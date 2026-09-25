import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixture, bot } from './helpers';
import { LifecycleCore } from '../src/core/lifecycle';
import { EffectLedger } from '../src/core/effects';
import { randomUUID } from 'node:crypto';
let f:ReturnType<typeof fixture>;afterEach(()=>f?.close());
function running(){
 f=fixture(true);const life=new LifecycleCore(f.store,f.core),boot=randomUUID();
 f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=1,lease_until=?",'2026-09-10T08:02:00.000Z');f.setNow('2026-09-10T08:00:00.000Z');
 const identity=life.registerBoot(boot);life.ready(identity);
 f.accept({schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'Read-only test.'}});const claim=life.claim(identity)!;life.submitted(identity,claim.run.id,1,'native');
 return {life,identity,runId:claim.run.id};
}
describe('bounded recovery',()=>{
 it.each([false,true])('retains a due retry while admission is disabled without reviving cancelled work: cancel=%s',cancel=>{
  const {life,identity,runId}=running();
  life.complete(identity,runId,1,{status:'failed',text:'Transient fixture',error_code:'TEMPORARY_UNAVAILABLE'});
  const timer=f.db.all('SELECT * FROM retry_queue'),run=f.store.run(runId),state=life.get();
  f.core.options.executionEnabled=false;
  f.setNow('2026-09-10T08:00:10.000Z');life.retryDue();
  f.setNow('2026-09-10T08:00:20.000Z');life.retryDue();
  expect(f.db.all('SELECT * FROM retry_queue')).toEqual(timer);
  expect(f.store.run(runId)).toEqual(run);expect(life.get()).toEqual(state);
  if(cancel){
   expect(f.accept({schema_version:1,type:'run.cancel',payload:{run_id:runId,reason:'No retry'}}).status).toBe('applied');
   life.retryDue();expect(f.db.all('SELECT * FROM retry_queue')).toEqual([]);
  }
  f.core.options.executionEnabled=true;life.retryDue();life.retryDue();
  expect(f.store.run(runId).status).toBe(cancel?'cancelled':'queued');
  expect(life.get().queue_sequence).toBe(state.queue_sequence+(cancel?0:1));
  expect(f.db.all('SELECT * FROM retry_queue')).toEqual([]);
  expect(life.claim(identity)?.run.current_attempt??null).toBe(cancel?null:2);
 });
 it('explicit retry replaces the old timer without shortening the next automatic backoff',()=>{
  const {life,identity,runId}=running();
  const failure={status:'failed' as const,text:'Retryable fixture',error_code:'TEMPORARY_UNAVAILABLE'};
  life.complete(identity,runId,1,failure);
  const pending=f.db.all('SELECT * FROM retry_queue');
  expect(pending).toEqual([{run_id:runId,due_at:'2026-09-10T08:00:10.000Z',reason:'TEMPORARY_UNAVAILABLE'}]);
  expect(f.accept({schema_version:1,type:'run.retry',payload:{run_id:runId,expected_attempt:0}}).status).toBe('rejected');
  expect(f.db.all('SELECT * FROM retry_queue')).toEqual(pending);
  f.setNow('2026-09-10T08:00:01.000Z');
  const key=randomUUID(),command={schema_version:1 as const,type:'run.retry' as const,payload:{run_id:runId,expected_attempt:1}};
  const receipt=f.accept(command,key);expect(receipt.status).toBe('applied');
  expect(f.db.all('SELECT * FROM retry_queue')).toEqual([]);
  expect(life.claim(identity)?.run).toMatchObject({id:runId,current_attempt:2});
  life.submitted(identity,runId,2,'native-second');
  f.setNow('2026-09-10T08:00:02.000Z');life.complete(identity,runId,2,failure);
  const next=[{run_id:runId,due_at:'2026-09-10T08:01:02.000Z',reason:'TEMPORARY_UNAVAILABLE'}];
  expect(f.db.all('SELECT * FROM retry_queue')).toEqual(next);
  expect(f.accept(command,key)).toEqual(receipt);
  expect(f.db.all('SELECT * FROM retry_queue')).toEqual(next);
  f.setNow('2026-09-10T08:00:10.000Z');life.retryDue();expect(f.store.run(runId).status).toBe('waiting');
  f.setNow('2026-09-10T08:01:01.999Z');life.retryDue();expect(f.store.run(runId).status).toBe('waiting');
  f.setNow('2026-09-10T08:01:02.000Z');life.retryDue();expect(f.store.run(runId)).toMatchObject({status:'queued',current_attempt:2});
  expect(f.db.all('SELECT * FROM retry_queue')).toEqual([]);
 });
 it('owner cancellation preserves recovery and unresolved custody while remaining deliverable',()=>{
  const {life,identity,runId}=running();
  life.heartbeat(identity,[{id:randomUUID(),run_id:runId,attempt:1,kind:'tool',status:'active',
   started_at:f.core.now(),last_progress_at:f.core.now(),deadline_at:'2026-09-10T08:02:00.000Z'}]);
  f.db.exec('INSERT INTO resource_locks VALUES(?,?,1,?)','external-record',runId,f.core.now());
  f.db.exec("INSERT INTO effects(id,run_id,action_key,classification,status,authorization_ref,request_digest,updated_at) VALUES(?,?,?,'mutation','dispatched','policy','digest',?)",randomUUID(),runId,randomUUID(),f.core.now());
  f.accept({schema_version:1,type:'run.cancel',payload:{run_id:runId,reason:'Stop'}});
  f.setNow('2026-09-10T08:00:30.000Z');life.watchdog();
  expect(f.store.run(runId).status).toBe('recovery_required');
  const before=Object.fromEntries(['operations','attempts','effects','resource_locks'].map(table=>[table,f.db.all(`SELECT * FROM ${table}`)]));
  expect(before.effects).toEqual([expect.objectContaining({status:'outcome_unknown'})]);
  f.setNow('2026-09-10T08:00:35.000Z');
  expect(f.accept({schema_version:1,type:'run.cancel',payload:{run_id:runId,reason:'Still stop'}}).status).toBe('applied');
  expect(f.store.run(runId)).toMatchObject({status:'recovery_required',error_code:'OWNER_CANCELLED'});
  for(const table of Object.keys(before))expect(f.db.all(`SELECT * FROM ${table}`)).toEqual(before[table]);
  expect(life.heartbeat(identity,[]).cancellations).toContain(runId);
  expect(f.accept({schema_version:1,type:'run.retry',payload:{run_id:runId,expected_attempt:1}}))
   .toMatchObject({status:'rejected',error:{code:'CANCEL_UNCONFIRMED'}});
  expect(()=>life.prepareSleep(identity)).toThrow(expect.objectContaining({code:'SLEEP_DENIED'}));
  expect(f.db.all('SELECT * FROM retry_queue')).toHaveLength(0);
  const events=f.db.all<{payload_json:string}>("SELECT payload_json FROM events WHERE type='run.cancellation_requested' ORDER BY sequence");
  expect(events.map(event=>JSON.parse(event.payload_json).status)).toEqual(['cancelling','recovery_required']);
 });
 it('distinct owner cancel commands do not restart the original cancellation grace',()=>{
  const {life,runId}=running();
  const cancel=()=>f.accept({schema_version:1,type:'run.cancel',payload:{run_id:runId,reason:'Stop'}});
  expect(cancel().status).toBe('applied');
  const began=f.store.run(runId).updated_at;
  f.setNow('2026-09-10T08:00:20.000Z');expect(cancel().status).toBe('applied');
  expect(f.store.run(runId)).toMatchObject({status:'cancelling',updated_at:began});
  expect(f.db.all("SELECT id FROM events WHERE type='run.cancellation_requested'")).toHaveLength(2);
  f.setNow('2026-09-10T08:00:29.999Z');life.watchdog();expect(f.store.run(runId).status).toBe('cancelling');
  f.setNow('2026-09-10T08:00:30.000Z');life.watchdog();
  expect(f.store.run(runId)).toMatchObject({status:'recovery_required',error_code:'OWNER_CANCELLED'});
  expect(f.db.all('SELECT status FROM attempts WHERE run_id=?',runId)).toEqual([{status:'running'}]);
  expect(f.db.all('SELECT * FROM retry_queue')).toHaveLength(0);
 });
 it('parks ignored cancellation without globally stopping other tasks',()=>{
  const {life,identity,runId}=running();f.accept({schema_version:1,type:'run.cancel',payload:{run_id:runId,reason:'Stop'}});
  f.setNow('2026-09-10T08:00:20.000Z');life.heartbeat(identity,[]);life.watchdog();expect(life.get().phase).toBe('READY');
  f.setNow('2026-09-10T08:00:31.000Z');life.watchdog();expect(life.get().phase).toBe('READY');expect(f.store.run(runId).status).toBe('recovery_required');expect(f.store.run(runId).error_code).toBe('OWNER_CANCELLED');
  expect(life.heartbeat(identity,[]).cancellations).toContain(runId);
  life.complete(identity,runId,1,{status:'cancelled',text:''});expect(f.db.all('SELECT * FROM retry_queue')).toHaveLength(0);
 });
 it('waits for confirmed provider stop before scheduling an interrupted read-only retry',()=>{
  const {life,runId}=running();f.setNow('2026-09-10T08:02:00.000Z');life.watchdog();expect(f.store.run(runId).status).toBe('recovery_required');
  expect(f.db.all('SELECT * FROM retry_queue')).toHaveLength(0);
  life.observeStopped({phase:'stopped',executionStopped:true,persistentState:'retained',observedAt:Date.now()});
  expect(f.store.run(runId).status).toBe('waiting');f.setNow('2026-09-10T08:02:11.000Z');life.retryDue();expect(f.store.run(runId).status).toBe('queued');
 });
 it.each([null,'',JSON.stringify({marker:'Retained checkpoint',padding:'界'.repeat(400000)})])('schedules stopped recovery without returning historical bodies (case %#)',checkpoint=>{
  const {life,runId}=running();
  const context=JSON.stringify({...JSON.parse(f.store.run(runId).context_json),padding:'x'.repeat(1100000)});
  f.db.exec('UPDATE runs SET context_json=?,checkpoint_json=? WHERE id=?',context,checkpoint,runId);
  f.setNow('2026-09-10T08:02:00.000Z');life.watchdog();
  const read=vi.spyOn(f.db,'all');
  try{
   life.observeStopped({phase:'stopped',executionStopped:true,persistentState:'retained',observedAt:Date.now()});
   const index=read.mock.calls.findIndex(([sql])=>sql.includes("FROM runs WHERE status='recovery_required'"));
   expect(index).toBeGreaterThanOrEqual(0);
   expect(read.mock.results[index].value).toEqual([{id:runId,role:'coordinator',current_attempt:1,error_code:'STALE_EPOCH'}]);
  }finally{read.mockRestore();}
  const due='2026-09-10T08:02:10.000Z';
  expect(f.store.run(runId)).toMatchObject({status:'waiting',current_attempt:1,context_json:context,
   checkpoint_json:checkpoint??JSON.stringify({retry_at:due}),error_code:'STALE_EPOCH'});
  expect(f.db.all('SELECT * FROM retry_queue')).toEqual([{run_id:runId,due_at:due,reason:'STALE_EPOCH'}]);
  expect(f.db.all('SELECT status FROM attempts WHERE run_id=?',runId)).toEqual([{status:'terminated'}]);
 });
 it('never retries an unknown external mutation after process termination',()=>{
  const {life,runId}=running();f.db.exec("INSERT INTO effects(id,run_id,action_key,classification,status,authorization_ref,request_digest,updated_at) VALUES(?,?,?,'mutation','dispatched','policy','digest',?)",randomUUID(),runId,randomUUID(),f.core.now());
  f.setNow('2026-09-10T08:02:00.000Z');life.watchdog();life.observeStopped({phase:'stopped',executionStopped:true,persistentState:'retained',observedAt:Date.now()});
  expect(f.store.run(runId).status).toBe('recovery_required');expect(f.db.all('SELECT * FROM retry_queue')).toHaveLength(0);
 });
 it('discards late output when context was invalidated',()=>{
  const {life,identity,runId}=running();f.db.exec("UPDATE runs SET status='cancelling',error_code='CONTEXT_INVALIDATED' WHERE id=?",runId);
  expect(()=>life.complete(identity,runId,1,{status:'completed',text:'removed fact'})).toThrow();
  life.complete(identity,runId,1,{status:'cancelled',text:'removed fact'});
  expect(JSON.stringify(f.db.all('SELECT * FROM outbox'))).not.toContain('removed fact');
 });
 it('uses a timed checkpoint for a transient read-only failure',()=>{
  const {life,identity,runId}=running();life.complete(identity,runId,1,{status:'failed',text:'Try later',error_code:'TEMPORARY_UNAVAILABLE'});
  expect(f.store.run(runId).status).toBe('waiting');expect(JSON.parse(f.store.run(runId).checkpoint_json!).retry_at).toBe('2026-09-10T08:00:10.000Z');
 });
 it('requires effect authorization, stable keys and receipts',()=>{
  const {runId}=running();const ledger=new EffectLedger(f.store,()=>f.core.now());
  const intent={id:randomUUID(),run_id:runId,attempt:1,action_key:'action-1',classification:'mutation' as const,authorization_ref:'not-granted',request_digest:'hash',provider_idempotency_key:null};
  expect(()=>ledger.intent(intent)).toThrow(expect.objectContaining({code:'FORBIDDEN'}));
  const result=ledger.intent({...intent,classification:'read_only'});expect(result.status).toBe('intent');
  ledger.transition(result.id,runId,'dispatched',null);
  expect(()=>ledger.transition(result.id,runId,'confirmed',null)).toThrow(expect.objectContaining({code:'INVALID_INPUT'}));
  ledger.transition(result.id,runId,'confirmed',{destination_id:'synthetic'});
  expect(ledger.intent({...intent,classification:'read_only'}).status).toBe('confirmed');
 });
});
