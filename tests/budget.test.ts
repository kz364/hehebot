import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Store, type Database, type SqlValue } from '../src/core/store';
import { BudgetLedger, BUDGET_POLICY_ID, BUDGET_REPORT_KEY, BUDGET_OVERRIDE_PREFIX, MAX_BUDGET_CENTS, type BudgetPolicy, type BudgetReport } from '../src/core/budget';
import type { Run } from '../src/core/types';

const schema = readFileSync(process.env.HEHEBOT_BUDGET_TEST_SCHEMA ?? new URL('../DB/schema.sql', import.meta.url), 'utf8');
class BudgetDatabase implements Database {
  sqlite = new DatabaseSync(':memory:');
  depth = 0;
  constructor() { this.sqlite.exec(schema); }
  all<T>(sql: string, ...values: SqlValue[]): T[] { return this.sqlite.prepare(sql).all(...values) as T[]; }
  exec(sql: string, ...values: SqlValue[]): void { this.sqlite.prepare(sql).run(...values); }
  transaction<T>(fn: () => T): T {
    const key = `budget_${this.depth++}`; this.sqlite.exec(`SAVEPOINT ${key}`);
    try { const value = fn(); this.sqlite.exec(`RELEASE ${key}`); return value; }
    catch (error) { this.sqlite.exec(`ROLLBACK TO ${key}; RELEASE ${key}`); throw error; }
    finally { this.depth--; }
  }
}
let db: BudgetDatabase, store: Store, ledger: BudgetLedger, now: string;
const persona = '11111111-1111-4111-8111-111111111111';
const optional = '77777777-7777-4777-8777-777777777777';
const required = '33333333-3333-4333-8333-333333333333';
const rejects = (fn: () => unknown, code: string) => expect(fn).toThrowError(expect.objectContaining({ code }));
const changes = () => db.all<{ n: number }>('SELECT total_changes() AS n')[0].n;
function command(type = 'budget.set', payload: unknown = {}, owner = 'owner') {
  const id = randomUUID();
  db.exec("INSERT INTO commands(id,owner_id,idempotency_key,body_hash,type,payload_json,status,accepted_at) VALUES(?,?,?,?,?,?,'accepted',?)", id, owner, randomUUID(), 'synthetic-digest', type, JSON.stringify(payload), now);
  return id;
}
function policy(patch: Partial<BudgetPolicy> = {}): BudgetPolicy {
  return { expected_revision: ledger.summary().revision, enabled: true, monthly_cap_cents: 500, optional_routine_ids: [optional], ...patch };
}
function set(patch: Partial<BudgetPolicy> = {}) { return ledger.set('owner', command(), policy(patch)); }
function report(projected_cents: number, patch: Partial<BudgetReport> = {}): BudgetReport {
  return { period: ledger.summary().period, projected_cents, observed_at: now, source_ref: 'synthetic:infra-73', ...patch };
}
function advance(ms = 1000) { now = new Date(Date.parse(now) + ms).toISOString(); }
function scheduled(routine = optional): Run {
  const occurrence = randomUUID(), id = randomUUID();
  db.exec("INSERT INTO occurrences(id,routine_id,routine_version,nominal_due_at,status,created_at) VALUES(?,?,1,?,'queued',?)", occurrence, routine, id, now);
  db.exec("INSERT INTO runs(id,occurrence_id,persona_id,routine_id,context_json,status,created_at,updated_at) VALUES(?,?,?,?,'{}','queued',?,?)", id, occurrence, persona, routine, now, now);
  return store.run(id);
}
function waiting(run: Run) { db.exec("UPDATE runs SET status='waiting',error_code='BUDGET_BLOCKED' WHERE id=?", run.id); return store.run(run.id); }
const protectedRows = () => ['commands', 'runs', 'attempts', 'effects', 'operations', 'resource_locks', 'lifecycle', 'occurrences'].map(table => db.all(`SELECT * FROM ${table} ORDER BY rowid`));

beforeEach(() => {
  db = new BudgetDatabase(); store = new Store(db); now = '2026-09-10T00:00:00.000Z'; ledger = new BudgetLedger(store, () => now, randomUUID);
  expect(db.all('SELECT version FROM schema_versions')).toEqual([{ version: 17 }]);
  store.put(persona, 'persona', { name: 'Synthetic persona', instructions: 'Read fixture data.', tool_policy_ids: [], archived: false }, 0, 'owner', now);
  for (const id of [optional, required]) store.put(id, 'routine', { persona_id: persona, name: 'Synthetic routine', instructions: 'Read fixture data.', enabled: true,
    schedule: { cron: '0 * * * *', timezone: 'Asia/Jakarta' }, trigger_source_id: null, action_policy_ids: [],
    policy: { misfire: 'coalesce', overlap: 'queue_one', max_replay: 1, max_lateness_seconds: 86400 } }, 0, 'owner', now);
});
afterEach(() => db.sqlite.close());

it('defaults disabled with a 500-cent suggestion, no implicit optional routines and no reads causing writes', () => {
  const run = scheduled(), before = changes();
  expect(ledger.summary()).toEqual({ policy: { enabled: false, monthly_cap_cents: 500, optional_routine_ids: [] }, revision: 0, period: '2026-09',
    report: null, freshness: 'missing', threshold: 0, status: 'disabled' });
  expect(ledger.blockedRoutineIds()).toEqual([]); expect(ledger.blocks(run)).toBe(false);
  expect(changes()).toBe(before); expect(db.all('SELECT * FROM runtime_metadata')).toEqual([]);
  set({ optional_routine_ids: [] }); expect(ledger.summary().status).toBe('BUDGET_UNKNOWN'); expect(ledger.blocks(run)).toBe(false);
});

it('uses integer threshold boundaries including a non-round cap and blocks exactly at cap', () => {
  set({ monthly_cap_cents: 501 }); const run = scheduled();
  for (const [amount, level] of [[350, 0], [351, 70], [450, 70], [451, 90], [500, 90], [501, 100], [700, 100]]) {
    advance(); ledger.report(report(amount));
    expect(ledger.summary().threshold).toBe(level);
    expect(ledger.blocks(run)).toBe(amount >= 501);
  }
  const events = store.events(0, 1000, now).filter(e => e.type === 'budget.threshold_crossed');
  expect(events.map(e => e.payload.threshold)).toEqual([70, 90, 100]);
  expect(events.map(e => e.payload)).toEqual([70, 90, 100].map(threshold => ({ period: '2026-09', threshold, policy_revision: 1 })));
  expect(JSON.stringify(events)).not.toContain('synthetic:infra-73');
  expect(ledger.blockedRoutineIds()).toEqual([optional]);
});

it('expires exactly at24h, rejects stale ingestion and resets freshness at Jakarta month rollover', () => {
  set(); ledger.report(report(123)); const initial = now;
  advance(86_399_999); expect(ledger.summary()).toMatchObject({ freshness: 'fresh', status: 'ok' });
  advance(1); expect(ledger.summary()).toMatchObject({ freshness: 'stale', status: 'BUDGET_UNKNOWN' });
  rejects(() => ledger.report(report(123, { observed_at: initial })), 'INVALID_INPUT');
  now = '2026-09-30T16:59:59.999Z'; ledger.report(report(500));
  expect(ledger.summary().period).toBe('2026-09');
  advance(1); expect(ledger.summary()).toMatchObject({ period: '2026-10', freshness: 'stale', status: 'BUDGET_UNKNOWN' });
  rejects(() => ledger.report(report(3, { period: '2026-09' })), 'INVALID_INPUT');
  rejects(() => ledger.report(report(3, { observed_at: '2026-09-30T16:59:59.999Z' })), 'INVALID_INPUT');
  ledger.report(report(500)); expect(ledger.summary()).toMatchObject({ freshness: 'fresh', status: 'BUDGET_BLOCKED' });
  expect(store.events(0, 1000, now).filter(e => e.type === 'budget.threshold_crossed' && e.payload.period === '2026-10').map(e => e.payload.threshold)).toEqual([70, 90, 100]);
});

it('rejects future, noncanonical, wrong-period and unbounded reports without touching stored data', () => {
  set(); ledger.report(report(37));
  const bad: Partial<BudgetReport>[] = [
    { projected_cents: -1 }, { projected_cents: 0.5 }, { projected_cents: NaN }, { projected_cents: Infinity }, { projected_cents: MAX_BUDGET_CENTS + 1 },
    { observed_at: '2026-09-10T00:00:00.001Z' }, { observed_at: '2026-09-10T00:00:00Z' }, { observed_at: '2026-09-10T07:00:00.000+07:00' },
    { observed_at: '2026-02-30T00:00:00.000Z' }, { period: '2026-9' }, { period: '2026-13' }, { period: '2026-08' },
    { source_ref: '' }, { source_ref: 'https://account.invalid/token' }, { source_ref: 'private text' }, { source_ref: 'x'.repeat(129) }
  ];
  const before = changes();
  for (const patch of bad) rejects(() => ledger.report(report(37, patch)), 'INVALID_INPUT');
  rejects(() => ledger.report({ ...report(37), authority: true } as BudgetReport), 'INVALID_INPUT');
  expect(changes()).toBe(before); advance(); ledger.report(report(MAX_BUDGET_CENTS)); expect(ledger.summary().status).toBe('BUDGET_BLOCKED');
});

it('keeps one report, exact replay has no writes and conflicts/older replacements never overwrite it', () => {
  set(); const initial = report(350); ledger.report(initial); const before = changes();
  ledger.report({ source_ref: initial.source_ref, observed_at: initial.observed_at, projected_cents: initial.projected_cents, period: initial.period });
  expect(changes()).toBe(before);
  rejects(() => ledger.report({ ...initial, projected_cents: 351 }), 'REVISION_CONFLICT');
  rejects(() => ledger.report({ ...initial, source_ref: 'synthetic:other' }), 'REVISION_CONFLICT');
  advance(); ledger.report(report(499)); rejects(() => ledger.report(initial), 'REVISION_CONFLICT');
  expect(ledger.summary().report?.projected_cents).toBe(499);
  expect(db.all('SELECT key FROM runtime_metadata')).toEqual([{ key: BUDGET_REPORT_KEY }]);
  for (const amount of [200, 350, 350, 450, 500, 700]) { advance(); ledger.report(report(amount)); }
  expect(store.events(0, 1000, now).filter(e => e.type === 'budget.threshold_crossed').map(e => e.payload.threshold)).toEqual([70, 90, 70, 90, 100]);
});

it('uses Store.put revisions and original command provenance, rejects stale edits and invalid selections', () => {
  const cmd = command(); expect(ledger.set('owner', cmd, policy({ optional_routine_ids: [optional, required] }))).toBe(BUDGET_POLICY_ID);
  expect(ledger.summary()).toMatchObject({ revision: 1, policy: { optional_routine_ids: [required, optional] } });
  expect(db.all('SELECT actor_id,source_event_id,revision FROM object_revisions WHERE object_id=?', BUDGET_POLICY_ID)).toEqual([{ actor_id: 'owner', source_event_id: cmd, revision: 1 }]);
  rejects(() => set({ expected_revision: 0 }), 'REVISION_CONFLICT');
  const cmd2 = command(), before = changes();
  for (const patch of [{ monthly_cap_cents: 0 }, { monthly_cap_cents: 1.5 }, { monthly_cap_cents: MAX_BUDGET_CENTS + 1 },
    { expected_revision: -1 }, { optional_routine_ids: [optional, optional] }, { optional_routine_ids: ['invalid'] }, { optional_routine_ids: Array.from({ length: 21 }, () => randomUUID()) }]) {
    rejects(() => ledger.set('owner', cmd2, policy(patch)), 'INVALID_INPUT');
  }
  rejects(() => ledger.set('owner', cmd2, policy({ optional_routine_ids: [persona] })), 'NOT_FOUND');
  rejects(() => ledger.set('owner', cmd2, policy({ optional_routine_ids: [randomUUID()] })), 'NOT_FOUND');
  expect(changes()).toBe(before);
  db.exec('UPDATE objects SET deleted_at=? WHERE id=?', now, required);
  rejects(() => ledger.set('owner', cmd2, policy({ optional_routine_ids: [required] })), 'NOT_FOUND');
  set({ enabled: false }); expect(ledger.summary().revision).toBe(2); expect(ledger.blockedRoutineIds()).toEqual([]);
});

it('blocks only selected unstarted scheduled coordinators, not manual work, retries, children or admitted states', () => {
  set(); const run = scheduled();
  expect(ledger.blocks(run)).toBe(true); expect(ledger.blocks(scheduled(required))).toBe(false);
  for (const patch of [{ occurrence_id: null }, { routine_id: null }, { role: 'background' as const }, { parent_run_id: randomUUID() }, { current_attempt: 1 },
    { status: 'claimed' as const }, { status: 'running' as const }, { status: 'finishing' as const }, { status: 'completed' as const },
    { status: 'recovery_required' as const }, { status: 'cancelling' as const }, { status: 'cancelled' as const }, { status: 'failed' as const }, { occurrence_id: randomUUID() }]) {
    expect(ledger.blocks({ ...run, ...patch })).toBe(false);
  }
  const other = scheduled(required); expect(ledger.blocks({ ...run, occurrence_id: other.occurrence_id })).toBe(false);
  expect(ledger.blocks(waiting(run))).toBe(true);
});

it('creates exact-run revision-bound overrides without renewing input age, mutating receipts, requeueing or waking', () => {
  set(); const target = waiting(scheduled()), sibling = waiting(scheduled());
  const cmd = command('budget.override', { run_id: target.id }); const before = protectedRows();
  expect(ledger.override('owner', cmd, target.id)).toBe(target.id);
  expect(protectedRows()).toEqual(before); expect(ledger.blocks(store.run(target.id))).toBe(false); expect(ledger.blocks(sibling)).toBe(true);
  const entry = JSON.parse(db.all<{ value_json: string }>('SELECT value_json FROM runtime_metadata WHERE key=?', BUDGET_OVERRIDE_PREFIX + target.id)[0].value_json);
  expect(entry).toEqual({ run_id: target.id, occurrence_id: target.occurrence_id, routine_id: optional, command_id: cmd, owner_id: 'owner', policy_revision: 1, created_at: now });
  const count = changes(); ledger.override('owner', cmd, target.id); expect(changes()).toBe(count);
  rejects(() => ledger.override('owner', cmd, sibling.id), 'FORBIDDEN');
  const another = command('budget.override', { run_id: target.id }); rejects(() => ledger.override('owner', another, target.id), 'REVISION_CONFLICT');
  set(); expect(ledger.blocks(store.run(target.id))).toBe(true);
  rejects(() => ledger.override('owner', cmd, target.id), 'REVISION_CONFLICT');
  ledger.override('owner', another, target.id); expect(ledger.blocks(store.run(target.id))).toBe(false);
  expect(store.run(target.id).created_at).toBe(target.created_at); expect(store.run(target.id).command_id).toBe(target.command_id);
});

it('keeps budget override admission and replay independent of historical snapshot hydration', () => {
  set(); const target = waiting(scheduled()), cmd = command('budget.override', { run_id: target.id });
  db.exec('UPDATE runs SET context_json=?,checkpoint_json=? WHERE id=?', JSON.stringify({ padding: '界'.repeat(400000) }), 'x'.repeat(1100000), target.id);
  const before = protectedRows(), read = vi.spyOn(db, 'all');
  try {
    expect(ledger.override('owner', cmd, target.id)).toBe(target.id);
    expect(ledger.override('owner', cmd, target.id)).toBe(target.id);
    const rows = read.mock.calls.flatMap(([sql], i) => sql.includes('FROM runs WHERE id=?') ? read.mock.results[i].value : []);
    expect(rows).toHaveLength(2);
    for (const row of rows) { expect(row).not.toHaveProperty('context_json'); expect(row).not.toHaveProperty('checkpoint_json'); }
  } finally { read.mockRestore(); }
  expect(protectedRows()).toEqual(before);
  expect(ledger.blocks(store.run(target.id))).toBe(false);
});

it('preserves command authority before missing-run errors for budget overrides', () => {
  set(); const id = randomUUID(), cmd = command('budget.override', { run_id: id }), before = protectedRows();
  expect(() => ledger.override('other-owner', cmd, id)).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
  expect(() => ledger.override('owner', cmd, id)).toThrowError(expect.objectContaining({ code: 'NOT_FOUND', message: 'Run unavailable.', status: 404 }));
  expect(protectedRows()).toEqual(before);
});

it('requires matching accepted owner receipts and rejects other waits, unselected runs and started override targets', () => {
  set(); const target = waiting(scheduled()), cmd = command('budget.override', { run_id: target.id });
  rejects(() => ledger.override('other-owner', cmd, target.id), 'FORBIDDEN');
  rejects(() => ledger.override('owner', randomUUID(), target.id), 'FORBIDDEN');
  rejects(() => ledger.set('owner', cmd, policy()), 'FORBIDDEN');
  db.exec("UPDATE commands SET status='rejected' WHERE id=?", cmd); rejects(() => ledger.override('owner', cmd, target.id), 'FORBIDDEN');
  db.exec("UPDATE commands SET status='accepted' WHERE id=?", cmd);
  for (const update of ["status='queued'", "status='waiting',error_code='AUTH_REQUIRED'", "error_code='BUDGET_UNKNOWN',current_attempt=1", "current_attempt=0,status='running'"]) {
    db.exec(`UPDATE runs SET ${update} WHERE id=?`, target.id); rejects(() => ledger.override('owner', cmd, target.id), 'REVISION_CONFLICT');
  }
  const other = waiting(scheduled(required)); rejects(() => ledger.override('owner', command('budget.override', { run_id: other.id }), other.id), 'REVISION_CONFLICT');
  expect(db.all("SELECT key FROM runtime_metadata WHERE key LIKE 'budget-override:%'")).toEqual([]);
});

it('fails closed for corrupt report/policy and refuses transplanted override metadata', () => {
  set(); const target = waiting(scheduled()), sibling = waiting(scheduled());
  ledger.override('owner', command('budget.override', { run_id: target.id }), target.id);
  db.exec('INSERT INTO runtime_metadata(key,value_json) SELECT ?,value_json FROM runtime_metadata WHERE key=?', BUDGET_OVERRIDE_PREFIX + sibling.id, BUDGET_OVERRIDE_PREFIX + target.id);
  expect(ledger.blocks(sibling)).toBe(true);
  db.exec('INSERT INTO runtime_metadata(key,value_json) VALUES(?,?)', BUDGET_REPORT_KEY, '{"wrong":true}');
  expect(ledger.summary()).toMatchObject({ freshness: 'invalid', status: 'BUDGET_UNKNOWN', report: null });
  rejects(() => ledger.report({ period: '2026-09', observed_at: now, projected_cents: 1, source_ref: 'test' }), 'BUDGET_UNKNOWN');
  db.exec("UPDATE objects SET body_json='{}' WHERE id=?", BUDGET_POLICY_ID);
  rejects(() => ledger.summary(), 'BUDGET_UNKNOWN'); rejects(() => ledger.blocks(sibling), 'BUDGET_UNKNOWN');
});

it('checks every override binding and fails closed when receipt provenance expires or changes', () => {
  set(); const target = waiting(scheduled()), sibling = waiting(scheduled()), cmd = command('budget.override', { run_id: target.id });
  ledger.override('owner', cmd, target.id);
  const key = BUDGET_OVERRIDE_PREFIX + target.id;
  const entry = JSON.parse(db.all<{ value_json: string }>('SELECT value_json FROM runtime_metadata WHERE key=?', key)[0].value_json);
  for (const patch of [{ occurrence_id: sibling.occurrence_id }, { routine_id: required }, { policy_revision: 0 }, { owner_id: 'different' },
    { created_at: 'yesterday' }, { created_at: '2026-02-30T00:00:00.000Z' }, { created_at: '2026-09-10T24:00:00.000Z' },
    { command_id: command('budget.override', { run_id: sibling.id }) }, { command_id: { invalid: true } }]) {
    db.exec('UPDATE runtime_metadata SET value_json=? WHERE key=?', JSON.stringify({ ...entry, ...patch }), key);
    expect(ledger.blocks(target)).toBe(true);
  }
  db.exec('UPDATE runtime_metadata SET value_json=? WHERE key=?', JSON.stringify(entry), key);
  expect(ledger.blocks(target)).toBe(false);
  db.exec("UPDATE commands SET status='rejected' WHERE id=?", cmd); expect(ledger.blocks(target)).toBe(true);
  db.exec("UPDATE commands SET status='applied',payload_json='{}' WHERE id=?", cmd); expect(ledger.blocks(target)).toBe(true);
});

it('accepts exactly20 explicitly selected existing routines and emits no thresholds while disabled', () => {
  const ids = [optional, required];
  while (ids.length < 20) {
    const id = randomUUID(); store.put(id, 'routine', store.get(optional, 'routine').body, 0, 'owner', now); ids.push(id);
  }
  set({ optional_routine_ids: ids, enabled: false });
  ledger.report(report(MAX_BUDGET_CENTS)); expect(ledger.summary().status).toBe('disabled');
  expect(ledger.summary().policy.optional_routine_ids).toEqual(ids.sort());
  expect(store.events(0, 1000, now).filter(e => e.type === 'budget.threshold_crossed')).toEqual([]);
  expect(ledger.blockedRoutineIds()).toEqual([]);
});

it('filters a blocked backlog before LIMIT using the same predicate as blocks, with indexed exception lookup', () => {
  set(); const backlog = Array.from({ length: 137 }, () => scheduled()); advance(); const ready = scheduled(required);
  const select = () => {
    const predicate = ledger.admissionPredicate();
    return db.all<{ id: string }>(`SELECT r.id FROM runs r WHERE r.status='queued' AND (${predicate.sql}) ORDER BY r.created_at,r.id LIMIT 1`, ...predicate.bindings);
  };
  expect(select()).toEqual([{ id: ready.id }]);
  const target = waiting(backlog[71]), cmd = command('budget.override', { run_id: target.id }); ledger.override('owner', cmd, target.id);
  db.exec("UPDATE runs SET status='queued' WHERE id=?", target.id); // Parent owns actual wait reconciliation.
  expect(select()).toEqual([{ id: target.id }]);
  const predicate = ledger.admissionPredicate();
  const plan = db.all<{ detail: string }>(`EXPLAIN QUERY PLAN SELECT r.id FROM runs r WHERE (${predicate.sql}) LIMIT 1`, ...predicate.bindings).map(row => row.detail).join('\n');
  expect(plan).toMatch(/SEARCH bm USING INDEX .*\(key=\?\)/);
  expect(plan).toMatch(/SEARCH bc USING INDEX .*\(id=\?\)/);
  for (const run of [store.run(target.id), ready, backlog[13]]) {
    const allowed = db.all(`SELECT r.id FROM runs r WHERE r.id=? AND (${predicate.sql})`, run.id, ...predicate.bindings).length > 0;
    expect(allowed).toBe(!ledger.blocks(run));
  }
  set(); expect(select()).toEqual([{ id: ready.id }]);
  set({ enabled: false }); expect(ledger.admissionPredicate()).toEqual({ sql: '1', bindings: [] });
});

it('never changes admitted attempts, unknown effects, locks or lifecycle when projections cross cap or expire', () => {
  set(); const active = scheduled();
  db.exec("UPDATE runs SET current_attempt=3,status='running' WHERE id=?", active.id);
  db.exec("INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,status,deadline_at) VALUES(?,3,'submit-83',17,'boot-51','running','deadline')", active.id);
  db.exec("INSERT INTO effects VALUES('effect-73',?,'action-19','mutation','outcome_unknown','policy-11','digest-37',NULL,NULL,'t1')", active.id);
  db.exec("INSERT INTO operations VALUES('operation-91',?,3,'tool','unknown','t1','t9','t3')", active.id);
  db.exec("INSERT INTO resource_locks VALUES('calendar:31',?,3,'t1')", active.id);
  db.exec("INSERT INTO lifecycle(singleton,provider_ref_json,phase,desired_state,epoch,boot_id) VALUES(1,'{}','READY','RUN',17,'boot-51')");
  const before = protectedRows();
  ledger.report(report(500)); expect(ledger.blocks(store.run(active.id))).toBe(false);
  advance(86_400_000); expect(ledger.summary().status).toBe('BUDGET_UNKNOWN'); expect(ledger.blocks(store.run(active.id))).toBe(false);
  expect(protectedRows()).toEqual(before); expect(db.all('PRAGMA foreign_key_check')).toEqual([]);
});

it('rolls back policy/revision, report and override writes if audit event insertion fails', () => {
  const collision = randomUUID(); store.event(collision, null, 'synthetic', 'system', null, {}, now);
  const broken = new BudgetLedger(store, () => now, () => collision), cmd = command();
  expect(() => broken.set('owner', cmd, policy())).toThrow(); expect(ledger.summary().revision).toBe(0);
  expect(db.all('SELECT * FROM object_revisions WHERE object_id=?', BUDGET_POLICY_ID)).toEqual([]);
  set(); expect(() => broken.report(report(500))).toThrow(); expect(db.all('SELECT * FROM runtime_metadata')).toEqual([]);
  const target = waiting(scheduled()), override = command('budget.override', { run_id: target.id });
  expect(() => broken.override('owner', override, target.id)).toThrow(); expect(db.all('SELECT * FROM runtime_metadata')).toEqual([]);
});
