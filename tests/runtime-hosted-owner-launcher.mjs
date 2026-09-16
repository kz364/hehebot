import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launchHostedOwnerAlpha } from '../runtime/hosted-owner-launcher.mjs';
import { readOwnerAlphaConfig } from '../runtime/owner-alpha-entry.mjs';

const lockScript = resolve('scripts/with-executor-lock.sh');
const entry = resolve('runtime/owner-alpha-entry.mjs');
const persona = '11111111-1111-4111-8111-111111111111';
const policy = { session_id: 'aaaaaaaa-1111-4111-8111-111111111111', persona_id: persona,
  expires_at: '2099-09-16T10:01:00.000Z', max_runs: 1, max_task_seconds: 30 };

async function sandbox(t) {
  const root = await mkdtemp(join(tmpdir(), 'hehe-hosted-launch-'));
  const children = new Set();
  t.after(async () => {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await Promise.all([...children].map(child => child.exitCode === null && child.signalCode === null
      ? once(child, 'exit').catch(() => {}) : undefined));
    await rm(root, { recursive: true, force: true });
  });
  const trackedSpawn = (...args) => {
    const child = spawn(...args); children.add(child);
    child.once('exit', () => children.delete(child));
    return child;
  };
  return { root, trackedSpawn };
}

async function setupConfig(t) {
  const { root, trackedSpawn } = await sandbox(t);
  const nativeHome = join(root, 'native-home'), stateDirectory = join(root, 'session');
  await mkdir(nativeHome, { mode: 0o700 }); await mkdir(stateDirectory, { mode: 0o700 });
  const config = { nativeHome, stateDirectory, hostedOwnerBindingSha256: '19'.repeat(32),
    ownerAlpha: policy, personas: { [persona]: { model: 'synthetic' } } };
  const path = join(root, 'owner.json'), bytes = JSON.stringify(config);
  await writeFile(path, bytes, { mode: 0o600 });
  return { root, trackedSpawn, nativeHome, stateDirectory, config, path, bytes };
}

function holder(spawnImpl, directory) {
  return spawnImpl('bash', [lockScript, directory, process.execPath, '-e',
    "process.stdout.write('ready');setInterval(()=>{},1000)"], { stdio: ['ignore', 'pipe', 'pipe'] });
}

async function ready(child) {
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
  try { await once(child.stdout, 'data'); } finally { clearTimeout(timeout); }
}

function injectedFixture(f, fixture, extra = [], inspect = () => {}) {
  let calls = 0;
  return {
    spawnImpl(command, argv, options) {
      calls++;
      const digest = createHash('sha256').update(f.bytes).digest('hex');
      assert.equal(command, 'bash');
      assert.deepEqual(argv, [lockScript, f.nativeHome, 'bash', lockScript, f.stateDirectory,
        process.execPath, entry, '--run-hosted-locked', f.path, digest]);
      assert.deepEqual(options, { stdio: 'inherit' });
      inspect(argv);
      return f.trackedSpawn(command, argv.slice(0, 5).concat(process.execPath, fixture,
        f.nativeHome, f.stateDirectory, ...extra), options);
    },
    get calls() { return calls; },
  };
}

test('native-home first and session second locks exclude fixture entry; release permits a fixture holding both',
  { timeout: 30000 }, async t => {
    const f = await setupConfig(t);
    const marker = join(f.root, 'entered');
    const report = join(f.root, 'lock-report');
    const fixture = join(f.root, 'fixture.mjs');
    await writeFile(fixture, `
      import { spawn } from 'node:child_process';
      import { once } from 'node:events';
      import { writeFile } from 'node:fs/promises';
      const [home, state, marker, report, script] = process.argv.slice(2);
      await writeFile(marker, 'entered');
      const results = [];
      for (const directory of [home, state]) {
        const child = spawn('bash', [script, directory, process.execPath, '-e', 'process.exit(0)']);
        results.push((await once(child, 'exit'))[0]);
      }
      await writeFile(report, JSON.stringify(results));
    `, { mode: 0o600 });
    const injected = injectedFixture(f, fixture, [marker, report, lockScript]);

    for (const locked of [f.nativeHome, f.stateDirectory]) {
      const held = holder(f.trackedSpawn, locked); await ready(held);
      assert.deepEqual(await launchHostedOwnerAlpha(f.path, { spawnImpl: injected.spawnImpl.bind(injected) }),
        { code: 73, signal: null });
      await assert.rejects(readFile(marker), { code: 'ENOENT' });
      const exited = once(held, 'exit'); held.kill('SIGTERM'); await exited;
    }

    assert.deepEqual(await launchHostedOwnerAlpha(f.path, { spawnImpl: injected.spawnImpl.bind(injected) }),
      { code: 0, signal: null });
    assert.equal(await readFile(marker, 'utf8'), 'entered');
    assert.deepEqual(JSON.parse(await readFile(report, 'utf8')), [73, 73]);
    assert.equal(injected.calls, 3);
    for (const directory of [f.nativeHome, f.stateDirectory]) {
      const contender = spawn('bash', [lockScript, directory, process.execPath, '-e', 'process.exit(0)']);
      assert.equal((await once(contender, 'exit'))[0], 0);
    }
    await assert.rejects(lstat(join(f.stateDirectory, 'journal')), { code: 'ENOENT' });
    await assert.rejects(lstat(join(f.stateDirectory, 'workspace')), { code: 'ENOENT' });
  });

test('abort is forwarded once to the exact exec-preserved child and is not retried', { timeout: 15000 }, async t => {
  const f = await setupConfig(t), fixture = join(f.root, 'abort.mjs');
  const readyPath = join(f.root, 'ready'), stoppedPath = join(f.root, 'stopped');
  await writeFile(fixture, `
    import { writeFileSync } from 'node:fs';
    const [ready, stopped] = process.argv.slice(-2);
    writeFileSync(ready, String(process.pid));
    process.on('SIGTERM', () => { writeFileSync(stopped, String(process.pid)); process.exit(0); });
    setTimeout(() => process.exit(92), 10000);
  `, { mode: 0o600 });
  let launched;
  const injected = injectedFixture(f, fixture, [readyPath, stoppedPath], () => {});
  const spawnImpl = (...args) => { launched = injected.spawnImpl(...args); return launched; };
  const controller = new AbortController();
  const result = launchHostedOwnerAlpha(f.path, { signal: controller.signal, spawnImpl });
  for (let end = Date.now() + 5000;;) {
    try { await readFile(readyPath); break; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    assert.ok(Date.now() < end, 'fixture startup bounded'); await new Promise(r => setTimeout(r, 10));
  }
  const exactPid = String(launched.pid);
  assert.equal(await readFile(readyPath, 'utf8'), exactPid);
  controller.abort();
  assert.deepEqual(await result, { code: 0, signal: null });
  assert.equal(await readFile(stoppedPath, 'utf8'), exactPid);
  assert.equal(injected.calls, 1);
});

test('pre-abort, private paths, symlinks and same-inode directories are rejected without spawn or reset',
  { timeout: 15000 }, async t => {
    const f = await setupConfig(t), sentinel = join(f.stateDirectory, 'retained');
    await writeFile(sentinel, 'custody', { mode: 0o600 });
    let spawns = 0;
    const noSpawn = () => { spawns++; assert.fail('must not spawn'); };
    const controller = new AbortController(); controller.abort();
    await assert.rejects(launchHostedOwnerAlpha(f.path, { signal: controller.signal, spawnImpl: noSpawn }),
      /HOSTED_OWNER_LAUNCH_REFUSED/);

    const badFile = join(f.root, 'public.json'); await writeFile(badFile, f.bytes, { mode: 0o644 });
    await assert.rejects(readOwnerAlphaConfig(badFile), { code: 'PRIVATE_PATH_REQUIRED' });
    const fileLink = join(f.root, 'config-link'); await symlink(f.path, fileLink);
    await assert.rejects(readOwnerAlphaConfig(fileLink), { code: 'PRIVATE_PATH_REQUIRED' });

    const publicDirectory = join(f.root, 'public-dir'); await mkdir(publicDirectory, { mode: 0o755 });
    for (const config of [
      { ...f.config, nativeHome: publicDirectory },
      { ...f.config, nativeHome: f.path },
      { ...f.config, stateDirectory: f.nativeHome },
    ]) {
      const path = join(f.root, `bad-${Math.random()}.json`);
      await writeFile(path, JSON.stringify(config), { mode: 0o600 });
      await assert.rejects(launchHostedOwnerAlpha(path, { spawnImpl: noSpawn }), /HOSTED_OWNER_LAUNCH_REFUSED/);
    }
    const directoryLink = join(f.root, 'directory-link'); await symlink(f.nativeHome, directoryLink);
    const linked = join(f.root, 'linked.json');
    await writeFile(linked, JSON.stringify({ ...f.config, nativeHome: directoryLink }), { mode: 0o600 });
    await assert.rejects(launchHostedOwnerAlpha(linked, { spawnImpl: noSpawn }), /HOSTED_OWNER_LAUNCH_REFUSED/);
    assert.equal(spawns, 0); assert.equal(await readFile(sentinel, 'utf8'), 'custody');
    await assert.rejects(lstat(join(f.stateDirectory, 'journal')), { code: 'ENOENT' });
  });

test('locked child rejects config changed after parent digest capture before state or account work',
  { timeout: 15000 }, async t => {
    const f = await setupConfig(t), sentinel = join(f.stateDirectory, 'retained');
    await writeFile(sentinel, 'custody', { mode: 0o600 });
    const injected = {
      spawnImpl(command, argv, options) {
        assert.equal(argv.at(-1), createHash('sha256').update(f.bytes).digest('hex'));
        // Synchronous spawn interception is the boundary between parent capture and locked child read.
        requireWriteChangedConfig(f.path, f.config);
        return f.trackedSpawn(command, argv, options);
      },
    };
    function requireWriteChangedConfig(path, config) {
      // Keep this synchronous so the real child cannot race the deliberate replacement.
      const { writeFileSync } = process.getBuiltinModule('node:fs');
      writeFileSync(path, JSON.stringify({ ...config, harmlessChangedField: true }), { mode: 0o600 });
    }
    assert.deepEqual(await launchHostedOwnerAlpha(f.path, { spawnImpl: injected.spawnImpl.bind(injected) }),
      { code: 1, signal: null });
    assert.equal(await readFile(sentinel, 'utf8'), 'custody');
    await assert.rejects(lstat(join(f.stateDirectory, 'journal')), { code: 'ENOENT' });
    await assert.rejects(lstat(join(f.stateDirectory, 'workspace')), { code: 'ENOENT' });
  });
