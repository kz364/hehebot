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
async function fixture(t, originalProfile = false) {
  const base = await mkdtemp(join(tmpdir(), 'hehe-claimed-')); t.after(() => rm(base, { recursive: true, force: true }));
  const home = join(base, 'home'), sessions = join(base, 'sessions'), session = join(sessions, id(6)), journalPath = join(session, 'journal');
  for (const path of [home, sessions, session, journalPath]) await mkdir(path, { mode: 0o700 });
  const expires = Date.now() - 10000, issued = expires - 60000, deadline = new Date(expires - 17000).toISOString();
  const textOnlyProfile = { codexVersion: '0.154.0', model: 'fixture', catalogPath: join(base, 'catalog'),
    catalogValidation: 'synthetic-fixture', syntheticFixture: true,
    modelCatalog: { models: [{ slug: 'fixture', tool_mode: 'direct', experimental_supported_tools: [] }] } };
  let profile = createCodexTextOnlyProfile(textOnlyProfile);
  if (originalProfile) {
    const startupConfig = { ...profile.startupConfig };
    for (const key of ['features.memories', 'features.skill_search', 'skills.include_instructions', 'project_doc_max_bytes']) delete startupConfig[key];
    profile = { ...profile, startupConfig, binding: { ...profile.binding, commandedConfigSha256: hash(JSON.stringify(startupConfig)) } };
  }
  const policy = { session_id: id(1), persona_id: id(2),
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
  const rootPin = async path => { const s = await stat(path); return { path, dev: s.dev, ino: s.ino }; };
  const roots = { native_home: await rootPin(home), sessions_root: await rootPin(sessions), session: await rootPin(session), journal: await rootPin(journalPath) };
  const current_sources = {}, original_sources = {};
  for (const [key, path] of Object.entries({ manager: 'runtime/hosted-owner-manager.mjs', launcher: 'runtime/hosted-owner-launcher.mjs',
    entry: 'runtime/owner-alpha-entry.mjs', service: 'runtime/codex-service.mjs', bridge: 'runtime/execution-bridge.mjs', adapter: 'runtime/codex-adapter.mjs',
    journal: 'runtime/file-journal.mjs', text_only: 'runtime/codex-text-only.mjs', lock_script: 'scripts/with-executor-lock.sh' })) {
    const bytes = await readFile(resolve(path)); current_sources[key] = hash(bytes);
    original_sources[key] = await pin(join(base, `original-${key}`), bytes);
  }
  current_sources.launch_floor = hash(await readFile(resolve('runtime/owner-alpha-launch-floor.mjs')));
  const request = { kind: 'owner-alpha-claimed-pre-turn-request-v2', installation_id: template.installationId,
    owner_binding_sha256: template.hostedOwnerBindingSha256, predecessor: { manifest_sha256: 'cd'.repeat(32), epoch: 9,
      boot_id: id(5), transition_id: id(6), session_id: id(1), run_id: id(4), attempt: 1, submission_key: claim.submission_key,
      native_attempt_id: dispatch.attemptId, native_fingerprint: native.fingerprint },
    assignment: { grant: { installation_id: template.installationId, owner_binding_sha256: template.hostedOwnerBindingSha256,
      run_id: id(4), epoch: 9, boot_id: id(5), transition_id: id(6), manifest_sha256: 'cd'.repeat(32),
      issued_at: new Date(issued).toISOString(), expires_at: policy.expires_at }, policy }, text_only_binding: profile.binding, files, roots,
    review: { source: 'synthetic-operator-review', reviewed_at: new Date().toISOString(), current_sources, original_sources,
      historical_memory_activity: 'unknown', historical_remote_ingress: 'unknown',
      assertions: { original_source_semantics_reviewed: true, intact_single_writer_no_rollback: true, fsync_before_turn: true,
        prospective_managed_denial_reviewed: true } } };
  const boot = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
  const receipt = { kind: 'owner-alpha-prospective-isolation-v2', installation_id: request.installation_id,
    owner_binding_sha256: request.owner_binding_sha256, predecessor: structuredClone(request.predecessor),
    source: request.review.source, observed_at: request.review.reviewed_at, valid_until: new Date(Date.now() + 120000).toISOString(),
    execution_cut: { kind: 'same-resource-whole-execution-cut', resource_id: 'synthetic-same-resource',
      before_kernel_boot_id: id(90), after_kernel_boot_id: boot, completed_at: new Date(expires + 1000).toISOString(),
      supported_operation: 'synthetic-reviewed-provider-operation', retained_state_sha256: '',
      retained_sources_sha256: hash(JSON.stringify({ current_sources, original_sources })) },
    managed: { requirements: await pin(join(base, 'requirements.toml'), 'allow_remote_control = false\n[features]\nmemories = false\n'),
      codex_version: '0.154.0', same_process_readback: true, process_id: 123, kernel_boot_id: boot,
      allow_remote_control: false, required_memories: false, effective_memories: false },
    ambient_input: await pin(join(base, 'ambient-review'), 'synthetic reviewed ambient input inventory'),
    assertions: { supported_whole_execution_cut_reviewed: true, current_launch_autostart_custody_reviewed: true,
      old_authority_expired_and_fenced: true, fresh_workspace_and_native_thread_no_resume: true, only_reviewed_subsequent_launch_paths: true } };
  const saveReceipt = async () => { files.requirements_evidence = await pin(join(base, 'reviewed-requirements'), receipt); };
  const rebindState = async () => {
    receipt.execution_cut.retained_state_sha256 = hash(JSON.stringify({ files: Object.fromEntries(
      ['runtime', 'service', 'dispatch', 'native'].map(key => [key, files[key]])), roots }));
    await saveReceipt();
  };
  await rebindState();
  const requestPath = join(base, 'request.json'), save = async () => (await pin(requestPath, request)).sha256;
  const change = async (key, action) => { const value = JSON.parse(await readFile(files[key].path)); action(value);
    files[key] = await pin(files[key].path, value); await rebindState(); };
  return { base, request, requestPath, sha256: await save(), save, change, receipt, saveReceipt, runtime, session, markerPath: join(session, marker) };
}

test('exact claimed pre-turn evidence uses real locks, preserves old bytes, and does not emit retirement or prompt data', async t => {
  const f = await fixture(t), before = await Promise.all(Object.values(f.request.files).map(pin => readFile(pin.path)));
  const report = await produceClaimedPreTurnEvidence(f.requestPath, f.sha256), bytes = await readFile(f.markerPath);
  assert.deepEqual(report, { kind: 'claimed-pre-turn-quarantine-v1', installation_id: f.request.installation_id,
    owner_binding_sha256: f.request.owner_binding_sha256, predecessor: f.request.predecessor,
    evidence: { sha256: hash(bytes), observed_at: JSON.parse(bytes).observed_at, source: f.request.review.source } });
  assert.ok(report.evidence.observed_at >= f.request.assignment.policy.expires_at);
  assert.deepEqual(JSON.parse(bytes).trusted_operator_review, f.request.review);
  assert.equal(JSON.parse(bytes).evidence_format, 'claimed-pre-turn-evidence-v2');
  assert.deepEqual(JSON.parse(bytes).trusted_prospective_isolation, f.receipt);
  assert.ok(!bytes.includes(canary)); assert.doesNotMatch(JSON.stringify(report), /nativeStopped|retirement|successor|refund/);
  assert.equal((await stat(f.markerPath)).mode & 0o777, 0o400);
  assert.deepEqual(await Promise.all(Object.values(f.request.files).map(pin => readFile(pin.path))), before);
  await assert.rejects(produceClaimedPreTurnEvidence(f.requestPath, f.sha256));
  assert.deepEqual(await readFile(f.markerPath), bytes);
  // Original commanded hashes and pre-diagnostic journals remain eligible without conversion.
  const legacy = await fixture(t, true); await legacy.change('native', row => { delete row.submissionFailure; });
  assert.notEqual(legacy.request.text_only_binding.commandedConfigSha256, f.request.text_only_binding.commandedConfigSha256);
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

test('pins, expiry, identity and retained custody assertions are required before writes', async t => {
  const mutations = [r => { r.files.runtime.sha256 = '00'.repeat(32); }, r => { r.review.current_sources.adapter = '00'.repeat(32); },
    r => { delete r.review.current_sources.launch_floor; }, r => { r.review.current_sources.launch_floor = '00'.repeat(32); },
    r => { r.review.original_sources.launch_floor = r.review.original_sources.entry; },
    r => { r.review.original_sources.bridge.sha256 = '00'.repeat(32); }, r => { r.files.requirements_evidence.sha256 = '00'.repeat(32); },
    r => { r.predecessor.native_fingerprint = '00'.repeat(32); }, r => { r.predecessor.native_attempt_id = '00'.repeat(32); },
    r => { r.predecessor.run_id = id(9); }, r => { r.owner_binding_sha256 = '00'.repeat(32); },
    r => { r.assignment.policy.expires_at = '2099-01-01T00:00:00.000Z'; }, r => { r.roots.session.ino++; },
    r => { r.review.assertions.fsync_before_turn = 'true'; }, r => { r.review.historical_memory_activity = false; },
    r => { delete r.review.historical_remote_ingress; }, r => { r.kind = 'owner-alpha-claimed-pre-turn-request-v1'; },
    r => { r.review.assertions.memories_disabled_throughout_predecessor = true; },
    ...['original_source_semantics_reviewed', 'intact_single_writer_no_rollback', 'fsync_before_turn',
      'prospective_managed_denial_reviewed']
      .map(key => r => { delete r.review.assertions[key]; })];
  for (const mutate of mutations) {
    const f = await fixture(t); mutate(f.request);
    await assert.rejects(produceClaimedPreTurnEvidence(f.requestPath, await f.save()));
    await assert.rejects(stat(f.markerPath), { code: 'ENOENT' });
  }
});

test('prospective receipt rejects crossed, stale, missing and weaker isolation evidence', async t => {
  const mutations = [
    r => { r.predecessor.epoch++; }, r => { r.installation_id = 'other'; },
    r => { r.owner_binding_sha256 = 'aa'.repeat(32); }, r => { r.source = 'other-review'; },
    r => { r.valid_until = r.observed_at; }, r => { r.valid_until = '2099-01-01T00:00:00.000Z'; },
    r => { r.execution_cut.before_kernel_boot_id = r.execution_cut.after_kernel_boot_id; },
    r => { r.execution_cut.after_kernel_boot_id = id(91); r.managed.kernel_boot_id = id(91); },
    r => { r.execution_cut.completed_at = '2000-01-01T00:00:00.000Z'; },
    r => { r.execution_cut.retained_state_sha256 = '00'.repeat(32); },
    r => { r.execution_cut.retained_sources_sha256 = '00'.repeat(32); },
    r => { delete r.execution_cut.resource_id; }, r => { delete r.execution_cut.supported_operation; },
    r => { r.managed.same_process_readback = false; }, r => { r.managed.kernel_boot_id = id(92); },
    r => { r.managed.codex_version = '0.155.0'; }, r => { r.managed.allow_remote_control = true; },
    r => { r.managed.required_memories = null; }, r => { r.managed.effective_memories = true; },
    r => { r.managed.requirements.sha256 = '00'.repeat(32); }, r => { r.ambient_input.sha256 = '00'.repeat(32); },
    ...['supported_whole_execution_cut_reviewed', 'current_launch_autostart_custody_reviewed',
      'old_authority_expired_and_fenced', 'fresh_workspace_and_native_thread_no_resume', 'only_reviewed_subsequent_launch_paths']
      .map(key => r => { delete r.assertions[key]; }),
  ];
  for (const mutate of mutations) {
    const f = await fixture(t); mutate(f.receipt); await f.saveReceipt();
    await assert.rejects(produceClaimedPreTurnEvidence(f.requestPath, await f.save()));
    await assert.rejects(stat(f.markerPath), { code: 'ENOENT' });
  }
});

test('stopped direct child and both free locks do not attest a surviving helper is cut', async t => {
  const f = await fixture(t), helper = spawn(process.execPath, ['-e', 'console.log("alive");process.stdin.resume()'],
    { stdio: ['pipe', 'pipe', 'pipe'] });
  await once(helper.stdout, 'data');
  try {
    await run(process.execPath, ['-e', 'process.exit(0)']);
    await run('bash', [lockScript, f.request.roots.native_home.path, 'bash', lockScript,
      f.request.roots.session.path, process.execPath, '-e', 'process.exit(0)']);
    assert.equal(helper.exitCode, null);
    f.receipt.execution_cut = { kind: 'direct-child-stopped', direct_child_stopped: true,
      execution_lock_free: true, session_lock_free: true };
    await f.saveReceipt();
    await assert.rejects(produceClaimedPreTurnEvidence(f.requestPath, await f.save()));
    assert.equal(helper.exitCode, null);
    await assert.rejects(stat(f.markerPath), { code: 'ENOENT' });
  } finally { const exit = once(helper, 'exit'); helper.stdin.end(); await exit; }
});

// V3 (ARCHITECTURE_V2 A2): CHANGED from the pre-V3 "a held lock refuses
// evidence production" expectation. A contended native_home or session lock
// is no longer refused: the real nested lock chain inside
// produceClaimedPreTurnEvidence kills the live holder's process group and
// takes over, so a foreign/stale holder no longer blocks evidence from a
// fully valid, otherwise-reviewed request. A bare `--write-locked`
// invocation that holds no lock of its own is still refused, since `held()`
// requires an fd, not merely a claim.
test('a held kernel lock is reclaimed by claimed pre-turn evidence production rather than blocking it', async t => {
  for (const key of ['native_home', 'session']) {
    const f = await fixture(t), holder = spawn('bash', [lockScript, f.request.roots[key].path, process.execPath, '-e',
      'console.log("locked");process.stdin.resume();'], { stdio: ['pipe', 'pipe', 'pipe'] });
    await once(holder.stdout, 'data');
    // Registered before any lock contention: a contended lock now (V3) kills a
    // live holder as part of takeover, so the 'exit' listener must be armed
    // before that can happen or the event is missed and this hangs forever.
    const exited = once(holder, 'exit');
    try {
      const evidence = await produceClaimedPreTurnEvidence(f.requestPath, f.sha256);
      assert.equal(evidence.kind, 'claimed-pre-turn-quarantine-v1');
      await assert.rejects(run(process.execPath, [producer, '--write-locked', f.requestPath, f.sha256]));
      assert.ok(await stat(f.markerPath).then(() => true, () => false));
      const [, signal] = await exited;
      assert.ok(typeof signal === 'string' && signal.startsWith('SIG'),
        'the live holder must be genuinely killed by takeover, not merely outlast a refusal');
    } finally { holder.stdin.end(); }
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
