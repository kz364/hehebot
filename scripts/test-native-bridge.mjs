#!/usr/bin/env node
// Credential-free bounded acceptance: real portal/SQLite control plane -> bridge -> pinned OpenClaw.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { ExecutionBridge } from '../runtime/execution-bridge.mjs';
import { ControlClient } from '../runtime/control-client.mjs';
import { FileJournal } from '../runtime/file-journal.mjs';
import { GatewayTransport } from '../runtime/gateway-transport.mjs';
import { OpenClawAdapter } from '../runtime/openclaw-adapter.mjs';

const root = resolve(import.meta.dirname, '..');
const packageRoot = resolve(process.env.CLAWBOT_OPENCLAW_PACKAGE_ROOT ?? join(root, '.local/native-execution/node_modules/openclaw'));
const gatewayEntry = join(packageRoot, 'dist/entry.js');
const delay = ms => new Promise(ok => setTimeout(ok, ms));
const checks = [];
const check = (name, fn) => { fn(); checks.push(name); };
const textOf = value => typeof value === 'string' ? value : Array.isArray(value) ? value.map(textOf).join(' ') : value && typeof value === 'object' ? textOf(value.text ?? value.content ?? '') : '';
const waitFor = async (fn, label, timeout = 20_000) => { const end = Date.now() + timeout; while (Date.now() < end) { const value = await fn(); if (value) return value; await delay(50); } throw new Error(`timed out waiting for ${label}`); };
async function freePort() { const server = createServer(); await new Promise((ok, fail) => server.once('error', fail).listen(0, '127.0.0.1', ok)); const port = server.address().port; await new Promise(ok => server.close(ok)); return port; }
async function bodyJson(req) { const chunks = []; for await (const chunk of req) chunks.push(chunk); return JSON.parse(Buffer.concat(chunks).toString()); }
function chunk(id, delta, finish_reason = null) { return { id, object: 'chat.completion.chunk', created: 1, model: 'fixture-model', choices: [{ index: 0, delta, finish_reason }] }; }
function sse(res, chunks) { res.writeHead(200, { 'content-type': 'text/event-stream' }); for (const item of chunks) res.write(`data: ${JSON.stringify(item)}\n\n`); res.end('data: [DONE]\n\n'); }

const privateDir = await mkdtemp(join(tmpdir(), 'clawbot-native-bridge-'));
const persistence = join(privateDir, 'worker-state');
const runtimeToken = randomBytes(32).toString('hex');
const gatewayToken = randomBytes(32).toString('hex');
const reply = `BRIDGE_NATIVE_REPLY_${randomUUID()}`;
const toolPayload = `BRIDGE_TOOL_EVIDENCE_${randomUUID()}\n`;
let worker, gateway, fixture, gatewayLog, transport;
let workerLogs = '';
let modelCalls = 0;
let loopbackModelCalls = 0;
const nativeEvents = [];
const report = { label: 'bounded-native-bridge-acceptance', status: 'failed', assertions: checks, externalModelCalls: 0, productionPromotionEligible: false };

async function startWorker() {
  const port = await freePort();
  const args = ['node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--env', 'local', '--ip', '127.0.0.1', '--port', String(port), '--persist-to', persistence,
    '--var', 'EXECUTION_ENABLED:true', '--var', 'NATIVE_VERIFIED:true', '--var', `RUNTIME_TOKEN:${runtimeToken}`,
    '--var', `PROVIDER_CONFIG:${JSON.stringify({ provider: 'fake', ref: { provider: 'fake', id: 'native-bridge-fixture' } })}`];
  workerLogs = '';
  worker = spawn(process.execPath, args, { cwd: root, env: { ...process.env, WRANGLER_LOG_PATH: join(privateDir, 'wrangler-logs'), WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
  worker.stdout.on('data', value => { workerLogs += value; }); worker.stderr.on('data', value => { workerLogs += value; });
  await waitFor(() => workerLogs.replace(/\u001b\[[0-9;]*m/g, '').includes(`Ready on http://127.0.0.1:${port}`), 'Worker readiness', 45_000);
  return `http://127.0.0.1:${port}`;
}
async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(ok => child.once('exit', ok));
  child.kill('SIGTERM');
  if (await Promise.race([exited.then(() => true), delay(5000).then(() => false)])) return;
  child.kill('SIGKILL');
  if (!await Promise.race([exited.then(() => true), delay(2000).then(() => false)])) throw new Error('Process shutdown was not confirmed');
}
async function stopWorker() { await stopProcess(worker); }
async function startGateway(port, env) {
  gateway = spawn(process.execPath, [gatewayEntry, 'gateway', 'run', '--port', String(port), '--bind', 'loopback'], { cwd: privateDir, env, stdio: ['ignore', gatewayLog.fd, gatewayLog.fd] });
  await waitFor(async () => new Promise(ok => { const socket = connect(port, '127.0.0.1'); socket.once('connect', () => { socket.destroy(); ok(true); }); socket.once('error', () => ok(false)); }), 'native Gateway readiness');
}
async function stopGateway() { transport?.close(); await stopProcess(gateway); }
function controlFor(base) {
  return new ControlClient({ origin: 'https://control.fixture/', token: runtimeToken, fetchImpl: (url, init) => fetch(base + new URL(url).pathname, init) });
}
async function command(base, persona, key) {
  const payload = { conversation_id: persona, text: 'BRIDGE_TOOL_REQUEST: read fixture.txt and return the fixture-prescribed exact final response.' };
  const response = await fetch(`${base}/v1/commands`, { method: 'POST', headers: { 'content-type': 'application/json', Origin: base, 'Idempotency-Key': key }, body: JSON.stringify({ schema_version: 1, type: 'message.send', payload }) });
  return { status: response.status, value: await response.json() };
}
async function state(base) { const response = await fetch(`${base}/v1/state`); assert.equal(response.status, 200); return response.json(); }
async function timeline(base, persona) { const response = await fetch(`${base}/v1/conversations/${persona}/events`); assert.equal(response.status, 200); return response.json(); }

try {
  const pkg = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '2026.9.3'); await readFile(gatewayEntry);
  const gatewayPort = await freePort(), fixturePort = await freePort();
  const stateDir = join(privateDir, 'openclaw-state'), workspace = join(privateDir, 'workspace'), tempRoot = join(privateDir, 'tmp');
  await Promise.all([mkdir(stateDir), mkdir(workspace), mkdir(tempRoot)]);
  await writeFile(join(workspace, 'fixture.txt'), toolPayload);
  await writeFile(join(workspace, 'AGENTS.md'), 'Use only the explicitly requested local tool. Never access a network.\n');
  fixture = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') { res.writeHead(404); res.end(); return; }
    modelCalls++; if (['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) loopbackModelCalls++;
    const body = await bodyJson(req); const messages = body.messages ?? []; const all = messages.map(message => textOf(message.content)).join('\n');
    const tool = [...messages].reverse().find(message => message.role === 'tool'); const id = `bridge-${modelCalls}`;
    if (all.includes('BRIDGE_TOOL_REQUEST') && !tool) sse(res, [chunk(id, { role: 'assistant', tool_calls: [{ index: 0, id: 'bridgeread1', type: 'function', function: { name: 'read', arguments: '{"path":"fixture.txt"}' } }] }), chunk(id, {}, 'tool_calls')]);
    else { assert.equal(tool?.tool_call_id, 'bridgeread1'); assert.equal(textOf(tool.content), toolPayload); sse(res, [chunk(id, { role: 'assistant', content: reply }), chunk(id, {}, 'stop')]); }
  });
  await new Promise((ok, fail) => fixture.once('error', fail).listen(fixturePort, '127.0.0.1', ok));
  const configPath = join(privateDir, 'openclaw.json');
  await writeFile(configPath, JSON.stringify({ gateway: { mode: 'local', bind: 'loopback', port: gatewayPort, auth: { mode: 'token', token: '${OPENCLAW_GATEWAY_TOKEN}', allowTailscale: false }, tailscale: { mode: 'off' }, controlUi: { enabled: false } }, agents: { defaults: { workspace, skipBootstrap: true, timeoutSeconds: 30, maxConcurrent: 1, heartbeat: { every: '0m' }, model: { primary: 'openai/fixture-model' }, models: { 'openai/fixture-model': { agentRuntime: { id: 'openclaw' } } } } }, models: { mode: 'replace', providers: { openai: { baseUrl: `http://127.0.0.1:${fixturePort}/v1`, apiKey: 'synthetic-local-only', api: 'openai-completions', models: [{ id: 'fixture-model', name: 'Bridge Fixture', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 1024 }] } } }, channels: {}, cron: { enabled: false }, plugins: { allow: [] }, discovery: { mdns: { mode: 'off' } }, update: { checkOnStart: false, auto: { enabled: false } }, telemetry: { enabled: false } }, null, 2), { mode: 0o600 });
  gatewayLog = await open(join(privateDir, 'gateway.log'), 'wx', 0o600);
  await startGateway(gatewayPort, { PATH: process.env.PATH, HOME: privateDir, TMPDIR: tempRoot, OPENCLAW_HOME: privateDir, OPENCLAW_STATE_DIR: stateDir, OPENCLAW_CONFIG_PATH: configPath, OPENCLAW_GATEWAY_TOKEN: gatewayToken, OPENCLAW_SKIP_CHANNELS: '1', OPENCLAW_DISABLE_BONJOUR: '1', OPENCLAW_DISABLE_TELEMETRY: '1', NO_COLOR: '1' });
  transport = new GatewayTransport({ url: `ws://127.0.0.1:${gatewayPort}`, token: gatewayToken, scopes: ['operator.read', 'operator.write', 'operator.admin'], timeoutMs: 15_000, onEvent: event => nativeEvents.push(event) });
  const hello = await transport.connect(); check('pristine pinned OpenClaw protocol-4 Gateway connected', () => { assert.equal(hello.protocol, 4); assert.equal(hello.version, '2026.9.3'); });

  let base = await startWorker(); const initial = await state(base); const persona = initial.objects.find(object => object.kind === 'persona').id;
  const ingressKey = randomUUID(), sent = await command(base, persona, ingressKey), duplicate = await command(base, persona, ingressKey);
  check('portal HTTP ingress accepted and deduplicated before execution', () => { assert.equal(sent.status, 202); assert.equal(duplicate.status, 202); assert.equal(duplicate.value.id, sent.value.id); assert.equal(duplicate.value.resource_id, sent.value.resource_id); });
  const control = controlFor(base);
  await waitFor(async () => (await control.request('status', {})).phase === 'BOOTING', 'fake test provider boot transition', 15_000);
  const identity = await control.request('boot', { boot_id: randomUUID() }); await control.request('ready', { identity });
  const nativeJournal = new FileJournal(join(privateDir, 'native-journal'));
  const native = new OpenClawAdapter({ testMode: true, journal: nativeJournal, rpc: (method, params) => transport.request(method, params, { timeoutMs: 30_000 }) });
  const bridge = new ExecutionBridge({ control, native, journal: new FileJournal(join(privateDir, 'bridge-journal')), identity, installationId: 'local-only', personas: { [persona]: { agentId: 'main', model: 'openai/fixture-model' } } });
  const row = await bridge.claimNext();
  check('actual SQLite Worker claim and submitted transitions reached running', () => assert.equal(row.phase, 'running'));
  const nativeWait = await transport.request('agent.wait', { runId: row.nativeRunId, timeoutMs: 20_000 }, { timeoutMs: 25_000 }); assert.equal(nativeWait.status, 'ok');
  const nativeRow = await nativeJournal.get(row.attemptId);
  const history = await transport.request('chat.history', { sessionKey: nativeRow.sessionKey, limit: 100, maxBytes: 1_000_000 });
  const messages = history.messages ?? [], rawHistory = JSON.stringify(messages);
  const settled = nativeEvents.find(event => event.event === 'agent' && event.payload?.runId === row.nativeRunId && event.payload?.stream === 'lifecycle' && event.payload?.data?.executionSettled === true && event.payload?.data?.phase === 'end');
  const toolResult = nativeEvents.find(event => event.event === 'agent' && event.payload?.runId === row.nativeRunId && event.payload?.stream === 'tool' && event.payload?.data?.phase === 'result' && event.payload?.data?.isError === false);
  check('native terminal, successful real tool result, and persisted history independently observed', () => { assert.ok(settled); assert.ok(toolResult); assert.match(JSON.stringify(toolResult), new RegExp(toolPayload.trim())); assert.match(rawHistory, /bridgeread1/); assert.ok(messages.some(message => message.role === 'assistant' && textOf(message.content) === reply)); });
  await bridge.complete({ attemptId: row.attemptId, nativeRunId: row.nativeRunId, rootSettled: Boolean(settled), toolsSettled: Boolean(toolResult), childrenSettled: true, effectsSettled: true, outputCommitted: true, result: { status: 'completed', text: reply } });
  const beforeRestart = await timeline(base, persona);
  check('exact assistant reply persisted once by Worker completion', () => assert.deepEqual(beforeRestart.events.filter(event => event.type === 'run.result').map(event => event.payload.text), [reply]));

  await stopWorker(); base = await startWorker();
  const afterRestart = await timeline(base, persona), duplicateAfterRestart = await command(base, persona, ingressKey);
  check('SQLite restart retained exact reply and ingress dedupe receipt', () => { assert.deepEqual(afterRestart.events.filter(event => event.type === 'run.result').map(event => event.payload.text), [reply]); assert.equal(duplicateAfterRestart.value.id, sent.value.id); assert.equal(duplicateAfterRestart.value.resource_id, sent.value.resource_id); });
  check('all model calls stayed at scripted loopback provider', () => { assert.equal(modelCalls, 2); assert.equal(loopbackModelCalls, modelCalls); });
  report.status = 'passed'; report.modelCalls = modelCalls; report.coverage = ['portal ingress/dedupe', 'Worker SQLite claim/submitted/complete', 'native tool/lifecycle/history', 'exact persisted reply', 'Worker restart persistence'];
} catch (error) {
  report.error = error instanceof Error ? error.message.replaceAll(runtimeToken, '[redacted]').replaceAll(gatewayToken, '[redacted]') : String(error);
  report.privateEvidence = join(privateDir, 'gateway.log'); process.exitCode = 1;
} finally {
  const shutdown = await Promise.allSettled([stopWorker(), stopGateway()]);
  if (shutdown.some(result => result.status === 'rejected')) {
    report.status = 'failed'; report.error = 'Process shutdown was not confirmed';
    report.privateEvidence = privateDir; process.exitCode = 1;
  }
  if (fixture) { fixture.closeAllConnections(); await new Promise(ok => fixture.close(ok)); }
  if (gatewayLog) await gatewayLog.close().catch(() => {});
  report.externalModelCalls = modelCalls - loopbackModelCalls;
  report.note = 'Test-only Worker flags and FakeProvider lifecycle plus adapter testMode are process-local. Settlement booleans are fixture-specific evidence derived from this root lifecycle/tool/history; this is not a generic supervisor, global egress proof, sleep proof, or production promotion.';
  if (report.status === 'passed') await rm(privateDir, { recursive: true, force: true });
  console.log(JSON.stringify(report, null, 2));
}
