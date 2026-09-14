#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PINNED_OPENCLAW } from '../runtime/openclaw-adapter.mjs';
import { probeGateway } from '../runtime/probe-gateway.mjs';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const packageRoot = resolve(process.env.CLAWBOT_OPENCLAW_PACKAGE_ROOT ?? '.local/native-execution/node_modules/openclaw');
const summary = { status: 'blocked', scope: 'credential-free native and control integration', assistantOperational: false, desktop: 'not-requested' };

async function prerequisite() {
  let manifest;
  try { manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')); }
  catch { throw new Error('PINNED_OPENCLAW_MISSING'); }
  if (manifest.version !== PINNED_OPENCLAW) throw new Error('PINNED_OPENCLAW_VERSION_MISMATCH');
}

async function command(label, file, args, { capture = false, timeout = 240_000 } = {}) {
  console.log(`\n==> ${label}`);
  const child = spawn(file, args, {
    cwd: resolve('.'), env: { ...process.env, OPENCLAW_PACKAGE_ROOT: packageRoot, CLAWBOT_OPENCLAW_PACKAGE_ROOT: packageRoot },
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit', detached: process.platform !== 'win32',
  });
  let stdout = '';
  if (capture) child.stdout.on('data', chunk => { stdout += chunk; process.stdout.write(chunk); });
  let timedOut = false;
  let killTimer;
  const timer = setTimeout(() => {
    timedOut = true;
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
    killTimer = setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }, 2_000);
  }, timeout);
  let result;
  try {
    result = await new Promise((done, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => done({ code, signal }));
    });
  } finally {
    clearTimeout(timer);
    clearTimeout(killTimer);
  }
  if (timedOut) throw new Error(`${label}:TIMEOUT`);
  if (result.code !== 0) throw new Error(`${label}:FAILED`);
  return stdout;
}

async function availablePort() {
  const server = createServer();
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
  const port = server.address().port;
  await new Promise(ok => server.close(ok));
  return port;
}

try {
  if (process.argv.slice(2).some(arg => !['--preflight-only', '--desktop'].includes(arg))) throw new Error('INVALID_ARGUMENT');
  await prerequisite();
  if (process.argv.includes('--preflight-only')) {
    summary.scope = 'native version preflight only';
    summary.status = 'passed';
  } else {
    await command('setup checks', process.execPath, ['--test', 'tests/setup-local.test.mjs']);
    await command('unit checks', 'npm', ['test']);
    await command('runtime checks', 'npm', ['run', 'test:runtime']);
    await command('import checks', process.execPath, ['--test', 'tests/bot-import.test.mjs']);
    const nativeOutput = await command('native source checks', process.execPath, ['--test', 'tests/native-orchestration-contracts.test.mjs'], { capture: true });
    if (/(?:# SKIP|skipped\s+[1-9])/i.test(nativeOutput)) throw new Error('NATIVE_SOURCE_CHECK_SKIPPED');
    await command('Amp smoke checks (mocked; no model calls)', process.execPath, ['--test', 'tests/amp-smoke.test.mjs']);
    await command('HTTP end-to-end checks', 'npm', ['run', 'test:e2e']);
    await command('disk-backed Worker restart', process.execPath, ['scripts/test-control-restart.mjs']);
    await command('native agent with scripted loopback model', process.execPath, ['scripts/test-native-agent.mjs']);
    await command('portal to native tool and persisted reply', process.execPath, ['scripts/test-native-bridge.mjs']);
    await command('native browser acceptance', process.execPath, ['scripts/test-native-browser.mjs']);
    if (process.argv.includes('--desktop')) {
      await command('native Linux desktop acceptance', 'bash', ['scripts/test-desktop.sh']);
      summary.desktop = 'passed-with-documented-limitations';
    }
    await command('build', 'npm', ['run', 'build']);
    const parent = await mkdtemp(join(tmpdir(), 'clawbot-gateway-probe-'));
    let stopped = false;
    try {
      const report = await probeGateway({ packageRoot, directory: join(parent, 'fresh'), port: await availablePort() });
      stopped = report.processStopped === true;
      if (report.status !== 'passed' || report.healthOk !== true || report.processStopped !== true) throw new Error('GATEWAY_HEALTH_BLOCKED');
      summary.gateway = { healthOk: true, processStopped: true, inferenceCalls: 0, externalSends: 0 };
    } finally {
      if (stopped) await rm(parent, { recursive: true, force: true });
      else summary.probeDirectory = parent; // Preserve state if a process may still own it.
    }
    summary.status = 'passed';
  }
} catch (error) {
  summary.reason = String(error?.message ?? 'VERIFICATION_FAILED').replace(/[^A-Za-z0-9:_ -]/g, '').slice(0, 120);
  process.exitCode = 1;
}
console.log(`\n${JSON.stringify(summary)}`);
