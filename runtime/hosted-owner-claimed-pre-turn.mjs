import { constants, fstatSync } from 'node:fs';
import { lstat, open, readFile, readdir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual as same } from 'node:util';
import { ownerAlphaPolicy } from './owner-alpha-policy.mjs';

const refuse = () => { throw new Error('CLAIMED_PRE_TURN_REFUSED_OR_UNKNOWN'); };
const require = value => { if (!value) refuse(); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonHash = value => hash(JSON.stringify(value));
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const utc = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, required, optional = []) => require(object(value) && required.every(key => Object.hasOwn(value, key)) &&
  Object.keys(value).every(key => [...required, ...optional].includes(key)));
const self = fileURLToPath(import.meta.url), marker = 'claimed-pre-turn-quarantine.json';
const sources = Object.fromEntries(Object.entries({ manager: './hosted-owner-manager.mjs', launcher: './hosted-owner-launcher.mjs',
  entry: './owner-alpha-entry.mjs', service: './codex-service.mjs', bridge: './execution-bridge.mjs', adapter: './codex-adapter.mjs',
  journal: './file-journal.mjs', text_only: './codex-text-only.mjs', lock_script: '../scripts/with-executor-lock.sh' })
  .map(([name, path]) => [name, fileURLToPath(new URL(path, import.meta.url))]));
const assertions = ['original_source_semantics_reviewed', 'intact_single_writer_no_rollback', 'fsync_before_turn',
  'prospective_managed_denial_reviewed'];
const isolationAssertions = ['supported_whole_execution_cut_reviewed', 'current_launch_autostart_custody_reviewed',
  'old_authority_expired_and_fenced', 'fresh_workspace_and_native_thread_no_resume', 'only_reviewed_subsequent_launch_paths'];
const label = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 256 && !/[\r\n\0]/.test(value);

// A pinned operator receipt, not provider verification or historical absence proof.
// Fixed projections make the retained bytes/source set unambiguous to reviewers.
async function isolationReceipt(receipt, request) {
  keys(receipt, ['kind', 'installation_id', 'owner_binding_sha256', 'predecessor', 'source', 'observed_at', 'valid_until',
    'execution_cut', 'managed', 'ambient_input', 'assertions']);
  const { execution_cut: cut, managed, assertions: reviewed } = receipt;
  keys(cut, ['kind', 'resource_id', 'before_kernel_boot_id', 'after_kernel_boot_id', 'completed_at', 'supported_operation',
    'retained_state_sha256', 'retained_sources_sha256']);
  keys(managed, ['requirements', 'codex_version', 'same_process_readback', 'process_id', 'kernel_boot_id',
    'allow_remote_control', 'required_memories', 'effective_memories']);
  keys(reviewed, isolationAssertions);
  const { files, roots, review } = request;
  const retained = Object.fromEntries(['runtime', 'service', 'dispatch', 'native'].map(key => [key, files[key]]));
  require(receipt.kind === 'owner-alpha-prospective-isolation-v2' && receipt.installation_id === request.installation_id &&
    receipt.owner_binding_sha256 === request.owner_binding_sha256 && same(receipt.predecessor, request.predecessor) &&
    receipt.source === review.source && receipt.observed_at === review.reviewed_at && utc(receipt.valid_until) &&
    receipt.valid_until > receipt.observed_at && Date.parse(receipt.valid_until) > Date.now() &&
    Date.parse(receipt.valid_until) - Date.parse(receipt.observed_at) <= 300000 &&
    cut.kind === 'same-resource-whole-execution-cut' && label(cut.resource_id) && label(cut.supported_operation) &&
    uuid(cut.before_kernel_boot_id) && uuid(cut.after_kernel_boot_id) && cut.before_kernel_boot_id !== cut.after_kernel_boot_id &&
    cut.after_kernel_boot_id === (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim() &&
    utc(cut.completed_at) && cut.completed_at >= request.assignment.policy.expires_at && cut.completed_at <= receipt.observed_at &&
    cut.retained_state_sha256 === jsonHash({ files: retained, roots }) &&
    cut.retained_sources_sha256 === jsonHash({ current_sources: review.current_sources, original_sources: review.original_sources }) &&
    managed.codex_version === '0.154.0' && managed.same_process_readback === true &&
    Number.isSafeInteger(managed.process_id) && managed.process_id > 0 && managed.kernel_boot_id === cut.after_kernel_boot_id &&
    managed.allow_remote_control === false && managed.required_memories === false && managed.effective_memories === false &&
    isolationAssertions.every(key => reviewed[key] === true));
  await readPinned(managed.requirements, false, true);
  await readPinned(receipt.ambient_input);
}

async function canonical(path) {
  require(typeof path === 'string' && isAbsolute(path) && resolve(path) === path && await realpath(path) === path);
}
async function readPinned(pin, privateFile = true, allowRootOwner = false) {
  keys(pin, ['path', 'sha256']); require(digest(pin.sha256)); await canonical(pin.path);
  const fd = await open(pin.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await fd.stat();
    require(before.isFile() && (before.uid === process.getuid() || allowRootOwner && before.uid === 0) && before.nlink === 1 &&
      !(before.mode & (privateFile ? 0o077 : 0o022)) && before.size > 0 && before.size <= 1048576);
    const bytes = await fd.readFile(), after = await fd.stat();
    require(bytes.length === before.size && before.size === after.size && before.mtimeMs === after.mtimeMs &&
      before.ctimeMs === after.ctimeMs && hash(bytes) === pin.sha256);
    return bytes;
  } finally { await fd.close(); }
}
async function root(pin) {
  keys(pin, ['path', 'dev', 'ino']); await canonical(pin.path);
  const stat = await lstat(pin.path);
  require(stat.isDirectory() && stat.uid === process.getuid() && (stat.mode & 0o777) === 0o700 &&
    Number.isSafeInteger(pin.dev) && Number.isSafeInteger(pin.ino) && stat.dev === pin.dev && stat.ino === pin.ino);
}
async function held(path) {
  const stat = await lstat(path);
  for (const name of await readdir('/proc/self/fd')) {
    try {
      const fd = Number(name), candidate = fstatSync(fd);
      if (fd > 2 && candidate.dev === stat.dev && candidate.ino === stat.ino &&
          /^lock:\s+\d+: FLOCK\s+ADVISORY\s+WRITE\s/m.test(await readFile(`/proc/self/fdinfo/${fd}`, 'utf8'))) return;
    } catch { /* Unrelated Node descriptors may close. */ }
  }
  refuse();
}
async function absent(path) {
  try { await lstat(path); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  refuse();
}

async function validate(path, sha256) {
  const request = JSON.parse(await readPinned({ path, sha256 }));
  keys(request, ['kind', 'installation_id', 'owner_binding_sha256', 'predecessor', 'assignment', 'text_only_binding', 'files', 'roots', 'review']);
  const { predecessor: p, files, roots, review, text_only_binding: binding } = request;
  keys(p, ['manifest_sha256', 'epoch', 'boot_id', 'transition_id', 'session_id', 'run_id', 'attempt', 'submission_key', 'native_attempt_id', 'native_fingerprint']);
  keys(request.assignment, ['grant', 'policy']);
  const { grant } = request.assignment, policy = ownerAlphaPolicy(request.assignment.policy);
  keys(grant, ['installation_id', 'owner_binding_sha256', 'run_id', 'epoch', 'boot_id', 'transition_id', 'manifest_sha256', 'issued_at', 'expires_at']);
  require(request.kind === 'owner-alpha-claimed-pre-turn-request-v2' && typeof request.installation_id === 'string' &&
    /^[a-zA-Z0-9_-]{1,128}$/.test(request.installation_id) && digest(request.owner_binding_sha256) &&
    [p.manifest_sha256, p.native_attempt_id, p.native_fingerprint].every(digest) &&
    [p.boot_id, p.transition_id, p.session_id, p.run_id].every(uuid) && Number.isSafeInteger(p.epoch) && p.epoch >= 2 &&
    p.attempt === 1 && p.submission_key === `${p.run_id}:1` && p.native_attempt_id === jsonHash([request.installation_id, p.submission_key]) &&
    grant.installation_id === request.installation_id && grant.owner_binding_sha256 === request.owner_binding_sha256 &&
    ['manifest_sha256', 'epoch', 'boot_id', 'transition_id', 'run_id'].every(key => grant[key] === p[key]) &&
    policy.session_id === p.session_id && policy.max_runs === 1 && policy.text_only && grant.expires_at === policy.expires_at &&
    utc(grant.issued_at) && grant.issued_at < grant.expires_at && Date.parse(grant.expires_at) - Date.parse(grant.issued_at) <= 300000);
  keys(review, ['source', 'reviewed_at', 'assertions', 'current_sources', 'original_sources',
    'historical_memory_activity', 'historical_remote_ingress']);
  keys(review.assertions, assertions); keys(review.current_sources, Object.keys(sources)); keys(review.original_sources, Object.keys(sources));
  require(review.historical_memory_activity === 'unknown' && review.historical_remote_ingress === 'unknown' &&
    assertions.every(key => review.assertions[key] === true) && typeof review.source === 'string' && review.source.trim() &&
    review.source.length <= 256 && !/[\r\n\0]/.test(review.source) && utc(review.reviewed_at) &&
    review.reviewed_at >= policy.expires_at && Date.parse(review.reviewed_at) <= Date.now());
  for (const [key, path] of Object.entries(sources)) {
    await readPinned({ path, sha256: review.current_sources[key] }, false);
    await readPinned(review.original_sources[key]);
  }
  keys(files, ['manager', 'template', 'runtime', 'service', 'dispatch', 'native', 'requirements_evidence']);
  const loaded = {};
  for (const [key, pin] of Object.entries(files)) {
    const bytes = await readPinned(pin);
    loaded[key] = JSON.parse(bytes);
  }
  await isolationReceipt(loaded.requirements_evidence, request);
  keys(roots, ['native_home', 'sessions_root', 'session', 'journal']);
  for (const pin of Object.values(roots)) await root(pin);
  require(new Set(Object.values(roots).map(pin => `${pin.dev}:${pin.ino}`)).size === 4);
  const { manager, template, runtime, service, dispatch, native } = loaded;
  keys(manager, ['kind', 'portalOrigin', 'installationId', 'hostedOwnerBindingSha256', 'managerTokenFile', 'templatePath', 'templateSha256', 'sessionsDirectory'],
    ['accessClientIdFile', 'accessClientSecretFile']);
  require(manager.kind === 'owner-alpha-manager-v1' && manager.installationId === request.installation_id &&
    manager.hostedOwnerBindingSha256 === request.owner_binding_sha256 && manager.sessionsDirectory === roots.sessions_root.path &&
    manager.templatePath === files.template.path && manager.templateSha256 === files.template.sha256 &&
    roots.session.path === join(roots.sessions_root.path, p.transition_id) && roots.journal.path === join(roots.session.path, 'journal') &&
    files.runtime.path === join(roots.session.path, 'runtime.json') && template.nativeHome === roots.native_home.path &&
    template.installationId === manager.installationId && template.hostedOwnerBindingSha256 === manager.hostedOwnerBindingSha256 &&
    template.portalOrigin === manager.portalOrigin);
  const origin = new URL(manager.portalOrigin);
  require(origin.protocol === 'https:' && !origin.username && !origin.password && !origin.search && !origin.hash && origin.pathname === '/');
  const generation = { epoch: p.epoch, boot_id: p.boot_id, transition_id: p.transition_id }, identity = { epoch: p.epoch, boot_id: p.boot_id };
  require(same(runtime, { ...template, stateDirectory: roots.session.path, runtimeTokenFile: join(roots.session.path, 'runtime-token'),
    ownerAlpha: policy, ownerAlphaGeneration: generation }));
  const templatePolicy = ownerAlphaPolicy(template.ownerAlpha);
  keys(binding, ['version', 'codexVersion', 'model', 'catalogSha256', 'commandedConfigSha256']);
  require(binding.version === 'codex-text-only-v1' && binding.codexVersion === '0.154.0' && digest(binding.catalogSha256) &&
    digest(binding.commandedConfigSha256) && binding.catalogSha256 === jsonHash(template.textOnlyProfile?.modelCatalog) &&
    template.textOnlyProfile?.model === binding.model && template.textOnlyProfile?.codexVersion === binding.codexVersion &&
    jsonHash(binding) === policy.text_only.profile_sha256 && same(templatePolicy.text_only, policy.text_only) &&
    templatePolicy.persona_id === policy.persona_id && Object.keys(template.personas).length === 1);
  const persona = template.personas[policy.persona_id];
  require(persona?.model === binding.model && Array.isArray(persona.allowedTools) && persona.allowedTools.length === 0 &&
    typeof persona.agentId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(persona.agentId));
  require(files.service.path === join(roots.journal.path, 'service.json') &&
    files.dispatch.path === join(roots.journal.path, `dispatch-${jsonHash(identity)}.json`) &&
    files.native.path === join(roots.journal.path, `${p.native_attempt_id}.json`));
  // Extra journals, including pending temp/effect/tool records, are not absence evidence.
  require(same((await readdir(roots.journal.path)).sort(), ['service.json', `dispatch-${jsonHash(identity)}.json`, `${p.native_attempt_id}.json`].sort()));
  keys(service, ['phase', 'bootId', 'ownerAlpha', 'ownerAlphaGeneration', 'hostedOwner', 'identity', 'permissions', 'nativeStopped']);
  require(service.phase === 'recovery' && service.nativeStopped === true && service.bootId === p.boot_id && same(service.identity, identity) &&
    same(service.ownerAlpha, policy) && same(service.ownerAlphaGeneration, generation) &&
    same(service.hostedOwner, { bindingSha256: request.owner_binding_sha256, origin: origin.origin }));
  keys(service.permissions, ['name', 'configSha256']);
  require(/^hehebot-restricted-[a-f0-9]{64}$/.test(service.permissions.name) && digest(service.permissions.configSha256));
  keys(dispatch, ['phase', 'identity', 'claim', 'attemptId'], ['nativeRunId', 'nativeThreadId', 'result', 'families']);
  require(dispatch.phase === 'submission_unknown' && same(dispatch.identity, identity) && dispatch.attemptId === p.native_attempt_id &&
    ['nativeRunId', 'nativeThreadId', 'result'].every(key => !Object.hasOwn(dispatch, key) || dispatch[key] === null) &&
    (!Object.hasOwn(dispatch, 'families') || same(dispatch.families, [])));
  const { claim } = dispatch;
  keys(claim, ['run', 'submission_key', 'deadline_at', 'text_only']);
  const { run } = claim;
  keys(run, ['role', 'parent_run_id', 'title', 'id', 'command_id', 'occurrence_id', 'persona_id', 'routine_id', 'context_json',
    'status', 'current_attempt', 'error_code', 'checkpoint_json', 'created_at', 'updated_at']);
  require(run.id === p.run_id && run.current_attempt === 1 && run.status === 'claimed' && run.persona_id === policy.persona_id &&
    run.role === 'coordinator' && run.parent_run_id === null && run.routine_id === null && run.occurrence_id === null &&
    run.checkpoint_json === null && run.error_code === null && claim.submission_key === p.submission_key &&
    same(claim.text_only, policy.text_only) && utc(claim.deadline_at) && claim.deadline_at <= policy.expires_at && claim.deadline_at > grant.issued_at);
  const context = JSON.parse(run.context_json);
  require(object(context) && !context.room_id);
  // Reproduce the pinned first-party bridge input, without executing original snapshots.
  const message = JSON.stringify({ ...context, skills: (context.skills ?? []).map(skill => ({ id: skill.id, revision: skill.revision,
    name: skill.body.name, description: skill.body.description, when_to_use: skill.body.when_to_use, load_with: 'hehebot_read_skill' })) });
  const values = [p.native_attempt_id, request.installation_id, persona.agentId, 'conversation', policy.persona_id, message, persona.model];
  const fingerprint = jsonHash([[values, { permissionsProfile: service.permissions.name,
    ownerAlpha: ownerAlphaPolicy({ ...policy, expires_at: claim.deadline_at }) }], { textOnlyProfile: binding }]);
  require(fingerprint === p.native_fingerprint);
  keys(native, ['attemptId', 'fingerprint', 'status', 'threadId', 'nativeRunId', 'rootSettled', 'cancelAcknowledged', 'textOnlyProfile'],
    ['recoveryRequired', 'error', 'submissionFailure']);
  require(native.attemptId === p.native_attempt_id && native.fingerprint === fingerprint && native.threadId === null && native.nativeRunId === null &&
    native.rootSettled === false && native.cancelAcknowledged === false && same(native.textOnlyProfile, policy.text_only) &&
    (native.status === 'thread_unknown' || native.status === 'recovery_required') &&
    (!Object.hasOwn(native, 'recoveryRequired') || native.recoveryRequired === true) &&
    (!Object.hasOwn(native, 'error') || native.error === 'SUBMISSION_OUTCOME_UNKNOWN'));
  if (native.submissionFailure !== undefined) {
    keys(native.submissionFailure, ['stage', 'code'], ['rpcCode']);
    require(['admission', 'thread_start', 'thread_ack'].includes(native.submissionFailure.stage) &&
      ['CODEX_RPC_ERROR', 'CODEX_TIMEOUT', 'CODEX_PROTOCOL_ERROR', 'OWNER_ALPHA_ADMISSION_DENIED', 'UNKNOWN_ERROR'].includes(native.submissionFailure.code) &&
      (!Object.hasOwn(native.submissionFailure, 'rpcCode') || native.submissionFailure.code === 'CODEX_RPC_ERROR' &&
        Number.isInteger(native.submissionFailure.rpcCode) && native.submissionFailure.rpcCode >= -2147483648 && native.submissionFailure.rpcCode <= 2147483647));
  }
  await absent(join(roots.session.path, marker));
  return request;
}

/** Operator evidence only. Isolation assertions remain trusted review, never
 * mechanical proof of absent startup effects, retirement or successor authority. */
export async function produceClaimedPreTurnEvidence(path, sha256) {
  try {
    const request = await validate(path, sha256);
    const { stdout } = await promisify(execFile)('bash', [sources.lock_script, request.roots.native_home.path,
      'bash', sources.lock_script, request.roots.session.path, process.execPath, self, '--write-locked', path, sha256], { maxBuffer: 16384 });
    return JSON.parse(stdout);
  } catch { refuse(); }
}
async function writeLocked(path, sha256) {
  const request = await validate(path, sha256);
  await held(request.roots.native_home.path); await held(request.roots.session.path);
  const receipt = JSON.parse(await readPinned(request.files.requirements_evidence));
  await isolationReceipt(receipt, request);
  const observed_at = new Date().toISOString(), source = request.review.source;
  require(observed_at >= request.review.reviewed_at && observed_at >= request.assignment.policy.expires_at);
  const identity = { kind: 'claimed-pre-turn-quarantine-v1', installation_id: request.installation_id,
    owner_binding_sha256: request.owner_binding_sha256, predecessor: request.predecessor };
  const bytes = Buffer.from(JSON.stringify({ ...identity, evidence_format: 'claimed-pre-turn-evidence-v2', observed_at, source, request_sha256: sha256,
    policy_expires_at: request.assignment.policy.expires_at, files: request.files, roots: request.roots,
    text_only_binding: request.text_only_binding, trusted_operator_review: request.review,
    trusted_prospective_isolation: receipt }) + '\n');
  const target = join(request.roots.session.path, marker), fd = await open(target, 'wx', 0o400);
  try { await fd.writeFile(bytes); await fd.sync(); } finally { await fd.close(); }
  const directory = await open(request.roots.session.path, 'r');
  try { await directory.sync(); } finally { await directory.close(); }
  await readPinned({ path: target, sha256: hash(bytes) });
  return { ...identity, evidence: { sha256: hash(bytes), observed_at, source } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [mode, path, sha256] = process.argv.slice(2);
    require(process.argv.length === 5 && ['--produce', '--write-locked'].includes(mode));
    console.log(JSON.stringify(await (mode === '--produce' ? produceClaimedPreTurnEvidence : writeLocked)(path, sha256)));
  } catch { console.error('CLAIMED_PRE_TURN_REFUSED_OR_UNKNOWN'); process.exitCode = 1; }
}
