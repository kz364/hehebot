import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TestDatabase, bot, otherBot, routine } from './helpers';
import { PersonalControl } from '../src/worker/control-object';
import { Store } from '../src/core/store';
import { BudgetLedger } from '../src/core/budget';

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
  await initialize();
});
async function initialize(executionEnabled=false) {
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
    EXECUTION_ENABLED: String(executionEnabled), NATIVE_VERIFIED: String(executionEnabled), PROVIDER_CONFIG: '{}',
    ACTION_POLICY_IDS: '[]', TOOL_POLICY_IDS: '[]', TRIGGER_CONFIG: '{}',
  } as Env);
  await initialized;
}
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
  expect(setAlarm).toHaveBeenLastCalledWith(Date.parse('2026-10-10T00:00:00.000Z')); // Remaining audit retention, not runtime polling.
  expect(deleteAlarm).not.toHaveBeenCalled();
  await control.alarm();
  expect(db.all("SELECT actor_id FROM events WHERE type='memory.deleted'")).toEqual([{ actor_id: 'system:expiry' }]);
});

it('timeline retention alarms run while stopped and expose gaps without creating executor work', async () => {
  const store = new Store(db);
  const audit = store.event(randomUUID(), bot, 'persona.updated', 'owner', null, { id: bot }, new Date().toISOString());
  store.event(randomUUID(), bot, 'message.user', 'owner', null, { text: 'Retained input' }, new Date().toISOString());
  await control.getState('owner');
  expect(setAlarm).toHaveBeenLastCalledWith(Date.parse('2026-10-10T00:00:00.000Z'));
  vi.setSystemTime(new Date('2026-10-10T00:00:00.000Z')); await control.alarm();
  expect(await control.getState('owner', audit - 1)).toMatchObject({ ok: false, error: { code: 'HISTORY_GAP' } });
  expect(await control.getTimeline('owner', bot)).toMatchObject({ ok: true, value: { history_gap: true, pruned_through: audit } });
  expect(setAlarm).toHaveBeenLastCalledWith(Date.parse('2026-12-09T00:00:00.000Z'));
  vi.setSystemTime(new Date('2026-12-09T00:00:00.000Z')); await control.alarm();
  expect(db.all('SELECT * FROM events')).toEqual([]);
  expect(deleteAlarm).toHaveBeenCalled();
  expect(db.all('SELECT * FROM runs')).toEqual([]); expect(db.all('SELECT * FROM controller_operations')).toEqual([]);
  expect(db.all('SELECT phase,desired_state FROM lifecycle')).toEqual([{ phase: 'STOPPED', desired_state: 'STOP' }]);
});

it('expired command text leaves linked webhook replay and its original receipt unchanged', async () => {
  const accepted = await control.accept('owner', randomUUID(), 'command-hash-19', message());
  expect(accepted.ok).toBe(true); if (!accepted.ok) throw new Error('fixture acceptance failed');
  const source = randomUUID(), store = new Store(db);
  store.put(source, 'trigger', { routine_id: randomUUID(), event_types: ['mail'] }, 0, 'operator', new Date().toISOString());
  db.exec('INSERT INTO webhook_receipts(source_id,event_id,body_hash,command_id,received_at) VALUES(?,?,?,?,?)', source, 'delivery-43', 'hash-71', accepted.value.id, new Date().toISOString());
  const runs = db.all<Record<string,unknown>>('SELECT * FROM runs'), receipts = db.all('SELECT * FROM webhook_receipts');
  vi.setSystemTime(new Date('2026-12-09T00:00:00.000Z')); await control.alarm();
  expect(db.all('SELECT payload_json FROM commands WHERE id=?', accepted.value.id)).toEqual([{ payload_json: '{}' }]);
  expect(await control.getReceipt('owner', accepted.value.id)).toEqual(accepted);
  expect(await control.trigger(source, 'delivery-43', 'hash-71', 'mail', {})).toEqual(accepted);
  expect(await control.trigger(source, 'delivery-43', 'changed-hash', 'mail', {})).toMatchObject({ ok: false, error: { code: 'IDEMPOTENCY_CONFLICT' } });
  expect(db.all('SELECT * FROM runs')).toEqual(runs.map(run=>({...run,context_json:'{}',status:'failed',error_code:'MESSAGE_EXPIRED',updated_at:'2026-12-09T00:00:00.000Z'}))); expect(db.all('SELECT * FROM webhook_receipts')).toEqual(receipts);
  expect(db.all('SELECT * FROM controller_operations')).toEqual([]);
  expect(setAlarm).toHaveBeenLastCalledWith(Date.parse('2027-01-08T00:00:00.000Z')); // Content-free expiry notice audit.
});

it('timeline reads hide overdue backlog immediately and keep the history floor scoped to its conversation', async () => {
  const store = new Store(db);
  for (let i = 0; i < 201; i++) store.event(randomUUID(), bot, 'persona.updated', 'owner', null, { text: `Expired ${i}` }, new Date().toISOString());
  const expiredThrough = store.sequence();
  store.event(randomUUID(), otherBot, 'message.user', 'owner', null, { text: 'Other retained 43' }, new Date().toISOString());
  vi.setSystemTime(new Date('2026-10-10T00:00:00.000Z'));
  store.event(randomUUID(), bot, 'message.user', 'owner', null, { text: 'Current retained 71' }, new Date().toISOString());
  const result = await control.getTimeline('owner', bot);
  expect(result).toMatchObject({ ok: true, value: { history_gap: true, pruned_through: expiredThrough } });
  if (!result.ok) throw new Error('fixture read failed');
  expect(result.value.events.map(e => e.payload.text)).toEqual(['Current retained 71']);
  expect(db.all("SELECT id FROM events WHERE type='persona.updated'")).toHaveLength(101);
  const other = await control.getTimeline('owner', otherBot);
  expect(other).toMatchObject({ ok: true, value: { history_gap: false, pruned_through: 0 } });
  expect(db.all('SELECT * FROM runs')).toEqual([]); expect(db.all('SELECT * FROM controller_operations')).toEqual([]);
});

it('keeps host infrastructure reporting behind runtime gates and strict schemas', async () => {
  const payload={identity:{epoch:1,boot_id:randomUUID()},run_id:randomUUID(),attempt:1,report:{period:'2026-09',projected_cents:499,observed_at:new Date().toISOString(),source_ref:'synthetic:19'}};
  expect(await control.runtime({type:'budget-report',payload})).toMatchObject({ok:false,error:{code:'CAPABILITY_UNAVAILABLE'}});
  for(const report of [{...payload.report,projected_cents:499.5},{...payload.report,source_ref:'https://private.invalid'},{...payload.report,grant:true}]){
    expect(await control.runtime({type:'budget-report',payload:{...payload,report}})).toMatchObject({ok:false,error:{code:'INVALID_INPUT'}});
  }
  expect(db.all("SELECT * FROM runtime_metadata WHERE key='budget-report'")).toEqual([]);
});

it('authenticates report custody and transactionally releases or parks only optional unstarted work', async () => {
  await initialize(true);
  const r=routine();
  expect(await control.accept('owner',randomUUID(),'routine',{schema_version:1,type:'routine.put',payload:r})).toMatchObject({ok:true,value:{status:'applied'}});
  expect(await control.accept('owner',randomUUID(),'budget',{schema_version:1,type:'budget.set',payload:{expected_revision:0,enabled:true,monthly_cap_cents:500,optional_routine_ids:[r.id]}})).toMatchObject({ok:true,value:{status:'applied'}});
  vi.setSystemTime(new Date('2026-09-10T00:15:00.000Z'));await control.getState('owner');
  const scheduled=db.all<{id:string}>("SELECT id FROM runs WHERE occurrence_id IS NOT NULL")[0].id;
  expect(db.all('SELECT status,error_code FROM runs WHERE id=?',scheduled)).toEqual([{status:'waiting',error_code:'BUDGET_UNKNOWN'}]);
  await control.accept('owner',randomUUID(),'owner-message',message());
  const root=db.all<{id:string}>('SELECT id FROM runs WHERE occurrence_id IS NULL')[0].id,identity={epoch:1,boot_id:randomUUID()};
  db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=1,lease_until='2026-09-10T00:17:00.000Z'");
  expect(await control.runtime({type:'boot',payload:{boot_id:identity.boot_id}})).toMatchObject({ok:true});
  expect(await control.runtime({type:'ready',payload:{identity}})).toMatchObject({ok:true});
  expect(await control.runtime({type:'claim',payload:{identity}})).toMatchObject({ok:true,value:{run:{id:root}}});
  const payload={identity,run_id:root,attempt:1,report:{period:'2026-09',projected_cents:499,observed_at:new Date().toISOString(),source_ref:'synthetic:19'}};
  expect(await control.runtime({type:'budget-report',payload:{...payload,identity:{...identity,epoch:2}}})).toMatchObject({ok:false,error:{code:'STALE_EPOCH'}});
  expect(await control.runtime({type:'budget-report',payload})).toMatchObject({ok:true});
  expect(db.all('SELECT status,error_code FROM runs WHERE id=?',scheduled)).toEqual([{status:'queued',error_code:null}]);
  const admitted=db.all('SELECT * FROM runs WHERE id=?',root);
  vi.setSystemTime(new Date('2026-09-10T00:15:01.000Z'));
  expect(await control.runtime({type:'budget-report',payload:{...payload,report:{...payload.report,projected_cents:501,observed_at:new Date().toISOString()}}})).toMatchObject({ok:true});
  expect(db.all('SELECT status,error_code FROM runs WHERE id=?',scheduled)).toEqual([{status:'waiting',error_code:'BUDGET_BLOCKED'}]);
  expect(db.all('SELECT * FROM runs WHERE id=?',root)).toEqual(admitted);
});

it('schedules budget freshness maintenance even with execution disabled',async()=>{
  const r=routine({enabled:false});await control.accept('owner',randomUUID(),'routine',{schema_version:1,type:'routine.put',payload:r});
  await control.accept('owner',randomUUID(),'budget',{schema_version:1,type:'budget.set',payload:{expected_revision:0,enabled:true,monthly_cap_cents:500,optional_routine_ids:[r.id]}});
  new BudgetLedger(new Store(db),()=>new Date().toISOString(),randomUUID).report({period:'2026-09',projected_cents:499,observed_at:new Date().toISOString(),source_ref:'synthetic:19'});
  await control.getState('owner');expect(setAlarm).toHaveBeenLastCalledWith(Date.parse('2026-09-11T00:00:00.000Z'));
  vi.setSystemTime(new Date('2026-09-11T00:00:00.000Z'));await control.alarm();
  expect(await control.getState('owner')).toMatchObject({ok:true,value:{budget:{freshness:'stale',status:'BUDGET_UNKNOWN'},summary:{execution_enabled:false}}});
  expect(db.all('SELECT * FROM controller_operations')).toEqual([]);expect(db.all('SELECT * FROM attempts')).toEqual([]);
});

it('alarms expire only settled steering audit with execution disabled and no provider work',async()=>{
  const run=randomUUID(),command=randomUUID();
  db.exec("INSERT INTO runs(id,persona_id,context_json,status,current_attempt,created_at,updated_at) VALUES(?,?,'{}','completed',1,?,?)",run,bot,new Date().toISOString(),new Date().toISOString());
  db.exec("INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,status,deadline_at,settled_at) VALUES(?,1,?,1,'boot','completed',?,?)",run,randomUUID(),new Date().toISOString(),new Date().toISOString());
  const row={run_id:run,attempt:1,command_id:command,status:'accepted',created_at:new Date().toISOString()};
  db.exec('INSERT INTO runtime_metadata VALUES(?,?)',`steer:${run}:1:${command}`,JSON.stringify(row));
  db.exec('INSERT INTO runtime_metadata VALUES(?,?)',`steer:${run}:1:pending`,JSON.stringify({...row,status:'pending'}));
  await control.getState('owner');expect(setAlarm).toHaveBeenLastCalledWith(Date.parse('2026-10-10T00:00:00.000Z'));
  vi.setSystemTime(new Date('2026-10-10T00:00:00.000Z'));await control.alarm();
  expect(db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'steer:*'")).toEqual([{key:`steer:${run}:1:pending`}]);
  expect(db.all('SELECT * FROM controller_operations')).toEqual([]);expect(deleteAlarm).toHaveBeenCalled();
});

it('serves validated recovery pages through owner RPC without starting runtime work',async()=>{
  const ids=[randomUUID(),randomUUID()].sort(),now=new Date().toISOString();
  for(const id of ids)db.exec("INSERT INTO runs(id,persona_id,context_json,status,current_attempt,created_at,updated_at) VALUES(?,?,'{}','recovery_required',1,?,?)",id,bot,now,now);
  const before=db.all('SELECT * FROM runs ORDER BY id');
  const first=await control.getRecovery('owner',bot,undefined,1);
  expect(first).toMatchObject({ok:true,value:{runs:[{id:ids[0]}],recovery:[{run_id:ids[0],can_recover:false}],next_cursor:ids[0]}});
  expect(await control.getRecovery('owner',bot,ids[0],1)).toMatchObject({ok:true,value:{runs:[{id:ids[1]}],next_cursor:null}});
  expect(await control.getRecovery('owner',otherBot)).toMatchObject({ok:true,value:{runs:[],recovery:[],next_cursor:null}});
  expect(await control.getRecovery('owner',bot,'invalid')).toMatchObject({ok:false,error:{code:'INVALID_INPUT'}});
  expect(await control.getRecovery('owner',bot,undefined,101)).toMatchObject({ok:false,error:{code:'INVALID_INPUT'}});
  expect(db.all('SELECT * FROM runs ORDER BY id')).toEqual(before);
  expect(db.all('SELECT * FROM controller_operations')).toEqual([]);expect(db.all('SELECT * FROM attempts')).toEqual([]);
});
