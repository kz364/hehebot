import * as age from 'age-encryption';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { fixture, bot } from './helpers';
import {
  backupObjectKey, backupCondition, BACKUP_LAST_KEY, BACKUP_NOTICE_STATE_KEY, KEEP_BACKUPS,
  manifestKeyFor, pruneKeys, readBackupLast, reconcileBackupNotice, runScheduledBackup,
  type BackupBucket, type BackupManifest, type BackupObjectSummary,
} from '../src/core/scheduled-backup';

let f: ReturnType<typeof fixture>;
beforeEach(() => { f = fixture(); });
afterEach(() => f.close());

/** In-memory stand-in for the real R2Bucket binding; structurally compatible
 * (put/list/delete), so the production code path is unchanged in tests. */
class FakeBucket implements BackupBucket {
  objects = new Map<string, { value: Uint8Array | string; contentType?: string }>();
  async put(key: string, value: Uint8Array | ArrayBuffer | string, options?: { httpMetadata?: { contentType?: string } }) {
    const stored = typeof value === 'string' ? value : value instanceof Uint8Array ? value : new Uint8Array(value);
    this.objects.set(key, { value: stored, contentType: options?.httpMetadata?.contentType });
  }
  async list(options: { prefix: string; cursor?: string }) {
    const all = [...this.objects.keys()].filter(k => k.startsWith(options.prefix)).sort();
    const start = options.cursor ? Number(options.cursor) : 0;
    const page = all.slice(start, start + 2); // Small page size on purpose, to exercise pagination.
    const objects: BackupObjectSummary[] = page.map(key => ({ key }));
    const truncated = start + page.length < all.length;
    return { objects, truncated, cursor: truncated ? String(start + page.length) : undefined };
  }
  async delete(keys: string | string[]) { for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key); }
}

async function recipient() {
  const identity = await age.generateIdentity();
  return { identity, recipient: await age.identityToRecipient(identity) };
}

it('does nothing when BACKUPS or the recipient is unconfigured (feature off)', async () => {
  const bucket = new FakeBucket();
  await expect(runScheduledBackup(f.store, {}, new Date(f.core.now()), () => crypto.randomUUID())).resolves.toEqual({ status: 'disabled' });
  await expect(runScheduledBackup(f.store, { BACKUPS: bucket }, new Date(f.core.now()), () => crypto.randomUUID())).resolves.toEqual({ status: 'disabled' });
  const { recipient: r } = await recipient();
  await expect(runScheduledBackup(f.store, { HEHEBOT_BACKUP_AGE_RECIPIENT: r }, new Date(f.core.now()), () => crypto.randomUUID())).resolves.toEqual({ status: 'disabled' });
  expect(bucket.objects.size).toBe(0);
  expect(readBackupLast(f.store)).toBeUndefined(); // Disabled must not even touch runtime_metadata.
});

it('produces one age ciphertext + manifest that decrypt to the exact exportControl snapshot', async () => {
  f.core.enqueue(bot, 'private instruction for backup', null, null, null);
  const bucket = new FakeBucket();
  const { identity, recipient: r } = await recipient();
  const now = new Date(f.core.now());
  const outcome = await runScheduledBackup(f.store, { BACKUPS: bucket, HEHEBOT_BACKUP_AGE_RECIPIENT: r }, now, () => crypto.randomUUID());
  expect(outcome.status).toBe('ok');
  if (outcome.status !== 'ok') throw new Error('unreachable');
  expect(outcome.key).toBe(backupObjectKey(now, outcome.sha256));
  expect(outcome.manifest_key).toBe(manifestKeyFor(outcome.key));
  expect(outcome.deleted).toBe(0);
  const ciphertext = bucket.objects.get(outcome.key)!.value as Uint8Array;
  const manifest = JSON.parse(bucket.objects.get(outcome.manifest_key)!.value as string) as BackupManifest;
  expect(manifest.format).toBe('hehebot-control-backup-manifest');
  expect(manifest.schema_version).toBe(20);
  expect(manifest.bytes.ciphertext).toBe(ciphertext.byteLength);
  const decrypter = new age.Decrypter(); decrypter.addIdentity(identity);
  const plaintext = await decrypter.decrypt(ciphertext, 'text');
  const parsed = JSON.parse(plaintext) as { tables: { name: string; rows: unknown[] }[] };
  expect(Object.fromEntries(parsed.tables.map(t => [t.name, t.rows.length]))).toEqual(manifest.row_counts);
  expect(manifest.sha256.plaintext).toBe(await sha256Hex(new TextEncoder().encode(plaintext)));
  const last = readBackupLast(f.store);
  expect(last).toMatchObject({ ok: true, key: outcome.key, sha256: outcome.sha256 });
});

async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

it('keeps only the newest 14 daily objects and prunes ciphertext+manifest pairs together', async () => {
  const bucket = new FakeBucket();
  const { recipient: r } = await recipient();
  for (let day = 1; day <= KEEP_BACKUPS + 3; day++) {
    const now = new Date(Date.UTC(2026, 0, day, 20, 0, 0));
    f.setNow(now.toISOString());
    const outcome = await runScheduledBackup(f.store, { BACKUPS: bucket, HEHEBOT_BACKUP_AGE_RECIPIENT: r }, now, () => crypto.randomUUID());
    expect(outcome.status).toBe('ok');
  }
  const ageKeys = [...bucket.objects.keys()].filter(k => k.endsWith('.age'));
  const manifestKeys = [...bucket.objects.keys()].filter(k => k.endsWith('.manifest.json'));
  expect(ageKeys.length).toBe(KEEP_BACKUPS);
  expect(manifestKeys.length).toBe(KEEP_BACKUPS);
  expect(ageKeys.every(key => bucket.objects.has(manifestKeyFor(key)))).toBe(true);
  // Kept objects are the most recent ones: none from day 1 should remain.
  expect(ageKeys.some(key => key.includes('2026-01-01T'))).toBe(false);
});

it('pruneKeys is pure retention math: sorts, dedupes, keeps only the newest `keep`', () => {
  expect(pruneKeys(['control/a', 'control/b', 'control/c'], 2)).toEqual(['control/a']);
  expect(pruneKeys(['control/b', 'control/a', 'control/a'], 1)).toEqual(['control/a']);
  expect(pruneKeys(['control/a'], 14)).toEqual([]);
});

it('fails closed without a partial write when the recipient is malformed', async () => {
  const bucket = new FakeBucket();
  const now = new Date(f.core.now());
  const outcome = await runScheduledBackup(f.store, { BACKUPS: bucket, HEHEBOT_BACKUP_AGE_RECIPIENT: 'not-a-recipient' }, now, () => crypto.randomUUID());
  expect(outcome).toEqual({ status: 'failed', error_code: 'RECIPIENT_INVALID' });
  expect(bucket.objects.size).toBe(0);
  expect(readBackupLast(f.store)).toMatchObject({ ok: false, error_code: 'RECIPIENT_INVALID' });
});

it('deletes the ciphertext object if the manifest write fails, never leaving an orphan', async () => {
  const bucket = new FakeBucket();
  const { recipient: r } = await recipient();
  const originalPut = bucket.put.bind(bucket);
  bucket.put = async (key, value, options) => { if (key.endsWith('.manifest.json')) throw new Error('R2_UNAVAILABLE'); return originalPut(key, value, options); };
  const outcome = await runScheduledBackup(f.store, { BACKUPS: bucket, HEHEBOT_BACKUP_AGE_RECIPIENT: r }, new Date(f.core.now()), () => crypto.randomUUID());
  expect(outcome.status).toBe('failed');
  expect(bucket.objects.size).toBe(0);
});

it('respects a bounded wall-clock deadline and fails closed instead of hanging', async () => {
  const bucket = new FakeBucket();
  const { recipient: r } = await recipient();
  const outcome = await runScheduledBackup(f.store, { BACKUPS: bucket, HEHEBOT_BACKUP_AGE_RECIPIENT: r }, new Date(f.core.now()), () => crypto.randomUUID(), 0);
  expect(outcome).toEqual({ status: 'failed', error_code: 'BACKUP_TIMEOUT' });
});

it('backupCondition: null before any attempt, then failed/stale/ok by last outcome', () => {
  const now = new Date('2026-09-10T00:00:00.000Z');
  expect(backupCondition(undefined, now)).toBeNull();
  expect(backupCondition({ at: now.toISOString(), ok: false, error_code: 'X' }, now)).toBe('BACKUP_FAILED');
  expect(backupCondition({ at: now.toISOString(), ok: true }, now)).toBe('ok');
  const stale = new Date(now.getTime() + 49 * 60 * 60 * 1000);
  expect(backupCondition({ at: now.toISOString(), ok: true }, stale)).toBe('BACKUP_STALE');
  const fresh = new Date(now.getTime() + 47 * 60 * 60 * 1000);
  expect(backupCondition({ at: now.toISOString(), ok: true }, fresh)).toBe('ok');
});

it('posts a degraded notice once per changed condition, not on every reconcile', () => {
  const now = f.core.now();
  f.db.exec('INSERT INTO runtime_metadata(key,value_json) VALUES(?,?)', BACKUP_LAST_KEY, JSON.stringify({ at: now, ok: false, error_code: 'BACKUP_FAILED' }));
  reconcileBackupNotice(f.store, () => crypto.randomUUID(), new Date(now));
  reconcileBackupNotice(f.store, () => crypto.randomUUID(), new Date(now));
  reconcileBackupNotice(f.store, () => crypto.randomUUID(), new Date(now));
  const notices = f.db.all<{ payload_json: string }>("SELECT payload_json FROM events WHERE type='notice'");
  expect(notices).toHaveLength(1);
  expect(JSON.parse(notices[0].payload_json)).toEqual({ kind: 'degraded', reason: 'BACKUP_FAILED' });
  // Recovery clears the marker silently (no extra notice), and a repeat failure posts again.
  f.db.exec('UPDATE runtime_metadata SET value_json=? WHERE key=?', JSON.stringify({ at: now, ok: true, key: 'k', bytes: 1, sha256: 'a' }), BACKUP_LAST_KEY);
  reconcileBackupNotice(f.store, () => crypto.randomUUID(), new Date(now));
  expect(f.db.all("SELECT 1 FROM events WHERE type='notice'")).toHaveLength(1);
  f.db.exec('UPDATE runtime_metadata SET value_json=? WHERE key=?', JSON.stringify({ at: now, ok: false, error_code: 'BACKUP_FAILED' }), BACKUP_LAST_KEY);
  reconcileBackupNotice(f.store, () => crypto.randomUUID(), new Date(now));
  expect(f.db.all("SELECT 1 FROM events WHERE type='notice'")).toHaveLength(2);
  expect(f.db.all<{ value_json: string }>('SELECT value_json FROM runtime_metadata WHERE key=?', BACKUP_NOTICE_STATE_KEY)[0].value_json).toBe(JSON.stringify({ condition: 'BACKUP_FAILED' }));
});

it('does nothing before any backup has ever been attempted (feature just enabled)', () => {
  reconcileBackupNotice(f.store, () => crypto.randomUUID(), new Date(f.core.now()));
  expect(f.db.all("SELECT 1 FROM events WHERE type='notice'")).toEqual([]);
});
