import { spawn } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readOwnerAlphaConfig } from './owner-alpha-entry.mjs';
import { ownerAlphaPolicy } from './owner-alpha-policy.mjs';

const fail = () => { throw new Error('HOSTED_OWNER_LAUNCH_REFUSED'); };
const lockScript = fileURLToPath(new URL('../scripts/with-executor-lock.sh', import.meta.url));
const entry = fileURLToPath(new URL('./owner-alpha-entry.mjs', import.meta.url));

/** Explicit locked launch. Locks exclude cooperating launchers, not arbitrary
 * native descendants after wrapper failure. No retry or deployment; callers own wake authorization. */
export async function launchHostedOwnerAlpha(path, { signal, expectedSha256, spawnImpl = spawn } = {}) {
  const { config, sha256 } = await readOwnerAlphaConfig(path, expectedSha256);
  if (typeof config?.hostedOwnerBindingSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(config.hostedOwnerBindingSha256)) fail();
  ownerAlphaPolicy(config.ownerAlpha);
  const directories = [];
  for (const directory of [config.nativeHome, config.stateDirectory]) {
    if (typeof directory !== 'string' || !isAbsolute(directory)) fail();
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || stat.mode & 0o077) fail();
    directories.push(stat);
  }
  if (directories[0].dev === directories[1].dev && directories[0].ino === directories[1].ino || signal?.aborted) fail();
  // Fixed lock order: native home first, then session. Both survive shell exec.
  // Child re-reads only bytes matching this digest before any account work, so
  // an owner config edit cannot silently substitute a directory after locking.
  const child = spawnImpl('bash', [lockScript, config.nativeHome, 'bash', lockScript,
    config.stateDirectory, process.execPath, entry, '--run-hosted-locked', path, sha256], { stdio: 'inherit' });
  return new Promise((resolveExit, reject) => {
    const stop = () => { child.kill('SIGTERM'); };
    const cleanup = () => signal?.removeEventListener('abort', stop);
    child.once('error', () => { cleanup(); reject(new Error('HOSTED_OWNER_LAUNCH_REFUSED')); });
    child.once('exit', (code, exitSignal) => { cleanup(); resolveExit({ code, signal: exitSignal }); });
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--run') fail();
    const result = await launchHostedOwnerAlpha(process.argv[3], { signal: controller.signal });
    process.exitCode = result.code ?? 1;
  } catch {
    console.error('Hosted owner launch refused; state retained. No automatic retry.');
    process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  }
}
