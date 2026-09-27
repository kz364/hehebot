import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSpritesWakeHandler } from './sprites-wake-service.mjs';

const fail = code => { throw Object.assign(new Error(code), { code }); };
const HEX64 = /^[a-f0-9]{64}$/;
const WAKE_HOLD_MS = 120000;
const CONFIG_KEYS = ['portalOrigin', 'runtimeTokenFile', 'wakeTokenFile', 'accessClientIdFile', 'accessClientSecretFile',
  'tlsCAFile', 'ownerBindingSha256', 'installationId', 'stateRoot', 'binary', 'nativeHome', 'personas',
  'restrictedPermissions', 'port', 'maintainIntervalMs'];
// Codes that are safe to report; anything else may carry transport detail.
const REPORTABLE = ['CONTROL_NOT_BOOTABLE', 'OWNER_BINDING_MISMATCH', 'SERVICE_RECOVERY_REQUIRED', 'EXECUTOR_FENCED',
  'NATIVE_STOP_UNCONFIRMED', 'CONTROL_HTTP_ERROR', 'CONTROL_TIMEOUT', 'CONTROL_TRANSPORT_FAILED', 'DRAIN_OUTCOME_UNKNOWN',
  'INVALID_SERVICE_CONFIGURATION', 'CODEX_VERSION_MISMATCH'];

export function privateFile(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) fail('PRIVATE_PATH_REQUIRED');
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.size > 262144 ||
      typeof process.getuid === 'function' && stat.uid !== process.getuid()) fail('PRIVATE_PATH_REQUIRED');
  return readFileSync(path, 'utf8').trim();
}

/** G8 Sprite runtime for v2 execution mode (ARCHITECTURE_V2 A1-A4).
 * Wake -> fresh boot directory -> codex-service with both lanes (coordinator and
 * task) -> maintain/settle -> once both lanes are idle past the grace period,
 * ask the Worker to prepare and commit sleep -> stop native and wait for the
 * next wake. The Worker's epoch fence is the only authority for a successor;
 * this process never replays a claim or takes over native work. The caller
 * must hold the executor lock (scripts/with-executor-lock.sh). */
export function createV2Runtime(input, dependencies = {}) {
  const config = structuredClone(input);
  // ownerBindingSha256 pins the Access owner; null only for a loopback control
  // plane (codex-service re-checks both against the Worker status).
  if (!config || Object.keys(config).some(key => !CONFIG_KEYS.includes(key)) ||
      !(typeof config.ownerBindingSha256 === 'string' && HEX64.test(config.ownerBindingSha256) || config.ownerBindingSha256 === null) || !isAbsolute(config.stateRoot ?? '') || !isAbsolute(config.binary ?? '') ||
      typeof config.installationId !== 'string' || !config.personas || typeof config.personas !== 'object' ||
      config.maintainIntervalMs !== undefined && (!Number.isInteger(config.maintainIntervalMs) ||
        config.maintainIntervalMs < 250 || config.maintainIntervalMs > 10000)) fail('INVALID_SERVICE_CONFIGURATION');
  const { createService, serviceDependencies = {}, readSecret = privateFile, now = Date.now,
    report = value => console.info(JSON.stringify(value)),
    wait = ms => new Promise(ok => setTimeout(ok, ms)), holdWake } = dependencies;
  if (typeof createService !== 'function') fail('INVALID_SERVICE_CONFIGURATION');
  const interval = config.maintainIntervalMs ?? 2000;
  let current = null, pendingEpoch = null;
  const serviceConfig = stateDirectory => ({ executionMode: 'v2', ownerBindingSha256: config.ownerBindingSha256,
    stateDirectory, binary: config.binary, portalOrigin: config.portalOrigin, runtimeTokenFile: config.runtimeTokenFile,
    installationId: config.installationId, personas: config.personas,
    ...(config.restrictedPermissions !== undefined ? { restrictedPermissions: config.restrictedPermissions } : {}),
    ...(config.nativeHome ? { nativeHome: config.nativeHome } : {}),
    ...(config.tlsCAFile ? { tlsCAFile: config.tlsCAFile } : {}),
    ...(config.accessClientIdFile ? { accessClientIdFile: config.accessClientIdFile, accessClientSecretFile: config.accessClientSecretFile } : {}) });
  const code = error => REPORTABLE.includes(error?.code) ? error.code : 'V2_RUNTIME_FAILURE';
  const runCycle = async epoch => {
    const cycle = { epoch, stop: false };
    current = cycle;
    let service;
    try {
      // A fresh boot directory per wake: the durable context lives in the
      // Worker; Codex threads are per attempt. Old boot directories are left
      // in place as diagnostics and are never reopened.
      const stateDirectory = join(config.stateRoot, `boot-${epoch}-${randomUUID()}`);
      await mkdir(stateDirectory, { mode: 0o700, recursive: false });
      service = createService(serviceConfig(stateDirectory), { ...serviceDependencies, now });
      cycle.service = service;
      await service.start();
      report({ event: 'v2.ready', epoch });
      while (!cycle.stop && service.phase === 'running') {
        await service.maintain();
        try {
          const slept = await service.sleep({ kind: 'v2-idle', epoch, at: new Date(now()).toISOString() });
          if (slept.sleeping) { report({ event: 'v2.sleep_committed', epoch }); break; }
        } catch (error) { if (error?.code !== 'SLEEP_DENIED') throw error; }
        await wait(interval);
      }
    } catch (error) {
      report({ event: 'v2.failed', epoch, code: code(error), ...(typeof error?.causeCode === 'string' ? { cause: error.causeCode } : {}), replayAllowed: false });
    } finally {
      try { await service?.stop(); }
      catch (error) { report({ event: 'v2.stop_failed', epoch, code: code(error) }); }
      report({ event: 'v2.stopped', epoch });
      current = null;
    }
  };
  const drive = async epoch => {
    for (let next = epoch; next !== null;) {
      await runCycle(next);
      next = pendingEpoch; pendingEpoch = null;
    }
  };
  let driving = null;
  const onWake = ({ epoch }) => {
    // A newer epoch means the Worker already fenced the running generation:
    // stop it promptly and boot the successor once it has stopped.
    if (current) {
      if (epoch > current.epoch) { pendingEpoch = Math.max(pendingEpoch ?? 0, epoch); current.stop = true; void current.service?.stop().catch(() => {}); }
      return;
    }
    if (driving) { pendingEpoch = Math.max(pendingEpoch ?? 0, epoch); return; }
    driving = drive(epoch).finally(() => { driving = null; });
  };
  // A Sprite pauses once the wake request is answered and no activity is held,
  // freezing boot until the next request. Hold activity before acknowledging;
  // the service's own activity hold takes over during start.
  const handler = createSpritesWakeHandler({ token: readSecret(config.wakeTokenFile), onWake,
    ...(holdWake ? { prepareWake: async ({ epoch }) => { await holdWake(epoch); return () => {}; } } : {}),
    onFailure: failure => report({ event: 'v2.wake_failed', code: failure }) });
  return {
    handler,
    get idle() { return !driving; },
    settled: () => driving ?? Promise.resolve(),
    /** Operator stop: ends the current cycle without asking for sleep. */
    async stop() {
      pendingEpoch = null;
      if (current) { current.stop = true; await current.service?.stop().catch(() => {}); }
      await driving;
    },
    server: () => http.createServer({ requestTimeout: 15000, headersTimeout: 10000, maxHeaderSize: 8192 }, (req, res) => {
      handler(req, res).catch(() => { if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('{"error":"INTERNAL_ERROR"}'); });
    }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const config = JSON.parse(privateFile(process.env.HEHEBOT_V2_CONFIG));
    const { createSpriteCodexService } = await import('./sprites-codex-service.mjs');
    const { SpritesTasksClient } = await import('../.local/codex-service/sprites.mjs');
    const { createSpritesTaskTransport } = await import('./sprites-task-transport.mjs');
    const tasks = new SpritesTasksClient(createSpritesTaskTransport({ timeoutMs: 3000 }), Date.now);
    const runtime = createV2Runtime(config, { createService: createSpriteCodexService,
      holdWake: epoch => tasks.hold({ id: `hehebot-v2-wake-${epoch}`, expiresAt: Date.now() + WAKE_HOLD_MS }) });
    const server = runtime.server();
    server.listen(config.port ?? 8080, '0.0.0.0', () => console.info(JSON.stringify({ event: 'v2.service_listening', port: config.port ?? 8080 })));
    const stop = () => server.close(() => process.exit(0));
    process.once('SIGTERM', stop); process.once('SIGINT', stop);
  } catch {
    console.error('v2 runtime configuration is invalid; no secrets printed.');
    process.exitCode = 1;
  }
}
