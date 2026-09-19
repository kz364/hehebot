import { createHash } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

const fail = code => { throw Object.assign(new Error(code), { code }); };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hex64 = /^[a-f0-9]{64}$/;
const canonical = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const secretValid = value => typeof value === 'string' && value.length > 0 && value.length <= 16384 && !/[\r\n\0]/.test(value);
const digest = values => createHash('sha256').update(JSON.stringify(values)).digest('hex');

export const WARM_MANIFEST_KEYS = Object.freeze(['admission', 'boot_id', 'command_id', 'command_sha256', 'epoch', 'event_sequence', 'expires_at', 'generation_sha256', 'installation_id', 'issued_at', 'kind', 'manifest_sha256', 'owner_binding_sha256', 'persona_id', 'policy_revision', 'reservation_micro_usd', 'run_id', 'schema_version', 'session_id', 'text_only', 'transition_id']);
export const WARM_TASK_GRANT_KEYS = Object.freeze(['attempt', 'boot_id', 'epoch', 'expires_at', 'generation_sha256', 'installation_id', 'issued_at', 'manifest_sha256', 'owner_binding_sha256', 'run_id', 'transition_id']);
export const WARM_CLAIM_KEYS = Object.freeze(['deadline_at', 'kind', 'manifest', 'run', 'schema_version', 'submission_key', 'task_credential', 'text_only']);

/** Canonical digest over the unsigned warm manifest; byte-identical to the
 * control plane's warmManifestSha256. Never reuse the legacy ownerAlphaManifestSha256. */
export function warmManifestSha256(unsigned) {
  return digest([unsigned.schema_version, unsigned.kind, unsigned.admission, unsigned.installation_id, unsigned.owner_binding_sha256,
    unsigned.run_id, unsigned.persona_id, unsigned.command_id, unsigned.command_sha256, unsigned.event_sequence,
    unsigned.policy_revision, unsigned.epoch, unsigned.boot_id, unsigned.transition_id, unsigned.session_id,
    unsigned.text_only.profile_version, unsigned.text_only.profile_sha256, unsigned.issued_at, unsigned.expires_at,
    unsigned.reservation_micro_usd, unsigned.generation_sha256]);
}

function textOnlyInvalid(value) {
  return !value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== 'profile_sha256,profile_version' ||
    value.profile_version !== 'codex-text-only-v1' || typeof value.profile_sha256 !== 'string' || !hex64.test(value.profile_sha256);
}

/** Shape-only task JWT check: correct protected header typ and algorithm, never
 * a signature verification. The Worker verifies the signature on receipt. */
function taskTokenShaped(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    return header && typeof header === 'object' && !Array.isArray(header) &&
      header.typ === 'hehebot-warm-task+jwt' && header.alg === 'HS256';
  } catch { return false; }
}

/** Strict validation of an owner-alpha-warm-claim-v1 envelope against the
 * configured generation binding. The deadline must be the manifest's frozen
 * expiry and at least one full second must remain. Host and manager credentials
 * are never accepted here; the token is staged, not journaled. */
export function validateWarmClaim(claim, { installationId, generation, generationSha256, textOnly, now = Date.now }) {
  if (!claim || typeof claim !== 'object' || Array.isArray(claim) || Object.keys(claim).sort().join(',') !== WARM_CLAIM_KEYS.join(',')) fail('INVALID_WARM_CLAIM');
  if (claim.schema_version !== 1 || claim.kind !== 'owner-alpha-warm-claim-v1') fail('INVALID_WARM_CLAIM');
  const run = claim.run;
  // The Worker returns the durable run row the dispatch bridge consumes
  // (including context_json); validate the binding-relevant fields strictly
  // rather than an exact key set, and pass the row through unchanged.
  if (!run || typeof run !== 'object' || Array.isArray(run) || typeof run.id !== 'string' || !uuid.test(run.id) ||
      run.current_attempt !== 1 || run.persona_id !== generation.persona_id ||
      run.role !== 'coordinator' || typeof run.context_json !== 'string' || !run.context_json) fail('INVALID_WARM_CLAIM');
  if (claim.submission_key !== `${run.id}:1` || textOnlyInvalid(claim.text_only) ||
    JSON.stringify(claim.text_only) !== JSON.stringify(textOnly)) fail('INVALID_WARM_CLAIM');
  if (typeof claim.deadline_at !== 'string' || !canonical(claim.deadline_at)) fail('INVALID_WARM_CLAIM');
  const manifest = claim.manifest;
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) ||
    Object.keys(manifest).sort().join(',') !== WARM_MANIFEST_KEYS.join(',') ||
    manifest.schema_version !== 1 || manifest.kind !== 'owner-alpha-warm-manifest-v1' ||
    !(manifest.admission === 1 || manifest.admission === 2) ||
    manifest.installation_id !== installationId || typeof manifest.owner_binding_sha256 !== 'string' || !hex64.test(manifest.owner_binding_sha256) ||
    manifest.run_id !== run.id || manifest.command_id !== run.command_id || typeof manifest.persona_id !== 'string' || !uuid.test(manifest.persona_id) ||
    manifest.persona_id !== generation.persona_id ||
    typeof manifest.command_id !== 'string' || !uuid.test(manifest.command_id) ||
    typeof manifest.command_sha256 !== 'string' || !hex64.test(manifest.command_sha256) ||
    !Number.isSafeInteger(manifest.event_sequence) || manifest.event_sequence < 1 ||
    typeof manifest.policy_revision !== 'string' || !manifest.policy_revision || manifest.policy_revision.length > 256 ||
    manifest.epoch !== generation.epoch || manifest.boot_id !== generation.boot_id || manifest.transition_id !== generation.transition_id ||
    typeof manifest.session_id !== 'string' || !uuid.test(manifest.session_id) || manifest.session_id !== generation.session_id ||
    textOnlyInvalid(manifest.text_only) || JSON.stringify(manifest.text_only) !== JSON.stringify(textOnly) ||
    typeof manifest.issued_at !== 'string' || !canonical(manifest.issued_at) ||
    typeof manifest.expires_at !== 'string' || !canonical(manifest.expires_at) ||
    !(Date.parse(manifest.expires_at) > Date.parse(manifest.issued_at)) ||
    !Number.isSafeInteger(manifest.reservation_micro_usd) || manifest.reservation_micro_usd <= 0 ||
    manifest.generation_sha256 !== generationSha256 ||
    typeof manifest.manifest_sha256 !== 'string' || !hex64.test(manifest.manifest_sha256)) fail('INVALID_WARM_CLAIM');
  const { manifest_sha256, ...unsigned } = manifest;
  if (warmManifestSha256(unsigned) !== manifest_sha256) fail('INVALID_WARM_CLAIM');
  // The per-task deadline is admission-frozen; a claim never opens a new window.
  if (claim.deadline_at !== manifest.expires_at) fail('INVALID_WARM_CLAIM');
  const credential = claim.task_credential;
  if (!credential || typeof credential !== 'object' || Array.isArray(credential) ||
    Object.keys(credential).sort().join(',') !== 'grant,token') fail('INVALID_WARM_CLAIM');
  const grant = credential.grant;
  if (!grant || typeof grant !== 'object' || Array.isArray(grant) ||
    Object.keys(grant).sort().join(',') !== WARM_TASK_GRANT_KEYS.join(',') ||
    grant.installation_id !== installationId || grant.owner_binding_sha256 !== manifest.owner_binding_sha256 ||
    grant.run_id !== run.id || grant.attempt !== 1 || grant.manifest_sha256 !== manifest.manifest_sha256 ||
    grant.epoch !== generation.epoch || grant.boot_id !== generation.boot_id || grant.transition_id !== generation.transition_id ||
    grant.generation_sha256 !== generationSha256 ||
    typeof grant.issued_at !== 'string' || !canonical(grant.issued_at) ||
    grant.expires_at !== manifest.expires_at || !(Date.parse(grant.issued_at) <= Date.parse(grant.expires_at))) fail('INVALID_WARM_CLAIM');
  if (!secretValid(credential.token) || !taskTokenShaped(credential.token)) fail('INVALID_WARM_CLAIM');
  if (Date.parse(claim.deadline_at) - now() < 1000) fail('WARM_TASK_DEADLINE_EXPIRED');
  return { run, submission_key: claim.submission_key, deadline_at: claim.deadline_at,
    text_only: { ...claim.text_only }, manifest: structuredClone(manifest), grant: structuredClone(grant) };
}

async function syncDirectory(path) {
  const fd = await open(path, 'r');
  try { await fd.sync(); } finally { await fd.close(); }
}
/** Write-once task token file. Reconstructing the same claim must reproduce the
 * identical bytes; any divergence is a permanent conflict, never a rewrite. */
async function writeOnce(path, bytes) {
  try {
    const fd = await open(path, 'wx', 0o600);
    try { await fd.writeFile(bytes); await fd.sync(); } finally { await fd.close(); }
    return;
  } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const existing = await readFile(path);
  if (!existing.equals(bytes)) fail('WARM_TASK_TOKEN_CONFLICT');
}

/** Stage one admitted warm claim: validate the full envelope against the
 * immutable generation binding, then durably write the unique task token to a
 * write-once file under the session's private task-tokens directory. Returns
 * the journal-shaped claim; the raw task token never enters the journal,
 * model context or the native environment. */
export async function stageWarmClaim(claim, context) {
  const staged = validateWarmClaim(claim, context);
  if (!isAbsolute(context.stateDirectory)) fail('INVALID_WARM_CLAIM_STAGE');
  const directory = join(context.stateDirectory, 'task-tokens');
  await mkdir(directory, { mode: 0o700, recursive: true });
  const tokenFile = join(directory, staged.run.id);
  await writeOnce(tokenFile, Buffer.from(claim.task_credential.token, 'utf8'));
  await syncDirectory(directory);
  return { run: staged.run, submission_key: staged.submission_key, deadline_at: staged.deadline_at,
    text_only: staged.text_only, manifest: staged.manifest,
    task_credential: { grant: staged.grant, token_file: tokenFile } };
}

/** Immutable launch-envelope validation context derived from the service
 * configuration. generation_sha256 binds the immutable generation digest. */
export function warmGenerationBinding(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== 'generation_sha256' ||
    typeof value.generation_sha256 !== 'string' || !hex64.test(value.generation_sha256)) fail('INVALID_SERVICE_CONFIGURATION');
  return Object.freeze({ generation_sha256: value.generation_sha256 });
}

/** Strict validation of an owner-alpha-warm-launch-v1 envelope as read by the
 * manager. Every binding must match the operator's configuration; nothing is
 * inferred or repaired. */
export function validateWarmLaunch(envelope, { installationId, ownerBindingSha256, personaId, profileSha256, request, now = Date.now }) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) ||
    Object.keys(envelope).sort().join(',') !== 'generation,host_credential,kind,schema_version' ||
    envelope.schema_version !== 1 || envelope.kind !== 'owner-alpha-warm-launch-v1') fail('HOSTED_WARM_MANAGER_REFUSED_OR_UNKNOWN');
  const generation = envelope.generation;
  if (!generation || typeof generation !== 'object' || Array.isArray(generation) ||
    Object.keys(generation).sort().join(',') !== 'boot_id,epoch,generation_sha256,policy,predecessor,session_id,transition_id' ||
    !Number.isSafeInteger(generation.epoch) || generation.epoch < 2 ||
    typeof generation.boot_id !== 'string' || !uuid.test(generation.boot_id) ||
    typeof generation.transition_id !== 'string' || !uuid.test(generation.transition_id) ||
    typeof generation.session_id !== 'string' || !uuid.test(generation.session_id) ||
    typeof generation.generation_sha256 !== 'string' || !hex64.test(generation.generation_sha256)) fail('HOSTED_WARM_MANAGER_REFUSED_OR_UNKNOWN');
  if (request.epoch !== generation.epoch || request.operationId !== generation.transition_id) fail('HOSTED_WARM_MANAGER_REFUSED_OR_UNKNOWN');
  const policy = generation.policy;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy) ||
    Object.keys(policy).sort().join(',') !== 'expires_at,max_runs,max_task_seconds,persona_id,text_only' ||
    policy.persona_id !== personaId || policy.max_runs !== 2 ||
    !Number.isSafeInteger(policy.max_task_seconds) || policy.max_task_seconds < 1 || policy.max_task_seconds > 300 ||
    textOnlyInvalid(policy.text_only) || policy.text_only.profile_sha256 !== profileSha256 ||
    typeof policy.expires_at !== 'string' || !canonical(policy.expires_at)) fail('HOSTED_WARM_MANAGER_REFUSED_OR_UNKNOWN');
  const predecessor = generation.predecessor;
  if (!predecessor || typeof predecessor !== 'object' || Array.isArray(predecessor) ||
    Object.keys(predecessor).sort().join(',') !== 'boot_id,epoch,session_id' ||
    predecessor.epoch !== generation.epoch - 1 ||
    typeof predecessor.boot_id !== 'string' || !uuid.test(predecessor.boot_id) ||
    typeof predecessor.session_id !== 'string' || !uuid.test(predecessor.session_id)) fail('HOSTED_WARM_MANAGER_REFUSED_OR_UNKNOWN');
  const credential = envelope.host_credential;
  if (!credential || typeof credential !== 'object' || Array.isArray(credential) ||
    Object.keys(credential).sort().join(',') !== 'grant,token') fail('HOSTED_WARM_MANAGER_REFUSED_OR_UNKNOWN');
  const grant = credential.grant;
  if (!grant || typeof grant !== 'object' || Array.isArray(grant) ||
    Object.keys(grant).sort().join(',') !== 'boot_id,epoch,expires_at,generation_sha256,installation_id,issued_at,transition_id' ||
    grant.installation_id !== installationId || grant.epoch !== generation.epoch ||
    grant.boot_id !== generation.boot_id || grant.transition_id !== generation.transition_id ||
    grant.generation_sha256 !== generation.generation_sha256 ||
    typeof grant.issued_at !== 'string' || !canonical(grant.issued_at) ||
    grant.expires_at !== policy.expires_at ||
    !(Date.parse(grant.issued_at) <= now()) || !(Date.parse(grant.expires_at) > now()) ||
    Date.parse(grant.expires_at) - Date.parse(grant.issued_at) > 300000) fail('HOSTED_WARM_MANAGER_REFUSED_OR_UNKNOWN');
  if (!secretValid(credential.token)) fail('HOSTED_WARM_MANAGER_REFUSED_OR_UNKNOWN');
  return { generation, policy, grant, token: credential.token };
}
