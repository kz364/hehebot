import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { once, EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { ControlClient } from '../runtime/control-client.mjs';
import { runHostedOwnerWarmManager, prepareHostedOwnerWarmManager } from '../runtime/hosted-owner-warm-manager.mjs';
import { createHostedOwnerWakeService } from '../runtime/hosted-owner-wake.mjs';
import { readOwnerAlphaConfig } from '../runtime/owner-alpha-entry.mjs';
import { createCodexTextOnlyProfile, codexTextOnlyProfileSha256 } from '../runtime/codex-text-only.mjs';
import { warmManifestSha256, stageWarmClaim, validateWarmClaim, validateWarmLaunch,
  warmGenerationBinding, WARM_MANIFEST_KEYS, WARM_TASK_GRANT_KEYS } from '../runtime/owner-alpha-warm-binding.mjs';
import { FileJournal } from '../runtime/file-journal.mjs';

// The real client is the existing first-party TS bundle, not a copied mock.
execFileSync('bash', [decodeURIComponent(new URL('../scripts/build-codex-service.sh', import.meta.url).pathname)], { stdio: 'pipe' });

const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const sha = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const token = kind => [Buffer.from(JSON.stringify({ typ: `${kind}+jwt`, alg: 'HS256' })).toString('base64url'), 'e30', 'c2ln'].join('.');
const text_only = { profile_version: 'codex-text-only-v1', profile_sha256: 'ab'.repeat(32) };
const now = Date.now();

/** One valid owner-alpha-warm-claim-v1 envelope against the given generation. */
function claimFixture({ admission = 1, runId = id(4) } = {}) {
  const manifest = { schema_version: 1, kind: 'owner-alpha-warm-manifest-v1', admission, installation_id: 'warm-fixture',
    owner_binding_sha256: 'cd'.repeat(32), run_id: runId, persona_id: id(2), command_id: id(7),
    command_sha256: 'ef'.repeat(32), event_sequence: 3, policy_revision: 'warm-unit-v1', epoch: 2, boot_id: id(5),
    transition_id: id(6), session_id: id(1), text_only: { ...text_only }, issued_at: new Date(now - 2000).toISOString(),
    expires_at: new Date(now + 60000).toISOString(), reservation_micro_usd: 2000, generation_sha256: 'ab'.repeat(32) };
  manifest.manifest_sha256 = warmManifestSha256(manifest);
  const { manifest_sha256, ...unsigned } = manifest;
  assert.equal(warmManifestSha256(unsigned), manifest.manifest_sha256);
  const grant = { installation_id: manifest.installation_id, owner_binding_sha256: manifest.owner_binding_sha256,
    run_id: manifest.run_id, attempt: 1, manifest_sha256, epoch: manifest.epoch, boot_id: manifest.boot_id,
    transition_id: manifest.transition_id, generation_sha256: manifest.generation_sha256,
    issued_at: manifest.issued_at, expires_at: manifest.expires_at };
  return { claim: { schema_version: 1, kind: 'owner-alpha-warm-claim-v1',
    run: { id: runId, current_attempt: 1, persona_id: id(2), role: 'coordinator', command_id: manifest.command_id,
      context_json: JSON.stringify({ room_id: null }) },
    submission_key: `${runId}:1`, deadline_at: manifest.expires_at, text_only: { ...text_only }, manifest,
    task_credential: { grant, token: token('hehebot-warm-task') } },
    manifest, grant };
}

function claimContext(overrides = {}) {
  return { installationId: 'warm-fixture', stateDirectory: 'unused', generationSha256: 'ab'.repeat(32),
    generation: { epoch: 2, boot_id: id(5), transition_id: id(6), session_id: id(1), persona_id: id(2) },
    textOnly: { ...text_only }, now: () => now, ...overrides };
}

test('warm principals have disjoint fixed route allowlists; legacy meaning unchanged', async () => {
  const calls = [];
  const manager = new ControlClient({ origin: 'https://portal.example', token: 'manager-secret', principal: 'warm-manager',
    fetchImpl: async (...args) => { calls.push(args); return new Response('null', { headers: { 'Content-Type': 'application/json' } }); } });
  assert.equal(await manager.request('generation', {}), null);
  assert.equal(calls[0][0], 'https://portal.example/internal/warm/manager/generation');
  const host = new ControlClient({ origin: 'https://portal.example', token: 'host-secret', principal: 'warm-host',
    fetchImpl: async (...args) => { calls.push(args); return new Response('null', { headers: { 'Content-Type': 'application/json' } }); } });
  assert.equal(await host.request('claim', { identity: {} }), null);
  assert.equal(calls[1][0], 'https://portal.example/internal/warm/host/claim');
  const task = new ControlClient({ origin: 'https://portal.example', token: 'task-secret', principal: 'warm-task',
    fetchImpl: async (...args) => { calls.push(args); return new Response('{}', { headers: { 'Content-Type': 'application/json' } }); } });
  assert.deepEqual(await task.request('agent-routines', {}), {});
  assert.equal(calls[2][0], 'https://portal.example/internal/warm/task/agent-routines');
  for (const [client, type] of [[manager, 'manifest'], [manager, 'boot'], [host, 'agent-routines'], [host, 'effect-intent'],
    [task, 'claim'], [task, 'boot'], [task, 'agent-command'], [task, '../claim']]) {
    await assert.rejects(client.request(type, {}), { code: 'UNSUPPORTED_RUNTIME_ENDPOINT' });
  }
  // Legacy principals never gain warm routes and vice versa.
  const runtime = new ControlClient({ origin: 'https://portal.example', token: 'runtime-secret',
    fetchImpl: async () => assert.fail('must reject before dispatch') });
  for (const type of ['generation', 'retirement']) await assert.rejects(runtime.request(type, {}), { code: 'UNSUPPORTED_RUNTIME_ENDPOINT' });
  for (const principal of ['warm', 'warm-host ', 'WARM-MANAGER', 'manager-v2']) {
    assert.throws(() => new ControlClient({ origin: 'https://portal.example', token: 'x'.repeat(32), principal }), { code: 'INVALID_CONFIGURATION' });
  }
});

test('warm manifest digest is the frozen versioned canonical digest, never the legacy one', () => {
  const unsigned = { schema_version: 1, kind: 'owner-alpha-warm-manifest-v1', admission: 1, installation_id: 'warm-fixture',
    owner_binding_sha256: 'cd'.repeat(32), run_id: id(4), persona_id: id(2), command_id: id(7), command_sha256: 'ef'.repeat(32),
    event_sequence: 3, policy_revision: 'warm-unit-v1', epoch: 2, boot_id: id(5), transition_id: id(6), session_id: id(1),
    text_only: { ...text_only }, issued_at: new Date(now - 2000).toISOString(), expires_at: new Date(now + 60000).toISOString(),
    reservation_micro_usd: 2000, generation_sha256: 'ab'.repeat(32) };
  const independent = createHash('sha256').update(JSON.stringify([unsigned.schema_version, unsigned.kind, unsigned.admission,
    unsigned.installation_id, unsigned.owner_binding_sha256, unsigned.run_id, unsigned.persona_id, unsigned.command_id, unsigned.command_sha256,
    unsigned.event_sequence, unsigned.policy_revision, unsigned.epoch, unsigned.boot_id, unsigned.transition_id, unsigned.session_id,
    unsigned.text_only.profile_version, unsigned.text_only.profile_sha256, unsigned.issued_at, unsigned.expires_at,
    unsigned.reservation_micro_usd, unsigned.generation_sha256])).digest('hex');
  assert.equal(warmManifestSha256(unsigned), independent);
  assert.equal(WARM_MANIFEST_KEYS.length, 21);
  assert.equal(WARM_TASK_GRANT_KEYS.length, 11);
  // The digest covers the frozen deadline: rewriting expiry changes the digest.
  assert.notEqual(warmManifestSha256({ ...unsigned, expires_at: new Date(now + 61000).toISOString() }), independent);
});

test('validateWarmClaim accepts the exact frozen envelope and passes the durable run row through', () => {
  const { claim } = claimFixture();
  claim.run = { ...claim.run, context_json: JSON.stringify({ room_id: null, history: ['prior owner text', 'prior reply'] }),
    parent_run_id: null, routine_id: null, occurrence_id: null };
  const staged = validateWarmClaim(structuredClone(claim), claimContext());
  assert.equal(staged.run.id, claim.run.id);
  assert.equal(staged.deadline_at, claim.manifest.expires_at);
  assert.deepEqual(staged.text_only, text_only);
  assert.equal(staged.manifest.manifest_sha256, claim.manifest.manifest_sha256);
});

test('validateWarmClaim refuses tampered or mismatched envelopes without staging', async () => {
  const base = claimFixture();
  const attempts = [
    claim => { claim.deadline_at = new Date(Date.parse(claim.manifest.expires_at) + 1000).toISOString(); }, // not the frozen deadline
    claim => { claim.manifest.manifest_sha256 = 'ff'.repeat(32); }, // tampered digest
    claim => { delete claim.manifest.manifest_sha256; claim.manifest.manifest_sha256 = warmManifestSha256({ ...claim.manifest, reservation_micro_usd: 9999 }); }, // rewritten body
    claim => { claim.task_credential.token = token('hehebot-runtime-generation'); }, // host-typed token
    claim => { claim.task_credential.grant.run_id = id(8); }, // cross-run grant
    claim => { claim.task_credential.grant.expires_at = new Date(Date.parse(claim.manifest.expires_at) + 1000).toISOString(); }, // grant outlives manifest
    claim => { claim.manifest.generation_sha256 = 'cd'.repeat(32); }, // foreign generation digest
    claim => { claim.manifest.epoch = 3; }, // foreign epoch
    claim => { claim.manifest.session_id = id(9); }, // foreign session
    claim => { claim.run.persona_id = id(9); }, // run persona mismatch
    claim => { claim.run.current_attempt = 2; }, // non-first attempt
    claim => { claim.run.role = 'child'; },
    claim => { claim.text_only.profile_sha256 = 'cd'.repeat(32); }, // text-only profile mismatch
    claim => { claim.manifest.text_only.profile_version = 'codex-text-only-v2'; },
    claim => { claim.manifest.admission = 3; },
    claim => { claim.submission_key = `${claim.run.id}:2`; },
    claim => { claim.manifest.expires_at = claim.manifest.issued_at; }, // non-positive lifetime
    claim => { delete claim.manifest.policy_revision; },
    claim => { claim.extra = true; }, // unknown envelope key
    claim => { claim.manifest.extra = true; }, // unknown manifest key
    claim => { claim.task_credential.grant.extra = true; }, // unknown grant key
    claim => { claim.manifest.event_sequence = 0; },
    claim => { claim.manifest.reservation_micro_usd = 0; },
    claim => { claim.task_credential.token = 'not-a-jwt'; },
    claim => { claim.run = null; },
  ];
  for (const mutate of attempts) {
    const claim = structuredClone(base.claim); mutate(claim);
    await assert.rejects(() => new Promise((resolve, reject) => {
      try { resolve(validateWarmClaim(claim, claimContext())); } catch (error) { reject(error); }
    }), /INVALID_WARM_CLAIM|WARM_TASK_DEADLINE_EXPIRED/);
  }
  // A claim inside its final partial second is expired before any staging.
  const expiring = structuredClone(base.claim);
  expiring.manifest.issued_at = new Date(now - 60000).toISOString();
  expiring.manifest.expires_at = new Date(now + 500).toISOString();
  delete expiring.manifest.manifest_sha256;
  expiring.manifest.manifest_sha256 = warmManifestSha256(expiring.manifest);
  expiring.deadline_at = expiring.manifest.expires_at;
  expiring.task_credential.grant.issued_at = expiring.manifest.issued_at;
  expiring.task_credential.grant.expires_at = expiring.manifest.expires_at;
  expiring.task_credential.grant.manifest_sha256 = expiring.manifest.manifest_sha256;
  assert.throws(() => validateWarmClaim(expiring, claimContext()), { code: 'WARM_TASK_DEADLINE_EXPIRED' });
  // One full second remaining is the accepted boundary.
  const boundary = structuredClone(expiring);
  boundary.manifest.expires_at = new Date(now + 1000).toISOString();
  delete boundary.manifest.manifest_sha256;
  boundary.manifest.manifest_sha256 = warmManifestSha256(boundary.manifest);
  boundary.deadline_at = boundary.manifest.expires_at;
  boundary.task_credential.grant.expires_at = boundary.manifest.expires_at;
  boundary.task_credential.grant.manifest_sha256 = boundary.manifest.manifest_sha256;
  assert.equal(validateWarmClaim(boundary, claimContext()).deadline_at, boundary.manifest.expires_at);
});

test('stageWarmClaim writes the unique task token once, 0600, without journaling the raw token', async t => {
  const root = await mkdtemp(join(tmpdir(), 'hehe-warm-stage-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stateDirectory = join(root, 'session');
  await mkdir(stateDirectory, { mode: 0o700 });
  const { claim } = claimFixture();
  const first = await stageWarmClaim(structuredClone(claim), claimContext({ stateDirectory }));
  assert.equal(first.task_credential.token_file, join(stateDirectory, 'task-tokens', claim.run.id));
  assert.equal((await stat(first.task_credential.token_file)).mode & 0o777, 0o600);
  assert.equal((await stat(join(stateDirectory, 'task-tokens'))).mode & 0o777, 0o700);
  assert.ok(!('token' in first.task_credential));
  assert.ok(!JSON.stringify(first).includes(claim.task_credential.token));
  // Replaying the identical claim reproduces the identical staged bytes.
  const replay = await stageWarmClaim(structuredClone(claim), claimContext({ stateDirectory }));
  assert.deepEqual(replay, first);
  // Divergent bytes for the same run are a permanent conflict, never a rewrite.
  const conflicting = structuredClone(claim);
  conflicting.task_credential.token = token('hehebot-warm-task') + 'x';
  await assert.rejects(stageWarmClaim(conflicting, claimContext({ stateDirectory })), { code: 'WARM_TASK_TOKEN_CONFLICT' });
  assert.equal(await readFile(first.task_credential.token_file, 'utf8'), claim.task_credential.token);
  assert.deepEqual(await readdir(join(stateDirectory, 'task-tokens')), [claim.run.id]);
  // A second admission stages its own distinct write-once token.
  const second = claimFixture({ admission: 2, runId: id(9) });
  const stagedSecond = await stageWarmClaim(second.claim, claimContext({ stateDirectory }));
  assert.notEqual(stagedSecond.task_credential.token_file, first.task_credential.token_file);
  assert.deepEqual((await readdir(join(stateDirectory, 'task-tokens'))).sort(), [claim.run.id, second.claim.run.id].sort());
  // Relative state directories never stage.
  await assert.rejects(stageWarmClaim(structuredClone(claim), claimContext({ stateDirectory: 'relative' })), { code: 'INVALID_WARM_CLAIM_STAGE' });
});

test('warmGenerationBinding binds only the immutable generation digest', () => {
  assert.deepEqual(warmGenerationBinding({ generation_sha256: 'ab'.repeat(32) }), { generation_sha256: 'ab'.repeat(32) });
  for (const value of [{}, { generation_sha256: 'zz' }, { generation_sha256: 'ab'.repeat(32), extra: 1 }, null]) {
    assert.throws(() => warmGenerationBinding(value), { code: 'INVALID_SERVICE_CONFIGURATION' });
  }
});

function launchFixture() {
  const generation = { epoch: 2, boot_id: id(5), transition_id: id(6), session_id: id(1), generation_sha256: 'ab'.repeat(32),
    policy: { persona_id: id(2), expires_at: new Date(now + 60000).toISOString(), max_runs: 2, max_task_seconds: 30,
      text_only: { ...text_only } },
    predecessor: { epoch: 1, boot_id: id(3), session_id: id(1) } };
  const envelope = { schema_version: 1, kind: 'owner-alpha-warm-launch-v1', generation,
    host_credential: { grant: { installation_id: 'warm-fixture', epoch: generation.epoch, boot_id: generation.boot_id,
      transition_id: generation.transition_id, generation_sha256: generation.generation_sha256,
      issued_at: new Date(now - 1000).toISOString(), expires_at: generation.policy.expires_at },
      token: 'opaque-host-credential' } };
  return { envelope, generation };
}

test('validateWarmLaunch accepts only the operator-bound envelope', () => {
  const { envelope, generation } = launchFixture();
  const accepted = validateWarmLaunch(structuredClone(envelope), { installationId: 'warm-fixture', ownerBindingSha256: 'cd'.repeat(32),
    personaId: generation.policy.persona_id, profileSha256: text_only.profile_sha256, request: { epoch: 2, operationId: generation.transition_id } });
  assert.equal(accepted.token, 'opaque-host-credential');
  assert.equal(accepted.generation.generation_sha256, generation.generation_sha256);
  const attempts = [
    e => { e.generation.policy.max_runs = 3; },
    e => { e.generation.policy.max_runs = 1; },
    e => { e.generation.policy.persona_id = id(9); },
    e => { e.generation.policy.text_only.profile_sha256 = 'cd'.repeat(32); },
    e => { e.generation.policy.expires_at = new Date(now + 301000).toISOString(); },
    e => { e.generation.epoch = 1; },
    e => { e.generation.predecessor.epoch = 3; },
    e => { e.host_credential.grant.installation_id = 'other-installation'; },
    e => { e.host_credential.grant.expires_at = new Date(Date.parse(e.generation.policy.expires_at) + 1000).toISOString(); },
    e => { e.host_credential.grant.issued_at = new Date(now + 30000).toISOString(); },
    e => { e.host_credential.grant.generation_sha256 = 'cd'.repeat(32); },
    e => { e.host_credential.grant.issued_at = new Date(Date.parse(e.generation.policy.expires_at) - 400000).toISOString(); }, // window longer than 300s
    e => { e.host_credential.token = ''; },
    e => { e.extra = true; },
  ];
  for (const mutate of attempts) {
    const candidate = structuredClone(envelope); mutate(candidate);
    assert.throws(() => validateWarmLaunch(candidate, { installationId: 'warm-fixture', ownerBindingSha256: 'cd'.repeat(32),
      personaId: generation.policy.persona_id, profileSha256: text_only.profile_sha256,
      request: { epoch: 2, operationId: generation.transition_id } }), { code: 'HOSTED_WARM_MANAGER_REFUSED_OR_UNKNOWN' });
  }
  // The request must identify the exact generation.
  for (const request of [{ epoch: 3, operationId: generation.transition_id }, { epoch: 2, operationId: id(9) }, { epoch: 2 }]) {
    const candidate = structuredClone(envelope);
    assert.throws(() => validateWarmLaunch(candidate, { installationId: 'warm-fixture', ownerBindingSha256: 'cd'.repeat(32),
      personaId: generation.policy.persona_id, profileSha256: text_only.profile_sha256, request }), { code: 'HOSTED_WARM_MANAGER_REFUSED_OR_UNKNOWN' });
  }
});

/** A private warm-manager staging fixture mirroring the operator's file layout. */
async function managerFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'hehe-warm-manager-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const nativeHome = join(root, 'home'), sessionsDirectory = join(root, 'sessions');
  await mkdir(nativeHome, { mode: 0o700 }); await mkdir(sessionsDirectory, { mode: 0o700 });
  const textOnlyProfile = { codexVersion: '0.154.0', model: 'fixture', modelCatalog: { models: [
    { slug: 'fixture', tool_mode: 'direct', experimental_supported_tools: [] }] },
  catalogPath: join(root, 'catalog.json'), catalogValidation: 'synthetic-fixture', syntheticFixture: true };
  const profile = createCodexTextOnlyProfile(textOnlyProfile);
  const template = { portalOrigin: 'https://control.example', installationId: 'warm-fixture',
    hostedOwnerBindingSha256: 'cd'.repeat(32), nativeHome, stateDirectory: join(root, 'old-state'),
    runtimeTokenFile: join(root, 'old-token'), textOnlyProfile,
    personas: { [id(2)]: { model: 'fixture', allowedTools: [] } } };
  const templatePath = join(root, 'template.json'), bytes = JSON.stringify(template);
  await writeFile(templatePath, bytes, { mode: 0o600 });
  const config = { kind: 'owner-alpha-warm-manager-v1', portalOrigin: template.portalOrigin,
    installationId: template.installationId, hostedOwnerBindingSha256: template.hostedOwnerBindingSha256,
    templatePath, templateSha256: sha(bytes), sessionsDirectory, managerTokenFile: join(root, 'manager-token') };
  const { envelope, generation } = launchFixture();
  envelope.generation.policy.persona_id = id(2);
  envelope.generation.policy.text_only = { profile_version: profile.version, profile_sha256: codexTextOnlyProfileSha256(profile) };
  envelope.host_credential.grant.expires_at = envelope.generation.policy.expires_at = new Date(now + 60000).toISOString();
  const calls = [], holds = [];
  const control = { request: async (type, body) => { calls.push({ type, body }); return type === 'generation' ? structuredClone(envelope) : null; } };
  const tasks = { hold: async value => { holds.push(value); } };
  return { root, config, envelope, generation, control, tasks, calls, holds, template, profile,
    request: { epoch: generation.epoch, operationId: generation.transition_id } };
}

/** Stop journal proof for the warm child, as the real service would leave it. */
async function stoppedWarm(path) {
  const { config } = await readOwnerAlphaConfig(path);
  const generation = config.ownerAlphaGeneration;
  await new FileJournal(join(config.stateDirectory, 'journal')).putIfAbsent('service', {
    nativeStopped: true, bootId: generation.boot_id, identity: { epoch: generation.epoch, boot_id: generation.boot_id },
    ownerAlpha: config.ownerAlpha, ownerAlphaGeneration: generation, ownerAlphaWarm: config.ownerAlphaWarm,
    hostedOwner: { bindingSha256: config.hostedOwnerBindingSha256, origin: new URL(config.portalOrigin).origin } });
}

test('warm manager stages one exclusive session, holds once, and never widens the legacy kind', async t => {
  const f = await managerFixture(t);
  let launches = 0;
  const launch = async (path, options) => {
    launches++;
    const { config, sha256 } = await readOwnerAlphaConfig(path, options.expectedSha256);
    assert.equal(config.nativeHome, f.template.nativeHome);
    assert.deepEqual(config.ownerAlpha, { session_id: f.generation.session_id, persona_id: f.generation.policy.persona_id,
      expires_at: f.generation.policy.expires_at, max_runs: 2, max_task_seconds: f.generation.policy.max_task_seconds,
      text_only: f.generation.policy.text_only });
    assert.deepEqual(config.ownerAlphaGeneration, { epoch: f.generation.epoch, boot_id: f.generation.boot_id, transition_id: f.generation.transition_id });
    assert.deepEqual(config.ownerAlphaWarm, { generation_sha256: f.generation.generation_sha256 });
    assert.equal(await readFile(config.runtimeTokenFile, 'utf8'), 'opaque-host-credential');
    assert.equal((await stat(config.runtimeTokenFile)).mode & 0o777, 0o600);
    assert.ok(!JSON.stringify(config).includes(f.config.managerTokenFile));
    const intent = JSON.parse(await readFile(join(config.stateDirectory, 'hosted-owner-warm-intent.json')));
    assert.deepEqual(intent, { phase: 'unknown',
      owner_alpha_generation: { epoch: f.generation.epoch, boot_id: f.generation.boot_id, transition_id: f.generation.transition_id },
      generation_sha256: f.generation.generation_sha256, session_id: f.generation.session_id,
      task_id: `hehe-warm-${f.generation.transition_id}`, expires_at: f.generation.policy.expires_at });
    return { code: 0, signal: null };
  };
  await assert.rejects(runHostedOwnerWarmManager(f.config, f.request, { control: f.control, tasks: f.tasks, launch }));
  assert.equal(launches, 1);
  assert.deepEqual(f.holds.map(hold => hold.id), [`hehe-warm-${f.generation.transition_id}`]);
  assert.deepEqual(f.calls.map(call => call.type), ['generation']);
  assert.deepEqual(f.calls.filter(call => call.type === 'retirement'), []);
  assert.deepEqual(await readdir(f.config.sessionsDirectory), [f.generation.transition_id]);
});

test('null generation, replay fence, and legacy template policies refuse before any hold', async t => {
  // Null assignment stages nothing.
  const empty = await managerFixture(t);
  assert.equal(await runHostedOwnerWarmManager(empty.config, empty.request,
    { control: { request: async () => null }, tasks: empty.tasks, launch: () => assert.fail('launched') }), 'NO_ASSIGNMENT');
  assert.deepEqual(await readdir(empty.config.sessionsDirectory), []);
  assert.deepEqual(empty.holds, []);
  // A partial session directory is a permanent replay fence.
  const fenced = await managerFixture(t);
  await mkdir(join(fenced.config.sessionsDirectory, fenced.request.operationId), { mode: 0o700 });
  await assert.rejects(runHostedOwnerWarmManager(fenced.config, fenced.request,
    { control: fenced.control, tasks: fenced.tasks, launch: () => assert.fail('launched') }));
  assert.deepEqual(fenced.holds, []);
  // A warm template never carries a legacy ownerAlpha policy.
  const legacy = await managerFixture(t);
  legacy.template.ownerAlpha = { session_id: id(1), persona_id: id(2), expires_at: new Date(now + 60000).toISOString(),
    max_runs: 1, max_task_seconds: 30, text_only: { ...text_only } };
  const legacyBytes = JSON.stringify(legacy.template);
  await writeFile(legacy.config.templatePath, legacyBytes, { mode: 0o600 });
  legacy.config.templateSha256 = sha(legacyBytes);
  await assert.rejects(runHostedOwnerWarmManager(legacy.config, legacy.request,
    { control: legacy.control, tasks: legacy.tasks, launch: () => assert.fail('launched') }));
  assert.deepEqual(legacy.holds, []);
  assert.deepEqual(await readdir(legacy.config.sessionsDirectory), []);
});

test('retirement requires matching warm journal identity and both locks, only after expiry', async t => {
  const f = await managerFixture(t);
  // Expiry must elapse in real time: inspectLocked uses the wall clock.
  f.envelope.generation.policy.expires_at = new Date(Date.now() + 1500).toISOString();
  f.envelope.host_credential.grant.expires_at = f.envelope.generation.policy.expires_at;
  assert.equal(await runHostedOwnerWarmManager(f.config, f.request, { control: f.control, tasks: f.tasks,
    launch: async (path, options) => {
      await new Promise(resolve => setTimeout(resolve, 1600));
      await stoppedWarm(path);
      return { code: 0, signal: null };
    } }), 'RETIREMENT_REPORTED');
  assert.deepEqual(f.calls.map(call => call.type), ['generation', 'retirement']);
  const report = f.calls[1].body;
  assert.deepEqual(report, { epoch: f.generation.epoch, boot_id: f.generation.boot_id, session_id: f.generation.session_id,
    transition_id: f.generation.transition_id, observed_at: report.observed_at, direct_child_stopped: true,
    execution_lock_free: true, session_lock_free: true,
    source: 'hosted-warm-manager:file-journal-nativeStopped+dual-flock' });
  assert.ok(Date.parse(report.observed_at) >= Date.parse(f.generation.policy.expires_at));
});

test('wrong journal identity, false stop, and premature stop never report retirement', async t => {
  for (const mutate of [row => ({ ...row, nativeStopped: false }), row => ({ ...row, bootId: id(9) }),
    row => ({ ...row, identity: { epoch: 8, boot_id: row.identity.boot_id } }),
    row => ({ ...row, ownerAlphaGeneration: { ...row.ownerAlphaGeneration, transition_id: id(9) } }),
    row => ({ ...row, ownerAlphaWarm: { generation_sha256: 'ff'.repeat(32) } }),
    row => ({ ...row, ownerAlpha: { ...row.ownerAlpha, session_id: id(9) } }),
    row => ({ ...row, hostedOwner: { ...row.hostedOwner, bindingSha256: 'ef'.repeat(32) } }), null]) {
    const f = await managerFixture(t);
    await assert.rejects(runHostedOwnerWarmManager(f.config, f.request, { control: f.control, tasks: f.tasks,
      launch: async path => {
        await stoppedWarm(path);
        if (mutate) {
          const { config } = await readOwnerAlphaConfig(path);
          const journal = new FileJournal(join(config.stateDirectory, 'journal'));
          const row = await journal.get('service');
          await journal.update('service', mutate({ ...row }));
        }
        return { code: 0, signal: null };
      } }));
    assert.deepEqual(f.calls.map(call => call.type), ['generation']);
  }
});

// G3 (GROK_ALIGNMENT A2): CHANGED from the pre-G3 "a held lock refuses
// retirement" expectation. A contended native-home or session lock is no
// longer refused: the retirement inspection kills the live holder's process
// group and takes over, so a foreign/stale holder no longer prevents a
// truthful journal from being reported as retired.
test('a held kernel lock is reclaimed by warm retirement inspection rather than blocking it', async t => {
  for (const which of ['nativeHome', 'stateDirectory']) {
    const f = await managerFixture(t);
    f.envelope.generation.policy.expires_at = new Date(Date.now() + 1500).toISOString();
    f.envelope.host_credential.grant.expires_at = f.envelope.generation.policy.expires_at;
    let holder, holderExited;
    assert.equal(await runHostedOwnerWarmManager(f.config, f.request, { control: f.control, tasks: f.tasks,
      launch: async path => {
        await new Promise(resolve => setTimeout(resolve, 1600));
        await stoppedWarm(path);
        const { config } = await readOwnerAlphaConfig(path);
        holder = spawn('bash', [join('scripts', 'with-executor-lock.sh'), config[which], process.execPath,
          '-e', 'console.log("locked"); process.stdin.resume();'], { stdio: ['pipe', 'pipe', 'pipe'] });
        await once(holder.stdout, 'data');
        // Registered before any lock contention: a contended lock now (G3)
        // kills a live holder as part of takeover, so the 'exit' listener
        // must be armed before that can happen or the event is missed and
        // this hangs forever.
        holderExited = once(holder, 'exit');
        return { code: 0, signal: null };
      } }), 'RETIREMENT_REPORTED');
    assert.deepEqual(f.calls.map(call => call.type), ['generation', 'retirement']);
    const [, signal] = await holderExited;
    assert.ok(typeof signal === 'string' && signal.startsWith('SIG'),
      'the live holder must be genuinely killed by takeover, not merely outlast a refusal');
  }
});

test('wake listener routes the warm kind to the warm manager without a second boot', async t => {
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

test('prepare continuation is single-shot and expiry-fenced', async t => {
  const f = await managerFixture(t);
  const resume = await prepareHostedOwnerWarmManager(f.config, f.request, { control: f.control, tasks: f.tasks,
    launch: async path => { await stoppedWarm(path); return { code: 0, signal: null }; } });
  await assert.rejects(resume()); // pre-expiry inspect fails closed
  await assert.rejects(resume()); // the continuation is consumed exactly once
  assert.deepEqual(f.calls.map(call => call.type), ['generation']);
});
