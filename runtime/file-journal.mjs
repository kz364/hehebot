import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const queues = new Map();

const invalidRecord = () => { throw Object.assign(new Error('INVALID_JOURNAL_RECORD'), { code: 'INVALID_JOURNAL_RECORD' }); };
function parseRecord(text) {
  let row;
  try { row = JSON.parse(text); } catch { invalidRecord(); }
  if (!row || typeof row !== 'object' || Array.isArray(row)) invalidRecord();
  return row;
}
function encodeRecord(row) {
  let text;
  try { text = JSON.stringify(row); } catch { invalidRecord(); }
  parseRecord(text);
  return text;
}

/** Single executor process only. A separate provider fence and OS ownership lock are required.
 * Serialized, fsynced intent journal. No native DB access. Directory must be private persistent disk.
 * Use one canonical directory path, not symlink aliases, across reconstructed instances.
 */
export class FileJournal {
  constructor(directory) { this.directory = resolve(directory); }
  path(id) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error('INVALID_ATTEMPT');
    return join(this.directory, `${id}.json`);
  }
  async get(id) {
    try { return parseRecord(await readFile(this.path(id), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  serial(fn) {
    const result = (queues.get(this.directory) ?? Promise.resolve()).then(fn);
    const tail = result.catch(() => {}).finally(() => {
      if (queues.get(this.directory) === tail) queues.delete(this.directory);
    });
    queues.set(this.directory, tail);
    return result;
  }
  async write(id, row) {
    const contents = encodeRecord(row);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const target = this.path(id);
    const temporary = `${target}.${randomUUID()}.tmp`;
    const fd = await open(temporary, 'wx', 0o600);
    try { await fd.writeFile(contents); await fd.sync(); }
    finally { await fd.close(); }
    await rename(temporary, target);
    const directory = await open(this.directory, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
    return parseRecord(contents);
  }
  async putIfAbsent(id, row) {
    // Capture before serial() yields, not when the queue finally admits the write.
    row = parseRecord(encodeRecord(row));
    return this.serial(async () => {
      const existing = await this.get(id);
      if (existing) return existing;
      await this.write(id, row);
      return null;
    });
  }
  async update(id, patch) {
    const captured = parseRecord(encodeRecord(patch));
    // Omitted JSON properties still replace an existing field with undefined,
    // deleting it at final serialization. Do not turn deletions into no-ops.
    for (const key of Object.keys(patch)) if (!Object.hasOwn(captured, key)) {
      Object.defineProperty(captured, key, { value: undefined, enumerable: true });
    }
    patch = captured;
    return this.serial(async () => {
      const current = await this.get(id);
      if (!current) throw new Error('UNKNOWN_ATTEMPT');
      return this.write(id, { ...current, ...patch });
    });
  }
}
