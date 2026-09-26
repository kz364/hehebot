import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { LifecycleCore } from '../src/core/lifecycle';
import { ControlCore } from '../src/core/control';
import type { Command } from '../src/core/types';
import { bot, otherBot, fixture } from './helpers';

let f: ReturnType<typeof fixture>, lifecycle: LifecycleCore, runId: string;
const identity = { epoch: 3, boot_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
const connection = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const answers = { destination: { answers: ['West'] }, timing: { answers: [] } };
const input = (id = randomUUID()) => ({ id, connection_id: connection, request_id: 0, params: {
  threadId: 'root-7', turnId: 'turn-19', itemId: 'call-4', isBlocking: false,
  questions: [
    { id: 'destination', header: 'Destination', question: 'Which region?', isOther: false, isSecret: false,
      options: [{ label: 'East', description: 'Eastern region' }, { label: 'West', description: 'Western region' }] },
    { id: 'timing', header: 'Timing', question: 'When?', isOther: true, isSecret: false, options: null },
  ],
} });
const answer = (question_id: string, expected_revision = 1): Command => ({ schema_version: 1, type: 'question.answer', payload: { question_id, expected_revision, answers } });
function admit(persona = bot, native = 'turn-19') {
  const id = randomUUID(), now = f.core.now();
  f.db.exec("INSERT INTO runs(id,persona_id,context_json,status,current_attempt,created_at,updated_at) VALUES(?,?,?,'running',1,?,?)",
    id, persona, JSON.stringify(f.core.context(persona, 'Synthetic question task', null, null)), now, now);
  f.db.exec("INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,status,native_run_ref,deadline_at,started_at) VALUES(?,1,?,3,?,'running',?,?,?)",
    id, `${id}:1`, identity.boot_id, native, '2026-09-10T00:20:00.000Z', now);
  return id;
}
const protectedRows = () => ['runs', 'attempts', 'events', 'operations', 'effects', 'resource_locks', 'outbox', 'lifecycle', 'objects']
  .map(table => [table, f.db.all(`SELECT * FROM ${table} ORDER BY rowid`)]);
beforeEach(() => {
  f = fixture(true); lifecycle = new LifecycleCore(f.store, f.core);
  f.db.exec("UPDATE lifecycle SET epoch=3,boot_id=?,phase='READY',lease_until=?", identity.boot_id, '2026-09-10T00:30:00.000Z');
  runId = admit();
});
afterEach(() => f.close());

it.each(['pending', 'answered'])('records a restart-required cutoff for %s questions without settling custody', state => {
  const deadline = '2026-09-10T00:05:00.000Z';
  const id = f.core.questions.record(identity, runId, 1, { ...input(), callback_deadline_at: deadline });
  if (state === 'answered') f.accept(answer(id));
  const unrelated = admit(otherBot, 'other-turn'), prior = f.core.questions.get(id);
  f.setNow('2026-09-10T00:04:59.999Z'); lifecycle.watchdog();
  expect(f.store.run(runId).status).toBe('running');
  expect(f.core.questions.nextCallbackDeadline()).toBe(deadline);
  f.setNow(deadline); lifecycle.watchdog();
  expect(f.core.questions.get(id)).toEqual({ ...prior, revision: prior.revision + 1, restart_required_at: deadline });
  expect(f.store.run(runId)).toMatchObject({ status: 'cancelling', error_code: 'NATIVE_QUESTION_RESTART_REQUIRED', updated_at: deadline });
  expect(f.store.run(unrelated).status).toBe('running');
  expect(lifecycle.heartbeat(identity, []).cancellations).toContain(runId);
  expect(f.core.questions.nextCallbackDeadline()).toBeNull();
  if (state === 'answered') expect(() => f.core.questions.takeAnswer(identity, id, connection)).toThrow();
  else expect(f.core.questions.takeAnswer(identity, id, connection)).toBeNull();
  f.setNow('2026-09-10T00:05:29.999Z'); lifecycle.watchdog();
  expect(f.store.run(runId).status).toBe('cancelling');
  f.setNow('2026-09-10T00:05:30.000Z'); lifecycle.watchdog();
  expect(f.store.run(runId).status).toBe('recovery_required');
  const reopened = new ControlCore(f.store, f.core.options);
  expect(reopened.questions.get(id)).toMatchObject({ state, restart_required_at: deadline });
  expect(f.db.all('SELECT * FROM retry_queue')).toEqual([]);
  expect(() => lifecycle.prepareSleep(identity)).toThrow();
});

it.each(['handoff', 'resolved', 'legacy'])('does not infer callback timeout from %s custody', state => {
  const id = f.core.questions.record(identity, runId, 1, { ...input(), ...(state === 'legacy' ? {} : { callback_deadline_at: '2026-09-10T00:05:00.000Z' }) });
  if (state === 'handoff') { f.accept(answer(id)); f.core.questions.takeAnswer(identity, id, connection); }
  if (state === 'resolved') f.core.questions.resolve(identity, id, connection);
  const prior = f.core.questions.get(id);
  f.setNow('2026-09-10T00:05:00.000Z'); lifecycle.watchdog();
  expect(f.core.questions.get(id)).toEqual(prior);
  expect(f.store.run(runId).status).toBe('running');
  expect(f.core.questions.nextCallbackDeadline()).toBeNull();
});

it.each(['OWNER_CANCELLED', 'CONTEXT_INVALIDATED', 'DEADLINE_EXCEEDED'])('preserves earlier %s cancellation and its grace across question expiry', reason => {
  const id = f.core.questions.record(identity, runId, 1, { ...input(), callback_deadline_at: '2026-09-10T00:05:00.000Z' });
  f.db.exec("UPDATE runs SET status='cancelling',error_code=?,updated_at='2026-09-10T00:04:50.000Z' WHERE id=?", reason, runId);
  f.setNow('2026-09-10T00:05:00.000Z'); lifecycle.watchdog();
  expect(f.store.run(runId)).toMatchObject({ status: 'cancelling', error_code: reason, updated_at: '2026-09-10T00:04:50.000Z' });
  f.core.questions.resolve(identity, id, connection);
  expect(f.core.questions.get(id)).toMatchObject({ state: 'resolved', restart_required_at: f.core.now() });
  f.setNow('2026-09-10T00:05:20.000Z'); lifecycle.watchdog();
  expect(f.store.run(runId).status).toBe('recovery_required');
});

it.each(['epoch', 'boot', 'attempt', 'turn', 'terminated'])('never mutates historical or mismatched %s question custody', mismatch => {
  const id = f.core.questions.record(identity, runId, 1, { ...input(), callback_deadline_at: '2026-09-10T00:05:00.000Z' });
  if (mismatch === 'epoch') f.db.exec('UPDATE lifecycle SET epoch=4');
  if (mismatch === 'boot') f.db.exec('UPDATE lifecycle SET boot_id=?', randomUUID());
  if (mismatch === 'attempt') f.db.exec('UPDATE runs SET current_attempt=2 WHERE id=?', runId);
  if (mismatch === 'turn') f.db.exec("UPDATE attempts SET native_run_ref='another-turn'");
  if (mismatch === 'terminated') f.db.exec("UPDATE attempts SET status='terminated'");
  const prior = f.core.questions.get(id);
  f.setNow('2026-09-10T00:05:00.000Z'); lifecycle.watchdog();
  expect(f.core.questions.get(id)).toEqual(prior);
  expect(f.core.questions.nextCallbackDeadline()).toBeNull();
  expect(f.store.run(runId).status).toBe('running');
});

it('keeps sibling watchdogs, locks and effects independent of the question cutoff', () => {
  const id = f.core.questions.record(identity, runId, 1, { ...input(), callback_deadline_at: '2026-09-10T00:05:00.000Z' });
  const now = f.core.now(), effect = randomUUID();
  f.db.exec("INSERT INTO operations VALUES(?, ?,1,'tool','active',?,'2026-09-10T00:02:00.000Z',?)", randomUUID(), runId, now, now);
  f.db.exec('INSERT INTO resource_locks VALUES(?,?,1,?)', 'synthetic-resource', runId, now);
  f.db.exec("INSERT INTO effects(id,run_id,action_key,classification,status,authorization_ref,request_digest,updated_at) VALUES(?,?,'send','mutation','dispatched','grant','digest',?)", effect, runId, now);
  f.setNow('2026-09-10T00:02:00.000Z'); lifecycle.watchdog();
  expect(f.store.run(runId)).toMatchObject({ status: 'cancelling', error_code: 'DEADLINE_EXCEEDED' });
  f.setNow('2026-09-10T00:02:30.000Z'); lifecycle.watchdog();
  const before = protectedRows();
  f.setNow('2026-09-10T00:05:00.000Z'); lifecycle.watchdog();
  expect(f.core.questions.get(id)).toMatchObject({ restart_required_at: f.core.now() });
  expect(protectedRows()).toEqual(before);
  expect(f.db.all('SELECT status FROM effects WHERE id=?', effect)).toEqual([{ status: 'outcome_unknown' }]);
  expect(f.db.all('SELECT status FROM operations WHERE run_id=?', runId)).toEqual([{ status: 'active' }]);
});

it('rolls back cutoff metadata with failed cancellation, then survives reload and stopped closure', () => {
  const id = f.core.questions.record(identity, runId, 1, { ...input(), callback_deadline_at: '2026-09-10T00:05:00.000Z' });
  f.setNow('2026-09-10T00:05:00.000Z');
  f.db.exec("CREATE TRIGGER cutoff_fail BEFORE UPDATE ON runs BEGIN SELECT RAISE(ABORT,'synthetic'); END");
  expect(() => lifecycle.watchdog()).toThrow();
  expect(f.core.questions.get(id)).not.toHaveProperty('restart_required_at');
  f.db.exec('DROP TRIGGER cutoff_fail');
  const reopened = new ControlCore(f.store, f.core.options);
  new LifecycleCore(f.store, reopened).watchdog();
  expect(reopened.questions.get(id)).toMatchObject({ restart_required_at: f.core.now(), revision: 2 });
  f.setNow('2026-09-10T00:04:59.999Z');
  expect(() => reopened.questions.resolve(identity, id, connection)).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
  f.setNow('2026-09-10T00:05:00.000Z');
  f.db.exec("UPDATE attempts SET status='terminated',settled_at=? WHERE run_id=?", f.core.now(), runId);
  expect(f.accept({ schema_version: 1, type: 'question.close', payload: { question_id: id, expected_revision: 2, confirm_stopped_closure: true } })).toMatchObject({ status: 'applied' });
  expect(reopened.questions.get(id)).toMatchObject({ version: 2, state: 'closed', revision: 3, restart_required_at: f.core.now() });
});

it('keeps the declared callback deadline through delayed recording and rejects answers at its exact boundary', () => {
  const request = { ...input(), callback_deadline_at: '2026-09-10T00:05:00.000Z' };
  f.setNow('2026-09-10T00:00:12.000Z');
  const before = protectedRows(), id = f.core.questions.record(identity, runId, 1, request);
  expect(f.core.questions.get(id)).toMatchObject({ created_at: '2026-09-10T00:00:12.000Z',
    expires_at: request.callback_deadline_at, callback_deadline_at: request.callback_deadline_at });
  f.setNow('2026-09-10T00:04:59.999Z');
  expect(f.core.questions.list()).toMatchObject([{ id, state: 'pending', answerable: true }]);
  expect(f.core.questions.record(identity, runId, 1, request)).toBe(id);
  expect(() => f.core.questions.record(identity, runId, 1, { ...request, callback_deadline_at: '2026-09-10T00:06:00.000Z' }))
    .toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
  f.setNow(request.callback_deadline_at);
  expect(f.accept(answer(id))).toMatchObject({ status: 'rejected', error: { code: 'NATIVE_QUESTION_EXPIRED' } });
  expect(new ControlCore(f.store, f.core.options).questions.list()).toMatchObject([{ id, state: 'pending', answerable: false }]);
  expect(protectedRows()).toEqual(before);
});

it.each([
  ['2026-09-10T00:20:00.000Z', '2026-09-10T00:15:00.000Z'],
  ['2026-09-10T00:04:00.000Z', '2026-09-10T00:04:00.000Z'],
])('a callback deadline cannot exceed the ledger cap or attempt deadline %s', (attemptDeadline, expected) => {
  f.db.exec('UPDATE attempts SET deadline_at=? WHERE run_id=?', attemptDeadline, runId);
  const id = f.core.questions.record(identity, runId, 1, { ...input(), callback_deadline_at: '2026-09-10T00:30:00.000Z' });
  expect(f.core.questions.get(id).expires_at).toBe(expected);
});

it('rejects expired or malformed callback declarations without recording custody', () => {
  for (const callback_deadline_at of ['2026-09-10T00:00:00.000Z', '2026-09-09T23:59:59.999Z', '2026-09-10T00:05:00Z']) {
    expect(() => f.core.questions.record(identity, runId, 1, { ...input(), callback_deadline_at })).toThrow();
  }
  expect(f.core.questions.list()).toEqual([]);
});

it('refuses stored expiry beyond its declared callback deadline', () => {
  const id = f.core.questions.record(identity, runId, 1, { ...input(), callback_deadline_at: '2026-09-10T00:05:00.000Z' });
  f.db.exec("UPDATE runtime_metadata SET value_json=json_set(value_json,'$.expires_at',?) WHERE key=?",
    '2026-09-10T00:05:00.001Z', `native-question:${id}`);
  expect(() => f.core.questions.get(id)).toThrowError(expect.objectContaining({ code: 'NATIVE_QUESTION_CORRUPT' }));
});

it('routes owner answers through durable receipts and projects current questions without task or event writes', () => {
  const protectedBefore = protectedRows(), id = f.core.questions.record(identity, runId, 1, input());
  expect(protectedRows()).toEqual(protectedBefore);
  expect(f.core.state().questions).toMatchObject([{ id, persona_id: bot, conversation_id: bot, state: 'pending', answerable: true }]);
  const key = randomUUID(), command = answer(id), receipt = f.accept(command, key);
  expect(receipt).toMatchObject({ status: 'applied', resource_id: id, error: null });
  expect(f.core.questions.get(id)).toMatchObject({ state: 'answered', answer_owner_id: 'owner', answer_command_id: receipt.id, answers });
  expect(f.core.state(0).questions).toMatchObject([{ id, state: 'answered', answerable: false }]);
  expect(protectedRows()).toEqual(protectedBefore);
  const changes = f.db.all<{ n: number }>('SELECT total_changes() AS n')[0].n;
  expect(f.accept(command, key)).toEqual(receipt);
  expect(f.db.all<{ n: number }>('SELECT total_changes() AS n')[0].n).toBe(changes);
  const conflict = f.accept(answer(id));
  expect(conflict.status).toBe('rejected');
  expect(f.core.questions.get(id).answer_command_id).toBe(receipt.id);
});

it('records handoff uncertainty before returning an answer and never replays it after reload', () => {
  const id = f.core.questions.record(identity, runId, 1, input());
  f.accept(answer(id));
  expect(f.core.questions.takeAnswer(identity, id, connection)).toEqual({ answers });
  expect(f.core.questions.get(id)).toMatchObject({ state: 'response_unknown', response_taken_at: f.core.now() });
  const reopened = new ControlCore(f.store, f.core.options);
  expect(reopened.questions.takeAnswer(identity, id, connection)).toBe(null);
  expect(f.core.state().questions).toMatchObject([{ id, state: 'response_unknown', answerable: false }]);
  expect(() => lifecycle.complete(identity, runId, 1, { status: 'completed', text: 'Not settlement' }))
    .toThrowError(expect.objectContaining({ code: 'CANCEL_UNCONFIRMED' }));
  f.core.questions.resolve(identity, id, connection);
  expect(f.core.state().questions).toEqual([]);
  expect(f.store.run(runId).status).toBe('running');
  lifecycle.complete(identity, runId, 1, { status: 'completed', text: 'Independent result receipt' });
  expect(f.store.run(runId).status).toBe('completed');
});

it('prevents expiry from becoming settlement while leaving unrelated task completion independent', () => {
  const id = f.core.questions.record(identity, runId, 1, input()), unrelated = admit(otherBot, 'turn-unrelated');
  f.setNow('2026-09-10T00:15:00.000Z');
  expect(f.core.state().questions).toMatchObject([{ id, state: 'pending', answerable: false }]);
  expect(f.accept(answer(id)).status).toBe('rejected');
  expect(() => lifecycle.complete(identity, runId, 1, { status: 'completed', text: 'Expired question' })).toThrow();
  lifecycle.complete(identity, unrelated, 1, { status: 'completed', text: 'Independent task' });
  expect(f.store.run(unrelated).status).toBe('completed');
  // Simulate retained terminal history: unresolved metadata still prevents sleep.
  f.db.exec("UPDATE runs SET status='completed' WHERE id=?", runId);
  f.db.exec("UPDATE attempts SET status='completed' WHERE run_id=?", runId);
  f.setNow('2026-09-10T00:16:01.000Z');
  expect(() => lifecycle.prepareSleep(identity)).toThrowError(expect.objectContaining({ code: 'SLEEP_DENIED' }));
});

it('permits native resolution after owner cancellation but does not grant an answer or settle cancellation', () => {
  const id = f.core.questions.record(identity, runId, 1, input());
  expect(f.accept({ schema_version: 1, type: 'run.cancel', payload: { run_id: runId, reason: 'Owner cancelled' } }).status).toBe('applied');
  expect(f.core.state().questions).toMatchObject([{ id, answerable: false }]);
  expect(f.accept(answer(id)).status).toBe('rejected');
  f.core.questions.resolve(identity, id, connection);
  expect(f.core.questions.get(id)).toMatchObject({ state: 'resolved', answers: null });
  expect(f.store.run(runId).status).toBe('cancelling');
  lifecycle.complete(identity, runId, 1, { status: 'cancelled', text: '' });
  expect(f.store.run(runId).status).toBe('cancelled');
});

const close = (question_id: string, expected_revision = 1): Command => ({ schema_version: 1, type: 'question.close',
  payload: { question_id, expected_revision, confirm_stopped_closure: true } });
function stop() {
  f.setNow('2026-09-10T00:30:00.000Z'); lifecycle.watchdog();
  lifecycle.observeStopped({ phase: 'stopped', executionStopped: true, persistentState: 'retained', observedAt: Date.now() });
}

it.each(['pending', 'answered', 'response_unknown'] as const)('explicit stopped closure preserves %s custody without claiming native resolution', state => {
  const id = f.core.questions.record(identity, runId, 1, input());
  if (state !== 'pending') f.accept(answer(id));
  if (state === 'response_unknown') f.core.questions.takeAnswer(identity, id, connection);
  const original = f.core.questions.get(id);
  expect(f.accept(close(id, original.revision))).toMatchObject({ status: 'rejected', error: { code: 'CANCEL_UNCONFIRMED' } });
  expect(f.core.questions.get(id)).toEqual(original);
  stop();
  expect(f.store.run(runId).status).toBe('recovery_required'); expect(f.db.all('SELECT * FROM retry_queue')).toEqual([]);
  expect(f.core.questions.list()).toMatchObject([{ id, answerable: false, closeable: true }]);
  expect(f.core.recoveryPage(bot).recovery).toMatchObject([{ unresolved_questions: 1, can_recover: false }]);
  expect(f.accept({ schema_version: 1, type: 'run.retry', payload: { run_id: runId, expected_attempt: 1 } }))
    .toMatchObject({ status: 'rejected', error: { code: 'CANCEL_UNCONFIRMED' } });
  const recovery: Command = { schema_version: 1, type: 'run.recover', payload: { run_id: runId, expected_attempt: 1, release_resources: true } };
  expect(f.accept(recovery)).toMatchObject({ status: 'rejected', error: { code: 'CANCEL_UNCONFIRMED' } });
  const before = protectedRows(), key = randomUUID(), command = close(id, original.revision), receipt = f.accept(command, key);
  expect(receipt).toMatchObject({ status: 'applied', resource_id: id });
  const closed = f.core.questions.get(id);
  expect(closed).toEqual({ ...original, version: 2, state: 'closed', revision: original.revision + 1,
    closed_at: f.core.now(), close_owner_id: 'owner', close_command_id: receipt.id });
  expect(closed.resolved_at).toBeNull(); expect(protectedRows()).toEqual(before);
  expect(f.core.questions.list()).toEqual([]);
  const reopened = new ControlCore(f.store, f.core.options);
  expect(reopened.questions.get(id)).toEqual(closed);
  expect(() => reopened.questions.takeAnswer(identity, id, connection)).toThrow();
  expect(() => reopened.questions.resolve(identity, id, connection)).toThrow();
  expect(f.accept(command, key)).toEqual(receipt); expect(f.core.questions.get(id)).toEqual(closed);
  expect(f.accept(close(id, closed.revision)).status).toBe('rejected');
  expect(f.core.recoveryPage(bot).recovery).toMatchObject([{ unresolved_questions: 0, can_recover: true }]);
  expect(f.accept(recovery).status).toBe('applied'); expect(f.store.run(runId).status).toBe('failed');
});

it('closure neither reconciles an unknown effect nor releases its resource lock or another question', () => {
  const id = f.core.questions.record(identity, runId, 1, input());
  const unrelated = admit(otherBot, 'other-turn'), request = input();
  request.request_id = 7; request.params.turnId = 'other-turn';
  const other = f.core.questions.record(identity, unrelated, 1, request);
  f.db.exec("INSERT INTO effects(id,run_id,action_key,classification,status,authorization_ref,request_digest,updated_at) VALUES(?,?,?,'mutation','dispatched','policy','digest',?)",
    randomUUID(), runId, 'synthetic-mutation', f.core.now());
  f.db.exec('INSERT INTO resource_locks(resource_id,run_id,attempt,acquired_at) VALUES(?,?,1,?)', 'browser:one', runId, f.core.now());
  stop(); const before = protectedRows(), otherBefore = f.core.questions.get(other);
  expect(f.accept(close(id)).status).toBe('applied'); expect(protectedRows()).toEqual(before);
  expect(f.core.questions.get(other)).toEqual(otherBefore);
  expect(f.core.recoveryPage(bot).recovery).toMatchObject([{ unresolved_questions: 0, can_recover: false, retained_locks: 1 }]);
  expect(f.core.questions.list()).toMatchObject([{ id: other }]);
});

it.each(['epoch', 'boot_id', 'native_run_ref', 'settled_at'])('requires original terminated %s identity before owner closure', field => {
  const id = f.core.questions.record(identity, runId, 1, input()); stop();
  const wrong = { epoch: 4, boot_id: randomUUID(), native_run_ref: 'other-turn', settled_at: null }[field];
  f.db.exec(`UPDATE attempts SET ${field}=? WHERE run_id=?`, wrong!, runId);
  expect(f.core.questions.list()).toMatchObject([{ id, closeable: false }]);
  expect(f.accept(close(id))).toMatchObject({ status: 'rejected', error: { code: 'CANCEL_UNCONFIRMED' } });
  expect(f.core.questions.get(id).state).toBe('pending');
});

it('stale closure revisions and mismatched owner receipts cannot close another question', () => {
  const id = f.core.questions.record(identity, runId, 1, input()); f.accept(answer(id)); stop();
  expect(f.accept(close(id))).toMatchObject({ status: 'rejected', error: { code: 'REVISION_CONFLICT' } });
  const accepted = randomUUID(), payload = close(id, 2).payload;
  f.db.exec("INSERT INTO commands(id,owner_id,idempotency_key,body_hash,type,payload_json,status,accepted_at) VALUES(?,'owner',?,'hash','question.close',?,'accepted',?)",
    accepted, randomUUID(), JSON.stringify(payload), f.core.now());
  expect(() => f.core.questions.closeStopped('other-owner', accepted, payload as any)).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
  f.db.exec("UPDATE commands SET payload_json=? WHERE id=?", JSON.stringify({ ...payload, question_id: randomUUID() }), accepted);
  expect(() => f.core.questions.closeStopped('owner', accepted, payload as any)).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
  expect(f.core.questions.get(id).state).toBe('answered');
});

it.each(['pending', 'answered', 'response_unknown', 'resolved'])('a retained due retry preserves %s question custody after control reconstruction', state => {
  const id = f.core.questions.record(identity, runId, 1, input());
  if (state === 'answered' || state === 'response_unknown') f.accept(answer(id));
  if (state === 'response_unknown') f.core.questions.takeAnswer(identity, id, connection);
  if (state === 'resolved') f.core.questions.resolve(identity, id, connection);
  const question = f.core.questions.get(id);
  expect(question.state).toBe(state);
  stop();
  f.db.exec("UPDATE runs SET status='waiting' WHERE id=?", runId);
  f.db.exec("INSERT INTO retry_queue(run_id,due_at,reason) VALUES(?,?,'STALE_EPOCH') ON CONFLICT(run_id) DO UPDATE SET due_at=excluded.due_at", runId, f.core.now());
  const core = new ControlCore(f.store, f.core.options), restored = new LifecycleCore(f.store, core);
  const before = restored.get(), run = f.store.run(runId);
  restored.retryDue();
  expect(core.questions.get(id)).toEqual(question);
  expect(f.store.run(runId)).toEqual({ ...run, status: state === 'resolved' ? 'queued' : 'recovery_required',
    error_code: state === 'resolved' ? run.error_code : 'NATIVE_QUESTION_UNRESOLVED' });
  if (state === 'resolved') expect(restored.get()).toMatchObject({ queue_sequence: before.queue_sequence + 1, desired_state: 'RUN' });
  else expect(restored.get()).toEqual(before);
  expect(f.db.all('SELECT * FROM retry_queue')).toEqual([]);
  const settled = restored.get(); restored.retryDue();
  expect(restored.get()).toEqual(settled);
  expect(core.questions.get(id)).toEqual(question);
});

it('claim selection skips a retained queued question task before LIMIT without starving fresh work', () => {
  f.core.questions.record(identity, runId, 1, input()); stop();
  f.db.exec("UPDATE runs SET status='queued' WHERE id=?", runId);
  expect(lifecycle.nextClaimableRun()).toBeUndefined();
  const fresh = f.accept({ schema_version: 1, type: 'message.send', payload: { conversation_id: otherBot, text: 'Unrelated fresh request' } }).resource_id;
  expect(lifecycle.nextClaimableRun()?.id).toBe(fresh);
  expect(f.store.run(runId).current_attempt).toBe(1);
});

it('stopped closure permits guarded retention only after task closure and the full 90 days', () => {
  const id = f.core.questions.record(identity, runId, 1, input()); stop();
  f.setNow('2026-09-11T00:00:00.000Z'); f.accept(close(id));
  expect(f.core.questions.nextExpiry()).toBeNull(); expect(f.core.questions.prune()).toBe(0);
  expect(f.accept({ schema_version: 1, type: 'run.recover', payload: { run_id: runId, expected_attempt: 1, release_resources: true } }).status).toBe('applied');
  expect(f.core.questions.nextExpiry()).toBe('2026-12-10T00:00:00.000Z');
  f.setNow('2026-12-09T23:59:59.999Z'); expect(f.core.questions.prune()).toBe(0);
  f.setNow('2026-12-10T00:00:00.000Z'); expect(f.core.questions.prune()).toBe(1);
  expect(f.core.questions.nextExpiry()).toBeNull();
});

it('closure and its command roll back together on a failed metadata write', () => {
  const id = f.core.questions.record(identity, runId, 1, input()); stop();
  const original = f.core.questions.get(id), before = f.db.all('SELECT * FROM commands');
  f.db.exec("CREATE TRIGGER reject_closure BEFORE UPDATE ON runtime_metadata WHEN NEW.key GLOB 'native-question:*' BEGIN SELECT RAISE(ABORT,'synthetic'); END");
  expect(() => f.accept(close(id))).toThrow();
  expect(f.core.questions.get(id)).toEqual(original); expect(f.db.all('SELECT * FROM commands')).toEqual(before);
});

it.each([{ version: 1 }, { state: 'resolved' }, { resolved_at: '2026-09-10T00:30:00.000Z' },
  { close_owner_id: '' }, { close_command_id: 'invalid' }, { closed_at: '2026-09-09T00:00:00.000Z' }, { revision: 1 }])
('rejects malformed closed envelopes without silent repair: %j', change => {
  const id = f.core.questions.record(identity, runId, 1, input()); stop(); f.accept(close(id));
  const corrupted = JSON.stringify({ ...f.core.questions.get(id), ...change });
  f.db.exec('UPDATE runtime_metadata SET value_json=? WHERE key=?', corrupted, `native-question:${id}`);
  expect(() => f.core.questions.get(id)).toThrowError(expect.objectContaining({ code: 'NATIVE_QUESTION_CORRUPT' }));
  expect(() => f.core.questions.list()).toThrowError(expect.objectContaining({ code: 'NATIVE_QUESTION_CORRUPT' }));
  expect(f.db.all<{value_json:string}>('SELECT value_json FROM runtime_metadata WHERE key=?', `native-question:${id}`)[0].value_json).toBe(corrupted);
});

it('can close retained old-attempt custody after a new epoch without touching current work', () => {
  const id = f.core.questions.record(identity, runId, 1, input()); stop();
  const boot = randomUUID();
  f.db.exec("UPDATE lifecycle SET epoch=4,boot_id=?,phase='READY',lease_until='2026-09-10T00:40:00.000Z'", boot);
  f.db.exec("UPDATE runs SET status='running',current_attempt=2 WHERE id=?", runId);
  f.db.exec("INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,status,native_run_ref,deadline_at) VALUES(?,2,?,4,?,'running','new-turn','2026-09-10T00:40:00.000Z')",
    runId, randomUUID(), boot);
  const request = input(); request.params.turnId = 'new-turn'; request.connection_id = randomUUID();
  const current = f.core.questions.record({ epoch: 4, boot_id: boot }, runId, 2, request), before = protectedRows();
  expect(f.accept(close(id)).status).toBe('applied'); expect(protectedRows()).toEqual(before);
  expect(f.core.questions.list()).toMatchObject([{ id: current, answerable: true, closeable: false }]);
});
