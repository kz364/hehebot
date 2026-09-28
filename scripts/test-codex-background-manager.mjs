#!/usr/bin/env node
// Stage B background runtime integration (HTTP or --browser): one pinned pristine
// Codex 0.154.0 process/boot/epoch hosts three independently admitted root
// tasks — A (role background, restricted V2 cap 2), S (role status, no MCP,
// frozen status summary composed into its restricted prompt), B (role
// independent, root-only read-only MCP) — under the default-off, terminal,
// finite background generation contract. Roles derive from the manifest
// ordinal, never user text. The real Worker/SQLite Durable Object fixture
// drives the actual alarm/sendHostedWake path: the once-only wake intent is
// delivered through the real workerd fetch to the pinned synthetic Sprite
// destination, which the fixture loopback-routes (disposable transport
// routing only, never a live Sprite provider or Access edge) into the
// production createHostedOwnerWakeService listener and the background
// manager. Credential-free: no live model, provider, account, OAuth cache,
// patched dependency or Codex-owned database. A never logically completes or
// settles; the background root stays unreleased-by-completion and its
// explicit owner cancellation targets only the A family. The post-expiry stop
// in this script is the test's own explicit service.stop() (labeled
// explicit-stop); no automatic timer stop is claimed, and authenticated
// maintenance near the millisecond policy deadline is never assumed.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startHostedControlFixture } from '../tests/fixtures/hosted-control.mjs';
import { ControlClient } from '../runtime/control-client.mjs';
import { createHostedOwnerWakeService } from '../runtime/hosted-owner-wake.mjs';
import { readOwnerAlphaConfig } from '../runtime/owner-alpha-entry.mjs';
import { backgroundProfileSha256 } from '../runtime/owner-alpha-background-binding.mjs';
import { createSpriteCodexService } from '../runtime/sprites-codex-service.mjs';
import { spawnCodex } from '../runtime/codex-transport.mjs';

const ROUTINE_MANAGE_POLICY = 'f0ff3ead-1e31-4f83-bbc2-aa25f069a962';
const syntheticProviderToken = 'synthetic-provider-' + 'p'.repeat(40);
const persona = '11111111-1111-4111-8111-111111111111';
const marker = value => `OWNER_BACKGROUND_${value}`;
const textA = `${marker('ROOT_A')} Coordinate the household quietly and delegate exactly one resident child task.`;
const textS = `${marker('ROOT_S')} Report the frozen generation status now.`;
const textB = `${marker('ROOT_B')} List the admitted routines with your own read-only grant.`;
const replyA = `${marker('A_FINAL')} Background root turn complete; the resident child keeps working.`;
const replyS = `${marker('S_FINAL')} Status answer recorded. The background task and its child remain unsettled.`;
const replyB = `${marker('B_FINAL')} Independent answer recorded using its own read-only grant.`;
const routineName = 'Fixture routine ledger sweep';
const pause = ms => new Promise(ok => setTimeout(ok, ms));
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const browserMode = process.argv.includes('--browser');
const browserSession = 'background-' + randomUUID().slice(0, 5);
const browser = (...args) => promisify(execFile)('agent-browser', ['--session', browserSession, '--ignore-https-errors', ...args], { timeout: 30000 });
const browserJson = async code => JSON.parse((await browser('eval', code)).stdout);
const waitFor = async probe => {
  const end = Date.now() + 30000;
  while (Date.now() < end) { if (await probe()) return true; await pause(200); }
  return false;
};
const directory = await mkdtemp(join(tmpdir(), 'hehe-background-manager-'));
const report = { status: 'failed', mode: browserMode ? 'browser-one-process' : 'http-one-process', nativeStarts: 0, modelRequests: 0, spriteRequests: [], toolCatalogs: {} };
const counts = {};
const withDeadline = (promise, timeoutMs, message) => {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
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
// A rejected deferred must never crash the process before the main flow
// attaches its handler: the wake callback can reject coordination deferreds
// while the main flow is still polling durable state.
const deferred = () => { let resolve, reject; const promise = new Promise((ok, no) => { resolve = ok; reject = no; }); promise.catch(() => {}); return { promise, resolve, reject }; };
let fixture, model, service, listener, modelError, wakeDeadline, hostTokenBytes;
let aRunIdForModel = null;
try {
  const home = join(directory, 'native-home'), sessionsDirectory = join(directory, 'sessions');
  await mkdir(home, { mode: 0o700 }); await mkdir(sessionsDirectory, { mode: 0o700 });
  const epochOneBoot = randomUUID();
  const backgroundProfile = { profile_version: 'codex-background-v2-restricted-v1', profile_sha256: hash('synthetic-background-profile'),
    max_resident_child_threads: 2, wait_agent_enabled: false, multi_agent_v1: false };
  const originalPolicy = { session_id: randomUUID(), persona_id: persona,
    expires_at: new Date(Date.now() - 120000).toISOString(), max_runs: 1, max_task_seconds: 30 };
  const ownerBinding = hash({ auth_mode: 'access', installation_id: 'hosted-fixture',
    issuer: 'https://synthetic.cloudflareaccess.com', audience: 'fixture-audience', owner_subject: 'fixture-owner' });
  const backgroundConfig = { schema_version: 1, kind: 'owner-alpha-background-generation-v1', installation_id: 'hosted-fixture',
    owner_id: 'fixture-owner', owner_binding_sha256: ownerBinding, policy_revision: 'background-stage-b-v1', persona_id: persona,
    background: backgroundProfile, expires_at: new Date(Date.now() + 290000).toISOString(), max_task_seconds: 300,
    max_admissions: 3, prior_cost_micro_usd: 1000, prior_cost_source: 'synthetic-baseline', total_cap_micro_usd: 10000000,
    reservation_micro_usd: 2000, seed_retirement: { epoch: 1, boot_id: epochOneBoot, session_id: originalPolicy.session_id,
      transition_id: null, observed_at: new Date(Date.now() - 60000).toISOString(), direct_child_stopped: true,
      execution_lock_free: true, session_lock_free: true, source: 'synthetic-background-seed' } };
  const managerToken = 'background-manager-' + randomBytes(24).toString('hex');
  const hostSigningKey = 'background-host-' + randomBytes(24).toString('hex');
  const taskSigningKey = 'background-task-' + randomBytes(24).toString('hex');
  const wakeToken = 'background-wake-' + randomBytes(24).toString('hex');
  const runtimeToken = 'legacy-runtime-' + randomBytes(24).toString('hex');
  const accessClientId = randomBytes(24).toString('hex'), accessClientSecret = randomBytes(32).toString('hex');
  fixture = await startHostedControlFixture({ directory: join(directory, 'control'), ownerAlpha: originalPolicy,
    runtimeToken, accessClientId, accessClientSecret,
    ...(browserMode ? { portalAssetsDirectory: resolve('public') } : {}),
    background: { generation: backgroundConfig, token: managerToken, hostSigningKey, taskSigningKey, wakeToken } });
  await fixture.retirePredecessor(epochOneBoot);
  const managerClient = new ControlClient({ origin: fixture.origin, token: managerToken, principal: 'background-manager',
    accessClientId, accessClientSecret, fetchImpl: fixture.fetchImpl });
  // Byte-stability seam on the manager request path: the first launch-envelope
  // read (the real wake preparation) captures the deterministic credential
  // here and proves repeated reads reproduce identical bytes with zero writes.
  const managerRequest = managerClient.request.bind(managerClient);
  let launchEnvelopeByteStable = false;
  managerClient.request = async (type, payload) => {
    const result = await managerRequest(type, payload);
    if (type !== 'generation' || result === null || launchEnvelopeByteStable) return result;
    launchEnvelopeByteStable = true;
    assert.equal(result.kind, 'owner-alpha-background-launch-v1');
    assert.equal(result.generation.epoch, 2);
    assert.equal(result.generation.policy.max_runs, 3);
    assert.deepEqual(result.generation.policy.background, backgroundProfile);
    assert.deepEqual(await managerRequest('generation', {}), result,
      'repeated launch-envelope reads did not reproduce the identical credential');
    return result;
  };
  const ownerHeaders = { 'Cf-Access-Jwt-Assertion': fixture.ownerJwt };
  const command = (type, payload, idempotencyKey) => ({ method: 'POST', headers: { ...ownerHeaders,
    Origin: fixture.origin, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey ?? randomUUID() }, body: JSON.stringify({ schema_version: 1, type, payload }) });
  const sendOwnerMessage = async (text, ordinal) => {
    if (!browserMode) return command('message.send', { conversation_id: persona, text });
    assert.ok(await waitFor(() => browserJson('!document.querySelector("#send").disabled && !document.querySelector("#message").readOnly')),
      `composer did not admit ordinal ${ordinal}`);
    await browser('fill', '#message', text);
    await browser('click', '#send');
    assert.ok(await waitFor(() => browserJson('document.querySelector("#message").value === ""')), 'composer receipt not confirmed');
    // The V5 durable outbox (ARCHITECTURE_V2 A5) sends via an async drain loop,
    // so the composer clearing no longer guarantees the server has the POST.
    assert.ok(await waitFor(() => fixture.browserCommands.length >= ordinal), 'browser send did not reach the server');
    assert.equal(fixture.browserCommands.length, ordinal, 'passive or duplicate browser command');
    const sent = fixture.browserCommands[ordinal - 1];
    assert.deepEqual(JSON.parse(sent.body), { schema_version: 1, type: 'message.send', payload: { conversation_id: persona, text } });
    assert.match(sent.headers['idempotency-key'], uuidPattern);
    assert.equal(sent.headers.origin, fixture.origin);
    assert.equal(sent.headers['sec-fetch-site'], 'same-origin');
    // No unconfirmed outbox record remains once the real timeline echo
    // reconciles it. window.__hehebotOutbox() (nonce/conversation_id/text/
    // phase only) is the V5 outbox's read-only test hook, replacing the old
    // single 'personal.pending.<conversation>' localStorage key.
    assert.ok(await waitFor(() => browserJson(`!window.__hehebotOutbox().some(r=>r.conversation_id==="${persona}")`)),
      'outbox record for this conversation did not reconcile after the real send');
    // Exact-byte replay recovers the stored receipt; it cannot admit another task.
    return { method: 'POST', headers: { ...ownerHeaders, Origin: fixture.origin,
      'Content-Type': sent.headers['content-type'], 'Idempotency-Key': sent.headers['idempotency-key'] }, body: sent.body };
  };
  const readState = async () => (await fixture.fetchImpl('/v1/state', { headers: ownerHeaders })).json();
  const personaPut = await fixture.fetchImpl('/v1/commands', command('persona.put', { id: persona, expected_revision: 1,
    name: 'Chief of Staff', instructions: 'Coordinate the owner’s requests. Keep actions within explicit authorization.',
    tool_policy_ids: [ROUTINE_MANAGE_POLICY], archived: false }));
  assert.equal(personaPut.status, 202); assert.equal((await personaPut.json()).status, 'applied');
  const routine = { id: randomUUID(), expected_revision: 0, persona_id: persona, name: routineName,
    instructions: 'Sweep the household ledger read-only.', schedule: { cron: '0 9 * * *', timezone: 'Asia/Jakarta' },
    trigger_source_id: null, enabled: false, policy: { misfire: 'skip', overlap: 'skip', max_replay: 1, max_lateness_seconds: 0 },
    action_policy_ids: [] };
  const routinePut = await fixture.fetchImpl('/v1/commands', command('routine.put', routine));
  assert.equal(routinePut.status, 202); assert.equal((await routinePut.json()).status, 'applied');

  // Passive reads stage nothing: no launch envelope, no sprite hold, no
  // native start, no wake, no staged session; the summary offers admission 1.
  let summary = (await readState()).summary;
  assert.deepEqual(summary.owner_alpha_background, { schema_version: 1, kind: 'owner-alpha-background-summary-v1',
    policy_revision: 'background-stage-b-v1', persona_id: persona, policy_expires_at: backgroundConfig.expires_at,
    max_admissions: 3, admissions_used: 0, message_admission_available: true, next_role: 'background', generation: null });
  assert.equal(summary.owner_alpha_session, undefined);
  assert.equal(summary.owner_alpha_bootstrap, undefined);
  assert.equal(summary.owner_alpha_generation, undefined);
  assert.equal(summary.owner_alpha_warm, undefined);
  assert.equal(await managerClient.request('generation', {}), null, 'passive generation read staged work');
  assert.equal(report.nativeStarts, 0); assert.equal(report.modelRequests, 0);
  assert.deepEqual(report.spriteRequests, []); assert.deepEqual(await readdir(sessionsDirectory), []);
  assert.deepEqual(fixture.backgroundWakeDeliveries, [], 'a passive read delivered a background wake');

  if (browserMode) {
    for (const route of ['/', '/app.js']) {
      assert.equal((await fixture.fetchImpl(route)).status, 401);
      assert.equal((await fixture.fetchImpl(route, { headers: { 'Cf-Access-Jwt-Assertion': fixture.otherOwnerJwt } })).status, 401);
      assert.equal((await fixture.fetchImpl(route, { headers: ownerHeaders })).status, 200);
    }
    await browser('set', 'headers', JSON.stringify(ownerHeaders));
    await browser('open', fixture.origin + '/?view=detailed');
    await browser('set', 'viewport', '1280', '1000', '2');
    assert.ok(await waitFor(() => browserJson('document.querySelector("#connection")?.textContent === "Connected"')));
    await browser('click', `[data-persona-id="${persona}"]`);
    assert.match(await browserJson('document.querySelector("#runtime-banner-text").textContent'), /3 of 3 messages remaining/);
    const reads = 'performance.getEntriesByType("resource").filter(e => new URL(e.name).pathname === "/v1/state").length';
    const before = await browserJson(reads);
    assert.ok(await waitFor(async () => await browserJson(reads) > before));
    assert.deepEqual(fixture.browserCommands, []);
    assert.equal(report.nativeStarts, 0); assert.equal(report.modelRequests, 0);
    assert.deepEqual(report.spriteRequests, []);
    assert.deepEqual(await readdir(sessionsDirectory), []);
  }

  // Arrange the production wake listener before the first owner message: the
  // Worker alarm may call back the manager while its handler still awaits the
  // wake acknowledgement, so the loopback route must already exist.
  const accessClientIdFile = join(directory, 'access-id'), accessClientSecretFile = join(directory, 'access-secret');
  await writeFile(accessClientIdFile, accessClientId, { mode: 0o600 });
  await writeFile(accessClientSecretFile, accessClientSecret, { mode: 0o600 });
  const template = { stateDirectory: join(directory, 'unused-state'), nativeHome: home,
    binary: resolve('.local/codex-runtime/node_modules/.bin/codex'), portalOrigin: fixture.origin,
    installationId: 'hosted-fixture', hostedOwnerBindingSha256: fixture.ownerBindingSha256,
    runtimeTokenFile: join(directory, 'unused-token'), accessClientIdFile, accessClientSecretFile,
    tlsCAFile: fixture.caFile, backgroundProfile,
    personas: { [persona]: { agentId: 'assistant', model: 'fixture-model',
      allowedTools: ['hehebot_list_routines', 'hehebot_read_skill'] } } };
  const templatePath = join(directory, 'template.json'), templateBytes = JSON.stringify(template);
  await writeFile(templatePath, templateBytes, { mode: 0o600 });
  const managerTokenFile = join(directory, 'manager-token'), wakeTokenFile = join(directory, 'wake-token');
  await writeFile(managerTokenFile, managerToken, { mode: 0o600 });
  await writeFile(wakeTokenFile, wakeToken, { mode: 0o600 });
  const managerConfig = { kind: 'owner-alpha-background-manager-v1', portalOrigin: fixture.origin,
    installationId: 'hosted-fixture', hostedOwnerBindingSha256: fixture.ownerBindingSha256,
    managerTokenFile, templatePath, templateSha256: hash(templateBytes), sessionsDirectory,
    accessClientIdFile, accessClientSecretFile };
  const configPath = join(directory, 'manager.json');
  await writeFile(configPath, JSON.stringify(managerConfig), { mode: 0o600 });

  const aDone = deferred(), sendS = deferred(), sDone = deferred(), sendB = deferred(),
    bDone = deferred(), cancelSent = deferred(), aCancelled = deferred(), launchStaged = deferred();
  const launchImpl = async (path, { expectedSha256 }) => {
    // This launch runs inside the real wake callback, potentially before the
    // main flow has observed any receipt or background row, so every
    // expectation derives from the immutable staged config plus independent
    // durable reads — never from main-flow bindings, which may still be in
    // their temporal dead zone when the alarm callback wins the race.
    const { config } = await readOwnerAlphaConfig(path, expectedSha256);
    assert.deepEqual(Object.keys(config.ownerAlphaGeneration).sort(), ['boot_id', 'epoch', 'transition_id']);
    assert.equal(config.ownerAlphaGeneration.epoch, 2);
    assert.equal(config.ownerAlpha.background_first_root, true);
    assert.equal(config.ownerAlpha.text_only, undefined);
    assert.equal(config.ownerAlphaWarm, undefined);
    assert.deepEqual(Object.keys(config.ownerAlphaBackground).sort(), ['background_profile_sha256', 'generation_sha256']);
    assert.deepEqual(config.backgroundProfile, backgroundProfile);
    const durableRows = await fixture.backgroundRows();
    const generationRow = durableRows.find(row => row.key === 'owner_alpha_background_generation:2');
    const manifestRow = durableRows.find(row => row.key === 'owner_alpha_background_manifest:2:1');
    const reservationRow = durableRows.find(row => row.key === 'owner_alpha_reservation:2:1');
    assert.ok(generationRow && manifestRow && reservationRow, 'first-admission durable rows missing at launch');
    assert.deepEqual(config.ownerAlphaGeneration, { epoch: generationRow.value.epoch,
      boot_id: generationRow.value.boot_id, transition_id: generationRow.value.transition_id });
    assert.deepEqual(config.ownerAlpha, { session_id: generationRow.value.policy.session_id, persona_id: persona,
      expires_at: generationRow.value.policy.expires_at, max_runs: 3, max_task_seconds: 300, background_first_root: true });
    assert.deepEqual(config.ownerAlphaBackground, { generation_sha256: generationRow.value.authority.generation_sha256,
      background_profile_sha256: backgroundProfileSha256(backgroundProfile) });
    assert.equal(config.stateDirectory, join(sessionsDirectory, config.ownerAlphaGeneration.transition_id));
    const hostTokenFile = config.runtimeTokenFile;
    hostTokenBytes = await readFile(hostTokenFile);
    assert.equal((await stat(hostTokenFile)).mode & 0o777, 0o600, 'host token is not owner-only');
    assert.ok(!JSON.stringify(config).includes(hostTokenBytes.toString('utf8')), 'raw host token entered the child configuration');
    assert.deepEqual(await readdir(sessionsDirectory), [config.ownerAlphaGeneration.transition_id]);
    assert.deepEqual(report.spriteRequests.slice(0, 2), ['PUT', 'GET'], 'background manager hold must precede launch');
    assert.equal(taskNames[0], `hehe-background-${config.ownerAlphaGeneration.transition_id}`, 'manager hold used another task identity');
    assert.equal(report.nativeStarts, 0, 'native started before the manager handed over');
    report.codex = (await import('../runtime/codex-adapter.mjs')).PINNED_CODEX;

    model = createServer(async (request, response) => {
      try {
        assert.equal(request.method, 'POST'); assert.equal(request.url, '/v1/responses');
        const chunks = []; let bytes = 0;
        for await (const chunk of request) { assert.ok((bytes += chunk.length) <= 2 * 1024 * 1024); chunks.push(chunk); }
        const body = JSON.parse(Buffer.concat(chunks)); report.modelRequests++;
        assert.ok(report.modelRequests <= 40); assert.equal(body.model, 'fixture-model'); assert.equal(body.stream, true);
        const catalog = names(body);
        report.toolCatalogs = { ...report.toolCatalogs };
        assert.ok(!catalog.some(name => /web_search|image_generation|tool_suggest/.test(name)), 'DISABLED_PROVIDER_SURFACE');
        assert.ok(!catalog.some(name => /(^|\.)sleep$/.test(name)), 'SLEEP_TOOL_ADVERTISED');
        assert.ok(!catalog.some(name => /wait_agent|close_agent|send_input|resume_agent/.test(name)), 'LEGACY_OR_WAIT_TOOL_ADVERTISED');
        const text = JSON.stringify(body.input.filter(item => item.role === 'user' || item.type === 'agent_message' || item.type === 'user_message'));
        // Assert prompt content against the decoded user text: the turn/start
        // message JSON arrives verbatim inside input_text, so re-stringified
        // input escapes its inner quotes.
        const prompt = body.input.filter(item => item.role === 'user' || item.type === 'agent_message' || item.type === 'user_message')
          .flatMap(item => Array.isArray(item.content) ? item.content : [])
          .map(part => part?.text ?? '').join('\n');
        const label = ['CHILD_A', 'ROOT_A', 'ROOT_S', 'ROOT_B'].find(value => text.includes(marker(value)));
        assert.ok(label, 'UNKNOWN_SCRIPTED_REQUEST');
        counts[label] = (counts[label] ?? 0) + 1;
        report.toolCatalogs[label] = catalog;
        if (label === 'ROOT_A') {
          for (const name of ['spawn_agent', 'send_message', 'followup_task', 'interrupt_agent', 'list_agents'])
            assert.ok(catalog.includes(`collaboration.${name}`), `ROOT_A_V2_TOOL_MISSING_${name}`);
          if (counts.ROOT_A === 1) {
            send(response, collabCall(body, 'spawn', 'spawn_agent',
              { task_name: 'child_a', message: marker('CHILD_A'), fork_turns: 'none' }));
          } else {
            assert.equal(counts.ROOT_A, 2, 'unexpected third background root model request');
            const output = body.input.filter(item => item.type === 'function_call_output').at(-1)?.output ?? '';
            assert.ok(output.includes('child_a'), 'spawn result absent from second background root request');
            report.spawnResult = output;
            send(response, message(replyA));
          }
          return;
        }
        if (label === 'CHILD_A') {
          assert.equal(counts.CHILD_A, 1, 'unexpected second resident child request');
          hold('CHILD_A', response);
          return;
        }
        if (label === 'ROOT_S') {
          assert.equal(counts.ROOT_S, 1, 'unexpected second status root request');
          assert.ok(!catalog.some(name => /collaboration|spawn_agent|list_agents|interrupt_agent|followup_task|send_message|mcp/.test(name)),
            'STATUS_ROOT_TOOL_SURFACE');
          assert.ok(prompt.includes(marker('ROOT_S')), 'status root prompt lost its own instruction');
          assert.ok(prompt.includes('"background_status_summary"'), 'frozen status summary absent from status prompt');
          assert.ok(aRunIdForModel && prompt.includes(aRunIdForModel), 'status summary lost the background root identity');
          assert.ok(prompt.includes('"coordinator_released":true'), 'status summary did not freeze the observed coordinator release');
          assert.ok(prompt.includes('"child_count":1'), 'status summary did not freeze the resident child count');
          for (const forbidden of [marker('ROOT_A'), marker('CHILD_A'), marker('A_FINAL'), 'child_a'])
            assert.ok(!prompt.includes(forbidden), `STATUS_ROOT_CONTEXT_LEAK_${forbidden}`);
          send(response, message(replyS));
          return;
        }
        assert.equal(label, 'ROOT_B');
        assert.ok(!catalog.some(name => /collaboration|spawn_agent|list_agents|interrupt_agent|followup_task|send_message/.test(name)),
          'INDEPENDENT_ROOT_COLLABORATION_TOOL');
        assert.ok(catalog.some(name => name.includes('hehebot_list_routines')), 'B_LIST_ROUTINES_TOOL_MISSING');
        assert.ok(catalog.some(name => name.includes('hehebot_read_skill')), 'B_READ_SKILL_TOOL_MISSING');
        assert.ok(prompt.includes(marker('ROOT_B')), 'independent root prompt lost its own instruction');
        for (const forbidden of [marker('ROOT_A'), marker('CHILD_A'), marker('A_FINAL'), marker('ROOT_S'), marker('S_FINAL'),
          'background_status_summary', 'child_a'])
          assert.ok(!prompt.includes(forbidden), `INDEPENDENT_ROOT_CONTEXT_LEAK_${forbidden}`);
        if (counts.ROOT_B === 1) {
          send(response, toolCall(body, 'listRoutines', 'hehebot_list_routines', {}));
        } else {
          assert.equal(counts.ROOT_B, 2, 'unexpected third independent root request');
          const rawOutput = body.input.filter(item => item.type === 'function_call_output').at(-1)?.output;
          // MCP tool outputs arrive as an array of typed parts, unlike the
          // collaboration call outputs above; join their text fields.
          const output = Array.isArray(rawOutput)
            ? rawOutput.map(part => part?.text ?? '').join('\n')
            : typeof rawOutput === 'string' ? rawOutput : '';
          assert.ok(output.includes(routineName), `routine list result absent from independent root follow-up: ${JSON.stringify(rawOutput).slice(0, 1200)}`);
          report.routineListOutput = output;
          send(response, message(replyB));
        }
      } catch (error) { modelError = error; response.destroy(); }
    });
    await new Promise(ok => model.listen(0, '127.0.0.1', ok));
    service = createSpriteCodexService(config, { spriteRequest, fetchImpl: fixture.fetchImpl,
      launch: options => { report.nativeStarts++; return spawnCodex(options); },
      prepareNative: async homeDirectory => {
        const catalogPath = join(homeDirectory, 'fixture-models.json');
        await writeFile(catalogPath, JSON.stringify({ models: [{ slug: 'fixture-model', display_name: 'Synthetic V2 fixture', description: null,
          supported_reasoning_levels: [], shell_type: 'unified_exec', visibility: 'list', supported_in_api: true,
          priority: 1, upgrade: null, model_messages: { instructions_template: 'Synthetic credential-free native fixture.', instructions_variables: null },
          default_reasoning_summary: 'auto', support_verbosity: false, default_verbosity: null, apply_patch_tool_type: null,
          truncation_policy: { mode: 'bytes', limit: 10000 }, supports_image_detail_original: false, context_window: 272000,
          auto_compact_token_limit: null, effective_context_window_percent: 95, experimental_supported_tools: [],
          multi_agent_version: 'v2' }] }), { mode: 0o600 });
        await writeFile(join(homeDirectory, 'config.toml'),
          `model = "fixture-model"\nmodel_provider = "fixture"\nweb_search = "disabled"\n` +
          `model_catalog_json = ${JSON.stringify(catalogPath)}\n[agents]\nenabled = false\n[features]\nmulti_agent = false\n` +
          `multi_agent_v2 = false\napps = false\nplugins = false\ntool_suggest = false\nimage_generation = false\n` +
          `standalone_web_search = false\ntoken_budget = false\nsleep_tool = false\nrequest_permissions_tool = false\n` +
          `exec_permission_approvals = false\n[analytics]\nenabled = false\n[feedback]\nenabled = false\n` +
          `[model_providers.fixture]\nname = "Loopback"\nbase_url = "http://127.0.0.1:${model.address().port}/v1"\n` +
          `wire_api = "responses"\nrequires_openai_auth = false\nrequest_max_retries = 0\nstream_max_retries = 0\n`, { mode: 0o600 });
      } });
    const dispatched = await service.start();
    assert.equal(report.nativeStarts, 1, 'background session started more than one native process');
    assert.equal(dispatched.claim.run.id, manifestRow.value.run_id);
    assert.equal(dispatched.claim.role, 'background');
    assert.equal(dispatched.claim.owner_alpha_background, true);
    assert.deepEqual(Object.keys(dispatched.claim).sort(),
      ['background', 'deadline_at', 'manifest', 'owner_alpha_background', 'role', 'run', 'submission_key', 'task_credential']);
    assert.equal(dispatched.claim.manifest.admission, 1);
    assert.equal(dispatched.claim.manifest.role, 'background');
    assert.equal(dispatched.claim.manifest.manifest_sha256, manifestRow.value.manifest_sha256);
    assert.equal(dispatched.claim.deadline_at, manifestRow.value.expires_at);
    assert.equal(dispatched.claim.run.current_attempt, 1);
    assert.deepEqual(Object.keys(dispatched.claim.task_credential).sort(), ['grant', 'token_file']);
    assert.equal(dispatched.claim.task_credential.token_file, join(config.stateDirectory, 'task-tokens', manifestRow.value.run_id));
    assert.equal(dispatched.claim.task_credential.grant.run_id, manifestRow.value.run_id);
    const tokenA = await readFile(dispatched.claim.task_credential.token_file);
    assert.equal((await stat(dispatched.claim.task_credential.token_file)).mode & 0o777, 0o600, 'task token file is not owner-only');
    assert.equal(JSON.parse(Buffer.from(tokenA.toString('utf8').split('.')[0], 'base64url').toString('utf8')).typ, 'hehebot-background-task+jwt');
    aRunIdForModel = manifestRow.value.run_id;
    const stateDirectory = config.stateDirectory;
    const completedRun = async runId => {
      const state = await readState();
      return state.runs.find(run => run.id === runId)?.status === 'completed';
    };
    const journalRows = async () => {
      const rows = [];
      for (const name of await readdir(join(stateDirectory, 'journal'))) {
        if (!name.endsWith('.json')) continue;
        const row = JSON.parse(await readFile(join(stateDirectory, 'journal', name), 'utf8'));
        rows.push(row, ...(Array.isArray(row.families) ? row.families : []));
      }
      return rows;
    };
    // The coordinator release is observed through the durable journal, not
    // through main-flow bindings: the dispatch cursor carries released and
    // completed families in a nested array.
    const aReleased = async () => (await journalRows()).some(row =>
      row.claim?.run?.id === manifestRow.value.run_id && row.coordinatorRelease?.acknowledged === true);
    const maintainUntil = async (probe, label, timeoutMs = 90000) => {
      const end = Date.now() + timeoutMs;
      while (Date.now() < end) {
        if (modelError) throw modelError;
        await service.maintain();
        if (await probe()) return;
        await pause(150);
      }
      assert.fail(`TIMEOUT_${label}`);
    };
    // The wake preparation and native launch are fully staged (session
    // claimed, native started, task credential written) before the main flow
    // observes anything further.
    launchStaged.resolve();

    // Drive A to its observed coordinator release: the resident child stays
    // active while the A coordinator releases and the status root replies.
    await maintainUntil(aReleased, 'A_COORDINATOR_RELEASE');
    assert.equal(counts.ROOT_A, 2); assert.equal(counts.CHILD_A, 1);
    assert.ok(held.get('CHILD_A') && held.get('CHILD_A').closed === false, 'resident child not active through the coordinator release');
    aDone.resolve();

    const { runId: sRunId } = await sendS.promise;
    await maintainUntil(() => completedRun(sRunId), 'S_CANONICAL_COMPLETION');
    assert.equal(counts.ROOT_S, 1);
    assert.ok(held.get('CHILD_A').closed === false, 'resident child did not stay active through the status reply');
    const rowsAfterS = await fixture.backgroundRows();
    assert.deepEqual(rowsAfterS.find(row => row.key === 'owner_alpha_background_manifest:2:1').value, manifestRow.value,
      'the background admission manifest changed after the status root settled');
    assert.ok(rowsAfterS.some(row => row.key === `owner_alpha_background_receipt:${sRunId}:1`), 'status root receipt missing');
    assert.equal((await readState()).runs.find(run => run.id === manifestRow.value.run_id).status, 'running',
      'the background root completed or settled');
    assert.equal((await readFile(join(stateDirectory, 'task-tokens', manifestRow.value.run_id))).compare(tokenA), 0,
      'the background root task credential changed');
    sDone.resolve();

    const { runId: bRunId } = await sendB.promise;
    await maintainUntil(() => completedRun(bRunId), 'B_CANONICAL_COMPLETION');
    assert.equal(counts.ROOT_B, 2);
    const rowsAfterB = await fixture.backgroundRows();
    assert.ok(rowsAfterB.some(row => row.key === `owner_alpha_background_receipt:${bRunId}:1`), 'independent root receipt missing');
    assert.ok(rowsAfterB.some(row => row.key === 'owner_alpha_background_manifest:2:3'), 'independent manifest row missing');
    assert.notEqual(rowsAfterB.find(row => row.key === 'owner_alpha_background_manifest:2:2').value.manifest_sha256,
      manifestRow.value.manifest_sha256, 'manifest digests collided across admissions');
    const tokenS = await readFile(join(stateDirectory, 'task-tokens', sRunId));
    const tokenB = await readFile(join(stateDirectory, 'task-tokens', bRunId));
    assert.ok(!tokenS.equals(tokenB) && !tokenS.equals(tokenA) && !tokenB.equals(tokenA),
      'admissions staged shared task credentials');
    const journalFiles = (await readdir(join(stateDirectory, 'journal'))).map(name => readFile(join(stateDirectory, 'journal', name), 'utf8'));
    for (const journal of await Promise.all(journalFiles)) {
      assert.ok(!journal.includes(tokenA.toString('utf8')), 'raw task token leaked into the journal');
      assert.ok(!journal.includes(tokenS.toString('utf8')), 'raw task token leaked into the journal');
      assert.ok(!journal.includes(tokenB.toString('utf8')), 'raw task token leaked into the journal');
      assert.ok(!journal.includes(hostTokenBytes.toString('utf8')), 'raw host token leaked into the journal');
    }
    const rootThreads = new Map();
    for (const row of await journalRows()) {
      if (row?.claim?.run?.id && row.nativeThreadId) rootThreads.set(row.claim.run.id, row.nativeThreadId);
    }
    assert.deepEqual([...rootThreads.keys()].sort(), [manifestRow.value.run_id, sRunId, bRunId].sort(),
      'the journal did not retain exactly the three admitted roots');
    assert.equal(new Set([...rootThreads.values()]).size, 3, 'the three roots shared one native thread');
    for (const threadId of rootThreads.values()) assert.match(threadId, uuidPattern);
    bDone.resolve();

    const { reason } = await cancelSent.promise;
    assert.ok(reason);
    await maintainUntil(() => held.get('CHILD_A')?.closed === true, 'A_CHILD_INTERRUPTED');
    assert.equal((await readState()).runs.find(run => run.id === manifestRow.value.run_id).status, 'cancelling',
      'the background root did not enter owner-requested cancellation');
    assert.equal((await readState()).runs.find(run => run.id === sRunId).status, 'completed', 'cancellation reached the status root');
    assert.equal((await readState()).runs.find(run => run.id === bRunId).status, 'completed', 'cancellation reached the independent root');
    aCancelled.resolve();

    // The frozen deadline is never shortened or mutated. This is the test's
    // own explicit post-expiry service.stop() (explicit-stop); no automatic
    // timer stop is claimed and authenticated maintenance is not assumed to
    // remain available up to the deadline itself.
    const expiresAt = Date.parse(generationRow.value.policy.expires_at);
    while (Date.now() < expiresAt) await pause(200);
    await service.stop();
    const stoppedJournal = JSON.parse(await readFile(join(stateDirectory, 'journal', 'service.json')));
    assert.equal(stoppedJournal.phase, 'recovery');
    assert.equal(stoppedJournal.nativeStopped, true);
    assert.deepEqual(stoppedJournal.ownerAlphaGeneration, config.ownerAlphaGeneration);
    assert.deepEqual(stoppedJournal.ownerAlphaBackground, config.ownerAlphaBackground);
    assert.deepEqual(stoppedJournal.ownerAlpha, config.ownerAlpha);
    assert.equal(stoppedJournal.hostedOwner.bindingSha256, config.hostedOwnerBindingSha256);
    return { code: 0, signal: null, label: 'explicit-stop' };
  };
  // A failed launch assertion must reject the coordination deferreds rather
  // than vanish into the wake callback's catch and hang the main flow.
  const launch = async (path, options) => {
    try { return await launchImpl(path, options); }
    catch (error) { aDone.reject(error); sendS.resolve(); sDone.reject(error); sendB.resolve(); bDone.reject(error);
      cancelSent.resolve(); aCancelled.reject(error); launchStaged.resolve(); throw error; }
  };
  let finishWake;
  const wakeFinished = new Promise(ok => { finishWake = ok; });
  listener = createHostedOwnerWakeService({ configPath, wakeTokenFile, port: 8080 },
    { control: managerClient, spriteRequest, report: value => finishWake(value.code), launch });
  listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  fixture.setBackgroundWakeLoopback(`http://127.0.0.1:${listener.address().port}`);
  assert.deepEqual(fixture.backgroundWakeDeliveries, [], 'arranging the listener delivered a wake');
  assert.deepEqual(await readdir(sessionsDirectory), [], 'arranging the listener staged a session');
  assert.equal(report.nativeStarts, 0); assert.deepEqual(report.spriteRequests, []);

  // First owner message admits the background root; the real Durable Object
  // alarm delivers the once-only wake intent through the actual production
  // sendHostedWake path.
  const requestA = await sendOwnerMessage(textA, 1);
  const receiptA = await (await fixture.fetchImpl('/v1/commands', requestA)).json();
  assert.equal(receiptA.status, 'applied');
  const rowsA = await fixture.backgroundRows();
  const generationRowA = rowsA.find(row => row.key === 'owner_alpha_background_generation:2');
  const manifestRowA = rowsA.find(row => row.key === 'owner_alpha_background_manifest:2:1');
  assert.ok(generationRowA && manifestRowA, 'first admission rows missing');
  assert.equal(manifestRowA.value.run_id, receiptA.resource_id);
  assert.equal(generationRowA.value.epoch, 2);
  let intent = null;
  for (let tries = 0; tries < 240 && !(intent && intent.status === 'queued'); tries++) {
    intent = await fixture.wakeIntent();
    if (!(intent && intent.status === 'queued')) await pause(250);
  }
  assert.ok(intent, 'wake intent never formed');
  assert.equal(intent.status, 'queued', `wake delivery was never confirmed: ${JSON.stringify(intent)}`);
  assert.equal(fixture.backgroundWakeDeliveries.length, 1, 'the background wake was not delivered exactly once');
  assert.deepEqual(fixture.backgroundWakeDeliveries[0], { method: 'POST', url: 'https://synthetic-background.sprites.app/wake',
    headers: { authorization: `Bearer ${syntheticProviderToken}`, 'x-hehe-wake-token': wakeToken, 'content-type': 'application/json' },
    body: { epoch: 2, operationId: generationRowA.value.transition_id } });
  assert.deepEqual(intent, { epoch: 2, boot_id: generationRowA.value.boot_id,
    transition_id: generationRowA.value.transition_id, status: 'queued' });
  await withDeadline(aDone.promise, 150000, 'the background root never released its coordinator');

  // The background root stays admitted and uncompleted; only the status root
  // may follow, and only after the observed release.
  summary = (await readState()).summary;
  assert.deepEqual(summary.owner_alpha_background, { schema_version: 1, kind: 'owner-alpha-background-summary-v1',
    policy_revision: 'background-stage-b-v1', persona_id: persona, policy_expires_at: backgroundConfig.expires_at,
    max_admissions: 3, admissions_used: 1, message_admission_available: true, next_role: 'status',
    generation: { session_id: generationRowA.value.policy.session_id, expires_at: generationRowA.value.policy.expires_at, epoch: 2 } });
  // Idempotent replay of the exact first request changes nothing.
  const replayA = await fixture.fetchImpl('/v1/commands', requestA);
  assert.equal(replayA.status, 202); assert.deepEqual(await replayA.json(), receiptA);
  assert.equal(fixture.backgroundWakeDeliveries.length, 1, 'replay delivered a second background wake');
  assert.equal(report.nativeStarts, 1, 'replay started another native process');
  assert.deepEqual(await fixture.wakeIntent(), intent, 'replay touched the settled wake intent');

  const requestS = await sendOwnerMessage(textS, 2);
  const receiptS = await (await fixture.fetchImpl('/v1/commands', requestS)).json();
  assert.equal(receiptS.status, 'applied');
  assert.notEqual(receiptS.resource_id, receiptA.resource_id);
  sendS.resolve({ runId: receiptS.resource_id });
  await withDeadline(sDone.promise, 120000, 'the status root never settled canonically');
  const historyS = await (await fixture.fetchImpl(`/v1/conversations/${persona}/events`, { headers: ownerHeaders })).json();
  const resultsS = historyS.events.filter(event => event.type === 'run.result' && event.payload.run_id === receiptS.resource_id);
  assert.equal(resultsS.length, 1); assert.equal(resultsS[0].payload.text, replyS);
  summary = (await readState()).summary;
  assert.deepEqual(summary.owner_alpha_background, { schema_version: 1, kind: 'owner-alpha-background-summary-v1',
    policy_revision: 'background-stage-b-v1', persona_id: persona, policy_expires_at: backgroundConfig.expires_at,
    max_admissions: 3, admissions_used: 2, message_admission_available: true, next_role: 'independent',
    generation: { session_id: generationRowA.value.policy.session_id, expires_at: generationRowA.value.policy.expires_at, epoch: 2 } });
  assert.deepEqual(await fixture.wakeIntent(), intent, 'the status admission touched the settled wake intent');
  assert.equal(fixture.backgroundWakeDeliveries.length, 1, 'the status admission delivered another wake');
  assert.equal(report.nativeStarts, 1, 'the status admission started another native process');

  if (browserMode) {
    assert.ok(await waitFor(() => browserJson(`Array.from(document.querySelectorAll('.message.bot .message-body')).some(n => n.textContent === ${JSON.stringify(replyS)})`)));
    assert.equal(held.get('CHILD_A').closed, false, 'child stopped before the browser displayed S');
    await mkdir('.amp/in/artifacts', { recursive: true });
    await browser('screenshot', resolve('.amp/in/artifacts/background-manager-status.png'));
  }

  const requestB = await sendOwnerMessage(textB, 3);
  const receiptB = await (await fixture.fetchImpl('/v1/commands', requestB)).json();
  assert.equal(receiptB.status, 'applied');
  assert.notEqual(receiptB.resource_id, receiptA.resource_id);
  assert.notEqual(receiptB.resource_id, receiptS.resource_id);
  sendB.resolve({ runId: receiptB.resource_id });
  await withDeadline(bDone.promise, 150000, 'the independent root never settled canonically');
  const historyB = await (await fixture.fetchImpl(`/v1/conversations/${persona}/events`, { headers: ownerHeaders })).json();
  const resultsB = historyB.events.filter(event => event.type === 'run.result' && event.payload.run_id === receiptB.resource_id);
  assert.equal(resultsB.length, 1); assert.equal(resultsB[0].payload.text, replyB);
  summary = (await readState()).summary;
  assert.deepEqual(summary.owner_alpha_background, { schema_version: 1, kind: 'owner-alpha-background-summary-v1',
    policy_revision: 'background-stage-b-v1', persona_id: persona, policy_expires_at: backgroundConfig.expires_at,
    max_admissions: 3, admissions_used: 3, message_admission_available: false, next_role: null,
    generation: { session_id: generationRowA.value.policy.session_id, expires_at: generationRowA.value.policy.expires_at, epoch: 2 } });

  if (browserMode) {
    await browser('reload');
    assert.ok(await waitFor(() => browserJson('document.querySelector("#connection")?.textContent === "Connected"')));
    assert.ok(await waitFor(() => browserJson(`Array.from(document.querySelectorAll('.message.bot .message-body')).some(n => n.textContent === ${JSON.stringify(replyB)})`)));
    const timeline = await browserJson(`({users:Array.from(document.querySelectorAll('.message.user .message-body')).map(n=>n.textContent),bots:Array.from(document.querySelectorAll('.message.bot .message-body')).map(n=>n.textContent)})`);
    assert.deepEqual(timeline.users, [textA, textS, textB]);
    for (const reply of [replyS, replyB]) assert.equal(timeline.bots.filter(text => text === reply).length, 1);
    assert.equal(await browserJson('document.querySelector("#send").disabled && document.querySelector("#message").readOnly'), true);
    assert.equal(await browserJson('document.querySelector("#runtime-banner").getAttribute("role")'), 'status');
    for (const selector of ['#send', '#message']) assert.equal(await browserJson(`document.querySelector(${JSON.stringify(selector)}).getAttribute('aria-describedby')`), 'runtime-banner');
    assert.equal(fixture.browserCommands.length, 3);
    assert.equal(report.nativeStarts, 1); assert.equal(report.modelRequests, 6);
    assert.equal((await browser('errors')).stdout.trim(), '');
    await browser('set', 'viewport', '1280', '1600', '2');
    await browser('eval', 'document.querySelector("#timeline").scrollTo(0, 0)');
    await browser('eval', 'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    await browser('screenshot', resolve('.amp/in/artifacts/background-manager-exhausted.png'));
    report.browserComposerVerified = true;
    report.reloadPreservedCanonicalReplies = true;
    report.passiveBrowserReadsDidNotLaunch = true;
  }

  // Exact owner cancellation of the background root family only.
  let cancelRequest = command('run.cancel', { run_id: receiptA.resource_id, reason: 'OWNER_BACKGROUND_EXPLICIT_CANCEL' });
  if (browserMode) {
    const card = `[data-run-id="${receiptA.resource_id}"]`;
    await browser('eval', `document.querySelector(${JSON.stringify(card)}).open=true`);
    await browser('click', card + ' .danger');
    assert.ok(await waitFor(() => browserJson('document.querySelector("#editor").open')));
    assert.ok((await browserJson('document.querySelector("#editor").textContent')).includes(receiptA.resource_id));
    await browser('check', '#editor [name=confirm]');
    await browser('click', '#editor-form button[type=submit]');
    assert.ok(await waitFor(() => browserJson('!document.querySelector("#editor").open')));
    assert.equal(fixture.browserCommands.length, 4);
    const sent = fixture.browserCommands[3];
    assert.deepEqual(JSON.parse(sent.body), { schema_version: 1, type: 'run.cancel',
      payload: { run_id: receiptA.resource_id, reason: 'Owner selected this task for cancellation.' } });
    cancelRequest = { method: 'POST', headers: { ...ownerHeaders, Origin: fixture.origin,
      'Content-Type': sent.headers['content-type'], 'Idempotency-Key': sent.headers['idempotency-key'] }, body: sent.body };
    report.exactBrowserCancellation = true;
  }
  const cancelReceipt = await (await fixture.fetchImpl('/v1/commands', cancelRequest)).json();
  assert.equal(cancelReceipt.status, 'applied');
  cancelSent.resolve({ reason: 'OWNER_BACKGROUND_EXPLICIT_CANCEL' });
  await withDeadline(aCancelled.promise, 120000, 'the background root family was never interrupted');
  const finalRuns = (await readState()).runs;
  assert.equal(finalRuns.find(run => run.id === receiptA.resource_id).status, 'cancelling');
  assert.equal(finalRuns.find(run => run.id === receiptS.resource_id).status, 'completed');
  assert.equal(finalRuns.find(run => run.id === receiptB.resource_id).status, 'completed');

  // Negative authority while the generation is still inside its frozen
  // deadline: retirement is premature, and separate principals never reach
  // each other's routes.
  await assert.rejects(() => managerClient.request('retirement', { epoch: intent.epoch, boot_id: intent.boot_id,
    session_id: generationRowA.value.policy.session_id, transition_id: intent.transition_id,
    observed_at: new Date().toISOString(), direct_child_stopped: true, execution_lock_free: true,
    session_lock_free: true, source: 'premature-observation' }),
  error => error.code === 'CONTROL_HTTP_ERROR' && error.status === 422, 'premature retirement was accepted');
  const stateDirectory = join(sessionsDirectory, intent.transition_id);
  const hostToken = (await readFile(join(stateDirectory, 'host-token'))).toString('utf8');
  const hostAbuse = new ControlClient({ origin: fixture.origin, token: hostToken, principal: 'background-manager',
    accessClientId, accessClientSecret, fetchImpl: fixture.fetchImpl });
  await assert.rejects(() => hostAbuse.request('generation', {}),
    error => error.code === 'CONTROL_HTTP_ERROR' && error.status === 401, 'host token reached the manager route');
  const taskToken = (await readFile(join(stateDirectory, 'task-tokens', receiptS.resource_id))).toString('utf8');
  const taskAbuse = new ControlClient({ origin: fixture.origin, token: taskToken, principal: 'background-host',
    accessClientId, accessClientSecret, fetchImpl: fixture.fetchImpl });
  await assert.rejects(() => taskAbuse.request('status', { identity: { epoch: 2, boot_id: intent.boot_id } }),
    error => error.code === 'CONTROL_HTTP_ERROR' && error.status === 401, 'task token reached the host route');
  // Idempotent replay of the exact delivered wake body to the production
  // listener is acknowledged duplicate without a second launch, hold or POST.
  const wakeReplay = await fetch(`http://127.0.0.1:${listener.address().port}/wake`, { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hehe-wake-token': wakeToken },
    body: JSON.stringify({ epoch: intent.epoch, operationId: intent.transition_id }),
    signal: AbortSignal.timeout(15000) });
  assert.equal(wakeReplay.status, 202, `wake replay body: ${await wakeReplay.clone().text().catch(() => '<unreadable>')}`);
  assert.deepEqual(await wakeReplay.json(), { accepted: true, epoch: intent.epoch, duplicate: true });
  assert.equal(fixture.backgroundWakeDeliveries.length, 1, 'wake replay reached the Worker outbound path again');
  assert.equal(report.nativeStarts, 1, 'wake replay launched a second native process');

  // The retired wake callback reports only after the frozen expiry, the
  // explicit stopped custody and the dual-flock readback settle.
  const result = await withDeadline(wakeFinished, 420000, 'the background wake callback did not settle');
  assert.equal(result, 'RETIREMENT_REPORTED');
  assert.equal(report.nativeStarts, 1, 'the background session used more than one native process');
  assert.deepEqual(counts, { ROOT_A: 2, CHILD_A: 1, ROOT_S: 1, ROOT_B: 2 });
  // One manager hold plus one activity hold, then only renewals of those same
  // holds: no release, no second wake hold, no DELETE.
  assert.deepEqual(report.spriteRequests.slice(0, 4), ['PUT', 'GET', 'PUT', 'GET']);
  assert.ok(report.spriteRequests.every(method => method === 'PUT' || method === 'GET'),
    'unexpected sprite activity beyond holds and confirmations');
  assert.deepEqual(taskNames.slice(0, 2),
    [`hehe-background-${intent.transition_id}`, `hehe-2-${intent.boot_id}`]);
  assert.equal(new Set(taskNames).size, 2, 'sprite holds appeared for another task identity');
  // A distinct retirement observation conflicts with the manager's own
  // immutable recorded observation.
  await assert.rejects(() => managerClient.request('retirement', { epoch: intent.epoch, boot_id: intent.boot_id,
    session_id: generationRowA.value.policy.session_id, transition_id: intent.transition_id,
    observed_at: new Date().toISOString(), direct_child_stopped: true, execution_lock_free: true,
    session_lock_free: true, source: 'stage-b-background-e2e:distinct-observation' }),
  error => error.code === 'CONTROL_HTTP_ERROR' && error.status === 422,
  'distinct retirement observation was accepted; the manager observation was never recorded');
  const retiredRows = await fixture.backgroundRows();
  assert.deepEqual(retiredRows.find(row => row.key === 'owner_alpha_background_generation:2').value, generationRowA.value,
    'retirement rewrote the immutable generation descriptor');
  const retirementRow = retiredRows.find(row => row.key === 'owner_alpha_retirement:2');
  assert.ok(retirementRow, 'manager retirement observation missing');
  assert.equal(retirementRow.value.epoch, 2); assert.equal(retirementRow.value.direct_child_stopped, true);
  assert.equal(retirementRow.value.execution_lock_free, true); assert.equal(retirementRow.value.session_lock_free, true);
  // Exactly one production wake POST to the private pinned Sprite destination
  // (loopback-routed); every other outbound request stays the Access certs read.
  const wakePosts = fixture.outboundRequests.filter(request => request.method === 'POST');
  assert.deepEqual(wakePosts, [{ method: 'POST', url: 'https://synthetic-background.sprites.app/wake' }],
    'the background wake was not the single outbound POST');
  assert.ok(fixture.outboundRequests.every(request =>
    request.method === 'GET' && request.url.endsWith('/cdn-cgi/access/certs') ||
    request.method === 'POST' && request.url === 'https://synthetic-background.sprites.app/wake'));
  assert.ok(launchEnvelopeByteStable, 'launch envelope byte-stability was never captured through the manager request seam');
  Object.assign(report, { status: 'passed', oneProcessThreeRoots: true, rolesFromManifestOrdinal: true,
    childActiveThroughStatusReply: true, distinctRootThreads: true, distinctTaskCredentials: true,
    statusPromptFrozenSummary: true, independentRootIsolatedContext: true, exactCancellationScopedToAFamily: true,
    backgroundRootNeverSettles: true, passiveReadsDidNotLaunch: true, replayDidNotRelaunch: true,
    noPrematureRetirement: true, explicitPostExpiryStop: true, automaticTimerStopClaimed: false,
    dualLockRetirement: true, productionEnabled: false, providerOrAccountVerified: false, realWorkerWakeDelivery: true,
    wakeReplayIdempotent: true, launchEnvelopeByteStable: true });
} catch (error) {
  report.error = error.code ?? error.name;
  report.message = error.message;
  report.frames = error.stack?.split('\n').filter(line => line.trimStart().startsWith('at '));
  // Surface the masked underlying cause without printing private payloads.
  if (error.cause) {
    report.cause = { code: error.cause.code ?? error.cause.name, message: error.cause.message,
      frames: error.cause.stack?.split('\n').filter(line => line.trimStart().startsWith('at ')) };
  }
  process.exitCode = 1;
} finally {
  if (browserMode) await browser('close').catch(() => {});
  clearTimeout(wakeDeadline); listener?.stop();
  await service?.stop().catch(() => {}); await fixture?.close().catch(() => {});
  if (model) { model.closeAllConnections(); await new Promise(ok => model.close(ok)); }
  if (report.status === 'passed') await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  else report.privateDiagnostics = directory;
  console.log(JSON.stringify(report, (key, value) => key === 'privateDiagnostics' && typeof value === 'string' ? '<disposable-temp>' : value, 2));
}

function names(body) {
  return body.tools.flatMap(tool => tool.type === 'namespace'
    ? tool.tools.map(nested => `${tool.name}.${nested.name}`) : [tool.name ?? tool.type]);
}
function message(text) {
  return [{ id: `msg_${randomUUID()}`, type: 'message', status: 'completed', role: 'assistant',
    content: [{ type: 'output_text', text, annotations: [] }] }];
}
function functionCall({ namespace, name, arguments: args }) {
  return [{ id: `fc_${randomUUID()}`, type: 'function_call', status: 'completed', call_id: `call_${randomUUID()}`,
    ...(namespace ? { namespace } : {}), name, arguments: JSON.stringify(args) }];
}
function collabCall(body, label, name, args) {
  const namespace = body.tools.find(tool => tool.type === 'namespace' && tool.tools?.some(nested => nested.name === name));
  assert.ok(namespace, `${label}_${name}_NOT_ADVERTISED`);
  return functionCall({ namespace: namespace.name, name, arguments: args });
}
function toolCall(body, label, suffix, args) {
  const flat = body.tools.find(tool => tool.name?.endsWith(suffix));
  if (flat) return functionCall({ name: flat.name, arguments: args });
  const namespace = body.tools.find(tool => tool.type === 'namespace' && tool.tools?.some(nested => nested.name === suffix));
  assert.ok(namespace, `${label}_${suffix}_NOT_ADVERTISED`);
  return functionCall({ namespace: namespace.name, name: suffix, arguments: args });
}
function send(res, output) {
  const response = { id: `resp_${randomUUID()}`, object: 'response', status: 'completed', model: 'fixture-model', output,
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const event = (type, fields) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`);
  event('response.created', { response: { ...response, status: 'in_progress', output: [] } });
  for (const [output_index, item] of output.entries()) {
    event('response.output_item.added', { output_index,
      item: item.type === 'function_call' ? { ...item, arguments: '' } : { ...item, content: [] } });
    if (item.type === 'function_call') event('response.function_call_arguments.done', { output_index, item_id: item.id, arguments: item.arguments });
    else {
      event('response.content_part.added', { output_index, item_id: item.id, content_index: 0,
        part: { type: 'output_text', text: '', annotations: [] } });
      event('response.output_text.delta', { output_index, item_id: item.id, content_index: 0, delta: item.content[0].text });
      event('response.output_text.done', { output_index, item_id: item.id, content_index: 0, text: item.content[0].text });
      event('response.content_part.done', { output_index, item_id: item.id, content_index: 0, part: item.content[0] });
    }
    event('response.output_item.done', { output_index, item });
  }
  event('response.completed', { response }); res.end('data: [DONE]\n\n');
}
function hold(label, res) {
  assert.equal(held.has(label), false);
  const row = { res, closed: false };
  held.set(label, row);
  res.once('close', () => { row.closed = true; });
}
