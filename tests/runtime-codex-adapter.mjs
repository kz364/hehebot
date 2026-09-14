import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileJournal } from '../runtime/file-journal.mjs';
import { CodexAdapter } from '../runtime/codex-adapter.mjs';

const input = { attemptId: 'attempt1', installationId: 'installation1', personaId: 'assistant',
  scope: 'conversation', scopeId: 'room1', message: 'Read the task context', model: 'gpt-5.4' };
async function fixture(t, rpc) {
  const cwd = await mkdtemp(join(tmpdir(), 'hehe-codex-'));
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

test('host dynamic definitions are snapshotted and changes cannot reuse a submitted attempt', async t => {
  const f = await fixture(t);
  const definitions = [{ type: 'function', name: 'read_fixture', description: 'Read fixture', inputSchema: { type: 'object' } }];
  const adapter = new CodexAdapter({ cwd: f.cwd, journal: f.journal, rpc: f.adapter.rpc, testMode: true, dynamicTools: definitions });
  definitions[0].name = 'changed_after_construction';
  await adapter.submit(input);
  assert.equal(f.calls[0].params.dynamicTools[0].name, 'read_fixture');
  assert.equal(f.calls[0].params.approvalPolicy, 'untrusted');
  await adapter.submit(input); assert.equal(f.calls.length, 2);
  const changed = new CodexAdapter({ cwd: f.cwd, journal: f.journal, rpc: () => assert.fail('must not resubmit'), testMode: true, dynamicTools: definitions });
  await assert.rejects(changed.submit(input), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(adapter.submit({ ...input, dynamicTools: definitions }), { code: 'INVALID_SUBMISSION' });
});

test('task MCP configuration is host-owned, snapshotted and bound to durable submission', async t => {
  const f = await fixture(t);
  const mcpServers = { task: { command: '/host/mcp', env: { GRANT_PATH: '/task-a/grant.json' } } };
  const adapter = new CodexAdapter({ cwd: f.cwd, journal: f.journal, rpc: f.adapter.rpc, testMode: true, mcpServers });
  mcpServers.task.env.GRANT_PATH = '/task-b/grant.json';
  await adapter.submit(input);
  assert.deepEqual(f.calls[0].params.config, { mcp_servers: { task: { command: '/host/mcp', env: { GRANT_PATH: '/task-a/grant.json' } } } });
  await adapter.submit(input); assert.equal(f.calls.length, 2);
  const other = new CodexAdapter({ cwd: f.cwd, journal: new FileJournal(f.cwd), rpc: () => assert.fail('must not replay'), testMode: true, mcpServers });
  await assert.rejects(other.submit(input), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(adapter.submit({ ...input, mcpServers }), { code: 'INVALID_SUBMISSION' });
  await assert.rejects(adapter.submit({ ...input, config: { mcp_servers: mcpServers } }), { code: 'INVALID_SUBMISSION' });
});

test('named permissions are bounded constructor-only host selection, not model authority', async t => {
  const f = await fixture(t);
  const options = { cwd: f.cwd, journal: f.journal, rpc: f.adapter.rpc, testMode: true };
  for (const permissionsProfile of ['', ' ', ' padded', 'a\nb', '../root', '/root', 'a.b', 'é', 'a'.repeat(129), null, false, 1, [], {}]) {
    assert.throws(() => new CodexAdapter({ ...options, permissionsProfile }), { code: 'INVALID_CONFIGURATION' });
  }
  const profile = 'A_9-' + 'z'.repeat(124);
  const configured = { ...options, permissionsProfile: profile };
  const adapter = new CodexAdapter(configured);
  configured.permissionsProfile = 'other';
  for (const field of ['permissionsProfile', 'permissions', 'sandbox', 'config']) {
    await assert.rejects(adapter.submit({ ...input, [field]: 'model-selected' }), { code: 'INVALID_SUBMISSION' });
  }
  assert.equal(await f.journal.get(input.attemptId), null);
  assert.equal(f.calls.length, 0);
  await adapter.submit(input);
  assert.equal(f.calls[0].params.permissions, profile);
  assert.equal(Object.hasOwn(f.calls[0].params, 'sandbox'), false);
  assert.equal(f.calls[0].params.approvalPolicy, 'untrusted');
  assert.equal(adapter.sleepReadiness().allowed, false);
  const production = new CodexAdapter({ ...options, testMode: false, permissionsProfile: profile });
  await assert.rejects(production.submit({ ...input, attemptId: 'blocked' }), { code: 'COMPATIBILITY_GATE_BLOCKED' });
  assert.equal(f.calls.length, 2);
});

test('named profile fingerprint survives reopen and rejects changes or removal without native replay', async t => {
  const f = await fixture(t);
  const dynamicTools = [{ name: 'read_fixture', inputSchema: { type: 'object' } }];
  const mcpServers = { task: { command: '/host/mcp' } };
  const options = { cwd: f.cwd, journal: f.journal, rpc: f.adapter.rpc, testMode: true, dynamicTools, mcpServers, permissionsProfile: 'task_A' };
  const adapter = new CodexAdapter(options);
  const receipt = await adapter.submit(input);
  assert.equal(receipt.status, 'running');
  assert.deepEqual(f.calls[0].params.dynamicTools, dynamicTools);
  assert.deepEqual(f.calls[0].params.config, { mcp_servers: mcpServers });
  const reopened = { ...options, journal: new FileJournal(f.cwd), rpc: () => assert.fail('must not replay') };
  assert.equal((await new CodexAdapter(reopened).submit(input)).nativeRunId, receipt.nativeRunId);
  for (const permissionsProfile of ['task_B', undefined]) {
    await assert.rejects(new CodexAdapter({ ...reopened, permissionsProfile }).submit(input), { code: 'IDEMPOTENCY_CONFLICT' });
  }
  await f.journal.update(input.attemptId, { status: 'recovery_required', nativeRunId: null });
  assert.equal((await new CodexAdapter(reopened).submit(input)).recoveryRequired, true);
  await assert.rejects(new CodexAdapter({ ...reopened, permissionsProfile: 'task_B' }).submit(input), { code: 'IDEMPOTENCY_CONFLICT' });
  assert.equal(f.calls.length, 2);
});

test('absent profile preserves all legacy fingerprints, sandbox defaults and reopened receipts', async t => {
  const dynamicTools = [{ name: 'read_fixture', inputSchema: { type: 'object' } }];
  const mcpServers = { task: { command: '/host/mcp' } };
  // Independent pre-change record format, including every prior optional-config branch.
  const values = ['attempt1', 'installation1', 'assistant', 'conversation', 'room1', 'Read the task context', 'gpt-5.4'];
  for (const [options, legacy] of [[{}, values], [{ dynamicTools }, [values, dynamicTools]],
    [{ mcpServers }, [values, [], mcpServers]], [{ dynamicTools, mcpServers }, [values, dynamicTools, mcpServers]]]) {
    const f = await fixture(t);
    const adapter = new CodexAdapter({ cwd: f.cwd, journal: f.journal, rpc: f.adapter.rpc, testMode: true, ...options });
    const receipt = await adapter.submit(input);
    assert.equal(receipt.fingerprint, createHash('sha256').update(JSON.stringify(legacy)).digest('hex'));
    assert.equal(f.calls[0].params.sandbox, 'read-only');
    assert.equal(Object.hasOwn(f.calls[0].params, 'permissions'), false);
    const reopened = { cwd: f.cwd, journal: new FileJournal(f.cwd), rpc: () => assert.fail('legacy receipt must not replay'), testMode: true, ...options };
    assert.equal((await new CodexAdapter(reopened).submit(input)).nativeRunId, receipt.nativeRunId);
    await assert.rejects(new CodexAdapter({ ...reopened, permissionsProfile: 'task_A' }).submit(input), { code: 'IDEMPOTENCY_CONFLICT' });
    assert.equal(f.calls.length, 2);
  }
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

test('child cancellation targets one observed turn after parent completion and survives lost acknowledgement', async t => {
  const { adapter, calls, journal, cwd } = await fixture(t);
  await adapter.submit(input);
  await adapter.observe(input.attemptId, { method: 'item/completed', params: { threadId: 'thread-a', turnId: 'turn-b',
    item: { id: 'spawn', type: 'collabAgentToolCall', tool: 'spawnAgent', senderThreadId: 'thread-a', status: 'completed', receiverThreadIds: ['child-a', 'child-b'] },
  } });
  for (const threadId of ['child-a', 'child-b']) await adapter.observe(input.attemptId, { method: 'turn/started', params: { threadId, turn: { id: 'same-turn', status: 'inProgress' } } });
  await adapter.observe(input.attemptId, { method: 'turn/completed', params: { threadId: 'thread-a', turn: { id: 'turn-b', status: 'completed' } } });
  const before = await journal.get(input.attemptId);
  adapter.rpc = async (method, params) => { calls.push({ method, params }); throw new Error('lost private acknowledgement'); };
  const target = { threadId: 'child-a', turnId: 'same-turn' };
  const outcomes = await Promise.all([adapter.cancelChild(input.attemptId, target), adapter.cancelChild(input.attemptId, target)]);
  assert.ok(outcomes.every(row => row.status === 'unknown'));
  assert.deepEqual(calls.slice(2), [{ method: 'turn/interrupt', params: target }]);
  assert.deepEqual(await journal.get(input.attemptId), before);
  const restored = new CodexAdapter({ cwd, journal: new FileJournal(cwd), rpc: () => assert.fail('unknown interrupt must not replay') });
  assert.equal((await restored.cancelChild(input.attemptId, target)).status, 'unknown');
  for (const target of [{ threadId: 'child-a', turnId: 'unobserved' }, { threadId: 'unrelated', turnId: 'same-turn' }, { threadId: 'thread-a', turnId: 'turn-b' }])
    await assert.rejects(restored.cancelChild(input.attemptId, target), { code: 'SETTLEMENT_IDENTITY_MISMATCH' });
  await restored.observe(input.attemptId, { method: 'turn/completed', params: { threadId: 'child-b', turn: { id: 'same-turn', status: 'completed' } } });
  assert.deepEqual(await restored.cancelChild(input.attemptId, { threadId: 'child-b', turnId: 'same-turn' }), { status: 'already_terminal', nativeOutcome: 'completed' });
  assert.equal(restored.sleepReadiness().allowed, false);
});

test('reopened adapter recovers only the exact acknowledged turn without replay or sleep permission', async t => {
  const { adapter, cwd } = await fixture(t);
  await adapter.submit(input);
  const calls = [];
  let turns = [{ id: 'unrelated-newer', status: 'failed' }, { id: 'turn-b', status: 'completed' }];
  const restored = new CodexAdapter({ cwd, journal: new FileJournal(cwd), rpc: async (method, params) => {
    calls.push(method); assert.equal(method, 'thread/read');
    assert.deepEqual(params, { threadId: 'thread-a', includeTurns: true });
    return { thread: { id: 'thread-a', turns } };
  } });
  const recovered = await restored.reconcile(input.attemptId);
  assert.equal(recovered.rootSettled, true); assert.equal(recovered.nativeOutcome, 'completed');
  assert.equal(recovered.status, 'finishing'); assert.equal(restored.sleepReadiness().allowed, false);
  assert.deepEqual(await restored.reconcile(input.attemptId), recovered);
  turns = [{ id: 'turn-b', status: 'interrupted' }];
  await assert.rejects(restored.reconcile(input.attemptId), { code: 'SETTLEMENT_CONFLICT' });
  turns = [{ id: 'turn-b', status: 'inProgress' }];
  await assert.rejects(restored.reconcile(input.attemptId), { code: 'SETTLEMENT_CONFLICT' });
  assert.equal(calls.length, 4);
});

test('missing or duplicate history and lost submission acknowledgment cannot be guessed', async t => {
  const { adapter, journal } = await fixture(t);
  await adapter.submit(input);
  for (const turns of [[], [{ id: 'other', status: 'completed' }],
    [{ id: 'turn-b', status: 'completed' }, { id: 'turn-b', status: 'completed' }]]) {
    adapter.rpc = async method => { assert.equal(method, 'thread/read'); return { thread: { id: 'thread-a', turns } }; };
    await assert.rejects(adapter.reconcile(input.attemptId), { code: 'RECONCILIATION_INCOMPLETE' });
    assert.equal((await journal.get(input.attemptId)).rootSettled, false);
  }
  await journal.update(input.attemptId, { nativeRunId: null, status: 'recovery_required' });
  adapter.rpc = () => assert.fail('Do not guess an unacknowledged turn from history');
  await assert.rejects(adapter.reconcile(input.attemptId), { code: 'SUBMISSION_OUTCOME_UNKNOWN' });
});

test('concurrent command starts survive root completion and omitted history until exact late exit', async t => {
  const { adapter, journal, cwd } = await fixture(t);
  await adapter.submit(input);
  const event = (id, status = 'inProgress', threadId = 'thread-a') => ({
    method: status === 'inProgress' ? 'item/started' : 'item/completed',
    params: { threadId, turnId: 'turn-b', item: { id, type: 'commandExecution', status } },
  });
  await Promise.all([adapter.observe(input.attemptId, event('command-a')), adapter.observe(input.attemptId, event('command-b'))]);
  const restored = new CodexAdapter({ cwd, journal: new FileJournal(cwd), rpc: async () => ({ thread: {
    id: 'thread-a', turns: [{ id: 'turn-b', status: 'completed', items: [] }],
  } }) });
  const root = await restored.reconcile(input.attemptId);
  assert.equal(root.rootSettled, true);
  assert.deepEqual(root.commands, { 'command-a': 'inProgress', 'command-b': 'inProgress' });
  await assert.rejects(restored.observe(input.attemptId, event('command-a', 'completed', 'other')), { code: 'SETTLEMENT_IDENTITY_MISMATCH' });
  await restored.observe(input.attemptId, event('command-a', 'completed'));
  assert.deepEqual((await journal.get(input.attemptId)).commands, { 'command-a': 'completed', 'command-b': 'inProgress' });
  await assert.rejects(restored.observe(input.attemptId, event('command-a', 'failed')), { code: 'SETTLEMENT_CONFLICT' });
  assert.equal(restored.sleepReadiness().allowed, false);
});
