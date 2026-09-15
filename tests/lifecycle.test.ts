import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LifecycleCore, type Identity, type HeartbeatOperation } from '../src/core/lifecycle';
import { NativeTaskLedger } from '../src/core/native-tasks';
import { ResourceLedger } from '../src/core/resources';
import { EffectLedger } from '../src/core/effects';
import { FakeProvider, type RuntimeRef } from '../src/providers';
import { fixture, bot } from './helpers';
let f: ReturnType<typeof fixture>, life: LifecycleCore, identity: Identity;
const ref: RuntimeRef = { provider: 'fake', id: 'synthetic-runtime' };
beforeEach(() => {
  f = fixture(true); life = new LifecycleCore(f.store, f.core);
  f.db.exec("UPDATE lifecycle SET provider_ref_json=?,phase='BOOTING',epoch=1,lease_until='2026-09-10T00:02:00.000Z'", JSON.stringify(ref));
  identity = life.registerBoot(randomUUID()); life.ready(identity);
});
afterEach(() => f.close());
function enqueue() { return f.accept({ schema_version: 1, type: 'message.send', payload: { conversation_id: bot, text: 'Synthetic task' } }).resource_id!; }
function claimed() { const id = enqueue(); const claim = life.claim(identity)!; expect(claim.run.id).toBe(id); return claim; }
function operation(run_id: string, kind: HeartbeatOperation['kind'] = 'inference'): HeartbeatOperation {
  return { id: randomUUID(), run_id, attempt: 1, kind, status: 'active', started_at: f.core.now(), last_progress_at: f.core.now(), deadline_at: '2026-09-10T00:20:00.000Z' };
}
function unknownEffect(runId: string) {
  f.db.exec("INSERT INTO effects(id,run_id,action_key,classification,status,authorization_ref,request_digest,updated_at) VALUES(?,?,?,'mutation','outcome_unknown','synthetic-authorization','synthetic-digest',?)", randomUUID(), runId, randomUUID(), f.core.now());
}
describe('executor leases and attempts', () => {
  it('holds quiet claimed/running inference even without tool records', () => {
    const claim = claimed(); f.setNow('2026-09-10T00:01:00.000Z');
    expect(() => life.prepareSleep(identity)).toThrowError(expect.objectContaining({ code: 'SLEEP_DENIED' }));
    life.submitted(identity, claim.run.id, 1, 'native-synthetic');
    expect(() => life.prepareSleep(identity)).toThrowError(expect.objectContaining({ code: 'SLEEP_DENIED' }));
    expect(life.claim(identity)).toBe(null);
  });
  it.each(['tool', 'child', 'transfer', 'node', 'flush', 'delivery'] as const)('%s operation blocks terminal completion and sleep', (kind) => {
    const claim = claimed(), op = operation(claim.run.id, kind); life.heartbeat(identity, [op]);
    expect(() => life.complete(identity, claim.run.id, 1, { status: 'completed', text: 'Synthetic result' })).toThrowError(expect.objectContaining({ code: 'CANCEL_UNCONFIRMED' }));
    f.setNow('2026-09-10T00:01:00.000Z');
    expect(() => life.prepareSleep(identity)).toThrowError(expect.objectContaining({ code: 'SLEEP_DENIED' }));
    life.heartbeat(identity, [{ ...op, status: 'settled' }]);
    expect(() => life.complete(identity, claim.run.id, 1, { status: 'completed', text: 'Synthetic result' })).not.toThrow();
  });
  it('stale epoch/boot or expired heartbeat cannot extend lease', () => {
    const lease = life.get().lease_until;
    for (const stale of [{ ...identity, epoch: 0 }, { ...identity, boot_id: randomUUID() }]) expect(() => life.heartbeat(stale, [])).toThrowError(expect.objectContaining({ code: 'STALE_EPOCH' }));
    expect(life.get().lease_until).toBe(lease);
    f.setNow('2026-09-10T00:01:30.000Z');
    expect(() => life.heartbeat(identity, [])).toThrowError(expect.objectContaining({ code: 'STALE_EPOCH' }));
    expect(life.get().lease_until).toBe(lease);
  });
  it('expired boot registration cannot resurrect lease before watchdog', () => {
    f.db.exec("UPDATE lifecycle SET phase='BOOTING'");
    f.setNow('2026-09-10T00:02:01.000Z');
    expect(() => life.registerBoot(identity.boot_id)).toThrowError(expect.objectContaining({ code: 'STALE_EPOCH' }));
  });
  it('submission cannot replace an already registered native child identity', () => {
    const parent = claimed();
    life.submitted(identity, parent.run.id, 1, 'native-root-19');
    const child = new NativeTaskLedger(f.store, f.core, life).register(identity, {
      parent_run_id: parent.run.id, parent_attempt: 1, persona_id: bot,
      native_run_ref: 'native-child-43', native_session_key: 'child-thread-71', title: 'Synthetic child',
    });
    const before = f.db.all('SELECT * FROM attempts WHERE run_id=?', child.id);
    expect(() => life.submitted(identity, child.id, 1, 'native-child-103'))
      .toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
    expect(f.db.all('SELECT * FROM attempts WHERE run_id=?', child.id)).toEqual(before);
    expect(f.store.run(child.id).status).toBe('claimed');
    life.submitted(identity, child.id, 1, 'native-child-43');
    expect(f.db.all('SELECT status,native_run_ref FROM attempts WHERE run_id=?', child.id))
      .toEqual([{ status: 'running', native_run_ref: 'native-child-43' }]);
    expect(f.store.run(child.id).status).toBe('running');
  });
  it('rejects wrong attempt and prevents settled operation resurrection', () => {
    const claim = claimed(), op = operation(claim.run.id);
    expect(() => life.submitted(identity, claim.run.id, 2, 'native')).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
    expect(() => life.heartbeat(identity, [{ ...op, attempt: 2 }])).toThrowError(expect.objectContaining({ code: 'STALE_EPOCH' }));
    life.heartbeat(identity, [{ ...op, status: 'settled' }]);
    expect(() => life.heartbeat(identity, [op])).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(() => life.complete(identity, claim.run.id, 2, { status: 'completed', text: '' })).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
  });
  it.each(['2026-09-10T01:02:00+01:00', '2026-09-09T23:02:00-01:00'])('canonicalizes offset deadlines before watchdog comparisons: %s', deadline => {
    const claim = claimed(), op = { ...operation(claim.run.id, 'tool'), deadline_at: deadline,
      started_at: '2026-09-10T07:00:00+07:00', last_progress_at: '2026-09-10T07:00:01+07:00' };
    life.heartbeat(identity, [op]);
    expect(f.db.all('SELECT started_at,deadline_at,last_progress_at FROM operations WHERE id=?', op.id)).toEqual([
      { started_at: '2026-09-10T00:00:00.000Z', deadline_at: '2026-09-10T00:02:00.000Z', last_progress_at: '2026-09-10T00:00:01.000Z' },
    ]);
    f.db.exec("UPDATE lifecycle SET lease_until='2026-09-10T00:10:00.000Z'");
    f.setNow('2026-09-10T00:01:59.999Z'); life.watchdog(); expect(f.store.run(claim.run.id).status).toBe('claimed');
    f.setNow('2026-09-10T00:02:00.000Z'); life.watchdog(); expect(f.store.run(claim.run.id).status).toBe('cancelling');
  });
  it.each([
    { kind: 'node' }, { started_at: '2026-09-10T00:00:00.001Z' }, { deadline_at: '2026-09-10T00:19:59.999Z' },
    { last_progress_at: '2026-09-09T23:59:59.999Z' },
  ])('rejects changed operation custody or regressing progress atomically: %j', patch => {
    const claim = claimed(), op = operation(claim.run.id); life.heartbeat(identity, [op]);
    const before = f.db.all('SELECT * FROM operations'), lease = life.get();
    f.setNow('2026-09-10T00:00:10.000Z');
    expect(() => life.heartbeat(identity, [operation(claim.run.id), { ...op, ...patch } as HeartbeatOperation]))
      .toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(f.db.all('SELECT * FROM operations')).toEqual(before); expect(life.get()).toEqual(lease);
  });
  it('accepts equivalent offset replay and advances progress without changing the deadline', () => {
    const claim = claimed(), op = operation(claim.run.id); life.heartbeat(identity, [op]);
    life.heartbeat(identity, [{ ...op, started_at: '2026-09-10T07:00:00+07:00', deadline_at: '2026-09-10T07:20:00+07:00', last_progress_at: '2026-09-10T07:00:10+07:00' }]);
    expect(f.db.all('SELECT started_at,deadline_at,last_progress_at FROM operations WHERE id=?', op.id)).toEqual([
      { started_at: op.started_at, deadline_at: op.deadline_at, last_progress_at: '2026-09-10T00:00:10.000Z' },
    ]);
  });
  it.each([
    { deadline_at: '2026-09-10T07:20:00.001+07:00' },
    { started_at: '2026-09-10T00:02:00.001Z', deadline_at: '2026-09-10T00:02:00.000Z', last_progress_at: '2026-09-10T00:02:00.001Z' },
    { last_progress_at: '2026-09-09T23:59:59.999Z' },
  ])('rejects new operation timing outside its attempt envelope atomically: %j', patch => {
    const claim = claimed(), before = life.get();
    f.setNow('2026-09-10T00:00:10.000Z');
    const invalid = { ...operation(claim.run.id), started_at: '2026-09-10T00:00:00.000Z', ...patch };
    expect(() => life.heartbeat(identity, [operation(claim.run.id), invalid]))
      .toThrowError(expect.objectContaining({ code: 'INVALID_INPUT', status: 422 }));
    expect(f.db.all('SELECT * FROM operations')).toEqual([]);
    expect(life.get()).toEqual(before);
  });
  it('accepts an exact hard-deadline boundary and late progress without extending custody', () => {
    const claim = claimed(), op = { ...operation(claim.run.id), started_at: claim.deadline_at,
      deadline_at: '2026-09-10T07:20:00+07:00', last_progress_at: claim.deadline_at };
    f.db.exec("UPDATE lifecycle SET lease_until='2026-09-10T00:21:00.000Z'");
    f.setNow(claim.deadline_at);
    life.heartbeat(identity, [op]);
    f.setNow('2026-09-10T00:20:00.001Z');
    life.heartbeat(identity, [{ ...op, status: 'settled', last_progress_at: '2026-09-10T00:20:00.001Z' }]);
    expect(f.db.all('SELECT started_at,deadline_at,last_progress_at,status FROM operations WHERE id=?', op.id)).toEqual([
      { started_at: claim.deadline_at, deadline_at: claim.deadline_at, last_progress_at: '2026-09-10T00:20:00.001Z', status: 'settled' },
    ]);
  });
  it('canonicalizes retained offset custody only on equivalent authorized replay', () => {
    const claim = claimed(), op = operation(claim.run.id); life.heartbeat(identity, [op]);
    f.db.exec('UPDATE operations SET started_at=?,deadline_at=?,last_progress_at=? WHERE id=?',
      '2026-09-10T07:00:00+07:00', '2026-09-10T07:20:00+07:00', '2026-09-10T07:00:00+07:00', op.id);
    life.heartbeat(identity, [op]);
    expect(f.db.all('SELECT * FROM operations WHERE id=?', op.id)).toEqual([op]);
  });
  it.each(['invalid', '2016-12-31T23:59:60Z', '9999-12-31T23:59:59-01:00'])('rejects nonrepresentable operation time without page writes: %s', deadline_at => {
    const claim = claimed(), before = life.get();
    expect(() => life.heartbeat(identity, [operation(claim.run.id), { ...operation(claim.run.id), deadline_at }]))
      .toThrowError(expect.objectContaining({ code: 'INVALID_INPUT', status: 422 }));
    expect(f.db.all('SELECT * FROM operations')).toEqual([]); expect(life.get()).toEqual(before);
  });
  it.each(['running','cancelling','completed','waiting','recovery_required'])('identical submission receipt replay leaves %s work and every table unchanged', status => {
    const id = claimed().run.id;
    life.submitted(identity, id, 1, 'native-receipt-71');
    f.db.exec('UPDATE runs SET status=? WHERE id=?', status, id);
    f.setNow('2026-09-10T00:00:20.000Z');
    const before = f.db.all<{ n:number }>('SELECT total_changes() AS n')[0].n;
    life.submitted(identity, id, 1, 'native-receipt-71');
    expect(f.db.all<{ n:number }>('SELECT total_changes() AS n')[0].n).toBe(before);
    expect(f.store.run(id).status).toBe(status);
    expect(() => life.submitted(identity, id, 1, 'native-receipt-17')).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
    expect(() => life.submitted({ ...identity, epoch: 2 }, id, 1, 'native-receipt-71')).toThrowError(expect.objectContaining({ code: 'STALE_EPOCH' }));
  });
  it('unacknowledged cancellation is not authority for a new submission registration', () => {
    const id = claimed().run.id;
    f.accept({ schema_version: 1, type: 'run.cancel', payload: { run_id: id, reason: 'Stop before acknowledgment' } });
    expect(() => life.submitted(identity, id, 1, 'never-registered')).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
    expect(f.db.all('SELECT native_run_ref FROM attempts WHERE run_id=?', id)).toEqual([{ native_run_ref: null }]);
    expect(f.store.run(id).status).toBe('cancelling');
  });
  it('completion replay uses retained receipts and cannot overwrite a checkpoint or acknowledge a pruned result', () => {
    const id = claimed().run.id;
    const result = { status: 'waiting' as const, text: 'Owner input needed', checkpoint: { cursor: 43, draft: 'first' } };
    life.complete(identity, id, 1, result);
    const before = f.db.all('SELECT * FROM attempts WHERE run_id=?', id);
    for (const change of [{ text: 'Different' }, { checkpoint: { cursor: 71, draft: 'first' } }, { status: 'completed' as const }]) {
      expect(() => life.complete(identity, id, 1, { ...result, ...change }))
        .toThrowError(expect.objectContaining({ code: 'RESULT_CONFLICT' }));
    }
    expect(f.db.all('SELECT * FROM attempts WHERE run_id=?', id)).toEqual(before);
    // Missing retained evidence cannot become a new publication or an acknowledgment.
    f.db.exec('UPDATE attempts SET result_json=NULL WHERE run_id=?', id);
    expect(() => life.complete(identity, id, 1, result)).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
    expect(f.db.all("SELECT id FROM events WHERE type='run.result'")).toHaveLength(1);
  });
  it('retry-queued receipt replay preserves admission state, but a new attempt or epoch fences it', () => {
    const id = claimed().run.id;
    const result = { status: 'failed' as const, text: 'Read unavailable', error_code: 'TEMPORARY_UNAVAILABLE' };
    life.complete(identity, id, 1, result);
    f.setNow('2026-09-10T00:00:11.000Z'); life.retryDue();
    expect(f.store.run(id).status).toBe('queued');
    life.complete(identity, id, 1, result);
    expect(f.store.run(id).status).toBe('queued');
    const next = life.claim(identity)!;
    expect(next.run.current_attempt).toBe(2);
    expect(() => life.complete(identity, id, 1, result)).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
    f.db.exec('UPDATE lifecycle SET epoch=2');
    expect(() => life.complete(identity, id, 1, result)).toThrowError(expect.objectContaining({ code: 'STALE_EPOCH' }));
    expect(f.db.all("SELECT id FROM events WHERE type='run.result'")).toHaveLength(1);
  });
  it('root retry waits for nested descendants while preserving their original parent attempt', () => {
    const root = claimed().run;
    life.submitted(identity, root.id, 1, 'root-retry');
    const native = new NativeTaskLedger(f.store, f.core, life);
    const spawn = (parent: string, ref: string) => native.register(identity, { parent_run_id: parent,
      parent_attempt: 1, persona_id: bot, native_run_ref: ref, native_session_key: ref, title: ref }, true);
    const child = spawn(root.id, 'retry-child'), grandchild = spawn(child.id, 'retry-grandchild');
    life.complete(identity, child.id, 1, { status: 'completed', text: '' });
    life.complete(identity, root.id, 1, { status: 'failed', text: '' });
    const retry = () => f.accept({ schema_version: 1, type: 'run.retry', payload: { run_id: root.id, expected_attempt: 1 } });
    expect(retry()).toMatchObject({ status: 'rejected', error: { code: 'CANCEL_UNCONFIRMED' } });
    expect(f.store.run(root.id)).toMatchObject({ status: 'failed', current_attempt: 1 });
    expect(f.store.run(grandchild.id)).toMatchObject({ status: 'running', current_attempt: 1 });
    life.complete(identity, grandchild.id, 1, { status: 'completed', text: '' });
    expect(retry()).toMatchObject({ status: 'applied', resource_id: root.id });
    expect(life.claim(identity)?.run).toMatchObject({ id: root.id, current_attempt: 2 });
  });
  it('rechecks late child observations before claim without hiding independent queued work', () => {
    const root = claimed().run;
    life.submitted(identity, root.id, 1, 'late-root');
    life.complete(identity, root.id, 1, { status: 'failed', text: '' });
    expect(f.accept({ schema_version: 1, type: 'run.retry', payload: { run_id: root.id, expected_attempt: 1 } })).toMatchObject({ status: 'applied' });
    const child = new NativeTaskLedger(f.store, f.core, life).register(identity, { parent_run_id: root.id,
      parent_attempt: 1, persona_id: bot, native_run_ref: 'late-child', native_session_key: 'late-child', title: 'Late observation' }, true);
    expect(life.claim(identity)).toBeNull();
    f.setNow('2026-09-10T00:00:01.000Z');
    const other = enqueue();
    expect(life.claim(identity)?.run.id).toBe(other);
    life.complete(identity, other, 1, { status: 'completed', text: '' });
    expect(f.store.run(root.id).current_attempt).toBe(1);
    life.complete(identity, child.id, 1, { status: 'completed', text: '' });
    expect(life.claim(identity)?.run).toMatchObject({ id: root.id, current_attempt: 2 });
  });
  it.each(['attempt','operation','lock','effect'] as const)('terminal descendant status does not hide a retained %s during retry admission', kind => {
    const root = claimed().run;
    life.submitted(identity, root.id, 1, 'retained-root');
    const child = new NativeTaskLedger(f.store, f.core, life).register(identity, { parent_run_id: root.id,
      parent_attempt: 1, persona_id: bot, native_run_ref: 'retained-child', native_session_key: 'retained-child', title: 'Retained evidence' }, true);
    life.complete(identity, root.id, 1, { status: 'failed', text: '' });
    if(kind === 'operation')life.heartbeat(identity, [operation(child.id)]);
    if(kind === 'lock')new ResourceLedger(f.store, () => f.core.now()).acquire(child.id, 1, ['calendar:retained']);
    if(kind === 'effect')unknownEffect(child.id);
    // Simulate restored, inconsistent terminal metadata; independent evidence
    // must still prevent a new root attempt even when the run status is final.
    f.db.exec("UPDATE runs SET status='completed' WHERE id=?", child.id);
    if(kind !== 'attempt')f.db.exec("UPDATE attempts SET status='completed',settled_at=? WHERE run_id=?", f.core.now(), child.id);
    expect(f.accept({ schema_version: 1, type: 'run.retry', payload: { run_id: root.id, expected_attempt: 1 } }))
      .toMatchObject({ status: 'rejected', error: { code: 'CANCEL_UNCONFIRMED' } });
    f.db.exec("UPDATE runs SET status='queued' WHERE id=?", root.id);
    expect(life.claim(identity)).toBeNull();
    expect(f.store.run(root.id).current_attempt).toBe(1);
  });
  it('unknown effects block completion and retry after provider stop', () => {
    const claim = claimed(); unknownEffect(claim.run.id);
    expect(() => life.complete(identity, claim.run.id, 1, { status: 'completed', text: '' })).toThrowError(expect.objectContaining({ code: 'OUTCOME_UNKNOWN' }));
    f.db.exec("UPDATE lifecycle SET phase='RECOVERY_REQUIRED'");
    life.observeStopped({ phase: 'stopped', executionStopped: true, persistentState: 'retained', observedAt: Date.now() });
    expect(f.accept({ schema_version: 1, type: 'run.retry', payload: { run_id: claim.run.id, expected_attempt: 1 } })).toMatchObject({ status: 'rejected', error: { code: 'OUTCOME_UNKNOWN' } });
  });
  it.each(['intent','dispatched','outcome_unknown'] as const)('retains %s effect locks across confirmed stop and rejects competing work until reconciliation', effectStatus => {
    const claim = claimed(), runId = claim.run.id, resources = new ResourceLedger(f.store, () => f.core.now());
    life.submitted(identity, runId, 1, 'native-root');
    const child = new NativeTaskLedger(f.store, f.core, life).register(identity, { parent_run_id: runId, parent_attempt: 1,
      persona_id: bot, native_run_ref: 'native-child', native_session_key: 'thread-child', title: 'Unrelated resource' });
    resources.acquire(runId, 1, ['calendar:remote']); resources.acquire(child.id, 1, ['browser:local']);
    unknownEffect(runId); f.db.exec('UPDATE effects SET status=? WHERE run_id=?', effectStatus, runId);
    expect(() => resources.release(runId, 1, ['calendar:remote'])).toThrowError(expect.objectContaining({ code: 'OUTCOME_UNKNOWN' }));
    f.db.exec("UPDATE lifecycle SET phase='RECOVERY_REQUIRED'");
    const observation = { phase: 'stopped' as const, executionStopped: true, persistentState: 'retained' as const, observedAt: Date.now() };
    life.observeStopped(observation); life.observeStopped(observation);
    expect(f.db.all('SELECT resource_id,run_id,attempt FROM resource_locks')).toEqual([{ resource_id: 'calendar:remote', run_id: runId, attempt: 1 }]);
    expect(f.db.all('SELECT status FROM effects WHERE run_id=?', runId)).toEqual([{ status: 'outcome_unknown' }]);
    expect(() => life.heartbeat(identity, [])).toThrowError(expect.objectContaining({ code: 'STALE_EPOCH' }));
    f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=2,lease_until='2026-09-10T00:02:00.000Z'");
    const nextIdentity = life.registerBoot(randomUUID()); life.ready(nextIdentity);
    const next = enqueue(); expect(life.claim(nextIdentity)?.run.id).toBe(next);
    expect(() => resources.acquire(next, 1, ['calendar:remote'])).toThrowError(expect.objectContaining({ code: 'RESOURCE_BUSY' }));
    const effect = f.db.all<{id:string}>('SELECT id FROM effects WHERE run_id=?', runId)[0].id;
    const ledger = new EffectLedger(f.store, () => f.core.now());
    expect(() => ledger.transition(effect, runId, 'confirmed', null)).toThrow();
    ledger.transition(effect, runId, 'confirmed', { destination_id: 'synthetic-reconciled-37' });
    resources.release(runId, 1, ['calendar:remote']); resources.acquire(next, 1, ['calendar:remote']);
    expect(f.db.all('SELECT run_id FROM resource_locks')).toEqual([{run_id:next}]);
  });
  it('bounds recovery effect metadata without exposing provider keys or enabling decisions before termination', () => {
    const root=claimed().run.id;
    for(let i=0;i<21;i++)unknownEffect(root);
    f.db.exec("UPDATE effects SET provider_idempotency_key='private-provider-key'");
    f.db.exec("UPDATE runs SET status='recovery_required' WHERE id=?",root);
    const before=f.db.all('SELECT * FROM effects ORDER BY id');
    const recovery=f.core.state().recovery[0];
    expect(recovery).toMatchObject({run_id:root,executor_terminated:false,can_decide_effects:false,can_recover:false,effects_truncated:true});
    expect(recovery.effects).toHaveLength(20);
    expect(JSON.stringify(recovery)).not.toContain('private-provider-key');
    expect(f.db.all('SELECT * FROM effects ORDER BY id')).toEqual(before);
  });
  it('pages old recovery tasks independently of recent runs and retained events, without crossing conversations', () => {
    const room=randomUUID();
    f.store.put(room,'room',{name:'Recovery room',member_ids:[bot],default_responder_id:bot},0,'owner',f.core.now());
    const old=Array.from({length:23},()=>f.core.enqueue(bot,'private-recovery-context',null,null,null)).sort();
    for(const id of old)f.db.exec("UPDATE runs SET status='recovery_required',context_json=json_set(context_json,'$.room_id',?) WHERE id=?",room,id);
    f.setNow('2026-09-10T00:01:00.000Z');
    for(let i=0;i<137;i++)f.core.enqueue(bot,'newer task',null,null,null);
    expect(f.core.state().recovery).toEqual([]);
    const before=f.db.all('SELECT * FROM runs ORDER BY id'),first=f.core.recoveryPage(bot);
    expect(first.runs.map(run=>run.id)).toEqual(old.slice(0,20));
    expect(first.next_cursor).toBe(old[19]);
    expect(first.recovery).toHaveLength(20);
    expect(JSON.stringify(first)).not.toContain('private-recovery-context');
    const last=f.core.recoveryPage(bot,first.next_cursor!);
    expect(last.runs.map(run=>run.id)).toEqual(old.slice(20));expect(last.next_cursor).toBeNull();
    expect(f.core.recoveryPage(room,undefined,100).runs.map(run=>run.id)).toEqual(old);
    expect(f.core.recoveryPage('22222222-2222-4222-8222-222222222222').runs).toEqual([]);
    expect(f.db.all('SELECT * FROM runs ORDER BY id')).toEqual(before);
    // Removing the cursor row cannot shift or repeat the next page.
    f.db.exec("UPDATE runs SET status='failed' WHERE id=?",old[19]);
    expect(f.core.recoveryPage(bot,first.next_cursor!).runs.map(run=>run.id)).toEqual(old.slice(20));
    for(const cursor of ['', 'private-text', "' OR 1=1--"])
      expect(()=>f.core.recoveryPage(bot,cursor)).toThrowError(expect.objectContaining({code:'INVALID_INPUT'}));
    for(const limit of [0,101,1.5,NaN])expect(()=>f.core.recoveryPage(bot,undefined,limit)).toThrow();
  });
  it('owner recovery closes stopped descendants bottom-up only after effect decisions and never retries them', () => {
    const root = claimed().run.id;
    life.submitted(identity,root,1,'recover-root');
    const native = new NativeTaskLedger(f.store,f.core,life);
    const spawn = (ref:string) => native.register(identity,{parent_run_id:root,parent_attempt:1,persona_id:bot,native_run_ref:ref,native_session_key:ref,title:ref},true).id;
    const child = spawn('recover-child'), sibling = spawn('recover-sibling');
    const resources = new ResourceLedger(f.store,()=>f.core.now());
    resources.acquire(child,1,['mail:child']); resources.acquire(sibling,1,['mail:sibling']);
    unknownEffect(child); unknownEffect(sibling);
    const recover = (id:string,key=randomUUID()) => f.accept({schema_version:1,type:'run.recover',payload:{run_id:id,expected_attempt:1,release_resources:true}},key);
    expect(recover(child).status).toBe('rejected');
    f.db.exec("UPDATE lifecycle SET phase='RECOVERY_REQUIRED'");
    life.observeStopped({phase:'stopped',executionStopped:true,persistentState:'retained',observedAt:Date.now()});
    f.core.options.executionEnabled=false;
    const recoveryState=(id:string)=>f.core.state().recovery.find(row=>row.run_id===id);
    expect(recoveryState(child)).toMatchObject({executor_terminated:true,can_decide_effects:true,can_recover:false,retained_locks:1});
    expect(recoveryState(root)).toMatchObject({descendants_unsettled:true,can_recover:false});
    expect(recover(root)).toMatchObject({status:'rejected',error:{code:'CANCEL_UNCONFIRMED'}});
    expect(recover(child)).toMatchObject({status:'rejected',error:{code:'OUTCOME_UNKNOWN'}});
    const decide = (id:string) => {
      const effect=f.db.all<{id:string;request_digest:string}>('SELECT id,request_digest FROM effects WHERE run_id=?',id)[0];
      expect(f.accept({schema_version:1,type:'effect.reconcile',payload:{run_id:id,expected_attempt:1,effect_id:effect.id,expected_request_digest:effect.request_digest,outcome:'confirmed',evidence_ref:'manual:verified-43'}}).status).toBe('applied');
    };
    decide(child);
    expect(recoveryState(child)).toMatchObject({can_recover:true,effects:[]});
    // Restored stale lock metadata must roll back even a preceding valid release.
    f.db.exec("INSERT INTO resource_locks VALUES('mail:stale',?,2,?)",child,f.core.now());
    const held=f.db.all('SELECT * FROM resource_locks ORDER BY resource_id');
    expect(recoveryState(child)).toMatchObject({can_recover:false,stale_locks:true});
    expect(recover(child)).toMatchObject({status:'rejected',error:{code:'FORBIDDEN'}});
    expect(f.db.all('SELECT * FROM resource_locks ORDER BY resource_id')).toEqual(held);
    expect(f.store.run(child).status).toBe('recovery_required');
    f.db.exec("DELETE FROM resource_locks WHERE resource_id='mail:stale'");
    const key=randomUUID(), first=recover(child,key);
    expect(first.status).toBe('applied'); expect(recover(child,key)).toEqual(first);
    expect(recoveryState(child)).toBeUndefined();
    expect(f.db.all('SELECT resource_id FROM resource_locks')).toEqual([{resource_id:'mail:sibling'}]);
    expect(recover(root).status).toBe('rejected');
    decide(sibling); expect(recover(sibling).status).toBe('applied'); expect(recover(root).status).toBe('applied');
    expect(f.db.all('SELECT status,current_attempt,error_code FROM runs')).toEqual(Array.from({length:3},()=>({status:'failed',current_attempt:1,error_code:'EXECUTOR_STOPPED'})));
    expect(f.db.all('SELECT status FROM attempts')).toEqual(Array.from({length:3},()=>({status:'terminated'})));
    expect(f.db.all('SELECT * FROM resource_locks')).toEqual([]); expect(f.db.all('SELECT * FROM retry_queue')).toEqual([]);
    expect(f.db.all('SELECT phase,boot_id FROM lifecycle')).toEqual([{phase:'STOPPED',boot_id:null}]);
  });
  it.each(['OWNER_CANCELLED','CONTEXT_INVALIDATED'])('preserves %s through direct stop and owner recovery', reason => {
    const root=claimed().run.id;
    f.db.exec("UPDATE runs SET status='cancelling',error_code=? WHERE id=?",reason,root);
    f.db.exec("UPDATE lifecycle SET phase='RECOVERY_REQUIRED'");
    life.observeStopped({phase:'stopped',executionStopped:true,persistentState:'retained',observedAt:Date.now()});
    expect(f.accept({schema_version:1,type:'run.recover',payload:{run_id:root,expected_attempt:1,release_resources:true}}).status).toBe('applied');
    expect(f.store.run(root)).toMatchObject({status:'cancelled',error_code:reason});
  });
  it('waiting requires checkpoint and terminal result is durable/idempotent', () => {
    const claim = claimed();
    expect(() => life.complete(identity, claim.run.id, 1, { status: 'waiting', text: '' })).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    life.complete(identity, claim.run.id, 1, { status: 'completed', text: 'Synthetic result' });
    life.complete(identity, claim.run.id, 1, { status: 'completed', text: 'Synthetic result' });
    expect(() => life.complete(identity, claim.run.id, 1, { status: 'completed', text: 'Conflicting result' }))
      .toThrowError(expect.objectContaining({ code: 'RESULT_CONFLICT' }));
    f.db.exec('UPDATE attempts SET result_json=NULL WHERE run_id=?', claim.run.id);
    expect(() => life.complete(identity, claim.run.id, 1, { status: 'completed', text: 'Synthetic result' }))
      .toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
    expect(f.db.all('SELECT * FROM outbox')).toHaveLength(1);
    expect(f.db.all("SELECT * FROM events WHERE type='run.result'")).toHaveLength(1);
  });
});
describe('drain, stop and takeover races', () => {
  it('requires the full idle grace before preparing sleep', () => {
    f.setNow('2026-09-10T00:00:59.999Z');
    expect(() => life.prepareSleep(identity)).toThrowError(expect.objectContaining({ code: 'SLEEP_DENIED' }));
    f.setNow('2026-09-10T00:01:00.000Z'); expect(life.prepareSleep(identity).stop_token).toBeTruthy();
  });
  it('new admission before commit invalidates stop token and returns READY', () => {
    f.setNow('2026-09-10T00:01:00.000Z'); const prepared = life.prepareSleep(identity);
    enqueue();
    expect(life.get()).toMatchObject({ phase: 'READY', stop_token: null, desired_state: 'RUN' });
    expect(() => life.commitSleep(identity, prepared.stop_token, prepared.queue_sequence, { synthetic: true })).toThrowError(expect.objectContaining({ code: 'SLEEP_DENIED' }));
  });
  it('new admission after commit survives stop and requests the next wake', async () => {
    const provider = new FakeProvider(); provider.setPhase(ref, 'running');
    f.setNow('2026-09-10T00:01:00.000Z'); const prepared = life.prepareSleep(identity);
    life.commitSleep(identity, prepared.stop_token, prepared.queue_sequence, { synthetic: true });
    enqueue(); expect(life.get()).toMatchObject({ phase: 'STOP_COMMITTED', wake_after_stop: 1 });
    await life.drive(provider); expect(life.get().phase).toBe('STOPPING');
    expect(provider.calls.map(c => c.action)).toEqual(['stop']);
    await life.drive(provider); expect(provider.calls).toHaveLength(1);
    provider.setPhase(ref, 'stopped'); await life.drive(provider);
    expect(provider.calls.map(c => c.action)).toEqual(['stop', 'wake']);
    expect(life.get()).toMatchObject({ phase: 'BOOTING', epoch: 2, wake_after_stop: 0 });
  });
  it('provider-confirmed stop is required before clearing operation leases', () => {
    const claim = claimed(), op = operation(claim.run.id); life.heartbeat(identity, [op]);
    f.db.exec("UPDATE lifecycle SET phase='RECOVERY_REQUIRED'");
    expect(() => life.observeStopped({ phase: 'stopping', executionStopped: false, persistentState: 'retained', observedAt: Date.now() })).toThrow();
    expect(f.db.all('SELECT status FROM operations')[0]).toEqual({ status: 'active' });
    life.observeStopped({ phase: 'stopped', executionStopped: true, persistentState: 'retained', observedAt: Date.now() });
    expect(f.db.all('SELECT status FROM operations')[0]).toEqual({ status: 'settled' });
    expect(f.store.run(claim.run.id).status).toBe('recovery_required');
  });
  it('expired executor loses ownership and pending effects become unknown', () => {
    const claim = claimed(); unknownEffect(claim.run.id);
    f.db.exec("UPDATE effects SET status='dispatched'");
    f.setNow('2026-09-10T00:01:31.000Z'); life.watchdog();
    expect(life.get().phase).toBe('RECOVERY_REQUIRED');
    expect(f.store.run(claim.run.id).status).toBe('recovery_required');
    expect(f.db.all('SELECT status FROM effects')[0]).toEqual({ status: 'outcome_unknown' });
  });
});
