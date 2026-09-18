import { mkdir, lstat, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ControlClient } from './control-client.mjs';
import { readOwnerAlphaConfig } from './owner-alpha-entry.mjs';
import { ownerAlphaPolicy } from './owner-alpha-policy.mjs';
import { createCodexTextOnlyProfile, codexTextOnlyProfileSha256 } from './codex-text-only.mjs';
import { FileJournal } from './file-journal.mjs';

const fail = () => { throw new Error('HOSTED_MANAGER_REFUSED_OR_UNKNOWN'); };
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const canonical = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const lockScript = fileURLToPath(new URL('../scripts/with-executor-lock.sh', import.meta.url));
const self = fileURLToPath(import.meta.url);

async function privateDirectory(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) fail();
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o700) fail();
}
async function syncDirectory(path) {
  const fd = await open(path, 'r');
  try { await fd.sync(); } finally { await fd.close(); }
}
async function writeExclusive(path, bytes) {
  const fd = await open(path, 'wx', 0o600);
  try { await fd.writeFile(bytes); await fd.sync(); } finally { await fd.close(); }
}

/** Called only by authenticated wake admission. No timer, renewal or replay. */
export async function runHostedOwnerManager(config, request, dependencies = {}) {
  const resume = await prepareHostedOwnerManager(config, request, dependencies);
  return resume ? resume() : 'NO_ASSIGNMENT';
}

/** Capture one authenticated assignment. The returned continuation cannot refetch,
 * renew or replay it. Optional Tasks preparation must finish before HTTP acceptance. */
export async function prepareHostedOwnerManager(config, request, { readSecret, launch, control, tasks, now = Date.now, signal } = {}) {
  config = structuredClone(config);
  const required = ['kind', 'portalOrigin', 'installationId', 'hostedOwnerBindingSha256', 'managerTokenFile', 'templatePath', 'templateSha256', 'sessionsDirectory'];
  if (!config || required.some(key => !Object.hasOwn(config, key)) ||
      Object.keys(config).some(key => ![...required, 'accessClientIdFile', 'accessClientSecretFile'].includes(key)) ||
      config.kind !== 'owner-alpha-manager-v1' || typeof config.installationId !== 'string' || !config.installationId || config.installationId.length > 256 ||
      !digest(config.hostedOwnerBindingSha256) || !digest(config.templateSha256) ||
      Boolean(config.accessClientIdFile) !== Boolean(config.accessClientSecretFile)) fail();
  const origin = new URL(config.portalOrigin);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') fail();
  for (const key of ['managerTokenFile', 'templatePath', 'sessionsDirectory', 'accessClientIdFile', 'accessClientSecretFile']) {
    if (config[key] !== undefined && (typeof config[key] !== 'string' || !isAbsolute(config[key]))) fail();
  }
  await privateDirectory(config.sessionsDirectory);
  const { config: template } = await readOwnerAlphaConfig(config.templatePath, config.templateSha256);
  if (template.installationId !== config.installationId || template.hostedOwnerBindingSha256 !== config.hostedOwnerBindingSha256 ||
      template.portalOrigin !== config.portalOrigin || !template.nativeHome || !template.ownerAlpha?.text_only) fail();
  await privateDirectory(template.nativeHome);
  const profile = createCodexTextOnlyProfile(template.textOnlyProfile);
  const templatePolicy = ownerAlphaPolicy(template.ownerAlpha);
  if (templatePolicy.text_only.profile_sha256 !== codexTextOnlyProfileSha256(profile)) fail();
  if (!control) {
    const token = await readSecret(config.managerTokenFile);
    const access = config.accessClientIdFile ? { accessClientId: await readSecret(config.accessClientIdFile),
      accessClientSecret: await readSecret(config.accessClientSecretFile) } : {};
    control = new ControlClient({ origin: config.portalOrigin, token, principal: 'manager',
      ...(tasks ? { timeoutMs: 3000 } : {}), ...access });
  }
  if (signal?.aborted) fail();
  const assignment = structuredClone(await control.request('manifest', {}));
  if (signal?.aborted) fail();
  if (assignment === null) return null;
  if (!assignment || Object.keys(assignment).sort().join(',') !== 'grant,policy,runtime_token') fail();
  const { grant, policy: rawPolicy, runtime_token: token } = assignment;
  const policy = ownerAlphaPolicy(rawPolicy);
  if (!grant || Object.keys(grant).sort().join(',') !== 'boot_id,epoch,expires_at,installation_id,issued_at,manifest_sha256,owner_binding_sha256,run_id,transition_id' ||
      grant.installation_id !== config.installationId || grant.owner_binding_sha256 !== config.hostedOwnerBindingSha256 ||
      !uuid(grant.run_id) || !uuid(grant.boot_id) || !uuid(grant.transition_id) || !digest(grant.manifest_sha256) ||
      !Number.isSafeInteger(grant.epoch) || grant.epoch < 2 || request.epoch !== grant.epoch || request.operationId !== grant.transition_id ||
      !canonical(grant.issued_at) || !canonical(grant.expires_at) || Date.parse(grant.issued_at) > now() ||
      Date.parse(grant.expires_at) - Date.parse(grant.issued_at) > 300000 || Date.parse(grant.expires_at) <= now() ||
      grant.expires_at !== policy.expires_at || policy.persona_id !== templatePolicy.persona_id ||
      policy.max_runs !== 1 || !policy.text_only ||
      policy.text_only.profile_sha256 !== codexTextOnlyProfileSha256(profile) ||
      Object.keys(template.personas ?? {}).length !== 1 || !template.personas[policy.persona_id] ||
      template.personas[policy.persona_id].model !== profile.model || template.personas[policy.persona_id].allowedTools?.length ||
      typeof token !== 'string' || !token || token.length > 16384 || /[\r\n\0]/.test(token) || signal?.aborted) fail();
  // The exclusive directory is itself a replay fence, including partial writes.
  const directory = join(config.sessionsDirectory, grant.transition_id);
  await mkdir(directory, { mode: 0o700 });
  await syncDirectory(config.sessionsDirectory);
  const generation = { epoch: grant.epoch, boot_id: grant.boot_id, transition_id: grant.transition_id };
  if (tasks) {
    // This durable UNKNOWN precedes the first potentially effective PUT. Neither
    // interrupted preparation nor a failed readback may acquire another hold.
    await writeExclusive(join(directory, 'hosted-owner-bootstrap-intent.json'), JSON.stringify({ phase: 'unknown',
      owner_alpha_generation: generation, run_id: grant.run_id, manifest_sha256: grant.manifest_sha256,
      task_id: `hehe-bootstrap-${grant.transition_id}`, expires_at: grant.expires_at }));
    await syncDirectory(directory);
    if (signal?.aborted || Date.parse(policy.expires_at) <= now()) fail();
    await tasks.hold({ id: `hehe-bootstrap-${grant.transition_id}`, expiresAt: Date.parse(grant.expires_at) });
    if (signal?.aborted || Date.parse(policy.expires_at) <= now()) fail();
  }
  let consumed = false;
  return async () => {
    if (consumed) fail();
    consumed = true;
    if (signal?.aborted || Date.parse(policy.expires_at) <= now()) fail();
    const child = { ...template, stateDirectory: directory, runtimeTokenFile: join(directory, 'runtime-token'),
      ownerAlpha: policy, ownerAlphaGeneration: generation };
    const path = join(directory, 'runtime.json');
    const bytes = JSON.stringify(child);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await writeExclusive(child.runtimeTokenFile, token);
    await writeExclusive(path, bytes);
    await writeExclusive(join(directory, 'hosted-owner-launch-intent.json'), JSON.stringify({ phase: 'unknown',
      config_sha256: sha256, owner_alpha_generation: generation, manifest_sha256: grant.manifest_sha256 }));
    await syncDirectory(directory);
    if (Date.parse(policy.expires_at) <= now() || signal?.aborted) fail();
    await launch(path, { expectedSha256: sha256, signal });
    // Acquire, rather than inspect PID files. Read proof while both locks are held.
    // Failure (including still-held locks) retains UNKNOWN and never retries.
    const { stdout } = await promisify(execFile)('bash', [lockScript, child.nativeHome, 'bash', lockScript,
      directory, process.execPath, self, '--inspect-locked', path, sha256], { timeout: 10000, maxBuffer: 16384 });
    const report = JSON.parse(stdout);
    await control.request('retirement', report);
    return 'RETIREMENT_REPORTED';
  };
}

async function inspectLocked(path, sha256) {
  const { config } = await readOwnerAlphaConfig(path, sha256);
  const row = await new FileJournal(join(config.stateDirectory, 'journal')).get('service');
  const generation = config.ownerAlphaGeneration;
  const policy = ownerAlphaPolicy(config.ownerAlpha);
  if (!row || row.nativeStopped !== true || row.bootId !== generation.boot_id ||
      row.identity?.epoch !== generation.epoch || row.identity?.boot_id !== generation.boot_id ||
      !same(row.ownerAlphaGeneration, generation) || !same(ownerAlphaPolicy(row.ownerAlpha), policy) ||
      row.hostedOwner?.bindingSha256 !== config.hostedOwnerBindingSha256 ||
      row.hostedOwner?.origin !== new URL(config.portalOrigin).origin || Date.now() < Date.parse(policy.expires_at)) fail();
  return { epoch: generation.epoch, boot_id: generation.boot_id, session_id: policy.session_id,
    transition_id: generation.transition_id, observed_at: new Date().toISOString(), direct_child_stopped: true,
    execution_lock_free: true, session_lock_free: true, source: 'hosted-manager:file-journal-nativeStopped+dual-flock' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 5 || process.argv[2] !== '--inspect-locked' || !digest(process.argv[4])) fail();
    console.log(JSON.stringify(await inspectLocked(process.argv[3], process.argv[4])));
  } catch { console.error('HOSTED_MANAGER_REFUSED_OR_UNKNOWN'); process.exitCode = 1; }
}
