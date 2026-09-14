import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const exec = promisify(execFile), root = resolve(new URL('..', import.meta.url).pathname);
async function executable(path, body) { await writeFile(path, body); await chmod(path, 0o755); }

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
  for (let i = 0; i < 2; i++) await exec('bash', [join(root, 'scripts/setup-codex.sh'), '--runtime-dir', runtime, '--npm', npm]);
  const calls = await readFile(join(dir, 'calls'), 'utf8');
  assert.equal(calls.trim().split('\n').length, 2);
  assert.match(calls, /@openai\/codex@0\.154\.0/);
  assert.doesNotMatch(calls, /login|auth|exec|infer/);
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
  const dir = await mkdtemp(join(tmpdir(), 'codex-probe-invalid-')); t.after(() => rm(dir, { recursive:true, force:true }));
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
