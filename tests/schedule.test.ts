import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dueOccurrences, nextDue, preview, validateSchedule } from '../src/core/schedule';
import { fixture, routine } from './helpers';
import vectors from '../TEST_VECTORS/lifecycle.json';
let f: ReturnType<typeof fixture>;
beforeEach(() => { f = fixture(); }); afterEach(() => f.close());
describe('schedule safety and DST', () => {
  it.each([
    ['2026-09-10T00:00:00.000Z','23 9 * * 1-5','Asia/Jakarta',['2026-09-10T02:23:00.000Z','2026-09-11T02:23:00.000Z','2026-09-14T02:23:00.000Z']],
    ['2026-03-08T00:00:00.000Z','30 2 * * *','America/New_York',['2026-03-09T06:30:00.000Z','2026-03-10T06:30:00.000Z','2026-03-11T06:30:00.000Z']],
    ['2026-11-01T00:00:00.000Z','30 1 * * *','America/New_York',['2026-11-01T05:30:00.000Z','2026-11-02T06:30:00.000Z','2026-11-03T06:30:00.000Z']],
    ['2026-01-31T09:00:00.000Z','0 9 31 * *','UTC',['2026-03-31T09:00:00.000Z','2026-05-31T09:00:00.000Z','2026-07-31T09:00:00.000Z']],
  ])('owner preview is pure and matches saved next times for %s %s', (now,cron,timezone,next_times)=>{
    f.setNow(now as string);const tables=['objects','commands','runs','occurrences','schedule_state','lifecycle','events'];
    const before=tables.map(table=>f.db.all(`SELECT * FROM ${table}`)),schedule={cron:cron as string,timezone:timezone as string};
    expect(f.core.schedulePreview(schedule.cron,schedule.timezone)).toEqual({schedule,observed_at:now,next_times});
    expect(tables.map(table=>f.db.all(`SELECT * FROM ${table}`))).toEqual(before);
    const r=routine({schedule});expect(f.accept({schema_version:1,type:'routine.put',payload:r}).status).toBe('applied');
    const event=f.db.all<{payload_json:string}>("SELECT payload_json FROM events WHERE type='routine.updated'")[0];
    expect(JSON.parse(event.payload_json).next_times).toEqual(next_times);
  });
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
  it.each([
    ['2026-09-10T03:00:59.999Z', ['2026-09-10T03:00:00.000Z'], 11],
    ['2026-09-10T03:01:00.000Z', [], 12],
    ['2026-09-10T03:01:00.001Z', [], 12],
  ])('skip misfires across twelve ticks at %s', (now, selected, skipped) => {
    const r = routine(); r.policy.misfire = 'skip';
    expect(dueOccurrences(r, '2026-09-10T00:15:00.000Z', now as string)).toEqual({ selected, skipped, next: '2026-09-10T03:15:00.000Z' });
  });
  it.each([
    ['2026-09-10T00:16:00.000Z', ['2026-09-10T00:15:00.000Z'], 0],
    ['2026-09-10T00:16:00.001Z', [], 1],
  ])('coalesce uses an inclusive max-lateness boundary at %s', (now, selected, skipped) => {
    const r = routine(); r.policy.max_lateness_seconds = 60;
    expect(dueOccurrences(r, '2026-09-10T00:15:00.000Z', now as string)).toEqual({ selected, skipped, next: '2026-09-10T00:30:00.000Z' });
  });
  it('caps twelve missed ticks at the latest three independently enumerated instants', () => {
    const r = routine(); r.policy.misfire = 'replay'; r.policy.max_replay = 3;
    expect(dueOccurrences(r, '2026-09-10T00:15:00.000Z', '2026-09-10T03:00:00.000Z')).toEqual({
      selected: ['2026-09-10T02:30:00.000Z', '2026-09-10T02:45:00.000Z', '2026-09-10T03:00:00.000Z'], skipped: 9, next: '2026-09-10T03:15:00.000Z',
    });
  });
  it('overlap skip records a skipped occurrence without replacing existing work', () => {
    const r = routine(); r.policy.overlap = 'skip';
    f.accept({ schema_version: 1, type: 'routine.put', payload: r });
    f.setNow('2026-09-10T00:15:00.000Z'); f.core.tick();
    const before = f.db.all('SELECT * FROM runs');
    f.setNow('2026-09-10T00:30:00.000Z'); f.core.tick(); f.core.tick();
    expect(f.db.all('SELECT * FROM runs')).toEqual(before);
    expect(f.db.all('SELECT nominal_due_at,status FROM occurrences ORDER BY nominal_due_at')).toEqual([
      { nominal_due_at: '2026-09-10T00:15:00.000Z', status: 'queued' },
      { nominal_due_at: '2026-09-10T00:30:00.000Z', status: 'skipped' },
    ]);
  });
});
