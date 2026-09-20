#!/usr/bin/env node
// F3 Stage B automatic real-native expiry stop through the production
// runHostedOwnerAlpha entrypoint. This closes the gap that
// scripts/test-codex-background-manager.mjs leaves open: that script proves the
// real Worker wake, staging, three-root isolation and dual-lock retirement, but
// its post-expiry custody transfer is the test's own explicit service.stop()
// (labeled explicit-stop there, unchanged). Here the real production wake
// listener (createHostedOwnerWakeService) accepts the real Worker alarm
// delivery, the real prepareHostedOwnerBackgroundManager continuation stages
// the session and holds the manager task, and the launch callback runs the
// ACTUAL runHostedOwnerAlpha entrypoint in-process over the ACTUAL
// createSpriteCodexService with a pinned pristine Codex 0.154.0 process. The
// production entrypoint's own expiry machinery — responsive maintain loop and
// the expiry+30s deadline timer — stops that real process. The test NEVER calls
// service.stop() on the success path; a test-owned stop only ever happens as
// failure cleanup and can never satisfy an assertion.
// The --pending-maintenance mode additionally proves the production expiry+30s
// backstop: after genuine maintenance and the observed canonical coordinator
// release through the durable journal, before expiry, the maintain
// instrumentation parks the entrypoint's own service.maintain() await on an
// explicit test-owned deferred (composition-seam fault injection, not live
// network-timeout evidence; the production timer, the real service and the
// real native process are never altered). While that await is pending, the
// timer itself must stop the real native executable; both observed PIDs
// disappear with no stopped report and no resolved entrypoint promise until
// the deferred is released, and releasing it lets the production finally
// finish idempotently with a second stop call, never a second launch.
// Seams are local and synthetic only: a loopback model server for the built-in
// openai client (zstd request bodies, SSE responses) routed through the
// supported openai_base_url session override, a synthetic chatgpt-shaped
// auth.json in the native home, a synthetic model catalog and feature flags
// through supported session-flag overrides (the launch floor's ordinary()
// contract rejects model_catalog_json in config.toml, so the catalog rides the
// session-flag seam exactly like the warm auto-stop fixture), a synthetic
// Sprite task-hold seam, and the authenticated Worker/SQLite Durable Object
// fixture with the real PersonalControl alarm + sendHostedWake path. No live
// account, model, provider, credentials, network spend or production flags.
// Honest limitations, never silently widened: the entrypoint runs in-process
// (the warm-established composition seam), so the real dual-lock launcher's
// separate setpriv'd process is not exercised here — that composition remains
// warm-manager/background-manager territory. The dual executor/session locks
// are nevertheless really acquired and held by the production manager
// continuation around its post-launch --inspect-locked readback
// (with-executor-lock.sh on the native home and the session directory, run as
// a real subprocess reading the FileJournal service row), which is the
// production retirement evidence path. Process exit is NOT descendant, tool or
// effect settlement; the held resident-child model request only proves a
// resident descendant was active before expiry. The background root never settles
// or completes; expiry leaves recovery-required unknown family custody, and no
// replay is possible (no second launch envelope; duplicate wake acknowledged
// without redelivery). One readback is staged for a reason that cannot be
// fixed at uid 1000: the launch floor reads root-owned /etc/codex paths, so
// tests/fixtures/warm-auto-stop-floor.mjs (reused read-only, not modified)
// stages exactly those floor reads and the single configRequirements/read
// reply. Every other verified byte — config/read layers, account/read,
// model/list and the native turn — comes from the real pinned process.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, readlink, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import { startHostedControlFixture } from '../tests/fixtures/hosted-control.mjs';
import { stagedLaunchFloor, STAGED_REQUIREMENTS_READBACK } from '../tests/fixtures/warm-auto-stop-floor.mjs';
import { ControlClient } from '../runtime/control-client.mjs';
import { createHostedOwnerWakeService } from '../runtime/hosted-owner-wake.mjs';
import { readOwnerAlphaConfig, runHostedOwnerAlpha } from '../runtime/owner-alpha-entry.mjs';
import { createSpriteCodexService } from '../runtime/sprites-codex-service.mjs';
import { backgroundProfileSha256 } from '../runtime/owner-alpha-background-binding.mjs';
import { spawnCodex } from '../runtime/codex-transport.mjs';
import { PINNED_CODEX } from '../runtime/codex-adapter.mjs';

const pendingMaintenance = process.argv.includes('--pending-maintenance');
const ROUTINE_MANAGE_POLICY = 'f0ff3ead-1e31-4f83-bbc2-aa25f069a962';
// Matches the PROVIDER_TOKEN binding the hosted fixture pins for the background
// wake destination; the production wake delivery carries exactly this bearer.
const syntheticProviderToken = 'synthetic-provider-' + 'p'.repeat(40);
const persona = '11111111-1111-4111-8111-111111111111';
const marker = value => `OWNER_BACKGROUND_${value}`;
const textA = `${marker('ROOT_A')} Coordinate the household quietly and delegate exactly one resident child task.`;
const replyA = `${marker('A_FINAL')} Background root turn complete; the resident child keeps working.`;
const routineName = 'Fixture routine ledger sweep';
const pause = ms => new Promise(ok => setTimeout(ok, ms));
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const alive = pid => {
  if (!Number.isInteger(pid)) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
};
// Synthetic chatgpt-shaped auth: fixture-only JWTs, never a live credential.
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const issuedAt = Math.floor(Date.now() / 1000);
const jwt = extra => [b64({ alg: 'RS256', typ: 'JWT' }),
  b64({ sub: 'auth0|synthetic', aud: 'https://api.openai.com/v1', iat: issuedAt, exp: issuedAt + 3600, ...extra }),
  'c2ln'].join('.');
const accessToken = jwt({});
const syntheticAuth = {
  OPENAI_API_KEY: null,
  tokens: { id_token: jwt({ email: 'synthetic@localhost', chatgpt_account_id: 'synthetic-account' }),
    access_token: accessToken, refresh_token: 'synthetic-refresh', account_id: 'synthetic-account' },
  last_refresh: new Date().toISOString(),
};
// Everything stays under the repository's private .local tree: the launch floor
// rejects /tmp ancestors (mode 1777) and requires uid-owned 0700 paths.
const directory = await mkdtemp(join(resolve('.local'), 'background-auto-stop-'));
const report = { status: 'failed', mode: pendingMaintenance ? 'pending-maintenance-backstop' : 'automatic-expiry-real-native',
  nativeStarts: 0, modelPosts: [], modelGets: 0, spriteRequests: [], taskNames: [], maintains: 0, stopCalls: [], events: [], eventTimes: [],
  maintainLog: [], controlRejections: [], toolCatalogs: {},
  dualLocksProved: false, descendantSettlementProved: false, effectSettlementProved: false };
const counts = {};
const modelHeld = new Map(), spriteHeld = new Map(), taskNames = report.taskNames;
let fixture, model, listener, serviceRef, managerClient, testOwnedStop = false;
let nativePid, nativeExecutablePid, nativeExit, pidAliveAtReady, readyAt, modelError, launchError;
let runExpiryAt = 0, runGraceAt = 0;
const watchdog = setTimeout(() => {
  report.watchdog = 'script exceeded 330s; failure cleanup stops the disposable native process';
  for (const pid of [nativeExecutablePid, nativePid]) {
    try { if (alive(pid)) process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
}, 330000);
const withDeadline = (promise, timeoutMs, message) => {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};
// Disposable Sprite seam: the manager task hold and the activity guard both
// ride it; every hold and confirmation is recorded for exact-sequence asserts.
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
      spriteHeld.set(name, { name, expires_at: new Date(Date.now() + JSON.parse(data).expire * 1000).toISOString() });
    } else assert.equal(options.method, 'GET');
    const response = new EventEmitter(); response.statusCode = 200; callback(response);
    response.emit('data', Buffer.from(JSON.stringify(options.method === 'GET' ? spriteHeld.get(name) : {}))); response.emit('end');
  };
  return request;
};
const waitFor = async (probe, timeoutMs) => {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) { if (await probe()) return true; await pause(200); }
  return false;
};
try {
  const home = join(directory, 'native-home'), sessionsDirectory = join(directory, 'sessions');
  await mkdir(home, { mode: 0o700 }); await mkdir(sessionsDirectory, { mode: 0o700 });
  const binary = resolve('.local/codex-runtime/node_modules/.bin/codex');
  const version = await promisify(execFile)(binary, ['--version'], { timeout: 10000 });
  assert.equal(version.stdout.trim(), 'codex-cli 0.154.0');
  const epochOneBoot = randomUUID();
  const backgroundProfile = { profile_version: 'codex-background-v2-restricted-v1', profile_sha256: hash('synthetic-background-profile'),
    max_resident_child_threads: 2, wait_agent_enabled: false, multi_agent_v1: false };
  const originalPolicy = { session_id: randomUUID(), persona_id: persona,
    expires_at: new Date(Date.now() - 120000).toISOString(), max_runs: 1, max_task_seconds: 30 };
  const ownerBinding = hash({ auth_mode: 'access', installation_id: 'hosted-fixture',
    issuer: 'https://synthetic.cloudflareaccess.com', audience: 'fixture-audience', owner_subject: 'fixture-owner' });
  // Fixed generation window: the production entrypoint requires expiry in
  // (now, now+300000]; 150s leaves room for the real Worker alarm delivery,
  // native boot and the resident-child turn before the frozen expiry.
  const backgroundConfig = { schema_version: 1, kind: 'owner-alpha-background-generation-v1', installation_id: 'hosted-fixture',
    owner_id: 'fixture-owner', owner_binding_sha256: ownerBinding, policy_revision: 'background-stage-b-v1', persona_id: persona,
    background: backgroundProfile, expires_at: new Date(Date.now() + 150000).toISOString(), max_task_seconds: 300,
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
    background: { generation: backgroundConfig, token: managerToken, hostSigningKey, taskSigningKey, wakeToken } });
  await fixture.retirePredecessor(epochOneBoot);
  managerClient = new ControlClient({ origin: fixture.origin, token: managerToken, principal: 'background-manager',
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
  const command = (type, payload) => ({ method: 'POST', headers: { ...ownerHeaders,
    Origin: fixture.origin, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ schema_version: 1, type, payload }) });
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

  // Passive reads stage nothing: no launch envelope, no sprite hold, no native
  // start, no wake, no staged session.
  const summary = (await readState()).summary;
  assert.deepEqual(summary.owner_alpha_background, { schema_version: 1, kind: 'owner-alpha-background-summary-v1',
    policy_revision: 'background-stage-b-v1', persona_id: persona, policy_expires_at: backgroundConfig.expires_at,
    max_admissions: 3, admissions_used: 0, message_admission_available: true, next_role: 'background', generation: null });
  assert.equal(await managerClient.request('generation', {}), null, 'passive generation read staged work');
  assert.equal(report.nativeStarts, 0); assert.equal(report.modelPosts.length, 0);
  assert.deepEqual(report.spriteRequests, []); assert.deepEqual(await readdir(sessionsDirectory), []);
  assert.deepEqual(fixture.backgroundWakeDeliveries, [], 'a passive read delivered a background wake');

  // Arrange the production wake listener and the manager template exactly as
  // the background-manager script stages them; only the launch callback
  // differs — it runs the real entrypoint in-process instead of the separate
  // setpriv'd launcher process.
  const accessClientIdFile = join(directory, 'access-id'), accessClientSecretFile = join(directory, 'access-secret');
  await writeFile(accessClientIdFile, accessClientId, { mode: 0o600 });
  await writeFile(accessClientSecretFile, accessClientSecret, { mode: 0o600 });
  const template = { stateDirectory: join(directory, 'unused-state'), nativeHome: home,
    binary, portalOrigin: fixture.origin,
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

  // The launch callback runs inside the real wake callback. Every expectation
  // derives from the immutable staged config plus independent durable reads,
  // never from main-flow bindings (the background-manager discipline).
  const launchImpl = async (path, { expectedSha256 } = {}) => {
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
    const hostTokenBytes = await readFile(config.runtimeTokenFile);
    assert.equal((await stat(config.runtimeTokenFile)).mode & 0o777, 0o600, 'host token is not owner-only');
    assert.ok(!JSON.stringify(config).includes(hostTokenBytes.toString('utf8')), 'raw host token entered the child configuration');
    assert.deepEqual(await readdir(sessionsDirectory), [config.ownerAlphaGeneration.transition_id]);
    assert.deepEqual(report.spriteRequests.slice(0, 2), ['PUT', 'GET'], 'background manager hold must precede launch');
    assert.equal(taskNames[0], `hehe-background-${config.ownerAlphaGeneration.transition_id}`, 'manager hold used another task identity');
    assert.equal(report.nativeStarts, 0, 'native started before the manager handed over');
    const expiryAt = Date.parse(config.ownerAlpha.expires_at);
    const graceAt = expiryAt + 30000;
    runExpiryAt = expiryAt; runGraceAt = graceAt;
    assert.ok(expiryAt - Date.now() > 60000, 'staging consumed too much of the fixed generation window');

    // Loopback model server for the built-in openai client: zstd POST bodies,
    // SSE replies, the same restricted V2 background script as the
    // background-manager fixture (root spawns exactly one resident child and
    // never settles; the child's model request is held open, proving a live
    // resident descendant at expiry without ever claiming its settlement).
    model = createServer(async (request, response) => {
      try {
        const chunks = []; let bytes = 0;
        for await (const chunk of request) { assert.ok((bytes += chunk.length) <= 2 * 1024 * 1024); chunks.push(chunk); }
        const raw = Buffer.concat(chunks);
        // The pristine client also sends harmless GET probes; they get a plain 404.
        if (request.method === 'GET' && !raw.length) {
          report.modelGets++;
          response.writeHead(404, { 'content-type': 'application/json' }); response.end('{}'); return;
        }
        assert.equal(request.method, 'POST');
        assert.equal(request.url, '/v1/responses');
        assert.ok(raw.length, 'empty model request');
        const body = JSON.parse(request.headers['content-encoding'] === 'zstd' ? zstdDecompressSync(raw) : raw);
        assert.ok(report.modelPosts.length < 20, 'unexpected model request flood');
        assert.equal(body.model, 'fixture-model'); assert.equal(body.stream, true);
        assert.equal(request.headers.authorization, `Bearer ${accessToken}`, 'the native model call did not use the synthetic account seam');
        const catalog = names(body);
        assert.ok(!catalog.some(name => /web_search|image_generation|tool_suggest/.test(name)), 'DISABLED_PROVIDER_SURFACE');
        assert.ok(!catalog.some(name => /(^|\.)sleep$/.test(name)), 'SLEEP_TOOL_ADVERTISED');
        assert.ok(!catalog.some(name => /wait_agent|close_agent|send_input|resume_agent/.test(name)), 'LEGACY_OR_WAIT_TOOL_ADVERTISED');
        const text = JSON.stringify(body.input.filter(item => item.role === 'user' || item.type === 'agent_message' || item.type === 'user_message'));
        const label = ['CHILD_A', 'ROOT_A'].find(value => text.includes(marker(value)));
        assert.ok(label, 'UNKNOWN_SCRIPTED_REQUEST');
        counts[label] = (counts[label] ?? 0) + 1;
        report.modelPosts.push({ at: Date.now(), label, contentEncoding: request.headers['content-encoding'] ?? null });
        report.toolCatalogs[label] = catalog;
        if (label === 'ROOT_A') {
          assert.ok(text.includes(textA), 'background root prompt lost its own instruction');
          for (const name of ['spawn_agent', 'send_message', 'followup_task', 'interrupt_agent', 'list_agents'])
            assert.ok(catalog.includes(`collaboration.${name}`), `ROOT_A_V2_TOOL_MISSING_${name}`);
          if (counts.ROOT_A === 1) {
            send(response, collabCall(body, 'spawn', 'spawn_agent',
              { task_name: 'child_a', message: marker('CHILD_A'), fork_turns: 'none' }));
          } else {
            assert.equal(counts.ROOT_A, 2, 'unexpected third background root model request');
            const output = body.input.filter(item => item.type === 'function_call_output').at(-1)?.output ?? '';
            assert.ok(output.includes('child_a'), 'spawn result absent from the second background root request');
            report.spawnResult = output;
            send(response, message(replyA));
          }
          return;
        }
        assert.equal(label, 'CHILD_A');
        assert.equal(counts.CHILD_A, 1, 'unexpected second resident child request');
        hold('CHILD_A', response);
      } catch (error) { modelError = error; response.destroy(); }
    });
    await new Promise(ok => model.listen(0, '127.0.0.1', ok));

    // Diagnostic evidence capture (test-owned, read-only): every non-OK
    // control response body is retained so the exact Worker-side rejection
    // (the expiry fence) stays provable.
    const controlFetch = async (url, init) => {
      const response = await fixture.fetchImpl(url, init);
      if (!response.ok) {
        const clone = response.clone();
        let body = null;
        try { body = JSON.parse(await clone.text()); } catch { body = '<unparseable>'; }
        report.controlRejections.push({ at: Date.now(), path: new URL(String(url)).pathname, status: response.status, body });
      }
      return response;
    };
    // The synthetic account seam plus an ordinary() floor-legal home config.
    // The model catalog and every feature switch ride the supported session
    // flag seam on the launch seam below: the launch floor's ordinary()
    // contract rejects model_catalog_json and analytics/feedback sections in
    // config.toml, and sessionFlags layers are exempt from floor verification.
    const prepareNative = async nativeHome => {
      await writeFile(join(nativeHome, 'auth.json'), JSON.stringify(syntheticAuth), { mode: 0o600 });
      await writeFile(join(nativeHome, 'fixture-models.json'), JSON.stringify({ models: [{ slug: 'fixture-model',
        display_name: 'Synthetic V2 fixture', description: null, supported_reasoning_levels: [], shell_type: 'unified_exec',
        visibility: 'list', supported_in_api: true, priority: 1, upgrade: null,
        model_messages: { instructions_template: 'Synthetic credential-free native fixture.', instructions_variables: null },
        default_reasoning_summary: 'auto', support_verbosity: false, default_verbosity: null, apply_patch_tool_type: null,
        truncation_policy: { mode: 'bytes', limit: 10000 }, supports_image_detail_original: false, context_window: 272000,
        auto_compact_token_limit: null, effective_context_window_percent: 95, experimental_supported_tools: [],
        multi_agent_version: 'v2' }] }), { mode: 0o600 });
      await writeFile(join(nativeHome, 'config.toml'),
        'model = "fixture-model"\nmodel_provider = "openai"\n', { mode: 0o600 });
    };
    const journalDir = join(config.stateDirectory, 'journal');
    const journalRows = async () => {
      let files;
      try { files = await readdir(journalDir); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
      const rows = [];
      for (const name of files) {
        if (!name.endsWith('.json')) continue;
        const row = JSON.parse(await readFile(join(journalDir, name), 'utf8'));
        rows.push(row, ...(Array.isArray(row.families) ? row.families : []));
      }
      return rows;
    };
    const aReleased = () => journalRows().then(rows => rows.some(row =>
      row.claim?.run?.id === manifestRow.value.run_id && row.coordinatorRelease?.acknowledged === true));
    let releaseObservedAt = null, maintenanceDeferred = null, maintenanceLatchedAt = 0, maintenanceReleasedAt = 0;
    let tokenA = null;
    // The real entrypoint: its maintain loop, expiry fence and expiry+30s
    // deadline timer perform every stop. The test only observes.
    let runError = null, runSettled = false;
    const runPromise = runHostedOwnerAlpha(config, {
      report: value => {
        report.events.push(value);
        report.eventTimes.push({ at: Date.now(), event: value.event });
        if (value.event === 'owner-alpha.ready') { readyAt = Date.now(); pidAliveAtReady = alive(nativePid); }
      },
      launchFloor: stagedLaunchFloor,
      launch: options => {
        report.nativeStarts++;
        assert.equal(report.nativeStarts, 1, 'the entrypoint launched a second native process');
        assert.equal(options.home, home);
        assert.equal(options.cwd, join(config.stateDirectory, 'workspace'));
        assert.equal(options.binary, binary);
        const transport = spawnCodex({ ...options, configOverrides: { ...options.configOverrides,
          openai_base_url: `http://127.0.0.1:${model.address().port}/v1`,
          model_catalog_json: join(home, 'fixture-models.json'),
          web_search: 'disabled',
          'agents.enabled': false,
          'features.multi_agent': false,
          'features.multi_agent_v2': false,
          'features.apps': false,
          'features.tool_suggest': false,
          'features.image_generation': false,
          'features.standalone_web_search': false,
          'features.token_budget': false,
          'features.sleep_tool': false,
          'features.request_permissions_tool': false,
          'features.exec_permission_approvals': false } });
        // PID and exit evidence through the supported transport child handle.
        nativePid = transport.child.pid;
        transport.child.once('exit', (code, signal) => { nativeExit ??= { code, signal, at: Date.now() }; });
        // The one staged readback: root-owned /etc/codex cannot exist at uid 1000.
        const request = transport.request.bind(transport);
        transport.request = (method, params) => method === 'configRequirements/read'
          ? Promise.resolve(STAGED_REQUIREMENTS_READBACK) : request(method, params);
        return transport;
      },
      createService: (captured, dependencies) => {
        assert.deepEqual(captured.ownerAlphaGeneration, config.ownerAlphaGeneration);
        assert.deepEqual(captured.ownerAlphaBackground, config.ownerAlphaBackground);
        assert.deepEqual(captured.ownerAlpha, config.ownerAlpha);
        const service = createSpriteCodexService(captured, { ...dependencies, spriteRequest,
          fetchImpl: controlFetch, prepareNative });
        serviceRef = service;
        // The transport child is the npm launcher, not its native executable.
        // Observe the actual pinned executable while alive, then require both
        // PIDs to disappear after the production stop. Not a descendant census.
        const start = service.start.bind(service);
        service.start = async () => {
          const value = await start();
          assert.equal(value.claim.run.id, manifestRow.value.run_id, 'the entrypoint claimed another run');
          assert.equal(value.claim.role, 'background');
          assert.equal(value.claim.owner_alpha_background, true);
          assert.equal(value.claim.manifest.admission, 1);
          tokenA = await readFile(value.claim.task_credential.token_file);
          assert.equal((await stat(value.claim.task_credential.token_file)).mode & 0o777, 0o600, 'task token file is not owner-only');
          const processes = execFileSync('ps', ['-eo', 'pid=,ppid=,comm='], { encoding: 'utf8' })
            .trim().split('\n').map(line => {
              const [pid, ppid, name] = line.trim().split(/\s+/);
              return { pid: Number(pid), ppid: Number(ppid), name };
            });
          const children = processes.filter(item => item.ppid === nativePid && item.name === 'codex');
          assert.equal(children.length, 1, 'expected exactly one Codex executable under the npm launcher');
          nativeExecutablePid = children[0].pid;
          const executable = await readlink(`/proc/${nativeExecutablePid}/exe`);
          assert.ok(executable.startsWith(resolve('.local/codex-runtime') + '/') && executable.endsWith('/codex'),
            'observed child is not the pinned native executable');
          assert.equal(alive(nativeExecutablePid), true);
          report.dispatchedClaim = { run: value.claim.run.id, role: value.claim.role, admission: value.claim.manifest.admission };
          return value;
        };
        // Records only; the production stop path is never altered. In
        // pending-maintenance mode this is also the composition seam: after
        // genuine maintenance, the observed canonical coordinator release and
        // several sustained reconciliations, before expiry, the entrypoint's
        // own maintain await parks on an explicit test-owned deferred. The real
        // service and the real native process stay fully intact; the
        // production expiry+30s deadline timer must then stop the real native
        // executable on its own while that await is pending.
        const maintain = service.maintain.bind(service);
        service.maintain = async () => {
          report.maintains++;
          try {
            const value = await maintain();
            if (pendingMaintenance && !maintenanceDeferred && releaseObservedAt !== null && report.maintains >= 3
              && Date.now() < expiryAt - 2000) {
              maintenanceLatchedAt = Date.now();
              maintenanceDeferred = Promise.withResolvers();
            }
            if (maintenanceDeferred) await maintenanceDeferred.promise;
            return value;
          } catch (error) {
            report.maintainLog.push({ at: Date.now(), code: error.code ?? error.name });
            throw error;
          }
        };
        const stop = service.stop.bind(service);
        service.stop = () => { report.stopCalls.push(Date.now()); return stop(); };
        return service;
      },
    });
    runPromise.then(() => { runSettled = true; }, error => { runError = error; runSettled = true; });

    // Observe the canonical A turn completion through the durable journal (the
    // coordinator release), never through main-flow bindings, with the
    // resident child still active.
    const released = await waitFor(async () => !modelError && counts.ROOT_A === 2
      && modelHeld.has('CHILD_A') && await aReleased(), 120000);
    if (modelError) throw modelError;
    assert.ok(released, 'TIMEOUT_A_COORDINATOR_RELEASE');
    releaseObservedAt = Date.now();
    assert.ok(modelHeld.get('CHILD_A') && modelHeld.get('CHILD_A').closed === false,
      'resident child not active through the coordinator release');

    // Idempotent replay of the exact delivered wake body to the production
    // listener is acknowledged duplicate without a second launch, hold or
    // POST — observed mid-callback, before the run settles.
    const wakeReplay = await fetch(`http://127.0.0.1:${listener.address().port}/wake`, { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hehe-wake-token': wakeToken },
      body: JSON.stringify({ epoch: config.ownerAlphaGeneration.epoch, operationId: config.ownerAlphaGeneration.transition_id }),
      signal: AbortSignal.timeout(15000) });
    assert.equal(wakeReplay.status, 202, `wake replay body: ${await wakeReplay.clone().text().catch(() => '<unreadable>')}`);
    assert.deepEqual(await wakeReplay.json(), { accepted: true, epoch: config.ownerAlphaGeneration.epoch, duplicate: true });
    assert.equal(fixture.backgroundWakeDeliveries.length, 1, 'wake replay reached the Worker outbound path again');
    assert.equal(report.nativeStarts, 1, 'wake replay launched a second native process');
    report.wakeReplayDuplicate = true;
    // Negative authority while the generation is still inside its frozen
    // deadline: retirement is premature and the Worker refuses it.
    await assert.rejects(() => managerClient.request('retirement', { epoch: config.ownerAlphaGeneration.epoch,
      boot_id: config.ownerAlphaGeneration.boot_id, session_id: config.ownerAlpha.session_id,
      transition_id: config.ownerAlphaGeneration.transition_id, observed_at: new Date().toISOString(),
      direct_child_stopped: true, execution_lock_free: true, session_lock_free: true,
      source: 'background-auto-stop:premature-observation' }),
      error => error.code === 'CONTROL_HTTP_ERROR' && error.status === 422, 'premature retirement was accepted');
    report.prematureRetirementRefused = true;

    if (pendingMaintenance) {
      // Wait for the maintain latch: genuine maintenance, the observed
      // coordinator release, and comfortably before expiry, with both PIDs
      // alive and the resident child's model request still open.
      const latched = await waitFor(() => !!maintenanceDeferred, Math.max(1000, expiryAt - 2000 - Date.now()));
      assert.ok(maintenanceDeferred, 'the pending-maintenance latch never engaged before expiry');
      assert.ok(report.maintains >= 3, 'the maintain latch engaged without genuine sustained maintenance');
      assert.ok(releaseObservedAt < maintenanceLatchedAt, 'the maintain latch engaged before the observed coordinator release');
      assert.ok(maintenanceLatchedAt < expiryAt - 2000, 'the maintain latch engaged too close to expiry');
      assert.equal(alive(nativePid), true, 'the npm launcher was not alive while maintenance was pending');
      assert.equal(alive(nativeExecutablePid), true, 'the native executable was not alive while maintenance was pending');
      assert.equal(modelHeld.get('CHILD_A').closed === false, true, 'the resident child request closed while maintenance was pending');
      // While the entrypoint's maintain await stays parked on the deferred,
      // the production expiry+30s deadline timer must itself stop the real
      // native process. Real bounded time; the timer is production code and is
      // never altered or fired by the test.
      let executableAliveBeforeBackstop = null;
      const observationDeadline = graceAt + 15000;
      while (Date.now() < observationDeadline) {
        if (Date.now() < graceAt && alive(nativeExecutablePid)) executableAliveBeforeBackstop = Date.now();
        if (report.stopCalls.length >= 1 && nativeExit && !alive(nativePid) && !alive(nativeExecutablePid)) break;
        assert.equal(runSettled, false, 'the entrypoint promise settled while the deferred was still unresolved');
        await pause(250);
      }
      assert.ok(executableAliveBeforeBackstop !== null,
        'the native executable was never observed alive before the backstop fired');
      assert.equal(report.stopCalls.length, 1,
        `expected exactly the timer-owned stop while the await was pending: ${JSON.stringify(report.stopCalls)}`);
      assert.ok(report.stopCalls[0] >= graceAt, 'the backstop stop ran before the expiry+30s boundary');
      assert.ok(report.stopCalls[0] <= graceAt + 5000, 'the backstop stop ran beyond bounded scheduling tolerance');
      assert.ok(nativeExit, 'the native exit was never observed through the transport child handle');
      assert.ok(nativeExit.at >= report.stopCalls[0], 'the native process exited before the timer-owned stop call');
      assert.throws(() => process.kill(nativePid, 0), error => error.code === 'ESRCH',
        'the npm launcher still exists at the backstop while the await is pending');
      assert.throws(() => process.kill(nativeExecutablePid, 0), error => error.code === 'ESRCH',
        'the native executable still exists at the backstop while the await is pending');
      assert.deepEqual(report.events.map(value => value.event), ['owner-alpha.ready'],
        'a stopped report appeared before the pending await was released');
      assert.equal(modelHeld.get('CHILD_A').closed, true,
        'the resident child model request did not close with the native executable at the backstop');
      // Only now release the deferred: the production finally finishes
      // idempotently with a second stop call, never a second launch.
      maintenanceReleasedAt = Date.now();
      maintenanceDeferred.resolve();
      const finished = await waitFor(() => runSettled, 30000);
      assert.ok(finished, 'the production finally never finished after the deferred was released');
      report.pendingMaintenanceObserved = { latchedAt: maintenanceLatchedAt, releasedAt: maintenanceReleasedAt,
        backstopStopAt: report.stopCalls[0] };
    } else {
      // Normal mode: responsive maintenance meets the real Worker's expiry
      // fence and the production finally performs the automatic stop around
      // expiry; the expiry+30s timer is the backstop that may also own the
      // stop if the fence beat stays responsive through expiry.
      const finished = await waitFor(() => runSettled, Math.max(1000, graceAt + 60000 - Date.now()));
      assert.ok(finished, 'the entrypoint run never settled within its bounded window');
    }
    if (modelError) throw modelError;
    assert.ok(!testOwnedStop, 'the test itself stopped the service on the success path');
    assert.equal(report.nativeStarts, 1);
    assert.ok(Number.isInteger(nativePid), 'native PID was never captured through the transport handle');
    assert.ok(Number.isInteger(nativeExecutablePid), 'native executable PID was never observed');
    assert.equal(pidAliveAtReady, true, 'native PID was not alive when the entrypoint reported ready');
    assert.ok(nativeExit, 'native exit was never observed through the transport child handle');
    assert.ok(nativeExit.code !== null || nativeExit.signal !== null, 'observed native exit has no code and no signal');
    assert.throws(() => process.kill(nativePid, 0), error => error.code === 'ESRCH',
      'the npm launcher still exists after the entrypoint returned');
    assert.throws(() => process.kill(nativeExecutablePid, 0), error => error.code === 'ESRCH',
      'the native executable still exists after the entrypoint returned');
    assert.ok(readyAt < expiryAt, 'the entrypoint reported ready only after expiry');
    // Which production path owned the stop — the expiry fence (responsive
    // maintenance) or the expiry+30s deadline timer — is recorded honestly.
    const eventNames = report.events.map(value => value.event);
    if (pendingMaintenance) {
      assert.equal(report.stopCalls.length, 2,
        `expected the timer stop plus the idempotent finally stop: ${JSON.stringify(report.stopCalls)}`);
      assert.ok(report.stopCalls[1] >= maintenanceReleasedAt, 'the finally stop ran before the deferred was released');
      assert.ok(report.stopCalls[1] < graceAt + 60000, 'the finally stop ran unboundedly late after the backstop');
    } else {
      // Normal mode. Two honest production stop paths exist: the responsive
      // maintain loop hits the real Worker's expiry fence (its maintain throws
      // a fenced code, owner-alpha.failed reports, the finally stops once), or
      // maintenance stays responsive through expiry and the production
      // expiry+30s deadline timer owns the stop, followed by the finally's own
      // idempotent stop. Which path fired is recorded, never assumed.
      if (report.stopCalls.length === 1) {
        assert.ok(report.stopCalls[0] >= expiryAt - 1500, 'a production stop ran before the expiry fence window opened');
        assert.ok(report.stopCalls[0] <= graceAt + 5000, 'the automatic stop ran beyond the expiry+30s backstop tolerance');
        // The supervisor may fence the phase before the entrypoint's own
        // maintain throws: a clean loop exit also reaches this single finally.
        assert.ok(eventNames.length === 2 || eventNames.length === 3);
      } else if (report.stopCalls.length === 2) {
        assert.ok(report.stopCalls[0] >= graceAt, `the first stop was not the expiry+30s deadline timer: ${JSON.stringify(report.stopCalls)}`);
        assert.ok(report.stopCalls[0] <= graceAt + 5000, 'the deadline timer fired beyond bounded scheduling tolerance');
        assert.ok(report.stopCalls[1] >= report.stopCalls[0], 'the finally stop preceded the timer stop');
        assert.ok(report.stopCalls[1] < graceAt + 60000, 'the finally stop ran unboundedly late after the deadline timer');
        assert.equal(eventNames.length, 2, 'a deadline-timer stop with a fenced failed report');
      } else assert.fail(`unexpected production stop call count: ${JSON.stringify(report.stopCalls)}`);
    }
    assert.ok(nativeExit.at >= report.stopCalls[0], 'the native process exited before the first production stop call');
    assert.ok(Date.now() < graceAt + 60000, 'the run exceeded its bounded window');
    assert.ok(report.maintains >= (pendingMaintenance ? 3 : 10), 'the maintain loop never sustained reconciliation');
    // Bounded lifecycle observations only; expiry is not success or
    // settlement. Either the responsive loop ends at the expiry fence (its own
    // maintain throws a fenced code after owner-alpha.failed) or the
    // supervisor's scheduled maintenance recovers the service phase first and
    // the loop exits cleanly; in pending mode the parked maintain holds a
    // genuine completed value, so the released entrypoint always finishes
    // cleanly with a stopped report.
    assert.equal(eventNames[0], 'owner-alpha.ready');
    assert.equal(eventNames.at(-1), 'owner-alpha.stopped');
    const fencedCodes = ['CONTROL_HTTP_ERROR', 'EXECUTOR_FENCED', 'SERVICE_RECOVERY_REQUIRED'];
    if (pendingMaintenance) {
      assert.deepEqual(eventNames, ['owner-alpha.ready', 'owner-alpha.stopped']);
      assert.equal(runError, null, 'the released entrypoint rejected instead of finishing cleanly');
    } else {
      assert.ok(eventNames.length === 2 || eventNames.length === 3, `unexpected report sequence: ${JSON.stringify(eventNames)}`);
      if (eventNames.length === 3) {
        assert.equal(eventNames[1], 'owner-alpha.failed');
        assert.deepEqual(Object.keys(report.events[1]).sort(),
          ['code', 'event', 'operatorStopped', 'policyExpired', 'replayAllowed', 'stage']);
        assert.equal(report.events[1].stage, 'run');
        assert.ok(fencedCodes.includes(report.events[1].code), `unexpected fence code: ${report.events[1].code}`);
        assert.equal(report.events[1].operatorStopped, false);
        assert.equal(typeof report.events[1].policyExpired, 'boolean');
        assert.equal(report.events[1].replayAllowed, false);
        assert.ok(runError, 'a failed report was emitted without an entrypoint rethrow');
        assert.ok(fencedCodes.includes(runError.code), `unexpected rethrow code: ${runError.code}`);
        assert.equal(runError.code, report.events[1].code);
      } else assert.equal(runError, null, 'the entrypoint rethrew without a failed report');
    }
    assert.deepEqual(report.events.at(-1), { event: 'owner-alpha.stopped', stateRetained: true, settlementProved: false, replayAllowed: false });
    assert.equal(report.events[0].hosted, true);
    assert.equal(report.events[0].providerHold, true);
    assert.equal(report.events[0].productionEnabled, false);
    assert.equal(report.events[0].outputIsProvisional, true);
    assert.equal(report.events[0].session_id, config.ownerAlpha.session_id);
    assert.equal(report.events[0].expires_at, config.ownerAlpha.expires_at);
    // The canonical background turn completed through the real loopback model
    // seam before expiry; exactly the scripted three requests.
    assert.deepEqual(counts, { ROOT_A: 2, CHILD_A: 1 });
    assert.equal(report.modelPosts.length, 3);
    for (const post of report.modelPosts) {
      assert.equal(post.contentEncoding, 'zstd', 'the request did not come from the built-in openai client');
      assert.ok(post.at < expiryAt, 'a model request happened after the frozen expiry');
    }
    assert.ok(modelHeld.get('CHILD_A').closed, 'the resident child model request never closed');
    // Durable journal honesty: recovery custody, observed automatic native
    // stop, retained identity — and no completion or settlement claim.
    const stateDirectory = config.stateDirectory;
    const stoppedJournal = JSON.parse(await readFile(join(stateDirectory, 'journal', 'service.json'), 'utf8'));
    assert.equal(stoppedJournal.phase, 'recovery');
    assert.equal(stoppedJournal.nativeStopped, true);
    assert.deepEqual(stoppedJournal.ownerAlphaGeneration, config.ownerAlphaGeneration);
    assert.deepEqual(stoppedJournal.ownerAlphaBackground, config.ownerAlphaBackground);
    assert.deepEqual(stoppedJournal.ownerAlpha, config.ownerAlpha);
    assert.equal(stoppedJournal.hostedOwner.bindingSha256, config.hostedOwnerBindingSha256);
    // The exact task identity and its write-once task token never changed.
    const tokenANow = await readFile(join(stateDirectory, 'task-tokens', manifestRow.value.run_id));
    assert.equal(tokenANow.compare(tokenA), 0, 'the background root task credential changed');
    const journalFiles = (await readdir(join(stateDirectory, 'journal'))).map(name => readFile(join(stateDirectory, 'journal', name), 'utf8'));
    for (const journal of await Promise.all(journalFiles)) {
      assert.ok(!journal.includes(tokenA.toString('utf8')), 'raw task token leaked into the journal');
      assert.ok(!journal.includes(hostTokenBytes.toString('utf8')), 'raw host token leaked into the journal');
    }
    // The launcher-style result shape; resume() ignores the value, the CLI
    // main sets exitCode 1 when the entrypoint rethrows.
    return { code: runError ? 1 : 0, signal: null };
  };
  const launch = async (path, options) => {
    try { return await launchImpl(path, options); }
    catch (error) {
      launchError = error;
      // Failure cleanup only; never satisfies any assertion.
      testOwnedStop = true;
      try { await serviceRef?.stop(); } catch { /* disposable failure cleanup */ }
      for (const pid of [nativeExecutablePid, nativePid]) {
        try { if (alive(pid)) process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
      }
      throw error;
    }
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

  // The single admitted owner message of this generation: the background root.
  const requestA = command('message.send', { conversation_id: persona, text: textA });
  const receiptA = await (await fixture.fetchImpl('/v1/commands', requestA)).json();
  assert.equal(receiptA.status, 'applied');
  const rowsA = await fixture.backgroundRows();
  const generationRowMain = rowsA.find(row => row.key === 'owner_alpha_background_generation:2');
  const manifestRowMain = rowsA.find(row => row.key === 'owner_alpha_background_manifest:2:1');
  assert.ok(generationRowMain && manifestRowMain, 'first admission durable rows missing');
  assert.equal(manifestRowMain.value.run_id, receiptA.resource_id);
  assert.equal(generationRowMain.value.epoch, 2);
  // The real Durable Object alarm delivers the once-only wake intent through
  // the actual production sendHostedWake path.
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
    body: { epoch: 2, operationId: generationRowMain.value.transition_id } });
  assert.deepEqual(intent, { epoch: 2, boot_id: generationRowMain.value.boot_id,
    transition_id: generationRowMain.value.transition_id, status: 'queued' });
  // Exact-byte replay of the owner command admits nothing new.
  const replayA = await fixture.fetchImpl('/v1/commands', requestA);
  assert.equal(replayA.status, 202); assert.deepEqual(await replayA.json(), receiptA);
  assert.equal(fixture.backgroundWakeDeliveries.length, 1, 'replay delivered a second background wake');
  assert.deepEqual(await fixture.wakeIntent(), intent, 'replay touched the settled wake intent');

  // The real wake callback: staging, the real entrypoint run, the automatic
  // production stop, the real dual-lock --inspect-locked readback and the
  // retirement report. Nothing below this point can be satisfied by the test.
  const result = await withDeadline(wakeFinished, 360000, 'the background wake callback did not settle');
  if (launchError) throw launchError;
  assert.equal(result, 'RETIREMENT_REPORTED');
  // One native process/start for the whole generation.
  assert.equal(report.nativeStarts, 1, 'the background session started more than one native process');
  // The background root never settles: the production stop observation goes
  // through the Worker's honest unknown custody. A fenced, stopped root is
  // retained as recovery_required with OUTCOME_UNKNOWN — never completed,
  // failed or still-idle 'running'. Process exit is not settlement.
  const finalRuns = (await readState()).runs;
  const finalRoot = finalRuns.find(run => run.id === manifestRowMain.value.run_id);
  assert.equal(finalRoot?.status, 'recovery_required',
    'the background root completed, settled or was not retained in unknown recovery custody');
  // Both codes are honest production unknown-custody outcomes: OUTCOME_UNKNOWN
  // from the stop observation, STALE_EPOCH from the lease-expiry sweep. Neither
  // completes, fails or cancels the run; process exit is not settlement.
  assert.ok(finalRoot?.error_code === 'OUTCOME_UNKNOWN' || finalRoot?.error_code === 'STALE_EPOCH',
    `the fenced root did not retain unknown custody: ${finalRoot?.error_code}`);
  report.finalRoot = { id: finalRoot.id, status: finalRoot.status, error_code: finalRoot.error_code };
  // Immutable rows through the whole run; the retirement observation recorded.
  const retiredRows = await fixture.backgroundRows();
  assert.deepEqual(retiredRows.find(row => row.key === 'owner_alpha_background_generation:2').value, generationRowMain.value,
    'retirement rewrote the immutable generation descriptor');
  assert.deepEqual(retiredRows.find(row => row.key === 'owner_alpha_background_manifest:2:1').value, manifestRowMain.value,
    'the background admission manifest changed');
  const retirementRow = retiredRows.find(row => row.key === 'owner_alpha_retirement:2');
  assert.ok(retirementRow, 'manager retirement observation missing');
  assert.equal(retirementRow.value.epoch, 2);
  assert.equal(retirementRow.value.direct_child_stopped, true);
  assert.equal(retirementRow.value.execution_lock_free, true);
  assert.equal(retirementRow.value.session_lock_free, true);
  assert.equal(retirementRow.value.source, 'hosted-background-manager:file-journal-nativeStopped+dual-flock');
  report.dualLocksProved = true;
  // No replay: the retired generation yields no second launch envelope, and
  // the delivered wake stays single-delivery.
  assert.equal(await managerClient.request('generation', {}), null, 'the retired generation yielded a second envelope');
  assert.equal(fixture.backgroundWakeDeliveries.length, 1);
  // A distinct retirement observation conflicts with the manager's own
  // immutable recorded observation.
  await assert.rejects(() => managerClient.request('retirement', { epoch: 2, boot_id: generationRowMain.value.boot_id,
    session_id: generationRowMain.value.policy.session_id, transition_id: generationRowMain.value.transition_id,
    observed_at: new Date().toISOString(), direct_child_stopped: true, execution_lock_free: true,
    session_lock_free: true, source: 'background-auto-stop:distinct-observation' }),
    error => error.code === 'CONTROL_HTTP_ERROR' && error.status === 422,
    'distinct retirement observation was accepted; the manager observation was never recorded');
  // Holds and renewals only on the two expected task identities.
  assert.deepEqual(report.spriteRequests.slice(0, 4), ['PUT', 'GET', 'PUT', 'GET']);
  assert.ok(report.spriteRequests.every(method => method === 'PUT' || method === 'GET'),
    'unexpected sprite activity beyond holds and confirmations');
  assert.equal(report.taskNames[0], `hehe-background-${generationRowMain.value.transition_id}`);
  assert.equal(report.taskNames[1], `hehe-2-${generationRowMain.value.boot_id}`);
  assert.equal(new Set(report.taskNames).size, 2, 'sprite holds appeared for another task identity');
  // Worker outbound surface: only the Access certs read and the single wake POST.
  assert.deepEqual(fixture.outboundRequests.filter(request => request.method === 'POST'),
    [{ method: 'POST', url: 'https://synthetic-background.sprites.app/wake' }],
    'the background wake was not the single outbound POST');
  assert.ok(fixture.outboundRequests.every(request =>
    request.method === 'GET' && request.url.endsWith('/cdn-cgi/access/certs') ||
    request.method === 'POST' && request.url === 'https://synthetic-background.sprites.app/wake'));
  // Exact pinned version was verified before staging or native launch.
  report.codex = PINNED_CODEX;
  Object.assign(report, { status: 'passed', automaticStop: true, automaticStopAt: report.stopCalls[0],
    expiryAt: new Date(runExpiryAt).toISOString(), graceAt: new Date(runGraceAt).toISOString(),
    ...(pendingMaintenance
      ? { pendingMaintenance: true, graceBackstopFired: true, expiryFenceStop: false,
          pendingAwaitHeld: true, secondStopWasIdempotentFinally: true }
      : { expiryFenceStop: report.stopCalls[0] < runGraceAt,
          graceBackstopFired: report.stopCalls[0] >= runGraceAt }),
    transportPid: nativePid, nativeExecutablePid, nativeExecutableStopped: true,
    nativeExit: { code: nativeExit?.code, signal: nativeExit?.signal },
    retirementReported: true, dualLockRetirementInspect: true,
    backgroundRootNeverSettles: true, replayDidNotRelaunch: true, passiveReadsDidNotLaunch: true,
    noSecondEnvelope: true, productionEnabled: false, providerOrAccountVerified: false,
    realWorkerWakeDelivery: true, stagedReadbacks: ['configRequirements/read'] });
} catch (error) {
  report.error = error.code ?? error.name;
  report.message = error.message;
  report.frames = error.stack?.split('\n').filter(line => line.trimStart().startsWith('at '));
  if (error.cause) {
    report.cause = { code: error.cause.code ?? error.cause.name, message: error.cause.message,
      frames: error.cause.stack?.split('\n').filter(line => line.trimStart().startsWith('at ')) };
  }
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  listener?.stop();
  // Failure cleanup only. A test-owned stop never satisfies any assertion: the
  // success path above has already returned with the production stop proven.
  if (report.status !== 'passed') {
    testOwnedStop = true;
    try { await serviceRef?.stop(); } catch { /* disposable failure cleanup */ }
    for (const pid of [nativeExecutablePid, nativePid]) {
      try { if (alive(pid)) process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
    }
  }
  await fixture?.close().catch(() => {});
  if (model) { model.closeAllConnections(); await new Promise(ok => model.close(ok)); }
  if (report.status === 'passed') await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  else report.privateDiagnostics = directory;
  console.log(JSON.stringify(report, (key, value) => key === 'privateDiagnostics' && typeof value === 'string' ? '<disposable-local>' : value, 2));
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
function send(res, output) {
  const response = { id: `resp_${randomUUID()}`, object: 'response', created_at: 1, status: 'completed', error: null,
    incomplete_details: null, model: 'fixture-model', output, tools: [], tool_choice: 'auto', parallel_tool_calls: false,
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2,
      input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
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
  assert.equal(modelHeld.has(label), false);
  const row = { res, closed: false };
  modelHeld.set(label, row);
  res.once('close', () => { row.closed = true; });
}
