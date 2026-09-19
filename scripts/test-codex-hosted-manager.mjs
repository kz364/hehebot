#!/usr/bin/env node
// Two credential-free owner sessions: real manager staging -> Sprite service
// -> pinned Codex -> scripted loopback text -> canonical completion/retirement.
// --browser drives the same two turns through the actual portal composer in a
// real browser against the same authenticated Worker/SQLite fixture; it is
// local integration only, never production Access SSO or live-model proof.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startHostedControlFixture } from '../tests/fixtures/hosted-control.mjs';
import { ControlClient } from '../runtime/control-client.mjs';
import { runHostedOwnerManager } from '../runtime/hosted-owner-manager.mjs';
import { createHostedOwnerWakeService } from '../runtime/hosted-owner-wake.mjs';
import { readOwnerAlphaConfig } from '../runtime/owner-alpha-entry.mjs';
import { createSpriteCodexService } from '../runtime/sprites-codex-service.mjs';
import { spawnCodex } from '../runtime/codex-transport.mjs';
import { createCodexTextOnlyProfile, codexTextOnlyProfileSha256 } from '../runtime/codex-text-only.mjs';

const browserMode = process.argv.includes('--browser');
const exec = (await import('node:util')).promisify(execFile);
const persona = '11111111-1111-4111-8111-111111111111';
const replies = ['The notebook is cobalt blue, reference 47.', 'Cobalt blue.'];
const pause = ms => new Promise(ok => setTimeout(ok, ms));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const directory = await mkdtemp(join(tmpdir(), 'hehe-hosted-manager-'));
const report = { status: 'failed', mode: browserMode ? 'browser-composer' : 'http', nativeStarts: 0, modelRequests: 0, spriteRequests: [] };
// Real-browser session for --browser mode. The synthetic signed owner identity
// is fixture-only: the header rides the same authenticated Worker ingress.
// Session names must stay short; keep this label at or under 20 characters.
const browserSession = 'hosted-manager-' + randomUUID().slice(0, 5);
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
let fixture, model, service, modelError, listener, wakeDeadline;
try {
  const home = join(directory, 'native-home'), sessionsDirectory = join(directory, 'sessions');
  await mkdir(home, { mode: 0o700 }); await mkdir(sessionsDirectory, { mode: 0o700 });
  const textOnlyProfile = { codexVersion: '0.154.0', model: 'fixture-model', catalogPath: join(directory, 'catalog.json'),
    catalogValidation: 'synthetic-fixture', syntheticFixture: true,
    modelCatalog: { models: [{ slug: 'fixture-model', display_name: 'Synthetic manager fixture', description: null,
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
  const accessClientId = randomBytes(24).toString('hex'), accessClientSecret = randomBytes(32).toString('hex');
  const managerToken = randomBytes(32).toString('hex');
  fixture = await startHostedControlFixture({ directory: join(directory, 'control'), ownerAlpha: originalPolicy,
    runtimeToken: randomBytes(32).toString('hex'), accessClientId, accessClientSecret,
    ...(browserMode ? { portalAssetsDirectory: resolve('public') } : {}),
    manager: { token: managerToken, signingKey: randomBytes(48).toString('hex'), bootstrap: {
      policy_revision: 'native-manager-fixture-v1', persona_id: persona, text_only,
      expires_at: new Date(Date.now() + 180000).toISOString(), session_seconds: 45, max_task_seconds: 30,
      prior_cost_micro_usd: 0, prior_cost_source: 'synthetic-no-provider', total_cap_micro_usd: 10000000, reservation_micro_usd: 1000 } } });
  await fixture.retireUnusedPredecessor();
  const control = new ControlClient({ origin: fixture.origin, token: managerToken, principal: 'manager',
    accessClientId, accessClientSecret, fetchImpl: fixture.fetchImpl });
  const accessClientIdFile = join(directory, 'access-id'), accessClientSecretFile = join(directory, 'access-secret');
  await writeFile(accessClientIdFile, accessClientId, { mode: 0o600 });
  await writeFile(accessClientSecretFile, accessClientSecret, { mode: 0o600 });
  const template = { stateDirectory: join(directory, 'unused-state'), nativeHome: home,
    ownerAlpha: originalPolicy, hostedOwnerBindingSha256: fixture.ownerBindingSha256,
    binary: resolve('.local/codex-runtime/node_modules/.bin/codex'), portalOrigin: fixture.origin,
    runtimeTokenFile: join(directory, 'unused-token'), accessClientIdFile, accessClientSecretFile, tlsCAFile: fixture.caFile,
    installationId: 'hosted-fixture', personas: { [persona]: { agentId: 'assistant', model: 'fixture-model', allowedTools: [] } }, textOnlyProfile };
  const templatePath = join(directory, 'template.json'), templateBytes = JSON.stringify(template);
  await writeFile(templatePath, templateBytes, { mode: 0o600 });
  const manager = { kind: 'owner-alpha-manager-v1', portalOrigin: fixture.origin, installationId: 'hosted-fixture',
    hostedOwnerBindingSha256: fixture.ownerBindingSha256, managerTokenFile: join(directory, 'unused-manager-file'),
    templatePath, templateSha256: hash(templateBytes), sessionsDirectory };
  assert.equal(await runHostedOwnerManager(manager, { epoch: 2, operationId: randomUUID() }, {
    control, launch: () => assert.fail('Native launch before assignment') }), 'NO_ASSIGNMENT');
  assert.equal(report.nativeStarts, 0); assert.deepEqual(await readdir(sessionsDirectory), []);

  const ownerHeaders = { 'Cf-Access-Jwt-Assertion': fixture.ownerJwt };
  if (browserMode) {
    // The user worker runs ahead of static assets: portal routes stay behind
    // owner authentication. Unauthenticated and wrong-owner requests to the
    // asset routes are denied; the authenticated owner is served.
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
    // Select the bootstrap persona explicitly (Chief of Staff).
    assert.ok(await waitFor(() => browserJson('Boolean(document.querySelector(\'[data-persona-id="' + persona + '"]\'))'), 30000), 'bootstrap persona missing from roster');
    await browser('click', `[data-persona-id="${persona}"]`);
    // The page adopts the bootstrap policy on observation and admits a send.
    assert.ok(await waitFor(() => browserJson('!document.querySelector("#send").disabled'), 30000), 'composer never admitted a first send');
    // Passive-read custody: portal load, roster selection, state polling and
    // bootstrap adoption caused zero launches, model requests or commands.
    assert.equal(report.nativeStarts, 0, 'portal visit launched a native runtime');
    assert.equal(report.modelRequests, 0, 'portal visit reached a model');
    assert.deepEqual(report.spriteRequests, [], 'portal visit contacted the Sprite');
    assert.equal(await control.request('manifest', {}), null, 'portal visit staged an assignment');
    assert.deepEqual(fixture.browserCommands, [], 'portal visit sent a command');
  }
  let prior;
  for (let turn = 1; turn <= 2; turn++) {
  const reply = replies[turn - 1];
  const text = turn === 1 ? 'Remember the cobalt blue notebook, reference 47.' : 'What color was the notebook?';
  const ready = await (await fixture.fetchImpl('/v1/state', { headers: ownerHeaders })).json();
  assert.equal(ready.summary.owner_alpha_bootstrap.message_admission_available, true);
  if (prior) {
    const replay = await fixture.fetchImpl('/v1/commands', prior.request);
    assert.equal(replay.status, 202); assert.deepEqual(await replay.json(), prior.receipt);
    assert.deepEqual(await fixture.retainedManifest(), prior.retained);
    assert.equal(await control.request('manifest', {}), null);
    assert.equal(report.nativeStarts, 1); assert.equal(report.modelRequests, 1);
  }
  let receipt;
  let sentRequest;
  if (browserMode) {
    // The real composer only re-enables Send once retirement freed the turn
    // (turn 2) and the fixed bootstrap policy is still admitted.
    assert.ok(await waitFor(() => browserJson('!document.querySelector("#send").disabled'), 30000),
      `composer never admitted the turn-${turn} send`);
    await browser('fill', '#message', text);
    await browser('click', '#send');
    // The composer clears the textarea only after its receipt is confirmed.
    assert.ok(await waitFor(() => browserJson('document.querySelector("#message")?.value === ""'), 15000),
      'composer did not confirm the sent message');
    assert.equal(fixture.browserCommands.length, turn, 'unexpected command count after composer send');
    const sent = fixture.browserCommands[turn - 1];
    assert.deepEqual(JSON.parse(sent.body), { schema_version: 1, type: 'message.send',
      payload: { conversation_id: persona, text } });
    assert.match(sent.headers['idempotency-key'], uuidPattern, 'composer idempotency key is not a UUID');
    assert.equal(sent.headers.origin, fixture.origin);
    assert.equal(sent.headers['sec-fetch-site'], 'same-origin');
    assert.equal(new Set(fixture.browserCommands.map(command => command.headers['idempotency-key'])).size, turn,
      'turns reused an idempotency key');
    sentRequest = { method: 'POST',
      headers: { ...ownerHeaders, 'Content-Type': sent.headers['content-type'], Origin: fixture.origin,
        'Idempotency-Key': sent.headers['idempotency-key'] }, body: sent.body };
    // Recover the durable receipt by replaying the exact composer bytes; the
    // idempotent replay returns the stored receipt without a new command.
    const confirmed = await fixture.fetchImpl('/v1/commands', sentRequest);
    assert.equal(confirmed.status, 202); assert.equal(fixture.browserCommands.length, turn);
    receipt = await confirmed.json();
  } else {
  const ownerRequest = { method: 'POST', headers: { ...ownerHeaders,
    Origin: fixture.origin, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ schema_version: 1, type: 'message.send', payload: { conversation_id: persona,
      text } }) };
  const response = await fixture.fetchImpl('/v1/commands', ownerRequest);
  assert.equal(response.status, 202);
  receipt = await response.json();
  sentRequest = ownerRequest;
  }
  assert.equal(receipt.status, 'applied');
  const assignment = await control.request('manifest', {}); assert.ok(assignment);
  assert.equal(assignment.grant.run_id, receipt.resource_id);
  const retained = await fixture.retainedManifest();
  for (const [key, value] of Object.entries(assignment.grant)) assert.deepEqual(retained[key], value);
  assert.equal(retained.session_id, assignment.policy.session_id);
  assert.equal(assignment.grant.epoch, turn + 1);
  if (prior) assert.notEqual(retained.session_id, prior.retained.session_id);
  model = createServer(async (request, response) => {
    try {
      assert.equal(request.url, '/v1/responses');
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks));
      report.modelRequests++; assert.equal(report.modelRequests, turn); assert.deepEqual(body.tools, []);
      if (turn === 2) {
        assert.ok(JSON.stringify(body.input).includes('Remember the cobalt blue notebook, reference 47.'), 'prior owner text absent from next native request');
        assert.ok(JSON.stringify(body.input).includes(replies[0]), 'prior reply absent from next native request');
      }
      const item = { id: `msg_${randomUUID()}`, type: 'message', status: 'completed', role: 'assistant',
        content: [{ type: 'output_text', text: reply, annotations: [] }] };
      const result = { id: `resp_${randomUUID()}`, object: 'response', created_at: 1, status: 'completed', error: null,
        incomplete_details: null, model: 'fixture-model', output: [item], tools: [], tool_choice: 'auto', parallel_tool_calls: false,
        usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const event = (type, fields) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`);
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
  const held = new Map(), taskNames = [];
  const spriteRequest = (options, callback) => {
    assert.equal(options.socketPath, '/.sprite/api.sock'); report.spriteRequests.push(options.method);
    const request = new EventEmitter(); request.setTimeout = () => {}; request.destroy = () => {};
    request.end = data => {
      const name = options.path.split('/').at(-1);
      if (options.method === 'PUT') {
        taskNames.push(name);
        held.set(name, { name, expires_at: new Date(Date.now() + JSON.parse(data).expire * 1000).toISOString() });
      }
      else assert.equal(options.method, 'GET');
      const response = new EventEmitter(); response.statusCode = 200; callback(response);
      response.emit('data', Buffer.from(JSON.stringify(options.method === 'GET' ? held.get(name) : {}))); response.emit('end');
    };
    return request;
  };
  const configPath = join(directory, 'manager.json'), wakeTokenFile = join(directory, 'wake-token');
  const wakeToken = randomBytes(32).toString('hex');
  await writeFile(configPath, JSON.stringify(manager), { mode: 0o600 });
  await writeFile(wakeTokenFile, wakeToken, { mode: 0o600 });
  let finishWake;
  const wakeFinished = new Promise(resolve => { finishWake = resolve; });
  listener = createHostedOwnerWakeService({ configPath, wakeTokenFile, port: 8080 }, {
    control, spriteRequest, report: value => finishWake(value.code), launch: async (path, { expectedSha256 }) => {
      assert.deepEqual(report.spriteRequests.slice((turn - 1) * 4), ['PUT', 'GET'], 'bootstrap hold must be confirmed before launch');
      assert.deepEqual(taskNames, [`hehe-bootstrap-${assignment.grant.transition_id}`]);
      const { config } = await readOwnerAlphaConfig(path, expectedSha256);
      assert.deepEqual(config.ownerAlpha, assignment.policy);
      assert.equal(await readFile(config.runtimeTokenFile, 'utf8'), assignment.runtime_token);
      assert.equal(config.nativeHome, home);
      service = createSpriteCodexService(config, { spriteRequest, fetchImpl: fixture.fetchImpl,
        launch: options => { report.nativeStarts++; return spawnCodex(options); },
        prepareNative: home => writeFile(join(home, 'config.toml'), `model = "fixture-model"\nmodel_provider = "fixture"\n[model_providers.fixture]\nname = "Loopback"\nbase_url = "http://127.0.0.1:${model.address().port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`, { mode: 0o600 }) });
      const dispatched = await service.start();
      assert.equal(dispatched.claim.run.id, assignment.grant.run_id);
      const serviceJournal = JSON.parse(await readFile(join(config.stateDirectory, 'journal', 'service.json')));
      assert.deepEqual(serviceJournal.identity, { epoch: assignment.grant.epoch, boot_id: assignment.grant.boot_id });
      const end = Date.now() + 25000; let completed = false;
      while (Date.now() < end) {
        if (modelError) throw modelError;
        await service.maintain();
        const state = await (await fixture.fetchImpl('/v1/state', { headers: ownerHeaders })).json();
        if (state.runs.find(run => run.id === receipt.resource_id)?.status === 'completed') { completed = true; break; }
        await pause(100);
      }
      assert.ok(completed, 'canonical completion missing');
      const history = await (await fixture.fetchImpl(`/v1/conversations/${persona}/events`, { headers: ownerHeaders })).json();
      const results = history.events.filter(event => event.type === 'run.result' && event.payload.run_id === receipt.resource_id);
      assert.equal(results.length, 1); assert.equal(results[0].payload.text, reply);
  if (browserMode) {
    // The portal timeline must show the attributed canonical reply for this turn.
    assert.ok(await waitFor(() => browserJson(
      `[...document.querySelectorAll(".message.bot .message-body")].some(node => node.textContent === ${JSON.stringify(reply)})`), 30000),
      `turn-${turn} canonical reply missing from portal timeline`);
    const userShown = await browserJson(
      `[...document.querySelectorAll(".message.user .message-body")].some(node => node.textContent === ${JSON.stringify(text)})`);
    assert.ok(userShown, `turn-${turn} owner message missing from portal timeline`);
  }
      assert.equal(await control.request('manifest', {}), null, 'completed assignment is no longer launchable');
      assert.deepEqual(await fixture.retainedManifest(), retained, 'durable assignment must not renew or change after completion');
      const families = await service.supervisor.bridge.families();
      assert.equal(families.length, 1); assert.equal(families[0].phase, 'complete');
      assert.equal(families[0].claim.run.id, assignment.grant.run_id);
      assert.equal(families[0].attemptId, dispatched.attemptId);
      const journal = JSON.parse(await readFile(join(config.stateDirectory, 'journal', `${dispatched.attemptId}.json`)));
      assert.equal(journal.textOnlyReceipt.profile_sha256, text_only.profile_sha256);
      await service.stop(); service = null;
      // Permit the real manager's expiry-gated retirement observation, without
      // changing either the fixed policy or its clock. No model runs during wait.
      await pause(Math.max(0, Date.parse(assignment.policy.expires_at) - Date.now()));
      return { code: 0, signal: null };
    } });
  listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  const wakeResponse = await fetch(`http://127.0.0.1:${listener.address().port}/wake`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hehe-wake-token': wakeToken },
    body: JSON.stringify({ epoch: assignment.grant.epoch, operationId: assignment.grant.transition_id }),
    signal: AbortSignal.timeout(15000) });
  assert.equal(wakeResponse.status, 202);
  assert.deepEqual(await wakeResponse.json(), { accepted: true, epoch: assignment.grant.epoch, duplicate: false });
  const result = await Promise.race([wakeFinished, new Promise((_, reject) => {
    wakeDeadline = setTimeout(() => reject(new Error('Wake callback did not settle')), 70000);
  })]);
  clearTimeout(wakeDeadline);
  assert.equal(result, 'RETIREMENT_REPORTED'); assert.equal(report.nativeStarts, turn); assert.equal(report.modelRequests, turn);
  assert.deepEqual(report.spriteRequests.slice((turn - 1) * 4), ['PUT', 'GET', 'PUT', 'GET']);
  assert.deepEqual(taskNames, [`hehe-bootstrap-${assignment.grant.transition_id}`, `hehe-${assignment.grant.epoch}-${assignment.grant.boot_id}`]);
  prior = { request: sentRequest, receipt, retained };
  listener.stop(); listener = null;
  model.closeAllConnections(); await new Promise(ok => model.close(ok)); model = null;
  }
  assert.ok(fixture.outboundRequests.every(request => request.method === 'GET' && request.url.endsWith('/cdn-cgi/access/certs')));
  if (browserMode) {
    // Reload the real portal: both turns' owner messages and canonical replies
    // must be retained, with no duplicate commands or extra launches.
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
    assert.equal(timeline.bots.length, 2, 'reloaded timeline lost or duplicated canonical replies');
    assert.ok(timeline.users.includes('Remember the cobalt blue notebook, reference 47.'));
    assert.ok(timeline.users.includes('What color was the notebook?'));
    assert.ok(timeline.bots.includes('The notebook is cobalt blue, reference 47.'));
    assert.ok(timeline.bots.includes('Cobalt blue.'));
    assert.equal(fixture.browserCommands.length, 2, 'reload sent or duplicated a command');
    assert.equal(report.nativeStarts, 2, 'reload launched another native runtime');
    assert.equal(report.modelRequests, 2, 'reload reached a model');
    assert.equal(await browserJson(`localStorage.getItem("personal.pending.${persona}")`), null,
      'composer left an unconfirmed pending message');
    assert.equal((await browser('errors')).stdout.trim(), '', 'portal reported page errors');
    // Absolute path: the CLI resolves relative screenshot names against its own
    // working directory, not this script's. Enlarge the viewport and scroll the
    // timeline so the screenshot shows both turns' messages and replies.
    await browser('set', 'viewport', '1280', '1600', '2');
    await browser('eval', 'document.querySelector("#timeline").scrollTo(0, 0)');
    await browser('screenshot', resolve('.amp/in/artifacts/hosted-manager-browser-portal.png'));
    await browser('close');
  }
  Object.assign(report, { status: 'passed', canonicalReplies: replies, ownerContinuation: true, priorConversationReachedNative: true,
    receiptReplayDidNotLaunch: true, immutableAssignment: true, noNativeBeforeAssignment: true,
    bootstrapHoldBeforeLaunch: true, httpWakeVerified: true, productionEnabled: false, providerOrAccountVerified: false,
    ...(browserMode ? { browserComposerVerified: true, passivePortalReadsDidNotLaunch: true,
      retirementReenabledComposer: true, portalReloadRetainedBothTurns: true } : {}) });
} catch (error) {
  report.error = error.code ?? error.name;
  report.frames = error.stack?.split('\n').filter(line => line.trimStart().startsWith('at '));
  process.exitCode = 1;
}
finally {
  clearTimeout(wakeDeadline); listener?.stop();
  if (browserMode) await browser('close').catch(() => {});
  await service?.stop().catch(() => {}); await fixture?.close().catch(() => {});
  if (model) { model.closeAllConnections(); await new Promise(ok => model.close(ok)); }
  if (report.status === 'passed') await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  else report.privateDiagnostics = directory;
  console.log(JSON.stringify(report, null, 2));
}
