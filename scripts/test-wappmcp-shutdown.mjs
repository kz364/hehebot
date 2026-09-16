// Verification only. Imports installed upstream code; never starts a session/browser.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const hashes = {
  'lib/signal-handler.js': '352f493adb2db1ae3b19506ce47f51351488d612931772e8936b4e529e462cac',
  'lib/whatsapp/session.js': 'e43eed4565ad33f44b53e748c9e2e46238ec0d12beb6be4ebd51d7f101e47cdc',
  'lib/timeout.js': '8212ded37927b0975c8c0e18201306b5cd9e0c01198fd0c6e0aed7ce0dc6331f',
  'cli/mcp.js': '7e94a51c5428f6b53793dcb9d0dea5c613cf20176403fc40f997e9fff992bcb1',
};
const self = fileURLToPath(import.meta.url);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const send = value => new Promise((resolve, reject) => process.send(value, error => error ? reject(error) : resolve()));

async function runChild(installation, mode, signal = 'SIGTERM') {
  const directory = await mkdtemp(join(tmpdir(), 'hehebot-shutdown-child-'));
  const child = fork(self, ['--synthetic-child', installation, mode, signal], {
    execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    // Do not pass account/environment credentials to synthetic processes.
    env: { PATH: process.env.PATH, HOME: directory, NODE_ENV: 'test' },
  });
  const events = [];
  let output = '', forced = false, hungTimer;
  child.stdout.on('data', bytes => { output = (output + bytes).slice(-4000); });
  child.stderr.on('data', bytes => { output = (output + bytes).slice(-4000); });
  const hardTimer = setTimeout(() => { forced = true; child.kill('SIGKILL'); }, 15000);
  child.on('message', event => {
    events.push(event);
    if (event === 'ready') child.kill(signal);
    if (event === 'entered' && mode === 'hung') {
      hungTimer = setTimeout(() => child.kill('SIGKILL'), 200);
    }
  });
  try {
    const exit = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    assert.equal(forced, false, `Synthetic child exceeded 15s bound: ${mode}; ${output}`);
    assert.equal(output, '', `Unexpected child output: ${mode}`);
    return { mode, inputSignal: signal, ...exit, events };
  } finally {
    clearTimeout(hardTimer); clearTimeout(hungTimer);
    await rm(directory, { recursive: true, force: true });
  }
}

/** Caller supplies verify-wappmcp's disposable, integrity-locked scripts-disabled graph. */
export async function verifyWappMcpShutdown(installation) {
  installation = resolve(installation);
  assert.equal(JSON.parse(await readFile(join(installation, 'node_modules/wappmcp/package.json'))).version, '0.4.0');
  assert.equal(JSON.parse(await readFile(join(installation, 'node_modules/whatsapp-web.js/package.json'))).version, '1.34.7');
  for (const [path, digest] of Object.entries(hashes)) {
    const bytes = await readFile(join(installation, 'node_modules/wappmcp/dist', path));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), digest, `Unreviewed upstream file: ${path}`);
  }
  // Resolve the import-only public export in the disposable graph, not this
  // repository's dependency tree or Node's CommonJS require condition.
  await writeFile(join(installation, 'shutdown-public-api.mjs'), 'export { WhatsAppSession, register } from "wappmcp";\n');
  const results = [];
  for (const signal of ['SIGINT', 'SIGTERM']) {
    for (const mode of ['fulfilled', 'rejected', 'cross-signal', 'repeat-signal', 'hung', 'unregistered']) {
      const result = await runChild(installation, mode, signal);
      const normal = ['fulfilled', 'rejected', 'cross-signal'].includes(mode);
      assert.equal(result.code, normal ? (signal === 'SIGINT' ? 130 : 143) : null);
      assert.equal(result.signal, normal ? null : mode === 'hung' ? 'SIGKILL' : signal);
      assert.deepEqual(result.events, mode === 'unregistered' ? ['ready'] :
        mode === 'cross-signal' ? ['ready', 'entered', 'cross-ignored', 'completed'] :
        mode === 'fulfilled' ? ['ready', 'entered', 'completed'] : ['ready', 'entered']);
      results.push(result);
    }
  }
  const destroy = await runChild(installation, 'destroy');
  assert.equal(destroy.code, 0); assert.equal(destroy.signal, null);
  assert.equal(destroy.events.length, 1);
  assert.deepEqual(destroy.events[0].cases, ['graceful-profile-retained', 'logout-negative-control', 'rejected', 'timeout', 'fallback-errors', 'no-browser', 'empty']);
  return { results, destroy: { ...destroy.events[0], code: destroy.code, signal: destroy.signal }, hashes, livePairing: false,
    syntheticChildExitVerified: true, processTreeSettlementVerified: false,
    cliLifecycleVerified: false, e09Complete: false };
}

async function destroyContracts(installation) {
  const require = createRequire(join(installation, 'package.json'));
  const { WhatsAppSession } = await import(pathToFileURL(join(installation, 'shutdown-public-api.mjs')).href);
  const { Client, LocalAuth } = require('whatsapp-web.js');
  const profile = await mkdtemp(join(process.env.HOME, 'synthetic-profile-'));
  const cases = [];
  try {
    const marker = join(profile, 'synthetic-profile');
    await writeFile(marker, 'synthetic, not credentials');
    const auth = new LocalAuth({ dataPath: profile });
    auth.userDataDir = profile;
    let logouts = 0, closes = 0, listeners = 0, fallbackCalls = 0;
    const originalLogout = auth.logout.bind(auth);
    auth.logout = async () => { logouts++; await originalLogout(); };
    const client = {
      pupBrowser: { isConnected: () => true, close: async () => { closes++; },
        disconnect: async () => { fallbackCalls++; },
        process: () => { fallbackCalls++; return null; } },
      authStrategy: auth,
      destroy() { return Client.prototype.destroy.call(this); },
      logout: () => assert.fail('Destroy must not logout'),
      removeAllListeners() { listeners++; },
    };
    const session = Object.assign(Object.create(WhatsAppSession.prototype), { wwebjs: client, state: 'connected' });
    await session.destroy();
    assert.equal(session.client, null); assert.equal(session.state, 'disconnected');
    assert.equal(logouts, 0); assert.equal(closes, 1); assert.equal(listeners, 1);
    assert.equal(fallbackCalls, 0); // Upstream catches fallback exceptions, so count calls.
    assert.equal(await readFile(marker, 'utf8'), 'synthetic, not credentials');
    await session.destroy(); assert.equal(closes, 1); assert.equal(listeners, 1);
    cases.push('graceful-profile-retained');
    // The same disposable canary is genuinely removed by the actual LocalAuth logout.
    await auth.logout(); assert.equal(logouts, 1);
    await assert.rejects(access(marker), { code: 'ENOENT' });
    cases.push('logout-negative-control');

    for (const mode of ['rejected', 'timeout', 'fallback-errors', 'no-browser']) {
      const calls = [];
      let release, releaseDisconnect, destroySettled = false, disconnectSettled = false;
      const held = new Promise(resolve => { release = resolve; }).then(() => { destroySettled = true; });
      const disconnected = new Promise(resolve => { releaseDisconnect = resolve; }).then(() => { disconnectSettled = true; });
      const browser = {
        disconnect() {
          calls.push('disconnect');
          if (mode === 'fallback-errors') return Promise.reject(Error('synthetic disconnect failure'));
          return disconnected; // Must not be mistaken for completed disconnect.
        },
        process() { calls.push('process'); return { kill(signal) {
          calls.push(signal);
          if (mode === 'fallback-errors') throw Error('synthetic kill failure');
          return false; // Request did not establish a terminated process.
        } }; },
      };
      const synthetic = {
        pupBrowser: mode === 'no-browser' ? undefined : browser,
        destroy() { calls.push('destroy'); return mode === 'timeout' ? held : Promise.reject(Error('synthetic rejection')); },
        logout: () => assert.fail('Fallback must not logout'),
        removeAllListeners() { calls.push('removeAllListeners'); },
      };
      const target = Object.assign(Object.create(WhatsAppSession.prototype), { wwebjs: synthetic, state: 'connected' });
      const started = performance.now();
      const pending = target.destroy();
      assert.equal(target.client, null); assert.equal(target.state, 'disconnected');
      // A concurrent second destroy returns without waiting for the first.
      await target.destroy(); assert.deepEqual(calls, ['destroy']);
      await pending;
      const elapsed = performance.now() - started;
      assert.deepEqual(calls, mode === 'no-browser' ? ['destroy', 'removeAllListeners'] :
        ['destroy', 'removeAllListeners', 'disconnect', 'process', 'SIGKILL']);
      if (mode === 'timeout') assert.ok(elapsed >= 4900, `Upstream 5000ms timeout returned early: ${elapsed}`);
      else assert.ok(elapsed < 4000, `Rejection incorrectly waited for timeout: ${elapsed}`);
      assert.equal(destroySettled, false); assert.equal(disconnectSettled, false);
      release(); await held; assert.equal(destroySettled, true);
      releaseDisconnect(); await disconnected; assert.equal(disconnectSettled, true);
      await pause(0); // Flush rejected disconnect catch before checking the child exit.
      cases.push(mode);
    }
    const empty = Object.assign(Object.create(WhatsAppSession.prototype), { wwebjs: null, state: 'idle' });
    await empty.destroy(); assert.equal(empty.state, 'disconnected'); cases.push('empty');
    await send({ cases, upstreamTimeoutMs: 5000, fallbackIsTermination: false });
  } finally { await rm(profile, { recursive: true, force: true }); }
}

async function syntheticChild(installation, mode, signal) {
  // Independent fail-closed bound, including assertion failures and held callbacks.
  const watchdog = setTimeout(() => process.exit(97), 12000);
  if (mode === 'destroy') {
    await destroyContracts(installation); clearTimeout(watchdog); process.disconnect(); return;
  }
  const { register } = await import(pathToFileURL(join(installation, 'shutdown-public-api.mjs')).href);
  let calls = 0;
  const unregister = register(async received => {
    calls++; assert.equal(calls, 1); assert.equal(received, signal);
    await send('entered');
    if (mode === 'rejected') throw Error('synthetic callback rejection');
    if (mode === 'hung') await new Promise(() => {});
    if (mode === 'repeat-signal') { process.kill(process.pid, signal); await new Promise(() => {}); }
    if (mode === 'cross-signal') {
      process.kill(process.pid, signal === 'SIGINT' ? 'SIGTERM' : 'SIGINT');
      await pause(50);
      assert.equal(calls, 1);
      assert.equal(process.listenerCount('SIGINT'), 0); assert.equal(process.listenerCount('SIGTERM'), 0);
      await send('cross-ignored');
    }
    await send('completed');
  });
  if (mode === 'unregistered') unregister();
  await send('ready');
}

if (process.argv[2] === '--synthetic-child' && resolve(process.argv[1]) === self) {
  await syntheticChild(process.argv[3], process.argv[4], process.argv[5]);
}
