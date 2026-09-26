import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { MAX_SNAPSHOTS, planBackupRetention } from '../scripts/plan-backup-retention.mjs';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const snapshot = (n: number, snapshot_at: string) => ({ id: id(n), snapshot_at });
const plan = (now: string, snapshots: ReturnType<typeof snapshot>[]) => planBackupRetention({ now, snapshots });
const at = (result: ReturnType<typeof plan>, n: number) => result.decisions.find(row => row.id === id(n))!;

it('expires exact 28 elapsed days and older independently of sparse bucket selection', () => {
  const result = plan('2026-09-28T17:00:00.000Z', [
    snapshot(1, '2026-08-31T17:00:00.000Z'), snapshot(2, '2026-08-31T16:59:59.999Z'),
    snapshot(3, '2026-08-31T17:00:00.001Z'), snapshot(4, '2026-09-06T17:00:00.000Z'),
  ]);
  expect(at(result, 1).reason).toBe('maximum_age');
  expect(at(result, 2).reason).toBe('maximum_age');
  expect(at(result, 3).reason).toBe('not_selected'); // Age-eligible, outside four calendar weeks.
  expect(at(result, 4).buckets).toEqual(['weekly']);
});

it('uses Jakarta midnight, not UTC midnight, and selects newest within each bucket', () => {
  const result = plan('2026-09-14T17:00:00.001Z', [
    snapshot(1, '2026-09-14T16:59:59.999Z'), snapshot(2, '2026-09-14T17:00:00.000Z'),
    snapshot(3, '2026-09-14T17:00:00.001Z'),
  ]);
  expect(at(result, 1).buckets).toEqual(['daily']);
  expect(at(result, 2).action).toBe('expire');
  expect(at(result, 3).buckets).toEqual(['daily', 'weekly']);
});

it('rolls weeks on Monday Jakarta and drops the fourth prior week at that instant', () => {
  const rows = [snapshot(1, '2026-08-24T05:00:00.000Z'), snapshot(2, '2026-08-30T17:00:00.000Z')];
  expect(at(plan('2026-09-20T16:59:59.999Z', rows), 1).buckets).toEqual(['weekly']);
  const after = plan('2026-09-20T17:00:00.000Z', rows);
  expect(at(after, 1).reason).toBe('not_selected'); // Still younger than28 days.
  expect(at(after, 2).buckets).toEqual(['weekly']);
});

it('selects seven current calendar days and four weeks, sharing representatives', () => {
  const rows = Array.from({ length: 28 }, (_, n) => snapshot(n + 1, `2026-09-${String(28 - n).padStart(2, '0')}T05:00:00.000Z`));
  const result = plan('2026-09-28T06:00:00.000Z', rows);
  expect(result.decisions.filter(row => row.buckets.includes('daily')).map(row => row.id)).toEqual([1, 2, 3, 4, 5, 6, 7].map(id));
  expect(result.decisions.filter(row => row.buckets.includes('weekly')).map(row => row.id)).toEqual([1, 2, 9, 16].map(id));
  expect(result.decisions.filter(row => row.action === 'keep')).toHaveLength(9);
});

it('does not fill empty buckets from older snapshots', () => {
  const result = plan('2026-09-28T06:00:00.000Z', [snapshot(7, '2026-09-01T05:00:00.000Z')]);
  expect(at(result, 7)).toMatchObject({ action: 'expire', reason: 'not_selected', buckets: [] });
  expect(plan('2026-09-28T06:00:00.000Z', []).decisions).toEqual([]);
});

it('ties by ascending opaque UUID and remains order independent, repeatable and nonmutating', () => {
  const rows = [snapshot(39, '2026-09-14T06:00:00.000Z'), snapshot(2, '2026-09-14T06:00:00.000Z')];
  const before = JSON.stringify(rows); Object.freeze(rows); rows.forEach(Object.freeze);
  const first = plan('2026-09-14T06:00:00.000Z', rows);
  expect(at(first, 2).action).toBe('keep'); expect(at(first, 39).action).toBe('expire');
  expect(plan('2026-09-14T06:00:00.000Z', [...rows].reverse())).toEqual(first);
  expect(plan('2026-09-14T06:00:00.000Z', rows)).toEqual(first); expect(JSON.stringify(rows)).toBe(before);
});

it('handles Jakarta year rollover and leap day without normalizing invalid dates', () => {
  const result = plan('2026-12-31T17:00:00.000Z', [snapshot(1, '2026-12-31T16:59:59.999Z'), snapshot(2, '2026-12-31T17:00:00.000Z')]);
  expect(at(result, 1).buckets).toEqual(['daily']); expect(at(result, 2).buckets).toEqual(['daily', 'weekly']);
  expect(plan('2024-02-29T01:00:00.000Z', [snapshot(1, '2024-02-29T00:00:00.000Z')]).decisions[0].action).toBe('keep');
});

it.each(['2026-02-30T00:00:00.000Z', '2026-09-14T00:00:00Z', '2026-09-14T07:00:00.000+07:00', 'secret-canary', '2026-09-14T24:00:00.000Z'])('rejects noncanonical timestamps: %s', value => {
  expect(() => plan(value, [])).toThrow('INVALID_RETENTION_INPUT');
  expect(() => plan('2026-09-15T00:00:00.000Z', [snapshot(1, value)])).toThrow('INVALID_RETENTION_INPUT');
});

it('rejects future records, duplicate identities, oversized catalogs and extra content', () => {
  const now = '2026-09-14T06:00:00.000Z';
  const valid = snapshot(1, now);
  for (const input of [
    { now, snapshots: [snapshot(1, '2026-09-14T06:00:00.001Z')] },
    { now, snapshots: [valid, { ...valid, snapshot_at: '2026-09-13T06:00:00.000Z' }] },
    { now, snapshots: [{ ...valid, id: '../secret' }] },
    { now, snapshots: [{ ...valid, mtime: now }] },
    { now, snapshots: [], credential: 'SECRET_CANARY' },
    { now, snapshots: Array.from({ length: MAX_SNAPSHOTS + 1 }, (_, i) => snapshot(i, now)) },
  ]) expect(() => planBackupRetention(input)).toThrow('INVALID_RETENTION_INPUT');
});

it('CLI emits only bounded decision metadata, and rejects content without echoing it', () => {
  const cli = decodeURIComponent(new URL('../scripts/plan-backup-retention.mjs', import.meta.url).pathname);
  const good = spawnSync(process.execPath, [cli], { input: JSON.stringify({ now: '2026-09-14T06:00:00.000Z', snapshots: [] }), encoding: 'utf8' });
  expect(good.status).toBe(0); expect(JSON.parse(good.stdout).decisions).toEqual([]);
  for (const input of ['{"credential":"SECRET_CANARY"}', 'x'.repeat(1024 * 1024 + 1)]) {
    const bad = spawnSync(process.execPath, [cli], { input, encoding: 'utf8' });
    expect(bad.status).toBe(1); expect(bad.stdout).toBe(''); expect(bad.stderr).toBe('INVALID_RETENTION_INPUT\n');
  }
});
