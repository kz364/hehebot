#!/usr/bin/env node
// Disposable actual Codex -> assembled host -> MCP -> HTTPS Worker -> SQLite.
// Sprite Tasks transport is synthetic; this does not verify live provider holds.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Agent } from 'undici';
import { createSpriteCodexService } from '../runtime/sprites-codex-service.mjs';
import { ControlClient } from '../runtime/control-client.mjs';

const root = resolve(import.meta.dirname, '..');
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
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const event = (type, fields) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`);
  event('response.created', { response: { ...response, status: 'in_progress', output: [] } });
  for (const [output_index, item] of output.entries()) {
    event('response.output_item.added', { output_index, item: { ...item, ...(item.type === 'function_call' ? { arguments: '' } : { content: [] }) } });
    if (item.type === 'function_call') event('response.function_call_arguments.done', { output_index, item_id: item.id, arguments: item.arguments });
    else {
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
    instructions: 'Compare 19 against 43 without external effects.', enabled: false,
    schedule: { cron: '0 8 * * 1-5', timezone: 'Asia/Jakarta' }, trigger_source_id: null, action_policy_ids: [],
    policy: { misfire: 'coalesce', overlap: 'queue_one', max_replay: 1, max_lateness_seconds: 60 } };
  const saved = await (await trustedFetch(`${origin}/v1/commands`, { method: 'POST', headers: {
    'content-type': 'application/json', Origin: origin, 'idempotency-key': randomUUID(),
  }, body: JSON.stringify({ schema_version: 1, type: 'routine.put', payload: routine }) })).json();
  assert.equal(saved.status, 'applied');
  const queued = await (await trustedFetch(`${origin}/v1/commands`, { method: 'POST', headers: {
    'content-type': 'application/json', Origin: origin, 'idempotency-key': randomUUID(),
  }, body: JSON.stringify({ schema_version: 1, type: 'message.send', payload: { conversation_id: persona.id, text: 'SERVICE_ASSEMBLY_19_43' } }) })).json();
  assert.equal(queued.status, 'applied');
  const control = new ControlClient({ origin: origin + '/', token, fetchImpl: trustedFetch });
  await wait(async () => (await control.request('status', {})).phase === 'BOOTING', 'FakeProvider boot');
  model = createServer(async (req, res) => {
    try {
      assert.equal(req.url, '/v1/responses');
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      report.modelRequests++;
      await wait(() => bound, 'service acknowledged root');
      assert.match(JSON.stringify(body.input), /SERVICE_ASSEMBLY_19_43/);
      if (report.modelRequests === 1) {
        const tool = body.tools.find(tool => tool.name?.includes('hehebot_list_routines')) ?? body.tools.find(tool => tool.name === 'mcp__hehebot');
        assert.ok(tool);
        send(res, [{ id: `fc_${randomUUID()}`, type: 'function_call', status: 'completed', call_id: `call_${randomUUID()}`,
          ...(tool.name === 'mcp__hehebot' ? { namespace: 'mcp__hehebot', name: 'hehebot_list_routines' } : { name: tool.name }), arguments: '{}' }]);
      } else {
        assert.equal(report.modelRequests, 2);
        const output = body.input.find(item => item.type === 'function_call_output').output;
        const decoded = typeof output === 'string' ? JSON.parse(output) : output;
        const content = Array.isArray(decoded) ? JSON.parse(decoded.at(-1).text) : decoded;
        const receipt = content.content ? JSON.parse(content.content.find(item => item.type === 'text').text) : content;
        assert.equal(receipt.next_cursor, null); assert.equal(receipt.routines.length, 1);
        assert.equal(receipt.routines[0].id, routine.id); assert.equal(receipt.routines[0].revision, 1);
        assert.deepEqual(receipt.routines[0].body, routine); report.nativeReceipt = true;
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
    portalOrigin: origin + '/', runtimeTokenFile, tlsCAFile: cert, installationId: 'service-fixture',
    personas: { [persona.id]: { agentId: 'assistant', model: 'fixture-model', allowedTools: ['hehebot_list_routines'] } } };
  service = createSpriteCodexService(config, { spriteRequest, fetchImpl: trustedFetch,
    prepareNative: home => writeFile(join(home, 'config.toml'), `model = "fixture-model"\nmodel_provider = "fixture"\n[features]\ncode_mode = false\n[model_providers.fixture]\nname = "Loopback"\nbase_url = "http://127.0.0.1:${model.address().port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`, { mode: 0o600 }) });
  const dispatched = await service.start(); bound = true;
  assert.equal(dispatched.phase, 'running'); assert.equal(dispatched.claim.run.id, queued.resource_id);
  await wait(async () => (await service.observe())?.rootSettled, 'root completion');
  const native = await service.observe();
  assert.deepEqual(Object.values(native.mcpCalls), ['completed']);
  assert.equal(native.effectsSettled, undefined);
  await service.maintain();
  const operations = await service.supervisor.operations();
  assert.equal(operations.length, 3);
  assert.equal(operations.filter(operation => operation.status === 'unknown').length, 1);
  assert.ok(operations.every(operation => operation.run_id === queued.resource_id && operation.deadline_at === dispatched.claim.deadline_at));
  await assert.rejects(service.supervisor.complete({ attemptId: dispatched.attemptId, nativeRunId: native.nativeRunId, rootSettled: true }), { code: 'NATIVE_SETTLEMENT_INCOMPLETE' });
  const final = await (await trustedFetch(`${origin}/v1/state`)).json();
  assert.equal(final.runs.find(run => run.id === queued.resource_id).status, 'running');
  assert.deepEqual(taskRequests, ['PUT', 'GET']); assert.equal(report.modelRequests, 2); assert.deepEqual(errors, []);
  await service.stop();
  assert.equal((await service.journal.get('service')).phase, 'recovery');
  report.status = 'passed';
} catch (error) {
  report.error = error.code ?? error.message;
  await writeFile(join(directory, 'diagnostics.log'), workerLogs + '\n' + errors.join('\n'), { mode: 0o600 });
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
