import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileJournal } from '../runtime/file-journal.mjs';
import { CodexAdapter } from '../runtime/codex-adapter.mjs';
import { codexTextOnlyProfileSha256, createCodexTextOnlyProfile } from '../runtime/codex-text-only.mjs';

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

test('submission diagnostics distinguish RPC from post-ack failure and survive reopen without replay', async t => {
  const canary = 'SECRET_SUBMISSION_DIAGNOSTIC_CANARY';
  for (const stage of ['thread_start', 'thread_ack', 'turn_start', 'turn_ack']) {
    const f = await fixture(t, method => {
      if (stage === (method === 'thread/start' ? 'thread_start' : 'turn_start')) {
        throw Object.assign(new Error(canary), { code: 'CODEX_RPC_ERROR', rpcCode: -32602, data: canary });
      }
      return method === 'thread/start' ? { thread: { id: 'thread-a' } } : { turn: { id: 'turn-b' } };
    });
    const update = f.journal.update.bind(f.journal);
    f.journal.update = (key, patch) => {
      if (stage === 'thread_ack' && patch.status === 'submission_unknown' || stage === 'turn_ack' && patch.status === 'running') {
        throw Object.assign(new Error(canary), { code: canary, rpcCode: -32602 });
      }
      return update(key, patch);
    };
    const row = await f.adapter.submit(input);
    assert.deepEqual(row.submissionFailure, { stage, code: stage.endsWith('_ack') ? 'UNKNOWN_ERROR' : 'CODEX_RPC_ERROR',
      ...(stage.endsWith('_ack') ? {} : { rpcCode: -32602 }) });
    assert.equal(row.error, 'SUBMISSION_OUTCOME_UNKNOWN'); assert.equal(row.status, 'recovery_required');
    assert.equal(row.rootSettled, false); assert.equal(row.nativeRunId, null);
    assert.equal(row.threadId, stage.startsWith('turn') ? 'thread-a' : null);
    const persisted = await readFile(join(f.cwd, `${input.attemptId}.json`), 'utf8');
    assert.ok(!persisted.includes(canary));
    const reopened = new CodexAdapter({ cwd: f.cwd, journal: new FileJournal(f.cwd), testMode: true,
      rpc: () => assert.fail('unknown submission must not replay') });
    assert.deepEqual((await reopened.submit(input)).submissionFailure, row.submissionFailure);
    assert.equal(f.calls.length, stage.startsWith('turn') ? 2 : 1);
  }
});

test('submission diagnostics redact hostile errors and bound RPC codes without coercion or getters', async t => {
  const canary = 'SECRET_SUBMISSION_DIAGNOSTIC_CANARY';
  let unsafeReads = 0;
  const errors = [null, canary, new Error(canary), { code: canary },
    { get code() { unsafeReads++; throw new Error(canary); } },
    new Proxy({}, { getOwnPropertyDescriptor() { throw new Error(canary); } }),
    { code: 'CODEX_TIMEOUT', rpcCode: -32602 },
    ...[-2147483648, 2147483647, -2147483649, 2147483648, 1.5, NaN, Infinity, canary,
      { toString() { unsafeReads++; throw new Error(canary); } }].map(rpcCode => ({ code: 'CODEX_RPC_ERROR', rpcCode, message: canary }))];
  for (const [index, error] of errors.entries()) {
    const f = await fixture(t, () => { throw error; });
    const row = await f.adapter.submit(input);
    assert.deepEqual(row.submissionFailure, { stage: 'thread_start', code: index < 6 ? 'UNKNOWN_ERROR'
      : index === 6 ? 'CODEX_TIMEOUT' : 'CODEX_RPC_ERROR',
    ...(index === 7 ? { rpcCode: -2147483648 } : index === 8 ? { rpcCode: 2147483647 } : {}) });
    assert.ok(!(await readFile(join(f.cwd, `${input.attemptId}.json`), 'utf8')).includes(canary));
  }
  assert.equal(unsafeReads, 0);
  for (const method of ['thread/start', 'turn/start']) {
    const f = await fixture(t, called => called === method ? { secret: canary } : { thread: { id: 'thread-a' } });
    assert.deepEqual((await f.adapter.submit(input)).submissionFailure, {
      stage: method === 'thread/start' ? 'thread_ack' : 'turn_ack', code: 'CODEX_PROTOCOL_ERROR' });
  }
});

test('production cannot be enabled by successful mock submission', async t => {
  const { adapter } = await fixture(t);
  adapter.testMode = false;
  await assert.rejects(adapter.submit(input), { code: 'COMPATIBILITY_GATE_BLOCKED' });
  assert.equal(adapter.sleepReadiness().allowed, false);
});

test('text-only binding is fingerprinted before RPC and commands explicit empty tool environments', async t => {
  const f = await fixture(t), profile = createCodexTextOnlyProfile({ codexVersion: '0.154.0', model: input.model,
    modelCatalog: { models: [{ slug: input.model, tool_mode: 'direct', experimental_supported_tools: [] }] },
    catalogPath: join(f.cwd, 'catalog.json'), catalogValidation: 'synthetic-fixture', syntheticFixture: true });
  const ownerAlpha = { session_id: '11111111-1111-4111-8111-111111111111', persona_id: '22222222-2222-4222-8222-222222222222',
    expires_at: '2099-01-01T00:00:00.000Z', max_runs: 1, max_task_seconds: 60,
    text_only: { profile_version: profile.version, profile_sha256: codexTextOnlyProfileSha256(profile) } };
  const adapter = new CodexAdapter({ cwd: f.cwd, journal: f.journal, rpc: f.adapter.rpc,
    permissionsProfile: 'restricted', ownerAlpha, textOnlyProfile: profile });
  const receipt = await adapter.submit({ ...input, personaId: ownerAlpha.persona_id, scopeId: ownerAlpha.persona_id });
  assert.deepEqual(f.calls[0].params.dynamicTools, []); assert.deepEqual(f.calls[1].params.environments, []);
  assert.deepEqual(receipt.textOnlySubmission, { threadStart: { model: input.model, dynamicTools: [] }, threadIdAck: 'thread-a',
    turnStart: { threadId: 'thread-a', environments: [] }, turnIdAck: 'turn-b' });
  const reopened = new CodexAdapter({ cwd: f.cwd, journal: new FileJournal(f.cwd), rpc: () => assert.fail('no replay'),
    permissionsProfile: 'restricted', ownerAlpha, textOnlyProfile: profile });
  assert.equal((await reopened.submit({ ...input, personaId: ownerAlpha.persona_id, scopeId: ownerAlpha.persona_id })).nativeRunId, 'turn-b');
  assert.throws(() => new CodexAdapter({ cwd: f.cwd, journal: f.journal, rpc: f.adapter.rpc, permissionsProfile: 'restricted',
    ownerAlpha: { ...ownerAlpha, text_only: { ...ownerAlpha.text_only, profile_sha256: 'a'.repeat(64) } }, textOnlyProfile: profile }),
  { code: 'INVALID_CONFIGURATION' });
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

test('initial inference survives acknowledgment and child events until exact root activity', async t => {
  const f = await fixture(t); await f.adapter.submit(input);
  assert.equal((await f.journal.get(input.attemptId)).initialInference, 'inProgress');
  await f.adapter.observe(input.attemptId, { method: 'turn/started', params: { threadId: 'thread-a', turn: { id: 'turn-b', status: 'inProgress' } } });
  assert.equal((await f.journal.get(input.attemptId)).initialInference, 'inProgress');
  await f.journal.update(input.attemptId, { spawns: { s: { status: 'completed', receiverThreadIds: ['child'] } }, childTurns: { '["child","turn"]': 'inProgress' } });
  await f.adapter.observe(input.attemptId, { method: 'item/started', params: { threadId: 'child', turnId: 'turn', item: { id: 'r', type: 'reasoning' } } });
  assert.equal((await f.journal.get(input.attemptId)).initialInference, 'inProgress');
  await assert.rejects(f.adapter.observe(input.attemptId, { method: 'item/started', params: { threadId: 'thread-a', turnId: 'wrong', item: { id: 'r', type: 'reasoning' } } }), { code: 'SETTLEMENT_IDENTITY_MISMATCH' });
  await f.adapter.observe(input.attemptId, { method: 'item/started', params: { threadId: 'thread-a', turnId: 'turn-b', item: { id: 'r', type: 'reasoning' } } });
  const row = await f.journal.get(input.attemptId);
  assert.equal(row.initialInference, 'completed'); assert.equal(row.reasoningItems.r, 'inProgress'); assert.equal(row.rootSettled, false);
  await f.adapter.submit(input); assert.equal(f.calls.length, 2);
  assert.equal((await f.journal.get(input.attemptId)).initialInference, 'completed');
});

test('child initial silence retains its own first observed start through replay and root activity', async t => {
  const f = await fixture(t); await f.adapter.submit(input);
  await f.journal.update(input.attemptId, { spawns: { s: { status: 'completed', receiverThreadIds: ['child'] } } });
  const start = { method: 'turn/started', params: { threadId: 'child', turn: { id: 'turn', status: 'inProgress' } } };
  const key = '["child","turn"]', at = '2026-09-15T01:02:00.000Z';
  await f.adapter.observe(input.attemptId, start, at);
  await f.adapter.observe(input.attemptId, start, '2026-09-15T01:03:00.000Z');
  await f.adapter.observe(input.attemptId, { method: 'turn/completed', params: { threadId: 'thread-a', turn: { id: 'turn-b', status: 'completed' } } });
  assert.deepEqual((await f.journal.get(input.attemptId)).childObligations[key], { initialInference: 'inProgress', initialInferenceAt: at });
  await f.adapter.observe(input.attemptId, { method: 'item/started', params: { threadId: 'child', turnId: 'turn', item: { id: 'reason', type: 'reasoning' } } }, '2026-09-15T01:04:00.000Z');
  const child = (await f.journal.get(input.attemptId)).childObligations[key];
  assert.equal(child.initialInference, 'completed'); assert.equal(child.initialInferenceAt, at);
  assert.equal(child.reasoningItems.reason, 'inProgress');
  await f.adapter.observe(input.attemptId, start, '2026-09-15T01:05:00.000Z');
  assert.deepEqual((await f.journal.get(input.attemptId)).childObligations[key], child);
});

test('child terminal-only observation ends initial silence without inventing legacy clocks', async t => {
  const f = await fixture(t); await f.adapter.submit(input);
  await f.journal.update(input.attemptId, { spawns: { s: { status: 'completed', receiverThreadIds: ['child', 'legacy'] } } });
  const event = (threadId, status) => ({ method: status === 'inProgress' ? 'turn/started' : 'turn/completed', params: { threadId, turn: { id: 'turn', status } } });
  const at = '2026-09-15T01:02:00.000Z';
  await f.adapter.observe(input.attemptId, event('child', 'inProgress'), at);
  await f.adapter.observe(input.attemptId, event('child', 'interrupted'), '2026-09-15T01:03:00.000Z');
  const row = await f.journal.get(input.attemptId);
  assert.equal(row.initialInference, 'inProgress');
  assert.deepEqual(row.childObligations['["child","turn"]'], { initialInference: 'completed', initialInferenceAt: at });
  await f.adapter.observe(input.attemptId, event('legacy', 'inProgress'));
  await f.adapter.observe(input.attemptId, event('legacy', 'inProgress'), at);
  assert.equal((await f.journal.get(input.attemptId)).childObligations['["legacy","turn"]'], undefined);
  await f.journal.update(input.attemptId, { childObligations: { '["child","turn"]': { initialInference: 'inProgress' } } });
  await assert.rejects(f.adapter.observe(input.attemptId, event('child', 'interrupted')), { code: 'INVALID_OPERATION_TIMING' });
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
  await adapter.observe(input.attemptId, { method: 'turn/completed', params: {
    threadId: 'thread-a', turn: { id: 'turn-b', status: 'completed' },
  } });
  assert.equal((await adapter.steer(input.attemptId, { commandId: 'cmd1', text: 'Change goal' })).status, 'accepted');
  await assert.rejects(adapter.steer(input.attemptId, { commandId: 'new', text: 'Too late' }), { code: 'TASK_NOT_RUNNING' });
  assert.equal(calls.length, 3);
});

test('descendant steering binds exact turn and command, survives terminal replay and never steers siblings', async t => {
  const { adapter, calls, journal, cwd } = await fixture(t);
  await adapter.submit(input);
  await adapter.observe(input.attemptId, { method: 'item/completed', params: { threadId: 'thread-a', turnId: 'turn-b',
    item: { id: 'spawn', type: 'collabAgentToolCall', tool: 'spawnAgent', senderThreadId: 'thread-a', status: 'completed', receiverThreadIds: ['child-a', 'child-b'] },
  } });
  for (const threadId of ['child-a', 'child-b']) await adapter.observe(input.attemptId, { method: 'turn/started', params: { threadId, turn: { id: 'same-turn', status: 'inProgress' } } });
  await adapter.observe(input.attemptId, { method: 'turn/completed', params: { threadId: 'thread-a', turn: { id: 'turn-b', status: 'completed' } } });
  const before = await journal.get(input.attemptId);
  adapter.rpc = async (method, params) => {
    calls.push({ method, params });
    return { turnId: params.expectedTurnId };
  };
  const target = { threadId: 'child-a', turnId: 'same-turn' }, instruction = { commandId: 'child-steer', text: 'Use tomorrow for A' };
  await Promise.all([adapter.steerChild(input.attemptId, target, instruction), adapter.steerChild(input.attemptId, target, instruction)]);
  assert.deepEqual(calls.slice(2), [{ method: 'turn/steer', params: { threadId: 'child-a', expectedTurnId: 'same-turn',
    input: [{ type: 'text', text: instruction.text }], clientUserMessageId: instruction.commandId } }]);
  assert.deepEqual(await journal.get(input.attemptId), before);
  await assert.rejects(adapter.steerChild(input.attemptId, { threadId: 'child-b', turnId: 'same-turn' }, instruction), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(adapter.steerChild(input.attemptId, target, { ...instruction, text: 'Another day' }), { code: 'IDEMPOTENCY_CONFLICT' });
  for (const target of [{ threadId: 'foreign', turnId: 'same-turn' }, { threadId: 'child-a', turnId: 'unobserved' }, { threadId: 'thread-a', turnId: 'turn-b' }])
    await assert.rejects(adapter.steerChild(input.attemptId, target, instruction), { code: 'SETTLEMENT_IDENTITY_MISMATCH' });
  await assert.rejects(adapter.steerChild(input.attemptId, { ...target, latest: true }, instruction), { code: 'INVALID_STEER_TARGET' });
  for (const instruction of [null, { commandId: 'x', text: '' }, { commandId: '../x', text: 'text' }, { commandId: 'x', text: 'text', permissions: 'all' }])
    await assert.rejects(adapter.steerChild(input.attemptId, target, instruction), { code: 'INVALID_STEERING' });
  await adapter.observe(input.attemptId, { method: 'turn/completed', params: { threadId: 'child-a', turn: { id: 'same-turn', status: 'completed' } } });
  const restored = new CodexAdapter({ cwd, journal: new FileJournal(cwd), rpc: () => assert.fail('must not replay native steer') });
  assert.equal((await restored.steerChild(input.attemptId, target, instruction)).status, 'accepted');
  await assert.rejects(restored.steerChild(input.attemptId, target, { ...instruction, commandId: 'late-command' }), { code: 'TASK_NOT_RUNNING' });
  assert.equal((await journal.get(input.attemptId)).childTurns[JSON.stringify(['child-b', 'same-turn'])], 'inProgress');
  assert.equal(restored.sleepReadiness().allowed, false);
});

test('read-only child recovery requires exact recorded ancestry and turn, preserving open tools and siblings', async t => {
  const { adapter, journal, cwd } = await fixture(t);
  await adapter.submit(input);
  const childKey = JSON.stringify(['child-a', 'turn-17']), grandKey = JSON.stringify(['grandchild', 'turn-39']);
  const prior = await journal.update(input.attemptId, {
    spawns: { spawn: { status: 'completed', receiverThreadIds: ['child-a', 'sibling'] } },
    childTurns: { [childKey]: 'inProgress', [grandKey]: 'inProgress', '["sibling","turn-83"]': 'inProgress' },
    childObligations: { [childKey]: { commands: { open: 'inProgress' }, spawns: { nested: { status: 'completed', receiverThreadIds: ['grandchild'] } } },
      [grandKey]: { initialInference: 'inProgress', initialInferenceAt: '2026-09-15T01:02:00.000Z' } },
  });
  let response = { id: 'grandchild', source: { subAgent: { thread_spawn: { parent_thread_id: 'child-a' } } },
    turns: [{ id: 'newer', status: 'failed' }, { id: 'turn-39', status: 'completed', items: [] }] };
  const calls = [];
  const restored = new CodexAdapter({ cwd, journal: new FileJournal(cwd), rpc: async (method, params) => {
    calls.push({ method, params }); return { thread: response };
  } });
  for (const target of [{ threadId: 'grandchild', turnId: 'missing' }, { threadId: 'other', turnId: 'turn-39' }])
    await assert.rejects(restored.reconcileChild(input.attemptId, target), { code: 'SETTLEMENT_IDENTITY_MISMATCH' });
  assert.equal(calls.length, 0);
  const target = { threadId: 'grandchild', turnId: 'turn-39' };
  for (const patch of [{ id: 'wrong' }, { source: {} }, { source: { subAgent: { thread_spawn: { parent_thread_id: 'thread-a' } } } }]) {
    const original = response; response = { ...response, ...patch };
    await assert.rejects(restored.reconcileChild(input.attemptId, target), { code: 'CODEX_PROTOCOL_ERROR' }); response = original;
  }
  for (const turns of [[], [{ id: 'other', status: 'completed' }], [{ id: 'turn-39', status: 'completed' }, { id: 'turn-39', status: 'completed' }]]) {
    const original = response; response = { ...response, turns };
    await assert.rejects(restored.reconcileChild(input.attemptId, target), { code: 'RECONCILIATION_INCOMPLETE' }); response = original;
  }
  assert.deepEqual(await journal.get(input.attemptId), prior);
  const recovered = await restored.reconcileChild(input.attemptId, target);
  assert.deepEqual(recovered, { ...prior, childTurns: { ...prior.childTurns, [grandKey]: 'completed' },
    childObligations: { ...prior.childObligations, [grandKey]: { ...prior.childObligations[grandKey], initialInference: 'completed' } } });
  assert.deepEqual(await restored.reconcileChild(input.attemptId, target), recovered);
  for (const status of ['inProgress', 'interrupted']) {
    response = { ...response, turns: [{ id: 'turn-39', status }] };
    await assert.rejects(restored.reconcileChild(input.attemptId, target), { code: 'SETTLEMENT_CONFLICT' });
  }
  assert.ok(calls.every(call => call.method === 'thread/read' && call.params.threadId === 'grandchild' && call.params.includeTurns === true));
  assert.equal(restored.sleepReadiness().allowed, false);
});

test('lost or mismatched steering acknowledgement stays unknown across journal reopen without text retention', async t => {
  for (const response of ['lost', 'wrong-turn']) {
    const { adapter, journal, cwd } = await fixture(t);
    await adapter.submit(input);
    let calls = 0;
    adapter.rpc = async () => { calls++; if (response === 'lost') throw new Error('private transport failure'); return { turnId: 'wrong-turn' }; };
    const instruction = { commandId: 'unknown-command', text: 'Private steering canary' };
    assert.equal((await adapter.steer(input.attemptId, instruction)).status, 'unknown');
    const restored = new CodexAdapter({ cwd, journal: new FileJournal(cwd), rpc: () => assert.fail('uncertain steering must not replay') });
    assert.equal((await restored.steer(input.attemptId, instruction)).status, 'unknown');
    const key = `steer-${createHash('sha256').update(JSON.stringify([input.attemptId, instruction.commandId])).digest('hex')}`;
    assert.equal(JSON.stringify(await journal.get(key)).includes(instruction.text), false);
    assert.equal(calls, 1);
  }
});

test('interrupt acknowledgement and root completion do not authorize sleep or complete children', async t => {
  const { adapter, calls } = await fixture(t);
  await adapter.submit(input);
  const cancelled = await adapter.cancel(input.attemptId);
  assert.equal(cancelled.cancelAcknowledged, true); assert.equal(cancelled.rootSettled, false);
  assert.equal(cancelled.initialInference, 'inProgress');
  await adapter.cancel(input.attemptId); assert.equal(calls.length, 3);
  await assert.rejects(adapter.observe(input.attemptId, { method: 'turn/completed', params: {
    threadId: 'wrong-thread', turn: { id: 'turn-b', status: 'interrupted' },
  } }), { code: 'SETTLEMENT_IDENTITY_MISMATCH' });
  const settled = await adapter.observe(input.attemptId, { method: 'turn/completed', params: {
    threadId: 'thread-a', turn: { id: 'turn-b', status: 'interrupted' },
  } });
  assert.equal(settled.status, 'finishing'); assert.equal(settled.rootSettled, true);
  assert.equal(settled.initialInference, 'completed');
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
  assert.equal(recovered.initialInference, 'completed');
  assert.equal(recovered.status, 'finishing'); assert.equal(restored.sleepReadiness().allowed, false);
  assert.deepEqual(await restored.reconcile(input.attemptId), recovered);
  turns = [{ id: 'turn-b', status: 'interrupted' }];
  await assert.rejects(restored.reconcile(input.attemptId), { code: 'SETTLEMENT_CONFLICT' });
  turns = [{ id: 'turn-b', status: 'inProgress' }];
  await assert.rejects(restored.reconcile(input.attemptId), { code: 'SETTLEMENT_CONFLICT' });
  assert.equal(calls.length, 4);
});

test('terminal exact-turn history recovers missed output without replay, clocks or sleep permission', async t => {
  const { adapter, journal, cwd } = await fixture(t);
  await adapter.submit(input);
  const calls = [];
  const items = [
    { id: 'first', type: 'agentMessage', text: 'Earlier commentary', phase: 'commentary' },
    { id: 'last', type: 'agentMessage', text: 'Recovered provisional reply', phase: 'final_answer' },
  ];
  const restored = new CodexAdapter({ cwd, journal: new FileJournal(cwd), rpc: async (method, params) => {
    calls.push(method); assert.deepEqual(params, { threadId: 'thread-a', includeTurns: true });
    return { thread: { id: 'thread-a', turns: [
      { id: 'newer-unrelated', status: 'completed', items: [{ id: 'wrong', type: 'agentMessage', text: 'DO NOT ADOPT' }] },
      { id: 'turn-b', status: 'completed', items },
    ] } };
  } });
  const recovered = await restored.reconcile(input.attemptId);
  assert.deepEqual(recovered.outputPreview, { version: 2, text: 'Recovered provisional reply', truncated: false });
  assert.deepEqual(Object.keys(recovered.outputItems), ['first', 'last']);
  assert.equal(recovered.operationTimes, undefined);
  assert.equal(recovered.quietPhases, undefined);
  assert.equal(restored.sleepReadiness().allowed, false);
  const update = restored.journal.update.bind(restored.journal);
  restored.journal.update = () => assert.fail('identical history must not write');
  assert.deepEqual(await restored.reconcile(input.attemptId), recovered);
  restored.journal.update = update;
  assert.deepEqual(await journal.get(input.attemptId), recovered);
  assert.deepEqual(calls, ['thread/read', 'thread/read']);
});

test('history cannot freeze partial output or regress an existing preview with omitted/conflicting items', async t => {
  const { adapter, journal } = await fixture(t);
  await adapter.submit(input);
  let turn = { id: 'turn-b', status: 'inProgress', items: [{ id: 'stream', type: 'agentMessage', text: 'partial' }] };
  adapter.rpc = async method => { assert.equal(method, 'thread/read'); return { thread: { id: 'thread-a', turns: [turn] } }; };
  const before = await journal.get(input.attemptId);
  assert.deepEqual(await adapter.reconcile(input.attemptId), before);
  const live = { id: 'live', type: 'agentMessage', text: 'Already visible', phase: 'final_answer' };
  await adapter.observe(input.attemptId, { method: 'item/completed', params: { threadId: 'thread-a', turnId: 'turn-b', item: live } });
  turn = { ...turn, status: 'completed', items: [{ id: 'old', type: 'agentMessage', text: 'Older omitted snapshot' }] };
  const retained = await adapter.reconcile(input.attemptId);
  assert.equal(retained.outputPreview.text, 'Already visible');
  assert.equal(retained.outputPreview.version, 1);
  assert.deepEqual(Object.keys(retained.outputItems), ['live']);
  for (const items of [[live, { ...live }], [{ ...live, text: 'Conflicting text' }],
    [live, { id: '', type: 'agentMessage', text: 'bad id' }]]) {
    turn.items = items;
    await assert.rejects(adapter.reconcile(input.attemptId));
    assert.deepEqual(await journal.get(input.attemptId), retained);
  }
  turn.items = [{ id: 'old', type: 'agentMessage', text: 'Earlier' }, live,
    { id: 'final', type: 'agentMessage', text: 'Later final reply' }];
  const recovered = await adapter.reconcile(input.attemptId);
  assert.deepEqual(recovered.outputPreview, { version: 3, text: 'Later final reply', truncated: false });
});

for (const status of ['failed', 'interrupted']) test(`${status} history does not freeze partial message text`, async t => {
  const { adapter } = await fixture(t);
  await adapter.submit(input);
  adapter.rpc = async () => ({ thread: { id: 'thread-a', turns: [{ id: 'turn-b', status,
    items: [{ id: 'partial', type: 'agentMessage', text: 'unfinished text' }] }] } });
  const recovered = await adapter.reconcile(input.attemptId);
  assert.equal(recovered.nativeOutcome, status);
  assert.equal(recovered.outputPreview, undefined);
  assert.equal(recovered.outputItems, undefined);
});

for (const count of [1024, 1025]) test(`history output limit is atomic at ${count} messages`, async t => {
  const { adapter, journal } = await fixture(t);
  await adapter.submit(input);
  const before = await journal.get(input.attemptId);
  adapter.rpc = async () => ({ thread: { id: 'thread-a', turns: [{ id: 'turn-b', status: 'completed',
    items: Array.from({ length: count }, (_, id) => ({ id: `message-${id}`, type: 'agentMessage', text: `Reply ${id}` })) }] } });
  if (count === 1025) {
    await assert.rejects(adapter.reconcile(input.attemptId), { code: 'OUTPUT_TRACKING_LIMIT' });
    assert.deepEqual(await journal.get(input.attemptId), before);
  } else {
    const recovered = await adapter.reconcile(input.attemptId);
    assert.deepEqual(recovered.outputPreview, { version: 1024, text: 'Reply 1023', truncated: false });
    assert.equal(Object.keys(recovered.outputItems).length, 1024);
  }
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

for (const child of [false, true]) test(`exact ${child ? 'child' : 'root'} command history recovers missed exits without adopting other work`, async t => {
  const { adapter, journal, cwd } = await fixture(t);
  await adapter.submit(input);
  const key = '["child-a","child-turn"]', sibling = '["sibling","child-turn"]';
  const obligations = { commands: { done: 'inProgress', missing: 'inProgress', held: 'inProgress' },
    mcpCalls: { effect: 'inProgress' }, dynamicCalls: { dynamic: 'inProgress' }, fileChanges: { file: 'inProgress' }, webSearches: { search: 'inProgress' } };
  await journal.update(input.attemptId, {
    ...obligations,
    spawns: { spawn: { status: 'completed', receiverThreadIds: ['child-a', 'sibling'] } },
    childTurns: { [key]: 'inProgress', [sibling]: 'inProgress' },
    childObligations: { [key]: obligations, [sibling]: obligations },
  });
  const threadId = child ? 'child-a' : 'thread-a', turnId = child ? 'child-turn' : 'turn-b';
  const command = (id, status) => ({ type: 'commandExecution', id, status });
  let turn = { id: turnId, status: 'inProgress', items: [command('done', 'failed'), command('held', 'inProgress'),
    command('unrecorded', 'completed'), { type: 'mcpToolCall', id: 'effect', status: 'completed' },
    { type: 'dynamicToolCall', id: 'dynamic', status: 'failed' }, { type: 'fileChange', id: 'file', status: 'declined' }, { type: 'webSearch', id: 'search' }] };
  const restored = new CodexAdapter({ cwd, journal: new FileJournal(cwd), rpc: async (method, params) => {
    assert.equal(method, 'thread/read'); assert.deepEqual(params, { threadId, includeTurns: true });
    return { thread: { id: threadId, source: { subAgent: { thread_spawn: { parent_thread_id: 'thread-a' } } },
      turns: [{ id: 'other-turn', status: 'completed', items: [command('missing', 'completed')] }, turn] } };
  } });
  const reconcile = () => child ? restored.reconcileChild(input.attemptId, { threadId, turnId }) : restored.reconcile(input.attemptId);
  const row = await reconcile(), selected = child ? row.childObligations[key] : row;
  assert.deepEqual(selected.commands, { done: 'failed', missing: 'inProgress', held: 'inProgress' });
  assert.deepEqual(selected.mcpCalls, { effect: 'completed' });
  assert.deepEqual(selected.dynamicCalls, { dynamic: 'failed' });
  assert.deepEqual(selected.fileChanges, { file: 'declined' });
  assert.equal(row.effectsSettled, undefined);
  assert.deepEqual(selected.webSearches, { search: 'inProgress' });
  assert.deepEqual(row.childObligations[sibling], obligations);
  if (child) assert.deepEqual(row.commands, obligations.commands);
  else assert.deepEqual(row.childObligations[key], obligations);
  assert.equal(row.rootSettled, false);
  assert.equal(row.childTurns[key], 'inProgress');
  const update = restored.journal.update.bind(restored.journal);
  restored.journal.update = () => assert.fail('Exact history replay must not write');
  assert.deepEqual(await reconcile(), row);
  restored.journal.update = update;
  turn = { ...turn, status: 'completed', items: [command('done', 'failed'), command('held', 'declined')] };
  const terminal = await reconcile();
  assert.equal((child ? terminal.childObligations[key] : terminal).commands.held, 'declined');
  assert.equal(terminal.childTurns[sibling], 'inProgress');
  assert.equal(restored.sleepReadiness().allowed, false);
});

for (const child of [false,true]) test(`restored ${child?'child':'root'} history lookup is linear without losing duplicate or omitted custody`, async t => {
  const {adapter,journal,cwd}=await fixture(t);await adapter.submit(input);
  const key='["child-a","child-turn"]',sibling='["sibling","child-turn"]';
  const ids=[...Array.from({length:64},(_,i)=>`cmd-${i}`),'7','__proto__'];
  const commands=Object.fromEntries([...ids.map(id=>[id,'inProgress']),['omitted','inProgress']]);
  await journal.update(input.attemptId,{commands,effectsSettled:false,
    spawns:{spawn:{status:'completed',receiverThreadIds:['child-a','sibling']}},
    childTurns:{[key]:'inProgress',[sibling]:'inProgress'},
    childObligations:{[key]:{commands},[sibling]:{commands}}});
  const threadId=child?'child-a':'thread-a',turnId=child?'child-turn':'turn-b';
  const items=[...Array.from({length:1024},(_,i)=>({id:`irrelevant-${i}`,type:'futureItem'})),
    {id:7,type:'commandExecution',status:'failed'},
    ...ids.map(id=>({id,type:'commandExecution',status:'completed'})),
    ...Array.from({length:32},(_,i)=>({id:`message-${i}`,type:'agentMessage',text:`Reply ${i}`}))];
  let visits=0;
  const measured=new Proxy(items,{get(target,key,receiver){if(typeof key==='string'&&/^\d+$/.test(key))visits++;return Reflect.get(target,key,receiver);}});
  const restored=new CodexAdapter({cwd,journal:new FileJournal(cwd),rpc:async method=>{
    assert.equal(method,'thread/read');return {thread:{id:threadId,source:{subAgent:{thread_spawn:{parent_thread_id:'thread-a'}}},
      turns:[{id:turnId,status:'completed',items:measured}]}};
  }});
  const reconcile=()=>child?restored.reconcileChild(input.attemptId,{threadId,turnId}):restored.reconcile(input.attemptId);
  const row=await reconcile(),selected=child?row.childObligations[key]:row;
  assert.deepEqual(selected.commands,Object.fromEntries([...ids.map(id=>[id,'completed']),['omitted','inProgress']]));
  assert.deepEqual(selected.outputPreview,{version:32,text:'Reply 31',truncated:false});
  assert.equal(row.effectsSettled,false);assert.deepEqual(row.childObligations[sibling],{commands});
  assert.ok(visits<=items.length*3,`History item visits ${visits} exceed three passes over ${items.length} items`);
  items.push({id:'cmd-63',type:'futureItem'});
  await assert.rejects(reconcile(),{code:'RECONCILIATION_INCOMPLETE'});
  assert.deepEqual(await journal.get(input.attemptId),row);
});

test('invalid command history cannot partially settle a turn or overwrite a newer live observation', async t => {
  const { adapter, journal } = await fixture(t);
  await adapter.submit(input);
  const before = await journal.update(input.attemptId, { commands: { first: 'inProgress', second: 'inProgress' }, mcpCalls: { effect: 'inProgress' } });
  const command = (id, status = 'completed') => ({ id, type: 'commandExecution', status });
  let items;
  adapter.rpc = async () => ({ thread: { id: 'thread-a', turns: [{ id: 'turn-b', status: 'completed', items }] } });
  for (const [bad, code] of [
    [[null, { type: 'agentMessage', text: 'Missing ID' }], 'CODEX_PROTOCOL_ERROR'],
    [[{ id: 'reply', type: 'agentMessage', text: 'Ambiguous' }, { id: 'reply', type: 'futureItem' }], 'RECONCILIATION_INCOMPLETE'],
    [[command('first'), command('second', 'unknown')], 'CODEX_PROTOCOL_ERROR'],
    [[command('first'), { ...command('second'), type: 'mcpToolCall' }], 'CODEX_PROTOCOL_ERROR'],
    [[command('first'), command('second'), command('second')], 'RECONCILIATION_INCOMPLETE'],
    [[command('first'), { id: 'effect', type: 'mcpToolCall', status: 'declined' }], 'CODEX_PROTOCOL_ERROR'],
    [[command('first'), { id: 'effect', type: 'dynamicToolCall', status: 'completed' }], 'CODEX_PROTOCOL_ERROR'],
    [[command('first'), { id: 'effect', type: 'mcpToolCall' }], 'CODEX_PROTOCOL_ERROR'],
    [{}, 'CODEX_PROTOCOL_ERROR'],
  ]) {
    items = bad;
    await assert.rejects(adapter.reconcile(input.attemptId), { code });
    assert.deepEqual(await journal.get(input.attemptId), before);
  }
  let release;
  adapter.rpc = () => new Promise(resolve => { release = resolve; });
  const pending = adapter.reconcile(input.attemptId);
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await adapter.observe(input.attemptId, { method: 'item/completed', params: {
    threadId: 'thread-a', turnId: 'turn-b', item: command('second', 'failed'),
  } });
  release({ thread: { id: 'thread-a', turns: [{ id: 'turn-b', status: 'completed', items: [command('first'), command('second')] }] } });
  await assert.rejects(pending, { code: 'SETTLEMENT_CONFLICT' });
  assert.deepEqual(await journal.get(input.attemptId), { ...before, initialInference: 'completed', commands: { first: 'inProgress', second: 'failed' } });
});
