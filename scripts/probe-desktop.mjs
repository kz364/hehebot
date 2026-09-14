// Credential-free Linux X11 proof using only the packaged CLI and named RPCs.
// Prerequisites: Xvfb, Openbox, dbus-run-session, GTK3/Python GI, at-spi2-core,
// x11-utils and xdotool. Run serve ONLY under `amp orb service start`.
// prepare <package-root> <fresh-private-directory>
// serve|status|proof <package-root> <prepared-directory>
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile, open, lstat } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const exec = promisify(execFile), delay = ms => new Promise(r => setTimeout(r, ms));
const self = fileURLToPath(import.meta.url);
const [mode, rootArg, dirArg] = process.argv.slice(2);
if (!rootArg || !dirArg) throw new Error('Usage: probe-desktop.mjs prepare|serve|status|proof <package-root> <private-directory>');
const root = resolve(rootArg), dir = resolve(dirArg), cli = join(root, 'openclaw.mjs');
const port = 29431, display = ':99';
const clean = {
  PATH: process.env.PATH, HOME: dir, TMPDIR: join(dir, 'tmp'),
  XDG_CONFIG_HOME: join(dir, 'config'), XDG_CACHE_HOME: join(dir, 'cache'),
  OPENCLAW_HOME: dir, OPENCLAW_SKIP_CHANNELS: '1', OPENCLAW_DISABLE_BONJOUR: '1',
  NO_COLOR: '1', NO_AT_BRIDGE: '0', DISPLAY: display, XDG_SESSION_TYPE: 'x11',
};
function env(role) {
  return { ...clean, OPENCLAW_STATE_DIR: join(dir, role), OPENCLAW_CONFIG_PATH: join(dir, `${role}.json`),
    ...(process.env.DBUS_SESSION_BUS_ADDRESS && mode === 'desktop' ? {DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS} : {}) };
}
async function json(path, value) { await writeFile(path, JSON.stringify(value, null, 2), {mode: 0o600}); }
async function command(args, role = 'gateway') {
  try {
    return await exec(process.execPath, [cli, ...args], {env: env(role), cwd: dir, maxBuffer: 16 * 1024 * 1024, timeout: 45000});
  } catch (error) {
    // Never print CLI command arguments, credentials, or arbitrary native errors.
    let native;
    try { native = JSON.parse(error.stdout).error; } catch {}
    const nodeCode = native?.details?.nodeError?.code;
    const code = error.stdout?.match(/COMPUTER_[A-Z_]+/)?.[0] ?? (['TIMEOUT', 'ABORTED'].includes(nodeCode) ? nodeCode : 'NATIVE_CLI_FAILED');
    throw Object.assign(new Error(code), {code, dispatched: native?.details?.nodeCommandDispatched === true});
  }
}
async function rpc(method, params = {}) {
  const result = await command(['gateway', 'call', method, '--params', JSON.stringify(params), '--json', '--timeout', '30000']);
  return JSON.parse(result.stdout);
}

if (mode !== 'prepare') {
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'probe.json'))), {kind: 'credential-free-desktop-probe', root, directory: dir});
  assert.equal((await lstat(dir)).mode & 0o777, 0o700);
}
if (mode === 'prepare') {
  assert.equal(JSON.parse(await readFile(join(root, 'package.json'))).version, '2026.9.3');
  await mkdir(dir, {mode: 0o700}); // Never reuse operator or previous proof state.
  for (const name of ['gateway', 'node', 'workspace', 'tmp', 'config', 'cache']) await mkdir(join(dir, name), {mode: 0o700});
  const token = randomBytes(32).toString('hex');
  const base = {
    agents: {defaults: {workspace: join(dir, 'workspace'), heartbeat: {every: '0m'}}},
    models: {catalogRefresh: {enabled: false}},
    logging: {file: join(dir, 'openclaw.log')},
    browser: {enabled: false}, nodeHost: {browserProxy: {enabled: false}},
    cron: {enabled: false}, hooks: {enabled: false},
    plugins: {allow: ['cua-computer'], slots: {memory: 'none'}, entries: {'cua-computer': {enabled: true}}},
    discovery: {mdns: {mode: 'off'}}, update: {checkOnStart: false, auto: {enabled: false}}, telemetry: {enabled: false},
  };
  await json(join(dir, 'gateway.json'), {...base, gateway: {
    mode: 'local', bind: 'loopback', port, auth: {mode: 'token', token, allowTailscale: false},
    tailscale: {mode: 'off'}, controlUi: {enabled: false},
    nodes: {pairing: {sshVerify: false}, commands: {deny: ['system.run', 'system.run.prepare', 'system.which', 'system.execApprovals.get', 'system.execApprovals.set', 'browser.proxy', 'browser.proxy.upload.v1', 'fs.listDir', 'terminal.upload', 'mcp.tools.call.v1']}},
  }});
  await json(join(dir, 'node.json'), {...base, gateway: {mode: 'remote', remote: {url: `ws://127.0.0.1:${port}`, token}}});
  const doctor = await command(['doctor', '--lint', '--only', 'cua-computer/driver-artifacts', '--json'], 'node');
  const result = JSON.parse(doctor.stdout); assert.equal(result.ok, true); assert.equal(result.checksRun, 1);
  await json(join(dir, 'doctor.json'), result);
  await json(join(dir, 'probe.json'), {kind: 'credential-free-desktop-probe', root, directory: dir});
  console.log(JSON.stringify({prepared: true, driverDoctor: result, directory: dir}));
} else if (mode === 'serve') {
  for (const path of ['/tmp/.X11-unix/X99', '/tmp/.X99-lock']) {
    const occupied = await lstat(path).then(() => true, error => {if (error.code !== 'ENOENT') throw error; return false;});
    assert.equal(occupied, false, 'X11_DISPLAY_ALREADY_IN_USE');
  }
  const check = createServer();
  await new Promise((resolve, reject) => {check.once('error', reject); check.listen(port, '127.0.0.1', resolve);});
  await new Promise(resolve => check.close(resolve));
  const child = spawn('dbus-run-session', ['--', process.execPath, self, 'desktop', root, dir], {env: clean, stdio: 'inherit'});
  process.once('SIGTERM', () => child.kill('SIGTERM'));
  process.once('SIGINT', () => child.kill('SIGTERM'));
  child.once('exit', code => {process.exitCode = code ?? 1;});
} else if (mode === 'desktop') {
  const children = [];
  let stopping = false;
  const stop = () => {stopping = true; for (const child of children.toReversed()) child.kill('SIGTERM');};
  async function start(name, executable, args, environment) {
    assert.equal(stopping, false, 'DESKTOP_SERVICE_STOPPED');
    const log = await open(join(dir, `${name}.log`), 'a', 0o600);
    const child = spawn(executable, args, {env: environment, cwd: dir, stdio: ['ignore', log.fd, log.fd]});
    child.once('error', () => {process.exitCode = 1; stop();});
    child.once('exit', () => {if (!stopping) {process.exitCode = 1; stop();}});
    children.push(child); await log.close(); return child;
  }
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  await start('xvfb', 'Xvfb', [display, '-screen', '0', '1280x800x24', '-nolisten', 'tcp'], env('node'));
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {await exec('xdpyinfo', [], {env: env('node')}); ready = true; break;} catch {await delay(100);}
  }
  assert.ok(ready, 'X11 startup failed');
  await start('openbox', 'openbox', [], env('node'));
  await start('fixture', '/usr/bin/python3', [join(dirname(self), 'fixtures/native-desktop.py'), dir], env('node'));
  await start('gateway', process.execPath, [cli, 'gateway', 'run', '--auth', 'token', '--bind', 'loopback', '--port', String(port)], env('gateway'));
  ready = false;
  for (let i = 0; i < 30 && !stopping; i++) {try {assert.equal((await rpc('health')).ok, true); ready = true; break;} catch {await delay(500);}}
  if (!ready) {stop(); throw new Error('GATEWAY_STARTUP_FAILED');}
  await start('node', process.execPath, [cli, 'node', 'run', '--host', '127.0.0.1', '--port', String(port), '--display-name', 'Credential-free X11 proof'], env('node'));
  console.log('DESKTOP_PROBE_SERVICES_STARTED');
} else if (mode === 'status') {
  console.log(JSON.stringify({devices: await rpc('device.pair.list'), nodes: await rpc('node.pair.list'), connected: await rpc('node.list')}, null, 2));
} else if (mode === 'proof') {
  await json(join(dir, 'report.json'), {status: 'blocked', reason: 'PROOF_NOT_COMPLETED'});
  const pending = (await rpc('node.pair.list')).pending;
  assert.ok(pending.length <= 1, 'Unexpected node pairing request');
  for (const request of pending) {
    assert.equal(request.displayName, 'Credential-free X11 proof');
    assert.deepEqual(request.commands.toSorted(), ['computer.act', 'screen.snapshot']);
    await command(['nodes', 'approve', request.requestId, '--json']);
  }
  const nodes = (await rpc('node.list')).nodes.filter(node => node.connected);
  assert.equal(nodes.length, 1);
  const node = nodes[0];
  assert.deepEqual(node.commands.toSorted(), ['computer.act', 'screen.snapshot']);
  const executionId = randomUUID();
  const invoke = (command, params, timeoutMs = 20000) => rpc('node.invoke', {nodeId: node.nodeId, command, params: {executionId, ...params}, timeoutMs, idempotencyKey: randomUUID()});
  let report;
  try {
    const description = await rpc('node.describe', {nodeId: node.nodeId});
    assert.equal(description.computerUse.provider.id, 'cua-computer');
    await json(join(dir, 'node-description.json'), description);
    // The documented proof orders capture first: it initializes this execution's
    // SDK generation before the provider issues window references.
    await invoke('screen.snapshot', {format: 'png', maxWidth: 1280});
    const windows = (await invoke('computer.act', {action: 'list_windows'})).payload.details.windows;
    const target = windows.find(window => window.title === 'OpenClaw CUA X11 Target');
    const sentinel = windows.find(window => window.title === 'OpenClaw CUA X11 Sentinel');
    assert.ok(target); assert.ok(sentinel);
    await invoke('computer.act', {action: 'bring_to_front', windowRef: sentinel.windowRef});
    const snapshot = (await invoke('screen.snapshot', {format: 'png', maxWidth: 1280})).payload;
    assert.equal(snapshot.width, 1280); assert.equal(snapshot.height, 800); assert.ok(snapshot.displayFrameId);
    await writeFile(join(dir, 'desktop-before.png'), Buffer.from(snapshot.base64, 'base64'), {mode: 0o600});
    const state = (await invoke('computer.act', {action: 'get_window_state', windowRef: target.windowRef})).payload;
    await json(join(dir, 'window-state.json'), state);
    const element = state.observation.elements.find(element => element.label === 'Proof text');
    assert.ok(element);
    async function desktopState() {
      const active = (await exec('xdotool', ['getactivewindow', 'getwindowname'], {env: clean})).stdout.trim();
      const pointer = (await exec('xdotool', ['getmouselocation', '--shell'], {env: clean})).stdout.split('\n').filter(line => /^[XY]=/.test(line));
      const fixture = JSON.parse(await readFile(join(dir, 'fixture-state.json')));
      return {active, pointer, text: fixture.text};
    }
    const before = await desktopState();
    assert.equal(before.active, 'OpenClaw CUA X11 Sentinel');
    const text = `CREDENTIAL FREE DESKTOP ${randomUUID().slice(0, 8)}`;
    const input = (await invoke('computer.act', {action: 'type', text, windowRef: target.windowRef, elementRef: element.elementRef,
      observationId: state.observation.observationId, deliveryMode: 'background'})).payload;
    await json(join(dir, 'background-result.json'), input);
    const after = await desktopState();
    assert.equal(after.active, before.active); assert.deepEqual(after.pointer, before.pointer);
    assert.notEqual(after.text, before.text); assert.ok(after.text.includes(text));
    const resized = (await invoke('screen.snapshot', {format: 'png', maxWidth: 640})).payload;
    assert.equal(resized.width, 640);
    await assert.rejects(invoke('computer.act', {action: 'left_click', displayFrameId: snapshot.displayFrameId,
      refWidth: snapshot.width, x: 330, y: 178}), {code: 'COMPUTER_STALE_FRAME'});
    assert.deepEqual(await desktopState(), after);
    const final = (await invoke('screen.snapshot', {format: 'png', maxWidth: 1280})).payload;
    await writeFile(join(dir, 'desktop-background.png'), Buffer.from(final.base64, 'base64'), {mode: 0o600});
    // Independent foreground test, not an automatic retry of background input.
    await invoke('computer.act', {action: 'left_click', displayFrameId: final.displayFrameId, refWidth: final.width,
      x: Math.round(element.bounds.x + element.bounds.width / 2), y: Math.round(element.bounds.y + element.bounds.height / 2)});
    await invoke('computer.act', {action: 'key', keys: 'ctrl+a'});
    await invoke('computer.act', {action: 'type', text: 'NATIVE FOREGROUND INPUT 42'});
    const foreground = await desktopState();
    assert.equal(foreground.active, 'OpenClaw CUA X11 Target');
    assert.equal(foreground.text, 'NATIVE FOREGROUND INPUT 42');
    await assert.rejects(invoke('computer.act', {action: 'left_mouse_down'}), {code: 'COMPUTER_UNSUPPORTED_ACTION'});
    let timeoutProbe;
    try {
      await invoke('screen.snapshot', {format: 'png', maxWidth: 1280}, 5);
      timeoutProbe = {outcome: 'completed-before-timeout'};
    } catch (error) {
      assert.equal(error.code, 'TIMEOUT');
      timeoutProbe = {outcome: error.code, dispatched: error.dispatched};
    }
    const recovery = (await invoke('screen.snapshot', {format: 'png', maxWidth: 1280})).payload;
    assert.equal(recovery.width, 1280);
    assert.deepEqual(await desktopState(), foreground);
    await writeFile(join(dir, 'desktop-after.png'), Buffer.from(recovery.base64, 'base64'), {mode: 0o600});
    report = {status: 'passed-with-limitations', nativeVersion: description.version, provider: description.computerUse.provider.id,
      screenshot: [snapshot.width, snapshot.height], windowDiscovery: true, backgroundText: {before, after, effect: input.effect},
      foreground, staleFrameRejected: true, advertisedHeldInputRejected: true, timeoutProbe, postTimeoutSnapshot: true, inferenceCalls: 0,
      limitations: ['Native background effect may be unverifiable despite independently observed text mutation.',
        'Timeout and subsequent recovery do not prove delivery of the SDK cancellation signal or arbitrary-tool settlement.']};
  } finally {
    // Exact-execution lifecycle envelope used by the pinned built-in computer
    // tool's dispose(). It is not a model action or an alternate driver API.
    const closed = await invoke('computer.act', {action: '__close_execution', reason: 'credential-free-proof-complete'});
    assert.equal(closed.payload.ok, true);
  }
  report.executionClosed = true;
  await json(join(dir, 'report.json'), report);
  console.log(JSON.stringify(report, null, 2));
} else {
  throw new Error('Unknown probe phase');
}
