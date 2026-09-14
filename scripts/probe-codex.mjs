import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { spawnCodex } from '../runtime/codex-transport.mjs';

const exec = promisify(execFile);
const PINNED = '0.154.0';
const root = resolve(new URL('..', import.meta.url).pathname);
let binary = join(root, '.local/codex-runtime/node_modules/.bin/codex');
let timeoutMs = 15_000;
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--binary') binary = resolve(process.argv[++i] ?? '');
  else if (process.argv[i] === '--timeout-ms') timeoutMs = Number(process.argv[++i]);
  else throw new Error('Usage: probe-codex.mjs [--binary PATH] [--timeout-ms MS]');
}
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) throw new Error('INVALID_TIMEOUT');

const report = { versionMatch: false, handshake: false, accountRead: false, authenticated: false };
let home;
let transport;
try {
  const version = await exec(binary, ['--version'], { timeout: timeoutMs, maxBuffer: 1024 });
  report.versionMatch = version.stdout.trim() === `codex-cli ${PINNED}`;
  if (!report.versionMatch) throw new Error('VERSION_MISMATCH');
  home = await mkdtemp(join(tmpdir(), 'hehebot-codex-probe-'));
  transport = spawnCodex({ binary, home, cwd: home, timeoutMs });
  const initialized = await transport.initialize();
  if (!['codexHome', 'platformFamily', 'platformOs', 'userAgent'].every(key =>
    typeof initialized?.[key] === 'string' && initialized[key])) throw new Error('INVALID_HANDSHAKE');
  if (initialized.codexHome !== home) throw new Error('HOME_MISMATCH');
  report.handshake = true;
  const account = await transport.request('account/read', { refreshToken: false });
  if (!account || typeof account.requiresOpenaiAuth !== 'boolean') throw new Error('INVALID_ACCOUNT');
  report.accountRead = true;
  report.authenticated = account?.account != null;
} catch {
  process.exitCode = 1;
} finally {
  if (transport) {
    const child = transport.child;
    transport.close();
    const waitForExit = () => new Promise(resolveWait => {
      if (child.exitCode != null || child.signalCode != null) return resolveWait();
      const timer = setTimeout(resolveWait, Math.min(timeoutMs, 2_000));
      child.once('exit', () => { clearTimeout(timer); resolveWait(); });
    });
    await waitForExit();
    if (child.exitCode == null && child.signalCode == null) {
      child.kill('SIGKILL');
      await waitForExit();
    }
    if (child.exitCode == null && child.signalCode == null) {
      process.exitCode = 1;
      home = null; // Preserve state rather than remove files under a live process.
    }
  }
  if (home) await rm(home, { recursive: true, force: true });
  process.stdout.write(`${JSON.stringify(report)}\n`);
}
