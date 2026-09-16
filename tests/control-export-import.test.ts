import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { importControlExport, MAX_EXPORT_BYTES } from '../scripts/import-control-export.mjs';
import { verifyControl } from '../scripts/backup-control.mjs';

type Cell = { type: string; value: string | null };
type Table = { name: string; columns: string[]; rows: Cell[][] };
const schema = await readFile(process.env.HEHEBOT_IMPORT_SCHEMA ?? new URL('../DB/schema.sql', import.meta.url), 'utf8');
const originalTime = '2026-08-29T03:41:57.019Z';
const canary = 'PRIVATE_EXPORT_731';
let directory: string, source: string, input: string, destination: string, db: DatabaseSync;
let wire: { format: string; version: number; createdAt: string; schemaSha256: string; schemaVersions: number[]; tables: Table[] };
const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
function tables(database: DatabaseSync): Table[] {
  return (database.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all() as { name: string }[]).map(({ name }) => {
    const columns = (database.prepare(`PRAGMA table_info("${name}")`).all() as { name: string }[]).map(row => row.name);
    const query = database.prepare(`SELECT * FROM "${name}"`); query.setReadBigInts(true);
    return { name, columns, rows: query.all().map(row => columns.map(column => {
      const value = row[column];
      if (value === null) return { type: 'null', value: null };
      if (typeof value === 'bigint') return { type: 'integer', value: value.toString() };
      if (typeof value === 'string') return { type: 'text', value };
      throw Error('unsupported fixture');
    })) };
  });
}
const table = (name: string) => wire.tables.find(t => t.name === name)!;
const field = (name: string, column: string) => table(name).rows[0][table(name).columns.indexOf(column)];
async function save(value: unknown = wire) { await writeFile(input, JSON.stringify(value), { mode: 0o600 }); }
async function clean() { expect((await readdir(directory)).filter(name => name.startsWith('.hehebot-export-'))).toEqual([]); }
async function rejected() {
  const before = hash(await readFile(input));
  await expect(importControlExport(input, destination)).rejects.toThrow('CONTROL_EXPORT_IMPORT_FAILED');
  expect(hash(await readFile(input))).toBe(before);
  await expect(lstat(destination)).rejects.toMatchObject({ code: 'ENOENT' }); await clean();
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'hehe-export-import-')); source = join(directory, 'original.sqlite');
  input = join(directory, 'export.json'); destination = join(directory, 'snapshot');
  await writeFile(source, '', { mode: 0o600 }); db = new DatabaseSync(source); db.exec(schema);
  db.exec(`
    INSERT INTO objects VALUES('persona-73','persona',7,'{"text":"${canary}"}',NULL,'t1','t7');
    INSERT INTO object_revisions VALUES('persona-73',3,'{"prior":31}','owner',NULL,'t2');
    INSERT INTO commands VALUES('command-19','owner','dedupe-43','digest-57','message.send','{}','applied','t3','root-29',NULL);
    INSERT INTO runs(id,command_id,persona_id,context_json,status,current_attempt,created_at,updated_at) VALUES('root-29','command-19','persona-73','{}','completed',2,'t3','t7');
    INSERT INTO runs(id,persona_id,context_json,role,parent_run_id,status,current_attempt,created_at,updated_at) VALUES('child-83','persona-73','{}','background','root-29','recovery_required',1,'t4','t8');
    INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,native_run_ref,status,deadline_at) VALUES('root-29',2,'root-submit',13,'boot-47','root-native','completed','t9');
    INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,native_run_ref,status,deadline_at) VALUES('child-83',1,'child-submit',13,'boot-47','child-native','terminated','t9');
    UPDATE attempts SET coordinator_release_json='{"native_ref":"root-native","outcome":"interrupted"}' WHERE run_id='root-29';
    INSERT INTO native_task_links VALUES('child-83','root-29',2,'child-native','child-session');
    INSERT INTO effects VALUES('effect-67','child-83','action-71','mutation','outcome_unknown','policy-secret','digest-secret',NULL,'{"observation":"${canary}"}','t8');
    INSERT INTO resource_locks VALUES('calendar:secret','child-83',1,'t4');
    INSERT INTO operations VALUES('op-59','child-83',1,'tool','unknown','t4','t9','t7');
    INSERT INTO events(sequence,id,type,actor_id,payload_json,created_at) VALUES(19,'event-19','message','owner','{}','t1');
    INSERT INTO events(sequence,id,type,actor_id,payload_json,created_at) VALUES(9007199254740993,'kept-high','message','owner','{}','t1');
    INSERT INTO events(sequence,id,type,actor_id,payload_json,created_at) VALUES(9007199254740997,'deleted-event','message','owner','{}','t1');
    DELETE FROM events WHERE id='deleted-event';
    INSERT INTO consumer_cursors VALUES('consumer-43','room-17',9007199254740997,19);
    INSERT INTO rate_limits VALUES('int64-edges',-9223372036854775808,9223372036854775807);
    INSERT INTO flight_restore_deadlines VALUES('leg-83',1,'2026-09-19T20:00:00.000Z','Asia/Jakarta','2026-09-18T20:00:00.000Z','routine-29','source-17','superseded',NULL,NULL);
    INSERT INTO flight_restore_deadlines VALUES('leg-83',2,'2026-09-20T21:00:00.000Z','Asia/Jakarta','2026-09-19T21:00:00.000Z','routine-29','source-43','outcome_unknown','child-83','{"observation":"${canary}"}');
  `);
  wire = { format: 'hehebot-control-export', version: 1, createdAt: originalTime,
    schemaSha256: '682c042d228bff9b09816e47ee175ccce8f71702e7d1148e76412fe75dd1aec4', schemaVersions: [10], tables: tables(db) };
  await save();
});
afterEach(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });

it('reconstructs exact typed data, int64 edges, deleted event high-water and original time', async () => {
  wire.tables.forEach(t => t.rows.reverse()); await save();
  const before = [hash(await readFile(input)), hash(await readFile(source))];
  expect(await importControlExport(input, destination)).toMatchObject({ status: 'verified', activation_allowed: false });
  const manifest = await verifyControl(destination); expect(manifest.createdAt).toBe(originalTime);
  const restored = new DatabaseSync(join(destination, 'control.sqlite'), { readOnly: true });
  try {
    const canonical = (ts: Table[]) => ts.map(t => ({ ...t, rows: t.rows.map(row => JSON.stringify(row)).sort() }));
    expect(canonical(tables(restored))).toEqual(canonical(wire.tables));
    const query = restored.prepare('SELECT seq FROM sqlite_sequence WHERE name=?'); query.setReadBigInts(true);
    expect(query.get('events')!.seq).toBe(9007199254740997n);
    const sequence = restored.prepare('SELECT sequence FROM events WHERE id=?'); sequence.setReadBigInts(true);
    expect(sequence.get('kept-high')!.sequence).toBe(9007199254740993n);
    expect(restored.prepare('SELECT status FROM effects').get()!.status).toBe('outcome_unknown');
    expect(restored.prepare('SELECT count(*) AS n FROM resource_locks').get()!.n).toBe(1);
    expect(restored.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { restored.close(); }
  expect([hash(await readFile(input)), hash(await readFile(source))]).toEqual(before);
  expect((await lstat(destination)).mode & 0o777).toBe(0o700);
  for (const name of ['control.sqlite', 'manifest.json']) expect((await lstat(join(destination, name))).mode & 0o777).toBe(0o600);
  expect((await readdir(destination)).sort()).toEqual(['control.sqlite', 'manifest.json']); await clean();
});

it.each([9, 10])('preserves schema%s migration history and flight deadlines without inventing release or upgrading legacy snapshots', async version => {
  if (version === 9) {
    db.exec('ALTER TABLE attempts DROP COLUMN coordinator_release_json; UPDATE schema_versions SET version=9 WHERE version=10');
    wire.schemaSha256 = '15bf82e1965b24b0620dfe9a6541ce74759320113c3ed230fe2048f6e10ee01c';
  }
  db.prepare('INSERT INTO schema_versions VALUES(?,?)').run(8, '2026-08-17T01:23:45.678Z');
  wire.schemaVersions = [8, version]; wire.tables = tables(db); table('schema_versions').rows.reverse(); await save();
  await importControlExport(input, destination);
  expect((await verifyControl(destination)).schemaVersions).toEqual([8, version]);
  const copy = new DatabaseSync(join(destination, 'control.sqlite'), { readOnly: true });
  try {
    expect(copy.prepare('SELECT * FROM schema_versions ORDER BY version').all()).toEqual(db.prepare('SELECT * FROM schema_versions ORDER BY version').all());
    expect(copy.prepare('SELECT * FROM attempts ORDER BY run_id').all()).toEqual(db.prepare('SELECT * FROM attempts ORDER BY run_id').all());
    expect(copy.prepare('PRAGMA table_info(attempts)').all().some(row => row.name === 'coordinator_release_json')).toBe(version === 10);
    expect(copy.prepare('SELECT * FROM flight_restore_deadlines ORDER BY leg_id,revision').all()).toEqual(db.prepare('SELECT * FROM flight_restore_deadlines ORDER BY leg_id,revision').all());
    expect(copy.prepare('SELECT status FROM flight_restore_deadlines WHERE revision=2').get()!.status).toBe('outcome_unknown');
  } finally { copy.close(); }
});

it.each([[], [8], [10, 8], [8, 8, 10], [0, 10], [1.5, 10], [11], [8, 10], [9]].map(versions => ({ versions })))('rejects invalid or row-mismatched header history $versions', async ({ versions }) => {
  wire.schemaVersions = versions; await save(); await rejected();
});

it('rejects omitted history rows in the header and missing flight data tables', async () => {
  db.prepare('INSERT INTO schema_versions VALUES(?,?)').run(8, '2026-08-17T01:23:45.678Z');
  wire.tables = tables(db); await save(); await rejected(); // Header [10] omits real row8.
  wire.schemaVersions = [8, 10]; wire.tables = wire.tables.filter(t => t.name !== 'flight_restore_deadlines');
  await save(); await rejected();
});

it.each(['_cf_METADATA', '__miniflare_do_name'])('does not import or silently discard platform-only table %s', async name => {
  wire.tables.push({ name, columns: ['value'], rows: [] }); wire.tables.sort((a, b) => a.name < b.name ? -1 : 1);
  await save(); await rejected();
});

it.each(['-0', '01', '+1', '1.0', '1e2', '9223372036854775808', '-9223372036854775809'])('rejects invalid integer %s', async value => {
  field('rate_limits', 'count').value = value; await save(); await rejected();
});

it.each(['real', 'blob', 'boolean'])('rejects unsupported tagged type %s', async type => {
  field('rate_limits', 'count').type = type; await save(); await rejected();
});

it('rejects integer-tagged numeric JSON and affinity coercion rather than rounding', async () => {
  const value: any = field('rate_limits', 'count'); value.value = 42; await save(); await rejected();
  value.type = 'text'; value.value = '42'; await save(); await rejected();
});

it.each(['2026-02-30T00:00:00.000Z', '2026-09-14T00:00:00Z', '2026-09-14T07:00:00.000+07:00'])('rejects malformed timestamp %s', async time => {
  wire.createdAt = time; await save(); await rejected();
});

it.each(['missing', 'duplicate', 'order', 'injection', 'columns', 'column-order', 'row-width', 'extra-key', 'schema', 'version'])('rejects incompatible wire contract %s', async mode => {
  if (mode === 'missing') wire.tables.pop();
  if (mode === 'duplicate') wire.tables[1] = wire.tables[0];
  if (mode === 'order') wire.tables.reverse();
  if (mode === 'injection') wire.tables[0].name = 'attempts"; DROP TABLE objects; --';
  if (mode === 'columns') table('runs').columns[1] = table('runs').columns[0];
  if (mode === 'column-order') table('runs').columns.reverse();
  if (mode === 'row-width') table('runs').rows[0].pop();
  if (mode === 'extra-key') (field('runs', 'id') as any).credential = canary;
  if (mode === 'schema') wire.schemaSha256 = 'f'.repeat(64);
  if (mode === 'version') wire.schemaVersions = [3];
  await save(); await rejected();
});

it('rejects duplicate escaped JSON keys and invalid Unicode/UTF8', async () => {
  await writeFile(input, JSON.stringify(wire).replace('"version":1', '"version":2,"\\u0076ersion":1')); await rejected();
  field('objects', 'id').value = '\ud800'; await save(); await rejected();
  await writeFile(input, Buffer.from([0xff, 0xfe])); await rejected();
});

it('rejects FK corruption after parsing and discards private staging', async () => {
  field('attempts', 'run_id').value = 'missing-run'; await save(); await rejected();
});

it('preserves SQL-looking Unicode text as bound data, not parser structure', async () => {
  const value = JSON.stringify({ text: `'}; DROP TABLE objects; -- 😀 {"version":2,"version":1}` });
  field('objects', 'body_json').value = value; await save();
  await importControlExport(input, destination);
  const copy = new DatabaseSync(join(destination, 'control.sqlite'), { readOnly: true });
  try { expect(copy.prepare('SELECT body_json FROM objects').get()!.body_json).toBe(value); } finally { copy.close(); }
});

it('refuses unpinned local SQL and incompatible imported schema-version rows', async () => {
  const previous = process.env.HEHEBOT_IMPORT_SCHEMA;
  const fake = join(directory, 'untrusted.sql'); await writeFile(fake, 'CREATE TABLE malicious(value);');
  process.env.HEHEBOT_IMPORT_SCHEMA = fake;
  try { await rejected(); } finally {
    if (previous === undefined) delete process.env.HEHEBOT_IMPORT_SCHEMA; else process.env.HEHEBOT_IMPORT_SCHEMA = previous;
  }
  field('schema_versions', 'version').value = '3'; await save(); await rejected();
});

it('bounds serialized bytes and combined rows before inserting', async () => {
  await writeFile(input, ' '.repeat(MAX_EXPORT_BYTES + 1)); await rejected();
  table('schema_versions').rows = Array.from({ length: 10001 }, () => [{ type: 'integer', value: '8' }, { type: 'text', value: 't1' }]);
  await save(); await rejected();
});

it('refuses links, public files, relative paths and overwrites without touching existing data', async () => {
  const linked = join(directory, 'linked.json'); await symlink(input, linked);
  await expect(importControlExport(linked, destination)).rejects.toThrow('CONTROL_EXPORT_IMPORT_FAILED'); await rm(linked);
  await link(input, linked); await rejected(); await rm(linked);
  await chmod(input, 0o644); await rejected(); await chmod(input, 0o600);
  await expect(importControlExport('relative.json', destination)).rejects.toThrow('CONTROL_EXPORT_IMPORT_FAILED');
  await symlink(source, destination);
  await expect(importControlExport(input, destination)).rejects.toThrow('CONTROL_EXPORT_IMPORT_FAILED');
  expect((await lstat(destination)).isSymbolicLink()).toBe(true); await rm(destination);
  await mkdir(destination, { mode: 0o700 }); const marker = join(destination, 'keep'); await writeFile(marker, canary);
  await expect(importControlExport(input, destination)).rejects.toThrow('CONTROL_EXPORT_IMPORT_FAILED'); expect(await readFile(marker, 'utf8')).toBe(canary);
  await clean();
});

it('CLI reports no private content and rejects corrupted exports with a fixed error', async () => {
  const cli = new URL('../scripts/import-control-export.mjs', import.meta.url).pathname;
  const good = spawnSync(process.execPath, [cli, input, destination], { encoding: 'utf8', timeout: 15000 });
  expect(good.status).toBe(0); expect(JSON.parse(good.stdout).activation_allowed).toBe(false);
  for (const secret of [canary, directory, 'policy-secret', 'calendar:secret']) expect(good.stdout + good.stderr).not.toContain(secret);
  await writeFile(input, canary);
  const bad = spawnSync(process.execPath, [cli, input, join(directory, 'bad')], { encoding: 'utf8', timeout: 15000 });
  expect(bad.status).toBe(1); expect(bad.stdout).toBe(''); expect(bad.stderr).toContain('CONTROL_EXPORT_IMPORT_FAILED');
  expect(bad.stderr).not.toContain(canary); expect(bad.stderr).not.toContain(directory); await clean();
});
