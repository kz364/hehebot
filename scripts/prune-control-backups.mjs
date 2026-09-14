#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, mkdir, open, opendir, rename, rm, unlink } from 'node:fs/promises';
import { isAbsolute, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planBackupRetention } from './plan-backup-retention.mjs';

export const CONFIRM_LOCAL_DELETION = 'DELETE_LOCAL_ENCRYPTED_BACKUPS';
export const MAX_BACKUPS = 256;
const MAX_FILE = 256 * 1024 * 1024, MAX_TOTAL = 1024 * 1024 * 1024, MAX_JSON = 256 * 1024, MAX_JOURNALS = 32;
const AGE_MAGIC = 'age-encryption.org/v1\n';
const sha = value => createHash('sha256').update(value).digest('hex');
const text = value => JSON.stringify(value) + '\n';
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
/** @returns {never} */
function fail(code = 'CONTROL_BACKUP_PRUNE_FAILED') { throw Object.assign(new Error(code), { code }); }
function fields(value, names) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...names].sort())) fail();
}
async function checked(path, directory = false) {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path || path.includes('\0')) fail();
  let current = parse(path).root;
  for (const part of path.slice(current.length).split('/').filter(Boolean)) {
    current = join(current, part); const stat = await lstat(current);
    if (stat.isSymbolicLink() || current !== path && (!stat.isDirectory() ||
        stat.uid !== 0 && stat.uid !== process.getuid() || (stat.mode & 0o022) && !(stat.mode & 0o1000))) fail();
  }
  const stat = await lstat(path, { bigint: true });
  if (stat.uid !== BigInt(process.getuid()) || (stat.mode & 0o077n) ||
      (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1n)) fail();
  return stat;
}
const identity = stat => ({ dev: String(stat.dev), ino: String(stat.ino), ctime_ns: String(stat.ctimeNs), mtime_ns: String(stat.mtimeNs) });
async function sync(path) { const file = await open(path, 'r'); try { await file.sync(); } finally { await file.close(); } }
async function namesWithin(path, limit) {
  const names = [];
  for await (const entry of await opendir(path)) { names.push(entry.name); if (names.length > limit) fail(); }
  return names.sort();
}
async function readJSON(path) {
  const stat = await checked(path); if (stat.size > BigInt(MAX_JSON)) fail();
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const buffer = Buffer.alloc(MAX_JSON + 1); let length = 0;
    while (length < buffer.length) { const { bytesRead } = await file.read(buffer, length, buffer.length - length, null); if (!bytesRead) break; length += bytesRead; }
    if (length > MAX_JSON) fail();
    const bytes = buffer.subarray(0, length);
    return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), hash: sha(bytes) };
  } finally { await file.close(); }
}
async function atomicJSON(path, value, parent) {
  const body = text(value); if (Buffer.byteLength(body) > MAX_JSON) fail();
  const temporary = path + '.next'; let created = false;
  try {
    const file = await open(temporary, 'wx', 0o600); created = true;
    try { await file.writeFile(body); await file.sync(); } finally { await file.close(); }
    await rename(temporary, path); await sync(parent);
  } finally { if (created) await rm(temporary, { force: true }); }
}

/** Advisory Linux flock held by this process's open file description. Creators must cooperate.
 * @template T
 * @param {string} directory
 * @param {(identity: {dev: string, ino: string}) => T | Promise<T>} callback
 * @returns {Promise<T>}
 */
export async function withBackupDirectoryLock(directory, callback) {
  const root = await checked(directory, true), path = join(directory, '.prune.lock');
  const file = await open(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  try {
    const stat = await checked(path), opened = await file.stat({ bigint: true });
    if (stat.ino !== opened.ino || stat.dev !== opened.dev || stat.size !== 0n) fail();
    await new Promise((ok, reject) => {
      const child = spawn('/usr/bin/flock', ['--exclusive', '--nonblock', '--conflict-exit-code', '73', '3'],
        { stdio: ['ignore', 'ignore', 'ignore', file.fd], env: { PATH: '/usr/bin:/bin', LANG: 'C' } });
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      child.once('error', () => { clearTimeout(timer); reject(new Error('CONTROL_BACKUP_PRUNE_FAILED')); });
      child.once('exit', code => { clearTimeout(timer); if (code === 0) ok(); else reject(Object.assign(new Error('PRUNE_LOCK_BUSY'), { code: 'PRUNE_LOCK_BUSY' })); });
    });
    const again = await checked(directory, true), lock = await checked(path);
    if (again.ino !== root.ino || again.dev !== root.dev || lock.ino !== opened.ino || lock.dev !== opened.dev) fail();
    return await callback({ dev: String(root.dev), ino: String(root.ino) });
  } finally { await file.close(); } // Last inherited descriptor closes: kernel releases lock, including on crash.
}

function inventory(value, now) {
  fields(value, ['version', 'backups']);
  if (value.version !== 1 || !Array.isArray(value.backups) || value.backups.length > MAX_BACKUPS) fail();
  let total = 0;
  const entries = value.backups.map(row => {
    fields(row, ['id', 'snapshot_at', 'bytes', 'sha256']);
    if (!Number.isSafeInteger(row.bytes) || row.bytes < 22 || row.bytes > MAX_FILE || !hex(row.sha256)) fail();
    total += row.bytes;
    return { id: row.id, snapshot_at: row.snapshot_at, bytes: row.bytes, sha256: row.sha256 };
  }).sort((a, b) => a.id < b.id ? -1 : 1);
  if (total > MAX_TOTAL) fail();
  // Reuse exact timestamp, UUID, duplicate, Jakarta calendar and max-age rules.
  const policy = planBackupRetention({ now, snapshots: entries.map(({ id, snapshot_at }) => ({ id, snapshot_at })) });
  return { entries, policy };
}
async function ciphertext(directory, entry) {
  const path = join(directory, entry.id + '.age'), stat = await checked(path);
  if (stat.size !== BigInt(entry.bytes)) fail();
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await file.stat({ bigint: true });
    if (opened.ino !== stat.ino || opened.dev !== stat.dev) fail();
    const digest = createHash('sha256'), buffer = Buffer.alloc(65536); let length = 0, prefix = Buffer.alloc(0);
    while (true) {
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null); if (!bytesRead) break;
      length += bytesRead; if (length > entry.bytes) fail();
      const chunk = buffer.subarray(0, bytesRead); digest.update(chunk);
      if (prefix.length < AGE_MAGIC.length) prefix = Buffer.concat([prefix, chunk]).subarray(0, AGE_MAGIC.length);
    }
    if (length !== entry.bytes || digest.digest('hex') !== entry.sha256 || prefix.toString() !== AGE_MAGIC) fail();
    const after = await file.stat({ bigint: true });
    if (JSON.stringify(identity(after)) !== JSON.stringify(identity(stat))) fail();
    return identity(stat);
  } finally { await file.close(); }
}
const journalPath = (directory, digest) => join(directory, '.prune', digest + '.json');
function validateJournal(value, digest) {
  fields(value, ['version', 'plan', 'phase', 'states']);
  const plan = value.plan;
  fields(plan, ['version', 'now', 'directory', 'inventory_hash', 'entries', 'policy']);
  fields(plan.directory, ['dev', 'ino']);
  if (value.version !== 1 || plan.version !== 1 || sha(text(plan)) !== digest || !hex(plan.inventory_hash) ||
      !['reviewed', 'applying', 'complete'].includes(value.phase) || !Array.isArray(plan.entries)) fail();
  const { policy } = inventory({ version: 1, backups: plan.entries.map(row => {
    fields(row, ['id', 'snapshot_at', 'bytes', 'sha256', 'identity']);
    fields(row.identity, ['dev', 'ino', 'ctime_ns', 'mtime_ns']);
    if (!Object.values(row.identity).every(value => typeof value === 'string' && /^\d+$/.test(value))) fail();
    return { id: row.id, snapshot_at: row.snapshot_at, bytes: row.bytes, sha256: row.sha256 };
  }) }, plan.now);
  if (JSON.stringify(policy) !== JSON.stringify(plan.policy)) fail();
  const ids = policy.decisions.filter(row => row.action === 'expire').map(row => row.id);
  fields(value.states, ids);
  if (!Object.values(value.states).every(state => ['pending', 'deleting', 'deleted'].includes(state)) ||
      value.phase === 'reviewed' && Object.values(value.states).some(state => state !== 'pending') ||
      value.phase === 'complete' && Object.values(value.states).some(state => state !== 'deleted')) fail();
  return value;
}
async function journals(directory) {
  const path = join(directory, '.prune');
  try { await mkdir(path, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  await checked(path, true);
  await sync(directory); // Persist the journal directory entry before any destructive operation.
  const names = await namesWithin(path, MAX_JOURNALS);
  const result = new Map();
  for (const name of names.sort()) {
    if (!/^[a-f0-9]{64}\.json$/.test(name)) fail();
    const digest = name.slice(0, 64);
    result.set(digest, validateJournal((await readJSON(join(path, name))).value, digest));
  }
  return result;
}
async function verifyFiles(directory, entries, states = {}) {
  const expected = ['.prune', '.prune.lock', 'inventory.json', ...entries.filter(row => states[row.id] !== 'deleted').map(row => row.id + '.age')].sort();
  const actual = await namesWithin(directory, MAX_BACKUPS + 3);
  for (const row of entries) if (states[row.id] === 'deleting' && !actual.includes(row.id + '.age')) fail('PRUNE_OUTCOME_UNKNOWN');
  if (JSON.stringify(expected) !== JSON.stringify(actual)) fail();
  const verified = [];
  for (const row of entries) if (states[row.id] !== 'deleted') {
    const found = await ciphertext(directory, row);
    if (row.identity && JSON.stringify(found) !== JSON.stringify(row.identity)) fail();
    verified.push({ ...row, identity: found });
  }
  return verified;
}

export async function reviewControlBackups(directory, now) {
  return withBackupDirectoryLock(directory, async root => {
    const prior = await journals(directory);
    if ([...prior.values()].some(row => row.phase === 'applying')) fail('PRUNE_INCOMPLETE_APPLY');
    const catalog = await readJSON(join(directory, 'inventory.json'));
    const { entries, policy } = inventory(catalog.value, now);
    const plan = { version: 1, now, directory: root, inventory_hash: catalog.hash, entries: await verifyFiles(directory, entries), policy };
    const digest = sha(text(plan));
    if (!prior.has(digest)) {
      if (prior.size >= MAX_JOURNALS) fail();
      const states = Object.fromEntries(policy.decisions.filter(row => row.action === 'expire').map(row => [row.id, 'pending']));
      await atomicJSON(journalPath(directory, digest), { version: 1, plan, phase: 'reviewed', states }, join(directory, '.prune'));
    }
    return { digest, plan };
  });
}

export async function applyControlBackups(directory, digest, confirmation) {
  if (!hex(digest) || confirmation !== CONFIRM_LOCAL_DELETION) fail('PRUNE_CONFIRMATION_REQUIRED');
  return withBackupDirectoryLock(directory, async root => {
    const all = await journals(directory), journal = all.get(digest);
    if (!journal || [...all].some(([key, row]) => key !== digest && row.phase === 'applying')) fail('PRUNE_REVIEW_MISMATCH');
    const { plan, states } = journal;
    if (JSON.stringify(root) !== JSON.stringify(plan.directory)) fail('PRUNE_REVIEW_MISMATCH');
    const kept = plan.entries.filter(row => !Object.hasOwn(states, row.id));
    const remaining = { version: 1, backups: kept.map(({ id, snapshot_at, bytes, sha256 }) => ({ id, snapshot_at, bytes, sha256 })) };
    const catalog = await readJSON(join(directory, 'inventory.json'));
    const allDeleted = Object.values(states).every(state => state === 'deleted');
    const remainingHash = sha(text(remaining));
    if (journal.phase === 'complete' ? catalog.hash !== remainingHash :
        catalog.hash !== plan.inventory_hash && !(journal.phase === 'applying' && allDeleted && catalog.hash === remainingHash)) fail('PRUNE_REVIEW_MISMATCH');
    await verifyFiles(directory, plan.entries, states); // Every kept/candidate identity, not just deletion targets.
    const persist = () => atomicJSON(journalPath(directory, digest), journal, join(directory, '.prune'));
    if (journal.phase !== 'complete') {
      journal.phase = 'applying'; await persist();
      for (const entry of plan.entries) if (Object.hasOwn(states, entry.id) && states[entry.id] !== 'deleted') {
        if (JSON.stringify(await ciphertext(directory, entry)) !== JSON.stringify(entry.identity)) fail();
        states[entry.id] = 'deleting'; await persist(); // A missing file after this point is UNKNOWN, not a receipt.
        await unlink(join(directory, entry.id + '.age')); await sync(directory);
        states[entry.id] = 'deleted'; await persist(); // Exact hash receipt only after successful unlink and fsync.
      }
      await atomicJSON(join(directory, 'inventory.json'), remaining, directory);
      journal.phase = 'complete'; await persist();
    }
    return receipt(digest, journal);
  });
}
/** @returns {{digest: string, phase: string, deletions: Array<{id: string, bytes: number, sha256: string, state: string}>, remote_copies_verified: boolean}} */
function receipt(digest, journal) {
  return { digest, phase: journal.phase, deletions: journal.plan.entries.filter(row => Object.hasOwn(journal.states, row.id))
    .map(({ id, bytes, sha256 }) => ({ id, bytes, sha256, state: journal.states[id] })), remote_copies_verified: false };
}
export async function controlBackupPruneStatus(directory, digest) {
  if (!hex(digest)) fail();
  return withBackupDirectoryLock(directory, async root => {
    const value = (await journals(directory)).get(digest); if (!value) fail();
    if (JSON.stringify(root) !== JSON.stringify(value.plan.directory)) fail('PRUNE_REVIEW_MISMATCH');
    return receipt(digest, value);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, directory, value, confirm, ...extra] = process.argv.slice(2);
    if (extra.length) fail();
    if (mode === 'review' && confirm === undefined) console.log(JSON.stringify(await reviewControlBackups(directory, value)));
    else if (mode === 'apply' && confirm === '--confirm-local-deletion') console.log(JSON.stringify(await applyControlBackups(directory, value, CONFIRM_LOCAL_DELETION)));
    else if (mode === 'status' && confirm === undefined) console.log(JSON.stringify(await controlBackupPruneStatus(directory, value)));
    else fail();
  } catch { console.error('CONTROL_BACKUP_PRUNE_FAILED'); process.exitCode = 1; }
}
