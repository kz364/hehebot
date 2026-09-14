#!/usr/bin/env node
// Deterministic acceptance test for the pinned, unmodified Codex app-server.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnCodex } from '../runtime/codex-transport.mjs';

const root = resolve(import.meta.dirname, '..');
const binary = join(root, '.local/codex-runtime/node_modules/.bin/codex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const marker = `CODEX_NATIVE_${randomUUID()}`;
const payload = `left-${randomUUID()}-RIGHT`;
let home, workspace, fixture, transport;
let requests = 0;
let toolContinuations = 0;
let heldRequests = 0;
let heldClosed = 0;
const bodies = [];
const notifications = [];
const nativeErrors = [];
const fixtureErrors = [];
const held = new Map();

function response(id, output) {
  return { id, object: 'response', created_at: 1, status: 'completed', error: null,
    incomplete_details: null, instructions: null, model: 'fixture-model', output,
    parallel_tool_calls: true, temperature: null, tool_choice: 'auto', tools: [],
    top_p: null, background: false, max_output_tokens: null, max_tool_calls: null,
    previous_response_id: null, prompt: null, reasoning: { effort: null, summary: null },
    service_tier: 'default', store: false, text: { format: { type: 'text' } },
    truncation: 'disabled', usage: { input_tokens: 1, input_tokens_details: { cached_tokens: 0 }, output_tokens: 1, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 2 }, user: null, metadata: {} };
}

function sendEvents(res, output) {
  const id = `resp_${randomUUID().replaceAll('-', '')}`;
  const completed = response(id, output);
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  send('response.created', { response: { ...completed, status: 'in_progress', output: [] } });
  output.forEach((item, output_index) => {
    send('response.output_item.added', { output_index, item: { ...item, ...(item.type === 'message' ? { content: [] } : item.type === 'function_call' ? { arguments: '' } : {}) } });
    if (item.type === 'function_call') send('response.function_call_arguments.done', { output_index, item_id: item.id, arguments: item.arguments });
    if (item.type === 'message') {
      const text = item.content[0].text;
      send('response.content_part.added', { item_id: item.id, output_index, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
      send('response.output_text.delta', { item_id: item.id, output_index, content_index: 0, delta: text });
      send('response.output_text.done', { item_id: item.id, output_index, content_index: 0, text });
      send('response.content_part.done', { item_id: item.id, output_index, content_index: 0, part: item.content[0] });
    }
    send('response.output_item.done', { output_index, item });
  });
  send('response.completed', { response: completed });
  res.end('data: [DONE]\n\n');
}

function message(text) {
  return [{ id: `msg_${randomUUID().replaceAll('-', '')}`, type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text, annotations: [], logprobs: [] }] }];
}

async function readBody(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 2 * 1024 * 1024) throw new Error('Fixture request exceeds limit');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function waitFor(predicate, label, timeout = 10_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (predicate()) return; await sleep(20); }
  throw new Error(`timeout waiting for ${label}`);
}

async function waitTurn(turnId, timeout = 15_000) {
  await waitFor(() => notifications.some(n => n.method === 'turn/completed' && n.params?.turn?.id === turnId), `turn/completed ${turnId}`, timeout);
  return notifications.find(n => n.method === 'turn/completed' && n.params?.turn?.id === turnId).params.turn;
}

function transcript(thread) { return JSON.stringify(thread); }

const report = { status: 'failed', codex: '0.154.0', requests: 0, toolContinuations: 0, heldRequests: 0, heldClosed: 0 };
try {
  const version = await promisify(execFile)(binary, ['--version'], { timeout: 10000 });
  assert.equal(version.stdout.trim(), 'codex-cli 0.154.0');
  home = await mkdtemp(join(tmpdir(), 'clawbot-codex-native-'));
  await chmod(home, 0o700);
  workspace = join(home, 'workspace');
  await mkdir(workspace, { mode: 0o700 });
  const fixturePath = join(workspace, 'asymmetric-fixture.txt');
  await writeFile(fixturePath, `${payload}\n`, { mode: 0o600 });

  fixture = createServer(async (req, res) => {
    try {
    if (req.method !== 'POST' || req.url !== '/v1/responses' || requests >= 8) { res.writeHead(requests >= 8 ? 429 : 404); res.end(); return; }
    requests++;
    const body = await readBody(req);
    bodies.push(body);
    const input = Array.isArray(body.input) ? body.input : [];
    const raw = JSON.stringify(input);
    if (raw.includes('HOLD_NATIVE_TURN')) {
      heldRequests++;
      res.once('close', () => { if (!res.writableEnded) heldClosed++; });
      held.set(heldRequests, res);
      return;
    }
    const output = input.find(item => item?.type === 'function_call_output');
    if (output) {
      toolContinuations++;
      assert.match(String(output.output), new RegExp(payload));
      sendEvents(res, message(`${marker}:${payload}`));
      return;
    }
    if (raw.includes('READ_ASYMMETRIC_FIXTURE')) {
      const call = `call_${randomUUID().replaceAll('-', '')}`;
      sendEvents(res, [{ id: `fc_${randomUUID().replaceAll('-', '')}`, type: 'function_call', status: 'completed', call_id: call,
        name: 'exec_command', arguments: JSON.stringify({ cmd: `cat ${JSON.stringify(fixturePath)}`, yield_time_ms: 1000, max_output_chars: 2000 }) }]);
      return;
    }
    sendEvents(res, message('SEPARATE_THREAD_OK'));
    } catch (error) {
      fixtureErrors.push(error.message);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  await new Promise((resolveListen, reject) => fixture.once('error', reject).listen(0, '127.0.0.1', resolveListen));
  const port = fixture.address().port;
  await writeFile(join(home, 'config.toml'), `model = "fixture-model"\nmodel_provider = "fixture"\napproval_policy = "never"\nsandbox_mode = "read-only"\n\n[model_providers.fixture]\nname = "Loopback fixture"\nbase_url = "http://127.0.0.1:${port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`, { mode: 0o600 });

  transport = spawnCodex({ binary, home, cwd: workspace, timeoutMs: 10_000 });
  transport.child.stderr.on('data', chunk => nativeErrors.push(chunk.toString('utf8')));
  transport.on('notification', notification => notifications.push(notification));
  await transport.initialize();
  const started = await transport.request('thread/start', { cwd: workspace, model: 'fixture-model', modelProvider: 'fixture', approvalPolicy: 'never', sandbox: 'read-only' });
  const threadId = started.thread.id;
  const turn = await transport.request('turn/start', { threadId, input: [{ type: 'text', text: 'READ_ASYMMETRIC_FIXTURE. Use exec_command to cat the named fixture and then return only the required exact marker plus contents.' }] });
  const completed = await waitTurn(turn.turn.id);
  assert.equal(completed.status, 'completed');
  assert.ok(notifications.some(n => n.method === 'item/completed' && n.params?.item?.type === 'commandExecution' && n.params.item.status === 'completed' && n.params.item.exitCode === 0 && n.params.item.aggregatedOutput?.includes(payload)));
  const read = await transport.request('thread/read', { threadId, includeTurns: true });
  const persistedItems = read.thread.turns.flatMap(savedTurn => savedTurn.items);
  assert.ok(persistedItems.some(item => item.type === 'agentMessage' && item.text === `${marker}:${payload}`));
  assert.match(transcript(read.thread), /commandExecution/);

  const heldThread = (await transport.request('thread/start', { cwd: workspace, modelProvider: 'fixture' })).thread.id;
  const heldTurn = (await transport.request('turn/start', { threadId: heldThread, input: [{ type: 'text', text: 'HOLD_NATIVE_TURN' }] })).turn.id;
  await waitFor(() => heldRequests === 1, 'held provider request');
  const separateThread = (await transport.request('thread/start', { cwd: workspace, modelProvider: 'fixture' })).thread.id;
  const separateTurn = (await transport.request('turn/start', { threadId: separateThread, input: [{ type: 'text', text: 'Answer independently.' }] })).turn.id;
  assert.equal((await waitTurn(separateTurn)).status, 'completed');
  const separateRead = await transport.request('thread/read', { threadId: separateThread, includeTurns: true });
  assert.ok(separateRead.thread.turns.flatMap(turn => turn.items).some(item => item.type === 'agentMessage' && item.text === 'SEPARATE_THREAD_OK'));
  await transport.request('turn/interrupt', { threadId: heldThread, turnId: heldTurn });
  assert.equal((await waitTurn(heldTurn)).status, 'interrupted');
  await waitFor(() => heldClosed === 1, 'held HTTP request closure');

  assert.equal(requests, 4);
  assert.equal(toolContinuations, 1);
  assert.deepEqual(fixtureErrors, []);
  assert.ok(bodies.every(body => body.model === 'fixture-model' && body.stream === true));
  report.status = 'passed';
} catch (error) {
  report.error = error?.stack ?? String(error);
  if (nativeErrors.length) report.nativeErrors = nativeErrors.join('').slice(-8000);
  process.exitCode = 1;
} finally {
  report.requests = requests; report.toolContinuations = toolContinuations; report.heldRequests = heldRequests; report.heldClosed = heldClosed;
  for (const res of held.values()) res.destroy();
  transport?.close();
  if (transport) {
    await waitFor(() => transport.child.exitCode !== null || transport.child.signalCode !== null, 'native process stop', 5000)
      .catch(() => { transport.child.kill('SIGKILL'); });
    await waitFor(() => transport.child.exitCode !== null || transport.child.signalCode !== null, 'native forced stop', 5000)
      .catch(() => { report.status = 'failed'; process.exitCode = 1; home = null; });
  }
  if (fixture) { fixture.closeAllConnections(); await new Promise(resolveClose => fixture.close(resolveClose)); }
  if (home) await rm(home, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
