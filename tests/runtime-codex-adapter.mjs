import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileJournal } from '../runtime/file-journal.mjs';
import { CodexAdapter } from '../runtime/codex-adapter.mjs';

const input = { attemptId: 'attempt1', installationId: 'installation1', personaId: 'assistant',
  scope: 'conversation', scopeId: 'room1', message: 'Read the task context', model: 'gpt-5.4' };
async function fixture(t, rpc) {
  const cwd = await mkdtemp(join(tmpdir(), 'claw-codex-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const journal = new FileJournal(cwd);
  const calls = [];
  const adapter = new CodexAdapter({ cwd, journal, testMode: true, rpc: async (method, params) => {
    calls.push({ method, params });
    if (rpc) return rpc(method, params, journal);
    if (method === 'thread/start') return { thread: { id: 'thread-a' } };
    if (method === 'turn/start') return { turn: { id: 'turn-b' } };
    if (method === 'turn/steer') return { turnId: 'turn-b' };
    return {};
  } });
  return { adapter, calls, journal, cwd };
}

test('production cannot be enabled by successful mock submission', async t => {
  const { adapter } = await fixture(t);
  adapter.testMode = false;
  await assert.rejects(adapter.submit(input), { code: 'COMPATIBILITY_GATE_BLOCKED' });
  assert.equal(adapter.sleepReadiness().allowed, false);
});

test('persists thread before inference; duplicate submission and changed input are distinct', async t => {
  const { adapter, calls, journal } = await fixture(t, async (method, params, journal) => {
    if (method === 'thread/start') return { thread: { id: 'thread-a' } };
    assert.equal((await journal.get(input.attemptId)).threadId, 'thread-a');
    assert.equal(params.clientUserMessageId, input.attemptId);
    return { turn: { id: 'turn-b' } };
  });
  assert.equal((await adapter.submit(input)).nativeRunId, 'turn-b');
  await adapter.submit(input); assert.equal(calls.length, 2);
  await assert.rejects(adapter.submit({ ...input, scopeId: 'another-room' }), { code: 'IDEMPOTENCY_CONFLICT' });
  assert.equal((await journal.get(input.attemptId)).status, 'running');
});

test('lost turn acknowledgement survives journal reopen without repeating inference', async t => {
  const { adapter, calls, journal, cwd } = await fixture(t, async method => {
    if (method === 'thread/start') return { thread: { id: 'thread-a' } };
    throw new Error('secret upstream diagnostic');
  });
  await adapter.submit(input);
  const restored = new CodexAdapter({ cwd, journal: new FileJournal(cwd), testMode: true,
    rpc: () => assert.fail('must not replay') });
  assert.equal((await restored.submit(input)).recoveryRequired, true);
  assert.equal(calls.length, 2);
  assert.equal(JSON.stringify(await journal.get(input.attemptId)).includes('secret'), false);
});

test('steering targets expected turn, deduplicates and never silently changes a task', async t => {
  const { adapter, calls } = await fixture(t);
  await adapter.submit(input);
  assert.equal((await adapter.steer(input.attemptId, { commandId: 'cmd1', text: 'Change goal' })).status, 'accepted');
  await adapter.steer(input.attemptId, { commandId: 'cmd1', text: 'Change goal' });
  assert.equal(calls.length, 3); assert.equal(calls[2].params.expectedTurnId, 'turn-b');
  await assert.rejects(adapter.steer(input.attemptId, { commandId: 'cmd1', text: 'Different goal' }), { code: 'IDEMPOTENCY_CONFLICT' });
});

test('interrupt acknowledgement and root completion do not authorize sleep or complete children', async t => {
  const { adapter, calls } = await fixture(t);
  await adapter.submit(input);
  const cancelled = await adapter.cancel(input.attemptId);
  assert.equal(cancelled.cancelAcknowledged, true); assert.equal(cancelled.rootSettled, false);
  await adapter.cancel(input.attemptId); assert.equal(calls.length, 3);
  await assert.rejects(adapter.observe(input.attemptId, { method: 'turn/completed', params: {
    threadId: 'wrong-thread', turn: { id: 'turn-b', status: 'interrupted' },
  } }), { code: 'SETTLEMENT_IDENTITY_MISMATCH' });
  const settled = await adapter.observe(input.attemptId, { method: 'turn/completed', params: {
    threadId: 'thread-a', turn: { id: 'turn-b', status: 'interrupted' },
  } });
  assert.equal(settled.status, 'finishing'); assert.equal(settled.rootSettled, true);
  assert.equal(adapter.sleepReadiness().allowed, false);
});
