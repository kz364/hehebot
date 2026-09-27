import * as age from 'age-encryption';
import { exportControl } from './control-export';
import type { Store } from './store';

/** Nightly off-host encrypted control-plane backup (Shrunk-scope "Backups" row).
 * Produces the existing `hehebot-control-export` logical snapshot from a single
 * synchronous DO transaction (see control-export.ts), encrypts it in-Worker to
 * an age X25519 recipient using the `age-encryption` package (typage; no
 * shelling out, no native binary in the Worker), and writes it plus a small
 * plaintext-adjacent JSON manifest to an R2 bucket. This is not a native/Sprite
 * backup and proves nothing about restore admission — see docs/BACKUPS.md and
 * scripts/restore-control-backup.mjs for the offline verified reconstruction
 * path via scripts/import-control-export.mjs.
 */

export const BACKUP_PREFIX = 'control/';
export const KEEP_BACKUPS = 14;
export const STALE_MS = 48 * 60 * 60 * 1000;
export const BACKUP_LAST_KEY = 'backup:last';
export const BACKUP_NOTICE_STATE_KEY = 'backup:notice_state';
const RECIPIENT_RE = /^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$/;

export interface BackupObjectSummary { key: string }
/** Structural subset of the real Cloudflare R2Bucket binding; a live binding
 * satisfies this directly, and tests pass an in-memory fake. */
export interface BackupBucket {
 put(key: string, value: Uint8Array | ArrayBuffer | string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
 list(options: { prefix: string; cursor?: string }): Promise<{ objects: BackupObjectSummary[]; truncated: boolean; cursor?: string }>;
 delete(keys: string | string[]): Promise<void>;
}
export interface ScheduledBackupEnv { BACKUPS?: BackupBucket; HEHEBOT_BACKUP_AGE_RECIPIENT?: string }
export interface BackupManifest {
 format: 'hehebot-control-backup-manifest'; version: 1; created_at: string; schema_version: number;
 bytes: { plaintext: number; ciphertext: number };
 sha256: { plaintext: string; ciphertext: string };
 row_counts: Record<string, number>;
}
export type BackupOutcome =
 | { status: 'disabled' }
 | { status: 'ok'; key: string; manifest_key: string; bytes: number; sha256: string; deleted: number }
 | { status: 'failed'; error_code: string };
export interface BackupLastState { at: string; ok: boolean; key?: string; bytes?: number; sha256?: string; error_code?: string }
export type BackupCondition = 'ok' | 'BACKUP_FAILED' | 'BACKUP_STALE';

function pad(n: number): string { return String(n).padStart(2, '0'); }
/** control/YYYY/MM/DD/<iso>-<sha256-prefix>.age; lexicographic sort of the
 * whole key equals chronological order, which the retention/list logic relies on. */
export function backupObjectKey(now: Date, ciphertextSha256Hex: string): string {
 return `${BACKUP_PREFIX}${now.getUTCFullYear()}/${pad(now.getUTCMonth() + 1)}/${pad(now.getUTCDate())}/${now.toISOString()}-${ciphertextSha256Hex.slice(0, 12)}.age`;
}
export function manifestKeyFor(objectKey: string): string { return `${objectKey}.manifest.json`; }
/** Given every `.age` key currently in the bucket, return the ones to delete so
 * only the newest `keep` remain. Pure so retention math is unit-testable
 * without a bucket. */
export function pruneKeys(ageKeys: string[], keep = KEEP_BACKUPS): string[] {
 const sorted = [...new Set(ageKeys)].sort();
 const excess = sorted.length - keep;
 return excess > 0 ? sorted.slice(0, excess) : [];
}
async function sha256Hex(bytes: Uint8Array): Promise<string> {
 const digest = await crypto.subtle.digest('SHA-256', bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
 return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function errorCode(error: unknown): string {
 const message = error instanceof Error ? error.message : String(error);
 return /^[A-Z][A-Z0-9_]*$/.test(message) ? message : 'BACKUP_FAILED';
}
async function listAgeKeys(bucket: BackupBucket): Promise<string[]> {
 const keys: string[] = []; let cursor: string | undefined;
 do {
  const page = await bucket.list({ prefix: BACKUP_PREFIX, cursor });
  for (const object of page.objects) if (object.key.endsWith('.age')) keys.push(object.key);
  cursor = page.truncated ? page.cursor : undefined;
 } while (cursor);
 return keys;
}
async function pruneOldBackups(bucket: BackupBucket): Promise<number> {
 const toDelete = pruneKeys(await listAgeKeys(bucket));
 if (!toDelete.length) return 0;
 await bucket.delete(toDelete.flatMap(key => [key, manifestKeyFor(key)]));
 return toDelete.length;
}
function recordOutcome(store: Store, now: Date, outcome: BackupOutcome): void {
 if (outcome.status === 'disabled') return;
 const state: BackupLastState = outcome.status === 'ok'
  ? { at: now.toISOString(), ok: true, key: outcome.key, bytes: outcome.bytes, sha256: outcome.sha256 }
  : { at: now.toISOString(), ok: false, error_code: outcome.error_code };
 store.db.exec('INSERT INTO runtime_metadata(key,value_json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json', BACKUP_LAST_KEY, JSON.stringify(state));
}
export function readBackupLast(store: Store): BackupLastState | undefined {
 const row = store.db.all<{ value_json: string }>('SELECT value_json FROM runtime_metadata WHERE key=?', BACKUP_LAST_KEY)[0];
 return row ? JSON.parse(row.value_json) as BackupLastState : undefined;
}
export function backupCondition(last: BackupLastState | undefined, now: Date, staleMs = STALE_MS): BackupCondition | null {
 if (!last) return null; // Never attempted (feature just enabled, or first run pending): nothing to alert on yet.
 if (!last.ok) return 'BACKUP_FAILED';
 return now.getTime() - Date.parse(last.at) > staleMs ? 'BACKUP_STALE' : 'ok';
}
/** Notice-once: posts a `degraded` notice only when the condition actually
 * changes (matches the memoryNotice/STUCK_NO_PROGRESS pattern elsewhere in
 * core/lifecycle.ts and core/progress-watchdog.ts). Call this both right after
 * a backup attempt and from the periodic reconcile pass, so staleness between
 * runs is also caught without waiting for the next cron trigger. */
export function reconcileBackupNotice(store: Store, uuid: () => string, now: Date): void {
 const condition = backupCondition(readBackupLast(store), now);
 if (condition === null) return;
 const row = store.db.all<{ value_json: string }>('SELECT value_json FROM runtime_metadata WHERE key=?', BACKUP_NOTICE_STATE_KEY)[0];
 const previous = row ? (JSON.parse(row.value_json) as { condition: BackupCondition }).condition : undefined;
 if (previous === condition) return;
 store.db.exec('INSERT INTO runtime_metadata(key,value_json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json', BACKUP_NOTICE_STATE_KEY, JSON.stringify({ condition }));
 if (condition === 'ok') return; // Recovery is recorded silently; only a degraded transition posts a notice.
 store.event(uuid(), null, 'notice', 'system', null, { kind: 'degraded', reason: condition }, now.toISOString());
}

/** Bounded end-to-end wall-clock budget for one scheduled backup attempt.
 * Export size/rows are already bounded by exportControl; this additionally
 * bounds the encrypt+upload tail so a stalled R2 call fails closed instead of
 * leaving the alarm/cron path hanging. */
const DEFAULT_DEADLINE_MS = 20000;

export async function runScheduledBackup(store: Store, env: ScheduledBackupEnv, now: Date, uuid: () => string, deadlineMs = DEFAULT_DEADLINE_MS): Promise<BackupOutcome> {
 const { BACKUPS: bucket, HEHEBOT_BACKUP_AGE_RECIPIENT: recipient } = env;
 if (!bucket || !recipient) return { status: 'disabled' };
 const start = Date.now();
 let outcome: BackupOutcome;
 try {
  if (!RECIPIENT_RE.test(recipient)) throw new Error('RECIPIENT_INVALID');
  // One synchronous DO transaction/read (see control-export.ts); nothing
  // async happens until this consistent snapshot is already in memory.
  const plaintextText = exportControl(store.db, now.toISOString());
  const plaintext = new TextEncoder().encode(plaintextText);
  const parsed = JSON.parse(plaintextText) as { schemaVersions: number[]; tables: { name: string; rows: unknown[] }[] };
  const rowCounts = Object.fromEntries(parsed.tables.map(table => [table.name, table.rows.length]));
  if (Date.now() - start > deadlineMs) throw new Error('BACKUP_TIMEOUT');
  const encrypter = new age.Encrypter(); encrypter.addRecipient(recipient);
  const ciphertext = await encrypter.encrypt(plaintext);
  if (Date.now() - start > deadlineMs) throw new Error('BACKUP_TIMEOUT');
  const [plaintextSha256, ciphertextSha256] = await Promise.all([sha256Hex(plaintext), sha256Hex(ciphertext)]);
  const key = backupObjectKey(now, ciphertextSha256), manifestKey = manifestKeyFor(key);
  const manifest: BackupManifest = { format: 'hehebot-control-backup-manifest', version: 1, created_at: now.toISOString(),
   schema_version: parsed.schemaVersions.at(-1)!, bytes: { plaintext: plaintext.byteLength, ciphertext: ciphertext.byteLength },
   sha256: { plaintext: plaintextSha256, ciphertext: ciphertextSha256 }, row_counts: rowCounts };
  await bucket.put(key, ciphertext, { httpMetadata: { contentType: 'application/octet-stream' } });
  try { await bucket.put(manifestKey, JSON.stringify(manifest), { httpMetadata: { contentType: 'application/json' } }); }
  catch (error) { await bucket.delete([key]).catch(() => {}); throw error; } // Never leave a ciphertext object without its manifest.
  const deleted = await pruneOldBackups(bucket);
  outcome = { status: 'ok', key, manifest_key: manifestKey, bytes: ciphertext.byteLength, sha256: ciphertextSha256, deleted };
 } catch (error) { outcome = { status: 'failed', error_code: errorCode(error) }; }
 recordOutcome(store, now, outcome);
 reconcileBackupNotice(store, uuid, now);
 return outcome;
}
