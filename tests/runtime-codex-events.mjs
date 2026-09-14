import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexEventRouter } from '../runtime/codex-events.mjs';
import { CodexAdapter } from '../runtime/codex-adapter.mjs';
import { FileJournal } from '../runtime/file-journal.mjs';

const command = (threadId, turnId, id, status = 'inProgress') => ({ method: status === 'inProgress' ? 'item/started' : 'item/completed', params: {
  threadId, turnId, item: { id, type: 'commandExecution', status, aggregatedOutput: 'PRIVATE_OUTPUT_NOT_FOR_ROUTER' },
} });
const root = (threadId, id) => ({ method: 'turn/completed', params: { threadId, turn: { id, status: 'completed' } } });
async function fixture(t, limits = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'clawbot-event-router-'));
  const journal = new FileJournal(directory), transport = new EventEmitter(), recoveries = [], calls = [];
  const adapter = new CodexAdapter({ journal, cwd: directory, rpc: async method => { calls.push(method); throw new Error('No RPC expected'); } });
  const router = new CodexEventRouter({ transport, adapter, onRecovery: value => recoveries.push(value.code), ...limits });
  t.after(async () => { router.close(); await router.tail; await rm(directory, { recursive: true, force: true }); });
  const admit = (attempt, threadId, nativeRunId) => journal.putIfAbsent(attempt, { threadId, nativeRunId, status: 'running', rootSettled: false });
  return { journal, transport, recoveries, calls, adapter, router, admit };
}

test('early observations wait for acknowledged exact pairs and retain commands after root completion', async t => {
  const f = await fixture(t);
  f.transport.emit('notification', command('thread-a', 'same-turn', 'command-a'));
  f.transport.emit('notification', root('thread-b', 'same-turn'));
  f.transport.emit('notification', root('thread-a', 'same-turn'));
  await f.router.flush();
  assert.equal(f.router.pending.length, 3);
  assert.doesNotMatch(JSON.stringify(f.router.pending), /PRIVATE_OUTPUT/);
  await f.admit('a', 'thread-a', 'same-turn'); await f.admit('b', 'thread-b', 'same-turn');
  await f.router.bind('a');
  assert.equal((await f.journal.get('a')).commands['command-a'], 'inProgress');
  assert.equal((await f.journal.get('a')).rootSettled, true);
  assert.equal((await f.journal.get('b')).rootSettled, false);
  assert.equal(f.router.pending.length, 1);
  await f.router.bind('b');
  f.transport.emit('notification', command('thread-a', 'same-turn', 'command-a', 'completed'));
  await f.router.flush();
  assert.equal((await f.journal.get('a')).commands['command-a'], 'completed');
  assert.equal((await f.journal.get('b')).commands, undefined);
  assert.equal(f.router.pending.length, 0); assert.deepEqual(f.recoveries, []);
  assert.equal(f.adapter.sleepReadiness().allowed, false); assert.deepEqual(f.calls, []);
});

test('unknown events are bounded and overflow fences without guessing a task', async t => {
  const f = await fixture(t, { maxPending: 2 });
  for (let i = 0; i < 3; i++) f.transport.emit('notification', root('unbound', `turn-${i}`));
  await f.router.flush();
  assert.deepEqual(f.recoveries, ['NATIVE_EVENT_OVERFLOW']); assert.equal(f.router.pending.length, 2);
  assert.equal(f.transport.listenerCount('notification'), 0);
  await assert.rejects(f.router.bind('unknown'), { code: 'EVENT_ROUTER_FENCED' });
});

test('MCP invocations remain separate from commands and external-effect settlement', async t => {
  const f = await fixture(t); await f.admit('a', 'thread', 'turn'); await f.router.bind('a');
  const mcp = status => ({ method: status === 'inProgress' ? 'item/started' : 'item/completed', params: {
    threadId: 'thread', turnId: 'turn', item: { id: 'mcp', type: 'mcpToolCall', status,
      arguments: { token: 'PRIVATE_ARGUMENT' }, result: { secret: 'PRIVATE_RESULT' }, readOnlyHint: true },
  } });
  f.transport.emit('notification', command('thread', 'turn', 'command'));
  f.transport.emit('notification', mcp('inProgress')); f.transport.emit('notification', root('thread', 'turn'));
  await f.router.flush();
  const unfinished = await f.journal.get('a');
  assert.deepEqual(unfinished.mcpCalls, { mcp: 'inProgress' }); assert.equal(unfinished.rootSettled, true);
  assert.deepEqual(unfinished.commands, { command: 'inProgress' });
  f.transport.emit('notification', mcp('failed')); await f.router.flush();
  const failed = await f.journal.get('a');
  assert.deepEqual(failed.mcpCalls, { mcp: 'failed' }); assert.deepEqual(failed.commands, { command: 'inProgress' });
  assert.doesNotMatch(JSON.stringify(failed), /PRIVATE_|readOnlyHint|effectsSettled/);
  assert.equal(f.adapter.sleepReadiness().allowed, false);
  f.transport.emit('notification', mcp('completed')); await f.router.flush();
  assert.deepEqual(f.recoveries, ['NATIVE_EVENT_RECONCILIATION_FAILED']);
  assert.deepEqual((await f.journal.get('a')).mcpCalls, { mcp: 'failed' });
});

test('a second logical attempt cannot take an existing native identity', async t => {
  const f = await fixture(t);
  await f.admit('a', 'thread', 'turn'); await f.admit('b', 'thread', 'turn');
  await f.router.bind('a');
  await assert.rejects(f.router.bind('b'), { code: 'NATIVE_IDENTITY_CONFLICT' });
  assert.deepEqual(f.recoveries, ['NATIVE_IDENTITY_CONFLICT']);
});

const spawn = (status, receiverThreadIds, extra = {}) => ({ method: status === 'inProgress' ? 'item/started' : 'item/completed', params: {
  threadId: 'parent', turnId: 'turn', item: { id: 'spawn-19', type: 'collabAgentToolCall', tool: 'spawnAgent',
    senderThreadId: 'parent', status, receiverThreadIds, prompt: 'PRIVATE_TASK', agentsStates: { private: 'PRIVATE_RESULT' }, ...extra },
} });

test('spawn receipts retain exact receivers after parent completion without settling children', async t => {
  const f = await fixture(t);
  f.transport.emit('notification', spawn('inProgress', []));
  f.transport.emit('notification', spawn('completed', ['child-43', 'child-19']));
  f.transport.emit('notification', root('parent', 'turn'));
  await f.router.flush();
  assert.doesNotMatch(JSON.stringify(f.router.pending), /PRIVATE_|agentsStates|prompt/);
  await f.admit('a', 'parent', 'turn'); await f.router.bind('a');
  const row = await f.journal.get('a');
  assert.deepEqual(row.spawns, { 'spawn-19': { status: 'completed', receiverThreadIds: ['child-19', 'child-43'] } });
  assert.equal(row.rootSettled, true); assert.equal(row.effectsSettled, undefined);
  assert.equal(f.adapter.sleepReadiness().allowed, false); assert.deepEqual(f.recoveries, []);
  f.transport.emit('notification', spawn('completed', ['child-19', 'child-43'])); await f.router.flush();
  assert.deepEqual(await f.journal.get('a'), row);
  f.transport.emit('notification', spawn('completed', ['child-99'])); await f.router.flush();
  assert.deepEqual(f.recoveries, ['NATIVE_EVENT_RECONCILIATION_FAILED']);
  assert.deepEqual(await f.journal.get('a'), row);
});

test('spawn sender, duplicate receivers and self-spawn are rejected before buffering', async t => {
  for (const event of [spawn('completed', ['child'], { senderThreadId: 'other' }),
    spawn('completed', ['child', 'child']), spawn('completed', ['parent'])]) {
    const f = await fixture(t); f.transport.emit('notification', event);
    assert.deepEqual(f.recoveries, ['NATIVE_EVENT_INVALID']); assert.equal(f.router.pending.length, 0);
  }
});

test('a failed spawn cannot erase an already observed receiver', async t => {
  const f = await fixture(t); await f.admit('a', 'parent', 'turn'); await f.router.bind('a');
  f.transport.emit('notification', spawn('inProgress', ['child-43'])); await f.router.flush();
  f.transport.emit('notification', spawn('failed', [])); await f.router.flush();
  assert.deepEqual(f.recoveries, ['NATIVE_EVENT_RECONCILIATION_FAILED']);
  assert.deepEqual((await f.journal.get('a')).spawns['spawn-19'], { status: 'inProgress', receiverThreadIds: ['child-43'] });
});

test('child turns arriving before spawn attribution are retained and settle independently', async t => {
  const f = await fixture(t);
  const started = { method: 'turn/started', params: { threadId: 'child-43', turn: { id: 'child-turn', status: 'inProgress', items: ['PRIVATE_INPUT'] } } };
  f.transport.emit('notification', started);
  f.transport.emit('notification', root('stranger', 'child-turn'));
  f.transport.emit('notification', spawn('completed', ['child-43']));
  f.transport.emit('notification', root('parent', 'turn'));
  await f.admit('a', 'parent', 'turn'); await f.router.bind('a');
  const key = JSON.stringify(['child-43', 'child-turn']);
  assert.deepEqual((await f.journal.get('a')).childTurns, { [key]: 'inProgress' });
  assert.equal((await f.journal.get('a')).rootSettled, true);
  assert.equal(f.router.pending.length, 1);
  f.transport.emit('notification', root('child-43', 'child-turn')); await f.router.flush();
  const settled = await f.journal.get('a');
  assert.deepEqual(settled.childTurns, { [key]: 'completed' });
  assert.equal(settled.effectsSettled, undefined); assert.doesNotMatch(JSON.stringify(settled), /PRIVATE_INPUT/);
  assert.deepEqual(f.recoveries, []); assert.equal(f.adapter.sleepReadiness().allowed, false);
  f.transport.emit('notification', started); await f.router.flush();
  assert.deepEqual(f.recoveries, ['NATIVE_EVENT_RECONCILIATION_FAILED']);
  assert.deepEqual((await f.journal.get('a')).childTurns, { [key]: 'completed' });
});

test('router restart restores only durable child attribution and rejects adoption by another root', async t => {
  const f = await fixture(t); await f.admit('a', 'parent', 'turn'); await f.router.bind('a');
  f.transport.emit('notification', spawn('completed', ['child-43'])); await f.router.flush();
  f.router.close();
  const restarted = new CodexEventRouter({ transport: f.transport, adapter: f.adapter, onRecovery: value => f.recoveries.push(value.code) });
  t.after(() => restarted.close());
  await restarted.bind('a');
  f.transport.emit('notification', root('child-43', 'child-turn')); await restarted.flush();
  assert.deepEqual((await f.journal.get('a')).childTurns, { '["child-43","child-turn"]': 'completed' });
  await f.admit('b', 'child-43', 'other-turn');
  await assert.rejects(restarted.bind('b'), { code: 'NATIVE_IDENTITY_CONFLICT' });
  assert.equal((await f.journal.get('b')).rootSettled, false);
});

test('binding limits allow repeats but missing acknowledgements never consume early events', async t => {
  const f = await fixture(t, { maxBindings: 1 });
  await f.admit('lost', 'thread-lost', null);
  f.transport.emit('notification', root('thread-lost', 'unacknowledged'));
  await assert.rejects(f.router.bind('lost'), { code: 'SUBMISSION_OUTCOME_UNKNOWN' });
  assert.equal(f.router.pending.length, 1); assert.equal(f.router.bindings.size, 0);
  await f.admit('a', 'thread-a', 'turn'); await f.admit('b', 'thread-b', 'turn');
  await f.router.bind('a'); await f.router.bind('a');
  await assert.rejects(f.router.bind('b'), { code: 'NATIVE_BINDING_LIMIT' });
  assert.deepEqual(f.recoveries, ['NATIVE_BINDING_LIMIT']);
});

test('malformed command status is rejected before an unknown event can be buffered', async t => {
  const f = await fixture(t);
  f.transport.emit('notification', command('thread', 'turn', 'command', { secret: 'invalid' }));
  assert.deepEqual(f.recoveries, ['NATIVE_EVENT_INVALID']); assert.equal(f.router.pending.length, 0);
});

test('disk observation failure retains the event and reports only a stable recovery code', async t => {
  const f = await fixture(t); await f.admit('a', 'thread', 'turn'); await f.router.bind('a');
  f.adapter.observe = async () => { throw new Error('sensitive local path'); };
  f.transport.emit('notification', root('thread', 'turn')); await f.router.flush();
  assert.deepEqual(f.recoveries, ['NATIVE_EVENT_RECONCILIATION_FAILED']);
  assert.equal(f.router.pending.length, 1); assert.equal((await f.journal.get('a')).rootSettled, false);
});

test('disconnect and malformed identity fence once without issuing native requests', async t => {
  const f = await fixture(t);
  f.transport.emit('notification', root('', 'turn')); f.transport.emit('disconnect');
  assert.deepEqual(f.recoveries, ['NATIVE_EVENT_INVALID']); assert.deepEqual(f.calls, []);
  const other = await fixture(t); other.transport.emit('disconnect'); other.transport.emit('disconnect');
  assert.deepEqual(other.recoveries, ['NATIVE_DISCONNECTED']);
});
