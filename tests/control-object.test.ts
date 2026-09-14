import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TestDatabase, bot, routine } from './helpers';
import { PersonalControl } from '../src/worker/control-object';
import { Store } from '../src/core/store';

// Exercise the real RPC methods and SQL; only the Cloudflare host is replaced.
vi.mock('cloudflare:workers', () => ({ DurableObject: class {
  constructor(public ctx: unknown, public env: unknown) {}
} }));
vi.mock('../DB/schema.sql', () => ({ default: '' }));

let db: TestDatabase, control: PersonalControl;
const setAlarm = vi.fn(async (_time: number) => {});
const deleteAlarm = vi.fn(async () => {});
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-10T00:00:00.000Z'));
  setAlarm.mockClear(); deleteAlarm.mockClear();
  db = new TestDatabase();
  let initialized: Promise<unknown> = Promise.resolve();
  const ctx = {
    storage: {
      sql: { exec: (sql: string, ...values: (string | number | null)[]) => {
        const rows = db.all(sql, ...values); return { toArray: () => rows };
      } },
      transactionSync: <T>(fn: () => T) => db.transaction(fn), setAlarm, deleteAlarm,
    },
    blockConcurrencyWhile: (fn: () => Promise<unknown>) => { initialized = fn(); },
  };
  control = new PersonalControl(ctx as unknown as DurableObjectState, {
    EXECUTION_ENABLED: 'false', NATIVE_VERIFIED: 'false', PROVIDER_CONFIG: '{}',
    ACTION_POLICY_IDS: '[]', TOOL_POLICY_IDS: '[]', TRIGGER_CONFIG: '{}',
  } as Env);
  await initialized;
});
afterEach(() => { db.close(); vi.useRealTimers(); });

async function overdue() {
  const r = routine();
  const result = await control.accept('owner', randomUUID(), 'synthetic', { schema_version: 1, type: 'routine.put', payload: r });
  expect(result).toMatchObject({ ok: true, value: { status: 'applied' } });
  vi.setSystemTime(new Date('2026-09-10T00:31:00.000Z'));
  setAlarm.mockClear();
  return { routine: r, receiptId: result.ok ? result.value.id : '' };
}
const message = () => ({ schema_version: 1, type: 'message.send', payload: { conversation_id: bot, text: 'Independent work' } });

it.each(['message', 'receipt', 'timeline', 'state', 'trigger'] as const)('%s ingress recovers a missed alarm without a state poll or inference', async endpoint => {
  const { routine: r, receiptId } = await overdue();
  if (endpoint === 'message') await control.accept('owner', randomUUID(), 'synthetic', message());
  if (endpoint === 'receipt') await control.getReceipt('owner', receiptId);
  if (endpoint === 'timeline') await control.getTimeline('owner', bot);
  if (endpoint === 'state') await control.getState('owner');
  // A duplicate trigger must reconcile too, despite its early receipt return.
  if (endpoint === 'trigger') {
    const source = randomUUID();
    new Store(db).put(source, 'trigger', { routine_id: r.id, event_types: ['mail'] }, 0, 'operator', new Date().toISOString());
    db.exec('INSERT INTO webhook_receipts(source_id,event_id,body_hash,command_id,received_at) VALUES(?,?,?,?,?)', source, 'event', 'synthetic', receiptId, new Date().toISOString());
    expect(await control.trigger(source, 'event', 'synthetic', 'mail', {})).toMatchObject({ ok: true });
  }
  expect(db.all('SELECT nominal_due_at FROM occurrences WHERE routine_id=?', r.id)).toEqual([{ nominal_due_at: '2026-09-10T00:30:00.000Z' }]);
  expect(db.all('SELECT next_due_at FROM schedule_state WHERE routine_id=?', r.id)).toEqual([{ next_due_at: '2026-09-10T00:45:00.000Z' }]);
  expect(setAlarm).toHaveBeenLastCalledWith(Date.parse('2026-09-10T00:45:00.000Z'));
  expect(db.all('SELECT status,error_code FROM runs WHERE routine_id=?', r.id)).toEqual([{ status: 'waiting', error_code: 'CAPABILITY_UNAVAILABLE' }]);
  expect(db.all('SELECT phase,desired_state FROM lifecycle')).toEqual([{ phase: 'STOPPED', desired_state: 'STOP' }]);
});

it('concurrent chat and receipt requests reconcile one occurrence and deduplicate the chat', async () => {
  const { receiptId } = await overdue();
  const key = randomUUID();
  const results = await Promise.all([
    control.accept('owner', key, 'same', message()), control.getReceipt('owner', receiptId),
    control.accept('owner', key, 'same', message()), control.getTimeline('owner', bot),
  ]);
  expect(results.every(r => r.ok)).toBe(true);
  expect(db.all('SELECT id FROM occurrences')).toHaveLength(1);
  expect(db.all('SELECT id FROM runs')).toHaveLength(2);
  expect(results[0]).toEqual(results[2]);
});

it('rearms overdue work even when the requested receipt does not exist', async () => {
  await overdue();
  expect(await control.getReceipt('owner', randomUUID())).toMatchObject({ ok: false });
  expect(db.all('SELECT id FROM occurrences')).toHaveLength(1);
  expect(setAlarm).toHaveBeenLastCalledWith(Date.parse('2026-09-10T00:45:00.000Z'));
});

it('idle reads do not manufacture work or a perpetual polling alarm', async () => {
  expect(await control.getTimeline('owner', bot)).toMatchObject({ ok: true });
  expect(db.all('SELECT id FROM runs')).toHaveLength(0);
  expect(setAlarm).not.toHaveBeenCalled();
  expect(deleteAlarm).toHaveBeenCalledOnce();
});

it.each(['alarm', 'missed-alarm-read'])('memory expiry through %s purges while runtime sleeps without creating work', async mode => {
  const id = randomUUID(), source = randomUUID(), store = new Store(db);
  store.event(source, bot, 'message.user', 'owner', null, { text: 'Synthetic expiry source' }, new Date().toISOString());
  expect(await control.accept('owner', randomUUID(), 'expiry', { schema_version: 1, type: 'memory.put', payload: {
    id, expected_revision: 0, scope: { kind: 'persona', id: bot }, text: 'Expiry canary', source_event_id: source,
    expires_at: '2026-09-10T08:01:00+08:00', sensitivity: 'ordinary',
  } })).toMatchObject({ ok: true, value: { status: 'applied' } });
  expect(setAlarm).toHaveBeenLastCalledWith(Date.parse('2026-09-10T00:01:00.000Z'));
  setAlarm.mockClear(); deleteAlarm.mockClear();
  vi.setSystemTime(new Date('2026-09-10T00:01:00.000Z'));
  if (mode === 'alarm') await control.alarm();
  else expect(await control.getState('owner')).toMatchObject({ ok: true });
  expect(db.all('SELECT body_json,deleted_at FROM objects WHERE id=?', id)).toEqual([{ body_json: '{}', deleted_at: '2026-09-10T00:01:00.000Z' }]);
  expect(db.all('SELECT id FROM runs')).toEqual([]);
  expect(db.all('SELECT id FROM controller_operations')).toEqual([]);
  expect(db.all('SELECT phase,desired_state FROM lifecycle')).toEqual([{ phase: 'STOPPED', desired_state: 'STOP' }]);
  expect(setAlarm).not.toHaveBeenCalled(); expect(deleteAlarm).toHaveBeenCalledOnce();
  await control.alarm();
  expect(db.all("SELECT actor_id FROM events WHERE type='memory.deleted'")).toEqual([{ actor_id: 'system:expiry' }]);
});
