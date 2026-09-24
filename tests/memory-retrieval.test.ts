import {randomUUID} from 'node:crypto';
import {backup,DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it,vi} from 'vitest';
import {fixture,bot,otherBot,TestDatabase} from './helpers';
import {Store} from '../src/core/store';
import {ControlCore} from '../src/core/control';
import validateRuntime from '../src/generated/validate-runtime.js';
import {AgentCommandBoundary,MEMORY_READ_POLICY,type AgentMemoryRead} from '../src/core/agent-commands';
import {LifecycleCore} from '../src/core/lifecycle';
import {MEMORY_TOKENIZER,type MemoryPreparation} from '../src/core/memory-context';
import {prepareMemoryDelivery,countSelectedModelMemory} from '../runtime/memory-read.mjs';
import {MemoryReadRetention} from '../src/core/memory-read-retention';

function setup(global=3900,scoped=7700){
 const f=fixture(true),life=new LifecycleCore(f.store,f.core);
 const persona=f.store.get(bot,'persona');f.store.put(bot,'persona',{...persona.body,tool_policy_ids:[MEMORY_READ_POLICY]},persona.revision,'owner',f.core.now());
 const ids=[randomUUID(),randomUUID(),randomUUID()];
 for(const [i,id] of ids.entries())f.store.put(id,'memory',{scope:i===0?{kind:'global',id:null}:{kind:'persona',id:i===1?bot:otherBot},
  text:'A🧭e\u0301Z Source 73',source_event_id:randomUUID(),expires_at:'2026-09-10T00:00:20.000Z',sensitivity:'ordinary',explicit_constraint:false},0,'owner',f.core.now());
 const run=f.accept({schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'Read'}}).resource_id!;
 f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=1,lease_until='2026-09-10T00:02:00.000Z'");
 const identity=life.registerBoot(randomUUID());life.ready(identity);const models={[bot]:'gpt-5.4'};
 const prepared=life.prepareMemory(identity,models) as MemoryPreparation;
 const {global:_,scoped:__,...p}=prepared;
 life.claim(identity,models,{...p,tokenizer:MEMORY_TOKENIZER,global_tokens:global,scoped_tokens:scoped});
 const boundary=new AgentCommandBoundary(f.core,life);
 const query=(id=ids[1]):AgentMemoryRead=>({identity,run_id:run,attempt:1,read_id:randomUUID(),memory_id:id,revision:1,offset:1,limit:3});
 const reservation=(q:AgentMemoryRead,tokens=31)=>{
  const p=boundary.prepareMemoryRead(q);return {...q,sha256:p.sha256,selected_model:p.selected_model,tokenizer:p.tokenizer,tokens};
 };
 return {...f,life,boundary,query,reservation,ids,run,identity};
}

it('prepares exact Unicode ranges with disclosure, no writes, and no foreign-body reads',()=>{
 const f=setup();try{
  const before=f.db.all('SELECT total_changes() AS n'),q=f.query(),p=f.boundary.prepareMemoryRead(q);
  expect(JSON.parse(p.text)).toMatchObject({memory:{id:q.memory_id,revision:1,text:'🧭e\u0301'},range:{offset:1,end:4,truncated:true}});
  expect(p).toMatchObject({bucket:'scoped',not_after:'2026-09-10T00:00:20.000Z'});
  expect(f.db.all('SELECT total_changes() AS n')).toEqual(before);
  const get=vi.spyOn(f.store,'get');
  expect(()=>f.boundary.prepareMemoryRead(f.query(f.ids[2]))).toThrow(expect.objectContaining({code:'NOT_FOUND'}));
  expect(get).not.toHaveBeenCalled();get.mockRestore();
  const reordered=Object.fromEntries(Object.entries(q).reverse()) as AgentMemoryRead;
  expect(f.boundary.prepareMemoryRead(reordered)).toEqual(p);
 }finally{f.close();}
});

it('charges repeated envelopes cumulatively, reconciles a lost reply without redelivery, and survives reconstruction',()=>{
 const f=setup();try{
  const first=f.reservation(f.query(),201);
  expect(f.boundary.reserveMemoryRead(first)).toMatchObject({delivery_allowed:true});
  const rebuilt=new AgentCommandBoundary(f.core,new LifecycleCore(f.store,f.core));
  expect(rebuilt.reserveMemoryRead(first)).toMatchObject({delivery_allowed:false});
  expect(()=>rebuilt.reserveMemoryRead({...first,tokens:200})).toThrow(expect.objectContaining({code:'IDEMPOTENCY_CONFLICT'}));
  expect(f.boundary.reserveMemoryRead(f.reservation(f.query(),99))).toMatchObject({delivery_allowed:true});
  const before=f.db.all("SELECT * FROM runtime_metadata WHERE key GLOB 'memory-read:*'");
  expect(()=>f.boundary.reserveMemoryRead(f.reservation(f.query(),1))).toThrow(expect.objectContaining({code:'MEMORY_BUDGET_EXCEEDED'}));
  expect(f.db.all("SELECT * FROM runtime_metadata WHERE key GLOB 'memory-read:*'")).toEqual(before);
  const ledger=JSON.parse((before[0] as {value_json:string}).value_json);
  expect(ledger).toMatchObject({version:1,global:3900,scoped:8000});expect(ledger.reads).toHaveLength(2);
  expect(JSON.stringify(ledger)).not.toMatch(/Source 73|🧭|source_event_id/);
  expect(f.boundary.reserveMemoryRead(f.reservation(f.query(f.ids[0]),100))).toMatchObject({delivery_allowed:true});
  expect(()=>f.boundary.reserveMemoryRead(f.reservation(f.query(f.ids[0]),1))).toThrow(expect.objectContaining({code:'MEMORY_BUDGET_EXCEEDED'}));
 }finally{f.close();}
});

it('does not hydrate a newly private replacement behind an admitted pointer',()=>{
 const f=setup();try{
  const q=f.query(),m=f.store.get(q.memory_id);
  f.store.put(m.id,'memory',{...m.body,scope:{kind:'persona',id:otherBot},text:'FOREIGN_REPLACEMENT_91'},m.revision,'owner',f.core.now());
  const reads=vi.spyOn(f.db,'all');
  expect(()=>f.boundary.prepareMemoryRead(q)).toThrow(expect.objectContaining({code:'MEMORY_PREPARATION_STALE'}));
  const bodies=reads.mock.results.flatMap(result=>result.type==='return'?result.value:[]);
  expect(JSON.stringify(bodies)).not.toContain('FOREIGN_REPLACEMENT_91');reads.mockRestore();
 }finally{f.close();}
});

it.each(['expiry','edit','delete','cancel','lease','attempt','grant','budget','alpha'] as const)('revalidates %s after prepare and before any charge',change=>{
 const f=setup();try{
  const q=f.query(),r=f.reservation(q);
  if(change==='expiry')f.setNow('2026-09-10T00:00:20.000Z'); // No purge/maintenance needed.
  if(change==='edit'){const m=f.store.get(q.memory_id);f.store.put(m.id,'memory',{...m.body,text:'Replacement 91'},m.revision,'owner',f.core.now());}
  if(change==='delete')f.accept({schema_version:1,type:'memory.delete',payload:{id:q.memory_id,expected_revision:1,purge_transcripts:false}});
  if(change==='cancel')f.db.exec("UPDATE runs SET status='cancelling' WHERE id=?",f.run);
  if(change==='lease')f.db.exec('UPDATE lifecycle SET lease_until=?',f.core.now());
  if(change==='attempt')r.attempt=2;
  if(change==='alpha')Object.defineProperty(f.core.ownerAlpha,'policy',{value:{session_id:randomUUID()}});
  if(change==='grant'||change==='budget'){
   const context=JSON.parse(f.store.run(f.run).context_json);
   if(change==='grant')context.persona.body.tool_policy_ids=[];else delete context.memory_budget;
   f.db.exec('UPDATE runs SET context_json=? WHERE id=?',JSON.stringify(context),f.run);
  }
  expect(()=>f.boundary.reserveMemoryRead(r)).toThrow();
  expect(f.db.all("SELECT * FROM runtime_metadata WHERE key GLOB 'memory-read:*'")).toEqual([]);
 }finally{f.close();}
});

it('does not replay a completed reservation after source expiry',()=>{
 const f=setup();try{
  const r=f.reservation(f.query());f.boundary.reserveMemoryRead(r);
  const before=f.db.all("SELECT * FROM runtime_metadata WHERE key GLOB 'memory-read:*'");
  f.setNow('2026-09-10T00:00:20.000Z');
  expect(()=>f.boundary.reserveMemoryRead(r)).toThrow(expect.objectContaining({code:'MEMORY_PREPARATION_STALE'}));
  expect(f.db.all("SELECT * FROM runtime_metadata WHERE key GLOB 'memory-read:*'")).toEqual(before);
 }finally{f.close();}
});

it('caps ledger work at64 reservations even when token budget remains',()=>{
 const f=setup(1,1);try{
  for(let i=0;i<64;i++)f.boundary.reserveMemoryRead(f.reservation(f.query(),1));
  expect(()=>f.boundary.reserveMemoryRead(f.reservation(f.query(),1))).toThrow(expect.objectContaining({code:'MEMORY_PREPARATION_LIMIT'}));
 }finally{f.close();}
});

it('retains spent budget and no-redelivery custody across an actual SQLite snapshot and reopen',async()=>{
 const f=setup(),directory=await mkdtemp(join(tmpdir(),'hehe-memory-read-'));
 try{
  const r=f.reservation(f.query(),300);f.boundary.reserveMemoryRead(r);
  const path=join(directory,'control.sqlite');await backup(f.db.sqlite,path);
  const db=new TestDatabase(new DatabaseSync(path)),store=new Store(db),core=new ControlCore(store,f.core.options);
  try{
   const boundary=new AgentCommandBoundary(core,new LifecycleCore(store,core));
   expect(boundary.reserveMemoryRead(r)).toMatchObject({delivery_allowed:false});
   const q={...r,read_id:randomUUID()},p=boundary.prepareMemoryRead(q);
   expect(()=>boundary.reserveMemoryRead({...q,sha256:p.sha256,tokens:1})).toThrow(expect.objectContaining({code:'MEMORY_BUDGET_EXCEEDED'}));
  }finally{db.close();}
 }finally{f.close();await rm(directory,{recursive:true,force:true});}
});

it('validates both authenticated wire stages without permitting caller-selected scope or oversized ranges',()=>{
 const f=setup();try{
  const q=f.query(),r=f.reservation(q);
  for(const [type,payload] of [['memory-read-prepare',q],['memory-read-reserve',r]] as const){
   expect(validateRuntime({type,payload})).toBe(true);
   for(const patch of [{limit:2001},{offset:-1},{revision:0},{read_id:'forged'},{scope:'global'}]){
    expect(validateRuntime({type,payload:{...payload,...patch}})).toBe(false);
   }
  }
  for(const patch of [{tokens:0},{tokens:1.5},{tokenizer:'other'},{sha256:'x'}]){
   expect(validateRuntime({type:'memory-read-reserve',payload:{...r,...patch}})).toBe(false);
  }
 }finally{f.close();}
});

it('real runtime counting reserves against SQLite before delivery and source changes during counting refuse',async()=>{
 for(const edit of [false,true]){
  const f=setup(0,0);try{
   const q=f.query(),p=f.boundary.prepareMemoryRead(q),calls:string[]=[];
   const config={identity:f.identity,runId:f.run,attempt:1,memoryBudget:{selected_model:p.selected_model,sha256:p.baseline_sha256}};
   const controlClient={request:async(type:string,payload:unknown)=>{
    expect(validateRuntime({type,payload})).toBe(true);calls.push(type);
    return type==='memory-read-prepare'?f.boundary.prepareMemoryRead(payload as AgentMemoryRead):
     f.boundary.reserveMemoryRead(payload as Parameters<AgentCommandBoundary['reserveMemoryRead']>[0]);
   }};
   const operation=prepareMemoryDelivery({controlClient,config,args:{memory_id:q.memory_id,revision:1,offset:1,limit:3},
    signal:undefined,now:()=>Date.parse(f.core.now()),counter:async(input:Parameters<typeof countSelectedModelMemory>[0],options:Parameters<typeof countSelectedModelMemory>[1])=>{
     const counts=await countSelectedModelMemory(input,options);
     if(edit){const m=f.store.get(q.memory_id);f.store.put(m.id,'memory',{...m.body,text:'Replacement 91'},m.revision,'owner',f.core.now());}
     return counts;
    }});
   if(edit){
    await expect(operation).rejects.toMatchObject({code:'MEMORY_PREPARATION_STALE'});
    expect(f.db.all("SELECT * FROM runtime_metadata WHERE key GLOB 'memory-read:*'")).toEqual([]);
   }else{
    const take=await operation;
    expect(take()).toBe(p.text);expect(()=>take()).toThrow('MEMORY_READ_DENIED');
    const row=f.db.all<{value_json:string}>("SELECT value_json FROM runtime_metadata WHERE key GLOB 'memory-read:*'")[0];
    expect(JSON.parse(row.value_json).scoped).toBeGreaterThan(50);
    expect(row.value_json).not.toContain('🧭');
   }
   expect(calls).toEqual(['memory-read-prepare','memory-read-reserve']);
  }finally{f.close();}
 }
});

it('retention starts from the memory-read key range and looks up exact attempts rather than scanning unrelated history',()=>{
 const f=setup();try{
  f.boundary.reserveMemoryRead(f.reservation(f.query()));f.life.complete(f.identity,f.run,1,{status:'failed',text:'Terminal'});
  f.db.transaction(()=>{
   for(let n=2;n<=1001;n++)f.db.exec('INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,status,deadline_at,settled_at) SELECT run_id,?,?,epoch,boot_id,status,deadline_at,settled_at FROM attempts WHERE run_id=? AND attempt=1',n,`unrelated-${n}`,f.run);
  });
  const retention=new MemoryReadRetention(f.store,()=>f.core.now());f.setNow('2026-12-09T00:00:00.000Z');
  const read=vi.spyOn(f.db,'all');
  expect(retention.nextDue()).toBe(f.core.now());expect(retention.prune()).toBe(1);
  const calls=read.mock.calls.slice();read.mockRestore();
  expect(calls).toHaveLength(2);
  for(const [sql,...values] of calls){
   const plan=f.db.all<{detail:string}>(`EXPLAIN QUERY PLAN ${sql}`,...values).map(row=>row.detail).join('\n');
   expect(plan).toMatch(/^SEARCH m USING COVERING INDEX .*\(key>\? AND key<\?\)/);
   expect(plan).toMatch(/SEARCH a USING INDEX .*\(run_id=\? AND attempt=\?\)/);
   expect(plan).toMatch(/SEARCH r USING INDEX .*\(id=\?\)/);
   expect(plan).not.toMatch(/SCAN a\b|SCAN m\b/);
  }
  expect(f.db.all('SELECT attempt FROM attempts')).toHaveLength(1001);
 }finally{vi.restoreAllMocks();f.close();}
});

it('retention never adopts numeric aliases, noncanonical task keys or orphan ledgers',()=>{
 const f=setup();try{
  f.boundary.reserveMemoryRead(f.reservation(f.query()));f.life.complete(f.identity,f.run,1,{status:'failed',text:'Terminal'});
  const keys=[...['01','1junk','1.0','+1','1:1'].map(suffix=>`memory-read:${f.run}:${suffix}`),
   `memory-read:${randomUUID()}:1`,`memory-read:${f.run}:2`,`unrelated:${f.run}:1`];
  for(const key of keys)f.db.exec("INSERT INTO runtime_metadata VALUES(?,'{}')",key);
  const retention=new MemoryReadRetention(f.store,()=>f.core.now());f.setNow('2026-12-09T00:00:00.000Z');
  expect(retention.prune()).toBe(1);expect(retention.nextDue()).toBeNull();expect(retention.prune()).toBe(0);
  expect(f.db.all<{key:string}>('SELECT key FROM runtime_metadata WHERE key IN (SELECT value FROM json_each(?)) ORDER BY key',JSON.stringify(keys)).map(row=>row.key)).toEqual(keys.sort());
 }finally{f.close();}
});

it('expires read ledgers at 90 days after terminal settlement without changing structural custody or reopening reads',()=>{
 const f=setup();try{
  const q=f.query();f.boundary.reserveMemoryRead(f.reservation(q));
  f.life.complete(f.identity,f.run,1,{status:'failed',text:'Terminal result'});
  const retention=new MemoryReadRetention(f.store,()=>f.core.now());
  const records=['runs','attempts','outbox'].map(table=>f.db.all(`SELECT * FROM ${table}`));
  expect(retention.nextDue()).toBe('2026-12-09T00:00:00.000Z');
  f.setNow('2026-12-08T23:59:59.999Z');expect(retention.prune()).toBe(0);
  f.setNow('2026-12-09T00:00:00.000Z');expect(retention.prune()).toBe(1);
  expect(retention.nextDue()).toBeNull();expect(retention.prune()).toBe(0);
  expect(['runs','attempts','outbox'].map(table=>f.db.all(`SELECT * FROM ${table}`))).toEqual(records);
  // Isolate the terminal-state fence from expired lease/source time guards.
  f.setNow('2026-09-10T00:00:01.000Z');
  expect(()=>f.boundary.prepareMemoryRead(q)).toThrow(expect.objectContaining({code:'REVISION_CONFLICT'}));
  expect(f.db.all("SELECT * FROM runtime_metadata WHERE key GLOB 'memory-read:*'")).toEqual([]);
 }finally{f.close();}
});

it.each(['running','waiting','recovery_required','retry','operation','lock','effect','delivery','question','grandchild','nested-effect'] as const)('retains read charges with %s custody even after 90 days',obstacle=>{
 const f=setup();try{
  f.boundary.reserveMemoryRead(f.reservation(f.query()));
  f.life.complete(f.identity,f.run,1,{status:'completed',text:'Terminal root'});
  if(['running','waiting','recovery_required'].includes(obstacle))f.db.exec('UPDATE runs SET status=? WHERE id=?',obstacle,f.run);
  if(obstacle==='retry')f.db.exec("INSERT INTO retry_queue VALUES(?,?,'synthetic')",f.run,f.core.now());
  if(obstacle==='operation')f.db.exec("INSERT INTO operations VALUES('op',?,1,'tool','unknown',?,?,?)",f.run,f.core.now(),f.core.now(),f.core.now());
  if(obstacle==='lock')f.db.exec("INSERT INTO resource_locks VALUES('resource',?,1,?)",f.run,f.core.now());
  if(obstacle==='effect')f.db.exec("INSERT INTO effects(id,run_id,action_key,classification,status,authorization_ref,request_digest,updated_at) VALUES('effect',?,'key','mutation','outcome_unknown','policy','digest',?)",f.run,f.core.now());
  if(obstacle==='delivery')f.db.exec("UPDATE outbox SET status='pending' WHERE run_id=?",f.run);
  if(obstacle==='question')f.db.exec('INSERT INTO runtime_metadata VALUES(?,?)','native-question:fixture',JSON.stringify({run_id:f.run,state:'response_unknown'}));
  if(obstacle==='grandchild'||obstacle==='nested-effect'){
   for(const [id,parent,status] of [['child',f.run,'completed'],['grandchild','child',obstacle==='grandchild'?'running':'completed']])
    f.db.exec("INSERT INTO runs(id,persona_id,context_json,role,parent_run_id,status,created_at,updated_at) VALUES(?,?,'{}','background',?,?,?,?)",id,bot,parent,status,f.core.now(),f.core.now());
   if(obstacle==='nested-effect')f.db.exec("INSERT INTO effects(id,run_id,action_key,classification,status,authorization_ref,request_digest,updated_at) VALUES('nested','grandchild','key','mutation','outcome_unknown','policy','digest',?)",f.core.now());
  }
  const before=f.db.all('SELECT * FROM runtime_metadata');
  const retention=new MemoryReadRetention(f.store,()=>f.core.now());f.setNow('2026-12-09T00:00:00.000Z');
  expect(retention.nextDue()).toBeNull();expect(retention.prune()).toBe(0);
  expect(f.db.all('SELECT * FROM runtime_metadata')).toEqual(before);
 }finally{f.close();}
});

it('bounds ledger deletion to 100 exact attempt keys, is independent of result-body pruning and rolls back failure',()=>{
 const f=setup();try{
  f.boundary.reserveMemoryRead(f.reservation(f.query()));f.life.complete(f.identity,f.run,1,{status:'completed',text:'Result'});
  const original=f.db.all<{value_json:string}>("SELECT value_json FROM runtime_metadata WHERE key GLOB 'memory-read:*'")[0].value_json;
  for(let n=2;n<=101;n++){
   f.db.exec('INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,status,deadline_at,settled_at) SELECT run_id,?,?,epoch,boot_id,status,deadline_at,settled_at FROM attempts WHERE run_id=? AND attempt=1',n,`synthetic-${n}`,f.run);
   f.db.exec('INSERT INTO runtime_metadata VALUES(?,?)',`memory-read:${f.run}:${n}`,original);
  }
  f.db.exec('UPDATE attempts SET result_json=NULL');
  f.db.exec("INSERT INTO runtime_metadata VALUES('unrelated','{}')");
  const retention=new MemoryReadRetention(f.store,()=>f.core.now());f.setNow('2026-12-09T00:00:00.000Z');
  f.db.sqlite.exec("CREATE TRIGGER reject_memory_prune BEFORE DELETE ON runtime_metadata WHEN OLD.key LIKE '%:2' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
  expect(()=>retention.prune()).toThrow('synthetic failure');
  expect(f.db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'memory-read:*'")).toHaveLength(101);
  f.db.sqlite.exec('DROP TRIGGER reject_memory_prune');
  expect(retention.prune()).toBe(100);expect(retention.nextDue()).toBe(f.core.now());
  expect(retention.prune()).toBe(1);expect(retention.nextDue()).toBeNull();
  expect(f.db.all('SELECT key FROM runtime_metadata')).toContainEqual({key:'unrelated'});
 }finally{f.close();}
});
