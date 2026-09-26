import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once, EventEmitter } from 'node:events';
import { ControlClient } from '../runtime/control-client.mjs';
import { runHostedOwnerBackgroundManager, prepareHostedOwnerBackgroundManager } from '../runtime/hosted-owner-background-manager.mjs';
import { createHostedOwnerWakeService } from '../runtime/hosted-owner-wake.mjs';
import { readOwnerAlphaConfig } from '../runtime/owner-alpha-entry.mjs';
import { backgroundManifestSha256, backgroundProfileSha256, stageBackgroundClaim, validateBackgroundClaim,
  validateBackgroundLaunch, validateBackgroundProfile, backgroundGenerationBinding,
  BACKGROUND_ROLES, BACKGROUND_MANIFEST_KEYS, BACKGROUND_TASK_GRANT_KEYS, BACKGROUND_CLAIM_KEYS } from '../runtime/owner-alpha-background-binding.mjs';
import { FileJournal } from '../runtime/file-journal.mjs';
import { CodexOperations } from '../runtime/codex-operations.mjs';

// The real client is the existing first-party TS bundle, not a copied mock.
execFileSync('bash', [new URL('../scripts/build-codex-service.sh', import.meta.url).pathname], { stdio: 'pipe' });

const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const sha = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const token = kind => [Buffer.from(JSON.stringify({ typ: `${kind}+jwt`, alg: 'HS256' })).toString('base64url'), 'e30', 'c2ln'].join('.');
const readOnlyTools = Object.freeze(['hehebot_list_routines', 'hehebot_read_skill', 'hehebot_send_message']);
const now = Date.now();
const backgroundProfile = { profile_version: 'codex-background-v2-restricted-v1', profile_sha256: 'ab'.repeat(32),
  max_resident_child_threads: 2, wait_agent_enabled: false, multi_agent_v1: false };

test('background coverage receipt only applies to admitted S/B roots, never A or legacy', async () => {
  const row = { threadId: 'thread-s', nativeRunId: 'turn-s', rootSettled: true, nativeOutcome: 'completed',
    backgroundReceipt: { thread_id: 'thread-s', turn_id: 'turn-s', output_sha256: sha('status output') } };
  const coverage = async (backgroundRole, changes = {}) => (await new CodexOperations({
    journal: { get: async () => ({ ...row, ...changes }) }, attemptId: 'root-s', runId: id(41), attempt: 1,
    startedAt: new Date(now - 1000).toISOString(), deadlineAt: new Date(now + 60000).toISOString(), backgroundRole,
  }).snapshot())[0].status;
  for (const role of [null, 'background', 'unknown']) assert.equal(await coverage(role), 'unknown');
  for (const role of ['status', 'independent']) {
    assert.equal(await coverage(role), 'settled');
    assert.equal(await coverage(role, { backgroundReceipt: { ...row.backgroundReceipt, output_sha256: 'invalid' } }), 'unknown');
    assert.equal(await coverage(role, { backgroundReceipt: { ...row.backgroundReceipt, turn_id: 'foreign' } }), 'unknown');
    assert.equal(await coverage(role, { childTurns: { '["child","turn"]': 'inProgress' } }), 'unknown');
    assert.equal(await coverage(role, { rootSettled: false }), 'unknown');
  }
});

/** One valid owner-alpha-background-claim-v1 envelope for a manifest ordinal. */
function claimFixture({ admission = 1, runId = id(4) } = {}) {
  const role = BACKGROUND_ROLES[admission - 1];
  const manifest = { schema_version: 1, kind: 'owner-alpha-background-manifest-v1', admission, role,
    installation_id: 'background-fixture', owner_binding_sha256: 'cd'.repeat(32), run_id: runId, persona_id: id(2),
    command_id: id(7), command_sha256: 'ef'.repeat(32), event_sequence: 3, policy_revision: 'background-unit-v1',
    epoch: 2, boot_id: id(5), transition_id: id(6), session_id: id(1), background: { ...backgroundProfile },
    issued_at: new Date(now - 2000).toISOString(), expires_at: new Date(now + 60000).toISOString(),
    reservation_micro_usd: 2000, generation_sha256: 'ab'.repeat(32),
    ...(role === 'status' ? { status_summary_sha256: '12'.repeat(32) } : {}) };
  manifest.manifest_sha256 = backgroundManifestSha256(manifest);
  const { manifest_sha256, ...unsigned } = manifest;
  assert.equal(backgroundManifestSha256(unsigned), manifest.manifest_sha256);
  const grant = { installation_id: manifest.installation_id, owner_binding_sha256: manifest.owner_binding_sha256,
    run_id: manifest.run_id, attempt: 1, manifest_sha256, epoch: manifest.epoch, boot_id: manifest.boot_id,
    transition_id: manifest.transition_id, generation_sha256: manifest.generation_sha256,
    issued_at: manifest.issued_at, expires_at: manifest.expires_at };
  return { claim: { schema_version: 1, kind: 'owner-alpha-background-claim-v1',
    run: { id: runId, current_attempt: 1, persona_id: id(2), role: 'coordinator', command_id: manifest.command_id,
      context_json: JSON.stringify({ room_id: null }) },
    submission_key: `${runId}:1`, deadline_at: manifest.expires_at, role, background: { ...backgroundProfile },
    manifest: { admission, role, manifest_sha256, expires_at: manifest.expires_at },
    task_credential: { grant, token: token('hehebot-background-task') },
    ...(role === 'background' ? { owner_alpha_background: true } : {}),
    ...(role === 'status' ? { status_summary: {
      schema_version: 1, kind: 'owner-alpha-background-status-summary-v1',
      generation: { epoch: manifest.epoch, generation_sha256: manifest.generation_sha256 },
      admissions: [{ admission: 1, role: 'background', run_id: id(4), run_status: 'running', attempt_status: 'running',
        coordinator_released: true, deadline_at: manifest.expires_at, child_count: 0,
        manifest_sha256: 'aa'.repeat(32) }], computed_at: manifest.issued_at } } : {}) },
    manifest, grant };
}

function claimContext(overrides = {}) {
  return { installationId: 'background-fixture', stateDirectory: 'unused', generationSha256: 'ab'.repeat(32),
    generation: { epoch: 2, boot_id: id(5), transition_id: id(6), session_id: id(1), persona_id: id(2) },
    background: { ...backgroundProfile }, now: () => now, ...overrides };
}

test('background principals have disjoint fixed route allowlists; legacy and warm meaning unchanged', async () => {
  const calls = [];
  const manager = new ControlClient({ origin: 'https://portal.example', token: 'manager-secret', principal: 'background-manager',
    fetchImpl: async (...args) => { calls.push(args); return new Response('null', { headers: { 'Content-Type': 'application/json' } }); } });
  assert.equal(await manager.request('generation', {}), null);
  assert.equal(calls[0][0], 'https://portal.example/internal/background/manager/generation');
  const host = new ControlClient({ origin: 'https://portal.example', token: 'host-secret', principal: 'background-host',
    fetchImpl: async (...args) => { calls.push(args); return new Response('null', { headers: { 'Content-Type': 'application/json' } }); } });
  assert.equal(await host.request('claim', { identity: {} }), null);
  assert.equal(calls[1][0], 'https://portal.example/internal/background/host/claim');
  const task = new ControlClient({ origin: 'https://portal.example', token: 'task-secret', principal: 'background-task',
    fetchImpl: async (...args) => { calls.push(args); return new Response('{}', { headers: { 'Content-Type': 'application/json' } }); } });
  assert.deepEqual(await task.request('agent-routines', {}), {});
  assert.equal(calls[2][0], 'https://portal.example/internal/background/task/agent-routines');
  for (const [client, type] of [[manager, 'manifest'], [manager, 'boot'], [manager, 'agent-routines'], [host, 'agent-routines'],
    [host, 'agent-command'], [host, 'effect-intent'], [task, 'claim'], [task, 'boot'], [task, 'agent-command'], [task, '../claim']]) {
    await assert.rejects(client.request(type, {}), { code: 'UNSUPPORTED_RUNTIME_ENDPOINT' });
  }
  // Legacy and warm principals never gain background routes and vice versa.
  const runtime = new ControlClient({ origin: 'https://portal.example', token: 'runtime-secret',
    fetchImpl: () => assert.fail('must reject before dispatch') });
  for (const type of ['generation', 'retirement']) await assert.rejects(runtime.request(type, {}), { code: 'UNSUPPORTED_RUNTIME_ENDPOINT' });
  const warmHost = new ControlClient({ origin: 'https://portal.example', token: 'warm-secret', principal: 'warm-host',
    fetchImpl: () => assert.fail('must reject before dispatch') });
  await assert.rejects(warmHost.request('native-child', {}), { code: 'UNSUPPORTED_RUNTIME_ENDPOINT' });
  for (const principal of ['background', 'background-host ', 'BACKGROUND-MANAGER', 'background-manager-v2']) {
    assert.throws(() => new ControlClient({ origin: 'https://portal.example', token: 'x'.repeat(32), principal }), { code: 'INVALID_CONFIGURATION' });
  }
});

test('background manifest digest is the frozen versioned canonical digest, never a warm or legacy one', () => {
  const unsigned = { schema_version: 1, kind: 'owner-alpha-background-manifest-v1', admission: 1, role: 'background',
    installation_id: 'background-fixture', owner_binding_sha256: 'cd'.repeat(32), run_id: id(4), persona_id: id(2),
    command_id: id(7), command_sha256: 'ef'.repeat(32), event_sequence: 3, policy_revision: 'background-unit-v1',
    epoch: 2, boot_id: id(5), transition_id: id(6), session_id: id(1), background: { ...backgroundProfile },
    issued_at: new Date(now - 2000).toISOString(), expires_at: new Date(now + 60000).toISOString(),
    reservation_micro_usd: 2000, generation_sha256: 'ab'.repeat(32) };
  const independent = createHash('sha256').update(JSON.stringify([unsigned.schema_version, unsigned.kind, unsigned.admission,
    unsigned.role, unsigned.installation_id, unsigned.owner_binding_sha256, unsigned.run_id, unsigned.persona_id, unsigned.command_id,
    unsigned.command_sha256, unsigned.event_sequence, unsigned.policy_revision, unsigned.epoch, unsigned.boot_id,
    unsigned.transition_id, unsigned.session_id, unsigned.background.profile_version, unsigned.background.profile_sha256,
    unsigned.background.max_resident_child_threads, unsigned.background.wait_agent_enabled, unsigned.background.multi_agent_v1,
    unsigned.issued_at, unsigned.expires_at, unsigned.reservation_micro_usd, unsigned.generation_sha256, null])).digest('hex');
  assert.equal(backgroundManifestSha256(unsigned), independent);
  assert.equal(BACKGROUND_MANIFEST_KEYS.length, 22); // 21 signed fields plus the digest itself
  assert.equal(BACKGROUND_TASK_GRANT_KEYS.length, 11);
  assert.deepEqual(BACKGROUND_ROLES, ['background', 'status', 'independent']);
  assert.deepEqual(BACKGROUND_CLAIM_KEYS.background, ['background', 'deadline_at', 'kind', 'manifest',
    'owner_alpha_background', 'role', 'run', 'schema_version', 'submission_key', 'task_credential']);
  assert.deepEqual(BACKGROUND_CLAIM_KEYS.status, ['background', 'deadline_at', 'kind', 'manifest', 'role', 'run',
    'schema_version', 'status_summary', 'submission_key', 'task_credential']);
  assert.deepEqual(BACKGROUND_CLAIM_KEYS.independent, ['background', 'deadline_at', 'kind', 'manifest', 'role', 'run',
    'schema_version', 'submission_key', 'task_credential']);
  // The digest covers the frozen deadline and the status summary digest.
  assert.notEqual(backgroundManifestSha256({ ...unsigned, expires_at: new Date(now + 61000).toISOString() }), independent);
  assert.notEqual(backgroundManifestSha256({ ...unsigned, admission: 2, role: 'status', status_summary_sha256: '12'.repeat(32) }), independent);
  // The profile digest binds all five restricted fields.
  assert.equal(backgroundProfileSha256(backgroundProfile),
    sha([backgroundProfile.profile_version, backgroundProfile.profile_sha256, backgroundProfile.max_resident_child_threads,
      backgroundProfile.wait_agent_enabled, backgroundProfile.multi_agent_v1]));
  for (const mutate of [{ max_resident_child_threads: 3 }, { wait_agent_enabled: true }, { multi_agent_v1: true },
    { profile_version: 'codex-background-v3' }, { profile_sha256: 'zz'.repeat(32) }, { extra: true }]) {
    assert.throws(() => validateBackgroundProfile({ ...backgroundProfile, ...mutate }), { code: 'INVALID_BACKGROUND_PROFILE' });
  }
});

test('validateBackgroundClaim derives the role from the manifest ordinal, never caller text', () => {
  for (const admission of [1, 2, 3]) {
    const { claim, manifest } = claimFixture({ admission });
    const staged = validateBackgroundClaim(structuredClone(claim), claimContext());
    assert.equal(staged.role, BACKGROUND_ROLES[admission - 1]);
    assert.equal(staged.role, manifest.role);
    assert.equal(staged.deadline_at, manifest.expires_at);
    assert.equal(staged.grant.manifest_sha256, manifest.manifest_sha256);
  }
  // User text cannot elect a role: the claim role must equal the ordinal's role.
  const swapped = claimFixture({ admission: 2 });
  swapped.claim.role = 'independent';
  assert.throws(() => validateBackgroundClaim(swapped.claim, claimContext()), { code: 'INVALID_BACKGROUND_CLAIM' });
  // The background root alone reuses the existing V2 claim flag; status carries
  // the frozen summary; independent carries neither.
  const withFlag = claimFixture({ admission: 2 });
  withFlag.claim.owner_alpha_background = true;
  assert.throws(() => validateBackgroundClaim(withFlag.claim, claimContext()), { code: 'INVALID_BACKGROUND_CLAIM' });
  const independentWithSummary = claimFixture({ admission: 3 });
  independentWithSummary.claim.status_summary = claimFixture({ admission: 2 }).claim.status_summary;
  assert.throws(() => validateBackgroundClaim(independentWithSummary.claim, claimContext()), { code: 'INVALID_BACKGROUND_CLAIM' });
});

test('validateBackgroundClaim refuses tampered or mismatched envelopes without staging', () => {
  const base = claimFixture();
  const attempts = [
    claim => { claim.deadline_at = new Date(Date.parse(claim.manifest.expires_at) + 1000).toISOString(); },
    claim => { claim.manifest.manifest_sha256 = 'ff'.repeat(32); },
    claim => { claim.manifest.role = 'independent'; }, // role not from ordinal
    claim => { claim.manifest.admission = 4; },
    claim => { claim.task_credential.token = token('hehebot-runtime-generation'); },
    claim => { claim.task_credential.token = token('hehebot-warm-task'); },
    claim => { claim.task_credential.grant.run_id = id(8); },
    claim => { claim.task_credential.grant.attempt = 2; },
    claim => { claim.task_credential.grant.manifest_sha256 = 'ee'.repeat(32); },
    claim => { claim.task_credential.grant.generation_sha256 = 'cd'.repeat(32); },
    claim => { claim.task_credential.grant.epoch = 3; },
    claim => { claim.task_credential.grant.boot_id = id(9); },
    claim => { claim.task_credential.grant.transition_id = id(9); },
    claim => { claim.run.persona_id = id(9); },
    claim => { claim.run.current_attempt = 2; },
    claim => { claim.run.role = 'child'; },
    claim => { claim.background.max_resident_child_threads = 4; }, // profile mismatch
    claim => { claim.background.wait_agent_enabled = true; },
    claim => { claim.submission_key = `${claim.run.id}:2`; },
    claim => { claim.extra = true; },
    claim => { claim.manifest.extra = true; },
    claim => { claim.task_credential.grant.extra = true; },
    claim => { claim.task_credential.token = 'not-a-jwt'; },
    claim => { claim.run = null; },
  ];
  for (const mutate of attempts) {
    const claim = structuredClone(base.claim); mutate(claim);
    assert.throws(() => validateBackgroundClaim(claim, claimContext()), { code: 'INVALID_BACKGROUND_CLAIM' });
  }
  // A status summary bound to a foreign generation, epoch or admission refuses.
  for (const mutate of [summary => ({ ...summary, generation: { ...summary.generation, epoch: 3 } }),
    summary => ({ ...summary, generation: { ...summary.generation, generation_sha256: 'cd'.repeat(32) } }),
    summary => ({ ...summary, admissions: [] }), summary => ({ ...summary, computed_at: 'not-a-date' }),
    summary => ({ ...summary, kind: 'owner-alpha-background-status-summary-v2' })]) {
    const statusClaim = claimFixture({ admission: 2 });
    statusClaim.claim.status_summary = mutate(statusClaim.claim.status_summary);
    assert.throws(() => validateBackgroundClaim(statusClaim.claim, claimContext()), { code: 'INVALID_BACKGROUND_CLAIM' });
  }
  // A claim inside its final partial second is expired before any staging.
  const expiringClaim = claim => {
    const { manifest_sha256, ...unsigned } = structuredClone(base.manifest);
    unsigned.expires_at = claim.expires_at;
    const recomputed = backgroundManifestSha256(unsigned);
    return structuredClone({ ...base.claim, deadline_at: unsigned.expires_at,
      manifest: { admission: unsigned.admission, role: unsigned.role, manifest_sha256: recomputed, expires_at: unsigned.expires_at },
      task_credential: { ...base.claim.task_credential, grant: { ...base.claim.task_credential.grant,
        manifest_sha256: recomputed, expires_at: unsigned.expires_at } } });
  };
  assert.throws(() => validateBackgroundClaim(expiringClaim({ expires_at: new Date(now + 500).toISOString() }), claimContext()),
    { code: 'BACKGROUND_TASK_DEADLINE_EXPIRED' });
  // One full second remaining is the accepted boundary.
  const boundary = expiringClaim({ expires_at: new Date(now + 1000).toISOString() });
  assert.equal(validateBackgroundClaim(boundary, claimContext()).deadline_at, boundary.manifest.expires_at);
});

test('stageBackgroundClaim writes the unique task token once, 0600, without journaling the raw token', async t => {
  const root = await mkdtemp(join(tmpdir(), 'hehe-background-stage-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stateDirectory = join(root, 'session');
  await mkdir(stateDirectory, { mode: 0o700 });
  const { claim } = claimFixture();
  const first = await stageBackgroundClaim(structuredClone(claim), claimContext({ stateDirectory }));
  assert.equal(first.task_credential.token_file, join(stateDirectory, 'task-tokens', claim.run.id));
  assert.equal((await stat(first.task_credential.token_file)).mode & 0o777, 0o600);
  assert.equal((await stat(join(stateDirectory, 'task-tokens'))).mode & 0o777, 0o700);
  assert.ok(!('token' in first.task_credential));
  assert.ok(!JSON.stringify(first).includes(claim.task_credential.token));
  assert.equal(first.role, 'background');
  assert.equal(first.owner_alpha_background, true);
  // Replaying the identical claim reproduces the identical staged bytes.
  const replay = await stageBackgroundClaim(structuredClone(claim), claimContext({ stateDirectory }));
  assert.deepEqual(replay, first);
  // Divergent bytes for the same run are a permanent conflict, never a rewrite.
  const conflicting = structuredClone(claim);
  conflicting.task_credential.token = token('hehebot-background-task') + 'x';
  await assert.rejects(stageBackgroundClaim(conflicting, claimContext({ stateDirectory })), { code: 'BACKGROUND_TASK_TOKEN_CONFLICT' });
  assert.equal(await readFile(first.task_credential.token_file, 'utf8'), claim.task_credential.token);
  assert.deepEqual(await readdir(join(stateDirectory, 'task-tokens')), [claim.run.id]);
  // Distinct roles stage their own distinct write-once tokens and flags.
  const statusClaim = claimFixture({ admission: 2, runId: id(9) });
  const stagedStatus = await stageBackgroundClaim(statusClaim.claim, claimContext({ stateDirectory }));
  assert.equal(stagedStatus.role, 'status');
  assert.ok(!Object.hasOwn(stagedStatus, 'owner_alpha_background'));
  assert.ok(Object.hasOwn(stagedStatus, 'status_summary'));
  const independentClaim = claimFixture({ admission: 3, runId: id(10) });
  const stagedIndependent = await stageBackgroundClaim(independentClaim.claim, claimContext({ stateDirectory }));
  assert.equal(stagedIndependent.role, 'independent');
  assert.ok(!Object.hasOwn(stagedIndependent, 'owner_alpha_background'));
  assert.ok(!Object.hasOwn(stagedIndependent, 'status_summary'));
  assert.equal(new Set([first.task_credential.token_file, stagedStatus.task_credential.token_file,
    stagedIndependent.task_credential.token_file]).size, 3);
  // Relative state directories never stage.
  await assert.rejects(stageBackgroundClaim(structuredClone(claim), claimContext({ stateDirectory: 'relative' })), { code: 'INVALID_BACKGROUND_CLAIM_STAGE' });
});

test('backgroundGenerationBinding binds the generation and profile digests', () => {
  assert.deepEqual(backgroundGenerationBinding({ generation_sha256: 'ab'.repeat(32), background_profile_sha256: 'cd'.repeat(32) }),
    { generation_sha256: 'ab'.repeat(32), background_profile_sha256: 'cd'.repeat(32) });
  for (const value of [{}, { generation_sha256: 'ab'.repeat(32) }, { generation_sha256: 'ab'.repeat(32), background_profile_sha256: 'zz' },
    { generation_sha256: 'ab'.repeat(32), background_profile_sha256: 'cd'.repeat(32), extra: 1 }, null]) {
    assert.throws(() => backgroundGenerationBinding(value), { code: 'INVALID_SERVICE_CONFIGURATION' });
  }
});

function launchFixture() {
  const generation = { epoch: 2, boot_id: id(5), transition_id: id(6), session_id: id(1), generation_sha256: 'ab'.repeat(32),
    policy: { persona_id: id(2), expires_at: new Date(Date.now() + 60000).toISOString(), max_runs: 3, max_task_seconds: 30,
      background: { ...backgroundProfile } },
    predecessor: { epoch: 1, boot_id: id(3), session_id: id(1) } };
  const envelope = { schema_version: 1, kind: 'owner-alpha-background-launch-v1', generation,
    host_credential: { grant: { installation_id: 'background-fixture', epoch: generation.epoch, boot_id: generation.boot_id,
      transition_id: generation.transition_id, generation_sha256: generation.generation_sha256,
      issued_at: new Date(Date.now() - 1000).toISOString(), expires_at: generation.policy.expires_at },
      token: 'opaque-host-credential' } };
  return { envelope, generation };
}

test('validateBackgroundLaunch accepts only the operator-bound envelope', () => {
  const { envelope, generation } = launchFixture();
  const accepted = validateBackgroundLaunch(structuredClone(envelope), { installationId: 'background-fixture',
    ownerBindingSha256: 'cd'.repeat(32), personaId: generation.policy.persona_id, backgroundProfile,
    request: { epoch: 2, operationId: generation.transition_id } });
  assert.equal(accepted.token, 'opaque-host-credential');
  assert.equal(accepted.generation.generation_sha256, generation.generation_sha256);
  const attempts = [
    e => { e.generation.policy.max_runs = 2; },
    e => { e.generation.policy.max_runs = 4; },
    e => { e.generation.policy.persona_id = id(9); },
    e => { e.generation.policy.background.max_resident_child_threads = 1; },
    e => { e.generation.policy.background.wait_agent_enabled = true; },
    e => { e.generation.policy.expires_at = new Date(Date.now() + 301000).toISOString(); },
    e => { e.generation.epoch = 1; },
    e => { e.generation.predecessor.epoch = 3; },
    e => { e.host_credential.grant.installation_id = 'other-installation'; },
    e => { e.host_credential.grant.expires_at = new Date(Date.parse(e.generation.policy.expires_at) + 1000).toISOString(); },
    e => { e.host_credential.grant.issued_at = new Date(Date.now() + 30000).toISOString(); },
    e => { e.host_credential.grant.generation_sha256 = 'cd'.repeat(32); },
    e => { e.host_credential.grant.issued_at = new Date(Date.parse(e.generation.policy.expires_at) - 400000).toISOString(); },
    e => { e.host_credential.token = ''; },
    e => { e.extra = true; },
  ];
  for (const mutate of attempts) {
    const candidate = structuredClone(envelope); mutate(candidate);
    assert.throws(() => validateBackgroundLaunch(candidate, { installationId: 'background-fixture', ownerBindingSha256: 'cd'.repeat(32),
      personaId: generation.policy.persona_id, backgroundProfile, request: { epoch: 2, operationId: generation.transition_id } }),
      { code: 'HOSTED_BACKGROUND_MANAGER_REFUSED_OR_UNKNOWN' });
  }
  for (const request of [{ epoch: 3, operationId: generation.transition_id }, { epoch: 2, operationId: id(9) }, { epoch: 2 }]) {
    const candidate = structuredClone(envelope);
    assert.throws(() => validateBackgroundLaunch(candidate, { installationId: 'background-fixture', ownerBindingSha256: 'cd'.repeat(32),
      personaId: generation.policy.persona_id, backgroundProfile, request }), { code: 'HOSTED_BACKGROUND_MANAGER_REFUSED_OR_UNKNOWN' });
  }
});

/** A private background-manager staging fixture mirroring the operator's file layout. */
async function managerFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'hehe-background-manager-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const nativeHome = join(root, 'home'), sessionsDirectory = join(root, 'sessions');
  await mkdir(nativeHome, { mode: 0o700 }); await mkdir(sessionsDirectory, { mode: 0o700 });
  const template = { portalOrigin: 'https://control.example', installationId: 'background-fixture',
    hostedOwnerBindingSha256: 'cd'.repeat(32), nativeHome, stateDirectory: join(root, 'old-state'),
    runtimeTokenFile: join(root, 'old-token'), backgroundProfile: { ...backgroundProfile },
    personas: { [id(2)]: { model: 'fixture', allowedTools: [...readOnlyTools] } } };
  const templatePath = join(root, 'template.json'), bytes = JSON.stringify(template);
  await writeFile(templatePath, bytes, { mode: 0o600 });
  const config = { kind: 'owner-alpha-background-manager-v1', portalOrigin: template.portalOrigin,
    installationId: template.installationId, hostedOwnerBindingSha256: template.hostedOwnerBindingSha256,
    templatePath, templateSha256: sha(bytes), sessionsDirectory, managerTokenFile: join(root, 'manager-token') };
  const { envelope, generation } = launchFixture();
  envelope.generation.policy.persona_id = id(2);
  envelope.generation.policy.expires_at = new Date(Date.now() + 60000).toISOString();
  envelope.host_credential.grant.expires_at = envelope.generation.policy.expires_at;
  const calls = [], holds = [];
  const control = { request: async (type, body) => { calls.push({ type, body }); return type === 'generation' ? structuredClone(envelope) : null; } };
  const tasks = { hold: async value => { holds.push(value); } };
  return { root, config, envelope, generation, control, tasks, calls, holds, template,
    request: { epoch: generation.epoch, operationId: generation.transition_id } };
}

/** Stop journal proof for the background child, as the real service would leave it. */
async function stoppedBackground(path) {
  const { config } = await readOwnerAlphaConfig(path);
  const generation = config.ownerAlphaGeneration;
  await new FileJournal(join(config.stateDirectory, 'journal')).putIfAbsent('service', {
    nativeStopped: true, bootId: generation.boot_id, identity: { epoch: generation.epoch, boot_id: generation.boot_id },
    ownerAlpha: config.ownerAlpha, ownerAlphaGeneration: generation, ownerAlphaBackground: config.ownerAlphaBackground,
    hostedOwner: { bindingSha256: config.hostedOwnerBindingSha256, origin: new URL(config.portalOrigin).origin } });
}

test('background manager stages one exclusive session, holds once, and never widens legacy or warm kinds', async t => {
  const f = await managerFixture(t);
  // Short window: this launch stages no stop proof, so the single proof read
  // must fail at the boundary and never report retirement.
  f.envelope.generation.policy.expires_at = new Date(Date.now() + 900).toISOString();
  f.envelope.host_credential.grant.expires_at = f.envelope.generation.policy.expires_at;
  let launches = 0;
  const launch = async (path, options) => {
    launches++;
    const { config } = await readOwnerAlphaConfig(path, options.expectedSha256);
    assert.equal(config.nativeHome, f.template.nativeHome);
    assert.deepEqual(config.ownerAlpha, { session_id: f.generation.session_id, persona_id: f.generation.policy.persona_id,
      expires_at: f.generation.policy.expires_at, max_runs: 3, max_task_seconds: f.generation.policy.max_task_seconds,
      background_first_root: true });
    assert.ok(!Object.hasOwn(config.ownerAlpha, 'text_only'));
    assert.deepEqual(config.ownerAlphaGeneration, { epoch: f.generation.epoch, boot_id: f.generation.boot_id, transition_id: f.generation.transition_id });
    assert.deepEqual(config.ownerAlphaBackground, { generation_sha256: f.generation.generation_sha256,
      background_profile_sha256: backgroundProfileSha256(f.generation.policy.background) });
    assert.equal(await readFile(config.runtimeTokenFile, 'utf8'), 'opaque-host-credential');
    assert.equal((await stat(config.runtimeTokenFile)).mode & 0o777, 0o600);
    assert.ok(!JSON.stringify(config).includes(f.config.managerTokenFile));
    const intent = JSON.parse(await readFile(join(config.stateDirectory, 'hosted-owner-background-intent.json')));
    assert.deepEqual(intent, { phase: 'unknown',
      owner_alpha_generation: { epoch: f.generation.epoch, boot_id: f.generation.boot_id, transition_id: f.generation.transition_id },
      generation_sha256: f.generation.generation_sha256, session_id: f.generation.session_id,
      task_id: `hehe-background-${f.generation.transition_id}`, expires_at: f.generation.policy.expires_at });
    return { code: 0, signal: null };
  };
  await assert.rejects(runHostedOwnerBackgroundManager(f.config, f.request, { control: f.control, tasks: f.tasks, launch }));
  assert.equal(launches, 1);
  assert.deepEqual(f.holds.map(hold => hold.id), [`hehe-background-${f.generation.transition_id}`]);
  assert.deepEqual(f.calls.map(call => call.type), ['generation']);
  assert.deepEqual(f.calls.filter(call => call.type === 'retirement'), []);
  assert.deepEqual(await readdir(f.config.sessionsDirectory), [f.generation.transition_id]);
});

test('null generation, replay fence, and widened templates refuse before any hold', async t => {
  // Null assignment stages nothing.
  const empty = await managerFixture(t);
  assert.equal(await runHostedOwnerBackgroundManager(empty.config, empty.request,
    { control: { request: async () => null }, tasks: empty.tasks, launch: () => assert.fail('launched') }), 'NO_ASSIGNMENT');
  assert.deepEqual(await readdir(empty.config.sessionsDirectory), []);
  assert.deepEqual(empty.holds, []);
  // A partial session directory is a permanent replay fence.
  const fenced = await managerFixture(t);
  await mkdir(join(fenced.config.sessionsDirectory, fenced.request.operationId), { mode: 0o700 });
  await assert.rejects(runHostedOwnerBackgroundManager(fenced.config, fenced.request,
    { control: fenced.control, tasks: fenced.tasks, launch: () => assert.fail('launched') }));
  assert.deepEqual(fenced.holds, []);
  // A background template never carries a legacy ownerAlpha policy, a text-only
  // profile, disposable test admission, or unrestricted permissions.
  for (const mutate of [template => { template.ownerAlpha = { session_id: id(1), persona_id: id(2),
      expires_at: new Date(now + 60000).toISOString(), max_runs: 1, max_task_seconds: 30, background_first_root: true }; },
    template => { template.textOnlyProfile = { codexVersion: '0.154.0', model: 'fixture' }; },
    template => { template.disposableTest = true; },
    template => { template.restrictedPermissions = false; },
    template => { delete template.backgroundProfile; },
    template => { template.personas[id(2)].allowedTools = ['hehebot_list_routines', 'hehebot_read_skill', 'hehebot_save_routine']; },
    template => { template.personas[id(3)] = { model: 'fixture', allowedTools: [...readOnlyTools] }; },
    template => { template.personas[id(2)].allowedTools = ['hehebot_read_skill']; }]) {
    const widened = await managerFixture(t);
    mutate(widened.template);
    const widenedBytes = JSON.stringify(widened.template);
    await writeFile(widened.config.templatePath, widenedBytes, { mode: 0o600 });
    widened.config.templateSha256 = sha(widenedBytes);
    await assert.rejects(runHostedOwnerBackgroundManager(widened.config, widened.request,
      { control: widened.control, tasks: widened.tasks, launch: () => assert.fail('launched') }));
    assert.deepEqual(widened.holds, []);
  }
});

test('retirement waits for the exact millisecond expiry boundary after the auto-stop returns early', async t => {
  // Production shape: the control plane floors the native auth JWT expiry to
  // whole seconds, so the real auto-stop returns with the policy's exact
  // millisecond expiry still ahead. The proof read must hold the one-shot
  // continuation until that boundary; an immediate read is premature and
  // fails closed. No favorable fixture sleeps launch past the deadline.
  const f = await managerFixture(t);
  f.envelope.generation.policy.expires_at = new Date(Date.now() + 1200).toISOString();
  f.envelope.host_credential.grant.expires_at = f.envelope.generation.policy.expires_at;
  let returnedAt = 0;
  assert.equal(await runHostedOwnerBackgroundManager(f.config, f.request, { control: f.control, tasks: f.tasks,
    launch: async path => {
      await new Promise(resolve => setTimeout(resolve, 300));
      await stoppedBackground(path);
      returnedAt = Date.now();
      return { code: 0, signal: null };
    } }), 'RETIREMENT_REPORTED');
  const expiryAt = Date.parse(f.generation.policy.expires_at);
  assert.ok(returnedAt < expiryAt, 'the launch fixture must return before the boundary for the wait to discriminate');
  assert.deepEqual(f.calls.map(call => call.type), ['generation', 'retirement']);
  const report = f.calls[1].body;
  assert.deepEqual(report, { epoch: f.generation.epoch, boot_id: f.generation.boot_id, session_id: f.generation.session_id,
    transition_id: f.generation.transition_id, observed_at: report.observed_at, direct_child_stopped: true,
    execution_lock_free: true, session_lock_free: true,
    source: 'hosted-background-manager:file-journal-nativeStopped+dual-flock' });
  assert.ok(Date.parse(report.observed_at) >= expiryAt, 'retirement was observed before the exact expiry boundary');
  assert.ok(Date.parse(report.observed_at) < expiryAt + 2000, 'the boundary wait ran unbounded');
  // Launch returning only after the boundary needs no wait at all.
  const g = await managerFixture(t);
  g.envelope.generation.policy.expires_at = new Date(Date.now() + 400).toISOString();
  g.envelope.host_credential.grant.expires_at = g.envelope.generation.policy.expires_at;
  assert.equal(await runHostedOwnerBackgroundManager(g.config, g.request, { control: g.control, tasks: g.tasks,
    launch: async path => {
      await new Promise(resolve => setTimeout(resolve, 500));
      await stoppedBackground(path);
      return { code: 0, signal: null };
    } }), 'RETIREMENT_REPORTED');
  assert.deepEqual(g.calls.map(call => call.type), ['generation', 'retirement']);
});

test('--inspect-locked refuses before the exact expiry boundary and reports at or after it', async t => {
  // The strict pre-expiry refusal lives in the production CLI boundary itself.
  // One immutable staged session flips from refusal to report purely by the
  // wall clock crossing the exact millisecond expiry; nothing is rewritten.
  const f = await managerFixture(t);
  f.envelope.generation.policy.expires_at = new Date(Date.now() + 2000).toISOString();
  f.envelope.host_credential.grant.expires_at = f.envelope.generation.policy.expires_at;
  let staged = null;
  await assert.rejects(runHostedOwnerBackgroundManager(f.config, f.request, { control: f.control, tasks: f.tasks,
    launch: async (path, options) => {
      await stoppedBackground(path);
      staged = { path, sha256: options.expectedSha256 };
      throw new Error('staged session captured for direct CLI boundary reads');
    } }));
  const self = new URL('../runtime/hosted-owner-background-manager.mjs', import.meta.url).pathname;
  const read = () => promisify(execFile)(process.execPath, [self, '--inspect-locked', staged.path, staged.sha256],
    { timeout: 10000, maxBuffer: 16384 });
  await assert.rejects(read(), error => error.code === 1 && error.stderr.trim() === 'HOSTED_BACKGROUND_MANAGER_REFUSED_OR_UNKNOWN',
    'the CLI read proof before the exact expiry boundary');
  while (Date.now() < Date.parse(f.generation.policy.expires_at) + 50) await new Promise(ok => setTimeout(ok, 25));
  const after = await read();
  const report = JSON.parse(after.stdout);
  assert.deepEqual(report, { epoch: f.generation.epoch, boot_id: f.generation.boot_id, session_id: f.generation.session_id,
    transition_id: f.generation.transition_id, observed_at: report.observed_at, direct_child_stopped: true,
    execution_lock_free: true, session_lock_free: true,
    source: 'hosted-background-manager:file-journal-nativeStopped+dual-flock' });
  assert.ok(Date.parse(report.observed_at) >= Date.parse(f.generation.policy.expires_at));
});

test('wrong journal identity, false stop and proofless early exit never report retirement at the boundary', async t => {
  // Every case reads proof only at the exact expiry boundary: a mismatched or
  // missing stop record must fail closed there, never before the boundary.
  const mutations = [row => ({ ...row, nativeStopped: false }), row => ({ ...row, bootId: id(9) }),
    row => ({ ...row, identity: { epoch: 8, boot_id: row.identity.boot_id } }),
    row => ({ ...row, ownerAlphaGeneration: { ...row.ownerAlphaGeneration, transition_id: id(9) } }),
    row => ({ ...row, ownerAlphaBackground: { ...row.ownerAlphaBackground, generation_sha256: 'ff'.repeat(32) } }),
    row => ({ ...row, ownerAlphaBackground: { ...row.ownerAlphaBackground, background_profile_sha256: 'ff'.repeat(32) } }),
    row => ({ ...row, ownerAlpha: { ...row.ownerAlpha, session_id: id(9) } }),
    row => ({ ...row, hostedOwner: { ...row.hostedOwner, bindingSha256: 'ef'.repeat(32) } })];
  for (const mutate of [...mutations, null]) {
    const f = await managerFixture(t);
    f.envelope.generation.policy.expires_at = new Date(Date.now() + 700).toISOString();
    f.envelope.host_credential.grant.expires_at = f.envelope.generation.policy.expires_at;
    await assert.rejects(runHostedOwnerBackgroundManager(f.config, f.request, { control: f.control, tasks: f.tasks,
      launch: async path => {
        if (mutate) {
          await stoppedBackground(path);
          const { config } = await readOwnerAlphaConfig(path);
          const journal = new FileJournal(join(config.stateDirectory, 'journal'));
          const row = await journal.get('service');
          await journal.update('service', mutate({ ...row }));
        } // null: an early exit stages no stop proof at all
        return { code: 0, signal: null };
      } }));
    assert.deepEqual(f.calls.map(call => call.type), ['generation']);
  }
});

test('either held kernel lock prevents background retirement despite a matching journal at the boundary', async t => {
  for (const which of ['nativeHome', 'stateDirectory']) {
    const f = await managerFixture(t);
    f.envelope.generation.policy.expires_at = new Date(Date.now() + 900).toISOString();
    f.envelope.host_credential.grant.expires_at = f.envelope.generation.policy.expires_at;
    let holder;
    try {
      await assert.rejects(runHostedOwnerBackgroundManager(f.config, f.request, { control: f.control, tasks: f.tasks,
        launch: async path => {
          await stoppedBackground(path);
          const { config } = await readOwnerAlphaConfig(path);
          holder = spawn('bash', [join('scripts', 'with-executor-lock.sh'), config[which], process.execPath,
            '-e', 'console.log("locked"); process.stdin.resume();'], { stdio: ['pipe', 'pipe', 'pipe'] });
          await once(holder.stdout, 'data');
          return { code: 0, signal: null };
        } }));
      assert.deepEqual(f.calls.map(call => call.type), ['generation']);
    } finally { if (holder) { const exited = once(holder, 'exit'); holder.stdin.end(); await exited; } }
  }
});

test('wake listener routes the background kind to the background manager without a second boot', async t => {
  const f = await managerFixture(t);
  await writeFile(join(f.root, 'manager.json'), JSON.stringify(f.config), { mode: 0o600 });
  await writeFile(join(f.root, 'wake-token'), 'w'.repeat(48), { mode: 0o600 });
  const reports = [];
  const spriteRequest = (options, callback) => {
    const req = new EventEmitter(); req.destroy = () => {};
    req.end = () => { const res = new EventEmitter(); res.statusCode = 200; callback(res);
      res.emit('data', Buffer.from('{}')); res.emit('end'); };
    return req;
  };
  const listener = createHostedOwnerWakeService({ configPath: join(f.root, 'manager.json'),
    wakeTokenFile: join(f.root, 'wake-token'), port: 8080 },
    { spriteRequest, control: { request: async type => (type === 'generation' ? null : undefined) }, report: value => reports.push(value) });
  listener.listen(0, '127.0.0.1'); await once(listener, 'listening');
  t.after(() => listener.stop());
  const origin = `http://127.0.0.1:${listener.address().port}`;
  const refused = await fetch(`${origin}/wake`, { method: 'POST', headers: { 'content-type': 'application/json',
    'x-hehe-wake-token': 'w'.repeat(48) }, body: JSON.stringify(f.request) });
  assert.equal(refused.status, 503); // no BOOTING generation: never a second boot
  assert.deepEqual(reports.map(report => report.code), ['PREPARATION_REFUSED_OR_UNKNOWN']);
  assert.deepEqual(f.holds, []);
});

test('prepare continuation is single-shot, expiry-fenced and never waits an aborted window out', async t => {
  // Expired before the continuation starts: refused before any launch.
  const expired = await managerFixture(t);
  expired.envelope.generation.policy.expires_at = new Date(Date.now() + 400).toISOString();
  expired.envelope.host_credential.grant.expires_at = expired.envelope.generation.policy.expires_at;
  let launches = 0;
  const resumeExpired = await prepareHostedOwnerBackgroundManager(expired.config, expired.request,
    { control: expired.control, tasks: expired.tasks, launch: async () => { launches++; return { code: 0, signal: null }; } });
  await new Promise(ok => setTimeout(ok, 550));
  await assert.rejects(resumeExpired());
  assert.equal(launches, 0);
  assert.deepEqual(expired.calls.map(call => call.type), ['generation']);
  // Single-shot through the boundary wait: one read, one report, consumed once.
  const retire = await managerFixture(t);
  retire.envelope.generation.policy.expires_at = new Date(Date.now() + 700).toISOString();
  retire.envelope.host_credential.grant.expires_at = retire.envelope.generation.policy.expires_at;
  const resumeOnce = await prepareHostedOwnerBackgroundManager(retire.config, retire.request,
    { control: retire.control, tasks: retire.tasks,
      launch: async path => { await stoppedBackground(path); return { code: 0, signal: null }; } });
  assert.equal(await resumeOnce(), 'RETIREMENT_REPORTED');
  await assert.rejects(resumeOnce());
  assert.deepEqual(retire.calls.map(call => call.type), ['generation', 'retirement']);
  // Abort during the boundary wait retains UNKNOWN without waiting it out.
  const aborted = await managerFixture(t);
  aborted.envelope.generation.policy.expires_at = new Date(Date.now() + 2500).toISOString();
  aborted.envelope.host_credential.grant.expires_at = aborted.envelope.generation.policy.expires_at;
  const controller = new AbortController();
  const resumeAborted = await prepareHostedOwnerBackgroundManager(aborted.config, aborted.request,
    { control: aborted.control, tasks: aborted.tasks, signal: controller.signal,
      launch: async path => { await stoppedBackground(path); return { code: 0, signal: null }; } });
  const rejection = assert.rejects(resumeAborted());
  setTimeout(() => controller.abort(), 200);
  await rejection;
  assert.ok(Date.now() < Date.parse(aborted.generation.policy.expires_at) - 1000,
    'an aborted manager must retain UNKNOWN well before the boundary, never wait the window out');
  assert.deepEqual(aborted.calls.map(call => call.type), ['generation']);
  await assert.rejects(resumeAborted());
});

test('a successful timed wait leaves no abort listener behind', async t => {
  // Regression for the listener leak: the deadline-anchored wait must remove
  // its abort listener on every path, including normal timer completion and
  // repeated early timer firings. The tracked signal records each add and
  // remove; after a full successful retirement through a real timed wait no
  // listener may remain.
  const f = await managerFixture(t);
  f.envelope.generation.policy.expires_at = new Date(Date.now() + 400).toISOString();
  f.envelope.host_credential.grant.expires_at = f.envelope.generation.policy.expires_at;
  const listeners = [];
  let added = 0;
  const signal = {
    aborted: false,
    addEventListener: (type, listener) => { added++; listeners.push(listener); },
    removeEventListener: (type, listener) => { const at = listeners.indexOf(listener); if (at >= 0) listeners.splice(at, 1); }
  };
  assert.equal(await runHostedOwnerBackgroundManager(f.config, f.request, { control: f.control, tasks: f.tasks, signal,
    launch: async path => { await stoppedBackground(path); return { code: 0, signal: null }; } }), 'RETIREMENT_REPORTED');
  assert.ok(added >= 1, 'the timed wait must actually register an abort listener to be a discriminator');
  assert.equal(listeners.length, 0, 'every abort listener registered by the boundary wait must be removed by retirement time');
  assert.deepEqual(f.calls.map(call => call.type), ['generation', 'retirement']);
});

test('an abort observed at or after the exact boundary never reaches the proof read or retirement', async t => {
  // The launch fixture returns with the boundary already behind it and the
  // manager signal already aborted: an aborted manager must retain UNKNOWN
  // even though now() >= expires_at, never start the dual-lock proof read,
  // and never initiate a retirement request.
  const f = await managerFixture(t);
  f.envelope.generation.policy.expires_at = new Date(Date.now() + 300).toISOString();
  f.envelope.host_credential.grant.expires_at = f.envelope.generation.policy.expires_at;
  const controller = new AbortController();
  const rejection = assert.rejects(runHostedOwnerBackgroundManager(f.config, f.request,
    { control: f.control, tasks: f.tasks, signal: controller.signal,
      launch: async path => {
        await stoppedBackground(path);
        await new Promise(resolve => setTimeout(resolve, 420));
        controller.abort();
        return { code: 0, signal: null };
      } }), { message: 'HOSTED_BACKGROUND_MANAGER_REFUSED_OR_UNKNOWN' });
  await rejection;
  assert.ok(Date.now() >= Date.parse(f.generation.policy.expires_at), 'the launch fixture must return at or after the boundary for this discriminator');
  assert.deepEqual(f.calls.map(call => call.type), ['generation'],
    'an aborted manager never initiates a retirement request, at or after the boundary');
});

test('an abort observed while the proof read runs never initiates the retirement request', async t => {
  // The abort lands inside the dual-lock --inspect-locked read itself: the
  // boundary wait completed un-aborted and the proof read succeeded, but the
  // manager must still retain UNKNOWN and never dispatch the retirement
  // request. An already-dispatched write is out of scope here; this asserts
  // only that none is initiated after the observed abort.
  const f = await managerFixture(t);
  f.envelope.generation.policy.expires_at = new Date(Date.now() + 300).toISOString();
  f.envelope.host_credential.grant.expires_at = f.envelope.generation.policy.expires_at;
  const controller = new AbortController();
  await assert.rejects(runHostedOwnerBackgroundManager(f.config, f.request,
    { control: f.control, tasks: f.tasks, signal: controller.signal,
      launch: async path => {
        await stoppedBackground(path);
        setTimeout(() => controller.abort(), Date.parse(f.generation.policy.expires_at) + 10 - Date.now());
        return { code: 0, signal: null };
      } }), { message: 'HOSTED_BACKGROUND_MANAGER_REFUSED_OR_UNKNOWN' });
  assert.deepEqual(f.calls.map(call => call.type), ['generation'],
    'an abort observed during the proof read never initiates a retirement request');
});
