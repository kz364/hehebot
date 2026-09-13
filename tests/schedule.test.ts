import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dueOccurrences, nextDue, preview, validateSchedule } from '../src/core/schedule';
import { fixture, routine } from './helpers';
import vectors from '../TEST_VECTORS/lifecycle.json';
let f: ReturnType<typeof fixture>;
beforeEach(() => { f = fixture(); }); afterEach(() => f.close());
describe('schedule safety and DST', () => {
  it('rejects subminimum cadence, invalid timezone and ambiguous day restrictions', () => {
    for (const schedule of [{ cron: '* * * * *', timezone: 'UTC' }, { cron: '0 8 * * *', timezone: 'Invalid/Zone' }, { cron: '0 8 1 * 1', timezone: 'UTC' }]) expect(() => validateSchedule(schedule)).toThrow();
    expect(() => validateSchedule({ cron: '*/15 * * * *', timezone: 'Asia/Jakarta' })).not.toThrow();
  });
  it('skips nonexistent spring-forward hour per fixture', () => {
    const fixture = vectors.vectors.find(c => c.id === 'dst-gap')!;
    expect(fixture.expected_utc).toEqual([]);
    expect(nextDue({ cron: fixture.cron!, timezone: fixture.timezone! }, '2026-03-08T00:00:00.000Z')).toBe('2026-03-09T06:30:00.000Z');
  });
  it('executes only first fall-back fold per fixture, including restart inside fold', () => {
    const fixture = vectors.vectors.find(c => c.id === 'dst-fold')!;
    const schedule = { cron: fixture.cron!, timezone: fixture.timezone! };
    const times = preview(schedule, '2026-11-01T00:00:00.000Z', 2);
    expect(times[0]).toBe(fixture.expected_utc![0]); expect(times[1]).toBe('2026-11-02T06:30:00.000Z');
    expect(nextDue(schedule, '2026-11-01T05:45:00.000Z')).toBe('2026-11-02T06:30:00.000Z');
  });
  it('coalesces delayed occurrences and caps replay', () => {
    const r = routine();
    expect(dueOccurrences(r, '2026-09-10T00:15:00.000Z', '2026-09-10T01:00:00.000Z')).toMatchObject({ selected: ['2026-09-10T01:00:00.000Z'], skipped: 3, next: '2026-09-10T01:15:00.000Z' });
    const replay = { ...r, policy: { ...r.policy, misfire: 'replay' as const, max_replay: 2 } };
    expect(dueOccurrences(replay, '2026-09-10T00:15:00.000Z', '2026-09-10T01:00:00.000Z').selected).toEqual(['2026-09-10T00:45:00.000Z', '2026-09-10T01:00:00.000Z']);
  });
  it('deduplicates repeated scheduler alarms and supersedes unclaimed old revision', () => {
    const r = routine(); expect(f.accept({ schema_version: 1, type: 'routine.put', payload: r }).status).toBe('applied');
    f.setNow('2026-09-10T00:15:00.000Z'); f.core.tick(); f.core.tick();
    expect(f.db.all('SELECT id FROM occurrences')).toHaveLength(1); expect(f.db.all('SELECT id FROM runs')).toHaveLength(1);
    expect(f.accept({ schema_version: 1, type: 'routine.put', payload: { ...r, expected_revision: 1, enabled: false } }).status).toBe('applied');
    expect(f.db.all('SELECT status FROM runs')[0]).toEqual({ status: 'cancelled' });
    expect(f.db.all('SELECT status FROM occurrences')[0]).toEqual({ status: 'superseded' });
    expect(f.db.all('SELECT * FROM schedule_state')).toHaveLength(0);
  });
  it('edits leave claimed runs and their context snapshot unchanged', () => {
    const r = routine(); f.accept({ schema_version: 1, type: 'routine.put', payload: r });
    f.setNow('2026-09-10T00:15:00.000Z'); f.core.tick();
    f.db.exec("UPDATE runs SET status='claimed'");
    const previous = f.db.all<{ context_json: string }>('SELECT context_json FROM runs')[0].context_json;
    f.accept({ schema_version: 1, type: 'routine.put', payload: { ...r, expected_revision: 1, instructions: 'Edited instruction' } });
    expect(f.db.all('SELECT status,context_json FROM runs')[0]).toEqual({ status: 'claimed', context_json: previous });
  });
});
