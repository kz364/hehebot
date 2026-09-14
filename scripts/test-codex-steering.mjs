#!/usr/bin/env node
// Real pinned native turns; every model response is scripted loopback fixture data.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, readdir, lstat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CodexTransport } from '../runtime/codex-transport.mjs';
import { CodexAdapter } from '../runtime/codex-adapter.mjs';
import { CodexEventRouter } from '../runtime/codex-events.mjs';
import { FileJournal } from '../runtime/file-journal.mjs';

const repo = resolve(import.meta.dirname, '..');
const binary = join(repo, '.local/codex-runtime/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex');
const adapterPath = join(repo, 'runtime/codex-adapter.mjs');
const directory = await mkdtemp(join(tmpdir(), 'hehe-steering-'));
const evidence = await mkdtemp(join(repo, '.local/steering-proof-'));
const home = join(directory, 'home'), cwd = join(directory, 'workspace'), journalPath = join(directory, 'journal');
const env = { PATH: process.env.PATH, LANG: 'C.UTF-8', HOME: home, CODEX_HOME: home };
const attemptId = 'steering-attempt-19';
const rootInstruction = { commandId: 'owner-root-31', text: 'STEERING_ROOT_DIRECTIVE_31' };
const childInstruction = { commandId: 'owner-child-57', text: 'STEERING_CHILD_DIRECTIVE_57' };
const report = { status: 'failed', assertions: [], modelRequests: 0, steerRPCs: 0, interruptRPCs: 0,
  approvals: 0, externalModelRequests: 0, workerAdmissionProved: false, modelUnderstandingProved: false, productionEnabled: false };
const trace = []; let traceBytes = 0;
function capture(kind, value) {
  const line = JSON.stringify({ kind, value }) + '\n'; traceBytes += Buffer.byteLength(line);
  assert.ok(traceBytes <= 16 * 1024 * 1024, 'bounded private trace'); trace.push(line);
}
class ObservedTransport extends CodexTransport {
  receive(message) { capture('native.receive', message); super.receive(message); }
  write(message) { capture('native.send', message); super.write(message); }
}
const check = (name, fn) => { fn(); report.assertions.push(name); };
const sleep = ms => new Promise(ok => setTimeout(ok, ms));
let transport, router, server, adapter, native, root;
const errors = [], active = new Map(), terminal = new Set(), outcomes = new Map(), counts = new Map(), held = new Map(), spawnCalls = new Map(), children = new Map();
async function wait(fn, label, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (errors.length) throw Error(errors[0]);
    const value = await fn(); if (value) return value; await sleep(20);
  }
  throw Error(`TIMEOUT_${label}`);
}
const sha = value => createHash('sha256').update(value).digest('hex');
async function fileHash(path) {
  const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex');
}
function send(res, output) {
  assert.equal(res.destroyed, false, 'held fixture response remains writable');
  const response = { id: `resp_${randomUUID()}`, object: 'response', created_at: 1, status: 'completed', error: null,
    incomplete_details: null, model: 'fixture-model', output, tools: [], parallel_tool_calls: false,
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
const message = text => [{ id: `msg_${randomUUID()}`, type: 'message', status: 'completed', role: 'assistant',
  content: [{ type: 'output_text', text, annotations: [] }] }];
function spawnChild(body, label) {
  const tool = body.tools.find(t => t.name === 'spawn_agent' || t.tools?.some(n => n.name === 'spawn_agent'));
  assert.ok(tool, 'native V1 spawn is advertised');
  const schema = (tool.tools?.find(t => t.name === 'spawn_agent') ?? tool).parameters;
  assert.ok(schema.properties.message); assert.ok(schema.properties.fork_context); assert.ok(!schema.required?.includes('task_name'));
  const callId = `call_${randomUUID()}`; spawnCalls.set(callId, label);
  return [{ id: `fc_${randomUUID()}`, type: 'function_call', status: 'completed', call_id: callId,
    ...(tool.type === 'namespace' ? { namespace: tool.name } : {}), name: 'spawn_agent',
    arguments: JSON.stringify({ message: `STEERING_${label}`, fork_context: false }) }];
}
function hold(label, number, res, body) {
  const key = `${label}:${number}`; assert.equal(held.has(key), false);
  const row = { res, body, closed: false, bodyHash: sha(JSON.stringify(body)), terminalAtArrival: root ? terminal.has(JSON.stringify([root.threadId, root.nativeRunId])) : false };
  held.set(key, row); res.once('close', () => { row.closed = true; });
}
function directive(body, text) {
  return body.input.filter(item => item.role === 'user').filter(item => JSON.stringify(item.content).includes(text));
}
async function journalHashes() {
  const result = {};
  for (const name of (await readdir(journalPath)).sort()) result[name] = await fileHash(join(journalPath, name));
  return result;
}
function reopened() { return new CodexAdapter({ rpc, journal: new FileJournal(journalPath), cwd, testMode: true }); }
async function rpc(method, params) {
  if (method === 'turn/steer') {
    const key = `steer-${sha(JSON.stringify([attemptId, params.clientUserMessageId]))}`;
    const persisted = await new FileJournal(journalPath).get(key);
    check(`${params.clientUserMessageId} unknown receipt is durable before exact native steer`, () => {
      assert.equal(persisted.status, 'unknown'); assert.equal(params.input.length, 1); assert.equal(params.input[0].type, 'text');
    });
    report.steerRPCs++;
  }
  if (method === 'turn/interrupt') report.interruptRPCs++;
  if (method === 'thread/start') {
    assert.equal(params.approvalPolicy, 'untrusted'); assert.equal(params.sandbox, 'read-only');
  }
  const reply = await transport.request(method, params);
  if (method === 'turn/steer') assert.equal(reply.turnId, params.expectedTurnId);
  return reply;
}
function siblingUnchanged(sibling, before) {
  assert.equal(counts.get('SIBLING83'), 1); assert.equal(held.get('SIBLING83:1').closed, false);
  assert.equal(held.get('SIBLING83:1').bodyHash, before); assert.equal(active.get(sibling.threadId), sibling.turnId);
}
const watchdog = setTimeout(() => { errors.push('FIXTURE_DEADLINE'); native?.kill('SIGKILL'); server?.closeAllConnections(); }, 90000);
watchdog.unref();
try {
  for (const path of [home, cwd, journalPath]) await mkdir(path, { mode: 0o700 });
  report.nativeSha256Before = await fileHash(binary); report.adapterSha256 = await fileHash(adapterPath);
  check('native executable is the pristine pinned Linux0.154.0 binary', () => assert.equal(report.nativeSha256Before, '3188814c35471432d4123203e0eb38e5bddc60226e3d7ddf0e59e649ea140022'));
  report.version = (await promisify(execFile)(binary, ['--version'], { env, cwd, timeout: 10000 })).stdout.trim();
  assert.equal(report.version, 'codex-cli 0.154.0');
  server = createServer(async (req, res) => {
    try {
      assert.equal(req.method, 'POST'); assert.equal(req.url, '/v1/responses');
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; assert.ok(size <= 2 * 1024 * 1024); chunks.push(chunk); }
      const body = JSON.parse(Buffer.concat(chunks)); capture('model.request', body);
      assert.ok(++report.modelRequests <= 9, 'bounded scripted requests');
      const user = body.input.filter(item => item.role === 'user').map(item => JSON.stringify(item.content)).join('\n');
      const label = ['SIBLING83', 'TARGET47', 'ROOT19'].find(label => user.includes(`STEERING_${label}`));
      assert.ok(label, 'known fixture task'); const number = (counts.get(label) ?? 0) + 1; counts.set(label, number);
      if (label === 'ROOT19') {
        for (const output of body.input.filter(item => item.type === 'function_call_output' && spawnCalls.has(item.call_id))) {
          const spawned = JSON.parse(output.output); assert.equal(typeof spawned.agent_id, 'string'); children.set(spawnCalls.get(output.call_id), spawned.agent_id);
        }
        if (number <= 2) { send(res, spawnChild(body, number === 1 ? 'TARGET47' : 'SIBLING83')); return; }
      }
      hold(label, number, res, body);
    } catch (error) { errors.push('MODEL_FIXTURE_FAILED'); capture('fixture.error', error.stack); if (!res.headersSent) res.writeHead(400); res.end(); }
  });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  await writeFile(join(home, 'config.toml'), `model = "fixture-model"\nmodel_provider = "fixture"\n[features]\ncode_mode = false\nmulti_agent = true\nmulti_agent_v2 = false\n[agents]\nmax_threads = 4\nmax_depth = 1\n[model_providers.fixture]\nname = "Scripted loopback only"\nbase_url = "http://127.0.0.1:${server.address().port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`, { mode: 0o600 });
  native = spawn(binary, ['app-server', '--strict-config', '--listen', 'stdio://'], { env, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  transport = new ObservedTransport(native, { timeoutMs: 10000 });
  native.stderr.on('data', data => capture('native.stderr', data.toString()));
  transport.on('notification', n => {
    if (n.method === 'turn/started') active.set(n.params.threadId, n.params.turn.id);
    if (n.method === 'turn/completed') {
      active.delete(n.params.threadId);
      const key = JSON.stringify([n.params.threadId, n.params.turn.id]);
      terminal.add(key); outcomes.set(key, n.params.turn.status);
    }
  });
  transport.on('deniedRequest', () => report.approvals++);
  await transport.initialize({ experimentalApi: true });
  const config = await transport.request('config/read', { includeLayers: false, cwd });
  check('strict config confirms V1 multi-agent, not V2', () => {
    assert.equal(config.config.features.multi_agent, true); assert.equal(config.config.features.multi_agent_v2, false);
    assert.equal(config.config.features.code_mode, false);
  });
  adapter = reopened(); router = new CodexEventRouter({ transport, adapter, onRecovery: value => errors.push(value.code) });
  root = await adapter.submit({ attemptId, installationId: 'fixture-installation', personaId: 'fixture-persona', scope: 'conversation',
    scopeId: 'steering-scope', message: 'STEERING_ROOT19', model: 'fixture-model' });
  assert.equal(root.status, 'running'); await router.bind(attemptId);
  await wait(() => held.has('ROOT19:3') && held.has('TARGET47:1') && held.has('SIBLING83:1'), 'THREE_HELD_TURNS');
  await router.flush();
  const child = { threadId: children.get('TARGET47'), turnId: active.get(children.get('TARGET47')) };
  const sibling = { threadId: children.get('SIBLING83'), turnId: active.get(children.get('SIBLING83')) };
  const siblingHash = held.get('SIBLING83:1').bodyHash;
  for (const target of [child, sibling]) {
    const read = await transport.request('thread/read', { threadId: target.threadId, includeTurns: false });
    assert.equal(read.thread.source.subAgent.thread_spawn.parent_thread_id, root.threadId);
  }
  check('real spawn receipts and observations bind two distinct direct children to one logical attempt', () => {
    assert.equal(new Set([root.threadId, child.threadId, sibling.threadId]).size, 3);
    assert.equal(new Set([root.nativeRunId, child.turnId, sibling.turnId]).size, 3);
    assert.equal(typeof child.turnId, 'string'); assert.equal(typeof sibling.turnId, 'string');
  });
  const rootAccepted = await adapter.steer(attemptId, rootInstruction); assert.equal(rootAccepted.status, 'accepted');
  if (!held.get('ROOT19:3').closed) send(held.get('ROOT19:3').res, message('ROOT_FIRST_RESPONSE'));
  const rootNext = await wait(() => held.get('ROOT19:4'), 'ROOT_STEER_CONTEXT');
  check('root steering text reaches next user context before completion on the same native turn', () => {
    assert.equal(directive(rootNext.body, rootInstruction.text).length, 1); assert.equal(rootNext.terminalAtArrival, false);
    assert.equal(active.get(root.threadId), root.nativeRunId); siblingUnchanged(sibling, siblingHash);
  });
  send(rootNext.res, message('ROOT_FINISHED'));
  await wait(() => terminal.has(JSON.stringify([root.threadId, root.nativeRunId])), 'ROOT_TERMINAL'); await router.flush();
  const beforeRootReplay = await journalHashes();
  assert.deepEqual(await reopened().steer(attemptId, rootInstruction), rootAccepted);
  check('reopened root receipt replays after terminal with no journal write or second RPC', () => assert.equal(report.steerRPCs, 1));
  assert.deepEqual(await journalHashes(), beforeRootReplay);
  const childAccepted = await adapter.steerChild(attemptId, child, childInstruction); assert.equal(childAccepted.status, 'accepted');
  if (!held.get('TARGET47:1').closed) send(held.get('TARGET47:1').res, message('CHILD_FIRST_RESPONSE'));
  const childNext = await wait(() => held.get('TARGET47:2'), 'CHILD_STEER_CONTEXT');
  check('direct child consumes steering into next context after root completion without sibling delivery', () => {
    assert.equal(directive(childNext.body, childInstruction.text).length, 1); assert.equal(directive(childNext.body, rootInstruction.text).length, 0);
    assert.equal(active.get(child.threadId), child.turnId); assert.equal(terminal.has(JSON.stringify([child.threadId, child.turnId])), false);
    siblingUnchanged(sibling, siblingHash);
  });
  await router.flush(); const beforeChildReplay = await journalHashes();
  assert.deepEqual(await reopened().steerChild(attemptId, child, childInstruction), childAccepted);
  await assert.rejects(reopened().steerChild(attemptId, sibling, childInstruction), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(reopened().steerChild(attemptId, { ...child, turnId: 'unobserved-turn' }, childInstruction), { code: 'SETTLEMENT_IDENTITY_MISMATCH' });
  await assert.rejects(reopened().steerChild(attemptId, child, { ...childInstruction, text: 'changed' }), { code: 'IDEMPOTENCY_CONFLICT' });
  assert.deepEqual(await journalHashes(), beforeChildReplay);
  check('child replay and wrong-target/content rejection issue no extra native steer', () => assert.equal(report.steerRPCs, 2));
  send(childNext.res, message('CHILD_FINISHED'));
  await wait(() => terminal.has(JSON.stringify([child.threadId, child.turnId])), 'CHILD_TERMINAL'); await router.flush();
  assert.deepEqual(await reopened().steerChild(attemptId, child, childInstruction), childAccepted);
  const row = await adapter.requireRun(attemptId);
  check('logical/native identities persist and native completion does not enable sleep', () => {
    assert.equal(row.attemptId, attemptId); assert.equal(row.threadId, root.threadId); assert.equal(row.nativeRunId, root.nativeRunId);
    assert.equal(row.rootSettled, true); assert.equal(row.childTurns[JSON.stringify([child.threadId, child.turnId])], 'completed');
    assert.equal(adapter.sleepReadiness().allowed, false); assert.equal(adapter.admissionReadiness().productionVerified, false);
    siblingUnchanged(sibling, siblingHash);
  });
  await adapter.cancelChild(attemptId, sibling);
  await wait(() => terminal.has(JSON.stringify([sibling.threadId, sibling.turnId])) && held.get('SIBLING83:1').closed, 'SIBLING_CLEANUP'); await router.flush();
  check('only cleanup interrupts sibling; all observed turns and held HTTP requests close', () => {
    assert.equal(report.interruptRPCs, 1); assert.equal(report.steerRPCs, 2); assert.equal(active.size, 0);
    assert.deepEqual(Object.fromEntries(counts), { ROOT19: 4, TARGET47: 2, SIBLING83: 1 });
    assert.equal(outcomes.get(JSON.stringify([root.threadId, root.nativeRunId])), 'completed');
    assert.equal(outcomes.get(JSON.stringify([child.threadId, child.turnId])), 'completed');
    assert.equal(outcomes.get(JSON.stringify([sibling.threadId, sibling.turnId])), 'interrupted');
    assert.ok([...held.values()].every(value => value.closed)); assert.equal(report.approvals, 0); assert.deepEqual(errors, []);
  });
  assert.equal((await lstat(journalPath)).mode & 0o777, 0o700);
  for (const name of await readdir(journalPath)) assert.equal((await lstat(join(journalPath, name))).mode & 0o777, 0o600);
  capture('journal.final', await Promise.all((await readdir(journalPath)).sort().map(async name => ({ name, value: JSON.parse(await readFile(join(journalPath, name), 'utf8')) }))));
  report.rootContextDelivery = true; report.childContextDelivery = true; report.siblingUnchanged = true;
  report.status = 'passed';
} catch (error) {
  capture('fixture.failure', error.stack); report.error = error.code ?? (/^TIMEOUT_/.test(error.message) ? error.message : 'STEERING_ASSERTION_FAILED'); process.exitCode = 1;
} finally {
  clearTimeout(watchdog); router?.close();
  if (transport) transport.close();
  if (native) {
    const stopped = () => native.exitCode !== null || native.signalCode !== null;
    const end = Date.now() + 5000; while (!stopped() && Date.now() < end) await sleep(20);
    if (!stopped()) { native.kill('SIGKILL'); const forced = Date.now() + 3000; while (!stopped() && Date.now() < forced) await sleep(20); }
    report.nativeStopped = stopped(); if (!stopped()) { report.status = 'failed'; process.exitCode = 1; }
  }
  if (server) { server.closeAllConnections(); await new Promise(ok => server.close(ok)); }
  report.nativeSha256After = await fileHash(binary); report.adapterUnchanged = await fileHash(adapterPath) === report.adapterSha256;
  report.binaryUnchanged = report.nativeSha256Before === report.nativeSha256After;
  if (!report.adapterUnchanged || !report.binaryUnchanged) { report.status = 'failed'; process.exitCode = 1; }
  await writeFile(join(evidence, 'trace.jsonl'), trace.join(''), { mode: 0o600 });
  report.traceSha256 = await fileHash(join(evidence, 'trace.jsonl')); report.privateEvidence = evidence;
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); report.disposableHomeRemoved = true;
  report.requestCounts = Object.fromEntries(counts); report.heldRequestsClosed = [...held.values()].filter(row => row.closed).length;
  await writeFile(join(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
}
