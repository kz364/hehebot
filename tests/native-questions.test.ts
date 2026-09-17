import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { Store, type Database, type SqlValue } from '../src/core/store';
import { ControlCore } from '../src/core/control';
import { LifecycleCore } from '../src/core/lifecycle';
import { NativeQuestionLedger, type NativeQuestionInput, type NativeQuestionAnswerCommand } from '../src/core/native-questions';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const identity = { epoch: 7, boot_id: id(7) }, connection = id(8);
class DB implements Database {
  sqlite = new DatabaseSync(':memory:'); depth = 0;
  constructor() { this.sqlite.exec(readFileSync(process.env.HEHEBOT_NATIVE_QUESTION_TEST_SCHEMA ?? new URL('../DB/schema.sql', import.meta.url), 'utf8')); }
  all<T>(sql: string, ...values: SqlValue[]): T[] { return this.sqlite.prepare(sql).all(...values) as T[]; }
  exec(sql: string, ...values: SqlValue[]) { this.sqlite.prepare(sql).run(...values); }
  transaction<T>(fn: () => T): T {
    const key = `q${this.depth++}`; this.sqlite.exec(`SAVEPOINT ${key}`);
    try { const result = fn(); this.sqlite.exec(`RELEASE ${key}`); return result; }
    catch (e) { this.sqlite.exec(`ROLLBACK TO ${key}; RELEASE ${key}`); throw e; }
    finally { this.depth--; }
  }
}
let db: DB, store: Store, lifecycle: LifecycleCore, ledger: NativeQuestionLedger, clock: string, serial: number;
const rejects = (fn: () => unknown, code: string) => expect(fn).toThrowError(expect.objectContaining({ code }));
const input = (n = 100): NativeQuestionInput => ({ id: id(n), connection_id: connection, request_id: n,
  params: { threadId: 'thread/root', turnId: 'turn/one', itemId: `item/${n}`, isBlocking: true,
    questions: [{ id: '__proto__', header: 'Choose', question: 'Which synthetic option?', options: [{ label: 'Blue', description: 'First' }, { label: 'Amber', description: 'Second' }] },
      { id: 'free/2', header: 'Detail', question: 'Optional detail', options: null }] } });
const answers = () => Object.fromEntries([['__proto__', { answers: ['Amber'] }], ['free/2', { answers: [] }]]);
function receipt(payload: NativeQuestionAnswerCommand, owner = 'alice', status = 'accepted', type = 'question.answer') {
  const key = id(serial++);
  db.exec('INSERT INTO commands(id,owner_id,idempotency_key,body_hash,type,payload_json,status,accepted_at) VALUES(?,?,?,?,?,?,?,?)', key, owner, key, 'synthetic', type, JSON.stringify(payload), status, clock);
  return key;
}
const command = (n = 100): NativeQuestionAnswerCommand => ({ question_id: id(n), expected_revision: 1, answers: answers() });
const record = (n = 100) => ledger.record(identity, id(20), 1, input(n));
const queued = () => { record(); const c = command(); ledger.answer('alice', receipt(c), c); };
const total = () => db.all<{ n: number }>('SELECT total_changes() n')[0].n;
const otherTables = () => db.all<{ name: string }>("SELECT name FROM sqlite_schema WHERE type='table' AND name!='runtime_metadata' ORDER BY name")
  .map(({ name }) => [name, db.all(`SELECT * FROM "${name}" ORDER BY rowid`)]);
beforeEach(() => {
  clock = '2026-09-14T12:00:00.000Z'; serial = 10000; db = new DB(); store = new Store(db);
  expect(db.all('SELECT version FROM schema_versions')).toEqual([{ version: 12 }]);
  const core = new ControlCore(store, { executionEnabled: false, actionPolicyIds: [], toolPolicyIds: [], now: () => new Date(clock), uuid: () => id(serial++) });
  lifecycle = new LifecycleCore(store, core); ledger = new NativeQuestionLedger(store, lifecycle, () => clock);
  db.exec("INSERT INTO lifecycle(singleton,provider_ref_json,epoch,boot_id,phase,desired_state,lease_until) VALUES(1,'{}',7,?,'READY','RUN','2026-09-14T13:00:00.000Z')", identity.boot_id);
  for (const n of [20, 21]) {
    store.put(id(n + 10), 'persona', { name: 'Synthetic' }, 0, 'alice', clock);
    db.exec("INSERT INTO runs(id,persona_id,context_json,status,current_attempt,created_at,updated_at) VALUES(?,?,?,'running',1,?,?)", id(n), id(n + 10), JSON.stringify({ persona: { id: id(n + 10) }, room_id: n === 20 ? id(40) : null }), clock, clock);
    db.exec("INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,status,native_run_ref,deadline_at) VALUES(?,1,?,7,?,'running',?,'2026-09-14T12:10:00.000Z')", id(n), `submit${n}`, identity.boot_id, n === 20 ? 'turn/one' : 'turn/two');
  }
  db.exec('INSERT INTO resource_locks VALUES(?, ?,1,?)', 'resource', id(20), clock);
  db.exec("INSERT INTO effects(id,run_id,action_key,classification,status,authorization_ref,request_digest,updated_at) VALUES(?,?,'x','mutation','outcome_unknown','grant','digest',?)", id(50), id(20), clock);
});
afterEach(() => db.sqlite.close());

it('caps expiry at fifteen minutes and rejects dispatch at the exact boundary without losing the queued answer', () => {
  db.exec("UPDATE attempts SET deadline_at='2026-09-14T12:30:00.000Z'"); queued();
  expect(ledger.get(id(100)).expires_at).toBe('2026-09-14T12:15:00.000Z');
  const before = ledger.get(id(100)); clock = '2026-09-14T12:15:00.000Z';
  rejects(() => ledger.takeAnswer(identity, id(100), connection), 'NATIVE_QUESTION_EXPIRED');
  expect(ledger.get(id(100))).toEqual(before);
});
it('rolls back failed dispatch writes and rejects stale boot dispatch', () => {
  queued(); const before = ledger.get(id(100));
  db.sqlite.exec("CREATE TRIGGER fail_question BEFORE UPDATE ON runtime_metadata BEGIN SELECT RAISE(ABORT,'synthetic'); END");
  expect(() => ledger.takeAnswer(identity, id(100), connection)).toThrow(); expect(ledger.get(id(100))).toEqual(before);
  db.sqlite.exec('DROP TRIGGER fail_question');
  rejects(() => ledger.takeAnswer({ ...identity, boot_id: id(9) }, id(100), connection), 'STALE_EPOCH');
  expect(ledger.get(id(100))).toEqual(before);
});
it('accepts codepoint limits and explicit other text, but rejects oversized UTF8 input', () => {
  const q = input(); q.params.questions[0].header = '😀'.repeat(80); q.params.questions[0].question = '😀'.repeat(2000); q.params.questions[0].isOther = true;
  ledger.record(identity, id(20), 1, q); const c = command(); c.answers['__proto__'] = { answers: ['Not an option'] };
  ledger.answer('alice', receipt(c), c);
  const huge = input(101); huge.params.questions = Array.from({ length: 3 }, (_, n) => ({ id: String(n), header: '😀'.repeat(80), question: '😀'.repeat(2000),
    options: Array.from({ length: 3 }, () => ({ label: '😀'.repeat(200), description: '😀'.repeat(1000) })) }));
  expect(new TextEncoder().encode(JSON.stringify(huge)).length).toBeGreaterThan(65536);
  rejects(() => ledger.record(identity, id(20), 1, huge), 'INVALID_INPUT');
});

it('queues exact native IDs and skip, commits uncertainty before return and never replays after reopen; other tables unchanged', () => {
  const c = command(), cmd = receipt(c), before = otherTables(); record();
  expect(ledger.get(id(100))).toMatchObject({ persona_id: id(30), conversation_id: id(40), expires_at: '2026-09-14T12:10:00.000Z' });
  expect(ledger.list()[0].answerable).toBe(true);
  ledger.answer('alice', cmd, c); expect(ledger.list()[0].answerable).toBe(false);
  expect(ledger.takeAnswer(identity, id(100), connection)).toEqual({ answers: answers() });
  ledger = new NativeQuestionLedger(new Store(db), lifecycle, () => clock);
  expect(ledger.get(id(100))).toMatchObject({ state: 'response_unknown', revision: 3, response_taken_at: clock });
  expect(ledger.takeAnswer(identity, id(100), connection)).toBeNull();
  ledger.resolve(identity, id(100), connection); const changes = total(); ledger.resolve(identity, id(100), connection);
  expect(total()).toBe(changes); expect(ledger.list()).toEqual([]); expect(otherTables()).toEqual(before);
});
it('replays identical normalized input without writes and isolates typed request IDs and a second task', () => {
  record(); const changes = total(); record(); expect(total()).toBe(changes);
  const changed = input(); changed.params.questions[0].question = 'Changed';
  rejects(() => ledger.record(identity, id(20), 1, changed), 'IDEMPOTENCY_CONFLICT');
  const duplicate = input(101); duplicate.request_id = 100;
  rejects(() => ledger.record(identity, id(20), 1, duplicate), 'IDEMPOTENCY_CONFLICT');
  duplicate.request_id = '100'; duplicate.params.turnId = 'turn/two'; duplicate.params.threadId = 'thread/two';
  ledger.record(identity, id(21), 1, duplicate); const second = ledger.get(id(101));
  const c = command(); ledger.answer('bob', receipt(c, 'bob'), c);
  ledger.resolve(identity, id(100), connection); expect(ledger.get(id(101))).toEqual(second);
});
it.each(['pending', 'answered'])('resolution from %s preserves whether an answer was taken', state => {
  if (state === 'answered') queued(); else record();
  ledger.resolve(identity, id(100), connection);
  expect(ledger.get(id(100))).toMatchObject({ state: 'resolved', response_taken_at: null, revision: state === 'pending' ? 2 : 3 });
  expect(ledger.takeAnswer(identity, id(100), connection)).toBeNull();
  const c = command(); rejects(() => ledger.answer('alice', receipt(c), c), 'REVISION_CONFLICT');
});
it.each(['epoch', 'boot', 'attempt', 'lease', 'deadline', 'status', 'native', 'context', 'cancel', 'expiry'])('fences %s and lists stale obligations without read writes', kind => {
  record();
  if (kind === 'epoch') db.exec('UPDATE lifecycle SET epoch=8');
  if (kind === 'boot') db.exec('UPDATE lifecycle SET boot_id=?', id(9));
  if (kind === 'attempt') db.exec('UPDATE runs SET current_attempt=2 WHERE id=?', id(20));
  if (kind === 'lease') db.exec('UPDATE lifecycle SET lease_until=?', clock);
  if (kind === 'deadline') db.exec('UPDATE attempts SET deadline_at=?', clock);
  if (kind === 'status') db.exec("UPDATE runs SET status='finishing',error_code='CONTEXT_INVALIDATED' WHERE id=?", id(20));
  if (kind === 'cancel') db.exec("UPDATE runs SET error_code='OWNER_CANCELLED' WHERE id=?", id(20));
  if (kind === 'native') db.exec("UPDATE attempts SET native_run_ref='other'");
  if (kind === 'context') db.exec("UPDATE runs SET context_json='{}'");
  if (kind === 'expiry') clock = '2026-09-14T12:10:00.000Z';
  const before = total(); expect(ledger.list()[0].answerable).toBe(false); expect(total()).toBe(before);
  const c = command(), cmd = receipt(c), stored = ledger.get(id(100)); expect(() => ledger.answer('alice', cmd, c)).toThrow(); expect(ledger.get(id(100))).toEqual(stored);
});
it('resolution can close expired/cancelled work but cannot cross a connection or lease fence', () => {
  queued(); rejects(() => ledger.resolve(identity, id(100), id(99)), 'STALE_EPOCH');
  db.exec("UPDATE runs SET status='cancelling' WHERE id=?", id(20)); clock = '2026-09-14T12:20:00.000Z';
  ledger.resolve(identity, id(100), connection); expect(ledger.get(id(100)).response_taken_at).toBeNull();
  db.exec('UPDATE lifecycle SET epoch=8'); rejects(() => ledger.resolve(identity, id(100), connection), 'STALE_EPOCH');
});
it.each(['owner', 'status', 'type', 'payload', 'revision', 'missing', 'option', 'extra'])('rejects changed %s receipts/answers without mutation', kind => {
  record(); const c = command();
  if (kind === 'revision') c.expected_revision = 2;
  if (kind === 'missing') delete c.answers['free/2'];
  if (kind === 'extra') c.answers.extra = { answers: [] };
  if (kind === 'option') c.answers['__proto__'] = { answers: ['Red'] };
  const cmd = receipt(c, kind === 'owner' ? 'bob' : 'alice', kind === 'status' ? 'rejected' : 'accepted', kind === 'type' ? 'run.cancel' : 'question.answer');
  if (kind === 'payload') c.answers['free/2'] = { answers: ['different'] };
  const before = total(); expect(() => ledger.answer('alice', cmd, c)).toThrow(); expect(total()).toBe(before); expect(ledger.get(id(100)).state).toBe('pending');
});
it.each(['secret', 'id', 'question', 'header', 'count', 'duplicate', 'option', 'request', 'extra', 'surrogate'])('rejects malformed or unsupported %s', kind => {
  const q = input();
  if (kind === 'secret') q.params.questions[0].isSecret = true;
  if (kind === 'id') q.id = '../bad';
  if (kind === 'question') q.params.questions[0].question = 'x'.repeat(2001);
  if (kind === 'header') q.params.questions[0].header = '😀'.repeat(81);
  if (kind === 'count') q.params.questions = [];
  if (kind === 'duplicate') q.params.questions[1].id = q.params.questions[0].id;
  if (kind === 'option') q.params.questions[0].options![0].label = '';
  if (kind === 'request') q.request_id = Number.MAX_SAFE_INTEGER + 1;
  if (kind === 'extra') Object.assign(q, { authority: 'owner' });
  if (kind === 'surrogate') q.params.questions[0].question = '\ud800';
  const before = total(); expect(() => ledger.record(identity, id(20), 1, q)).toThrow(); expect(total()).toBe(before);
});
it('fails closed on corrupt records and unresolved/retained capacity, without repair', () => {
  for (let n = 100; n < 164; n++) record(n);
  expect(ledger.list()).toHaveLength(64); rejects(() => record(164), 'NATIVE_QUESTION_CAPACITY');
  const r = ledger.get(id(100));
  db.exec('UPDATE runtime_metadata SET value_json=? WHERE key=?', JSON.stringify({ ...r, revision: 99 }), `native-question:${r.id}`);
  const before = total(); rejects(() => ledger.list(), 'NATIVE_QUESTION_CORRUPT'); expect(total()).toBe(before);
  db.exec('DELETE FROM runtime_metadata');
  const settled = { ...r, state: 'resolved', resolved_at: clock, revision: 2 };
  db.transaction(() => { for (let n = 100; n < 4196; n++) db.exec('INSERT INTO runtime_metadata VALUES(?,?)', `native-question:${id(n)}`, JSON.stringify({ ...settled, id: id(n), request_id: n })); });
  rejects(() => record(5000), 'NATIVE_QUESTION_CAPACITY'); expect(ledger.list()).toEqual([]);
});

function settleForRetention() {
  db.exec("UPDATE runs SET status='completed' WHERE id=?", id(20));
  db.exec("UPDATE attempts SET status='completed',settled_at=? WHERE run_id=?", clock, id(20));
  db.exec('DELETE FROM resource_locks'); db.exec("UPDATE effects SET status='confirmed'");
}
it('expires resolved content at 90 days after later settlement, preserving other tables and preventing replay', () => {
  queued(); ledger.takeAnswer(identity, id(100), connection); ledger.resolve(identity, id(100), connection);
  clock = '2026-09-15T12:00:00.000Z'; settleForRetention();
  expect(ledger.nextExpiry()).toBe('2026-12-14T12:00:00.000Z');
  const before = otherTables();
  clock = '2026-12-14T11:59:59.999Z'; expect(ledger.prune()).toBe(0);
  clock = '2026-12-14T12:00:00.000Z'; expect(ledger.prune()).toBe(1);
  expect(ledger.nextExpiry()).toBeNull(); expect(ledger.prune()).toBe(0);
  expect(otherTables()).toEqual(before); rejects(() => ledger.get(id(100)), 'NOT_FOUND');
  // Expiry cannot make the old terminal attempt eligible for a new record.
  db.exec("UPDATE lifecycle SET lease_until='2027-01-01T00:00:00.000Z'");
  rejects(() => record(), 'REVISION_CONFLICT');
});
it('late native resolution starts retention after the earlier task settlement', () => {
  record(); settleForRetention(); clock = '2026-09-14T12:02:00.000Z';
  ledger.resolve(identity, id(100), connection);
  expect(ledger.nextExpiry()).toBe('2026-12-13T12:02:00.000Z');
  clock = '2026-12-13T12:00:00.000Z'; expect(ledger.prune()).toBe(0);
  clock = '2026-12-13T12:02:00.000Z'; expect(ledger.prune()).toBe(1);
});
it('never purges pending, answered or unknown questions merely because their task is terminal and expired', () => {
  record(100); record(101); record(102);
  for (const n of [101, 102]) { const c = command(n); ledger.answer('alice', receipt(c), c); }
  ledger.takeAnswer(identity, id(102), connection); settleForRetention();
  const before = db.all('SELECT * FROM runtime_metadata ORDER BY key');
  clock = '2027-09-15T00:00:00.000Z'; expect(ledger.nextExpiry()).toBeNull(); expect(ledger.prune()).toBe(0);
  expect(db.all('SELECT * FROM runtime_metadata ORDER BY key')).toEqual(before);
});
it.each(['run', 'attempt', 'retry', 'operation', 'effect', 'lock'])('preserves resolved question with %s obligation', kind => {
  record(); ledger.resolve(identity, id(100), connection); settleForRetention();
  if (kind === 'run') db.exec("UPDATE runs SET status='recovery_required' WHERE id=?", id(20));
  if (kind === 'attempt') db.exec("UPDATE attempts SET status='running' WHERE run_id=?", id(20));
  if (kind === 'retry') db.exec('INSERT INTO retry_queue VALUES(?,?,?)', id(20), clock, 'test');
  if (kind === 'operation') db.exec("INSERT INTO operations VALUES(?,?,1,'tool','unknown',?,?,?)", id(90), id(20), clock, clock, clock);
  if (kind === 'effect') db.exec("UPDATE effects SET status='outcome_unknown'");
  if (kind === 'lock') db.exec('INSERT INTO resource_locks VALUES(?,?,1,?)', 'resource', id(20), clock);
  const before = otherTables(); clock = '2027-09-15T00:00:00.000Z';
  expect(ledger.nextExpiry()).toBeNull(); expect(ledger.prune()).toBe(0); expect(ledger.get(id(100)).state).toBe('resolved');
  expect(otherTables()).toEqual(before);
});
it('bounds cleanup to 100 rows and rolls back a batch containing corrupt custody', () => {
  record(); ledger.resolve(identity, id(100), connection); const base = ledger.get(id(100));
  for (let n = 101; n < 201; n++) db.exec('INSERT INTO runtime_metadata VALUES(?,?)', `native-question:${id(n)}`, JSON.stringify({ ...base, id: id(n), request_id: n }));
  settleForRetention(); clock = '2027-01-01T00:00:00.000Z';
  db.exec('UPDATE runtime_metadata SET value_json=? WHERE key=?', JSON.stringify({ ...base, id: id(199), revision: 99 }), `native-question:${id(199)}`);
  rejects(() => ledger.prune(), 'NATIVE_QUESTION_CORRUPT');
  expect(db.all('SELECT key FROM runtime_metadata')).toHaveLength(101);
  db.exec('UPDATE runtime_metadata SET value_json=? WHERE key=?', JSON.stringify({ ...base, id: id(199) }), `native-question:${id(199)}`);
  expect(ledger.prune()).toBe(100); expect(ledger.nextExpiry()).not.toBeNull();
  expect(ledger.prune()).toBe(1); expect(ledger.nextExpiry()).toBeNull();
});
