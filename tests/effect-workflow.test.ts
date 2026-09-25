import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ControlCore, parseCommand } from '../src/core/control';
import { Store } from '../src/core/store';
import { LifecycleCore, type Identity } from '../src/core/lifecycle';
import { EffectLedger, type EffectIntent } from '../src/core/effects';
import { FlightRestoreIntegration, FLIGHT_ROUTINES } from '../src/core/flight-integration';
import { ResourceLedger } from '../src/core/resources';
import { fixture, routine } from './helpers';

const policy = '44444444-4444-4444-8444-444444444444';
const otherPolicy = '55555555-5555-4555-8555-555555555555';
let f: ReturnType<typeof fixture>, life: LifecycleCore, identity: Identity;
let flights: FlightRestoreIntegration, effects: EffectLedger;
function reconstruct() {
  const store = new Store(f.db), core = new ControlCore(store, f.core.options);
  life = new LifecycleCore(store, core); effects = new EffectLedger(store, () => core.now());
  flights = new FlightRestoreIntegration(store, core, life, { enabled: true, policyId: policy }); flights.initialize();
}
beforeEach(() => {
  f = fixture(true); f.core.options.actionPolicyIds.push(policy, otherPolicy);
  for (const id of [FLIGHT_ROUTINES.triage, FLIGHT_ROUTINES.restore]) {
    const r = routine({ id, persona_id: FLIGHT_ROUTINES.inbox, action_policy_ids: [policy, otherPolicy] });
    expect(f.accept({ schema_version: 1, type: 'routine.put', payload: r }).status).toBe('applied');
  }
  reconstruct();
  f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=1,lease_until='2026-09-10T00:02:00.000Z'");
  identity = life.registerBoot(randomUUID()); life.ready(identity);
});
afterEach(() => f.close());
function activeRoutine(id: string = FLIGHT_ROUTINES.restore) {
  const run = f.core.enqueue(FLIGHT_ROUTINES.inbox, 'Synthetic input, never connector authority', null, id, null);
  expect(life.claim(identity)?.run.id).toBe(run); life.submitted(identity, run, 1, `native:${run}`);
  return run;
}
function intent(run_id: string): EffectIntent {
  return { id: randomUUID(), run_id, attempt: 1, action_key: 'synthetic:mail-17:restore', classification: 'idempotent',
    authorization_ref: policy, request_digest: 'sha256:mail-17-INBOX', provider_idempotency_key: 'destination-mail-17' };
}

it.each([false,true])('dispatch validation omits historical run bodies (expired=%s)',expired=>{
  const run=activeRoutine(),input=intent(run);effects.intent(input);
  f.db.exec('UPDATE runs SET context_json=?,checkpoint_json=? WHERE id=?',JSON.stringify({padding:'界'.repeat(400000)}),JSON.stringify({padding:'x'.repeat(1100000)}),run);
  if(expired)f.db.exec('UPDATE attempts SET deadline_at=? WHERE run_id=?',f.core.now(),run);
  const before=f.store.run(run),read=vi.spyOn(f.db,'all');
  try{
    if(expired)expect(()=>effects.transition(input.id,run,'dispatched',null)).toThrowError(expect.objectContaining({code:'DEADLINE_EXCEEDED'}));
    else effects.transition(input.id,run,'dispatched',null);
    const reads=read.mock.calls.flatMap(([sql,id],i)=>sql.includes('FROM runs WHERE id=?')&&id===run?[read.mock.results[i].value]:[]);
    expect(reads.length).toBeGreaterThan(0);
    for(const rows of reads)for(const row of rows){expect(row).not.toHaveProperty('context_json');expect(row).not.toHaveProperty('checkpoint_json');}
  }finally{read.mockRestore();}
  expect(f.store.run(run)).toEqual(before);
  expect(f.db.all('SELECT status FROM effects WHERE id=?',input.id)).toEqual([{status:expired?'intent':'dispatched'}]);
});

it('intent replay checks identity without hydrating a retained destination receipt',()=>{
  const run=activeRoutine(),input=intent(run);effects.intent(input);
  const receipt=JSON.stringify({padding:'界'.repeat(400000)});
  f.db.exec("UPDATE effects SET status='outcome_unknown',receipt_json=? WHERE id=?",receipt,input.id);
  f.db.exec('UPDATE attempts SET deadline_at=? WHERE run_id=?',f.core.now(),run);
  const before=f.db.all('SELECT * FROM effects WHERE id=?',input.id),read=vi.spyOn(f.db,'all');
  try{
    expect(effects.intent(input)).toEqual({id:input.id,status:'outcome_unknown'});
    expect(()=>effects.intent({...input,request_digest:'different'})).toThrowError(expect.objectContaining({code:'IDEMPOTENCY_CONFLICT'}));
    const reads=read.mock.calls.flatMap(([sql],i)=>sql.includes('FROM effects WHERE action_key=?')?[read.mock.results[i].value]:[]);
    expect(reads).toHaveLength(2);
    for(const rows of reads)for(const row of rows)expect(row).not.toHaveProperty('receipt_json');
  }finally{read.mockRestore();}
  expect(f.db.all('SELECT * FROM effects WHERE id=?',input.id)).toEqual(before);
});

it('owner cancellation blocks first dispatch but not late receipts from an already dispatched action', () => {
  const run = activeRoutine(), pending = intent(run);
  const sent = { ...pending, id: randomUUID(), action_key: 'synthetic:already-sent' };
  effects.intent(pending); effects.intent(sent); effects.transition(sent.id, run, 'dispatched', null);
  expect(f.accept({ schema_version: 1, type: 'run.cancel', payload: { run_id: run, reason: 'Stop' } }).status).toBe('applied');
  reconstruct(); const before = f.db.all('SELECT * FROM effects');
  expect(() => effects.transition(pending.id, run, 'dispatched', null)).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
  expect(f.db.all('SELECT * FROM effects')).toEqual(before);
  effects.transition(sent.id, run, 'dispatched', null);
  effects.transition(sent.id, run, 'confirmed', { destination_id: 'receipt-after-cancel' });
  effects.transition(pending.id, run, 'failed', { reason: 'cancelled-before-dispatch' });
  expect(f.store.run(run).status).toBe('cancelling');
  expect(f.db.all('SELECT status FROM effects ORDER BY action_key')).toEqual([{ status: 'confirmed' }, { status: 'failed' }]);
});

it.each(['intent', 'dispatch'] as const)('fences new effect %s at the hard deadline but preserves late receipts', phase => {
  const run = activeRoutine(), input = intent(run);
  f.db.exec("UPDATE attempts SET deadline_at='2026-09-10T00:00:10.000Z' WHERE run_id=?", run);
  f.setNow('2026-09-10T00:00:09.999Z');
  effects.intent(input);
  effects.transition(input.id, run, 'dispatched', null);
  const pending = { ...input, id: randomUUID(), action_key: 'synthetic:mail-93:restore' };
  if (phase === 'dispatch') effects.intent(pending);
  for (const now of ['2026-09-10T00:00:10.000Z', '2026-09-10T00:00:10.001Z']) {
    f.setNow(now); reconstruct();
    const before = f.db.all('SELECT * FROM effects');
    expect(() => phase === 'intent' ? effects.intent(pending) : effects.transition(pending.id, run, 'dispatched', null))
      .toThrowError(expect.objectContaining({ code: 'DEADLINE_EXCEEDED' }));
    expect(f.db.all('SELECT * FROM effects')).toEqual(before);
    expect(effects.intent(input)).toEqual({ id: input.id, status: 'dispatched' });
    effects.transition(input.id, run, 'dispatched', null); // Lost-ACK lookup is not another dispatch.
  }
  effects.transition(input.id, run, 'confirmed', { destination_id: 'late-receipt-17' });
  expect(effects.intent(input)).toEqual({ id: input.id, status: 'confirmed' });
  if (phase === 'dispatch') effects.transition(pending.id, run, 'failed', { reason: 'not-dispatched' });
  expect(f.db.all("SELECT id FROM effects WHERE status IN ('intent','dispatched','outcome_unknown')")).toEqual([]);
});

it.each([
  { request_digest: 'sha256:different-mail' },
  { classification: 'read_only' as const },
  { authorization_ref: otherPolicy },
  { provider_idempotency_key: 'different-destination-key' },
])('rejects altered immutable effect identity after reconstruction: %j', changed => {
  const input = intent(activeRoutine()), first = effects.intent(input);
  reconstruct();
  expect(effects.intent({ ...input, id: randomUUID() })).toEqual(first);
  expect(() => effects.intent({ ...input, ...changed })).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
  expect(f.db.all('SELECT id FROM effects')).toHaveLength(1);
});

it.each(['intent', 'dispatched'] as const)('never replays a %s mutation after lost executor ownership, reconstruction and owner retry', crashAt => {
  const run = activeRoutine(), input = { ...intent(run), classification: 'mutation' as const, provider_idempotency_key: null };
  effects.intent(input);
  const destinationWrites: string[] = [];
  if (crashAt === 'dispatched') {
    effects.transition(input.id, run, 'dispatched', null);
    destinationWrites.push('synthetic-mail-17 restored'); // Fake destination succeeded; receipt deliberately lost.
  }
  reconstruct(); f.setNow('2026-09-10T00:01:31.000Z'); life.watchdog();
  expect(f.db.all('SELECT status FROM effects')).toEqual([{ status: 'outcome_unknown' }]);
  life.observeStopped({ phase: 'stopped', executionStopped: true, persistentState: 'retained', observedAt: Date.now() });
  reconstruct(); f.setNow('2026-09-10T01:00:00.000Z'); life.retryDue(); life.retryDue();
  expect(f.accept({ schema_version: 1, type: 'run.retry', payload: { run_id: run, expected_attempt: 1 } })).toMatchObject({ status: 'rejected', error: { code: 'OUTCOME_UNKNOWN' } });
  expect(() => effects.transition(input.id, run, 'dispatched', null)).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
  expect(() => effects.intent(input)).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
  expect(f.store.run(run).status).toBe('recovery_required');
  expect(f.db.all('SELECT * FROM retry_queue')).toHaveLength(0); expect(f.db.all('SELECT * FROM outbox')).toHaveLength(0);
  expect(destinationWrites).toEqual(crashAt === 'dispatched' ? ['synthetic-mail-17 restored'] : []);
});

it.each(['confirmed','failed'] as const)('records an explicit owner %s decision only after confirmed termination, without releasing locks or retrying', outcome => {
  const run = activeRoutine(), input = intent(run);
  const locks = new ResourceLedger(f.store, () => f.core.now()); locks.acquire(run, 1, ['mail:17']);
  effects.intent(input); effects.transition(input.id, run, 'dispatched', null);
  const payload = { run_id:run, expected_attempt:1, effect_id:input.id, expected_request_digest:input.request_digest, outcome, evidence_ref:'manual-check:receipt-103' };
  const command = { schema_version:1 as const, type:'effect.reconcile' as const, payload };
  expect(parseCommand(command)).toEqual(command);
  effects.transition(input.id, run, 'outcome_unknown', null);
  expect(f.accept(command)).toMatchObject({ status:'rejected', error:{code:'CANCEL_UNCONFIRMED'} });
  f.db.exec("UPDATE lifecycle SET phase='RECOVERY_REQUIRED'");
  expect(f.accept(command)).toMatchObject({ status:'rejected', error:{code:'CANCEL_UNCONFIRMED'} });
  life.observeStopped({ phase:'stopped', executionStopped:true, persistentState:'retained', observedAt:Date.now() });
  f.core.options.executionEnabled = false;
  const beforeLocks = f.db.all('SELECT * FROM resource_locks'), beforeRun = f.store.run(run);
  for(const changed of [{ expected_attempt:2 },{ expected_request_digest:'wrong-request' },{ effect_id:randomUUID() }]) {
    expect(f.accept({ ...command, payload:{...payload,...changed} }).status).toBe('rejected');
    expect(f.db.all('SELECT status FROM effects')).toEqual([{status:'outcome_unknown'}]);
  }
  const key = randomUUID(), receipt = f.accept(command,key);
  expect(receipt.status).toBe('applied'); expect(f.accept(command,key)).toEqual(receipt);
  const saved = f.db.all<{receipt_json:string}>('SELECT receipt_json FROM effects')[0].receipt_json;
  expect(JSON.parse(saved)).toEqual({kind:'owner_reconciliation',owner_id:'owner',command_id:receipt.id,evidence_ref:payload.evidence_ref,attempt:1});
  expect(f.accept(command).status).toBe('applied');
  expect(f.accept({...command,payload:{...payload,outcome:outcome==='confirmed'?'failed':'confirmed'}}).status).toBe('rejected');
  expect(f.accept({...command,payload:{...payload,evidence_ref:'different-reference'}}).status).toBe('rejected');
  expect(f.db.all('SELECT status,receipt_json FROM effects')).toEqual([{status:outcome,receipt_json:saved}]);
  expect(f.db.all('SELECT * FROM resource_locks')).toEqual(beforeLocks); expect(f.store.run(run)).toEqual(beforeRun);
  expect(f.db.all('SELECT * FROM retry_queue')).toEqual([]);
  expect(f.db.all('SELECT * FROM outbox')).toEqual([]);
  expect(() => life.authorizeAttempt(identity,run,1)).toThrowError(expect.objectContaining({code:'STALE_EPOCH'}));
});

// Real core admission/auth/effect/flight SQL, with synthetic structured mail and
// a fake destination receipt. This is NOT a Gmail connector implementation.
it('restores only the due synthetic flight leg through pinned authority and one durable effect/receipt across reconstruction', () => {
  const triage = activeRoutine(FLIGHT_ROUTINES.triage);
  const due = { leg_id: 'flight17', revision: 1, departure_at: '2026-09-10T07:00:00+08:00', departure_zone: 'Asia/Singapore', source_ref: 'synthetic-mail-17' };
  const later = { leg_id: 'flight93', revision: 1, departure_at: '2026-09-12T19:30:00+09:00', departure_zone: 'Asia/Tokyo', source_ref: 'synthetic-mail-93' };
  for (const leg of [due, later]) flights.register({ identity, run_id: triage, attempt: 1, leg });
  life.complete(identity, triage, 1, { status: 'completed', text: 'Two synthetic flight records' });
  reconstruct();
  expect(flights.reconcile()).toBe(1); expect(flights.reconcile()).toBe(0);
  const job = life.claim(identity)!.run;
  expect(job.routine_id).toBe(FLIGHT_ROUTINES.restore);
  expect(JSON.parse(job.context_json).instruction).toContain('synthetic-mail-17');
  expect(JSON.parse(job.context_json).instruction).not.toContain('synthetic-mail-93');
  life.submitted(identity, job.id, 1, 'synthetic-native-restore');
  const locks = new ResourceLedger(f.store, () => f.core.now()); locks.acquire(job.id, 1, ['mail:17']);
  const input = { ...intent(job.id), action_key: 'flight-restore:flight17:1' };
  // Acquiring a lock does not authorize an ungranted effect.
  expect(() => effects.intent({ ...input, authorization_ref: 'ungranted' })).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
  const effect = effects.intent(input);
  effects.transition(effect.id, job.id, 'dispatched', null);
  const receipt = { message_ref: 'synthetic-mail-17', labels_verified: ['INBOX'], revision: 7 };
  effects.transition(effect.id, job.id, 'confirmed', receipt);
  reconstruct(); // Receipt committed, flight confirmation not yet persisted.
  expect(effects.intent(input)).toEqual({ id: effect.id, status: 'confirmed' });
  const confirmation = { identity, run_id: job.id, attempt: 1, leg_id: due.leg_id, revision: 1, effect_id: effect.id };
  flights.confirm(confirmation); flights.confirm(confirmation);
  expect(f.db.all('SELECT leg_id,status,receipt_json FROM flight_restore_deadlines ORDER BY leg_id')).toEqual([
    { leg_id: 'flight17', status: 'confirmed', receipt_json: JSON.stringify(receipt) },
    { leg_id: 'flight93', status: 'pending', receipt_json: null },
  ]);
  locks.release(job.id, 1, ['mail:17']);
  life.complete(identity, job.id, 1, { status: 'completed', text: 'Restored synthetic mail 17' });
  life.complete(identity, job.id, 1, { status: 'completed', text: 'Restored synthetic mail 17' });
  expect(() => life.complete(identity, job.id, 1, { status: 'completed', text: 'Duplicate' }))
    .toThrowError(expect.objectContaining({ code: 'RESULT_CONFLICT' }));
  expect(f.db.all('SELECT id FROM effects')).toHaveLength(1);
  expect(f.db.all('SELECT id FROM outbox WHERE run_id=?', job.id)).toHaveLength(1);
  expect(flights.reconcile()).toBe(0);
});
