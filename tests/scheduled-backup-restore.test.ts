// End-to-end: Worker-side age-encryption (age-encryption npm package) →
// decrypt with the pinned `age` CLI → verify manifest → reconstruct via
// scripts/import-control-export.mjs. Skips visibly (not a failure) when the
// pinned age binary isn't present locally; see docs/BACKUPS.md.
import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync as realPath } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir as osTmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { fixture, bot } from './helpers';
import { runScheduledBackup, type BackupBucket, type BackupObjectSummary } from '../src/core/scheduled-backup';
import { restoreControlBackup } from '../scripts/restore-control-backup.mjs';

const tmpdir = () => realPath(osTmpdir());
const age = process.env.HEHEBOT_AGE_BIN ?? resolve('.local/age-v1.3.2/age/age');
const keygen = process.env.HEHEBOT_AGE_KEYGEN_BIN ?? resolve('.local/age-v1.3.2/age/age-keygen');
const ageAvailable = existsSync(age) && existsSync(keygen);

class FakeBucket implements BackupBucket {
  objects = new Map<string, Uint8Array | string>();
  async put(key: string, value: Uint8Array | ArrayBuffer | string) {
    this.objects.set(key, typeof value === 'string' ? value : value instanceof Uint8Array ? value : new Uint8Array(value));
  }
  async list(options: { prefix: string }) {
    const objects: BackupObjectSummary[] = [...this.objects.keys()].filter(k => k.startsWith(options.prefix)).sort().map(key => ({ key }));
    return { objects, truncated: false };
  }
  async delete(keys: string | string[]) { for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key); }
}

let f: ReturnType<typeof fixture>, directory: string;
beforeEach(async () => { f = fixture(); directory = await mkdtemp(join(tmpdir(), 'hehe-restore-e2e-')); });
afterEach(async () => { f.close(); await rm(directory, { recursive: true, force: true }); });

(ageAvailable ? it : it.skip)('decrypts a Worker-produced backup with the pinned age CLI and reconstructs identical row counts', async () => {
  expect(execFileSync(age, ['--version'], { encoding: 'utf8' }).trim()).toBe('v1.3.2');
  execFileSync(keygen, ['-o', join(directory, 'identity.txt')], { stdio: ['ignore', 'ignore', 'pipe'] });
  const recipient = execFileSync(keygen, ['-y', join(directory, 'identity.txt')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

  f.core.enqueue(bot, 'private instruction for e2e restore', null, null, null);
  const before = f.db.all('SELECT * FROM runs ORDER BY id');
  const bucket = new FakeBucket();
  const outcome = await runScheduledBackup(f.store, { BACKUPS: bucket, HEHEBOT_BACKUP_AGE_RECIPIENT: recipient }, new Date(f.core.now()), () => crypto.randomUUID());
  expect(outcome.status).toBe('ok');
  if (outcome.status !== 'ok') throw new Error('unreachable');

  const ciphertextPath = join(directory, 'backup.age'), manifestPath = join(directory, 'backup.manifest.json');
  await writeFile(ciphertextPath, bucket.objects.get(outcome.key) as Uint8Array, { mode: 0o600 });
  await writeFile(manifestPath, bucket.objects.get(outcome.manifest_key) as string, { mode: 0o600 });

  const snapshotDirectory = join(directory, 'restored');
  const result = await restoreControlBackup(ciphertextPath, manifestPath, join(directory, 'identity.txt'), age, snapshotDirectory);
  expect(result).toEqual({ status: 'verified', format: 'hehebot-control-snapshot', version: 1, application_only: true, activation_allowed: false });

  const { DatabaseSync } = await import('node:sqlite');
  const restored = new DatabaseSync(join(snapshotDirectory, 'control.sqlite'), { readOnly: true });
  try { expect(restored.prepare('SELECT * FROM runs ORDER BY id').all()).toEqual(before); }
  finally { restored.close(); }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  expect(manifest.row_counts.runs).toBe(1);
});

(ageAvailable ? it : it.skip)('rejects a tampered ciphertext before ever invoking the importer', async () => {
  execFileSync(keygen, ['-o', join(directory, 'identity.txt')], { stdio: ['ignore', 'ignore', 'pipe'] });
  const recipient = execFileSync(keygen, ['-y', join(directory, 'identity.txt')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const bucket = new FakeBucket();
  const outcome = await runScheduledBackup(f.store, { BACKUPS: bucket, HEHEBOT_BACKUP_AGE_RECIPIENT: recipient }, new Date(f.core.now()), () => crypto.randomUUID());
  if (outcome.status !== 'ok') throw new Error('unreachable');
  const ciphertext = bucket.objects.get(outcome.key) as Uint8Array;
  const tampered = new Uint8Array(ciphertext); tampered[tampered.length - 1] ^= 0xff;
  const ciphertextPath = join(directory, 'backup.age'), manifestPath = join(directory, 'backup.manifest.json');
  await writeFile(ciphertextPath, tampered, { mode: 0o600 });
  await writeFile(manifestPath, bucket.objects.get(outcome.manifest_key) as string, { mode: 0o600 });
  await expect(restoreControlBackup(ciphertextPath, manifestPath, join(directory, 'identity.txt'), age, join(directory, 'restored'))).rejects.toMatchObject({ message: 'CIPHERTEXT_MISMATCH' });
});

if (!ageAvailable) it('age CLI unavailable: e2e restore tests skipped (set HEHEBOT_AGE_BIN or .local/age-v1.3.2/age/age)', () => { expect(ageAvailable).toBe(false); });
