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

const foreignClose = process.argv.includes('--foreign-close');
assert.ok(process.argv.slice(2).length <= 1 && process.argv.slice(2).every(arg => arg === '--foreign-close'));
const binary = resolve(import.meta.dirname, '../.local/codex-runtime/node_modules/.bin/codex');
const directory = await mkdtemp(join(tmpdir(), 'hehe-owner-background-'));
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
  appServerGlobalChildCapProved: false, toolEffectSettlementProved: false };
let server, transport, configPath, originalConfig, modelRequests = 0;
const held = new Map(), active = new Map(), completed = new Map();
const children = new Map(), spawnCalls = new Map();

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
function spawn(body, label, allowMissing = false) {
  const tool = body.tools.find(item => item.name === 'spawn_agent' || item.tools?.some(nested => nested.name === 'spawn_agent'));
  if (!allowMissing) assert.ok(tool, `${label}_SPAWN_NOT_ADVERTISED`);
  const callId = `call_${randomUUID()}`; spawnCalls.set(callId, label);
  return [{ id: `fc_${randomUUID()}`, type: 'function_call', status: 'completed', call_id: callId,
    ...(tool?.type === 'namespace' ? { namespace: tool.name } : {}), name: 'spawn_agent',
    arguments: JSON.stringify({ task_name: label.toLowerCase(), message: marker(label), fork_turns: 'all' }) }];
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
      assert.ok(modelRequests <= (foreignClose ? 9 : 7)); assert.equal(body.model, 'fixture-model'); assert.equal(body.stream, true);
      const catalog = names(body);
      assert.ok(!catalog.some(name => /web_search|image_generation|mcp|tool_suggest/.test(name)), 'DISABLED_PROVIDER_SURFACE');
      const text = body.input.filter(item => item.role === 'user' || item.type === 'agent_message')
        .map(item => JSON.stringify(item.content)).join('\n');
      const label = ['CHILD_A', 'ROOT_A', 'ROOT_S'].find(value => text.includes(marker(value)));
      assert.ok(label, 'UNKNOWN_SCRIPTED_REQUEST');
      const output = body.input.filter(item => item.type === 'function_call_output').at(-1);
      if (foreignClose && text.includes(marker('FOREIGN_CLOSE'))) {
        if (output?.call_id === 'foreign_close') {
          report.foreignCloseReply = output.output;
          send(res, message('FOREIGN_CLOSE_RETURNED')); return;
        }
        const tool = body.tools.find(item => item.name === 'close_agent' || item.tools?.some(nested => nested.name === 'close_agent'));
        assert.ok(tool, 'SELECTED_ROOT_CLOSE_ADVERTISED');
        send(res, [{ id: 'fc_foreign_close', type: 'function_call', status: 'completed', call_id: 'foreign_close',
          ...(tool.type === 'namespace' ? { namespace: tool.name } : {}), name: 'close_agent',
          arguments: JSON.stringify({ target: report.identities.rootS.threadId }) }]);
        return;
      }
      if (label === 'ROOT_A' && !output) { report.rootAToolCatalog = catalog; send(res, spawn(body, 'CHILD_A')); return; }
      if (label === 'ROOT_A' && output && !body.input.some(item => spawnCalls.get(item.call_id) === 'SECOND_A')) {
        const receipt = JSON.parse(output.output); children.set('CHILD_A', receipt.agent_id); send(res, spawn(body, 'SECOND_A')); return;
      }
      if (label === 'ROOT_A') { report.secondChildDenial = String(output.output); send(res, message('ROOT_A_CAP_DENIAL_VISIBLE')); return; }
      if (label === 'CHILD_A' && !output) {
        report.childToolCatalog = catalog;
        send(res, spawn(body, 'GRANDCHILD_A', true));
        return;
      }
      if (label === 'CHILD_A') { report.grandchildDenial = String(output.output); hold(label, res); return; }
      if (label === 'ROOT_S' && !output) {
        report.rootSToolCatalog = catalog;
        send(res, spawn(body, 'FORBIDDEN_S', true));
        return;
      }
      report.rootSDenial = String(output.output); send(res, message('ROOT_S_DEFAULT_DENIAL_VISIBLE'));
    } catch (error) { raw.failures.push(error.stack); if (!res.headersSent) res.writeHead(500); res.end(); }
  });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const filesystem = { ':minimal': 'read', [workspace]: 'read', [privateHome]: 'deny', [journal]: 'deny', [token]: 'deny' };
  const fileEntries = Object.entries(filesystem).map(([path, mode]) => `${JSON.stringify(path)} = ${JSON.stringify(mode)}`).join('\n');
  const disabled = ['multi_agent', 'multi_agent_v2', 'apps', 'plugins', 'tool_suggest', 'image_generation',
    'standalone_web_search', 'token_budget', 'request_permissions_tool', 'exec_permission_approvals', 'code_mode', 'code_mode_only'];
  const config = `model = "fixture-model"\nmodel_provider = "fixture"\nweb_search = "disabled"\ndefault_permissions = "owner-background"\n` +
    `[agents]\nenabled = false\n[features]\n${disabled.map(key => `${key} = false`).join('\n')}\n` +
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
  report.defaultConfigReadback = { agents: effective.agents, features: Object.fromEntries(disabled.map(key => [key, effective.features[key]])),
    profile: { name: effective.default_permissions, filesystem: { ':minimal': 'read', '<workspace>': 'read', '<private-home>': 'deny',
      '<journal>': 'deny', '<token>': 'deny', glob_scan_max_depth: null }, network: { enabled: false } }, mcpServers: 0 };
  const start = async (label, configOverride) => {
    const started = await transport.request('thread/start', { cwd: workspace, model: 'fixture-model', modelProvider: 'fixture',
      permissions: 'owner-background', approvalPolicy: 'untrusted', ...(configOverride ? { config: configOverride } : {}) });
    assert.equal(started.approvalPolicy, 'untrusted');
    const turn = (await transport.request('turn/start', { threadId: started.thread.id,
      input: [{ type: 'text', text: marker(label) }] })).turn;
    return { threadId: started.thread.id, turnId: turn.id };
  };
  const rootAConfig = { agents: { enabled: true, max_concurrent_threads_per_session: 1, max_depth: 1 },
    features: { multi_agent: true, multi_agent_v2: false } };
  const rootA = await start('ROOT_A', rootAConfig);
  await wait(() => children.has('CHILD_A'), 'CHILD_RECEIPT');
  const childThread = children.get('CHILD_A');
  await wait(() => active.has(childThread), 'CHILD_ACTIVE');
  await wait(() => completed.get(rootA.threadId)?.get(rootA.turnId) === 'completed', 'ROOT_A_COMPLETE');
  assert.equal(report.secondChildDenial, 'collab spawn failed: agent thread limit reached');
  await wait(() => held.has('CHILD_A'), 'CHILD_HELD_AFTER_GRANDCHILD_DENIAL');
  assert.equal(report.grandchildDenial, 'unsupported call: spawn_agent');
  const rootS = await start('ROOT_S');
  await wait(() => completed.get(rootS.threadId)?.get(rootS.turnId) === 'completed', 'ROOT_S_COMPLETE');
  assert.equal(report.rootSDenial, 'unsupported call: spawn_agent');
  for (const [root, text] of [[rootA, 'ROOT_A_CAP_DENIAL_VISIBLE'], [rootS, 'ROOT_S_DEFAULT_DENIAL_VISIBLE']]) {
    const readback = (await transport.request('thread/read', { threadId: root.threadId, includeTurns: true })).thread;
    const turn = readback.turns.find(turn => turn.id === root.turnId);
    assert.deepEqual(turn.items.filter(item => item.type === 'agentMessage').map(item => item.text), [text]);
  }
  const childRead = (await transport.request('thread/read', { threadId: childThread, includeTurns: true })).thread;
  assert.equal(childRead.source.subAgent.thread_spawn.parent_thread_id, rootA.threadId);
  assert.equal(childRead.source.subAgent.thread_spawn.depth, 1);
  const featuresA = await transport.request('experimentalFeature/list', { threadId: rootA.threadId, limit: 100 });
  const featuresS = await transport.request('experimentalFeature/list', { threadId: rootS.threadId, limit: 100 });
  const featuresChild = await transport.request('experimentalFeature/list', { threadId: childThread, limit: 100 });
  const feature = (list, name) => list.data.find(item => item.name === name)?.enabled;
  assert.equal(feature(featuresA, 'multi_agent'), true); assert.equal(feature(featuresA, 'multi_agent_v2'), false);
  assert.equal(feature(featuresS, 'multi_agent'), false); assert.equal(feature(featuresS, 'multi_agent_v2'), false);
  assert.equal(feature(featuresChild, 'multi_agent'), true); assert.equal(feature(featuresChild, 'multi_agent_v2'), false);
  report.identities = { rootA, childA: { threadId: childThread, turnId: active.get(childThread), source: childRead.source }, rootS };
  report.scopedFeatures = { rootA: { multi_agent: true, multi_agent_v2: false }, childA: { multi_agent: true, multi_agent_v2: false },
    rootS: { multi_agent: false, multi_agent_v2: false } };
  report.outputs = { rootA: 'ROOT_A_CAP_DENIAL_VISIBLE', rootS: 'ROOT_S_DEFAULT_DENIAL_VISIBLE',
    secondChild: report.secondChildDenial, grandchild: report.grandchildDenial, rootSDefault: report.rootSDenial };
  if (foreignClose) {
    const before = await transport.request('thread/loaded/list', {});
    assert.ok(before.data.includes(rootS.threadId), 'FOREIGN_ROOT_WAS_LOADED');
    // Host supplies the known foreign ID only to this synthetic model response.
    // A second turn on A tests native target authorization, not automatic reactivation.
    const probe = (await transport.request('turn/start', { threadId: rootA.threadId,
      input: [{ type: 'text', text: marker('FOREIGN_CLOSE') }] })).turn;
    await wait(() => completed.get(rootA.threadId)?.get(probe.id) === 'completed', 'FOREIGN_CLOSE_RETURN');
    assert.deepEqual(JSON.parse(report.foreignCloseReply), { previous_status: { completed: 'ROOT_S_DEFAULT_DENIAL_VISIBLE' } });
    const after = await transport.request('thread/loaded/list', {});
    assert.ok(!after.data.includes(rootS.threadId), 'FOREIGN_ROOT_MUST_BE_REMOVED_TO_CONFIRM_GAP');
    assert.ok(after.data.includes(rootA.threadId) && after.data.includes(childThread));
    assert.equal(held.get('CHILD_A').closed, false);
    const persisted = (await transport.request('thread/read', { threadId: rootA.threadId, includeTurns: true })).thread;
    assert.deepEqual(persisted.turns.find(turn => turn.id === probe.id).items.filter(item => item.type === 'agentMessage').map(item => item.text), ['FOREIGN_CLOSE_RETURNED']);
    report.foreignClose = { unsafeCrossRootCloseObserved: true, sourceThread: rootA.threadId,
      sourceTurn: probe.id, targetThread: rootS.threadId, targetPreviouslyLoaded: true,
      targetRemoved: true, foreignCompletionTextReturned: true, ownChildStillActive: true, automaticRootReactivationProved: false };
  }
  const childTurn = active.get(childThread); await interrupt(childThread, childTurn);
  await wait(() => held.get('CHILD_A').closed, 'CHILD_HTTP_CLOSED');
  assert.equal(active.size, 0); assert.deepEqual(raw.failures, []);
  assert.equal(modelRequests, foreignClose ? 9 : 7);
  report.cleanup = { interrupted: { threadId: childThread, turnId: childTurn }, activeTurns: 0, heldRequests: held.size,
    closedHeldRequests: [...held.values()].filter(row => row.closed).length };
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
  if (originalConfig) {
    const finalConfig = await readFile(configPath); report.finalConfigSha256 = sha256(finalConfig);
    report.originalConfigUnchanged = finalConfig.equals(originalConfig);
    if (!report.originalConfigUnchanged) { report.status = 'failed'; process.exitCode = 1; }
  }
  report.modelRequests = modelRequests;
  // Raw protocol/model material is private and intentionally removed with the disposable home/workspace.
  report.privateRawRetained = false;
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
