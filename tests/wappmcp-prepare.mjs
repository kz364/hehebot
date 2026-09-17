import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, readdir, stat, symlink, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const exec = promisify(execFile), script = resolve('scripts/verify-wappmcp.mjs');
async function fixture(t) {
  // Inside Git deliberately: patch application must not discover the parent repo.
  const root = await mkdtemp(resolve('.local/wapp-prepare-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const preload = join(root, 'no-fetch.mjs');
  await writeFile(preload, 'globalThis.fetch = async () => { throw Error("SYNTHETIC_DOWNLOAD_FAILURE"); };\n');
  return { root, preload, run: (args, options = {}) => exec(process.execPath, [script, ...args], {
    timeout: 240000, maxBuffer: 4 * 1024 * 1024, ...options,
  }) };
}

test('invalid/existing destinations are refused unchanged; failed preparation removes only its new directory', async t => {
  const f = await fixture(t), destination = join(f.root, 'new');
  for (const args of [['--prepare'], ['--prepare', 'relative'], ['--wrong', destination], ['--prepare', destination, 'extra']]) {
    await assert.rejects(f.run(args), error => /Usage:/.test(error.stderr));
  }
  const existing = join(f.root, 'existing');
  await mkdir(existing); await writeFile(join(existing, 'sentinel'), 'keep-exactly');
  const link = join(f.root, 'link'); await symlink(existing, link);
  for (const path of [existing, link]) await assert.rejects(f.run(['--prepare', path]), error => /EEXIST/.test(error.stderr));
  assert.deepEqual(await readdir(existing), ['sentinel']);
  assert.equal(await readFile(join(existing, 'sentinel'), 'utf8'), 'keep-exactly');
  await assert.rejects(exec(process.execPath, ['--import', f.preload, script, '--prepare', destination]),
    error => /SYNTHETIC_DOWNLOAD_FAILURE/.test(error.stderr));
  await assert.rejects(stat(destination), { code: 'ENOENT' });
});

test('explicit prepare retains checked graph privately, no npm credentials/config inheritance or connector startup', async t => {
  const f = await fixture(t), destination = join(f.root, 'prepared');
  const { stdout } = await f.run(['--prepare', destination], { env: {
    PATH: process.env.PATH, HOME: f.root,
    npm_config_userconfig: '/nonexistent/private-config', npm_config_registry: 'http://127.0.0.1:1',
    NPM_TOKEN: 'SYNTHETIC_MUST_NOT_INHERIT', GIT_DIR: '/nonexistent/git-dir', TAR_OPTIONS: '--invalid-option',
  } });
  const report = JSON.parse(stdout.trim().split('\n').at(-1));
  assert.equal(report.status, 'passed'); assert.equal(report.disposableInstall, false);
  assert.equal(report.installed, true); assert.equal(report.readiness, 'blocked');
  assert.equal(report.syntheticCompatibility, false); assert.equal(report.productionAdmission, false);
  assert.equal(report.livePairing, false); assert.equal(report.redistributionApproved, false);
  assert.deepEqual(await readdir(destination), ['installation']);
  assert.equal((await stat(destination)).mode & 0o777, 0o700);
  const installation = join(destination, 'installation');
  assert.equal(report.preparedInstallation, installation);
  const receiptPath = join(installation, 'hehebot-preparation.json');
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  assert.equal((await stat(receiptPath)).mode & 0o777, 0o600);
  assert.equal(receipt.status, 'prepared-not-enabled');
  for (const key of ['paired', 'processStarted', 'toolsRegistered', 'redistributionApproved']) assert.equal(receipt[key], false);
  const lock = await readFile('config/wappmcp/package-lock.json');
  assert.deepEqual(await readFile(join(installation, 'package-lock.json')), lock);
  assert.equal(receipt.lockSha256, createHash('sha256').update(lock).digest('hex'));
  assert.equal(receipt.verification.lockedPackages, 350);
  assert.equal(receipt.verification.cleanPatch, true);
  assert.equal(receipt.verification.publicServer.boundRecentRetainsUnknown, true);
  assert.equal(JSON.parse(await readFile(join(installation, 'node_modules/wappmcp/package.json'))).version, '0.4.0');
  const before = await readFile(receiptPath);
  await assert.rejects(f.run(['--prepare', destination]), error => /EEXIST/.test(error.stderr));
  assert.deepEqual(await readFile(receiptPath), before);
  assert.deepEqual(await readdir(destination), ['installation']);
});
