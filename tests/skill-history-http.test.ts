import { randomUUID } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import worker from '../src/worker/index';
import { PersonalControl } from '../src/worker/control-object';
import { Store } from '../src/core/store';
import type { SkillBody } from '../src/core/types';
import { TestDatabase, bot } from './helpers';

vi.mock('cloudflare:workers', () => ({ DurableObject: class { constructor(public ctx: unknown, public env: unknown) {} } }));
vi.mock('../DB/schema.sql', () => ({ default: '' }));
const keys = vi.hoisted(() => ({ resolve: undefined as unknown }));
vi.mock('jose', async importOriginal => ({ ...await importOriginal<typeof import('jose')>(), createRemoteJWKSet: () => keys.resolve }));

const origin = 'https://skill-history.invalid';
const issuer = 'https://skill-history.cloudflareaccess.com';
const runtimeToken = 'synthetic-history-runtime-token';
let ownerToken: string, foreignToken: string, db: TestDatabase, control: PersonalControl, env: Env, skill: string;
const setAlarm = vi.fn(async () => {}), deleteAlarm = vi.fn(async () => {});
const body = (revision: number): SkillBody => ({ name: `HTTP skill ${revision}`, description: `HTTP body ${revision}`, when_to_use: 'Synthetic HTTP history', inputs_access: [`input-${revision}`], steps: [`step-${revision}`], decision_rules: [`rule-${revision}`], validation: [`check-${revision}`], output: `output-${revision}`, failure_handling: [`failure-${revision}`], approval_boundaries: [`boundary-${revision}`], contains_private_facts: false });

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  keys.resolve = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: 'history', alg: 'RS256' }] });
  const sign = (sub: string) => new SignJWT({ iss: issuer, aud: 'history', sub, iat: 1788998400, exp: 1788998700 }).setProtectedHeader({ alg: 'RS256', kid: 'history' }).sign(pair.privateKey);
  ownerToken = await sign('owner'); foreignToken = await sign('foreign-owner');
});

function headers(actor: 'owner' | 'foreign' | 'runtime' | 'missing') {
  const result = new Headers();
  if (actor === 'owner' || actor === 'foreign') result.set('Cf-Access-Jwt-Assertion', actor === 'owner' ? ownerToken : foreignToken);
  if (actor === 'runtime') result.set('Authorization', `Bearer ${runtimeToken}`);
  return result;
}
const request = (path: string, actor: 'owner' | 'foreign' | 'runtime' | 'missing') => worker.fetch(new Request(origin + path, { headers: headers(actor) }), env);
const custody = () => ({ objects: db.all('SELECT * FROM objects ORDER BY id'), revisions: db.all('SELECT * FROM object_revisions ORDER BY object_id,revision'), proposals: db.all('SELECT * FROM skill_proposals ORDER BY id'), events: db.all('SELECT * FROM events ORDER BY sequence'), runs: db.all('SELECT * FROM runs ORDER BY id'), lifecycle: db.all('SELECT * FROM lifecycle') });

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-10T00:00:00Z'));
  db = new TestDatabase();
  db.exec("INSERT INTO lifecycle(singleton,provider_ref_json,phase,desired_state) VALUES(1,'{}','STOPPED','STOP')");
  let initialized: Promise<unknown> = Promise.resolve();
  const ctx = { storage: { sql: { exec: (sql: string, ...values: (string | number | null)[]) => { const rows=db.all(sql,...values);return {toArray:()=>rows}; } }, transactionSync: <T>(fn: () => T) => db.transaction(fn), setAlarm, deleteAlarm }, blockConcurrencyWhile: (fn: () => Promise<unknown>) => { initialized = fn(); } };
  env = { AUTH_MODE: 'access', INSTALLATION_ID: 'history', ACCESS_ISSUER: issuer, ACCESS_AUD: 'history', OWNER_SUB: 'owner', EXECUTION_ENABLED: 'false', NATIVE_VERIFIED: 'false', PROVIDER_CONFIG: '{}', ACTION_POLICY_IDS: '[]', TOOL_POLICY_IDS: '[]', TRIGGER_CONFIG: '{}', RUNTIME_TOKEN: runtimeToken, CONTROL: { getByName: () => control } } as unknown as Env;
  control = new PersonalControl(ctx as unknown as DurableObjectState, env); await initialized;
  const store = new Store(db); skill = randomUUID();
  for (let revision = 1; revision <= 4; revision++) store.put(skill, 'skill', body(revision), revision - 1, `actor-${revision}`, `2026-09-10T00:00:0${revision}.000Z`, `source-${revision}`);
  setAlarm.mockClear(); deleteAlarm.mockClear();
});
afterEach(() => { db.close(); vi.useRealTimers(); vi.restoreAllMocks(); });

it('admits explicit skill input only through owner command ingress, preserving receipt identity and the execution gate',async()=>{
 const command={schema_version:1,type:'skill.run',payload:{skill_id:skill,expected_skill_revision:4,persona_id:bot,expected_persona_revision:1,text:'Compare 17 and 43.'}},key=randomUUID();
 const post=(actor:'owner'|'foreign'|'runtime'|'missing')=>{
  const h=headers(actor);h.set('Origin',origin);h.set('Content-Type','application/json');h.set('Idempotency-Key',key);
  return worker.fetch(new Request(origin+'/v1/commands',{method:'POST',headers:h,body:JSON.stringify(command)}),env);
 };
 const before=custody(),accept=vi.spyOn(control,'accept');
 for(const actor of ['foreign','runtime','missing'] as const){expect((await post(actor)).status).toBe(401);expect(custody()).toEqual(before);}
 expect(accept).not.toHaveBeenCalled();
 const response=await post('owner'),receipt=await response.json() as {status:string;resource_id:string};expect(response.status,JSON.stringify(receipt)).toBe(202);expect(receipt.status).toBe('applied');
 expect(await (await post('owner')).json()).toEqual(receipt);
 const run=db.all<{status:string;context_json:string}>('SELECT status,context_json FROM runs WHERE id=?',receipt.resource_id)[0];
 expect(run.status).toBe('waiting');expect(JSON.parse(run.context_json)).toMatchObject({skill_invocation:{skill_id:skill,skill_revision:4},skills:[{id:skill,revision:4,body:body(4)}]});
 expect(db.all('SELECT * FROM skill_enablements')).toEqual([]);expect(db.all('SELECT * FROM attempts')).toEqual([]);
 expect(db.all('SELECT * FROM lifecycle')).toEqual(before.lifecycle);
});

it('serves authenticated bounded history with exclusive cursor and no metadata or control-plane action', async () => {
  const before = custody();
  const first = await request(`/v1/skills/${skill}/revisions?limit=3`, 'owner');
  expect(first.status).toBe(200);
  expect(await first.json()).toEqual({ skill_id: skill, current_revision: 4, revisions: [4, 3, 2].map(revision => ({ revision, body: body(revision), created_at: `2026-09-10T00:00:0${revision}.000Z` })), next_cursor: 2 });
  const second = await request(`/v1/skills/${skill}/revisions?before=2`, 'owner');
  expect(second.status).toBe(200);
  const value = await second.json();
  expect(value).toEqual({ skill_id: skill, current_revision: 4, revisions: [{ revision: 1, body: body(1), created_at: '2026-09-10T00:00:01.000Z' }], next_cursor: null });
  expect(JSON.stringify(value)).not.toMatch(/actor|source|proposal|pending/i);
  expect(custody()).toEqual(before);
  expect(setAlarm).not.toHaveBeenCalled(); expect(deleteAlarm).not.toHaveBeenCalled();
});

it.each(['missing', 'foreign', 'runtime'] as const)('authenticates the owner before history RPC for %s credentials', async actor => {
  const before = custody(), spy = vi.spyOn(control, 'getSkillHistory');
  const response = await request(`/v1/skills/${skill}/revisions`, actor);
  expect(response.status).toBe(401); expect(await response.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  expect(spy).not.toHaveBeenCalled(); expect(custody()).toEqual(before);
  expect(setAlarm).not.toHaveBeenCalled(); expect(deleteAlarm).not.toHaveBeenCalled();
});

it.each(['before=0', 'before=-1', 'before=1.5', 'before=9007199254740992', 'before=', 'limit=0', 'limit=21', 'limit=1.5', 'limit=NaN', 'limit='])('rejects malformed HTTP bounds: %s', async query => {
  const before = custody();
  const response = await request(`/v1/skills/${skill}/revisions?${query}`, 'owner');
  expect(response.status).toBe(422); expect(await response.json()).toMatchObject({ error: { code: 'INVALID_INPUT' } });
  expect(custody()).toEqual(before); expect(setAlarm).not.toHaveBeenCalled(); expect(deleteAlarm).not.toHaveBeenCalled();
});

it('returns NOT_FOUND for missing, deleted, non-skill, and malformed skill IDs', async () => {
  const store = new Store(db), nonSkill = randomUUID();
  store.put(nonSkill, 'memory', { text: 'not a skill' }, 0, 'owner', '2026-09-10T00:00:00.000Z');
  db.exec("UPDATE objects SET deleted_at='2026-09-10T00:01:00.000Z',revision=5 WHERE id=?", skill);
  for (const id of [randomUUID(), skill, nonSkill, 'not-a-uuid']) {
    const response = await request(`/v1/skills/${id}/revisions`, 'owner');
    expect(response.status).toBe(404); expect(await response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  }
  expect(setAlarm).not.toHaveBeenCalled(); expect(deleteAlarm).not.toHaveBeenCalled();
});
