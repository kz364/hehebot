#!/usr/bin/env node
// Disposable actual Codex -> assembled host -> MCP -> HTTPS Worker -> SQLite.
// Sprite Tasks transport is synthetic; this does not verify live provider holds.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, readdir, readlink, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Agent } from 'undici';
import { createSpriteCodexService } from '../runtime/sprites-codex-service.mjs';
import { ControlClient } from '../runtime/control-client.mjs';
import { spawnCodex } from '../runtime/codex-transport.mjs';
import { inspectCodexRecovery } from '../runtime/codex-recovery-inspect.mjs';

const root = resolve(import.meta.dirname, '..');
const effectsMode = process.argv.includes('--child-effects');
const historyChildMode = process.argv.includes('--history-child');
const childMode = process.argv.includes('--child') || effectsMode || historyChildMode;
const crashMode = process.argv.includes('--crash');
const historyMode = process.argv.includes('--history') || historyChildMode;
const questionCancelMode = process.argv.includes('--questions-cancel');
const questionsMode = process.argv.includes('--questions') || questionCancelMode;
const submissionAckMode = process.argv.includes('--submission-ack');
const operationPagesMode = process.argv.includes('--operation-pages');
const reasoningMode = process.argv.includes('--reasoning');
const expectedToolCalls = operationPagesMode ? 101 : 1;
const questionAnswers = { route43: { answers: ['West43'] }, timing19: { answers: [] } };
assert.ok(process.argv.slice(2).length <= 1 && process.argv.slice(2).every(arg => ['--child', '--crash', '--child-effects', '--questions', '--questions-cancel', '--history', '--history-child', '--submission-ack', '--operation-pages', '--reasoning'].includes(arg)), 'Unknown fixture option');
const sleep = ms => new Promise(ok => setTimeout(ok, ms));
async function wait(fn, label, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await sleep(25); }
  throw new Error(`Timed out: ${label}`);
}
async function port() {
  const server = createServer(); await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  const result = server.address().port; await new Promise(ok => server.close(ok)); return result;
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  try { await wait(() => child.exitCode !== null || child.signalCode !== null, 'worker stop', 5000); }
  catch { child.kill('SIGKILL'); await wait(() => child.exitCode !== null || child.signalCode !== null, 'worker forced stop', 2000); }
}
function send(res, output) {
  const response = { id: `resp_${randomUUID()}`, object: 'response', created_at: 1, status: 'completed', error: null,
    incomplete_details: null, model: 'fixture-model', output, parallel_tool_calls: true, tools: [], tool_choice: 'auto',
    usage: { input_tokens: 31, input_tokens_details: { cached_tokens: 7 }, output_tokens: 13,
      output_tokens_details: { reasoning_tokens: 5 }, total_tokens: 44 } };
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const event = (type, fields) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`);
  event('response.created', { response: { ...response, status: 'in_progress', output: [] } });
  for (const [output_index, item] of output.entries()) {
    event('response.output_item.added', { output_index, item: { ...item, ...(item.type === 'function_call' ? { arguments: '' } : { content: [] }) } });
    if (item.type === 'function_call') event('response.function_call_arguments.done', { output_index, item_id: item.id, arguments: item.arguments });
    else if (item.type === 'message') {
      event('response.content_part.added', { output_index, item_id: item.id, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
      event('response.output_text.delta', { output_index, item_id: item.id, content_index: 0, delta: item.content[0].text });
      event('response.output_text.done', { output_index, item_id: item.id, content_index: 0, text: item.content[0].text });
      event('response.content_part.done', { output_index, item_id: item.id, content_index: 0, part: item.content[0] });
    }
    event('response.output_item.done', { output_index, item });
  }
  event('response.completed', { response }); res.end('data: [DONE]\n\n');
}
const directory = await mkdtemp(join(tmpdir(), 'hehe-service-native-'));
const report = { status: 'failed', modelRequests: 0, nativeReceipt: false, spriteHoldLive: false, assistantOperational: false };
let worker, service, model, dispatcher, workerLogs = '', bound = false;
let toolRequests = 0, childThreadId, childHeld = false, childClosed = false;
let nativeTransport, nativeLaunches = 0, crashHeld = false, crashClosed = false;
const interrupts = [], notifications = [];
const errors = [], taskRequests = [];
try {
  const workerPort = await port(), token = randomBytes(32).toString('hex');
  const routinePolicy = 'f0ff3ead-1e31-4f83-bbc2-aa25f069a962';
  const cert = join(directory, 'cert.pem'), key = join(directory, 'key.pem');
  await promisify(execFile)('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', key, '-out', cert]);
  worker = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--env', 'local', '--ip', '127.0.0.1',
    '--port', String(workerPort), '--persist-to', join(directory, 'worker'), '--local-protocol', 'https', '--https-key-path', key, '--https-cert-path', cert,
    '--var', 'EXECUTION_ENABLED:true', '--var', 'NATIVE_VERIFIED:true', '--var', `RUNTIME_TOKEN:${token}`,
    '--var', `TOOL_POLICY_IDS:${JSON.stringify([routinePolicy])}`,
    ...(effectsMode ? ['--var', `ACTION_POLICY_IDS:${JSON.stringify([routinePolicy])}`] : []),
    '--var', `PROVIDER_CONFIG:${JSON.stringify({ provider: 'fake', ref: { provider: 'fake', id: 'assembly-fixture' } })}`],
    { cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: join(directory, 'logs') }, stdio: ['ignore', 'pipe', 'pipe'] });
  worker.stdout.on('data', chunk => { workerLogs += chunk; }); worker.stderr.on('data', chunk => { workerLogs += chunk; });
  await wait(() => workerLogs.replace(/\u001b\[[0-9;]*m/g, '').includes(`Ready on https://127.0.0.1:${workerPort}`), 'Worker readiness', 45000);
  const origin = `https://127.0.0.1:${workerPort}`;
  dispatcher = new Agent({ connect: { ca: await readFile(cert) } });
  const trustedFetch = (url, init) => fetch(url, { ...init, dispatcher });
  const state = await (await trustedFetch(`${origin}/v1/state`)).json();
  const persona = state.objects.find(object => object.kind === 'persona');
  const adopted = await (await trustedFetch(`${origin}/v1/commands`, { method: 'POST', headers: {
    'content-type': 'application/json', Origin: origin, 'idempotency-key': randomUUID(),
  }, body: JSON.stringify({ schema_version: 1, type: 'persona.put', payload: { ...persona.body,
    id: persona.id, expected_revision: persona.revision, tool_policy_ids: [routinePolicy] } }) })).json();
  assert.equal(adopted.status, 'applied');
  const routine = { id: randomUUID(), expected_revision: 0, persona_id: persona.id, name: 'Assembly fixture 19 versus 43',
    instructions: `${effectsMode ? 'SERVICE_ASSEMBLY_19_43 ' : ''}Compare 19 against 43 without external effects.`, enabled: false,
    schedule: { cron: '0 8 * * 1-5', timezone: 'Asia/Jakarta' }, trigger_source_id: null, action_policy_ids: effectsMode ? [routinePolicy] : [],
    policy: { misfire: 'coalesce', overlap: 'queue_one', max_replay: 1, max_lateness_seconds: 60 } };
  const saved = await (await trustedFetch(`${origin}/v1/commands`, { method: 'POST', headers: {
    'content-type': 'application/json', Origin: origin, 'idempotency-key': randomUUID(),
  }, body: JSON.stringify({ schema_version: 1, type: 'routine.put', payload: routine }) })).json();
  assert.equal(saved.status, 'applied');
  const queued = await (await trustedFetch(`${origin}/v1/commands`, { method: 'POST', headers: {
    'content-type': 'application/json', Origin: origin, 'idempotency-key': randomUUID(),
  }, body: JSON.stringify(effectsMode
    ? { schema_version: 1, type: 'routine.run', payload: { id: routine.id, expected_revision: 1 } }
    : { schema_version: 1, type: 'message.send', payload: { conversation_id: persona.id, text: 'SERVICE_ASSEMBLY_19_43' } }) })).json();
  assert.equal(queued.status, 'applied');
  const control = new ControlClient({ origin: origin + '/', token, fetchImpl: trustedFetch });
  await wait(async () => (await control.request('status', {})).phase === 'BOOTING', 'FakeProvider boot');
  model = createServer(async (req, res) => {
    try {
      assert.equal(req.url, '/v1/responses');
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      report.modelRequests++;
      assert.ok(report.modelRequests <= (childMode ? 4 : questionsMode && !questionCancelMode ? 3 : 2), 'Unexpected model continuation');
      await wait(() => bound, 'service acknowledged root');
      if (report.modelRequests === 1) {
        assert.equal((await service.observe()).initialInference, 'inProgress');
        const initial = (await service.supervisor.operations()).filter(operation => operation.kind === 'inference' &&
          Date.parse(operation.deadline_at) - Date.parse(operation.started_at) === 300000);
        assert.equal(initial.length, 1); assert.equal(initial[0].status, 'active');
        report.initialSilenceBounded = true;
      }
      if (questionsMode && report.modelRequests === 3) {
        const result = body.input.find(item => item.type === 'function_call_output' && item.call_id === 'question_call_43');
        assert.deepEqual(JSON.parse(result.output), { answers: questionAnswers });
        report.nativeQuestionAnswerContext = true;
        send(res, [{ id: `msg_${randomUUID()}`, type: 'message', status: 'completed', role: 'assistant',
          content: [{ type: 'output_text', text: 'SERVICE_ASSEMBLY_OK', annotations: [] }] }]);
        return;
      }
      if (childMode) {
        const isChild = body.input.some(item => item.role === 'user' && JSON.stringify(item.content).includes('SERVICE_CHILD_PROOF'));
        if (!isChild) {
          assert.match(JSON.stringify(body.input), /SERVICE_ASSEMBLY_19_43/);
          const output = body.input.find(item => item.type === 'function_call_output');
          if (output) {
            childThreadId = JSON.parse(String(output.output)).agent_id;
            assert.equal(typeof childThreadId, 'string');
            send(res, [{ id: `msg_${randomUUID()}`, type: 'message', status: 'completed', role: 'assistant',
              content: [{ type: 'output_text', text: 'SERVICE_PARENT_DONE', annotations: [] }] }]);
          } else {
            const tool = body.tools.find(tool => tool.name === 'spawn_agent' || tool.tools?.some(nested => nested.name === 'spawn_agent'));
            assert.ok(tool, 'native spawn tool advertised');
            send(res, [{ id: `fc_${randomUUID()}`, type: 'function_call', status: 'completed', call_id: `call_${randomUUID()}`,
              ...(tool.type === 'namespace' ? { namespace: tool.name } : {}), name: 'spawn_agent',
              arguments: JSON.stringify({ message: 'SERVICE_CHILD_PROOF', agent_type: 'default' }) }]);
          }
          return;
        }
        await wait(async () => (await service.observe())?.rootSettled, 'parent terminal before child MCP');
        if (toolRequests === 0) {
          await wait(async () => Object.values((await service.observe()).childObligations ?? {}).some(child => child.initialInference === 'inProgress'), 'child initial phase');
          const phases = (await service.supervisor.operations()).filter(operation => operation.kind === 'inference' && operation.status === 'active');
          assert.equal(phases.length, 1);
          assert.equal(Date.parse(phases[0].deadline_at) - Date.parse(phases[0].started_at), 300000);
          report.childInitialSilenceBounded = true;
        }
      } else assert.match(JSON.stringify(body.input), /SERVICE_ASSEMBLY_19_43/);
      toolRequests++;
      if (toolRequests === 1) {
        const tool = body.tools.find(tool => tool.name?.includes('hehebot_list_routines')) ?? body.tools.find(tool => tool.name === 'mcp__hehebot');
        assert.ok(tool);
        send(res, [...(childMode ? [{ id: `msg_${randomUUID()}`, type: 'message', status: 'completed', role: 'assistant', phase: 'commentary',
          content: [{ type: 'output_text', text: 'SERVICE_CHILD_PROGRESS', annotations: [] }] }] : []),
          ...(reasoningMode ? [{ id: 'rs_fixture_43', type: 'reasoning', summary: [{ type: 'summary_text', text: 'PRIVATE_SYNTHETIC_REASONING_43' }] }] : []),
          ...Array.from({ length: expectedToolCalls }, () => ({ id: `fc_${randomUUID()}`, type: 'function_call', status: 'completed', call_id: `call_${randomUUID()}`,
          ...(tool.name === 'mcp__hehebot' ? { namespace: 'mcp__hehebot', name: 'hehebot_list_routines' } : { name: tool.name }), arguments: '{}' }))]);
      } else {
        assert.equal(toolRequests, 2);
        const outputs = body.input.filter(item => item.type === 'function_call_output');
        assert.equal(outputs.length, expectedToolCalls);
        for (const { output } of outputs) {
          const decoded = typeof output === 'string' ? JSON.parse(output) : output;
          const content = Array.isArray(decoded) ? JSON.parse(decoded.at(-1).text) : decoded;
          const receipt = content.content ? JSON.parse(content.content.find(item => item.type === 'text').text) : content;
          assert.equal(receipt.next_cursor, null); assert.equal(receipt.routines.length, 1);
          assert.equal(receipt.routines[0].id, routine.id); assert.equal(receipt.routines[0].revision, 1);
          assert.deepEqual(receipt.routines[0].body, routine); report.nativeReceipt = true;
        }
        if (questionsMode) {
          const tool = body.tools.find(tool => tool.name === 'request_user_input' || tool.tools?.some(nested => nested.name === 'request_user_input'));
          assert.ok(tool);
          send(res, [{ id: 'question_item_43', type: 'function_call', status: 'completed', call_id: 'question_call_43',
            ...(tool.type === 'namespace' ? { namespace: tool.name } : {}), name: 'request_user_input', arguments: JSON.stringify({ questions: [
              { id: 'route43', header: 'Route', question: 'Choose route', options: [{ label: 'West43', description: 'Western' }, { label: 'East19', description: 'Eastern' }] },
              { id: 'timing19', header: 'Timing', question: 'Choose timing', options: [{ label: 'Now19', description: 'Now' }, { label: 'Later43', description: 'Later' }] },
            ] }) }]);
          return;
        }
        if (childMode) {
          childHeld = true;
          res.once('close', () => { if (!res.writableEnded) childClosed = true; });
          return;
        }
        if (crashMode) {
          crashHeld = true;
          res.once('close', () => { if (!res.writableEnded) crashClosed = true; });
          return;
        }
        send(res, [{ id: `msg_${randomUUID()}`, type: 'message', status: 'completed', role: 'assistant',
          content: [{ type: 'output_text', text: 'SERVICE_ASSEMBLY_OK', annotations: [] }] }]);
      }
    } catch (error) {
      errors.push(error.message);
      if (!res.headersSent) send(res, [{ id: `msg_${randomUUID()}`, type: 'message', status: 'completed', role: 'assistant',
        content: [{ type: 'output_text', text: 'FIXTURE_FAILED', annotations: [] }] }]);
      else res.end();
    }
  });
  await new Promise(ok => model.listen(0, '127.0.0.1', ok));
  const stateDirectory = join(directory, 'state'); await mkdir(stateDirectory, { mode: 0o700 });
  const runtimeTokenFile = join(directory, 'token'); await writeFile(runtimeTokenFile, token, { mode: 0o600 });
  let held;
  const spriteRequest = (options, callback) => {
    assert.equal(options.socketPath, '/.sprite/api.sock'); assert.equal(options.headers.Authorization, undefined);
    taskRequests.push(options.method);
    const req = new EventEmitter(); req.setTimeout = () => {}; req.destroy = () => {};
    req.end = data => {
      if (options.method === 'PUT') held = { name: options.path.split('/').at(-1), expires_at: new Date(Date.now() + JSON.parse(data).expire * 1000).toISOString() };
      else assert.equal(options.method, 'GET');
      const res = new EventEmitter(); res.statusCode = 200; callback(res);
      res.emit('data', Buffer.from(JSON.stringify(options.method === 'GET' ? held : {}))); res.emit('end');
    };
    return req;
  };
  const config = { disposableTest: true, stateDirectory, binary: join(root, '.local/codex-runtime/node_modules/.bin/codex'),
    ...(questionsMode ? { ownerQuestions: true } : {}),
    portalOrigin: origin + '/', runtimeTokenFile, tlsCAFile: cert, installationId: 'service-fixture',
    personas: { [persona.id]: { agentId: 'assistant', model: 'fixture-model', allowedTools: ['hehebot_list_routines'] } } };
  const submissionRequests = [], heartbeatPages = [];
  const dependencies = { spriteRequest, fetchImpl: async (url, init) => {
    const response = await trustedFetch(url, init);
    if ((operationPagesMode || reasoningMode) && new URL(url).pathname === '/internal/heartbeat') {
      assert.equal(response.status, 200);
      heartbeatPages.push(JSON.parse(init.body).operations);
    }
    if (submissionAckMode && new URL(url).pathname === '/internal/submitted') {
      assert.equal(response.status, 200);
      submissionRequests.push(JSON.parse(init.body));
      if (submissionRequests.length === 1) {
        await response.text();
        throw new Error('Synthetic reply loss after Worker registration');
      }
    }
    return response;
  },
    launch: options => {
      const transport = spawnCodex(options), request = transport.request.bind(transport);
      if (historyMode) {
        const emit = transport.emit.bind(transport);
        report.withheldMcpCompletions = 0;
        transport.emit = (event, ...args) => {
          if (event === 'notification' && args[0]?.method === 'item/completed' && args[0].params?.item?.type === 'mcpToolCall') {
            report.withheldMcpCompletions++; return true;
          }
          return emit(event, ...args);
        };
      }
      if (questionsMode) {
        const write = transport.write.bind(transport);
        report.nativeAnswerWrites = 0;
        transport.write = message => {
          if (message?.result?.answers) report.nativeAnswerWrites++;
          return write(message);
        };
      }
      nativeTransport = transport; nativeLaunches++;
      transport.on('notification', notification => notifications.push(notification));
      transport.request = (method, params) => {
        if (method === 'turn/interrupt') interrupts.push(structuredClone(params));
        return request(method, params);
      };
      return transport;
    },
    prepareNative: home => writeFile(join(home, 'config.toml'), `model = "fixture-model"\nmodel_provider = "fixture"\n[features]\ncode_mode = false\n${questionsMode ? 'default_mode_request_user_input = true\n' : ''}[model_providers.fixture]\nname = "Loopback"\nbase_url = "http://127.0.0.1:${model.address().port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`, { mode: 0o600 }) };
  service = createSpriteCodexService(config, dependencies);
  const dispatched = await service.start(); bound = true;
  assert.equal(dispatched.phase, 'running'); assert.equal(dispatched.claim.run.id, queued.resource_id);
  if (submissionAckMode) {
    assert.equal(submissionRequests.length, 2);
    assert.deepEqual(submissionRequests[0], submissionRequests[1]);
    assert.equal(submissionRequests[1].native_ref, dispatched.nativeRunId);
    assert.equal(nativeLaunches, 1);
    report.exactSubmissionRegistrationRecovered = true;
  }
  if (questionsMode) {
    const question = await wait(async () => (await (await trustedFetch(`${origin}/v1/state`)).json()).questions?.[0], 'durable native question');
    assert.equal(question.run_id, queued.resource_id); assert.equal(question.attempt, dispatched.claim.run.current_attempt);
    assert.equal(question.state, 'pending'); assert.equal(question.answerable, true);
    assert.equal(report.modelRequests, 2);
    const response = await trustedFetch(`${origin}/v1/commands`, { method: 'POST', headers: {
      'content-type': 'application/json', Origin: origin, 'idempotency-key': randomUUID(),
    }, body: JSON.stringify(questionCancelMode
      ? { schema_version: 1, type: 'run.cancel', payload: { run_id: queued.resource_id, reason: 'Cancel pending fixture question' } }
      : { schema_version: 1, type: 'question.answer', payload: {
        question_id: question.id, expected_revision: question.revision, answers: questionAnswers } }) });
    assert.equal(response.status, 202); assert.equal((await response.json()).status, 'applied');
    if (questionCancelMode) await service.maintain();
    await wait(async () => (await (await trustedFetch(`${origin}/v1/state`)).json()).questions.length === 0, 'native resolved custody');
    report.ownerQuestionResolved = true;
    if (questionCancelMode) {
      const observed = await wait(async () => {
        const row = await service.observe(); return row?.nativeOutcome === 'interrupted' && row;
      }, 'interrupted question root');
      assert.deepEqual(interrupts, [{ threadId: observed.threadId, turnId: observed.nativeRunId }]);
      const late = await trustedFetch(`${origin}/v1/commands`, { method: 'POST', headers: {
        'content-type': 'application/json', Origin: origin, 'idempotency-key': randomUUID(),
      }, body: JSON.stringify({ schema_version: 1, type: 'question.answer', payload: {
        question_id: question.id, expected_revision: question.revision, answers: questionAnswers } }) });
      assert.equal(late.status, 202);
      const lateReceipt = await late.json();
      assert.equal(lateReceipt.status, 'rejected'); assert.equal(lateReceipt.error.code, 'REVISION_CONFLICT');
      await service.maintain();
      assert.equal(report.nativeAnswerWrites, 0); assert.equal(report.modelRequests, 2);
      assert.equal(nativeTransport.closed, false);
      const readback = await nativeTransport.request('thread/read', { threadId: observed.threadId, includeTurns: true });
      assert.equal(readback.thread.id, observed.threadId);
      assert.equal(readback.thread.turns.find(turn => turn.id === observed.nativeRunId)?.status, 'interrupted');
      report.pendingQuestionCancelledWithoutAnswer = true;
    }
  }
  if (crashMode) await wait(() => crashHeld, 'active root inference after verified MCP receipt');
  else await wait(async () => (await service.observe())?.rootSettled, 'root completion');
  if (childMode) {
    await wait(() => childHeld, 'child inherited MCP receipt and open model request');
    await service.maintain();
    let observed = await service.observe();
    const [[childKey, childStatus]] = Object.entries(observed.childTurns);
    const [targetThread, targetTurn] = JSON.parse(childKey);
    assert.equal(targetThread, childThreadId); assert.equal(childStatus, 'inProgress');
    if (historyChildMode) {
      assert.equal(report.withheldMcpCompletions, 1); assert.equal(observed.rootSettled, true);
      const before = observed, requests = report.modelRequests;
      assert.deepEqual(Object.values(before.childObligations[childKey].mcpCalls), ['inProgress']);
      const target = { threadId: targetThread, turnId: targetTurn };
      observed = await service.adapter.reconcileChild(dispatched.attemptId, target);
      assert.deepEqual(Object.keys(observed.childObligations[childKey].mcpCalls), Object.keys(before.childObligations[childKey].mcpCalls));
      assert.deepEqual(observed.childTurns, before.childTurns);
      const rootOnly = row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'childObligations'));
      assert.deepEqual(rootOnly(observed), rootOnly(before));
      assert.deepEqual(await service.adapter.reconcileChild(dispatched.attemptId, target), observed);
      assert.equal(report.modelRequests, requests); assert.equal(childClosed, false);
      report.missedChildMcpCompletionRecovered = true;
    }
    assert.deepEqual(Object.values(observed.childObligations[childKey].mcpCalls), ['completed']);
    const registered = await (await trustedFetch(`${origin}/v1/state`)).json();
    const children = registered.runs.filter(run => run.parent_run_id === queued.resource_id);
    assert.equal(children.length, 1);
    const child = children[0];
    assert.equal(registered.output_previews.find(preview => preview.run_id === queued.resource_id)?.text, 'SERVICE_PARENT_DONE');
    assert.equal(registered.output_previews.find(preview => preview.run_id === child.id)?.text, 'SERVICE_CHILD_PROGRESS');
    assert.equal(registered.output_previews.length, 2);
    assert.equal(observed.effectsSettled, undefined);
    report.nativeChildProvisionalOutput = true;
    const mappingFiles = (await readdir(join(stateDirectory, 'journal'))).filter(name => name.startsWith('native-tasks-'));
    assert.equal(mappingFiles.length, 1);
    const mapping = JSON.parse(await readFile(join(stateDirectory, 'journal', mappingFiles[0]), 'utf8'));
    assert.deepEqual(Object.keys(mapping.children), [childKey]);
    assert.equal(mapping.children[childKey].runId, child.id);
    assert.equal(mapping.children[childKey].receipt.native_session_key, targetThread);
    assert.equal(mapping.children[childKey].receipt.parent_run_id, queued.resource_id);
    assert.equal(mapping.children[childKey].started, true);
    assert.equal(child.status, 'running'); assert.equal(child.persona_id, persona.id);
    report.nativeStartAcknowledgedByService = true;
    assert.equal(childClosed, false); assert.deepEqual(interrupts, []);
    let effectInput, effectResult;
    if (effectsMode) {
      const identity = service.supervisor.identity;
      effectInput = { identity, root_run_id: queued.resource_id, root_attempt: dispatched.claim.run.current_attempt,
        resources: ['calendar:z43', 'browser:a19'], effect: { id: randomUUID(), run_id: child.id, attempt: child.current_attempt,
          action_key: randomUUID(), classification: 'mutation', authorization_ref: routinePolicy,
          request_digest: 'synthetic-request-71', provider_idempotency_key: null } };
      effectResult = (status, receipt = null) => ({ identity, root_run_id: effectInput.root_run_id,
        root_attempt: effectInput.root_attempt, run_id: child.id, attempt: child.current_attempt,
        effect_id: effectInput.effect.id, status, receipt });
      // Service-owned acknowledgement already made the child running. The host
      // fixture never submits that child; it only verifies exact receipt replay.
      const receipt = mapping.children[childKey].receipt;
      await assert.rejects(control.request('native-child', { identity, started: true,
        child: { ...receipt, native_session_key: 'wrong-thread-103' } }), { code: 'CONTROL_HTTP_ERROR', status: 409 });
      const replay = await control.request('native-child', { identity, child: receipt, started: true });
      assert.equal(replay.id, child.id); assert.equal(replay.status, 'running');
      const original = { id: effectInput.effect.id, status: 'intent' };
      assert.deepEqual(await control.request('root-child-effect-intent', effectInput), original);
      assert.deepEqual(await control.request('root-child-effect-intent', { ...effectInput,
        resources: [...effectInput.resources].reverse(), effect: { ...effectInput.effect, id: randomUUID() } }), original);
      await assert.rejects(control.request('root-child-effect-intent', { ...effectInput, resources: ['browser:a19'] }),
        { code: 'CONTROL_HTTP_ERROR', status: 409 });
      await assert.rejects(control.request('root-child-effect-intent', { ...effectInput,
        effect: { ...effectInput.effect, run_id: queued.resource_id } }), { code: 'CONTROL_HTTP_ERROR', status: 403 });
      // A root cannot take its child's locks. Failure after the lexically first
      // free resource must roll back that partial acquisition as well.
      await assert.rejects(control.request('resource-acquire', { identity, run_id: queued.resource_id,
        attempt: dispatched.claim.run.current_attempt, resources: ['a:rollback19', 'calendar:z43'] }),
      { code: 'CONTROL_HTTP_ERROR', status: 409 });
      await control.request('resource-acquire', { identity, run_id: child.id, attempt: child.current_attempt, resources: ['a:rollback19'] });
      // No per-effect resource mapping exists: even this additional lock stays
      // held while the child's external effect is unresolved.
      await assert.rejects(control.request('resource-release', { identity, run_id: child.id,
        attempt: child.current_attempt, resources: ['a:rollback19'] }), { code: 'CONTROL_HTTP_ERROR', status: 409 });
      // Synthetic trusted-executor observations only; no connector is called.
      await control.request('root-child-effect-result', effectResult('dispatched'));
      await control.request('root-child-effect-result', effectResult('outcome_unknown'));
    }
    const cancelled = await (await trustedFetch(`${origin}/v1/commands`, { method: 'POST', headers: {
      'content-type': 'application/json', Origin: origin, 'idempotency-key': randomUUID(),
    }, body: JSON.stringify({ schema_version: 1, type: 'run.cancel', payload: {
      run_id: child.id, reason: 'Disposable service exact child cancellation' } }) })).json();
    assert.equal(cancelled.status, 'applied');
    await service.maintain(); await service.maintain();
    await wait(() => childClosed, 'interrupted child HTTP closure');
    await wait(() => notifications.some(n => n.method === 'turn/completed' && n.params.threadId === targetThread &&
      n.params.turn.id === targetTurn && n.params.turn.status === 'interrupted'), 'exact child interrupted event');
    assert.deepEqual(interrupts, [{ threadId: targetThread, turnId: targetTurn }]);
    assert.equal((await service.observe()).childTurns[childKey], 'interrupted');
    assert.equal(service.supervisor.phase, 'running');
    report.nativeServiceChildCancellation = true;
    if (effectsMode) {
      assert.deepEqual(await control.request('root-child-effect-intent', effectInput), { id: effectInput.effect.id, status: 'outcome_unknown' });
      await assert.rejects(control.request('root-child-effect-result', effectResult('confirmed', {})), { code: 'CONTROL_HTTP_ERROR', status: 422 });
      await control.request('root-child-effect-result', effectResult('confirmed', { synthetic_receipt: 'destination-103' }));
      assert.deepEqual(await control.request('root-child-effect-intent', effectInput), { id: effectInput.effect.id, status: 'confirmed' });
      await assert.rejects(control.request('resource-acquire', { identity: service.supervisor.identity,
        run_id: queued.resource_id, attempt: dispatched.claim.run.current_attempt, resources: effectInput.resources }),
      { code: 'CONTROL_HTTP_ERROR', status: 409 });
      const completion = await trustedFetch(`${origin}/internal/complete`, { method: 'POST', headers: {
        'content-type': 'application/json', Authorization: `Bearer ${token}`,
      }, body: JSON.stringify({ identity: service.supervisor.identity, run_id: child.id, attempt: child.current_attempt,
        result: { status: 'cancelled', text: '' } }) });
      assert.equal(completion.status, 409); assert.equal((await completion.json()).error.code, 'RESOURCE_BUSY');
      Object.assign(report, { nativeChildEffectCustody: true, childOwnedLocksRetained: true, atomicLockRollback: true,
        nativeSubmissionIdentityPreserved: true, effectReconciledDuringCancellation: true, effectReplayPreserved: true, connectorDispatches: 0 });
    }
  }
  if (historyMode && !historyChildMode) {
    const before = await service.observe();
    assert.equal(report.withheldMcpCompletions, 1);
    assert.deepEqual(Object.values(before.mcpCalls), ['inProgress']);
    assert.equal(before.rootSettled, true);
    const requests = report.modelRequests;
    const recovered = await service.adapter.reconcile(dispatched.attemptId);
    assert.deepEqual(Object.keys(recovered.mcpCalls), Object.keys(before.mcpCalls));
    assert.deepEqual(Object.values(recovered.mcpCalls), ['completed']);
    assert.equal(recovered.effectsSettled, undefined);
    assert.deepEqual(await service.adapter.reconcile(dispatched.attemptId), recovered);
    assert.equal(report.modelRequests, requests);
    report.missedMcpCompletionRecovered = true;
  }
  const native = await service.observe();
  assert.deepEqual(Object.values(native.mcpCalls ?? {}), childMode ? [] : Array(expectedToolCalls).fill('completed'));
  assert.equal(native.effectsSettled, undefined);
  await service.maintain();
  const operations = await service.supervisor.operations();
  assert.equal(native.initialInference, 'completed');
  if (!crashMode && !historyMode) {
    const owners = [native, ...Object.values(native.childObligations ?? {})];
    const phases = owners.flatMap(owner => Object.values(owner.quietPhases ?? {}));
    assert.ok(phases.length > 0); assert.ok(phases.every(phase => phase.status === 'completed'));
    assert.ok(phases.every(phase => new Date(phase.startedAt).toISOString() === phase.startedAt));
    report.quietPhaseJournalObserved = true;
  }
  assert.equal(operations.length, childMode ? 8 : expectedToolCalls + 3 + Number(reasoningMode));
  if (childMode) {
    assert.ok(Object.values(native.childObligations).every(child => child.initialInference === 'completed'));
    assert.equal(operations.filter(operation => operation.kind === 'inference' && operation.status === 'settled').length, 3);
    const startup = operations.filter(operation => operation.kind === 'child' && operation.deadline_at < dispatched.claim.deadline_at);
    assert.equal(startup.length, 1); assert.equal(startup[0].status, 'settled');
    const [spawnId] = Object.keys(native.spawns);
    assert.equal(startup[0].started_at, native.operationTimes[JSON.stringify(['spawns', spawnId])].lastProgressAt);
    assert.equal(Date.parse(startup[0].deadline_at) - Date.parse(startup[0].started_at), 120000);
    report.childStartupClockObserved = true;
  }
  if (reasoningMode) {
    assert.deepEqual(Object.values(native.reasoningItems), ['completed']);
    assert.doesNotMatch(JSON.stringify(native), /PRIVATE_SYNTHETIC_REASONING_43/);
    const phases = operations.filter(operation => operation.kind === 'inference' && operation.deadline_at < dispatched.claim.deadline_at);
    assert.equal(phases.length, 2); assert.ok(phases.every(phase => phase.status === 'settled'));
    assert.ok(phases.every(phase => Date.parse(phase.deadline_at) - Date.parse(phase.started_at) === 300000));
    assert.deepEqual(heartbeatPages.at(-1), operations);
    report.reasoningPhaseObserved = true; report.reasoningContentExcluded = true;
  }
  if (operationPagesMode) {
    assert.deepEqual(heartbeatPages.slice(-2).map(page => page.length), [100, 4]);
    assert.deepEqual(heartbeatPages.slice(-2).flat(), operations);
    assert.equal(new Set(operations.map(operation => operation.id)).size, 104);
    report.nativeToolCalls = expectedToolCalls;
    report.completeHeartbeatPages = [100, 4];
  }
  assert.equal(operations.filter(operation => operation.status === 'unknown').length, 1);
  assert.ok(operations.every(operation => operation.run_id === queued.resource_id && operation.deadline_at <= dispatched.claim.deadline_at));
  const timedTools = operations.filter(operation => operation.kind === 'tool' && operation.deadline_at < dispatched.claim.deadline_at);
  assert.equal(timedTools.length, expectedToolCalls + Number(childMode));
  assert.ok(timedTools.every(operation => Date.parse(operation.deadline_at) <= Date.parse(operation.started_at) + 120000));
  await assert.rejects(service.supervisor.complete({ attemptId: dispatched.attemptId, nativeRunId: native.nativeRunId, rootSettled: true }), { code: 'NATIVE_SETTLEMENT_INCOMPLETE' });
  await assert.rejects(service.supervisor.drain({ state: 'fixture' }), { code: 'SLEEP_DENIED' });
  if (crashMode) {
    assert.equal(native.rootSettled, false); assert.equal(crashClosed, false);
    assert.equal(operations.find(operation => operation.kind === 'inference').status, 'active');
    // The npm launcher owns one native child. Target that binary, not the shim.
    const launcherPid = nativeTransport.child.pid;
    const nativePids = (await readFile(`/proc/${launcherPid}/task/${launcherPid}/children`, 'utf8')).trim().split(/\s+/).map(Number);
    assert.equal(nativePids.length, 1); assert.ok(Number.isSafeInteger(nativePids[0]) && nativePids[0] > 1);
    assert.match(await readlink(`/proc/${nativePids[0]}/exe`), /\/codex$/);
    process.kill(nativePids[0], 'SIGKILL');
    await wait(() => service.phase === 'recovery' && nativeTransport.child.signalCode === 'SIGKILL', 'native crash fences service');
    await wait(() => crashClosed, 'crashed root HTTP closure');
    assert.equal(notifications.some(n => n.method === 'turn/completed' && n.params.threadId === native.threadId && n.params.turn.id === native.nativeRunId), false);
    await assert.rejects(service.maintain(), { code: 'SERVICE_RECOVERY_REQUIRED' });
    await assert.rejects(service.supervisor.dispatch(), { code: 'EXECUTOR_FENCED' });
    await assert.rejects(service.supervisor.drain({ state: 'fixture' }), { code: 'EXECUTOR_FENCED' });
    assert.deepEqual(await service.journal.get(dispatched.attemptId), native);
    Object.assign(report, { activeNativeCrashFenced: true, rootHttpClosed: crashClosed, rootTerminalObserved: false,
      unknownCoverage: 1, sleepDenied: true });
  }
  if (childMode) {
    assert.equal(operations.find(operation => operation.kind === 'child').status, 'settled');
    const rejected = await trustedFetch(`${origin}/internal/complete`, { method: 'POST', headers: {
      'content-type': 'application/json', Authorization: `Bearer ${token}`,
    }, body: JSON.stringify({ identity: service.supervisor.identity, run_id: queued.resource_id,
      attempt: dispatched.claim.run.current_attempt, result: { status: 'completed', text: 'Root-only result must fail' } }) });
    assert.equal(rejected.status, 409); assert.match(JSON.stringify(await rejected.json()), /CANCEL_UNCONFIRMED/);
  }
  const final = await (await trustedFetch(`${origin}/v1/state`)).json();
  assert.equal(final.runs.find(run => run.id === queued.resource_id).status, questionCancelMode ? 'cancelling' : 'running');
  if (questionCancelMode) assert.deepEqual(final.output_previews, []);
  if (!crashMode && !questionCancelMode) {
    assert.deepEqual(final.output_previews, [{ run_id: queued.resource_id, attempt: dispatched.claim.run.current_attempt,
      version: 1, text: childMode ? 'SERVICE_PARENT_DONE' : 'SERVICE_ASSEMBLY_OK', truncated: false }]);
    report.nativeProvisionalOutputWithoutSettlement = true;
  }
  if (childMode) {
    assert.equal(final.runs.find(run => run.parent_run_id === queued.resource_id).status, 'cancelling');
    assert.equal(interrupts.length, 1);
    Object.assign(report, { interrupts: interrupts.length, childInterrupted: true, childHttpClosed: childClosed,
      heartbeatOperations: operations.length, unknownCoverage: 1, rootWorkerStatus: 'running', childWorkerStatus: 'cancelling', sleepDenied: true });
  }
  assert.deepEqual(taskRequests, ['PUT', 'GET']); assert.equal(report.modelRequests, childMode ? 4 : questionsMode && !questionCancelMode ? 3 : 2); assert.deepEqual(errors, []);
  if (questionsMode) assert.equal(report.nativeAnswerWrites, questionCancelMode ? 0 : 1);
  await service.stop();
  assert.equal((await service.journal.get('service')).phase, 'recovery');
  const diagnostic = await inspectCodexRecovery(join(stateDirectory, 'journal'));
  assert.deepEqual(diagnostic.issues, []);
  assert.deepEqual(diagnostic.questions, { complete: true, total: questionsMode ? 1 : 0, unresolved: 0,
    resolutionObserved: questionsMode ? 1 : 0, phases: questionsMode ? { resolved: 1 } : {} });
  assert.equal(diagnostic.dispatch.runId, queued.resource_id);
  assert.equal(diagnostic.dispatch.attemptId, dispatched.attemptId);
  assert.equal(diagnostic.native.root.threadId, native.threadId);
  assert.equal(diagnostic.native.root.turnId, native.nativeRunId);
  assert.equal(diagnostic.native.root.observedTerminal, !crashMode);
  const expectedLastUsage = { inputTokens: 31, cachedInputTokens: 7, cacheWriteInputTokens: 0,
    outputTokens: 13, reasoningOutputTokens: 5, totalTokens: 44 };
  assert.deepEqual(diagnostic.native.root.tokenUsage.last, expectedLastUsage);
  if (childMode) {
    assert.equal(diagnostic.native.children.length, 1);
    assert.deepEqual(diagnostic.native.children[0].tokenUsage.last, expectedLastUsage);
  }
  report.nativeUsageSnapshotObserved = true;
  const inspectedCalls = diagnostic.native.observations.filter(observation => observation.kind === 'mcpCalls');
  assert.equal(inspectedCalls.length, expectedToolCalls);
  const stoppedNative = await service.journal.get(dispatched.attemptId);
  for (const call of inspectedCalls) {
    const owner = call.threadId === stoppedNative.threadId ? stoppedNative
      : stoppedNative.childObligations[JSON.stringify([call.threadId, call.turnId])];
    const stored = owner.operationTimes[JSON.stringify(['mcpCalls', call.itemId])];
    assert.equal(typeof call.timing?.startedAt, 'string');
    assert.deepEqual(call.timing, { startedAt: stored.startedAt, lastProgressAt: stored.lastProgressAt });
  }
  report.offlineOperationClocksPreserved = true;
  assert.equal(diagnostic.resumeAllowed, false); assert.equal(diagnostic.sleepAllowed, false);
  report.offlineRecoveryDiagnostic = true;
  if (crashMode) {
    const before = await service.journal.get(dispatched.attemptId);
    await assert.rejects(createSpriteCodexService(config, dependencies).start(), { code: 'SERVICE_RECOVERY_REQUIRED' });
    assert.equal(nativeLaunches, 1); assert.equal(report.modelRequests, 2);
    assert.deepEqual(await service.journal.get(dispatched.attemptId), before);
    assert.deepEqual(taskRequests, ['PUT', 'GET']);
    Object.assign(report, { restartRefused: true, nativeLaunches, rootWorkerStatus: 'running' });
  }
  report.status = 'passed';
} catch (error) {
  report.error = error.code ?? error.message;
  await writeFile(join(directory, 'diagnostics.log'), workerLogs + '\n' + errors.join('\n') + '\n' + error.stack, { mode: 0o600 });
  process.exitCode = 1;
} finally {
  try { await service?.stop(); await stop(worker); }
  catch { report.status = 'failed'; report.cleanupError = 'PROCESS_STOP_UNCONFIRMED'; process.exitCode = 1; }
  if (model) { model.closeAllConnections(); await new Promise(ok => model.close(ok)); }
  await dispatcher?.close();
  if (report.status === 'passed') await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  else report.privateDiagnostics = directory;
  console.log(JSON.stringify(report, null, 2));
}
