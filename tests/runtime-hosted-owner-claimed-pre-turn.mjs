import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, stat, symlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { produceClaimedPreTurnEvidence } from '../runtime/hosted-owner-claimed-pre-turn.mjs';
import { runHostedOwnerAlpha } from '../runtime/owner-alpha-entry.mjs';
import { FileJournal } from '../runtime/file-journal.mjs';
import { ExecutionBridge } from '../runtime/execution-bridge.mjs';
import { CodexAdapter } from '../runtime/codex-adapter.mjs';
import { createCodexTextOnlyProfile, codexTextOnlyProfileSha256 } from '../runtime/codex-text-only.mjs';

const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const marker = 'claimed-pre-turn-quarantine.json', canary = 'PRIVATE_CONTEXT_CANARY';
const lockScript = resolve('scripts/with-executor-lock.sh'), producer = resolve('runtime/hosted-owner-claimed-pre-turn.mjs');
const run = promisify(execFile);
async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'hehe-claimed-')); t.after(() => rm(base, { recursive: true, force: true }));
  const home = join(base, 'home'), sessions = join(base, 'sessions'), session = join(sessions, id(6)), journalPath = join(session, 'journal');
  for (const path of [home, sessions, session, journalPath]) await mkdir(path, { mode: 0o700 });
  const expires = Date.now() - 10000, issued = expires - 60000, deadline = new Date(expires - 17000).toISOString();
  const textOnlyProfile = { codexVersion: '0.154.0', model: 'fixture', catalogPath: join(base, 'catalog'),
    catalogValidation: 'synthetic-fixture', syntheticFixture: true,
    modelCatalog: { models: [{ slug: 'fixture', tool_mode: 'direct', experimental_supported_tools: [] }] } };
  const profile = createCodexTextOnlyProfile(textOnlyProfile), policy = { session_id: id(1), persona_id: id(2),
    expires_at: new Date(expires).toISOString(), max_runs: 1, max_task_seconds: 60,
    text_only: { profile_version: profile.version, profile_sha256: codexTextOnlyProfileSha256(profile) } };
  const template = { portalOrigin: 'https://control.example', installationId: 'claimed-fixture', hostedOwnerBindingSha256: 'ab'.repeat(32),
    nativeHome: home, stateDirectory: join(base, 'old'), runtimeTokenFile: join(base, 'missing-token'), ownerAlpha: policy,
    textOnlyProfile, personas: { [id(2)]: { agentId: 'helper', model: 'fixture', allowedTools: [] } } };
  const pin = async (path, value) => { const bytes = typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value);
    await writeFile(path, bytes, { mode: 0o600 }); return { path, sha256: hash(bytes) }; };
  const files = { template: await pin(join(base, 'template.json'), template) };
  const manager = { kind: 'owner-alpha-manager-v1', portalOrigin: template.portalOrigin, installationId: template.installationId,
    hostedOwnerBindingSha256: template.hostedOwnerBindingSha256, managerTokenFile: join(base, 'missing-manager-token'),
    templatePath: files.template.path, templateSha256: files.template.sha256, sessionsDirectory: sessions };
  files.manager = await pin(join(base, 'manager.json'), manager);
  const generation = { epoch: 9, boot_id: id(5), transition_id: id(6) }, identity = { epoch: 9, boot_id: id(5) };
  const runtime = { ...template, stateDirectory: session, runtimeTokenFile: join(session, 'runtime-token'), ownerAlpha: policy, ownerAlphaGeneration: generation };
  files.runtime = await pin(join(session, 'runtime.json'), runtime);
  const permissions = { name: `hehebot-restricted-${'df'.repeat(32)}`, configSha256: 'ef'.repeat(32) };
  files.service = await pin(join(journalPath, 'service.json'), { phase: 'recovery', bootId: id(5), ownerAlpha: policy,
    ownerAlphaGeneration: generation, hostedOwner: { bindingSha256: template.hostedOwnerBindingSha256, origin: template.portalOrigin },
    identity, permissions, nativeStopped: true });
  const journal = new FileJournal(journalPath);
  const adapter = new CodexAdapter({ journal, cwd: join(session, 'workspace'), permissionsProfile: permissions.name,
    ownerAlpha: { ...policy, expires_at: deadline }, textOnlyProfile: profile, now: () => issued + 1000,
    rpc: async method => { assert.equal(method, 'thread/start'); throw Object.assign(new Error('synthetic'), { code: 'CODEX_TIMEOUT' }); } });
  const claim = { run: { id: id(4), command_id: id(7), occurrence_id: null, persona_id: id(2), routine_id: null,
    role: 'coordinator', parent_run_id: null, title: null, status: 'claimed', current_attempt: 1, error_code: null, checkpoint_json: null,
    created_at: new Date(issued).toISOString(), updated_at: new Date(issued).toISOString(),
    context_json: JSON.stringify({ room_id: null, instruction: canary, skills: [{ id: id(8), revision: 3,
      body: { name: 'fixture', description: 'desc', when_to_use: 'test' } }] }) },
  submission_key: `${id(4)}:1`, deadline_at: deadline, text_only: policy.text_only };
  const bridge = new ExecutionBridge({ journal, native: adapter, identity, installationId: template.installationId,
    personas: template.personas, control: { request: async method => { assert.equal(method, 'claim'); return claim; } } });
  const dispatch = await bridge.claimNext(), native = await journal.get(dispatch.attemptId);
  for (const [key, name] of [['dispatch', bridge.cursor], ['native', dispatch.attemptId]]) {
    const path = join(journalPath, `${name}.json`); files[key] = { path, sha256: hash(await readFile(path)) };
  }
  files.requirements_evidence = await pin(join(base, 'reviewed-requirements'), 'Synthetic operator-reviewed evidence; no live attestation.');
  const rootPin = async path => { const s = await stat(path); return { path, dev: s.dev, ino: s.ino }; };
  const roots = { native_home: await rootPin(home), sessions_root: await rootPin(sessions), session: await rootPin(session), journal: await rootPin(journalPath) };
  const current_sources = {}, original_sources = {};
  for (const [key, path] of Object.entries({ manager: 'runtime/hosted-owner-manager.mjs', launcher: 'runtime/hosted-owner-launcher.mjs',
    entry: 'runtime/owner-alpha-entry.mjs', service: 'runtime/codex-service.mjs', bridge: 'runtime/execution-bridge.mjs', adapter: 'runtime/codex-adapter.mjs',
    journal: 'runtime/file-journal.mjs', text_only: 'runtime/codex-text-only.mjs', lock_script: 'scripts/with-executor-lock.sh' })) {
    const bytes = await readFile(resolve(path)); current_sources[key] = hash(bytes);
    original_sources[key] = await pin(join(base, `original-${key}`), bytes);
  }
  const request = { kind: 'owner-alpha-claimed-pre-turn-request-v1', installation_id: template.installationId,
    owner_binding_sha256: template.hostedOwnerBindingSha256, predecessor: { manifest_sha256: 'cd'.repeat(32), epoch: 9,
      boot_id: id(5), transition_id: id(6), session_id: id(1), run_id: id(4), attempt: 1, submission_key: claim.submission_key,
      native_attempt_id: dispatch.attemptId, native_fingerprint: native.fingerprint },
    assignment: { grant: { installation_id: template.installationId, owner_binding_sha256: template.hostedOwnerBindingSha256,
      run_id: id(4), epoch: 9, boot_id: id(5), transition_id: id(6), manifest_sha256: 'cd'.repeat(32),
      issued_at: new Date(issued).toISOString(), expires_at: policy.expires_at }, policy }, text_only_binding: profile.binding, files, roots,
    review: { source: 'synthetic-operator-review', reviewed_at: new Date().toISOString(), current_sources, original_sources,
      assertions: { original_source_semantics_reviewed: true, intact_single_writer_no_rollback: true, fsync_before_turn: true,
        no_alternate_ingress_throughout_predecessor: true, memories_disabled_throughout_predecessor: true, prospective_managed_denial_reviewed: true } } };
  const requestPath = join(base, 'request.json'), save = async () => (await pin(requestPath, request)).sha256;
  const change = async (key, action) => { const value = JSON.parse(await readFile(files[key].path)); action(value); files[key] = await pin(files[key].path, value); };
  return { base, request, requestPath, sha256: await save(), save, change, runtime, session, markerPath: join(session, marker) };
}

test('exact claimed pre-turn evidence uses real locks, preserves old bytes, and does not emit retirement or prompt data', async t => {
  const f = await fixture(t), before = await Promise.all(Object.values(f.request.files).map(pin => readFile(pin.path)));
  const report = await produceClaimedPreTurnEvidence(f.requestPath, f.sha256), bytes = await readFile(f.markerPath);
  assert.deepEqual(report, { kind: 'claimed-pre-turn-quarantine-v1', installation_id: f.request.installation_id,
    owner_binding_sha256: f.request.owner_binding_sha256, predecessor: f.request.predecessor,
    evidence: { sha256: hash(bytes), observed_at: JSON.parse(bytes).observed_at, source: f.request.review.source } });
  assert.ok(report.evidence.observed_at >= f.request.assignment.policy.expires_at);
  assert.deepEqual(JSON.parse(bytes).trusted_operator_review, f.request.review);
  assert.ok(!bytes.includes(canary)); assert.doesNotMatch(JSON.stringify(report), /nativeStopped|retirement|successor|refund/);
  assert.equal((await stat(f.markerPath)).mode & 0o777, 0o400);
  assert.deepEqual(await Promise.all(Object.values(f.request.files).map(pin => readFile(pin.path))), before);
  await assert.rejects(produceClaimedPreTurnEvidence(f.requestPath, f.sha256));
  assert.deepEqual(await readFile(f.markerPath), bytes);
  // Pre-diagnostic native journals remain eligible without conversion.
  const legacy = await fixture(t); await legacy.change('native', row => { delete row.submissionFailure; });
  const { stdout } = await run(process.execPath, [producer, '--produce', legacy.requestPath, await legacy.save()]);
  assert.equal(JSON.parse(stdout).evidence.sha256, hash(await readFile(legacy.markerPath)));
});

test('literal null, contradictory records and unknown journals refuse without marker or record modification', async t => {
  const cases = [
    ['native', row => { delete row.threadId; }], ['native', row => { delete row.nativeRunId; }],
    ['native', row => { row.threadId = 'thread-known'; }], ['native', row => { row.nativeRunId = 'turn-known'; }],
    ['native', row => { row.rootSettled = true; }], ['native', row => { row.commands = {}; }],
    ['native', row => { row.outputPreview = { text: canary }; }], ['native', row => { row.childTurns = {}; }],
    ['native', row => { row.initialInference = 'inProgress'; }], ['native', row => { row.effects = {}; }],
    ['native', row => { row.submissionFailure.stage = 'turn_start'; }],
    ['service', row => { row.nativeStopped = false; }], ['service', row => { row.identity.epoch++; }],
    ['dispatch', row => { row.claim.run.current_attempt = 2; }], ['dispatch', row => { row.claim.deadline_at = fardate; }],
  ];
  const fardate = '2099-01-01T00:00:00.000Z';
  for (const [key, action] of cases) {
    const f = await fixture(t); await f.change(key, action);
    const bytes = await readFile(f.request.files[key].path);
    await assert.rejects(produceClaimedPreTurnEvidence(f.requestPath, await f.save()));
    await assert.rejects(stat(f.markerPath), { code: 'ENOENT' });
    assert.deepEqual(await readFile(f.request.files[key].path), bytes);
  }
  const f = await fixture(t); await writeFile(join(f.request.roots.journal.path, 'effect-extra.json'), '{}', { mode: 0o600 });
  await assert.rejects(produceClaimedPreTurnEvidence(f.requestPath, f.sha256));
  await assert.rejects(stat(f.markerPath), { code: 'ENOENT' });
  const corrupt = await fixture(t), pin = corrupt.request.files.native;
  await writeFile(pin.path, '{broken'); pin.sha256 = hash('{broken');
  await assert.rejects(produceClaimedPreTurnEvidence(corrupt.requestPath, await corrupt.save()));
  await assert.rejects(stat(corrupt.markerPath), { code: 'ENOENT' });
});

test('pins, expiry, identity and all historical assertions are required before writes', async t => {
  const mutations = [r => { r.files.runtime.sha256 = '00'.repeat(32); }, r => { r.review.current_sources.adapter = '00'.repeat(32); },
    r => { r.review.original_sources.bridge.sha256 = '00'.repeat(32); }, r => { r.files.requirements_evidence.sha256 = '00'.repeat(32); },
    r => { r.predecessor.native_fingerprint = '00'.repeat(32); }, r => { r.predecessor.native_attempt_id = '00'.repeat(32); },
    r => { r.predecessor.run_id = id(9); }, r => { r.owner_binding_sha256 = '00'.repeat(32); },
    r => { r.assignment.policy.expires_at = '2099-01-01T00:00:00.000Z'; }, r => { r.roots.session.ino++; },
    r => { r.review.assertions.fsync_before_turn = 'true'; }, r => { r.review.assertions.memories_disabled_throughout_predecessor = null; },
    ...['original_source_semantics_reviewed', 'intact_single_writer_no_rollback', 'fsync_before_turn',
      'no_alternate_ingress_throughout_predecessor', 'memories_disabled_throughout_predecessor', 'prospective_managed_denial_reviewed']
      .map(key => r => { delete r.review.assertions[key]; })];
  for (const mutate of mutations) {
    const f = await fixture(t); mutate(f.request);
    await assert.rejects(produceClaimedPreTurnEvidence(f.requestPath, await f.save()));
    await assert.rejects(stat(f.markerPath), { code: 'ENOENT' });
  }
});

test('both kernel locks are required and a direct helper invocation cannot assert their ownership', async t => {
  for (const key of ['native_home', 'session']) {
    const f = await fixture(t), holder = spawn('bash', [lockScript, f.request.roots[key].path, process.execPath, '-e',
      'console.log("locked");process.stdin.resume();'], { stdio: ['pipe', 'pipe', 'pipe'] });
    await once(holder.stdout, 'data');
    try {
      await assert.rejects(produceClaimedPreTurnEvidence(f.requestPath, f.sha256));
      await assert.rejects(run(process.execPath, [producer, '--write-locked', f.requestPath, f.sha256]));
      await assert.rejects(stat(f.markerPath), { code: 'ENOENT' });
    } finally { const exit = once(holder, 'exit'); holder.stdin.end(); await exit; }
  }
});

test('partial/existing/symlink marker is never overwritten and blocks otherwise fresh supported entry', async t => {
  for (const kind of ['empty', 'partial', 'symlink']) {
    const f = await fixture(t);
    if (kind === 'symlink') await symlink(join(f.base, 'missing'), f.markerPath);
    else await writeFile(f.markerPath, kind === 'empty' ? '' : '{partial', { mode: 0o600 });
    await assert.rejects(produceClaimedPreTurnEvidence(f.requestPath, f.sha256));
    // Separate fresh-looking directory proves marker refusal, not existing journal refusal.
    const fresh = join(f.base, 'fresh'); await mkdir(fresh, { mode: 0o700 });
    if (kind === 'symlink') await symlink(join(f.base, 'missing'), join(fresh, marker));
    else await writeFile(join(fresh, marker), kind === 'empty' ? '' : '{partial', { mode: 0o600 });
    await assert.rejects(runHostedOwnerAlpha({ ...f.runtime, stateDirectory: fresh,
      ownerAlpha: { ...f.runtime.ownerAlpha, expires_at: new Date(Date.now() + 60000).toISOString() } }, {
      createService: () => assert.fail('no service/account work'), launch: () => assert.fail('no native launch'),
    }), { code: 'OWNER_ALPHA_FRESH_STATE_REQUIRED' });
    assert.deepEqual(await readdir(fresh), [marker]);
  }
});
