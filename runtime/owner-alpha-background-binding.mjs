import { createHash } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

const fail = code => { throw Object.assign(new Error(code), { code }); };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hex64 = /^[a-f0-9]{64}$/;
const canonical = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const secretValid = value => typeof value === 'string' && value.length > 0 && value.length <= 16384 && !/[\r\n\0]/.test(value);
const digest = values => createHash('sha256').update(JSON.stringify(values)).digest('hex');

export const BACKGROUND_ROLES = Object.freeze(['background', 'status', 'independent']);
/** Full manifest key set as journaled by the control plane (role status adds
 * status_summary_sha256, handled by the digest itself). */
export const BACKGROUND_MANIFEST_KEYS = Object.freeze(['admission', 'background', 'boot_id', 'command_id', 'command_sha256', 'epoch', 'event_sequence', 'expires_at', 'generation_sha256', 'installation_id', 'issued_at', 'kind', 'manifest_sha256', 'owner_binding_sha256', 'persona_id', 'policy_revision', 'reservation_micro_usd', 'role', 'run_id', 'schema_version', 'session_id', 'transition_id']);
export const BACKGROUND_TASK_GRANT_KEYS = Object.freeze(['attempt', 'boot_id', 'epoch', 'expires_at', 'generation_sha256', 'installation_id', 'issued_at', 'manifest_sha256', 'owner_binding_sha256', 'run_id', 'transition_id']);
const CLAIM_BASE_KEYS = ['background', 'deadline_at', 'kind', 'manifest', 'role', 'run', 'schema_version', 'submission_key', 'task_credential'];
/** Exact claim key sets per role: the background root reuses the existing V2
 * claim flag; the status root carries the frozen summary; independent carries
 * neither. Roles always come from the manifest ordinal, never user text. */
export const BACKGROUND_CLAIM_KEYS = Object.freeze({
  background: Object.freeze([...CLAIM_BASE_KEYS, 'owner_alpha_background'].sort()),
  status: Object.freeze([...CLAIM_BASE_KEYS, 'status_summary'].sort()),
  independent: Object.freeze([...CLAIM_BASE_KEYS].sort()),
});

/** Canonical digest over the unsigned background manifest; byte-identical to
 * the control plane's backgroundManifestSha256. Never reuse any warm or legacy
 * manifest digest. */
export function backgroundManifestSha256(unsigned) {
  return digest([unsigned.schema_version, unsigned.kind, unsigned.admission, unsigned.role, unsigned.installation_id, unsigned.owner_binding_sha256,
    unsigned.run_id, unsigned.persona_id, unsigned.command_id, unsigned.command_sha256, unsigned.event_sequence,
    unsigned.policy_revision, unsigned.epoch, unsigned.boot_id, unsigned.transition_id, unsigned.session_id,
    unsigned.background.profile_version, unsigned.background.profile_sha256, unsigned.background.max_resident_child_threads,
    unsigned.background.wait_agent_enabled, unsigned.background.multi_agent_v1, unsigned.issued_at, unsigned.expires_at,
    unsigned.reservation_micro_usd, unsigned.generation_sha256, unsigned.status_summary_sha256 ?? null]);
}

function backgroundProfileInvalid(value) {
  return !value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== 'max_resident_child_threads,multi_agent_v1,profile_sha256,profile_version,wait_agent_enabled' ||
    value.profile_version !== 'codex-background-v2-restricted-v1' || typeof value.profile_sha256 !== 'string' || !hex64.test(value.profile_sha256) ||
    value.max_resident_child_threads !== 2 || value.wait_agent_enabled !== false || value.multi_agent_v1 !== false;
}

/** Canonical digest binding the full restricted background profile (all five
 * descriptor fields), used by the versioned ownerAlphaBackground config. */
export function backgroundProfileSha256(profile) {
  if (backgroundProfileInvalid(profile)) fail('INVALID_BACKGROUND_PROFILE');
  return digest([profile.profile_version, profile.profile_sha256, profile.max_resident_child_threads, profile.wait_agent_enabled, profile.multi_agent_v1]);
}

/** Strict shape check for a template-carried restricted background profile;
 * returns a frozen copy, never the caller's object. */
export function validateBackgroundProfile(value) {
  if (backgroundProfileInvalid(value)) fail('INVALID_BACKGROUND_PROFILE');
  return Object.freeze({ ...structuredClone(value) });
}

/** The runtime status reports a background generation's owner-alpha policy in
 * its generation shape: the staged runtime bounds (session_id, persona_id,
 * expires_at, max_runs, max_task_seconds) with the full restricted profile
 * under `background` instead of the runtime-only background_first_root
 * marker. Validate that exact shape against the staged policy and return a
 * canonical copy for deep comparison; any other shape is not bootable. */
export function backgroundGenerationPolicy(value, { alpha, backgroundProfile } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'background,expires_at,max_runs,max_task_seconds,persona_id,session_id' ||
      backgroundProfileInvalid(value.background) || JSON.stringify(value.background) !== JSON.stringify(backgroundProfile) ||
      value.session_id !== alpha?.session_id || !uuid.test(value.session_id) ||
      value.persona_id !== alpha?.persona_id || !uuid.test(value.persona_id) ||
      value.expires_at !== alpha?.expires_at || !canonical(value.expires_at) ||
      value.max_runs !== alpha?.max_runs || value.max_task_seconds !== alpha?.max_task_seconds) fail('CONTROL_NOT_BOOTABLE');
  return { session_id: value.session_id, persona_id: value.persona_id, expires_at: value.expires_at,
    max_runs: value.max_runs, max_task_seconds: value.max_task_seconds, background: structuredClone(value.background) };
}

/** Shape-only task JWT check: correct protected header typ and algorithm,
 * never a signature verification. The Worker verifies on receipt. */
function taskTokenShaped(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    return header && typeof header === 'object' && !Array.isArray(header) &&
      header.typ === 'hehebot-background-task+jwt' && header.alg === 'HS256';
  } catch { return false; }
}

function validateStatusSummary(summary, generation, generationSha256) {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary) ||
      Object.keys(summary).sort().join(',') !== 'admissions,computed_at,generation,kind,schema_version' ||
      summary.schema_version !== 1 || summary.kind !== 'owner-alpha-background-status-summary-v1') fail('INVALID_BACKGROUND_CLAIM');
  const inner = summary.generation;
  if (!inner || typeof inner !== 'object' || Array.isArray(inner) ||
      Object.keys(inner).sort().join(',') !== 'epoch,generation_sha256' ||
      inner.epoch !== generation.epoch || inner.generation_sha256 !== generationSha256) fail('INVALID_BACKGROUND_CLAIM');
  if (!Array.isArray(summary.admissions) || summary.admissions.length !== 1) fail('INVALID_BACKGROUND_CLAIM');
  const admission = summary.admissions[0];
  if (!admission || typeof admission !== 'object' || Array.isArray(admission) ||
      Object.keys(admission).sort().join(',') !== 'admission,attempt_status,child_count,coordinator_released,deadline_at,manifest_sha256,role,run_id,run_status' ||
      admission.admission !== 1 || admission.role !== 'background' ||
      typeof admission.run_id !== 'string' || !uuid.test(admission.run_id) ||
      typeof admission.run_status !== 'string' || !admission.run_status ||
      !(admission.attempt_status === null || typeof admission.attempt_status === 'string') ||
      admission.coordinator_released !== true ||
      typeof admission.deadline_at !== 'string' || !canonical(admission.deadline_at) ||
      !Number.isSafeInteger(admission.child_count) || admission.child_count < 0 ||
      typeof admission.manifest_sha256 !== 'string' || !hex64.test(admission.manifest_sha256)) fail('INVALID_BACKGROUND_CLAIM');
  if (typeof summary.computed_at !== 'string' || !canonical(summary.computed_at)) fail('INVALID_BACKGROUND_CLAIM');
}

/** Strict validation of an owner-alpha-background-claim-v1 envelope against
 * the configured generation binding. The claim manifest is the control
 * plane's reduced descriptor (admission, role, manifest_sha256, expires_at);
 * the role must equal the manifest ordinal's role, the deadline must be the
 * frozen manifest expiry, and at least one full second must remain. Host,
 * manager and legacy credentials are never accepted here. */
export function validateBackgroundClaim(claim, { installationId, generation, generationSha256, background, now = Date.now }) {
  if (!claim || typeof claim !== 'object' || Array.isArray(claim) || claim.schema_version !== 1 ||
      claim.kind !== 'owner-alpha-background-claim-v1') fail('INVALID_BACKGROUND_CLAIM');
  const manifest = claim.manifest;
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) ||
      Object.keys(manifest).sort().join(',') !== 'admission,expires_at,manifest_sha256,role' ||
      !Number.isSafeInteger(manifest.admission) || manifest.admission < 1 || manifest.admission > 3 ||
      !BACKGROUND_ROLES.includes(manifest.role)) fail('INVALID_BACKGROUND_CLAIM');
  // The role is the manifest ordinal's role, never caller text.
  if (manifest.role !== BACKGROUND_ROLES[manifest.admission - 1] || claim.role !== manifest.role) fail('INVALID_BACKGROUND_CLAIM');
  if (Object.keys(claim).sort().join(',') !== BACKGROUND_CLAIM_KEYS[manifest.role].join(',')) fail('INVALID_BACKGROUND_CLAIM');
  const run = claim.run;
  // The Worker returns the durable run row the dispatch bridge consumes
  // (including context_json); validate binding-relevant fields strictly and
  // pass the row through unchanged.
  if (!run || typeof run !== 'object' || Array.isArray(run) || typeof run.id !== 'string' || !uuid.test(run.id) ||
      run.current_attempt !== 1 || run.persona_id !== generation.persona_id ||
      run.role !== 'coordinator' || typeof run.context_json !== 'string' || !run.context_json) fail('INVALID_BACKGROUND_CLAIM');
  if (claim.submission_key !== `${run.id}:1` || typeof claim.deadline_at !== 'string' || !canonical(claim.deadline_at)) fail('INVALID_BACKGROUND_CLAIM');
  if (typeof manifest.manifest_sha256 !== 'string' || !hex64.test(manifest.manifest_sha256) ||
      typeof manifest.expires_at !== 'string' || !canonical(manifest.expires_at) ||
      manifest.expires_at !== claim.deadline_at) fail('INVALID_BACKGROUND_CLAIM');
  if (backgroundProfileInvalid(claim.background) || JSON.stringify(claim.background) !== JSON.stringify(background)) fail('INVALID_BACKGROUND_CLAIM');
  const credential = claim.task_credential;
  if (!credential || typeof credential !== 'object' || Array.isArray(credential) ||
      Object.keys(credential).sort().join(',') !== 'grant,token') fail('INVALID_BACKGROUND_CLAIM');
  const grant = credential.grant;
  if (!grant || typeof grant !== 'object' || Array.isArray(grant) ||
      Object.keys(grant).sort().join(',') !== BACKGROUND_TASK_GRANT_KEYS.join(',') ||
      grant.installation_id !== installationId || typeof grant.owner_binding_sha256 !== 'string' || !hex64.test(grant.owner_binding_sha256) ||
      grant.run_id !== run.id || grant.attempt !== 1 || grant.manifest_sha256 !== manifest.manifest_sha256 ||
      grant.epoch !== generation.epoch || grant.boot_id !== generation.boot_id || grant.transition_id !== generation.transition_id ||
      grant.generation_sha256 !== generationSha256 ||
      typeof grant.issued_at !== 'string' || !canonical(grant.issued_at) ||
      grant.expires_at !== manifest.expires_at || !(Date.parse(grant.issued_at) <= Date.parse(grant.expires_at))) fail('INVALID_BACKGROUND_CLAIM');
  if (!secretValid(credential.token) || !taskTokenShaped(credential.token)) fail('INVALID_BACKGROUND_CLAIM');
  if (manifest.role === 'background') {
    if (claim.owner_alpha_background !== true) fail('INVALID_BACKGROUND_CLAIM');
  } else if (manifest.role === 'status') {
    validateStatusSummary(claim.status_summary, generation, generationSha256);
  }
  if (Date.parse(claim.deadline_at) - now() < 1000) fail('BACKGROUND_TASK_DEADLINE_EXPIRED');
  return { run, submission_key: claim.submission_key, deadline_at: claim.deadline_at, role: manifest.role,
    background: { ...claim.background }, manifest: structuredClone(manifest), grant: structuredClone(grant) };
}

async function syncDirectory(path) {
  const fd = await open(path, 'r');
  try { await fd.sync(); } finally { await fd.close(); }
}
/** Write-once task token file. Reconstructing the same claim must reproduce
 * the identical bytes; any divergence is a permanent conflict, never a
 * rewrite. */
async function writeOnce(path, bytes) {
  try {
    const fd = await open(path, 'wx', 0o600);
    try { await fd.writeFile(bytes); await fd.sync(); } finally { await fd.close(); }
    return;
  } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const existing = await readFile(path);
  if (!existing.equals(bytes)) fail('BACKGROUND_TASK_TOKEN_CONFLICT');
}

/** Stage one admitted background claim: validate the full envelope against the
 * immutable generation binding, then durably write the unique task token to a
 * write-once file under the session's private task-tokens directory. Returns
 * the journal-shaped claim; the raw task token never enters the journal,
 * model context or the native environment. */
export async function stageBackgroundClaim(claim, context) {
  const staged = validateBackgroundClaim(claim, context);
  if (!isAbsolute(context.stateDirectory)) fail('INVALID_BACKGROUND_CLAIM_STAGE');
  const directory = join(context.stateDirectory, 'task-tokens');
  await mkdir(directory, { mode: 0o700, recursive: true });
  const tokenFile = join(directory, staged.run.id);
  await writeOnce(tokenFile, Buffer.from(claim.task_credential.token, 'utf8'));
  await syncDirectory(directory);
  return { run: staged.run, submission_key: staged.submission_key, deadline_at: staged.deadline_at,
    role: staged.role, background: staged.background, manifest: staged.manifest,
    task_credential: { grant: staged.grant, token_file: tokenFile },
    ...(staged.role === 'background' ? { owner_alpha_background: true } : {}),
    ...(staged.role === 'status' ? { status_summary: structuredClone(claim.status_summary) } : {}) };
}

/** Immutable launch-envelope validation context derived from the service
 * configuration. generation_sha256 binds the immutable background generation
 * digest; the restricted background profile is carried explicitly. */
export function backgroundGenerationBinding(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'background_profile_sha256,generation_sha256' ||
      typeof value.generation_sha256 !== 'string' || !hex64.test(value.generation_sha256) ||
      typeof value.background_profile_sha256 !== 'string' || !hex64.test(value.background_profile_sha256)) fail('INVALID_SERVICE_CONFIGURATION');
  return Object.freeze({ generation_sha256: value.generation_sha256, background_profile_sha256: value.background_profile_sha256 });
}

/** Strict validation of an owner-alpha-background-launch-v1 envelope as read
 * by the manager. Every binding must match the operator's configuration;
 * nothing is inferred or repaired. */
export function validateBackgroundLaunch(envelope, { installationId, ownerBindingSha256, personaId, backgroundProfile, request, now = Date.now }) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) ||
      Object.keys(envelope).sort().join(',') !== 'generation,host_credential,kind,schema_version' ||
      envelope.schema_version !== 1 || envelope.kind !== 'owner-alpha-background-launch-v1') fail('HOSTED_BACKGROUND_MANAGER_REFUSED_OR_UNKNOWN');
  const generation = envelope.generation;
  if (!generation || typeof generation !== 'object' || Array.isArray(generation) ||
      Object.keys(generation).sort().join(',') !== 'boot_id,epoch,generation_sha256,policy,predecessor,session_id,transition_id' ||
      !Number.isSafeInteger(generation.epoch) || generation.epoch < 2 ||
      typeof generation.boot_id !== 'string' || !uuid.test(generation.boot_id) ||
      typeof generation.transition_id !== 'string' || !uuid.test(generation.transition_id) ||
      typeof generation.session_id !== 'string' || !uuid.test(generation.session_id) ||
      typeof generation.generation_sha256 !== 'string' || !hex64.test(generation.generation_sha256)) fail('HOSTED_BACKGROUND_MANAGER_REFUSED_OR_UNKNOWN');
  if (request.epoch !== generation.epoch || request.operationId !== generation.transition_id) fail('HOSTED_BACKGROUND_MANAGER_REFUSED_OR_UNKNOWN');
  const policy = generation.policy;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy) ||
      Object.keys(policy).sort().join(',') !== 'background,expires_at,max_runs,max_task_seconds,persona_id' ||
      policy.persona_id !== personaId || policy.max_runs !== 3 ||
      !Number.isSafeInteger(policy.max_task_seconds) || policy.max_task_seconds < 1 || policy.max_task_seconds > 300 ||
      backgroundProfileInvalid(policy.background) || JSON.stringify(policy.background) !== JSON.stringify(backgroundProfile) ||
      typeof policy.expires_at !== 'string' || !canonical(policy.expires_at)) fail('HOSTED_BACKGROUND_MANAGER_REFUSED_OR_UNKNOWN');
  const predecessor = generation.predecessor;
  if (!predecessor || typeof predecessor !== 'object' || Array.isArray(predecessor) ||
      Object.keys(predecessor).sort().join(',') !== 'boot_id,epoch,session_id' ||
      predecessor.epoch !== generation.epoch - 1 ||
      typeof predecessor.boot_id !== 'string' || !uuid.test(predecessor.boot_id) ||
      typeof predecessor.session_id !== 'string' || !uuid.test(predecessor.session_id)) fail('HOSTED_BACKGROUND_MANAGER_REFUSED_OR_UNKNOWN');
  const credential = envelope.host_credential;
  if (!credential || typeof credential !== 'object' || Array.isArray(credential) ||
      Object.keys(credential).sort().join(',') !== 'grant,token') fail('HOSTED_BACKGROUND_MANAGER_REFUSED_OR_UNKNOWN');
  const grant = credential.grant;
  if (!grant || typeof grant !== 'object' || Array.isArray(grant) ||
      Object.keys(grant).sort().join(',') !== 'boot_id,epoch,expires_at,generation_sha256,installation_id,issued_at,transition_id' ||
      grant.installation_id !== installationId || grant.epoch !== generation.epoch ||
      grant.boot_id !== generation.boot_id || grant.transition_id !== generation.transition_id ||
      grant.generation_sha256 !== generation.generation_sha256 ||
      typeof grant.issued_at !== 'string' || !canonical(grant.issued_at) ||
      grant.expires_at !== policy.expires_at ||
      !(Date.parse(grant.issued_at) <= now()) || !(Date.parse(grant.expires_at) > now()) ||
      Date.parse(grant.expires_at) - Date.parse(grant.issued_at) > 300000) fail('HOSTED_BACKGROUND_MANAGER_REFUSED_OR_UNKNOWN');
  if (!secretValid(credential.token)) fail('HOSTED_BACKGROUND_MANAGER_REFUSED_OR_UNKNOWN');
  return { generation, policy, grant, token: credential.token };
}
