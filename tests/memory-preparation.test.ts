import {randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {fixture,bot,otherBot} from './helpers';
import {LifecycleCore} from '../src/core/lifecycle';
import {MEMORY_TOKENIZER,type MemoryPreparation,type MemoryBudgetReceipt} from '../src/core/memory-context';
import validateRuntime from '../src/generated/validate-runtime.js';

function setup(){
 const f=fixture(true),life=new LifecycleCore(f.store,f.core);
 f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=1,lease_until='2026-09-10T00:02:00.000Z'");
 const identity=life.registerBoot(randomUUID());life.ready(identity);
 const add=(scope='persona',id:string|null=bot,text='Never submit without approval.',expires_at:string|null=null)=>{
  const key=randomUUID();f.store.put(key,'memory',{scope:{kind:scope,id},text,expires_at,explicit_constraint:true},0,'owner',f.core.now());return key;
 };
 const enqueue=()=>f.accept({schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'Read scoped memory'}}).resource_id!;
 const models={[bot]:'gpt-5.4'};
 const prepare=()=>{
  const value=life.prepareMemory(identity,models);
  expect(value&&!('blocked' in value)).toBe(true);
  return value as MemoryPreparation;
 };
 const receipt=(p:MemoryPreparation,global_tokens=4000,scoped_tokens=8000):MemoryBudgetReceipt=>{
  const {global:_,scoped:__,...identity}=p;
  return {...identity,tokenizer:MEMORY_TOKENIZER,global_tokens,scoped_tokens};
 };
 return {...f,life,identity,add,enqueue,models,prepare,receipt};
}

it('prepares without claiming and admits exact bucket limits with full constraints and scope',()=>{
 const f=setup();try{
  const global=f.add('global',null,'Global constraint'),own=f.add(),foreign=f.add('persona',otherBot);
  const id=f.enqueue(),before=f.db.all('SELECT * FROM lifecycle');
  const p=f.prepare();
  expect(JSON.parse(p.global).map((m:{id:string})=>m.id)).toEqual([global]);
  expect(JSON.parse(p.scoped).map((m:{id:string})=>m.id)).toEqual([own]);
  expect(p.global+p.scoped).not.toContain(foreign);
  expect(f.db.all('SELECT * FROM attempts')).toEqual([]);
  expect(f.db.all('SELECT * FROM lifecycle')).toEqual(before);
  const claim=f.life.claim(f.identity,f.models,f.receipt(p))!;
  expect(claim.run.id).toBe(id);expect(claim.run.current_attempt).toBe(1);
  const context=JSON.parse(claim.run.context_json);
  expect(context.memories.map((m:{id:string})=>m.id).sort()).toEqual([global,own].sort());
  expect(context.memories.every((m:{body:{explicit_constraint:boolean}})=>m.body.explicit_constraint)).toBe(true);
  expect(context.authorization_policy_ids).toEqual([]);
  expect(context.memory_budget).toEqual(f.receipt(p));
 }finally{f.close();}
});

it.each([[4001,8000],[4000,8001]])('blocks overflow %s/%s durably before any attempt', (global,scoped)=>{
 const f=setup();try{
  f.add();const id=f.enqueue(),p=f.prepare();
  expect(f.life.claim(f.identity,f.models,f.receipt(p,global,scoped))).toBeNull();
  expect(f.store.run(id)).toMatchObject({status:'waiting',current_attempt:0,error_code:'MEMORY_BUDGET_EXCEEDED'});
  expect(f.db.all('SELECT * FROM attempts')).toEqual([]);
  expect(f.life.prepareMemory(f.identity,f.models)).toBeNull();
  expect(f.db.all("SELECT * FROM events WHERE type='run.waiting'")).toHaveLength(1);
 }finally{f.close();}
});

it('keeps overflow parked across passive memory edits; only explicit retry readmits it',()=>{
 const f=setup();try{
  const key=f.add(),id=f.enqueue(),p=f.prepare();
  f.life.claim(f.identity,f.models,f.receipt(p,4001,1));
  const metadata=f.db.all('SELECT * FROM runtime_metadata'),lifecycle=f.db.all('SELECT * FROM lifecycle');
  const edited=f.accept({schema_version:1,type:'memory.put',payload:{id:key,expected_revision:1,
   scope:{kind:'persona',id:bot},text:'Keep approval required.',source_event_id:f.store.run(id).command_id!,
   expires_at:null,sensitivity:'ordinary'}});
  expect(edited.status).toBe('applied');
  expect(f.store.get(key).body.explicit_constraint).toBe(true);
  expect(f.store.run(id)).toMatchObject({status:'waiting',current_attempt:0});
  expect(f.db.all('SELECT * FROM runtime_metadata')).toEqual(metadata);
  expect(f.db.all('SELECT * FROM lifecycle')).toEqual(lifecycle);
  expect(f.db.all('SELECT * FROM controller_operations')).toEqual([]);
  expect(f.db.all('SELECT * FROM attempts')).toEqual([]);
  expect(f.accept({schema_version:1,type:'run.retry',payload:{run_id:id,expected_attempt:0}}).status).toBe('applied');
  const fresh=f.prepare();expect(fresh.run_id).toBe(id);expect(fresh.attempt).toBe(1);
  expect(fresh.sha256).not.toBe(p.sha256);
  expect(f.life.claim(f.identity,f.models,f.receipt(fresh,1,50))?.run.current_attempt).toBe(1);
  expect(f.db.all('SELECT * FROM runs')).toHaveLength(1);
 }finally{f.close();}
});

it.each(['add','edit','move','delete','expire','model','task'] as const)('rejects stale %s before claim without consuming an attempt',change=>{
 const f=setup();try{
  const key=f.add('persona',bot,'Current constraint','2026-09-10T00:00:01.000Z');
  const id=f.enqueue(),p=f.prepare();
  if(change==='add')f.add('global',null,'New explicit constraint');
  if(change==='edit'||change==='move'){
   const old=f.store.get(key);f.store.put(key,'memory',{...old.body,...(change==='edit'?{text:'Corrected constraint'}:{scope:{kind:'persona',id:otherBot}})},1,'owner',f.core.now());
  }
  if(change==='delete')f.db.exec('UPDATE objects SET deleted_at=? WHERE id=?',f.core.now(),key);
  if(change==='expire')f.setNow('2026-09-10T00:00:01.000Z');
  const receipt=f.receipt(p);
  if(change==='task')receipt.run_id=randomUUID();
  expect(()=>f.life.claim(f.identity,change==='model'?{[bot]:'gpt-5.5'}:f.models,receipt)).toThrow(expect.objectContaining({code:'MEMORY_PREPARATION_STALE'}));
  expect(f.store.run(id)).toMatchObject({status:'queued',current_attempt:0});
  expect(f.db.all('SELECT * FROM attempts')).toEqual([]);
 }finally{f.close();}
});

it('blocks work limits without emitting a truncated set or starting an attempt',()=>{
 const f=setup();try{
  for(let i=0;i<65;i++)f.add();
  const id=f.enqueue();
  expect(f.life.prepareMemory(f.identity,f.models)).toEqual({blocked:true,run_id:id,reason:'MEMORY_PREPARATION_LIMIT'});
  expect(f.store.run(id)).toMatchObject({status:'waiting',current_attempt:0});
  expect(f.db.all('SELECT * FROM attempts')).toEqual([]);
 }finally{f.close();}
});

it('fences unsupported tokenizer identity and invalid counts without mutation',()=>{
 const f=setup();try{
  f.add();f.enqueue();const receipt=f.receipt(f.prepare());
  expect(()=>f.life.claim(f.identity,f.models,{...receipt,tokenizer:'unknown'} as never)).toThrow(expect.objectContaining({code:'MEMORY_PREPARATION_STALE'}));
  for(const count of [-1,0.5,NaN,Infinity])expect(()=>f.life.claim(f.identity,f.models,{...receipt,global_tokens:count})).toThrow(expect.objectContaining({code:'INVALID_INPUT'}));
  expect(f.db.all('SELECT * FROM attempts')).toEqual([]);
 }finally{f.close();}
});

it('returns all 64 scoped records but refuses 65, including expired work',()=>{
 const f=setup();try{
  for(let i=0;i<64;i++)f.add();
  f.enqueue();
  expect(JSON.parse(f.prepare().scoped)).toHaveLength(64);
  f.add('persona',bot,'Expired row','2026-09-09T00:00:00.000Z');
  expect(f.life.prepareMemory(f.identity,f.models)).toMatchObject({blocked:true,reason:'MEMORY_PREPARATION_LIMIT'});
  expect(f.db.all('SELECT * FROM attempts')).toEqual([]);
 }finally{f.close();}
});

it('bounds the exact combined UTF-8 arrays, not text length or each bucket separately',()=>{
 const f=setup();try{
  f.add('global',null,'😀'.repeat(16000));f.add('persona',bot,'😀'.repeat(16000));
  const key=f.add('persona',bot,'');f.enqueue();
  const p=f.prepare(),remaining=131072-Buffer.byteLength(p.global+p.scoped);
  expect(remaining).toBeGreaterThan(0);expect(remaining).toBeLessThan(16000);
  const old=f.store.get(key);
  f.store.put(key,'memory',{...old.body,text:'a'.repeat(remaining)},1,'owner',f.core.now());
  const exact=f.prepare();
  expect(Buffer.byteLength(exact.global+exact.scoped)).toBe(131072);
  f.store.put(key,'memory',{...old.body,text:'a'.repeat(remaining+1)},2,'owner',f.core.now());
  expect(f.life.prepareMemory(f.identity,f.models)).toMatchObject({blocked:true,reason:'MEMORY_PREPARATION_LIMIT'});
  expect(f.db.all('SELECT * FROM attempts')).toEqual([]);
 }finally{f.close();}
});

it.each(['expired-lease','wrong-boot','disabled'] as const)('denies %s before reading any memory',mode=>{
 const f=setup();try{
  f.add();f.enqueue();
  const read=vi.spyOn(f.store,'scopedMemories');
  let identity=f.identity;
  if(mode==='expired-lease')f.setNow('2026-09-10T00:02:00.000Z');
  if(mode==='wrong-boot')identity={...identity,boot_id:randomUUID()};
  if(mode==='disabled')f.core.options.executionEnabled=false;
  expect(()=>f.life.prepareMemory(identity,f.models)).toThrow(expect.objectContaining({code:mode==='disabled'?'CAPABILITY_UNAVAILABLE':'STALE_EPOCH'}));
  expect(read).not.toHaveBeenCalled();expect(f.db.all('SELECT * FROM attempts')).toEqual([]);
 }finally{vi.restoreAllMocks();f.close();}
});

it('rejects a prepared receipt when a different queued task becomes the next candidate',()=>{
 const f=setup();try{
  f.add();const first=f.enqueue(),p=f.prepare();
  f.setNow('2026-09-10T00:00:00.001Z');const second=f.enqueue();
  f.db.exec("UPDATE runs SET status='cancelled' WHERE id=?",first);
  expect(()=>f.life.claim(f.identity,f.models,f.receipt(p))).toThrow(expect.objectContaining({code:'MEMORY_PREPARATION_STALE'}));
  expect(f.store.run(second)).toMatchObject({status:'queued',current_attempt:0});
  expect(f.db.all('SELECT * FROM attempts')).toEqual([]);
 }finally{f.close();}
});

it('validates the wire preparation and receipt without accepting extra authority fields',()=>{
 const f=setup();try{
  f.add();f.enqueue();const receipt=f.receipt(f.prepare());
  const prepare={type:'memory-prepare',payload:{identity:f.identity,persona_models:f.models}};
  const claim={type:'claim',payload:{identity:f.identity,persona_models:f.models,memory_budget:receipt}};
  expect(validateRuntime(prepare)).toBe(true);expect(validateRuntime(claim)).toBe(true);
  expect(validateRuntime({...prepare,payload:{identity:f.identity}})).toBe(false);
  for(const value of [{...receipt,authorization_policy_ids:['untrusted']},{...receipt,global_tokens:0.1},
   {...receipt,scoped_tokens:Number.MAX_SAFE_INTEGER+1},{...receipt,sha256:'bad'}, {...receipt,tokenizer:'other'}]){
   expect(validateRuntime({...claim,payload:{...claim.payload,memory_budget:value}})).toBe(false);
  }
 }finally{f.close();}
});
