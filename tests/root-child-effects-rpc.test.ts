import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TestDatabase, bot, routine } from './helpers';
import { PersonalControl } from '../src/worker/control-object';
import worker from '../src/worker/index';
import { unwrap } from '../src/worker/rpc';
import type { Identity } from '../src/core/lifecycle';
import type { RootChildEffectIntent, RootChildEffectResult } from '../src/core/root-child-effects';
import type { Command, Run } from '../src/core/types';

// Real HTTP handler, token validation, RPC and SQLite. Cloudflare hosting and
// native observations are synthetic; no listener, connector or provider runs.
vi.mock('cloudflare:workers', () => ({ DurableObject: class {
 constructor(public ctx: unknown, public env: unknown) {}
} }));
vi.mock('../DB/schema.sql', () => ({ default: '' }));
let db: TestDatabase, control: PersonalControl, env: Env, identity: Identity;
let root: string, child: string, sibling: string;
const policy = '00000000-0000-4000-8000-000000000043';
const token = 'synthetic-runtime-token-not-a-credential';
async function owner(command: Command) {
 return unwrap(await control.accept('owner', randomUUID(), 'synthetic', command));
}
async function rpc(type: string, payload: unknown) {
 return unwrap(await control.runtime({ type, payload }));
}
async function http(type: string, payload: unknown, bearer = token) {
 const response = await worker.fetch(new Request(`https://control.invalid/internal/${type}`, {
  method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
 }), env);
 return { status: response.status, body: await response.json() };
}
async function spawn(parent: string) {
 const ref = `synthetic-child:${randomUUID()}`;
 const run = await rpc('native-child', { identity, child: { parent_run_id: parent, parent_attempt: 1,
  persona_id: bot, native_run_ref: ref, native_session_key: ref, title: 'Synthetic child observation' } }) as Run;
 await rpc('submitted', { identity, run_id: run.id, attempt: 1, native_ref: ref });
 return run.id;
}
function intent(runId = child): RootChildEffectIntent {
 return { identity, root_run_id: root, root_attempt: 1, resources: ['calendar:z43', 'browser:a19'],
  effect: { id: randomUUID(), run_id: runId, attempt: 1, action_key: randomUUID(), classification: 'mutation',
   authorization_ref: policy, request_digest: 'synthetic-request-71', provider_idempotency_key: null } };
}
function result(input: RootChildEffectIntent, status: RootChildEffectResult['status'], receipt: RootChildEffectResult['receipt'] = null): RootChildEffectResult {
 return { identity, root_run_id: root, root_attempt: 1, run_id: input.effect.run_id, attempt: 1, effect_id: input.effect.id, status, receipt };
}
const locks = () => db.all('SELECT resource_id,run_id,attempt FROM resource_locks ORDER BY resource_id');
const effects = () => db.all('SELECT * FROM effects ORDER BY id');
beforeEach(async () => {
 vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-10T00:00:00Z'));
 db = new TestDatabase();
 let initialized: Promise<unknown> = Promise.resolve();
 const ctx = {
  storage: {
   sql: { exec: (sql: string, ...values: (string | number | null)[]) => {
    const rows = db.all(sql, ...values); return { toArray: () => rows };
   } },
   transactionSync: <T>(fn: () => T) => db.transaction(fn), setAlarm: vi.fn(async () => {}), deleteAlarm: vi.fn(async () => {}),
  },
  blockConcurrencyWhile: (fn: () => Promise<unknown>) => { initialized = fn(); },
 };
 env = { EXECUTION_ENABLED: 'true', NATIVE_VERIFIED: 'true', PROVIDER_CONFIG: '{}',
  ACTION_POLICY_IDS: JSON.stringify([policy]), TOOL_POLICY_IDS: '[]', TRIGGER_CONFIG: '{}', RUNTIME_TOKEN: token,
  INSTALLATION_ID: 'synthetic', CONTROL: { getByName: () => control },
 } as unknown as Env;
 control = new PersonalControl(ctx as unknown as DurableObjectState, env); await initialized;
 // Only provider boot observation is seeded; all task/policy mutations use the
 // existing owner command or runtime contracts, including child submission.
 db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=7,lease_until='2026-09-10T00:02:00.000Z'");
 identity = await rpc('boot', { boot_id: randomUUID() }) as Identity;
 await rpc('ready', { identity });
 const r = routine({ enabled: false, action_policy_ids: [policy] });
 await owner({ schema_version: 1, type: 'routine.put', payload: r });
 root = (await owner({ schema_version: 1, type: 'routine.run', payload: { id: r.id, expected_revision: 1 } })).resource_id!;
 expect(await rpc('claim', { identity })).toMatchObject({ run: { id: root, current_attempt: 1 } });
 await rpc('submitted', { identity, run_id: root, attempt: 1, native_ref: 'synthetic-root-23' });
 child = await spawn(root); sibling = await spawn(root);
});
afterEach(() => { db.close(); vi.useRealTimers(); });

it('normalizes authenticated child heartbeat clocks and rejects changed custody without affecting effects or siblings', async () => {
 const input = intent(); await http('root-child-effect-intent', input);
 const beforeEffects = effects(), beforeLocks = locks(), beforeRuns = db.all('SELECT * FROM runs ORDER BY id');
 const op = { id: randomUUID(), run_id: child, attempt: 1, kind: 'tool', status: 'active',
  started_at: '2026-09-10T07:00:00+07:00', deadline_at: '2026-09-09T23:02:00-01:00', last_progress_at: '2026-09-10T00:00:01Z' };
 expect((await http('heartbeat', { identity, operations: [op] }, 'wrong-token')).status).toBe(401);
 expect(db.all('SELECT * FROM operations')).toEqual([]);
 expect((await http('heartbeat', { identity, operations: [op] })).status).toBe(200);
 const stored = db.all('SELECT * FROM operations');
 expect(stored).toEqual([{ ...op, started_at: '2026-09-10T00:00:00.000Z', deadline_at: '2026-09-10T00:02:00.000Z', last_progress_at: '2026-09-10T00:00:01.000Z' }]);
 expect(await http('heartbeat', { identity, operations: [{ ...op, deadline_at: '2026-09-10T00:03:00Z' }] }))
  .toMatchObject({ status: 422, body: { error: { code: 'INVALID_INPUT' } } });
 expect(db.all('SELECT * FROM operations')).toEqual(stored);
 expect(effects()).toEqual(beforeEffects); expect(locks()).toEqual(beforeLocks);
 expect(db.all('SELECT * FROM runs ORDER BY id')).toEqual(beforeRuns);
});

it('routes child-owned intent/replay and cancellation reconciliation without settlement or lock release', async () => {
 await rpc('complete', { identity, run_id: root, attempt: 1, result: { status: 'completed', text: 'Root output only' } });
 const input = intent();
 expect(await http('root-child-effect-intent', input)).toEqual({ status: 200, body: { id: input.effect.id, status: 'intent' } });
 expect(locks()).toEqual(['browser:a19', 'calendar:z43'].map(resource_id => ({ resource_id, run_id: child, attempt: 1 })));
 const held = locks(), before = effects();
 const release = { identity, run_id: child, attempt: 1, resources: input.resources };
 expect(await http('resource-release', release)).toMatchObject({ status: 409, body: { error: { code: 'OUTCOME_UNKNOWN' } } });
 expect(locks()).toEqual(held);
 expect(await http('root-child-effect-intent', { ...input, resources: [...input.resources].reverse(), effect: { ...input.effect, id: randomUUID() } }))
  .toEqual({ status: 200, body: { id: input.effect.id, status: 'intent' } });
 expect(effects()).toEqual(before);
 expect(await http('root-child-effect-intent', { ...input, resources: ['browser:a19'] }))
  .toMatchObject({ status: 409, body: { error: { code: 'IDEMPOTENCY_CONFLICT' } } });
 expect((await http('root-child-effect-result', result(input, 'dispatched'))).status).toBe(200);
 expect(await http('resource-release', release)).toMatchObject({ status: 409, body: { error: { code: 'OUTCOME_UNKNOWN' } } });
 expect(locks()).toEqual(held);
 await owner({ schema_version: 1, type: 'run.cancel', payload: { run_id: child, reason: 'Synthetic owner cancellation' } });
 expect((await http('root-child-effect-result', result(input, 'outcome_unknown'))).status).toBe(200);
 expect(await http('resource-release', release)).toMatchObject({ status: 409, body: { error: { code: 'OUTCOME_UNKNOWN' } } });
 expect(locks()).toEqual(held);
 expect(await http('root-child-effect-intent', input)).toEqual({ status: 200, body: { id: input.effect.id, status: 'outcome_unknown' } });
 expect(await http('root-child-effect-result', result(input, 'confirmed', {})))
  .toMatchObject({ status: 422, body: { error: { code: 'INVALID_INPUT' } } });
 expect((await http('root-child-effect-result', result(input, 'confirmed', { synthetic_destination: 'receipt-103' }))).status).toBe(200);
 const reconciled = effects();
 expect((await http('root-child-effect-result', result(input, 'confirmed', { ignored: 'duplicate' }))).status).toBe(200);
 expect(effects()).toEqual(reconciled); expect(locks()).toEqual(held);
 expect(db.all('SELECT status FROM runs WHERE id=?', child)).toEqual([{ status: 'cancelling' }]);
 expect(await http('complete', { identity, run_id: child, attempt: 1, result: { status: 'cancelled', text: '' } }))
  .toMatchObject({ status: 409, body: { error: { code: 'RESOURCE_BUSY' } } });
 expect(await http('prepare-sleep', { identity })).toMatchObject({ status: 409, body: { error: { code: 'SLEEP_DENIED' } } });
 expect((await http('resource-release', release)).status).toBe(200);
 expect(locks()).toEqual([]);
});

it('enforces resource bounds and strict envelopes before any effect/lock writes', async () => {
 const input = intent();
 const malformed = [
  { ...input, resources: [] }, { ...input, resources: ['duplicate', 'duplicate'] }, { ...input, resources: ['has space'] },
  { ...input, resources: Array.from({ length: 9 }, (_, i) => `resource:${i}`) }, { ...input, root_attempt: 0 },
  { ...input, root_run_id: 'not-a-uuid' }, { ...input, identity: { ...identity, child: true } },
  { ...input, trusted: true }, { ...input, effect: { ...input.effect, permissions: 'all' } },
  { ...input, effect: { ...input.effect, request_digest: 'x'.repeat(257) } },
  { ...input, resources: [], effect: { ...input.effect, classification: 'idempotent', provider_idempotency_key: 'key' } },
 ];
 for (const payload of malformed) expect(await http('root-child-effect-intent', payload))
  .toMatchObject({ status: 422, body: { error: { code: 'INVALID_INPUT' } } });
 for (const payload of [{ ...result(input, 'dispatched'), status: 'intent' }, { ...result(input, 'failed'), receipt: [] },
  { ...result(input, 'failed'), attempt: 0 }, { ...result(input, 'failed'), resources: [] }]) {
  expect(await http('root-child-effect-result', payload)).toMatchObject({ status: 422, body: { error: { code: 'INVALID_INPUT' } } });
 }
 expect(effects()).toEqual([]); expect(locks()).toEqual([]);
 const read = { ...input, resources: [], effect: { ...input.effect, classification: 'read_only' } };
 expect((await http('root-child-effect-intent', read)).status).toBe(200); expect(locks()).toEqual([]);
 const bounded = intent(sibling); bounded.effect.classification = 'idempotent'; bounded.effect.provider_idempotency_key = 'synthetic-key';
 bounded.resources = Array.from({ length: 8 }, (_, i) => `resource:${i}`);
 expect((await http('root-child-effect-intent', bounded)).status).toBe(200); expect(locks()).toHaveLength(8);
});

it('rolls back new effects and partial lock acquisition on sibling contention', async () => {
 await rpc('resource-acquire', { identity, run_id: sibling, attempt: 1, resources: ['calendar:z43'] });
 const held = locks();
 expect(await http('root-child-effect-intent', intent())).toMatchObject({ status: 409, body: { error: { code: 'RESOURCE_BUSY' } } });
 expect(effects()).toEqual([]); expect(locks()).toEqual(held);
});

it('rejects invalid custody and ordinary non-mediated effect results', async () => {
 const input = intent();
 for (const payload of [{ ...input, effect: { ...input.effect, run_id: root } }, { ...input, root_run_id: sibling }]) {
  expect(await http('root-child-effect-intent', payload)).toMatchObject({ status: 403, body: { error: { code: 'FORBIDDEN' } } });
 }
 expect(await http('root-child-effect-intent', { ...input, identity: { ...identity, epoch: 8 } }))
  .toMatchObject({ status: 409, body: { error: { code: 'STALE_EPOCH' } } });
 expect(effects()).toEqual([]);
 await rpc('effect-intent', { identity, effect: input.effect });
 expect(await http('root-child-effect-result', result(input, 'outcome_unknown')))
  .toMatchObject({ status: 403, body: { error: { code: 'FORBIDDEN' } } });
 expect(effects()).toMatchObject([{ status: 'intent', request_digest: 'synthetic-request-71' }]);
});

it('requires runtime authentication and keeps both routes closed with production defaults', async () => {
 const input = intent();
 for (const [type, payload] of [['root-child-effect-intent', input], ['root-child-effect-result', result(input, 'dispatched')]] as const) {
  expect((await http(type, payload, 'incorrect-token')).status).toBe(401);
 }
 env.EXECUTION_ENABLED = 'false'; env.NATIVE_VERIFIED = 'false';
 // Reopening uses the same durable database but re-evaluates host gates.
 const ctx = (control as unknown as { ctx: DurableObjectState }).ctx;
 control = new PersonalControl(ctx, env);
 for (const [type, payload] of [['root-child-effect-intent', input], ['root-child-effect-result', result(input, 'dispatched')]] as const) {
  expect(await http(type, payload)).toMatchObject({ status: 409, body: { error: { code: 'CAPABILITY_UNAVAILABLE' } } });
 }
 expect(effects()).toEqual([]); expect(locks()).toEqual([]);
});

it('validates optional native-start acknowledgement and preserves cancellation on exact replay', async () => {
 const receipt = { parent_run_id: root, parent_attempt: 1, persona_id: bot, native_run_ref: 'synthetic-start-43',
  native_session_key: 'synthetic-thread-71', title: 'Observed start' };
 const registered = await rpc('native-child', { identity, child: receipt }) as Run;
 expect(registered.status).toBe('claimed');
 expect(await http('native-child', { identity, child: receipt, started: 'true' }))
  .toMatchObject({ status: 422, body: { error: { code: 'INVALID_INPUT' } } });
 expect(db.all('SELECT status FROM runs WHERE id=?', registered.id)).toEqual([{ status: 'claimed' }]);
 expect(await http('native-child', { identity, child: receipt, started: true }))
  .toMatchObject({ status: 200, body: { id: registered.id, status: 'running' } });
 await owner({ schema_version: 1, type: 'run.cancel', payload: { run_id: registered.id, reason: 'Cancel observed child' } });
 expect(await http('native-child', { identity, child: receipt, started: true }))
  .toMatchObject({ status: 200, body: { id: registered.id, status: 'cancelling' } });
 expect(db.all('SELECT run_id FROM native_task_links WHERE native_run_ref=?', receipt.native_run_ref))
  .toEqual([{ run_id: registered.id }]);
});

it('routes owner steering and exact native receipts while denying model commands, bad auth and closed gates', async () => {
 const before = db.all('SELECT * FROM runs ORDER BY id');
 const command:Command = { schema_version:1,type:'run.steer',payload:{run_id:child,expected_attempt:1,text:'Use tomorrow for this child'} };
 const receipt = await owner(command);
 expect(receipt.status).toBe('applied');
 const query = { identity, targets:[{run_id:child,attempt:1},{run_id:sibling,attempt:1}] };
 expect(await http('steer-pending',query)).toMatchObject({status:200,body:[{command_id:receipt.id,run_id:child,attempt:1,text:command.payload.text}]});
 const outcome = {identity,run_id:child,attempt:1,command_id:receipt.id,status:'accepted'};
 expect((await http('steer-pending',query,'incorrect-token')).status).toBe(401);
 expect((await http('steer-result',outcome,'incorrect-token')).status).toBe(401);
 expect((await http('steer-result',{...outcome,status:'consumed'})).status).toBe(422);
 expect((await http('agent-command',{identity,run_id:root,attempt:1,idempotency_key:randomUUID(),command})).status).toBe(422);
 expect(await http('steer-result',outcome)).toEqual({status:200,body:{ok:true}});
 expect(await http('steer-pending',query)).toEqual({status:200,body:[]});
 expect(db.all('SELECT * FROM runs ORDER BY id')).toEqual(before);expect(effects()).toEqual([]);expect(locks()).toEqual([]);
 env.EXECUTION_ENABLED='false';env.NATIVE_VERIFIED='false';
 control=new PersonalControl((control as unknown as {ctx:DurableObjectState}).ctx,env);
 expect((await http('steer-pending',query)).body).toMatchObject({error:{code:'CAPABILITY_UNAVAILABLE'}});
 expect((await http('steer-result',outcome)).body).toMatchObject({error:{code:'CAPABILITY_UNAVAILABLE'}});
 expect((await owner({...command,payload:{...command.payload,run_id:sibling}})).error?.code).toBe('CAPABILITY_UNAVAILABLE');
});
