import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import worker from '../src/worker/index';
import { PersonalControl } from '../src/worker/control-object';
import { Store } from '../src/core/store';
import { TestDatabase, bot, routine } from './helpers';

vi.mock('cloudflare:workers', () => ({ DurableObject: class { constructor(public ctx: unknown, public env: unknown) {} } }));
vi.mock('../DB/schema.sql', () => ({ default: '' }));
const keys = vi.hoisted(() => ({ resolve: undefined as unknown }));
vi.mock('jose', async importOriginal => ({ ...await importOriginal<typeof import('jose')>(), createRemoteJWKSet: () => keys.resolve }));

const origin = 'https://routine-history.invalid', issuer = 'https://routine-history.cloudflareaccess.com', runtimeToken = 'routine-history-runtime';
let ownerToken: string, foreignToken: string, db: TestDatabase, control: PersonalControl, env: Env, routineId: string;
const setAlarm = vi.fn(async () => {}), deleteAlarm = vi.fn(async () => {});

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  keys.resolve = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: 'routine-history', alg: 'RS256' }] });
  const sign = (sub: string) => new SignJWT({ iss: issuer, aud: 'routine-history', sub, iat: 1788998400, exp: 1788998700 }).setProtectedHeader({ alg: 'RS256', kid: 'routine-history' }).sign(pair.privateKey);
  ownerToken = await sign('owner'); foreignToken = await sign('foreign-owner');
});

const headers = (actor: 'owner' | 'foreign' | 'runtime' | 'missing') => {
  const value = new Headers();
  if (actor === 'owner' || actor === 'foreign') value.set('Cf-Access-Jwt-Assertion', actor === 'owner' ? ownerToken : foreignToken);
  if (actor === 'runtime') value.set('Authorization', `Bearer ${runtimeToken}`);
  return value;
};
const request = (path: string, actor: 'owner' | 'foreign' | 'runtime' | 'missing' = 'owner') => worker.fetch(new Request(origin + path, { headers: headers(actor) }), env);
const custody = () => ['objects', 'commands', 'runs', 'attempts', 'outbox', 'occurrences', 'operations', 'effects', 'events', 'lifecycle', 'controller_operations', 'schedule_state'].map(table => db.all(`SELECT * FROM ${table} ORDER BY 1`));

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-10T00:00:00.000Z'));
  db = new TestDatabase(); db.exec("INSERT INTO lifecycle(singleton,provider_ref_json,phase,desired_state) VALUES(1,'{}','STOPPED','STOP')");
  let initialized: Promise<unknown> = Promise.resolve();
  const ctx = { storage: { sql: { exec: (sql: string, ...values: (string | number | null)[]) => ({ toArray: () => db.all(sql, ...values) }) }, transactionSync: <T>(fn: () => T) => db.transaction(fn), getAlarm: async () => null, setAlarm, deleteAlarm }, blockConcurrencyWhile: (fn: () => Promise<unknown>) => { initialized = fn(); } };
  env = { AUTH_MODE: 'access', INSTALLATION_ID: 'routine-history', ACCESS_ISSUER: issuer, ACCESS_AUD: 'routine-history', OWNER_SUB: 'owner', EXECUTION_ENABLED: 'false', NATIVE_VERIFIED: 'false', PROVIDER_CONFIG: '{}', ACTION_POLICY_IDS: '[]', TOOL_POLICY_IDS: '[]', TRIGGER_CONFIG: '{}', RUNTIME_TOKEN: runtimeToken, CONTROL: { getByName: () => control } } as unknown as Env;
  control = new PersonalControl(ctx as unknown as DurableObjectState, env); await initialized;
  const store = new Store(db);
  if (!db.all('SELECT id FROM objects WHERE id=?', bot).length) store.put(bot, 'persona', { id: bot, expected_revision: 0, name: 'HTTP persona', instructions: 'Synthetic.', tool_policy_ids: [], archived: false }, 0, 'system', '2026-09-10T00:00:00.000Z');
  const value = routine({ id: randomUUID(), persona_id: bot }); routineId = value.id;
  store.put(routineId, 'routine', value, 0, 'owner', '2026-09-10T00:00:00.000Z');
  for (const [id, status] of [['00000000-0000-4000-8000-000000000001', 'completed'], ['00000000-0000-4000-8000-000000000002', 'waiting']] as const)
    db.exec("INSERT INTO runs(id,persona_id,routine_id,context_json,status,created_at,updated_at) VALUES(?,?,?,'{\"private\":\"HTTP_PRIVATE_CONTEXT\"}',?,?,?)", id, bot, routineId, status, '2026-09-10T00:00:00.000Z', '2026-09-10T00:00:00.000Z');
  setAlarm.mockClear(); deleteAlarm.mockClear();
});
afterEach(() => { db.close(); vi.useRealTimers(); vi.restoreAllMocks(); });

it('serves signed-owner routine history with exclusive pagination and no reconciliation or alarms', async () => {
  const before = custody(), first = await request(`/v1/routines/${routineId}/runs?limit=1`);
  expect(first.status).toBe(200); expect(await first.json()).toMatchObject({ counts: { total: 2, waiting: 1, recovery: 0 }, runs: [{ id: '00000000-0000-4000-8000-000000000001', status: 'completed' }], next_cursor: '00000000-0000-4000-8000-000000000001' });
  const second = await request(`/v1/routines/${routineId}/runs?after=00000000-0000-4000-8000-000000000001&limit=1`);
  const value = await second.json(); expect(second.status).toBe(200); expect(value).toMatchObject({ counts: { total: 2, waiting: 1, recovery: 0 }, runs: [{ id: '00000000-0000-4000-8000-000000000002', status: 'waiting' }], next_cursor: null });
  expect(JSON.stringify(value)).not.toMatch(/HTTP_PRIVATE_CONTEXT|context_json|checkpoint_json/);
  expect(custody()).toEqual(before); expect(setAlarm).not.toHaveBeenCalled(); expect(deleteAlarm).not.toHaveBeenCalled();
});

it('projects content-free execution and run-level delivery through authenticated HTTP without mutation', async () => {
  const run = '00000000-0000-4000-8000-000000000001';
  db.exec('UPDATE runs SET current_attempt=2 WHERE id=?', run);
  db.exec(`INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,status,deadline_at,settled_at,result_json)
    VALUES(?,2,'HTTP_SECRET_SUBMISSION',1,'HTTP_SECRET_BOOT','completed',?,?, '{"text":"HTTP_SECRET_RESULT"}')`, run, '2026-09-10T00:05:00.000Z', '2026-09-10T00:00:00.000Z');
  db.exec("INSERT INTO outbox VALUES(?,?,'HTTP_SECRET_DESTINATION','{\"text\":\"HTTP_SECRET_PAYLOAD\"}','outcome_unknown',?,?)", randomUUID(), run, '2026-09-09T00:00:00.000Z', '2026-09-09T00:00:00.000Z');
  const before = custody(), response = await request(`/v1/routines/${routineId}/runs?limit=1`), page = await response.json();
  expect(response.status).toBe(200);
  expect(page).toMatchObject({ runs: [{ execution: { attempt: 2, status: 'completed', started_at: null, settled_at: '2026-09-10T00:00:00.000Z', result_body_retained: true }, run_delivery: { counts: { pending: 0, delivered: 0, failed: 0, outcome_unknown: 1 }, portal: null } }] });
  expect(JSON.stringify(page)).not.toMatch(/HTTP_SECRET_|HTTP_PRIVATE_CONTEXT|context_json|checkpoint_json|result_json|payload_json/);
  expect(custody()).toEqual(before); expect(setAlarm).not.toHaveBeenCalled(); expect(deleteAlarm).not.toHaveBeenCalled();
});

it('serves preflight observations without reconciliation, alarms or captured private context', async () => {
  const before=custody(),response=await request(`/v1/routines/${routineId}/preflight`),value=await response.json();
  expect(response.status).toBe(200);
  expect(value).toMatchObject({routine_id:routineId,routine_revision:1,persona_id:bot,manual_run:{command_allowed:false,execution_enabled:false,blockers:[{code:'RESOURCE_BUSY'}]}});
  expect(JSON.stringify(value)).not.toMatch(/HTTP_PRIVATE_CONTEXT|context_json|checkpoint_json/);
  expect(custody()).toEqual(before);expect(setAlarm).not.toHaveBeenCalled();expect(deleteAlarm).not.toHaveBeenCalled();
});

it.each(['missing','foreign','runtime'] as const)('denies %s credentials before preflight RPC',async actor=>{
  const before=custody(),spy=vi.spyOn(control,'getRoutinePreflight');
  expect((await request(`/v1/routines/${routineId}/preflight`,actor)).status).toBe(401);
  expect(spy).not.toHaveBeenCalled();expect(custody()).toEqual(before);expect(setAlarm).not.toHaveBeenCalled();
});

it.each(['missing', 'foreign', 'runtime'] as const)('denies %s credentials before routine-history RPC', async actor => {
  const before = custody(), spy = vi.spyOn(control, 'getRoutineTasks');
  const response = await request(`/v1/routines/${routineId}/runs`, actor);
  expect(response.status).toBe(401); expect(await response.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  expect(spy).not.toHaveBeenCalled(); expect(custody()).toEqual(before); expect(setAlarm).not.toHaveBeenCalled(); expect(deleteAlarm).not.toHaveBeenCalled();
});

it.each(['after=', 'after=invalid', 'after=00000000-0000-4000-8000-00000000000g', 'limit=', 'limit=0', 'limit=11', 'limit=1.5', 'limit=NaN'])('rejects malformed HTTP bounds without RPC or mutation: %s', async query => {
  const before = custody(), spy = vi.spyOn(control, 'getRoutineTasks');
  const response = await request(`/v1/routines/${routineId}/runs?${query}`);
  expect(response.status).toBe(422); expect(await response.json()).toMatchObject({ error: { code: 'INVALID_INPUT' } });
  expect(spy).not.toHaveBeenCalled(); expect(custody()).toEqual(before); expect(setAlarm).not.toHaveBeenCalled(); expect(deleteAlarm).not.toHaveBeenCalled();
});

it('returns NOT_FOUND for missing, deleted, non-routine and malformed routine IDs without control work', async () => {
  const store = new Store(db), nonRoutine = randomUUID(); store.put(nonRoutine, 'memory', { text: 'not routine' }, 0, 'owner', '2026-09-10T00:00:00.000Z');
  db.exec("UPDATE objects SET deleted_at='2026-09-10T00:01:00.000Z' WHERE id=?", routineId);
  for (const id of [randomUUID(), routineId, nonRoutine, 'not-a-uuid']) {
    const before = custody(), response = await request(`/v1/routines/${id}/runs`);
    expect(response.status).toBe(404); expect(await response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } }); expect(custody()).toEqual(before);
  }
  expect(setAlarm).not.toHaveBeenCalled(); expect(deleteAlarm).not.toHaveBeenCalled();
});
