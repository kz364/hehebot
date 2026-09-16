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
  scope: 'Scripted fixture-model only; V2 residency cap is not a logical-child or model-independent depth bound.' };
let server, transport, configPath, originalConfig, modelRequests = 0;
const held = new Map(), active = new Map(), completed = new Map();
const calls = new Map(), pending = new Map(), counts = new Map();
let rootS, childThread;
report.results = {};
report.modelCalls = [];

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
function hold(label, res) {
  assert.equal(held.has(label), false); const row = { res, closed: false }; held.set(label, row);
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
      const text = JSON.stringify(body.input.filter(item => item.role === 'user' || item.type === 'agent_message'));
      const label = ['CHILD_A', 'ROOT_A', 'ROOT_S'].find(value => text.includes(marker(value)));
      assert.ok(label, 'UNKNOWN_SCRIPTED_REQUEST');
      counts.set(label, (counts.get(label) ?? 0) + 1);
      report[`${label}ToolCatalog`] = catalog;
      assert.ok(!catalog.some(name => /wait_agent|close_agent|send_input|resume_agent/.test(name)), 'LEGACY_OR_WAIT_TOOL_ADVERTISED');
      if (label !== 'ROOT_A') assert.ok(!catalog.some(name => /agent|collaboration/.test(name)), 'NON_ROOT_CONTROL_TOOLS');
      if (label === 'ROOT_S') { hold(`ROOT_S_${counts.get(label)}`, res); return; }
      if (label === 'CHILD_A') {
        if (counts.get(label) === 1) {
          send(res, call(body, 'grandchild', 'spawn_agent', { task_name: 'grandchild', message: 'FORBIDDEN_GRANDCHILD', fork_turns: 'none' }, true));
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
    'standalone_web_search', 'remote_models', 'token_budget', 'request_permissions_tool', 'exec_permission_approvals', 'code_mode', 'code_mode_only'];
  const config = `model = "fixture-model"\nmodel_provider = "fixture"\nweb_search = "disabled"\ndefault_permissions = "owner-background"\n` +
    `[agents]\nenabled = false\n[features]\n${disabled.map(key => `${key} = false`).join('\n')}\n` +
    `[analytics]\nenabled = false\n[feedback]\nenabled = false\n[otel]\nexporter = "none"\ntrace_exporter = "none"\nmetrics_exporter = "none"\n` +
    `[permissions.owner-background.filesystem]\n${fileEntries}\n[permissions.owner-background.network]\nenabled = false\n` +
    `[model_providers.fixture]\nname = "Scripted loopback only"\nbase_url = "http://127.0.0.1:${server.address().port}/v1"\n` +
    `wire_api = "responses"\nrequires_openai_auth = false\nrequest_max_retries = 0\nstream_max_retries = 0\n`;
  configPath = join(home, 'config.toml'); await writeFile(configPath, config, { mode: 0o600 }); originalConfig = await readFile(configPath);
  report.originalConfigSha256 = sha256(originalConfig);
  transport = spawnCodex({ binary, home, cwd: workspace, timeoutMs: 10000 });
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
  const effective = (await transport.request('config/read', { includeLayers: false, cwd: workspace })).config;
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
  assert.equal(report.results.grandchild, 'unsupported call: spawn_agent');
  assert.equal(report.results.grandchildNamespaced, 'unsupported call: collaborationspawn_agent');
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
  const row = await wait(() => pending.get('ROOT_A'), 'A_FINISH');
  pending.delete('ROOT_A'); send(row.res, message('ROOT_A_AUTHORITY_CHECKED'));
  await wait(() => completed.get(rootA.threadId)?.get(rootA.turnId) === 'completed', 'A_COMPLETE');
  report.scopedFeatures = {};
  for (const [label, id, enabled] of [['rootA', rootA.threadId, true], ['childA', childThread, true], ['rootS', rootS.threadId, false]]) {
    const result = await transport.request('experimentalFeature/list', { threadId: id, limit: 100 });
    const flags = Object.fromEntries(['multi_agent', 'multi_agent_v2'].map(name => [name, result.data.find(item => item.name === name)?.enabled]));
    assert.deepEqual(flags, { multi_agent: false, multi_agent_v2: enabled }); report.scopedFeatures[label] = flags;
  }
  report.persistedReadback = { rootA: (await read(rootA.threadId)).turns, rootS: (await read(rootS.threadId)).turns };
  assert.deepEqual(report.persistedReadback.rootA[0].items.filter(item => item.type === 'agentMessage').map(item => item.text), ['ROOT_A_AUTHORITY_CHECKED']);
  assert.deepEqual(report.persistedReadback.rootA[0].items.filter(item => item.type === 'subAgentActivity').map(item => item.agentThreadId),
    [childThread, childThread, childThread, childThread]);
  await interrupt(childThread, active.get(childThread));
  await wait(() => held.get('CHILD_FOLLOWUP').closed, 'FOLLOWUP_HTTP_CLOSED');
  assert.equal(active.size, 0); assert.deepEqual(raw.failures, []);
  assert.equal(counts.get('ROOT_S'), 1); assert.equal(counts.get('CHILD_A'), 4);
  assert.equal(modelRequests, 23);
  report.persistedReadback.childA = (await read(childThread)).turns;
  assert.deepEqual(report.persistedReadback.childA.map(turn => turn.status), ['interrupted', 'interrupted']);
  const defaultsAfter = (await transport.request('config/read', { includeLayers: false, cwd: workspace })).config;
  assert.deepEqual(defaultsAfter, effective);
  report.defaultConfigReadbackUnchanged = true;
  report.cleanup = { activeTurns: active.size, heldRequests: held.size, closedHeldRequests: [...held.values()].filter(row => row.closed).length };
  report.status = 'passed';
} catch (error) {
  raw.failures.push(error.stack); report.gap = error.message; process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
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
