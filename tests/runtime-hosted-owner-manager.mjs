import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { once, EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { runHostedOwnerManager, prepareHostedOwnerManager } from '../runtime/hosted-owner-manager.mjs';
import { createHostedOwnerWakeService } from '../runtime/hosted-owner-wake.mjs';
import { readOwnerAlphaConfig } from '../runtime/owner-alpha-entry.mjs';
import { createCodexTextOnlyProfile, codexTextOnlyProfileSha256 } from '../runtime/codex-text-only.mjs';
import { FileJournal } from '../runtime/file-journal.mjs';

// The real client is the existing first-party TS bundle, not a copied mock.
// Build it here so credential-free runtime tests also work in a fresh checkout.
execFileSync('bash', [decodeURIComponent(new URL('../scripts/build-codex-service.sh', import.meta.url).pathname)], { stdio: 'pipe' });

const id = n => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'hehe-manager-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const nativeHome = join(root, 'home'), sessionsDirectory = join(root, 'sessions');
  await mkdir(nativeHome, { mode: 0o700 }); await mkdir(sessionsDirectory, { mode: 0o700 });
  const textOnlyProfile = { codexVersion: '0.154.0', model: 'fixture', modelCatalog: { models: [
    { slug: 'fixture', tool_mode: 'direct', experimental_supported_tools: [] }] },
  catalogPath: join(root, 'catalog.json'), catalogValidation: 'synthetic-fixture', syntheticFixture: true };
  const text_only = { profile_version: 'codex-text-only-v1',
    profile_sha256: codexTextOnlyProfileSha256(createCodexTextOnlyProfile(textOnlyProfile)) };
  const now = Date.now();
  const policy = { session_id: id(1), persona_id: id(2), expires_at: new Date(now + 60000).toISOString(),
    max_runs: 1, max_task_seconds: 60, text_only };
  const template = { portalOrigin: 'https://control.example', installationId: 'manager-fixture',
    hostedOwnerBindingSha256: 'ab'.repeat(32), nativeHome, stateDirectory: join(root, 'old-state'),
    runtimeTokenFile: join(root, 'old-token'), ownerAlpha: policy, textOnlyProfile,
    personas: { [id(2)]: { model: 'fixture', allowedTools: [] } } };
  const templatePath = join(root, 'template.json'), bytes = JSON.stringify(template);
  await writeFile(templatePath, bytes, { mode: 0o600 });
  const config = { kind: 'owner-alpha-manager-v1', portalOrigin: template.portalOrigin,
    installationId: template.installationId, hostedOwnerBindingSha256: template.hostedOwnerBindingSha256,
    templatePath, templateSha256: sha(bytes), sessionsDirectory, managerTokenFile: join(root, 'manager-token') };
  const grant = { installation_id: template.installationId, owner_binding_sha256: template.hostedOwnerBindingSha256,
    run_id: id(4), epoch: 7, boot_id: id(5), transition_id: id(6), manifest_sha256: 'cd'.repeat(32),
    issued_at: new Date(now - 1000).toISOString(), expires_at: policy.expires_at };
  const assignment = { grant, policy, runtime_token: 'opaque-task-token' };
  const calls = [], request = { epoch: 7, operationId: id(6) };
  const control = { request: async (type, body) => { calls.push({ type, body }); return type === 'manifest' ? assignment : null; } };
  return { root, config, template, assignment, calls, request, control };
}
async function stopped(path, mutate = row => row) {
  const { config } = await readOwnerAlphaConfig(path);
  const generation = config.ownerAlphaGeneration;
  await new FileJournal(join(config.stateDirectory, 'journal')).putIfAbsent('service', mutate({
    nativeStopped: true, bootId: generation.boot_id, identity: { epoch: generation.epoch, boot_id: generation.boot_id },
    ownerAlpha: config.ownerAlpha, ownerAlphaGeneration: generation,
    hostedOwner: { bindingSha256: config.hostedOwnerBindingSha256, origin: config.portalOrigin } }));
}
const futureForStaging = f => () => Date.parse(f.assignment.policy.expires_at) - 1000;
function expiredForInspection(f) {
  f.assignment.policy.expires_at = f.assignment.grant.expires_at = new Date(Date.now() - 1000).toISOString();
  f.assignment.grant.issued_at = new Date(Date.now() - 60000).toISOString();
}

test('stages exclusive private task config preserving native identity; UNKNOWN survives reconstructed replay', async t => {
  const f = await fixture(t); let launches = 0;
  const launch = async (path, options) => {
    launches++;
    const { config, sha256 } = await readOwnerAlphaConfig(path);
    assert.equal(options.expectedSha256, sha256);
    assert.equal(config.nativeHome, f.template.nativeHome);
    assert.deepEqual(config.textOnlyProfile, f.template.textOnlyProfile);
    assert.equal(config.managerTokenFile, undefined);
    assert.equal(await readFile(config.runtimeTokenFile, 'utf8'), 'opaque-task-token');
    assert.equal((await stat(config.runtimeTokenFile)).mode & 0o777, 0o600);
    const intent = JSON.parse(await readFile(join(config.stateDirectory, 'hosted-owner-launch-intent.json')));
    assert.equal(intent.phase, 'unknown'); assert.equal(intent.config_sha256, sha256);
    return { code: 0, signal: null }; // Not native stop evidence.
  };
  await assert.rejects(runHostedOwnerManager(f.config, f.request, { control: f.control, launch }));
  await assert.rejects(runHostedOwnerManager(structuredClone(f.config), f.request, { control: f.control, launch }));
  assert.equal(launches, 1); assert.equal(f.calls.filter(c => c.type === 'retirement').length, 0);
});

test('invalid identity, epoch, operation, lifetime, expiry and profile refuse before staging', async t => {
  for (const mutate of [
    f => { f.assignment.grant.installation_id = id(8); },
    f => { f.assignment.grant.owner_binding_sha256 = 'ef'.repeat(32); },
    f => { f.request.epoch++; }, f => { f.request.operationId = id(9); },
    f => { f.assignment.grant.issued_at = new Date(Date.now() - 300000).toISOString(); },
    f => { f.assignment.policy.expires_at = f.assignment.grant.expires_at = new Date(Date.now() - 1).toISOString(); },
    f => { f.assignment.policy.persona_id = id(10); },
    f => { f.assignment.policy.text_only.profile_sha256 = 'ef'.repeat(32); },
    f => { f.assignment.policy.max_runs = 2; },
    f => { f.assignment.grant.session_id = id(11); },
    f => { f.config.templateSha256 = 'ef'.repeat(32); },
  ]) {
    const f = await fixture(t); mutate(f);
    await assert.rejects(runHostedOwnerManager(f.config, f.request, { control: f.control, launch: () => assert.fail('launched') }));
    assert.deepEqual(await readdir(f.config.sessionsDirectory), []);
  }
});

test('partial directory is a permanent replay fence; null assignment stages nothing', async t => {
  const f = await fixture(t);
  assert.equal(await runHostedOwnerManager(f.config, f.request, { control: { request: async () => null } }), 'NO_ASSIGNMENT');
  assert.deepEqual(await readdir(f.config.sessionsDirectory), []);
  await mkdir(join(f.config.sessionsDirectory, f.request.operationId), { mode: 0o700 });
  await assert.rejects(runHostedOwnerManager(f.config, f.request, { control: f.control, launch: () => assert.fail('launched') }));
});

test('manager bearer and paired Access files stay on manager transport; uncertain retirement is not retried', async t => {
  const f = await fixture(t); expiredForInspection(f);
  f.config.accessClientIdFile = join(f.root, 'access-id');
  f.config.accessClientSecretFile = join(f.root, 'access-secret');
  const secrets = new Map([[f.config.managerTokenFile, 'manager-only-canary'],
    [f.config.accessClientIdFile, 'access-id-canary'], [f.config.accessClientSecretFile, 'access-secret-canary']]);
  const calls = [], original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push(url);
    assert.equal(options.headers.Authorization, 'Bearer manager-only-canary');
    assert.equal(options.headers['CF-Access-Client-Id'], 'access-id-canary');
    assert.equal(options.headers['CF-Access-Client-Secret'], 'access-secret-canary');
    if (url.endsWith('/manifest')) {
      assert.equal(options.body, '{}');
      return new Response(JSON.stringify(f.assignment), { headers: { 'content-type': 'application/json' } });
    }
    throw new Error('uncertain secret response');
  };
  t.after(() => { globalThis.fetch = original; });
  await assert.rejects(runHostedOwnerManager(f.config, f.request, { now: futureForStaging(f),
    readSecret: async path => secrets.get(path), launch: async path => {
      const bytes = await readFile(path, 'utf8');
      assert.ok(!bytes.includes('manager-only-canary'));
      assert.ok(!bytes.includes(f.config.managerTokenFile));
      await stopped(path);
    } }), error => error.code === 'CONTROL_TRANSPORT_FAILED' && !error.message.includes('secret'));
  assert.deepEqual(calls, ['https://control.example/internal/manager/manifest', 'https://control.example/internal/manager/retirement']);
});

test('retirement requires matching native-stop journal and both real locks after expiry', async t => {
  const f = await fixture(t); expiredForInspection(f);
  assert.equal(await runHostedOwnerManager(f.config, f.request, { control: f.control, now: futureForStaging(f),
    launch: async path => { await stopped(path); return { code: 1 }; } }), 'RETIREMENT_REPORTED');
  const report = f.calls[1];
  assert.equal(report.type, 'retirement');
  assert.deepEqual(report.body, { epoch: 7, boot_id: id(5), session_id: id(1), transition_id: id(6),
    observed_at: report.body.observed_at, direct_child_stopped: true, execution_lock_free: true, session_lock_free: true,
    source: 'hosted-manager:file-journal-nativeStopped+dual-flock' });
  assert.ok(Date.parse(report.body.observed_at) >= Date.parse(f.assignment.policy.expires_at));
});

test('wrong journal identity, false stop, and pre-expiry stop never report retirement', async t => {
  for (const mutate of [row => ({ ...row, nativeStopped: false }), row => ({ ...row, bootId: id(9) }),
    row => ({ ...row, identity: { epoch: 8, boot_id: id(5) } }),
    row => ({ ...row, ownerAlphaGeneration: { ...row.ownerAlphaGeneration, transition_id: id(9) } }),
    row => ({ ...row, ownerAlpha: { ...row.ownerAlpha, session_id: id(9) } }),
    row => ({ ...row, hostedOwner: { ...row.hostedOwner, bindingSha256: 'ef'.repeat(32) } }), null]) {
    const f = await fixture(t); if (mutate) expiredForInspection(f);
    await assert.rejects(runHostedOwnerManager(f.config, f.request, { control: f.control, now: futureForStaging(f),
      launch: async path => stopped(path, mutate ?? (row => row)) }));
    assert.deepEqual(f.calls.map(c => c.type), ['manifest']);
  }
});

test('either held kernel lock prevents retirement despite matching native-stop journal', async t => {
  for (const which of ['nativeHome', 'stateDirectory']) {
    const f = await fixture(t); expiredForInspection(f); let holder;
    try {
      await assert.rejects(runHostedOwnerManager(f.config, f.request, { control: f.control, now: futureForStaging(f),
        launch: async path => {
          await stopped(path);
          const { config } = await readOwnerAlphaConfig(path);
          holder = spawn('bash', [resolve('scripts/with-executor-lock.sh'), config[which], process.execPath,
            '-e', 'console.log("locked"); process.stdin.resume();'], { stdio: ['pipe', 'pipe', 'pipe'] });
          await once(holder.stdout, 'data');
        } }));
      assert.deepEqual(f.calls.map(c => c.type), ['manifest']);
    } finally { if (holder) { const exited = once(holder, 'exit'); holder.stdin.end(); await exited; } }
  }
});

function heldTaskTransport(f) {
  const requests = []; let finishGet, gotReadback;
  const pending = new Promise(ok => { gotReadback = ok; });
  const request = (options, callback) => {
    requests.push(options.method);
    assert.equal(options.socketPath, '/.sprite/api.sock');
    assert.equal(options.path, `/v1/tasks/hehe-bootstrap-${f.request.operationId}`);
    const req = new EventEmitter(); req.destroy = () => {};
    const respond = (status, body) => {
      const res = new EventEmitter(); res.statusCode = status; callback(res);
      res.emit('data', Buffer.from(JSON.stringify(body))); res.emit('end');
    };
    req.end = data => {
      if (options.method === 'PUT') {
        const intent = JSON.parse(readFileSync(join(f.config.sessionsDirectory, f.request.operationId, 'hosted-owner-bootstrap-intent.json')));
        assert.equal(intent.phase, 'unknown'); assert.equal(intent.manifest_sha256, f.assignment.grant.manifest_sha256);
        assert.equal(intent.expires_at, f.assignment.policy.expires_at);
        assert.ok(JSON.parse(data).expire > 0 && JSON.parse(data).expire <= 62);
        respond(200, {});
      } else {
        assert.equal(options.method, 'GET', 'never delete or renew bootstrap hold');
        finishGet = (status = 200) => respond(status, { name: `hehe-bootstrap-${f.request.operationId}`, expires_at: f.assignment.policy.expires_at });
        gotReadback();
      }
    };
    return req;
  };
  return { request, requests, pending, finish: status => finishGet(status) };
}

async function listenerFixture(t, f, spriteRequest) {
  const token = 'w'.repeat(40), reports = [], counts = { reads: 0, launches: 0 };
  const configPath = join(f.root, 'manager.json'), wakeTokenFile = join(f.root, 'wake-token');
  await writeFile(configPath, JSON.stringify(f.config), { mode: 0o600 });
  await writeFile(wakeTokenFile, token, { mode: 0o600 });
  const start = async () => {
    const service = createHostedOwnerWakeService({ configPath, wakeTokenFile, port: 8080 }, {
      spriteRequest, control: f.control, readConfig: async (...args) => { counts.reads++; return readOwnerAlphaConfig(...args); },
      launch: async () => { counts.launches++; throw new Error('secret must not escape'); }, report: report => reports.push(report) });
    service.listen(0, '127.0.0.1'); await once(service, 'listening'); t.after(() => service.stop());
    return { service, origin: `http://127.0.0.1:${service.address().port}` };
  };
  const wake = (origin, signal) => fetch(`${origin}/wake`, { method: 'POST', signal, headers: { 'content-type': 'application/json',
    'x-hehe-wake-token': token }, body: JSON.stringify(f.request) });
  return { start, wake, counts, reports };
}

test('real Tasks client waits for GET before 202; concurrent duplicates share one hold and captured launch', async t => {
  const f = await fixture(t), tasks = heldTaskTransport(f);
  const { start, wake, counts, reports } = await listenerFixture(t, f, tasks.request);
  let { service, origin } = await start();
  assert.equal((await fetch(origin)).status, 404);
  assert.equal((await fetch(`${origin}/wake`, { method: 'POST' })).status, 401);
  assert.equal(counts.reads, 0); assert.deepEqual(f.calls, []); assert.deepEqual(tasks.requests, []);
  let replies = 0;
  const first = wake(origin).then(res => { replies++; return res; });
  await tasks.pending;
  const duplicate = wake(origin).then(res => { replies++; return res; });
  await new Promise(ok => setTimeout(ok, 30));
  assert.equal(replies, 0); assert.equal(counts.launches, 0);
  assert.deepEqual(await readdir(join(f.config.sessionsDirectory, f.request.operationId)), ['hosted-owner-bootstrap-intent.json']);
  assert.deepEqual(tasks.requests, ['PUT', 'GET']); assert.equal(f.calls.length, 1);
  tasks.finish();
  const responses = await Promise.all([first, duplicate]);
  assert.deepEqual(responses.map(res => res.status), [202, 202]);
  assert.deepEqual((await Promise.all(responses.map(res => res.json()))).map(body => body.duplicate), [false, true]);
  for (let n = 0; n < 100 && counts.launches < 1; n++) await new Promise(ok => setTimeout(ok, 10));
  assert.equal(counts.launches, 1); assert.equal(f.calls.length, 1);
  assert.equal((await wake(origin)).status, 202);
  service.stop(); ({ service, origin } = await start());
  assert.equal((await wake(origin)).status, 503);
  assert.equal(counts.launches, 1); assert.deepEqual(tasks.requests, ['PUT', 'GET']);
  assert.ok(!JSON.stringify(reports).includes('secret'));
});

test('failed GET leaves UNKNOWN and forbids 202, staging, DELETE and retry across reconstruction', async t => {
  const f = await fixture(t), tasks = heldTaskTransport(f);
  const { start, wake, counts } = await listenerFixture(t, f, tasks.request);
  let { service, origin } = await start();
  const first = wake(origin); await tasks.pending;
  const duplicate = wake(origin); tasks.finish(500);
  assert.deepEqual((await Promise.all([first, duplicate])).map(res => res.status), [503, 503]);
  service.stop(); ({ service, origin } = await start());
  assert.equal((await wake(origin)).status, 503);
  assert.deepEqual(tasks.requests, ['PUT', 'GET']); assert.equal(counts.launches, 0);
  assert.deepEqual(await readdir(join(f.config.sessionsDirectory, f.request.operationId)), ['hosted-owner-bootstrap-intent.json']);
});

test('preaccept disconnect and late readback cannot launch or retry', async t => {
  const f = await fixture(t), tasks = heldTaskTransport(f);
  const { start, wake, counts, reports } = await listenerFixture(t, f, tasks.request);
  const { origin } = await start(), controller = new AbortController();
  const first = wake(origin, controller.signal); const rejected = assert.rejects(first);
  await tasks.pending; controller.abort(); await rejected;
  for (let n = 0; n < 100 && reports.length < 1; n++) await new Promise(ok => setTimeout(ok, 10));
  tasks.finish();
  assert.equal((await wake(origin)).status, 503); assert.equal(counts.launches, 0);
  assert.deepEqual(tasks.requests, ['PUT', 'GET']);
});

test('bounded Unix GET timeout rejects late readback and keeps the durable bootstrap fence', async t => {
  const f = await fixture(t), tasks = heldTaskTransport(f);
  const { start, wake, counts } = await listenerFixture(t, f, tasks.request);
  let { service, origin } = await start();
  const started = Date.now(), first = wake(origin); await tasks.pending;
  assert.equal((await first).status, 503);
  assert.ok(Date.now() - started < 10000, 'request deadline stays below Worker timeout');
  tasks.finish();
  service.stop(); ({ service, origin } = await start());
  assert.equal((await wake(origin)).status, 503);
  assert.equal(counts.launches, 0); assert.deepEqual(tasks.requests, ['PUT', 'GET']);
});

test('aggregate hosted preparation timeout fences a manifest that completes after the HTTP refusal', async t => {
  const f = await fixture(t); let finish, manifestStarted;
  const pending = new Promise(ok => { manifestStarted = ok; });
  f.control = { request: () => { manifestStarted(); return new Promise(ok => { finish = ok; }); } };
  const { start, wake, counts } = await listenerFixture(t, f, () => assert.fail('late Task'));
  const { origin } = await start();
  const started = Date.now(), first = wake(origin); await pending;
  assert.equal((await first).status, 503);
  assert.ok(Date.now() - started < 14000, 'aggregate preparation must expire before Worker15s');
  finish(f.assignment); await new Promise(ok => setTimeout(ok, 20));
  assert.deepEqual(await readdir(f.config.sessionsDirectory), []);
  assert.equal(counts.launches, 0); assert.equal((await wake(origin)).status, 503);
});

test('null, invalid and expired manifests never issue a bootstrap Task', async t => {
  for (const kind of ['null', 'identity', 'expired']) {
    const f = await fixture(t);
    if (kind === 'null') f.control = { request: async () => null };
    if (kind === 'identity') f.assignment.grant.owner_binding_sha256 = 'ef'.repeat(32);
    if (kind === 'expired') expiredForInspection(f);
    const { start, wake, counts } = await listenerFixture(t, f, () => assert.fail('Task requested'));
    const { origin } = await start(); assert.equal((await wake(origin)).status, 503);
    assert.equal(counts.launches, 0); assert.deepEqual(await readdir(f.config.sessionsDirectory), []);
  }
});

test('prepared assignment is captured once and continuation is single-use', async t => {
  const f = await fixture(t); let launches = 0;
  const resume = await prepareHostedOwnerManager(f.config, f.request, { control: f.control, launch: async path => {
    launches++;
    const { config } = await readOwnerAlphaConfig(path);
    assert.equal(config.ownerAlpha.session_id, id(1));
    assert.equal(config.ownerAlphaGeneration.boot_id, id(5));
    throw new Error('synthetic launch stop');
  } });
  f.assignment.policy.session_id = id(20); f.assignment.grant.boot_id = id(21);
  await assert.rejects(resume()); await assert.rejects(resume());
  assert.equal(launches, 1); assert.equal(f.calls.length, 1);
});
