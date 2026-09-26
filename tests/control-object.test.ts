import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TestDatabase, bot, otherBot, routine } from './helpers';
import { PersonalControl } from '../src/worker/control-object';
import worker from '../src/worker/index';
import { Store } from '../src/core/store';
import { BudgetLedger } from '../src/core/budget';
import type { ControlCore } from '../src/core/control';
import { SKILL_PROPOSE_POLICY } from '../src/core/agent-commands';

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

it('serves only the bundled connector baseline without reconciling overdue work or issuing authority',async()=>{
 await overdue();
 const env={AUTH_MODE:'local',INSTALLATION_ID:'local-only',CONTROL:{getByName:()=>control}} as unknown as Env;
 const request=(origin='http://127.0.0.1',method='GET')=>worker.fetch(new Request(origin+'/v1/connectors/catalog',{method}),env);
 const tables=['objects','commands','runs','occurrences','schedule_state','lifecycle','events','controller_operations','effects','attempts'],before=tables.map(table=>db.all(`SELECT * FROM ${table}`));
 deleteAlarm.mockClear();
 expect((await request('https://control.invalid')).status).toBe(401);
 expect((await request('http://127.0.0.1','POST')).status).toBe(404);
 const response=await request();expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toContain('no-store');
 const result=await response.json() as Extract<Awaited<ReturnType<PersonalControl['getConnectorCatalog']>>,{ok:true}>['value'];expect(result).toMatchObject({scope:'bundled-diagnostic-baseline',runtime_inventory:'unobserved',authority:'not-granted',catalog:{schemaVersion:1,whatsapp:{version:'0.4.0',revision:'9a0a39e61b2271df1a1d7fc1e198f1e37f66aaf8',evidence:{installed:false,artifact:'verified',authorization:'not-checked'},protocol:{whatsapp_get_chat_messages:'incompatible',whatsapp_search_messages:'synthetic-verified'},mutationsAvailable:false,coverage:'unknown'}}});
 expect(result.catalog.whatsapp.protocol.recentReadBlocker).toContain('structuredContent is an array');
 expect(result.catalog.whatsapp.evidenceScope).toContain('no installed, paired or callable runtime');
 const direct=await control.getConnectorCatalog('owner');if(!direct.ok)throw Error('Expected catalog');direct.value.catalog.whatsapp.prerequisites.length=0;
 expect((await request()).status).toBe(200);expect((await control.getConnectorCatalog('owner')).ok).toBe(true);
 expect((await (await request()).json() as typeof result).catalog.whatsapp.prerequisites.length).toBeGreaterThan(0);
 for(let i=0;i<117;i++)expect((await request()).status).toBe(200);expect((await request()).status).toBe(429);
 expect(tables.map(table=>db.all(`SELECT * FROM ${table}`))).toEqual(before);expect(setAlarm).not.toHaveBeenCalled();expect(deleteAlarm).not.toHaveBeenCalled();
 const internals=control as unknown as {core:{ownerAlpha:{policy:unknown}}};
 Object.defineProperty(internals.core.ownerAlpha,'policy',{value:{session_id:randomUUID()}});
 expect(await control.getConnectorCatalog('fresh-alpha-owner')).toMatchObject({ok:false,error:{code:'CAPABILITY_UNAVAILABLE'}});
});

it('serves rate-limited owner schedule previews without reconciliation or wake',async()=>{
 const env={AUTH_MODE:'local',INSTALLATION_ID:'local-only',CONTROL:{getByName:()=>control}} as unknown as Env;
 const request=(cron:string,timezone:string,origin='http://127.0.0.1')=>worker.fetch(new Request(`${origin}/v1/schedules/preview?${new URLSearchParams({cron,timezone})}`),env);
 const tables=['objects','commands','runs','occurrences','schedule_state','lifecycle','events','controller_operations'],before=tables.map(table=>db.all(`SELECT * FROM ${table}`));setAlarm.mockClear();
 expect((await request('23 9 * * 1-5','Asia/Jakarta','https://control.invalid')).status).toBe(401);
 const response=await request('23 9 * * 1-5','Asia/Jakarta');expect(response.status).toBe(200);
 expect(await response.json()).toEqual({schedule:{cron:'23 9 * * 1-5',timezone:'Asia/Jakarta'},observed_at:'2026-09-10T00:00:00.000Z',next_times:['2026-09-10T02:23:00.000Z','2026-09-11T02:23:00.000Z','2026-09-14T02:23:00.000Z']});
 for(const [cron,zone] of [['','UTC'],['0 8 * * *',''],['x'.repeat(129),'UTC'],['* * * * *','UTC'],['0 8 * * *','Invalid/Zone']])expect((await request(cron,zone)).status).toBe(422);
 for(let n=6;n<30;n++)await request('', 'UTC');expect((await request('0 8 * * *','UTC')).status).toBe(429);
 expect(tables.map(table=>db.all(`SELECT * FROM ${table}`))).toEqual(before);expect(setAlarm).not.toHaveBeenCalled();
});

it('persists owner roster commands idempotently without task or lifecycle effects and rejects nonlocal bypass',async()=>{
 const env={AUTH_MODE:'local',INSTALLATION_ID:'local-only',CONTROL:{getByName:()=>control}} as unknown as Env;
 const key=randomUUID(),section=randomUUID(),payload={expected_revision:0,sections:[{id:section,name:'Travel group',persona_ids:[otherBot,bot],collapsed:true}],hidden_persona_ids:[bot]};
 const post=(origin:string,p=payload,k=key)=>worker.fetch(new Request(`${origin}/v1/commands`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':k,Origin:origin},body:JSON.stringify({schema_version:1,type:'roster.set',payload:p})}),env);
 const tables=['objects','object_revisions','runs','attempts','effects','resource_locks','events','lifecycle','controller_operations'];
 const before=tables.map(table=>db.all(`SELECT * FROM ${table}`));
 expect((await post('https://control.invalid')).status).toBe(401);
 const response=await post('http://127.0.0.1'),receipt=await response.json();expect(response.status).toBe(202);expect(receipt).toMatchObject({status:'applied',resource_id:'roster-layout'});
 expect(await (await post('http://127.0.0.1')).json()).toEqual(receipt);
 expect(await control.getState('owner')).toMatchObject({ok:true,value:{roster:{revision:1,sections:payload.sections,hidden_persona_ids:[bot]}}});
 expect(await (await post('http://127.0.0.1',payload,randomUUID())).json()).toMatchObject({status:'rejected',error:{code:'REVISION_CONFLICT'}});
 expect(tables.map(table=>db.all(`SELECT * FROM ${table}`))).toEqual(before);
 await initialize();expect(await control.getState('owner')).toMatchObject({ok:true,value:{roster:{revision:1,hidden_persona_ids:[bot]}}});
});

async function overdue() {
  const r = routine();
  const result = await control.accept('owner', randomUUID(), 'synthetic', { schema_version: 1, type: 'routine.put', payload: r });
  expect(result).toMatchObject({ ok: true, value: { status: 'applied' } });
  vi.setSystemTime(new Date('2026-09-10T00:31:00.000Z'));
  setAlarm.mockClear();
  return { routine: r, receiptId: result.ok ? result.value.id : '' };
}
const message = () => ({ schema_version: 1, type: 'message.send', payload: { conversation_id: bot, text: 'Independent work' } });

it('serves scoped task pages only after owner authentication and validates page bounds',async()=>{
 await control.accept('owner',randomUUID(),'message',message());
 const env={AUTH_MODE:'local',INSTALLATION_ID:'local-only',CONTROL:{getByName:()=>control}} as unknown as Env;
 const request=(origin:string,query='')=>worker.fetch(new Request(`${origin}/v1/conversations/${bot}/tasks${query}`),env);
 expect((await request('https://control.invalid')).status).toBe(401);
 const response=await request('http://127.0.0.1');expect(response.status).toBe(200);
 expect(await response.json()).toMatchObject({counts:{total:1,waiting:1,recovery:0},runs:[{persona_id:bot,status:'waiting',request_status:'applied'}]});
 expect((await request('http://127.0.0.1','?limit=11')).status).toBe(422);
 expect((await request('http://127.0.0.1','?after=invalid')).status).toBe(422);
 expect((await worker.fetch(new Request(`http://127.0.0.1/v1/conversations/${otherBot}/tasks`),env)).status).toBe(200);
});

it('stages task-sourced owner drafts through command HTTP without copying task input or dispatching work',async()=>{
 await initialize(true);await control.accept('owner',randomUUID(),'source-message',message());
 const run=db.all<{id:string}>('SELECT id FROM runs')[0].id,identity={epoch:1,boot_id:randomUUID()};
 db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=1,lease_until='2026-09-10T00:02:00.000Z'");
 for(const [type,payload] of [['boot',{boot_id:identity.boot_id}],['ready',{identity}],['claim',{identity}]])expect(await control.runtime({type,payload})).toMatchObject({ok:true});
 const env={AUTH_MODE:'local',INSTALLATION_ID:'local-only',CONTROL:{getByName:()=>control}} as unknown as Env,key=randomUUID();
 const body={name:'Owner corrected process',description:'Generic procedure',when_to_use:'When reviewing totals',inputs_access:[],steps:['Check the units'],decision_rules:[],validation:['Recompute'],output:'Review',failure_handling:['Ask'],approval_boundaries:['No effects'],contains_private_facts:false};
 const command={schema_version:1,type:'skill.propose_from_task',payload:{proposal_id:randomUUID(),skill_id:randomUUID(),expected_skill_revision:0,source_run_id:run,expected_attempt:1,body}};
 const post=(origin='http://127.0.0.1')=>worker.fetch(new Request(origin+'/v1/commands',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,'Idempotency-Key':key},body:JSON.stringify(command)}),env);
 expect((await post('https://control.invalid')).status).toBe(401);
 const before=db.all('SELECT * FROM runs'),response=await post(),receipt=await response.json();expect(response.status).toBe(202);expect(receipt).toMatchObject({status:'applied',resource_id:command.payload.proposal_id});
 expect(await (await post()).json()).toEqual(receipt);
 expect(db.all('SELECT * FROM runs')).toEqual(before);expect(db.all('SELECT * FROM skill_enablements')).toEqual([]);
 expect(db.all('SELECT body_json,provenance_json,status FROM skill_proposals')).toEqual([{body_json:JSON.stringify(body),provenance_json:JSON.stringify({kind:'task',source_ref:`task:${bot}/${run}/1`}),status:'pending'}]);
});

it('routes authenticated bounded skill discovery through the real runtime schema and SQLite boundary',async()=>{
 await initialize(true);const store=new Store(db),persona=store.get(bot,'persona');
 store.put(bot,'persona',{...persona.body,tool_policy_ids:[SKILL_PROPOSE_POLICY]},persona.revision,'owner',new Date().toISOString());
 const skill=randomUUID();store.put(skill,'skill',{name:'Review method',description:'Review metadata',when_to_use:'Before review',steps:['SECRET BODY'],references:[{name:'secret.md',text:'SECRET REFERENCE'}]},0,'owner',new Date().toISOString());
 await control.accept('owner',randomUUID(),'search-message',message());
 const run=db.all<{id:string}>('SELECT id FROM runs')[0].id,identity={epoch:1,boot_id:randomUUID()};
 db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=1,lease_until='2026-09-10T00:02:00.000Z'");
 for(const [type,payload] of [['boot',{boot_id:identity.boot_id}],['ready',{identity}],['claim',{identity}]])expect(await control.runtime({type,payload})).toMatchObject({ok:true});
 const env={RUNTIME_TOKEN:'synthetic-token',INSTALLATION_ID:'local-only',CONTROL:{getByName:()=>control}} as unknown as Env;
 const payload={identity,run_id:run,attempt:1,query:'REVIEW'},post=(body:unknown,token='synthetic-token')=>worker.fetch(new Request('https://control.invalid/internal/agent-skill-search',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)}),env);
 expect((await post(payload,'wrong')).status).toBe(401);
 for(const extra of [{query:''},{query:'x'.repeat(201)},{after:'invalid'},{skill_id:skill}])expect((await post({...payload,...extra})).status).toBe(422);
 const response=await post(payload);expect(response.status).toBe(200);expect(await response.json()).toEqual({skills:[{id:skill,revision:1,name:'Review method',description:'Review metadata',when_to_use:'Before review'}],next_cursor:null});
 expect((await post({...payload,identity:{...identity,epoch:2}})).status).toBe(409);
 await initialize(false);expect((await post(payload)).status).toBe(409);
});

it('authenticates provisional output, rejects malformed/old custody and acknowledges cancelled display without resurrection',async()=>{
 await initialize(true);await control.accept('owner',randomUUID(),'message',message());
 const run=db.all<{id:string}>('SELECT id FROM runs')[0].id,identity={epoch:1,boot_id:randomUUID()};
 db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=1,lease_until='2026-09-10T00:02:00.000Z'");
 for(const [type,payload] of [['boot',{boot_id:identity.boot_id}],['ready',{identity}],['claim',{identity}],['submitted',{identity,run_id:run,attempt:1,native_ref:'native-43'}]])
  expect(await control.runtime({type,payload})).toMatchObject({ok:true});
 const env={RUNTIME_TOKEN:'synthetic-token',INSTALLATION_ID:'local-only',CONTROL:{getByName:()=>control}} as unknown as Env;
 const payload={identity,run_id:run,attempt:1,native_ref:'native-43',version:1,text:'Provisional only',truncated:false};
 const post=(body:unknown,token='synthetic-token')=>worker.fetch(new Request('https://control.invalid/internal/output-preview',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)}),env);
 expect((await post(payload,'wrong')).status).toBe(401);
 expect((await post({...payload,unexpected:true})).status).toBe(422);
 expect((await post({...payload,identity:{...identity,epoch:2}})).status).toBe(409);
 expect(await (await post(payload)).json()).toEqual({accepted:true});
 expect(await (await post(payload)).json()).toEqual({accepted:true});
 expect(await control.getState('owner')).toMatchObject({ok:true,value:{output_previews:[{run_id:run,text:'Provisional only'}]}});
 await control.accept('owner',randomUUID(),'cancel',{schema_version:1,type:'run.cancel',payload:{run_id:run,reason:'Stop'}});
 expect(await (await post({...payload,version:2,text:'Late output'})).json()).toEqual({accepted:false,reason:'OUTPUT_FENCED'});
 expect(await control.getState('owner')).toMatchObject({ok:true,value:{output_previews:[]}});
 expect(db.all('SELECT status FROM runs WHERE id=?',run)).toEqual([{status:'cancelling'}]);
});

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

it('owner export enforces HTTP authentication before reading or spending its rate allowance', async () => {
  const env = { AUTH_MODE: 'access', ACCESS_ISSUER: 'https://synthetic.cloudflareaccess.com', ACCESS_AUD: 'portal', OWNER_SUB: 'owner',
    INSTALLATION_ID: 'local-only', CONTROL: { getByName: () => control } } as unknown as Env;
  const exportSpy = vi.spyOn(control, 'getControlExport');
  const denied = await worker.fetch(new Request('https://control.invalid/v1/export/control', {
    headers: { Authorization: 'Bearer synthetic-runtime-token', 'Cf-Access-Authenticated-User-Email': 'owner@example.com' },
  }), env);
  expect(denied.status).toBe(401); expect(exportSpy).not.toHaveBeenCalled();
  expect(db.all("SELECT * FROM rate_limits WHERE subject LIKE '%:export'")).toEqual([]);
  const local = { ...env, AUTH_MODE: 'local' };
  expect((await worker.fetch(new Request('https://control.invalid/v1/export/control'), local)).status).toBe(401);
  const response = await worker.fetch(new Request('http://127.0.0.1/v1/export/control'), local);
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(response.headers.get('Content-Disposition')).toContain('attachment');
  expect((await response.json() as { format: string }).format).toBe('hehebot-control-export');
  expect(exportSpy).toHaveBeenCalledExactlyOnceWith('local-owner');
  exportSpy.mockRestore();
});

it('export rate window is bounded without missed-alarm maintenance or runtime wake', async () => {
  await overdue(); deleteAlarm.mockClear();
  const before = db.all('SELECT * FROM schedule_state');
  for (let n = 0; n < 2; n++) {
    const result = await control.getControlExport('owner');
    expect(result.ok).toBe(true);
    if (result.ok) expect((await new Response(result.value).json() as { schemaVersions: number[] }).schemaVersions).toEqual([16]);
  }
  expect(await control.getControlExport('owner')).toMatchObject({ ok: false, status: 429 });
  expect(db.all('SELECT * FROM schedule_state')).toEqual(before);
  expect(db.all('SELECT * FROM occurrences')).toEqual([]);
  expect(setAlarm).not.toHaveBeenCalled(); expect(deleteAlarm).not.toHaveBeenCalled();
  vi.setSystemTime(new Date('2026-09-10T00:32:00.000Z'));
  expect(await control.getControlExport('owner')).toMatchObject({ ok: true });
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

it('arms the exact pre-handoff question cutoff and persists it on alarm without a wake',async()=>{
  const core=(control as unknown as {core:ControlCore}).core;
  const run=randomUUID(),boot=randomUUID(),now=new Date().toISOString(),deadline='2026-09-10T00:00:03.000Z';
  db.exec("UPDATE lifecycle SET epoch=1,boot_id=?,phase='READY',lease_until='2026-09-10T00:20:00.000Z'",boot);
  db.exec("INSERT INTO runs(id,persona_id,context_json,status,current_attempt,created_at,updated_at) VALUES(?,?,?,'running',1,?,?)",run,bot,JSON.stringify(core.context(bot,'Question',null,null)),now,now);
  db.exec("INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,status,native_run_ref,deadline_at) VALUES(?,1,?,1,?,'running','turn','2026-09-10T00:15:00.000Z')",run,randomUUID(),boot);
  const id=core.questions.record({epoch:1,boot_id:boot},run,1,{id:randomUUID(),connection_id:randomUUID(),request_id:1,callback_deadline_at:deadline,
    params:{threadId:'thread',turnId:'turn',itemId:'item',isBlocking:true,questions:[{id:'choice',header:'Choice',question:'Choose'}]}});
  await control.getState('owner');expect(setAlarm).toHaveBeenLastCalledWith(Date.parse(deadline));
  vi.setSystemTime(new Date(deadline));await control.alarm();
  expect(core.questions.get(id)).toMatchObject({state:'pending',restart_required_at:deadline,revision:2});
  expect(db.all('SELECT status,error_code FROM runs WHERE id=?',run)).toEqual([{status:'cancelling',error_code:'NATIVE_QUESTION_RESTART_REQUIRED'}]);
  const before=core.questions.get(id);await control.alarm();expect(core.questions.get(id)).toEqual(before);
  expect(db.all('SELECT * FROM controller_operations')).toEqual([]);
  expect(core.questions.nextCallbackDeadline()).toBeNull();
});

it.each(['resolved','closed'])('%s question retention alarm runs while execution is disabled without wake or task mutation',async state=>{
  const run=randomUUID(),id=randomUUID(),now=new Date().toISOString();
  db.exec("INSERT INTO runs(id,persona_id,context_json,status,current_attempt,created_at,updated_at) VALUES(?,?,'{}','completed',1,?,?)",run,bot,now,now);
  db.exec("INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,status,deadline_at,settled_at) VALUES(?,1,?,1,?,'completed',?,?)",run,randomUUID(),randomUUID(),now,now);
  const row={version:1,id,connection_id:randomUUID(),request_id:19,params:{threadId:'thread',turnId:'turn',itemId:'item',isBlocking:true,
    questions:[{id:'choice',header:'Choice',question:'Synthetic text'}]},revision:2,state:'resolved',run_id:run,attempt:1,epoch:1,
    boot_id:randomUUID(),persona_id:bot,conversation_id:bot,created_at:now,expires_at:'2026-09-10T00:15:00.000Z',
    answers:null,answer_owner_id:null,answer_command_id:null,answered_at:null,response_taken_at:null,resolved_at:now};
  if(state==='closed'){
    db.exec("UPDATE attempts SET status='terminated',boot_id=?,native_run_ref='turn' WHERE run_id=?",row.boot_id,run);
    db.exec('INSERT INTO runtime_metadata VALUES(?,?)',`native-question:${id}`,JSON.stringify({...row,revision:1,state:'pending',resolved_at:null}));
    const command={schema_version:1,type:'question.close',payload:{question_id:id,expected_revision:1,confirm_stopped_closure:true}};
    const key=randomUUID();
    const env={AUTH_MODE:'local',INSTALLATION_ID:'local-only',CONTROL:{getByName:()=>control}} as unknown as Env;
    const post=(origin:string)=>worker.fetch(new Request(`${origin}/v1/commands`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key,Origin:origin},body:JSON.stringify(command)}),env);
    expect((await post('https://control.invalid')).status).toBe(401);
    const response=await post('http://127.0.0.1'),receipt=await response.json();
    expect(response.status).toBe(202);expect(receipt).toMatchObject({status:'applied',resource_id:id});
    expect(await (await post('http://127.0.0.1')).json()).toEqual(receipt);
    const closed=JSON.parse(db.all<{value_json:string}>('SELECT value_json FROM runtime_metadata WHERE key=?',`native-question:${id}`)[0].value_json);
    expect(closed).toMatchObject({version:2,state:'closed',resolved_at:null,closed_at:now,close_owner_id:'local-owner'});
  }else db.exec('INSERT INTO runtime_metadata VALUES(?,?)',`native-question:${id}`,JSON.stringify(row));
  const before=['runs','attempts','lifecycle','events','controller_operations'].map(table=>db.all(`SELECT * FROM ${table}`));
  await control.getState('owner');expect(setAlarm).toHaveBeenLastCalledWith(Date.parse('2026-12-09T00:00:00.000Z'));
  vi.setSystemTime(new Date('2026-12-09T00:00:00.000Z'));await control.alarm();
  expect(db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'native-question:*'")).toEqual([]);
  expect(['runs','attempts','lifecycle','events','controller_operations'].map(table=>db.all(`SELECT * FROM ${table}`))).toEqual(before);
  expect(deleteAlarm).toHaveBeenCalled();
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
