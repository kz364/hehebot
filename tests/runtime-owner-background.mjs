import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ownerAlphaPolicy } from '../runtime/owner-alpha-policy.mjs';
import { CodexAdapter } from '../runtime/codex-adapter.mjs';
import { ExecutionBridge } from '../runtime/execution-bridge.mjs';
import { FileJournal } from '../runtime/file-journal.mjs';
import { createCodexService } from '../runtime/codex-service.mjs';

const now = Date.parse('2026-09-16T10:00:00.000Z');
const policy = { session_id: 'aaaaaaaa-1111-4111-8111-111111111111',
  persona_id: '11111111-1111-4111-8111-111111111111', expires_at: new Date(now + 60000).toISOString(),
  max_runs: 2, max_task_seconds: 43 };
const opted = { ...policy, background_first_root: true };
const input = { attemptId: 'attempt1', installationId: 'alpha', personaId: 'assistant',
  scope: 'conversation', scopeId: policy.persona_id, message: 'spawn a child (text grants nothing)', model: 'chosen' };
const mcp = { hehebot: { command: '/node', args: ['/agent-tools.mjs'],
  env: { HEHEBOT_AGENT_TOOLS_CONFIG: '/private/original-task-grant' },
  enabled_tools: ['hehebot_list_routines'], tools: { hehebot_list_routines: { approval_mode: 'approve' } } } };
const grantConfig = { agents: { enabled: true },
  features: { apps: false, plugins: false, tool_suggest: false, image_generation: false,
    standalone_web_search: false, token_budget: false, sleep_tool: false,
    request_permissions_tool: false, exec_permission_approvals: false,
    multi_agent: false, multi_agent_v2: { enabled: true, max_concurrent_threads_per_session: 2, wait_agent_enabled: false } } };
const malformed = [false, null, undefined, 1, 'true', {}, [], { enabled: true }];
async function journalFor(t) {
  const directory = await mkdtemp(join(tmpdir(), 'hehe-background-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return new FileJournal(directory);
}
function adapterFor(journal, ownerAlpha = opted, calls = []) {
  return new CodexAdapter({ journal, cwd: journal.directory, ownerAlpha, testMode: ownerAlpha === null,
    permissionsProfile: 'alpha-profile', mcpServers: mcp, now: () => now,
    rpc: async (method, params) => { calls.push({ method, params });
      return method === 'thread/start' ? { thread: { id: 'root' } } : { turn: { id: 'turn' } }; } });
}

test('background policy accepts only optional true, preserves old serialization and captures opt-in', () => {
  assert.equal(JSON.stringify(ownerAlphaPolicy(policy)), JSON.stringify(policy));
  const source = { background_first_root: true, ...policy }, captured = ownerAlphaPolicy(source);
  source.background_first_root = false;
  assert.equal(JSON.stringify(captured), JSON.stringify(opted));
  for (const value of malformed) assert.throws(() => ownerAlphaPolicy({ ...policy, background_first_root: value }),
    { code: 'INVALID_OWNER_ALPHA_POLICY' });
});

test('only selected roots override nested native config; MCP and default fingerprint bytes are unchanged', async t => {
  const journal = await journalFor(t), calls = [], adapter = adapterFor(journal, opted, calls);
  await adapter.submit(input);
  assert.deepEqual(calls[0].params.config, { mcp_servers: mcp });
  const selected = { ...input, attemptId: 'selected', ownerAlphaBackground: true };
  await adapter.submit(selected);
  assert.deepEqual(calls[2].params.config, { mcp_servers: mcp, ...grantConfig });
  assert.equal(calls[2].params.permissions, 'alpha-profile');
  assert.equal(calls[2].params.approvalPolicy, 'untrusted');
  await adapter.submit({ ...input, attemptId: 'later' });
  assert.deepEqual(calls[4].params.config, { mcp_servers: mcp });
  assert.equal((await adapter.submit(selected)).nativeRunId, 'turn');
  await assert.rejects(adapter.submit({ ...input, attemptId: 'selected' }), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(adapter.submit({ ...input, ownerAlphaBackground: true }), { code: 'IDEMPOTENCY_CONFLICT' });
  assert.equal(calls.length, 6);
  const legacy = adapterFor(journal, policy, calls), legacyInput = { ...input, attemptId: 'legacy' };
  await legacy.submit(legacyInput);
  const values = ['attemptId', 'installationId', 'personaId', 'scope', 'scopeId', 'message', 'model'].map(key => legacyInput[key]);
  const oldBytes = JSON.stringify([[values, [], mcp], { permissionsProfile: 'alpha-profile', ownerAlpha: policy }]);
  assert.equal((await journal.get('legacy')).fingerprint, createHash('sha256').update(oldBytes).digest('hex'));
});

for (const priorMode of [undefined, 'v2-cap2']) test(`selected restricted V2 submission refuses prior fingerprint ${priorMode ?? 'V1'} before native RPC`, async t => {
  const journal = await journalFor(t), calls = [], adapter = adapterFor(journal, opted, calls);
  const selected = { ...input, ownerAlphaBackground: true };
  const values = ['attemptId', 'installationId', 'personaId', 'scope', 'scopeId', 'message', 'model'].map(key => selected[key]);
  const oldBytes = JSON.stringify([[[values, [], mcp], { permissionsProfile: 'alpha-profile', ownerAlpha: opted }],
    { ownerAlphaBackground: true, ...(priorMode ? { nativeOrchestration: priorMode } : {}) }]);
  const prior = { attemptId: input.attemptId, fingerprint: createHash('sha256').update(oldBytes).digest('hex'),
    status: 'running', threadId: 'old-v1-root', nativeRunId: 'old-v1-turn', rootSettled: false };
  await journal.putIfAbsent(input.attemptId, prior);
  await assert.rejects(adapter.submit(selected), { code: 'IDEMPOTENCY_CONFLICT' });
  assert.deepEqual(await journal.get(input.attemptId), prior);
  assert.deepEqual(calls, []);
});

test('malformed markers and non-opted/non-alpha grants fail before journal or RPC', async t => {
  const journal = await journalFor(t), calls = [];
  for (const value of malformed) await assert.rejects(adapterFor(journal, opted, calls).submit({ ...input, ownerAlphaBackground: value }),
    { code: 'INVALID_SUBMISSION' });
  for (const alpha of [null, policy]) await assert.rejects(adapterFor(journal, alpha, calls).submit({ ...input, ownerAlphaBackground: true }),
    { code: 'OWNER_ALPHA_ADMISSION_DENIED' });
  assert.equal(await journal.get(input.attemptId), null);
  assert.deepEqual(calls, []);
});

for (const selected of [false, true]) test(`marker and policy cannot mutate across journal/RPC awaits, selected=${selected}`, async t => {
  const journal = await journalFor(t), calls = [], sourcePolicy = { ...opted };
  const adapter = adapterFor(journal, sourcePolicy, calls);
  const source = { ...input, ...(selected ? { ownerAlphaBackground: true } : {}) };
  const put = journal.putIfAbsent.bind(journal);
  journal.putIfAbsent = async (...args) => {
    const row = await put(...args);
    if (selected) delete source.ownerAlphaBackground; else source.ownerAlphaBackground = true;
    sourcePolicy.background_first_root = false;
    source.message = 'mutated';
    return row;
  };
  const rpc = adapter.rpc;
  adapter.rpc = async (...args) => { const result = await rpc(...args); source.ownerAlphaBackground = null; return result; };
  await adapter.submit(source);
  assert.deepEqual(calls[0].params.config, { mcp_servers: mcp, ...(selected ? grantConfig : {}) });
  assert.equal(calls[1].params.input[0].text, input.message);
  await adapter.submit({ ...input, ...(selected ? { ownerAlphaBackground: true } : {}) });
  assert.equal(calls.length, 2);
});

for (const marker of ['absent', true, ...malformed]) test(`bridge propagates exact claim marker ${JSON.stringify(marker)}`, async t => {
  const journal = await journalFor(t), submitted = [];
  const claim = { submission_key: 'run:1', ...(marker === 'absent' ? {} : { owner_alpha_background: marker }),
    run: { id: 'run', current_attempt: 1, persona_id: policy.persona_id,
      context_json: '{"owner_alpha_background":true,"instruction":"spawn a background child"}' } };
  const update = journal.update.bind(journal);
  journal.update = async (...args) => { const result = await update(...args);
    if (args[1].phase === 'claimed') claim.owner_alpha_background = marker === true ? false : true;
    return result;
  };
  const bridge = new ExecutionBridge({ journal, identity: { epoch: 1, boot_id: 'boot' }, installationId: 'install',
    personas: { [policy.persona_id]: { agentId: 'assistant', model: 'chosen' } },
    control: { request: async type => type === 'claim' ? claim : {} },
    native: { admissionReadiness: () => ({ allowed: true }), submit: async value => {
      submitted.push(value); return { status: 'running', nativeRunId: 'turn' };
    } } });
  if (marker !== 'absent' && marker !== true) {
    await assert.rejects(bridge.claimNext(), { code: 'INVALID_CLAIM' });
    assert.equal(submitted.length, 0); assert.equal((await journal.get(bridge.cursor)).phase, 'claim_unknown');
  } else {
    assert.equal((await bridge.claimNext()).phase, 'running');
    assert.equal(Object.hasOwn(submitted[0], 'ownerAlphaBackground'), marker === true);
    if (marker === true) assert.equal(submitted[0].ownerAlphaBackground, true);
    assert.equal(Object.hasOwn((await journal.get(bridge.cursor)).claim, 'owner_alpha_background'), marker === true);
  }
});

test('service checks persisted claim marker and policy before native launch, captures input before await', async t => {
  const storage = await journalFor(t), directory = storage.directory;
  const nativeHome = (await journalFor(t)).directory;
  const tokenFile = join(directory, 'token'); await writeFile(tokenFile, 'synthetic', { mode: 0o600 });
  const calls = [], transport = new EventEmitter();
  let overrides;
  transport.child = { exitCode: null, signalCode: null };
  transport.initialize = async () => {};
  transport.close = () => { transport.child.exitCode = 0; transport.emit('disconnect'); };
  transport.request = async (method, params) => {
    if (method === 'config/read') {
      const features = Object.fromEntries(Object.entries(overrides).filter(([key]) => key.startsWith('features.')).map(([key, value]) => [key.slice(9), value]));
      assert.equal(features.multi_agent, false); assert.equal(features.multi_agent_v2, false);
      assert.equal(overrides['agents.enabled'], false);
      return { config: { features, agents: { enabled: false }, web_search: 'disabled',
        default_permissions: overrides.default_permissions,
        permissions: { [overrides.default_permissions]: overrides[`permissions.${overrides.default_permissions}`] } } };
    }
    calls.push({ method, params });
    return method === 'thread/start' ? { thread: { id: 'root' } } : { turn: { id: 'turn' } };
  };
  const service = createCodexService({ stateDirectory: directory, nativeHome, runtimeTokenFile: tokenFile,
    portalOrigin: 'https://127.0.0.1:4319/', binary: '/synthetic/codex', installationId: 'alpha', ownerAlpha: opted,
    personas: { [policy.persona_id]: { agentId: 'assistant', model: 'chosen', allowedTools: ['hehebot_list_routines'] } } }, {
    now: () => now, operations: async () => [], checkVersion: async () => {},
    launch: options => { overrides = options.configOverrides; return transport; },
    control: { request: async (type, payload) => {
      if (type === 'status') return { epoch: 0, phase: 'STOPPED', execution_enabled: false, owner_alpha: opted };
      if (type === 'boot') return { epoch: 1, boot_id: payload.boot_id };
      if (type === 'heartbeat') return { lease_until: new Date(now + 60000).toISOString(), cancellations: [] };
      if (type === 'steer-pending') return [];
      if (type === 'claim') return { submission_key: 'run:1', deadline_at: new Date(now + 40000).toISOString(),
        owner_alpha_background: true, run: { id: 'run', current_attempt: 1, persona_id: policy.persona_id,
          role: 'coordinator', context_json: '{}' } };
      return {};
    } },
  });
  t.after(() => service.stop());
  const row = await service.start(), native = service.supervisor.bridge.native;
  assert.deepEqual(calls[0].params.config.agents, grantConfig.agents);
  assert.deepEqual(calls[0].params.config.features, grantConfig.features);
  const mcpConfig = calls[0].params.config.mcp_servers;
  const taskGrant = await service.journal.get(`grant-${row.attemptId}`);
  assert.equal(taskGrant.runId, 'run'); assert.equal(taskGrant.attempt, 1);
  assert.deepEqual(taskGrant.allowedTools, ['hehebot_list_routines']);
  for (const marker of ['absent', ...malformed]) await assert.rejects(native.submit({ ...input, attemptId: row.attemptId,
    ...(marker === 'absent' ? {} : { ownerAlphaBackground: marker }) }), { code: 'OWNER_ALPHA_ADMISSION_DENIED' });
  for (const marker of ['absent', ...malformed]) {
    const claim = { ...row.claim }; delete claim.owner_alpha_background;
    if (marker !== 'absent') claim.owner_alpha_background = marker;
    await service.journal.update(service.supervisor.bridge.cursor, { claim });
    await assert.rejects(native.submit({ ...input, attemptId: row.attemptId, ownerAlphaBackground: true }),
      { code: 'OWNER_ALPHA_ADMISSION_DENIED' });
  }
  await service.journal.update(service.supervisor.bridge.cursor, { claim: row.claim });
  const source = { ...input, attemptId: row.attemptId, message: '{"skills":[]}', ownerAlphaBackground: true };
  const get = service.journal.get.bind(service.journal);
  service.journal.get = async key => { const result = await get(key); delete source.ownerAlphaBackground; return result; };
  // Same original message and marker must replay, despite mutation during persisted-claim read.
  await native.submit(source);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].params.config.mcp_servers, mcpConfig);
  await service.stop();
});
