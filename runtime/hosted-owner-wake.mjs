import http from 'node:http';
import { open, lstat, readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ControlClient } from './control-client.mjs';
import { launchHostedOwnerAlpha } from './hosted-owner-launcher.mjs';
import { prepareHostedOwnerManager } from './hosted-owner-manager.mjs';
import { readOwnerAlphaConfig } from './owner-alpha-entry.mjs';
import { ownerAlphaPolicy } from './owner-alpha-policy.mjs';
import { createSpritesWakeHandler } from './sprites-wake-service.mjs';
import { createSpritesTaskTransport } from './sprites-task-transport.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = /^[0-9a-f]{64}$/;
const intentName = 'hosted-owner-launch-intent.json';
const allowedDependencies = new Set(['control', 'launch', 'now', 'report', 'readConfig', 'readSecret', 'spriteRequest']);
const fail = code => { throw Object.assign(new Error(code), { code }); };

async function privateSecret(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) fail('INVALID_PRIVATE_FILE');
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || stat.mode & 0o077 ||
      stat.size < 1 || stat.size > 32768) fail('INVALID_PRIVATE_FILE');
  const value = (await readFile(path, 'utf8')).trim();
  if (!value || value.length > 16384 || /[\r\n\0]/.test(value)) fail('INVALID_PRIVATE_FILE');
  return value;
}

function generation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'boot_id,epoch,transition_id' ||
      !Number.isSafeInteger(value.epoch) || value.epoch < 2 ||
      typeof value.boot_id !== 'string' || !uuid.test(value.boot_id) ||
      typeof value.transition_id !== 'string' || !uuid.test(value.transition_id)) fail('INVALID_HOSTED_WAKE_CONFIGURATION');
  return { epoch: value.epoch, boot_id: value.boot_id, transition_id: value.transition_id };
}

async function stateDirectory(config) {
  const path = config?.stateDirectory;
  if (typeof path !== 'string' || !isAbsolute(path)) fail('INVALID_HOSTED_WAKE_CONFIGURATION');
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || stat.mode & 0o077)
    fail('INVALID_HOSTED_WAKE_CONFIGURATION');
  for (const name of ['journal', 'workspace']) {
    try { await lstat(join(path, name)); fail('HOSTED_WAKE_STATE_NOT_FRESH'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return path;
}

async function writeIntent(directory, value) {
  const path = join(directory, intentName);
  let file;
  try {
    file = await open(path, 'wx', 0o600);
    await file.writeFile(JSON.stringify(value));
    await file.sync();
  } catch (error) {
    if (error.code === 'EEXIST') fail('HOSTED_WAKE_ALREADY_ATTEMPTED');
    throw error;
  } finally { await file?.close(); }
  const parent = await open(directory, 'r');
  try { await parent.sync(); } finally { await parent.close(); }
}

function exactStatus(status, policy, staged, binding) {
  if (!status || status.phase !== 'BOOTING' || status.execution_enabled !== false ||
      status.owner_alpha_hosted !== true || status.owner_binding_sha256 !== binding ||
      status.epoch !== staged.epoch) return false;
  try {
    return JSON.stringify(ownerAlphaPolicy(status.owner_alpha)) === JSON.stringify(policy) &&
      JSON.stringify(generation(status.owner_alpha_generation)) === JSON.stringify(staged);
  } catch { return false; }
}

/**
 * Default-off endpoint for immutable, already-staged generations. A quiet
 * listener may outlive a session; it never creates or renews a grant itself.
 * Manager mode confirms a bounded bootstrap Task before acknowledgement.
 * Its HTTP 202 response means only that the callback was queued; it never means
 * that the runtime launched or became ready. The durable intent forbids retries.
 */
export function createHostedOwnerWakeService({ configPath, wakeTokenFile, port } = {}, deps = {}) {
  if (Object.keys(deps).some(key => !allowedDependencies.has(key)) ||
      typeof configPath !== 'string' || typeof wakeTokenFile !== 'string' ||
      !Number.isInteger(port) || port < 1 || port > 65535) fail('INVALID_HOSTED_WAKE_CONFIGURATION');
  const readConfig = deps.readConfig ?? readOwnerAlphaConfig;
  const readSecret = deps.readSecret ?? privateSecret;
  const launch = deps.launch ?? launchHostedOwnerAlpha;
  const now = deps.now ?? Date.now;
  const report = deps.report ?? (value => console.info(JSON.stringify(value)));
  const controller = new AbortController();
  let handlerPromise;
  const getHandler = async () => {
    if (!handlerPromise) handlerPromise = (async () => {
      const token = await readSecret(wakeTokenFile);
      return createSpritesWakeHandler({ token, prepareWake: async (request, { signal }) => {
        // Read the operator's current config only after authenticated work.
        // Warm listeners must not retain a preceding generation's config.
        let initial;
        try { initial = await readConfig(configPath); }
        catch { return async () => { fail('HOSTED_WAKE_REFUSED'); }; }
        const config = initial.config;
        if (config?.kind === 'owner-alpha-manager-v1') {
          const { SpritesTasksClient } = await import('../.local/codex-service/sprites.mjs');
          const tasks = new SpritesTasksClient(createSpritesTaskTransport({ request: deps.spriteRequest, timeoutMs: 3000 }), now);
          const resume = await prepareHostedOwnerManager(config, request, { readSecret, launch, tasks,
            control: deps.control, now, signal: AbortSignal.any([signal, controller.signal]) });
          if (!resume) fail('HOSTED_WAKE_NO_ASSIGNMENT');
          return async () => {
            const code = await resume();
            report({ event: 'hosted-owner-wake', code, ready: false });
          };
        }
        // Legacy staged launch still runs after acknowledgement, without a
        // bootstrap Task. Only the explicit manager variant changes admission.
        return async () => {
          const policy = ownerAlphaPolicy(config?.ownerAlpha);
          const staged = generation(config?.ownerAlphaGeneration);
          if (!policy.text_only || typeof config.hostedOwnerBindingSha256 !== 'string' ||
              !digest.test(config.hostedOwnerBindingSha256) || request.epoch !== staged.epoch ||
              request.operationId !== staged.transition_id || Date.parse(policy.expires_at) <= now())
            fail('HOSTED_WAKE_REFUSED');
          const directory = await stateDirectory(config);
          let control = deps.control;
          if (!control) {
            const token = await readSecret(config.runtimeTokenFile);
            const access = config.accessClientIdFile || config.accessClientSecretFile ? {
              accessClientId: await readSecret(config.accessClientIdFile),
              accessClientSecret: await readSecret(config.accessClientSecretFile),
            } : {};
            control = new ControlClient({ origin: config.portalOrigin, token, ...access });
          }
          const status = await control.request('status', {});
          if (!exactStatus(status, policy, staged, config.hostedOwnerBindingSha256) ||
              Date.parse(policy.expires_at) <= now()) fail('HOSTED_WAKE_REFUSED');
          await readConfig(configPath, initial.sha256);
          if (Date.parse(policy.expires_at) <= now()) fail('HOSTED_WAKE_REFUSED');
          await writeIntent(directory, { config_sha256: initial.sha256, owner_alpha_generation: staged,
            phase: 'unknown' });
          const result = await launch(configPath, { expectedSha256: initial.sha256, signal: controller.signal });
          if (result?.code !== 0 || result?.signal != null) fail('HOSTED_WAKE_LAUNCH_UNKNOWN');
          report({ event: 'hosted-owner-wake', code: 'LAUNCH_EXITED', ready: false });
        };
      }, onWake: async (_request, resume) => {
        try { await resume(); } catch {
          report({ event: 'hosted-owner-wake', code: 'LAUNCH_REFUSED_OR_UNKNOWN', ready: false });
        }
      }, onFailure: code => report({ event: 'hosted-owner-wake',
        code: code === 'WAKE_PREPARATION_FAILED' ? 'PREPARATION_REFUSED_OR_UNKNOWN' : 'CALLBACK_FAILED', ready: false }) });
    })();
    return handlerPromise;
  };
  const server = http.createServer({ requestTimeout: 15000, headersTimeout: 10000, maxHeaderSize: 8192 },
    async (req, res) => {
      try { await (await getHandler())(req, res); }
      catch { if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end('{"error":"SERVICE_UNAVAILABLE"}'); }
    });
  server.once('close', () => controller.abort());
  // Stop admission and signal the launcher before waiting for slow HTTP bodies.
  // This initiates shutdown; it is not proof of native descendant termination.
  server.stop = () => {
    controller.abort();
    server.close();
    server.closeAllConnections();
  };
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 6 || !['--serve', '--listen'].includes(process.argv[2])) fail('INVALID_HOSTED_WAKE_CONFIGURATION');
    const port = Number(process.argv[5]);
    const server = createHostedOwnerWakeService({ configPath: process.argv[3], wakeTokenFile: process.argv[4], port });
    server.on('error', () => { console.error('Hosted wake listener failed; no automatic retry.'); process.exitCode = 1; server.stop(); });
    server.listen(port, '0.0.0.0');
    const stop = () => server.stop();
    // --serve is one supervised window and must not auto-restart. --listen is
    // a quiet provider-managed HTTP service: no polling, startup hold or native startup.
    // Each authenticated launch still enforces its independent bounded policy.
    const deadline = process.argv[2] === '--serve' ? setTimeout(stop, 330000) : undefined;
    server.once('close', () => { clearTimeout(deadline); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); });
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  } catch {
    console.error('Hosted wake configuration refused; no secrets printed.'); process.exitCode = 1;
  }
}
