#!/usr/bin/env node
// Offline restore of one nightly Worker-produced backup (see docs/BACKUPS.md).
// Decrypts a downloaded `.age` object with the pinned age CLI and the owner's
// private identity, verifies its sidecar manifest's hashes/row counts, and
// reconstructs a verified private snapshot via scripts/import-control-export.mjs.
// This never talks to R2, the Worker, or a live Durable Object; every input is
// a file the owner already downloaded (see the `wrangler r2 object get` steps
// in docs/BACKUPS.md). Not restore *admission*: see import-control-export.mjs's
// "This is not restore admission" section, which fully applies here too.
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { lstat, mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { AGE_VERSION } from './encrypt-control-backup.mjs';
import { importControlExport, MAX_EXPORT_BYTES } from './import-control-export.mjs';

const maxCiphertext = MAX_EXPORT_BYTES + 1024 * 1024, maxManifest = 65536;
const env = { PATH: '', LANG: 'C' }; // No account environment or plugin/key discovery.
const fail = code => { throw new Error(code); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function absolute(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path || path.includes('\0')) fail('UNSAFE_PATH');
}
async function checked(path, kind = 'file') {
  absolute(path); let current = parse(path).root;
  for (const part of path.slice(current.length).split('/').filter(Boolean)) {
    current = join(current, part); const stat = await lstat(current);
    if (stat.isSymbolicLink()) fail('UNSAFE_PATH');
    if (current !== path && (!stat.isDirectory() || (stat.uid !== 0 && stat.uid !== process.getuid()) ||
      ((stat.mode & 0o022) && !(stat.mode & 0o1000)))) fail('UNSAFE_PATH');
  }
  const stat = await lstat(path), executable = kind === 'executable';
  if ((stat.uid !== process.getuid() && !(executable && stat.uid === 0)) || (stat.mode & (executable ? 0o022 : 0o077)) ||
    (kind === 'directory' ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)) fail('UNSAFE_PATH');
  return stat;
}
async function version(binary) {
  await checked(binary, 'executable');
  try {
    const result = await promisify(execFile)(binary, ['--version'], { env, timeout: 5000, maxBuffer: 1024 });
    if (result.stdout.trim() !== AGE_VERSION) fail('AGE_VERSION');
  } catch { fail('AGE_VERSION'); }
}
async function readBounded(path, maxBytes) {
  const stat = await checked(path); await checked(dirname(path), 'directory');
  if (stat.size > maxBytes) fail('SIZE_LIMIT');
  return readFile(path);
}
const bounded = maximum => {
  let bytes = 0;
  return new Transform({ transform(chunk, _encoding, done) {
    bytes += chunk.length; done(bytes > maximum ? new Error('SIZE_LIMIT') : null, chunk);
  } });
};
async function decrypt(ageBinary, identity, ciphertextPath, plaintextPath, maxBytes) {
  const identityFile = await open(identity, 'r');
  try {
    // Write to stdout, not `-o`: age creates `-o` output with the default
    // umask (world-readable), which the private-path checks below would then
    // reject. A self-created, mode-0600, bounded write stream keeps this
    // script's own path-safety invariant instead of relying on age's umask.
    const child = spawn(ageBinary, ['--decrypt', '--identity', '/dev/fd/3', ciphertextPath],
      { env, stdio: ['ignore', 'pipe', 'ignore', identityFile.fd] });
    const exit = new Promise((resolveExit, reject) => { child.once('error', reject); child.once('close', code => code === 0 ? resolveExit() : reject(new Error('AGE_FAILED'))); });
    const timer = setTimeout(() => child.kill('SIGKILL'), 120000); timer.unref();
    try {
      await Promise.all([exit, pipeline(child.stdout, bounded(maxBytes), createWriteStream(plaintextPath, { flags: 'wx', mode: 0o600 }))]);
    } catch { child.kill('SIGKILL'); fail('AGE_FAILED'); }
    finally { clearTimeout(timer); }
  } finally { await identityFile.close(); }
}
function manifestShape(value) {
  return value && typeof value === 'object' && value.format === 'hehebot-control-backup-manifest' && value.version === 1 &&
    typeof value.created_at === 'string' && Number.isInteger(value.schema_version) &&
    value.bytes && Number.isInteger(value.bytes.plaintext) && Number.isInteger(value.bytes.ciphertext) &&
    value.sha256 && /^[0-9a-f]{64}$/.test(value.sha256.plaintext) && /^[0-9a-f]{64}$/.test(value.sha256.ciphertext) &&
    value.row_counts && typeof value.row_counts === 'object' && !Array.isArray(value.row_counts);
}

/** Verify one downloaded `.age` object against its sidecar manifest and
 * reconstruct it into a new verified snapshot directory. Every path must be
 * absolute; the new snapshot directory must not already exist (same
 * publication contract as importControlExport). */
export async function restoreControlBackup(ciphertextPath, manifestPath, identityPath, ageBinary, newSnapshotDirectory) {
  await version(ageBinary);
  await checked(identityPath); await checked(dirname(identityPath), 'directory');
  const ciphertext = await readBounded(ciphertextPath, maxCiphertext);
  const manifest = JSON.parse((await readBounded(manifestPath, maxManifest)).toString('utf8'));
  if (!manifestShape(manifest)) fail('MANIFEST_INVALID');
  if (hash(ciphertext) !== manifest.sha256.ciphertext || ciphertext.byteLength !== manifest.bytes.ciphertext) fail('CIPHERTEXT_MISMATCH');
  const work = await mkdtemp(join(dirname(resolve(newSnapshotDirectory)), '.hehebot-restore-'));
  try {
    const plaintextPath = join(work, 'export.json');
    await decrypt(ageBinary, identityPath, ciphertextPath, plaintextPath, MAX_EXPORT_BYTES);
    const plaintext = await readBounded(plaintextPath, MAX_EXPORT_BYTES);
    if (hash(plaintext) !== manifest.sha256.plaintext || plaintext.byteLength !== manifest.bytes.plaintext) fail('PLAINTEXT_MISMATCH');
    const parsed = JSON.parse(plaintext.toString('utf8'));
    if (parsed.format !== 'hehebot-control-export' || (parsed.schemaVersions?.at?.(-1)) !== manifest.schema_version) fail('MANIFEST_MISMATCH');
    const rowCounts = Object.fromEntries((parsed.tables ?? []).map(table => [table.name, table.rows.length]));
    if (JSON.stringify(rowCounts) !== JSON.stringify(manifest.row_counts)) fail('ROW_COUNT_MISMATCH');
    // The manifest and container are now fully authenticated by age + these
    // hash/shape checks; importControlExport independently re-verifies the
    // exact logical export contract (schema pin, cell types, int64 bounds,
    // private staging) before publishing anything.
    return await importControlExport(plaintextPath, newSnapshotDirectory);
  } finally { await rm(work, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 7) fail('USAGE');
    const [, , ciphertextPath, manifestPath, identityPath, ageBinary, newSnapshotDirectory] = process.argv;
    console.log(JSON.stringify(await restoreControlBackup(ciphertextPath, manifestPath, identityPath, ageBinary, newSnapshotDirectory)));
  } catch {
    console.error('CONTROL_BACKUP_RESTORE_FAILED: check private paths, the pinned age binary/identity, and the downloaded object + manifest; usage: restore-control-backup.mjs <ciphertext.age> <manifest.json> <identity-file> <age-binary> <new-snapshot-dir>');
    process.exitCode = 1;
  }
}
