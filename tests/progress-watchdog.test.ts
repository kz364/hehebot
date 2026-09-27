import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { LifecycleCore, type Identity } from '../src/core/lifecycle';
import { ProgressWatchdog, parseStuckPolicy } from '../src/core/progress-watchdog';
import { bot, fixture } from './helpers';

let f: ReturnType<typeof fixture>, life: LifecycleCore, identity: Identity, dog: ProgressWatchdog, run: string;
const T0 = Date.parse('2026-09-10T00:00:00.000Z');
const at = (ms: number) => { f.setNow(new Date(T0 + ms).toISOString()); f.db.exec('UPDATE lifecycle SET lease_until=?', new Date(T0 + ms + 60000).toISOString()); };
const status = () => f.db.all<{ status: string; error_code: string | null }>('SELECT status,error_code FROM runs WHERE id=?', run)[0];
const steers = () => f.db.all("SELECT id FROM commands WHERE type='run.steer' AND owner_id='system' AND status='applied'").length;
const tokens = (total: number) => f.db.exec("INSERT INTO runtime_metadata(key,value_json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json",
  `token-usage:${run}`, JSON.stringify({ attempt: 1, usage: { total: { totalTokens: total } } }));
beforeEach(() => {
  f = fixture(true);
  life = new LifecycleCore(f.store, f.core);
  dog = new ProgressWatchdog(f.store, f.core, parseStuckPolicy('{"no_progress_ms":300000,"nudge_grace_ms":120000}'));
  f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=1,lease_until='2026-09-10T00:02:00.000Z'");
  identity = life.registerBoot(randomUUID()); life.ready(identity);
  run = f.core.enqueue(bot, 'Browse for something', null, null, null);
  life.claim(identity); life.submitted(identity, run, 1, `native:${run}`);
});
afterEach(() => f.close());

it('attempts that never report progress are not watched', () => {
  at(3_600_000); dog.sweep();
  expect(status().status).toBe('running'); expect(steers()).toBe(0);
});
it('idle past the threshold is nudged once, then stopped with an owner notice', () => {
  dog.record(identity, run, 1, 'browser', life);
  at(200_000); dog.sweep(); expect(steers()).toBe(0);
  at(301_000); dog.sweep(); expect(steers()).toBe(1);
  at(360_000); dog.sweep(); expect(steers()).toBe(1); expect(status().status).toBe('running');
  at(422_000); dog.sweep();
  expect(status()).toEqual({ status: 'cancelling', error_code: 'STUCK_NO_PROGRESS' });
  const notice = f.db.all<{ payload_json: string }>("SELECT payload_json FROM events WHERE type='notice'").map(r => JSON.parse(r.payload_json));
  expect(notice).toEqual([expect.objectContaining({ kind: 'runtime', reason: 'STUCK_NO_PROGRESS', run_id: run })]);
});
it('new progress or growing token usage counts as activity and clears a nudge', () => {
  tokens(100); dog.record(identity, run, 1, 'browser', life);
  at(301_000); dog.sweep(); expect(steers()).toBe(1);
  tokens(250); at(330_000); dog.sweep();
  at(500_000); dog.sweep(); expect(status().status).toBe('running');
  dog.record(identity, run, 1, 'browser', life);
  at(700_000); dog.sweep(); expect(status().status).toBe('running');
});
it('policy is optional and validated', () => {
  expect(parseStuckPolicy(undefined)).toBeUndefined();
  expect(() => parseStuckPolicy('{"no_progress_ms":5}')).toThrow();
  const off = new ProgressWatchdog(f.store, f.core);
  dog.record(identity, run, 1, 'browser', life); at(3_600_000); off.sweep();
  expect(status().status).toBe('running');
});
