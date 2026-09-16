import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareOwnerAlphaSession, serveOwnerAlphaSession } from '../runtime/owner-alpha-session.mjs';

const at = Date.parse('2026-09-16T15:00:00.000Z');
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'hehe-session-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const stateDirectory = join(dir, 'session'), nativeHome = join(dir, 'native');
  await mkdir(stateDirectory, { mode: 0o700 }); await mkdir(nativeHome, { mode: 0o700 });
  return { stateDirectory, nativeHome, model: 'fixture-model', personaId: '11111111-1111-4111-8111-111111111111',
    publicOrigin: 'https://owner.example', port: 19876, sessionSeconds: 73, maxRuns: 2, maxTaskSeconds: 41 };
}

test('fresh session captures distinct private tokens and bounded readback without touching native auth/config', async t => {
  const input = await fixture(t), before = 'cli_auth_credentials_store = "keyring"\n';
  await writeFile(join(input.nativeHome, 'config.toml'), before, { mode: 0o600 });
  const session = await prepareOwnerAlphaSession(input, { now: () => at });
  input.model = 'changed';
  assert.equal(session.model, 'fixture-model');
  assert.equal(session.ownerAlpha.expires_at, '2026-09-16T15:01:13.000Z');
  assert.equal(session.accessExpiresAt, '2026-09-16T15:16:13.000Z');
  assert.equal(session.ownerAlpha.max_runs, 2); assert.equal(session.ownerAlpha.max_task_seconds, 41);
  assert.equal(Object.hasOwn(session.ownerAlpha, 'background_first_root'), false);
  const owner = await readFile(session.ownerTokenFile, 'utf8'), runtime = await readFile(session.runtimeTokenFile, 'utf8');
  assert.match(owner, /^[A-Za-z0-9_-]{43}$/); assert.match(runtime, /^[a-f0-9]{64}$/); assert.notEqual(owner, runtime);
  for (const path of [session.ownerTokenFile, session.runtimeTokenFile, join(session.stateDirectory, 'session-policy.json')])
    assert.equal((await lstat(path)).mode & 0o777, 0o600);
  assert.equal((await lstat(session.runtimeDirectory)).mode & 0o777, 0o700);
  assert.equal(await readFile(join(input.nativeHome, 'config.toml'), 'utf8'), before);
  assert.deepEqual(await readdir(input.nativeHome), ['config.toml']);
  assert.equal((await readdir(session.runtimeDirectory)).length, 0);
  await assert.rejects(prepareOwnerAlphaSession(input, { now: () => at }), { code: 'FRESH_SESSION_DIRECTORY_REQUIRED' });
  assert.equal(await readFile(session.ownerTokenFile, 'utf8'), owner);
});

test('explicit background opt-in persists exact bounded policy without changing native home', async t => {
  const input = await fixture(t);
  const session = await prepareOwnerAlphaSession({ ...input, backgroundFirstRoot: true }, { now: () => at });
  const saved = JSON.parse(await readFile(join(input.stateDirectory, 'session-policy.json'), 'utf8'));
  assert.deepEqual(saved.ownerAlpha, session.ownerAlpha);
  assert.equal(session.ownerAlpha.background_first_root, true);
  assert.equal(session.ownerAlpha.max_runs, 2);
  assert.equal(session.ownerAlpha.expires_at, '2026-09-16T15:01:13.000Z');
  assert.deepEqual(await readdir(input.nativeHome), []);
});

test('invalid origin, bounds and extra fields refuse before creating session custody', async t => {
  const config = await fixture(t);
  for (const change of [{ publicOrigin: 'http://owner.example' }, { publicOrigin: 'https://owner.example/' },
    { publicOrigin: 'https://user:secret@owner.example' }, { publicOrigin: 'https://owner.example/path' },
    { publicOrigin: 'https://owner.example?x=1' }, { port: 0 }, { port: '19876' }, { port: 65536 },
    { sessionSeconds: 29 }, { sessionSeconds: 301 }, { maxRuns: 4 }, { maxTaskSeconds: 301 },
    { model: 'model with spaces' }, { personaId: 'wrong' }, { disposableTest: true },
    ...[false, null, 1, 'true', undefined].map(backgroundFirstRoot => ({ backgroundFirstRoot }))]) {
    await assert.rejects(prepareOwnerAlphaSession({ ...config, ...change }, { now: () => at }));
    assert.deepEqual(await readdir(config.stateDirectory), []);
  }
});

test('private directories and disjoint native home are required; old state is never adopted', async t => {
  const config = await fixture(t);
  await chmod(config.nativeHome, 0o755);
  await assert.rejects(prepareOwnerAlphaSession(config), { code: 'PRIVATE_PATH_REQUIRED' });
  await chmod(config.nativeHome, 0o700);
  await assert.rejects(prepareOwnerAlphaSession({ ...config, nativeHome: config.stateDirectory }), { code: 'SEPARATE_NATIVE_HOME_REQUIRED' });
  const nested = join(config.nativeHome, 'nested'); await mkdir(nested, { mode: 0o700 });
  await assert.rejects(prepareOwnerAlphaSession({ ...config, stateDirectory: nested }), { code: 'SEPARATE_NATIVE_HOME_REQUIRED' });
  const link = config.nativeHome + '-link'; await symlink(config.nativeHome, link);
  await assert.rejects(prepareOwnerAlphaSession({ ...config, nativeHome: link }), { code: 'PRIVATE_PATH_REQUIRED' });
  await writeFile(join(config.stateDirectory, 'old-state'), 'retained');
  await assert.rejects(prepareOwnerAlphaSession(config), { code: 'FRESH_SESSION_DIRECTORY_REQUIRED' });
  assert.equal(await readFile(join(config.stateDirectory, 'old-state'), 'utf8'), 'retained');
});

test('concurrent preparation admits one winner, not two independent session quotas', async t => {
  const input = await fixture(t);
  const results = await Promise.allSettled([prepareOwnerAlphaSession(input), prepareOwnerAlphaSession(input)]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(results.filter(x => x.status === 'rejected').length, 1);
  const saved = JSON.parse(await readFile(join(input.stateDirectory, 'session-policy.json')));
  assert.equal(saved.ownerAlpha.session_id, results.find(x => x.status === 'fulfilled').value.ownerAlpha.session_id);
});

test('pre-aborted launch creates no custody, worker, model runtime or gateway', async t => {
  const input = await fixture(t);
  await assert.rejects(serveOwnerAlphaSession(input, { signal: AbortSignal.abort(), report: () => assert.fail('no process report') }), { code: 'SESSION_STOPPED' });
  assert.deepEqual(await readdir(input.stateDirectory), []);
});
