#!/usr/bin/env node
// Credential-free integrated application backup/decrypt/semantic-inspection drill (F6/E10 evidence slice).
//
// Composes the existing public APIs against a disposable private on-disk SQLite source and real
// pinned age: snapshotControl -> createControlBackup -> decryptControlBackup -> inspectControlRestore,
// with two distinct negatives (flipped ciphertext bytes and an unrelated generated identity).
// The drill proves that unresolved custody (recovery run, outcome_unknown effect, retained lock,
// unknown operation) survives the snapshot/encrypt/decrypt round trip byte-for-byte and is still
// reported as blockers, never as corruption and never as restore readiness. Successful decrypt is
// NOT evidence of safe restore: external_readiness stays 'unverified' and coordinated_restore_ready
// stays false. This is an application snapshot drill, not a coordinated native/browser restore,
// process termination, key-custody acceptance or production activation.
//
// Synthetic fixtures, generated disposable identities and private temporary directories only: no
// real secrets, accounts, provider calls or off-host writes. Failures exit 1 with a fixed message
// and never echo paths, rows, task text or key material.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshotControl, verifyControl } from './backup-control.mjs';
import { createControlBackup } from './create-control-backup.mjs';
import { decryptControlBackup } from './encrypt-control-backup.mjs';
import { inspectControlRestore } from './inspect-control-restore.mjs';

const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const ageBinary = process.env.HEHEBOT_AGE_BIN ?? join(repository, '.local/age-v1.3.2/age/age');
const keygenBinary = process.env.HEHEBOT_AGE_KEYGEN_BIN ?? join(repository, '.local/age-v1.3.2/age/age-keygen');
const schema = await readFile(process.env.HEHEBOT_DRILL_SCHEMA ?? join(repository, 'DB/schema.sql'), 'utf8');
const inspectCli = fileURLToPath(new URL('./inspect-control-restore.mjs', import.meta.url));
const decryptCli = fileURLToPath(new URL('./encrypt-control-backup.mjs', import.meta.url));
const backupId = '00000000-0000-4000-8000-000000000610';

// Private synthetic canaries that must never appear in any console or CLI output of this drill.
const canaryTaskText = 'PRIVATE_DRILL_TASK_TEXT_610';
const canaryResource = 'drill-private-resource-610';
const canaryAuthorization = 'drill-private-authorization-610';
const canaryDigest = 'drill-private-digest-610';
const canaries = [canaryTaskText, canaryResource, canaryAuthorization, canaryDigest, 'AGE-SECRET-KEY-1'];

const assert = (condition, code) => { if (!condition) throw new Error(code); };
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value && typeof value === 'object'
    ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function fingerprint(paths) {
  const result = {};
  for (const path of paths) result[path] = digest(await readFile(path));
  return result;
}
async function absent(path) {
  try { await stat(path); } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  throw new Error('UNEXPECTED_PUBLISHED_DESTINATION');
}
const outputClean = output => assert(!canaries.some(canary => output.includes(canary)), 'OUTPUT_LEAK');
async function refusal(promise, code) {
  try { await promise; } catch (error) {
    assert(error instanceof Error && error.message === code, 'UNEXPECTED_FAILURE');
    return;
  }
  throw new Error('MISSING_REFUSAL');
}

let root;
try {
  // Disposable private staging and synthetic generated identities (never real credentials).
  root = await mkdtemp(join(tmpdir(), 'hehebot-restore-drill-'));
  const source = join(root, 'source.sqlite');
  const snapshot = join(root, 'snapshot');
  const backups = join(root, 'backups');
  const identity = join(root, 'identity.txt');
  const unrelated = join(root, 'unrelated.txt');
  const cipher = join(backups, backupId + '.age');
  const staging = join(root, 'decrypted');
  for (const binary of [ageBinary, keygenBinary]) {
    assert(execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim() === 'v1.3.2', 'AGE_VERSION');
  }
  execFileSync(keygenBinary, ['-o', identity], { stdio: ['ignore', 'ignore', 'pipe'] });
  await chmod(identity, 0o600);
  execFileSync(keygenBinary, ['-o', unrelated], { stdio: ['ignore', 'ignore', 'pipe'] });
  await chmod(unrelated, 0o600);
  const recipient = execFileSync(keygenBinary, ['-y', identity], { encoding: 'utf8' }).trim();

  // Seed a disposable private application database: two asymmetric synthetic personas, settled
  // coordinator/sibling history, and one recovery-required background task carrying preserved
  // unresolved custody (retained lock, outcome_unknown effect, unknown operation).
  await writeFile(source, '', { mode: 0o600 });
  const db = new DatabaseSync(source);
  try {
    db.exec(schema);
    for (const [persona, revision] of [['persona-a', 1], ['persona-b', 2]]) {
      db.prepare('INSERT INTO objects VALUES(?,?,?,?,NULL,?,?)').run(persona, 'persona', revision,
        JSON.stringify({ kind: 'persona', note: `drill-${persona}` }), 't1', 't1');
    }
    const context = persona => JSON.stringify({ schema_version: 1, persona: { id: persona }, routine: null,
      room_id: null, scope_key: `${persona}/personal`, instruction: canaryTaskText });
    const insertRun = (id, parent, persona, status, attemptStatus) => {
      db.prepare('INSERT INTO runs(id,persona_id,context_json,role,parent_run_id,status,current_attempt,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?)')
        .run(id, persona, context(persona), parent ? 'background' : 'coordinator', parent, status, 't1', 't9');
      db.prepare('INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,native_run_ref,status,deadline_at,settled_at) VALUES(?,1,?,1,?,?,?,?,?)')
        .run(id, `${id}-submission`, 'boot-1', `${id}-native-1`, attemptStatus, 't9', 't8');
      if (parent) db.prepare('INSERT INTO native_task_links VALUES(?,?,?,?,?)').run(id, parent, 1, `${id}-native-1`, `${id}-thread`);
    };
    insertRun('drill-root', null, 'persona-a', 'completed', 'completed');
    insertRun('drill-recovery-child', 'drill-root', 'persona-a', 'completed', 'completed');
    insertRun('drill-sibling', 'drill-root', 'persona-b', 'completed', 'completed');
    db.exec("UPDATE runs SET status='recovery_required' WHERE id='drill-recovery-child'; UPDATE attempts SET status='terminated' WHERE run_id='drill-recovery-child'");
    db.prepare('INSERT INTO resource_locks VALUES(?,?,1,?)').run(canaryResource, 'drill-recovery-child', 't1');
    db.prepare('INSERT INTO effects VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run('drill-effect', 'drill-recovery-child', 'drill-action', 'mutation', 'outcome_unknown',
        canaryAuthorization, canaryDigest, null, null, 't1');
    db.prepare('INSERT INTO operations VALUES(?,?,?,?,?,?,?,?)')
      .run('drill-operation', 'drill-recovery-child', 1, 'tool', 'unknown', 't1', 't9', 't3');
    assert(db.prepare('PRAGMA foreign_key_check').all().length === 0, 'SEED_FOREIGN_KEYS');
  } finally { db.close(); }

  // Snapshot with the real SQLite online backup, then encrypt the exact verified copy.
  await snapshotControl(source, snapshot);
  const snapshotManifest = await verifyControl(snapshot);
  const originalSnapshot = await Promise.all(['control.sqlite', 'manifest.json'].map(name => readFile(join(snapshot, name))));
  await mkdir(backups, { mode: 0o700 });
  await writeFile(join(backups, 'inventory.json'), '{"version":1,"backups":[]}\n', { mode: 0o600 });
  const entry = await createControlBackup(snapshot, backups, { id: backupId, recipient, ageBinary, now: new Date().toISOString() });
  const cipherBytes = await readFile(cipher);
  assert(entry.id === backupId && entry.bytes === cipherBytes.length && entry.sha256 === digest(cipherBytes), 'BACKUP_ENTRY');
  assert(JSON.stringify((await readdir(backups)).sort())
    === JSON.stringify(['.prune', '.prune.lock', backupId + '.age', 'inventory.json']), 'BACKUP_COMPONENTS');
  assert(!cipherBytes.includes(Buffer.from(canaryTaskText)) && !cipherBytes.includes(Buffer.from(canaryResource)), 'CIPHERTEXT_PLAINTEXT_LEAK');

  // Decrypt with the explicit identity file only; the exact original bytes must come back.
  const decrypted = await decryptControlBackup(cipher, staging, identity, ageBinary);
  assert(decrypted.status === 'ok' && decrypted.operation === 'decrypt', 'DECRYPT_STATUS');
  assert(JSON.stringify((await readdir(staging)).sort()) === '["control.sqlite","manifest.json"]', 'STAGING_COMPONENTS');
  for (const [index, name] of ['control.sqlite', 'manifest.json'].entries()) {
    assert((await readFile(join(staging, name))).equals(originalSnapshot[index]), 'DECRYPTED_BYTES_CHANGED');
  }
  assert(canonical(await verifyControl(staging)) === canonical(snapshotManifest), 'DECRYPTED_MANIFEST');

  // Semantic inspection of the decrypted staging copy: the original unresolved custody must
  // survive as blockers, not as corruption, and must never authorize restore or activation.
  const guarded = [source, join(snapshot, 'control.sqlite'), join(snapshot, 'manifest.json'), cipher,
    join(backups, 'inventory.json'), join(staging, 'control.sqlite'), join(staging, 'manifest.json'), identity, unrelated];
  const before = await fingerprint(guarded);
  const report = await inspectControlRestore(staging);
  const expectedReport = { version: 1, snapshot_verified: true, schema_version: 13,
    semantic_status: 'no_detected_inconsistency', inconsistencies: {},
    blockers: { RECOVERY_RUN: 1, RETAINED_LOCK: 1, UNRESOLVED_EFFECT: 1, UNRESOLVED_OPERATION: 1 },
    external_readiness: 'unverified', coordinated_restore_ready: false };
  assert(canonical(report) === canonical(expectedReport), 'INSPECTION_REPORT');
  const inspectRun = spawnSync(process.execPath, [inspectCli, staging], { encoding: 'utf8' });
  assert(inspectRun.status === 2, 'INSPECT_CLI_EXIT');
  assert(canonical(JSON.parse(inspectRun.stdout)) === canonical(report), 'INSPECT_CLI_REPORT');
  outputClean(inspectRun.stdout + inspectRun.stderr);
  assert(canonical(await fingerprint(guarded)) === canonical(before), 'INSPECTION_MUTATED_SOURCE');
  assert(JSON.stringify((await readdir(snapshot)).sort()) === '["control.sqlite","manifest.json"]', 'SNAPSHOT_SIDECARS');

  // Negative 1: flipped ciphertext bytes must be refused without publishing a staging result
  // or mutating the source, inventory, snapshot or identities.
  const tampered = join(root, 'tampered.age');
  const flipped = Buffer.from(cipherBytes);
  flipped[flipped.length - 1] ^= 1;
  await writeFile(tampered, flipped, { mode: 0o600 });
  const refusedTamper = join(root, 'refused-tamper');
  await refusal(decryptControlBackup(tampered, refusedTamper, identity, ageBinary), 'AGE_FAILED');
  await absent(refusedTamper);
  const tamperCli = spawnSync(process.execPath,
    [decryptCli, 'decrypt', tampered, join(root, 'refused-tamper-cli'), identity, ageBinary], { encoding: 'utf8' });
  assert(tamperCli.status === 1, 'TAMPER_CLI_EXIT');
  outputClean(tamperCli.stdout + tamperCli.stderr);
  await absent(join(root, 'refused-tamper-cli'));

  // Negative 2: an unrelated generated identity must be refused the same way.
  const refusedWrongKey = join(root, 'refused-wrong-key');
  await refusal(decryptControlBackup(cipher, refusedWrongKey, unrelated, ageBinary), 'AGE_FAILED');
  await absent(refusedWrongKey);
  const wrongKeyCli = spawnSync(process.execPath,
    [decryptCli, 'decrypt', cipher, join(root, 'refused-wrong-key-cli'), unrelated, ageBinary], { encoding: 'utf8' });
  assert(wrongKeyCli.status === 1, 'WRONG_KEY_CLI_EXIT');
  outputClean(wrongKeyCli.stdout + wrongKeyCli.stderr);
  await absent(join(root, 'refused-wrong-key-cli'));

  assert(JSON.stringify((await readdir(root)).filter(name => name.startsWith('.hehebot-age-'))) === '[]', 'TEMP_DIRS_LEFT');
  assert(canonical(await fingerprint(guarded)) === canonical(before), 'REFUSAL_MUTATED_SOURCE');

  // End-to-end: the untouched staging copy still verifies and still reports the same custody.
  assert(canonical(await verifyControl(staging)) === canonical(snapshotManifest), 'FINAL_VERIFY');
  assert(canonical(await inspectControlRestore(staging)) === canonical(report), 'FINAL_INSPECTION');

  // Bounded summary only; self-check that this drill's own output leaks nothing private.
  const summary = { status: 'ok', drill: 'control-backup-restore-drill', scope: 'local-application-snapshot-only',
    steps: ['seed', 'snapshot', 'encrypt', 'decrypt', 'inspect', 'tamper-refused', 'wrong-key-refused', 'output-clean'],
    external_readiness: 'unverified', coordinated_restore_ready: false, activation_authorized: false };
  outputClean(JSON.stringify(summary));
  console.log(JSON.stringify(summary));
} catch {
  console.error('CONTROL_BACKUP_RESTORE_DRILL_FAILED');
  process.exitCode = 1;
} finally {
  if (root) await rm(root, { recursive: true, force: true });
}
