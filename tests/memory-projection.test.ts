import {createHash,randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {fixture,bot,otherBot} from './helpers';
import {LifecycleCore} from '../src/core/lifecycle';
import {AgentCommandBoundary,MEMORY_READ_POLICY} from '../src/core/agent-commands';
import {MEMORY_TOKENIZER,type MemoryPreparation,type MemoryBudgetReceipt} from '../src/core/memory-context';
import validateRuntime from '../src/generated/validate-runtime.js';

function setup(policy=true){
 const f=fixture(true),life=new LifecycleCore(f.store,f.core);
 const persona=f.store.get(bot,'persona');
 f.store.put(bot,'persona',{...persona.body,tool_policy_ids:policy?[MEMORY_READ_POLICY]:[]},persona.revision,'owner',f.core.now());
 const add=(constraint:boolean|undefined=false,scope={kind:'persona',id:bot as string|null},text='Raw source 73 🧭 e\u0301. '.repeat(40))=>{
  const id=randomUUID(),event=randomUUID();f.store.event(event,bot,'message.user','owner',null,{text:'Source'},f.core.now());
  const body={id,expected_revision:0,scope,text,source_event_id:event,expires_at:'2026-09-10T00:00:20.000Z',sensitivity:'ordinary',explicit_constraint:constraint};
  const digest=createHash('sha256').update(JSON.stringify([1,id,1,scope.kind,scope.id,text,event,body.expires_at,'ordinary',false])).digest('hex');
  const summary={schema_version:1,source_sha256:digest,text:'Owner summary 29.'};
  // Constraint fixtures deliberately carry unusable legacy metadata; projection
  // must independently refuse it rather than trust only memory.put validation.
  f.store.put(id,'memory',{...body,summary},0,'owner',f.core.now());
  return {id,body,summary};
 };
 const start=()=>{
  const run=f.accept({schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'Read source'}}).resource_id!;
  f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=1,lease_until='2026-09-10T00:02:00.000Z'");
  const identity=life.registerBoot(randomUUID());life.ready(identity);
  return {run,identity};
 };
 const models={[bot]:'gpt-5.4'};
 const receipt=(p:MemoryPreparation):MemoryBudgetReceipt=>{const {global:_,scoped:__,...rest}=p;return {...rest,tokenizer:MEMORY_TOKENIZER,global_tokens:100,scoped_tokens:200};};
 return {...f,life,add,start,models,receipt};
}

it.each([[true,true],[true,false],[false,true],[false,false]])('projects only with both persona policy=%s and host retrieval=%s', (policy,host)=>{
 const f=setup(policy);try{
  const m=f.add(),{identity}=f.start(),hosts=host?[bot]:[];
  const p=f.life.prepareMemory(identity,f.models,hosts) as MemoryPreparation;
  const entry=JSON.parse(p.scoped)[0];
  if(policy&&host){
   expect(entry.body.text).toBe(m.summary.text);expect(entry.body).not.toHaveProperty('summary');
   expect(entry).toMatchObject({id:m.id,revision:1,representation:{kind:'owner_summary',source_sha256:m.summary.source_sha256,
    source_code_points:Array.from(m.body.text).length,load_with:'hehebot_read_memory'}});
   expect(entry.representation.disclosure).toMatch(/not the full source/);
   expect(p.scoped).not.toContain('Raw source 73');
  }else {expect(entry.body.text).toBe(m.body.text);expect(entry).not.toHaveProperty('representation');}
  const claim=f.life.claim(identity,f.models,f.receipt(p),hosts)!;
  expect(JSON.stringify(JSON.parse(claim.run.context_json).memories)).toBe(p.scoped);
  expect(f.store.get(m.id).body.text).toBe(m.body.text);
 }finally{f.close();}
});

it('keeps true/unclassified constraints verbatim and preserves exact scope and bucket boundaries',()=>{
 const f=setup();try{
  const yes=f.add(true),unknown=f.add(undefined),global=f.add(false,{kind:'global',id:null}),foreign=f.add(false,{kind:'persona',id:otherBot});
  // JS default parameters need an explicit legacy-field removal for undefined.
  const row=f.store.get(unknown.id);delete row.body.explicit_constraint;
  f.db.exec('UPDATE objects SET body_json=? WHERE id=?',JSON.stringify(row.body),unknown.id);
  const {identity}=f.start(),p=f.life.prepareMemory(identity,f.models,[bot]) as MemoryPreparation;
  const scoped=JSON.parse(p.scoped);
  for(const m of [yes,unknown]){expect(scoped.find((e:{id:string})=>e.id===m.id).body.text).toBe(m.body.text);}
  expect(scoped.every((e:object)=>!('representation' in e))).toBe(true);
  expect(JSON.parse(p.global)[0]).toMatchObject({id:global.id,representation:{kind:'owner_summary'}});
  expect(p.global+p.scoped).not.toContain(foreign.id);
 }finally{f.close();}
});

it.each(['host','policy','source'] as const)('refuses stale projection when %s changes between prepare and claim',change=>{
 const f=setup();try{
  const m=f.add(),{identity}=f.start(),p=f.life.prepareMemory(identity,f.models,[bot]) as MemoryPreparation;
  if(change==='policy'){const persona=f.store.get(bot);f.store.put(bot,'persona',{...persona.body,tool_policy_ids:[]},persona.revision,'owner',f.core.now());}
  if(change==='source'){const record=f.store.get(m.id);f.store.put(m.id,'memory',{...record.body,text:'Changed source'},record.revision,'owner',f.core.now());}
  expect(()=>f.life.claim(identity,f.models,f.receipt(p),change==='host'?[]:[bot])).toThrow(expect.objectContaining({code:'MEMORY_PREPARATION_STALE'}));
  expect(f.db.all('SELECT * FROM attempts')).toEqual([]);
 }finally{f.close();}
});

it('retrieves raw code-point ranges from a projected pointer and refuses same-revision source tampering',()=>{
 const f=setup();try{
  const m=f.add(),{identity,run}=f.start(),p=f.life.prepareMemory(identity,f.models,[bot]) as MemoryPreparation;
  f.life.claim(identity,f.models,f.receipt(p),[bot]);
  const boundary=new AgentCommandBoundary(f.core,f.life),q={identity,run_id:run,attempt:1,read_id:randomUUID(),memory_id:m.id,revision:1,offset:0,limit:13};
  const read=boundary.prepareMemoryRead(q);
  expect(JSON.parse(read.text).memory.text).toBe('Raw source 73');
  expect(boundary.reserveMemoryRead({...q,sha256:read.sha256,selected_model:read.selected_model,tokenizer:read.tokenizer,tokens:50})).toMatchObject({delivery_allowed:true});
  const row=f.store.get(m.id);row.body.text='Tampered body with unchanged revision';
  f.db.exec('UPDATE objects SET body_json=? WHERE id=?',JSON.stringify(row.body),m.id);
  expect(()=>boundary.prepareMemoryRead({...q,read_id:randomUUID()})).toThrow(expect.objectContaining({code:'MEMORY_PREPARATION_STALE'}));
 }finally{f.close();}
});

it('checks full-source byte work limits before summary projection',()=>{
 const f=setup();try{
  const {identity,run}=f.start();
  for(let i=0;i<3;i++)f.add(false,undefined,'🧭'.repeat(16000));
  expect(f.life.prepareMemory(identity,f.models,[bot])).toMatchObject({blocked:true,reason:'MEMORY_PREPARATION_LIMIT',run_id:run});
  expect(f.db.all('SELECT * FROM attempts')).toEqual([]);
 }finally{f.close();}
});

it.each(['expiry','delete','scope','summary'] as const)('refuses a projected read when %s changes after preparation',change=>{
 const f=setup();try{
  const m=f.add(),{identity,run}=f.start(),p=f.life.prepareMemory(identity,f.models,[bot]) as MemoryPreparation;
  f.life.claim(identity,f.models,f.receipt(p),[bot]);
  const boundary=new AgentCommandBoundary(f.core,f.life),q={identity,run_id:run,attempt:1,read_id:randomUUID(),memory_id:m.id,revision:1,offset:0,limit:13};
  const read=boundary.prepareMemoryRead(q);
  if(change==='expiry')f.setNow(m.body.expires_at);
  if(change==='delete')f.accept({schema_version:1,type:'memory.delete',payload:{id:m.id,expected_revision:1,purge_transcripts:false}});
  if(change==='scope'||change==='summary'){
   const row=f.store.get(m.id);
   if(change==='scope')row.body.scope={kind:'persona',id:otherBot};else row.body.summary={...m.summary,text:'Changed summary 81'};
   f.db.exec('UPDATE objects SET body_json=? WHERE id=?',JSON.stringify(row.body),m.id);
  }
  expect(()=>boundary.reserveMemoryRead({...q,sha256:read.sha256,selected_model:read.selected_model,tokenizer:read.tokenizer,tokens:50})).toThrow();
  expect(f.db.all("SELECT * FROM runtime_metadata WHERE key GLOB 'memory-read:*'")).toEqual([]);
 }finally{f.close();}
});

it.each(['memory-prepare','claim'])('validates optional bounded host capability on %s',type=>{
 const payload={identity:{epoch:1,boot_id:randomUUID()},persona_models:{[bot]:'gpt-5.4'}};
 expect(validateRuntime({type,payload})).toBe(true);
 for(const memory_read_personas of [[],[bot],Array.from({length:256},()=>randomUUID())])expect(validateRuntime({type,payload:{...payload,memory_read_personas}})).toBe(true);
 for(const memory_read_personas of [[bot,bot],['not-a-uuid'],Array.from({length:257},()=>randomUUID()),true])expect(validateRuntime({type,payload:{...payload,memory_read_personas}})).toBe(false);
});
