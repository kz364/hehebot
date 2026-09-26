import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { ControlCore } from '../src/core/control';
import { Store } from '../src/core/store';
import { LifecycleCore } from '../src/core/lifecycle';
import { NativeTaskLedger } from '../src/core/native-tasks';
import { ResourceLedger } from '../src/core/resources';
import { FakeProvider, type RuntimeRef } from '../src/providers';
import { fixture, bot, otherBot, routine } from './helpers';

const ref: RuntimeRef = { provider: 'fake', id: 'seeded-control' };
const message = (text: string) => ({ schema_version: 1 as const, type: 'message.send' as const, payload: { conversation_id: bot, text } });
function random(seed: number) {
  // Diffuse nearby seed values before choosing the first interleaving step.
  for (let i = 0; i < 10; i++) seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x100000000; };
}
function boot(f: ReturnType<typeof fixture>) {
  const life = new LifecycleCore(f.store, f.core);
  f.db.exec("UPDATE lifecycle SET provider_ref_json=?,phase='BOOTING',epoch=1,lease_until=?", JSON.stringify(ref), new Date(Date.parse(f.core.now()) + 120000).toISOString());
  const identity = life.registerBoot(randomUUID()); life.ready(identity);
  return { life, identity };
}

// These are controller/SQLite interleavings, not native process-crash proofs.
// Each seed schedules independent ingress, duplicate alarms, reconstruction and
// ordered stop phases. Expectations come from the four logical input jobs.
describe('100 reproducible drain/queue interleavings', () => {
  const outcomes: boolean[] = [];
  afterAll(() => {
    if (outcomes.length === 100) {
      const committed = outcomes.filter(Boolean).length;
      expect(committed).toBeGreaterThan(0); expect(committed).toBeLessThan(100);
      console.info(`Seeded drain coverage: ${100 - committed} invalidated stops, ${committed} committed stop/wake sequences.`);
    }
  });
  it.each(Array.from({ length: 100 }, (_, i) => 0xc1a000 + i))('seed %i preserves every job across drain, duplicate delivery and reconstruction', async seed => {
    const rand = random(seed), f = fixture(true), provider = new FakeProvider();
    try {
      const r = routine(); f.accept({ schema_version: 1, type: 'routine.put', payload: r });
      f.setNow('2026-09-10T00:14:00.000Z');
      let { life, identity } = boot(f);
      provider.setPhase(ref, 'running');
      f.setNow('2026-09-10T00:15:00.000Z');
      const prepared = life.prepareSleep(identity);
      const commands = [message('Read invoice 17'), message('Inspect appointment 43'), message('Summarize itinerary 91')];
      const keys = commands.map(() => randomUUID());
      const ids = new Map<number, string>();
      let committed = false;
      const phases = [
        () => {
          if (ids.size || f.db.all('SELECT id FROM occurrences').length) {
            expect(() => life.commitSleep(identity, prepared.stop_token, prepared.queue_sequence, { seed })).toThrowError(expect.objectContaining({ code: 'SLEEP_DENIED' }));
          } else { life.commitSleep(identity, prepared.stop_token, prepared.queue_sequence, { seed }); committed = true; }
        },
        () => life.drive(provider),
        () => { if (committed) provider.setPhase(ref, 'stopped'); },
        () => life.drive(provider),
      ];
      const ingress = [0, 1, 2, 0, 2].map(index => () => {
        const receipt = f.accept(commands[index], keys[index]);
        expect(receipt.status).toBe('applied');
        if (ids.has(index)) expect(receipt.resource_id).toBe(ids.get(index));
        ids.set(index, receipt.resource_id!);
      });
      const actions: (() => unknown)[] = [...ingress, () => f.core.tick(), () => f.core.tick(),
        ...Array.from({ length: 2 }, () => () => {
          const store = new Store(f.db), core = new ControlCore(store, f.core.options);
          life = new LifecycleCore(store, core);
        })];
      while (actions.length || phases.length) {
        const index = Math.floor(rand() * (actions.length + (phases.length ? 1 : 0)));
        await (index === actions.length ? phases.shift()! : actions.splice(index, 1)[0])();
      }
      if (committed) {
        await life.drive(provider);
        expect(provider.calls.map(c => c.action)).toEqual(['stop', 'wake']);
        expect(life.get().epoch).toBe(2);
        identity = life.registerBoot(randomUUID()); life.ready(identity);
      } else {
        expect(provider.calls).toHaveLength(0);
        expect(life.get()).toMatchObject({ phase: 'READY', epoch: 1, stop_token: null });
      }
      expect(f.db.all('SELECT nominal_due_at FROM occurrences')).toEqual([{ nominal_due_at: '2026-09-10T00:15:00.000Z' }]);
      expect(f.db.all('SELECT id FROM runs')).toHaveLength(4);
      expect(life.get().queue_sequence).toBe(4);
      const expected = new Set([...ids.values(), f.db.all<{ id: string }>('SELECT id FROM runs WHERE routine_id=?', r.id)[0].id]);
      const completed = new Set<string>();
      for (let i = 0; i < 4; i++) {
        const claim = life.claim(identity)!;
        expect(expected.has(claim.run.id)).toBe(true); expect(completed.has(claim.run.id)).toBe(false);
        life.complete(identity, claim.run.id, 1, { status: 'completed', text: `Result ${claim.run.id}` });
        life.complete(identity, claim.run.id, 1, { status: 'completed', text: `Result ${claim.run.id}` });
        expect(() => life.complete(identity, claim.run.id, 1, { status: 'completed', text: 'Duplicate must not replace result' }))
          .toThrowError(expect.objectContaining({ code: 'RESULT_CONFLICT' }));
        completed.add(claim.run.id);
      }
      expect(completed).toEqual(expected); expect(life.claim(identity)).toBeNull();
      expect(f.db.all('SELECT id FROM outbox')).toHaveLength(4);
      expect(f.db.all("SELECT id FROM events WHERE type='run.result'")).toHaveLength(4);
      expect(f.db.all<{ payload_json: string }>('SELECT payload_json FROM outbox').map(x => JSON.parse(x.payload_json).text).sort()).toEqual([...expected].map(id => `Result ${id}`).sort());
      outcomes.push(committed);
    } finally { f.close(); }
  });
});

it('1000 passive publications persist recipient delivery without provider wake while execution is enabled', async () => {
  const f = fixture(true), provider = new FakeProvider(), roomId = randomUUID();
  try {
    f.db.exec('UPDATE lifecycle SET provider_ref_json=?', JSON.stringify(ref));
    expect(f.accept({ schema_version: 1, type: 'room.put', payload: { id: roomId, expected_revision: 0,
      name: 'Passive volume fixture', member_ids: [bot, otherBot], default_responder_id: bot } }).status).toBe('applied');
    const before = f.db.all('SELECT * FROM lifecycle');
    for (let i = 0; i < 1000; i++) {
      const command = { schema_version: 1 as const, type: 'room.publish' as const, payload: {
        room_id: roomId, kind: 'context_update' as const, recipient_ids: [i % 3 === 0 ? otherBot : bot],
        text: `Passive update ${i}`, references: [], cause_id: randomUUID(),
      } };
      const key = randomUUID(), receipt = f.accept(command, key);
      expect(receipt.status).toBe('applied');
      if (i % 100 === 0) {
        expect(f.accept(command, key)).toEqual(receipt);
        expect(f.accept(command).resource_id).toBe(receipt.resource_id);
        // Reconstruct the controller between batches, then exercise its actual
        // provider driver, rather than asserting an unused spy stayed at zero.
        const store = new Store(f.db), core = new ControlCore(store, f.core.options);
        core.tick(); await new LifecycleCore(store, core).drive(provider);
      }
    }
    expect(f.db.all('SELECT * FROM lifecycle')).toEqual(before); expect(provider.calls).toEqual([]);
    for (const table of ['runs', 'attempts', 'operations', 'effects', 'outbox']) expect(f.db.all(`SELECT * FROM ${table}`)).toEqual([]);
    expect(f.db.all("SELECT id FROM events WHERE type='room.context_update'")).toHaveLength(1000);
    expect(f.db.all('SELECT event_id FROM room_publications')).toHaveLength(1000);
    const cursors = f.db.all<{ consumer_id: string; delivered_sequence: number; consumed_sequence: number }>('SELECT * FROM consumer_cursors');
    expect(cursors).toHaveLength(2); expect(cursors.every(cursor => cursor.consumed_sequence === 0)).toBe(true);
    for (const recipient of [bot, otherBot]) {
      const expected = Array.from({ length: 1000 }, (_, i) => i).filter(i => (i % 3 === 0 ? otherBot : bot) === recipient);
      expect(f.core.context(recipient, 'Read metadata', null, roomId).context_events.map(event => event.payload.text))
        .toEqual(expected.slice(0, 100).map(i => `Passive update ${i}`));
      const last = f.db.all<{ sequence: number }>("SELECT sequence FROM events WHERE type='room.context_update' AND json_extract(payload_json,'$.text')=?", `Passive update ${expected.at(-1)}`)[0].sequence;
      expect(cursors.find(cursor => cursor.consumer_id === recipient)?.delivered_sequence).toBe(last);
    }
  } finally { f.close(); }
});

it('rejects old-epoch completion after confirmed termination and retry admission without changing the new attempt', async () => {
  const f = fixture(true);
  try {
    const { life, identity } = boot(f);
    const id = f.accept(message('Read synthetic record 73')).resource_id!;
    life.claim(identity); life.submitted(identity, id, 1, 'old-native');
    f.setNow('2026-09-10T00:01:31.000Z'); life.watchdog();
    life.observeStopped({ phase: 'stopped', executionStopped: true, persistentState: 'retained', observedAt: Date.now() });
    f.setNow('2026-09-10T00:01:41.000Z'); life.retryDue();
    const provider = new FakeProvider(); await life.drive(provider);
    const current = life.registerBoot(randomUUID()); life.ready(current);
    expect(life.claim(current)?.run.current_attempt).toBe(2);
    const before = f.store.run(id);
    for (const caller of [identity, current]) {
      expect(() => life.complete(caller, id, 1, { status: 'completed', text: 'Stale private output' })).toThrowError(expect.objectContaining({ code: 'STALE_EPOCH' }));
      expect(f.store.run(id)).toEqual(before);
      expect(f.db.all('SELECT * FROM outbox')).toHaveLength(0);
    }
    life.complete(current, id, 2, { status: 'completed', text: 'Fresh output' });
    expect(f.db.all<{ payload_json: string }>('SELECT payload_json FROM outbox').map(x => JSON.parse(x.payload_json).text)).toEqual(['Fresh output']);
  } finally { f.close(); }
});

it.each([7, 29, 113, 2027])('seed %i preserves sibling operations and locks through exact cancellation and reconstruction', seed => {
  const rand = random(seed), f = fixture(true);
  try {
    let { life, identity } = boot(f);
    const p = f.accept(message('Coordinate two unrelated records')).resource_id!; life.claim(identity);
    const tasks = new NativeTaskLedger(f.store, f.core, life);
    const children = ['invoice-17', 'calendar-93'].map(title => tasks.register(identity, {
      parent_run_id: p, parent_attempt: 1, persona_id: bot, title,
      native_run_ref: `native-${title}`, native_session_key: `agent:test:${title}`,
    }));
    const target = Math.floor(rand() * 2), sibling = 1 - target;
    let resources = new ResourceLedger(f.store, () => f.core.now());
    children.forEach((child, i) => resources.acquire(child.id, 1, [`record:${i}`]));
    const ops = children.map((child, i) => ({ id: randomUUID(), run_id: child.id, attempt: 1, kind: 'tool' as const,
      status: 'active' as const, started_at: f.core.now(), last_progress_at: f.core.now(), deadline_at: `2026-09-10T00:0${i + 4}:00.000Z` }));
    life.heartbeat(identity, ops);
    const siblingBefore = f.store.run(children[sibling].id), parentBefore = f.store.run(p);
    const key = randomUUID(), command = { schema_version: 1 as const, type: 'run.cancel' as const, payload: { run_id: children[target].id, reason: 'Only selected record' } };
    const accepted = f.accept(command, key); expect(f.accept(command, key)).toEqual(accepted);
    f.setNow('2026-09-10T00:00:31.000Z'); life.watchdog();
    const store = new Store(f.db), core = new ControlCore(store, f.core.options);
    life = new LifecycleCore(store, core); resources = new ResourceLedger(store, () => core.now());
    expect(f.store.run(children[target].id).status).toBe('interrupted');
    expect(life.heartbeat(identity, []).cancellations).toEqual([children[target].id]);
    expect(() => resources.release(children[target].id, 1, [`record:${target}`, `record:${sibling}`])).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(f.db.all('SELECT resource_id FROM resource_locks')).toHaveLength(2); // Earlier deletion rolled back.
    expect(() => life.complete(identity, children[target].id, 1, { status: 'cancelled', text: '' })).toThrowError(expect.objectContaining({ code: 'CANCEL_UNCONFIRMED' }));
    life.heartbeat(identity, [{ ...ops[target], status: 'settled' }]);
    resources.release(children[target].id, 1, [`record:${target}`]);
    life.complete(identity, children[target].id, 1, { status: 'cancelled', text: 'Must be suppressed' });
    expect(f.store.run(children[sibling].id)).toEqual(siblingBefore); expect(f.store.run(p)).toEqual(parentBefore);
    expect(f.db.all('SELECT resource_id,run_id FROM resource_locks')).toEqual([{ resource_id: `record:${sibling}`, run_id: children[sibling].id }]);
    expect(f.db.all('SELECT status FROM operations WHERE id=?', ops[sibling].id)).toEqual([{ status: 'active' }]);
    expect(f.db.all('SELECT * FROM retry_queue')).toHaveLength(0);
    expect(JSON.stringify(f.db.all('SELECT * FROM outbox'))).not.toContain('Must be suppressed');
    expect(() => life.prepareSleep(identity)).toThrowError(expect.objectContaining({ code: 'SLEEP_DENIED' }));
  } finally { f.close(); }
});

it('read-only retries wait exactly 10 then 60 seconds and never admit a fourth attempt', () => {
  const f = fixture(true);
  try {
    const { life, identity } = boot(f);
    const id = f.accept(message('Read synthetic invoice 71')).resource_id!;
    for (const [attempt, beforeDue, due] of [
      [1, '2026-09-10T00:00:09.999Z', '2026-09-10T00:00:10.000Z'],
      [2, '2026-09-10T00:01:09.999Z', '2026-09-10T00:01:10.000Z'],
    ] as const) {
      expect(life.claim(identity)?.run.current_attempt).toBe(attempt);
      life.submitted(identity, id, attempt, `native-${attempt}`);
      life.complete(identity, id, attempt, { status: 'failed', text: '', error_code: 'TEMPORARY_UNAVAILABLE' });
      expect(f.db.all('SELECT due_at FROM retry_queue')).toEqual([{ due_at: due }]);
      f.setNow(beforeDue); life.retryDue(); expect(f.store.run(id).status).toBe('waiting');
      f.setNow(due); life.retryDue(); life.heartbeat(identity, []);
      expect(f.store.run(id).status).toBe('queued');
    }
    expect(life.claim(identity)?.run.current_attempt).toBe(3);
    life.complete(identity, id, 3, { status: 'failed', text: '', error_code: 'TEMPORARY_UNAVAILABLE' });
    f.setNow('2026-09-10T00:02:11.000Z'); life.retryDue();
    expect(f.store.run(id).status).toBe('failed'); expect(f.db.all('SELECT * FROM retry_queue')).toHaveLength(0);
    expect(f.db.all('SELECT attempt FROM attempts ORDER BY attempt')).toEqual([{ attempt: 1 }, { attempt: 2 }, { attempt: 3 }]);
    expect(f.accept({ schema_version: 1, type: 'run.retry', payload: { run_id: id, expected_attempt: 3 } })).toMatchObject({ status: 'rejected', error: { code: 'DEADLINE_EXCEEDED' } });
  } finally { f.close(); }
});
