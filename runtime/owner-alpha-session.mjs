import { spawn, execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { Agent } from 'undici';
import { ownerAlphaPolicy } from './owner-alpha-policy.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const routinePolicy = 'f0ff3ead-1e31-4f83-bbc2-aa25f069a962';
const fail = code => { throw Object.assign(new Error(code), { code }); };
const exec = promisify(execFile);
const sleep = ms => new Promise(resolveWait => setTimeout(resolveWait, ms));
async function privatePath(path, directory) {
  if (typeof path !== 'string' || !isAbsolute(path)) fail('PRIVATE_PATH_REQUIRED');
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || stat.uid !== process.getuid() || stat.mode & 0o077 ||
      !(directory ? stat.isDirectory() : stat.isFile())) fail('PRIVATE_PATH_REQUIRED');
}

/** Capture a fresh operator-selected session. No account calls, native execution,
 * credential copying, portal creation or existing-state reset occurs here. */
export async function prepareOwnerAlphaSession(input, { now = Date.now } = {}) {
  const config = structuredClone(input);
  const keys = ['stateDirectory', 'nativeHome', 'model', 'personaId', 'publicOrigin', 'port',
    'sessionSeconds', 'maxRuns', 'maxTaskSeconds'];
  if (!config || Object.keys(config).some(key => !keys.includes(key))) fail('INVALID_SESSION_CONFIGURATION');
  const { stateDirectory, nativeHome, model, personaId, publicOrigin, port,
    sessionSeconds = 300, maxRuns = 1, maxTaskSeconds = 120 } = config;
  let origin;
  try { origin = new URL(publicOrigin); } catch { fail('INVALID_SESSION_CONFIGURATION'); }
  if (origin.protocol !== 'https:' || origin.origin !== publicOrigin || origin.username || origin.password ||
      !Number.isInteger(port) || port < 1 || port > 65535 ||
      !Number.isInteger(sessionSeconds) || sessionSeconds < 30 || sessionSeconds > 300 ||
      typeof model !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(model)) fail('INVALID_SESSION_CONFIGURATION');
  const ownerAlpha = ownerAlphaPolicy({ session_id: randomUUID(), persona_id: personaId,
    expires_at: new Date(now() + sessionSeconds * 1000).toISOString(), max_runs: maxRuns, max_task_seconds: maxTaskSeconds });
  await privatePath(stateDirectory, true); await privatePath(nativeHome, true);
  const state = resolve(stateDirectory), home = resolve(nativeHome);
  if (state === home || state.startsWith(home + '/') || home.startsWith(state + '/')) fail('SEPARATE_NATIVE_HOME_REQUIRED');
  if ((await readdir(state)).length) fail('FRESH_SESSION_DIRECTORY_REQUIRED');
  // This marker is a durable no-replay fence, including partial setup failures.
  await writeFile(join(state, 'session-policy.json'), JSON.stringify({ ownerAlpha, publicOrigin, model }), { flag: 'wx', mode: 0o600 });
  const runtimeDirectory = join(state, 'runtime');
  await mkdir(runtimeDirectory, { mode: 0o700 });
  const runtimeTokenFile = join(state, 'runtime-token'), ownerTokenFile = join(state, 'owner-token');
  await writeFile(runtimeTokenFile, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
  await writeFile(ownerTokenFile, randomBytes(32).toString('base64url'), { flag: 'wx', mode: 0o600 });
  return { stateDirectory: state, runtimeDirectory, nativeHome: home, ownerAlpha, model, publicOrigin, port,
    runtimeTokenFile, ownerTokenFile, cert: join(state, 'cert.pem'), key: join(state, 'key.pem'),
    accessExpiresAt: new Date(Date.parse(ownerAlpha.expires_at) + 900000).toISOString() };
}

async function freePort() {
  const listener = createServer();
  await new Promise((ok, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', ok); });
  const port = listener.address().port;
  await new Promise((ok, reject) => listener.close(error => error ? reject(error) : ok()));
  return port;
}
async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  for (let i = 0; i < 100 && child.exitCode === null && child.signalCode === null; i++) await sleep(100);
  if (child.exitCode === null && child.signalCode === null) fail('CHILD_STOP_UNCONFIRMED');
}
async function until(check, signal, timeoutMs = 45000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    signal.throwIfAborted();
    if (await check()) return;
    await sleep(250);
  }
  fail('SESSION_START_TIMEOUT');
}

/** Supervise private Worker + native runtime + authenticated public gateway.
 * Invoke under an orb/service manager; never publish the private Worker port. */
export async function serveOwnerAlphaSession(input, { signal, report = value => console.info(JSON.stringify(value)) } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) fail('SESSION_STOPPED');
  signal?.addEventListener('abort', abort, { once: true });
  let worker, runtime, gateway, agent, timer;
  const logs = [];
  const trackedSpawn = (command, args, env, logFile) => {
    controller.signal.throwIfAborted();
    const child = spawn(command, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '';
    const stream = createWriteStream(logFile, { flags: 'ax', mode: 0o600 }); logs.push(stream);
    for (const output of [child.stdout, child.stderr]) {
      output.pipe(stream, { end: false });
      output.on('data', bytes => { text = (text + bytes.toString()).slice(-65536); });
    }
    child.on('error', () => controller.abort());
    return { child, text: () => text };
  };
  try {
    const session = await prepareOwnerAlphaSession(input);
    timer = setTimeout(abort, Math.max(0, Date.parse(session.accessExpiresAt) - Date.now()));
    const { stateDirectory: state, runtimeDirectory, ownerAlpha, cert, key } = session;
    controller.signal.throwIfAborted();
    await exec('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', key, '-out', cert],
    { timeout: 10000, signal: controller.signal });
    const upstreamPort = await freePort(), upstreamOrigin = `https://127.0.0.1:${upstreamPort}`;
    const token = await readFile(session.runtimeTokenFile, 'utf8');
    const workerProcess = trackedSpawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev',
      '--local', '--env', 'local', '--ip', '127.0.0.1', '--port', String(upstreamPort),
      '--persist-to', join(state, 'worker'), '--local-protocol', 'https', '--https-key-path', key, '--https-cert-path', cert,
      '--var', 'EXECUTION_ENABLED:false', '--var', 'NATIVE_VERIFIED:false', '--var', 'PROVIDER_CONFIG:{}',
      '--var', `RUNTIME_TOKEN:${token}`, '--var', `TOOL_POLICY_IDS:${JSON.stringify([routinePolicy])}`,
      '--var', `HEHEBOT_OWNER_ALPHA:${JSON.stringify(ownerAlpha)}`],
    { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: join(state, 'wrangler-logs') }, join(state, 'worker.log'));
    worker = workerProcess.child;
    await until(() => {
      if (worker.exitCode !== null || worker.signalCode !== null) fail('PRIVATE_WORKER_STOPPED');
      return workerProcess.text().includes(`Ready on ${upstreamOrigin}`);
    }, controller.signal);
    agent = new Agent({ connect: { ca: await readFile(cert) } });
    const fetchControl = async (path, init = {}) => {
      controller.signal.throwIfAborted();
      const response = await fetch(upstreamOrigin + path, { ...init, dispatcher: agent, redirect: 'error',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
      if (!response.ok) fail('SESSION_CONTROL_REFUSED');
      return response.json();
    };
    const snapshot = await fetchControl('/v1/state');
    const persona = snapshot.objects.find(value => value.kind === 'persona' && value.id === ownerAlpha.persona_id);
    if (!persona || snapshot.runs.length) fail('FRESH_PERSONA_REQUIRED');
    const adopted = await fetchControl('/v1/commands', { method: 'POST', headers: {
      'Content-Type': 'application/json', Origin: upstreamOrigin, 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ schema_version: 1, type: 'persona.put', payload: {
      ...persona.body, id: persona.id, expected_revision: persona.revision, tool_policy_ids: [routinePolicy] } }) });
    if (adopted.status !== 'applied') fail('PERSONA_ADOPTION_REFUSED');
    const nativeConfig = { stateDirectory: runtimeDirectory, ownerAlpha, nativeHome: session.nativeHome,
      binary: join(root, '.local/codex-runtime/node_modules/.bin/codex'), portalOrigin: upstreamOrigin + '/',
      runtimeTokenFile: session.runtimeTokenFile, tlsCAFile: cert, installationId: 'owner-alpha-session',
      personas: { [persona.id]: { agentId: 'assistant', model: session.model, allowedTools: ['hehebot_list_routines', 'hehebot_read_skill'] } } };
    const nativeConfigFile = join(state, 'native-session.json');
    await writeFile(nativeConfigFile, JSON.stringify(nativeConfig), { flag: 'wx', mode: 0o600 });
    // One active session per native home; never race credential-refresh owners.
    const nativeProcess = trackedSpawn('bash', ['scripts/with-executor-lock.sh', session.nativeHome,
      'bash', 'scripts/with-executor-lock.sh', runtimeDirectory, process.execPath,
      'runtime/owner-alpha-entry.mjs', '--run', nativeConfigFile],
    { ...process.env, NODE_EXTRA_CA_CERTS: cert }, join(state, 'runtime.log'));
    runtime = nativeProcess.child;
    await until(() => {
      if (runtime.exitCode !== null || runtime.signalCode !== null) fail('NATIVE_SESSION_REFUSED');
      return nativeProcess.text().includes('"event":"owner-alpha.ready"');
    }, controller.signal);
    const { startOwnerAlphaGateway } = await import('./owner-alpha-gateway.mjs');
    controller.signal.throwIfAborted();
    gateway = await startOwnerAlphaGateway({ publicOrigin: session.publicOrigin, upstreamOrigin,
      upstreamCaFile: cert, ownerTokenFile: session.ownerTokenFile, runtimeTokenFile: session.runtimeTokenFile,
      ownerAlpha, accessExpiresAt: session.accessExpiresAt, port: session.port }, {
      admissionOpen: () => !controller.signal.aborted && runtime.exitCode === null && runtime.signalCode === null,
    });
    controller.signal.throwIfAborted();
    report({ event: 'owner-alpha.portal-ready', publicOrigin: session.publicOrigin, expiresAt: ownerAlpha.expires_at,
      accessExpiresAt: session.accessExpiresAt, ownerTokenFile: session.ownerTokenFile,
      productionEnabled: false, automaticReplay: false });
    // A native stop does not erase readback. Private Worker failure closes ingress.
    while (!controller.signal.aborted) {
      if (worker.exitCode !== null || worker.signalCode !== null) fail('PRIVATE_WORKER_STOPPED');
      await sleep(1000);
    }
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
    const results = await Promise.allSettled([gateway?.stop(), stopChild(runtime)]);
    results.push(...await Promise.allSettled([stopChild(worker), agent?.close()]));
    for (const log of logs) log.end();
    const stopConfirmed = results.every(value => value.status === 'fulfilled');
    report({ event: 'owner-alpha.portal-stopped', stateRetained: true, settlementProved: false,
      stopConfirmed });
    if (!stopConfirmed) fail('SESSION_STOP_UNCONFIRMED');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.umask(0o077);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--serve') fail('EXPLICIT_SESSION_REQUIRED');
    await privatePath(process.argv[3], false);
    const config = JSON.parse(await readFile(process.argv[3], 'utf8'));
    if (process.env.PUBLIC_URL) {
      const origin = new URL(process.env.PUBLIC_URL).origin;
      if (config.publicOrigin && config.publicOrigin !== origin) fail('PUBLIC_ORIGIN_MISMATCH');
      config.publicOrigin = origin;
    }
    if (process.env.PORT) {
      if (config.port !== undefined && config.port !== Number(process.env.PORT)) fail('LISTENER_PORT_MISMATCH');
      config.port = Number(process.env.PORT);
    }
    await serveOwnerAlphaSession(config, { signal: controller.signal });
  } catch {
    console.error('Owner-alpha session stopped or refused. Retain private state; do not automatically restart.');
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  }
}
