import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, stat, symlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { produceUnusedEvidence } from '../runtime/hosted-owner-unused.mjs';
import { prepareHostedOwnerManager } from '../runtime/hosted-owner-manager.mjs';
import { createCodexTextOnlyProfile, codexTextOnlyProfileSha256 } from '../runtime/codex-text-only.mjs';

const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const hash = value => createHash('sha256').update(value).digest('hex');
const lockScript = resolve('scripts/with-executor-lock.sh'), producer = resolve('runtime/hosted-owner-unused.mjs');
const run = promisify(execFile);
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'hehe-unused-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const nativeHome = join(root, 'home'), sessionsDirectory = join(root, 'sessions');
  await mkdir(nativeHome, { mode: 0o700 }); await mkdir(sessionsDirectory, { mode: 0o700 });
  const textOnlyProfile = { codexVersion: '0.154.0', model: 'fixture', modelCatalog: { models: [
    { slug: 'fixture', tool_mode: 'direct', experimental_supported_tools: [] }] },
  catalogPath: join(root, 'catalog.json'), catalogValidation: 'synthetic-fixture', syntheticFixture: true };
  const text_only = { profile_version: 'codex-text-only-v1', profile_sha256: codexTextOnlyProfileSha256(createCodexTextOnlyProfile(textOnlyProfile)) };
  const expires = Date.now() - 10000;
  const policy = { session_id: id(1), persona_id: id(2), expires_at: new Date(expires).toISOString(),
    max_runs: 1, max_task_seconds: 30, text_only };
  const template = { portalOrigin: 'https://control.example', installationId: 'unused-fixture',
    hostedOwnerBindingSha256: 'ab'.repeat(32), nativeHome, stateDirectory: join(root, 'unused-state'),
    runtimeTokenFile: join(root, 'missing-task-token'), ownerAlpha: policy, textOnlyProfile,
    personas: { [id(2)]: { model: 'fixture', allowedTools: [] } } };
  const templatePath = join(root, 'template.json'), templateBytes = JSON.stringify(template);
  await writeFile(templatePath, templateBytes, { mode: 0o600 });
  const config = { kind: 'owner-alpha-manager-v1', portalOrigin: template.portalOrigin,
    installationId: template.installationId, hostedOwnerBindingSha256: template.hostedOwnerBindingSha256,
    templatePath, templateSha256: hash(templateBytes), sessionsDirectory, managerTokenFile: join(root, 'missing-manager-token') };
  const configPath = join(root, 'manager.json'), configBytes = JSON.stringify(config);
  await writeFile(configPath, configBytes, { mode: 0o600 });
  const grant = { installation_id: config.installationId, owner_binding_sha256: config.hostedOwnerBindingSha256,
    run_id: id(4), epoch: 8, boot_id: id(5), transition_id: id(6), manifest_sha256: 'cd'.repeat(32),
    issued_at: new Date(expires - 60000).toISOString(), expires_at: policy.expires_at };
  const rootPin = async path => { const s = await stat(path); return { path, dev: s.dev, ino: s.ino }; };
  const request = { kind: 'owner-alpha-unused-request-v1', installation_id: config.installationId,
    owner_binding_sha256: config.hostedOwnerBindingSha256,
    predecessor: { manifest_sha256: grant.manifest_sha256, epoch: grant.epoch, boot_id: grant.boot_id,
      transition_id: grant.transition_id, session_id: policy.session_id, run_id: grant.run_id },
    policy_expires_at: policy.expires_at, assignment: { grant, policy },
    manager_config: { path: configPath, sha256: hash(configBytes) }, review: {
      source: 'synthetic-reviewed-unused-root-custody', reviewed_at: new Date().toISOString(), persistent_root_custody_reviewed: true,
      sources: { manager: hash(await readFile(resolve('runtime/hosted-owner-manager.mjs'))),
        launcher: hash(await readFile(resolve('runtime/hosted-owner-launcher.mjs'))), lock_script: hash(await readFile(lockScript)) },
      sessions_root: await rootPin(sessionsDirectory), native_home: await rootPin(nativeHome) } };
  const requestPath = join(root, 'request.json');
  const save = async () => { const bytes = JSON.stringify(request); await writeFile(requestPath, bytes, { mode: 0o600 }); return hash(bytes); };
  return { root, config, request, requestPath, save, sha256: await save(), directory: join(sessionsDirectory, grant.transition_id) };
}

test('operator-only producer persists digest-bound evidence under actual dual locks, without credentials or retirement claims', async t => {
  const f = await fixture(t);
  const { stdout } = await run(process.execPath, [producer, '--produce', f.requestPath, f.sha256]);
  const report = JSON.parse(stdout), persisted = await readFile(join(f.directory, 'unused-before-staging.json'));
  assert.deepEqual(Object.keys(report).sort(), ['evidence', 'installation_id', 'kind', 'owner_binding_sha256', 'predecessor']);
  assert.deepEqual(report.predecessor, f.request.predecessor);
  assert.equal(report.installation_id, f.config.installationId); assert.equal(report.owner_binding_sha256, f.config.hostedOwnerBindingSha256);
  assert.equal(report.kind, 'unused-before-staging-v1'); assert.equal(report.evidence.sha256, hash(persisted));
  assert.equal(report.evidence.source, f.request.review.source);
  assert.ok(report.evidence.observed_at >= f.request.policy_expires_at);
  const row = JSON.parse(persisted);
  assert.equal(row.request_sha256, f.sha256); assert.deepEqual(row.review, f.request.review);
  assert.deepEqual(row.manager_config, f.request.manager_config); assert.equal(row.policy_expires_at, f.request.policy_expires_at);
  assert.ok(!/nativeStopped|retirement|successor_policy_revision/.test(persisted.toString()));
  assert.equal((await stat(join(f.directory, 'unused-before-staging.json'))).mode & 0o777, 0o400);
  assert.deepEqual(await readdir(f.config.nativeHome ?? f.request.review.native_home.path), []);
  await assert.rejects(produceUnusedEvidence(f.requestPath, f.sha256));
  assert.deepEqual(await readFile(join(f.directory, 'unused-before-staging.json')), persisted);
});

test('request/config/source pins, expiry, identity and explicit custody mismatches refuse before writes', async t => {
  const mutations = [
    f => { f.request.manager_config.sha256 = 'ef'.repeat(32); },
    ...['manager', 'launcher', 'lock_script'].map(key => f => { f.request.review.sources[key] = 'ef'.repeat(32); }),
    f => { f.request.review.persistent_root_custody_reviewed = false; },
    f => { f.request.review.sessions_root.ino++; },
    f => { f.request.review.native_home.ino++; },
    f => { f.request.policy_expires_at = new Date(Date.now() + 60000).toISOString(); },
    f => { f.request.installation_id = 'another-installation'; },
    f => { f.request.owner_binding_sha256 = 'ef'.repeat(32); },
    ...['manifest_sha256', 'epoch', 'boot_id', 'transition_id', 'session_id', 'run_id'].map(key => f => {
      f.request.predecessor[key] = key === 'epoch' ? 9 : key === 'manifest_sha256' ? 'ef'.repeat(32) : id(9);
    }),
    f => { f.request.unreviewed_extra = true; },
  ];
  for (const mutate of mutations) {
    const f = await fixture(t); mutate(f);
    await assert.rejects(produceUnusedEvidence(f.requestPath, await f.save()));
    assert.deepEqual(await readdir(f.config.sessionsDirectory), []);
  }
  const f = await fixture(t);
  await assert.rejects(produceUnusedEvidence(f.requestPath, 'ef'.repeat(32)));
  const alias = join(f.root, 'request-alias'); await symlink(f.requestPath, alias);
  await assert.rejects(produceUnusedEvidence(alias, f.sha256));
  assert.deepEqual(await readdir(f.config.sessionsDirectory), []);
});

test('empty, partial and symlink transition directories are never attested or changed', async t => {
  for (const kind of ['empty', 'partial', 'symlink']) {
    const f = await fixture(t), target = join(f.root, 'target');
    if (kind === 'symlink') { await mkdir(target, { mode: 0o700 }); await symlink(target, f.directory); }
    else { await mkdir(f.directory, { mode: 0o700 }); if (kind === 'partial') await writeFile(join(f.directory, 'partial'), 'retained'); }
    await assert.rejects(produceUnusedEvidence(f.requestPath, f.sha256));
    assert.deepEqual(await readdir(f.directory), kind === 'partial' ? ['partial'] : []);
  }
});

// V3 (ARCHITECTURE_V2 A2): CHANGED from the pre-V3 "a held lock refuses
// consumption" expectation. A contended native-home lock is no longer
// refused: produceUnusedEvidence's own lock chain kills the live holder's
// process group and takes over, so a foreign/stale holder no longer blocks a
// fully valid, otherwise-reviewed request from being consumed.
test('a held native-home flock is reclaimed by unused evidence production rather than blocking it', async t => {
  const f = await fixture(t);
  const holder = spawn('bash', [lockScript, f.request.review.native_home.path, process.execPath, '-e',
    'console.log("locked");process.stdin.resume();'], { stdio: ['pipe', 'pipe', 'pipe'] });
  await once(holder.stdout, 'data');
  // Registered before any lock contention: a contended lock now (V3) kills a
  // live holder as part of takeover, so the 'exit' listener must be armed
  // before that can happen or the event is missed and this hangs forever.
  const exited = once(holder, 'exit');
  const evidence = await produceUnusedEvidence(f.requestPath, f.sha256);
  assert.equal(evidence.kind, 'unused-before-staging-v1');
  // The transition is now consumed by that successful production; a second,
  // independent (unlocked) --reserve attempt still fails on its own terms.
  await assert.rejects(run(process.execPath, [producer, '--reserve', f.requestPath, f.sha256]));
  assert.deepEqual(await readdir(f.config.sessionsDirectory), [basename(f.directory)]);
  const [, signal] = await exited;
  assert.ok(typeof signal === 'string' && signal.startsWith('SIG'),
    'the live holder must be genuinely killed by takeover, not merely outlast a refusal');
  holder.stdin.end();
});

test('a held transition-directory lock is reclaimed by evidence write rather than blocking it', async t => {
  const f = await fixture(t);
  const { stdout } = await run('bash', [lockScript, f.request.review.native_home.path, process.execPath,
    producer, '--reserve', f.requestPath, f.sha256]);
  assert.throws(() => JSON.parse(stdout)); // An internal handoff ticket is not evidence.
  assert.deepEqual(await readdir(f.directory), ['unused-reservation.json']);
  await assert.rejects(produceUnusedEvidence(f.requestPath, f.sha256));
  await assert.rejects(run(process.execPath, [producer, '--write', f.requestPath, f.sha256, stdout.trim()]));
  assert.deepEqual(await readdir(f.directory), ['unused-reservation.json']);
  const holder = spawn('bash', [lockScript, f.directory, process.execPath, '-e',
    'console.log("locked");process.stdin.resume();'], { stdio: ['pipe', 'pipe', 'pipe'] });
  await once(holder.stdout, 'data');
  // Registered before any lock contention: a contended lock now (V3) kills a
  // live holder as part of takeover, so the 'exit' listener must be armed
  // before that can happen or the event is missed and this hangs forever.
  const exited = once(holder, 'exit');
  // V3 (ARCHITECTURE_V2 A2): CHANGED from the pre-V3 "a held transition-
  // directory lock refuses the write" expectation. The nested lock chain
  // kills the live holder's process group and takes over, so the write with
  // a valid reservation ticket now succeeds instead of being refused.
  await run('bash', [lockScript, f.request.review.native_home.path,
    'bash', lockScript, f.directory, process.execPath, producer, '--write', f.requestPath, f.sha256, stdout.trim()]);
  assert.deepEqual((await readdir(f.directory)).sort(), ['unused-before-staging.json', 'unused-reservation.json']);
  const [, signal] = await exited;
  assert.ok(typeof signal === 'string' && signal.startsWith('SIG'),
    'the live holder must be genuinely killed by takeover, not merely outlast a refusal');
  holder.stdin.end();
});

test('racing and delayed real managers cannot both acquire the transition with the unused fence', async t => {
  for (const winner of ['manager', 'fence']) {
    const f = await fixture(t); let release, holds = 0, launches = 0;
    const assigned = new Promise(ok => { release = ok; });
    // Simulate a manager still holding its earlier authenticated assignment and
    // pre-expiry clock. The shared exclusive mkdir, not expiry rejection, decides.
    const manager = prepareHostedOwnerManager(f.config, { epoch: 8, operationId: id(6) }, {
      now: () => Date.parse(f.request.policy_expires_at) - 1000,
      control: { request: () => assigned }, tasks: { hold: async () => { holds++; } },
      launch: async () => { launches++; throw new Error('synthetic launch stop'); } });
    const assignment = { ...f.request.assignment, runtime_token: 'synthetic-task-token' };
    if (winner === 'manager') release(assignment);
    // Attach rejection handlers immediately, including the losing manager.
    const managerOutcome = manager.then(value => ({ value }), () => ({ refused: true }));
    // Control the winner instead of depending on child-process startup speed.
    if (winner === 'manager') await managerOutcome;
    const fenceOutcome = produceUnusedEvidence(f.requestPath, f.sha256).then(value => ({ value }), () => ({ refused: true }));
    const fence = await fenceOutcome;
    if (winner === 'fence') release(assignment);
    const prepared = await managerOutcome;
    assert.equal(Number(!!fence.value) + Number(!!prepared.value), 1);
    if (prepared.value) await assert.rejects(prepared.value());
    assert.equal(holds, winner === 'manager' ? 1 : 0); assert.equal(launches, holds);
    if (winner === 'fence') {
      await assert.rejects(prepareHostedOwnerManager(f.config, { epoch: 8, operationId: id(6) }, {
        now: () => Date.parse(f.request.policy_expires_at) - 1000, control: { request: async () => assignment },
        tasks: { hold: () => assert.fail('delayed hold') }, launch: () => assert.fail('delayed launch') }));
    } else await assert.rejects(readFile(join(f.directory, 'unused-before-staging.json')));
  }
});
