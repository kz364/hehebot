#!/usr/bin/env node
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshotControl, verifyControl } from './backup-control.mjs';

export const MAX_EXPORT_BYTES = 4 * 1024 * 1024;
export const MAX_EXPORT_ROWS = 10000;
const sqlHash = '0b6b7b223f3088aa93eeb4a43e2808d1e028e90ac782c0acb8829b72aedec3bc';
const schemaPins = {
  9: '15bf82e1965b24b0620dfe9a6541ce74759320113c3ed230fe2048f6e10ee01c',
  10: '682c042d228bff9b09816e47ee175ccce8f71702e7d1148e76412fe75dd1aec4',
  11: '8bd40b2cb56bf706a72006fe4a54cf310d1620ec3c0d408af4429d5cf2c5947a',
  12: 'a333b2b0ca9d5e7572e84d8aa3f8210b99e3b946a831bbd6dd4ff231173d0bf6',
  13: '0eaf3801cdd090fbeeb7d2d362f19c1e7157ae01bb7a09264409bbf504a17d2f',
  14: '1fe0bfe3a7be6a29c66dc3b73bb3b8974de03fbda7773fe921c50e7b19558ddb',
  15: '327be864123d24d2aa574a9bddb9b333948b7311e2eb0ea9363d4b37b3799c5c',
  16: 'ce7ce5e8bf6f0d2574a42eb90653900e79b67c240b55bdd8b12acea29874cb80',
};
const hash = value => createHash('sha256').update(value).digest('hex');
/** @returns {never} */
const fail = () => { throw new Error('CONTROL_EXPORT_IMPORT_FAILED'); };
function absolute(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path || path.includes('\0')) fail();
}
async function checked(path, directory = false) {
  absolute(path); let current = parse(path).root;
  for (const part of path.slice(current.length).split('/').filter(Boolean)) {
    current = join(current, part); const stat = await lstat(current);
    if (stat.isSymbolicLink()) fail();
    if (current !== path && (!stat.isDirectory() || (stat.uid !== 0 && stat.uid !== process.getuid()) ||
        ((stat.mode & 0o022) && !(stat.mode & 0o1000)))) fail();
  }
  const stat = await lstat(path);
  if (stat.uid !== process.getuid() || (stat.mode & 0o077) ||
      (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)) fail();
  return stat;
}
function keys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) fail();
}
function parseExport(text) {
  const value = JSON.parse(text);
  // JSON.parse otherwise silently accepts duplicate keys. Tokenize only structural
  // delimiters and complete strings after syntax validation; decode escaped keys.
  const stack = [];
  for (const match of text.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\]]/g)) {
    const token = match[0];
    if (token === '{' || token === '[') { stack.push(token === '{' ? new Set() : null); if (stack.length > 32) fail(); }
    else if (token === '}' || token === ']') stack.pop();
    else {
      let next = match.index + token.length;
      while (' \t\r\n'.includes(text[next]) && next < text.length) next++;
      if (text[next] === ':') {
        const key = JSON.parse(token), names = stack.at(-1);
        if (!names || names.has(key)) fail(); names.add(key);
      }
    }
  }
  return value;
}
function cell(value) {
  keys(value, ['type', 'value']);
  if (value.type === 'null' && value.value === null) return null;
  if (value.type === 'text' && typeof value.value === 'string' &&
      new TextDecoder().decode(new TextEncoder().encode(value.value)) === value.value) return value.value;
  if (value.type === 'integer' && typeof value.value === 'string' && value.value.length <= 20 && /^(0|-[1-9][0-9]*|[1-9][0-9]*)$/.test(value.value)) {
    const n = BigInt(value.value);
    if (n >= -9223372036854775808n && n <= 9223372036854775807n) return n;
  }
  fail();
}
const quote = name => `"${name.replaceAll('"', '""')}"`;
function exactRows(db, tables) {
  for (const table of tables) {
    const statement = db.prepare(`SELECT ${table.columns.map(quote).join(',')} FROM ${quote(table.name)}`);
    statement.setReadBigInts(true);
    const actual = statement.all().map(row => JSON.stringify(table.columns.map(column => {
      const value = row[column];
      if (value === null) return { type: 'null', value: null };
      if (typeof value === 'string') return { type: 'text', value };
      if (typeof value === 'bigint') return { type: 'integer', value: String(value) };
      fail();
    }))).sort();
    const expected = table.rows.map(row => JSON.stringify(row.map(c => ({ type: c.type, value: c.value })))).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) fail();
  }
}
async function sync(path) { const f = await open(path, 'r'); try { await f.sync(); } finally { await f.close(); } }

/** Reconstruct application data only; no custody, shutdown or activation claim. */
export async function importControlExport(exportFile, snapshotDirectory) {
  let work, published = false;
  try {
    const stat = await checked(exportFile); await checked(dirname(exportFile), true);
    if (stat.size > MAX_EXPORT_BYTES) fail();
    absolute(snapshotDirectory); await checked(dirname(snapshotDirectory), true);
    try { await lstat(snapshotDirectory); fail(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const file = await open(exportFile, constants.O_RDONLY | constants.O_NOFOLLOW);
    const bytes = Buffer.alloc(MAX_EXPORT_BYTES + 1); let size = 0;
    try {
      const opened = await file.stat();
      if (opened.ino !== stat.ino || opened.dev !== stat.dev) fail();
      while (size < bytes.length) {
        const result = await file.read(bytes, size, bytes.length - size, null);
        if (!result.bytesRead) break; size += result.bytesRead;
      }
    } finally { await file.close(); }
    if (size > MAX_EXPORT_BYTES) fail();
    const input = parseExport(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size)));
    keys(input, ['format', 'version', 'createdAt', 'schemaSha256', 'schemaVersions', 'tables']);
    const latest = Array.isArray(input.schemaVersions) ? input.schemaVersions.at(-1) : null;
    if (input.format !== 'hehebot-control-export' || input.version !== 1 || ![9, 10, 11, 12, 13, 14, 15, 16].includes(latest) || input.schemaSha256 !== schemaPins[latest] ||
        input.schemaVersions.length < 1 || input.schemaVersions.length > latest || !input.schemaVersions.every((version, i) =>
          Number.isInteger(version) && version >= 1 && version <= latest && (!i || version > input.schemaVersions[i - 1])) ||
        typeof input.createdAt !== 'string' ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(input.createdAt) ||
        !Number.isFinite(Date.parse(input.createdAt)) || new Date(input.createdAt).toISOString() !== input.createdAt || !Array.isArray(input.tables)) fail();
    const sql = await readFile(process.env.HEHEBOT_IMPORT_SCHEMA ?? new URL('../DB/schema.sql', import.meta.url));
    if (hash(sql) !== sqlHash) fail(); // Never execute export-provided SQL, even if a fingerprint is asserted.
    work = await mkdtemp(join(dirname(snapshotDirectory), '.hehebot-export-'));
    const source = join(work, 'source.sqlite');
    const created = await open(source, 'wx', 0o600); await created.close();
    const db = new DatabaseSync(source, { allowExtension: false });
    try {
      db.exec(sql.toString('utf8'));
      // Reconstruct legacy snapshots without inventing receipts or upgrading
      // their history. Only this disposable, empty local staging DB is changed.
      if (latest < 16) db.exec('DROP INDEX operations_run_status; DROP INDEX effects_run_status; DROP INDEX resource_locks_run');
      if (latest < 15) db.exec('DROP INDEX runs_parent');
      if (latest < 14) db.exec('DROP INDEX objects_memory_scope');
      if (latest < 13) db.exec(`DROP TABLE occurrences; CREATE TABLE occurrences (
 id TEXT PRIMARY KEY, routine_id TEXT NOT NULL REFERENCES objects(id), routine_version INTEGER NOT NULL,
 nominal_due_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('queued','claimed','completed','skipped','superseded','failed')),
 coalesced_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
 UNIQUE(routine_id,routine_version,nominal_due_at)
)`);
      if (latest < 12) db.exec('ALTER TABLE attempts DROP COLUMN captured_routine_revision');
      if (latest < 11) db.exec('DROP TABLE native_task_links; CREATE TABLE native_task_links (run_id TEXT PRIMARY KEY REFERENCES runs(id),parent_run_id TEXT NOT NULL REFERENCES runs(id),parent_attempt INTEGER NOT NULL,native_run_ref TEXT NOT NULL UNIQUE,native_session_key TEXT NOT NULL UNIQUE)');
      if (latest === 9) db.exec('ALTER TABLE attempts DROP COLUMN coordinator_release_json');
      const schema = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name").all();
      if (hash(JSON.stringify(schema)) !== schemaPins[latest]) fail();
      const names = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(row => row.name);
      if (input.tables.length !== names.length) fail();
      let rows = 0;
      for (const [index, table] of input.tables.entries()) {
        keys(table, ['name', 'columns', 'rows']);
        if (table.name !== names[index]) fail();
        const columns = db.prepare(`PRAGMA table_info(${quote(names[index])})`).all().map(row => row.name);
        if (JSON.stringify(table.columns) !== JSON.stringify(columns) || !Array.isArray(table.rows)) fail();
        rows += table.rows.length; if (rows > MAX_EXPORT_ROWS) fail();
        for (const row of table.rows) {
          if (!Array.isArray(row) || row.length !== columns.length) fail();
          for (const value of row) cell(value);
        }
      }
      db.exec('PRAGMA foreign_keys=OFF; BEGIN');
      for (const name of names) db.exec(`DELETE FROM ${quote(name)}`);
      for (const table of [...input.tables.filter(table => table.name !== 'sqlite_sequence'), ...input.tables.filter(table => table.name === 'sqlite_sequence')]) {
        // Importing events may advance sqlite_sequence; replace it only after all other tables.
        if (table.name === 'sqlite_sequence') db.exec('DELETE FROM sqlite_sequence');
        const statement = db.prepare(`INSERT INTO ${quote(table.name)} (${table.columns.map(quote).join(',')}) VALUES(${table.columns.map(() => '?').join(',')})`);
        for (const row of table.rows) statement.run(...row.map(cell));
      }
      exactRows(db, input.tables); // Reject affinity conversion, REAL results, or lost int64 precision.
      // Multiple turns may share a thread, never its original authority.
      if (db.prepare(`SELECT n.native_session_key FROM native_task_links n JOIN runs r ON r.id=n.run_id
        GROUP BY n.native_session_key HAVING count(DISTINCT n.parent_run_id)>1 OR
        count(DISTINCT n.parent_attempt)>1 OR count(DISTINCT r.persona_id)>1 LIMIT 1`).get()) fail();
      const history = db.prepare('SELECT version FROM schema_versions ORDER BY version'); history.setReadBigInts(true);
      if (JSON.stringify(history.all().map(row => String(row.version))) !== JSON.stringify(input.schemaVersions.map(String))) fail();
      db.exec('COMMIT; PRAGMA foreign_keys=ON');
    } finally { db.close(); }
    const staging = join(work, 'snapshot');
    await snapshotControl(source, staging); // Existing FK/integrity/schema/manifest machinery.
    const manifestPath = join(staging, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')); manifest.createdAt = input.createdAt;
    const manifestFile = await open(manifestPath, 'w', 0o600);
    try { await manifestFile.writeFile(JSON.stringify(manifest, null, 2) + '\n'); await manifestFile.sync(); } finally { await manifestFile.close(); }
    await verifyControl(staging);
    const copy = new DatabaseSync(join(staging, 'control.sqlite'), { readOnly: true, allowExtension: false });
    try { exactRows(copy, input.tables); } finally { copy.close(); }
    await mkdir(snapshotDirectory, { mode: 0o700 }); published = true;
    for (const name of ['control.sqlite', 'manifest.json']) await rename(join(staging, name), join(snapshotDirectory, name));
    await sync(snapshotDirectory); await sync(dirname(snapshotDirectory));
    await verifyControl(snapshotDirectory);
    return { status: 'verified', format: 'hehebot-control-snapshot', version: 1, application_only: true, activation_allowed: false };
  } catch {
    if (published) await rm(snapshotDirectory, { recursive: true, force: true });
    return fail();
  } finally { if (work) await rm(work, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4) fail();
    console.log(JSON.stringify(await importControlExport(process.argv[2], process.argv[3])));
  } catch { console.error('CONTROL_EXPORT_IMPORT_FAILED'); process.exitCode = 1; }
}
