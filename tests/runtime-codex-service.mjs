import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCodexService } from '../runtime/codex-service.mjs';
import { CODEX_TEXT_ONLY_FEATURES, createCodexTextOnlyProfile, codexTextOnlyProfileSha256 } from '../runtime/codex-text-only.mjs';

function preparedMemory(run_id, selected_model = 'gpt-5.5') {
  const value = { schema_version: 1, run_id, attempt: 1, selected_model, global: '[]', scoped: '[]' };
  return { ...value, sha256: createHash('sha256').update(JSON.stringify(value)).digest('hex') };
}
function memoryContext(payload) {
  return JSON.stringify({ instruction: 'fixture', selected_model: payload.persona_models.bot,
    memories: [], ...(payload.memory_budget ? { memory_budget: payload.memory_budget } : {}) });
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'hehe-service-unit-'));
  const tokenFile = join(directory, 'token'); await writeFile(tokenFile, 'synthetic', { mode: 0o600 });
  const calls = []; let now = Date.now(), failHold = false;
  const transport = new EventEmitter();
  transport.child = { exitCode: null, signalCode: null, kill: () => { transport.child.signalCode = 'SIGKILL'; } };
  transport.initialize = async () => calls.push('initialize');
  transport.close = () => { transport.child.exitCode = 0; transport.emit('disconnect'); };
  transport.request = async (method, params) => {
    calls.push({ method, params });
    if (method === 'thread/start') return { thread: { id: 'native-thread' } };
    if (method === 'turn/start') {
      transport.emit('notification', { method: 'turn/started', params: { threadId: 'native-thread', turn: { id: 'native-turn', status: 'inProgress' } } });
      return { turn: { id: 'native-turn' } };
    }
    throw Error('unexpected native RPC');
  };
  const config = { disposableTest: true, stateDirectory: directory, runtimeTokenFile: tokenFile,
    portalOrigin: 'https://fixture.invalid/', binary: '/synthetic/codex', installationId: 'fixture',
    personas: { bot: { agentId: 'assistant', model: 'gpt-5.5', allowedTools: ['hehebot_list_routines'] } } };
  const dependencies = {
    tasks: { hold: async value => { calls.push('hold'); if (failHold) throw Error('private'); return { name: value.id, expiresAt: value.expiresAt }; },
      release: async () => assert.fail('must not release unverified activity') },
    now: () => now, operations: async () => [], checkVersion: async () => {},
    launch: () => { calls.push('launch'); return transport; },
    control: { request: async (type, payload) => {
      calls.push(type);
      if (type === 'status') return { epoch: 1, phase: 'BOOTING', execution_enabled: true };
      if (type === 'boot') return { epoch: 1, boot_id: payload.boot_id };
      if (type === 'ready' || type === 'submitted') return {};
      if (type === 'heartbeat') return { lease_until: new Date(now + 60000).toISOString(), cancellations: [] };
      if (type === 'steer-pending') return [];
      if (type === 'memory-prepare') return preparedMemory('run', payload.persona_models.bot);
      // G4c: this generic fixture models a single ordinary coordinator run with no
      // queued background task, so the background lane never has anything to
      // claim -- matching a real Worker's nextClaimableRun('background') when no
      // coordinator_task run is queued. Tests exercising the task lane itself use
      // their own dedicated fixture below.
      if (type === 'claim') return payload.lane === 'background' ? null
        : { submission_key: 'run:1', run: { id: 'run', current_attempt: 1, persona_id: 'bot', context_json: memoryContext(payload) } };
      throw Error('unexpected control RPC');
    } },
  };
  const service = createCodexService(config, dependencies);
  t.after(async () => { await service.stop(); await rm(directory, { recursive: true, force: true }); });
  return { config, dependencies, service, calls, transport, directory, advance: ms => { now += ms; }, failHold: () => { failHold = true; } };
}

test('default production gate rejects before disk, provider, control or native activity', async t => {
  const f = await fixture(t);
  const service = createCodexService({ ...f.config, disposableTest: false }, f.dependencies);
  await assert.rejects(service.start(), { code: 'NATIVE_COMPATIBILITY_GATE_BLOCKED' });
  assert.deepEqual(f.calls, []); assert.deepEqual(await readdir(f.directory), ['token']);
});

for (const model of ['gpt-5', 'gpt-5.4', 'gpt-5.5', 'gpt-5-codex']) test(`ordinary service counts a reviewed encoding mapping for ${model}`, async t => {
  const f = await fixture(t);
  f.config.personas.bot.model = model;
  const service = createCodexService(f.config, f.dependencies);
  t.after(() => service.stop());
  const row = await service.start(), budget = JSON.parse(row.claim.run.context_json).memory_budget;
  assert.equal(row.phase, 'running');
  assert.equal(budget.selected_model, model);
  assert.equal(budget.global_tokens, 1); assert.equal(budget.scoped_tokens, 1);
  assert.equal(f.calls.find(call => call.method === 'thread/start').params.model, model);
  await service.stop();
});

test('ordinary memory read grant persists the admitted model and baseline, never a default or mutable selection', async t => {
  const f = await fixture(t);
  f.config.personas.bot.allowedTools = ['hehebot_read_memory'];
  f.config.personas.bot.model = 'gpt-5.4';
  const service = createCodexService(f.config, f.dependencies);
  t.after(() => service.stop());
  f.config.personas.bot.model = 'unreviewed-after-construction';
  const row = await service.start();
  const grant = await service.journal.get(`grant-${row.attemptId}`);
  assert.deepEqual(grant.memoryBudget, { selected_model: 'gpt-5.4', sha256: JSON.parse(row.claim.run.context_json).memory_budget.sha256 });
  assert.deepEqual(grant.allowedTools, ['hehebot_read_memory']);
  const start = f.calls.find(call => call.method === 'thread/start');
  assert.equal(start.params.model, 'gpt-5.4');
  await service.stop();
});

for (const model of ['gpt-5-NOT-A-MODEL', 'gpt-5.5-unreviewed', 'gpt-4', 'GPT-5.5']) test(`ordinary service refuses unmapped ${model} before claim, without prefix fallback`, async t => {
  const f = await fixture(t);
  f.config.personas.bot.model = model;
  const service = createCodexService(f.config, f.dependencies);
  t.after(() => service.stop());
  await assert.rejects(service.start(), { code: 'SERVICE_RECOVERY_REQUIRED' });
  assert.ok(f.calls.includes('memory-prepare'));
  assert.equal(f.calls.includes('claim'), false);
  assert.equal(f.calls.some(call => call.method === 'thread/start'), false);
  assert.equal(await service.journal.get(service.supervisor.bridge.cursor), null);
});

test('ordinary service retains over-budget counts for Worker refusal instead of truncating or skipping preparation', async t => {
  const f = await fixture(t), request = f.dependencies.control.request;
  // Independent tiktoken0.11.0/o200k_base encode_ordinary reference: the text
  // has 5,000 tokens, and this exact JSON bucket has 5,020 including framing.
  const global = JSON.stringify([{ body: { scope: { kind: 'global' }, text: ' x'.repeat(5000), explicit_constraint: true } }]);
  const preparation = { schema_version: 1, run_id: 'run', attempt: 1, selected_model: 'gpt-5.5', global, scoped: '[]' };
  let receipt;
  const service = createCodexService(f.config, { ...f.dependencies, control: { request: async (type, payload) => {
    if (type === 'memory-prepare') return { ...preparation, sha256: createHash('sha256').update(JSON.stringify(preparation)).digest('hex') };
    if (type === 'claim' && payload.lane === 'background') return null; // The task lane claims separately.
    if (type === 'claim') { receipt = payload.memory_budget; return null; } // Worker owns the persisted waiting transition.
    return request(type, payload);
  } } });
  t.after(() => service.stop());
  assert.equal((await service.start()).phase, 'complete');
  assert.equal(receipt.global_tokens, 5020); assert.equal(receipt.scoped_tokens, 1);
  assert.equal(receipt.sha256, createHash('sha256').update(JSON.stringify(preparation)).digest('hex'));
  assert.equal(f.calls.some(call => call.method === 'thread/start'), false);
  await service.stop();
});

test('service validates Access files, carries both headers and persists only per-root file references', async t => {
  const f = await fixture(t);
  const accessClientIdFile = join(f.directory, 'access-id'), accessClientSecretFile = join(f.directory, 'access-secret');
  await writeFile(accessClientIdFile, 'synthetic-client-19\n', { mode: 0o600 });
  await writeFile(accessClientSecretFile, 'synthetic-secret-43\n', { mode: 0o600 });
  const request = f.dependencies.control.request, received = [];
  const service = createCodexService({ ...f.config, accessClientIdFile, accessClientSecretFile }, {
    ...f.dependencies, control: undefined, fetchImpl: async (url, options) => {
      received.push(url);
      assert.equal(new URL(url).origin, 'https://fixture.invalid');
      assert.equal(options.headers['CF-Access-Client-Id'], 'synthetic-client-19');
      assert.equal(options.headers['CF-Access-Client-Secret'], 'synthetic-secret-43');
      assert.equal(options.redirect, 'error');
      return Response.json(await request(new URL(url).pathname.slice('/internal/'.length), JSON.parse(options.body)));
    },
  });
  t.after(() => service.stop());
  await service.start();
  assert.ok(received.includes('https://fixture.invalid/internal/submitted'));
  const launch = f.calls.find(call => call.method === 'thread/start');
  const raw = await readFile(launch.params.config.mcp_servers.hehebot.env.HEHEBOT_AGENT_TOOLS_CONFIG, 'utf8');
  const grant = JSON.parse(raw);
  assert.equal(grant.accessClientIdFile, accessClientIdFile); assert.equal(grant.accessClientSecretFile, accessClientSecretFile);
  assert.doesNotMatch(raw, /synthetic-client-19|synthetic-secret-43/);
  assert.doesNotMatch(JSON.stringify(launch), /synthetic-client-19|synthetic-secret-43/);
  await service.stop();
});

test('service rejects invalid Access configuration before control, journal or native activity', async t => {
  const f = await fixture(t), id = join(f.directory, 'id'), secret = join(f.directory, 'secret');
  await writeFile(id, 'synthetic-id-19', { mode: 0o600 });
  await writeFile(secret, 'first\nsecond', { mode: 0o600 });
  const publicFile = join(f.directory, 'public'); await writeFile(publicFile, 'synthetic-secret-43', { mode: 0o644 });
  for (const fields of [{ accessClientIdFile: id }, { accessClientSecretFile: id },
    { accessClientIdFile: id, accessClientSecretFile: secret },
    { accessClientIdFile: publicFile, accessClientSecretFile: id },
    { accessClientIdFile: 'relative', accessClientSecretFile: id },
    { accessClientIdFile: null, accessClientSecretFile: id },
    { portalOrigin: 'https://fixture.invalid/untrusted', accessClientIdFile: id, accessClientSecretFile: id },
    { accessClientId: 'raw-value', accessClientSecret: 'raw-secret' }]) {
    const service = createCodexService({ ...f.config, ...fields }, f.dependencies);
    await assert.rejects(service.start(), error => ['SERVICE_RECOVERY_REQUIRED', 'INVALID_SERVICE_CONFIGURATION'].includes(error.code));
    assert.deepEqual(f.calls, []);
    assert.equal((await readdir(f.directory)).includes('journal'), false);
  }
});

test('assembly claims before creating a private root grant, binds events before submitted, and retains recovery', async t => {
  const f = await fixture(t), row = await f.service.start();
  assert.equal(row.phase, 'running');
  assert.ok(f.calls.indexOf('hold') < f.calls.indexOf('launch'));
  assert.ok(f.calls.indexOf('memory-prepare') < f.calls.indexOf('claim'));
  assert.deepEqual(JSON.parse(row.claim.run.context_json).memory_budget, {
    schema_version: 1, run_id: 'run', attempt: 1, selected_model: 'gpt-5.5', sha256: preparedMemory('run').sha256,
    tokenizer: 'gpt-tokenizer@4.0.0/o200k_base/ordinary-v1', global_tokens: 1, scoped_tokens: 1,
  });
  assert.ok(f.calls.indexOf('claim') < f.calls.findIndex(call => call.method === 'thread/start'));
  const launch = f.calls.find(call => call.method === 'thread/start');
  const grantPath = launch.params.config.mcp_servers.hehebot.env.HEHEBOT_AGENT_TOOLS_CONFIG;
  const grant = JSON.parse(await readFile(grantPath, 'utf8'));
  assert.equal(grant.runId, 'run'); assert.equal(grant.attempt, 1);
  assert.deepEqual(grant.allowedTools, ['hehebot_list_routines']);
  assert.equal(launch.params.approvalPolicy, 'untrusted');
  const native = await f.service.observe(); assert.equal(native.threadId, 'native-thread');
  f.transport.emit('notification', { method: 'turn/completed', params: { threadId: native.threadId, turn: { id: native.nativeRunId, status: 'completed' } } });
  assert.equal((await f.service.observe()).rootSettled, true);
  await assert.rejects(f.service.supervisor.complete({ attemptId: row.attemptId, nativeRunId: native.nativeRunId, rootSettled: true }), { code: 'NATIVE_SETTLEMENT_INCOMPLETE' });
  await assert.rejects(f.service.supervisor.drain({ state: 'fixture' }), { code: 'SLEEP_DENIED' });
  await f.service.stop();
  assert.equal((await f.service.journal.get('service')).phase, 'recovery');
  assert.equal(f.calls.includes('complete'), false);
  const count = f.calls.length;
  const restored = createCodexService(f.config, f.dependencies);
  await assert.rejects(restored.start(), { code: 'SERVICE_RECOVERY_REQUIRED' });
  assert.equal(f.calls.length, count);
});

for(const search of [false,true])test(`service preserves explicit proposal/search allowlist search=${search}`, async t => {
  const f = await fixture(t);
  const expected=['hehebot_propose_skill',...(search?['hehebot_search_skills']:[])];
  f.config.personas.bot.allowedTools = expected;
  const service = createCodexService(f.config, f.dependencies);
  await service.start();
  const launch = f.calls.find(call => call.method === 'thread/start');
  assert.deepEqual(Object.keys(launch.params.config.mcp_servers.hehebot.tools),expected);
  const grant = JSON.parse(await readFile(launch.params.config.mcp_servers.hehebot.env.HEHEBOT_AGENT_TOOLS_CONFIG, 'utf8'));
  assert.deepEqual(grant.allowedTools, expected);
  await service.stop();
});

test('expired lease or disconnected native fences dispatch without release or replay', async t => {
  const f = await fixture(t); await f.service.start();
  const count = f.calls.length; f.advance(60001);
  await assert.rejects(f.service.maintain(), { code: 'EXECUTOR_FENCED' });
  assert.equal(f.service.phase, 'recovery'); assert.equal(f.calls.length, count);
  await assert.rejects(f.service.supervisor.dispatch(), { code: 'EXECUTOR_FENCED' });
});

test('uncertain provider hold blocks native launch and preserves boot intent', async t => {
  const f = await fixture(t); f.failHold();
  await assert.rejects(f.service.start(), { code: 'SERVICE_RECOVERY_REQUIRED' });
  assert.equal(f.calls.includes('launch'), false);
  assert.equal((await f.service.journal.get('service')).phase, 'recovery');
});

test('shutdown during native preparation cannot later launch or acknowledge readiness', async t => {
  const f = await fixture(t);
  let entered, release;
  const preparing = new Promise(ok => { entered = ok; });
  f.dependencies.prepareNative = () => { entered(); return new Promise(ok => { release = ok; }); };
  const service = createCodexService(f.config, f.dependencies);
  const started = service.start();
  const rejected = assert.rejects(started, { code: 'SERVICE_RECOVERY_REQUIRED' });
  await preparing; await service.stop(); release(); await rejected;
  assert.equal(f.calls.includes('launch'), false); assert.equal(f.calls.includes('ready'), false);
});

test('shutdown during initial file checks cannot later contact control or create boot intent', async t => {
  const f = await fixture(t);
  const started = f.service.start();
  const rejected = assert.rejects(started, { code: 'SERVICE_RECOVERY_REQUIRED' });
  await f.service.stop(); await rejected;
  assert.deepEqual(f.calls, []);
  assert.deepEqual(await readdir(f.directory), ['token']);
});

for (const phase of ['starting', 'running']) test(`shutdown during ${phase} journal write cannot advance startup or report success`, async t => {
  const f = await fixture(t), request = f.dependencies.control.request;
  let entered, release;
  const blocked = new Promise(resolve => { entered = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  f.dependencies.control.request = async (type, payload) => {
    if (type === 'boot') {
      const write = f.service.journal.write.bind(f.service.journal);
      f.service.journal.write = async (id, row) => {
        if (id === 'service' && row.phase === phase) { entered(); await held; }
        return write(id, row);
      };
    }
    return request(type, payload);
  };
  const started = f.service.start();
  const rejected = assert.rejects(started, { code: 'SERVICE_RECOVERY_REQUIRED' });
  await blocked;
  const stopping = f.service.stop();
  release(); await Promise.all([stopping, rejected]);
  assert.equal(f.service.phase, 'recovery');
  assert.equal((await f.service.journal.get('service')).phase, 'recovery');
  if (phase === 'starting') {
    assert.equal(f.calls.includes('hold'), false);
    assert.equal(f.calls.includes('launch'), false);
    assert.equal(f.calls.includes('ready'), false);
  } else {
    assert.equal(f.calls.filter(call => call.method === 'turn/start').length, 1);
    assert.equal(f.transport.child.exitCode, 0);
    assert.equal(f.service.supervisor.phase, 'recovery');
  }
});

for (const phase of ['starting', 'running']) test(`shutdown after ${phase} write resolution still fences the next action`, async t => {
  const f = await fixture(t), request = f.dependencies.control.request;
  f.dependencies.control.request = async (type, payload) => {
    if (type === 'boot') {
      const update = f.service.journal.update.bind(f.service.journal);
      f.service.journal.update = (id, patch) => update(id, patch).then(result => {
        if (id === 'service' && patch.phase === phase) queueMicrotask(() => queueMicrotask(() => { void f.service.stop(); }));
        return result;
      });
    }
    return request(type, payload);
  };
  await assert.rejects(f.service.start(), { code: 'SERVICE_RECOVERY_REQUIRED' });
  await f.service.stop();
  assert.equal(f.service.phase, 'recovery');
  assert.equal((await f.service.journal.get('service')).phase, 'recovery');
  if (phase === 'starting') assert.equal(f.calls.includes('hold'), false);
});

test('native disconnect fences a running service without claiming replacement work', async t => {
  const f = await fixture(t); await f.service.start();
  const count = f.calls.length;
  f.transport.emit('disconnect', { code: 'synthetic EOF' });
  assert.equal(f.service.phase, 'recovery');
  await assert.rejects(f.service.maintain(), { code: 'SERVICE_RECOVERY_REQUIRED' });
  await assert.rejects(f.service.start(), { code: 'SERVICE_ALREADY_STARTED' });
  assert.equal(f.calls.length, count);
});

test('assembly synchronizes exact child mapping before delivering a selected cancellation', async t => {
  const f = await fixture(t), original = f.dependencies.control.request;
  let cancellation = false, registrations = 0;
  f.dependencies.control.request = async (type, payload) => {
    if (type === 'native-child') {
      registrations++;
      assert.equal(payload.child.native_session_key, 'child-thread');
      assert.equal(payload.started, true);
      return { id: 'worker-child', parent_run_id: 'run', persona_id: 'bot', current_attempt: 1, role: 'background', status: 'running' };
    }
    const result = await original(type, payload);
    return type === 'heartbeat' && cancellation ? { ...result, cancellations: ['worker-child'] } : result;
  };
  await f.service.start();
  f.transport.emit('notification', { method: 'item/completed', params: { threadId: 'native-thread', turnId: 'native-turn',
    item: { id: 'spawn', type: 'collabAgentToolCall', tool: 'spawnAgent', status: 'completed', senderThreadId: 'native-thread', receiverThreadIds: ['child-thread'] } } });
  f.transport.emit('notification', { method: 'turn/started', params: { threadId: 'child-thread', turn: { id: 'child-turn', status: 'inProgress' } } });
  await f.service.maintain(); cancellation = true;
  await f.service.maintain(); await f.service.maintain();
  assert.equal(registrations, 1);
  assert.deepEqual(f.calls.filter(call => call.method === 'turn/interrupt'), [{ method: 'turn/interrupt', params: { threadId: 'child-thread', turnId: 'child-turn' } }]);
  assert.equal((await f.service.observe()).childTurns['["child-thread","child-turn"]'], 'inProgress');
});

for (const method of ['turn/steer', 'turn/interrupt']) test(`lease expiry during durable intent fences final ${method} dispatch`, async t => {
  const f = await fixture(t), row = await f.service.start();
  await f.service.adapter.observe(row.attemptId, { method: 'item/completed', params: {
    threadId: 'native-thread', turnId: 'native-turn', item: { id: 'spawn', type: 'collabAgentToolCall',
      tool: 'spawnAgent', status: 'completed', senderThreadId: 'native-thread', receiverThreadIds: ['child-thread'] } } });
  await f.service.adapter.observe(row.attemptId, { method: 'turn/started', params: {
    threadId: 'child-thread', turn: { id: 'child-turn', status: 'inProgress' } } });
  const put = f.service.journal.putIfAbsent.bind(f.service.journal);
  let intent;
  f.service.journal.putIfAbsent = async (key, value) => {
    const result = await put(key, value);
    if (key.startsWith('steer-') || key.startsWith('cancel-child-')) { intent = key; f.advance(60001); }
    return result;
  };
  const target = { threadId: 'child-thread', turnId: 'child-turn' };
  const result = method === 'turn/steer'
    ? await f.service.adapter.steerChild(row.attemptId, target, { commandId: 'command-71', text: 'Synthetic instruction' })
    : await f.service.adapter.cancelChild(row.attemptId, target);
  assert.equal(result.status, 'unknown');
  assert.equal((await f.service.journal.get(intent)).status, 'unknown');
  assert.deepEqual(f.calls.filter(call => call.method === method), []);
  await assert.rejects(f.service.maintain(), { code: 'EXECUTOR_FENCED' });
});

test('assembly delivers explicit steering during maintenance and replays only its durable receipt', async t => {
  const f = await fixture(t), control = f.dependencies.control.request, native = f.transport.request;
  const command = { command_id: '77777777-0000-4000-8000-000000000019', run_id: 'run', attempt: 1,
    native_ref: 'native-turn', text: 'Change the remaining root work' };
  let offered = true, deliveries = 0, reports = 0;
  f.dependencies.control.request = async (type, payload) => {
    if (type === 'steer-pending') {
      assert.deepEqual(payload.targets, [{ run_id: 'run', attempt: 1 }]);
      return offered ? [command] : [];
    }
    if (type === 'steer-result') {
      assert.equal(payload.command_id, command.command_id); assert.equal(payload.status, 'accepted');
      if (++reports === 2) offered = false;
      return { ok: true };
    }
    return control(type, payload);
  };
  f.transport.request = async (method, params) => {
    if (method !== 'turn/steer') return native(method, params);
    deliveries++;
    assert.deepEqual(params, { threadId: 'native-thread', expectedTurnId: 'native-turn',
      input: [{ type: 'text', text: command.text }], clientUserMessageId: command.command_id });
    return { turnId: 'native-turn' };
  };
  await f.service.start();await f.service.maintain();await f.service.maintain();await f.service.maintain();
  assert.equal(deliveries, 1);assert.equal(reports, 2);
  assert.equal((await f.service.observe()).rootSettled, false);
});

test('owner questions are default-off and reject nonboolean configuration before launch', async t => {
  const f = await fixture(t); let launched;
  f.dependencies.launch = options => { launched = options; return f.transport; };
  const service = createCodexService(f.config, f.dependencies); t.after(() => service.stop());
  await service.start();
  assert.equal(launched.onUserInput, undefined); assert.equal(launched.userInputTimeoutMs, undefined);
  for (const ownerQuestions of [null, 1, 'true', {}]) {
    await assert.rejects(createCodexService({ ...f.config, ownerQuestions }, f.dependencies).start(), { code: 'INVALID_SERVICE_CONFIGURATION' });
  }
  await service.stop();
});

test('opt-in question waits for acknowledged admission, takes once, and resolves after root termination', async t => {
  const f = await fixture(t), originalControl = f.dependencies.control.request, native = f.transport.request;
  const runId = '77777777-0000-4000-8000-000000000043';
  const params = { threadId: 'native-thread', turnId: 'native-turn', itemId: 'question-item', isBlocking: false,
    questions: [{ id: 'route', header: 'Route', question: 'Select a route', options: [
      { label: 'West43', description: 'Western route' }, { label: 'East19', description: 'Eastern route' }] }] };
  const expected = { answers: { route: { answers: ['West43'] } } };
  let launched, answer, submitted = false, recorded, takes = 0, resolves = 0;
  // This test exercises owner-question wiring on the coordinator lane only; the
  // background task lane is irrelevant here and this fixture's fake control
  // handler models a single claimable run, not per-lane claim discrimination.
  const service = createCodexService({ ...f.config, ownerQuestions: true, backgroundTaskLane: false }, {
    ...f.dependencies,
    launch: options => { launched = options; return f.transport; },
    control: { request: async (type, payload) => {
      if (type === 'memory-prepare') return preparedMemory(runId);
      if (type === 'claim') return { submission_key: `${runId}:1`, deadline_at: new Date(Date.now() + 600000).toISOString(),
        run: { id: runId, current_attempt: 1, persona_id: 'bot', context_json: memoryContext(payload) } };
      if (type === 'submitted') {
        await new Promise(resolve => setTimeout(resolve, 60)); assert.equal(recorded, undefined); submitted = true; return {};
      }
      if (type === 'question-record') {
        assert.equal(submitted, true); assert.equal(payload.run_id, runId); assert.equal(payload.attempt, 1);
        assert.deepEqual(payload.question.params, params); recorded = payload.question; return { id: recorded.id };
      }
      if (type === 'question-take') {
        takes++; assert.equal(payload.question_id, recorded.id); assert.equal(payload.connection_id, recorded.connection_id);
        return { state: 'response_unknown', answer: expected };
      }
      if (type === 'question-resolve') { resolves++; assert.equal(payload.question_id, recorded.id); return { ok: true }; }
      return originalControl(type, payload);
    } },
  });
  t.after(() => service.stop());
  f.transport.request = async (method, payload) => {
    if (method === 'turn/start') {
      answer = launched.onUserInput(params, { signal: new AbortController().signal, requestId: 71 });
      // Attach immediately so a regression does not become an unhandled rejection.
      answer.catch(() => {});
    }
    return native(method, payload);
  };
  await service.start(); assert.deepEqual(await answer, expected); assert.equal(takes, 1);
  assert.equal(launched.timeoutMs, 10000); assert.equal(launched.userInputTimeoutMs, 300000);
  const questionFile = (await readdir(service.journal.directory)).find(name => name.startsWith('question_'));
  const custody = JSON.parse(await readFile(join(service.journal.directory, questionFile), 'utf8'));
  assert.equal(Date.parse(custody.wait.deadlineAt) - Date.parse(custody.wait.startedAt), 300000);
  const row = await service.journal.get(service.supervisor.bridge.cursor);
  await service.journal.update(row.attemptId, { rootSettled: true, status: 'completed' });
  f.transport.emit('notification', { method: 'serverRequest/resolved', params: { threadId: params.threadId, requestId: 71 } });
  for (let i = 0; i < 100 && resolves === 0; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(resolves, 1); assert.equal(takes, 1);
  await assert.rejects(launched.onUserInput({ ...params, itemId: 'another', threadId: 'unrelated-thread' },
    { signal: new AbortController().signal, requestId: 72 }), { code: 'QUESTION_CALLBACK_STOPPED' });
  await service.stop();
  assert.equal(f.transport.listenerCount('notification'), 0);
  await assert.rejects(launched.onUserInput(params, { signal: new AbortController().signal, requestId: 73 }), { code: 'QUESTION_CALLBACK_REJECTED' });
});

test('maintenance retains old-family coverage and late output after fresh coordinator admission', async t => {
  const f = await fixture(t), request = f.dependencies.control.request;
  const ids = ['77777777-0000-4000-8000-000000000017', '77777777-0000-4000-8000-000000000053'];
  let claims = 0, threads = 0;
  const heartbeats = [], previews = [], releases = [];
  // This test exercises coordinator-lane family retention/sequencing with a
  // fixed two-claim script; the background lane is irrelevant here.
  const service = createCodexService({ ...f.config, backgroundTaskLane: false }, { ...f.dependencies, operations: undefined,
    control: { request: async (type, payload) => {
      if (type === 'memory-prepare') return ids[claims] ? preparedMemory(ids[claims]) : null;
      if (type === 'claim') {
        const id = ids[claims++];
        return id ? { submission_key: `${id}:1`, deadline_at: new Date(Date.now() + 600000).toISOString(),
          run: { id, persona_id: 'bot', current_attempt: 1, updated_at: new Date().toISOString(), context_json: memoryContext(payload) } } : null;
      }
      if (type === 'coordinator-release') { releases.push(payload); return {}; }
      if (type === 'heartbeat') heartbeats.push(payload.operations);
      if (type === 'output-preview') { previews.push(payload); return { accepted: true }; }
      return request(type, payload);
    } },
  });
  t.after(() => service.stop());
  f.transport.request = async (method, params) => {
    if (method === 'thread/start') return { thread: { id: `thread-${++threads}` } };
    if (method === 'turn/start') return { turn: { id: `turn-${threads}` } };
    throw Error(`unexpected ${method}`);
  };
  const first = await service.start();
  f.transport.emit('notification', { method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } });
  const second = await service.maintain();
  assert.equal(second.claim.run.id, ids[1]);
  assert.equal(releases.length, 1); assert.equal(releases[0].run_id, ids[0]);
  const item = { id: 'late-message', type: 'agentMessage', text: 'Old family output 71', phase: 'final_answer' };
  f.transport.emit('notification', { method: 'item/completed', params: { threadId: 'thread-1', turnId: 'turn-1', item } });
  await service.maintain();
  assert.deepEqual([...new Set(heartbeats.at(-1).map(row => row.run_id))], ids);
  assert.deepEqual(heartbeats.at(-1).filter(row => row.status === 'unknown').map(row => row.run_id), ids);
  assert.equal(previews.length, 1); assert.equal(previews[0].run_id, ids[0]);
  assert.equal((await service.observe(first.attemptId)).nativeOutcome, 'completed');
  assert.equal((await service.observe(second.attemptId)).rootSettled, false);
  assert.equal(service.supervisor.idleSince, null);
  await assert.rejects(service.supervisor.drain({ test: 'no false sleep' }), { code: 'SLEEP_DENIED' });
  assert.equal(threads, 2); assert.equal(claims, 2);
  await service.stop();
});

const restrictedReadback = {
  web_search: 'disabled', features: { apps: false, plugins: false, tool_suggest: false,
    image_generation: false, standalone_web_search: false, token_budget: false, sleep_tool: false,
    request_permissions_tool: false, exec_permission_approvals: false },
};

async function hostedFixture(t) {
  const f = await fixture(t), bindingSha256 = '19'.repeat(32);
  const accessClientIdFile = join(f.directory, 'hosted-access-id');
  const accessClientSecretFile = join(f.directory, 'hosted-access-secret');
  await writeFile(accessClientIdFile, 'hosted-id-19\n', { mode: 0o600 });
  await writeFile(accessClientSecretFile, 'hosted-secret-43\n', { mode: 0o600 });
  const nativeHome = join(f.directory, 'hosted-native-home');
  await mkdir(nativeHome, { mode: 0o700 });
  await writeFile(join(nativeHome, 'config.toml'), 'cli_auth_credentials_store = "keyring"\n', { mode: 0o600 });
  const ownerAlpha = { session_id: 'aaaaaaaa-1111-4111-8111-111111111119',
    persona_id: '11111111-1111-4111-8111-111111111119', expires_at: new Date(f.dependencies.now() + 240000).toISOString(),
    max_runs: 1, max_task_seconds: 180 };
  const { disposableTest, ...base } = f.config;
  const config = { ...base, portalOrigin: 'https://hosted-19.invalid/', accessClientIdFile, accessClientSecretFile,
    nativeHome, ownerAlpha, hostedOwnerBindingSha256: bindingSha256, personas: { [ownerAlpha.persona_id]: base.personas.bot } };
  const originalRequest = f.dependencies.control.request, originalRpc = f.transport.request;
  let overrides;
  f.transport.request = async (method, params) => {
    if (method !== 'config/read') return originalRpc(method, params);
    const name = overrides.default_permissions;
    return { config: { ...restrictedReadback, agents: { enabled: false },
      features: { ...restrictedReadback.features, multi_agent: false, multi_agent_v2: false },
      default_permissions: name, permissions: { [name]: overrides[`permissions.${name}`] } } };
  };
  const dependencies = { ...f.dependencies,
    checkVersion: async () => f.calls.push('version'),
    tasks: { ...f.dependencies.tasks, release: async () => { f.calls.push('release'); assert.fail('must retain hosted Task'); } },
    launch: input => { overrides = input.configOverrides; return f.dependencies.launch(input); },
    control: { request: async (type, payload) => {
      if (type === 'status') return { epoch: 0, phase: 'STOPPED', execution_enabled: false,
        owner_alpha: ownerAlpha, owner_binding_sha256: bindingSha256, owner_alpha_hosted: true };
      if (type === 'claim') return { submission_key: 'hosted-run:1', deadline_at: new Date(f.dependencies.now() + 179000).toISOString(),
        run: { id: 'hosted-run', current_attempt: 1, persona_id: ownerAlpha.persona_id,
          role: 'coordinator', context_json: '{"instruction":"hosted fixture 43"}' } };
      return originalRequest(type, payload);
    } } };
  return { ...f, config, dependencies, bindingSha256, ownerAlpha, accessClientIdFile, accessClientSecretFile };
}

async function successorFixture(t) {
  const f = await hostedFixture(t), catalogPath = join(f.directory, 'successor-catalog.json');
  const profileInput = { codexVersion: '0.154.0', model: 'gpt-5.5', catalogPath,
    modelCatalog: { models: [{ slug: 'gpt-5.5', tool_mode: 'direct', experimental_supported_tools: [] }] },
    catalogValidation: 'synthetic-fixture', syntheticFixture: true };
  const profile = createCodexTextOnlyProfile(profileInput);
  await writeFile(catalogPath, JSON.stringify(profile.modelCatalog), { mode: 0o600 });
  f.ownerAlpha.text_only = { profile_version: profile.version, profile_sha256: codexTextOnlyProfileSha256(profile) };
  f.config.personas[f.ownerAlpha.persona_id].allowedTools = [];
  f.config.textOnlyProfile = profileInput;
  f.config.ownerAlphaGeneration = { epoch: 2, boot_id: '22222222-2222-4222-8222-222222222219',
    transition_id: '33333333-3333-4333-8333-333333333319' };
  const rpc = f.transport.request;
  f.transport.request = async (method, params) => {
    const reply = await rpc(method, params);
    if (method === 'config/read') Object.assign(reply.config, { model: profile.model, model_catalog_json: catalogPath,
      skills: { include_instructions: false }, project_doc_max_bytes: 0,
      mcp_servers: {}, features: Object.fromEntries(CODEX_TEXT_ONLY_FEATURES.map(key => [key, false])) });
    return reply;
  };
  const request = f.dependencies.control.request;
  f.dependencies.control.request = async (type, payload) => {
    if (type === 'status') return { epoch: f.config.ownerAlphaGeneration.epoch, phase: 'BOOTING', execution_enabled: false,
      owner_alpha: f.ownerAlpha, owner_alpha_generation: f.config.ownerAlphaGeneration,
      owner_binding_sha256: f.bindingSha256, owner_alpha_hosted: true };
    if (type === 'boot') return { epoch: f.config.ownerAlphaGeneration.epoch, boot_id: payload.boot_id };
    if (type === 'claim') return { text_only: f.ownerAlpha.text_only,
      submission_key: '12345678-1234-4234-8234-123456789abc:1',
      deadline_at: new Date(f.dependencies.now() + 179000).toISOString(), run: {
        id: '12345678-1234-4234-8234-123456789abc', current_attempt: 1, persona_id: f.ownerAlpha.persona_id,
        role: 'coordinator', context_json: '{}', updated_at: new Date(f.dependencies.now()).toISOString() } };
    const result = await request(type, payload);
    return result;
  };
  return f;
}

test('matching hosted text-only successor pins committed generation and reaches native startup', async t => {
  const f = await successorFixture(t), service = createCodexService(f.config, f.dependencies);
  await service.start();
  const intent = await service.journal.get('service');
  assert.deepEqual(intent.ownerAlphaGeneration, f.config.ownerAlphaGeneration);
  assert.equal(intent.bootId, f.config.ownerAlphaGeneration.boot_id);
  assert.deepEqual(intent.identity, { epoch: 2, boot_id: f.config.ownerAlphaGeneration.boot_id });
  assert.equal(f.calls.filter(call => call === 'hold').length, 1);
  assert.equal(f.calls.filter(call => call === 'launch').length, 1);
  assert.equal(f.calls.filter(call => call === 'initialize').length, 1);
  await service.stop();
});

for (const mismatch of ['epoch', 'lifecycle-epoch', 'boot', 'transition', 'policy']) test(`hosted successor refuses mismatched ${mismatch} before hold or native launch`, async t => {
  const f = await successorFixture(t), request = f.dependencies.control.request;
  f.dependencies.control.request = async (type, payload) => {
    const status = await request(type, payload);
    if (type !== 'status') return status;
    if (mismatch === 'policy') status.owner_alpha = { ...status.owner_alpha, max_runs: 2 };
    else if (mismatch === 'lifecycle-epoch') status.epoch = 3;
    else status.owner_alpha_generation = { ...status.owner_alpha_generation,
      ...(mismatch === 'epoch' ? { epoch: 3 } : {}),
      ...(mismatch === 'boot' ? { boot_id: '44444444-4444-4444-8444-444444444419' } : {}),
      ...(mismatch === 'transition' ? { transition_id: '55555555-5555-4555-8555-555555555519' } : {}) };
    return status;
  };
  const configured = structuredClone(f.config.ownerAlphaGeneration);
  const service = createCodexService(f.config, f.dependencies);
  await assert.rejects(service.start(), { code: 'SERVICE_RECOVERY_REQUIRED' });
  assert.equal(f.calls.includes('boot'), false);
  assert.equal(f.calls.includes('hold'), false);
  assert.equal(f.calls.includes('launch'), false);
  assert.deepEqual((await service.journal.get('service')).ownerAlphaGeneration, configured);
});

test('fresh hosted alpha rejects an unexpected successor descriptor without loosening epoch zero', async t => {
  const f = await hostedFixture(t), request = f.dependencies.control.request;
  f.dependencies.control.request = async (type, payload) => {
    const status = await request(type, payload);
    if (type === 'status') status.owner_alpha_generation = { epoch: 2,
      boot_id: '22222222-2222-4222-8222-222222222219', transition_id: '33333333-3333-4333-8333-333333333319' };
    return status;
  };
  const service = createCodexService(f.config, f.dependencies);
  await assert.rejects(service.start(), { code: 'SERVICE_RECOVERY_REQUIRED' });
  assert.equal(f.calls.includes('boot'), false); assert.equal(f.calls.includes('hold'), false);
});

for (const corruption of [null, 'catalog', 'output']) test(`text-only service completes with settled coverage or retains uncertainty: ${corruption}`, async t => {
  const f = await hostedFixture(t), catalogPath = join(f.directory, 'catalog.json');
  const profileInput = { codexVersion: '0.154.0', model: 'gpt-5.5', catalogPath,
    modelCatalog: { models: [{ slug: 'gpt-5.5', tool_mode: 'direct', experimental_supported_tools: [] }] },
    catalogValidation: 'synthetic-fixture', syntheticFixture: true };
  const profile = createCodexTextOnlyProfile(profileInput);
  await writeFile(catalogPath, JSON.stringify(profile.modelCatalog), { mode: 0o600 });
  f.ownerAlpha.text_only = { profile_version: profile.version, profile_sha256: codexTextOnlyProfileSha256(profile) };
  f.config.personas[f.ownerAlpha.persona_id].allowedTools = [];
  const originalRpc = f.transport.request, originalRequest = f.dependencies.control.request;
  const runId = '12345678-1234-4234-8234-123456789abc', completions = [], heartbeats = [];
  let claims = 0;
  f.transport.request = async (method, params) => {
    if (method === 'thread/read') return { thread: { id: 'native-thread', turns: [{ id: 'native-turn', status: 'completed',
      items: [{ id: 'answer', type: 'agentMessage', phase: 'final_answer', text: corruption === 'output' ? 'different' : 'Full exact answer ✓' }] }] } };
    const reply = await originalRpc(method, params);
    if (method === 'config/read') Object.assign(reply.config, { model: profile.model, model_catalog_json: catalogPath,
      skills: { include_instructions: false }, project_doc_max_bytes: 0,
      mcp_servers: {}, features: Object.fromEntries(CODEX_TEXT_ONLY_FEATURES.map(key => [key, false])) });
    return reply;
  };
  const service = createCodexService({ ...f.config, textOnlyProfile: profileInput }, { ...f.dependencies, operations: undefined,
    control: { request: async (type, payload) => {
      if (type === 'claim') return claims++ ? null : { text_only: f.ownerAlpha.text_only, submission_key: `${runId}:1`,
        deadline_at: new Date(f.dependencies.now() + 179000).toISOString(), run: { id: runId, current_attempt: 1,
          persona_id: f.ownerAlpha.persona_id, role: 'coordinator', context_json: '{}', updated_at: new Date(f.dependencies.now()).toISOString() } };
      if (type === 'heartbeat') heartbeats.push(payload.operations);
      if (type === 'output-preview') return { accepted: true };
      if (type === 'coordinator-release') return {};
      if (type === 'complete') { completions.push(payload); return {}; }
      return originalRequest(type, payload);
    } } });
  t.after(() => service.stop());
  await service.start();
  const emit = (method, params) => f.transport.emit('notification', { method, params });
  emit('item/started', { threadId: 'native-thread', turnId: 'native-turn', item: { id: 'answer', type: 'agentMessage' } });
  emit('item/completed', { threadId: 'native-thread', turnId: 'native-turn', item: { id: 'answer', type: 'agentMessage', phase: 'final_answer', text: 'Full exact answer ✓' } });
  emit('turn/completed', { threadId: 'native-thread', turn: { id: 'native-turn', status: 'completed' } });
  if (corruption === 'catalog') await writeFile(catalogPath, '{}', { mode: 0o600 });
  if (corruption) {
    await assert.rejects(service.maintain());
    assert.equal(service.phase, 'recovery'); assert.deepEqual(completions, []);
  } else {
    await service.maintain();
    assert.equal(completions.length, 1);
    assert.deepEqual(completions[0].result, { status: 'completed', text: 'Full exact answer ✓' });
    assert.equal(completions[0].text_only_receipt.profile_sha256, f.ownerAlpha.text_only.profile_sha256);
    assert.ok(heartbeats.at(-1).length >= 2);
    assert.ok(heartbeats.at(-1).every(operation => operation.status === 'settled'));
    assert.ok((await service.supervisor.bridge.families()).every(row => row.phase === 'complete'));
  }
  assert.equal(f.calls.find(call => call.method === 'thread/start').params.config, undefined);
  assert.deepEqual(f.calls.find(call => call.method === 'turn/start').params.environments, []);
  assert.equal((await readdir(join(f.directory, 'journal'))).some(name => name.startsWith('grant-')), false);
  await service.stop();
});

test('hosted owner composition persists its pin before authenticated status and holds before version/native submission', async t => {
  const f = await hostedFixture(t), request = f.dependencies.control.request;
  f.dependencies.control.request = async (type, payload) => {
    if (type === 'status') {
      const persisted = JSON.parse(await readFile(join(f.directory, 'journal', 'service.json'), 'utf8'));
      assert.deepEqual(persisted.hostedOwner, { bindingSha256: f.bindingSha256, origin: 'https://hosted-19.invalid' });
    }
    return request(type, payload);
  };
  const service = createCodexService(f.config, f.dependencies);
  t.after(() => service.stop());
  await service.start();
  assert.ok(f.calls.indexOf('hold') < f.calls.indexOf('version'));
  assert.ok(f.calls.indexOf('version') < f.calls.indexOf('launch'));
  assert.equal(f.calls.filter(call => call === 'hold').length, 1);
  assert.equal(f.calls.filter(call => call.method === 'turn/start').length, 1);
  assert.equal((await service.journal.get('service')).hostedOwner.bindingSha256, f.bindingSha256);
  await assert.rejects(service.supervisor.drain({}), { code: 'SLEEP_DENIED' });
  f.advance(120000);
  await assert.rejects(service.maintain());
  assert.equal(f.calls.filter(call => call === 'hold').length, 1);
  assert.equal(f.calls.filter(call => call.method === 'turn/start').length, 1);
  await service.stop();
  assert.equal(f.calls.includes('release'), false);
});

for (const readback of ['missing', 'mismatch']) test(`hosted owner ${readback} status digest blocks boot, hold and native`, async t => {
  const f = await hostedFixture(t), request = f.dependencies.control.request;
  f.dependencies.control.request = async (type, payload) => type === 'status'
    ? { ...(await request(type, payload)), owner_binding_sha256: readback === 'missing' ? undefined : '43'.repeat(32) }
    : request(type, payload);
  const service = createCodexService(f.config, f.dependencies);
  await assert.rejects(service.start(), { code: 'SERVICE_RECOVERY_REQUIRED' });
  assert.equal(f.calls.includes('boot'), false); assert.equal(f.calls.includes('hold'), false);
  assert.equal(f.calls.includes('version'), false); assert.equal(f.calls.includes('launch'), false);
  assert.equal((await service.journal.get('service')).hostedOwner.bindingSha256, f.bindingSha256);
});

for (const mode of ['missing', 'false', 'local']) test(`hosted handshake rejects ${mode} mode before boot`, async t => {
  const f = await hostedFixture(t), request = f.dependencies.control.request;
  if (mode === 'local') {
    delete f.config.hostedOwnerBindingSha256;
    f.config.portalOrigin = 'https://127.0.0.1:4319/';
  }
  f.dependencies.control.request = async (type, payload) => {
    const result = await request(type, payload);
    if (type === 'status' && mode !== 'local') {
      if (mode === 'missing') delete result.owner_alpha_hosted;
      else result.owner_alpha_hosted = false;
    }
    return result;
  };
  const service = createCodexService(f.config, f.dependencies);
  await assert.rejects(service.start(), { code: 'SERVICE_RECOVERY_REQUIRED' });
  assert.equal(f.calls.includes('boot'), false);
  assert.equal(f.calls.includes('hold'), false);
  assert.equal(f.calls.includes('launch'), false);
});

test('hosted owner validates pin, Access references and Task functions before side effects', async t => {
  const f = await hostedFixture(t);
  const malformed = [
    { hostedOwnerBindingSha256: '19'.repeat(31) }, { hostedOwnerBindingSha256: 'AA'.repeat(32) },
    { hostedOwnerBindingSha256: undefined }, { ownerAlpha: undefined },
    { accessClientIdFile: undefined }, { accessClientSecretFile: undefined },
  ];
  for (const patch of malformed) await assert.rejects(createCodexService({ ...f.config, ...patch }, f.dependencies).start(),
    { code: 'INVALID_SERVICE_CONFIGURATION' });
  for (const tasks of [{ hold: async () => {} }, { release: async () => {} }, undefined])
    await assert.rejects(createCodexService(f.config, { ...f.dependencies, tasks }).start(), { code: 'INVALID_SERVICE_CONFIGURATION' });
  const { hostedOwnerBindingSha256, ...localAlpha } = f.config;
  await assert.rejects(createCodexService(localAlpha, f.dependencies).start(), { code: 'INVALID_SERVICE_CONFIGURATION' });
  assert.deepEqual(f.calls, []);
  assert.equal((await readdir(f.directory)).includes('journal'), false);
});

test('hosted owner captures config across status await and retained journal refuses repeat startup', { timeout: 5000 }, async t => {
  const f = await hostedFixture(t), original = f.dependencies.control.request;
  let releaseStatus, statusArrived;
  const arrived = new Promise(resolve => { statusArrived = resolve; });
  const held = new Promise(resolve => { releaseStatus = resolve; });
  f.dependencies.control.request = async (type, payload) => {
    if (type === 'status') { statusArrived(); await held; return original(type, payload); }
    return original(type, payload);
  };
  const service = createCodexService(f.config, f.dependencies), started = service.start();
  t.after(() => service.stop());
  await arrived;
  f.config.hostedOwnerBindingSha256 = '43'.repeat(32); f.config.portalOrigin = 'https://swapped.invalid/';
  releaseStatus(); await started;
  assert.deepEqual((await service.journal.get('service')).hostedOwner,
    { bindingSha256: f.bindingSha256, origin: 'https://hosted-19.invalid' });
  await service.stop();
  const count = f.calls.length;
  await assert.rejects(createCodexService({ ...f.config, hostedOwnerBindingSha256: f.bindingSha256,
    portalOrigin: 'https://hosted-19.invalid/' }, f.dependencies).start(), { code: 'SERVICE_RECOVERY_REQUIRED' });
  assert.equal(f.calls.length, count);
});

test('failed hosted hold prevents version/native and stop never releases its Task', async t => {
  const f = await hostedFixture(t); f.failHold();
  f.dependencies.checkVersion = async () => f.calls.push('version');
  const service = createCodexService(f.config, f.dependencies);
  await assert.rejects(service.start(), { code: 'SERVICE_RECOVERY_REQUIRED' });
  assert.equal(f.calls.filter(call => call === 'hold').length, 1);
  assert.equal(f.calls.includes('version'), false); assert.equal(f.calls.includes('launch'), false);
  assert.equal(f.calls.includes('release'), false);
});

for (const boundary of ['version', 'prepare']) test(`hosted hold expiry during ${boundary} blocks native launch without reacquiring`, async t => {
  const f = await hostedFixture(t);
  f.dependencies.checkVersion = async () => { if (boundary === 'version') f.advance(120000); };
  f.dependencies.prepareNative = async () => { f.calls.push('prepare'); f.advance(120000); };
  const service = createCodexService(f.config, f.dependencies);
  await assert.rejects(service.start(), { code: 'SERVICE_RECOVERY_REQUIRED' });
  assert.equal(f.calls.includes('prepare'), boundary === 'prepare');
  assert.equal(f.calls.filter(call => call === 'hold').length, 1);
  assert.equal(f.calls.includes('launch'), false); assert.equal(f.calls.includes('release'), false);
});

for (const sleepTool of [false, { enabled: false, mode: 'always_on' }]) test(`restricted service binds exact minimal profile with sleep config ${JSON.stringify(sleepTool)}`, async t => {
  const f = await fixture(t), rpc = f.transport.request;
  const service = createCodexService({ ...f.config, restrictedPermissions: true }, { ...f.dependencies,
    launch: options => {
      assert.deepEqual(options.configOverrides, { web_search: 'disabled',
        ...Object.fromEntries(Object.keys(restrictedReadback.features).map(key => [`features.${key}`, false])) });
      return f.dependencies.launch(options);
    },
    prepareNative: home => writeFile(join(home, 'config.toml'), 'model = "private-provider-canary"\n', { mode: 0o600 }),
  });
  let name;
  f.transport.initialize = async options => assert.deepEqual(options, { experimentalApi: true });
  f.transport.request = async (method, params) => {
    if (method === 'config/read') {
      assert.equal(f.calls.includes('ready'), false);
      const contents = await readFile(join(f.directory, 'codex-home', 'config.toml'), 'utf8');
      name = JSON.parse(contents.split('\n')[0].split(' = ')[1]);
      assert.match(name, /^hehebot-restricted-[a-f0-9]{64}$/);
      assert.ok(contents.includes('[permissions.' + name + '.filesystem]'));
      assert.ok(contents.includes('":minimal" = "read"'));
      return { config: { ...restrictedReadback, features: { ...restrictedReadback.features, sleep_tool: sleepTool }, default_permissions: name, permissions: { [name]: {
        filesystem: { glob_scan_max_depth: null, ':minimal': 'read', [join(f.directory, 'workspace')]: 'read',
          [join(f.directory, 'journal')]: 'deny', [join(f.directory, 'codex-home')]: 'deny', [f.config.runtimeTokenFile]: 'deny' },
        network: { enabled: false },
      } } } };
    }
    if (method === 'thread/start') {
      assert.equal(params.permissions, name); assert.equal(Object.hasOwn(params, 'sandbox'), false);
      assert.equal(params.approvalPolicy, 'untrusted');
      assert.deepEqual(Object.keys(params.config.mcp_servers.hehebot.tools), ['hehebot_list_routines']);
      assert.deepEqual(params.config.mcp_servers.hehebot.enabled_tools, ['hehebot_list_routines']);
    }
    return rpc(method, params);
  };
  try {
    await service.start();
    const custody = await service.journal.get('service');
    assert.equal(custody.permissions.name, name); assert.match(custody.permissions.configSha256, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(JSON.stringify(custody), /private-provider-canary/);
  } finally { await service.stop(); }
});

for (const mismatch of ['network', 'extra-root', 'changed-file', 'hosted-apps', 'sleep-tool', 'sleep-tool-structured', 'extra-mcp']) test(`restricted ${mismatch} refuses native admission`, async t => {
  const f = await fixture(t), rpc = f.transport.request, request = f.dependencies.control.request;
  const service = createCodexService({ ...f.config, restrictedPermissions: true }, f.dependencies);
  f.transport.request = async (method, params) => {
    if (method !== 'config/read') return rpc(method, params);
    const contents = await readFile(join(f.directory, 'codex-home', 'config.toml'), 'utf8');
    const name = JSON.parse(contents.split('\n')[0].split(' = ')[1]);
    return { config: { ...restrictedReadback,
      ...(mismatch === 'hosted-apps' ? { features: { ...restrictedReadback.features, apps: true } } : {}),
      ...(mismatch === 'sleep-tool' ? { features: { ...restrictedReadback.features, sleep_tool: true } } : {}),
      ...(mismatch === 'sleep-tool-structured' ? { features: { ...restrictedReadback.features, sleep_tool: { enabled: true, mode: 'always_on' } } } : {}),
      ...(mismatch === 'extra-mcp' ? { mcp_servers: { generic: { command: '/unapproved' } } } : {}),
      default_permissions: name, permissions: { [name]: {
      filesystem: { ':minimal': 'read', [join(f.directory, 'workspace')]: 'read',
        [join(f.directory, 'journal')]: 'deny', [join(f.directory, 'codex-home')]: 'deny', [f.config.runtimeTokenFile]: 'deny',
        ...(mismatch === 'extra-root' ? { ':root': 'read' } : {}) },
      network: { enabled: mismatch === 'network' },
    } } } };
  };
  f.dependencies.control.request = async (type, payload) => {
    if (type === 'claim' && mismatch === 'changed-file') await writeFile(join(f.directory, 'codex-home', 'config.toml'), 'changed');
    return request(type, payload);
  };
  try {
    await assert.rejects(service.start(), { code: 'SERVICE_RECOVERY_REQUIRED' });
    assert.equal(f.calls.some(call => call.method === 'thread/start'), false);
    assert.equal(f.calls.includes('submitted'), false);
  } finally { await service.stop(); }
});

test('restricted mode rejects mutation tools and malformed options before any startup side effect', async t => {
  const f = await fixture(t);
  for (const config of [
    { ...f.config, restrictedPermissions: 'true' },
    { ...f.config, restrictedPermissions: true, personas: { bot: { ...f.config.personas.bot, allowedTools: ['hehebot_save_routine'] } } },
  ]) await assert.rejects(createCodexService(config, f.dependencies).start(), { code: 'INVALID_SERVICE_CONFIGURATION' });
  assert.deepEqual(f.calls, []);
});

test('service rejects standalone search grants without expanding read-only or alpha tools', async t => {
  const f = await fixture(t);
  for (const allowedTools of [['hehebot_search_skills'], ['hehebot_list_routines', 'hehebot_search_skills']]) {
    const service = createCodexService({ ...f.config, personas: { bot: { ...f.config.personas.bot, allowedTools } } }, f.dependencies);
    await assert.rejects(service.start(), { code: 'INVALID_SERVICE_CONFIGURATION' });
  }
  assert.deepEqual(f.calls, []);
  const hosted = await hostedFixture(t);
  hosted.config.personas[hosted.ownerAlpha.persona_id].allowedTools = ['hehebot_propose_skill', 'hehebot_search_skills'];
  await assert.rejects(createCodexService(hosted.config, hosted.dependencies).start(), { code: 'INVALID_SERVICE_CONFIGURATION' });
  assert.deepEqual(hosted.calls, []);
});

for (const changed of [false, true]) test(`owner alpha reuses config in place, denies drift=${changed}, and never acquires provider hold`, async t => {
  const f = await fixture(t), rpc = f.transport.request, request = f.dependencies.control.request;
  const nativeHome = await mkdtemp(join(tmpdir(), 'hehe-authorized-home-'));
  t.after(() => rm(nativeHome, { recursive: true, force: true }));
  const path = join(nativeHome, 'config.toml'), original = 'cli_auth_credentials_store = "keyring"\n';
  await writeFile(path, original, { mode: 0o600 });
  const ownerAlpha = { session_id: 'aaaaaaaa-1111-4111-8111-111111111111',
    persona_id: '11111111-1111-4111-8111-111111111111', expires_at: new Date(f.dependencies.now() + 240000).toISOString(),
    max_runs: 1, max_task_seconds: 180 };
  const { disposableTest, ...base } = f.config;
  let overrides;
  f.transport.request = async (method, params) => {
    if (method !== 'config/read') return rpc(method, params);
    assert.equal(await readFile(path, 'utf8'), original);
    const name = overrides.default_permissions;
    return { config: { ...restrictedReadback, agents: { enabled: false },
      features: { ...restrictedReadback.features, multi_agent: false, multi_agent_v2: false },
      default_permissions: name, permissions: { [name]: overrides[`permissions.${name}`] } } };
  };
  const service = createCodexService({ ...base, nativeHome, ownerAlpha, portalOrigin: 'https://127.0.0.1:4319/',
    personas: { [ownerAlpha.persona_id]: base.personas.bot } }, {
    ...f.dependencies, tasks: undefined,
    launch: options => { overrides = options.configOverrides; assert.equal(options.home, nativeHome); return f.dependencies.launch(options); },
    control: { request: async (type, payload) => {
      if (type === 'status') return { epoch: 0, phase: 'STOPPED', execution_enabled: false, owner_alpha: ownerAlpha };
      if (type === 'claim') {
        if (changed) await writeFile(path, 'model = "changed"\n', { mode: 0o600 });
        return { submission_key: 'run:1', deadline_at: new Date(f.dependencies.now() + 179000).toISOString(),
          run: { id: 'run', current_attempt: 1, persona_id: ownerAlpha.persona_id,
            role: 'coordinator', context_json: '{"instruction":"fixture"}' } };
      }
      return request(type, payload);
    } },
  });
  try {
    if (changed) {
      await assert.rejects(service.start(), { code: 'SERVICE_RECOVERY_REQUIRED' });
      assert.equal(f.calls.some(call => call.method === 'thread/start'), false);
    } else {
      await service.start();
      assert.equal(service.adapter.testMode, false);
      assert.equal(service.adapter.admissionReadiness().productionVerified, false);
      assert.equal(await readFile(path, 'utf8'), original);
      assert.equal((await service.journal.get('service')).ownerAlpha.session_id, ownerAlpha.session_id);
      assert.equal(f.calls.filter(call => call.method === 'turn/start').length, 1);
      await assert.rejects(service.supervisor.drain({}), { code: 'SLEEP_DENIED' });
    }
    assert.equal(f.calls.includes('hold'), false);
  } finally { await service.stop(); }
});

test('declared shell deadline flows from service config through journal events into emitted heartbeats without granting tools', async t => {
  const f = await fixture(t), request = f.dependencies.control.request;
  const heartbeats = [];
  const attemptDeadline = new Date(f.dependencies.now() + 600000).toISOString();
  const serviceConfig = { ...f.config, shellOperationTimeoutMs: 240000 };
  const service = createCodexService(serviceConfig, { ...f.dependencies, operations: undefined,
    control: { request: async (type, payload) => {
      if (type === 'memory-prepare') return preparedMemory('88888888-0000-4000-8000-0000000000e1');
      if (type === 'claim' && payload.lane === 'background') return null;
      if (type === 'claim') return { submission_key: '88888888-0000-4000-8000-0000000000e1:1', deadline_at: attemptDeadline,
        run: { id: '88888888-0000-4000-8000-0000000000e1', persona_id: 'bot', current_attempt: 1, updated_at: new Date().toISOString(), context_json: memoryContext(payload) } };
      if (type === 'heartbeat') { heartbeats.push(payload.operations); return { lease_until: new Date(f.dependencies.now() + 60000).toISOString(), cancellations: [] }; }
      return request(type, payload);
    } } });
  t.after(() => service.stop());
  // Freeze through composition: later caller mutation never changes the service's deadline.
  serviceConfig.shellOperationTimeoutMs = 120001;
  await service.start();
  const launch = f.calls.find(call => call.method === 'thread/start');
  assert.deepEqual(Object.keys(launch.params.config.mcp_servers.hehebot.tools), ['hehebot_list_routines'],
    'a declared shell deadline grants no tool permission');
  const grant = JSON.parse(await readFile(launch.params.config.mcp_servers.hehebot.env.HEHEBOT_AGENT_TOOLS_CONFIG, 'utf8'));
  assert.deepEqual(grant.allowedTools, ['hehebot_list_routines'],
    'the admitted grant keeps its declared tool surface');
  f.advance(1000);
  const native = await service.observe();
  f.transport.emit('notification', { method: 'item/started', params: { threadId: native.threadId, turnId: native.nativeRunId,
    item: { id: 'shell-op', type: 'commandExecution', status: 'inProgress' } } });
  f.transport.emit('notification', { method: 'item/started', params: { threadId: native.threadId, turnId: native.nativeRunId,
    item: { id: 'mcp-op', type: 'mcpToolCall', status: 'inProgress' } } });
  for (let i = 0; i < 100 && (await service.supervisor.operations()).length < 5; i++)
    await new Promise(resolve => setTimeout(resolve, 10));
  await service.supervisor.heartbeat();
  const startedAt = new Date(f.dependencies.now()).toISOString();
  const operations = heartbeats.at(-1);
  const shell = operations.find(op => op.started_at === startedAt && op.deadline_at === new Date(Date.parse(startedAt) + 240000).toISOString());
  const mcp = operations.find(op => op.started_at === startedAt && op.deadline_at === new Date(Date.parse(startedAt) + 120000).toISOString());
  assert.ok(shell, 'the clocked shell command carries the declared four-minute deadline into the emitted heartbeat');
  assert.ok(mcp, 'a concurrent MCP invocation still carries the two-minute deadline');
  assert.equal(shell.last_progress_at, startedAt, 'a declared deadline never refreshes progress');
  assert.ok(operations.every(op => op.deadline_at <= attemptDeadline),
    'no operation deadline extends past the admitted attempt deadline');
  f.advance(500);
  await service.supervisor.heartbeat();
  assert.deepEqual(heartbeats.at(-1).find(op => op.id === shell.id), { ...shell },
    'a repeated heartbeat replays the identical deadline and progress');
  await assert.rejects(service.supervisor.drain({ state: 'fixture' }), { code: 'SLEEP_DENIED' },
    'unsettled obligations prevent sleep');
  await service.stop();
});

test('service validates the declared shell deadline before any side effect', async t => {
  const f = await fixture(t);
  for (const invalid of [120000, 600001, 1.5, '240000', null, true, Number.NaN]) {
    const service = createCodexService({ ...f.config, shellOperationTimeoutMs: invalid }, f.dependencies);
    await assert.rejects(service.start(), error => ['SERVICE_RECOVERY_REQUIRED', 'INVALID_SERVICE_CONFIGURATION'].includes(error.code),
      `invalid declared deadline ${JSON.stringify(invalid)} must refuse startup`);
    assert.deepEqual(f.calls, []);
    assert.deepEqual(await readdir(f.directory), ['token']);
  }
  for (const valid of [120001, 600000]) {
    // A stopped service's journal row survives for recovery, so each accepted
    // boundary value proves admission on its own pristine state directory.
    const accepted = await fixture(t);
    const service = createCodexService({ ...accepted.config, shellOperationTimeoutMs: valid }, accepted.dependencies);
    await service.start();
    await service.stop();
  }
});

// G4c: a real service composition runs the coordinator lane and the background
// task lane concurrently on one Codex app-server connection -- shared
// native/adapter.rpc/router, per-lane heartbeat, admit()/maintain()/stop()
// driving both, notifications routed by attemptId (already lane-disambiguating).
async function twoLaneFixture(t) {
  const f = await fixture(t);
  f.config.personas.bot.allowedTools = ['hehebot_send_message', 'hehebot_start_task'];
  let threads = 0, claims = { coordinator: [], background: [] }, completions = [];
  const request = f.dependencies.control.request;
  const control = { request: async (type, payload) => {
    const lane = payload?.lane === 'background' ? 'background' : 'coordinator';
    if (type === 'memory-prepare') {
      // memory-prepare carries no lane discriminator (only `claim` does), and
      // service.maintain() always fully resolves the coordinator lane's own
      // dispatch before starting the background lane's -- so whichever queue
      // still has an unconsumed head is the one actually calling right now.
      const next = claims.coordinator[0] ?? claims.background[0];
      return next ? preparedMemory(next.id, payload.persona_models.bot) : null;
    }
    if (type === 'claim') {
      const next = claims[lane].shift();
      if (!next) return null;
      const context = { instruction: next.role === 'background' ? 'run the task' : 'fixture',
        selected_model: payload.persona_models.bot, memories: [],
        ...(next.role === 'background' ? { coordinator_task: true } : {}),
        ...(payload.memory_budget ? { memory_budget: payload.memory_budget } : {}) };
      return { submission_key: `${next.id}:1`, run: { id: next.id, current_attempt: 1, persona_id: 'bot',
        role: next.role, ...(next.parent ? { parent_run_id: next.parent } : {}), context_json: JSON.stringify(context) } };
    }
    if (type === 'coordinator-release') return {};
    if (type === 'complete') { completions.push(payload); return {}; }
    return request(type, payload);
  } };
  f.transport.request = async (method, params) => {
    f.calls.push({ method, params });
    if (method === 'thread/start') return { thread: { id: `thread-${++threads}` } };
    if (method === 'turn/start') {
      const threadId = params.threadId;
      f.transport.emit('notification', { method: 'turn/started', params: { threadId, turn: { id: `turn-${threadId}`, status: 'inProgress' } } });
      return { turn: { id: `turn-${threadId}` } };
    }
    throw Error(`unexpected native RPC ${method}`);
  };
  const service = createCodexService(f.config, { ...f.dependencies, control });
  // This fixture layers a second, independently driven service on the same
  // temp directory as the base fixture's own (never-started) service; the base
  // fixture's own teardown (`rm(directory, ...)`) can race this service's final
  // stop() write, so cleanup errors here are immaterial to the test's assertions.
  t.after(() => service.stop().catch(() => {}));
  const queueCoordinator = id => claims.coordinator.push({ id, role: 'coordinator' });
  const queueTask = (id, parent) => claims.background.push({ id, role: 'background', parent });
  return { ...f, service, queueCoordinator, queueTask, completions };
}

test('G4c: coordinator turn starts a task claimed on the background lane in its own thread while the coordinator lane stays free', async t => {
  const f = await twoLaneFixture(t);
  f.queueCoordinator('coord-1');
  const first = await f.service.start();
  assert.equal(first.claim.run.id, 'coord-1');
  // The background lane starts idle: nothing queued, so it claims nothing.
  assert.ok(f.service.taskSupervisor, 'the ordinary non-alpha path gets a background task lane');
  assert.equal(f.service.taskSupervisor.phase, 'running');
  const coordThread = (await f.service.observe()).threadId;

  // Simulate the coordinator's turn calling hehebot_start_task: a task run
  // becomes claimable on the background lane.
  f.queueTask('task-1', 'coord-1');
  await f.service.maintain();
  const taskRow = (await f.service.taskSupervisor.bridge.families()).at(-1);
  assert.equal(taskRow.claim.run.id, 'task-1');
  assert.equal(taskRow.claim.run.role, 'background');
  const taskNative = await f.service.observe(taskRow.attemptId);
  assert.notEqual(taskNative.threadId, coordThread, 'the task runs in its own isolated native thread, never the coordinator\'s');

  // The task's own grant excludes coordinator-only task-management tools but
  // keeps hehebot_send_message, and carries task_guidance, not coordinator_guidance.
  const taskThreadStart = f.calls.filter(call => call.method === 'thread/start').at(-1);
  const taskTurnStart = f.calls.filter(call => call.method === 'turn/start').at(-1);
  const grant = JSON.parse(await readFile(taskThreadStart.params.config.mcp_servers.hehebot.env.HEHEBOT_AGENT_TOOLS_CONFIG, 'utf8'));
  assert.deepEqual(grant.allowedTools, ['hehebot_send_message']);
  const taskMessage = JSON.parse(taskTurnStart.params.input[0].text);
  assert.ok(taskMessage.task_guidance, 'the task thread carries task-executor guidance');
  assert.equal(taskMessage.coordinator_guidance, undefined);

  // Capacity: while task-1 is active, a second background claim is refused
  // (nothing more is even offered by this fixture's script), and the running
  // coordinator lane is unaffected by the background lane being busy.
  f.queueCoordinator('coord-2');
  f.transport.emit('notification', { method: 'turn/completed', params: { threadId: coordThread, turn: { id: `turn-${coordThread}`, status: 'completed' } } });
  const second = await f.service.maintain();
  assert.equal(second.claim.run.id, 'coord-2', 'the coordinator lane claims a fresh owner message while the task is still running');
  assert.equal(f.service.taskSupervisor.phase, 'running', 'the background lane is untouched by coordinator release/re-claim');

  // The task completes: settled directly by the trusted native reconciler path,
  // exactly like the coordinator's own bridge.complete() (see execution-bridge.mjs).
  const completed = await f.service.taskSupervisor.complete({ attemptId: taskRow.attemptId, nativeRunId: taskNative.nativeRunId,
    rootSettled: true, toolsSettled: true, childrenSettled: true, effectsSettled: true, outputCommitted: true,
    result: { status: 'completed', text: 'Task finished' } });
  assert.equal(completed.phase, 'complete');
  assert.equal(completed.result.text, 'Task finished');

  // Task.event + coordinator wake: once complete, the Worker's own ControlCore
  // enqueues a wake; here we just prove the coordinator lane keeps claiming
  // independently of the (now idle) background lane's own state.
  f.queueCoordinator('coord-3');
  const secondThread = (await f.service.observe(second.attemptId)).threadId;
  f.transport.emit('notification', { method: 'turn/completed', params: { threadId: secondThread, turn: { id: `turn-${secondThread}`, status: 'completed' } } });
  const third = await f.service.maintain();
  assert.equal(third.claim.run.id, 'coord-3', 'coordinator wake claim succeeds after the task lane settles');
});

test('G4c: stop() stops both lanes and each lane keeps its own heartbeat cadence', async t => {
  const f = await twoLaneFixture(t);
  f.queueCoordinator('coord-1');
  await f.service.start();
  assert.equal(f.service.supervisor.phase, 'running');
  assert.equal(f.service.taskSupervisor.phase, 'running');
  const coordinatorLease = f.service.supervisor.leaseUntil, taskLease = f.service.taskSupervisor.leaseUntil;
  assert.ok(coordinatorLease > 0); assert.ok(taskLease > 0);
  f.advance(1000);
  await f.service.maintain();
  // Each lane renews its own lease independently on the shared heartbeat channel.
  assert.ok(f.service.supervisor.leaseUntil >= coordinatorLease);
  assert.ok(f.service.taskSupervisor.leaseUntil >= taskLease);
  await f.service.stop();
  assert.equal(f.service.supervisor.phase, 'recovery');
  assert.equal(f.service.taskSupervisor.phase, 'recovery');
  assert.throws(() => f.service.supervisor.assertLease(), { code: 'EXECUTOR_FENCED' });
  assert.throws(() => f.service.taskSupervisor.assertLease(), { code: 'EXECUTOR_FENCED' });
});
