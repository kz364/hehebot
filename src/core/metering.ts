import { requireThat } from './errors';
import type { Identity, LifecycleCore } from './lifecycle';
import type { Store } from './store';

/** Published Fly Sprite rates as of 2026-09; the owner reconciles occasionally against Fly's Cost Explorer. */
export type MeteringRates = { cpu_hour_usd: number; gb_hour_usd: number; storage_gb_hour_usd: number };
export const DEFAULT_METERING_RATES: MeteringRates = { cpu_hour_usd: 0.07, gb_hour_usd: 0.04375, storage_gb_hour_usd: 0.000683 };
const rateKeys = ['cpu_hour_usd', 'gb_hour_usd', 'storage_gb_hour_usd'] as const;

export function parseMeteringRates(raw: string | undefined): MeteringRates {
  if (raw === undefined || raw === '') return DEFAULT_METERING_RATES;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { parsed = null; }
  const positive = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1000;
  requireThat(!!parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
    Object.keys(parsed).sort().join(',') === rateKeys.slice().sort().join(',') &&
    rateKeys.every(key => positive((parsed as Record<string, unknown>)[key])),
    'INVALID_CONFIGURATION', 'HEHEBOT_METERING_RATES must be {cpu_hour_usd,gb_hour_usd,storage_gb_hour_usd} as non-negative numbers.', 503);
  return parsed as MeteringRates;
}

/**
 * Self-metering only: Fly has no usage/billing API for Sprites, so the runtime samples its
 * own cgroup and reports periodically. Awake seconds are derived from the wall interval each
 * report covers (not from a separate lifecycle-transition log) because that interval is already
 * fenced by the same epoch/boot identity check as heartbeat, and adding a persistent phase-
 * transition history just to double-check it would not change the trust boundary. The only
 * gap this leaves is the time between the last report before an unclean stop and the actual
 * stop, bounded by the report interval (default 60s).
 */
export type MeteringReport = { interval_seconds: number; cpu_seconds: number; gb_seconds: number; samples: number; cgroup_available: boolean };
export type MeteringDay = { day: string; awake_seconds: number; cpu_seconds: number; gb_seconds: number; samples: number; reports: number; updated_at: string };

const prefix = 'metering:';
// The owner is in Asia/Jakarta (UTC+7, no DST); ledger days are Jakarta calendar days so the
// portal's "today"/"7 days"/"month-to-date" line up with what the owner experiences.
export const jakartaDay = (isoTime: string): string => new Date(Date.parse(isoTime) + 7 * 3_600_000).toISOString().slice(0, 10);

function validReport(value: unknown): value is MeteringReport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const keys = ['interval_seconds', 'cpu_seconds', 'gb_seconds', 'samples', 'cgroup_available'];
  if (Object.keys(v).sort().join(',') !== keys.slice().sort().join(',')) return false;
  const bounded = (x: unknown, max: number) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= max;
  // 4 CPU-hours and 64 GiB-hours per report is far beyond any Sprite size; this only guards
  // against a malformed/hostile sample, not real usage.
  return bounded(v.interval_seconds, 3600) && bounded(v.cpu_seconds, 14400) && bounded(v.gb_seconds, 230400) &&
    Number.isSafeInteger(v.samples) && (v.samples as number) >= 0 && (v.samples as number) <= 1000 && typeof v.cgroup_available === 'boolean';
}

/** Runtime observations only; not a billing record. Fenced by the same identity check as heartbeat. */
export class MeteringLedger {
  constructor(private store: Store, private now: () => string) {}

  record(identity: Identity, report: MeteringReport, lifecycle: LifecycleCore): void {
    requireThat(validReport(report), 'INVALID_INPUT', 'Invalid metering report.', 422);
    this.store.db.transaction(() => {
      lifecycle.authorizeMetering(identity);
      const day = jakartaDay(this.now());
      const key = prefix + day;
      const row = this.store.db.all<{ value_json: string }>('SELECT value_json FROM runtime_metadata WHERE key=?', key)[0];
      const prior: MeteringDay = row ? JSON.parse(row.value_json) : { day, awake_seconds: 0, cpu_seconds: 0, gb_seconds: 0, samples: 0, reports: 0, updated_at: this.now() };
      const next: MeteringDay = {
        day,
        awake_seconds: prior.awake_seconds + report.interval_seconds,
        cpu_seconds: prior.cpu_seconds + report.cpu_seconds,
        gb_seconds: prior.gb_seconds + report.gb_seconds,
        samples: prior.samples + report.samples,
        reports: prior.reports + 1,
        updated_at: this.now(),
      };
      this.store.db.exec('INSERT INTO runtime_metadata(key,value_json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json', key, JSON.stringify(next));
    });
  }

  day(day: string): MeteringDay | null {
    const row = this.store.db.all<{ value_json: string }>('SELECT value_json FROM runtime_metadata WHERE key=?', prefix + day)[0];
    return row ? JSON.parse(row.value_json) as MeteringDay : null;
  }

  /** Retention: keep 400 days of daily rows (well beyond month-to-date) so history stays cheap. */
  prune(cutoffDay: string): number {
    return this.store.db.transaction(() => {
      const rows = this.store.db.all<{ key: string }>("SELECT key FROM runtime_metadata WHERE key GLOB 'metering:*' AND substr(key,10)<? ORDER BY key LIMIT 100", cutoffDay);
      for (const row of rows) this.store.db.exec('DELETE FROM runtime_metadata WHERE key=?', row.key);
      return rows.length;
    });
  }
}

function zeroTotals(): { awake_seconds: number; cpu_seconds: number; gb_seconds: number; samples: number } {
  return { awake_seconds: 0, cpu_seconds: 0, gb_seconds: 0, samples: 0 };
}
function addDay(totals: ReturnType<typeof zeroTotals>, day: MeteringDay | null) {
  if (!day) return;
  totals.awake_seconds += day.awake_seconds; totals.cpu_seconds += day.cpu_seconds; totals.gb_seconds += day.gb_seconds; totals.samples += day.samples;
}
function present(totals: ReturnType<typeof zeroTotals>, rates: MeteringRates) {
  return {
    awake_minutes: Math.round(totals.awake_seconds / 60 * 100) / 100,
    cpu_hours: Math.round(totals.cpu_seconds / 3600 * 10000) / 10000,
    gb_hours: Math.round(totals.gb_seconds / 3600 * 10000) / 10000,
    estimated_usd: Math.round((totals.cpu_seconds / 3600 * rates.cpu_hour_usd + totals.gb_seconds / 3600 * rates.gb_hour_usd) * 10000) / 10000,
    samples: totals.samples,
  };
}

/** today / last 7 days / month-to-date, all bucketed by Jakarta calendar day. */
export function meteringSummary(store: Store, nowIso: string, rates: MeteringRates) {
  const ledger = new MeteringLedger(store, () => nowIso);
  const today = jakartaDay(nowIso);
  const dayMs = 86_400_000;
  const jakartaNow = Date.parse(nowIso) + 7 * 3_600_000;
  const monthStart = today.slice(0, 7) + '-01';
  const last7 = zeroTotals(), monthToDate = zeroTotals();
  const todayTotals = zeroTotals();
  addDay(todayTotals, ledger.day(today));
  for (let i = 0; i < 7; i++) addDay(last7, ledger.day(new Date(jakartaNow - i * dayMs).toISOString().slice(0, 10)));
  for (let cursor = monthStart; cursor <= today; cursor = new Date(Date.parse(cursor) + dayMs).toISOString().slice(0, 10)) addDay(monthToDate, ledger.day(cursor));
  const tokenTotal = store.db.all<{ total: number | null }>(
    "SELECT SUM(json_extract(value_json,'$.usage.total.totalTokens')) AS total FROM runtime_metadata WHERE key GLOB 'token-usage:*'")[0].total ?? 0;
  return {
    calendar: 'Asia/Jakarta', rates,
    today: present(todayTotals, rates), last_7_days: present(last7, rates), month_to_date: present(monthToDate, rates),
    // Snapshots are per-run (not per-day) and are pruned after 90 days; this is a live sum of
    // what is currently retained, not a true daily/monthly token ledger. See docs/METERING.md.
    tokens: { total_tokens_in_retained_snapshots: tokenTotal, note: 'Sum of currently retained per-run token-usage snapshots; not bucketed by day.' },
    note: 'Estimate from runtime samples × published Sprite rates; reconcile with Fly Cost Explorer.',
  };
}
