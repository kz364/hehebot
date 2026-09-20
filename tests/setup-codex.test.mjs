import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const exec = promisify(execFile), root = resolve(new URL('..', import.meta.url).pathname);
const script = join(root, 'scripts/setup-codex.sh');
async function executable(path, body) { await writeFile(path, body); await chmod(path, 0o755); }

// Synthetic prior installation plus unrelated config/auth sentinels that must survive every
// setup outcome byte-for-byte. No real credentials are involved anywhere in this file.
async function seedPrior(runtime) {
  await mkdir(join(runtime, 'node_modules/@openai/codex'), { recursive: true });
  await mkdir(join(runtime, 'node_modules/.bin'), { recursive: true });
  await writeFile(join(runtime, 'node_modules/@openai/codex/package.json'), '{"version":"0.154.0"}');
  await executable(join(runtime, 'node_modules/.bin/codex'), '#!/bin/sh\necho "codex-cli 0.154.0"\n');
  await writeFile(join(runtime, 'config.toml'), 'synthetic config sentinel\n');
  await mkdir(join(runtime, 'account'), { recursive: true });
  const auth = join(runtime, 'account/auth.json');
  await writeFile(auth, 'synthetic auth sentinel\n');
  await chmod(auth, 0o600);
}

// Recursive snapshot of regular-file contents and modes: proves unrelated runtime/config/auth
// files and the prior installation stay byte-for-byte unchanged through success and failure.
async function treeOf(dir) {
  const files = {};
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) {
        const content = await readFile(child);
        files[relative(dir, child)] = { mode: (await stat(child)).mode & 0o777, bytes: content.toString('base64') };
      }
    }
  }
  await walk(dir);
  return files;
}

// The prior executable must remain runnable and no scratch state may stay behind.
async function assertPriorUsable(runtime) {
  const version = await exec(join(runtime, 'node_modules/.bin/codex'), ['--version']);
  assert.equal(version.stdout.trim(), 'codex-cli 0.154.0');
  const names = (await readdir(runtime)).join(' ');
  assert.doesNotMatch(names, /setup-staging|node_modules\.previous/);
}

test('setup installs the exact package repeatably without auth commands', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-setup-test-')); t.after(() => rm(dir, {recursive: true, force: true}));
  const npm = join(dir, 'npm');
  await executable(npm, `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> '${dir}/calls'
prefix=''
while [ "$#" -gt 0 ]; do [ "$1" = --prefix ] && { prefix="$2"; break; }; shift; done
mkdir -p "$prefix/node_modules/@openai/codex" "$prefix/node_modules/.bin"
printf '{"version":"0.154.0"}' > "$prefix/node_modules/@openai/codex/package.json"
printf '#!/bin/sh\\necho "codex-cli 0.154.0"\\n' > "$prefix/node_modules/.bin/codex"
chmod +x "$prefix/node_modules/.bin/codex"
`);
  const runtime = join(dir, 'runtime with spaces');
  await seedPrior(runtime);
  await writeFile(join(runtime, 'node_modules/.stale-marker'), 'previous install marker\n');
  const before = await treeOf(runtime);
  for (let i = 0; i < 2; i++) await exec('bash', [script, '--runtime-dir', runtime, '--npm', npm]);
  const calls = await readFile(join(dir, 'calls'), 'utf8');
  assert.equal(calls.trim().split('\n').length, 2);
  assert.match(calls, /@openai\/codex@0\.154\.0/);
  assert.doesNotMatch(calls, /login|auth|exec|infer/);
  const after = await treeOf(runtime);
  const expected = { ...before };
  delete expected['node_modules/.stale-marker'];
  assert.deepEqual(after, expected);
  await assertPriorUsable(runtime);
});

test('failed npm install leaves the prior executable usable and unrelated files unchanged', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-setup-fail-')); t.after(() => rm(dir, {recursive: true, force: true}));
  const npm = join(dir, 'npm-fail');
  // Simulates a partially destructive npm failure: network/package errors can leave the target
  // prefix damaged before npm exits nonzero. With a live installation this destroyed the CLI.
  await executable(npm, `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> '${dir}/calls'
prefix=''
while [ "$#" -gt 0 ]; do [ "$1" = --prefix ] && { prefix="$2"; break; }; shift; done
rm -rf "$prefix/node_modules/@openai/codex" "$prefix/node_modules/.bin"
exit 1
`);
  const runtime = join(dir, 'runtime');
  await seedPrior(runtime);
  const before = await treeOf(runtime);
  await assert.rejects(exec('bash', [script, '--runtime-dir', runtime, '--npm', npm]));
  assert.deepEqual(await treeOf(runtime), before);
  await assertPriorUsable(runtime);
});

test('mismatched staged candidate is refused without touching the installed package', async t => {
  for (const [name, packageVersion, cliVersion, exitCommand = 'exit 0'] of
    [['npm-wrong-package', '0.153.0', '0.153.0'], ['npm-wrong-cli', '0.154.0', '0.153.0'],
      ['npm-failed-cli', '0.154.0', '0.154.0', 'exit 17'],
      ['npm-failed-final-cli', '0.154.0', '0.154.0', 'case "$0" in */.setup-staging/*) exit 0 ;; *) exit 17 ;; esac']]) {
    await t.test(name, async t => {
      const dir = await mkdtemp(join(tmpdir(), `codex-${name}-`)); t.after(() => rm(dir, {recursive: true, force: true}));
      const npm = join(dir, name);
      await executable(npm, `#!/bin/sh
set -eu
prefix=''
while [ "$#" -gt 0 ]; do [ "$1" = --prefix ] && { prefix="$2"; break; }; shift; done
mkdir -p "$prefix/node_modules/@openai/codex" "$prefix/node_modules/.bin"
printf '{"version":"${packageVersion}"}' > "$prefix/node_modules/@openai/codex/package.json"
printf '#!/bin/sh\\necho "codex-cli ${cliVersion}"\\n${exitCommand}\\n' > "$prefix/node_modules/.bin/codex"
chmod +x "$prefix/node_modules/.bin/codex"
`);
      const runtime = join(dir, 'runtime with spaces');
      await seedPrior(runtime);
      const before = await treeOf(runtime);
      await assert.rejects(exec('bash', [script, '--runtime-dir', runtime, '--npm', npm]));
      assert.deepEqual(await treeOf(runtime), before);
      await assertPriorUsable(runtime);
    });
  }
});

test('setup reconstructs both interrupted replacement states before a new npm failure', async t => {
  for (const swapped of [false, true]) await t.test(swapped ? 'after candidate swap' : 'between renames', async t => {
    const dir = await mkdtemp(join(tmpdir(), 'codex-setup-recover-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const runtime = join(dir, 'runtime');
    await seedPrior(runtime);
    await writeFile(join(runtime, 'node_modules/prior-marker'), 'old installation');
    const before = await treeOf(runtime);
    await rename(join(runtime, 'node_modules'), join(runtime, '.node_modules.previous'));
    if (swapped) {
      await seedPrior(runtime);
      await writeFile(join(runtime, 'node_modules/current-marker'), 'validated replacement');
    }
    await mkdir(join(runtime, '.setup-staging'));
    await writeFile(join(runtime, '.setup-staging/partial'), 'interrupted scratch');
    const npm = join(dir, 'npm');
    await executable(npm, '#!/bin/sh\nexit 23\n');
    await assert.rejects(exec('bash', [script, '--runtime-dir', runtime, '--npm', npm]));
    const expected = { ...before };
    if (swapped) {
      delete expected['node_modules/prior-marker'];
      expected['node_modules/current-marker'] = { mode: 0o644, bytes: Buffer.from('validated replacement').toString('base64') };
    }
    assert.deepEqual(await treeOf(runtime), expected);
    await assertPriorUsable(runtime);
  });
});

test('probe performs initialize and non-refreshing account read and emits booleans only', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-probe-test-')); t.after(() => rm(dir, {recursive: true, force: true}));
  const binary = join(dir, 'codex');
  await executable(binary, `#!/usr/bin/env node
if (process.argv.includes('--version')) { console.log('codex-cli 0.154.0'); process.exit(0); }
const readline = require('node:readline');
readline.createInterface({input:process.stdin}).on('line', line => {
 const m=JSON.parse(line); if (m.method==='initialize') console.log(JSON.stringify({id:m.id,result:{codexHome:process.env.CODEX_HOME,platformFamily:'unix',platformOs:'linux',userAgent:'codex'}}));
 else if (m.method==='account/read') { if(m.params.refreshToken!==false) process.exit(9); console.log(JSON.stringify({id:m.id,result:{account:null,requiresOpenaiAuth:true,secret:'must-not-print'}})); }
});
`);
  const result = await exec(process.execPath, [join(root, 'scripts/probe-codex.mjs'), '--binary', binary, '--timeout-ms', '1000']);
  assert.deepEqual(JSON.parse(result.stdout), {versionMatch:true, handshake:true, accountRead:true, authenticated:false});
  assert.doesNotMatch(result.stdout, /secret|home|diagnostic/);
});

test('probe fails closed on a version mismatch without starting app-server', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-probe-fail-')); t.after(() => rm(dir, {recursive:true, force:true}));
  const binary = join(dir, 'codex'); await executable(binary, '#!/bin/sh\necho "codex-cli 9.9.9"\n');
  await assert.rejects(exec(process.execPath, [join(root, 'scripts/probe-codex.mjs'), '--binary', binary]), error => {
    assert.deepEqual(JSON.parse(error.stdout), {versionMatch:false, handshake:false, accountRead:false, authenticated:false}); return true;
  });
});

test('RPC success with malformed handshake cannot pass native verification', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-probe-invalid-')); t.after(() => rm(dir, {recursive:true, force:true}));
  const binary = join(dir, 'codex');
  await executable(binary, `#!/usr/bin/env node
if (process.argv.includes('--version')) { console.log('codex-cli 0.154.0'); process.exit(0); }
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
 const m=JSON.parse(line); if(m.id) console.log(JSON.stringify({id:m.id,result:{}}));
});
`);
  await assert.rejects(exec(process.execPath, [join(root, 'scripts/probe-codex.mjs'), '--binary', binary]), error => {
    assert.deepEqual(JSON.parse(error.stdout), {versionMatch:true, handshake:false, accountRead:false, authenticated:false}); return true;
  });
});
