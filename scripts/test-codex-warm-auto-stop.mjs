#!/usr/bin/env node
// F3 automatic real-native shutdown verification: closes the gap between
// tests/runtime-owner-alpha-warm-entry.mjs (actual runHostedOwnerAlpha but a
// simulated service/native stop) and scripts/test-codex-warm-manager.mjs
// (real native but an explicit test-owned service.stop after expiry).
// This script runs the ACTUAL runHostedOwnerAlpha entrypoint over the ACTUAL
// createSpriteCodexService with a pinned pristine Codex 0.154.0 process and lets
// the production entrypoint stop that real process by itself at the frozen
// expiry. The test NEVER calls service.stop() on the success path; a stop that
// the test performs only ever happens as failure cleanup and can never satisfy
// an assertion. The supported transport child handle observes launcher exit;
// Linux process inspection separately attests the pinned native executable PID
// and its disappearance. Neither proves descendant, tool or effect settlement.
// Verified production behavior (empirically, against the real Worker): the
// warm host is fenced at the expiry boundary — the host credential's exp is
// floored to whole seconds, so the Worker rejects heartbeats from up to ~1s
// before the millisecond-precise expiry, and the lifecycle lease fence rejects
// them at/after expiry. With responsive maintenance, this fixture's loop ends at
// the expiry fence: either its own maintain throws (owner-alpha.failed with an
// unknown outcome — never a settlement claim) or the supervisor's scheduled
// maintenance recovers the service phase first and the loop condition exits
// cleanly. In both outcomes the production finally performs the automatic
// native stop around expiry, and the expiry+30s deadline timer is a backstop
// that does not fire in this run. Pending maintenance or account waits are not
// covered here; their independent backstop is tested by warm-entry's simulated
// service. No general claim that the backstop is unreachable is made.
// Seams are local and synthetic only: a loopback model server (the built-in
// openai client's zstd bodies) routed through the supported openai_base_url
// session override, a synthetic chatgpt-shaped auth.json in the native home, a
// synthetic Sprite task-hold seam, and the authenticated Worker/SQLite fixture
// with the real production PersonalControl alarm + sendHostedWake path. No live
// account, model, provider, credentials, network spend or production flags.
// The dual executor/session locks of the production dual-lock launcher are NOT
// proven here: the host boots in-process through the entrypoint's composition
// seam, so lock evidence remains warm-manager's explicit-post-expiry-stop
// verification. The manager wake-preparation/launch flow (session template,
// exclusive session staging, task hold hehe-warm-<transition>) is likewise
// warm-manager's territory; the wake listener here is the real production
// createSpritesWakeHandler acknowledging the real Worker alarm delivery.
// One readback is staged for a reason that cannot be fixed at uid 1000: the
// launch floor and the pristine process both read root-owned /etc/codex paths,
// which cannot exist in this sandbox. tests/fixtures/warm-auto-stop-floor.mjs
// stages exactly those floor reads for the real floor inspection, and the
// launch seam stages only the single configRequirements/read reply. Every
// other verified byte — config/read layers, account/read, model/list and the
// native turn — comes from the real pinned process.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { execFile, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import { startHostedControlFixture } from '../tests/fixtures/hosted-control.mjs';
import { stagedLaunchFloor, STAGED_REQUIREMENTS_READBACK } from '../tests/fixtures/warm-auto-stop-floor.mjs';
import { ControlClient } from '../runtime/control-client.mjs';
import { runHostedOwnerAlpha } from '../runtime/owner-alpha-entry.mjs';
import { createSpriteCodexService } from '../runtime/sprites-codex-service.mjs';
import { spawnCodex } from '../runtime/codex-transport.mjs';
import { createSpritesWakeHandler } from '../runtime/sprites-wake-service.mjs';
import { createCodexTextOnlyProfile, codexTextOnlyProfileSha256 } from '../runtime/codex-text-only.mjs';

const ROUTINE_MANAGE_POLICY = 'f0ff3ead-1e31-4f83-bbc2-aa25f069a962';
// Matches the warm-mode PROVIDER_TOKEN binding the hosted fixture pins; the
// production wake delivery must carry exactly this bearer on its one POST.
const syntheticProviderToken = 'synthetic-provider-' + 'p'.repeat(40);
const persona = '11111111-1111-4111-8111-111111111111';
const text1 = 'Remember the cobalt blue notebook, reference 47.';
const reply = 'The notebook is cobalt blue, reference 47.';
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
// Everything stays under the repository's private .local tree: the launch
// floor rejects /tmp ancestors (mode 1777) and requires uid-owned 0700 paths.
const directory = await mkdtemp(join(resolve('.local'), 'warm-auto-stop-'));
const report = { status: 'failed', mode: 'automatic-expiry-real-native', nativeStarts: 0, modelPosts: [], modelGets: 0,
  spriteRequests: [], taskNames: [], maintains: 0, stopCalls: [], events: [], eventTimes: [], maintainLog: [], controlRejections: [],
  dualLocksProved: false, descendantSettlementProved: false, effectSettlementProved: false };
let fixture, model, listener, serviceRef, managerClient, testOwnedStop = false;
let nativePid, nativeExecutablePid, nativeExit, pidAliveAtReady, readyAt, modelError, wakeHits = 0;
const watchdog = setTimeout(() => {
  report.watchdog = 'script exceeded 330s; failure cleanup stops the disposable native process';
  for (const pid of [nativeExecutablePid, nativePid]) {
    try { if (alive(pid)) process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
}, 330000);
try {
  const home = join(directory, 'native-home'), sessionsDirectory = join(directory, 'sessions');
  await mkdir(home, { mode: 0o700 }); await mkdir(sessionsDirectory, { mode: 0o700 });
  const binary = resolve('.local/codex-runtime/node_modules/.bin/codex');
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
  // Warm generation seed: the expired epoch-1 predecessor policy is retired
  // through the fixture surface exactly like warm-manager's staging.
  const originalPolicy = { session_id: randomUUID(), persona_id: persona, expires_at: new Date(Date.now() - 120000).toISOString(),
    max_runs: 1, max_task_seconds: 30, text_only };
  const epochOneBoot = randomUUID();
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
    text_only, expires_at: new Date(Date.now() + 150000).toISOString(), max_task_seconds: 30, max_admissions: 2,
    prior_cost_micro_usd: 1000, prior_cost_source: 'synthetic-baseline', total_cap_micro_usd: 10000000,
    reservation_micro_usd: 2000, seed_retirement: { epoch: 1, boot_id: epochOneBoot, session_id: originalPolicy.session_id,
      transition_id: null, observed_at: new Date(Date.now() - 60000).toISOString(), direct_child_stopped: true,
      execution_lock_free: true, session_lock_free: true, source: 'synthetic-warm-seed' } };
  fixture = await startHostedControlFixture({ directory: join(directory, 'control'), ownerAlpha: originalPolicy,
    runtimeToken, accessClientId, accessClientSecret,
    warm: { generation: warmConfig, token: managerToken, hostSigningKey, taskSigningKey, wakeToken } });
  await fixture.retirePredecessor(epochOneBoot);
  managerClient = new ControlClient({ origin: fixture.origin, token: managerToken, principal: 'warm-manager',
    accessClientId, accessClientSecret, fetchImpl: fixture.fetchImpl });
  const ownerHeaders = { 'Cf-Access-Jwt-Assertion': fixture.ownerJwt };
  const command = (type, payload) => ({ method: 'POST', headers: { ...ownerHeaders,
    Origin: fixture.origin, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ schema_version: 1, type, payload }) });
  const personaPut = await fixture.fetchImpl('/v1/commands', command('persona.put', { id: persona, expected_revision: 1,
    name: 'Chief of Staff', instructions: 'Coordinate the owner’s requests. Keep actions within explicit authorization.',
    tool_policy_ids: [ROUTINE_MANAGE_POLICY], archived: false }));
  assert.equal(personaPut.status, 202);
  assert.equal((await personaPut.json()).status, 'applied');

  // Arrange the real production wake listener before the first admission: the
  // Worker alarm delivers through sendHostedWake to the pinned synthetic Sprite
  // destination, which the fixture loopback-routes here. The no-op onWake is
  // documented above: manager wake preparation and launch are warm-manager's
  // verified flow; this script exercises the entrypoint's automatic stop.
  const wakeHandler = createSpritesWakeHandler({ token: wakeToken, onWake: () => {} });
  listener = createServer(async (request, response) => {
    if (request.method === 'POST' && request.url === '/wake') wakeHits++;
    await wakeHandler(request, response);
  });
  listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  fixture.setWarmWakeLoopback(`http://127.0.0.1:${listener.address().port}`);

  // Loopback model server for the built-in openai client. The pristine process
  // sends zstd-compressed POST bodies; harmless GET probes get a plain 404.
  model = createServer(async (request, response) => {
    try {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const raw = Buffer.concat(chunks);
      if (request.method !== 'POST' || request.url !== '/v1/responses' || !raw.length) {
        report.modelGets++;
        response.writeHead(404, { 'content-type': 'application/json' }); response.end('{}'); return;
      }
      const body = JSON.parse(request.headers['content-encoding'] === 'zstd' ? zstdDecompressSync(raw) : raw);
      report.modelPosts.push({ at: Date.now(), url: request.url, contentEncoding: request.headers['content-encoding'] ?? null,
        authorization: request.headers.authorization, model: body.model, tools: body.tools, input: JSON.stringify(body.input) });
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

  // The single admitted owner message of this generation.
  const response1 = await fixture.fetchImpl('/v1/commands', command('message.send', { conversation_id: persona, text: text1 }));
  assert.equal(response1.status, 202);
  const receipt1 = await response1.json();
  assert.equal(receipt1.status, 'applied');
  const rows1 = await fixture.warmRows();
  const rowsOf = (rows, suffix) => rows.filter(row => row.key.endsWith(suffix));
  const generationRow = rowsOf(rows1, 'owner_alpha_warm_generation:2')[0];
  const manifestRow = rowsOf(rows1, 'owner_alpha_warm_manifest:2:1')[0];
  assert.ok(generationRow && manifestRow, 'first admission durable rows missing');
  assert.equal(manifestRow.value.run_id, receipt1.resource_id);
  assert.equal(generationRow.value.epoch, 2);

  // The real production alarm path must complete before the host boots: the
  // once-only wake intent is queued only after the Worker read the listener's
  // authenticated 202 through the real sendHostedWake fetch.
  let intent = null;
  for (let tries = 0; tries < 120 && !(intent && intent.status === 'queued'); tries++) {
    intent = await fixture.wakeIntent();
    if (!(intent && intent.status === 'queued')) await pause(250);
  }
  assert.ok(intent, 'wake intent never formed');
  assert.equal(intent.status, 'queued', `wake delivery was never confirmed: ${JSON.stringify(intent)}`);
  assert.equal(fixture.warmWakeDeliveries.length, 1, 'the warm wake was not delivered exactly once');
  assert.deepEqual(fixture.warmWakeDeliveries[0], { method: 'POST', url: 'https://synthetic-warm.sprites.app/wake',
    headers: { authorization: `Bearer ${syntheticProviderToken}`, 'x-hehe-wake-token': wakeToken, 'content-type': 'application/json' },
    body: { epoch: 2, operationId: generationRow.value.transition_id } });
  assert.deepEqual(intent, { epoch: 2, boot_id: generationRow.value.boot_id,
    transition_id: generationRow.value.transition_id, status: 'queued' });

  // One launch envelope, byte-stable, read through the manager principal.
  const envelope = await managerClient.request('generation', {});
  assert.ok(envelope, 'no launch envelope while BOOTING');
  assert.equal(envelope.kind, 'owner-alpha-warm-launch-v1');
  assert.equal(envelope.generation.epoch, 2);
  assert.equal(envelope.generation.boot_id, generationRow.value.boot_id);
  assert.equal(envelope.generation.transition_id, generationRow.value.transition_id);
  assert.equal(envelope.generation.session_id, generationRow.value.policy.session_id);
  assert.equal(envelope.generation.policy.expires_at, generationRow.value.policy.expires_at);
  assert.equal(envelope.generation.policy.max_runs, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(envelope.generation.policy.text_only)), text_only);
  assert.deepEqual(await managerClient.request('generation', {}), envelope,
    'repeated launch-envelope reads did not reproduce the identical credential');

  // Build the host configuration exactly as the manager's resume continuation
  // does, derived from the envelope plus independent durable-row reads.
  const stateDirectory = join(sessionsDirectory, envelope.generation.transition_id);
  await mkdir(stateDirectory, { mode: 0o700 });
  const runtimeTokenFile = join(stateDirectory, 'host-token');
  await writeFile(runtimeTokenFile, envelope.host_credential.token, { mode: 0o600 });
  const accessClientIdFile = join(directory, 'access-id'), accessClientSecretFile = join(directory, 'access-secret');
  await writeFile(accessClientIdFile, accessClientId, { mode: 0o600 });
  await writeFile(accessClientSecretFile, accessClientSecret, { mode: 0o600 });
  const config = { stateDirectory, nativeHome: home, binary, portalOrigin: fixture.origin,
    installationId: 'hosted-fixture', hostedOwnerBindingSha256: fixture.ownerBindingSha256,
    runtimeTokenFile, accessClientIdFile, accessClientSecretFile, tlsCAFile: fixture.caFile,
    textOnlyProfile,
    ownerAlpha: { session_id: envelope.generation.session_id, persona_id: envelope.generation.policy.persona_id,
      expires_at: envelope.generation.policy.expires_at, max_runs: envelope.generation.policy.max_runs,
      max_task_seconds: envelope.generation.policy.max_task_seconds, text_only: envelope.generation.policy.text_only },
    ownerAlphaGeneration: { epoch: envelope.generation.epoch, boot_id: envelope.generation.boot_id,
      transition_id: envelope.generation.transition_id },
    ownerAlphaWarm: { generation_sha256: generationRow.value.authority.generation_sha256 },
    personas: { [persona]: { agentId: 'assistant', model: 'fixture-model', allowedTools: [] } } };
  assert.deepEqual(config.ownerAlphaGeneration, { epoch: generationRow.value.epoch,
    boot_id: generationRow.value.boot_id, transition_id: generationRow.value.transition_id });
  const configJson = JSON.stringify(config);
  assert.ok(!configJson.includes(envelope.host_credential.token), 'raw host token entered the child configuration');
  const expiryAt = Date.parse(config.ownerAlpha.expires_at);
  const graceAt = expiryAt + 30000;
  assert.ok(expiryAt - Date.now() > 60000, 'staging consumed too much of the fixed generation window');

  // Disposable Sprite seam: the hosted activity hold and its renewals only;
  // every hold and confirmation is recorded for exact-sequence asserts.
  const held = new Map();
  const spriteRequest = (options, callback) => {
    assert.equal(options.socketPath, '/.sprite/api.sock');
    assert.equal(options.host, 'sprite');
    assert.match(options.path, /^\/v1\/tasks\/[a-zA-Z0-9_-]+$/);
    report.spriteRequests.push(options.method);
    const request = new EventEmitter();
    request.setTimeout = () => {}; request.destroy = () => {};
    request.end = data => {
      const name = options.path.split('/').at(-1);
      if (options.method === 'PUT') {
        report.taskNames.push(name);
        held.set(name, { name, expires_at: new Date(Date.now() + JSON.parse(data).expire * 1000).toISOString() });
      } else assert.equal(options.method, 'GET');
      const response = new EventEmitter();
      response.statusCode = 200; callback(response);
      response.emit('data', Buffer.from(JSON.stringify(options.method === 'GET' ? held.get(name) : {}))); response.emit('end');
    };
    return request;
  };

  // Account seam: the synthetic chatgpt-shaped auth plus an ordinary() home
  // config selecting the built-in openai provider. The loopback model URL is
  // injected only through the supported openai_base_url session override.
  const prepareNative = async nativeHome => {
    await writeFile(join(nativeHome, 'auth.json'), JSON.stringify(syntheticAuth), { mode: 0o600 });
    await writeFile(join(nativeHome, 'config.toml'), 'model = "fixture-model"\nmodel_provider = "openai"\n', { mode: 0o600 });
  };

  // Diagnostic evidence capture (test-owned, read-only): every non-OK control
  // response body is retained so the exact Worker-side rejection stays provable.
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
  // The fenced outcome rethrows after its owner-alpha.failed report; the clean
  // outcome returns normally. Both are accepted production outcomes here.
  let runError = null;
  try {
    await runHostedOwnerAlpha(config, {
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
      assert.equal(options.cwd, join(stateDirectory, 'workspace'));
      assert.equal(options.binary, binary);
      const transport = spawnCodex({ ...options,
        configOverrides: { ...options.configOverrides,
          openai_base_url: `http://127.0.0.1:${model.address().port}/v1` } });
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
      assert.deepEqual(captured.ownerAlphaWarm, config.ownerAlphaWarm);
      assert.deepEqual(captured.ownerAlpha, config.ownerAlpha);
      const service = createSpriteCodexService(captured, { ...dependencies, spriteRequest,
        fetchImpl: controlFetch, prepareNative });
      serviceRef = service;
      // The transport child is the npm launcher, not its native executable.
      // Observe the actual pinned executable while alive, then require both
      // PIDs to disappear after production stop. This is not a descendant census.
      const start = service.start.bind(service);
      service.start = async () => {
        const value = await start();
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
        return value;
      };
      // Records only; the production stop path itself is never altered.
      const maintain = service.maintain.bind(service);
      service.maintain = async () => {
        const at = Date.now(); report.maintains++;
        try {
          const value = await maintain();
          if (report.maintains === 1) report.maintainLog.push({ at, ended: Date.now(), ok: true });
          return value;
        } catch (error) {
          report.maintainLog.push({ at, ended: Date.now(), ok: false, code: error.code ?? error.name });
          throw error;
        }
      };
      const stop = service.stop.bind(service);
      service.stop = () => { report.stopCalls.push(Date.now()); return stop(); };
      return service;
    },
    });
  } catch (error) {
    runError = error;
  }

  // The production entrypoint stopped the real native process by itself.
  assert.ok(!testOwnedStop, 'the test itself stopped the service on the success path');
  assert.equal(report.nativeStarts, 1);
  assert.ok(Number.isInteger(nativePid), 'native PID was never captured through the transport handle');
  assert.equal(pidAliveAtReady, true, 'native PID was not alive when the entrypoint reported ready');
  assert.ok(nativeExit, 'native exit was never observed through the transport child handle');
  assert.ok(nativeExit.code !== null || nativeExit.signal !== null, 'observed native exit has no code and no signal');
  assert.equal(report.stopCalls.length, 1, `unexpected production stop call count: ${JSON.stringify(report.stopCalls)}`);
  // The real Worker fences the warm host at the frozen expiry: the host
  // credential's exp is floored to whole seconds (rejected up to ~1s before the
  // millisecond-precise expiry), and the lifecycle lease fence rejects
  // heartbeats at/after expiry. The responsive production maintain loop here
  // ends at the expiry fence — roughly one loop beat around expiry — and the
  // entrypoint's finally performs the automatic native stop. The expiry+30s
  // deadline timer is a backstop that never fires in this composition, so the
  // stop is proven at the fence, never at the grace boundary.
  assert.ok(report.stopCalls[0] >= expiryAt - 1500, 'a production stop ran before the expiry fence window opened');
  assert.ok(report.stopCalls[0] < graceAt, 'the automatic stop only ran at the expiry+30s backstop boundary');
  assert.ok(report.stopCalls[0] <= expiryAt + 5000, 'the automatic stop ran unboundedly late after the expiry fence');
  assert.ok(nativeExit.at >= report.stopCalls[0], 'the native process exited before the first production stop call');
  assert.throws(() => process.kill(nativePid, 0), error => error.code === 'ESRCH',
    'the npm launcher still exists after the entrypoint returned');
  assert.ok(Number.isInteger(nativeExecutablePid), 'native executable PID was never observed');
  assert.throws(() => process.kill(nativeExecutablePid, 0), error => error.code === 'ESRCH',
    'the native executable still exists after the entrypoint returned');
  assert.ok(Date.now() < graceAt + 60000, 'the run exceeded its bounded window');
  assert.ok(report.maintains >= 10, 'the maintain loop never sustained reconciliation');
  assert.ok(readyAt < expiryAt, 'the entrypoint reported ready only after expiry');

  // Only bounded lifecycle observations; expiry is not success or settlement.
  // The real composition ends at the expiry fence: either the entrypoint's own
  // maintain hits the fence (owner-alpha.failed with an unknown outcome, never
  // a settlement claim) or the supervisor's scheduled maintenance recovers the
  // service phase first and the loop condition exits cleanly. Both outcomes
  // stop the real native process through the production finally.
  const eventNames = report.events.map(value => value.event);
  assert.equal(eventNames[0], 'owner-alpha.ready');
  assert.equal(eventNames.at(-1), 'owner-alpha.stopped');
  assert.ok(eventNames.length === 2 || eventNames.length === 3, `unexpected report sequence: ${JSON.stringify(eventNames)}`);
  const fencedCodes = ['CONTROL_HTTP_ERROR', 'EXECUTOR_FENCED', 'SERVICE_RECOVERY_REQUIRED'];
  if (eventNames.length === 3) {
    assert.equal(eventNames[1], 'owner-alpha.failed');
    assert.deepEqual(Object.keys(report.events[1]).sort(),
      ['code', 'event', 'operatorStopped', 'policyExpired', 'replayAllowed', 'stage']);
    assert.equal(report.events[1].stage, 'run');
    assert.ok(fencedCodes.includes(report.events[1].code), `unexpected fence code: ${report.events[1].code}`);
    assert.equal(report.events[1].operatorStopped, false);
    assert.equal(typeof report.events[1].policyExpired, 'boolean');
    assert.equal(report.events[1].replayAllowed, false);
    // The rethrown entrypoint error is the same fence the failed report named.
    assert.ok(runError, 'a failed report was emitted without an entrypoint rethrow');
    assert.ok(fencedCodes.includes(runError.code), `unexpected rethrow code: ${runError.code}`);
    assert.equal(runError.code, report.events[1].code);
  } else {
    assert.equal(runError, null, 'the entrypoint rethrew without a failed report');
  }
  assert.deepEqual(report.events.at(-1), { event: 'owner-alpha.stopped', stateRetained: true, settlementProved: false, replayAllowed: false });
  assert.equal(report.events[0].hosted, true);
  assert.equal(report.events[0].providerHold, true);
  assert.equal(report.events[0].productionEnabled, false);
  assert.equal(report.events[0].outputIsProvisional, true);
  assert.equal(report.events[0].session_id, config.ownerAlpha.session_id);
  assert.equal(report.events[0].expires_at, config.ownerAlpha.expires_at);

  // The canonical turn completed through the real loopback model seam before expiry.
  assert.equal(modelError, undefined, 'the model fixture encountered an error');
  assert.equal(report.modelPosts.length, 1);
  const post = report.modelPosts[0];
  assert.equal(post.url, '/v1/responses');
  assert.equal(post.model, 'fixture-model');
  assert.deepEqual(post.tools, []);
  assert.ok(post.input.includes(text1), 'owner text absent from the native model request');
  assert.equal(post.authorization, `Bearer ${accessToken}`, 'the native model call did not use the synthetic account seam');
  assert.equal(post.contentEncoding, 'zstd', 'the request did not come from the built-in openai client');
  assert.ok(post.at < expiryAt, 'the model request happened after the frozen expiry');
  const history = await (await fixture.fetchImpl(`/v1/conversations/${persona}/events`, { headers: ownerHeaders })).json();
  const results = history.events.filter(event => event.type === 'run.result' && event.payload.run_id === manifestRow.value.run_id);
  assert.equal(results.length, 1, 'the admitted run never completed canonically');
  assert.equal(results[0].payload.text, reply);

  // Durable journal honesty: recovery custody, observed native stop, retained
  // identity — and no completion or settlement claim.
  const stoppedJournal = JSON.parse(await readFile(join(stateDirectory, 'journal', 'service.json'), 'utf8'));
  assert.equal(stoppedJournal.phase, 'recovery');
  assert.equal(stoppedJournal.nativeStopped, true);
  assert.deepEqual(stoppedJournal.ownerAlphaGeneration, config.ownerAlphaGeneration);
  assert.deepEqual(stoppedJournal.ownerAlphaWarm, config.ownerAlphaWarm);
  assert.equal(stoppedJournal.identity.epoch, 2);
  assert.equal(stoppedJournal.identity.boot_id, generationRow.value.boot_id);

  // The immutable generation descriptor never changed through the whole run.
  const rowsFinal = await fixture.warmRows();
  assert.deepEqual(rowsOf(rowsFinal, 'owner_alpha_warm_generation:2')[0].value, generationRow.value,
    'the run rewrote the immutable generation descriptor');
  // The completed generation yields no second launch envelope: no replay.
  assert.equal(await managerClient.request('generation', {}), null, 'the stopped generation yielded a second envelope');
  // The real wake listener saw exactly the one production delivery.
  assert.equal(wakeHits, 1);
  // One hosted activity hold plus its renewals only: no release, no second identity.
  assert.ok(report.spriteRequests.length >= 2);
  assert.deepEqual(report.spriteRequests.slice(0, 2), ['PUT', 'GET']);
  assert.ok(report.spriteRequests.every(method => method === 'PUT' || method === 'GET'),
    'unexpected sprite activity beyond holds and confirmations');
  assert.ok(new Set(report.taskNames).size === 1 && report.taskNames[0] === `hehe-2-${generationRow.value.boot_id}`,
    'sprite holds appeared for another task identity');
  // Worker outbound surface: only the Access certs read and the single wake POST.
  assert.deepEqual(fixture.outboundRequests.filter(request => request.method === 'POST'),
    [{ method: 'POST', url: 'https://synthetic-warm.sprites.app/wake' }],
    'the warm wake was not the single outbound POST');
  assert.ok(fixture.outboundRequests.every(request =>
    request.method === 'GET' && request.url === 'https://synthetic.cloudflareaccess.com/cdn-cgi/access/certs' ||
    request.method === 'POST' && request.url === 'https://synthetic-warm.sprites.app/wake'));
  // The pinned binary really is the tested Codex version.
  const version = JSON.stringify(await (await import('node:util')).promisify(execFile)(binary, ['--version']));
  assert.ok(version.includes('codex-cli 0.154.0'), `unexpected binary version: ${version}`);

  Object.assign(report, { status: 'passed', automaticStop: true, automaticStopAt: report.stopCalls[0],
    expiryFenceStop: true, graceBackstopFired: false,
    expiryAt: config.ownerAlpha.expires_at, transportPid: nativePid, nativeExecutablePid,
    nativeExecutableStopped: true, nativeExit: { code: nativeExit.code, signal: nativeExit.signal },
    productionEnabled: false, providerOrAccountVerified: false, realWorkerWakeDelivery: true,
    dualLocksProved: false, stagedReadbacks: ['configRequirements/read'] });
} catch (error) {
  report.error = error.code ?? error.name;
  report.message = error.message;
  report.frames = error.stack?.split('\n').filter(line => line.trimStart().startsWith('at '));
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  listener?.close();
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
  console.log(JSON.stringify(report, null, 2));
}
