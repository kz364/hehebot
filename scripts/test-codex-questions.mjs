#!/usr/bin/env node
// Protocol proof only. All model responses and answers are explicit disposable fixture data.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CodexTransport } from '../runtime/codex-transport.mjs';

const repo = resolve(import.meta.dirname, '..');
const binary = join(repo, '.local/codex-runtime/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex');
const expectedHash = '3188814c35471432d4123203e0eb38e5bddc60226e3d7ddf0e59e649ea140022';
const work = await mkdtemp(join(tmpdir(), 'hehe-questions-'));
const evidence = await mkdtemp(join(repo, '.local/questions-proof-'));
const report = { status: 'failed', assertions: [], availability: [], modelRequests: 0, questionRequests: 0, deniedRequests: 0,
  productionEnabled: false, authenticatedModelsTested: false, recoveryProved: false };
const trace = []; let traceSize = 0;
function capture(kind, value) {
  const line = JSON.stringify({ kind, value }) + '\n'; traceSize += Buffer.byteLength(line);
  assert.ok(traceSize <= 16 * 1024 * 1024, 'private trace bound'); trace.push(line);
}
const check = (name, fn) => { fn(); report.assertions.push(name); };
const sleep = ms => new Promise(ok => setTimeout(ok, ms));
const hash = async path => { const h = createHash('sha256'); for await (const chunk of createReadStream(path)) h.update(chunk); return h.digest('hex'); };
const exec = promisify(execFile);
const sessions = [];
const envFor = home => ({ PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', HOME: home, CODEX_HOME: home });
const answerFor = label => ({ answers: { [`${label}_route`]: { answers: ['North17'] }, [`${label}_detail`]: { answers: [`SYNTHETIC_${label}_ANSWER_73`] } } });
const questionsFor = label => ['route', 'detail'].map((suffix, index) => ({ id: `${label}_${suffix}`, header: index ? 'Detail' : 'Route',
  question: `Synthetic ${suffix} selection?`, options: [{ label: 'North17', description: 'Synthetic first option' }, { label: 'South83', description: 'Synthetic second option' }] }));
const findTool = (body, name) => body.tools.flatMap(tool => tool.tools ? tool.tools.map(child => ({ ...child, namespace: tool.name })) : [tool]).find(tool => tool.name === name);
function send(res, output) {
  const response = { id: `resp_${randomUUID()}`, object: 'response', created_at: 1, status: 'completed', error: null,
    incomplete_details: null, model: 'fixture-model', output, tools: [], parallel_tool_calls: false, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
  capture('model.response', response); res.writeHead(200, { 'content-type': 'text/event-stream' });
  const event = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  event('response.created', { response: { ...response, status: 'in_progress', output: [] } });
  output.forEach((item, output_index) => {
    event('response.output_item.added', { output_index, item });
    if (item.type === 'function_call') event('response.function_call_arguments.done', { output_index, item_id: item.id, arguments: item.arguments });
    event('response.output_item.done', { output_index, item });
  });
  event('response.completed', { response }); res.end('data: [DONE]\n\n');
}
const finish = res => send(res, [{ id: `msg_${randomUUID()}`, type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: 'SYNTHETIC_FINISHED', annotations: [] }] }]);

async function session(name, enabled, v2, experimentalApi = true) {
  const home = join(work, name); await mkdir(home, { mode: 0o700 });
  const s = { name, home, enabled, v2, pending: new Map(), threads: new Map(), rpcIds: new Map(), resolved: new Map(), answersWritten: 0,
    counts: new Map(), held: new Map(), calls: new Map(), active: new Map(), completed: new Map(), errors: [], childId: null };
  sessions.push(s);
  s.wait = async (predicate, label, ms = 12000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (s.errors.length) throw Error('MODEL_FIXTURE_FAILED'); const value = predicate(); if (value) return value; await sleep(20); }
    throw Error(`TIMEOUT_${label}`);
  };
  const labels = ['CHILD', 'ISOLATED', 'ROOT', 'INTERRUPT', 'AFTER', 'DISCONNECT', 'DEFAULT', 'PLAN', 'V2'];
  s.server = createServer(async (req, res) => {
    try {
      assert.equal(req.method, 'POST'); assert.equal(req.url, '/v1/responses');
      let size = 0; const chunks = [];
      for await (const chunk of req) { size += chunk.length; assert.ok(size <= 2 * 1024 * 1024); chunks.push(chunk); }
      const body = JSON.parse(Buffer.concat(chunks)); capture('model.request', { session: name, body }); assert.ok(++report.modelRequests <= 28);
      const users = body.input.filter(item => item.role === 'user').map(item => JSON.stringify(item.content)).join('\n');
      const label = labels.find(label => users.includes(`QUESTION_FIXTURE_${label}`)); assert.ok(label);
      const count = (s.counts.get(label) ?? 0) + 1; s.counts.set(label, count);
      const questionTool = findTool(body, 'request_user_input');
      if (count === 1) report.availability.push({ session: name, label, advertised: Boolean(questionTool), defaultModeFeature: enabled, multiAgentV2: v2 });
      const call = (toolName, args) => {
        const tool = findTool(body, toolName); const callId = `call_${randomUUID()}`;
        if (toolName === 'request_user_input') s.calls.set(callId, label);
        else s.spawnCall = callId;
        send(res, [{ id: `fc_${randomUUID()}`, type: 'function_call', status: 'completed', call_id: callId, name: toolName,
          ...(tool?.namespace ? { namespace: tool.namespace } : {}), arguments: JSON.stringify(args) }]);
      };
      if (label === 'ROOT' && count === 1) {
        assert.ok(findTool(body, 'spawn_agent')); call('spawn_agent', { message: 'QUESTION_FIXTURE_CHILD', fork_context: false }); return;
      }
      if (label === 'ROOT' && count === 2) {
        const output = body.input.find(item => item.type === 'function_call_output' && item.call_id === s.spawnCall);
        s.childId = JSON.parse(output.output).agent_id;
      }
      if (!['ISOLATED', 'AFTER'].includes(label) && count === (label === 'ROOT' ? 2 : 1)) {
        // DEFAULT deliberately attempts the known tool even if unavailable; it must not create a user RPC.
        if (label !== 'DEFAULT') assert.ok(questionTool, 'question tool advertised in explicit fixture configuration');
        call('request_user_input', { questions: questionsFor(label) }); return;
      }
      const held = { body, res, closed: false }; s.held.set(label, held); res.once('close', () => { held.closed = true; });
    } catch (error) { capture('fixture.error', error.stack); s.errors.push(true); res.destroy(); }
  });
  await new Promise(ok => s.server.listen(0, '127.0.0.1', ok));
  await writeFile(join(home, 'config.toml'), `model="fixture-model"\nmodel_provider="fixture"\n[features]\ncode_mode=false\nmulti_agent=true\nmulti_agent_v2=${v2}\ndefault_mode_request_user_input=${enabled}\n[agents]\nmax_threads=4\nmax_depth=1\n[model_providers.fixture]\nname="Synthetic loopback"\nbase_url="http://127.0.0.1:${s.server.address().port}/v1"\nwire_api="responses"\nrequires_openai_auth=false\n`, { mode: 0o600 });
  s.native = spawn(binary, ['app-server', '--strict-config', '--listen', 'stdio://'], { env: envFor(home), cwd: home, stdio: ['pipe', 'pipe', 'pipe'] });
  class QuestionsTransport extends CodexTransport {
    receive(message) {
      capture('native.receive', { session: name, message });
      if (message.method === 'item/tool/requestUserInput' && Object.hasOwn(message, 'id')) {
        s.rpcIds.set(message.params.itemId, message.id);
      }
      super.receive(message);
    }
    write(message) {
      capture('native.send', { session: name, message });
      if (message.result?.answers) { assert.ok([...s.rpcIds.values()].includes(message.id)); s.answersWritten++; }
      super.write(message);
    }
  }
  s.transport = new QuestionsTransport(s.native, { timeoutMs: 10000, onUserInput: (params, { signal, requestId }) => {
    const label = s.calls.get(params.itemId);
    if (!label || ['DEFAULT', 'CHILD'].includes(label) || params.threadId !== s.threads.get(label) ||
        params.turnId !== s.active.get(params.threadId) || s.pending.has(label)) throw Error('FIXTURE_IDENTITY_MISMATCH');
    assert.deepEqual(params.questions.map(({ isOther, isSecret, ...question }) => question), questionsFor(label));
    assert.ok(params.questions.every(q => q.isOther === true && q.isSecret === false));
    assert.equal(requestId, s.rpcIds.get(params.itemId));
    assert.ok(++report.questionRequests <= 10);
    return new Promise(resolve => s.pending.set(label, { params, signal, resolve, id: requestId }));
  } });
  s.native.stderr.on('data', data => capture('native.stderr', { session: name, text: data.toString() }));
  s.transport.on('deniedRequest', () => report.deniedRequests++);
  s.transport.on('notification', n => {
    if (n.method === 'turn/started') s.active.set(n.params.threadId, n.params.turn.id);
    if (n.method === 'turn/completed') { s.active.delete(n.params.threadId); s.completed.set(n.params.threadId, n.params.turn); }
    if (n.method === 'serverRequest/resolved') {
      assert.deepEqual(Object.keys(n.params).sort(), ['requestId', 'threadId']);
      s.resolved.set(JSON.stringify([n.params.threadId, n.params.requestId]), { answersWritten: s.answersWritten });
    }
  });
  await s.transport.initialize({ experimentalApi });
  const config = await s.transport.request('config/read', { cwd: home, includeLayers: false });
  assert.equal(config.config.features.default_mode_request_user_input, enabled); assert.equal(config.config.features.multi_agent_v2, v2);
  s.start = async (label, mode = 'default', threadId) => {
    const thread = threadId ?? (await s.transport.request('thread/start', { cwd: home, model: 'fixture-model', approvalPolicy: 'untrusted', sandbox: 'read-only' })).thread.id;
    s.threads.set(label, thread);
    const turn = await s.transport.request('turn/start', { threadId: thread, input: [{ type: 'text', text: `QUESTION_FIXTURE_${label}` }],
      collaborationMode: { mode, settings: { model: 'fixture-model', reasoning_effort: null, developer_instructions: null } } });
    return { threadId: thread, turnId: turn.turn.id };
  };
  s.answer = async label => {
    const request = await s.wait(() => s.pending.get(label), `${label}_QUESTION`);
    assert.equal(request.params.isBlocking, label === 'PLAN');
    const before = s.counts.get(label); await sleep(150);
    assert.equal(s.counts.get(label), before); assert.equal(s.completed.has(request.params.threadId), false);
    request.resolve(answerFor(label));
    const next = await s.wait(() => s.held.get(label), `${label}_ANSWER_CONTEXT`);
    const output = next.body.input.find(item => item.type === 'function_call_output' && item.call_id === request.params.itemId);
    assert.deepEqual(JSON.parse(output.output), answerFor(label));
    assert.equal(s.active.get(request.params.threadId), request.params.turnId);
    check(`${name}/${label}: exact question IDs and synthetic answers reach next model context while original turn active`, () => assert.ok(output));
    const resolution = await s.wait(() => s.resolved.get(JSON.stringify([request.params.threadId, request.id])), `${label}_RESOLVED`);
    check(`${name}/${label}: resolved notification correlates by thread and original server request ID`, () => assert.ok(resolution.answersWritten > 0));
    return next;
  };
  return s;
}
async function stop(s) {
  s.transport?.close();
  if (s.native) {
    const exited = () => s.native.exitCode !== null || s.native.signalCode !== null;
    for (let n = 0; n < 100 && !exited(); n++) await sleep(20);
    if (!exited()) s.native.kill('SIGKILL');
    for (let n = 0; n < 100 && !exited(); n++) await sleep(20);
    assert.ok(exited());
  }
  if (s.server?.listening) { s.server.closeAllConnections(); await new Promise(ok => s.server.close(ok)); }
}
const watchdog = setTimeout(() => { for (const s of sessions) { s.native?.kill('SIGKILL'); s.server?.closeAllConnections(); } }, 90000);
try {
  report.nativeSha256Before = await hash(binary); assert.equal(report.nativeSha256Before, expectedHash);
  report.transportSha256 = await hash(join(repo, 'runtime/codex-transport.mjs'));
  report.version = (await exec(binary, ['--version'], { env: envFor(work), timeout: 10000 })).stdout.trim(); assert.equal(report.version, 'codex-cli 0.154.0');
  for (const experimental of [false, true]) {
    const path = join(evidence, experimental ? 'experimental-schema' : 'stable-schema');
    await exec(binary, ['app-server', 'generate-json-schema', '--out', path, ...(experimental ? ['--experimental'] : [])], { env: envFor(work), timeout: 10000 });
    const schema = await readFile(join(path, 'ServerRequest.json'), 'utf8');
    report[experimental ? 'experimentalSchemaQuestion' : 'stableSchemaQuestion'] = schema.includes('item/tool/requestUserInput');
  }
  const params = JSON.parse(await readFile(join(evidence, 'experimental-schema', 'ToolRequestUserInputParams.json')));
  check('advertised question RPC requires exact thread/turn/item identity and blocking flag', () => assert.deepEqual(params.required, ['isBlocking', 'itemId', 'questions', 'threadId', 'turnId']));
  const response = JSON.parse(await readFile(join(evidence, 'experimental-schema', 'ToolRequestUserInputResponse.json')));
  check('advertised response maps original question IDs to string-array answers', () => {
    assert.deepEqual(response.required, ['answers']); assert.equal(response.properties.answers.type, 'object');
    assert.equal(response.definitions.ToolRequestUserInputAnswer.properties.answers.items.type, 'string');
  });
  const stable = await session('experimental-api-off', false, false, false);
  await assert.rejects(stable.start('PLAN', 'plan'), { code: 'CODEX_RPC_ERROR' });
  check('explicit collaboration mode requires experimental API capability', () => assert.equal(stable.counts.size, 0)); await stop(stable);
  const off = await session('v1-feature-off', false, false);
  await off.start('DEFAULT'); const rejected = await off.wait(() => off.held.get('DEFAULT'), 'DEFAULT_REJECTION');
  check('default mode advertises tool but feature-off execution is rejected without question RPC', () => {
    assert.equal(off.pending.size, 0);
    assert.ok(rejected.body.input.some(item => item.type === 'function_call_output' && item.output === 'request_user_input is unavailable in Default mode'));
  }); finish(rejected.res);
  await off.start('PLAN', 'plan'); finish((await off.answer('PLAN')).res); await stop(off);

  const on = await session('v1-feature-on', true, false);
  const isolated = await on.start('ISOLATED'); const untouched = await on.wait(() => on.held.get('ISOLATED'), 'ISOLATED');
  const root = await on.start('ROOT'); await on.wait(() => on.pending.has('ROOT') && on.held.has('CHILD') && on.childId, 'ROOT_CHILD_QUESTIONS');
  const child = await on.transport.request('thread/read', { threadId: on.childId, includeTurns: false });
  check('observed V1 direct child is root-only rejected despite advertised tool and enabled feature', () => {
    assert.equal(child.thread.source.subAgent.thread_spawn.parent_thread_id, root.threadId);
    assert.equal(on.pending.get('ROOT').params.threadId, root.threadId); assert.equal(on.pending.get('ROOT').params.turnId, root.turnId);
    assert.equal(on.pending.has('CHILD'), false);
    assert.ok(on.held.get('CHILD').body.input.some(item => item.type === 'function_call_output' && item.output === 'request_user_input can only be used by the root thread'));
    assert.notEqual(on.active.get(on.childId), root.turnId);
  });
  finish((await on.answer('ROOT')).res); finish(on.held.get('CHILD').res);
  check('answering root leaves unrelated held root unchanged and child receives no answer', () => {
    assert.equal(on.counts.get('ISOLATED'), 1); assert.equal(untouched.closed, false); assert.equal(on.active.get(isolated.threadId), isolated.turnId);
    assert.equal(JSON.stringify(untouched.body).includes('ANSWER_73'), false);
    assert.equal(JSON.stringify(on.held.get('CHILD').body).includes('SYNTHETIC_ROOT_ANSWER_73'), false);
  });
  const interrupted = await on.start('INTERRUPT'); const pending = await on.wait(() => on.pending.get('INTERRUPT'), 'INTERRUPT_QUESTION');
  const beforeInterrupt = on.answersWritten;
  await on.transport.request('turn/interrupt', interrupted); await on.wait(() => on.completed.get(interrupted.threadId)?.status === 'interrupted', 'INTERRUPTED');
  const cancellation = await on.wait(() => on.resolved.get(JSON.stringify([interrupted.threadId, pending.id])), 'CANCELLATION_RESOLVED');
  check('interruption resolves a question BEFORE any answer: resolution is not answer acceptance', () => assert.equal(cancellation.answersWritten, beforeInterrupt));
  pending.resolve(answerFor('INTERRUPT')); await sleep(150);
  check('native cancellation resolution aborts only its callback and suppresses late answer write', () => {
    assert.equal(pending.signal.aborted, true); assert.deepEqual(pending.signal.reason, { code: 'CODEX_USER_INPUT_RESOLVED' });
    assert.equal(on.answersWritten, beforeInterrupt); assert.equal(on.counts.get('INTERRUPT'), 1);
    assert.equal(on.transport.closed, false); assert.equal(untouched.closed, false);
  });
  // A fresh unrelated turn proves the connection remains usable, not recovery of the interrupted question.
  await on.start('AFTER'); const after = await on.wait(() => on.held.get('AFTER'), 'AFTER'); finish(after.res);
  await on.start('DISCONNECT'); const disconnected = await on.wait(() => on.pending.get('DISCONNECT'), 'DISCONNECT_QUESTION');
  await stop(on);
  const written = on.answersWritten; disconnected.resolve(answerFor('DISCONNECT')); await sleep(150);
  check('close aborts the actual host callback and suppresses its late result without answer context', () => {
    assert.equal(disconnected.signal.aborted, true); assert.equal(on.answersWritten, written); assert.equal(on.counts.get('DISCONNECT'), 1);
    assert.equal(on.resolved.has(JSON.stringify([disconnected.params.threadId, disconnected.id])), false);
  });

  const v2 = await session('v2-feature-on', true, true); await v2.start('V2'); finish((await v2.answer('V2')).res); await stop(v2);
  check('no unexpected server requests or approvals were granted', () => assert.equal(report.deniedRequests, 0));
  report.status = 'passed';
} catch (error) {
  capture('failure', error.stack); report.error = /^TIMEOUT_/.test(error.message) ? error.message : 'QUESTION_PROOF_FAILED'; process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  for (const s of sessions) await stop(s);
  report.nativeProcessesStopped = sessions.every(s => s.native.exitCode !== null || s.native.signalCode !== null);
  report.heldConnectionsClosed = sessions.every(s => [...s.held.values()].every(row => row.closed));
  report.nativeSha256After = await hash(binary); report.binaryUnchanged = report.nativeSha256Before === report.nativeSha256After;
  report.transportUnchanged = report.transportSha256 === await hash(join(repo, 'runtime/codex-transport.mjs'));
  if (!report.binaryUnchanged || !report.transportUnchanged || !report.nativeProcessesStopped || !report.heldConnectionsClosed) { report.status = 'failed'; process.exitCode = 1; }
  await writeFile(join(evidence, 'trace.jsonl'), trace.join(''), { mode: 0o600 }); report.traceSha256 = await hash(join(evidence, 'trace.jsonl'));
  await rm(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); report.cleanup = true;
  report.privateEvidence = evidence; report.requestCounts = sessions.map(s => ({ session: s.name, counts: Object.fromEntries(s.counts) }));
  await writeFile(join(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
}
