import { randomUUID } from 'node:crypto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { LifecycleCore, type Identity, type CoordinatorOutcome } from '../src/core/lifecycle';
import { NativeTaskLedger } from '../src/core/native-tasks';
import { ResourceLedger } from '../src/core/resources';
import validateRuntime from '../src/generated/validate-runtime.js';
import { fixture, bot, otherBot } from './helpers';

let f: ReturnType<typeof fixture>, life: LifecycleCore, identity: Identity;
beforeEach(() => {
  f = fixture(true); life = new LifecycleCore(f.store, f.core);
  f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=7,lease_until='2026-09-10T00:02:00.000Z'");
  identity = life.registerBoot(randomUUID()); life.ready(identity);
});
afterEach(() => f.close());
function message(persona = bot) {
  return f.accept({ schema_version: 1, type: 'message.send', payload: { conversation_id: persona, text: 'Independent synthetic work' } }).resource_id!;
}
function root() {
  const id = message(); expect(life.claim(identity)?.run.id).toBe(id);
  life.submitted(identity, id, 1, `native:${id}`); return id;
}
function release(id: string, outcome: CoordinatorOutcome = 'completed', attempt = 1) {
  life.coordinatorRelease(identity, id, attempt, `native:${id}`, outcome);
}
function changes() { return f.db.all<{n:number}>('SELECT total_changes() AS n')[0].n; }
function child(id: string) {
  return new NativeTaskLedger(f.store, f.core, life).register(identity, { parent_run_id: id, parent_attempt: 1, persona_id: bot, native_run_ref: randomUUID(), native_session_key: randomUUID(), title: 'Unsettled child' }, true);
}

it.each(['running','cancelling','recovery_required'] as const)('releases %s coordinator custody without historical snapshot hydration', status => {
  const id = root(), descendant = child(id);
  const context = JSON.stringify({ padding: '界'.repeat(400000) }), checkpoint = JSON.stringify({ padding: 'x'.repeat(1100000) });
  f.db.exec('UPDATE runs SET status=?,context_json=?,checkpoint_json=? WHERE id=?', status, context, checkpoint, id);
  f.db.exec("INSERT INTO effects VALUES('retained-effect',?,'retained-action','mutation','outcome_unknown','policy','digest',NULL,NULL,?)", id, f.core.now());
  const before = f.store.run(id), oldChild = f.store.run(descendant.id), effects = f.db.all('SELECT * FROM effects');
  const read = vi.spyOn(f.db, 'all');
  try {
    release(id, 'interrupted');
    const count = changes(); release(id, 'interrupted'); expect(changes()).toBe(count);
    expect(() => release(id, 'completed')).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
    const rows = read.mock.calls.flatMap(([sql], index) => sql.includes('FROM runs WHERE id=?') ? read.mock.results[index].value : []);
    expect(rows).toEqual(Array.from({ length: 3 }, () => ({ current_attempt: 1, role: 'coordinator', status })));
  } finally { read.mockRestore(); }
  expect(f.store.run(id)).toEqual(before); expect(f.store.run(descendant.id)).toEqual(oldChild);
  expect(f.db.all('SELECT * FROM effects')).toEqual(effects);
  expect(f.db.all('SELECT status,result_json,coordinator_release_json FROM attempts WHERE run_id=?', id)).toEqual([
    { status: 'running', result_json: null, coordinator_release_json: JSON.stringify({ native_ref: `native:${id}`, outcome: 'interrupted' }) }
  ]);
});

it('releases only the root inference lane while child, unknown operations, effects, locks and deadlines remain unchanged', () => {
  const id = root(), descendant = child(id), next = message(otherBot);
  const oldChild = f.store.run(descendant.id);
  life.heartbeat(identity, [{ id: 'unknown-root-op', run_id: id, attempt: 1, kind: 'tool', status: 'unknown', started_at: f.core.now(), last_progress_at: f.core.now(), deadline_at: '2026-09-10T00:13:00.000Z' }]);
  new ResourceLedger(f.store, () => f.core.now()).acquire(descendant.id, 1, ['calendar:child:43']);
  f.db.exec("INSERT INTO effects VALUES('effect-73',?,'action-29','mutation','outcome_unknown','policy-17','digest-91',NULL,NULL,?)", id, f.core.now());
  f.db.exec("INSERT INTO flight_restore_deadlines VALUES('leg-83',2,'departure','Asia/Jakarta','restore','routine','source','outcome_unknown',?,NULL)", id);
  const tables = ['operations', 'effects', 'resource_locks', 'native_task_links', 'flight_restore_deadlines', 'outbox', 'events', 'lifecycle', 'runtime_metadata'];
  const before = tables.map(table => f.db.all(`SELECT * FROM ${table}`));
  const oldRoot = f.store.run(id), oldAttempt = f.db.all('SELECT * FROM attempts WHERE run_id=?', id)[0];
  expect(life.claim(identity)).toBeNull();
  release(id);
  expect(tables.map(table => f.db.all(`SELECT * FROM ${table}`))).toEqual(before);
  expect(f.store.run(id)).toEqual(oldRoot);
  expect(f.db.all('SELECT * FROM attempts WHERE run_id=?', id)[0]).toEqual({ ...oldAttempt as object, coordinator_release_json: JSON.stringify({ native_ref: `native:${id}`, outcome: 'completed' }) });
  const count = changes(); release(id); expect(changes()).toBe(count);
  expect(() => life.complete(identity, id, 1, { status: 'completed', text: 'Not settled' })).toThrowError(expect.objectContaining({ code: 'CANCEL_UNCONFIRMED' }));
  expect(life.claim(identity)?.run.id).toBe(next);
  expect(f.store.run(id)).toEqual(oldRoot); expect(f.store.run(descendant.id)).toEqual(oldChild);
  expect(tables.slice(0, 6).map(table => f.db.all(`SELECT * FROM ${table}`))).toEqual(before.slice(0, 6));
  f.setNow('2026-09-10T00:01:01.000Z');
  expect(() => life.prepareSleep(identity)).toThrowError(expect.objectContaining({ code: 'SLEEP_DENIED' }));
});

it.each(['completed', 'failed', 'interrupted'] as const)('persists %s once across service reconstruction and terminal result without overwriting either receipt', outcome => {
  const id = root(); release(id, outcome);
  life = new LifecycleCore(f.store, f.core);
  life.complete(identity, id, 1, { status: 'completed', text: 'Actually settled independently' });
  const before = f.db.all('SELECT * FROM attempts'), count = changes();
  release(id, outcome); expect(changes()).toBe(count);
  expect(() => release(id, outcome === 'failed' ? 'completed' : 'failed')).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
  expect(f.db.all('SELECT * FROM attempts')).toEqual(before);
});

it('rejects missing submission, wrong native ref, background role, wrong attempt and stale executor without mutation', () => {
  const id = message(); life.claim(identity);
  expect(() => release(id)).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
  life.submitted(identity, id, 1, `native:${id}`);
  const descendant = child(id), count = changes();
  expect(() => life.coordinatorRelease(identity, id, 1, 'different-native', 'completed')).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
  expect(() => life.coordinatorRelease(identity, descendant.id, 1, 'anything', 'completed')).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
  expect(() => release(id, 'completed', 2)).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
  expect(() => life.coordinatorRelease({ ...identity, boot_id: randomUUID() }, id, 1, `native:${id}`, 'completed')).toThrowError(expect.objectContaining({ code: 'STALE_EPOCH' }));
  expect(() => life.coordinatorRelease({ ...identity, epoch: 6 }, id, 1, `native:${id}`, 'completed')).toThrowError(expect.objectContaining({ code: 'STALE_EPOCH' }));
  expect(changes()).toBe(count);
  f.setNow('2026-09-10T00:02:00.000Z');
  expect(() => release(id)).toThrowError(expect.objectContaining({ code: 'STALE_EPOCH' }));
  expect(changes()).toBe(count);
});

it('does not use an earlier attempt release to admit another coordinator', () => {
  const id = root(); release(id);
  life.complete(identity, id, 1, { status: 'failed', text: 'Retryable', error_code: 'TEMPORARY_UNAVAILABLE' });
  f.setNow('2026-09-10T00:00:11.000Z'); life.retryDue();
  expect(life.claim(identity)?.run).toMatchObject({ id, current_attempt: 2 });
  life.submitted(identity, id, 2, 'native-second-91');
  const next = message(otherBot), count = changes();
  expect(() => release(id)).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
  expect(life.claim(identity)).toBeNull(); expect(changes()).toBe(count);
  life.coordinatorRelease(identity, id, 2, 'native-second-91', 'interrupted');
  expect(life.claim(identity)?.run.id).toBe(next);
  expect(f.db.all<{coordinator_release_json:string}>('SELECT coordinator_release_json FROM attempts WHERE run_id=? ORDER BY attempt', id).map(row => JSON.parse(row.coordinator_release_json))).toEqual([
    { native_ref: `native:${id}`, outcome: 'completed' }, { native_ref: 'native-second-91', outcome: 'interrupted' },
  ]);
});

it.each(['cancelling', 'interrupted'])('preserves %s and owner cancellation anchors, requiring exact release before next claim', status => {
  const id = root();
  f.accept({ schema_version: 1, type: 'run.cancel', payload: { run_id: id, reason: 'Owner selected task' } });
  if (status === 'interrupted') { f.setNow('2026-09-10T00:00:31.000Z'); life.watchdog(); }
  const before = f.store.run(id), next = message(otherBot);
  expect(before.status).toBe(status); expect(life.claim(identity)).toBeNull();
  release(id, 'interrupted'); expect(life.claim(identity)?.run.id).toBe(next);
  expect(f.store.run(id)).toEqual(before);
  expect(life.heartbeat(identity, []).cancellations).toContain(id);
  expect(() => life.complete(identity, id, 1, { status: 'completed', text: 'No cancellation bypass' })).toThrowError(expect.objectContaining({ code: 'CONTEXT_INVALIDATED' }));
});

it('never reuses an old epoch release to revive custody in a replacement executor', () => {
  const id = root(); release(id); message(otherBot);
  f.db.exec("UPDATE lifecycle SET epoch=8,boot_id=?,phase='READY'", randomUUID());
  const replacement = { epoch: 8, boot_id: life.get().boot_id! }, count = changes();
  expect(() => release(id)).toThrowError(expect.objectContaining({ code: 'STALE_EPOCH' }));
  expect(() => life.coordinatorRelease(replacement, id, 1, `native:${id}`, 'completed')).toThrowError(expect.objectContaining({ code: 'STALE_EPOCH' }));
  expect(life.claim(replacement)).toBeNull(); expect(changes()).toBe(count);
});

it('bounds unresolved families at 32 including terminal roots with descendants, then admits only after genuine settlement', () => {
  const roots: string[] = [], children: string[] = [];
  for (let n = 0; n < 32; n++) {
    const id = root(); roots.push(id); children.push(child(id).id); release(id);
    life.complete(identity, id, 1, { status: 'completed', text: 'Root settled; child still active' });
  }
  const next = message(otherBot), before = f.db.all('SELECT * FROM runs'), count = changes();
  expect(life.claim(identity)).toBeNull(); expect(changes()).toBe(count);
  expect(f.db.all('SELECT * FROM runs')).toEqual(before);
  life.complete(identity, children[13], 1, { status: 'completed', text: 'Family 14 settled' });
  expect(life.claim(identity)?.run.id).toBe(next);
  expect(f.store.run(children[12]).status).toBe('running');
  expect(f.db.all('SELECT * FROM runs')).toHaveLength(65);
  expect(f.db.all('SELECT * FROM attempts WHERE coordinator_release_json IS NOT NULL')).toHaveLength(32);
});

it('validates only the exact bounded internal release envelope', () => {
  const payload = { identity, run_id: randomUUID(), attempt: 3, native_ref: 'root-turn-73', outcome: 'completed' };
  const valid = (p: unknown) => validateRuntime({ type: 'coordinator-release', payload: p });
  for (const outcome of ['completed', 'failed', 'interrupted']) expect(valid({ ...payload, outcome })).toBe(true);
  for (const patch of [{ outcome: 'cancelled' }, { outcome: 'unknown' }, { attempt: 0 }, { native_ref: '' }, { native_ref: 'x'.repeat(257) }, { result: {} }, { identity: { ...identity, epoch: 0 } }]) expect(valid({ ...payload, ...patch })).toBe(false);
  for (const key of Object.keys(payload)) { const partial = { ...payload } as Record<string,unknown>; delete partial[key]; expect(valid(partial)).toBe(false); }
});
