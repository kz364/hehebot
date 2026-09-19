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
import { validateWarmLaunch } from './owner-alpha-warm-binding.mjs';
import { FileJournal } from './file-journal.mjs';

const fail = () => { throw new Error('HOSTED_WARM_MANAGER_REFUSED_OR_UNKNOWN'); };
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
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

/** Called only by authenticated wake admission under the warm contract. No
 * timer, renewal or replay; one launch envelope ever, one process, one boot. */
export async function runHostedOwnerWarmManager(config, request, dependencies = {}) {
  const resume = await prepareHostedOwnerWarmManager(config, request, dependencies);
  return resume ? resume() : 'NO_ASSIGNMENT';
}

/** Capture one authenticated warm assignment. The returned continuation cannot
 * refetch, renew or replay it; a READY or retired generation yields no launch
 * envelope at all. Optional Tasks preparation must finish before HTTP acceptance. */
export async function prepareHostedOwnerWarmManager(config, request, { readSecret, launch, control, tasks, now = Date.now, signal } = {}) {
  config = structuredClone(config);
  const required = ['kind', 'portalOrigin', 'installationId', 'hostedOwnerBindingSha256', 'managerTokenFile', 'templatePath', 'templateSha256', 'sessionsDirectory'];
  if (!config || required.some(key => !Object.hasOwn(config, key)) ||
      Object.keys(config).some(key => ![...required, 'accessClientIdFile', 'accessClientSecretFile'].includes(key)) ||
      config.kind !== 'owner-alpha-warm-manager-v1' || typeof config.installationId !== 'string' || !config.installationId || config.installationId.length > 256 ||
      !digest(config.hostedOwnerBindingSha256) || !digest(config.templateSha256) ||
      Boolean(config.accessClientIdFile) !== Boolean(config.accessClientSecretFile)) fail();
  const origin = new URL(config.portalOrigin);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') fail();
  for (const key of ['managerTokenFile', 'templatePath', 'sessionsDirectory', 'accessClientIdFile', 'accessClientSecretFile']) {
    if (config[key] !== undefined && (typeof config[key] !== 'string' || !isAbsolute(config[key]))) fail();
  }
  await privateDirectory(config.sessionsDirectory);
  const { config: template } = await readOwnerAlphaConfig(config.templatePath, config.templateSha256);
  // The warm kind is explicit: a warm template never carries a legacy ownerAlpha
  // policy, so the versioned kind cannot implicitly widen owner-alpha-manager-v1.
  if (template.installationId !== config.installationId || template.hostedOwnerBindingSha256 !== config.hostedOwnerBindingSha256 ||
      template.portalOrigin !== config.portalOrigin || !template.nativeHome || template.ownerAlpha !== undefined ||
      template.disposableTest !== undefined || template.restrictedPermissions !== undefined ||
      template.textOnlyProfile === undefined || Object.keys(template.personas ?? {}).length !== 1) fail();
  await privateDirectory(template.nativeHome);
  const profile = createCodexTextOnlyProfile(template.textOnlyProfile);
  const [personaId, persona] = Object.entries(template.personas)[0];
  if (persona.model !== profile.model || persona.allowedTools?.length) fail();
  if (!control) {
    const token = await readSecret(config.managerTokenFile);
    const access = config.accessClientIdFile ? { accessClientId: await readSecret(config.accessClientIdFile),
      accessClientSecret: await readSecret(config.accessClientSecretFile) } : {};
    control = new ControlClient({ origin: config.portalOrigin, token, principal: 'warm-manager',
      ...(tasks ? { timeoutMs: 3000 } : {}), ...access });
  }
  if (signal?.aborted) fail();
  const envelope = structuredClone(await control.request('generation', {}));
  if (signal?.aborted) fail();
  if (envelope === null) return null;
  const assignment = validateWarmLaunch(envelope, { installationId: config.installationId,
    ownerBindingSha256: config.hostedOwnerBindingSha256, personaId, profileSha256: codexTextOnlyProfileSha256(profile),
    request, now });
  const { generation, policy, token } = assignment;
  // The exclusive directory is itself a replay fence, including partial writes.
  const directory = join(config.sessionsDirectory, generation.transition_id);
  await mkdir(directory, { mode: 0o700 });
  await syncDirectory(config.sessionsDirectory);
  if (tasks) {
    // This durable UNKNOWN precedes the first potentially effective PUT. Neither
    // interrupted preparation nor a failed readback may acquire another hold.
    await writeExclusive(join(directory, 'hosted-owner-warm-intent.json'), JSON.stringify({ phase: 'unknown',
      owner_alpha_generation: { epoch: generation.epoch, boot_id: generation.boot_id, transition_id: generation.transition_id },
      generation_sha256: generation.generation_sha256, session_id: generation.session_id,
      task_id: `hehe-warm-${generation.transition_id}`, expires_at: policy.expires_at }));
    await syncDirectory(directory);
    if (signal?.aborted || Date.parse(policy.expires_at) <= now()) fail();
    await tasks.hold({ id: `hehe-warm-${generation.transition_id}`, expiresAt: Date.parse(policy.expires_at) });
    if (signal?.aborted || Date.parse(policy.expires_at) <= now()) fail();
  }
  let consumed = false;
  return async () => {
    if (consumed) fail();
    consumed = true;
    if (signal?.aborted || Date.parse(policy.expires_at) <= now()) fail();
    const child = { ...template, stateDirectory: directory, runtimeTokenFile: join(directory, 'host-token'),
      ownerAlpha: { session_id: generation.session_id, persona_id: policy.persona_id, expires_at: policy.expires_at,
        max_runs: policy.max_runs, max_task_seconds: policy.max_task_seconds, text_only: policy.text_only },
      ownerAlphaGeneration: { epoch: generation.epoch, boot_id: generation.boot_id, transition_id: generation.transition_id },
      ownerAlphaWarm: { generation_sha256: generation.generation_sha256 } };
    const path = join(directory, 'runtime.json');
    const bytes = JSON.stringify(child);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    // The host credential stays in its own write-once file; it is never the
    // child's task token and never enters model context or the native sandbox.
    await writeExclusive(child.runtimeTokenFile, token);
    await writeExclusive(path, bytes);
    await writeExclusive(join(directory, 'hosted-owner-warm-launch-intent.json'), JSON.stringify({ phase: 'unknown',
      config_sha256: sha256, owner_alpha_generation: child.ownerAlphaGeneration,
      generation_sha256: generation.generation_sha256 }));
    await syncDirectory(directory);
    if (Date.parse(policy.expires_at) <= now() || signal?.aborted) fail();
    await launch(path, { expectedSha256: sha256, signal });
    // Acquire, rather than inspect PID files. Read proof while both locks are
    // held. Failure (including still-held locks) retains UNKNOWN and never retries.
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
  const warm = config.ownerAlphaWarm;
  const policy = ownerAlphaPolicy(config.ownerAlpha);
  if (!row || row.nativeStopped !== true || row.bootId !== generation.boot_id ||
      row.identity?.epoch !== generation.epoch || row.identity?.boot_id !== generation.boot_id ||
      !same(row.ownerAlphaGeneration, generation) || !warm || !same(row.ownerAlphaWarm, warm) ||
      !same(row.ownerAlpha, policy) || !same(ownerAlphaPolicy(row.ownerAlpha), policy) ||
      row.hostedOwner?.bindingSha256 !== config.hostedOwnerBindingSha256 ||
      row.hostedOwner?.origin !== new URL(config.portalOrigin).origin ||
      Date.now() < Date.parse(policy.expires_at)) fail();
  return { epoch: generation.epoch, boot_id: generation.boot_id, session_id: policy.session_id,
    transition_id: generation.transition_id, observed_at: new Date().toISOString(), direct_child_stopped: true,
    execution_lock_free: true, session_lock_free: true,
    source: 'hosted-warm-manager:file-journal-nativeStopped+dual-flock' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 5 || process.argv[2] !== '--inspect-locked' || !digest(process.argv[4])) fail();
    console.log(JSON.stringify(await inspectLocked(process.argv[3], process.argv[4])));
  } catch { console.error('HOSTED_WARM_MANAGER_REFUSED_OR_UNKNOWN'); process.exitCode = 1; }
}
