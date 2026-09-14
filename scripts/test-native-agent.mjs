#!/usr/bin/env node
// Deterministic acceptance test for the pinned, unmodified OpenClaw agent loop.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { GatewayTransport } from '../runtime/gateway-transport.mjs';

const root = resolve(import.meta.dirname, '..');
const packageRoot = resolve(process.env.CLAWBOT_OPENCLAW_PACKAGE_ROOT ?? join(root, '.local/native-execution/node_modules/openclaw'));
const entry = join(packageRoot, 'dist/entry.js');
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const checks = [];
let privateDir, gateway, log, fixture, transport;
let modelCalls = 0;
let loopbackModelCalls = 0;
let heldRequests = 0;
let heldClosed = 0;
let externalModelCalls = 0;
const events = [];
const heldResponses = new Map();
const observedRequests = [];
const fixtureErrors = [];
const filePayload = `native-tool-payload-${randomUUID()}\n`;
const followupMarker = `NATIVE_FOLLOWUP_FINAL_${randomUUID()}`;
const interruptMarker = `NATIVE_INTERRUPT_FINAL_${randomUUID()}`;
const steerMarker = `NATIVE_STEER_FINAL_${randomUUID()}`;

function check(name, fn) { fn(); checks.push(name); }
function textOf(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textOf).join(' ');
  if (value && typeof value === 'object') return textOf(value.text ?? value.content ?? '');
  return '';
}
function historyMessages(history) { return Array.isArray(history?.messages) ? history.messages : []; }
function hasText(history, pattern, role) {
  return historyMessages(history).some((message) => (!role || message.role === role) && pattern.test(textOf(message.content)));
}
async function freePort() {
  const server = createServer();
  await new Promise((ok, fail) => server.once('error', fail).listen(0, '127.0.0.1', ok));
  const port = server.address().port;
  await new Promise((ok) => server.close(ok));
  return port;
}
function sendSse(res, chunks) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  for (const chunk of chunks) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  res.end('data: [DONE]\n\n');
}
function completion(id, delta, finishReason = null) {
  return { id, object: 'chat.completion.chunk', created: 1, model: 'fixture-model', choices: [{ index: 0, delta, finish_reason: finishReason }] };
}
async function bodyJson(req) {
  const parts = [];
  for await (const part of req) parts.push(part);
  return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
async function waitFor(predicate, label, timeoutMs = 10_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { if (await predicate()) return; await delay(25); }
  throw new Error(`timed out waiting for ${label}`);
}
async function startGateway(port, env) {
  gateway = spawn(process.execPath, [entry, 'gateway', 'run', '--port', String(port), '--bind', 'loopback'], {
    cwd: privateDir, env, stdio: ['ignore', log.fd, log.fd],
  });
  let exited = false;
  gateway.once('exit', () => { exited = true; });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (exited) throw new Error('native Gateway exited during startup (inspect retained private gateway.log)');
    const ready = await new Promise((done) => {
      const socket = connect(port, '127.0.0.1');
      socket.once('connect', () => { socket.destroy(); done(true); });
      socket.once('error', () => done(false));
    });
    if (ready) return;
    await delay(100);
  }
  throw new Error('native Gateway readiness timed out');
}
async function stopGateway() {
  transport?.close();
  if (!gateway || gateway.exitCode !== null || gateway.signalCode !== null) return true;
  const exited = new Promise((resolveExit) => gateway.once('exit', resolveExit));
  gateway.kill('SIGTERM');
  let confirmed = await Promise.race([exited.then(() => true), delay(2_500).then(() => false)]);
  if (!confirmed) {
    gateway.kill('SIGKILL');
    confirmed = await Promise.race([exited.then(() => true), delay(2_500).then(() => false)]);
  }
  return confirmed && (gateway.exitCode !== null || gateway.signalCode !== null);
}
async function send(sessionKey, message, queueMode) {
  const ack = await transport.request('chat.send', { sessionKey, message, deliver: false, idempotencyKey: randomUUID(), ...(queueMode ? { queueMode } : {}) });
  assert.equal(typeof ack?.runId, 'string');
  return ack.runId;
}
async function waitRun(runId) {
  return transport.request('agent.wait', { runId, timeoutMs: 20_000 }, { timeoutMs: 25_000 });
}
async function history(sessionKey) {
  return transport.request('chat.history', { sessionKey, limit: 100, maxBytes: 1_000_000 });
}
function runEvents(runId) { return events.filter((event) => event.payload?.runId === runId); }
function settledEvent(runId) {
  return runEvents(runId).find((event) => event.event === 'agent' && event.payload?.stream === 'lifecycle' &&
    event.payload?.data?.executionSettled === true && ['end', 'error'].includes(event.payload?.data?.phase));
}
function abortedSettledEvent(runId) {
  const event = settledEvent(runId);
  return event?.payload?.data?.aborted === true || event?.payload?.data?.stopReason === 'aborted' ? event : undefined;
}
function releaseHeld(marker) {
  const held = heldResponses.get(marker);
  assert.ok(held, `no held fixture response for ${marker}`);
  heldResponses.delete(marker);
  held.release();
}
function executionRunForMarker(marker, afterEventIndex = 0) {
  return events.slice(afterEventIndex).find((event) => event.payload?.runId && JSON.stringify(event.payload).includes(marker))?.payload.runId;
}

const gatewayPort = await freePort();
const fixturePort = await freePort();
const token = randomBytes(32).toString('hex');
const report = {
  label: 'deterministic-native-integration', status: 'failed', package: 'openclaw@2026.9.3',
  assertions: checks, externalModelCalls: 0, productionPromotionEligible: false,
};

try {
  const pkg = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '2026.9.3');
  await readFile(entry);
  privateDir = await mkdtemp(join(tmpdir(), 'clawbot-native-agent-'));
  const state = join(privateDir, 'state');
  const workspace = join(privateDir, 'workspace');
  const tempRoot = join(privateDir, 'tmp');
  await Promise.all([mkdir(state), mkdir(workspace), mkdir(tempRoot)]);
  await writeFile(join(workspace, 'fixture.txt'), filePayload);
  await writeFile(join(workspace, 'AGENTS.md'), 'Use tools exactly when requested. Never access a network.\n');

  fixture = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') { res.writeHead(404); res.end(); return; }
    modelCalls++;
    try {
      if (req.socket.remoteAddress === '127.0.0.1' || req.socket.remoteAddress === '::1' || req.socket.remoteAddress === '::ffff:127.0.0.1') loopbackModelCalls++;
      externalModelCalls = modelCalls - loopbackModelCalls;
      const body = await bodyJson(req);
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const all = messages.map((m) => textOf(m.content)).join('\n');
      const latestUser = [...messages].reverse().find((m) => m.role === 'user' && !textOf(m.content).includes('BEGIN_OPENCLAW_INTERNAL_CONTEXT'));
      const latestUserText = textOf(latestUser?.content);
      observedRequests.push({ latestUserText, all, raw: JSON.stringify(messages) });
      const wantsTool = latestUserText.includes('NATIVE_TOOL_REQUEST') || all.includes('NATIVE_STEER_BOUNDARY');
      const wantsSpawn = latestUserText.includes('NATIVE_SPAWN_REQUEST');
      const holdMarker = latestUserText.includes('NATIVE_CHILD_HOLD') ? 'NATIVE_CHILD_HOLD'
        : latestUserText.includes('NATIVE_HOLD_REQUEST') ? 'NATIVE_HOLD_REQUEST'
          : latestUserText.includes('NATIVE_INTERRUPT_HOLD') ? 'NATIVE_INTERRUPT_HOLD'
            : latestUserText.includes('NATIVE_STEER_BOUNDARY') && !messages.some((m) => m.role === 'tool') ? 'NATIVE_STEER_BOUNDARY' : undefined;
      if (holdMarker) {
        heldRequests++;
        res.once('close', () => { if (!res.writableEnded) heldClosed++; });
        heldResponses.set(holdMarker, { release: () => {
          if (holdMarker === 'NATIVE_STEER_BOUNDARY') {
            const id = `fixture-${modelCalls}`;
            sendSse(res, [completion(id, { role: 'assistant', tool_calls: [{ index: 0, id: 'fixturesteerread1', type: 'function', function: { name: 'read', arguments: '{"path":"fixture.txt"}' } }] }), completion(id, {}, 'tool_calls')]);
          } else {
            const id = `fixture-${modelCalls}`;
            sendSse(res, [completion(id, { role: 'assistant', content: 'NATIVE_HELD_RELEASED' }), completion(id, {}, 'stop')]);
          }
        } });
        return;
      }
      const toolResult = [...messages].reverse().find((m) => m.role === 'tool');
      const readResult = wantsTool ? toolResult : undefined;
      const spawnResult = wantsSpawn ? toolResult : undefined;
      const id = `fixture-${modelCalls}`;
      if (wantsTool && !readResult) {
        sendSse(res, [
          completion(id, { role: 'assistant', tool_calls: [{ index: 0, id: 'fixtureread1', type: 'function', function: { name: 'read', arguments: '{"path":"fixture.txt"}' } }] }),
          completion(id, {}, 'tool_calls'),
        ]);
      } else if (wantsSpawn && !spawnResult) {
        sendSse(res, [
          completion(id, { role: 'assistant', tool_calls: [{ index: 0, id: 'fixturespawn1', type: 'function', function: { name: 'sessions_spawn', arguments: JSON.stringify({ task: 'NATIVE_CHILD_HOLD: remain pending until exact cancellation.', taskName: 'native_child_hold', label: 'Quiet deterministic child', runtime: 'subagent', context: 'isolated', mode: 'run', cleanup: 'keep', expectsCompletionMessage: false, runTimeoutSeconds: 30 }) } }] }),
          completion(id, {}, 'tool_calls'),
        ]);
      } else {
        let answer = 'NATIVE_NORMAL_FINAL';
        if (readResult) {
          assert.ok(['fixtureread1', 'fixturesteerread1'].includes(readResult.tool_call_id));
          if (all.includes('NATIVE_STEER_BOUNDARY')) {
            assert.equal(textOf(readResult.content), 'Skipped due to queued user message.');
            assert.match(latestUserText, /NATIVE_STEER/);
            answer = steerMarker;
          } else {
            assert.equal(textOf(readResult.content), filePayload);
            answer = `NATIVE_TOOL_FINAL ${filePayload.trim()}`;
          }
        } else if (spawnResult) {
          assert.equal(spawnResult.tool_call_id, 'fixturespawn1');
          const receiptText = textOf(spawnResult.content);
          assert.match(receiptText, /accepted/); assert.match(receiptText, /childSessionKey/); assert.match(receiptText, /runId/);
          answer = `NATIVE_SPAWN_FINAL ${receiptText}`;
        } else if (latestUserText.includes('NATIVE_FOLLOWUP')) {
          answer = followupMarker;
        } else if (latestUserText.includes('NATIVE_INTERRUPT_REPLACEMENT')) {
          answer = interruptMarker;
        }
        sendSse(res, [completion(id, { role: 'assistant', content: answer }), completion(id, {}, 'stop')]);
      }
    } catch (error) { fixtureErrors.push(String(error)); if (!res.headersSent) res.writeHead(400); res.end(); }
  });
  await new Promise((ok, fail) => fixture.once('error', fail).listen(fixturePort, '127.0.0.1', ok));

  const configPath = join(privateDir, 'openclaw.json');
  await writeFile(configPath, JSON.stringify({
    gateway: { mode: 'local', bind: 'loopback', port: gatewayPort, auth: { mode: 'token', token: '${OPENCLAW_GATEWAY_TOKEN}', allowTailscale: false }, tailscale: { mode: 'off' }, controlUi: { enabled: false } },
    agents: { defaults: { workspace, skipBootstrap: true, timeoutSeconds: 30, maxConcurrent: 1, subagents: { maxConcurrent: 1 }, heartbeat: { every: '0m' }, model: { primary: 'fixture/fixture-model' }, models: { 'fixture/fixture-model': { agentRuntime: { id: 'openclaw' } } } } },
    models: { mode: 'replace', providers: { fixture: { baseUrl: `http://127.0.0.1:${fixturePort}/v1`, apiKey: 'synthetic-local-only', api: 'openai-completions', timeoutSeconds: 30, models: [{ id: 'fixture-model', name: 'Deterministic Fixture', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 1024 }] } } },
    channels: {}, cron: { enabled: false }, plugins: { allow: [] }, discovery: { mdns: { mode: 'off' } }, update: { checkOnStart: false, auto: { enabled: false } }, telemetry: { enabled: false },
  }, null, 2), { mode: 0o600 });
  log = await open(join(privateDir, 'gateway.log'), 'wx', 0o600);
  const env = { PATH: process.env.PATH, HOME: privateDir, TMPDIR: tempRoot, OPENCLAW_HOME: privateDir, OPENCLAW_STATE_DIR: state, OPENCLAW_CONFIG_PATH: configPath, OPENCLAW_GATEWAY_TOKEN: token, OPENCLAW_SKIP_CHANNELS: '1', OPENCLAW_DISABLE_BONJOUR: '1', OPENCLAW_DISABLE_TELEMETRY: '1', NO_COLOR: '1' };
  await startGateway(gatewayPort, env);
  transport = new GatewayTransport({ url: `ws://127.0.0.1:${gatewayPort}`, token, scopes: ['operator.read', 'operator.write', 'operator.admin'], timeoutMs: 10_000, onEvent: (event) => events.push(event) });
  const hello = await transport.connect();
  check('real pinned protocol-4 Gateway', () => { assert.equal(hello.protocol, 4); assert.equal(hello.version, '2026.9.3'); assert.ok(hello.methods.includes('chat.send')); });

  const toolSession = 'agent:main:native-tool';
  const toolRun = await send(toolSession, 'NATIVE_TOOL_REQUEST: read fixture.txt, then report its exact contents.');
  const toolWait = await waitRun(toolRun);
  check('native tool run settled successfully', () => assert.equal(toolWait.status, 'ok'));
  const toolHistory = await history(toolSession);
  check('submitted user turn persisted in native chat.history', () => assert.ok(hasText(toolHistory, /NATIVE_TOOL_REQUEST/, 'user')));
  check('real tool call and result persisted in native chat.history', () => {
    const raw = JSON.stringify(historyMessages(toolHistory));
    assert.match(raw, /fixtureread1/); assert.match(raw, new RegExp(filePayload.trim()));
  });
  check('tool-result continuation final reply persisted', () => assert.ok(hasText(toolHistory, new RegExp(`NATIVE_TOOL_FINAL ${filePayload.trim()}`), 'assistant')));
  check('native lifecycle and tool events observed', () => {
    assert.ok(settledEvent(toolRun));
    const terminalTool = runEvents(toolRun).find((event) => event.event === 'agent' && event.payload?.stream === 'tool' &&
      event.payload?.data?.phase === 'result' && event.payload?.data?.isError === false && event.payload?.data?.result != null);
    assert.ok(terminalTool); assert.match(JSON.stringify(terminalTool.payload.data.result), new RegExp(filePayload.trim()));
  });

  const coordinatorSession = 'agent:main:native-coordinator';
  const spawnRun = await send(coordinatorSession, 'NATIVE_SPAWN_REQUEST: use sessions_spawn exactly as requested.');
  assert.equal((await waitRun(spawnRun)).status, 'ok');
  await waitFor(() => heldRequests === 1, 'quiet isolated child provider request');
  const spawnHistory = await history(coordinatorSession);
  const spawnRaw = JSON.stringify(historyMessages(spawnHistory));
  const spawnReceiptText = historyMessages(spawnHistory).map((message) => textOf(message.content)).find((text) => text.includes('childSessionKey')) ?? '';
  const childSession = spawnReceiptText.match(/"childSessionKey"\s*:\s*"([^"]+)"/)?.[1];
  const childRun = spawnReceiptText.match(/"runId"\s*:\s*"([^"]+)"/)?.[1];
  check('native sessions_spawn accepted an isolated quiet child', () => {
    assert.ok(childSession); assert.ok(childRun); assert.match(spawnRaw, /fixturespawn1/); assert.match(spawnReceiptText, /"status"\s*:\s*"accepted"/);
    assert.ok(settledEvent(spawnRun));
  });
  const statusRun = await send(coordinatorSession, 'Report coordinator status while the quiet child continues.');
  assert.equal((await waitRun(statusRun)).status, 'ok');
  check('main=1 coordinator capacity remained available while subagent=1 quiet child stayed held', () => {
    assert.equal(heldRequests, 1); assert.equal(heldClosed, 0); assert.ok(settledEvent(statusRun));
  });
  const childAbort = await transport.request('chat.abort', { sessionKey: childSession, runId: childRun });
  await waitFor(() => heldClosed === 1, 'exact child provider cleanup');
  const childWait = await waitRun(childRun);
  check('exact quiet child cancellation settled natively without affecting coordinator', () => {
    assert.deepEqual(childAbort?.runIds, [childRun]); assert.equal(childWait.status, 'error'); assert.ok(abortedSettledEvent(childRun));
    assert.ok(hasText(spawnHistory, /NATIVE_SPAWN_FINAL/, 'assistant')); assert.ok(settledEvent(statusRun));
  });

  const heldSession = 'agent:main:native-held';
  const heldRun = await send(heldSession, 'NATIVE_HOLD_REQUEST: remain pending until cancelled.');
  await waitFor(() => heldRequests === 2, 'held local model request');
  const requestsBeforeFollowup = modelCalls;
  const followupEventStart = events.length;
  const followupAck = await send(heldSession, `NATIVE_FOLLOWUP: execute only after the active turn settles and emit ${followupMarker}.`, 'followup');
  await delay(250);
  check('chat.send followup queued without steering the active run', () => {
    assert.notEqual(followupAck, heldRun); assert.equal(modelCalls, requestsBeforeFollowup); assert.equal(heldClosed, 1);
  });
  releaseHeld('NATIVE_HOLD_REQUEST');
  const heldWait = await waitRun(heldRun);
  check('held fixture response was deliberately released and active run settled successfully', () => {
    assert.equal(heldWait.status, 'ok'); assert.ok(settledEvent(heldRun)); assert.equal(heldClosed, 1);
  });
  await waitFor(async () => hasText(await history(heldSession), new RegExp(followupMarker), 'assistant'), 'queued followup final in native history', 20_000);
  await waitFor(() => Boolean(executionRunForMarker(followupMarker, followupEventStart)), 'queued followup execution id');
  const followupExecutionRun = executionRunForMarker(followupMarker, followupEventStart);
  await waitFor(() => Boolean(settledEvent(followupExecutionRun)), 'queued followup executionSettled event');
  const heldHistory = await history(heldSession);
  check('queued followup executed after settlement with native history and its real execution id', () => {
    assert.ok(hasText(heldHistory, /NATIVE_HOLD_REQUEST/, 'user')); assert.ok(hasText(heldHistory, /NATIVE_FOLLOWUP/, 'user'));
    assert.ok(hasText(heldHistory, new RegExp(followupMarker), 'assistant')); assert.ok(settledEvent(followupExecutionRun));
  });

  const interruptSession = 'agent:main:native-interrupt';
  const interruptTarget = await send(interruptSession, 'NATIVE_INTERRUPT_HOLD: wait for exact interrupt.');
  await waitFor(() => heldResponses.has('NATIVE_INTERRUPT_HOLD'), 'interrupt target provider request');
  const interruptEventStart = events.length;
  await send(interruptSession, `NATIVE_INTERRUPT_REPLACEMENT: emit ${interruptMarker}.`, 'interrupt');
  await waitFor(() => heldClosed === 2, 'interrupt target provider abort');
  assert.equal((await waitRun(interruptTarget)).status, 'error');
  await waitFor(async () => hasText(await history(interruptSession), new RegExp(interruptMarker), 'assistant'), 'interrupt replacement final', 20_000);
  const interruptExecution = executionRunForMarker(interruptMarker, interruptEventStart);
  check('queueMode interrupt aborted the exact target and immediately executed replacement', () => {
    assert.ok(abortedSettledEvent(interruptTarget)); assert.ok(interruptExecution); assert.ok(settledEvent(interruptExecution));
  });

  const steerSession = 'agent:main:native-steer';
  const steerEventStart = events.length;
  const steerTargetRun = await send(steerSession, 'NATIVE_STEER_BOUNDARY: begin the held model response then read fixture.txt.');
  await waitFor(() => heldResponses.has('NATIVE_STEER_BOUNDARY'), 'steer model boundary');
  const steerAck = await send(steerSession, `NATIVE_STEER: after the tool boundary emit ${steerMarker}.`, 'steer');
  await delay(250);
  check('steer did not abort the in-flight provider request', () => assert.equal(heldClosed, 2));
  releaseHeld('NATIVE_STEER_BOUNDARY');
  await waitFor(async () => hasText(await history(steerSession), new RegExp(steerMarker), 'assistant'), 'steered final in history', 20_000);
  const steerExecution = executionRunForMarker(steerMarker, steerEventStart) ?? steerTargetRun;
  await waitFor(() => Boolean(settledEvent(steerExecution)), 'steer executionSettled');
  const steerHistory = await history(steerSession);
  check('steer instruction was injected at the real tool/model boundary and persisted', () => {
    assert.ok(observedRequests.some((request) => request.latestUserText.includes('NATIVE_STEER') && request.raw.includes('fixturesteerread1')));
    assert.ok(hasText(steerHistory, new RegExp(steerMarker), 'assistant')); assert.ok(settledEvent(steerExecution));
    assert.notEqual(steerAck, '');
  });
  check('configured provider requests were measured at the loopback fixture', () => { assert.equal(externalModelCalls, 0); assert.equal(loopbackModelCalls, modelCalls); assert.ok(modelCalls >= 7); });
  report.status = 'passed';
  report.modelCalls = modelCalls;
  report.coverage = ['native agent submission/history', 'native read tool success/result/continuation', 'main=1 plus subagent=1 quiet child/coordinator capacity', 'exact child cancellation', 'queued followup execution correlation', 'queueMode interrupt exact abort/replacement', 'steer at tool/model boundary'];
} catch (error) {
  report.error = error instanceof Error ? error.message.replaceAll(token, '[redacted]') : String(error);
  if (fixtureErrors.length) report.fixtureErrors = fixtureErrors;
  report.requestEvidence = observedRequests.slice(-3).map(({ latestUserText, raw }) => ({ latestUserText, hasSteer: raw.includes('NATIVE_STEER'), hasSteerTool: raw.includes('fixturesteerread1') }));
  report.privateEvidence = privateDir ? join(privateDir, 'gateway.log') : undefined;
  process.exitCode = 1;
} finally {
  const shutdownConfirmed = await stopGateway().catch(() => false);
  if (!shutdownConfirmed && gateway) {
    report.status = 'failed'; report.error ??= 'native Gateway shutdown was not confirmed';
    report.privateEvidence = privateDir ? join(privateDir, 'gateway.log') : undefined;
    process.exitCode = 1;
  }
  if (fixture) {
    fixture.closeAllConnections();
    await new Promise((ok) => fixture.close(ok));
  }
  if (log) await log.close().catch(() => {});
  report.externalModelCalls = externalModelCalls;
  report.loopbackModelCalls = loopbackModelCalls;
  report.note = 'deterministic native integration configured and observed through a loopback model fixture; this does not measure global network egress; cannot promote production flags';
  if (report.status === 'passed' && privateDir) await rm(privateDir, { recursive: true, force: true });
  // Public output contains assertion names/counts only; prompts, keys and native logs stay private.
  console.log(JSON.stringify(report, null, 2));
}
