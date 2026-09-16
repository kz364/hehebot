import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { ControlCore } from '../src/core/control';
import { Store } from '../src/core/store';
import { LifecycleCore } from '../src/core/lifecycle';
import { EffectLedger, type EffectIntent } from '../src/core/effects';
import { ResourceLedger } from '../src/core/resources';
import { fixture, bot, routine } from './helpers';

// Real SQLite/core, synthetic receipts and provider observations. Reconstruction
// replaces JS objects over the same database; it is NOT a process crash, durable
// disk reopen, native executor termination, or live-provider acceptance.
const seeds = Array.from({ length: 200 }, (_, i) => 0xe15000 + i);
const coverage: Record<string, number> = {};
function count(name: string) { coverage[name] = (coverage[name] ?? 0) + 1; }
function random(seed: number) {
  for (let i = 0; i < 10; i++) seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
}
const denied = (fn: () => unknown, code: string) =>
  expect(fn).toThrowError(expect.objectContaining({ code }));
type Status = 'intent' | 'dispatched' | 'outcome_unknown' | 'confirmed' | 'failed';
type ModelEffect = { input: EffectIntent; status: Status; receipt: Record<string, unknown> | null };
const pending = (effect: ModelEffect) => !['confirmed', 'failed'].includes(effect.status);

describe('seeded effect custody and drain races', () => {
  afterAll(() => {
    // These floors make silently losing an admitted branch a suite failure.
    for (const name of ['dispatch', 'unknown', 'receipt', 'cancel', 'lease-loss', 'stopped-pending',
      'stopped-settled', 'reconstruct', 'drain-commit', 'queue-invalidates', 'lease-invalidates']) {
      expect(coverage[name], name).toBeGreaterThan(0);
    }
    console.info(`Drain/effect seeds ${seeds[0]}..${seeds.at(-1)}: ${JSON.stringify(coverage)}`);
  });

  it.each(seeds)('seed %i preserves effects, receipts and locks at every scheduled boundary', seed => {
    const rand = random(seed), f = fixture(true), trace: string[] = [];
    let life = new LifecycleCore(f.store, f.core);
    let effects = new EffectLedger(f.store, () => f.core.now());
    let resources = new ResourceLedger(f.store, () => f.core.now());
    const reconstruct = () => {
      const store = new Store(f.db), core = new ControlCore(store, f.core.options);
      life = new LifecycleCore(store, core);
      effects = new EffectLedger(store, () => core.now());
      resources = new ResourceLedger(store, () => core.now());
      count('reconstruct');
    };
    try {
      const policy = '44444444-4444-4444-8444-444444444444';
      f.core.options.actionPolicyIds.push(policy);
      const r = routine({ action_policy_ids: [policy] });
      expect(f.accept({ schema_version: 1, type: 'routine.put', payload: r }).status).toBe('applied');
      f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=1,lease_until='2026-09-10T00:02:00.000Z'");
      const identity = life.registerBoot(randomUUID()); life.ready(identity);
      const run = f.core.enqueue(bot, 'Synthetic race', null, r.id, null);
      expect(life.claim(identity)?.run.id).toBe(run); life.submitted(identity, run, 1, 'synthetic-native');
      const lockIds = ['calendar:17', 'mail:93'];
      resources.acquire(run, 1, lockIds);
      let held = true, cancelled = false, lost = false, stopped = false;
      const model: ModelEffect[] = Array.from({ length: 3 }, (_, i) => ({
        input: { id: randomUUID(), run_id: run, attempt: 1, action_key: `seed:${seed}:effect:${i}`,
          classification: i === 1 ? 'idempotent' : 'mutation', authorization_ref: policy,
          request_digest: `request:${i}`, provider_idempotency_key: i === 1 ? `destination:${seed}` : null },
        status: 'intent', receipt: null,
      }));
      for (const e of model) expect(effects.intent(e.input).status).toBe('intent');
      // Guarantee a genuinely admitted dispatch before the random cancellation /
      // lease-loss frontier, while the other two effects still have unsent intents.
      effects.transition(model[0].input.id, run, 'dispatched', null);
      model[0].status = 'dispatched'; count('dispatch');
      const check = () => {
        expect(f.db.all('SELECT id,status,receipt_json FROM effects ORDER BY action_key')).toEqual(
          model.map(e => ({ id: e.input.id, status: e.status, receipt_json: e.receipt ? JSON.stringify(e.receipt) : null })));
        expect(f.db.all('SELECT resource_id,run_id,attempt FROM resource_locks ORDER BY resource_id')).toEqual(
          held ? lockIds.map(resource_id => ({ resource_id, run_id: run, attempt: 1 })) : []);
        expect(f.db.all('SELECT * FROM retry_queue')).toEqual([]);
        expect(f.db.all('SELECT * FROM outbox')).toEqual([]);
        expect(f.db.all('SELECT attempt,native_run_ref FROM attempts')).toEqual([{ attempt: 1, native_run_ref: 'synthetic-native' }]);
      };
      const stop = () => {
        const unresolved = model.some(pending);
        count(unresolved ? 'stopped-pending' : 'stopped-settled');
        const before = f.db.all('SELECT * FROM lifecycle');
        denied(() => life.observeStopped({ phase: 'unknown', executionStopped: false, executionPaused: true,
          persistentState: 'retained', observedAt: Date.parse(f.core.now()) }), 'CAPABILITY_UNAVAILABLE');
        expect(f.db.all('SELECT * FROM lifecycle')).toEqual(before); check();
        life.observeStopped({ phase: 'stopped', executionStopped: true, persistentState: 'retained', observedAt: Date.parse(f.core.now()) });
        stopped = true;
        if (!unresolved) held = false;
        life.observeStopped({ phase: 'stopped', executionStopped: true, persistentState: 'retained', observedAt: Date.parse(f.core.now()) });
      };
      // Enabled actions come from the independent model, never database state.
      // Each chosen action advances a frontier, so this cannot degenerate into
      // a random-input rejection loop. The trace labels suffice to replay order.
      let rebuilds = 3;
      const loseLease = seed % 2 === 0;
      while (model.some(pending) || rebuilds || !cancelled || (loseLease && !stopped)) {
        const actions: { name: string; run: () => void }[] = [];
        model.forEach((e, i) => {
          if (!pending(e)) return;
          actions.push({ name: `${i}:${e.status}`, run: () => {
            let next: Status;
            if (e.status === 'intent') next = cancelled || lost ? 'failed' : 'dispatched';
            else if (e.status === 'dispatched') next = 'outcome_unknown';
            else next = i === 2 ? 'failed' : 'confirmed';
            const receipt = ['confirmed', 'failed'].includes(next) ? { destination: `receipt:${seed}:${i}`, outcome: next } : null;
            effects.transition(e.input.id, run, next, receipt);
            e.status = next; e.receipt = receipt;
            count(next === 'dispatched' ? 'dispatch' : next === 'outcome_unknown' ? 'unknown' : 'receipt');
          } });
        });
        if (!cancelled) actions.push({ name: 'cancel', run: () => {
          expect(f.accept({ schema_version: 1, type: 'run.cancel', payload: { run_id: run, reason: 'Synthetic cancel' } }).status).toBe('applied');
          cancelled = true; count('cancel');
        } });
        if (rebuilds) actions.push({ name: 'reconstruct', run: () => { reconstruct(); rebuilds--; } });
        if (loseLease && !lost) actions.push({ name: 'lease-loss', run: () => {
          f.setNow('2026-09-10T00:01:29.999Z');
          life.authorizeAttempt(identity, run, 1);
          f.setNow('2026-09-10T00:01:30.000Z'); life.watchdog(); lost = true; count('lease-loss');
          for (const e of model) if (e.status === 'intent' || e.status === 'dispatched') { e.status = 'outcome_unknown'; e.receipt = null; }
          denied(() => life.heartbeat(identity, []), 'STALE_EPOCH');
        } });
        if (lost && !stopped) actions.push({ name: 'stop-observation', run: stop });
        const action = actions[Math.floor(rand() * actions.length)]; trace.push(action.name); action.run(); check();
        if (!cancelled && !lost) {
          for (const e of model) expect(effects.intent({ ...e.input, id: randomUUID() })).toEqual({ id: e.input.id, status: e.status });
          const before = f.db.all('SELECT * FROM resource_locks');
          resources.acquire(run, 1, [...lockIds].reverse());
          expect(f.db.all('SELECT * FROM resource_locks')).toEqual(before);
        }
        if (model.some(pending)) {
          denied(() => resources.release(run, 1, lockIds), 'OUTCOME_UNKNOWN');
          check(); // Rejected release must leave every lock and receipt intact.
        }
        if (!lost) denied(() => life.prepareSleep(identity), 'SLEEP_DENIED');
        else denied(() => life.prepareSleep(identity), 'STALE_EPOCH');
        for (const e of model.filter(e => e.status === 'outcome_unknown')) {
          denied(() => effects.transition(e.input.id, run, 'dispatched', null), 'REVISION_CONFLICT');
        }
        check();
      }
      // Receipts are immutable under duplicate delivery, including after stop.
      for (const e of model) effects.transition(e.input.id, run, e.status as 'confirmed' | 'failed', { wrong: 'duplicate must not overwrite' });
      check();
      if (lost) {
        denied(() => life.complete(identity, run, 1, { status: 'cancelled', text: '' }), 'STALE_EPOCH');
        expect(f.store.run(run).status).toBe('recovery_required');
        resources.release(run, 1, lockIds); held = false; check();
        return; // No synthetic successful recovery is inferred from receipts.
      }
      resources.release(run, 1, lockIds); held = false; check();
      life.complete(identity, run, 1, { status: 'cancelled', text: 'Suppressed' });
      expect(f.db.all<{ payload_json: string }>('SELECT payload_json FROM outbox').map(row => JSON.parse(row.payload_json).text)).toEqual(['']);
      f.setNow('2026-09-10T00:01:00.000Z');
      const prepared = life.prepareSleep(identity);
      let arrived = false, queueCancelled = false, committed = false, expired = false, tried = false;
      let queued = '';
      const race: { name: string; run: () => void }[] = [
        { name: 'queue-arrival', run: () => {
          queued = f.core.enqueue(bot, 'Independent arrival', null, null, null); arrived = true;
          expect(f.store.run(run).status).toBe('cancelled');
        } },
        { name: 'commit', run: () => {
          tried = true;
          if (expired) { denied(() => life.commitSleep(identity, prepared.stop_token, prepared.queue_sequence, { seed }), 'STALE_EPOCH'); count('lease-invalidates'); }
          else if (arrived) { denied(() => life.commitSleep(identity, prepared.stop_token, prepared.queue_sequence, { seed }), 'SLEEP_DENIED'); count('queue-invalidates'); }
          else { life.commitSleep(identity, prepared.stop_token, prepared.queue_sequence, { seed }); committed = true; count('drain-commit'); }
        } },
        { name: 'reconstruct', run: reconstruct },
      ];
      if (seed % 4 === 1) race.push({ name: 'drain-lease-loss', run: () => {
        f.setNow('2026-09-10T00:01:30.000Z'); life.watchdog(); expired = true;
      } });
      while (race.length || (arrived && !queueCancelled)) {
        if (arrived && !queueCancelled && !race.some(a => a.name === 'queue-cancel')) race.push({ name: 'queue-cancel', run: () => {
          expect(f.accept({ schema_version: 1, type: 'run.cancel', payload: { run_id: queued, reason: 'Only queued work' } }).status).toBe('applied');
          queueCancelled = true;
        } });
        const action = race.splice(Math.floor(rand() * race.length), 1)[0]; trace.push(action.name); action.run();
        expect(f.db.all('SELECT id,status,receipt_json FROM effects ORDER BY action_key')).toEqual(
          model.map(e => ({ id: e.input.id, status: e.status, receipt_json: JSON.stringify(e.receipt) })));
        expect(f.db.all('SELECT * FROM resource_locks')).toEqual([]);
      }
      expect(tried).toBe(true); expect(f.store.run(queued).status).toBe('cancelled');
      expect(life.get().queue_sequence).toBe(prepared.queue_sequence + 1);
      expect(f.db.all('SELECT value_json FROM runtime_metadata WHERE key=?', 'checkpoint')).toEqual(committed ? [{ value_json: JSON.stringify({ seed }) }] : []);
      if (committed) {
        life.observeStopped({ phase: 'stopped', executionStopped: true, persistentState: 'retained', observedAt: Date.parse(f.core.now()) });
        expect(life.get().phase).toBe('STOPPED');
      }
    } catch (error) {
      throw new Error(`seed=${seed}; trace=${trace.join(' -> ')}`, { cause: error });
    } finally { f.close(); }
  });
});
