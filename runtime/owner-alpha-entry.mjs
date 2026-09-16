import { lstat, readFile, mkdir } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCodexService } from './codex-service.mjs';
import { spawnCodex } from './codex-transport.mjs';
import { ownerAlphaPolicy } from './owner-alpha-policy.mjs';

const fail = code => { throw Object.assign(new Error(code), { code }); };
// Do not force login/store settings: that can log out an existing account.
const authOverrides = { model_provider: 'openai' };

async function privatePath(path, directory = false) {
  if (!isAbsolute(path)) fail('PRIVATE_PATH_REQUIRED');
  const stat = await lstat(path);
  if (!(directory ? stat.isDirectory() : stat.isFile()) || stat.isSymbolicLink() ||
      stat.uid !== process.getuid() || stat.mode & 0o077 || !directory && stat.size > 32768) fail('PRIVATE_PATH_REQUIRED');
}

/** Supported account/model discovery, never inference or an account login. */
export async function checkAlphaAccount(transport, model) {
  const account = await transport.request('account/read', { refreshToken: false });
  if (account?.account?.type !== 'chatgpt' || account.requiresOpenaiAuth !== true) fail('OWNER_ALPHA_LOGIN_REQUIRED');
  let cursor = null;
  for (let page = 0; page < 10; page++) {
    const list = await transport.request('model/list', { cursor, limit: 100, includeHidden: false });
    if (!Array.isArray(list?.data)) fail('OWNER_ALPHA_MODEL_UNAVAILABLE');
    if (list.data.some(value => value.model === model && value.hidden === false)) return;
    if (typeof list.nextCursor !== 'string' || !list.nextCursor || list.nextCursor === cursor) break;
    cursor = list.nextCursor;
  }
  fail('OWNER_ALPHA_MODEL_UNAVAILABLE');
}

/** Explicitly supervised local entrypoint; never called by the Sprite wake service. */
export async function runOwnerAlpha(config, { createService = createCodexService, launch = spawnCodex,
  report = value => console.info(JSON.stringify(value)), signal, now = Date.now,
  wait = ms => new Promise(resolveWait => setTimeout(resolveWait, ms)) } = {}) {
  config = structuredClone(config);
  const policy = ownerAlphaPolicy(config.ownerAlpha);
  // V1 native tools can target foreign live thread IDs in the same app-server.
  // Scripted service fixtures do not establish independent-task authority.
  if (policy.background_first_root) fail('OWNER_BACKGROUND_AUTHORITY_UNVERIFIED');
  if (config.disposableTest !== undefined || config.restrictedPermissions !== undefined ||
      Object.keys(config.personas ?? {}).length !== 1 || !config.personas?.[policy.persona_id] ||
      Date.parse(policy.expires_at) <= now() || Date.parse(policy.expires_at) > now() + 300000) fail('INVALID_OWNER_ALPHA_CONFIGURATION');
  await privatePath(config.stateDirectory, true);
  const home = config.nativeHome ?? join(config.stateDirectory, 'codex-home');
  // The owner may run supported login here before starting this fresh session.
  if (!config.nativeHome) await mkdir(home, { recursive: true, mode: 0o700 });
  await privatePath(home, true);
  // Do not overwrite an existing user config or retry used session custody.
  for (const path of [...(config.nativeHome ? [] : [join(home, 'config.toml')]), join(config.stateDirectory, 'journal'), join(config.stateDirectory, 'workspace')]) {
    try { await lstat(path); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    fail('OWNER_ALPHA_FRESH_STATE_REQUIRED');
  }
  if (signal?.aborted) fail('OWNER_ALPHA_STOPPED');
  let service, deadline;
  let timedOut = false;
  const stop = () => { void service?.stop().catch(() => {}); };
  signal?.addEventListener('abort', stop, { once: true });
  try {
    service = createService(config, { now, launch: options => {
      const transport = launch({ ...options, configOverrides: { ...options.configOverrides, ...authOverrides } });
      const initialize = transport.initialize.bind(transport);
      transport.initialize = async options => {
        const result = await initialize(options);
        const readback = await transport.request('config/read', { includeLayers: false });
        if (readback?.config?.model_provider !== 'openai' || readback.config.model_providers?.openai != null) fail('OWNER_ALPHA_PROVIDER_DENIED');
        await checkAlphaAccount(transport, config.personas[policy.persona_id].model);
        if (signal?.aborted) fail('OWNER_ALPHA_STOPPED');
        return result;
      };
      return transport;
    } });
    // Stop independently of an in-flight maintenance/account await.
    deadline = setTimeout(() => { timedOut = true; stop(); }, Math.max(0, Date.parse(policy.expires_at) + 30000 - now()));
    await service.start();
    if (timedOut || signal?.aborted) fail('OWNER_ALPHA_STOPPED');
    report({ event: 'owner-alpha.ready', session_id: policy.session_id, expires_at: policy.expires_at,
      max_runs: policy.max_runs, productionEnabled: false, providerHold: false, outputIsProvisional: true });
    // Keep reconciliation alive through the existing 30s cancellation grace.
    // Stopping the app-server afterward is not recursive/effect settlement.
    while (!timedOut && !signal?.aborted && service.phase === 'running' && now() < Date.parse(policy.expires_at) + 30000) {
      await service.maintain();
      await wait(1000);
    }
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener('abort', stop);
    if (service) await service.stop();
    report({ event: 'owner-alpha.stopped', stateRetained: true, settlementProved: false, replayAllowed: false });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--run') fail('OWNER_ALPHA_EXPLICIT_RUN_REQUIRED');
    const path = process.argv[3]; await privatePath(path);
    const config = JSON.parse(await readFile(path, 'utf8'));
    await runOwnerAlpha(config, { signal: controller.signal });
  } catch {
    console.error('Owner alpha refused or stopped; inspect retained private state. No automatic retry.');
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  }
}
