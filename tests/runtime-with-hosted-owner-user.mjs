import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const bootstrap = resolve('scripts/with-hosted-owner-user.sh');
const launcherModule = resolve('runtime/hosted-owner-launcher.mjs');
const harnessUid = process.getuid();
const harnessGid = process.getgid();
const sudoReady = process.getuid() !== 0 && spawnSync('sudo', ['-n', 'true'], { encoding: 'utf8' }).status === 0;

/** Runs argv as the real root caller. When the harness itself is unprivileged,
 * passwordless sudo provides the root caller inside a disposable context. */
function privilegedSync(argv) {
  if (process.getuid() === 0) return spawnSync(argv[0], argv.slice(1), { encoding: 'utf8' });
  if (!sudoReady) return null;
  return spawnSync('sudo', ['-n', ...argv], { encoding: 'utf8' });
}

async function scratch(t, prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

const readbackFixture = `
  import { readFile } from 'node:fs/promises';
  import { statSync } from 'node:fs';
  const fields = {};
  for (const line of (await readFile('/proc/self/status', 'utf8')).split('\\n')) {
    const match = /^(Uid|CapInh|CapPrm|CapEff|CapBnd|CapAmb|NoNewPrivs):\\t(.*)$/.exec(line);
    if (match) fields[match[1]] = match[2].trim();
  }
  console.log(JSON.stringify({ uid: process.getuid(), euid: process.geteuid(), gid: process.getgid(),
    uidMap: (await readFile('/proc/self/uid_map', 'utf8')).trim(),
    rootUid: statSync('/').uid, argv: process.argv.slice(2), ...fields }));
`;

function assertZeroBoundary(observed, uid) {
  assert.equal(observed.uid, uid);
  assert.equal(observed.euid, uid);
  assert.equal(observed.gid, harnessGid);
  assert.equal(observed.Uid, [uid, uid, uid, uid].join('\t'));
  for (const field of ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']) {
    assert.equal(observed[field], '0000000000000000', field);
  }
  assert.equal(observed.NoNewPrivs, '1');
}

test('bootstrap refuses a non-root caller without running the command', async t => {
  if (harnessUid === 0) return t.skip('harness is root; non-root refusal not observable here');
  const root = await scratch(t, 'bootstrap-nonroot-');
  const marker = join(root, 'ran');
  const result = spawnSync('bash', [bootstrap, '1000', '1000', '--', process.execPath, '-e',
    `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`], { encoding: 'utf8' });
  assert.equal(result.status, 64);
  assert.match(result.stderr, /caller must be root/);
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
});

test('bootstrap fails closed on invalid identity arguments without running the command', async t => {
  const root = await scratch(t, 'bootstrap-args-');
  const marker = join(root, 'ran');
  const command = [process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')` ];
  for (const args of [
    ['0', '1000', '--', ...command],
    ['1000', '0', '--', ...command],
    ['abc', '1000', '--', ...command],
    ['1000', 'abc', '--', ...command],
    ['-1', '1000', '--', ...command],
    ['007', '1000', '--', ...command],
    ['4294967295', '1000', '--', ...command],
    ['18446744073709551617', '1000', '--', ...command],
    ['1000', '18446744073709551617', '--', ...command],
    ['1000', '1000', ...command],
    ['1000', '1000', '--'],
  ]) {
    const result = privilegedSync(['bash', bootstrap, ...args]);
    if (!result) return t.skip('passwordless sudo or a root harness is required for argument validation');
    assert.equal(result.status, 64, JSON.stringify(args));
    assert.equal(result.stdout, '');
    await assert.rejects(readFile(marker), { code: 'ENOENT' });
  }
});

test('bootstrap drops a real root caller to the owner with zero capability masks in the same namespace', async t => {
  const root = await scratch(t, 'bootstrap-transition-');
  const fixture = join(root, 'status.mjs');
  await writeFile(fixture, readbackFixture, { mode: 0o600 });
  const result = privilegedSync(['bash', bootstrap, String(harnessUid), String(harnessGid), '--',
    process.execPath, fixture, 'passthrough-arg']);
  if (!result) return t.skip('passwordless sudo or a root harness is required for the root-to-owner transition');
  assert.equal(result.status, 0);
  assert.notEqual(harnessUid, 0);
  const observed = JSON.parse(result.stdout);
  assertZeroBoundary(observed, harnessUid);
  // Same (initial) user namespace: the root-managed floor keeps authentic ownership.
  assert.deepEqual(observed.uidMap.trim().split(/\s+/).map(Number), [0, 0, 4294967295]);
  assert.equal(observed.rootUid, 0);
  assert.deepEqual(observed.argv, ['passthrough-arg']);
});

test('bootstrap refuses a silently ignored drop instead of running the command as root', async t => {
  const root = await scratch(t, 'bootstrap-silent-');
  const stub = join(root, 'setpriv-stub');
  await writeFile(stub, '#!/bin/sh\nwhile [ "$1" != "--" ]; do shift; done\nshift\nexec "$@"\n', { mode: 0o755 });
  const inner = join(root, 'inner.sh');
  await writeFile(inner, `mount --bind ${stub} /usr/bin/setpriv
exec bash ${bootstrap} ${harnessUid} ${harnessGid} -- bash -c 'echo RAN'`);
  const result = privilegedSync(['unshare', '--mount', '--propagation', 'private', 'bash', inner]);
  if (!result) return t.skip('passwordless sudo or a root harness is required for the silent-drop refusal');
  assert.equal(result.status, 91);
  assert.equal(result.stdout, '');
});

test('bootstrap propagates a hard drop failure without running the command', async t => {
  const root = await scratch(t, 'bootstrap-hard-');
  const stub = join(root, 'setpriv-stub');
  await writeFile(stub, '#!/bin/sh\nexit 77\n', { mode: 0o755 });
  const inner = join(root, 'inner.sh');
  await writeFile(inner, `mount --bind ${stub} /usr/bin/setpriv
exec bash ${bootstrap} ${harnessUid} ${harnessGid} -- bash -c 'echo RAN'`);
  const result = privilegedSync(['unshare', '--mount', '--propagation', 'private', 'bash', inner]);
  if (!result) return t.skip('passwordless sudo or a root harness is required for the hard-failure propagation');
  assert.equal(result.status, 77);
  assert.equal(result.stdout, '');
});

test('bootstrap fails closed when a trusted system executable is missing', async t => {
  const root = await scratch(t, 'bootstrap-missing-');
  const blank = join(root, 'not-awk');
  await writeFile(blank, '', { mode: 0o644 });
  const inner = join(root, 'inner.sh');
  await writeFile(inner, `mount --bind ${blank} /usr/bin/awk
exec bash ${bootstrap} ${harnessUid} ${harnessGid} -- bash -c 'echo RAN'`);
  const result = privilegedSync(['unshare', '--mount', '--propagation', 'private', 'bash', inner]);
  if (!result) return t.skip('passwordless sudo or a root harness is required for the missing-executable refusal');
  assert.equal(result.status, 64);
  assert.equal(result.stdout, '');
});

test('bootstrap composes with the real launcher verified exec from a real root caller', { timeout: 30000 }, async t => {
  const root = await scratch(t, 'bootstrap-compose-');
  const fixture = join(root, 'status.mjs');
  await writeFile(fixture, readbackFixture, { mode: 0o600 });
  const inner = join(root, 'inner-launcher.mjs');
  await writeFile(inner, `
    import { spawn } from 'node:child_process';
    import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
    import { dirname, join } from 'node:path';
    import { pathToFileURL } from 'node:url';
    const [launcherModule, fixture] = process.argv.slice(2);
    const { launchHostedOwnerAlpha } = await import(pathToFileURL(launcherModule).href);
    const scratch = await mkdtemp(join(dirname(fixture), 'inner-'));
    const nativeHome = join(scratch, 'native-home'), stateDirectory = join(scratch, 'session');
    await mkdir(nativeHome, { mode: 0o700 }); await mkdir(stateDirectory, { mode: 0o700 });
    const config = { nativeHome, stateDirectory, hostedOwnerBindingSha256: '19'.repeat(32),
      ownerAlpha: { session_id: 'aaaaaaaa-1111-4111-8111-111111111111', persona_id: '11111111-1111-4111-8111-111111111111',
        expires_at: '2099-09-16T10:01:00.000Z', max_runs: 1, max_task_seconds: 30 },
      personas: { '11111111-1111-4111-8111-111111111111': { model: 'synthetic' } } };
    const path = join(scratch, 'owner.json');
    await writeFile(path, JSON.stringify(config), { mode: 0o600 });
    let stdout = '';
    const result = await launchHostedOwnerAlpha(path, { spawnImpl(command, argv, options) {
      const entryIndex = argv.indexOf(process.execPath);
      const child = spawn(command, argv.slice(0, entryIndex).concat(process.execPath, fixture),
        { ...options, stdio: ['ignore', 'pipe', 'inherit'] });
      child.stdout.on('data', data => { stdout += data; });
      return child;
    } });
    console.log(JSON.stringify({ result, stdout, uid: process.getuid() }));
  `, { mode: 0o600 });
  const result = privilegedSync(['bash', bootstrap, String(harnessUid), String(harnessGid), '--',
    process.execPath, inner, launcherModule, fixture]);
  if (!result) return t.skip('passwordless sudo or a root harness is required for the composition');
  assert.equal(result.status, 0);
  const observed = JSON.parse(result.stdout);
  assert.deepEqual(observed.result, { code: 0, signal: null });
  assert.equal(observed.uid, harnessUid);
  assertZeroBoundary(JSON.parse(observed.stdout), harnessUid);
});
