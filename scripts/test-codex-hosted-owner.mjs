#!/usr/bin/env node
// Credential-free hosted composition: signed Access -> Worker/SQLite -> pinned
// Codex -> read-only MCP. All credentials, provider traffic and Sprite holds are synthetic.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createSpriteCodexService } from '../runtime/sprites-codex-service.mjs';
import { spawnCodex } from '../runtime/codex-transport.mjs';
import { startHostedControlFixture } from '../tests/fixtures/hosted-control.mjs';

const root = resolve(import.meta.dirname, '..');
const personaId = '11111111-1111-4111-8111-111111111111';
const routinePolicy = 'f0ff3ead-1e31-4f83-bbc2-aa25f069a962';
const prompt = 'HOSTED_OWNER_LIST_ROUTINES_43';
const reply = 'HOSTED_OWNER_ROUTINE_REPLY_43';
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));
async function wait(fn, label, timeout = 20_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await sleep(100); }
  throw new Error(`Timed out: ${label}`);
}
async function sendSse(response, output) {
  const body = { id: `resp_${randomUUID()}`, object: 'response', created_at: 1, status: 'completed', error: null,
    incomplete_details: null, model: 'fixture-model', output, parallel_tool_calls: true, tools: [], tool_choice: 'auto',
    usage: { input_tokens: 11, input_tokens_details: { cached_tokens: 0 }, output_tokens: 7,
      output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 18 } };
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const event = (type, fields) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`);
  event('response.created', { response: { ...body, status: 'in_progress', output: [] } });
  for (const [output_index, item] of output.entries()) {
    event('response.output_item.added', { output_index, item: { ...item,
      ...(item.type === 'function_call' ? { arguments: '' } : { content: [] }) } });
    if (item.type === 'function_call') event('response.function_call_arguments.done', {
      output_index, item_id: item.id, arguments: item.arguments });
    else {
      const text = item.content[0].text;
      event('response.content_part.added', { output_index, item_id: item.id, content_index: 0,
        part: { type: 'output_text', text: '', annotations: [] } });
      event('response.output_text.delta', { output_index, item_id: item.id, content_index: 0, delta: text });
      event('response.output_text.done', { output_index, item_id: item.id, content_index: 0, text });
      event('response.content_part.done', { output_index, item_id: item.id, content_index: 0, part: item.content[0] });
    }
    event('response.output_item.done', { output_index, item });
  }
  event('response.completed', { response: body }); response.end('data: [DONE]\n\n');
}

const directory = await mkdtemp(join(tmpdir(), 'hehe-hosted-owner-'));
const report = { status: 'failed', loopbackRequests: 0, spriteRequests: [] };
let fixture, reopened, service, model, nativeTransport, bound = false;
try {
  const runtimeToken = randomBytes(32).toString('hex');
  const accessClientId = `fixture-id-${randomUUID()}`, accessClientSecret = randomBytes(24).toString('hex');
  const ownerAlpha = { session_id: randomUUID(), persona_id: personaId,
    expires_at: new Date(Date.now() + 4 * 60_000).toISOString(), max_runs: 1, max_task_seconds: 45 };
  assert.ok(Date.parse(ownerAlpha.expires_at) - Date.now() <= 300_000);
  fixture = await startHostedControlFixture({ directory: join(directory, 'control'), ownerAlpha, runtimeToken,
    accessClientId, accessClientSecret });
  const ownerHeaders = { 'Cf-Access-Jwt-Assertion': fixture.ownerJwt };
  const command = async (type, payload) => {
    const response = await fixture.fetchImpl('/v1/commands', { method: 'POST', headers: { ...ownerHeaders,
      Origin: fixture.origin, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ schema_version: 1, type, payload }) });
    assert.equal(response.status, 202); const receipt = await response.json(); assert.equal(receipt.status, 'applied'); return receipt;
  };
  const initial = await fixture.fetchImpl('/v1/state', { headers: ownerHeaders });
  assert.equal(initial.status, 200); const initialState = await initial.json();
  const persona = initialState.objects.find(object => object.kind === 'persona' && object.id === personaId);
  assert.ok(persona); assert.equal(initialState.summary.execution_enabled, false);
  await command('persona.put', { ...persona.body, id: persona.id, expected_revision: persona.revision,
    tool_policy_ids: [routinePolicy] });
  const routine = { id: randomUUID(), expected_revision: 0, persona_id: personaId, name: 'Hosted routine fixture',
    instructions: 'Read-only hosted composition fixture.', enabled: false,
    schedule: { cron: '0 8 * * 1-5', timezone: 'Asia/Jakarta' }, trigger_source_id: null, action_policy_ids: [],
    policy: { misfire: 'coalesce', overlap: 'queue_one', max_replay: 1, max_lateness_seconds: 60 } };
  await command('routine.put', routine);
  const queued = await command('message.send', { conversation_id: personaId, text: prompt });

  let exactRoutineOutput;
  model = createServer(async (request, response) => {
    try {
      assert.equal(request.url, '/v1/responses');
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString()); report.loopbackRequests++;
      assert.ok(report.loopbackRequests <= 2, 'unexpected inference replay');
      if (report.loopbackRequests === 1) {
        await wait(() => bound, 'root submission acknowledged before tool call');
        const tool = body.tools.find(value => value.name?.includes('hehebot_list_routines')) ??
          body.tools.find(value => value.name === 'mcp__hehebot');
        assert.ok(tool, 'read-only routine MCP tool not advertised');
        await sendSse(response, [{ id: `fc_${randomUUID()}`, type: 'function_call', status: 'completed',
          call_id: 'hosted_routines_call', ...(tool.name === 'mcp__hehebot'
            ? { namespace: 'mcp__hehebot', name: 'hehebot_list_routines' } : { name: tool.name }), arguments: '{}' }]);
      } else {
        const output = body.input.find(value => value.type === 'function_call_output' && value.call_id === 'hosted_routines_call');
        assert.ok(output); const decoded = typeof output.output === 'string' ? JSON.parse(output.output) : output.output;
        const content = Array.isArray(decoded) ? JSON.parse(decoded.at(-1).text) : decoded;
        exactRoutineOutput = content.content ? JSON.parse(content.content.find(value => value.type === 'text').text) : content;
        const [listed] = exactRoutineOutput.routines;
        assert.match(listed.created_at, /^\d{4}-\d\d-\d\dT/); assert.equal(listed.updated_at, listed.created_at);
        assert.deepEqual(exactRoutineOutput, { routines: [{ id: routine.id, kind: 'routine', revision: 1,
          created_at: listed.created_at, updated_at: listed.created_at, deleted_at: null, body: routine }], next_cursor: null });
        await sendSse(response, [{ id: `msg_${randomUUID()}`, type: 'message', status: 'completed', role: 'assistant',
          content: [{ type: 'output_text', text: reply, annotations: [] }] }]);
      }
    } catch (error) {
      report.modelError = error.message;
      if (!response.headersSent) await sendSse(response, [{ id: `msg_${randomUUID()}`, type: 'message', status: 'completed',
        role: 'assistant', content: [{ type: 'output_text', text: 'FIXTURE_FAILED', annotations: [] }] }]);
      else response.end();
    }
  });
  await new Promise(resolveListen => model.listen(0, '127.0.0.1', resolveListen));

  const stateDirectory = join(directory, 'runtime'); await mkdir(stateDirectory, { mode: 0o700 });
  const runtimeTokenFile = join(directory, 'runtime-token'), accessClientIdFile = join(directory, 'access-id');
  const accessClientSecretFile = join(directory, 'access-secret');
  await Promise.all([writeFile(runtimeTokenFile, runtimeToken, { mode: 0o600 }),
    writeFile(accessClientIdFile, accessClientId, { mode: 0o600 }),
    writeFile(accessClientSecretFile, accessClientSecret, { mode: 0o600 })]);
  let held;
  const spriteRequest = (options, callback) => {
    assert.equal(options.socketPath, '/.sprite/api.sock');
    report.spriteRequests.push(options.method);
    const request = new EventEmitter(); request.setTimeout = () => {}; request.destroy = () => {};
    request.end = data => {
      if (options.method === 'PUT') held = { name: options.path.split('/').at(-1),
        expires_at: new Date(Date.now() + JSON.parse(data).expire * 1000).toISOString() };
      else assert.equal(options.method, 'GET');
      const response = new EventEmitter(); response.statusCode = 200; callback(response);
      response.emit('data', Buffer.from(JSON.stringify(options.method === 'GET' ? held : {}))); response.emit('end');
    };
    return request;
  };
  const config = { stateDirectory, ownerAlpha, hostedOwnerBindingSha256: fixture.ownerBindingSha256,
    binary: join(root, '.local/codex-runtime/node_modules/.bin/codex'), portalOrigin: `${fixture.origin}/`,
    runtimeTokenFile, accessClientIdFile, accessClientSecretFile, tlsCAFile: fixture.caFile,
    installationId: 'hosted-fixture', personas: { [personaId]: {
      agentId: 'assistant', model: 'fixture-model', allowedTools: ['hehebot_list_routines'] } } };
  service = createSpriteCodexService(config, { spriteRequest, fetchImpl: fixture.fetchImpl,
    launch: options => (nativeTransport = spawnCodex(options)),
    prepareNative: home => writeFile(join(home, 'config.toml'),
      `model = "fixture-model"\nmodel_provider = "fixture"\n[features]\ncode_mode = false\nsleep_tool = { enabled = true, mode = "always_on" }\n[model_providers.fixture]\nname = "Loopback"\nbase_url = "http://127.0.0.1:${model.address().port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`, { mode: 0o600 }) });
  const dispatched = await service.start();
  bound = true;
  assert.equal(dispatched.claim.run.id, queued.resource_id); assert.equal(service.adapter.testMode, false);
  assert.equal(service.adapter.admissionReadiness().productionVerified, false);
  assert.ok(dispatched.claim.deadline_at <= ownerAlpha.expires_at);
  await wait(async () => {
    await service.maintain();
    if (report.loopbackRequests !== 2) return false;
    const response = await fixture.fetchImpl('/v1/state', { headers: ownerHeaders });
    if (response.status !== 200) return false;
    return (await response.json()).output_previews.some(value => value.run_id === queued.resource_id && value.text === reply);
  }, 'persisted provisional reply');
  assert.equal(report.loopbackRequests, 2); assert.ok(exactRoutineOutput);
  assert.equal(report.modelError, undefined);
  assert.ok(fixture.outboundRequests.every(request => request.method === 'GET' &&
    request.url === 'https://synthetic.cloudflareaccess.com/cdn-cgi/access/certs'));
  const nativeConfig = await nativeTransport.request('config/read', { includeLayers: false,
    cwd: join(stateDirectory, 'workspace') });
  assert.equal(nativeConfig.config.features.sleep_tool?.enabled ?? nativeConfig.config.features.sleep_tool, false);
  assert.equal(service.adapter.sleepReadiness().allowed, false);
  await service.stop(); service = null;
  assert.deepEqual(report.spriteRequests, ['PUT', 'GET']);
  await fixture.close(); fixture = null;

  reopened = await startHostedControlFixture({ directory: join(directory, 'control'), ownerAlpha, runtimeToken,
    accessClientId, accessClientSecret });
  const before = report.loopbackRequests;
  const readbackResponse = await reopened.fetchImpl('/v1/state', { headers: { 'Cf-Access-Jwt-Assertion': reopened.ownerJwt } });
  assert.equal(readbackResponse.status, 200); const readback = await readbackResponse.json();
  assert.equal(readback.output_previews.find(value => value.run_id === queued.resource_id)?.text, reply);
  assert.equal(report.loopbackRequests, before); assert.equal(readback.summary.execution_enabled, false);
  Object.assign(report, { status: 'passed', signedAccess: true, exactRoutineReceipt: true,
    provisionalReply: reply, persistedReadback: true, replayed: false, productionEnabled: false,
    nativeVerified: false, sleepDenied: true, runId: queued.resource_id });
} catch (error) {
  report.error = error.code ?? error.message; report.stack = error.stack; process.exitCode = 1;
} finally {
  await service?.stop().catch(() => {}); await fixture?.close().catch(() => {}); await reopened?.close().catch(() => {});
  if (model) { model.closeAllConnections(); await new Promise(resolveClose => model.close(resolveClose)); }
  if (report.status === 'passed') await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  else report.privateDiagnostics = directory;
  console.log(JSON.stringify(report, null, 2));
}
