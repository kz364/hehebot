import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { bot, fixture } from './helpers';
import { LifecycleCore, type Identity } from '../src/core/lifecycle';
import { DEFAULT_METERING_RATES, MeteringLedger, jakartaDay, meteringSummary, parseMeteringRates, type MeteringReport } from '../src/core/metering';

let f: ReturnType<typeof fixture>, lifecycle: LifecycleCore, identity: Identity, ledger: MeteringLedger;
const sample = (overrides: Partial<MeteringReport> = {}): MeteringReport =>
  ({ interval_seconds: 60, cpu_seconds: 6, gb_seconds: 3.75, samples: 4, cgroup_available: true, ...overrides });
beforeEach(() => {
  f = fixture(true); lifecycle = new LifecycleCore(f.store, f.core); ledger = new MeteringLedger(f.store, () => f.core.now());
  f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=1,lease_until='2026-09-10T00:02:00.000Z'");
  identity = lifecycle.registerBoot(randomUUID()); lifecycle.ready(identity);
});
afterEach(() => f.close());
const record = (value = sample()) => ledger.record(identity, value, lifecycle);

it('jakartaDay buckets by Asia/Jakarta (UTC+7) calendar day, not UTC', () => {
  expect(jakartaDay('2026-09-10T16:59:59.000Z')).toBe('2026-09-10');
  expect(jakartaDay('2026-09-10T17:00:00.000Z')).toBe('2026-09-11');
  expect(jakartaDay('2026-09-10T00:00:00.000Z')).toBe('2026-09-10');
});

it('accumulates reports into the Jakarta-day ledger row', () => {
  record(); record();
  const day = ledger.day(jakartaDay(f.core.now()));
  expect(day).toMatchObject({ awake_seconds: 120, cpu_seconds: 12, gb_seconds: 7.5, samples: 8, reports: 2 });
});

it('rolls into a new bucket at the Jakarta day boundary', () => {
  f.db.exec("UPDATE lifecycle SET lease_until='2026-09-10T18:00:00.000Z'");
  f.setNow('2026-09-10T16:59:00.000Z'); record();
  f.setNow('2026-09-10T17:01:00.000Z'); record();
  expect(ledger.day('2026-09-10')).toMatchObject({ awake_seconds: 60 });
  expect(ledger.day('2026-09-11')).toMatchObject({ awake_seconds: 60 });
});

it('rejects a malformed report and writes nothing', () => {
  const before = ledger.day(jakartaDay(f.core.now()));
  const invalid: unknown[] = [
    { ...sample(), extra: true }, { ...sample(), interval_seconds: -1 }, { ...sample(), cpu_seconds: 999999 },
    { ...sample(), samples: 1.5 }, { ...sample(), cgroup_available: 'yes' },
  ];
  for (const value of invalid) expect(() => record(value as MeteringReport)).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
  expect(ledger.day(jakartaDay(f.core.now()))).toEqual(before);
});

it.each(['epoch', 'boot', 'phase'] as const)('fences on stale %s identity like heartbeat', kind => {
  if (kind === 'epoch') identity.epoch++;
  if (kind === 'boot') identity.boot_id = randomUUID();
  if (kind === 'phase') f.db.exec("UPDATE lifecycle SET phase='STOPPED'");
  expect(() => record()).toThrowError(expect.objectContaining({ code: 'STALE_EPOCH' }));
});

it('allows BOOTING as well as READY, unlike attempt-scoped RPCs', () => {
  f.db.exec("UPDATE lifecycle SET phase='BOOTING'");
  expect(() => record()).not.toThrow();
});

it('prunes rows strictly before the cutoff day, keeping the cutoff day itself', () => {
  f.setNow('2026-01-01T00:00:00.000Z'); record();
  f.setNow('2026-02-01T00:00:00.000Z'); record();
  expect(ledger.prune('2026-02-01')).toBe(1);
  expect(ledger.day('2026-01-01')).toBeNull();
  expect(ledger.day('2026-02-01')).not.toBeNull();
});

it('parseMeteringRates defaults to the published Sprite rates and validates overrides', () => {
  expect(parseMeteringRates(undefined)).toEqual(DEFAULT_METERING_RATES);
  expect(parseMeteringRates('')).toEqual(DEFAULT_METERING_RATES);
  const custom = { cpu_hour_usd: 0.1, gb_hour_usd: 0.05, storage_gb_hour_usd: 0.001 };
  expect(parseMeteringRates(JSON.stringify(custom))).toEqual(custom);
  for (const bad of ['not json', '{}', '{"cpu_hour_usd":-1,"gb_hour_usd":0,"storage_gb_hour_usd":0}',
    '{"cpu_hour_usd":0,"gb_hour_usd":0,"storage_gb_hour_usd":0,"extra":1}'])
    expect(() => parseMeteringRates(bad)).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIGURATION' }));
});

it('meteringSummary computes cost from cpu/gb-seconds at the configured rates and aggregates today/7-day/month-to-date', () => {
  // 3600 cpu-seconds = 1 cpu-hour, 3600 gb-seconds = 1 gb-hour, at default rates.
  record({ interval_seconds: 60, cpu_seconds: 3600, gb_seconds: 3600, samples: 1, cgroup_available: true });
  const summary = meteringSummary(f.store, f.core.now(), DEFAULT_METERING_RATES);
  expect(summary.calendar).toBe('Asia/Jakarta');
  expect(summary.today).toEqual({ awake_minutes: 1, cpu_hours: 1, gb_hours: 1, estimated_usd: 0.1138, samples: 1 });
  expect(summary.last_7_days).toEqual(summary.today);
  expect(summary.month_to_date).toEqual(summary.today);
  expect(summary.note).toContain('reconcile with Fly Cost Explorer');
});

it('meteringSummary reads zero for days with no reports', () => {
  const summary = meteringSummary(f.store, f.core.now(), DEFAULT_METERING_RATES);
  expect(summary.today).toEqual({ awake_minutes: 0, cpu_hours: 0, gb_hours: 0, estimated_usd: 0, samples: 0 });
});

it('surfaces retained token-usage snapshot totals with an explicit non-daily-ledger note', () => {
  f.db.exec("INSERT INTO runtime_metadata(key,value_json) VALUES('token-usage:run-a',?)", JSON.stringify({ usage: { total: { totalTokens: 1234 } } }));
  f.db.exec("INSERT INTO runtime_metadata(key,value_json) VALUES('token-usage:run-b',?)", JSON.stringify({ usage: { total: { totalTokens: 66 } } }));
  const summary = meteringSummary(f.store, f.core.now(), DEFAULT_METERING_RATES);
  expect(summary.tokens.total_tokens_in_retained_snapshots).toBe(1300);
  expect(summary.tokens.note).toMatch(/not bucketed by day/);
});

it('is exposed on /v1/state as `metering`', () => {
  f.accept({ schema_version: 1, type: 'message.send', payload: { conversation_id: bot, text: 'hi' } });
  const state = f.core.state();
  expect(state.metering).toBeDefined();
  expect(state.metering.today).toBeDefined();
});
