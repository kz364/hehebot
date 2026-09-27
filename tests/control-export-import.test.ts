import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { importControlExport, MAX_EXPORT_BYTES } from '../scripts/import-control-export.mjs';
import { verifyControl } from '../scripts/backup-control.mjs';
import { exportControl } from '../src/core/control-export';
import type { SqlValue } from '../src/core/store';
import {legacyOccurrences} from './legacy-occurrences';
import {legacyRuns} from './legacy-runs';

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
    schemaSha256: '6fedcfb0c86cd8efe3a307a73247892408875c7a818f68a777ee93c3a2b97076', schemaVersions: [18], tables: tables(db) };
  await save();
});
afterEach(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });

it('roundtrips skill references, explicit removal and admitted prior content without materializing documents', async () => {
  const base = { name: 'Review notes', description: 'Synthetic method.', when_to_use: 'For a test.', inputs_access: [], steps: ['Review.'], decision_rules: [], validation: ['Check.'], output: 'Notes.', failure_handling: ['Stop.'], approval_boundaries: ['No effects.'], contains_private_facts: false };
  const original = JSON.stringify({ ...base, references: [{ name: 'review-notes.md', text: 'First 37\n雪 🧭\n  preserve whitespace and \\literal\\ text\n' }] });
  const current = JSON.stringify({ ...base, references: [] });
  const context = JSON.stringify({ skills: [{ id: 'skill-71', revision: 1, body: JSON.parse(original) }], authorization_policy_ids: [] });
  db.prepare("INSERT INTO objects VALUES('skill-71','skill',2,?,NULL,'t1','t7')").run(current);
  db.prepare("INSERT INTO object_revisions VALUES('skill-71',1,?,'owner',NULL,'t1')").run(original);
  db.prepare("INSERT INTO object_revisions VALUES('skill-71',2,?,'owner',NULL,'t7')").run(current);
  db.prepare("UPDATE runs SET context_json=? WHERE id='root-29'").run(context);
  const exported = exportControl({
    all: <T>(sql: string, ...values: SqlValue[]) => db.prepare(sql).all(...values) as T[],
    exec: () => { throw Error('Read only'); },
    transaction: <T>(fn: () => T) => { db.exec('BEGIN'); try { return fn(); } finally { db.exec('ROLLBACK'); } },
  }, originalTime);
  await writeFile(input, exported); await importControlExport(input, destination);
  const copy = new DatabaseSync(join(destination, 'control.sqlite'), { readOnly: true });
  try {
    expect(copy.prepare("SELECT body_json FROM objects WHERE id='skill-71'").get()).toEqual({ body_json: current });
    expect(copy.prepare("SELECT revision,body_json FROM object_revisions WHERE object_id='skill-71' ORDER BY revision").all()).toEqual([{ revision: 1, body_json: original }, { revision: 2, body_json: current }]);
    expect(copy.prepare("SELECT context_json FROM runs WHERE id='root-29'").get()).toEqual({ context_json: context });
    expect(await readdir(destination)).not.toContain('review-notes.md');
  } finally { copy.close(); }
});

it('roundtrips distinct manual null-due occurrences and their exact run references', async () => {
  db.exec(`INSERT INTO objects VALUES('routine-17','routine',19,'{}',NULL,'t1','t7');
    INSERT INTO occurrences(id,routine_id,routine_version,nominal_due_at,status,created_at,origin) VALUES
    ('manual-43','routine-17',7,NULL,'completed','t3','manual'),('manual-89','routine-17',7,NULL,'failed','t4','manual'),
    ('scheduled-53','routine-17',7,'2026-09-17T03:15:00.000Z','completed','t2','scheduled');
    UPDATE runs SET routine_id='routine-17',occurrence_id=CASE id WHEN 'root-29' THEN 'manual-43' ELSE 'manual-89' END`);
  const exported = exportControl({
    all: <T>(sql: string, ...values: SqlValue[]) => db.prepare(sql).all(...values) as T[],
    exec: () => { throw Error('Read only'); },
    transaction: <T>(fn: () => T) => { db.exec('BEGIN'); try { return fn(); } finally { db.exec('ROLLBACK'); } },
  }, originalTime);
  await writeFile(input, exported); await importControlExport(input, destination);
  const copy = new DatabaseSync(join(destination, 'control.sqlite'), { readOnly: true });
  try {
    expect(copy.prepare('SELECT id,origin,nominal_due_at FROM occurrences ORDER BY id').all()).toEqual([
      {id:'manual-43',origin:'manual',nominal_due_at:null},{id:'manual-89',origin:'manual',nominal_due_at:null},
      {id:'scheduled-53',origin:'scheduled',nominal_due_at:'2026-09-17T03:15:00.000Z'},
    ]);
    expect(copy.prepare('SELECT id,occurrence_id FROM runs ORDER BY id').all()).toEqual([
      {id:'child-83',occurrence_id:'manual-89'},{id:'root-29',occurrence_id:'manual-43'},
    ]);
    expect(copy.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { copy.close(); }
});

it.each([['scheduled',null],['manual','due'],['unknown',null],[null,null]])('rejects imported origin/due mismatch %s/%s', async (origin,due) => {
  db.exec("INSERT INTO occurrences(id,routine_id,routine_version,nominal_due_at,status,created_at) VALUES('occurrence','persona-73',7,'due','completed','t3')");
  wire.tables=tables(db);
  Object.assign(field('occurrences','origin'),{type:origin===null?'null':'text',value:origin});
  Object.assign(field('occurrences','nominal_due_at'),{type:due===null?'null':'text',value:due});
  await save(); await rejected();
});

it.each([1, 73, 9007199254740991])('roundtrips captured revision %s alongside an unknown historical attempt', async revision => {
  db.prepare("UPDATE attempts SET captured_routine_revision=? WHERE run_id='root-29'").run(revision);
  const exported = exportControl({
    all: <T>(sql: string, ...values: SqlValue[]) => db.prepare(sql).all(...values) as T[],
    exec: () => { throw Error('Read only'); },
    transaction: <T>(fn: () => T) => { db.exec('BEGIN'); try { return fn(); } finally { db.exec('ROLLBACK'); } },
  }, originalTime);
  await writeFile(input, exported);
  await importControlExport(input, destination);
  const copy = new DatabaseSync(join(destination, 'control.sqlite'), { readOnly: true });
  try {
    expect(copy.prepare('SELECT run_id,captured_routine_revision FROM attempts ORDER BY run_id').all()).toEqual([
      { run_id: 'child-83', captured_routine_revision: null }, { run_id: 'root-29', captured_routine_revision: revision },
    ]);
  } finally { copy.close(); }
});

it.each([
  { type: 'integer', value: '0' }, { type: 'integer', value: '-1' },
  { type: 'integer', value: '9007199254740992' }, { type: 'text', value: '1.5' },
  { type: 'text', value: '73' }, { type: 'text', value: 'not-a-revision' },
])('rejects invalid or affinity-coerced captured revision %j', async value => {
  Object.assign(field('attempts', 'captured_routine_revision'), value);
  await save(); await rejected();
});

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

it.each(['same', 'parent', 'attempt', 'persona'])('roundtrips shared thread turns only with %s custody', async mode => {
  db.exec(`INSERT INTO objects VALUES('persona-97','persona',1,'{}',NULL,'t1','t1');
    INSERT INTO runs(id,persona_id,context_json,role,parent_run_id,status,current_attempt,created_at,updated_at)
      VALUES('followup-41','persona-73','{}','background','root-29','cancelling',1,'t5','t8');
    INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,native_run_ref,status,deadline_at)
      VALUES('followup-41',1,'followup-submit',13,'boot-47','turn-907','claimed','t9');
    INSERT INTO native_task_links VALUES('followup-41','root-29',2,'turn-907','child-session');`);
  if (mode === 'parent') db.exec("UPDATE native_task_links SET parent_run_id='child-83' WHERE run_id='followup-41'; UPDATE runs SET parent_run_id='child-83' WHERE id='followup-41'");
  if (mode === 'attempt') db.exec("UPDATE native_task_links SET parent_attempt=1 WHERE run_id='followup-41'");
  if (mode === 'persona') db.exec("UPDATE runs SET persona_id='persona-97' WHERE id='followup-41'");
  const exported = exportControl({
    all: <T>(sql: string, ...values: SqlValue[]) => db.prepare(sql).all(...values) as T[],
    exec: () => { throw Error('Read only'); },
    transaction: <T>(fn: () => T) => { db.exec('BEGIN'); try { return fn(); } finally { db.exec('ROLLBACK'); } },
  }, originalTime);
  await writeFile(input, exported);
  if (mode !== 'same') { await rejected(); return; }
  await importControlExport(input, destination);
  const copy = new DatabaseSync(join(destination, 'control.sqlite'), { readOnly: true });
  try {
    for (const name of ['runs', 'attempts', 'native_task_links', 'flight_restore_deadlines']) {
      expect(copy.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()).toEqual(db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all());
    }
    expect(copy.prepare('SELECT native_run_ref,native_session_key FROM native_task_links ORDER BY native_run_ref').all()).toEqual([
      {native_run_ref:'child-native',native_session_key:'child-session'}, {native_run_ref:'turn-907',native_session_key:'child-session'},
    ]);
  } finally { copy.close(); }
});

it.each([9, 10, 11, 12, 13, 14, 15, 16])('preserves schema%s migration history and referenced occurrences without inventing attribution or upgrading legacy snapshots', async version => {
  legacyRuns(db);
  wire.schemaSha256 = 'ce7ce5e8bf6f0d2574a42eb90653900e79b67c240b55bdd8b12acea29874cb80';
  db.exec(`INSERT INTO objects VALUES('routine-17','routine',19,'{}',NULL,'t1','t7');
    INSERT INTO occurrences(id,routine_id,routine_version,nominal_due_at,status,coalesced_count,created_at) VALUES('occurrence-43','routine-17',7,'2026-09-17T03:15:00.000Z','completed',5,'t3');
    UPDATE runs SET occurrence_id='occurrence-43',routine_id='routine-17' WHERE id='root-29'`);
  if (version < 16) {
    db.exec('DROP INDEX operations_run_status; DROP INDEX effects_run_status; DROP INDEX resource_locks_run');
    wire.schemaSha256 = '327be864123d24d2aa574a9bddb9b333948b7311e2eb0ea9363d4b37b3799c5c';
  }
  if (version < 15) {
    db.exec('DROP INDEX runs_parent');
    wire.schemaSha256 = '1fe0bfe3a7be6a29c66dc3b73bb3b8974de03fbda7773fe921c50e7b19558ddb';
  }
  if (version < 14) {
    db.exec('DROP INDEX objects_memory_scope');
    wire.schemaSha256 = '0eaf3801cdd090fbeeb7d2d362f19c1e7157ae01bb7a09264409bbf504a17d2f';
  }
  if (version < 13) {
    legacyOccurrences(db);
    wire.schemaSha256 = 'a333b2b0ca9d5e7572e84d8aa3f8210b99e3b946a831bbd6dd4ff231173d0bf6';
  }
  if (version < 12) {
    db.exec('ALTER TABLE attempts DROP COLUMN captured_routine_revision');
    wire.schemaSha256 = '8bd40b2cb56bf706a72006fe4a54cf310d1620ec3c0d408af4429d5cf2c5947a';
  }
  db.prepare('UPDATE schema_versions SET version=? WHERE version=18').run(version);
  if (version < 11) {
    const links = db.prepare('SELECT * FROM native_task_links').all();
    db.exec('DROP TABLE native_task_links; CREATE TABLE native_task_links (run_id TEXT PRIMARY KEY REFERENCES runs(id),parent_run_id TEXT NOT NULL REFERENCES runs(id),parent_attempt INTEGER NOT NULL,native_run_ref TEXT NOT NULL UNIQUE,native_session_key TEXT NOT NULL UNIQUE)');
    for (const link of links) db.prepare('INSERT INTO native_task_links VALUES(?,?,?,?,?)').run(...Object.values(link));
    wire.schemaSha256 = '682c042d228bff9b09816e47ee175ccce8f71702e7d1148e76412fe75dd1aec4';
  }
  if (version === 9) {
    db.exec('ALTER TABLE attempts DROP COLUMN coordinator_release_json');
    wire.schemaSha256 = '15bf82e1965b24b0620dfe9a6541ce74759320113c3ed230fe2048f6e10ee01c';
  }
  db.prepare('INSERT INTO schema_versions VALUES(?,?)').run(8, '2026-08-17T01:23:45.678Z');
  wire.schemaVersions = [8, version]; wire.tables = tables(db); table('schema_versions').rows.reverse(); await save();
  await importControlExport(input, destination);
  expect((await verifyControl(destination)).schemaVersions).toEqual([8, version]);
  const copy = new DatabaseSync(join(destination, 'control.sqlite'), { readOnly: true });
  try {
    expect(copy.prepare('SELECT * FROM schema_versions ORDER BY version').all()).toEqual(db.prepare('SELECT * FROM schema_versions ORDER BY version').all());
    expect(copy.prepare("SELECT name FROM sqlite_schema WHERE name IN ('operations_run_status','effects_run_status','resource_locks_run')").all()).toHaveLength(version >= 16 ? 3 : 0);
    expect(copy.prepare("SELECT name FROM sqlite_schema WHERE name='runs_parent'").all()).toHaveLength(version >= 15 ? 1 : 0);
    expect(copy.prepare('SELECT * FROM occurrences').all()).toEqual(db.prepare('SELECT * FROM occurrences').all());
    expect(copy.prepare("SELECT occurrence_id FROM runs WHERE id='root-29'").get()).toEqual({occurrence_id:'occurrence-43'});
    expect(copy.prepare('PRAGMA table_info(occurrences)').all().some(row => row.name === 'origin')).toBe(version >= 13);
    expect(copy.prepare('SELECT * FROM attempts ORDER BY run_id').all()).toEqual(db.prepare('SELECT * FROM attempts ORDER BY run_id').all());
    expect(copy.prepare('PRAGMA table_info(attempts)').all().some(row => row.name === 'coordinator_release_json')).toBe(version >= 10);
    expect(copy.prepare('PRAGMA table_info(attempts)').all().some(row => row.name === 'captured_routine_revision')).toBe(version >= 12);
    expect(copy.prepare('SELECT * FROM flight_restore_deadlines ORDER BY leg_id,revision').all()).toEqual(db.prepare('SELECT * FROM flight_restore_deadlines ORDER BY leg_id,revision').all());
    expect(copy.prepare('SELECT status FROM flight_restore_deadlines WHERE revision=2').get()!.status).toBe('outcome_unknown');
  } finally { copy.close(); }
});

it.each([[], [8], [16, 8], [8, 8, 16], [0, 16], [1.5, 16], [17], [8, 16], [9], [10], [11], [12], [13], [14], [15]].map(versions => ({ versions })))('rejects invalid or row-mismatched header history $versions', async ({ versions }) => {
  wire.schemaVersions = versions; await save(); await rejected();
});

it('rejects omitted history rows in the header and missing flight data tables', async () => {
  db.prepare('INSERT INTO schema_versions VALUES(?,?)').run(8, '2026-08-17T01:23:45.678Z');
  wire.tables = tables(db); await save(); await rejected(); // Header [16] omits real row8.
  wire.schemaVersions = [8, 16]; wire.tables = wire.tables.filter(t => t.name !== 'flight_restore_deadlines');
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
  const cli = decodeURIComponent(new URL('../scripts/import-control-export.mjs', import.meta.url).pathname);
  const good = spawnSync(process.execPath, [cli, input, destination], { encoding: 'utf8', timeout: 15000 });
  expect(good.status).toBe(0); expect(JSON.parse(good.stdout).activation_allowed).toBe(false);
  for (const secret of [canary, directory, 'policy-secret', 'calendar:secret']) expect(good.stdout + good.stderr).not.toContain(secret);
  await writeFile(input, canary);
  const bad = spawnSync(process.execPath, [cli, input, join(directory, 'bad')], { encoding: 'utf8', timeout: 15000 });
  expect(bad.status).toBe(1); expect(bad.stdout).toBe(''); expect(bad.stderr).toContain('CONTROL_EXPORT_IMPORT_FAILED');
  expect(bad.stderr).not.toContain(canary); expect(bad.stderr).not.toContain(directory); await clean();
});
