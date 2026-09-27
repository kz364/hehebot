import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { chmod, copyFile, link, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir as osTmpdir } from 'node:os';
import { realpathSync as realPath } from 'node:fs';
// The backup scripts refuse symlinked path components; macOS tmpdir() is under the /var symlink.
const tmpdir = () => realPath(osTmpdir());
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';

const fault = vi.hoisted(() => ({ directory: '', sourceManifest: '', mode: '', onFrozen: undefined as undefined | (() => Promise<void>), onPublish: undefined as undefined | (() => Promise<void>), onRename: undefined as undefined | (() => Promise<void>) }));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, copyFile: async (source: string, destination: string, flags?: number) => {
    const publishing = destination.startsWith(fault.directory + '/') && destination.slice(fault.directory.length + 1).indexOf('/') === -1 && destination.endsWith('.age');
    if (publishing) {
      await fault.onPublish?.();
      if (fault.mode === 'before-copy') throw new Error('SYNTHETIC');
      if (fault.mode === 'partial-copy') { await actual.writeFile(destination, 'partial', { mode: 0o600, flag: 'wx' }); throw new Error('SYNTHETIC'); }
      if (fault.mode === 'existing-file') await actual.writeFile(destination, 'DO_NOT_OVERWRITE', { mode: 0o600, flag: 'wx' });
    }
    await actual.copyFile(source, destination, flags);
    if (source === fault.sourceManifest) await fault.onFrozen?.();
    if (publishing && fault.mode === 'after-copy') throw new Error('SYNTHETIC');
  }, rename: async (source: string, destination: string) => {
    const publishing = destination === fault.directory + '/inventory.json';
    if (publishing) {
      await fault.onRename?.();
      if (fault.mode === 'before-inventory') throw new Error('SYNTHETIC');
    }
    await actual.rename(source, destination);
    if (publishing && fault.mode === 'after-inventory') throw new Error('SYNTHETIC');
  } };
});
import { createControlBackup } from '../scripts/create-control-backup.mjs';
import { snapshotControl, verifyControl } from '../scripts/backup-control.mjs';
import { decryptControlBackup } from '../scripts/encrypt-control-backup.mjs';
import { reviewControlBackups, applyControlBackups, withBackupDirectoryLock, CONFIRM_LOCAL_DELETION } from '../scripts/prune-control-backups.mjs';

const ageBinary = process.env.HEHEBOT_AGE_BIN ?? resolve('.local/age-v1.3.2/age/age');
const keygen = process.env.HEHEBOT_AGE_KEYGEN_BIN ?? resolve('.local/age-v1.3.2/age/age-keygen');
const schema = await readFile(process.env.HEHEBOT_CREATOR_TEST_SCHEMA ?? new URL('../DB/schema.sql', import.meta.url), 'utf8');
const cli = decodeURIComponent(new URL('../scripts/create-control-backup.mjs', import.meta.url).pathname);
const now = '2026-09-28T17:00:00.000Z', original = '2026-09-06T17:00:00.000Z';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
let fixture: string, root: string, directory: string, snapshot: string, identity: string, recipient: string;
const create = (n = 7) => createControlBackup(snapshot, directory, { id: id(n), recipient, ageBinary, now });
const cipher = (n = 7) => join(directory, id(n) + '.age');
const catalog = () => readFile(join(directory, 'inventory.json'), 'utf8');
const live = async () => (await readdir(directory)).filter(name => name.endsWith('.age')).sort();
const clean = async () => expect((await readdir(directory)).filter(name => name.startsWith('.create-') || name.endsWith('.next'))).toEqual([]);
async function timestamp(value: string) {
  const path = join(snapshot, 'manifest.json'), manifest = JSON.parse(await readFile(path, 'utf8'));
  manifest.createdAt = value; await writeFile(path, JSON.stringify(manifest), { mode: 0o600 });
}
beforeAll(async () => {
  expect(execFileSync(ageBinary, ['--version'], { encoding: 'utf8' }).trim()).toBe('v1.3.2');
  fixture = await mkdtemp(join(tmpdir(), 'hehe-create-fixture-')); identity = join(fixture, 'identity');
  execFileSync(keygen, ['-o', identity], { stdio: ['ignore', 'ignore', 'pipe'] }); await chmod(identity, 0o600);
  recipient = execFileSync(keygen, ['-y', identity], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const source = join(fixture, 'source.sqlite'); await writeFile(source, '', { mode: 0o600 });
  const db = new DatabaseSync(source);
  try {
    db.exec(schema);
    db.prepare("INSERT INTO objects VALUES('synthetic-persona','persona',7,?,NULL,'t1','t9')").run(JSON.stringify({ canary: 'PRIVATE_CREATION_CANARY_791', asymmetric: [17, 3] }));
    await snapshotControl(source, join(fixture, 'snapshot'));
  } finally { db.close(); }
}, 30000);
afterAll(async () => { await rm(fixture, { recursive: true, force: true }); });
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'hehe-create-')); directory = join(root, 'backups'); snapshot = join(root, 'snapshot');
  await mkdir(directory, { mode: 0o700 }); await mkdir(snapshot, { mode: 0o700 });
  for (const name of ['control.sqlite', 'manifest.json']) await copyFile(join(fixture, 'snapshot', name), join(snapshot, name));
  await timestamp(original); await writeFile(join(directory, 'inventory.json'), '{"version":1,"backups":[]}\n', { mode: 0o600 });
  fault.directory = directory; fault.sourceManifest = join(snapshot, 'manifest.json');
  fault.mode = ''; fault.onFrozen = undefined; fault.onPublish = undefined; fault.onRename = undefined;
});
afterEach(async () => { fault.mode = ''; fault.onFrozen = undefined; fault.onPublish = undefined; fault.onRename = undefined; await rm(root, { recursive: true, force: true }); });

it('publishes real age ciphertext with exact original timestamp/hash/length and preserves source and kept data', async () => {
  const source = await Promise.all(['manifest.json', 'control.sqlite'].map(name => readFile(join(snapshot, name))));
  const keyBefore = await readFile(identity), first = await create();
  const bytes = await readFile(cipher());
  expect(first).toEqual({ id: id(7), snapshot_at: original, bytes: bytes.length, sha256: hash(bytes) });
  expect(bytes.includes(Buffer.from('PRIVATE_CREATION_CANARY_791'))).toBe(false);
  expect((await lstat(cipher())).mode & 0o777).toBe(0o600); expect((await lstat(cipher())).nlink).toBe(1);
  const restored = join(root, 'decrypted'); await decryptControlBackup(cipher(), restored, identity, ageBinary);
  expect((await verifyControl(restored)).createdAt).toBe(original);
  for (const [index, name] of ['manifest.json', 'control.sqlite'].entries()) {
    expect(await readFile(join(snapshot, name))).toEqual(source[index]);
    expect(await readFile(join(restored, name))).toEqual(source[index]);
  }
  await timestamp(now); const second = await create(3);
  expect(JSON.parse(await catalog()).backups).toEqual([second, first]);
  expect(await readFile(cipher())).toEqual(bytes); expect(await readFile(identity)).toEqual(keyBefore);
  expect((await reviewControlBackups(directory, now)).plan.entries).toHaveLength(2); await clean();
});

it('uses the frozen snapshot timestamp and content even if the original changes after the private copy', async () => {
  fault.onFrozen = () => timestamp(now);
  expect((await create()).snapshot_at).toBe(original);
  const restored = join(root, 'decrypted'); await decryptControlBackup(cipher(), restored, identity, ageBinary);
  expect((await verifyControl(restored)).createdAt).toBe(original);
  expect((await verifyControl(snapshot)).createdAt).toBe(now);
});

it('preserves exact28-day age instead of rejuvenating or deleting old snapshots', async () => {
  await timestamp('2026-08-31T17:00:00.000Z'); await create();
  expect((await reviewControlBackups(directory, now)).plan.policy.decisions[0]).toMatchObject({ id: id(7), action: 'expire', reason: 'maximum_age' });
  expect(await live()).toEqual([id(7) + '.age']);
});

it('refuses duplicates without overwriting, and publication invalidates earlier prune reviews', async () => {
  await create(); const bytes = await readFile(cipher()), before = await catalog();
  await expect(create()).rejects.toThrow(); expect(await catalog()).toBe(before); expect(await readFile(cipher())).toEqual(bytes);
  const review = await reviewControlBackups(directory, now); await create(3);
  await expect(applyControlBackups(directory, review.digest, CONFIRM_LOCAL_DELETION)).rejects.toThrow('PRUNE_REVIEW_MISMATCH');
  expect(await live()).toHaveLength(2);
});

it('refuses incomplete applies and UUID reuse from completed deletion journals', async () => {
  await timestamp('2026-08-31T17:00:00.000Z'); await create();
  const review = await reviewControlBackups(directory, now), path = join(directory, '.prune', review.digest + '.json');
  const journal = JSON.parse(await readFile(path, 'utf8')); journal.phase = 'applying'; await writeFile(path, JSON.stringify(journal));
  await expect(create(3)).rejects.toThrow('PRUNE_INCOMPLETE_APPLY'); expect(await live()).toHaveLength(1);
  await applyControlBackups(directory, review.digest, CONFIRM_LOCAL_DELETION);
  await expect(create()).rejects.toThrow(); expect(await live()).toEqual([]);
  await timestamp(now); await create(3); expect(await live()).toEqual([id(3) + '.age']);
});

it('holds stable flock through publication and inventory commit; competing creator/review cannot enter', async () => {
  let probes = 0;
  const probe = async () => {
    await expect(create(3)).rejects.toThrow('PRUNE_LOCK_BUSY');
    await expect(reviewControlBackups(directory, now)).rejects.toThrow('PRUNE_LOCK_BUSY'); probes++;
  };
  fault.onPublish = probe; fault.onRename = probe;
  await create(); expect(probes).toBe(2); expect(await live()).toEqual([id(7) + '.age']);
  await withBackupDirectoryLock(directory, async () => { await expect(create(9)).rejects.toThrow('PRUNE_LOCK_BUSY'); });
});

it.each(['before-copy', 'partial-copy', 'after-copy', 'before-inventory', 'after-inventory', 'existing-file'])('preserves honest publication state after %s fault and rejects ambiguous retries', async mode => {
  await create(3); const kept = await readFile(cipher(3)), before = await catalog();
  fault.mode = mode; await expect(create()).rejects.toThrow(); fault.mode = ''; await clean();
  expect(await readFile(cipher(3))).toEqual(kept);
  if (mode === 'before-copy') {
    expect(await catalog()).toBe(before); expect(await live()).toEqual([id(3) + '.age']); await create();
  } else {
    const published = await readFile(cipher());
    if (mode === 'partial-copy') expect(published.toString()).toBe('partial');
    if (mode === 'existing-file') expect(published.toString()).toBe('DO_NOT_OVERWRITE');
    await expect(create()).rejects.toThrow(); expect(await readFile(cipher())).toEqual(published);
    if (mode === 'after-inventory') {
      expect(JSON.parse(await catalog()).backups).toHaveLength(2);
      expect((await reviewControlBackups(directory, now)).plan.entries).toHaveLength(2);
    } else {
      expect(await catalog()).toBe(before); await expect(reviewControlBackups(directory, now)).rejects.toThrow();
      await expect(create(9)).rejects.toThrow();
    }
  }
});

it.each(['unknown', 'crash-stage', 'inventory-next', 'missing', 'corrupt', 'hardlink', 'symlink', 'public-file', 'public-directory'])('refuses %s inventory state without changing existing files', async mode => {
  await create(3); const before = await catalog();
  if (mode === 'unknown') await writeFile(join(directory, 'unknown'), 'x', { mode: 0o600 });
  if (mode === 'crash-stage') await mkdir(join(directory, '.create-crashed'), { mode: 0o700 });
  if (mode === 'inventory-next') await writeFile(join(directory, 'inventory.json.next'), '{}', { mode: 0o600 });
  if (mode === 'missing') await rm(cipher(3));
  if (mode === 'corrupt') await writeFile(cipher(3), 'not age');
  if (mode === 'hardlink') await link(cipher(3), join(root, 'linked'));
  if (mode === 'symlink') { await rm(cipher(3)); await symlink(join(snapshot, 'control.sqlite'), cipher(3)); }
  if (mode === 'public-file') await chmod(cipher(3), 0o644);
  if (mode === 'public-directory') await chmod(directory, 0o755);
  await expect(create()).rejects.toThrow(); expect(await catalog()).toBe(before);
  await expect(lstat(cipher())).rejects.toMatchObject({ code: 'ENOENT' });
});

it('refuses corrupt sources, future snapshot times, unsafe directory paths, invalid IDs and bad age recipients', async () => {
  await timestamp('2026-09-28T17:00:00.001Z'); await expect(create()).rejects.toThrow(); await timestamp(original);
  await expect(createControlBackup(snapshot, directory, { id: '../escape', recipient, ageBinary, now })).rejects.toThrow();
  await expect(createControlBackup(snapshot, directory, { id: id(7), recipient: 'not-a-recipient', ageBinary, now })).rejects.toThrow();
  await expect(createControlBackup(snapshot, directory + '/../backups', { id: id(9), recipient, ageBinary, now })).rejects.toThrow();
  const alias = join(root, 'alias'); await symlink(directory, alias);
  await expect(createControlBackup(snapshot, alias, { id: id(9), recipient, ageBinary, now })).rejects.toThrow();
  await writeFile(join(snapshot, 'control.sqlite'), 'corrupt'); await expect(create(9)).rejects.toThrow(); await clean();
});

it('CLI success is bounded metadata and failures are fixed/redacted', async () => {
  const success = spawnSync(process.execPath, [cli, snapshot, directory, id(7), recipient, ageBinary, now], { encoding: 'utf8' });
  expect(success.status).toBe(0); expect(JSON.parse(success.stdout)).toMatchObject({ id: id(7), snapshot_at: original });
  expect(success.stdout).not.toContain('PRIVATE_CREATION_CANARY'); expect(success.stdout).not.toContain(root);
  const failed = spawnSync(process.execPath, [cli, '/PRIVATE_CREATION_CANARY_NOT_A_SOURCE', directory, id(9), recipient, ageBinary, now], { encoding: 'utf8' });
  expect(failed.status).toBe(1); expect(failed.stdout).toBe(''); expect(failed.stderr.trim()).toBe('CONTROL_BACKUP_CREATE_FAILED');
});
