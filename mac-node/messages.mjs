import { DatabaseSync } from 'node:sqlite';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Read-only access to the macOS Messages database (ARCHITECTURE_V2 A9 /
// PROJECT_INTENT §5). The owner grants Full Disk Access to the node binary;
// this module never requests it, never writes, and never reads attachments.
export const DEFAULT_MESSAGES_DB = join(homedir(), 'Library', 'Messages', 'chat.db');
export const MESSAGES_LIMITS = Object.freeze({ defaultDays: 7, maxLimit: 50, defaultLimit: 20, scanRows: 2000, textChars: 2000, resultBytes: 60000 });
const APPLE_EPOCH_S = 978307200; // 2001-01-01T00:00:00Z

export class MessagesError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/** Best-effort decoder for `message.attributedBody` (an NSArchiver
 * "streamtyped" NSAttributedString) when `message.text` is NULL, as recent
 * macOS versions store it. It reads only the first NSString payload using the
 * stable layout `NSString 01 ?? 84 01 2B <length> <utf8>`, where the length is
 * one byte, or 0x81 + uint16 LE, or 0x82 + uint32 LE. Anything unexpected
 * returns null (the message is reported as text_unavailable); it never throws
 * and never reads past the buffer. */
export function decodeAttributedBody(blob) {
  if (!blob || !(blob instanceof Uint8Array) || blob.length < 16) return null;
  const buffer = Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength);
  const marker = buffer.indexOf('NSString', 0, 'latin1');
  if (marker < 0) return null;
  let i = marker + 8;
  if (i + 6 > buffer.length || buffer[i] !== 0x01 || buffer[i + 2] !== 0x84 || buffer[i + 3] !== 0x01 || buffer[i + 4] !== 0x2b) return null;
  i += 5;
  let length;
  if (buffer[i] === 0x81) { if (i + 3 > buffer.length) return null; length = buffer.readUInt16LE(i + 1); i += 3; }
  else if (buffer[i] === 0x82) { if (i + 5 > buffer.length) return null; length = buffer.readUInt32LE(i + 1); i += 5; }
  else if (buffer[i] < 0x80) { length = buffer[i]; i += 1; }
  else return null;
  if (length < 1 || i + length > buffer.length) return null;
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(i, i + length)); } catch { return null; }
}

function parseDate(value, fallbackMs) {
  if (value === undefined) return fallbackMs;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new MessagesError('INVALID_ARGS', 'since/until must be ISO dates.');
  return ms;
}
export function validateSearchArgs(args = {}, now = Date.now()) {
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
      Object.keys(args).some(key => !['query', 'sender', 'since', 'until', 'limit'].includes(key))) throw new MessagesError('INVALID_ARGS', 'Unsupported search arguments.');
  for (const key of ['query', 'sender']) if (args[key] !== undefined && (typeof args[key] !== 'string' || !args[key].length || args[key].length > 200)) throw new MessagesError('INVALID_ARGS', `${key} must be 1–200 characters.`);
  const limit = args.limit ?? MESSAGES_LIMITS.defaultLimit;
  if (!Number.isInteger(limit) || limit < 1 || limit > MESSAGES_LIMITS.maxLimit) throw new MessagesError('INVALID_ARGS', 'limit must be 1–50.');
  const until = parseDate(args.until, now), since = parseDate(args.since, until - MESSAGES_LIMITS.defaultDays * 86400000);
  if (since > until) throw new MessagesError('INVALID_ARGS', 'since must be before until.');
  return { query: args.query, sender: args.sender, sinceMs: since, untilMs: until, limit };
}

/** Opens chat.db strictly read-only (SQLite read-only open plus query_only). */
export function openMessagesDb(path = DEFAULT_MESSAGES_DB) {
  try {
    const db = new DatabaseSync(path, { readOnly: true });
    db.exec('PRAGMA query_only = ON');
    return db;
  } catch {
    throw new MessagesError('MESSAGES_UNAVAILABLE', 'Cannot open the Messages database read-only. The owner must grant Full Disk Access to the node binary.');
  }
}

const likeEscape = value => `%${value.replace(/[\\%_]/g, match => `\\${match}`)}%`;
/** Recent messages matching text/sender/date filters, newest first, bounded,
 * text only. `db` may be injected (tests); otherwise `path` is opened and
 * closed per call so no handle stays open between requests. */
export function searchMessages(args, { db, path = DEFAULT_MESSAGES_DB, now = Date.now() } = {}) {
  const filter = validateSearchArgs(args, now);
  const own = !db;
  const handle = db ?? openMessagesDb(path);
  try {
    // Modern chat.db stores nanoseconds since 2001-01-01 (beyond 2^53, so the
    // raw column is never selected into JS); older rows store seconds.
    const where = ['(CASE WHEN m.date > 100000000000 THEN m.date / 1000000000 ELSE m.date END) BETWEEN ? AND ?'];
    const values = [Math.floor(filter.sinceMs / 1000) - APPLE_EPOCH_S, Math.ceil(filter.untilMs / 1000) - APPLE_EPOCH_S];
    if (filter.sender) { where.push("h.id LIKE ? ESCAPE '\\'"); values.push(likeEscape(filter.sender)); }
    if (filter.query) { where.push("(m.text LIKE ? ESCAPE '\\' OR (m.text IS NULL AND m.attributedBody IS NOT NULL))"); values.push(likeEscape(filter.query)); }
    let rows;
    try {
      rows = handle.prepare(`SELECT m.guid AS guid, m.text AS text, m.attributedBody AS body, (CASE WHEN m.date > 100000000000 THEN m.date / 1000000000.0 ELSE m.date END) AS date_s, m.is_from_me AS is_from_me,
        m.service AS service, m.cache_has_attachments AS has_attachments, h.id AS sender, c.display_name AS chat_name, c.chat_identifier AS chat_identifier
        FROM message m LEFT JOIN handle h ON h.ROWID = m.handle_id
        LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID LEFT JOIN chat c ON c.ROWID = cmj.chat_id
        WHERE ${where.join(' AND ')} ORDER BY m.date DESC, m.ROWID DESC LIMIT ${MESSAGES_LIMITS.scanRows}`).all(...values);
    } catch { throw new MessagesError('MESSAGES_UNAVAILABLE', 'The Messages database schema was not recognized.'); }
    const needle = filter.query?.toLocaleLowerCase();
    const messages = [];
    const seen = new Set();
    for (const row of rows) {
      if (seen.has(row.guid)) continue;
      const text = typeof row.text === 'string' ? row.text : decodeAttributedBody(row.body);
      if (needle && !(text ?? '').toLocaleLowerCase().includes(needle)) continue;
      seen.add(row.guid);
      messages.push({ id: row.guid, date: new Date(Math.round((Number(row.date_s) + APPLE_EPOCH_S) * 1000)).toISOString(),
        from: row.is_from_me ? 'me' : row.sender ?? 'unknown', chat: row.chat_name || row.chat_identifier || null, service: row.service ?? null,
        text: text === null ? null : text.slice(0, MESSAGES_LIMITS.textChars), ...(text === null ? { text_unavailable: true } : {}),
        has_attachments: row.has_attachments === 1 });
      if (messages.length >= filter.limit) break;
    }
    const result = { messages, scanned: rows.length, window: { since: new Date(filter.sinceMs).toISOString(), until: new Date(filter.untilMs).toISOString() } };
    while (Buffer.byteLength(JSON.stringify(result)) > MESSAGES_LIMITS.resultBytes && result.messages.length) { result.messages.pop(); result.truncated = true; }
    return result;
  } finally { if (own) handle.close(); }
}
