#!/usr/bin/env node
// Stage A warm runtime integration: two successive ordinary owner messages
// canonically complete in ONE pinned Codex 0.154.0 process/boot/epoch under
// the default-off warm contract. Real local Codex binary + loopback model
// server + the authenticated Worker/SQLite fixture; credential-free, no live
// model, provider or account. A second message never triggers a second wake,
// process, provider bootstrap, activity hold, boot or epoch.
// --browser drives both ordinary owner messages through the actual portal
// composer in a real browser against the same authenticated Worker/SQLite
// fixture and the same single warm process; it is local integration only,
// never production Access SSO, actual outbound Worker wake or a live model.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startHostedControlFixture } from '../tests/fixtures/hosted-control.mjs';
import { ControlClient } from '../runtime/control-client.mjs';
import { createHostedOwnerWakeService } from '../runtime/hosted-owner-wake.mjs';
import { readOwnerAlphaConfig } from '../runtime/owner-alpha-entry.mjs';
import { createSpriteCodexService } from '../runtime/sprites-codex-service.mjs';
import { spawnCodex } from '../runtime/codex-transport.mjs';
import { createCodexTextOnlyProfile, codexTextOnlyProfileSha256 } from '../runtime/codex-text-only.mjs';

const browserMode = process.argv.includes('--browser');
const exec = (await import('node:util')).promisify(execFile);
const ROUTINE_MANAGE_POLICY = 'f0ff3ead-1e31-4f83-bbc2-aa25f069a962';
const persona = '11111111-1111-4111-8111-111111111111';
const replies = ['The notebook is cobalt blue, reference 47.', 'Cobalt blue.'];
const pause = ms => new Promise(ok => setTimeout(ok, ms));
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const directory = await mkdtemp(join(tmpdir(), 'hehe-warm-manager-'));
const report = { status: 'failed', mode: browserMode ? 'browser-composer' : 'http-one-process', nativeStarts: 0, modelRequests: 0, spriteRequests: [] };
// Real-browser session for --browser mode. The synthetic signed owner identity
// is fixture-only: the header rides the same authenticated Worker ingress.
// Session names must stay short; keep this label at or under 20 characters.
const browserSession = 'warm-manager-' + randomUUID().slice(0, 5);
const browser = (...args) => exec('agent-browser', ['--session', browserSession, '--ignore-https-errors', ...args], { timeout: 30000 });
const browserJson = async code => JSON.parse((await browser('eval', code)).stdout);
const waitFor = async (probe, timeoutMs, stepMs = 250) => {
  const end = Date.now() + timeoutMs;
  do {
    try { if (await probe()) return true; } catch { /* transient DOM/parse states */ }
    await pause(stepMs);
  } while (Date.now() < end);
  return false;
};
// Disposable Sprite seam: the manager task hold and the activity guard both
// ride it; every hold and confirmation is recorded for exact-sequence asserts.
const held = new Map(), taskNames = [];
const spriteRequest = (options, callback) => {
  assert.equal(options.socketPath, '/.sprite/api.sock');
  assert.equal(options.host, 'sprite');
  assert.match(options.path, /^\/v1\/tasks\/[a-zA-Z0-9_-]+$/);
  report.spriteRequests.push(options.method);
  const request = new EventEmitter(); request.setTimeout = () => {}; request.destroy = () => {};
  request.end = data => {
    const name = options.path.split('/').at(-1);
    if (options.method === 'PUT') {
      taskNames.push(name);
      held.set(name, { name, expires_at: new Date(Date.now() + JSON.parse(data).expire * 1000).toISOString() });
    } else assert.equal(options.method, 'GET');
    const response = new EventEmitter(); response.statusCode = 200; callback(response);
    response.emit('data', Buffer.from(JSON.stringify(options.method === 'GET' ? held.get(name) : {}))); response.emit('end');
  };
  return request;
};
const deferred = () => { let resolve, reject; const promise = new Promise((ok, no) => { resolve = ok; reject = no; }); return { promise, resolve, reject }; };
let fixture, model, service, listener, modelError, wakeDeadline, hostTokenBytes, firstEnvelope;
try {
  const home = join(directory, 'native-home'), sessionsDirectory = join(directory, 'sessions');
  await mkdir(home, { mode: 0o700 }); await mkdir(sessionsDirectory, { mode: 0o700 });
  const textOnlyProfile = { codexVersion: '0.154.0', model: 'fixture-model', catalogPath: join(directory, 'catalog.json'),
    catalogValidation: 'synthetic-fixture', syntheticFixture: true,
    modelCatalog: { models: [{ slug: 'fixture-model', display_name: 'Synthetic warm fixture', description: null,
      supported_reasoning_levels: [], shell_type: 'unified_exec', visibility: 'list', supported_in_api: true,
      priority: 1, upgrade: null, model_messages: { instructions_template: 'Synthetic credential-free fixture.', instructions_variables: null },
      default_reasoning_summary: 'auto', support_verbosity: false, tool_mode: 'direct', default_verbosity: null,
      apply_patch_tool_type: null, truncation_policy: { mode: 'bytes', limit: 10000 }, supports_image_detail_original: false,
      context_window: 272000, auto_compact_token_limit: null, effective_context_window_percent: 95, experimental_supported_tools: [] }] } };
  const profile = createCodexTextOnlyProfile(textOnlyProfile);
  await writeFile(textOnlyProfile.catalogPath, JSON.stringify(profile.modelCatalog), { mode: 0o600 });
  const text_only = { profile_version: profile.version, profile_sha256: codexTextOnlyProfileSha256(profile) };
  const originalPolicy = { session_id: randomUUID(), persona_id: persona, expires_at: new Date(Date.now() - 120000).toISOString(),
    max_runs: 1, max_task_seconds: 30, text_only };
  const epochOneBoot = randomUUID();
  // Warm secrets are pairwise distinct from each other, from the legacy runtime
  // token and from the wake token; none is ever a model or account credential.
  const managerToken = 'warm-manager-' + randomBytes(24).toString('hex');
  const hostSigningKey = 'warm-host-' + randomBytes(24).toString('hex');
  const taskSigningKey = 'warm-task-' + randomBytes(24).toString('hex');
  const runtimeToken = 'legacy-runtime-' + randomBytes(24).toString('hex');
  const wakeToken = 'warm-wake-' + randomBytes(24).toString('hex');
  const accessClientId = randomBytes(24).toString('hex'), accessClientSecret = randomBytes(32).toString('hex');
  const ownerBinding = hash({ auth_mode: 'access', installation_id: 'hosted-fixture',
    issuer: 'https://synthetic.cloudflareaccess.com', audience: 'fixture-audience', owner_subject: 'fixture-owner' });
  const warmConfig = { schema_version: 1, kind: 'owner-alpha-warm-generation-v1', installation_id: 'hosted-fixture',
    owner_id: 'fixture-owner', owner_binding_sha256: ownerBinding, policy_revision: 'warm-stage-a-v1', persona_id: persona,
    text_only, expires_at: new Date(Date.now() + 120000).toISOString(), max_task_seconds: 30, max_admissions: 2,
    prior_cost_micro_usd: 1000, prior_cost_source: 'synthetic-baseline', total_cap_micro_usd: 10000000,
    reservation_micro_usd: 2000, seed_retirement: { epoch: 1, boot_id: epochOneBoot, session_id: originalPolicy.session_id,
      transition_id: null, observed_at: new Date(Date.now() - 60000).toISOString(), direct_child_stopped: true,
      execution_lock_free: true, session_lock_free: true, source: 'synthetic-warm-seed' } };
  fixture = await startHostedControlFixture({ directory: join(directory, 'control'), ownerAlpha: originalPolicy,
    runtimeToken, accessClientId, accessClientSecret,
    ...(browserMode ? { portalAssetsDirectory: resolve('public') } : {}),
    warm: { generation: warmConfig, token: managerToken, hostSigningKey, taskSigningKey, wakeToken } });
  assert.equal(fixture.ownerBindingSha256, ownerBinding, 'warm owner binding differs from authenticated custody');
  await fixture.retirePredecessor(epochOneBoot);
  const managerClient = new ControlClient({ origin: fixture.origin, token: managerToken, principal: 'warm-manager',
    accessClientId, accessClientSecret, fetchImpl: fixture.fetchImpl });
  const ownerHeaders = { 'Cf-Access-Jwt-Assertion': fixture.ownerJwt };
  const command = (type, payload, idempotencyKey) => ({ method: 'POST', headers: { ...ownerHeaders,
    Origin: fixture.origin, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey ?? randomUUID() },
    body: JSON.stringify({ schema_version: 1, type, payload }) });
  const readState = async () => (await fixture.fetchImpl('/v1/state', { headers: ownerHeaders })).json();
  // The seeded persona needs the bounded routine-read policy for its staged task
  // token route; granted through the public owner command surface only.
  const personaPut = await fixture.fetchImpl('/v1/commands', command('persona.put', { id: persona, expected_revision: 1,
    name: 'Chief of Staff', instructions: 'Coordinate the owner’s requests. Keep actions within explicit authorization.',
    tool_policy_ids: [ROUTINE_MANAGE_POLICY], archived: false }));
  assert.equal(personaPut.status, 202);
  assert.equal((await personaPut.json()).status, 'applied');

  // Passive reads stage nothing: no launch envelope taken, no sprite hold, no
  // native start, and the summary still offers the first admission.
  let summary = (await readState()).summary;
  assert.deepEqual(summary.owner_alpha_warm, { schema_version: 1, kind: 'owner-alpha-warm-summary-v1',
    policy_revision: 'warm-stage-a-v1', persona_id: persona, policy_expires_at: warmConfig.expires_at,
    max_admissions: 2, admissions_used: 0, message_admission_available: true, generation: null });
  assert.equal(summary.owner_alpha_session, undefined);
  assert.equal(summary.owner_alpha_bootstrap, undefined);
  assert.equal(summary.owner_alpha_generation, undefined);
  assert.equal(await managerClient.request('generation', {}), null, 'passive generation read staged work');
  assert.equal(report.nativeStarts, 0); assert.equal(report.modelRequests, 0);
  assert.deepEqual(report.spriteRequests, []); assert.deepEqual(await readdir(sessionsDirectory), []);

  if (browserMode) {
    // The user worker runs ahead of static assets: the portal routes stay
    // behind owner authentication. Unauthenticated and wrong-owner requests
    // to the asset routes are denied; the authenticated owner is served.
    for (const route of ['/', '/app.js']) {
      assert.equal((await fixture.fetchImpl(route)).status, 401, `unauthenticated ${route} was not denied`);
      assert.equal((await fixture.fetchImpl(route, { headers: { 'Cf-Access-Jwt-Assertion': fixture.otherOwnerJwt } })).status, 401,
        `wrong-owner ${route} was not denied`);
      const served = await fixture.fetchImpl(route, { headers: ownerHeaders });
      assert.equal(served.status, 200, `authenticated ${route} was not served`);
      assert.ok((await served.text()).length > 0, `authenticated ${route} returned an empty body`);
    }
    // Open the actual portal in a real browser against the authenticated
    // Worker origin. The synthetic signed identity is fixture-only.
    await browser('set', 'headers', JSON.stringify(ownerHeaders));
    await browser('open', fixture.origin + '/');
    await browser('set', 'viewport', '1280', '900', '2');
    // Wait for the exact connected state: an initial Connecting is also truthy.
    assert.ok(await waitFor(() => browserJson('document.querySelector("#connection")?.textContent === "Connected"'), 30000),
      'portal did not connect to the Worker');
    // The pre-first warm banner still offers both admissions of one generation.
    assert.match(await browserJson('document.querySelector("#runtime-banner-text")?.textContent ?? ""'), /2 of 2 messages remaining/);
    assert.match(await browserJson('document.querySelector("#runtime-banner-text")?.textContent ?? ""'), /One fixed generation starts with your first Send/);
    // Select the warm generation's persona explicitly (Chief of Staff).
    assert.ok(await waitFor(() => browserJson(`Boolean(document.querySelector('[data-persona-id="${persona}"]'))`), 30000),
      'warm persona missing from roster');
    await browser('click', `[data-persona-id="${persona}"]`);
    assert.ok(await waitFor(() => browserJson('!document.querySelector("#send").disabled && !document.querySelector("#message").readOnly'), 30000),
      'warm persona composer never admitted the first send');
    // Passive-read custody: portal load, roster selection, state polling and
    // the 5-second refresh timer caused zero commands, launches, model
    // requests, Sprite contacts or staged sessions.
    const stateReadCount = 'performance.getEntriesByType("resource").filter(entry => new URL(entry.name).pathname === "/v1/state").length';
    const priorStateReads = await browserJson(stateReadCount);
    assert.ok(await waitFor(async () => await browserJson(stateReadCount) > priorStateReads, 10000),
      'passive portal refresh never completed another state read');
    assert.equal(report.nativeStarts, 0, 'passive portal load launched a native runtime');
    assert.equal(report.modelRequests, 0, 'passive portal load reached a model');
    assert.deepEqual(report.spriteRequests, [], 'passive portal load contacted the Sprite');
    assert.deepEqual(await readdir(sessionsDirectory), [], 'passive portal load staged a session');
    assert.equal(await managerClient.request('generation', {}), null, 'passive portal load staged a launch envelope');
    assert.deepEqual(fixture.browserCommands, [], 'passive portal load sent a command');
  }

  const text1 = 'Remember the cobalt blue notebook, reference 47.', text2 = 'What color was the notebook?';
  let request1, receipt1;
  if (browserMode) {
    // Send the first ordinary owner message through the actual composer.
    await browser('fill', '#message', text1);
    await browser('click', '#send');
    // The composer clears the textarea only after its receipt is confirmed.
    assert.ok(await waitFor(() => browserJson('document.querySelector("#message")?.value === ""'), 15000),
      'composer did not confirm the first message');
    assert.equal(await browserJson(`localStorage.getItem("personal.pending.${persona}")`), null,
      'composer left an unconfirmed pending first message');
    assert.equal(fixture.browserCommands.length, 1, 'composer send was not recorded exactly once');
    const sent1 = fixture.browserCommands[0];
    assert.deepEqual(JSON.parse(sent1.body), { schema_version: 1, type: 'message.send',
      payload: { conversation_id: persona, text: text1 } });
    assert.match(sent1.headers['idempotency-key'], uuidPattern, 'composer idempotency key is not a UUID');
    assert.equal(sent1.headers.origin, fixture.origin);
    assert.equal(sent1.headers['sec-fetch-site'], 'same-origin');
    // Recover the durable receipt by replaying the exact composer bytes: the
    // idempotent replay returns the stored receipt without a new command.
    request1 = { method: 'POST', headers: { ...ownerHeaders, 'Content-Type': sent1.headers['content-type'],
      Origin: fixture.origin, 'Idempotency-Key': sent1.headers['idempotency-key'] }, body: sent1.body };
    const confirmed1 = await fixture.fetchImpl('/v1/commands', request1);
    assert.equal(confirmed1.status, 202);
    assert.equal(fixture.browserCommands.length, 1, 'receipt replay sent another browser command');
    receipt1 = await confirmed1.json();
  } else {
    request1 = command('message.send', { conversation_id: persona, text: text1 });
    const response1 = await fixture.fetchImpl('/v1/commands', request1);
    assert.equal(response1.status, 202);
    receipt1 = await response1.json();
  }
  assert.equal(receipt1.status, 'applied');
  const rowsOf = (rows, suffix) => rows.filter(row => row.key.endsWith(suffix));
  const rows1 = await fixture.warmRows();
  const generationRow1 = rowsOf(rows1, 'owner_alpha_warm_generation:2')[0];
  const manifestRow1 = rowsOf(rows1, 'owner_alpha_warm_manifest:2:1')[0];
  const reservationRow1 = rowsOf(rows1, 'owner_alpha_reservation:2:1')[0];
  assert.ok(generationRow1 && manifestRow1 && reservationRow1, 'first admission rows missing');
  assert.equal(manifestRow1.value.run_id, receipt1.resource_id);
  assert.equal(generationRow1.value.epoch, 2);
  // Passive generation reads after admission are byte-stable and stage nothing.
  firstEnvelope = await managerClient.request('generation', {});
  assert.ok(firstEnvelope && firstEnvelope.kind === 'owner-alpha-warm-launch-v1');
  assert.equal(firstEnvelope.generation.epoch, 2);
  assert.equal(firstEnvelope.generation.policy.max_runs, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(firstEnvelope.generation.policy.text_only)), text_only);
  assert.deepEqual(await readdir(sessionsDirectory), [], 'passive generation read staged a session');
  assert.equal(report.nativeStarts, 0); assert.deepEqual(report.spriteRequests, []);

  // The Durable Object alarm delivers the single once-only wake intent.
  let intent = null;
  for (let tries = 0; tries < 120 && !intent; tries++) { intent = await fixture.wakeIntent(); if (!intent) await pause(250); }
  assert.ok(intent, 'wake intent never formed');
  // The fixture's warm Durable Object stubs the outbound wake delivery, so the
  // single once-only intent settles queued and is never replayed or re-formed.
  assert.deepEqual(intent, { epoch: 2, boot_id: generationRow1.value.boot_id,
    transition_id: generationRow1.value.transition_id, status: 'queued' });

  // Deterministic envelope: a second read reproduces the identical credential.
  assert.deepEqual(await managerClient.request('generation', {}), firstEnvelope);

  const accessClientIdFile = join(directory, 'access-id'), accessClientSecretFile = join(directory, 'access-secret');
  await writeFile(accessClientIdFile, accessClientId, { mode: 0o600 });
  await writeFile(accessClientSecretFile, accessClientSecret, { mode: 0o600 });
  const template = { stateDirectory: join(directory, 'unused-state'), nativeHome: home,
    binary: resolve('.local/codex-runtime/node_modules/.bin/codex'), portalOrigin: fixture.origin,
    installationId: 'hosted-fixture', hostedOwnerBindingSha256: fixture.ownerBindingSha256,
    runtimeTokenFile: join(directory, 'unused-token'), accessClientIdFile, accessClientSecretFile,
    tlsCAFile: fixture.caFile, textOnlyProfile,
    personas: { [persona]: { agentId: 'assistant', model: 'fixture-model', allowedTools: [] } } };
  const templatePath = join(directory, 'template.json'), templateBytes = JSON.stringify(template);
  await writeFile(templatePath, templateBytes, { mode: 0o600 });
  const managerTokenFile = join(directory, 'manager-token'), wakeTokenFile = join(directory, 'wake-token');
  await writeFile(managerTokenFile, managerToken, { mode: 0o600 });
  await writeFile(wakeTokenFile, wakeToken, { mode: 0o600 });
  const managerConfig = { kind: 'owner-alpha-warm-manager-v1', portalOrigin: fixture.origin,
    installationId: 'hosted-fixture', hostedOwnerBindingSha256: fixture.ownerBindingSha256,
    managerTokenFile, templatePath, templateSha256: hash(templateBytes), sessionsDirectory,
    accessClientIdFile, accessClientSecretFile };
  const configPath = join(directory, 'manager.json');
  await writeFile(configPath, JSON.stringify(managerConfig), { mode: 0o600 });

  const run1Done = deferred(), proceed2 = deferred(), run2Done = deferred(), proceedStop = deferred();
  const launchImpl = async (path, { expectedSha256 }) => {
    // The manager staged exactly one exclusive session for this transition.
    assert.deepEqual(await readdir(sessionsDirectory), [intent.transition_id]);
    assert.deepEqual(report.spriteRequests.slice(0, 2), ['PUT', 'GET'], 'warm manager hold must precede launch');
    assert.equal(report.nativeStarts, 0, 'native started before the manager handed over');
    const { config } = await readOwnerAlphaConfig(path, expectedSha256);
    assert.deepEqual(config.ownerAlpha, { session_id: generationRow1.value.policy.session_id, persona_id: persona,
      expires_at: generationRow1.value.policy.expires_at, max_runs: 2, max_task_seconds: 30, text_only });
    assert.deepEqual(config.ownerAlphaGeneration, { epoch: intent.epoch, boot_id: intent.boot_id, transition_id: intent.transition_id });
    assert.deepEqual(config.ownerAlphaWarm, { generation_sha256: generationRow1.value.authority.generation_sha256 });
    assert.equal(config.stateDirectory, join(sessionsDirectory, intent.transition_id));
    const hostTokenFile = config.runtimeTokenFile;
    hostTokenBytes = await readFile(hostTokenFile);
    const hostTokenStat = await stat(hostTokenFile);
    assert.equal(hostTokenStat.mode & 0o777, 0o600, 'host token is not owner-only');
    const configJson = JSON.stringify(config);
    assert.ok(!configJson.includes(hostTokenBytes.toString('utf8')), 'raw host token entered the child configuration');

    model = createServer(async (request, response) => {
      try {
        assert.equal(request.url, '/v1/responses');
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks));
        report.modelRequests++;
        assert.deepEqual(body.tools, [], 'warm model request is not text-only');
        if (report.modelRequests === 1) {
          assert.ok(JSON.stringify(body.input).includes(text1), 'first owner text absent from first native request');
        } else {
          assert.equal(report.modelRequests, 2, 'a third model request happened');
          assert.ok(JSON.stringify(body.input).includes(text1), 'first owner text absent from second native request');
          assert.ok(JSON.stringify(body.input).includes(replies[0]), 'first canonical reply absent from second native request');
          assert.ok(JSON.stringify(body.input).includes(text2), 'second owner text absent from second native request');
        }
        const item = { id: `msg_${randomUUID()}`, type: 'message', status: 'completed', role: 'assistant',
          content: [{ type: 'output_text', text: replies[report.modelRequests - 1], annotations: [] }] };
        const result = { id: `resp_${randomUUID()}`, object: 'response', created_at: 1, status: 'completed', error: null,
          incomplete_details: null, model: 'fixture-model', output: [item], tools: [], tool_choice: 'auto', parallel_tool_calls: false,
          usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        const event = (type, fields) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`);
        const reply = replies[report.modelRequests - 1];
        event('response.created', { response: { ...result, status: 'in_progress', output: [] } });
        event('response.output_item.added', { output_index: 0, item: { ...item, content: [] } });
        event('response.content_part.added', { output_index: 0, item_id: item.id, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
        event('response.output_text.delta', { output_index: 0, item_id: item.id, content_index: 0, delta: reply });
        event('response.output_text.done', { output_index: 0, item_id: item.id, content_index: 0, text: reply });
        event('response.content_part.done', { output_index: 0, item_id: item.id, content_index: 0, part: item.content[0] });
        event('response.output_item.done', { output_index: 0, item });
        event('response.completed', { response: result }); response.end('data: [DONE]\n\n');
      } catch (error) { modelError = error; response.destroy(); }
    });
    await new Promise(ok => model.listen(0, '127.0.0.1', ok));
    service = createSpriteCodexService(config, { spriteRequest, fetchImpl: fixture.fetchImpl,
      launch: options => { report.nativeStarts++; return spawnCodex(options); },
      prepareNative: home => writeFile(join(home, 'config.toml'), `model = "fixture-model"\nmodel_provider = "fixture"\n[model_providers.fixture]\nname = "Loopback"\nbase_url = "http://127.0.0.1:${model.address().port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`, { mode: 0o600 }) });
    const dispatched = await service.start();
    assert.equal(report.nativeStarts, 1, 'warm session started more than one native process');
    assert.equal(dispatched.claim.run.id, receipt1.resource_id);
    assert.equal(dispatched.claim.manifest.admission, 1);
    assert.equal(dispatched.claim.manifest.manifest_sha256, manifestRow1.value.manifest_sha256);
    assert.deepEqual(Object.keys(dispatched.claim.task_credential).sort(), ['grant', 'token_file']);
    assert.equal(dispatched.claim.task_credential.token_file, join(config.stateDirectory, 'task-tokens', receipt1.resource_id));
    const token1 = await readFile(dispatched.claim.task_credential.token_file);
    const token1Stat = await stat(dispatched.claim.task_credential.token_file);
    assert.equal(token1Stat.mode & 0o777, 0o600, 'task token file is not owner-only');
    assert.equal(JSON.parse(Buffer.from(token1.toString('utf8').split('.')[0], 'base64url').toString('utf8')).typ, 'hehebot-warm-task+jwt');

    const stateDirectory = config.stateDirectory;
    const completedRun = async runId => {
      const state = await readState();
      return state.runs.find(run => run.id === runId)?.status === 'completed';
    };
    const maintainUntil = async runId => {
      const end = Date.now() + 45000;
      while (Date.now() < end) {
        if (modelError) throw modelError;
        await service.maintain();
        if (await completedRun(runId)) return;
        await pause(100);
      }
      assert.fail(`run ${runId} never completed canonically`);
    };
    await maintainUntil(receipt1.resource_id);
    const state1 = await readState();
    assert.deepEqual(state1.summary.owner_alpha_warm, { schema_version: 1, kind: 'owner-alpha-warm-summary-v1',
      policy_revision: 'warm-stage-a-v1', persona_id: persona, policy_expires_at: warmConfig.expires_at,
      max_admissions: 2, admissions_used: 1, message_admission_available: true,
      generation: { session_id: generationRow1.value.policy.session_id, expires_at: generationRow1.value.policy.expires_at, epoch: 2 } });
    const history1 = await (await fixture.fetchImpl(`/v1/conversations/${persona}/events`, { headers: ownerHeaders })).json();
    const results1 = history1.events.filter(event => event.type === 'run.result' && event.payload.run_id === receipt1.resource_id);
    assert.equal(results1.length, 1); assert.equal(results1[0].payload.text, replies[0]);
    let families = await service.supervisor.bridge.families();
    assert.equal(families.length, 1); assert.equal(families[0].phase, 'complete');
    assert.equal(families[0].claim.run.id, receipt1.resource_id);
    if (browserMode) {
      // The portal timeline must show the owner message and the attributed
      // canonical reply for the first turn.
      assert.ok(await waitFor(() => browserJson(
        `[...document.querySelectorAll(".message.bot .message-body")].some(node => node.textContent === ${JSON.stringify(replies[0])})`), 30000),
        'first canonical reply missing from portal timeline');
      assert.ok(await browserJson(
        `[...document.querySelectorAll(".message.user .message-body")].some(node => node.textContent === ${JSON.stringify(text1)})`),
        'first owner message missing from portal timeline');
      // Canonical completion re-enables Send within the SAME generation: no
      // retirement, no second boot, no second launch envelope taken.
      assert.ok(await waitFor(() => browserJson(
        '!document.querySelector("#send").disabled && !document.querySelector("#message").readOnly'), 30000),
        'first canonical completion did not re-enable the composer within the same generation');
      assert.match(await browserJson('document.querySelector("#runtime-banner-text")?.textContent ?? ""'), /1 of 2 messages remaining/);
      assert.match(await browserJson('document.querySelector("#runtime-banner-text")?.textContent ?? ""'), /Generation 2 deadline/);
      assert.equal(report.nativeStarts, 1, 'first completion started another native process');
      assert.equal(fixture.browserCommands.length, 1, 'completion sent another browser command');
    }
    run1Done.resolve();

    await proceed2.promise;
    // The already-running service claims the second admitted message itself: no
    // second wake, boot, provider bootstrap or activity hold.
    assert.equal(report.nativeStarts, 1, 'second message started another native process');
    await maintainUntil(run2.resource_id);
    const familiesAll = await service.supervisor.bridge.families();
    // A release prunes completed families, so after two sequential claims the
    // cursor retains exactly the second family: both runs left one lane each.
    assert.equal(familiesAll.length, 1, `unexpected families: ${JSON.stringify(familiesAll.map(f => ({ phase: f.phase, attemptId: f.attemptId })))}`);
    assert.equal(familiesAll[0].phase, 'complete', 'retained family is not complete');
    assert.equal(familiesAll[0].claim.run.id, run2.resource_id, 'retained family holds the wrong claim');
    assert.notEqual(dispatched.attemptId, familiesAll[0].attemptId, 'both messages shared one attempt identity');
    const observed1 = await service.adapter.requireRun(dispatched.attemptId);
    const observed2 = await service.observe(familiesAll[0].attemptId);
    assert.match(observed1.threadId, uuidPattern); assert.match(observed2.threadId, uuidPattern);
    assert.notEqual(observed1.threadId, observed2.threadId, 'second message did not get a fresh native root thread');
    const token2 = await readFile(join(stateDirectory, 'task-tokens', run2.resource_id));
    assert.ok(!token1.equals(token2), 'both admissions staged identical task tokens');
    const journalFiles = (await readdir(join(stateDirectory, 'journal'))).map(name => readFile(join(stateDirectory, 'journal', name), 'utf8'));
    const journals = await Promise.all(journalFiles);
    for (const journal of journals) {
      assert.ok(!journal.includes(token1.toString('utf8')), 'raw task token leaked into the journal');
      assert.ok(!journal.includes(token2.toString('utf8')), 'raw task token leaked into the journal');
      assert.ok(!journal.includes(hostTokenBytes.toString('utf8')), 'raw host token leaked into the journal');
    }
    const history2 = await (await fixture.fetchImpl(`/v1/conversations/${persona}/events`, { headers: ownerHeaders })).json();
    const results2 = history2.events.filter(event => event.type === 'run.result' && event.payload.run_id === run2.resource_id);
    assert.equal(results2.length, 1); assert.equal(results2[0].payload.text, replies[1]);
    if (browserMode) {
      // The second canonical reply must appear in the same timeline, and the
      // exhausted generation must close the composer again: no third admission,
      // no retirement, no second boot.
      assert.ok(await waitFor(() => browserJson(
        `[...document.querySelectorAll(".message.bot .message-body")].filter(node => node.textContent === ${JSON.stringify(replies[1])}).length === 1`), 30000),
        'second canonical reply missing from portal timeline');
      assert.ok(await browserJson(
        `[...document.querySelectorAll(".message.user .message-body")].some(node => node.textContent === ${JSON.stringify(text2)})`),
        'second owner message missing from portal timeline');
      assert.ok(await waitFor(() => browserJson(
        'document.querySelector("#send").disabled && document.querySelector("#message").readOnly'), 30000),
        'exhausted generation did not close the composer');
      assert.match(await browserJson('document.querySelector("#runtime-banner-text")?.textContent ?? ""'), /Both warm messages have been used/);
      assert.equal(report.nativeStarts, 1, 'second completion started another native process');
      assert.equal(fixture.browserCommands.length, 2, 'exhaustion sent another browser command');
    }
    run2Done.resolve();

    await proceedStop.promise;
    // The warm process stays available through the fixed generation expiry. This
    // stop is the test's own explicit post-expiry service.stop(): it verifies
    // explicit post-expiry stopped custody (recovery journal, nativeStopped,
    // dual-lock readback). runHostedOwnerAlpha's independent automatic stop
    // timer (expiry + 30s grace) is NOT exercised by this script; that
    // warm entrypoint path requires separate verification.
    while (Date.now() < Date.parse(generationRow1.value.policy.expires_at)) await pause(200);
    await service.stop();
    service = null;
    const stoppedJournal = JSON.parse(await readFile(join(stateDirectory, 'journal', 'service.json')));
    assert.equal(stoppedJournal.phase, 'recovery');
    assert.equal(stoppedJournal.nativeStopped, true);
    assert.deepEqual(stoppedJournal.ownerAlphaGeneration, { epoch: intent.epoch, boot_id: intent.boot_id, transition_id: intent.transition_id });
    assert.deepEqual(stoppedJournal.ownerAlphaWarm, { generation_sha256: generationRow1.value.authority.generation_sha256 });
    return { code: 0, signal: null };
  };
  // A failed launch assertion must reject the coordination deferreds rather
  // than vanish into the wake callback's catch and hang the main flow.
  const launch = async (path, options) => {
    try { return await launchImpl(path, options); }
    catch (error) { proceed2.resolve(); run1Done.reject(error); run2Done.reject(error); proceedStop.resolve(); throw error; }
  };
  let finishWake;
  const wakeFinished = new Promise(ok => { finishWake = ok; });
  // The injected client carries the same manager principal and credentials the
  // manager would build itself; the loopback CA cannot ride the global agent.
  listener = createHostedOwnerWakeService({ configPath, wakeTokenFile, port: 8080 },
    { control: managerClient, spriteRequest, report: value => finishWake(value.code), launch });
  listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const wakeResponse = await fetch(`http://127.0.0.1:${listener.address().port}/wake`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hehe-wake-token': wakeToken },
    body: JSON.stringify({ epoch: intent.epoch, operationId: intent.transition_id }),
    signal: AbortSignal.timeout(15000) });
  assert.equal(wakeResponse.status, 202, `wake response body: ${await wakeResponse.clone().text().catch(() => '<unreadable>')}`);
  assert.deepEqual(await wakeResponse.json(), { accepted: true, epoch: intent.epoch, duplicate: false });

  await run1Done.promise;
  let request2, receipt2;
  if (browserMode) {
    // Send the second ordinary owner message through the same composer in the
    // same browser session and the same warm generation.
    assert.ok(await waitFor(() => browserJson(
      '!document.querySelector("#send").disabled && !document.querySelector("#message").readOnly'), 30000),
      'composer never admitted the second send');
    await browser('fill', '#message', text2);
    await browser('click', '#send');
    assert.ok(await waitFor(() => browserJson('document.querySelector("#message")?.value === ""'), 15000),
      'composer did not confirm the second message');
    assert.equal(await browserJson(`localStorage.getItem("personal.pending.${persona}")`), null,
      'composer left an unconfirmed pending second message');
    assert.equal(fixture.browserCommands.length, 2, 'second composer send was not recorded exactly once');
    const sent2 = fixture.browserCommands[1];
    assert.deepEqual(JSON.parse(sent2.body), { schema_version: 1, type: 'message.send',
      payload: { conversation_id: persona, text: text2 } });
    assert.match(sent2.headers['idempotency-key'], uuidPattern, 'second composer idempotency key is not a UUID');
    assert.notEqual(sent2.headers['idempotency-key'], request1.headers['Idempotency-Key'],
      'both turns reused one idempotency key');
    request2 = { method: 'POST', headers: { ...ownerHeaders, 'Content-Type': sent2.headers['content-type'],
      Origin: fixture.origin, 'Idempotency-Key': sent2.headers['idempotency-key'] }, body: sent2.body };
    const confirmed2 = await fixture.fetchImpl('/v1/commands', request2);
    assert.equal(confirmed2.status, 202);
    assert.equal(fixture.browserCommands.length, 2, 'receipt replay sent another browser command');
    receipt2 = await confirmed2.json();
  } else {
    request2 = command('message.send', { conversation_id: persona, text: text2 });
    const response2 = await fixture.fetchImpl('/v1/commands', request2);
    assert.equal(response2.status, 202);
    receipt2 = await response2.json();
  }
  assert.equal(receipt2.status, 'applied');
  const run2 = { resource_id: receipt2.resource_id };
  const rows2 = await fixture.warmRows();
  const manifestRow2 = rowsOf(rows2, 'owner_alpha_warm_manifest:2:2')[0];
  const reservationRow2 = rowsOf(rows2, 'owner_alpha_reservation:2:2')[0];
  assert.ok(manifestRow2 && reservationRow2, 'second admission rows missing');
  assert.equal(manifestRow2.value.run_id, run2.resource_id);
  assert.notEqual(manifestRow2.value.manifest_sha256, manifestRow1.value.manifest_sha256);
  assert.notDeepEqual(reservationRow2.value, reservationRow1.value);
  assert.deepEqual(rowsOf(rows2, 'owner_alpha_warm_generation:2')[0].value, generationRow1.value,
    'second admission rewrote the immutable generation descriptor');
  proceed2.resolve();

  await run2Done.promise; const finalSummary = (await readState()).summary;
  assert.deepEqual(finalSummary.owner_alpha_warm, { schema_version: 1, kind: 'owner-alpha-warm-summary-v1',
    policy_revision: 'warm-stage-a-v1', persona_id: persona, policy_expires_at: warmConfig.expires_at,
    max_admissions: 2, admissions_used: 2, message_admission_available: false,
    generation: { session_id: generationRow1.value.policy.session_id, expires_at: generationRow1.value.policy.expires_at, epoch: 2 } });
  // Idempotent replay of the exact first request changes nothing.
  const replay = await fixture.fetchImpl('/v1/commands', request1);
  assert.equal(replay.status, 202); assert.deepEqual(await replay.json(), receipt1);
  assert.equal(report.nativeStarts, 1); assert.equal(report.modelRequests, 2);
  // Retirement before the fixed expiry is refused, and the completed
  // generation yields no second launch envelope.
  assert.deepEqual(await managerClient.request('generation', {}), null, 'completed generation yielded a second envelope');
  await assert.rejects(() => managerClient.request('retirement', { epoch: intent.epoch, boot_id: intent.boot_id,
    session_id: generationRow1.value.policy.session_id, transition_id: intent.transition_id,
    observed_at: new Date().toISOString(), direct_child_stopped: true, execution_lock_free: true,
    session_lock_free: true, source: 'premature-observation' }),
  error => error.code === 'CONTROL_HTTP_ERROR' && error.status === 422, 'premature retirement was accepted');
  // Separate principals and route allowlists: the host credential cannot reach
  // the manager route, and legacy credentials cannot reach warm or manager routes.
  const hostAbuse = new ControlClient({ origin: fixture.origin, token: hostTokenBytes.toString('utf8'),
    principal: 'warm-manager', accessClientId, accessClientSecret, fetchImpl: fixture.fetchImpl });
  await assert.rejects(() => hostAbuse.request('generation', {}),
    error => error.code === 'CONTROL_HTTP_ERROR' && error.status === 401, 'host token reached the manager route');
  const legacyManager = new ControlClient({ origin: fixture.origin, token: managerToken, principal: 'manager',
    accessClientId, accessClientSecret, fetchImpl: fixture.fetchImpl });
  await assert.rejects(() => legacyManager.request('manifest', {}),
    error => error.code === 'CONTROL_HTTP_ERROR' && error.status === 404, 'legacy manager route stayed open');
  const legacyRuntime = new ControlClient({ origin: fixture.origin, token: runtimeToken,
    accessClientId, accessClientSecret, fetchImpl: fixture.fetchImpl });
  await assert.rejects(() => legacyRuntime.request('status', {}),
    error => error.code === 'CONTROL_HTTP_ERROR' && error.status === 404, 'legacy runtime route stayed open');
  if (browserMode) {
    // Reload the real portal while the warm generation is still open: the
    // exact two owner messages and two canonical bot replies must be retained,
    // the exhausted composer stays disabled/readOnly, no uncertain pending
    // bytes survive, and the reload itself stays passive.
    await browser('reload');
    assert.ok(await waitFor(() => browserJson('document.querySelector("#connection")?.textContent === "Connected"'), 30000),
      'portal did not reconnect after reload');
    assert.ok(await waitFor(() => browserJson(
      '[...document.querySelectorAll(".message.bot .message-body")].filter(node => node.textContent === "Cobalt blue.").length === 1'), 30000),
      'reloaded timeline missing the second canonical reply');
    const timeline = await browserJson(`(() => ({
      users: [...document.querySelectorAll(".message.user .message-body")].map(node => node.textContent),
      bots: [...document.querySelectorAll(".message.bot .message-body")].map(node => node.textContent) }) )()`);
    assert.equal(timeline.users.length, 2, 'reloaded timeline lost or duplicated owner messages');
    assert.equal(timeline.bots.length, 2, 'reloaded timeline lost or duplicated canonical bot replies');
    assert.ok(timeline.users.includes(text1) && timeline.users.includes(text2), 'reloaded timeline lost an owner message');
    assert.ok(timeline.bots.includes(replies[0]) && timeline.bots.includes(replies[1]), 'reloaded timeline lost a canonical reply');
    assert.equal(await browserJson('document.querySelector("#send").disabled'), true, 'reloaded composer is not disabled');
    assert.equal(await browserJson('document.querySelector("#message").readOnly'), true, 'reloaded composer textarea is not readOnly');
    assert.match(await browserJson('document.querySelector("#runtime-banner-text")?.textContent ?? ""'), /Both warm messages have been used/);
    assert.equal(await browserJson(`localStorage.getItem("personal.pending.${persona}")`), null,
      'reloaded composer left an unconfirmed pending message');
    assert.equal(fixture.browserCommands.length, 2, 'reload sent or duplicated a browser command');
    assert.equal(report.nativeStarts, 1, 'reload launched another native runtime');
    assert.equal(report.modelRequests, 2, 'reload reached a model');
    assert.equal((await browser('errors')).stdout.trim(), '', 'portal reported page errors');
    assert.ok(Date.now() < Date.parse(generationRow1.value.policy.expires_at),
      'reload assertions completed only after generation expiry');
    // Absolute path: the CLI resolves relative screenshot names against its
    // own working directory, not this script's. Enlarge the viewport and scroll
    // the timeline so the screenshot shows both turns' messages and replies.
    await mkdir('.amp/in/artifacts', { recursive: true });
    await browser('set', 'viewport', '1280', '1600', '2');
    await browser('eval', 'document.querySelector("#timeline").scrollTo(0, 0)');
    await browser('eval', 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await browser('screenshot', resolve('.amp/in/artifacts/warm-manager-browser-portal.png'));
  }
  proceedStop.resolve();

  const result = await Promise.race([wakeFinished, new Promise((_, reject) => {
    wakeDeadline = setTimeout(() => reject(new Error('Warm wake callback did not settle')), 210000);
  })]);
  clearTimeout(wakeDeadline);
  assert.equal(result, 'RETIREMENT_REPORTED');
  assert.equal(report.nativeStarts, 1, 'the warm session used more than one native process');
  assert.equal(report.modelRequests, 2);
  // One manager hold plus one activity hold, then only renewals of that same
  // hold: no release, no second wake hold, no DELETE.
  assert.deepEqual(report.spriteRequests.slice(0, 4), ['PUT', 'GET', 'PUT', 'GET']);
  assert.ok(report.spriteRequests.every(method => method === 'PUT' || method === 'GET'),
    'unexpected sprite activity beyond holds and confirmations');
  assert.deepEqual(taskNames.slice(0, 2), [`hehe-warm-${intent.transition_id}`, `hehe-2-${intent.boot_id}`]);
  assert.equal(new Set(taskNames).size, 2, 'sprite holds appeared for another task identity');
  // The fixture's warm-row surface does not expose retirement rows, so prove
  // recorded custody through the contract itself: the manager already reported
  // its own observation (RETIREMENT_REPORTED above), so this distinct report
  // must hit the immutable-row conflict rather than being accepted.
  const retirement = { epoch: intent.epoch, boot_id: intent.boot_id,
    session_id: generationRow1.value.policy.session_id, transition_id: intent.transition_id,
    observed_at: new Date().toISOString(), direct_child_stopped: true, execution_lock_free: true,
    session_lock_free: true, source: 'stage-a-warm-e2e:distinct-observation' };
  await assert.rejects(() => managerClient.request('retirement', retirement),
    error => error.code === 'CONTROL_HTTP_ERROR' && error.status === 422,
    'distinct retirement observation was accepted; the manager observation was never recorded');
  const retiredRows = await fixture.warmRows();
  assert.deepEqual(rowsOf(retiredRows, 'owner_alpha_warm_generation:2')[0].value, generationRow1.value,
    'retirement rewrote the immutable generation descriptor');
  assert.ok(fixture.outboundRequests.every(request => request.method === 'GET' && request.url.endsWith('/cdn-cgi/access/certs')));
  Object.assign(report, { status: 'passed', canonicalReplies: replies, oneProcessTwoTurns: true,
    sameGenerationBothTurns: true, distinctTaskCredentials: true, boundedPriorCanonicalContext: true,
    passiveReadsDidNotLaunch: true, replayDidNotRelaunch: true, noPrematureRetirement: true,
    explicitPostExpiryStop: true, dualLockRetirement: true, productionEnabled: false, providerOrAccountVerified: false,
    ...(browserMode ? { browserComposerVerified: true, passivePortalReadsDidNotLaunch: true,
      completionReenabledComposer: true, portalReloadRetainedBothTurns: true } : {}) });
} catch (error) {
  report.error = error.code ?? error.name;
  report.message = error.message;
  report.frames = error.stack?.split('\n').filter(line => line.trimStart().startsWith('at '));
  process.exitCode = 1;
} finally {
  clearTimeout(wakeDeadline); listener?.stop();
  if (browserMode) await browser('close').catch(() => {});
  await service?.stop().catch(() => {}); await fixture?.close().catch(() => {});
  if (model) { model.closeAllConnections(); await new Promise(ok => model.close(ok)); }
  if (report.status === 'passed') await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  else report.privateDiagnostics = directory;
  console.log(JSON.stringify(report, null, 2));
}
