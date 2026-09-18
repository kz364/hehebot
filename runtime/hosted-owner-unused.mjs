import { constants, fstatSync } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, realpath } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ownerAlphaPolicy } from './owner-alpha-policy.mjs';
import { createCodexTextOnlyProfile, codexTextOnlyProfileSha256 } from './codex-text-only.mjs';

const fail = () => { throw new Error('UNUSED_EVIDENCE_REFUSED_OR_UNKNOWN'); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const utc = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const exact = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) fail();
};
const self = fileURLToPath(import.meta.url);
const sources = { manager: fileURLToPath(new URL('./hosted-owner-manager.mjs', import.meta.url)),
  launcher: fileURLToPath(new URL('./hosted-owner-launcher.mjs', import.meta.url)),
  lock_script: fileURLToPath(new URL('../scripts/with-executor-lock.sh', import.meta.url)) };
const marker = 'unused-before-staging.json', reservation = 'unused-reservation.json';

async function canonical(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path || await realpath(path) !== path) fail();
}
async function bytes(path, expected, privateFile = true) {
  await canonical(path);
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await fd.stat();
    if (!stat.isFile() || stat.uid !== process.getuid() || stat.nlink !== 1 || stat.mode & (privateFile ? 0o077 : 0o022) ||
        stat.size < 1 || stat.size > 131072) fail();
    const value = await fd.readFile();
    if (value.length > 131072 || expected !== undefined && (!digest(expected) || hash(value) !== expected)) fail();
    return value;
  } finally { await fd.close(); }
}
async function privateRoot(pin) {
  exact(pin, ['path', 'dev', 'ino']); await canonical(pin.path);
  const stat = await lstat(pin.path);
  if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700 ||
      !Number.isSafeInteger(pin.dev) || !Number.isSafeInteger(pin.ino) || stat.dev !== pin.dev || stat.ino !== pin.ino) fail();
  return stat;
}
async function syncDirectory(path) {
  const fd = await open(path, 'r'); try { await fd.sync(); } finally { await fd.close(); }
}
async function immutable(path, value) {
  const fd = await open(path, 'wx', 0o400);
  try { await fd.writeFile(value); await fd.sync(); } finally { await fd.close(); }
}
async function inheritedLock(path) {
  const stat = await lstat(path);
  for (const name of await readdir('/proc/self/fd')) {
    try {
      const fd = Number(name), held = fstatSync(fd);
      if (fd > 2 && held.dev === stat.dev && held.ino === stat.ino &&
          /^lock:\s+\d+: FLOCK\s+ADVISORY\s+WRITE\s/m.test(await readFile(`/proc/self/fdinfo/${fd}`, 'utf8'))) return;
    } catch { /* A transient unrelated Node descriptor may have closed. */ }
  }
  fail();
}

async function validate(path, sha256) {
  if (!digest(sha256)) fail();
  const request = JSON.parse(await bytes(path, sha256));
  exact(request, ['kind', 'installation_id', 'owner_binding_sha256', 'predecessor', 'policy_expires_at', 'assignment', 'manager_config', 'review']);
  exact(request.predecessor, ['manifest_sha256', 'epoch', 'boot_id', 'transition_id', 'session_id', 'run_id']);
  exact(request.assignment, ['grant', 'policy']);
  exact(request.manager_config, ['path', 'sha256']);
  const review = request.review;
  exact(review, ['source', 'reviewed_at', 'persistent_root_custody_reviewed', 'sources', 'sessions_root', 'native_home']);
  exact(review.sources, Object.keys(sources));
  // This is an explicit operator assertion that these deployed roots were not
  // deleted/replaced/emptied during the predecessor. Hashes cannot establish it.
  if (request.kind !== 'owner-alpha-unused-request-v1' || review.persistent_root_custody_reviewed !== true ||
      typeof review.source !== 'string' || !review.source.trim() || review.source.length > 256 || /[\r\n\0]/.test(review.source) ||
      !utc(review.reviewed_at) || Date.parse(review.reviewed_at) > Date.now() || !utc(request.policy_expires_at) ||
      Date.parse(request.policy_expires_at) > Date.parse(review.reviewed_at)) fail();
  const { grant } = request.assignment, policy = ownerAlphaPolicy(request.assignment.policy), p = request.predecessor;
  exact(grant, ['installation_id', 'owner_binding_sha256', 'run_id', 'epoch', 'boot_id', 'transition_id', 'manifest_sha256', 'issued_at', 'expires_at']);
  if (typeof request.installation_id !== 'string' || !request.installation_id || request.installation_id.length > 256 ||
      !digest(request.owner_binding_sha256) || !digest(p.manifest_sha256) ||
      ![p.boot_id, p.transition_id, p.session_id, p.run_id].every(uuid) || !Number.isSafeInteger(p.epoch) || p.epoch < 2 ||
      grant.installation_id !== request.installation_id || grant.owner_binding_sha256 !== request.owner_binding_sha256 ||
      ['manifest_sha256', 'epoch', 'boot_id', 'transition_id', 'run_id'].some(key => grant[key] !== p[key]) ||
      policy.session_id !== p.session_id || policy.expires_at !== request.policy_expires_at || grant.expires_at !== policy.expires_at ||
      !utc(grant.issued_at) || Date.parse(grant.issued_at) >= Date.parse(grant.expires_at) ||
      Date.parse(grant.expires_at) - Date.parse(grant.issued_at) > 300000 || policy.max_runs !== 1 || !policy.text_only) fail();
  const config = JSON.parse(await bytes(request.manager_config.path, request.manager_config.sha256));
  const keys = ['kind', 'portalOrigin', 'installationId', 'hostedOwnerBindingSha256', 'managerTokenFile', 'templatePath', 'templateSha256', 'sessionsDirectory'];
  if (config.accessClientIdFile !== undefined) keys.push('accessClientIdFile', 'accessClientSecretFile');
  exact(config, keys);
  const origin = new URL(config.portalOrigin);
  if (config.kind !== 'owner-alpha-manager-v1' || origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/' ||
      config.installationId !== request.installation_id || config.hostedOwnerBindingSha256 !== request.owner_binding_sha256 ||
      config.sessionsDirectory !== review.sessions_root.path) fail();
  for (const key of ['managerTokenFile', 'accessClientIdFile', 'accessClientSecretFile']) {
    if (config[key] !== undefined && (typeof config[key] !== 'string' || !isAbsolute(config[key]))) fail();
  }
  const template = JSON.parse(await bytes(config.templatePath, config.templateSha256));
  const templatePolicy = ownerAlphaPolicy(template.ownerAlpha), profile = createCodexTextOnlyProfile(template.textOnlyProfile);
  if (template.installationId !== config.installationId || template.hostedOwnerBindingSha256 !== config.hostedOwnerBindingSha256 ||
      template.portalOrigin !== config.portalOrigin || template.nativeHome !== review.native_home.path ||
      templatePolicy.persona_id !== policy.persona_id || templatePolicy.text_only?.profile_sha256 !== policy.text_only.profile_sha256 ||
      codexTextOnlyProfileSha256(profile) !== policy.text_only.profile_sha256 ||
      Object.keys(template.personas ?? {}).length !== 1 || template.personas[policy.persona_id]?.model !== profile.model ||
      template.personas[policy.persona_id]?.allowedTools?.length) fail();
  for (const [key, sourcePath] of Object.entries(sources)) await bytes(sourcePath, review.sources[key], false);
  const roots = await Promise.all([privateRoot(review.native_home), privateRoot(review.sessions_root)]);
  if (roots[0].dev === roots[1].dev && roots[0].ino === roots[1].ino) fail();
  return { request, directory: join(config.sessionsDirectory, p.transition_id) };
}

/** Operator-only local evidence, not authority to launch, retire or recover.
 * No API/model credential file is read; no API, native or Tasks call is made. */
export async function produceUnusedEvidence(path, sha256) {
  try {
    const { request, directory } = await validate(path, sha256);
    // Keep the native-home descriptor in this shell, then exec the session lock
    // and writer. A killed reservation helper cannot leave a detached writer.
    const command = 'set -euo pipefail; reservation="$("$1" "$2" --reserve "$3" "$4")"; exec bash "$5" "$6" "$1" "$2" --write "$3" "$4" "$reservation"';
    const { stdout } = await promisify(execFile)('bash', [sources.lock_script, request.review.native_home.path,
      'bash', '-c', command, 'hehe-unused', process.execPath, self, path, sha256, sources.lock_script, directory], { maxBuffer: 16384 });
    return JSON.parse(stdout);
  } catch { fail(); }
}

async function reserve(path, sha256) {
  const { request, directory } = await validate(path, sha256);
  await inheritedLock(request.review.native_home.path);
  await mkdir(directory, { mode: 0o700 }); // No recursive flag: any prior/partial use consumes the transition.
  await syncDirectory(request.review.sessions_root.path);
  const stat = await lstat(directory), nonce = randomBytes(32).toString('hex');
  await immutable(join(directory, reservation), JSON.stringify({ request_sha256: sha256, nonce_sha256: hash(nonce) }));
  await syncDirectory(directory);
  return `${stat.dev}:${stat.ino}:${nonce}`;
}

async function writeEvidence(path, sha256, ticket) {
  const { request, directory } = await validate(path, sha256);
  if (!/^\d+:\d+:[a-f0-9]{64}$/.test(ticket)) fail();
  const [dev, ino, nonce] = ticket.split(':');
  await privateRoot({ path: directory, dev: Number(dev), ino: Number(ino) });
  await inheritedLock(request.review.native_home.path); await inheritedLock(directory);
  const saved = JSON.parse(await bytes(join(directory, reservation)));
  if (saved.request_sha256 !== sha256 || saved.nonce_sha256 !== hash(nonce) ||
      (await readdir(directory)).join(',') !== reservation) fail();
  const observed_at = new Date().toISOString(), source = request.review.source;
  if (observed_at < request.policy_expires_at || observed_at < request.review.reviewed_at) fail();
  const identity = { kind: 'unused-before-staging-v1', installation_id: request.installation_id,
    owner_binding_sha256: request.owner_binding_sha256, predecessor: request.predecessor };
  const persisted = Buffer.from(JSON.stringify({ ...identity, policy_expires_at: request.policy_expires_at,
    request_sha256: sha256, manager_config: request.manager_config, review: request.review, observed_at, source }) + '\n');
  await immutable(join(directory, marker), persisted); await syncDirectory(directory);
  const evidenceSha256 = hash(persisted);
  await bytes(join(directory, marker), evidenceSha256);
  return { ...identity, evidence: { sha256: evidenceSha256, observed_at, source } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [mode, path, sha256, ticket] = process.argv.slice(2);
    if (mode === '--produce' && process.argv.length === 5) console.log(JSON.stringify(await produceUnusedEvidence(path, sha256)));
    else if (mode === '--reserve' && process.argv.length === 5) console.log(await reserve(path, sha256));
    else if (mode === '--write' && process.argv.length === 6) console.log(JSON.stringify(await writeEvidence(path, sha256, ticket)));
    else fail();
  } catch { console.error('UNUSED_EVIDENCE_REFUSED_OR_UNKNOWN'); process.exitCode = 1; }
}
