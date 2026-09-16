import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { Store, type Database, type SqlValue } from '../src/core/store';
import { RosterLedger, ROSTER_LAYOUT_KEY, type RosterLayout } from '../src/core/roster';

const schema = readFileSync(process.env.HEHEBOT_ROSTER_TEST_SCHEMA ?? new URL('../DB/schema.sql', import.meta.url), 'utf8');
class RosterDatabase implements Database {
  sqlite = new DatabaseSync(':memory:');
  depth = 0;
  writes: string[] = [];
  constructor() { this.sqlite.exec(schema); }
  all<T>(sql: string, ...values: SqlValue[]): T[] { return this.sqlite.prepare(sql).all(...values) as T[]; }
  exec(sql: string, ...values: SqlValue[]): void { this.writes.push(sql); this.sqlite.prepare(sql).run(...values); }
  transaction<T>(fn: () => T): T {
    const key = `roster_${this.depth++}`; this.sqlite.exec(`SAVEPOINT ${key}`);
    try { const result = fn(); this.sqlite.exec(`RELEASE ${key}`); return result; }
    catch (error) { this.sqlite.exec(`ROLLBACK TO ${key}; RELEASE ${key}`); throw error; }
    finally { this.depth--; }
  }
}
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = '2026-09-14T14:15:16.017Z';
let db: RosterDatabase, store: Store, ledger: RosterLedger;
const rejects = (fn: () => unknown, code: string) => expect(fn).toThrowError(expect.objectContaining({ code }));
function command(owner = 'owner', type = 'roster.set', status = 'accepted') {
  const key = randomUUID();
  db.exec('INSERT INTO commands(id,owner_id,idempotency_key,body_hash,type,payload_json,status,accepted_at) VALUES(?,?,?,?,?,?,?,?)',
    key, owner, randomUUID(), 'synthetic-only', type, '{}', status, now);
  return key;
}
function layout(patch: Partial<RosterLayout> = {}): RosterLayout {
  return { expected_revision: ledger.summary().revision, sections: [
    { id: id(901), name: 'Travel', persona_ids: [id(3), id(1)], collapsed: true },
    { id: id(902), name: 'Home', persona_ids: [id(2)], collapsed: false },
  ], hidden_persona_ids: [id(3)], ...patch };
}
const set = (input = layout()) => ledger.set('owner', command(), input);
const total = () => db.all<{ n: number }>('SELECT total_changes() AS n')[0].n;
const protectedRows = () => db.all<{ name: string }>("SELECT name FROM sqlite_schema WHERE type='table' AND name!='runtime_metadata' ORDER BY name")
  .map(({ name }) => [name, db.all(`SELECT * FROM "${name}" ORDER BY rowid`)]);
beforeEach(() => {
  db = new RosterDatabase(); store = new Store(db); ledger = new RosterLedger(store, () => now);
  expect(db.all('SELECT version FROM schema_versions')).toEqual([{ version: 10 }]);
  for (let n = 1; n <= 4; n++) store.put(id(n), 'persona', { name: `Persona ${n}`, archived: n === 4 }, 0, 'owner', now);
  store.put(id(100), 'routine', { persona_id: id(3), enabled: true }, 0, 'owner', now);
  db.exec("INSERT INTO runs(id,persona_id,routine_id,context_json,status,current_attempt,created_at,updated_at) VALUES(?,?,?,'{}','running',1,?,?)", id(200), id(3), id(100), now, now);
  db.exec("INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,status,deadline_at) VALUES(?,1,'synthetic',1,'boot','running',?)", id(200), now);
  db.exec("INSERT INTO resource_locks VALUES('synthetic-resource',?,1,?)", id(200), now);
  db.exec("INSERT INTO effects(id,run_id,action_key,classification,status,authorization_ref,request_digest,updated_at) VALUES(?,?,'synthetic','mutation','outcome_unknown','grant','digest',?)", id(201), id(200), now);
});
afterEach(() => db.sqlite.close());

it('defaults to plain unassigned visible roster without any writes', () => {
  const before = total(); db.writes = [];
  expect(ledger.summary()).toEqual({ revision: 0, sections: [], hidden_persona_ids: [] });
  expect(total()).toBe(before); expect(db.writes).toEqual([]); expect(store.list('persona')).toHaveLength(4);
});

it('preserves exact ordering/collapse/hide and reloads without disabling work or changing any other table', () => {
  const input = layout(), cmd = command(), before = protectedRows(), changes = total(); db.writes = [];
  expect(ledger.set('owner', cmd, input)).toBe(ROSTER_LAYOUT_KEY);
  expect(protectedRows()).toEqual(before); expect(total() - changes).toBe(1);
  expect(db.writes).toHaveLength(1); expect(db.writes[0]).toContain('INSERT INTO runtime_metadata');
  expect(new RosterLedger(new Store(db), () => now).summary()).toEqual({ revision: 1, sections: input.sections, hidden_persona_ids: [id(3)] });
  expect(store.get(id(100)).body.enabled).toBe(true); expect(store.run(id(200)).status).toBe('running');
  expect(db.all<{ status: string }>('SELECT status FROM effects')[0].status).toBe('outcome_unknown');
  const stored = JSON.parse(db.all<{ value_json: string }>('SELECT value_json FROM runtime_metadata WHERE key=?', ROSTER_LAYOUT_KEY)[0].value_json);
  expect(stored).toEqual({ version: 1, revision: 1, sections: input.sections, hidden_persona_ids: [id(3)], owner_id: 'owner', command_id: cmd, updated_at: now });
  input.sections[0].name = 'Changed outside ledger'; const read = ledger.summary(); read.sections[0].persona_ids.reverse();
  expect(ledger.summary().sections[0]).toMatchObject({ name: 'Travel', persona_ids: [id(3), id(1)] });
});

it('removes a section by unassigning members, preserves explicit hiding, and supports rename/reorder', () => {
  set(); set(layout({ sections: [{ id: id(902), name: 'Renamed', persona_ids: [id(2)], collapsed: true }] }));
  const summary = ledger.summary(), assigned = new Set(summary.sections.flatMap(section => section.persona_ids));
  expect([id(1), id(3), id(4)].every(persona => !assigned.has(persona))).toBe(true);
  expect(summary.hidden_persona_ids).toEqual([id(3)]); expect(store.list('persona')).toHaveLength(4);
  const input = layout(); input.sections.reverse(); input.sections[1].persona_ids.reverse(); set(input);
  expect(ledger.summary().sections.map(s => s.id)).toEqual([id(902), id(901)]);
  expect(ledger.summary().sections[1].persona_ids).toEqual([id(1), id(3)]);
  set(layout({ sections: [], hidden_persona_ids: [] })); expect(ledger.summary()).toEqual({ revision: 4, sections: [], hidden_persona_ids: [] });
});

it('rejects stale revisions and invalid references with no partial metadata writes', () => {
  set();
  for (const [input, code] of [[layout({ expected_revision: 0 }), 'REVISION_CONFLICT'],
    [layout({ hidden_persona_ids: [id(100)] }), 'NOT_FOUND'], [layout({ hidden_persona_ids: [id(999)] }), 'NOT_FOUND']] as const) {
    const cmd = command(), before = total(), summary = ledger.summary();
    rejects(() => ledger.set('owner', cmd, input), code); expect(total()).toBe(before); expect(ledger.summary()).toEqual(summary);
  }
});

it.each(['member-duplicate', 'cross-section', 'section-duplicate', 'hidden-duplicate', 'uuid', 'extra', 'collapsed', 'blank', 'trim', 'control', 'surrogate', 'name-long', 'sections', 'hidden-count', 'negative', 'fraction', 'unsafe-integer'])('rejects %s without writes', kind => {
  const input = layout();
  if (kind === 'member-duplicate') input.sections[0].persona_ids.push(id(3));
  if (kind === 'cross-section') input.sections[1].persona_ids.push(id(1));
  if (kind === 'section-duplicate') input.sections[1].id = id(901);
  if (kind === 'hidden-duplicate') input.hidden_persona_ids.push(id(3));
  if (kind === 'uuid') input.sections[0].id = 'invalid';
  if (kind === 'extra') Object.assign(input.sections[0], { authority: true });
  if (kind === 'collapsed') Object.assign(input.sections[0], { collapsed: 1 });
  if (kind === 'blank') input.sections[0].name = '';
  if (kind === 'trim') input.sections[0].name = ' Travel';
  if (kind === 'control') input.sections[0].name = 'A\nB';
  if (kind === 'surrogate') input.sections[0].name = '\ud800';
  if (kind === 'name-long') input.sections[0].name = '🌏'.repeat(81);
  if (kind === 'sections') input.sections = Array.from({ length: 21 }, (_, n) => ({ id: id(n + 800), name: 'S', persona_ids: [], collapsed: false }));
  if (kind === 'hidden-count') input.hidden_persona_ids = Array.from({ length: 201 }, (_, n) => id(n + 1));
  if (kind === 'negative') input.expected_revision = -1;
  if (kind === 'fraction') input.expected_revision = 0.5;
  if (kind === 'unsafe-integer') input.expected_revision = Number.MAX_SAFE_INTEGER;
  const cmd = command(), before = total(); rejects(() => ledger.set('owner', cmd, input), 'INVALID_INPUT'); expect(total()).toBe(before);
});

it('accepts exact name/section/persona limits but rejects excess distinct union, not legal hide-membership overlap', () => {
  for (let n = 5; n <= 201; n++) store.put(id(n + 1000), 'persona', { name: 'Synthetic' }, 0, 'owner', now);
  const members = [1, 2, 3, 4].map(id).concat(Array.from({ length: 196 }, (_, n) => id(n + 1005)));
  const sections = Array.from({ length: 20 }, (_, n) => ({ id: id(n + 800), name: '🌏'.repeat(80), persona_ids: members.slice(n * 10, n * 10 + 10), collapsed: false }));
  set(layout({ sections, hidden_persona_ids: members.slice().reverse() })); expect(ledger.summary().hidden_persona_ids).toHaveLength(200);
  const input = layout({ sections, hidden_persona_ids: [id(1201)] }), cmd = command(), before = total();
  rejects(() => ledger.set('owner', cmd, input), 'INVALID_INPUT'); expect(total()).toBe(before);
});

it('allows archived persona display metadata but does not undelete, unarchive or silently scrub references', () => {
  set(layout({ hidden_persona_ids: [id(4)] })); expect(store.get(id(4)).body.archived).toBe(true);
  db.exec('UPDATE objects SET deleted_at=? WHERE id=?', now, id(4));
  const before = total(); expect(ledger.summary().hidden_persona_ids).toEqual([id(4)]); expect(total()).toBe(before);
  rejects(() => set(layout({ hidden_persona_ids: [id(4)] })), 'NOT_FOUND');
  set(layout({ hidden_persona_ids: [] })); expect(ledger.summary().hidden_persona_ids).toEqual([]);
});

it('requires owner command provenance and leaves deduplication to the command receipt boundary', () => {
  for (const cmd of [randomUUID(), command('other'), command('owner', 'persona.update'), command('owner', 'roster.set', 'rejected')]) {
    const before = total(); rejects(() => ledger.set('owner', cmd, layout()), 'FORBIDDEN'); expect(total()).toBe(before);
  }
  const cmd = command(), input = layout(); ledger.set('owner', cmd, input);
  const before = total(); rejects(() => ledger.set('owner', cmd, input), 'REVISION_CONFLICT'); expect(total()).toBe(before);
});

it('rolls metadata back with an enclosing command transaction', () => {
  const cmd = command();
  expect(() => db.transaction(() => { ledger.set('owner', cmd, layout()); throw new Error('SYNTHETIC_ABORT'); })).toThrow('SYNTHETIC_ABORT');
  expect(ledger.summary()).toEqual({ revision: 0, sections: [], hidden_persona_ids: [] });
});

it('fails closed on corrupt metadata or invalid host clock, never resets organization', () => {
  set(); const cmd = command(), input = layout();
  rejects(() => new RosterLedger(store, () => 'not-a-time').set('owner', cmd, input), 'ROSTER_INVALID');
  db.exec('UPDATE runtime_metadata SET value_json=? WHERE key=?', '{"unexpected":"synthetic"}', ROSTER_LAYOUT_KEY);
  const before = total(); rejects(() => ledger.summary(), 'ROSTER_INVALID');
  rejects(() => ledger.set('owner', cmd, input), 'ROSTER_INVALID'); expect(total()).toBe(before);
});
