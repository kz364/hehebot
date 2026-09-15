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
