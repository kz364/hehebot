#!/usr/bin/env node
import { spawn, execFile } from 'node:child_process';
import { constants, createReadStream, createWriteStream } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, open, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { verifyControl } from './backup-control.mjs';

export const AGE_VERSION = 'v1.3.2';
export const MAX_DATABASE_BYTES = 256 * 1024 * 1024;
const maxManifest = 65536, magic = Buffer.from('HEHEBOT-CONTROL-BACKUP/1\n');
const headerBytes = magic.length + 8, maxPlaintext = headerBytes + maxManifest + MAX_DATABASE_BYTES;
const maxCiphertext = maxPlaintext + 1024 * 1024;
const env = { PATH: '', LANG: 'C' }; // No account environment, plugin lookup or default key discovery.
const fail = code => { throw new Error(code); };

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
async function newDestination(path) {
  absolute(path); await checked(dirname(path), 'directory');
  try { await lstat(path); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  fail('DESTINATION_EXISTS');
}
async function version(binary) {
  await checked(binary, 'executable');
  try {
    const result = await promisify(execFile)(binary, ['--version'], { env, timeout: 5000, maxBuffer: 1024 });
    if (result.stdout.trim() !== AGE_VERSION) fail('AGE_VERSION');
  } catch { fail('AGE_VERSION'); }
}
const bounded = maximum => {
  let bytes = 0;
  return new Transform({ transform(chunk, _encoding, done) {
    bytes += chunk.length; done(bytes > maximum ? new Error('SIZE_LIMIT') : null, chunk);
  } });
};
async function runAge(binary, args, input, output, maximum, identity) {
  const child = spawn(binary, args, { env, stdio: ['pipe', 'pipe', 'ignore', ...(identity ? [identity.fd] : [])] });
  const exit = new Promise((ok, reject) => {
    child.once('error', () => reject(new Error('AGE_FAILED')));
    child.once('close', code => code === 0 ? ok() : reject(new Error('AGE_FAILED')));
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), 120000); timer.unref();
  const tasks = [exit, pipeline(input, bounded(identity ? maxCiphertext : maxPlaintext), child.stdin), pipeline(child.stdout, bounded(maximum), createWriteStream(output, { flags: 'wx', mode: 0o600 }))];
  try { await Promise.all(tasks); }
  catch { child.kill('SIGKILL'); await Promise.allSettled(tasks); fail('AGE_FAILED'); }
  finally { clearTimeout(timer); }
}
async function sync(path) {
  const file = await open(path, 'r'); try { await file.sync(); } finally { await file.close(); }
}
async function* container(directory, manifestSize, databaseSize) {
  const header = Buffer.alloc(headerBytes); magic.copy(header); header.writeUInt32BE(manifestSize, magic.length); header.writeUInt32BE(databaseSize, magic.length + 4);
  yield header;
  for (const name of ['manifest.json', 'control.sqlite']) {
    for await (const chunk of createReadStream(join(directory, name))) yield chunk;
  }
}

export async function encryptControlBackup(snapshotDirectory, encryptedFile, recipient, ageBinary) {
  if (typeof recipient !== 'string' || !/^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$/.test(recipient)) fail('RECIPIENT_INVALID');
  await newDestination(encryptedFile); await version(ageBinary);
  await checked(snapshotDirectory, 'directory');
  if (encryptedFile.startsWith(snapshotDirectory + '/')) fail('UNSAFE_PATH'); // Preserve the source's exact two-component directory.
  const manifestSize = (await checked(join(snapshotDirectory, 'manifest.json'))).size;
  const databaseSize = (await checked(join(snapshotDirectory, 'control.sqlite'))).size;
  if (manifestSize < 1 || manifestSize > maxManifest || databaseSize < 100 || databaseSize > MAX_DATABASE_BYTES) fail('SIZE_LIMIT');
  await verifyControl(snapshotDirectory);
  const work = await mkdtemp(join(dirname(encryptedFile), '.hehebot-age-'));
  let published = false;
  try {
    const snapshot = join(work, 'snapshot'); await mkdir(snapshot, { mode: 0o700 });
    for (const name of ['manifest.json', 'control.sqlite']) await copyFile(join(snapshotDirectory, name), join(snapshot, name), constants.COPYFILE_EXCL);
    await verifyControl(snapshot); // Encrypt the exact private copy verified here, not a mutable source stream.
    if ((await lstat(join(snapshot, 'manifest.json'))).size !== manifestSize || (await lstat(join(snapshot, 'control.sqlite'))).size !== databaseSize) fail('SOURCE_CHANGED');
    const cipher = join(work, 'payload.age');
    await runAge(ageBinary, ['--encrypt', '--recipient', recipient], Readable.from(container(snapshot, manifestSize, databaseSize)), cipher, maxCiphertext);
    await sync(cipher);
    await copyFile(cipher, encryptedFile, constants.COPYFILE_EXCL); published = true;
    await sync(encryptedFile); await sync(dirname(encryptedFile));
    return { status: 'ok', operation: 'encrypt', format: 'age-encryption.org/v1', ageVersion: AGE_VERSION };
  } catch (error) { if (published) await rm(encryptedFile, { force: true }); throw error; }
  finally { await rm(work, { recursive: true, force: true }); }
}

async function identityFile(path) {
  const stat = await checked(path); await checked(dirname(path), 'directory');
  if (stat.size < 1 || stat.size > 4096) fail('IDENTITY_INVALID');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const bytes = Buffer.alloc(4097); const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    const lines = bytes.subarray(0, bytesRead).toString('utf8').split('\n').filter(line => line !== '' && !line.startsWith('#'));
    if (bytesRead > 4096 || lines.length !== 1 || !/^AGE-SECRET-KEY-1[023456789ACDEFGHJKLMNPQRSTUVWXYZ]{58}$/.test(lines[0])) fail('IDENTITY_INVALID');
    bytes.fill(0); return file; // The CLI inherits the opened file descriptor, never the secret in argv/environment.
  } catch (error) { await file.close(); throw error; }
}

async function unpack(path, snapshot) {
  const total = (await lstat(path)).size, file = await open(path, 'r');
  try {
    const header = Buffer.alloc(headerBytes); const { bytesRead } = await file.read(header, 0, header.length, 0);
    if (bytesRead !== headerBytes || !header.subarray(0, magic.length).equals(magic)) fail('CONTAINER_INVALID');
    const manifestSize = header.readUInt32BE(magic.length), databaseSize = header.readUInt32BE(magic.length + 4);
    if (manifestSize < 1 || manifestSize > maxManifest || databaseSize < 100 || databaseSize > MAX_DATABASE_BYTES ||
      total !== headerBytes + manifestSize + databaseSize) fail('CONTAINER_INVALID');
    await mkdir(snapshot, { mode: 0o700 });
    let offset = headerBytes;
    for (const [name, size] of [['manifest.json', manifestSize], ['control.sqlite', databaseSize]]) {
      await pipeline(createReadStream(path, { start: offset, end: offset + size - 1 }), createWriteStream(join(snapshot, name), { flags: 'wx', mode: 0o600 }));
      offset += size;
    }
  } finally { await file.close(); }
}

export async function decryptControlBackup(encryptedFile, stagingDirectory, identityPath, ageBinary) {
  await newDestination(stagingDirectory); await version(ageBinary);
  const size = (await checked(encryptedFile)).size; await checked(dirname(encryptedFile), 'directory');
  if (size < 1 || size > maxCiphertext) fail('SIZE_LIMIT');
  const identity = await identityFile(identityPath);
  let work, published = false;
  try {
    work = await mkdtemp(join(dirname(stagingDirectory), '.hehebot-age-'));
    const plaintext = join(work, 'authenticated-container');
    await runAge(ageBinary, ['--decrypt', '--identity', '/dev/fd/3'], createReadStream(encryptedFile), plaintext, maxPlaintext, identity);
    // Do not parse, extract or publish even authenticated prefix chunks before full age success.
    const snapshot = join(work, 'snapshot'); await unpack(plaintext, snapshot); await verifyControl(snapshot);
    await mkdir(stagingDirectory, { mode: 0o700 }); published = true;
    for (const name of ['control.sqlite', 'manifest.json']) {
      await rename(join(snapshot, name), join(stagingDirectory, name)); await sync(join(stagingDirectory, name));
    }
    await sync(stagingDirectory); await sync(dirname(stagingDirectory));
    await verifyControl(stagingDirectory);
    return { status: 'ok', operation: 'decrypt', format: 'age-encryption.org/v1', ageVersion: AGE_VERSION };
  } catch (error) { if (published) await rm(stagingDirectory, { recursive: true, force: true }); throw error; }
  finally { await identity.close(); if (work) await rm(work, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, ...args] = process.argv.slice(2);
    if (args.length !== 4) fail('USAGE');
    if (mode === 'encrypt') console.log(JSON.stringify(await encryptControlBackup(...args)));
    else if (mode === 'decrypt') console.log(JSON.stringify(await decryptControlBackup(...args)));
    else fail('USAGE');
  } catch {
    console.error('ENCRYPTED_CONTROL_BACKUP_FAILED: check private paths, pinned age, key reference and verified snapshot; usage: encrypt <snapshot-dir> <new-age-file> <public-recipient> <age-binary> | decrypt <age-file> <new-staging-dir> <identity-file> <age-binary>');
    process.exitCode = 1;
  }
}
