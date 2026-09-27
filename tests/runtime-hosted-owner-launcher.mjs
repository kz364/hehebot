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

test('private configuration accepts a genuine-sized catalog and bounds bytes at 128 KiB', async t => {
  const { root } = await sandbox(t), path = join(root, 'bounded.json');
  for (const size of [42750, 128 * 1024, 128 * 1024 + 1]) {
    const bytes = JSON.stringify({ catalog: 'x'.repeat(size - 14) });
    assert.equal(Buffer.byteLength(bytes), size);
    await writeFile(path, bytes, { mode: 0o600 });
    if (size > 128 * 1024) await assert.rejects(readOwnerAlphaConfig(path), { code: 'PRIVATE_PATH_REQUIRED' });
    else assert.equal((await readOwnerAlphaConfig(path)).config.catalog.length, size - 14);
  }
});

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
      const verifyIndex = argv.indexOf('-c');
      assert.ok(verifyIndex > 5 && argv[verifyIndex - 1] === 'bash',
        'launcher must install a bash -c verified exec after the capability drop');
      const verifyScript = argv[verifyIndex + 1];
      assert.ok(typeof verifyScript === 'string' && verifyScript.includes('/proc/self/status')
        && verifyScript.includes('exec "$@"') && verifyScript.includes('exit 91'),
        'verified exec must read back /proc/self/status and refuse on mismatch');
      assert.deepEqual([...argv.slice(0, verifyIndex - 1), 'bash', '-c', verifyScript, ...argv.slice(verifyIndex + 2)],
        [lockScript, f.nativeHome, 'bash', lockScript, f.stateDirectory,
          'setpriv', '--bounding-set=-all', '--inh-caps=-all', '--ambient-caps=-all', '--no-new-privs', '--',
          'bash', '-c', verifyScript, 'verify-launch-boundary',
          process.execPath, entry, '--run-hosted-locked', f.path, digest]);
      assert.deepEqual(options, { stdio: 'inherit' });
      inspect(argv);
      // The lock test exercises lock semantics, not the boundary; run the real
      // locks and the setpriv drop attempt, then the fixture instead of the
      // verified exec (which would refuse an unprivileged harness).
      return f.trackedSpawn(command, argv.slice(0, verifyIndex - 1).concat(process.execPath, fixture,
        f.nativeHome, f.stateDirectory, ...extra), options);
    },
    get calls() { return calls; },
  };
}

// G3 (GROK_ALIGNMENT A2): CHANGED from the pre-G3 "a contended lock simply
// refuses (exit 73) and the launch never runs the fixture" expectation. A
// contended native-home or session lock is no longer refused: the launcher
// kills the live holder's process group and takes over within its retry
// budget, so the launch always completes (exit 0) once the prior holder is
// reclaimed, rather than being excluded by it.
test('native-home first and session second locks are reclaimed from a live holder and the launch completes',
  { timeout: 30000 }, async t => {
    const f = await setupConfig(t);
    const marker = join(f.root, 'entered');
    const report = join(f.root, 'lock-report');
    const fixture = join(f.root, 'fixture.mjs');
    await writeFile(fixture, `
      import { spawn } from 'node:child_process';
      import { once } from 'node:events';
      import { writeFile, readFile } from 'node:fs/promises';
      const [home, state, marker, report] = process.argv.slice(2);
      await writeFile(marker, 'entered');
      const results = [];
      // Non-destructive probes: a raw flock, not the with-executor-lock.sh
      // takeover wrapper. This process IS the exec chain that already holds
      // both locks, so going through the wrapper here would see its own
      // ancestor as the live holder and (correctly, for a genuine external
      // contender) kill it -- which would be self-destructive in this
      // self-referential check. A plain nonblocking flock proves the same
      // exclusivity without that hazard.
      for (const directory of [home, state]) {
        const child = spawn('flock', ['--nonblock', '--conflict-exit-code', '73', directory, process.execPath, '-e', 'process.exit(0)']);
        results.push((await once(child, 'exit'))[0]);
      }
      const status = await readFile('/proc/self/status', 'utf8');
      await writeFile(report, JSON.stringify({ results, status }));
    `, { mode: 0o600 });
    const injected = injectedFixture(f, fixture, [marker, report]);

    for (const locked of [f.nativeHome, f.stateDirectory]) {
      const held = holder(f.trackedSpawn, locked); await ready(held);
      // Registered before any lock contention: the launch below kills this
      // holder as part of takeover, so the 'exit' listener must be armed
      // before that can happen or the event is missed and this hangs.
      const heldExited = once(held, 'exit');
      assert.deepEqual(await launchHostedOwnerAlpha(f.path, { spawnImpl: injected.spawnImpl.bind(injected) }),
        { code: 0, signal: null });
      const [, heldSignal] = await heldExited;
      assert.ok(typeof heldSignal === 'string' && heldSignal.startsWith('SIG'),
        'the live holder must be genuinely killed by takeover, not merely outlast a refusal');
      assert.equal(await readFile(marker, 'utf8'), 'entered');
      const observed = JSON.parse(await readFile(report, 'utf8'));
      assert.deepEqual(observed.results, [73, 73]);
      await rm(marker, { force: true }); await rm(report, { force: true });
    }

    assert.deepEqual(await launchHostedOwnerAlpha(f.path, { spawnImpl: injected.spawnImpl.bind(injected) }),
      { code: 0, signal: null });
    assert.equal(await readFile(marker, 'utf8'), 'entered');
    const observed = JSON.parse(await readFile(report, 'utf8'));
    assert.deepEqual(observed.results, [73, 73]);
    for (const field of ['CapInh', 'CapPrm', 'CapEff', 'CapAmb']) assert.match(observed.status, new RegExp(`^${field}:\\s+0+$`, 'm'));
    assert.match(observed.status, /^NoNewPrivs:\s+1$/m);
    assert.equal(injected.calls, 3);
    for (const directory of [f.nativeHome, f.stateDirectory]) {
      const contender = spawn('bash', [lockScript, directory, process.execPath, '-e', 'process.exit(0)']);
      assert.equal((await once(contender, 'exit'))[0], 0);
    }
    await assert.rejects(lstat(join(f.stateDirectory, 'journal')), { code: 'ENOENT' });
    await assert.rejects(lstat(join(f.stateDirectory, 'workspace')), { code: 'ENOENT' });
  });

test('capability-drop refusal preserves custody and never falls back or retries entry', async t => {
  const f = await setupConfig(t), refusal = join(f.root, 'refuse-setpriv');
  await writeFile(refusal, '#!/bin/sh\nexit 77\n', { mode: 0o700 });
  let calls = 0;
  const result = await launchHostedOwnerAlpha(f.path, { spawnImpl(command, argv, options) {
    calls++;
    assert.equal(argv[5], 'setpriv');
    return f.trackedSpawn(command, [...argv.slice(0, 5), refusal, ...argv.slice(6)], options);
  } });
  assert.deepEqual(result, { code: 77, signal: null });
  assert.equal(calls, 1);
  assert.equal(await readFile(f.path, 'utf8'), f.bytes);
  await assert.rejects(lstat(join(f.stateDirectory, 'journal')), { code: 'ENOENT' });
  await assert.rejects(lstat(join(f.stateDirectory, 'workspace')), { code: 'ENOENT' });
});

const statusReadbackFixture = `
  import { readFile } from 'node:fs/promises';
  const fields = {};
  for (const line of (await readFile('/proc/self/status', 'utf8')).split('\\n')) {
    const match = /^(Uid|CapInh|CapPrm|CapEff|CapBnd|CapAmb|NoNewPrivs):\\t(.*)$/.exec(line);
    if (match) fields[match[1]] = match[2].trim();
  }
  console.log(JSON.stringify({ uid: process.getuid(), euid: process.geteuid(), ...fields }));
`;

test('unverified boundary refuses launch instead of running the entry with capabilities', { timeout: 30000 }, async t => {
  const f = await setupConfig(t), fixture = join(f.root, 'ran.mjs');
  await writeFile(fixture, statusReadbackFixture, { mode: 0o600 });
  assert.ok(process.getuid() !== 0, 'regression evidence requires an unprivileged harness');
  let stdout = '', calls = 0;
  const result = await launchHostedOwnerAlpha(f.path, { spawnImpl(command, argv, options) {
    calls++;
    assert.equal(argv[5], 'setpriv');
    // Real locks, real drop attempt, real verified exec; only the entry is a
    // status readback so the refusal is observable.
    const child = f.trackedSpawn(command, argv.slice(0, argv.indexOf(process.execPath)).concat(process.execPath, fixture),
      { ...options, stdio: ['ignore', 'pipe', 'inherit'] });
    child.stdout.on('data', data => { stdout += data; });
    return child;
  } });
  assert.deepEqual(result, { code: 91, signal: null });
  assert.equal(stdout, '');
  assert.equal(calls, 1);
  assert.equal(await readFile(f.path, 'utf8'), f.bytes);
  await assert.rejects(lstat(join(f.stateDirectory, 'journal')), { code: 'ENOENT' });
  await assert.rejects(lstat(join(f.stateDirectory, 'workspace')), { code: 'ENOENT' });
});

test('verified exec admits only a zero-capability non-root boundary before running the entry', { timeout: 30000 }, async t => {
  const f = await setupConfig(t), fixture = join(f.root, 'status.mjs');
  await writeFile(fixture, statusReadbackFixture, { mode: 0o600 });
  assert.ok(process.getuid() !== 0, 'boundary evidence requires a non-root harness');
  let stdout = '', calls = 0;
  const result = await launchHostedOwnerAlpha(f.path, { spawnImpl(command, argv, options) {
    calls++;
    const verifyIndex = argv.indexOf('-c');
    assert.ok(verifyIndex > 5, 'launcher must install a bash -c verified exec boundary');
    const entryIndex = argv.indexOf(process.execPath);
    assert.ok(entryIndex > verifyIndex, 'verified exec must precede the entry');
    // Reproduce the supported drop inside a private identity-mapped user
    // namespace: the only unprivileged environment where the kernel permits
    // the bounding-set drop the verified exec demands.
    const child = f.trackedSpawn('unshare', ['--map-current-user', '--keep-caps',
      ...argv.slice(5, entryIndex), process.execPath, fixture, f.path],
      { ...options, stdio: ['ignore', 'pipe', 'inherit'] });
    child.stdout.on('data', data => { stdout += data; });
    return child;
  } });
  assert.deepEqual(result, { code: 0, signal: null });
  assert.equal(calls, 1);
  const observed = JSON.parse(stdout);
  const uid = process.getuid();
  assert.equal(observed.uid, uid); assert.equal(observed.euid, uid);
  assert.equal(observed.Uid, [uid, uid, uid, uid].join('\t'));
  for (const field of ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']) {
    assert.equal(observed[field], '0000000000000000', field);
  }
  assert.equal(observed.NoNewPrivs, '1');
});

test('verified exec refuses a silently ignored capability drop without running the entry', { timeout: 30000 }, async t => {
  const f = await setupConfig(t), fixture = join(f.root, 'ran.mjs');
  await writeFile(fixture, statusReadbackFixture, { mode: 0o600 });
  assert.ok(process.getuid() !== 0, 'refusal evidence requires an unprivileged harness');
  let stdout = '', calls = 0;
  const result = await launchHostedOwnerAlpha(f.path, { spawnImpl(command, argv, options) {
    calls++;
    const verifyIndex = argv.indexOf('-c');
    assert.ok(verifyIndex > 5, 'launcher must install a bash -c verified exec boundary');
    const entryIndex = argv.indexOf(process.execPath);
    // Without --keep-caps the namespace grants are dropped before setpriv,
    // whose bounding-set drop Debian libcap-ng then silently ignores: the
    // exact regression class the verified exec must catch.
    const child = f.trackedSpawn('unshare', ['--map-current-user',
      ...argv.slice(5, entryIndex), process.execPath, fixture, f.path],
      { ...options, stdio: ['ignore', 'pipe', 'inherit'] });
    child.stdout.on('data', data => { stdout += data; });
    return child;
  } });
  assert.deepEqual(result, { code: 91, signal: null });
  assert.equal(stdout, '');
  assert.equal(calls, 1);
  assert.equal(await readFile(f.path, 'utf8'), f.bytes);
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
    await assert.rejects(launchHostedOwnerAlpha(f.path, { expectedSha256: '00'.repeat(32), spawnImpl: noSpawn }),
      { code: 'OWNER_ALPHA_CONFIG_CHANGED' });
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
        // Reproduce the supported drop in a private identity-mapped user
        // namespace so the verified exec admits the chain and the locked
        // child itself can be observed refusing the changed digest.
        return f.trackedSpawn('unshare', ['--map-current-user', '--keep-caps', ...argv.slice(5)], options);
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
