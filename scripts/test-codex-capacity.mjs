#!/usr/bin/env node
// Supported-native behavior only: scripted loopback, no Worker or account state.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CodexTransport } from '../runtime/codex-transport.mjs';

const binary = resolve(import.meta.dirname, '../.local/codex-runtime/node_modules/.bin/codex');
const maxDepth = 3;
const directory = await mkdtemp(join(tmpdir(), 'hehe-capacity-'));
const evidence = await mkdtemp(resolve(import.meta.dirname, '../.local/capacity-proof-'));
const trace = []; let traceBytes = 0;
const sha = value => createHash('sha256').update(value).digest('hex');
function capture(kind, value) {
  const line = JSON.stringify({ kind, value }) + '\n'; traceBytes += Buffer.byteLength(line);
  assert.ok(traceBytes <= 16 * 1024 * 1024, 'bounded private trace'); trace.push(line);
}
class ObservedTransport extends CodexTransport {
  receive(message) { capture('native.receive', message); super.receive(message); }
  write(message) { capture('native.send', message); super.write(message); }
}
const home = join(directory, 'home'), cwd = join(directory, 'workspace');
await mkdir(home, { mode: 0o700 }); await mkdir(cwd, { mode: 0o700 });
const env = { PATH: process.env.PATH, LANG: 'C.UTF-8', HOME: home, CODEX_HOME: home };
const report = { status: 'failed', version: null, assertions: [], requests: 0, externalModelRequests: 0,
  workerAdmissionProved: false, installationWideLimitProved: false, assistantOperational: false,
  modelUnderstandingProved: false, p03Complete: false, productionEnabled: false };
const check = (name, fn) => { fn(); report.assertions.push(name); };
const sleep = ms => new Promise(ok => setTimeout(ok, ms));
async function wait(fn, label, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await sleep(25); }
  throw Error(`Timed out: ${label}`);
}
let transport, server, nativeLog = '';
const notifications = [], errors = [], held = new Map(), shapes = [];
const active = new Map();
let parentThread, childThread, grandchildThread, childSpawnResult;
const marker = label => `CAPACITY_${label}`;
function hold(label, res, body) {
  assert.equal(held.has(label), false, `duplicate held request: ${label}`);
  const row = { closed: false, res, inputHash: sha(JSON.stringify(body.input)) }; held.set(label, row);
  res.once('close', () => { row.closed = true; });
}
function send(res, output) {
  const response = { id: `resp_${randomUUID()}`, object: 'response', created_at: 1, status: 'completed',
    error: null, incomplete_details: null, model: 'fixture-model', output, tools: [], parallel_tool_calls: true,
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
  capture('model.response', response);
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const event = (type, fields) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`);
  event('response.created', { response: { ...response, status: 'in_progress', output: [] } });
  output.forEach((item, output_index) => {
    event('response.output_item.added', { output_index, item });
    if (item.type === 'function_call') event('response.function_call_arguments.done', { output_index, item_id: item.id, arguments: item.arguments });
    event('response.output_item.done', { output_index, item });
  });
  event('response.completed', { response }); res.end('data: [DONE]\n\n');
}
function spawnOutput(body, label) {
  const tool = body.tools.find(tool => tool.name === 'spawn_agent' || tool.tools?.some(item => item.name === 'spawn_agent'));
  assert.ok(tool, 'supported spawn_agent is advertised');
  report.spawnNamespace = tool.type === 'namespace' ? tool.name : null;
  const parameters = (tool.tools?.find(item => item.name === 'spawn_agent') ?? tool).parameters;
  assert.deepEqual(parameters.required, ['task_name', 'message']);
  return [{ id: `fc_${randomUUID()}`, type: 'function_call', status: 'completed', call_id: `call_${randomUUID()}`,
    ...(tool.type === 'namespace' ? { namespace: tool.name } : {}), name: 'spawn_agent',
    arguments: JSON.stringify({ message: marker(label), task_name: label.toLowerCase(), fork_turns: 'all' }) }];
}
async function interrupt(threadId, turnId) {
  await transport.request('turn/interrupt', { threadId, turnId });
  await wait(() => notifications.some(n => n.method === 'turn/completed' && n.params.threadId === threadId &&
    n.params.turn.id === turnId && n.params.turn.status === 'interrupted'), 'exact interrupted event');
}
const message = text => [{ id: `msg_${randomUUID()}`, type: 'message', status: 'completed', role: 'assistant',
  content: [{ type: 'output_text', text, annotations: [] }] }];
const completed = target => notifications.some(n => n.method === 'turn/completed' && n.params.threadId === target.threadId &&
  n.params.turn.id === target.turnId && n.params.turn.status === 'completed');
const watchdog = setTimeout(() => { errors.push('FIXTURE_DEADLINE'); transport?.child.kill('SIGKILL'); server?.closeAllConnections(); }, 90000);
watchdog.unref();
try {
  const version = await promisify(execFile)(binary, ['--version'], { env, cwd, timeout: 10000 });
  report.version = version.stdout.trim(); assert.equal(report.version, 'codex-cli 0.154.0');
  server = createServer(async (req, res) => {
    try {
      assert.equal(req.url, '/v1/responses'); assert.equal(req.method, 'POST');
      const chunks = []; let bytes = 0;
      for await (const chunk of req) { bytes += chunk.length; assert.ok(bytes <= 2097152); chunks.push(chunk); }
      const body = JSON.parse(Buffer.concat(chunks)); report.requests++; assert.ok(report.requests <= 12);
      capture('model.request', body);
      const user = body.input.filter(item => item.role === 'user' || item.type === 'agent_message').map(item => JSON.stringify(item.content)).join('\n');
      const label = ['STATUS97', 'TASK_B', 'GRAND71', 'CHILD43', 'PARENT19', 'ROOT_A', 'ROOT_B'].find(label => user.includes(marker(label)));
      assert.ok(label, 'exact fixture marker');
      const taskIndex = body.input.findLastIndex(item => item.type === 'agent_message');
      const output = body.input.slice(taskIndex + 1).filter(item => item.type === 'function_call_output').at(-1);
      shapes.push({ label, continuation: Boolean(output) });
      if (label === 'STATUS97') {
        assert.equal(body.input.filter(item => item.role === 'user' && JSON.stringify(item.content).includes(marker('STATUS97'))).length, 1);
        send(res, message('SCRIPTED_STATUS: task A remains held; no task instruction changed.')); return;
      }
      if (label.startsWith('ROOT_') || label === 'GRAND71' || label === 'TASK_B') { hold(label, res, body); return; }
      if (label === 'CHILD43') {
        report.childToolNames = body.tools.flatMap(tool => tool.tools ?? [tool]).map(tool => tool.name);
        report.unnamedChildTools = body.tools.filter(tool => !tool.name);
      }
      if (label === 'CHILD43' && !body.tools.some(tool => tool.name === 'spawn_agent' || tool.tools?.some(item => item.name === 'spawn_agent'))) {
        report.childSpawnToolAvailable = false; hold(label, res, body); return;
      }
      if (!output) { send(res, spawnOutput(body, label === 'PARENT19' ? 'CHILD43' : 'GRAND71')); return; }
      if (label === 'PARENT19') {
        report.parentSpawnToolAfterChild = body.tools.some(tool => tool.name === 'spawn_agent' || tool.tools?.some(item => item.name === 'spawn_agent'));
        report.parentSpawnReceipt = output.output;
        assert.doesNotMatch(String(output.output), /failed to parse/, String(output.output));
        assert.equal(JSON.parse(output.output).task_name, '/root/child43');
      } else {
        childSpawnResult = String(output.output);
        try { grandchildThread = JSON.parse(childSpawnResult).task_name; } catch { /* Supported tool failures may be text. */ }
      }
      hold(label, res, body);
    } catch (error) { errors.push(error.message); if (!res.headersSent) res.writeHead(400); res.end(); }
  });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  await writeFile(join(home, 'config.toml'), `model = "fixture-model"\nmodel_provider = "fixture"\n[features]\ncode_mode = false\nmulti_agent_v2 = true\n[agents]\nmax_concurrent_threads_per_session = 1\nmax_depth = ${maxDepth}\n[model_providers.fixture]\nname = "Loopback only"\nbase_url = "http://127.0.0.1:${server.address().port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`, { mode: 0o600 });
  const features = await promisify(execFile)(binary, ['features', 'list'], { env, cwd, timeout: 10000 });
  report.featureLine = features.stdout.split('\n').find(line => /^multi_agent_v2\s/.test(line));
  assert.match(report.featureLine, /true\s*$/);
  const child = spawn(binary, ['app-server', '--strict-config', '--listen', 'stdio://'], { env, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  transport = new ObservedTransport(child, { timeoutMs: 10000 });
  child.stderr.on('data', chunk => { nativeLog += chunk; });
  transport.on('notification', n => {
    notifications.push(n);
    if (n.method === 'turn/started') active.set(n.params.threadId, n.params.turn.id);
    if (n.method === 'turn/completed') active.delete(n.params.threadId);
  });
  await transport.initialize();
  const config = await transport.request('config/read', { includeLayers: false, cwd });
  check('strict-config accepts V2 and the per-session concurrent-thread limit', () => {
    assert.equal(config.config.features.multi_agent_v2, true);
    assert.equal(config.config.agents.max_concurrent_threads_per_session, 1);
    assert.equal(config.config.agents.max_depth, maxDepth);
    report.configuredMaxDepth = maxDepth;
  });
  const start = async label => {
    const { thread } = await transport.request('thread/start', { cwd, model: 'fixture-model', approvalPolicy: 'untrusted', sandbox: 'read-only', ephemeral: false });
    const { turn } = await transport.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: marker(label) }] });
    return { threadId: thread.id, turnId: turn.id };
  };
  const a = await start('ROOT_A'); await wait(() => held.has('ROOT_A'), 'first root held');
  const b = await start('ROOT_B'); await wait(() => held.has('ROOT_B'), 'second root held concurrently');
  check('two native roots overlap held responses despite per-session limit1', () => {
    assert.notEqual(a.threadId, b.threadId); assert.notEqual(a.turnId, b.turnId);
    assert.equal(held.get('ROOT_A').closed, false); assert.equal(held.get('ROOT_B').closed, false);
  });
  await interrupt(a.threadId, a.turnId); await wait(() => held.get('ROOT_A').closed, 'first root connection closed');
  check('first exact interrupt leaves second root HTTP request and turn active', () => {
    assert.equal(held.get('ROOT_B').closed, false); assert.equal(active.get(b.threadId), b.turnId);
  });
  await interrupt(b.threadId, b.turnId); await wait(() => held.get('ROOT_B').closed, 'second root connection closed');
  report.nativeRootOverlap = true; report.exactRootInterrupts = 2;
  const parent = await start('PARENT19'); parentThread = parent.threadId;
  await wait(() => held.has('PARENT19'), 'parent spawn receipt');
  childThread = await wait(() => [...active.keys()].find(id => id !== parentThread), 'child turn identity');
  report.childSource = (await transport.request('thread/read', { threadId: childThread, includeTurns: false })).thread.source;
  const childFeatures = await transport.request('experimentalFeature/list', { threadId: childThread, limit: 100 });
  report.childV2Feature = childFeatures.data.find(feature => feature.name === 'multi_agent_v2');
  report.childMultiAgentFeature = childFeatures.data.find(feature => feature.name === 'multi_agent');
  check('V2 child readback identifies the exact parent and task path with both features enabled', () => {
    assert.equal(report.childSource.subAgent.thread_spawn.parent_thread_id, parentThread);
    assert.equal(report.childSource.subAgent.thread_spawn.agent_path, '/root/child43');
    assert.equal(report.childV2Feature.enabled, true); assert.equal(report.childMultiAgentFeature.enabled, true);
  });
  await wait(() => active.has(childThread), 'exact child turn started');
  await wait(() => held.has('CHILD43') || held.has('GRAND71'), 'child spawn result or grandchild model start');
  check('root and child overlap independently of root-turn accounting', () => {
    assert.equal(held.get('PARENT19').closed, false); assert.ok(active.has(parentThread)); assert.ok(active.has(childThread));
    assert.equal(held.get('CHILD43').closed, false);
  });
  report.childSpawnResult = childSpawnResult ?? null;
  report.grandchildModelStarted = held.has('GRAND71');
  report.grandchildTaskAcknowledged = typeof grandchildThread === 'string';
  if (report.childSpawnToolAvailable === false) report.grandchildDispatch = 'unsupported: child spawn tool absent';
  else if (!report.grandchildModelStarted && !report.grandchildTaskAcknowledged) {
    assert.match(childSpawnResult, /limit|maximum|concurr|capacity/i);
    report.grandchildDispatch = 'rejected by native capacity';
  } else report.grandchildDispatch = 'observed; inspect supported V2 semantics';
  const taskA = { threadId: childThread, turnId: active.get(childThread) };
  const taskABefore = (await transport.request('thread/read', { threadId: childThread, includeTurns: true })).thread;
  const inputHash = held.get('CHILD43').inputHash;
  const unchangedA = () => {
    assert.equal(active.get(taskA.threadId), taskA.turnId);
    assert.equal(held.get('CHILD43').closed, false);
    assert.equal(held.get('CHILD43').inputHash, inputHash);
    assert.equal(shapes.filter(row => row.label === 'CHILD43').length, 1);
    assert.equal(notifications.some(n => n.method === 'turn/completed' && n.params.threadId === taskA.threadId), false);
  };
  send(held.get('PARENT19').res, message('SCRIPTED_COORDINATOR_DONE: task A continues independently.'));
  await wait(() => completed(parent), 'coordinator completes while child held');
  check('completed coordinator leaves exact task A turn and original model input held', unchangedA);
  const statusInput = `${marker('STATUS97')}: What is the status of task A? Do not change it.`;
  const { turn: statusTurn } = await transport.request('turn/start', { threadId: parentThread, input: [{ type: 'text', text: statusInput }] });
  const status = { threadId: parentThread, turnId: statusTurn.id };
  await wait(() => completed(status), 'separate status turn completes');
  check('separate status turn completes on coordinator without steering or interrupting A', () => {
    assert.notEqual(status.turnId, parent.turnId); unchangedA();
    const sent = trace.map(line => JSON.parse(line)).filter(row => row.kind === 'native.send').map(row => row.value);
    assert.equal(sent.some(row => row.method === 'turn/steer'), false);
    assert.equal(sent.some(row => row.method === 'turn/interrupt' && row.params.threadId === taskA.threadId), false);
  });
  const taskB = await start('TASK_B'); await wait(() => held.has('TASK_B'), 'independent task B held');
  check('independent root B is natively admitted while A remains held', () => {
    assert.notEqual(taskB.threadId, parentThread); assert.notEqual(taskB.threadId, taskA.threadId);
    assert.equal(active.get(taskB.threadId), taskB.turnId); unchangedA();
  });
  await interrupt(taskB.threadId, taskB.turnId); await wait(() => held.get('TASK_B').closed, 'target B closed');
  check('exact cancellation of independent B leaves A unchanged and un-interrupted', unchangedA);
  const taskAAfter = (await transport.request('thread/read', { threadId: childThread, includeTurns: true })).thread;
  check('native A history readback preserves exact source, input items and turn through status and B cancellation', () => {
    assert.deepEqual(taskAAfter.source, taskABefore.source);
    assert.deepEqual(taskAAfter.turns, taskABefore.turns);
    assert.ok(taskABefore.turns.some(turn => turn.id === taskA.turnId && turn.status === 'inProgress'));
  });
  report.responsiveness = { coordinator: parent, status, statusInput, taskA, taskAInputSha256: inputHash,
    taskAHistorySha256: sha(JSON.stringify(taskABefore.turns)),
    taskASource: report.childSource, taskB, taskBKind: 'independent root, not same-session child',
    coordinatorCompleted: true, statusCompleted: true, taskAUnchangedThroughBCancellation: true };
  await interrupt(childThread, taskA.turnId);
  if (held.has('CHILD43')) await wait(() => held.get('CHILD43').closed, 'child response closed');
  await wait(() => held.get('PARENT19').closed, 'parent response closed');
  for (const [threadId, turnId] of [...active]) await interrupt(threadId, turnId);
  check('all observed turns terminated and all five held connections closed before process shutdown', () => {
    assert.equal(active.size, 0); assert.equal(held.size, 5); assert.ok([...held.values()].every(row => row.closed));
  });
  assert.deepEqual(errors, []);
  report.status = 'passed';
} catch (error) {
  report.error = error.message; report.requestShapes = shapes; report.fixtureErrors = errors;
  report.identities = notifications.filter(n => ['thread/started', 'turn/started'].includes(n.method)).map(n => ({ method: n.method,
    threadId: n.params.threadId ?? n.params.thread?.id, turnId: n.params.turn?.id, source: n.params.thread?.source }));
  await writeFile(join(directory, 'diagnostics.log'), nativeLog, { mode: 0o600 });
  report.privateDiagnostics = directory; process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  if (transport) {
    transport.close();
    const child = transport.child, stopped = () => child.exitCode !== null || child.signalCode !== null;
    try { await wait(stopped, 'native stop', 5000); }
    catch { child.kill('SIGKILL'); try { await wait(stopped, 'forced native stop', 3000); } catch { report.status = 'failed'; report.cleanupError = 'NATIVE_STOP_UNCONFIRMED'; process.exitCode = 1; } }
    report.nativeStopped = stopped();
  }
  if (server) { server.closeAllConnections(); await new Promise(ok => server.close(ok)); }
  report.heldRequests = held.size; report.closedRequests = [...held.values()].filter(row => row.closed).length;
  await writeFile(join(evidence, 'trace.jsonl'), trace.join(''), { mode: 0o600 });
  await writeFile(join(evidence, 'native.log'), nativeLog, { mode: 0o600 });
  report.traceSha256 = sha(trace.join('')); report.privateEvidence = evidence;
  if (report.status === 'passed') await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  await writeFile(join(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
}
