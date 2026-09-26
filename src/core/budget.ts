import { requireThat } from './errors';
import { Store, type SqlValue } from './store';
import type { Run } from './types';

export const BUDGET_POLICY_ID = 'bbbbbbbb-0000-4000-8000-000000000025';
export const BUDGET_REPORT_KEY = 'budget-report';
export const BUDGET_OVERRIDE_PREFIX = 'budget-override:';
export const MAX_BUDGET_CENTS = 1_000_000_000;
const day = 86_400_000;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export type BudgetPolicy = { expected_revision: number; enabled: boolean; monthly_cap_cents: number; optional_routine_ids: string[] };
export type BudgetReport = { period: string; projected_cents: number; observed_at: string; source_ref: string };
type PolicyBody = Omit<BudgetPolicy, 'expected_revision'>;
type Threshold = 0 | 70 | 90 | 100;
export type BudgetSummary = {
  policy: PolicyBody; revision: number; period: string; report: BudgetReport | null;
  freshness: 'missing' | 'fresh' | 'stale' | 'invalid';
  status: 'disabled' | 'ok' | 'BUDGET_UNKNOWN' | 'BUDGET_BLOCKED'; threshold: Threshold;
};
type Override = { run_id: string; occurrence_id: string; routine_id: string; command_id: string; owner_id: string; policy_revision: number; created_at: string };
export type BudgetAdmissionPredicate = { sql: string; bindings: SqlValue[] };

function timestamp(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value ? time : NaN;
}
// Jakarta has UTC+07:00 year-round. UTC slicing avoids host timezone/locale dependence.
const periodAt = (time: number) => new Date(time + 7 * 3_600_000).toISOString().slice(0, 7);
const cents = (value: unknown, minimum: number) => typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= MAX_BUDGET_CENTS;
const fields = (value: unknown, names: string[]): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value) &&
  JSON.stringify(Object.keys(value).sort()) === JSON.stringify(names.slice().sort()));
function validPolicy(value: unknown): value is PolicyBody {
  if (!fields(value, ['enabled', 'monthly_cap_cents', 'optional_routine_ids'])) return false;
  const ids = value.optional_routine_ids;
  return typeof value.enabled === 'boolean' && cents(value.monthly_cap_cents, 1) && Array.isArray(ids) && ids.length <= 20 &&
    ids.every(id => typeof id === 'string' && uuidPattern.test(id)) && new Set(ids).size === ids.length;
}
function validReport(value: unknown): value is BudgetReport {
  return fields(value, ['period', 'projected_cents', 'observed_at', 'source_ref']) && typeof value.period === 'string' &&
    /^\d{4}-(0[1-9]|1[0-2])$/.test(value.period) && cents(value.projected_cents, 0) && Number.isFinite(timestamp(value.observed_at)) &&
    typeof value.source_ref === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.source_ref);
}
function threshold(report: BudgetReport, cap: number): Threshold {
  for (const level of [100, 90, 70] as const) if (report.projected_cents * 100 >= cap * level) return level;
  return 0;
}

/** Trusted-host accounting only; this class neither admits nor stops work. */
export class BudgetLedger {
  constructor(private store: Store, private now: () => string, private uuid: () => string) {}

  private clock(): { now: string; time: number; period: string } {
    const now = this.now(), time = timestamp(now);
    requireThat(Number.isFinite(time), 'BUDGET_UNKNOWN', 'The budget clock is unavailable.');
    return { now, time, period: periodAt(time) };
  }

  private policy(): { policy: PolicyBody; revision: number } {
    const row = this.store.db.all<{ kind: string; revision: number; deleted_at: string | null; body_json: string }>('SELECT kind,revision,deleted_at,body_json FROM objects WHERE id=?', BUDGET_POLICY_ID)[0];
    if (!row) return { policy: { enabled: false, monthly_cap_cents: 500, optional_routine_ids: [] }, revision: 0 };
    let body: unknown; try { body = JSON.parse(row.body_json); } catch { /* fail closed below */ }
    requireThat(row.kind === 'policy' && row.deleted_at === null && Number.isSafeInteger(row.revision) && row.revision > 0 && validPolicy(body),
      'BUDGET_UNKNOWN', 'The budget policy requires review.');
    return { policy: body, revision: row.revision };
  }

  private metadata(key: string): unknown {
    const row = this.store.db.all<{ value_json: string }>('SELECT value_json FROM runtime_metadata WHERE key=?', key)[0];
    if (!row) return undefined;
    try { return JSON.parse(row.value_json); } catch { return null; }
  }

  private command(owner: string, commandId: string, type: string, runId?: string): void {
    const row = this.store.db.all<{ owner_id: string; status: string; type: string; run_id: string | null }>("SELECT owner_id,status,type,json_extract(payload_json,'$.run_id') AS run_id FROM commands WHERE id=?", commandId)[0];
    requireThat(row && row.owner_id === owner && row.type === type && ['accepted', 'applied'].includes(row.status) &&
      (runId === undefined || row.run_id === runId), 'FORBIDDEN', 'An accepted owner command for this operation is required.', 403);
  }

  set(owner: string, commandId: string, input: BudgetPolicy): string {
    return this.store.db.transaction(() => {
      this.command(owner, commandId, 'budget.set');
      requireThat(fields(input, ['expected_revision', 'enabled', 'monthly_cap_cents', 'optional_routine_ids']) &&
        Number.isSafeInteger(input.expected_revision) && input.expected_revision >= 0 && input.expected_revision < Number.MAX_SAFE_INTEGER,
      'INVALID_INPUT', 'The budget policy is invalid.', 422);
      const { expected_revision, ...body } = input;
      requireThat(validPolicy(body), 'INVALID_INPUT', 'The budget policy is invalid.', 422);
      this.policy();
      for (const id of body.optional_routine_ids) this.store.get(id, 'routine');
      const now = this.clock().now;
      const revision = this.store.put(BUDGET_POLICY_ID, 'policy', { ...body, optional_routine_ids: body.optional_routine_ids.slice().sort() }, expected_revision, owner, now, commandId);
      this.store.event(this.uuid(), null, 'budget.policy_updated', owner, commandId, { revision, enabled: body.enabled }, now);
      return BUDGET_POLICY_ID;
    });
  }

  report(input: BudgetReport): void {
    this.store.db.transaction(() => {
      requireThat(validReport(input), 'INVALID_INPUT', 'The infrastructure projection is invalid.', 422);
      const clock = this.clock(), observed = timestamp(input.observed_at);
      requireThat(input.period === clock.period && periodAt(observed) === input.period && observed <= clock.time && clock.time - observed < day,
        'INVALID_INPUT', 'The infrastructure projection must be current and fresh.', 422);
      const previous = this.metadata(BUDGET_REPORT_KEY);
      requireThat(previous === undefined || validReport(previous), 'BUDGET_UNKNOWN', 'The stored projection requires review.');
      if (previous) {
        const prior = timestamp(previous.observed_at);
        requireThat(observed >= prior, 'REVISION_CONFLICT', 'A newer infrastructure projection is already stored.');
        if (observed === prior) {
          requireThat(input.period === previous.period && input.projected_cents === previous.projected_cents && input.source_ref === previous.source_ref,
            'REVISION_CONFLICT', 'This observation timestamp has conflicting content.');
          return;
        }
      }
      const { policy, revision } = this.policy();
      const before = previous && previous.period === input.period ? threshold(previous, policy.monthly_cap_cents) : 0;
      const after = threshold(input, policy.monthly_cap_cents);
      this.store.db.exec('INSERT INTO runtime_metadata(key,value_json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json',
        BUDGET_REPORT_KEY, JSON.stringify({ period: input.period, projected_cents: input.projected_cents, observed_at: input.observed_at, source_ref: input.source_ref }));
      if (policy.enabled) for (const level of [70, 90, 100]) {
        if (before < level && after >= level) this.store.event(this.uuid(), null, 'budget.threshold_crossed', 'system', null,
          { period: input.period, threshold: level, policy_revision: revision }, clock.now);
      }
    });
  }

  summary(): BudgetSummary {
    const { policy, revision } = this.policy(), clock = this.clock(), raw = this.metadata(BUDGET_REPORT_KEY);
    const report = validReport(raw) ? raw : null;
    const freshness = raw === undefined ? 'missing' : !report || timestamp(report.observed_at) > clock.time || periodAt(timestamp(report.observed_at)) !== report.period ? 'invalid' :
      report.period !== clock.period || clock.time - timestamp(report.observed_at) >= day ? 'stale' : 'fresh';
    const level = freshness === 'fresh' && report ? threshold(report, policy.monthly_cap_cents) : 0;
    return { policy, revision, period: clock.period, report, freshness, threshold: level,
      status: !policy.enabled ? 'disabled' : freshness !== 'fresh' ? 'BUDGET_UNKNOWN' : level === 100 ? 'BUDGET_BLOCKED' : 'ok' };
  }

  blockedRoutineIds(): string[] {
    const summary = this.summary();
    return summary.status === 'BUDGET_BLOCKED' || summary.status === 'BUDGET_UNKNOWN' ? summary.policy.optional_routine_ids.slice() : [];
  }

  private eligibility(summary: BudgetSummary): BudgetAdmissionPredicate {
    const ids = summary.policy.optional_routine_ids;
    if (!ids.length) return { sql: '0', bindings: [] };
    return { sql: `COALESCE((r.role='coordinator' AND r.parent_run_id IS NULL AND r.current_attempt=0
      AND r.status IN ('queued','waiting') AND r.routine_id IN (${ids.map(() => '?').join(',')})
      AND r.occurrence_id IS NOT NULL AND EXISTS(SELECT 1 FROM occurrences bo WHERE bo.id=r.occurrence_id AND bo.routine_id=r.routine_id AND bo.origin='scheduled')),0)`, bindings: ids };
  }

  private exception(revision: number): BudgetAdmissionPredicate {
    return { sql: `EXISTS(SELECT 1 FROM runtime_metadata bm JOIN commands bc ON bc.id=json_extract(bm.value_json,'$.command_id')
      WHERE bm.key=? || r.id AND json_type(bm.value_json)='object' AND (SELECT count(*) FROM json_each(bm.value_json))=7
      AND json_extract(bm.value_json,'$.run_id')=r.id AND json_extract(bm.value_json,'$.occurrence_id')=r.occurrence_id
      AND json_extract(bm.value_json,'$.routine_id')=r.routine_id AND json_type(bm.value_json,'$.policy_revision')='integer'
      AND json_extract(bm.value_json,'$.policy_revision')=? AND json_type(bm.value_json,'$.command_id')='text'
      AND json_type(bm.value_json,'$.owner_id')='text' AND bc.owner_id=json_extract(bm.value_json,'$.owner_id')
      AND bc.type='budget.override' AND bc.status IN ('accepted','applied') AND json_extract(bc.payload_json,'$.run_id')=r.id
      AND json_type(bm.value_json,'$.created_at')='text' AND length(json_extract(bm.value_json,'$.created_at'))=24
      AND substr(json_extract(bm.value_json,'$.created_at'),12,2)<'24'
      AND date(json_extract(bm.value_json,'$.created_at'),'+0 days')=substr(json_extract(bm.value_json,'$.created_at'),1,10)
      AND strftime('%Y-%m-%dT%H:%M:%fZ',json_extract(bm.value_json,'$.created_at'))=json_extract(bm.value_json,'$.created_at'))`,
    bindings: [BUDGET_OVERRIDE_PREFIX, revision] };
  }

  private matches(run: Pick<Run,'id'|'role'|'parent_run_id'|'current_attempt'|'status'|'occurrence_id'|'routine_id'>, predicate: BudgetAdmissionPredicate): boolean {
    return Boolean(this.store.db.all<{ matched: number }>(`WITH r AS (SELECT ? AS id,? AS role,? AS parent_run_id,? AS current_attempt,
      ? AS status,? AS occurrence_id,? AS routine_id) SELECT COALESCE((${predicate.sql}),0) AS matched FROM r`,
    run.id, run.role, run.parent_run_id, run.current_attempt, run.status, run.occurrence_id, run.routine_id, ...predicate.bindings)[0].matched);
  }

  /** Budget permission only, not full admission. Apply against runs alias r before LIMIT in the same transaction. */
  admissionPredicate(): BudgetAdmissionPredicate {
    const summary = this.summary();
    if (!['BUDGET_UNKNOWN', 'BUDGET_BLOCKED'].includes(summary.status)) return { sql: '1', bindings: [] };
    const eligible = this.eligibility(summary), exception = this.exception(summary.revision);
    return { sql: `NOT ((${eligible.sql}) AND NOT (${exception.sql}))`, bindings: [...eligible.bindings, ...exception.bindings] };
  }

  blocks(run: Omit<Run,'context_json'|'checkpoint_json'>): boolean {
    return !this.matches(run, this.admissionPredicate());
  }

  override(owner: string, commandId: string, runId: string): string {
    return this.store.db.transaction(() => {
      this.command(owner, commandId, 'budget.override', runId);
      const run = this.store.db.all<Pick<Run,'id'|'role'|'parent_run_id'|'current_attempt'|'status'|'occurrence_id'|'routine_id'|'error_code'>>(
        'SELECT id,role,parent_run_id,current_attempt,status,occurrence_id,routine_id,error_code FROM runs WHERE id=?', runId)[0];
      requireThat(run, 'NOT_FOUND', 'Run unavailable.', 404);
      const summary = this.summary();
      requireThat(run.status === 'waiting' && ['BUDGET_UNKNOWN', 'BUDGET_BLOCKED'].includes(run.error_code ?? '') &&
        this.matches(run, this.eligibility(summary)) && ['BUDGET_UNKNOWN', 'BUDGET_BLOCKED'].includes(summary.status),
      'REVISION_CONFLICT', 'Only an unstarted budget-waiting optional occurrence can be overridden.');
      const key = BUDGET_OVERRIDE_PREFIX + run.id, previous = this.metadata(key);
      if (previous !== undefined && this.matches(run, this.exception(summary.revision))) {
        requireThat((previous as Override).command_id === commandId && (previous as Override).owner_id === owner,
          'REVISION_CONFLICT', 'This run already has a different budget override.');
        return run.id;
      }
      requireThat(!previous || (previous as Override).command_id !== commandId, 'REVISION_CONFLICT', 'A new owner command is required after a policy revision.');
      const entry: Override = { run_id: run.id, occurrence_id: run.occurrence_id!, routine_id: run.routine_id!, command_id: commandId,
        owner_id: owner, policy_revision: summary.revision, created_at: this.clock().now };
      this.store.db.exec('INSERT INTO runtime_metadata(key,value_json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json', key, JSON.stringify(entry));
      this.store.event(this.uuid(), null, 'budget.run_overridden', owner, commandId, { run_id: run.id, policy_revision: summary.revision }, entry.created_at);
      return run.id;
    });
  }
}
