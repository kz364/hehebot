import { DatabaseSync } from 'node:sqlite';
import { execFileSync, spawnSync } from 'node:child_process';
import { watch } from 'node:fs';
import { chmod, copyFile, link, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir as osTmpdir } from 'node:os';
import { realpathSync as realPath } from 'node:fs';
// The backup scripts refuse symlinked path components; macOS tmpdir() is under the /var symlink.
const tmpdir = () => realPath(osTmpdir());
import { basename, join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { snapshotControl, verifyControl } from '../scripts/backup-control.mjs';
import { encryptControlBackup, decryptControlBackup, MAX_DATABASE_BYTES } from '../scripts/encrypt-control-backup.mjs';

const age = process.env.HEHEBOT_AGE_BIN ?? resolve('.local/age-v1.3.2/age/age');
const keygen = process.env.HEHEBOT_AGE_KEYGEN_BIN ?? resolve('.local/age-v1.3.2/age/age-keygen');
const schema = await readFile(process.env.HEHEBOT_ENCRYPTED_BACKUP_TEST_SCHEMA ?? new URL('../DB/schema.sql', import.meta.url), 'utf8');
const cli = decodeURIComponent(new URL('../scripts/encrypt-control-backup.mjs', import.meta.url).pathname);
let fixtureDirectory: string, directory: string, snapshot: string, encrypted: string, staging: string, identity: string, recipient: string;
const clean = async () => expect((await readdir(directory)).filter(name => name.startsWith('.hehebot-age-'))).toEqual([]);
const absent = async (path: string) => expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' });
function makeIdentity(path: string) {
  execFileSync(keygen, ['-o', path], { stdio: ['ignore', 'ignore', 'pipe'] });
  return execFileSync(keygen, ['-y', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
async function rawContainer(manifest?: Buffer, database?: Buffer) {
  const m = manifest ?? await readFile(join(snapshot, 'manifest.json'));
  const d = database ?? await readFile(join(snapshot, 'control.sqlite'));
  // Independent encoding from the documented fixed container; no implementation pack helper.
  const magic = Buffer.from('HEHEBOT-CONTROL-BACKUP/1\n');
  const header = Buffer.alloc(magic.length + 8); magic.copy(header); header.writeUInt32BE(m.length, magic.length); header.writeUInt32BE(d.length, magic.length + 4);
  return Buffer.concat([header, m, d]);
}
async function sealRaw(payload: Buffer, path = encrypted) {
  const ciphertext = execFileSync(age, ['--encrypt', '--recipient', recipient], { input: payload, maxBuffer: 2 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
  await writeFile(path, ciphertext, { mode: 0o600 });
}
beforeAll(async () => {
  expect(execFileSync(age, ['--version'], { encoding: 'utf8' }).trim()).toBe('v1.3.2');
  expect(execFileSync(keygen, ['--version'], { encoding: 'utf8' }).trim()).toBe('v1.3.2');
  fixtureDirectory = await mkdtemp(join(tmpdir(), 'hehe-encrypted-fixture-'));
  const source = join(fixtureDirectory, 'control.sqlite'); await writeFile(source, '', { mode: 0o600 });
  const db = new DatabaseSync(source);
  try {
    db.exec(schema);
    db.prepare("INSERT INTO objects VALUES('persona-73','persona',7,?,NULL,'t1','t9')").run(JSON.stringify({ canary: 'PRIVATE_APPLICATION_CANARY_713', text: 'synthetic-only-'.repeat(12000) }));
    db.exec("INSERT INTO object_revisions VALUES('persona-73',3,'{\"prior\":19}','owner',NULL,'t1')");
    await snapshotControl(source, join(fixtureDirectory, 'snapshot'));
  } finally { db.close(); }
}, 30000);
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'hehe-encrypted-backup-'));
  snapshot = join(directory, 'snapshot'); encrypted = join(directory, 'snapshot.age'); staging = join(directory, 'decrypted'); identity = join(directory, 'identity.txt');
  recipient = makeIdentity(identity); await chmod(identity, 0o600);
  await mkdir(snapshot, { mode: 0o700 });
  for (const name of ['control.sqlite', 'manifest.json']) await copyFile(join(fixtureDirectory, 'snapshot', name), join(snapshot, name));
});
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
afterAll(async () => { if (fixtureDirectory) await rm(fixtureDirectory, { recursive: true, force: true }); });

it('round-trips actual age ciphertext, verifies exact application bytes and preserves source/identity', async () => {
  const original = await Promise.all(['manifest.json', 'control.sqlite'].map(name => readFile(join(snapshot, name))));
  const keyBefore = await readFile(identity);
  expect(await encryptControlBackup(snapshot, encrypted, recipient, age)).toMatchObject({ status: 'ok', operation: 'encrypt', ageVersion: 'v1.3.2' });
  const ciphertext = await readFile(encrypted);
  expect(ciphertext.subarray(0, 22).toString()).toBe('age-encryption.org/v1\n');
  expect(ciphertext.includes(Buffer.from('PRIVATE_APPLICATION_CANARY_713'))).toBe(false);
  expect(await decryptControlBackup(encrypted, staging, identity, age)).toMatchObject({ status: 'ok', operation: 'decrypt' });
  expect(await verifyControl(staging)).toEqual(await verifyControl(snapshot));
  for (const [index, name] of ['manifest.json', 'control.sqlite'].entries()) {
    expect((await readFile(join(staging, name))).equals(original[index])).toBe(true);
    expect((await readFile(join(snapshot, name))).equals(original[index])).toBe(true);
    expect((await lstat(join(staging, name))).mode & 0o777).toBe(0o600);
  }
  expect((await readFile(identity)).equals(keyBefore)).toBe(true);
  expect((await readFile(encrypted)).equals(ciphertext)).toBe(true);
  expect((await lstat(staging)).mode & 0o777).toBe(0o700); expect((await lstat(encrypted)).mode & 0o777).toBe(0o600);
  expect((await lstat(encrypted)).nlink).toBe(1); await clean();
});

it('rejects a wrong identity and late chunk tampering without ever publishing the plaintext directory', async () => {
  await encryptControlBackup(snapshot, encrypted, recipient, age);
  const wrong = join(directory, 'wrong.txt'); makeIdentity(wrong); await chmod(wrong, 0o600);
  await expect(decryptControlBackup(encrypted, staging, wrong, age)).rejects.toThrow('AGE_FAILED'); await absent(staging); await clean();
  const ciphertext = await readFile(encrypted); ciphertext[ciphertext.length - 1] ^= 1; await writeFile(encrypted, ciphertext);
  const direct = spawnSync(age, ['--decrypt', '--identity', identity], { input: ciphertext, maxBuffer: 2 * 1024 * 1024 });
  expect(direct.status).toBe(1); expect(direct.stdout.length).toBeGreaterThan(65536); // age can expose authenticated prefix chunks before final failure.
  const published: string[] = [], watcher = watch(directory, (_event, name) => { if (name === basename(staging)) published.push(name); });
  try {
    await expect(decryptControlBackup(encrypted, staging, identity, age)).rejects.toThrow('AGE_FAILED');
    await new Promise(done => setTimeout(done, 20)); expect(published).toEqual([]);
  } finally { watcher.close(); }
  await absent(staging); await clean();
});

it('rejects truncation and corrupted age headers without leaving staging or changing input', async () => {
  await encryptControlBackup(snapshot, encrypted, recipient, age); const original = await readFile(encrypted);
  for (const bytes of [original.subarray(0, original.length - 17), Buffer.concat([Buffer.from('not-age\n'), original.subarray(8)])]) {
    await writeFile(encrypted, bytes); await expect(decryptControlBackup(encrypted, staging, identity, age)).rejects.toThrow('AGE_FAILED');
    expect((await readFile(encrypted)).equals(bytes)).toBe(true); await absent(staging); await clean();
  }
});

it('rejects authenticated extra/truncated/oversized containers and never extracts arbitrary paths', async () => {
  const valid = await rawContainer(), magicLength = Buffer.byteLength('HEHEBOT-CONTROL-BACKUP/1\n');
  const hugeManifest = Buffer.from(valid); hugeManifest.writeUInt32BE(65537, magicLength);
  const hugeDb = Buffer.from(valid); hugeDb.writeUInt32BE(MAX_DATABASE_BYTES + 1, magicLength + 4);
  for (const payload of [Buffer.concat([valid, Buffer.from('../outside-secret')]), valid.subarray(0, valid.length - 1), hugeManifest, hugeDb, Buffer.from('../../escape\0symlink\0hardlink')]) {
    await sealRaw(payload); await expect(decryptControlBackup(encrypted, staging, identity, age)).rejects.toThrow('CONTAINER_INVALID');
    await absent(staging); await clean();
  }
  await absent(join(directory, 'outside-secret'));
});

it('runs verifyControl after authentication, rejecting traversal manifests, wrong hashes and counts', async () => {
  const manifest = JSON.parse(await readFile(join(snapshot, 'manifest.json'), 'utf8'));
  for (const patch of [{ database: '../escape.sqlite' }, { sha256: '0'.repeat(64) }, { counts: { ...manifest.counts, object_revisions: 0 } }]) {
    await sealRaw(await rawContainer(Buffer.from(JSON.stringify({ ...manifest, ...patch }))));
    await expect(decryptControlBackup(encrypted, staging, identity, age)).rejects.toThrow(); await absent(staging); await clean();
  }
  await absent(join(directory, 'escape.sqlite'));
});

it('refuses overwrite of encrypted output or plaintext staging, preserving existing bytes', async () => {
  await encryptControlBackup(snapshot, encrypted, recipient, age); const bytes = await readFile(encrypted);
  await expect(encryptControlBackup(snapshot, encrypted, recipient, age)).rejects.toThrow('DESTINATION_EXISTS');
  expect((await readFile(encrypted)).equals(bytes)).toBe(true);
  await decryptControlBackup(encrypted, staging, identity, age); const manifest = await readFile(join(staging, 'manifest.json'));
  await expect(decryptControlBackup(encrypted, staging, identity, age)).rejects.toThrow('DESTINATION_EXISTS');
  expect((await readFile(join(staging, 'manifest.json'))).equals(manifest)).toBe(true); await clean();
});

it('rejects symlink/hardlink ciphertext or identity and unsafe private-file modes', async () => {
  await encryptControlBackup(snapshot, encrypted, recipient, age);
  for (const input of [encrypted, identity]) {
    const alias = join(directory, 'alias');
    for (const make of [symlink, link]) {
      await make(input, alias);
      await expect(decryptControlBackup(input === encrypted ? alias : encrypted, staging, input === identity ? alias : identity, age)).rejects.toThrow('UNSAFE_PATH');
      await rm(alias);
    }
  }
  await chmod(identity, 0o644); await expect(decryptControlBackup(encrypted, staging, identity, age)).rejects.toThrow('UNSAFE_PATH');
  await chmod(identity, 0o600); await chmod(encrypted, 0o644); await expect(decryptControlBackup(encrypted, staging, identity, age)).rejects.toThrow('UNSAFE_PATH');
  await clean(); await absent(staging);
});

it('requires a verified two-component source with bounded sizes and rejects linked source files', async () => {
  const path = join(snapshot, 'control.sqlite'), alias = join(directory, 'hardlink');
  await expect(encryptControlBackup(snapshot, join(snapshot, 'nested.age'), recipient, age)).rejects.toThrow('UNSAFE_PATH');
  expect((await readdir(snapshot)).sort()).toEqual(['control.sqlite', 'manifest.json']);
  await symlink(snapshot, alias); await expect(encryptControlBackup(alias, encrypted, recipient, age)).rejects.toThrow('UNSAFE_PATH'); await rm(alias);
  await link(path, alias); await expect(encryptControlBackup(snapshot, encrypted, recipient, age)).rejects.toThrow('UNSAFE_PATH'); await rm(alias);
  await writeFile(join(snapshot, 'extra'), 'extra', { mode: 0o600 }); await expect(encryptControlBackup(snapshot, encrypted, recipient, age)).rejects.toThrow('COMPONENTS_INVALID');
  await rm(join(snapshot, 'extra')); await truncate(path, MAX_DATABASE_BYTES + 1);
  await expect(encryptControlBackup(snapshot, encrypted, recipient, age)).rejects.toThrow('SIZE_LIMIT');
  await absent(encrypted); await clean();
});

it('rejects an oversized sparse ciphertext before decrypting or creating staging', async () => {
  await writeFile(encrypted, '', { mode: 0o600 });
  const maximum = MAX_DATABASE_BYTES + 65536 + Buffer.byteLength('HEHEBOT-CONTROL-BACKUP/1\n') + 8 + 1024 * 1024;
  await truncate(encrypted, maximum + 1);
  await expect(decryptControlBackup(encrypted, staging, identity, age)).rejects.toThrow('SIZE_LIMIT');
  expect((await lstat(encrypted)).size).toBe(maximum + 1); await absent(staging); await clean();
});

it('denies plugin/passphrase/SSH identities, invalid recipients and unsupported CLI versions', async () => {
  await encryptControlBackup(snapshot, encrypted, recipient, age);
  const badKey = join(directory, 'bad-key');
  for (const contents of ['AGE-PLUGIN-FAKE-1TEST\n', '-----BEGIN OPENSSH PRIVATE KEY-----\n', 'age-encryption.org/v1\n', '# comment-only\n', 'x'.repeat(4097)]) {
    await writeFile(badKey, contents, { mode: 0o600 }); await expect(decryptControlBackup(encrypted, staging, badKey, age)).rejects.toThrow('IDENTITY_INVALID');
  }
  for (const bad of ['--passphrase', 'ssh-ed25519 AAAA', 'age1plugin1secret', recipient + ' --extra']) {
    await expect(encryptControlBackup(snapshot, join(directory, 'new.age'), bad, age)).rejects.toThrow('RECIPIENT_INVALID');
  }
  await expect(encryptControlBackup(snapshot, join(directory, 'new.age'), 'age1' + 'q'.repeat(58), age)).rejects.toThrow('AGE_FAILED');
  const old = join(directory, 'old-age'); await writeFile(old, '#!/bin/sh\necho v0.0.0\n', { mode: 0o700 });
  await expect(encryptControlBackup(snapshot, join(directory, 'new.age'), recipient, old)).rejects.toThrow('AGE_VERSION');
  await absent(staging); await absent(join(directory, 'new.age')); await clean();
});

it('CLI uses only explicit file references and emits fixed status/errors, never key or source content', () => {
  const encryptedResult = spawnSync(process.execPath, [cli, 'encrypt', snapshot, encrypted, recipient, age], { encoding: 'utf8' });
  expect(encryptedResult.status).toBe(0); expect(JSON.parse(encryptedResult.stdout).operation).toBe('encrypt');
  const decrypted = spawnSync(process.execPath, [cli, 'decrypt', encrypted, staging, identity, age], { encoding: 'utf8' });
  expect(decrypted.status).toBe(0); expect(JSON.parse(decrypted.stdout).operation).toBe('decrypt');
  const bad = spawnSync(process.execPath, [cli, 'decrypt', encrypted, join(directory, 'new'), join(directory, 'PRIVATE_PATH_CANARY'), age], { encoding: 'utf8' });
  expect(bad.status).toBe(1); expect(bad.stderr).toContain('ENCRYPTED_CONTROL_BACKUP_FAILED');
  expect([encryptedResult.stdout, encryptedResult.stderr, decrypted.stdout, decrypted.stderr, bad.stderr].join('')).not.toMatch(/PRIVATE_PATH_CANARY|AGE-SECRET-KEY-1|PRIVATE_APPLICATION_CANARY_713/);
});
