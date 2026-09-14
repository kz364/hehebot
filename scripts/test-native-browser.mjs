#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { spawn } from 'node:child_process';
import { access, appendFile, copyFile, mkdtemp, mkdir, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { PINNED_OPENCLAW } from '../runtime/openclaw-adapter.mjs';

const root = resolve(import.meta.dirname, '..');
const packageRoot = resolve(process.env.CLAWBOT_OPENCLAW_PACKAGE_ROOT ?? join(root, '.local/native-execution/node_modules/openclaw'));
const entry = join(packageRoot, 'dist/entry.js');
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const reportPath = resolve(root, '.local/native-browser-acceptance-report.json');
const checks = [];
let privateDir;
let gateway;
let log;
let server;
let retainPrivateState = false;

function boundedSanitized(value) {
  return String(value ?? 'unknown error').replaceAll(token, '[REDACTED_TOKEN]').slice(0, 2_000);
}

async function executable(path) {
  try { await access(path, constants.X_OK); return (await stat(path)).isFile(); } catch { return false; }
}

async function findChrome() {
  if (process.env.CLAWBOT_CHROME_EXECUTABLE) {
    const candidate = resolve(process.env.CLAWBOT_CHROME_EXECUTABLE);
    if (!await executable(candidate)) throw new Error('CLAWBOT_CHROME_EXECUTABLE is not an executable file');
    return candidate;
  }
  const browserRoot = '/home/user/.agent-browser/browsers';
  const versions = (await readdir(browserRoot)).filter((name) => name.startsWith('chrome-')).sort().reverse();
  for (const version of versions) {
    const candidate = join(browserRoot, version, 'chrome');
    if (await executable(candidate)) return candidate;
  }
  throw new Error('no executable Chrome for Testing found; set CLAWBOT_CHROME_EXECUTABLE');
}

function awaitExit(child, timeout) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  return new Promise((resolveExit) => {
    const timer = setTimeout(() => { child.off('exit', onExit); resolveExit(null); }, timeout);
    const onExit = (code, signal) => { clearTimeout(timer); resolveExit({ code, signal }); };
    child.once('exit', onExit);
  });
}

async function terminateAndWait(child, label) {
  const exited = await awaitExit(child, 0);
  if (exited) return exited;
  child.kill('SIGTERM');
  let result = await awaitExit(child, 5_000);
  if (result) return result;
  child.kill('SIGKILL');
  result = await awaitExit(child, 5_000);
  if (!result) throw new Error(`${label} shutdown could not be confirmed`);
  return result;
}

function check(name, fn) {
  fn();
  checks.push(name);
}

async function freePort() {
  const socket = createServer();
  await new Promise((ok, fail) => socket.once('error', fail).listen(0, '127.0.0.1', ok));
  const { port } = socket.address();
  await new Promise((ok) => socket.close(ok));
  return port;
}

async function run(args, { allowFailure = false, timeout = 30_000 } = {}) {
  return await new Promise((done, fail) => {
    const child = spawn(process.execPath, [entry, ...args], {
      cwd: privateDir,
      env: nativeEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (part) => { stdout += part; });
    child.stderr.on('data', (part) => { stderr += part; });
    let settled = false;
    const reject = async (error, terminate = true) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (terminate) {
        try { await terminateAndWait(child, 'timed-out native CLI'); } catch (shutdownError) { retainPrivateState = true; error = shutdownError; }
      }
      await appendFile(join(privateDir, 'cli-errors.log'), `${new Date().toISOString()} ${boundedSanitized(error)}\n`, { mode: 0o600 }).catch(() => {});
      fail(new Error(boundedSanitized(error)));
    };
    const timer = setTimeout(() => { void reject(new Error('native OpenClaw command timed out')); }, timeout);
    child.once('error', (error) => { void reject(new Error(`native OpenClaw spawn failed: ${error.message}`), false); });
    child.once('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const result = { code, signal, stdout, stderr };
      if (code === 0 || allowFailure) done(result);
      else {
        const detail = boundedSanitized(stderr || stdout);
        void appendFile(join(privateDir, 'cli-errors.log'), `${new Date().toISOString()} ${detail}\n`, { mode: 0o600 });
        fail(new Error(`native OpenClaw command failed (${code ?? signal}): ${detail}`));
      }
    });
  });
}

async function browser(...args) {
  return (await run(['browser', '--browser-profile', 'openclaw', '--url', `ws://127.0.0.1:${gatewayPort}`, '--token', token, ...args])).stdout;
}

function refFor(snapshot, accessibleName) {
  const line = snapshot.split('\n').find((candidate) => candidate.includes(accessibleName) && /ref=[A-Za-z0-9_-]+/.test(candidate));
  assert.ok(line, `snapshot did not contain a ref for ${accessibleName}`);
  return line.match(/ref=([A-Za-z0-9_-]+)/)[1];
}

function findDownloadPath(value) {
  if (!value || typeof value !== 'object') return undefined;
  if (typeof value.path === 'string') return value.path;
  for (const nested of Object.values(value)) {
    const found = findDownloadPath(nested);
    if (found) return found;
  }
}

function findExactFormResult(value) {
  if (typeof value === 'string') {
    try { return findExactFormResult(JSON.parse(value)); } catch { return undefined; }
  }
  if (!value || typeof value !== 'object') return undefined;
  if (Object.hasOwn(value, 'name') && Object.hasOwn(value, 'consent') && Object.hasOwn(value, 'upload')) return value;
  for (const nested of Object.values(value)) {
    const found = findExactFormResult(nested);
    if (found) return found;
  }
}

async function startGateway() {
  gateway = spawn(process.execPath, [entry, 'gateway', 'run', '--port', String(gatewayPort), '--bind', 'loopback'], {
    cwd: privateDir,
    env: nativeEnv,
    stdio: ['ignore', log.fd, log.fd],
    detached: true,
  });
  let exited = false;
  gateway.once('exit', () => { exited = true; });
  for (let i = 0; i < 90; i++) {
    if (exited) throw new Error('native Gateway exited during startup (see private gateway.log)');
    const ready = await new Promise((done) => {
      const socket = connect(gatewayPort, '127.0.0.1');
      socket.once('connect', () => { socket.destroy(); done(true); });
      socket.once('error', () => done(false));
    });
    if (ready) return;
    await delay(500);
  }
  throw new Error('native Gateway readiness timed out (see private gateway.log)');
}

async function stopGateway() {
  if (!gateway) return;
  try { await terminateAndWait(gateway, 'native Gateway'); }
  catch (error) { retainPrivateState = true; throw error; }
}

const gatewayPort = await freePort();
const fixturePort = await freePort();
const token = randomBytes(32).toString('hex');
let nativeEnv;
const report = { status: 'failed', package: `openclaw@${PINNED_OPENCLAW}`, assertions: checks, limitations: [], inferenceCalls: 0, externalSends: 0 };

try {
  const chrome = await findChrome();
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  check('native package matches runtime pin', () => assert.equal(manifest.version, PINNED_OPENCLAW));
  await Promise.all([readFile(entry), readFile(resolve(root, 'tests/form.html')), readFile(resolve(root, 'tests/upload.txt'))]);
  privateDir = await mkdtemp(join(tmpdir(), 'clawbot-native-browser-'));
  const state = join(privateDir, 'state');
  const workspace = join(privateDir, 'workspace');
  const tempRoot = join(privateDir, 'tmp');
  await Promise.all([mkdir(join(state, 'media/inbound'), { recursive: true }), mkdir(workspace), mkdir(tempRoot)]);
  const uploadPath = join(state, 'media/inbound/upload.txt');
  await copyFile(resolve(root, 'tests/upload.txt'), uploadPath);
  const configPath = join(privateDir, 'openclaw.json');
  await writeFile(configPath, JSON.stringify({
    gateway: { mode: 'local', bind: 'loopback', port: gatewayPort, auth: { mode: 'token', token: '${OPENCLAW_GATEWAY_TOKEN}', allowTailscale: false }, tailscale: { mode: 'off' }, controlUi: { enabled: false } },
    agents: { defaults: { workspace, heartbeat: { every: '0m' } } },
    browser: { enabled: true, defaultProfile: 'openclaw', headless: true, executablePath: chrome, ssrfPolicy: { allowedHostnames: ['127.0.0.1'] }, profiles: { openclaw: { cdpPort: await freePort(), headless: true, executablePath: chrome } } },
    cron: { enabled: false }, plugins: { allow: ['browser'], entries: { browser: { enabled: true } } }, discovery: { mdns: { mode: 'off' } },
    update: { checkOnStart: false, auto: { enabled: false } }, telemetry: { enabled: false },
  }, null, 2), { mode: 0o600 });
  log = await open(join(privateDir, 'gateway.log'), 'wx', 0o600);
  nativeEnv = { PATH: process.env.PATH, TMPDIR: tempRoot, OPENCLAW_HOME: privateDir, OPENCLAW_STATE_DIR: state, OPENCLAW_CONFIG_PATH: configPath, OPENCLAW_GATEWAY_TOKEN: token, OPENCLAW_SKIP_CHANNELS: '1', OPENCLAW_DISABLE_BONJOUR: '1', NO_COLOR: '1' };

  const fixture = await readFile(resolve(root, 'tests/form.html'));
  server = createServer((req, res) => {
    if (req.url === '/form.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fixture); }
    else { res.writeHead(404); res.end('not found'); }
  });
  await new Promise((ok, fail) => server.once('error', fail).listen(fixturePort, '127.0.0.1', ok));
  await startGateway();
  await browser('start');
  const fixtureUrl = `http://127.0.0.1:${fixturePort}/form.html`;
  await browser('open', fixtureUrl, '--label', 'acceptance-task');
  let snapshot = await browser('snapshot', '--target-id', 'acceptance-task');
  check('actual fixture title and form visible in native snapshot', () => { assert.match(snapshot, /Local form test/); assert.match(snapshot, /Full name/); });
  await browser('open', fixtureUrl, '--label', 'independent-task');
  const independentSnapshot = await browser('snapshot', '--target-id', 'independent-task');
  await browser('fill', '--target-id', 'independent-task', '--fields', JSON.stringify([
    { ref: refFor(independentSnapshot, 'Full name'), value: 'Independent tab state' },
  ]));
  await browser('fill', '--target-id', 'acceptance-task', '--fields', JSON.stringify([
    { ref: refFor(snapshot, 'Full name'), value: 'Ada Lovelace' },
    { ref: refFor(snapshot, 'Email'), value: 'ada+native@example.test' },
    { ref: refFor(snapshot, 'Date'), value: '1843-12-10' },
  ]));
  await browser('select', refFor(snapshot, 'Category'), 'Research', '--target-id', 'acceptance-task');
  await browser('click', refFor(snapshot, 'Test consent'), '--target-id', 'acceptance-task');
  await browser('click', refFor(snapshot, 'Next step'), '--target-id', 'acceptance-task');
  await browser('wait', '--text', 'Dynamic note', '--target-id', 'acceptance-task');
  snapshot = await browser('snapshot', '--target-id', 'acceptance-task');
  await browser('upload', uploadPath, '--ref', refFor(snapshot, 'Upload test file'), '--target-id', 'acceptance-task');
  await browser('type', refFor(snapshot, 'Dynamic note'), 'appeared after step transition', '--target-id', 'acceptance-task');
  await browser('click', refFor(snapshot, 'Finish test'), '--target-id', 'acceptance-task');
  const resultOutput = await browser('--json', 'evaluate', '--target-id', 'acceptance-task', '--fn', '() => JSON.parse(document.querySelector("#result").textContent)');
  const result = findExactFormResult(JSON.parse(resultOutput));
  check('submitted form object has every exact value', () => assert.deepEqual(result, {
    name: 'Ada Lovelace', email: 'ada+native@example.test', category: 'Research', date: '1843-12-10',
    consent: 'on', upload: 'upload.txt', note: 'appeared after step transition',
  }));
  const independentOutput = await browser('--json', 'evaluate', '--target-id', 'independent-task', '--fn', '() => ({ name: document.querySelector("#name").value, step: getComputedStyle(document.querySelector("#step1")).display })');
  const independentState = JSON.parse(independentOutput);
  const findIndependent = (value) => {
    if (!value || typeof value !== 'object') return undefined;
    if (value.name === 'Independent tab state' && typeof value.step === 'string') return value;
    for (const nested of Object.values(value)) { const found = findIndependent(nested); if (found) return found; }
  };
  check('actions on first task do not mutate second task', () => assert.deepEqual(findIndependent(independentState), { name: 'Independent tab state', step: 'block' }));

  snapshot = await browser('snapshot', '--target-id', 'acceptance-task');
  const downloaded = await browser('--json', 'download', refFor(snapshot, 'Download test file'), 'native-download.txt', '--target-id', 'acceptance-task');
  const downloadPath = findDownloadPath(JSON.parse(downloaded));
  const downloadContent = await readFile(downloadPath, 'utf8');
  check('download content exact', () => assert.equal(downloadContent, 'OpenClaw download verified\n'));
  await browser('storage', 'local', 'set', 'native-proof', 'survives-restart', '--target-id', 'acceptance-task');

  const bad = await run(['browser', '--browser-profile', 'openclaw', '--url', `ws://127.0.0.1:${gatewayPort}`, '--token', token, 'snapshot', '--target-id', 'definitely-wrong-target'], { allowFailure: true });
  check('explicit wrong target rejected for target lookup', () => {
    assert.notEqual(bad.code, 0);
    assert.match(`${bad.stderr}\n${bad.stdout}`, /target[^\n]*(?:not found|unknown|does not exist)|(?:not found|unknown)[^\n]*target/i);
  });
  await stopGateway();
  await startGateway();
  const tabsAfter = await browser('tabs');
  if (!/acceptance-task/.test(tabsAfter)) report.limitations.push(`OpenClaw ${PINNED_OPENCLAW} closes managed Chrome with the Gateway, so live task tab identity cannot survive a Gateway restart.`);
  await browser('start');
  await browser('open', fixtureUrl, '--label', 'acceptance-task-restored');
  const storage = await browser('storage', 'local', 'get', '--target-id', 'acceptance-task-restored');
  check('synthetic browser profile storage survives managed browser and Gateway restart', () => assert.match(storage, /survives-restart/));
  report.status = 'passed';
} catch (error) {
  report.error = boundedSanitized(error instanceof Error ? error.message : error);
  if (privateDir) await appendFile(join(privateDir, 'cli-errors.log'), `${new Date().toISOString()} ${report.error}\n`, { mode: 0o600 }).catch(() => {});
  process.exitCode = 1;
} finally {
  try { if (gateway?.exitCode === null) await browser('stop'); } catch { /* cleanup continues */ }
  try { await stopGateway(); } catch (error) {
    report.status = 'failed';
    report.error = boundedSanitized(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
  if (server) await new Promise((ok) => server.close(ok));
  if (log) await log.close().catch(() => {});
  report.completedAt = new Date().toISOString();
  if (privateDir && retainPrivateState) report.privateStateRetained = privateDir;
  await mkdir(resolve(root, '.local'), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
  if (privateDir && !retainPrivateState) await rm(privateDir, { recursive: true, force: true });
  console.log(JSON.stringify({ ...report, reportPath }, null, 2));
}
