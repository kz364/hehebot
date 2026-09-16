#!/usr/bin/env node
// Credential-free prerequisite only: pinned native behavior with scripted loopback inference.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { spawnCodex } from '../runtime/codex-transport.mjs';
import { CodexAdapter } from '../runtime/codex-adapter.mjs';
import { CodexEventRouter } from '../runtime/codex-events.mjs';
import { CodexOperations } from '../runtime/codex-operations.mjs';
import { FileJournal } from '../runtime/file-journal.mjs';

assert.ok(process.argv.slice(2).every(arg => ['--v2-model-catalog', '--terminal-root-mailbox'].includes(arg)), 'UNKNOWN_FIXTURE_ARGUMENT');
const v2ModelCatalog = process.argv.includes('--v2-model-catalog');
const terminalRootMailbox = process.argv.includes('--terminal-root-mailbox');
assert.ok(!terminalRootMailbox || v2ModelCatalog, 'TERMINAL_ROOT_MAILBOX_REQUIRES_V2_MODEL_CATALOG');
const binary = resolve(import.meta.dirname, '../.local/codex-runtime/node_modules/.bin/codex');
const directory = await mkdtemp(join(tmpdir(), 'hehe-owner-background-v2-'));
const home = join(directory, 'home');
const workspace = join(directory, 'workspace');
const privateHome = join(directory, 'private-home');
const journal = join(directory, 'journal');
const token = join(directory, 'token');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const marker = value => `OWNER_BACKGROUND_${value}`;
const raw = { requests: [], notifications: [], failures: [] };
const report = { status: 'failed', codex: null, pinnedSourceCommit: '6b9826e3aa83b1a5947db50f4332cb9c65f1b340',
  externalModelCalls: 0, realAuth: false, providerIntegration: false, productionReady: false,
  appServerGlobalChildCapProved: false, toolEffectSettlementProved: false,
  modelIndependentDepthBoundProved: false, logicalChildCountBoundProved: false,
  mode: terminalRootMailbox ? 'terminal-root-mailbox' : v2ModelCatalog ? 'v2-model-catalog' : 'default',
  scope: v2ModelCatalog ? 'Synthetic V2-capable model: advertised child spawn capacity and sequential idle eviction; no live authorization.' :
    'Default synthetic model: child collaboration tools absent; no model-independent depth claim.' };
let server, transport, router, configPath, originalConfig, modelRequests = 0;
const held = new Map(), active = new Map(), completed = new Map();
const calls = new Map(), pending = new Map(), counts = new Map();
let rootS, childThread, secondChildThread;
report.results = {};
report.modelCalls = [];
const source = 'https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/';
report.pinnedSourceReferences = {
  startupCatalogConfig: `${source}core/config.schema.json#L6636-L6643`,
  catalogLoader: `${source}core/src/config/mod.rs#L2057-L2085`,
  modelMetadata: `${source}protocol/src/openai_models.rs#L400-L505`,
  requiredInstructions: `${source}protocol/src/openai_models.rs#L810-L866`,
  sharedResidency: `${source}core/src/agent/control.rs#L114-L135`,
  spawnResidencyReservation: `${source}core/src/agent/control/spawn.rs#L620-L641`,
  residencyUnloadability: `${source}core/src/agent/control/residency.rs#L233-L239`,
  liveAgentList: `${source}core/src/agent/control.rs#L579-L615`,
  notificationMethods: `${source}app-server-protocol/src/protocol/common.rs#L1882-L1917`,
  activityItem: `${source}app-server-protocol/src/protocol/v2/item.rs#L385-L393`,
  activityKinds: `${source}app-server-protocol/src/protocol/v2/item.rs#L1244-L1259`,
  itemStarted: `${source}app-server-protocol/src/protocol/v2/item.rs#L1321-L1330`,
  itemCompleted: `${source}app-server-protocol/src/protocol/v2/item.rs#L1399-L1408`,
  turnStarted: `${source}app-server-protocol/src/protocol/v2/turn.rs#L492-L504`,
  threadStarted: `${source}app-server-protocol/src/protocol/v2/thread.rs#L1939-L1942`,
  childSource: `${source}protocol/src/protocol.rs#L2822-L2842`,
};

async function wait(predicate, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await predicate(); if (value) return value; await sleep(20); }
  throw new Error(`TIMEOUT_${label}`);
}
function names(body) {
  return body.tools.flatMap(tool => tool.type === 'namespace'
    ? tool.tools.map(nested => `${tool.name}.${nested.name}`) : [tool.name ?? tool.type]);
}
function send(res, output) {
  const response = { id: `resp_${randomUUID()}`, object: 'response', status: 'completed', model: 'fixture-model', output,
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const event = (type, fields) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`);
  event('response.created', { response: { ...response, status: 'in_progress', output: [] } });
  for (const [output_index, item] of output.entries()) {
    event('response.output_item.added', { output_index, item: item.type === 'function_call' ? { ...item, arguments: '' } : { ...item, content: [] } });
    if (item.type === 'function_call') event('response.function_call_arguments.done', { output_index, item_id: item.id, arguments: item.arguments });
    else {
      event('response.content_part.added', { output_index, item_id: item.id, content_index: 0,
        part: { type: 'output_text', text: '', annotations: [] } });
      event('response.output_text.delta', { output_index, item_id: item.id, content_index: 0, delta: item.content[0].text });
      event('response.output_text.done', { output_index, item_id: item.id, content_index: 0, text: item.content[0].text });
      event('response.content_part.done', { output_index, item_id: item.id, content_index: 0, part: item.content[0] });
    }
    event('response.output_item.done', { output_index, item });
  }
  event('response.completed', { response }); res.end('data: [DONE]\n\n');
}
const message = text => [{ id: `msg_${randomUUID()}`, type: 'message', status: 'completed', role: 'assistant',
  content: [{ type: 'output_text', text, annotations: [] }] }];
function call(body, label, name, args, allowMissing = false) {
  const tool = body.tools.find(item => item.name === name || item.tools?.some(nested => nested.name === name));
  if (!allowMissing) assert.ok(tool, `${label}_${name}_NOT_ADVERTISED`);
  const callId = `call_${randomUUID()}`; calls.set(callId, label);
  report.modelCalls.push({ label, name, namespace: typeof allowMissing === 'string' ? allowMissing : tool?.type === 'namespace' ? tool.name : null, args });
  return [{ id: `fc_${randomUUID()}`, type: 'function_call', status: 'completed', call_id: callId,
    ...(typeof allowMissing === 'string' ? { namespace: allowMissing } : tool?.type === 'namespace' ? { namespace: tool.name } : {}), name,
    arguments: JSON.stringify(args) }];
}
function hold(label, res, body = null) {
  assert.equal(held.has(label), false); const row = { res, body, closed: false }; held.set(label, row);
  res.once('close', () => { row.closed = true; });
}
async function interrupt(threadId, turnId) {
  await transport.request('turn/interrupt', { threadId, turnId });
  await wait(() => completed.get(threadId)?.get(turnId) === 'interrupted', `INTERRUPT_${threadId}`);
}

const watchdog = setTimeout(() => {
  raw.failures.push('FIXTURE_DEADLINE'); transport?.close(); server?.closeAllConnections();
}, 90000);
watchdog.unref();
try {
  await Promise.all([mkdir(home, { mode: 0o700 }), mkdir(workspace, { mode: 0o700 }), mkdir(privateHome, { mode: 0o700 })]);
  report.codex = (await promisify(execFile)(binary, ['--version'], { timeout: 10000 })).stdout.trim();
  assert.equal(report.codex, 'codex-cli 0.154.0');
  server = createServer(async (req, res) => {
    try {
      assert.equal(req.method, 'POST'); assert.equal(req.url, '/v1/responses');
      const chunks = []; let bytes = 0;
      for await (const chunk of req) { assert.ok((bytes += chunk.length) <= 2 * 1024 * 1024); chunks.push(chunk); }
      const body = JSON.parse(Buffer.concat(chunks)); raw.requests.push(body); modelRequests++;
      assert.ok(modelRequests <= 40); assert.equal(body.model, 'fixture-model'); assert.equal(body.stream, true);
      const catalog = names(body);
      assert.ok(!catalog.some(name => /web_search|image_generation|mcp|tool_suggest/.test(name)), 'DISABLED_PROVIDER_SURFACE');
      assert.ok(!catalog.some(name => /(^|\.)sleep$/.test(name)), 'SLEEP_TOOL_ADVERTISED');
      const text = JSON.stringify(body.input.filter(item => item.role === 'user' || item.type === 'agent_message'));
      const label = ['CHILD_B', 'CHILD_A', 'ROOT_A', 'ROOT_S'].find(value => text.includes(marker(value)));
      assert.ok(label, 'UNKNOWN_SCRIPTED_REQUEST');
      counts.set(label, (counts.get(label) ?? 0) + 1);
      report[`${label}ToolCatalog`] = catalog;
      assert.ok(!catalog.some(name => /wait_agent|close_agent|send_input|resume_agent/.test(name)), 'LEGACY_OR_WAIT_TOOL_ADVERTISED');
      if (label === 'ROOT_S' || !v2ModelCatalog && label !== 'ROOT_A') {
        assert.ok(!catalog.some(name => /agent|collaboration/.test(name)), 'NON_ROOT_CONTROL_TOOLS');
      } else if (v2ModelCatalog) {
        for (const name of ['spawn_agent', 'send_message', 'followup_task', 'interrupt_agent', 'list_agents']) {
          assert.ok(catalog.includes(`collaboration.${name}`), `${label}_V2_TOOL_MISSING_${name}`);
        }
      }
      if (label === 'ROOT_S') { hold(`ROOT_S_${counts.get(label)}`, res); return; }
      if (label === 'CHILD_B') {
        assert.equal(v2ModelCatalog, true);
        if (counts.get(label) === 1) {
          send(res, call(body, 'secondGrandchild', 'spawn_agent', { task_name: 'grandchild_b', message: 'FORBIDDEN_GRANDCHILD_B', fork_turns: 'none' }));
        } else if (!terminalRootMailbox || counts.get(label) === 2) {
          assert.equal(counts.get(label), 2);
          report.results.secondGrandchild = body.input.filter(item => item.type === 'function_call_output').at(-1)?.output;
          hold('CHILD_B', res, body);
        } else if (counts.get(label) === 3) {
          report.results.terminalRootMessage = body.input.filter(item => item.type === 'function_call_output').at(-1)?.output;
          send(res, call(body, 'terminalRootFollowup', 'followup_task', { target: report.identities.rootA.threadId,
            message: 'MUST_NOT_RESTART_TERMINAL_ROOT' }));
        } else {
          assert.equal(counts.get(label), 4);
          report.results.terminalRootFollowup = body.input.filter(item => item.type === 'function_call_output').at(-1)?.output;
          send(res, message('CHILD_B_NATURAL_DONE'));
        }
        return;
      }
      if (label === 'CHILD_A') {
        if (counts.get(label) === 1) {
          send(res, call(body, 'grandchild', 'spawn_agent', { task_name: 'grandchild', message: 'FORBIDDEN_GRANDCHILD', fork_turns: 'none' }, !v2ModelCatalog));
        } else if (counts.get(label) === 2) {
          report.results.grandchild = body.input.filter(item => item.type === 'function_call_output').at(-1)?.output;
          send(res, call(body, 'grandchildNamespaced', 'spawn_agent', { task_name: 'grandchild', message: 'FORBIDDEN_GRANDCHILD', fork_turns: 'none' }, 'collaboration'));
        } else {
          const output = body.input.filter(item => item.type === 'function_call_output').at(-1);
          if (counts.get(label) === 3) report.results.grandchildNamespaced = output?.output;
          else assert.ok(text.includes('ALLOWED_FOLLOWUP'), 'FOLLOWUP_NOT_DELIVERED_TO_CHILD');
          hold(counts.get(label) === 3 ? 'CHILD_A' : 'CHILD_FOLLOWUP', res);
        }
        return;
      }
      // Root A is driven one model call at a time by the assertions below.
      for (const output of body.input.filter(item => item.type === 'function_call_output')) {
        const id = calls.get(output.call_id);
        if (id) report.results[id] = output.output;
      }
      assert.equal(pending.has('ROOT_A'), false);
      pending.set('ROOT_A', { body, res });
    } catch (error) { raw.failures.push(error.stack); if (!res.headersSent) res.writeHead(500); res.end(); }
  });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const filesystem = { ':minimal': 'read', [workspace]: 'read', [privateHome]: 'deny', [journal]: 'deny', [token]: 'deny' };
  const fileEntries = Object.entries(filesystem).map(([path, mode]) => `${JSON.stringify(path)} = ${JSON.stringify(mode)}`).join('\n');
  const disabled = ['multi_agent', 'multi_agent_v2', 'apps', 'plugins', 'tool_suggest', 'image_generation',
    'standalone_web_search', 'remote_models', 'token_budget', 'sleep_tool', 'request_permissions_tool', 'exec_permission_approvals', 'code_mode', 'code_mode_only'];
  const catalogPath = join(home, 'fixture-models.json');
  if (v2ModelCatalog) {
    // Supported startup config, not a Codex-owned cache/database edit. Required fields follow
    // pinned protocol/src/openai_models.rs ModelInfo; multi_agent_version is public model metadata.
    const catalog = { models: [{ slug: 'fixture-model', display_name: 'Synthetic V2 fixture', description: null,
      supported_reasoning_levels: [], shell_type: 'unified_exec', visibility: 'list', supported_in_api: true,
      priority: 1, upgrade: null, model_messages: { instructions_template: 'Synthetic credential-free native fixture.', instructions_variables: null },
      default_reasoning_summary: 'auto', support_verbosity: false,
      default_verbosity: null, apply_patch_tool_type: null, truncation_policy: { mode: 'bytes', limit: 10000 },
      supports_image_detail_original: false, context_window: 272000, auto_compact_token_limit: null,
      effective_context_window_percent: 95, experimental_supported_tools: [], multi_agent_version: 'v2' }] };
    await writeFile(catalogPath, JSON.stringify(catalog), { mode: 0o600 });
    report.modelCatalog = catalog;
    report.modelCatalogSha256 = sha256(await readFile(catalogPath));
  }
  const config = `model = "fixture-model"\nmodel_provider = "fixture"\nweb_search = "disabled"\ndefault_permissions = "owner-background"\n` +
    (v2ModelCatalog ? `model_catalog_json = ${JSON.stringify(catalogPath)}\n` : '') +
    `[agents]\nenabled = false\n[features]\n${disabled.map(key => `${key} = false`).join('\n')}\n` +
    `[analytics]\nenabled = false\n[feedback]\nenabled = false\n[otel]\nexporter = "none"\ntrace_exporter = "none"\nmetrics_exporter = "none"\n` +
    `[permissions.owner-background.filesystem]\n${fileEntries}\n[permissions.owner-background.network]\nenabled = false\n` +
    `[model_providers.fixture]\nname = "Scripted loopback only"\nbase_url = "http://127.0.0.1:${server.address().port}/v1"\n` +
    `wire_api = "responses"\nrequires_openai_auth = false\nrequest_max_retries = 0\nstream_max_retries = 0\n`;
  configPath = join(home, 'config.toml'); await writeFile(configPath, config, { mode: 0o600 }); originalConfig = await readFile(configPath);
  report.originalConfigSha256 = sha256(originalConfig);
  transport = spawnCodex({ binary, home, cwd: workspace, timeoutMs: 10000 });
  // Observe public JSON-RPC errors without changing transport behavior. This disposable fixture
  // has no private prompts or credentials; path redaction still applies to the final report.
  let protocolBuffer = '';
  transport.child.stdout.on('data', chunk => {
    protocolBuffer += chunk.toString();
    let end;
    while ((end = protocolBuffer.indexOf('\n')) !== -1) {
      const line = protocolBuffer.slice(0, end); protocolBuffer = protocolBuffer.slice(end + 1);
      try { const frame = JSON.parse(line); if (frame.error) (report.nativeRpcErrors ??= []).push(frame.error); } catch { /* transport validates frames */ }
    }
  });
  transport.on('notification', notification => {
    raw.notifications.push(notification);
    if (notification.method === 'turn/started') active.set(notification.params.threadId, notification.params.turn.id);
    if (notification.method === 'turn/completed') {
      active.delete(notification.params.threadId);
      const turns = completed.get(notification.params.threadId) ?? new Map(); turns.set(notification.params.turn.id, notification.params.turn.status);
      completed.set(notification.params.threadId, turns);
    }
  });
  await transport.initialize({ experimentalApi: true });
  const runtimeJournal = new FileJournal(journal);
  const adapter = new CodexAdapter({ journal: runtimeJournal, cwd: workspace,
    rpc: () => assert.fail('Observation integration must not submit or replay inference') });
  const recoveryEvents = [];
  router = new CodexEventRouter({ transport, adapter, onRecovery: value => recoveryEvents.push(value) });
  const effective = (await transport.request('config/read', { includeLayers: false, cwd: workspace })).config;
  if (v2ModelCatalog) {
    assert.equal(effective.model_catalog_json, catalogPath);
    report.modelCatalogConfigReadback = '<disposable>/home/fixture-models.json';
  }
  assert.equal(effective.agents.enabled, false); assert.equal(effective.features.multi_agent, false); assert.equal(effective.features.multi_agent_v2, false);
  for (const key of disabled) assert.equal(effective.features[key], false, key);
  assert.equal(effective.web_search, 'disabled'); assert.equal(effective.default_permissions, 'owner-background');
  assert.deepEqual(effective.permissions['owner-background'].filesystem, { glob_scan_max_depth: null, ...filesystem });
  assert.equal(effective.permissions['owner-background'].network.enabled, false); assert.deepEqual(effective.mcp_servers, {});
  assert.equal(effective.analytics.enabled, false); assert.equal(effective.feedback.enabled, false);
  for (const field of ['exporter', 'trace_exporter', 'metrics_exporter']) assert.equal(effective.otel[field], 'none');
  report.telemetryReadback = { analytics: effective.analytics, feedback: effective.feedback, otel: effective.otel };
  report.defaultConfigReadback = { agents: effective.agents, features: Object.fromEntries(disabled.map(key => [key, effective.features[key]])),
    profile: { name: effective.default_permissions, filesystem: { ':minimal': 'read', '<workspace>': 'read', '<private-home>': 'deny',
      '<journal>': 'deny', '<token>': 'deny', glob_scan_max_depth: null }, network: { enabled: false } }, mcpServers: 0 };
  const start = async (label, configOverride) => {
    const started = await transport.request('thread/start', { cwd: workspace, model: 'fixture-model', modelProvider: 'fixture',
      permissions: 'owner-background', approvalPolicy: 'untrusted', ...(configOverride ? { config: configOverride } : {}) });
    assert.equal(started.approvalPolicy, 'untrusted');
    assert.equal(started.modelProvider, 'fixture'); assert.equal(started.model, 'fixture-model');
    assert.deepEqual(started.sandbox, { type: 'readOnly', networkAccess: false });
    assert.deepEqual(started.activePermissionProfile, { id: 'owner-background', extends: null });
    report[`${label}StartReadback`] = { approvalPolicy: started.approvalPolicy, sandbox: started.sandbox,
      activePermissionProfile: started.activePermissionProfile, model: started.model, modelProvider: started.modelProvider };
    const turn = (await transport.request('turn/start', { threadId: started.thread.id,
      input: [{ type: 'text', text: marker(label) }] })).turn;
    await runtimeJournal.putIfAbsent(label, { attemptId: label, threadId: started.thread.id, nativeRunId: turn.id,
      status: 'running', rootSettled: false });
    await router.bind(label);
    return { threadId: started.thread.id, turnId: turn.id };
  };
  const read = async threadId => (await transport.request('thread/read', { threadId, includeTurns: true })).thread;
  const rootAConfig = { agents: { enabled: true }, features: { multi_agent: false,
    multi_agent_v2: { enabled: true, max_concurrent_threads_per_session: 2, wait_agent_enabled: false } } };
  report.rootAConfigRequested = rootAConfig;
  rootS = await start('ROOT_S');
  await wait(() => held.has('ROOT_S_1'), 'S_ACTIVE');
  const rootA = await start('ROOT_A', rootAConfig);
  report.identities = { rootA, rootS };
  const step = async (label, name, args, allowMissing = false) => {
    const row = await wait(() => pending.get('ROOT_A'), `READY_${label}`);
    pending.delete('ROOT_A'); send(row.res, call(row.body, label, name, args, allowMissing));
    await wait(() => Object.hasOwn(report.results, label), `RESULT_${label}`);
    return report.results[label];
  };
  const spawnResult = JSON.parse(await step('spawn', 'spawn_agent', {
    task_name: 'child_a', message: marker('CHILD_A'), fork_turns: 'none' }));
  assert.equal(spawnResult.task_name, '/root/child_a');
  await wait(() => held.has('CHILD_A'), 'CHILD_ACTIVE');
  childThread = [...active.keys()].find(id => id !== rootA.threadId && id !== rootS.threadId);
  assert.ok(childThread);
  const childTurn = active.get(childThread);
  const childRead = await read(childThread);
  assert.equal(childRead.source.subAgent.thread_spawn.parent_thread_id, rootA.threadId);
  assert.equal(childRead.source.subAgent.thread_spawn.depth, 1);
  report.identities.childA = { threadId: childThread, turnId: childTurn, source: childRead.source };
  assert.equal(report.results.grandchild, v2ModelCatalog ? 'collab spawn failed: agent thread limit reached' : 'unsupported call: spawn_agent');
  assert.equal(report.results.grandchildNamespaced, v2ModelCatalog ? 'collab spawn failed: agent thread limit reached' : 'unsupported call: collaborationspawn_agent');
  assert.equal(await step('secondChild', 'spawn_agent', { task_name: 'second', message: 'FORBIDDEN_SECOND', fork_turns: 'none' }),
    'collab spawn failed: agent thread limit reached');
  const listBefore = JSON.parse(await step('listBefore', 'list_agents', {}));
  assert.deepEqual(listBefore.agents.map(item => item.agent_name).sort(), ['/root', '/root/child_a']);
  const sBefore = await read(rootS.threadId);
  const sEvents = () => raw.notifications.filter(item => item.params?.threadId === rootS.threadId);
  const sEventsBefore = structuredClone(sEvents());
  for (const name of ['send_message', 'followup_task', 'interrupt_agent']) {
    const args = { target: rootS.threadId, ...(name === 'interrupt_agent' ? {} : { message: `FORBIDDEN_${name}` }) };
    assert.equal(await step(`foreign_${name}`, name, args), `agent with id ${rootS.threadId} not found`);
  }
  for (const name of ['close_agent', 'send_input', 'resume_agent']) {
    assert.equal(await step(`v1_${name}`, name, { [name === 'resume_agent' ? 'id' : 'target']: rootS.threadId,
      ...(name === 'send_input' ? { message: 'FORBIDDEN_V1', interrupt: true } : {}) }, true),
      `unsupported call: ${name}`);
  }
  for (const name of ['close_agent', 'send_input', 'resume_agent', 'spawn_agent']) {
    const args = name === 'spawn_agent' ? { message: 'FORBIDDEN_V1_SPAWN' } :
      { [name === 'resume_agent' ? 'id' : 'target']: rootS.threadId,
        ...(name === 'send_input' ? { message: 'FORBIDDEN_V1', interrupt: true } : {}) };
    assert.equal(await step(`v1_namespaced_${name}`, name, args, 'multi_agent_v1'), `unsupported call: multi_agent_v1${name}`);
  }
  const listAfter = JSON.parse(await step('listAfter', 'list_agents', {}));
  assert.deepEqual(listAfter, listBefore);
  assert.deepEqual((await read(rootS.threadId)).turns, sBefore.turns);
  assert.deepEqual(sEvents(), sEventsBefore);
  assert.equal(counts.get('ROOT_S'), 1);
  assert.equal(active.get(rootS.threadId), rootS.turnId);
  assert.equal(held.get('ROOT_S_1').closed, false);
  report.foreignIsolation = { unchangedTurns: true, unchangedEvents: true, requests: 1, stillActive: true, unchangedRegistry: true };
  assert.equal(await step('sameTreeMessage', 'send_message', { target: childThread, message: 'ALLOWED_MESSAGE' }), '');
  assert.equal(active.get(childThread), childTurn);
  assert.equal(counts.get('CHILD_A'), 3);
  // Positive same-tree target: native interrupt must close the child's held inference.
  const positive = JSON.parse(await step('sameTreeInterrupt', 'interrupt_agent', { target: childThread }));
  assert.equal(positive.previous_status, 'running');
  await wait(() => completed.get(childThread)?.get(childTurn) === 'interrupted', 'SAME_TREE_INTERRUPTED');
  await wait(() => held.get('CHILD_A').closed, 'CHILD_HTTP_CLOSED');
  // Start a new authorized child turn to prove independent S response while child inference is active.
  const followup = await step('sameTreeFollowup', 'followup_task', { target: childThread, message: 'ALLOWED_FOLLOWUP' });
  assert.equal(followup, '');
  await wait(() => active.has(childThread), 'CHILD_FOLLOWUP_ACTIVE');
  await wait(() => held.has('CHILD_FOLLOWUP'), 'CHILD_FOLLOWUP_HTTP');
  send(held.get('ROOT_S_1').res, message('ROOT_S_INDEPENDENT'));
  await wait(() => completed.get(rootS.threadId)?.get(rootS.turnId) === 'completed', 'S_INDEPENDENT_COMPLETE');
  assert.ok(active.has(childThread));
  assert.deepEqual((await read(rootS.threadId)).turns[0].items.filter(item => item.type === 'agentMessage').map(item => item.text), ['ROOT_S_INDEPENDENT']);
  report.independentResponse = 'ROOT_S_INDEPENDENT';
  report.scopedFeatures = {};
  for (const [label, id, enabled] of [['rootA', rootA.threadId, true], ['childA', childThread, true], ['rootS', rootS.threadId, false]]) {
    const result = await transport.request('experimentalFeature/list', { threadId: id, limit: 100 });
    const flags = Object.fromEntries(['multi_agent', 'multi_agent_v2'].map(name => [name, result.data.find(item => item.name === name)?.enabled]));
    assert.deepEqual(flags, { multi_agent: false, multi_agent_v2: enabled }); report.scopedFeatures[label] = flags;
  }
  if (v2ModelCatalog) {
    const loaded = async () => {
      const result = await transport.request('thread/loaded/list', { limit: 100 });
      assert.equal(result.nextCursor, null); return result.data.sort();
    };
    const firstFollowupTurn = active.get(childThread);
    send(held.get('CHILD_FOLLOWUP').res, message('CHILD_A_DONE'));
    await wait(() => completed.get(childThread)?.get(firstFollowupTurn) === 'completed', 'FIRST_CHILD_COMPLETED');
    await wait(() => held.get('CHILD_FOLLOWUP').closed, 'COMPLETED_CHILD_HTTP_CLOSED');
    assert.equal(active.has(childThread), false);
    const loadedBefore = await loaded();
    assert.deepEqual(loadedBefore, [rootA.threadId, rootS.threadId, childThread].sort());
    const sBeforeEviction = (await read(rootS.threadId)).turns;
    const sEventsBeforeEviction = structuredClone(sEvents());
    const second = JSON.parse(await step('sequentialSpawn', 'spawn_agent', {
      task_name: 'child_b', message: marker('CHILD_B'), fork_turns: 'none' }));
    assert.equal(second.task_name, '/root/child_b');
    await wait(() => held.has('CHILD_B'), 'SECOND_CHILD_ACTIVE');
    const descendants = [...active.keys()].filter(id => id !== rootA.threadId && id !== rootS.threadId);
    assert.equal(descendants.length, 1); secondChildThread = descendants[0];
    assert.notEqual(secondChildThread, childThread);
    assert.equal(report.results.secondGrandchild, 'collab spawn failed: agent thread limit reached');
    const secondRead = await read(secondChildThread);
    assert.equal(secondRead.source.subAgent.thread_spawn.parent_thread_id, rootA.threadId);
    assert.equal(secondRead.source.subAgent.thread_spawn.depth, 1);
    assert.equal(secondRead.source.subAgent.thread_spawn.agent_path, '/root/child_b');
    report.identities.childB = { threadId: secondChildThread, turnId: active.get(secondChildThread), source: secondRead.source };
    const loadedAfter = await loaded();
    assert.deepEqual(loadedAfter, [rootA.threadId, rootS.threadId, secondChildThread].sort());
    const retained = await read(childThread);
    assert.deepEqual(retained.source, childRead.source);
    assert.deepEqual(retained.turns.map(turn => turn.status), ['interrupted', 'completed']);
    assert.deepEqual(retained.turns.at(-1).items.filter(item => item.type === 'agentMessage').map(item => item.text), ['CHILD_A_DONE']);
    assert.deepEqual(await loaded(), loadedAfter, 'READ_MUST_NOT_RELOAD_EVICTED_CHILD');
    const registry = JSON.parse(await step('sequentialRegistry', 'list_agents', {}));
    // list_agents skips unloaded threads; it is not a complete logical-child inventory.
    assert.deepEqual(registry.agents, [
      { agent_name: '/root', agent_status: 'running' },
      { agent_name: '/root/child_b', agent_status: 'running' },
    ]);
    // A retained same-tree UUID must pass identity resolution, then fail residency admission
    // while B is active. A foreign UUID must still fail identity resolution instead.
    assert.equal(await step('retainedChildAuthority', 'send_message', { target: childThread, message: 'MUST_NOT_DELIVER_WHILE_B_ACTIVE' }),
      'collab tool failed: agent thread limit reached');
    for (const name of ['send_message', 'followup_task', 'interrupt_agent']) {
      assert.equal(await step(`afterEviction_${name}`, name, { target: rootS.threadId,
        ...(name === 'interrupt_agent' ? {} : { message: `FORBIDDEN_AFTER_EVICTION_${name}` }) }), `agent with id ${rootS.threadId} not found`);
    }
    assert.deepEqual((await read(rootS.threadId)).turns, sBeforeEviction);
    assert.deepEqual(sEvents(), sEventsBeforeEviction);
    assert.deepEqual(await loaded(), loadedAfter);
    assert.deepEqual((await read(childThread)).turns, retained.turns, 'CAPACITY_DENIED_MESSAGE_MUST_NOT_MUTATE_EVICTED_CHILD');
    report.v2CapacityEvidence = { advertisedChildSpawnDenied: true, sequentialRootSpawnSucceeded: true,
      completedFirstChildEvictedButReadable: true, loadedBefore, loadedAfter, retainedChild: retained,
      registry, depthDenialDoesNotDependOnMissingTool: true,
      retainedChildIdentityAcceptedButCapacityDenied: true, foreignControlsDeniedAfterEviction: true };
  }
  const row = await wait(() => pending.get('ROOT_A'), 'A_FINISH');
  pending.delete('ROOT_A'); send(row.res, message('ROOT_A_AUTHORITY_CHECKED'));
  await wait(() => completed.get(rootA.threadId)?.get(rootA.turnId) === 'completed', 'A_COMPLETE');
  if (terminalRootMailbox) {
    const rootTurnsBeforeMailbox = structuredClone((await read(rootA.threadId)).turns);
    const foreignTurnsBeforeMailbox = structuredClone((await read(rootS.threadId)).turns);
    const rootRequestsBeforeMailbox = counts.get('ROOT_A');
    const requestsBeforeMailbox = modelRequests;
    const childB = held.get('CHILD_B');
    assert.ok(childB?.body, 'HELD_CHILD_B_BODY_MISSING');
    send(childB.res, call(childB.body, 'terminalRootMessage', 'send_message', { target: rootA.threadId,
      message: 'QUEUE_ONLY_AFTER_ROOT_COMPLETION' }));
    await wait(() => completed.get(secondChildThread)?.get(report.identities.childB.turnId) === 'completed', 'CHILD_B_NATURAL_COMPLETE');
    await wait(() => childB.closed, 'CHILD_B_NATURAL_HTTP_CLOSED');
    assert.equal(report.results.terminalRootMessage, '');
    assert.equal(report.results.terminalRootFollowup, "Follow-up tasks can't target the root agent");
    const rootAfterNotification = await read(rootA.threadId);
    await sleep(1000);
    const rootAfterBoundedWindow = await read(rootA.threadId);
    const originalItems = rootTurnsBeforeMailbox[0].items;
    const observedItems = rootAfterBoundedWindow.turns[0].items;
    const appendedItems = observedItems.slice(originalItems.length);
    report.terminalRootMailbox = { messageResult: report.results.terminalRootMessage,
      followupResult: report.results.terminalRootFollowup, exactNativeDenial: "Follow-up tasks can't target the root agent",
      rootTurnsBefore: rootTurnsBeforeMailbox.length, rootTurnsAfter: rootAfterBoundedWindow.turns.length,
      rootModelRequestsAdded: counts.get('ROOT_A') - rootRequestsBeforeMailbox,
      childModelRequestsAdded: modelRequests - requestsBeforeMailbox,
      observationWindowMs: 1000, appendedItems,
      boundedClaim: 'No new root inference or turn was observed during the finite 1-second window after notification/readback; this is not an eternal guarantee.',
      childCompletedNaturally: true };
    // Child completion appends metadata to the existing root turn, not inference.
    assert.deepEqual(appendedItems, [{ type: 'subAgentActivity',
      id: `subagent-completed-${report.identities.childB.turnId}`, kind: 'completed',
      agentThreadId: secondChildThread, agentPath: '/root/child_b' }]);
    assert.deepEqual(observedItems.slice(0, originalItems.length), originalItems);
    for (const snapshot of [rootAfterNotification, rootAfterBoundedWindow]) {
      assert.equal(snapshot.turns.length, 1);
      const { items, ...metadata } = snapshot.turns[0];
      const { items: previousItems, ...previousMetadata } = rootTurnsBeforeMailbox[0];
      assert.deepEqual(metadata, previousMetadata);
    }
    assert.equal(counts.get('ROOT_A'), rootRequestsBeforeMailbox);
    assert.equal(modelRequests, requestsBeforeMailbox + 2);
    assert.equal(active.has(rootA.threadId), false);
    assert.deepEqual((await read(rootS.threadId)).turns, foreignTurnsBeforeMailbox);
  }
  report.persistedReadback = { rootA: (await read(rootA.threadId)).turns, rootS: (await read(rootS.threadId)).turns };
  assert.deepEqual(report.persistedReadback.rootA[0].items.filter(item => item.type === 'agentMessage').map(item => item.text), ['ROOT_A_AUTHORITY_CHECKED']);
  assert.deepEqual(report.persistedReadback.rootA[0].items.filter(item => item.type === 'subAgentActivity').map(item => [item.kind, item.agentThreadId]),
    [['started', childThread], ['interacted', childThread], ['interrupted', childThread], ['interacted', childThread],
      ...(v2ModelCatalog ? [['completed', childThread], ['started', secondChildThread]] : []),
      ...(terminalRootMailbox ? [['completed', secondChildThread]] : [])]);
  const cleanupChild = v2ModelCatalog ? secondChildThread : childThread;
  if (!terminalRootMailbox) {
    await interrupt(cleanupChild, active.get(cleanupChild));
    await wait(() => held.get(v2ModelCatalog ? 'CHILD_B' : 'CHILD_FOLLOWUP').closed, 'FOLLOWUP_HTTP_CLOSED');
  }
  assert.equal(active.size, 0); assert.deepEqual(raw.failures, []);
  assert.equal(counts.get('ROOT_S'), 1); assert.equal(counts.get('CHILD_A'), 4);
  assert.equal(modelRequests, v2ModelCatalog ? terminalRootMailbox ? 33 : 31 : 23);
  report.persistedReadback.childA = (await read(childThread)).turns;
  assert.deepEqual(report.persistedReadback.childA.map(turn => turn.status), ['interrupted', v2ModelCatalog ? 'completed' : 'interrupted']);
  if (v2ModelCatalog) {
    assert.equal(counts.get('CHILD_B'), terminalRootMailbox ? 4 : 2);
    report.persistedReadback.childB = (await read(secondChildThread)).turns;
    assert.deepEqual(report.persistedReadback.childB.map(turn => turn.status), [terminalRootMailbox ? 'completed' : 'interrupted']);
    assert.equal(sha256(await readFile(catalogPath)), report.modelCatalogSha256);
    report.modelCatalogUnchanged = true;
  }
  const defaultsAfter = (await transport.request('config/read', { includeLayers: false, cwd: workspace })).config;
  assert.deepEqual(defaultsAfter, effective);
  report.defaultConfigReadbackUnchanged = true;
  await router.flush();
  assert.deepEqual(recoveryEvents, []);
  assert.equal(router.pending.length, 0);
  const observedA = await adapter.requireRun('ROOT_A'), observedS = await adapter.requireRun('ROOT_S');
  assert.equal(observedA.rootSettled, true); assert.equal(observedS.rootSettled, true);
  assert.equal(Object.keys(observedS.spawns ?? {}).length, 0);
  assert.deepEqual(Object.values(observedA.spawns).map(spawn => spawn.receiverThreadIds[0]).sort(),
    [childThread, ...(v2ModelCatalog ? [secondChildThread] : [])].sort());
  assert.ok(Object.values(observedA.spawns).every(spawn => spawn.status === 'observed' && spawn.source === 'v2Activity'));
  assert.equal(Object.keys(observedA.childTurns).length, v2ModelCatalog ? 3 : 2);
  for (const [threadId, turns] of [[childThread, report.persistedReadback.childA],
    ...(v2ModelCatalog ? [[secondChildThread, report.persistedReadback.childB]] : [])]) {
    for (const turn of turns) assert.equal(observedA.childTurns[JSON.stringify([threadId, turn.id])], turn.status);
  }
  const operations = await new CodexOperations({ journal: runtimeJournal, attemptId: 'ROOT_A', runId: randomUUID(), attempt: 1,
    startedAt: new Date(Date.now() - 60000).toISOString(), deadlineAt: new Date(Date.now() + 60000).toISOString() }).snapshot();
  assert.ok(operations.some(operation => operation.status === 'unknown'));
  assert.equal(adapter.sleepReadiness().allowed, false);
  report.runtimeObservation = { roots: 2, childTurns: Object.keys(observedA.childTurns).length,
    retainedChildThreads: Object.keys(observedA.spawns).length, recoveryEvents, pendingEvents: router.pending.length,
    activityInvocationsSettled: false, sleepAllowed: false, operationCount: operations.length };
  report.liveCollaborationEvents = raw.notifications.filter(event =>
    ['subAgentActivity', 'collabAgentToolCall'].includes(event.params?.item?.type));
  assert.equal(report.liveCollaborationEvents.length, terminalRootMailbox ? 16 : v2ModelCatalog ? 12 : 8);
  assert.ok(report.liveCollaborationEvents.every(event => event.params.item.type === 'subAgentActivity'));
  for (const [label, kind, id, path] of [
    ['spawn', 'started', childThread, '/root/child_a'],
    ['sameTreeMessage', 'interacted', childThread, '/root/child_a'],
    ['sameTreeInterrupt', 'interrupted', childThread, '/root/child_a'],
    ['sameTreeFollowup', 'interacted', childThread, '/root/child_a'],
    ...(v2ModelCatalog ? [['sequentialSpawn', 'started', secondChildThread, '/root/child_b']] : []),
  ]) {
    const callId = [...calls].find(([, value]) => value === label)[0];
    const events = report.liveCollaborationEvents.filter(event => event.params.item.id === callId);
    assert.deepEqual(events.map(event => event.method), ['item/started', 'item/completed']);
    for (const event of events) {
      assert.deepEqual(event.params.item, { type: 'subAgentActivity', id: callId, kind, agentThreadId: id, agentPath: path });
      assert.equal(event.params.threadId, rootA.threadId); assert.equal(event.params.turnId, rootA.turnId);
    }
  }
  report.liveChildIdentityEvents = raw.notifications.filter(event => {
    const id = event.params?.threadId ?? event.params?.thread?.id;
    return [childThread, secondChildThread].includes(id) && ['thread/started', 'turn/started', 'turn/completed'].includes(event.method);
  });
  report.liveSourceIdentityEvents = raw.notifications.filter(event => JSON.stringify(event).includes('"thread_spawn"'));
  report.liveChildThreadStartedCount = report.liveChildIdentityEvents.filter(event => event.method === 'thread/started').length;
  report.liveEventLimits = [
    'subAgentActivity is activity metadata, not collabAgentToolCall or a settlement receipt.',
    'item/completed with kind started means the spawn activity completed, not that the child completed.',
    'send_message and followup_task both emit interacted; the item alone does not distinguish them.',
    'Child source ancestry is captured from thread/read; do not infer a thread/started event from persisted source.',
  ];
  report.liveCallEventLabels = Object.fromEntries(calls);
  report.cleanup = { activeTurns: active.size, heldRequests: held.size, closedHeldRequests: [...held.values()].filter(row => row.closed).length };
  report.status = 'passed';
} catch (error) {
  raw.failures.push(error.stack); report.gap = error.message; process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  router?.close();
  if (transport) {
    for (const [threadId, turnId] of [...active]) await interrupt(threadId, turnId).catch(() => {});
    transport.close();
    await wait(() => transport.child.exitCode !== null || transport.child.signalCode !== null, 'NATIVE_STOP', 5000).catch(() => transport.child.kill('SIGKILL'));
    await wait(() => transport.child.exitCode !== null || transport.child.signalCode !== null, 'NATIVE_STOP_CONFIRMED', 5000).catch(() => {});
    report.nativeStopped = transport.child.exitCode !== null || transport.child.signalCode !== null;
    if (!report.nativeStopped) { report.status = 'failed'; process.exitCode = 1; }
  }
  if (server) { server.closeAllConnections(); await new Promise(resolveClose => server.close(resolveClose)); }
  report.httpServerClosed = server ? !server.listening : true;
  report.finalCleanup = { activeTurns: active.size, heldRequests: held.size,
    closedHeldRequests: [...held.values()].filter(row => row.closed).length };
  if (active.size || [...held.values()].some(row => !row.closed)) { report.status = 'failed'; process.exitCode = 1; }
  if (originalConfig) {
    const finalConfig = await readFile(configPath); report.finalConfigSha256 = sha256(finalConfig);
    report.originalConfigUnchanged = finalConfig.equals(originalConfig);
    if (!report.originalConfigUnchanged) { report.status = 'failed'; process.exitCode = 1; }
  }
  report.modelRequests = modelRequests;
  // Raw protocol/model material is private and intentionally removed with the disposable home/workspace.
  report.privateRawRetained = false;
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  process.stdout.write(`${JSON.stringify(report, null, 2).replaceAll(directory, '<disposable>')}\n`);
}
