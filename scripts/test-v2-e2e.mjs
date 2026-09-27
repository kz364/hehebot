#!/usr/bin/env node
// G8 local rehearsal of the v2-architecture hosted path, credential-free.
//
// Real: Worker + SQLite Durable Object in local workerd (wrangler dev, HTTPS,
// HEHEBOT_EXECUTION_MODE=v2, NATIVE_VERIFIED left false), the Sprite runtime
// entry (runtime/v2-service-entry.mjs) with its /wake handler, codex-service
// with both lanes, pinned Codex 0.154.0 app-server, and the hehebot MCP tools
// over HTTPS into the Worker.
// Synthetic: the model (a loopback Responses server that scripts each turn),
// the Sprite Tasks socket, and the provider (FakeProvider: the Worker records
// the wake; this script delivers it to the runtime's /wake like SpritesProvider
// would). No Codex login, no model/provider account, no network egress.
//
// Scenario: owner says "research hotels" -> coordinator starts a task and
// replies via hehebot_send_message -> while the task runs, owner asks "how's
// it going?" -> coordinator answers from hehebot_list_tasks without touching
// the task -> task completes -> task.event wakes the coordinator -> relayed
// reply -> both lanes idle -> runtime asks, Worker commits sleep.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Agent } from 'undici';
import { createSpriteCodexService } from '../runtime/sprites-codex-service.mjs';
import { createV2Runtime } from '../runtime/v2-service-entry.mjs';
import { ControlClient } from '../runtime/control-client.mjs';

const root = resolve(import.meta.dirname, '..');
const model = 'gpt-5.5';
const FIRST = 'research hotels', SECOND = "how's it going?";
const TASK_TITLE = 'Hotel research', TASK_BRIEF = 'Find three hotel options near the venue.';
const ACK = 'On it: I started a background task to research hotels.';
const STATUS = 'Still working on it: the hotel research task is running.';
const TASK_RESULT = 'Found three hotels: Alpha Inn, Beta Suites, Gamma Lodge.';
const RELAY = 'The hotel research is done: Alpha Inn, Beta Suites and Gamma Lodge.';
const sleep = ms => new Promise(ok => setTimeout(ok, ms));
async function wait(fn, label, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await sleep(100); }
  throw new Error(`Timed out: ${label}`);
}
async function freePort() {
  const server = createServer(); await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  const port = server.address().port; await new Promise(ok => server.close(ok)); return port;
}
async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  try { await wait(() => child.exitCode !== null || child.signalCode !== null, 'worker stop', 5000); }
  catch { child.kill('SIGKILL'); }
}
// Minimal Responses SSE stream (same wire shape as scripts/test-codex-service.mjs).
function send(res, output) {
  const response = { id: `resp_${randomUUID()}`, object: 'response', created_at: 1, status: 'completed', error: null,
    incomplete_details: null, model, output, parallel_tool_calls: true, tools: [], tool_choice: 'auto',
    usage: { input_tokens: 31, input_tokens_details: { cached_tokens: 0 }, output_tokens: 13,
      output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 44 } };
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const event = (type, fields) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`);
  event('response.created', { response: { ...response, status: 'in_progress', output: [] } });
  for (const [output_index, item] of output.entries()) {
    event('response.output_item.added', { output_index, item: { ...item, ...(item.type === 'function_call' ? { arguments: '' } : { content: [] }) } });
    if (item.type === 'function_call') event('response.function_call_arguments.done', { output_index, item_id: item.id, arguments: item.arguments });
    else {
      const text = item.content[0].text;
      event('response.content_part.added', { output_index, item_id: item.id, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
      event('response.output_text.delta', { output_index, item_id: item.id, content_index: 0, delta: text });
      event('response.output_text.done', { output_index, item_id: item.id, content_index: 0, text });
      event('response.content_part.done', { output_index, item_id: item.id, content_index: 0, part: item.content[0] });
    }
    event('response.output_item.done', { output_index, item });
  }
  event('response.completed', { response }); res.end('data: [DONE]\n\n');
}
const message = text => ({ id: `msg_${randomUUID()}`, type: 'message', status: 'completed', role: 'assistant',
  content: [{ type: 'output_text', text, annotations: [] }] });
const toolNames = body => body.tools.flatMap(tool => tool.type === 'namespace' ? (tool.tools ?? []).map(nested => nested.name) : [tool.name]);
function call(body, name, args) {
  const base = { id: `fc_${randomUUID()}`, type: 'function_call', status: 'completed', call_id: `call_${randomUUID()}`, arguments: JSON.stringify(args) };
  const flat = body.tools.find(tool => tool.type !== 'namespace' && typeof tool.name === 'string' && tool.name.endsWith(name));
  if (flat) return { ...base, name: flat.name };
  const namespace = body.tools.find(tool => tool.type === 'namespace' && tool.tools?.some(nested => nested.name === name)) ??
    body.tools.find(tool => tool.name === 'mcp__hehebot');
  if (!namespace) throw new Error(`${name} not advertised`);
  return { ...base, namespace: namespace.name, name };
}
// Decode the MCP tool result the model sees (same layering as test-codex-service).
function toolResult(item) {
  let value = typeof item.output === 'string' ? JSON.parse(item.output) : item.output;
  if (Array.isArray(value)) value = JSON.parse(value.at(-1).text);
  if (value?.content) value = JSON.parse(value.content.find(part => part.type === 'text').text);
  return value;
}
function context(body) {
  for (const item of body.input.filter(entry => entry.role === 'user')) {
    const parts = typeof item.content === 'string' ? [item.content] : (item.content ?? []).map(part => part.text);
    for (const text of parts) { try { const parsed = JSON.parse(text); if (typeof parsed?.instruction === 'string') return parsed; } catch {} }
  }
  return null;
}

const directory = await mkdtemp(join(tmpdir(), 'hehe-v2-e2e-'));
const report = { status: 'failed', modelRequests: 0, turns: {}, spriteTasks: [], runtimeEvents: [] };
const errors = [];
let worker, modelServer, runtimeServer, runtime, dispatcher, workerLogs = '';
let taskHeld = null, releaseTask, listTasksSeen = null;
try {
  // --- Worker in local workerd, v2 mode on, NATIVE_VERIFIED stays false.
  const workerPort = await freePort(), token = randomBytes(32).toString('hex'), wakeToken = randomBytes(32).toString('hex');
  const cert = join(directory, 'cert.pem'), key = join(directory, 'key.pem');
  await promisify(execFile)('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', key, '-out', cert]);
  worker = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--env', 'local', '--ip', '127.0.0.1',
    '--port', String(workerPort), '--persist-to', join(directory, 'worker'), '--local-protocol', 'https', '--https-key-path', key, '--https-cert-path', cert,
    '--var', 'EXECUTION_ENABLED:true', '--var', 'HEHEBOT_EXECUTION_MODE:v2', '--var', `RUNTIME_TOKEN:${token}`,
    '--var', `PROVIDER_CONFIG:${JSON.stringify({ provider: 'fake', ref: { provider: 'fake', id: 'v2-rehearsal' } })}`],
  { cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: join(directory, 'logs') }, stdio: ['ignore', 'pipe', 'pipe'] });
  worker.stdout.on('data', chunk => { workerLogs += chunk; }); worker.stderr.on('data', chunk => { workerLogs += chunk; });
  await wait(() => workerLogs.replace(/\u001b\[[0-9;]*m/g, '').includes(`Ready on https://127.0.0.1:${workerPort}`), 'Worker readiness', 60000);
  const origin = `https://127.0.0.1:${workerPort}`;
  dispatcher = new Agent({ connect: { ca: await readFile(cert) } });
  const trustedFetch = (url, init) => fetch(url, { ...init, dispatcher });
  const owner = async (path, init = {}) => {
    const response = await trustedFetch(`${origin}${path}`, init);
    const body = await response.json();
    assert.ok(response.ok, `${path} -> ${response.status} ${JSON.stringify(body)}`);
    return body;
  };
  const say = text => owner('/v1/commands', { method: 'POST', headers: { 'content-type': 'application/json', Origin: origin,
    'idempotency-key': randomUUID() }, body: JSON.stringify({ schema_version: 1, type: 'message.send', payload: { conversation_id: persona, text } }) });
  const control = new ControlClient({ origin: origin + '/', token, fetchImpl: trustedFetch });
  const initial = await control.request('status', {});
  assert.equal(initial.execution_mode, 'v2');
  assert.equal(initial.execution_enabled, true);
  assert.equal(initial.phase, 'STOPPED');
  const state = await owner('/v1/state');
  const persona = state.objects.find(object => object.kind === 'persona').id;
  const runs = async () => (await owner('/v1/state')).runs;
  const run = async id => (await runs()).find(value => value.id === id);

  // --- Scripted model: one script per turn, keyed by the turn's instruction.
  const turns = report.turns;
  modelServer = createServer(async (req, res) => {
    try {
      assert.equal(req.url, '/v1/responses');
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      report.modelRequests++;
      const turn = context(body);
      assert.ok(turn, 'every request carries the Worker context');
      const outputs = body.input.filter(item => item.type === 'function_call_output');
      const names = toolNames(body);
      if (turn.coordinator_task) {
        // Task executor turn: isolated thread, no task-management tools.
        turns.task = (turns.task ?? 0) + 1;
        assert.equal(turn.instruction, TASK_BRIEF);
        assert.ok(names.some(name => name.endsWith('hehebot_send_message')));
        assert.ok(!names.some(name => /hehebot_(start|list)_task/.test(name)), 'task turn must not get coordinator task tools');
        await new Promise(ok => { taskHeld = true; releaseTask = ok; });
        return send(res, [message(TASK_RESULT)]);
      }
      assert.match(turn.coordinator_guidance ?? '', /hehebot_send_message/);
      if (turn.instruction === FIRST) {
        turns.first = (turns.first ?? 0) + 1;
        if (outputs.length === 0) return send(res, [call(body, 'hehebot_start_task', { idempotency_key: randomUUID(), payload: { title: TASK_TITLE, brief: TASK_BRIEF } })]);
        if (outputs.length === 1) {
          const receipt = toolResult(outputs[0]);
          assert.equal(receipt.status, 'applied'); report.taskRunId = receipt.resource_id;
          return send(res, [call(body, 'hehebot_send_message', { text: ACK })]);
        }
        return send(res, [message('(acknowledged)')]);
      }
      if (turn.instruction === SECOND) {
        turns.second = (turns.second ?? 0) + 1;
        if (outputs.length === 0) return send(res, [call(body, 'hehebot_list_tasks', {})]);
        if (outputs.length === 1) {
          listTasksSeen = toolResult(outputs[0]);
          return send(res, [call(body, 'hehebot_send_message', { text: STATUS })]);
        }
        return send(res, [message('(status given)')]);
      }
      if (/is now completed/.test(turn.instruction)) {
        turns.wake = (turns.wake ?? 0) + 1;
        assert.ok(turn.instruction.includes(TASK_TITLE) && turn.instruction.includes(TASK_RESULT), 'task.event carries the task result');
        if (outputs.length === 0) return send(res, [call(body, 'hehebot_send_message', { text: RELAY })]);
        return send(res, [message('(relayed)')]);
      }
      throw new Error(`Unexpected turn: ${turn.instruction}`);
    } catch (error) {
      errors.push(error.message);
      if (!res.headersSent) send(res, [message('FIXTURE_FAILED')]); else res.end();
    }
  });
  await new Promise(ok => modelServer.listen(0, '127.0.0.1', ok));

  // --- Sprite runtime entry with synthetic Sprite Tasks socket.
  const stateRoot = join(directory, 'sprite'); await mkdir(stateRoot, { mode: 0o700 });
  const runtimeTokenFile = join(directory, 'runtime-token'), wakeTokenFile = join(directory, 'wake-token');
  await writeFile(runtimeTokenFile, token, { mode: 0o600 }); await writeFile(wakeTokenFile, wakeToken, { mode: 0o600 });
  const catalogPath = join(directory, 'models.json');
  await writeFile(catalogPath, JSON.stringify({ models: [{ slug: model, display_name: 'Synthetic rehearsal model', description: null,
    supported_reasoning_levels: [], shell_type: 'unified_exec', visibility: 'list', supported_in_api: true, priority: 1, upgrade: null,
    model_messages: { instructions_template: 'Synthetic credential-free rehearsal.', instructions_variables: null },
    default_reasoning_summary: 'auto', support_verbosity: false, tool_mode: 'direct', default_verbosity: null,
    supports_search_tool: false, use_responses_lite: false, multi_agent_version: null, apply_patch_tool_type: null,
    truncation_policy: { mode: 'bytes', limit: 10000 }, supports_image_detail_original: false, context_window: 272000,
    auto_compact_token_limit: null, effective_context_window_percent: 95, experimental_supported_tools: [] }] }), { mode: 0o600 });
  let held = null;
  const spriteRequest = (options, callback) => {
    assert.equal(options.socketPath, '/.sprite/api.sock');
    report.spriteTasks.push(options.method);
    const req = new EventEmitter(); req.setTimeout = () => {}; req.destroy = () => {};
    req.end = data => {
      const res = new EventEmitter();
      let payload = '';
      if (options.method === 'PUT') { held = { name: options.path.split('/').at(-1), expires_at: new Date(Date.now() + JSON.parse(data).expire * 1000).toISOString() }; res.statusCode = 200; payload = '{}'; }
      else if (options.method === 'GET') { res.statusCode = held ? 200 : 404; payload = held ? JSON.stringify(held) : ''; }
      else { held = null; res.statusCode = 204; }
      callback(res); if (payload) res.emit('data', Buffer.from(payload)); res.emit('end');
    };
    return req;
  };
  runtime = createV2Runtime({ portalOrigin: origin + '/', runtimeTokenFile, wakeTokenFile, tlsCAFile: cert,
    ownerBindingSha256: initial.owner_binding_sha256 ?? null, installationId: 'v2-rehearsal', stateRoot,
    binary: join(root, '.local/codex-runtime/node_modules/.bin/codex'), restrictedPermissions: true, maintainIntervalMs: 500,
    personas: { [persona]: { agentId: 'assistant', model, allowedTools: ['hehebot_send_message', 'hehebot_start_task',
      'hehebot_list_tasks', 'hehebot_task_detail', 'hehebot_steer_task', 'hehebot_queue_followup', 'hehebot_cancel_task'] } } },
  { createService: createSpriteCodexService, report: value => report.runtimeEvents.push(value),
    serviceDependencies: { spriteRequest, fetchImpl: trustedFetch,
      prepareNative: home => writeFile(join(home, 'config.toml'), `model = "${model}"\nmodel_catalog_json = "${catalogPath}"\nmodel_provider = "fixture"\n[features]\ncode_mode = false\n[model_providers.fixture]\nname = "Loopback"\nbase_url = "http://127.0.0.1:${modelServer.address().port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`, { mode: 0o600 }) } });
  runtimeServer = runtime.server();
  await new Promise(ok => runtimeServer.listen(0, '127.0.0.1', ok));
  const wake = async epoch => {
    const response = await fetch(`http://127.0.0.1:${runtimeServer.address().port}/wake`, { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hehe-wake-token': wakeToken }, body: JSON.stringify({ epoch, operationId: randomUUID() }) });
    assert.equal(response.status, 202);
  };

  // 1. Owner: "research hotels". The Worker requests a wake; deliver it.
  const first = await say(FIRST);
  assert.equal(first.status, 'applied');
  const booting = await wait(async () => { const s = await control.request('status', {}); return s.phase === 'BOOTING' && s; }, 'Worker wake request');
  await wake(booting.epoch);
  await wait(() => report.runtimeEvents.some(event => event.event === 'v2.ready'), 'runtime boot', 60000);

  // 2. Coordinator starts the task and acknowledges through hehebot_send_message.
  const timeline = async () => (await owner(`/v1/conversations/${persona}/events?after=0`)).events;
  const bubbles = async () => (await timeline()).filter(event => event.type === 'message.user' || event.type === 'bot.message');
  await wait(async () => (await bubbles()).some(event => event.payload.text === ACK), 'acknowledgement bubble', 60000);
  await wait(() => taskHeld, 'task running on the task lane', 60000);
  const firstRun = first.resource_id;
  await wait(async () => (await run(firstRun))?.status === 'completed', 'first coordinator turn completes while the task runs', 30000);
  const taskBefore = await run(report.taskRunId);
  assert.equal(taskBefore.status, 'running');
  assert.equal(taskBefore.current_attempt, 1);

  // 3. While the task runs: "how's it going?" is answered from list_tasks.
  const second = await say(SECOND);
  await wait(async () => (await bubbles()).some(event => event.payload.text === STATUS), 'status bubble', 60000);
  assert.ok(listTasksSeen, 'coordinator read the task ledger');
  assert.deepEqual(listTasksSeen.tasks.map(task => [task.id, task.title, task.status]), [[report.taskRunId, TASK_TITLE, 'running']]);
  const taskDuring = await run(report.taskRunId);
  assert.equal(taskDuring.status, 'running', 'the status question did not disturb the task');
  assert.equal(taskDuring.current_attempt, 1);
  assert.equal(turns.task, 1, 'the task turn saw exactly one model request (no steer/restart)');
  await wait(async () => (await run(second.resource_id))?.status === 'completed', 'status coordinator turn completes');

  // 4. The task finishes; task.event wakes the coordinator, which relays.
  releaseTask();
  await wait(async () => (await bubbles()).some(event => event.payload.text === RELAY), 'relayed result bubble', 60000);
  await wait(async () => (await run(report.taskRunId))?.status === 'completed', 'task completed');

  // 5. Both lanes idle -> runtime asks -> Worker commits sleep (G2 predicate).
  await wait(() => report.runtimeEvents.some(event => event.event === 'v2.sleep_committed'), 'sleep committed', 150000);
  await wait(() => report.runtimeEvents.some(event => event.event === 'v2.stopped'), 'native stopped after sleep', 30000);
  const asleep = await wait(async () => { const s = await control.request('status', {}); return ['STOP_COMMITTED', 'STOPPING', 'STOPPED'].includes(s.phase) && s; }, 'Worker sleep phase');
  report.finalPhase = asleep.phase;
  assert.equal(held, null, 'Sprite activity hold released after the committed sleep');
  assert.ok(!report.runtimeEvents.some(event => event.event === 'v2.failed'), JSON.stringify(report.runtimeEvents));

  // 6. Clean thread: only message.user / bot.message bubbles, ordered, no duplicates.
  const events = await timeline();
  const thread = events.filter(event => event.type === 'message.user' || event.type === 'bot.message');
  const sequences = thread.map(event => event.sequence);
  assert.deepEqual(sequences, [...sequences].sort((a, b) => a - b));
  assert.equal(new Set(thread.map(event => event.id)).size, thread.length);
  report.thread = thread.map(event => ({ type: event.type, text: event.payload.text, origin: event.payload.origin ?? null,
    task: event.payload.task_run_id ? 'task' : null }));
  // The task's final text is NOT a bubble: the coordinator is woken by the
  // task.event and relays it (A4), so the owner sees the result once. Every
  // bubble is a committed hehebot_send_message.
  assert.deepEqual(report.thread, [
    { type: 'message.user', text: FIRST, origin: null, task: null },
    { type: 'bot.message', text: ACK, origin: 'tool', task: null },
    { type: 'message.user', text: SECOND, origin: null, task: null },
    { type: 'bot.message', text: STATUS, origin: 'tool', task: null },
    { type: 'bot.message', text: RELAY, origin: 'tool', task: null },
  ]);
  assert.equal(new Set(thread.map(event => event.payload.text)).size, thread.length, 'no duplicate bubbles');
  assert.ok(events.some(event => event.type === 'task.event' && event.payload.task_run_id === report.taskRunId && event.payload.status === 'completed'));
  assert.deepEqual(turns, { first: 3, task: 1, second: 3, wake: 2 });
  assert.equal(report.modelRequests, 9);
  assert.deepEqual(errors, []);
  report.status = 'passed';
} catch (error) {
  report.error = error.code ?? error.message;
  report.fixtureErrors = errors;
  await writeFile(join(directory, 'diagnostics.log'), workerLogs + '\n' + errors.join('\n') + '\n' + error.stack, { mode: 0o600 }).catch(() => {});
  process.exitCode = 1;
} finally {
  releaseTask?.();
  if (runtimeServer) await new Promise(ok => runtimeServer.close(ok));
  await runtime?.stop().catch(() => {});
  await stopChild(worker);
  if (modelServer) { modelServer.closeAllConnections(); await new Promise(ok => modelServer.close(ok)); }
  await dispatcher?.close();
  if (report.status === 'passed') await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  else report.privateDiagnostics = directory;
  console.log(JSON.stringify(report, null, 2));
}
