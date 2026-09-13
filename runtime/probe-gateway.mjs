import { spawn } from 'node:child_process';
import { mkdir, writeFile, open } from 'node:fs/promises';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { GatewayTransport } from './gateway-transport.mjs';

const delay = ms => new Promise(r => setTimeout(r, ms));
/** Opt-in isolated, read-only wire proof. Fresh directory required; never imports live auth. */
export async function probeGateway({ packageRoot, directory = resolve('.local/native-transport-probe'), port = 19887 }) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('INVALID_PROBE_PORT');
  const check = createServer();
  await new Promise((resolve, reject) => { check.once('error', reject); check.listen(port, '127.0.0.1', resolve); });
  await new Promise(resolve => check.close(resolve));
  await mkdir(directory, { mode: 0o700 }); // EEXIST refuses reuse of any prior state.
  const state = join(directory, 'state'), workspace = join(directory, 'workspace');
  await mkdir(state, { mode: 0o700 }); await mkdir(workspace, { mode: 0o700 });
  const configPath = join(directory, 'openclaw.json');
  await writeFile(configPath, JSON.stringify({
    gateway: { mode: 'local', bind: 'loopback', port, auth: { mode: 'token', token: '${OPENCLAW_GATEWAY_TOKEN}', allowTailscale: false }, tailscale: { mode: 'off' }, controlUi: { enabled: false } },
    agents: { defaults: { workspace, heartbeat: { every: '0m' } } }, browser: { enabled: false },
    cron: { enabled: false }, plugins: { enabled: false }, discovery: { mdns: { mode: 'off' } },
    update: { checkOnStart: false, auto: { enabled: false } }, telemetry: { enabled: false },
  }, null, 2), { mode: 0o600 });
  const log = await open(join(directory, 'gateway.log'), 'wx', 0o600);
  const token = randomBytes(32).toString('hex');
  const env = { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR ?? '/tmp',
    OPENCLAW_HOME: directory, OPENCLAW_STATE_DIR: state, OPENCLAW_CONFIG_PATH: configPath,
    OPENCLAW_GATEWAY_TOKEN: token, OPENCLAW_SKIP_CHANNELS: '1', OPENCLAW_DISABLE_BONJOUR: '1', NO_COLOR: '1' };
  // Explicit OpenClaw home/state overrides; HOME and user credential environments are not copied.
  const child = spawn(process.execPath, [join(packageRoot, 'dist/entry.js'), 'gateway', 'run', '--port', String(port), '--bind', 'loopback'], {
    cwd: directory, env, stdio: ['ignore', log.fd, log.fd], detached: true,
  });
  const guard = process.platform === 'darwin' && child.pid ? spawn('/usr/bin/caffeinate', ['-i', '-w', String(child.pid)], { stdio: 'ignore' }) : null;
  let exit = null; child.once('exit', (code, signal) => { exit = { code, signal }; });
  let transport, report = { inspectedAt: new Date().toISOString(), launch: 'isolated', inferenceCalls: 0, externalSends: 0, status: 'blocked' };
  try {
    const until = Date.now() + 45000;
    while (Date.now() < until && !exit) {
      transport = new GatewayTransport({ url: `ws://127.0.0.1:${port}`, token, timeoutMs: 3000 });
      try {
        const hello = await transport.connect();
        const health = await transport.request('health');
        report = { ...report, status: 'passed', protocol: hello.protocol, version: hello.version, scopes: hello.scopes,
          healthReturned: !!health && typeof health === 'object', healthOk: health?.ok === true };
        delete report.reason;
        break;
      } catch (error) {
        report.reason = error.code ?? 'PROBE_FAILED';
        transport.close();
        await delay(500); // Only connection/health probe retries; never inference/mutations.
      }
    }
    if (exit) report.processExit = exit;
  } finally {
    transport?.close();
    if (child.pid && !exit) {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* child exited */ }
      const until = Date.now() + 5000;
      while (!exit && Date.now() < until) await delay(50);
      if (!exit) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { /* child exited */ }
        const killedUntil = Date.now() + 2000;
        while (!exit && Date.now() < killedUntil) await delay(50);
      }
    }
    if (guard && guard.exitCode === null) guard.kill('SIGTERM');
    await log.close();
  }
  report.processStopped = exit !== null;
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) throw new Error('Usage: node runtime/probe-gateway.mjs /path/to/installed/openclaw');
  console.log(JSON.stringify(await probeGateway({ packageRoot: resolve(process.argv[2]) }), null, 2));
}
