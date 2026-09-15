import { afterEach, describe, expect, it } from 'vitest';
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
