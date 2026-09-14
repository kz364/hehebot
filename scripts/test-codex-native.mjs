#!/usr/bin/env node
// Deterministic acceptance test for the pinned, unmodified Codex app-server.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdir, mkdtemp, rm, writeFile, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnCodex } from '../runtime/codex-transport.mjs';
import { CodexAdapter } from '../runtime/codex-adapter.mjs';
import { CodexEventRouter } from '../runtime/codex-events.mjs';
import { FileJournal } from '../runtime/file-journal.mjs';

const root = resolve(import.meta.dirname, '..');
const binary = join(root, '.local/codex-runtime/node_modules/.bin/codex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const marker = `CODEX_NATIVE_${randomUUID()}`;
const payload = `left-${randomUUID()}-RIGHT`;
let home, workspace, fixture, transport, router;
let requests = 0;
let toolContinuations = 0;
let heldRequests = 0;
let heldClosed = 0;
let spawnedChildId;
let dynamicChildId;
let dynamicParentThread;
const bodies = [];
const notifications = [];
const nativeErrors = [];
const fixtureErrors = [];
const held = new Map();
const dynamicCalls = [];

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
  home = await mkdtemp(join(tmpdir(), 'hehebot-codex-native-'));
  await chmod(home, 0o700);
  workspace = join(home, 'workspace');
  await mkdir(workspace, { mode: 0o700 });
  const fixturePath = join(workspace, 'asymmetric-fixture.txt');
  await writeFile(fixturePath, `${payload}\n`, { mode: 0o600 });
  const commandGate = join(workspace, 'command-gate');
  await promisify(execFile)('mkfifo', ['-m', '600', commandGate], { timeout: 5000 });

  fixture = createServer(async (req, res) => {
    try {
    if (req.method !== 'POST' || req.url !== '/v1/responses' || requests >= 18) { res.writeHead(requests >= 18 ? 429 : 404); res.end(); return; }
    requests++;
    const body = await readBody(req);
    bodies.push(body);
    const input = Array.isArray(body.input) ? body.input : [];
    const raw = JSON.stringify(input);
    if (raw.includes('HOLD_NATIVE_TURN') || input.some(item => item?.role === 'user' && JSON.stringify(item.content).includes('HOLD_NATIVE_CHILD'))) {
      heldRequests++;
      res.once('close', () => { if (!res.writableEnded) heldClosed++; });
      held.set(heldRequests, res);
      return;
    }
    const output = input.find(item => item?.type === 'function_call_output');
    if (input.some(item => item?.role === 'user' && JSON.stringify(item.content).includes('DYNAMIC_CHILD_TOOL_PROOF'))) {
      // A fast child result can inject another continuation while its parent is
      // still answering. This availability probe orders completion explicitly;
      // it does not assume one provider request per native turn.
      await waitFor(() => notifications.some(n => n.method === 'turn/completed' && n.params?.threadId === dynamicParentThread), 'dynamic parent completion before child response');
      const probeTool = body.tools.find(tool => tool.name === 'hehebot_identity_probe' || tool.tools?.some(nested => nested.name === 'hehebot_identity_probe'));
      report.dynamicChildToolsAvailable = Boolean(probeTool);
      if (!report.dynamicChildToolsAvailable) { sendEvents(res, message('CHILD_DYNAMIC_UNAVAILABLE')); return; }
      if (output) { assert.match(String(output.output), /DYNAMIC_IDENTITY_19_43/); sendEvents(res, message('CHILD_DYNAMIC_OK')); return; }
      sendEvents(res, [{ id: `fc_${randomUUID().replaceAll('-', '')}`, type: 'function_call', status: 'completed', call_id: `call_${randomUUID().replaceAll('-', '')}`,
        ...(probeTool.type === 'namespace' ? { namespace: probeTool.name } : {}),
        name: 'hehebot_identity_probe', arguments: JSON.stringify({ left: 19, right: 43 }) }]);
      return;
    }
    if (raw.includes('DYNAMIC_PARENT_PROOF')) {
      if (output) {
        dynamicChildId = JSON.parse(String(output.output)).agent_id; assert.equal(typeof dynamicChildId, 'string');
        sendEvents(res, message('DYNAMIC_PARENT_DONE')); return;
      }
      const spawnTool = body.tools.find(tool => tool.name === 'spawn_agent' || tool.tools?.some(nested => nested.name === 'spawn_agent'));
      assert.ok(spawnTool);
      sendEvents(res, [{ id: `fc_${randomUUID().replaceAll('-', '')}`, type: 'function_call', status: 'completed', call_id: `call_${randomUUID().replaceAll('-', '')}`,
        ...(spawnTool.type === 'namespace' ? { namespace: spawnTool.name } : {}),
        name: 'spawn_agent', arguments: JSON.stringify({ message: 'DYNAMIC_CHILD_TOOL_PROOF', agent_type: 'default' }) }]);
      return;
    }
    if (raw.includes('DYNAMIC_ROOT_PROOF')) {
      if (output) {
        assert.match(String(output.output), /DYNAMIC_IDENTITY_19_43/);
        sendEvents(res, message('DYNAMIC_ROOT_OK')); return;
      }
      assert.ok(body.tools.some(tool => tool.name === 'hehebot_identity_probe'));
      sendEvents(res, [{ id: `fc_${randomUUID().replaceAll('-', '')}`, type: 'function_call', status: 'completed', call_id: `call_${randomUUID().replaceAll('-', '')}`,
        name: 'hehebot_identity_probe', arguments: JSON.stringify({ left: 19, right: 43 }) }]);
      return;
    }
    if (raw.includes('SPAWN_CHILD_PROOF')) {
      if (output) {
        spawnedChildId = JSON.parse(String(output.output)).agent_id;
        assert.equal(typeof spawnedChildId, 'string');
        sendEvents(res, message('PARENT_FINISHED_CHILD_RUNNING')); return;
      }
      const spawnTool = body.tools.find(tool => tool.name === 'spawn_agent' || tool.tools?.some(nested => nested.name === 'spawn_agent'));
      assert.ok(spawnTool, 'Native spawn_agent must be advertised');
      sendEvents(res, [{ id: `fc_${randomUUID().replaceAll('-', '')}`, type: 'function_call', status: 'completed', call_id: `call_${randomUUID().replaceAll('-', '')}`,
        ...(spawnTool.type === 'namespace' ? { namespace: spawnTool.name } : {}),
        name: 'spawn_agent', arguments: JSON.stringify({ message: 'HOLD_NATIVE_CHILD', agent_type: 'default' }) }]);
      return;
    }
    if (raw.includes('BACKGROUND_EXECUTION_PROOF')) {
      if (output) { sendEvents(res, message('ROOT_FINISHED_BEFORE_COMMAND')); return; }
      sendEvents(res, [{ id: `fc_${randomUUID().replaceAll('-', '')}`, type: 'function_call', status: 'completed', call_id: `call_${randomUUID().replaceAll('-', '')}`,
        name: 'exec_command', arguments: JSON.stringify({ cmd: `cat ${JSON.stringify(commandGate)}`, yield_time_ms: 1000, max_output_chars: 2000 }) }]);
      return;
    }
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
  await writeFile(join(home, 'config.toml'), `model = "fixture-model"\nmodel_provider = "fixture"\napproval_policy = "never"\nsandbox_mode = "read-only"\nthread_unload_delay_secs = 2\n\n[model_providers.fixture]\nname = "Loopback fixture"\nbase_url = "http://127.0.0.1:${port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`, { mode: 0o600 });

  transport = spawnCodex({ binary, home, cwd: workspace, timeoutMs: 10_000, onToolCall: async params => {
    assert.equal(params.tool, 'hehebot_identity_probe'); assert.equal(params.namespace, null);
    assert.deepEqual(params.arguments, { left: 19, right: 43 });
    dynamicCalls.push(structuredClone(params));
    return { success: true, contentItems: [{ type: 'inputText', text: 'DYNAMIC_IDENTITY_19_43' }] };
  } });
  transport.child.stderr.on('data', chunk => nativeErrors.push(chunk.toString('utf8')));
  transport.on('notification', notification => notifications.push(notification));
  await transport.initialize({ experimentalApi: true });
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

  // Reconstruct our journal/adapter without consuming the terminal notification.
  // The acknowledged native IDs are the only permitted recovery targets.
  const journalPath = join(home, 'executor-journal');
  await new FileJournal(journalPath).putIfAbsent('recovery-proof', {
    threadId, nativeRunId: turn.turn.id, status: 'running', rootSettled: false,
  });
  const recovery = new CodexAdapter({ cwd: workspace, journal: new FileJournal(journalPath),
    rpc: (method, params) => { assert.equal(method, 'thread/read'); return transport.request(method, params); } });
  const recovered = await recovery.reconcile('recovery-proof');
  assert.equal(recovered.rootSettled, true); assert.equal(recovered.nativeOutcome, 'completed');
  assert.equal(recovery.sleepReadiness().allowed, false);
  report.readOnlyRootRecovery = true;

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

  const routerFailures = [];
  router = new CodexEventRouter({ transport, adapter: recovery, onRecovery: value => routerFailures.push(value.code) });
  const backgroundThread = (await transport.request('thread/start', { cwd: workspace, modelProvider: 'fixture' })).thread.id;
  const backgroundTurn = (await transport.request('turn/start', { threadId: backgroundThread, input: [{ type: 'text', text: 'BACKGROUND_EXECUTION_PROOF' }] })).turn.id;
  assert.equal((await waitTurn(backgroundTurn)).status, 'completed');
  const rootHistory = await transport.request('thread/read', { threadId: backgroundThread, includeTurns: true });
  const commandAtRoot = notifications.find(n => n.method === 'item/started' && n.params?.turnId === backgroundTurn && n.params.item?.type === 'commandExecution')?.params.item;
  report.backgroundAtRoot = {
    historyItemTypes: rootHistory.thread.turns.find(x => x.id === backgroundTurn).items.map(x => x.type),
    events: notifications.filter(n => n.params?.turnId === backgroundTurn).map(n => ({ method: n.method, type: n.params.item?.type, status: n.params.item?.status })),
  };
  assert.equal(commandAtRoot.status, 'inProgress');
  assert.equal(notifications.some(n => n.method === 'item/completed' && n.params?.turnId === backgroundTurn && n.params.item?.id === commandAtRoot.id), false);
  const liveTerminals = await transport.request('thread/backgroundTerminals/list', { threadId: backgroundThread });
  assert.equal(liveTerminals.nextCursor, null);
  assert.equal(liveTerminals.data.length, 1);
  assert.equal(liveTerminals.data[0].itemId, commandAtRoot.id);
  await new FileJournal(journalPath).putIfAbsent('background-proof', { threadId: backgroundThread, nativeRunId: backgroundTurn, status: 'running', rootSettled: false });
  await router.bind('background-proof');
  assert.equal((await recovery.requireRun('background-proof')).rootSettled, true);
  const stillOpen = await recovery.reconcile('background-proof');
  assert.equal(stillOpen.rootSettled, true); assert.equal(stillOpen.commands[commandAtRoot.id], 'inProgress');
  const gate = await open(commandGate, constants.O_WRONLY | constants.O_NONBLOCK);
  try { await gate.writeFile('BACKGROUND_COMMAND_EXIT'); } finally { await gate.close(); }
  await waitFor(() => notifications.some(n => n.method === 'item/completed' && n.params?.turnId === backgroundTurn && n.params.item.id === commandAtRoot.id && n.params.item.status === 'completed'), 'late background command exit');
  await router.flush();
  const settledCommand = await recovery.requireRun('background-proof');
  assert.equal(settledCommand.commands[commandAtRoot.id], 'completed');
  const lateHistory = await transport.request('thread/read', { threadId: backgroundThread, includeTurns: true });
  const commandAfterExit = lateHistory.thread.turns.find(x => x.id === backgroundTurn).items.find(x => x.id === commandAtRoot.id);
  assert.equal(commandAfterExit.status, 'completed'); assert.equal(commandAfterExit.exitCode, 0);
  assert.match(commandAfterExit.aggregatedOutput, /BACKGROUND_COMMAND_EXIT/);
  report.backgroundCommandOutlivesRoot = true;
  assert.deepEqual(routerFailures, []); assert.equal(router.pending.length, 0);
  report.liveEventRouting = true;

  const parentThread = (await transport.request('thread/start', { cwd: workspace, modelProvider: 'fixture' })).thread.id;
  const parentTurn = (await transport.request('turn/start', { threadId: parentThread, input: [{ type: 'text', text: 'SPAWN_CHILD_PROOF' }] })).turn.id;
  assert.equal((await waitTurn(parentTurn)).status, 'completed');
  await waitFor(() => heldRequests === 2, 'child model request');
  const spawned = notifications.find(n => n.method === 'item/completed' && n.params?.threadId === parentThread && n.params?.turnId === parentTurn && n.params.item?.type === 'collabAgentToolCall' && n.params.item.tool === 'spawnAgent')?.params.item;
  assert.equal(spawned.status, 'completed'); assert.equal(spawned.senderThreadId, parentThread);
  assert.equal(spawned.receiverThreadIds.length, 1);
  const childThread = spawned.receiverThreadIds[0];
  assert.equal(childThread, spawnedChildId);
  await new FileJournal(journalPath).putIfAbsent('parent-proof', { threadId: parentThread, nativeRunId: parentTurn, status: 'running', rootSettled: false });
  await router.bind('parent-proof');
  const parentRow = await recovery.requireRun('parent-proof');
  assert.equal(parentRow.rootSettled, true);
  assert.deepEqual(parentRow.spawns[spawned.id], { status: 'completed', receiverThreadIds: [childThread] });
  assert.equal(parentRow.effectsSettled, undefined);
  assert.deepEqual(routerFailures, []); assert.equal(router.pending.length, 0);
  report.nativeSpawnReceiptRouting = true;
  const childStarted = notifications.find(n => n.method === 'turn/started' && n.params?.threadId === childThread);
  report.childTurnStartObserved = Boolean(childStarted);
  assert.ok(childStarted, 'Child turn identity must be observed before interruption');
  const childKey = JSON.stringify([childThread, childStarted.params.turn.id]);
  assert.equal(parentRow.childTurns[childKey], 'inProgress');
  assert.equal(heldClosed, 1);
  assert.equal(notifications.some(n => n.method === 'turn/completed' && n.params?.threadId === childThread && n.params.turn.id === childStarted.params.turn.id), false);
  let childInterrupts = 0;
  const childCancellation = new CodexAdapter({ cwd: workspace, journal: new FileJournal(journalPath), rpc: (method, params) => {
    assert.equal(method, 'turn/interrupt');
    assert.deepEqual(params, { threadId: childThread, turnId: childStarted.params.turn.id });
    childInterrupts++;
    return transport.request(method, params);
  } });
  const childTarget = { threadId: childThread, turnId: childStarted.params.turn.id };
  assert.equal((await childCancellation.cancelChild('parent-proof', childTarget)).status, 'accepted');
  assert.equal((await childCancellation.cancelChild('parent-proof', childTarget)).status, 'accepted');
  assert.equal(childInterrupts, 1);
  assert.equal((await waitTurn(childStarted.params.turn.id)).status, 'interrupted');
  await waitFor(() => heldClosed === 2, 'child provider request closure');
  await router.flush();
  assert.equal((await recovery.requireRun('parent-proof')).childTurns[childKey], 'interrupted');
  assert.deepEqual(routerFailures, []); assert.equal(router.pending.length, 0);
  report.nativeChildTurnRouting = true;
  report.durableChildCancellation = true;
  router.close();
  report.childOutlivesParent = true;

  const dynamicTools = [{
    type: 'function', name: 'hehebot_identity_probe', description: 'Synthetic identity-only acceptance tool; no effects.',
    inputSchema: { type: 'object', properties: { left: { type: 'integer' }, right: { type: 'integer' } }, required: ['left', 'right'], additionalProperties: false },
  }];
  const dynamicThread = (await transport.request('thread/start', { cwd: workspace, modelProvider: 'fixture', dynamicTools })).thread.id;
  const dynamicTurn = (await transport.request('turn/start', { threadId: dynamicThread, input: [{ type: 'text', text: 'DYNAMIC_ROOT_PROOF' }] })).turn.id;
  assert.equal((await waitTurn(dynamicTurn)).status, 'completed');
  assert.equal(dynamicCalls.length, 1);
  assert.equal(dynamicCalls[0].threadId, dynamicThread); assert.equal(dynamicCalls[0].turnId, dynamicTurn);
  assert.equal(typeof dynamicCalls[0].callId, 'string'); assert.ok(dynamicCalls[0].callId.length > 0);
  const dynamicHistory = await transport.request('thread/read', { threadId: dynamicThread, includeTurns: true });
  assert.ok(dynamicHistory.thread.turns.flatMap(saved => saved.items).some(item => item.type === 'agentMessage' && item.text === 'DYNAMIC_ROOT_OK'));
  report.dynamicRootIdentity = true;

  const dynamicParent = (await transport.request('thread/start', { cwd: workspace, modelProvider: 'fixture', dynamicTools })).thread.id;
  dynamicParentThread = dynamicParent;
  const dynamicParentTurn = (await transport.request('turn/start', { threadId: dynamicParent, input: [{ type: 'text', text: 'DYNAMIC_PARENT_PROOF' }] })).turn.id;
  assert.equal((await waitTurn(dynamicParentTurn)).status, 'completed');
  await waitFor(() => notifications.some(n => n.method === 'turn/started' && n.params?.threadId === dynamicChildId), 'dynamic child turn start');
  const childDynamicStart = notifications.find(n => n.method === 'turn/started' && n.params?.threadId === dynamicChildId);
  assert.equal((await waitTurn(childDynamicStart.params.turn.id)).status, 'completed');
  assert.equal(dynamicCalls.length, report.dynamicChildToolsAvailable ? 2 : 1);
  if (report.dynamicChildToolsAvailable) {
    assert.equal(dynamicCalls[1].threadId, dynamicChildId); assert.equal(dynamicCalls[1].turnId, childDynamicStart.params.turn.id);
  }
  const childDynamicHistory = await transport.request('thread/read', { threadId: dynamicChildId, includeTurns: true });
  assert.ok(childDynamicHistory.thread.turns.flatMap(saved => saved.items).some(item => item.type === 'agentMessage' && item.text === (report.dynamicChildToolsAvailable ? 'CHILD_DYNAMIC_OK' : 'CHILD_DYNAMIC_UNAVAILABLE')));

  // A supported per-thread unload is stronger than idle/root completion, but
  // does not settle descendants, external effects or unknown detached work.
  const emptyTerminals = await transport.request('thread/backgroundTerminals/list', { threadId: backgroundThread });
  assert.deepEqual(emptyTerminals, { data: [], nextCursor: null });
  const beforeUnload = notifications.length;
  assert.equal((await transport.request('thread/unsubscribe', { threadId: backgroundThread })).status, 'unsubscribed');
  await waitFor(() => notifications.slice(beforeUnload).some(n => n.method === 'thread/closed' && n.params?.threadId === backgroundThread), 'exact thread closed');
  await waitFor(() => notifications.slice(beforeUnload).some(n => n.method === 'thread/status/changed' && n.params?.threadId === backgroundThread && n.params.status?.type === 'notLoaded'), 'exact thread not loaded');
  const loaded = await transport.request('thread/loaded/list', {});
  assert.equal(loaded.nextCursor, null); assert.equal(loaded.data.includes(backgroundThread), false);
  assert.equal(loaded.data.includes(dynamicThread), true);
  report.nativeBackgroundTerminalReadback = true;
  report.nativeThreadUnloadObserved = true;

  // This fixture owns every session in this process. Never apply this global
  // drain to an installation with unaccounted or unrelated active work.
  for (const id of loaded.data) {
    assert.deepEqual(await transport.request('thread/backgroundTerminals/list', { threadId: id }), { data: [], nextCursor: null });
    assert.ok(['unsubscribed', 'notSubscribed'].includes((await transport.request('thread/unsubscribe', { threadId: id })).status));
  }
  await waitFor(() => loaded.data.every(id => notifications.some(n => n.method === 'thread/closed' && n.params?.threadId === id)), 'all known loaded threads closed');
  assert.deepEqual(await transport.request('thread/loaded/list', {}), { data: [], nextCursor: null });

  // A new native process must recover disk-backed history, not a live server cache.
  // EOF after observed unload, without sending a termination signal.
  transport.child.stdin.end();
  await waitFor(() => transport.child.exitCode !== null || transport.child.signalCode !== null, 'native restart stop', 5000);
  assert.equal(transport.child.exitCode, 0); assert.equal(transport.child.signalCode, null);
  report.nativeGracefulProcessExit = true;
  transport = spawnCodex({ binary, home, cwd: workspace, timeoutMs: 10_000 });
  transport.child.stderr.on('data', chunk => nativeErrors.push(chunk.toString('utf8')));
  await transport.initialize();
  const restarted = await transport.request('thread/read', { threadId, includeTurns: true });
  assert.equal(restarted.thread.id, threadId);
  const savedRoot = restarted.thread.turns.find(item => item.id === turn.turn.id);
  assert.equal(savedRoot.status, 'completed');
  assert.ok(savedRoot.items.some(item => item.type === 'agentMessage' && item.text === `${marker}:${payload}`));
  const restartedJournal = new FileJournal(journalPath);
  const restartedAdapter = new CodexAdapter({ cwd: workspace, journal: restartedJournal,
    rpc: (method, params) => { assert.equal(method, 'thread/read'); return transport.request(method, params); } });
  assert.equal((await restartedAdapter.reconcile('recovery-proof')).nativeOutcome, 'completed');
  assert.equal((await restartedAdapter.reconcile('background-proof')).commands[commandAtRoot.id], 'completed');
  assert.equal(restartedAdapter.sleepReadiness().allowed, false);
  report.nativeProcessRestartReadback = true;

  assert.equal(requests, report.dynamicChildToolsAvailable ? 15 : 14);
  assert.equal(toolContinuations, 1);
  assert.deepEqual(fixtureErrors, []);
  assert.ok(bodies.every(body => body.model === 'fixture-model' && body.stream === true));
  report.status = 'passed';
} catch (error) {
  report.error = error?.stack ?? String(error);
  report.requestShapes = bodies.map(body => ({
    prompts: ['HOLD_NATIVE_TURN', 'HOLD_NATIVE_CHILD', 'DYNAMIC_CHILD_TOOL_PROOF', 'DYNAMIC_PARENT_PROOF', 'DYNAMIC_ROOT_PROOF', 'SPAWN_CHILD_PROOF', 'BACKGROUND_EXECUTION_PROOF']
      .filter(marker => JSON.stringify(body.input).includes(marker)),
    calls: body.input.filter(item => item.type === 'function_call').map(item => item.name),
    outputs: body.input.filter(item => item.type === 'function_call_output').length,
  }));
  if (fixtureErrors.length) report.fixtureErrors = fixtureErrors;
  if (nativeErrors.length) report.nativeErrors = nativeErrors.join('').slice(-8000);
  process.exitCode = 1;
} finally {
  report.requests = requests; report.toolContinuations = toolContinuations; report.heldRequests = heldRequests; report.heldClosed = heldClosed;
  for (const res of held.values()) res.destroy();
  router?.close();
  if (router) await router.tail;
  transport?.close();
  if (transport) {
    await waitFor(() => transport.child.exitCode !== null || transport.child.signalCode !== null, 'native process stop', 5000)
      .catch(() => { transport.child.kill('SIGKILL'); });
    await waitFor(() => transport.child.exitCode !== null || transport.child.signalCode !== null, 'native forced stop', 5000)
      .catch(() => { report.status = 'failed'; process.exitCode = 1; home = null; });
  }
  if (fixture) { fixture.closeAllConnections(); await new Promise(resolveClose => fixture.close(resolveClose)); }
  if (home) await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {
    report.status = 'failed'; report.cleanupError = 'PRIVATE_HOME_CLEANUP_FAILED'; process.exitCode = 1;
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
