import { spawn } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readOwnerAlphaConfig } from './owner-alpha-entry.mjs';
import { ownerAlphaPolicy } from './owner-alpha-policy.mjs';

const fail = () => { throw new Error('HOSTED_OWNER_LAUNCH_REFUSED'); };
const lockScript = fileURLToPath(new URL('../scripts/with-executor-lock.sh', import.meta.url));
const entry = fileURLToPath(new URL('./owner-alpha-entry.mjs', import.meta.url));

/** Verified exec for the launch boundary. Debian's libcap-ng logs failed
 * bounding-set drops instead of failing setpriv, so the launcher must read back
 * its own /proc/self/status: exec the entry only when every uid is non-root,
 * every capability mask is empty, and NoNewPrivs is set. Any other state
 * exits 91 without running the entry. */
const launchBoundaryVerification = [
  "awk -F '\\t' '",
  'BEGIN { uid_ok = 0; caps_ok = 1; nnp_ok = 0 }',
  '$1 == "Uid:" { uid_ok = ($2 != 0 && $3 != 0 && $4 != 0 && $5 != 0) }',
  '$1 == "CapInh:" || $1 == "CapPrm:" || $1 == "CapEff:" || $1 == "CapBnd:" || $1 == "CapAmb:" { if ($2 != "0000000000000000") caps_ok = 0 }',
  '$1 == "NoNewPrivs:" { nnp_ok = ($2 == 1) }',
  'END { exit (uid_ok && caps_ok && nnp_ok) ? 0 : 91 }',
  "' /proc/self/status || exit 91",
  'exec "$@"',
].join('\n');

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
  // Sprite's inherited capabilities break the native sandbox. The kernel only
  // permits bounding-set drops with CAP_SETPCAP, and an unprivileged launcher
  // has none, so the zero-capability boundary is established by the privileged
  // launch path through scripts/with-hosted-owner-user.sh when it drops to
  // this owner uid; the drop must follow the reuid or the emptied bounding set
  // blocks setresuid. Debian's libcap-ng then logs failed drops instead of
  // failing setpriv, so the verified exec above reads back /proc/self/status
  // and refuses to run the entry unless the boundary really holds. A private
  // user namespace is not a substitute: it would leave the root-managed floor
  // unmapped (stat as 65534) and fail the entry's floor checks. Verification
  // failure must stop launch; never fall back to an unrestricted child.
  const child = spawnImpl('bash', [lockScript, config.nativeHome, 'bash', lockScript,
    config.stateDirectory, 'setpriv', '--bounding-set=-all', '--inh-caps=-all',
    '--ambient-caps=-all', '--no-new-privs', '--', 'bash', '-c', launchBoundaryVerification,
    'verify-launch-boundary', process.execPath, entry, '--run-hosted-locked', path, sha256],
    { stdio: 'inherit' });
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
