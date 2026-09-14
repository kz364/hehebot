import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmod, link, lstat, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { snapshotControl, verifyControl } from '../scripts/backup-control.mjs';

const schema = await readFile(process.env.HEHEBOT_BACKUP_TEST_SCHEMA ?? new URL('../DB/schema.sql', import.meta.url), 'utf8');
const cli = new URL('../scripts/backup-control.mjs', import.meta.url).pathname;
const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex');
let directory: string, source: string, destination: string, db: DatabaseSync;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'hehe-control-backup-'));
  source = join(directory, 'source.sqlite'); destination = join(directory, 'backup');
  await writeFile(source, '', { mode: 0o600 });
  db = new DatabaseSync(source); db.exec(schema);
  db.exec(`
    INSERT INTO objects VALUES ('persona-a','persona',7,'{"canary":"PRIVATE_CONTENT_731"}',NULL,'t1','t9');
    INSERT INTO objects VALUES ('trigger-b','trigger',3,'{}',NULL,'t2','t8');
    INSERT INTO object_revisions VALUES ('persona-a',2,'{"old":19}','owner',NULL,'t1');
    INSERT INTO object_revisions VALUES ('persona-a',7,'{"current":43}','owner',NULL,'t9');
    INSERT INTO commands VALUES ('command-c','owner','dedupe-83','hash-c','message.send','{}','applied','t3','root-r',NULL);
    INSERT INTO runs(id,command_id,persona_id,context_json,status,current_attempt,created_at,updated_at)
      VALUES ('root-r','command-c','persona-a','{}','completed',2,'t3','t7');
    INSERT INTO runs(id,persona_id,context_json,role,parent_run_id,status,current_attempt,created_at,updated_at)
      VALUES ('child-z','persona-a','{}','background','root-r','recovery_required',5,'t4','t8');
    INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,status,deadline_at,result_json)
      VALUES ('root-r',2,'submission-r',11,'boot-37','completed','t9','{"text":"root done"}');
    INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,status,deadline_at)
      VALUES ('child-z',5,'submission-z',11,'boot-37','running','t9');
    INSERT INTO native_task_links VALUES ('child-z','root-r',2,'native-child-51','session-child-61');
    INSERT INTO operations VALUES ('op-x','child-z',5,'tool','unknown','t4','t9','t5');
    INSERT INTO effects VALUES ('effect-y','child-z','action-29','mutation','outcome_unknown','policy-17','digest-31',NULL,'{"provider":"receipt-97"}','t8');
    INSERT INTO resource_locks VALUES ('calendar:83','child-z',5,'t4');
    INSERT INTO webhook_receipts VALUES ('trigger-b','event-webhook','body-91','command-c','t3');
    INSERT INTO events(id,type,actor_id,payload_json,created_at) VALUES ('event-71','message','owner','{}','t3');
    DELETE FROM events;
    INSERT INTO events(id,type,actor_id,payload_json,created_at) VALUES ('event-89','message','owner','{}','t5');
    INSERT INTO consumer_cursors VALUES ('consumer-31','room-19',89,71);
    INSERT INTO event_tombstones VALUES ('expired-17',17,'room-19','t1');
    INSERT INTO context_retention VALUES ('consumer-31','room-19',17);
  `);
});
afterEach(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });

it('includes committed WAL rows, excludes an uncommitted writer, preserves exact ledgers and database/WAL bytes', async () => {
  db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; UPDATE objects SET revision=11 WHERE id='persona-a'");
  expect((await lstat(source + '-wal')).size).toBeGreaterThan(0);
  const before = await Promise.all(['', '-wal'].map(s => readFile(source + s)));
  db.exec("BEGIN IMMEDIATE; UPDATE objects SET revision=99 WHERE id='persona-a'");
  const manifest = await snapshotControl(source, destination);
  expect(manifest.schemaVersions).toEqual([9]);
  expect(manifest.counts).toMatchObject({ objects: 2, object_revisions: 2, runs: 2, attempts: 2, effects: 1, resource_locks: 1, webhook_receipts: 1 });
  // SQLite's shared-memory reader marks are coordination state, not immutable database pages.
  expect(await Promise.all(['', '-wal'].map(async s => digest(await readFile(source + s))))).toEqual(before.map(digest));
  db.exec('ROLLBACK');
  const copy = new DatabaseSync(join(destination, 'control.sqlite'), { readOnly: true });
  try {
    expect(copy.prepare("SELECT revision FROM objects WHERE id='persona-a'").get()).toEqual({ revision: 11 });
    expect(copy.prepare('SELECT revision FROM object_revisions ORDER BY revision').all()).toEqual([{ revision: 2 }, { revision: 7 }]);
    expect(copy.prepare('SELECT * FROM resource_locks').get()).toEqual({ resource_id: 'calendar:83', run_id: 'child-z', attempt: 5, acquired_at: 't4' });
    expect(copy.prepare('SELECT run_id,status,receipt_json FROM effects').get()).toEqual({ run_id: 'child-z', status: 'outcome_unknown', receipt_json: '{"provider":"receipt-97"}' });
    expect(copy.prepare('SELECT * FROM native_task_links').get()).toEqual({ run_id: 'child-z', parent_run_id: 'root-r', parent_attempt: 2, native_run_ref: 'native-child-51', native_session_key: 'session-child-61' });
    for (const table of ['commands', 'webhook_receipts', 'operations', 'consumer_cursors', 'event_tombstones', 'context_retention', 'sqlite_sequence']) {
      expect(copy.prepare(`SELECT * FROM ${table}`).all()).toEqual(db.prepare(`SELECT * FROM ${table}`).all());
    }
    expect(copy.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { copy.close(); }
  const filesBefore = await Promise.all(['control.sqlite', 'manifest.json'].map(p => readFile(join(destination, p))));
  expect(await verifyControl(destination)).toEqual(manifest);
  expect(await Promise.all(['control.sqlite', 'manifest.json'].map(p => readFile(join(destination, p))))).toEqual(filesBefore);
  expect(await readdir(destination)).toEqual(['control.sqlite', 'manifest.json']);
  expect((await lstat(destination)).mode & 0o777).toBe(0o700);
  for (const file of ['control.sqlite', 'manifest.json']) expect((await lstat(join(destination, file))).mode & 0o777).toBe(0o600);
  expect(JSON.stringify(manifest)).not.toMatch(/PRIVATE_CONTENT|persona-a|receipt-97|boot-37/);
});

it('verifies legacy schema8 without migrating the source or snapshot', async () => {
  db.exec('DROP TABLE flight_restore_deadlines; UPDATE schema_versions SET version=8 WHERE version=9');
  const before = digest(await readFile(source));
  const manifest = await snapshotControl(source, destination);
  expect(manifest.schemaVersions).toEqual([8]);
  expect(manifest.schemaSha256).toBe('99b9fa6597785da358b9b0adfbef41a09802648ece96da2792956405de55e619');
  expect(await verifyControl(destination)).toEqual(manifest);
  expect(digest(await readFile(source))).toBe(before);
});

it('preserves schema9 flight obligations and original migration history', async () => {
  db.exec("INSERT INTO schema_versions VALUES(8,'2026-08-17T01:23:45.678Z'); INSERT INTO flight_restore_deadlines VALUES('leg-83',2,'2026-09-20T21:00:00.000Z','Asia/Jakarta','2026-09-19T21:00:00.000Z','routine-29','source-43','outcome_unknown','child-z','{\"receipt\":73}')");
  const manifest = await snapshotControl(source, destination);
  expect(manifest.schemaVersions).toEqual([8, 9]);
  expect(manifest.counts).toMatchObject({ flight_restore_deadlines: 1 });
  const copy = new DatabaseSync(join(destination, 'control.sqlite'), { readOnly: true });
  try {
    for (const table of ['schema_versions', 'flight_restore_deadlines']) {
      expect(copy.prepare(`SELECT * FROM ${table}`).all()).toEqual(db.prepare(`SELECT * FROM ${table}`).all());
    }
  } finally { copy.close(); }
  expect(await verifyControl(destination)).toEqual(manifest);
});

it('CLI snapshots and verifies without logging paths or application content', () => {
  const result = execFileSync(process.execPath, [cli, 'snapshot', source, destination], { encoding: 'utf8' });
  expect(JSON.parse(result)).toEqual({ status: 'ok', operation: 'snapshot', scope: 'local-application-sqlite-only' });
  expect(JSON.parse(execFileSync(process.execPath, [cli, 'verify', destination], { encoding: 'utf8' })).status).toBe('ok');
  const bad = spawnSync(process.execPath, [cli, 'verify', join(directory, 'PRIVATE_PATH_CANARY')], { encoding: 'utf8' });
  expect(bad.status).toBe(1); expect(bad.stderr).not.toContain('PRIVATE_PATH_CANARY');
});

it('settles a multi-batch backup in an otherwise idle process and exits without a leaked timer', () => {
  const content = 'asymmetric-large-backup-731:'.repeat(50000);
  db.prepare("UPDATE objects SET body_json=? WHERE id='persona-a'").run(JSON.stringify({ content }));
  expect(Number(db.prepare('PRAGMA page_count').get()!.page_count)).toBeGreaterThan(100);
  const result = spawnSync(process.execPath, [cli, 'snapshot', source, destination], { encoding: 'utf8', timeout: 10000 });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout).status).toBe('ok');
  const copy = new DatabaseSync(join(destination, 'control.sqlite'), { readOnly: true });
  try {
    expect(JSON.parse(String(copy.prepare("SELECT body_json FROM objects WHERE id='persona-a'").get()!.body_json))).toEqual({ content });
  } finally { copy.close(); }
});

it('pins one transaction when another connection commits paired changes after snapshot acquisition', async () => {
  db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0');
  let finished = false;
  const pending = snapshotControl(source, destination).finally(() => { finished = true; });
  // The directory is created only after the source read transaction and schema inspection.
  const until = Date.now() + 5000;
  while (true) {
    try { await lstat(destination); break; } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || Date.now() > until) throw error;
      await new Promise<void>(done => setImmediate(done));
    }
  }
  expect(finished).toBe(false);
  db.exec("BEGIN; UPDATE objects SET revision=23 WHERE id='persona-a'; UPDATE effects SET status='confirmed' WHERE id='effect-y'; COMMIT");
  await pending;
  const copy = new DatabaseSync(join(destination, 'control.sqlite'), { readOnly: true });
  try {
    expect(copy.prepare("SELECT revision FROM objects WHERE id='persona-a'").get()).toEqual({ revision: 7 });
    expect(copy.prepare('SELECT status FROM effects').get()).toEqual({ status: 'outcome_unknown' });
    expect(db.prepare("SELECT revision FROM objects WHERE id='persona-a'").get()).toEqual({ revision: 23 });
    expect(db.prepare('SELECT status FROM effects').get()).toEqual({ status: 'confirmed' });
  } finally { copy.close(); }
});

it('rejects unsupported versions, schema drift and native-like databases without leaving backups', async () => {
  db.exec('UPDATE schema_versions SET version=99');
  await expect(snapshotControl(source, destination)).rejects.toThrow('UNSUPPORTED_SCHEMA');
  db.exec('UPDATE schema_versions SET version=9; CREATE TABLE sqliteXauth(secret TEXT)');
  await expect(snapshotControl(source, destination)).rejects.toThrow('UNSUPPORTED_SCHEMA');
  await expect(lstat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('rejects broken foreign keys and check constraints despite a matching schema', async () => {
  db.exec("PRAGMA foreign_keys=OFF; UPDATE resource_locks SET run_id='absent'");
  await expect(snapshotControl(source, destination)).rejects.toThrow('FOREIGN_KEYS_FAILED');
  db.exec("UPDATE resource_locks SET run_id='child-z'; PRAGMA ignore_check_constraints=ON; UPDATE objects SET revision=-1");
  await expect(snapshotControl(source, destination)).rejects.toThrow('INTEGRITY_FAILED');
  await expect(lstat(destination)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('refuses overwrite, relative paths, symlinks, hardlinks and public files/directories', async () => {
  await snapshotControl(source, destination);
  const original = await readFile(join(destination, 'control.sqlite'));
  await expect(snapshotControl(source, destination)).rejects.toMatchObject({ code: 'EEXIST' });
  expect(await readFile(join(destination, 'control.sqlite'))).toEqual(original);
  await expect(snapshotControl('source.sqlite', join(directory, 'new'))).rejects.toThrow('UNSAFE_PATH');
  const alias = join(directory, 'alias'); await symlink(source, alias);
  await expect(snapshotControl(alias, join(directory, 'new'))).rejects.toThrow('UNSAFE_PATH');
  await rm(alias); await link(source, alias);
  await expect(snapshotControl(source, join(directory, 'new'))).rejects.toThrow('UNSAFE_PATH');
  await rm(alias); await chmod(source, 0o644);
  await expect(snapshotControl(source, join(directory, 'new'))).rejects.toThrow('UNSAFE_PATH');
  await chmod(source, 0o600); await chmod(directory, 0o755);
  await expect(snapshotControl(source, join(directory, 'new'))).rejects.toThrow('UNSAFE_PATH');
});

it('rejects sidecar redirection before opening source', async () => {
  await symlink(source, source + '-wal');
  await expect(snapshotControl(source, destination)).rejects.toThrow('UNSAFE_PATH');
  await rm(source + '-wal');
});

it('detects missing/extra components, truncation and corrupted bytes', async () => {
  await snapshotControl(source, destination);
  const path = join(destination, 'control.sqlite'), original = await readFile(path);
  await writeFile(path, original.subarray(0, 300));
  await expect(verifyControl(destination)).rejects.toThrow('HASH_MISMATCH');
  const corrupt = Buffer.from(original); corrupt[100] ^= 1; await writeFile(path, corrupt);
  await expect(verifyControl(destination)).rejects.toThrow('HASH_MISMATCH');
  await writeFile(path, original); await writeFile(join(destination, 'control.sqlite-wal'), '', { mode: 0o600 });
  await expect(verifyControl(destination)).rejects.toThrow('COMPONENTS_INVALID');
  await rm(join(destination, 'control.sqlite-wal')); await rm(join(destination, 'manifest.json'));
  await expect(verifyControl(destination)).rejects.toThrow('COMPONENTS_INVALID');
});

it('checks counts and strict bounded manifest fields independently of database hash', async () => {
  const manifest = await snapshotControl(source, destination), path = join(destination, 'manifest.json');
  await writeFile(path, JSON.stringify({ ...manifest, counts: { ...manifest.counts, effects: 0 } }));
  await expect(verifyControl(destination)).rejects.toThrow('METADATA_MISMATCH');
  await writeFile(path, JSON.stringify({ ...manifest, database: '../source.sqlite' }));
  await expect(verifyControl(destination)).rejects.toThrow('MANIFEST_INVALID');
  await writeFile(path, JSON.stringify({ ...manifest, secret: 'CANARY' }));
  await expect(verifyControl(destination)).rejects.toThrow('MANIFEST_INVALID');
  await writeFile(path, ' '.repeat(65537));
  await expect(verifyControl(destination)).rejects.toThrow('MANIFEST_TOO_LARGE');
});

it('rechecks schema and FKs even when someone recomputes the unsigned checksum', async () => {
  const manifest = await snapshotControl(source, destination), path = join(destination, 'control.sqlite');
  const copy = new DatabaseSync(path); copy.exec("PRAGMA foreign_keys=OFF; UPDATE resource_locks SET run_id='missing'"); copy.close();
  await writeFile(join(destination, 'manifest.json'), JSON.stringify({ ...manifest, sha256: digest(await readFile(path)) }));
  await expect(verifyControl(destination)).rejects.toThrow('FOREIGN_KEYS_FAILED');
});

it('rejects a rehashed WAL header without creating sidecars or changing the delivered files', async () => {
  const manifest = await snapshotControl(source, destination), path = join(destination, 'control.sqlite');
  const bytes = await readFile(path); bytes[18] = 2; bytes[19] = 2; await writeFile(path, bytes);
  await writeFile(join(destination, 'manifest.json'), JSON.stringify({ ...manifest, sha256: digest(bytes) }));
  await expect(verifyControl(destination)).rejects.toThrow('DATABASE_FORMAT_INVALID');
  expect(await readdir(destination)).toEqual(['control.sqlite', 'manifest.json']);
  expect(await readFile(path)).toEqual(bytes);
});
