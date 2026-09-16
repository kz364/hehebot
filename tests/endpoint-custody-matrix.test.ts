import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import worker from '../src/worker/index';
import { PersonalControl } from '../src/worker/control-object';
import { Store } from '../src/core/store';
import type { PersonaPut } from '../src/core/types';
import { TestDatabase, bot, otherBot } from './helpers';

// Same host shim as control-object.test.ts; ingress, JWT verification, RPC,
// schemas and core SQL are production code. Only JWKS transport is replaced.
vi.mock('cloudflare:workers', () => ({ DurableObject: class {
 constructor(public ctx: unknown, public env: unknown) {}
} }));
vi.mock('../DB/schema.sql', () => ({ default: '' }));
const keys = vi.hoisted(() => ({ resolve: undefined as unknown }));
vi.mock('jose', async importOriginal => ({ ...await importOriginal<typeof import('jose')>(),
 createRemoteJWKSet: () => keys.resolve,
}));
const origin = 'https://custody.invalid', issuer = 'https://custody.cloudflareaccess.com';
const runtimeToken = 'synthetic-runtime-custody-token';
const canaries = ['PRIVATE-TRAVEL-719', 'PRIVATE-INBOX-283', 'SECRET-ANSWER-947', 'SECRET-QUESTION-651'];
const policy = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const identity = { epoch: 3, boot_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
let ownerToken: string, foreignToken: string, db: TestDatabase, control: PersonalControl, env: Env;
let runs: string[], receipt: string, question: { id: string; connection_id: string };
const setAlarm = vi.fn(async () => {}), deleteAlarm = vi.fn(async () => {});
const network = vi.fn(() => { throw new Error('Unexpected external dispatch'); });
beforeAll(async () => {
 const pair = await generateKeyPair('RS256');
 keys.resolve = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: 'custody', alg: 'RS256' }] });
 const sign = (sub: string) => new SignJWT({ iss: issuer, aud: 'custody', sub, iat: 1788998400, exp: 1788998700 })
  .setProtectedHeader({ alg: 'RS256', kid: 'custody' }).sign(pair.privateKey);
 ownerToken = await sign('owner'); foreignToken = await sign('foreign-owner');
});
function headers(actor: string) {
 const h = new Headers({ 'Content-Type': 'application/json', Origin: origin, 'Idempotency-Key': randomUUID() });
 if (actor === 'owner' || actor === 'foreign') h.set('Cf-Access-Jwt-Assertion', actor === 'owner' ? ownerToken : foreignToken);
 if (actor === 'runtime') h.set('Authorization', `Bearer ${runtimeToken}`);
 return h;
}
async function request(path: string, actor: string, body?: unknown) {
 return worker.fetch(new Request(origin + path, { method: body === undefined ? 'GET' : 'POST',
  headers: headers(actor), body: body === undefined ? undefined : JSON.stringify(body) }), env);
}
const command = (type: string, payload: unknown) => ({ schema_version: 1, type, payload });
beforeEach(async () => {
 vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-10T00:00:00Z'));
 vi.stubGlobal('fetch', network); network.mockClear();
 db = new TestDatabase();
 let initialized: Promise<unknown> = Promise.resolve();
 const ctx = { storage: {
  sql: { exec: (sql: string, ...values: (string | number | null)[]) => {
   const rows = db.all(sql, ...values); return { toArray: () => rows };
  } },
  transactionSync: <T>(fn: () => T) => db.transaction(fn), setAlarm, deleteAlarm,
 }, blockConcurrencyWhile: (fn: () => Promise<unknown>) => { initialized = fn(); } };
 env = { AUTH_MODE: 'access', INSTALLATION_ID: 'custody', ACCESS_ISSUER: issuer, ACCESS_AUD: 'custody', OWNER_SUB: 'owner',
  EXECUTION_ENABLED: 'true', NATIVE_VERIFIED: 'true', PROVIDER_CONFIG: '{}', ACTION_POLICY_IDS: '[]', TOOL_POLICY_IDS: JSON.stringify([policy]),
  HEHEBOT_WHATSAPP_READ_POLICIES: JSON.stringify({ [policy]: { chatIds: ['family@g.us'], tools: ['whatsapp_get_chat_messages'] } }),
  TRIGGER_CONFIG: '{}', RUNTIME_TOKEN: runtimeToken, CONTROL: { getByName: () => control },
 } as unknown as Env;
 control = new PersonalControl(ctx as unknown as DurableObjectState, env); await initialized;
 const store = new Store(db), persona = store.get<PersonaPut>(bot, 'persona');
 store.put(bot, 'persona', { ...persona.body, tool_policy_ids: [policy] }, persona.revision, 'owner', new Date().toISOString());
 // Seed only native admission observations; owner messages still enter via HTTP.
 db.exec("UPDATE lifecycle SET epoch=3,boot_id=?,phase='READY',lease_until='2026-09-10T00:30:00.000Z'", identity.boot_id);
 runs = [];
 for (const [index, id] of [bot, otherBot].entries()) {
  const response = await request('/v1/commands', 'owner', command('message.send', { conversation_id: id, text: canaries[index] }));
  expect(response.status).toBe(202);
  const result = await response.json() as { id: string; resource_id: string; status: string };
  expect(result.status).toBe('applied'); receipt = result.id; runs.push(result.resource_id);
  db.exec("UPDATE runs SET status='running',current_attempt=1,title=? WHERE id=?", canaries[index], result.resource_id);
  db.exec("INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,status,native_run_ref,deadline_at) VALUES(?,1,?,3,?,'running',?,'2026-09-10T00:20:00.000Z')",
   result.resource_id, randomUUID(), identity.boot_id, `turn-${index}`);
 }
 question = { id: randomUUID(), connection_id: randomUUID() };
 const recorded = await request('/internal/question-record', 'runtime', { identity, run_id: runs[0], attempt: 1,
  question: { ...question, request_id: 0, params: { threadId: 'thread-0', turnId: 'turn-0', itemId: 'item-0', isBlocking: true,
   questions: [{ id: 'secret', header: 'Private', question: canaries[3], isSecret: false, isOther: true, options: null }] } } });
 expect(recorded.status).toBe(200); expect(await recorded.json()).toEqual({ id: question.id });
 setAlarm.mockClear(); deleteAlarm.mockClear();
});
afterEach(() => { db.close(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function snapshot() {
 return db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
  .map(({ name }) => [name, db.all(`SELECT * FROM "${name}" ORDER BY rowid`)]);
}
const publicCases = ['state', 'history', 'tasks', 'recovery', 'receipt', 'export', 'answer', 'close', 'recover'] as const;
function ownerRoute(name: typeof publicCases[number]): [string, unknown?] {
 switch (name) {
  case 'state': return ['/v1/state'];
  case 'history': return [`/v1/conversations/${bot}/events`];
  case 'tasks': return [`/v1/conversations/${bot}/tasks`];
  case 'recovery': return [`/v1/conversations/${bot}/recovery`];
  case 'receipt': return [`/v1/receipts/${receipt}`];
  case 'export': return ['/v1/export/control'];
  case 'answer': return ['/v1/commands', command('question.answer', { question_id: question.id, expected_revision: 1, answers: { secret: { answers: [canaries[2]] } } })];
  case 'close': return ['/v1/commands', command('question.close', { question_id: question.id, expected_revision: 1, confirm_stopped_closure: true })];
  case 'recover': return ['/v1/commands', command('run.recover', { run_id: runs[0], expected_attempt: 1, release_resources: true })];
 }
}
async function denied(path: string, actor: string, body?: unknown) {
 const before = snapshot(), changes = db.all('SELECT total_changes() AS n');
 const spies = [vi.spyOn(control, 'getState'), vi.spyOn(control, 'getTimeline'), vi.spyOn(control, 'getTasks'),
  vi.spyOn(control, 'getRecovery'), vi.spyOn(control, 'getReceipt'), vi.spyOn(control, 'getControlExport'),
  vi.spyOn(control, 'accept'), vi.spyOn(control, 'runtime')];
 const response = await request(path, actor, body), text = await response.text();
 expect(response.status).toBe(401); expect(JSON.parse(text)).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
 for (const value of [...canaries, runtimeToken, ownerToken, foreignToken]) expect(text).not.toContain(value);
 for (const spy of spies) expect(spy).not.toHaveBeenCalled();
 expect(snapshot()).toEqual(before); expect(db.all('SELECT total_changes() AS n')).toEqual(changes);
 expect(setAlarm).not.toHaveBeenCalled(); expect(deleteAlarm).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
}
it.each(publicCases.flatMap(route => ['missing', 'foreign', 'runtime'].map(actor => ({ route, actor }))))
('denies $actor on owner $route before durable access', async ({ route, actor }) => {
 const [path, body] = ownerRoute(route); await denied(path, actor, body);
});
const nativeCases = ['question-record', 'question-take', 'question-resolve', 'whatsapp-read-authorize'] as const;
function nativeBody(route: typeof nativeCases[number]) {
 if (route === 'whatsapp-read-authorize') return { identity, run_id: runs[0], attempt: 1, name: 'whatsapp_get_chat_messages', chatId: 'family@g.us' };
 if (route === 'question-record') return { identity, run_id: runs[0], attempt: 1, question: { ...question, request_id: 0,
  params: { threadId: 'thread-0', turnId: 'turn-0', itemId: 'item-0', isBlocking: true, questions: [{ id: 'secret', header: 'Private', question: canaries[3] }] } } };
 return { identity, question_id: question.id, connection_id: question.connection_id };
}
it.each(nativeCases.flatMap(route => ['missing', 'foreign', 'owner'].map(actor => ({ route, actor }))))
('denies $actor on runtime $route before durable access', async ({ route, actor }) => {
 await denied(`/internal/${route}`, actor, nativeBody(route));
});
it('authorized owner reads real canaries but conversation history and tasks exclude the other persona', async () => {
 for (const route of ['state', 'history', 'tasks', 'receipt', 'export', 'recovery'] as const) {
  if (route === 'recovery') db.exec("UPDATE runs SET status='recovery_required' WHERE id=?", runs[0]);
  const [path] = ownerRoute(route), response = await request(path, 'owner'), text = await response.text();
  expect(response.status).toBe(200);
  if (route !== 'receipt') expect(text).toContain(canaries[0]);
  if (route === 'history' || route === 'tasks' || route === 'recovery') expect(text).not.toContain(canaries[1]);
  if (route === 'state' || route === 'export') expect(text).toContain(canaries[1]);
 }
});
it('only the runtime can take an owner answer; taking records uncertainty and cannot replay it', async () => {
 const [path, body] = ownerRoute('answer');
 const response = await request(path, 'owner', body);
 expect(response.status).toBe(202); expect(await response.json()).toMatchObject({ status: 'applied' });
 // A secret exists in durable custody before the denied take attempts.
 expect(JSON.stringify(snapshot())).toContain(canaries[2]);
 setAlarm.mockClear(); deleteAlarm.mockClear();
 await denied('/internal/question-take', 'owner', nativeBody('question-take'));
 vi.restoreAllMocks();
 const take = await request('/internal/question-take', 'runtime', nativeBody('question-take'));
 expect(take.status).toBe(200);
 expect(await take.json()).toEqual({ state: 'response_unknown', answer: { answers: { secret: { answers: [canaries[2]] } } } });
 expect(await (await request('/internal/question-take', 'runtime', nativeBody('question-take'))).json())
  .toEqual({ state: 'response_unknown', answer: null });
 const resolved = await request('/internal/question-resolve', 'runtime', nativeBody('question-resolve'));
 expect(resolved.status).toBe(200); expect(await resolved.json()).toEqual({ ok: true });
});
it('authorized stopped closure and recovery use owner commands rather than the runtime credential', async () => {
 db.exec("UPDATE lifecycle SET phase='STOPPED',desired_state='STOP',lease_until=NULL");
 db.exec("UPDATE runs SET status='recovery_required' WHERE id=?", runs[0]);
 db.exec("UPDATE attempts SET status='terminated',settled_at=? WHERE run_id=?", new Date().toISOString(), runs[0]);
 for (const route of ['close', 'recover'] as const) {
  const [path, body] = ownerRoute(route), response = await request(path, 'owner', body);
  expect(response.status).toBe(202); expect(await response.json()).toMatchObject({ status: 'applied' });
 }
 expect(db.all('SELECT status FROM runs WHERE id=?', runs[0])).toEqual([{ status: 'failed' }]);
 expect(db.all('SELECT status FROM runs WHERE id=?', runs[1])).toEqual([{ status: 'running' }]);
 expect(network).not.toHaveBeenCalled();
});
it('runtime WhatsApp authority uses the pinned persona scope without dispatch or durable writes', async () => {
 const before = snapshot(), changes = db.all('SELECT total_changes() AS n');
 const body = nativeBody('whatsapp-read-authorize');
 const allowed = await request('/internal/whatsapp-read-authorize', 'runtime', body);
 expect(allowed.status).toBe(200); expect(await allowed.json()).toEqual({ allowed: true, deadline_at: '2026-09-10T00:20:00.000Z' });
 const foreignTask = await request('/internal/whatsapp-read-authorize', 'runtime', { ...body, run_id: runs[1] });
 expect(foreignTask.status).toBe(403);
 const text = await foreignTask.text(); expect(JSON.parse(text)).toMatchObject({ error: { code: 'FORBIDDEN' } });
 for (const value of canaries) expect(text).not.toContain(value);
 expect(snapshot()).toEqual(before); expect(db.all('SELECT total_changes() AS n')).toEqual(changes);
 expect(setAlarm).not.toHaveBeenCalled(); expect(deleteAlarm).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
});
