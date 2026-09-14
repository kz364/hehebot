import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const exec = promisify(execFile);
const setup = resolve('scripts/setup-local.sh');
const verify = resolve('scripts/verify-local.mjs');
const run = async (file, args, env) => {
  try { return { ...await exec(file, args, { cwd: resolve('.'), env: { ...process.env, ...env } }), code: 0 }; }
  catch (error) { return error; }
};

test('setup reuses the exact pin and refuses unknown or mismatched installs', async t => {
  const base = await mkdtemp(join(tmpdir(), 'clawbot-setup-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const correct = join(base, 'correct', 'node_modules', 'openclaw');
  await mkdir(correct, { recursive: true });
  await writeFile(join(correct, 'package.json'), '{"version":"2026.9.3"}');
  assert.equal((await run('bash', [setup], { CLAWBOT_OPENCLAW_PACKAGE_ROOT: correct })).code, 0);

  const wrong = join(base, 'wrong', 'node_modules', 'openclaw');
  await mkdir(wrong, { recursive: true });
  await writeFile(join(wrong, 'package.json'), '{"version":"0.0.0"}');
  assert.notEqual((await run('bash', [setup], { CLAWBOT_OPENCLAW_PACKAGE_ROOT: wrong })).code, 0);

  const unknown = join(base, 'unknown', 'node_modules', 'openclaw');
  await mkdir(unknown, { recursive: true });
  assert.notEqual((await run('bash', [setup], { CLAWBOT_OPENCLAW_PACKAGE_ROOT: unknown })).code, 0);
});

test('verification preflight fails for missing and wrong pins without running suites', async t => {
  const base = await mkdtemp(join(tmpdir(), 'clawbot-verify-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const missing = await run(process.execPath, [verify, '--preflight-only'], { CLAWBOT_OPENCLAW_PACKAGE_ROOT: join(base, 'missing') });
  assert.notEqual(missing.code, 0);
  assert.match(missing.stdout, /"assistantOperational":false/);
  const wrong = join(base, 'wrong');
  await mkdir(wrong);
  await writeFile(join(wrong, 'package.json'), '{"version":"1.2.3"}');
  const mismatch = await run(process.execPath, [verify, '--preflight-only'], { CLAWBOT_OPENCLAW_PACKAGE_ROOT: wrong });
  assert.notEqual(mismatch.code, 0);
  assert.match(mismatch.stdout, /PINNED_OPENCLAW_VERSION_MISMATCH/);
});
