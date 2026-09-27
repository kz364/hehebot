import { createHash } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir as osTmpdir } from 'node:os';
import { realpathSync as realPath } from 'node:fs';
// The backup scripts refuse symlinked path components; macOS tmpdir() is under the /var symlink.
const tmpdir = () => realPath(osTmpdir());
import { afterAll, afterEach, beforeAll, beforeEach, expect, it as test, vi } from 'vitest';
import { existsSync } from 'node:fs';
// The prune lock pins Linux /usr/bin/flock (backups run on the Linux runtime); skip visibly elsewhere.
const it = test.skipIf(!existsSync('/usr/bin/flock'));

const fault = vi.hoisted(() => ({ call: 0, at: 0, after: false, afterInventoryRename: false, receiptRename: '' }));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: async (source: string, destination: string) => {
    const receipt = fault.receiptRename && destination.includes('/.prune/') &&
      Object.values(JSON.parse(await actual.readFile(source, 'utf8')).states).includes('deleted');
    if (receipt && fault.receiptRename === 'before') throw new Error('SYNTHETIC_RECEIPT_RENAME');
    await actual.rename(source, destination);
    if (receipt && fault.receiptRename === 'after') throw new Error('SYNTHETIC_RECEIPT_RENAME');
    if (fault.afterInventoryRename && destination.endsWith('/inventory.json')) throw new Error('SYNTHETIC_INVENTORY_RENAME');
  }, unlink: async (path: string) => {
    const fail = path.endsWith('.age') && ++fault.call === fault.at;
    if (fail && !fault.after) throw new Error('SYNTHETIC_BEFORE_UNLINK');
    await actual.unlink(path);
    if (fail) throw new Error('SYNTHETIC_AFTER_UNLINK');
  } };
});
import { applyControlBackups, reviewControlBackups, controlBackupPruneStatus, withBackupDirectoryLock, CONFIRM_LOCAL_DELETION } from '../scripts/prune-control-backups.mjs';

const age = process.env.HEHEBOT_AGE_BIN ?? resolve('.local/age-v1.3.2/age/age'), keygen = process.env.HEHEBOT_AGE_KEYGEN_BIN ?? resolve('.local/age-v1.3.2/age/age-keygen');
const cli = decodeURIComponent(new URL('../scripts/prune-control-backups.mjs', import.meta.url).pathname);
const now = '2026-09-28T17:00:00.000Z'; // Tuesday00:00 Jakarta.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
let fixtures: string, root: string, directory: string, recipient: string;
let encrypted: Buffer[];
let catalog: { version: number; backups: { id: string; snapshot_at: string; bytes: number; sha256: string }[] };
const path = (n: number) => join(directory, id(n) + '.age');
const save = () => writeFile(join(directory, 'inventory.json'), JSON.stringify(catalog) + '\n', { mode: 0o600 });
const authorize = (digest: string) => applyControlBackups(directory, digest, CONFIRM_LOCAL_DELETION);
async function live() { return (await readdir(directory)).filter(name => name.endsWith('.age')).sort(); }
async function keptBytes() { return Promise.all([3, 4, 5].map(async n => hash(await readFile(path(n))))); }
beforeAll(async () => {
  fixtures = await mkdtemp(join(tmpdir(), 'hehe-prune-age-'));
  const identity = join(fixtures, 'identity');
  expect(execFileSync(age, ['--version'], { encoding: 'utf8' }).trim()).toBe('v1.3.2');
  execFileSync(keygen, ['-o', identity], { stdio: ['ignore', 'ignore', 'pipe'] }); await chmod(identity, 0o600);
  recipient = execFileSync(keygen, ['-y', identity], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  encrypted = Array.from({ length: 5 }, (_, n) => execFileSync(age, ['-r', recipient], { input: `PRIVATE_SYNTHETIC_PRUNE_CANARY_${n}`.repeat(n + 1), stdio: ['pipe', 'pipe', 'pipe'] }));
});
afterAll(async () => { await rm(fixtures, { recursive: true, force: true }); });
beforeEach(async () => {
  fault.call = 0; fault.at = 0; fault.after = false; fault.afterInventoryRename = false; fault.receiptRename = '';
  root = await mkdtemp(join(tmpdir(), 'hehe-prune-')); directory = join(root, 'backups'); await mkdir(directory, { mode: 0o700 });
  const timestamps = ['2026-08-31T17:00:00.000Z', '2026-09-28T16:00:00.000Z', '2026-09-28T16:59:59.999Z', '2026-09-28T17:00:00.000Z', '2026-09-06T17:00:00.000Z'];
  catalog = { version: 1, backups: encrypted.map((bytes, index) => ({ id: id(index + 1), snapshot_at: timestamps[index], bytes: bytes.length, sha256: hash(bytes) })) };
  for (let n = 1; n <= 5; n++) await writeFile(path(n), encrypted[n - 1], { mode: 0o600 });
  await save();
});
afterEach(async () => { fault.at = 0; await rm(root, { recursive: true, force: true }); });

it('reviews all real age ciphertext, then prunes exact28-day and superseded files only with confirmation', async () => {
  const before = await keptBytes(), oldCatalog = await readFile(join(directory, 'inventory.json'));
  const review = await reviewControlBackups(directory, now);
  expect(review.plan.policy.decisions.map(row => [row.id, row.action, row.reason])).toEqual([
    [id(1), 'expire', 'maximum_age'], [id(2), 'expire', 'not_selected'], [id(3), 'keep', 'bucket_selected'],
    [id(4), 'keep', 'bucket_selected'], [id(5), 'keep', 'bucket_selected'],
  ]);
  expect(await readFile(join(directory, 'inventory.json'))).toEqual(oldCatalog); expect(await live()).toHaveLength(5);
  expect((await reviewControlBackups(directory, now)).digest).toBe(review.digest);
  await expect(applyControlBackups(directory, review.digest, 'no')).rejects.toMatchObject({ code: 'PRUNE_CONFIRMATION_REQUIRED' });
  const result = await authorize(review.digest);
  expect(result.phase).toBe('complete'); expect(result.deletions.map(row => row.state)).toEqual(['deleted', 'deleted']);
  expect(result.deletions.map(row => row.sha256)).toEqual(catalog.backups.slice(0, 2).map(row => row.sha256));
  expect(await live()).toEqual([3, 4, 5].map(n => id(n) + '.age')); expect(await keptBytes()).toEqual(before);
  expect(JSON.parse(await readFile(join(directory, 'inventory.json'), 'utf8')).backups).toEqual(catalog.backups.slice(2));
  expect(await authorize(review.digest)).toEqual(result); expect(fault.call).toBe(2);
  expect(await controlBackupPruneStatus(directory, review.digest)).toEqual(result);
  for (const name of await readdir(join(directory, '.prune'))) expect((await lstat(join(directory, '.prune', name))).mode & 0o777).toBe(0o600);
});

it('rejects wrong digest or changed metadata before any deletion', async () => {
  const review = await reviewControlBackups(directory, now);
  await expect(authorize('a'.repeat(64))).rejects.toMatchObject({ code: 'PRUNE_REVIEW_MISMATCH' });
  catalog.backups[0].snapshot_at = '2026-08-30T17:00:00.000Z'; await save();
  await expect(authorize(review.digest)).rejects.toMatchObject({ code: 'PRUNE_REVIEW_MISMATCH' });
  expect(await live()).toHaveLength(5); expect(fault.call).toBe(0);
});

it.each([1, 4])('rejects same-byte inode replacement of candidate or kept file %i', async n => {
  const review = await reviewControlBackups(directory, now);
  const replacement = join(root, 'replacement'); await writeFile(replacement, encrypted[n - 1], { mode: 0o600 }); await rename(replacement, path(n));
  await expect(authorize(review.digest)).rejects.toThrow(); expect(fault.call).toBe(0); expect(await live()).toHaveLength(5);
});

it('rehashes kept ciphertext instead of trusting catalog or only candidates', async () => {
  const review = await reviewControlBackups(directory, now);
  const bytes = Buffer.from(encrypted[3]); bytes[bytes.length - 1] ^= 1; await writeFile(path(4), bytes);
  await expect(authorize(review.digest)).rejects.toThrow(); expect(fault.call).toBe(0);
  await expect(reviewControlBackups(directory, now)).rejects.toThrow();
});

it.each(['extra', 'missing', 'symlink', 'hardlink', 'public-file', 'public-directory', 'invalid-magic'])('rejects unsafe/incomplete directory %s', async mode => {
  if (mode === 'extra') await writeFile(join(directory, 'unknown.txt'), 'PRIVATE_CANARY');
  if (mode === 'missing') await rm(path(3));
  if (mode === 'symlink') { await rename(path(3), join(root, 'original')); await symlink(join(root, 'original'), path(3)); }
  if (mode === 'hardlink') await link(path(3), join(root, 'alias'));
  if (mode === 'public-file') await chmod(path(3), 0o644);
  if (mode === 'public-directory') await chmod(directory, 0o755);
  if (mode === 'invalid-magic') { const bytes = Buffer.from(encrypted[2]); bytes[0] = 0; await writeFile(path(3), bytes); catalog.backups[2].sha256 = hash(bytes); await save(); }
  await expect(reviewControlBackups(directory, now)).rejects.toThrow(); expect(fault.call).toBe(0);
});

it('proves inherited-descriptor kernel lock survives helper exit and blocks independent processes', async () => {
  await withBackupDirectoryLock(directory, async () => {
    await expect(reviewControlBackups(directory, now)).rejects.toMatchObject({ code: 'PRUNE_LOCK_BUSY' });
    const contender = spawnSync('/usr/bin/flock', ['-n', '-E', '73', join(directory, '.prune.lock'), 'true']);
    expect(contender.status).toBe(73);
    const child = spawnSync(process.execPath, [cli, 'review', directory, now], { encoding: 'utf8', timeout: 10000 });
    expect(child.status).toBe(1); expect(child.stderr).toBe('CONTROL_BACKUP_PRUNE_FAILED\n');
  });
  expect((await reviewControlBackups(directory, now)).digest).toMatch(/^[a-f0-9]{64}$/);
});

it('kernel releases the stable lock after holder process death', async () => {
  const moduleURL = new URL('../scripts/prune-control-backups.mjs', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import {withBackupDirectoryLock} from ${JSON.stringify(moduleURL)};
    await withBackupDirectoryLock(${JSON.stringify(directory)}, async () => {
      process.stdout.write('locked'); await new Promise(resolve => setTimeout(resolve, 10000));
    });`], { stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('LOCK_FIXTURE_TIMEOUT')), 3000);
      child.stdout.once('data', bytes => { clearTimeout(timeout); if (bytes.toString() === 'locked') resolve(); else reject(new Error('LOCK_FIXTURE_FAILED')); });
    });
    await expect(reviewControlBackups(directory, now)).rejects.toMatchObject({ code: 'PRUNE_LOCK_BUSY' });
  } finally { child.kill('SIGKILL'); await exited; }
  expect((await reviewControlBackups(directory, now)).digest).toMatch(/^[a-f0-9]{64}$/);
});

it.each(['duplicate', 'future', 'path', 'extra-metadata', 'bytes'])('rejects malformed inventory %s', async mode => {
  if (mode === 'duplicate') catalog.backups[1].id = catalog.backups[0].id;
  if (mode === 'future') catalog.backups[1].snapshot_at = '2026-09-28T17:00:00.001Z';
  if (mode === 'path') catalog.backups[1].id = '../PRIVATE_CANARY';
  if (mode === 'extra-metadata') (catalog.backups[1] as any).credential = 'PRIVATE_CANARY';
  if (mode === 'bytes') catalog.backups[1].bytes = 1;
  await save(); await expect(reviewControlBackups(directory, now)).rejects.toThrow(); expect(fault.call).toBe(0);
});

it('rejects metadata/lock symlinks and a noncanonical directory path', async () => {
  const outside = join(root, 'outside'); await writeFile(outside, '', { mode: 0o600 });
  await symlink(outside, join(directory, '.prune.lock'));
  await expect(reviewControlBackups(directory, now)).rejects.toThrow(); await rm(join(directory, '.prune.lock'));
  await rename(join(directory, 'inventory.json'), join(root, 'catalog')); await symlink(join(root, 'catalog'), join(directory, 'inventory.json'));
  await expect(reviewControlBackups(directory, now)).rejects.toThrow();
  await expect(reviewControlBackups(directory + '/.', now)).rejects.toThrow(); expect(fault.call).toBe(0);
});

it('rejects rolled-back metadata after completion and tampered reviewed plans', async () => {
  const { digest } = await reviewControlBackups(directory, now); await authorize(digest); const count = fault.call;
  await save(); await expect(authorize(digest)).rejects.toMatchObject({ code: 'PRUNE_REVIEW_MISMATCH' }); expect(fault.call).toBe(count);
  const journal = join(directory, '.prune', digest + '.json');
  const value = JSON.parse(await readFile(journal, 'utf8')); value.plan.entries[0].sha256 = 'a'.repeat(64); await writeFile(journal, JSON.stringify(value));
  await expect(controlBackupPruneStatus(directory, digest)).rejects.toThrow(); expect(fault.call).toBe(count);
});

it('reopens partial apply with exact deleted hash receipt and resumes only original remaining files', async () => {
  const { digest } = await reviewControlBackups(directory, now); const before = await keptBytes();
  fault.at = 2; await expect(authorize(digest)).rejects.toThrow('SYNTHETIC_BEFORE_UNLINK');
  expect((await controlBackupPruneStatus(directory, digest)).deletions.map(row => row.state)).toEqual(['deleted', 'deleting']);
  await expect(reviewControlBackups(directory, now)).rejects.toMatchObject({ code: 'PRUNE_INCOMPLETE_APPLY' });
  fault.at = 0;
  const reopened = spawnSync(process.execPath, [cli, 'apply', directory, digest, '--confirm-local-deletion'], { encoding: 'utf8', timeout: 15000 });
  expect(reopened.status).toBe(0); expect(JSON.parse(reopened.stdout).phase).toBe('complete');
  expect((await controlBackupPruneStatus(directory, digest)).deletions.map(row => row.state)).toEqual(['deleted', 'deleted']);
  expect(await keptBytes()).toEqual(before); expect(await live()).toHaveLength(3);
});

it('recovers inventory publication before the completion receipt without deleting twice', async () => {
  const { digest } = await reviewControlBackups(directory, now);
  fault.afterInventoryRename = true; await expect(authorize(digest)).rejects.toThrow('SYNTHETIC_INVENTORY_RENAME');
  expect((await controlBackupPruneStatus(directory, digest)).phase).toBe('applying');
  expect(JSON.parse(await readFile(join(directory, 'inventory.json'), 'utf8')).backups).toEqual(catalog.backups.slice(2));
  fault.afterInventoryRename = false;
  expect((await authorize(digest)).phase).toBe('complete'); expect(fault.call).toBe(2);
});

it('refuses a replacement at an already-deleted identity during retry', async () => {
  const { digest } = await reviewControlBackups(directory, now);
  fault.at = 2; await expect(authorize(digest)).rejects.toThrow(); fault.at = 0;
  await writeFile(path(1), encrypted[0], { mode: 0o600 });
  await expect(authorize(digest)).rejects.toThrow(); expect(fault.call).toBe(2);
  expect(await readFile(path(1))).toEqual(encrypted[0]); expect(await live()).toHaveLength(5);
});

it('never converts crash-after-unlink ambiguity into a confirmed deletion', async () => {
  const { digest } = await reviewControlBackups(directory, now); const before = await keptBytes();
  fault.at = 1; fault.after = true; await expect(authorize(digest)).rejects.toThrow('SYNTHETIC_AFTER_UNLINK'); fault.at = 0;
  await expect(authorize(digest)).rejects.toMatchObject({ code: 'PRUNE_OUTCOME_UNKNOWN' });
  expect((await controlBackupPruneStatus(directory, digest)).deletions.map(row => row.state)).toEqual(['deleting', 'pending']);
  expect(fault.call).toBe(1); expect(await keptBytes()).toEqual(before); expect(await live()).toHaveLength(4);
});

it.each([
  ['pending', 'deleting'], ['pending', 'deleted'], ['deleting', 'deleting'], ['deleting', 'deleted'],
])('rejects unreachable applying states %s/%s without trusting receipts or deleting', async (first, second) => {
  const { digest } = await reviewControlBackups(directory, now);
  const journalPath = join(directory, '.prune', digest + '.json');
  const journal = JSON.parse(await readFile(journalPath, 'utf8'));
  journal.phase = 'applying'; journal.states = { [id(2)]: second, [id(1)]: first }; // Object order is not execution order.
  await writeFile(journalPath, JSON.stringify(journal));
  if (second === 'deleted') await rm(path(2)); // Previously sufficient to skip this unearned receipt on apply.
  const before = await readFile(journalPath), inventory = await readFile(join(directory, 'inventory.json'));
  const files = await live(), kept = await keptBytes();
  await expect(controlBackupPruneStatus(directory, digest)).rejects.toThrow('CONTROL_BACKUP_PRUNE_FAILED');
  await expect(authorize(digest)).rejects.toThrow('CONTROL_BACKUP_PRUNE_FAILED');
  await expect(reviewControlBackups(directory, now)).rejects.toThrow('CONTROL_BACKUP_PRUNE_FAILED');
  expect(await readFile(journalPath)).toEqual(before); expect(await readFile(join(directory, 'inventory.json'))).toEqual(inventory);
  expect(await live()).toEqual(files); expect(await keptBytes()).toEqual(kept); expect(fault.call).toBe(0);
});

it.each([
  ['pending', 'pending'], ['deleting', 'pending'], ['deleted', 'pending'], ['deleted', 'deleting'], ['deleted', 'deleted'],
])('resumes reachable applying states %s/%s in plan order despite reversed JSON keys', async (first, second) => {
  const { digest } = await reviewControlBackups(directory, now), before = await keptBytes();
  const journalPath = join(directory, '.prune', digest + '.json');
  const journal = JSON.parse(await readFile(journalPath, 'utf8'));
  journal.phase = 'applying'; journal.states = { [id(2)]: second, [id(1)]: first };
  await writeFile(journalPath, JSON.stringify(journal));
  if (first === 'deleted') await rm(path(1));
  if (second === 'deleted') await rm(path(2));
  expect((await controlBackupPruneStatus(directory, digest)).deletions.map(row => row.state)).toEqual([first, second]);
  expect((await authorize(digest)).phase).toBe('complete');
  expect(fault.call).toBe([first, second].filter(state => state !== 'deleted').length);
  expect(await live()).toEqual([3, 4, 5].map(n => id(n) + '.age')); expect(await keptBytes()).toEqual(before);
});

it.each(['before', 'after'])('preserves the actual receipt boundary when %s-rename journal persistence fails', async boundary => {
  const { digest } = await reviewControlBackups(directory, now), before = await keptBytes();
  fault.receiptRename = boundary;
  await expect(authorize(digest)).rejects.toThrow('SYNTHETIC_RECEIPT_RENAME'); fault.receiptRename = '';
  expect(await live()).toEqual([2, 3, 4, 5].map(n => id(n) + '.age')); expect(fault.call).toBe(1);
  const status = await controlBackupPruneStatus(directory, digest);
  expect(status.deletions.map(row => row.state)).toEqual([boundary === 'before' ? 'deleting' : 'deleted', 'pending']);
  expect(status.remote_copies_verified).toBe(false);
  if (boundary === 'before') {
    await expect(authorize(digest)).rejects.toThrow('PRUNE_OUTCOME_UNKNOWN'); expect(fault.call).toBe(1);
  } else {
    expect((await authorize(digest)).phase).toBe('complete'); expect(fault.call).toBe(2);
  }
  expect(await keptBytes()).toEqual(before);
  expect((await readdir(join(directory, '.prune'))).filter(name => name.endsWith('.next'))).toEqual([]);
});

it('does not treat a missing unattempted candidate as successful deletion', async () => {
  const { digest } = await reviewControlBackups(directory, now); await rm(path(2));
  await expect(authorize(digest)).rejects.toThrow(); expect(fault.call).toBe(0);
  expect((await controlBackupPruneStatus(directory, digest)).deletions.map(row => row.state)).toEqual(['pending', 'pending']);
});

it('CLI review/apply uses explicit confirmation and fixed redacted errors', async () => {
  const reviewed = spawnSync(process.execPath, [cli, 'review', directory, now], { encoding: 'utf8', timeout: 15000 });
  expect(reviewed.status).toBe(0); const { digest } = JSON.parse(reviewed.stdout);
  expect(reviewed.stdout).not.toContain(directory); expect(reviewed.stdout).not.toContain('PRIVATE_SYNTHETIC');
  const denied = spawnSync(process.execPath, [cli, 'apply', directory, digest], { encoding: 'utf8', timeout: 10000 });
  expect(denied.status).toBe(1); expect(denied.stderr).toBe('CONTROL_BACKUP_PRUNE_FAILED\n'); expect(await live()).toHaveLength(5);
  const applied = spawnSync(process.execPath, [cli, 'apply', directory, digest, '--confirm-local-deletion'], { encoding: 'utf8', timeout: 15000 });
  expect(applied.status).toBe(0); expect(JSON.parse(applied.stdout).phase).toBe('complete'); expect(await live()).toHaveLength(3);
});
