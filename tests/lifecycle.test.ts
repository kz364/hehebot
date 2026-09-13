import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LifecycleCore, type Identity, type HeartbeatOperation } from '../src/core/lifecycle';
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
  it('rejects wrong attempt and prevents settled operation resurrection', () => {
    const claim = claimed(), op = operation(claim.run.id);
    expect(() => life.submitted(identity, claim.run.id, 2, 'native')).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
    expect(() => life.heartbeat(identity, [{ ...op, attempt: 2 }])).toThrowError(expect.objectContaining({ code: 'STALE_EPOCH' }));
    life.heartbeat(identity, [{ ...op, status: 'settled' }]);
    expect(() => life.heartbeat(identity, [op])).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(() => life.complete(identity, claim.run.id, 2, { status: 'completed', text: '' })).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
  });
  it('unknown effects block completion and retry after provider stop', () => {
    const claim = claimed(); unknownEffect(claim.run.id);
    expect(() => life.complete(identity, claim.run.id, 1, { status: 'completed', text: '' })).toThrowError(expect.objectContaining({ code: 'OUTCOME_UNKNOWN' }));
    f.db.exec("UPDATE lifecycle SET phase='RECOVERY_REQUIRED'");
    life.observeStopped({ phase: 'stopped', executionStopped: true, persistentState: 'retained', observedAt: Date.now() });
    expect(f.accept({ schema_version: 1, type: 'run.retry', payload: { run_id: claim.run.id, expected_attempt: 1 } })).toMatchObject({ status: 'rejected', error: { code: 'OUTCOME_UNKNOWN' } });
  });
  it('waiting requires checkpoint and terminal result is durable/idempotent', () => {
    const claim = claimed();
    expect(() => life.complete(identity, claim.run.id, 1, { status: 'waiting', text: '' })).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    life.complete(identity, claim.run.id, 1, { status: 'completed', text: 'Synthetic result' });
    life.complete(identity, claim.run.id, 1, { status: 'completed', text: 'Duplicate ignored' });
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
