#!/usr/bin/env node
// Run through test-codex-launcher-boundary.sh, never directly in a host root.
// Real launcher/default entry/locks/setpriv/floor/Tasks socket. The ONLY native
// launch seam is a labelled executable wrapper adding supported session flags
// for synthetic loopback inference/catalog. No RPC, floor, service or timer
// replacement. This is neither production-config nor recursive containment,
// effect settlement, safe-resume or safe-sleep evidence.
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdir, readFile, readdir, readlink, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { networkInterfaces } from 'node:os';
import { promisify } from 'node:util';
import { zstdDecompressSync } from 'node:zlib';
import { startHostedControlFixture } from '../tests/fixtures/hosted-control.mjs';
import { ControlClient } from '../runtime/control-client.mjs';
import { createHostedOwnerWakeService } from '../runtime/hosted-owner-wake.mjs';
import { readOwnerAlphaConfig } from '../runtime/owner-alpha-entry.mjs';
import { inspectOwnerAlphaLaunchFloor } from '../runtime/owner-alpha-launch-floor.mjs';

const [root, directory, hostMount, hostNetwork, mode] = process.argv.slice(2);
assert.ok(root && directory?.startsWith(`${root}/.local/launcher-boundary-`));
assert.notEqual(process.getuid(), 0);
assert.notEqual(await readlink('/proc/self/ns/mnt'), hostMount);
assert.notEqual(await readlink('/proc/self/ns/net'), hostNetwork);
assert.deepEqual(Object.keys(networkInterfaces()), ['lo']);
process.chdir(root);
for (const path of ['/etc/codex', '/etc/codex/config.toml', '/etc/codex/requirements.toml']) {
  const info = await stat(path);
  assert.equal(info.uid, 0); assert.equal(info.mode & 0o022, 0);
}
assert.equal((await stat('/.sprite')).uid, process.getuid());
assert.equal(await readFile('/etc/codex/requirements.toml', 'utf8'), 'allow_remote_control = false\n\n[features]\nmemories = false\n');
if (mode === '--probe') {
  console.log(JSON.stringify({ status: 'passed', scope: 'namespace-prerequisites-only', nonRoot: true,
    privateMountNamespace: true, privateNetworkNamespace: true, realRootOwnedFloor: true }));
  process.exit(0);
}
assert.equal(mode, '');
const run = promisify(execFile), pause = ms => new Promise(ok => setTimeout(ok, ms));
const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const secret = () => randomBytes(32).toString('hex');
const persona = '11111111-1111-4111-8111-111111111111';
const ROOT_TEXT = 'LAUNCH_BOUNDARY_ROOT: delegate one resident child, then release the coordinator.';
const CHILD_TEXT = 'LAUNCH_BOUNDARY_CHILD: remain active.';
const reply = 'LAUNCH_BOUNDARY_ROOT_DONE';
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const nowSeconds = Math.floor(Date.now() / 1000);
const jwt = extra => `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ sub: 'auth0|synthetic', aud: 'https://api.openai.com/v1',
  iat: nowSeconds, exp: nowSeconds + 3600, ...extra })}.c2ln`;
const accessToken = jwt({});
const report = { status: 'failed', scope: 'real-launcher-boundary', wrapperSeam: 'supported-loopback-model-and-catalog-session-arguments',
  productionConfigurationProved: false, containmentProved: false, settlementProved: false, safeResumeProved: false,
  privateMountNamespace: true, privateNetworkNamespace: true, nonRoot: true, modelPosts: 0, events: [], lockProbes: 0 };
let fixture, listener, model, tasks, launcher, stateDirectory, errorFromServer, heldChild, heldChildClosed = false;
let expiryAt, exitAt, readyAt, entryPid, npmPid, nativePid, outerPid, monitor, monitorError;
let stopMonitoring = false, firstFreeAt = null, launcherResult, wakeResult;
const live = pid => { try { process.kill(pid, 0); return true; } catch (e) { if (e.code === 'ESRCH') return false; throw e; } };
const waitFor = async (probe, timeout = 30000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (errorFromServer) throw errorFromServer; if (monitorError) throw monitorError;
    if (await probe()) return; await pause(50); }
  throw new Error('BOUNDARY_OBSERVATION_TIMEOUT');
};
const watchdog = setTimeout(() => {
  console.error('Launcher boundary watchdog failed; cleanup only, never acceptance.');
  for (const pid of [nativePid, npmPid, entryPid, outerPid]) if (pid && live(pid)) process.kill(pid, 'SIGKILL');
  process.exit(1);
}, 300000);

async function children(pid) {
  return (await readFile(`/proc/${pid}/task/${pid}/children`, 'utf8')).trim().split(/\s+/).filter(Boolean).map(Number);
}
async function processIdentity(pid, parent, native = false) {
  const text = await readFile(`/proc/${pid}/status`, 'utf8');
  assert.match(text, new RegExp(`^PPid:\\s+${parent}$`, 'm'));
  assert.match(text, new RegExp(`^Uid:\\s+${process.getuid()}\\s+${process.getuid()}\\s+${process.getuid()}\\s+${process.getuid()}$`, 'm'));
  const capabilities = Object.fromEntries(['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']
    .map(field => [field, text.match(new RegExp(`^${field}:\\s+([0-9a-f]+)$`, 'm'))?.[1]]));
  (report.observedCapabilities ??= []).push({ pid, capabilities });
  for (const [field, bits] of Object.entries(capabilities)) assert.match(bits ?? '', /^0+$/, `${field} must be zero after the production launcher`);
  assert.match(text, /^NoNewPrivs:\s+1$/m);
  const executable = await readlink(`/proc/${pid}/exe`);
  if (native) assert.ok(executable.startsWith(resolve('.local/codex-runtime') + '/') && executable.endsWith('/codex'));
  else assert.equal(executable, await readlink('/proc/self/exe'));
  return { pid, parent, executable, uid: process.getuid(), zeroCapabilities: true, noNewPrivs: true };
}

try {
  const home = join(directory, 'native-home'), sessions = join(directory, 'sessions');
  await mkdir(home, { mode: 0o700 }); await mkdir(sessions, { mode: 0o700 });
  const pinned = resolve('.local/codex-runtime/node_modules/.bin/codex');
  assert.equal((await run(pinned, ['--version'])).stdout.trim(), 'codex-cli 0.154.0');
  const wrapper = join(directory, 'synthetic-model-wrapper.sh');
  const counts = { root: 0, child: 0 };
  model = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks); assert.ok(raw.length < 2 * 1024 * 1024);
      if (req.method === 'GET' && !raw.length) { res.writeHead(404); res.end('{}'); return; }
      assert.equal(req.method, 'POST'); assert.equal(req.url, '/v1/responses');
      assert.equal(req.headers.authorization, `Bearer ${accessToken}`);
      assert.equal(req.headers['content-encoding'], 'zstd');
      const body = JSON.parse(zstdDecompressSync(raw)); assert.equal(body.model, 'fixture-model');
      const text = JSON.stringify(body.input.filter(item => ['user', 'assistant'].includes(item.role) || item.type === 'agent_message'));
      report.modelPosts++;
      if (text.includes(CHILD_TEXT)) {
        assert.equal(++counts.child, 1); heldChild = res; res.once('close', () => { heldChildClosed = true; }); return;
      }
      assert.ok(text.includes(ROOT_TEXT));
      if (++counts.root === 1) {
        const namespace = body.tools.find(tool => tool.type === 'namespace' && tool.tools?.some(t => t.name === 'spawn_agent'));
        assert.ok(namespace, 'actual restricted V2 collaboration tools absent');
        send(res, [{ id: `fc_${randomUUID()}`, type: 'function_call', status: 'completed', call_id: `call_${randomUUID()}`,
          namespace: namespace.name, name: 'spawn_agent', arguments: JSON.stringify({ task_name: 'child', message: CHILD_TEXT, fork_turns: 'none' }) }]);
      } else {
        assert.equal(counts.root, 2);
        send(res, [{ id: `msg_${randomUUID()}`, type: 'message', status: 'completed', role: 'assistant',
          content: [{ type: 'output_text', text: reply, annotations: [] }] }]);
      }
    } catch (error) { errorFromServer = error; res.destroy(); }
  });
  model.listen(0, '127.0.0.1'); await once(model, 'listening');
  const holds = new Map(), taskRequests = [];
  tasks = createServer(async (req, res) => {
    try {
      assert.equal(req.headers.host, 'sprite'); assert.match(req.url, /^\/v1\/tasks\/[a-zA-Z0-9_-]+$/);
      assert.ok(['PUT', 'GET'].includes(req.method), 'no release allowed'); taskRequests.push(req.method);
      if (req.method === 'PUT') {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks)); assert.deepEqual(Object.keys(body), ['expire']);
        holds.set(req.url, { name: req.url.split('/').at(-1), expires_at: new Date(Date.now() + body.expire * 1000).toISOString() });
      }
      assert.ok(holds.has(req.url)); res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(req.method === 'GET' ? holds.get(req.url) : {}));
    } catch (error) { errorFromServer = error; res.destroy(); }
  });
  tasks.listen('/.sprite/api.sock'); await once(tasks, 'listening');
  const catalogPath = join(home, 'fixture-models.json');
  await writeFile(catalogPath, JSON.stringify({ models: [{ slug: 'fixture-model', display_name: 'Synthetic V2 fixture', description: null,
    supported_reasoning_levels: [], shell_type: 'unified_exec', visibility: 'list', supported_in_api: true, priority: 1, upgrade: null,
    model_messages: { instructions_template: 'Synthetic credential-free fixture.', instructions_variables: null },
    default_reasoning_summary: 'auto', support_verbosity: false, default_verbosity: null, apply_patch_tool_type: null,
    truncation_policy: { mode: 'bytes', limit: 10000 }, supports_image_detail_original: false, context_window: 272000,
    auto_compact_token_limit: null, effective_context_window_percent: 95, experimental_supported_tools: [], multi_agent_version: 'v2' }] }), { mode: 0o600 });
  await writeFile(join(home, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: null, tokens: {
    id_token: jwt({ email: 'synthetic@localhost', chatgpt_account_id: 'synthetic-account' }), access_token: accessToken,
    refresh_token: 'synthetic-refresh', account_id: 'synthetic-account' }, last_refresh: new Date().toISOString() }), { mode: 0o600 });
  await writeFile(join(home, 'config.toml'), 'model = "fixture-model"\nmodel_provider = "openai"\n', { mode: 0o600 });
  const shellQuote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
  const overrides = { openai_base_url: `http://127.0.0.1:${model.address().port}/v1`, model_catalog_json: catalogPath,
    web_search: 'disabled', 'agents.enabled': false, ...Object.fromEntries(['multi_agent', 'multi_agent_v2', 'apps', 'tool_suggest',
      'image_generation', 'standalone_web_search', 'token_budget', 'sleep_tool', 'request_permissions_tool', 'exec_permission_approvals']
      .map(key => [`features.${key}`, false])) };
  await writeFile(wrapper, `#!/bin/bash\nset -euo pipefail\numask 077\n# TEST ONLY: supported synthetic model/catalog CLI session arguments.\nif [[ "\${1:-}" == --version && $# == 1 ]]; then exec ${shellQuote(pinned)} "$@"; fi\n[[ "\${1:-}" == app-server ]]\nexec ${shellQuote(pinned)} "$@" ${Object.entries(overrides).map(([key, value]) => `-c ${shellQuote(`${key}=${JSON.stringify(value)}`)}`).join(' ')} 2>${shellQuote(join(directory, 'native-stderr.log'))}\n`, { mode: 0o700 });
  report.wrapperSha256 = hash(await readFile(wrapper));
  const seedBoot = randomUUID(), managerToken = secret(), wakeToken = secret(), accessClientId = secret(), accessClientSecret = secret();
  const oldPolicy = { session_id: randomUUID(), persona_id: persona, expires_at: new Date(Date.now() - 120000).toISOString(), max_runs: 1, max_task_seconds: 30 };
  const ownerBinding = hash({ auth_mode: 'access', installation_id: 'hosted-fixture', issuer: 'https://synthetic.cloudflareaccess.com', audience: 'fixture-audience', owner_subject: 'fixture-owner' });
  const backgroundProfile = { profile_version: 'codex-background-v2-restricted-v1', profile_sha256: hash('synthetic-background-profile'),
    max_resident_child_threads: 2, wait_agent_enabled: false, multi_agent_v1: false };
  // Preserve millisecond precision. Do not round to hide the known early-JWT
  // retirement gap; a failure is reported, never retried for favorable timing.
  const policy = { schema_version: 1, kind: 'owner-alpha-background-generation-v1', installation_id: 'hosted-fixture', owner_id: 'fixture-owner',
    owner_binding_sha256: ownerBinding, policy_revision: 'launcher-boundary-v1', persona_id: persona, background: backgroundProfile,
    expires_at: new Date(Date.now() + 150000).toISOString(), max_task_seconds: 300, max_admissions: 3,
    prior_cost_micro_usd: 1000, prior_cost_source: 'synthetic-baseline', total_cap_micro_usd: 10000000, reservation_micro_usd: 2000,
    seed_retirement: { epoch: 1, boot_id: seedBoot, session_id: oldPolicy.session_id, transition_id: null,
      observed_at: new Date(Date.now() - 60000).toISOString(), direct_child_stopped: true, execution_lock_free: true,
      session_lock_free: true, source: 'synthetic-seed' } };
  expiryAt = Date.parse(policy.expires_at);
  fixture = await startHostedControlFixture({ directory: join(directory, 'control'), ownerAlpha: oldPolicy, runtimeToken: secret(), accessClientId, accessClientSecret,
    background: { generation: policy, token: managerToken, hostSigningKey: secret(), taskSigningKey: secret(), wakeToken } });
  await fixture.retirePredecessor(seedBoot);
  const manager = new ControlClient({ origin: fixture.origin, token: managerToken, principal: 'background-manager', accessClientId, accessClientSecret, fetchImpl: fixture.fetchImpl });
  const ownerHeaders = { 'Cf-Access-Jwt-Assertion': fixture.ownerJwt };
  const command = (type, payload) => ({ method: 'POST', headers: { ...ownerHeaders, Origin: fixture.origin,
    'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ schema_version: 1, type, payload }) });
  assert.equal((await (await fixture.fetchImpl('/v1/commands', command('persona.put', { id: persona, expected_revision: 1, name: 'Fixture owner',
    instructions: 'Follow synthetic instructions only.', tool_policy_ids: ['f0ff3ead-1e31-4f83-bbc2-aa25f069a962'], archived: false }))).json()).status, 'applied');
  const paths = {};
  for (const [name, value] of Object.entries({ accessId: accessClientId, accessSecret: accessClientSecret, manager: managerToken, wake: wakeToken })) {
    paths[name] = join(directory, name); await writeFile(paths[name], value, { mode: 0o600 });
  }
  const template = { stateDirectory: join(directory, 'unused'), nativeHome: home, binary: wrapper, portalOrigin: fixture.origin,
    installationId: 'hosted-fixture', hostedOwnerBindingSha256: fixture.ownerBindingSha256, runtimeTokenFile: join(directory, 'unused-token'),
    accessClientIdFile: paths.accessId, accessClientSecretFile: paths.accessSecret, tlsCAFile: fixture.caFile, backgroundProfile,
    personas: { [persona]: { agentId: 'assistant', model: 'fixture-model', allowedTools: ['hehebot_list_routines', 'hehebot_read_skill'] } } };
  const templatePath = join(directory, 'template.json'); await writeFile(templatePath, JSON.stringify(template), { mode: 0o600 });
  const configPath = join(directory, 'manager.json');
  await writeFile(configPath, JSON.stringify({ kind: 'owner-alpha-background-manager-v1', portalOrigin: fixture.origin, installationId: 'hosted-fixture',
    hostedOwnerBindingSha256: fixture.ownerBindingSha256, managerTokenFile: paths.manager, templatePath, templateSha256: hash(template),
    sessionsDirectory: sessions, accessClientIdFile: paths.accessId, accessClientSecretFile: paths.accessSecret }), { mode: 0o600 });
  let resolveWake; const wakeFinished = new Promise(ok => { resolveWake = ok; });
  const launch = async (path, { expectedSha256 }) => {
    const { config, sha256 } = await readOwnerAlphaConfig(path, expectedSha256); assert.equal(sha256, expectedSha256);
    stateDirectory = config.stateDirectory;
    launcher = spawn(process.execPath, [resolve('runtime/hosted-owner-launcher.mjs'), '--run', path], {
      stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_EXTRA_CA_CERTS: fixture.caFile } });
    outerPid = launcher.pid;
    let buffer = ''; launcher.stdout.on('data', chunk => {
      buffer += chunk;
      while (buffer.includes('\n')) {
        const end = buffer.indexOf('\n'), line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        try { const event = JSON.parse(line); report.events.push({ ...event, observedAt: Date.now() });
          if (event.event === 'owner-alpha.ready') readyAt = Date.now(); } catch { /* only structured production reports are evidence */ }
      }
    });
    launcher.stderr.resume();
    const [code, signal] = await once(launcher, 'exit'); exitAt = Date.now();
    launcherResult = { code, signal }; return launcherResult;
  };
  listener = createHostedOwnerWakeService({ configPath, wakeTokenFile: paths.wake, port: 8080 }, {
    control: manager, launch, report: value => { wakeResult = value.code; resolveWake(); } });
  listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  fixture.setBackgroundWakeLoopback(`http://127.0.0.1:${listener.address().port}`);
  const receipt = await (await fixture.fetchImpl('/v1/commands', command('message.send', { conversation_id: persona, text: ROOT_TEXT }))).json();
  assert.equal(receipt.status, 'applied');
  await waitFor(() => readyAt || launcherResult, 60000);
  assert.ok(readyAt, 'unmodified locked entry never reached ready'); assert.ok(readyAt < expiryAt);
  [entryPid] = await children(outerPid); assert.equal((await children(outerPid)).length, 1);
  const entryArgs = await readFile(`/proc/${entryPid}/cmdline`, 'utf8');
  assert.ok(entryArgs.includes(resolve('runtime/owner-alpha-entry.mjs')) && entryArgs.includes('--run-hosted-locked'));
  const entryChildren = await children(entryPid);
  const candidates = [];
  for (const pid of entryChildren) if ((await readFile(`/proc/${pid}/cmdline`, 'utf8')).includes('app-server')) candidates.push(pid);
  assert.equal(candidates.length, 1); [npmPid] = candidates;
  const nativeChildren = await children(npmPid); assert.equal(nativeChildren.length, 1); [nativePid] = nativeChildren;
  report.processes = [await processIdentity(entryPid, outerPid), await processIdentity(npmPid, entryPid), await processIdentity(nativePid, npmPid, true)];
  report.floor = inspectOwnerAlphaLaunchFloor({ home, cwd: join(stateDirectory, 'workspace') });
  report.realFloorReadbackBeforeReady = true; // unchanged entry enforces same-process readback before ready
  const lockScript = resolve('scripts/with-executor-lock.sh');
  const lockProbe = async target => {
    const code = `for(const pid of ${JSON.stringify([entryPid, npmPid, nativePid])}){try{process.kill(pid,0);process.exit(91)}catch(e){if(e.code!=='ESRCH')throw e}}`;
    const child = spawn('bash', [lockScript, target, process.execPath, '-e', code], { stdio: 'ignore' });
    const [exit, signal] = await once(child, 'exit'); assert.equal(signal, null); report.lockProbes++;
    assert.ok(exit === 73 || exit === 0, `lock acquired with a surviving entry/native process (exit ${exit})`);
    return exit;
  };
  for (const target of [home, stateDirectory]) assert.equal(await lockProbe(target), 73, 'lock absent while entry active');
  monitor = (async () => {
    while (!stopMonitoring) {
      for (const target of [home, stateDirectory]) {
        if (await lockProbe(target) === 0) firstFreeAt ??= Date.now();
      }
      await pause(100);
    }
  })().catch(error => { monitorError = error; });
  await waitFor(() => counts.root === 2 && counts.child === 1 && heldChild && !heldChildClosed, 60000);
  assert.ok(Date.now() < expiryAt - 2000); report.residentChildBeforeExpiry = true;
  await wakeFinished;
  stopMonitoring = true; await monitor; if (monitorError) throw monitorError;
  if (errorFromServer) throw errorFromServer;
  assert.ok(exitAt >= expiryAt - 1500 && exitAt <= expiryAt + 35000, 'exit outside frozen expiry fence/backstop window');
  assert.ok([0, 1].includes(launcherResult.code)); assert.equal(launcherResult.signal, null);
  for (const pid of [outerPid, entryPid, npmPid, nativePid]) assert.equal(live(pid), false, 'a launch process survived');
  for (const target of [home, stateDirectory]) assert.equal(await lockProbe(target), 0);
  assert.equal(heldChildClosed, true); assert.equal(report.modelPosts, 3);
  const events = report.events.map(event => event.event);
  assert.equal(events[0], 'owner-alpha.ready'); assert.equal(events.at(-1), 'owner-alpha.stopped');
  assert.ok(events.length === 2 || events.length === 3);
  if (events.length === 3) {
    assert.equal(events[1], 'owner-alpha.failed'); assert.equal(report.events[1].operatorStopped, false);
    assert.ok(['CONTROL_HTTP_ERROR', 'EXECUTOR_FENCED', 'SERVICE_RECOVERY_REQUIRED'].includes(report.events[1].code));
  }
  assert.equal(report.events.at(-1).settlementProved, false); assert.equal(report.events.at(-1).replayAllowed, false);
  const journal = JSON.parse(await readFile(join(stateDirectory, 'journal/service.json'), 'utf8'));
  assert.equal(journal.phase, 'recovery'); assert.equal(journal.nativeStopped, true);
  const rows = await fixture.backgroundRows();
  const generation = rows.find(row => row.key === 'owner_alpha_background_generation:2');
  assert.deepEqual(journal.ownerAlphaGeneration, { epoch: 2, boot_id: generation.value.boot_id, transition_id: generation.value.transition_id });
  report.expiryAt = expiryAt; report.exitAt = exitAt; report.firstFreeAt = firstFreeAt;
  report.wakeResult = wakeResult; report.retirementReported = wakeResult === 'RETIREMENT_REPORTED';
  assert.equal(wakeResult, 'RETIREMENT_REPORTED', 'retirement refused; preserve exact timing rather than weakening the boundary');
  const retired = rows.find(row => row.key === 'owner_alpha_retirement:2'); assert.ok(retired);
  assert.equal(retired.value.execution_lock_free, true); assert.equal(retired.value.session_lock_free, true);
  assert.equal(retired.value.source, 'hosted-background-manager:file-journal-nativeStopped+dual-flock');
  assert.equal(await manager.request('generation', {}), null);
  const state = await (await fixture.fetchImpl('/v1/state', { headers: ownerHeaders })).json();
  const runRow = state.runs.find(row => row.id === receipt.resource_id);
  assert.equal(runRow.status, 'recovery_required'); assert.ok(['OUTCOME_UNKNOWN', 'STALE_EPOCH'].includes(runRow.error_code));
  const families = [];
  for (const name of await readdir(join(stateDirectory, 'journal'))) {
    const row = JSON.parse(await readFile(join(stateDirectory, 'journal', name), 'utf8'));
    if (Array.isArray(row.families)) families.push(...row.families);
    assert.notEqual(row.effectsSettled, true);
  }
  assert.ok(families.some(row => row.claim?.run?.id === receipt.resource_id));
  assert.equal(fixture.backgroundWakeDeliveries.length, 1);
  assert.ok(taskRequests.every(method => method === 'PUT' || method === 'GET'));
  report.status = 'passed'; report.noHarnessSuccessStop = true; report.rootRetainedUnknown = true;
  report.realDualLocks = true; report.realTasksSocket = true; report.noReplay = true;
} catch (error) {
  report.error = error.code ?? error.name; report.message = error.message;
  report.frames = error.stack?.split('\n').filter(line => line.trimStart().startsWith('at '));
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog); stopMonitoring = true; await monitor;
  // Cleanup cannot satisfy success: status is fixed before any test-owned kill.
  if (report.status !== 'passed') for (const pid of [nativePid, npmPid, entryPid, outerPid]) {
    try { if (pid && live(pid)) process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
  listener?.stop(); await fixture?.close();
  for (const server of [model, tasks]) if (server) { server.closeAllConnections(); await new Promise(ok => server.close(ok)); }
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(report, null, 2));
}

function send(res, output) {
  const response = { id: `resp_${randomUUID()}`, object: 'response', created_at: 1, status: 'completed', error: null,
    incomplete_details: null, model: 'fixture-model', output, tools: [], tool_choice: 'auto', parallel_tool_calls: false,
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const event = (type, fields) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`);
  event('response.created', { response: { ...response, status: 'in_progress', output: [] } });
  for (const [output_index, item] of output.entries()) {
    event('response.output_item.added', { output_index, item: item.type === 'function_call' ? { ...item, arguments: '' } : { ...item, content: [] } });
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
