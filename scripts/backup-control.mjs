#!/usr/bin/env node
// Local application SQLite only. No executor, credential, restore or network APIs.
import { DatabaseSync, backup } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Exact reviewed application schemas; old snapshots remain verifiable.
const schemaPins = {
  8: '99b9fa6597785da358b9b0adfbef41a09802648ece96da2792956405de55e619',
  9: '15bf82e1965b24b0620dfe9a6541ce74759320113c3ed230fe2048f6e10ee01c',
  10: '682c042d228bff9b09816e47ee175ccce8f71702e7d1148e76412fe75dd1aec4',
  11: '8bd40b2cb56bf706a72006fe4a54cf310d1620ec3c0d408af4429d5cf2c5947a',
  12: 'a333b2b0ca9d5e7572e84d8aa3f8210b99e3b946a831bbd6dd4ff231173d0bf6',
  13: '0eaf3801cdd090fbeeb7d2d362f19c1e7157ae01bb7a09264409bbf504a17d2f',
  14: '1fe0bfe3a7be6a29c66dc3b73bb3b8974de03fbda7773fe921c50e7b19558ddb',
  15: '327be864123d24d2aa574a9bddb9b333948b7311e2eb0ea9363d4b37b3799c5c',
  16: 'ce7ce5e8bf6f0d2574a42eb90653900e79b67c240b55bdd8b12acea29874cb80',
};
const maxManifest = 65536;
const fail = code => { throw new Error(code); };
const hash = value => createHash('sha256').update(value).digest('hex');

async function checkedPath(path, directory = false) {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path || path.includes('\0')) fail('UNSAFE_PATH');
  let current = parse(path).root;
  for (const part of path.slice(current.length).split('/').filter(Boolean)) {
    current = join(current, part);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) fail('UNSAFE_PATH');
    // An untrusted ancestor may not replace paths; system sticky /tmp is allowed.
    if (current !== path && (!stat.isDirectory() || (stat.uid !== 0 && stat.uid !== process.getuid()) ||
        ((stat.mode & 0o022) && !(stat.mode & 0o1000)))) fail('UNSAFE_PATH');
  }
  const stat = await lstat(path);
  if (stat.uid !== process.getuid() || (stat.mode & 0o077) ||
      (directory ? !stat.isDirectory() : (!stat.isFile() || stat.nlink !== 1))) fail('UNSAFE_PATH');
  return stat;
}

function schema(db) {
  return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name").all();
}

function inspect(db) {
  const rows = schema(db);
  const schemaSha256 = hash(JSON.stringify(rows));
  const schemaVersions = db.prepare('SELECT version FROM schema_versions ORDER BY version').all().map(row => row.version);
  const latest = schemaVersions.at(-1);
  if (schemaPins[latest] !== schemaSha256 || !schemaVersions.every((version, i) =>
    Number.isInteger(version) && version >= 1 && version <= latest && (!i || version > schemaVersions[i - 1]))) fail('UNSUPPORTED_SCHEMA');
  if (JSON.stringify(db.prepare('PRAGMA integrity_check').all()) !== '[{"integrity_check":"ok"}]') fail('INTEGRITY_FAILED');
  if (db.prepare('PRAGMA foreign_key_check').all().length) fail('FOREIGN_KEYS_FAILED');
  const counts = {};
  for (const row of rows.filter(row => row.type === 'table')) {
    const count = db.prepare(`SELECT count(*) AS n FROM "${row.name.replaceAll('"', '""')}"`).get().n;
    if (!Number.isSafeInteger(count) || count < 0) fail('COUNT_OVERFLOW');
    counts[row.name] = count;
  }
  return { schemaSha256, schemaVersions, counts };
}

async function sha256(path) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest('hex');
}

async function privateWrite(path, data = '') {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(data); await file.sync(); } finally { await file.close(); }
}

export async function snapshotControl(source, destination) {
  await checkedPath(source); await checkedPath(dirname(source), true);
  if (typeof destination !== 'string' || !isAbsolute(destination) || resolve(destination) !== destination) fail('UNSAFE_PATH');
  await checkedPath(dirname(destination), true);
  // Existing sidecars must also be private regular files, not redirections.
  for (const suffix of ['-wal', '-shm', '-journal']) {
    try { await checkedPath(source + suffix); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const db = new DatabaseSync(source, { readOnly: true, allowExtension: false });
  let created = false;
  try {
    db.exec('PRAGMA query_only=ON; BEGIN');
    inspect(db); // Establish the read transaction before starting the online backup.
    await mkdir(destination, { mode: 0o700 }); created = true;
    const path = join(destination, 'control.sqlite');
    await privateWrite(path);
    // Node 26.5.1 can omit the microtask checkpoint after native backup completion.
    // Keep a JS callback alive only while awaiting it; never alter SQLite's snapshot.
    const completionTick = setInterval(() => {}, 10);
    try { await backup(db, path); } finally { clearInterval(completionTick); }
    // Normalize only the copy, making the delivered database self-contained (no WAL dependency).
    const copy = new DatabaseSync(path, { allowExtension: false });
    let metadata;
    try { copy.exec('PRAGMA journal_mode=DELETE'); metadata = inspect(copy); } finally { copy.close(); }
    const file = await open(path, 'r'); try { await file.sync(); } finally { await file.close(); }
    const manifest = { format: 'hehebot-control-snapshot', version: 1, createdAt: new Date().toISOString(),
      database: 'control.sqlite', bytes: (await checkedPath(path)).size, sha256: await sha256(path), ...metadata };
    const text = JSON.stringify(manifest, null, 2) + '\n';
    if (Buffer.byteLength(text) > maxManifest) fail('MANIFEST_TOO_LARGE');
    await privateWrite(join(destination, 'manifest.json'), text);
    const dir = await open(destination, 'r'); try { await dir.sync(); } finally { await dir.close(); }
    const parent = await open(dirname(destination), 'r'); try { await parent.sync(); } finally { await parent.close(); }
    return manifest;
  } catch (error) {
    if (created) await rm(destination, { recursive: true, force: true });
    throw error;
  } finally { db.close(); }
}

export async function verifyControl(directory) {
  await checkedPath(directory, true);
  if (JSON.stringify((await readdir(directory)).sort()) !== '["control.sqlite","manifest.json"]') fail('COMPONENTS_INVALID');
  const manifestPath = join(directory, 'manifest.json'), path = join(directory, 'control.sqlite');
  if ((await checkedPath(manifestPath)).size > maxManifest) fail('MANIFEST_TOO_LARGE');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const keys = ['format', 'version', 'createdAt', 'database', 'bytes', 'sha256', 'schemaSha256', 'schemaVersions', 'counts'].sort();
  if (!manifest || JSON.stringify(Object.keys(manifest).sort()) !== JSON.stringify(keys) ||
      manifest.format !== 'hehebot-control-snapshot' || manifest.version !== 1 || manifest.database !== 'control.sqlite' ||
      typeof manifest.createdAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(manifest.createdAt) ||
      !Number.isFinite(Date.parse(manifest.createdAt)) || !Number.isSafeInteger(manifest.bytes) ||
      typeof manifest.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.sha256)) fail('MANIFEST_INVALID');
  if ((await checkedPath(path)).size !== manifest.bytes || await sha256(path) !== manifest.sha256) fail('HASH_MISMATCH');
  // Reject WAL format before SQLite can create shared-memory sidecars on open.
  const file = await open(path, 'r');
  const header = Buffer.alloc(20);
  try { await file.read(header, 0, header.length, 0); } finally { await file.close(); }
  if (header.subarray(0, 16).toString() !== 'SQLite format 3\0' || header[18] !== 1 || header[19] !== 1) fail('DATABASE_FORMAT_INVALID');
  const db = new DatabaseSync(path, { readOnly: true, allowExtension: false });
  try {
    if (db.prepare('PRAGMA journal_mode').get().journal_mode !== 'delete') fail('SIDECAR_DEPENDENCY');
    const metadata = inspect(db);
    for (const key of Object.keys(metadata)) {
      if (JSON.stringify(manifest[key]) !== JSON.stringify(metadata[key])) fail('METADATA_MISMATCH');
    }
    return manifest;
  } finally { db.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, ...args] = process.argv.slice(2);
    if (mode === 'snapshot' && args.length === 2) await snapshotControl(...args);
    else if (mode === 'verify' && args.length === 1) await verifyControl(args[0]);
    else fail('USAGE');
    console.log(JSON.stringify({ status: 'ok', operation: mode, scope: 'local-application-sqlite-only' }));
  } catch {
    // Never echo SQLite errors, caller paths, row values or untrusted manifest content.
    console.error('CONTROL_BACKUP_FAILED: check private paths, schema, integrity and snapshot components; usage: snapshot <absolute-source> <new-absolute-directory> | verify <absolute-directory>');
    process.exitCode = 1;
  }
}
