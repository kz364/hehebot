import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { bindOwnerAuth, issueRuntimeTaskToken, type AuthConfig } from '../src/worker/auth';
import { PersonalControl } from '../src/worker/control-object';
import worker from '../src/worker/index';
import { exportControl } from '../src/core/control-export';
import { importControlExport } from '../scripts/import-control-export.mjs';
import { TestDatabase } from './helpers';
import { bot, routine } from './helpers';
import { ownerAlphaSuccessorSha256, type OwnerAlphaPolicy } from '../src/core/owner-alpha';

vi.mock('cloudflare:workers', () => ({ DurableObject: class {
  constructor(public ctx: unknown, public env: unknown) {}
} }));
vi.mock('../DB/schema.sql', () => ({ default: '' }));

const access = (overrides: Partial<AuthConfig> = {}): AuthConfig => ({
  AUTH_MODE: 'access',
  INSTALLATION_ID: 'installation-43',
  ACCESS_ISSUER: 'https://owner-team.cloudflareaccess.com',
  ACCESS_AUD: 'portal-audience-71',
  OWNER_SUB: 'owner-subject-29',
  ...overrides,
});
const expectedBinding = (config: AuthConfig) => JSON.stringify({
  auth_mode: config.AUTH_MODE,
  installation_id: config.INSTALLATION_ID,
  issuer: config.ACCESS_ISSUER,
  audience: config.ACCESS_AUD,
  owner_subject: config.OWNER_SUB,
});
const ownerRows = (db: TestDatabase) => db.all<{ value_json: string }>(
  "SELECT value_json FROM runtime_metadata WHERE key='installation_owner'",
);

function construct(db: TestDatabase, auth: AuthConfig, overrides: Partial<Env> = {}) {
  let initialized: Promise<unknown> = Promise.resolve();
  let alarm: number | null = null;
  const ctx = {
    storage: {
      sql: { exec: (sql: string, ...values: (string | number | null)[]) => {
        const rows = db.all(sql, ...values);
        return { toArray: () => rows };
      } },
      transactionSync: <T>(fn: () => T) => db.transaction(fn),
      getAlarm: vi.fn(async () => alarm),
      setAlarm: vi.fn(async (time: number) => { alarm = time; }),
      deleteAlarm: vi.fn(async () => { alarm = null; }),
    },
    blockConcurrencyWhile: (fn: () => Promise<unknown>) => { initialized = fn(); },
  };
  const env = {
    ...auth,
    EXECUTION_ENABLED: 'false', NATIVE_VERIFIED: 'false', PROVIDER_CONFIG: '{}',
    ACTION_POLICY_IDS: '[]', TOOL_POLICY_IDS: '[]', TRIGGER_CONFIG: '{}',
    ...overrides,
  } as unknown as Env;
  const control = new PersonalControl(ctx as unknown as DurableObjectState, env);
  return { control, initialized };
}

const hostedDigest = 'd167d266bdd34b51eb916816899830e9810c2d32283e61ebd0a6b5dc7bfe7897';
const hostedPolicy = (): OwnerAlphaPolicy => ({
  session_id: randomUUID(), persona_id: bot, expires_at: '2026-09-16T00:01:00.000Z',
  max_runs: 1, max_task_seconds: 45,
});
const hostedConfig = (policy: OwnerAlphaPolicy, digest = hostedDigest) => JSON.stringify({
  owner_binding_sha256: digest, policy,
});
const custodyTables = (db: TestDatabase) => Object.fromEntries([
  'runtime_metadata', 'objects', 'commands', 'runs', 'attempts', 'operations', 'effects',
  'resource_locks', 'controller_operations', 'lifecycle',
].map(table => [table, db.all(`SELECT * FROM ${table} ORDER BY rowid`)]));

const databases: TestDatabase[] = [];
const database = () => { const db = new TestDatabase(); databases.push(db); return db; };
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

it('binds the exact Access owner on fresh data and reconstructs idempotently before seeding', async () => {
  const db = database(), config = access();
  const first = construct(db, config);
  await first.initialized;
  expect(ownerRows(db)).toEqual([{ value_json: expectedBinding(config) }]);
  const seeded = db.all('SELECT * FROM objects ORDER BY id');
  expect(seeded.length).toBeGreaterThan(0);

  const before = db.all('SELECT * FROM runtime_metadata ORDER BY key');
  const second = construct(db, config);
  await second.initialized;
  expect(ownerRows(db)).toEqual([{ value_json: expectedBinding(config) }]);
  expect(db.all('SELECT * FROM runtime_metadata ORDER BY key')).toEqual(before);
  expect(db.all('SELECT * FROM objects ORDER BY id')).toEqual(seeded);
});

it('exposes only the stable binding digest on runtime-authenticated status', async () => {
  const db = database(), config = access(), first = construct(db, config);
  await first.initialized;
  const env = { ...config, RUNTIME_TOKEN: 'runtime-secret-19', CONTROL: { getByName: () => first.control } } as unknown as Env;
  const request = (token: string) => worker.fetch(new Request('https://portal.example/internal/status', {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: '{}',
  }), env);
  expect((await request('wrong-token')).status).toBe(401);
  const response = await request('runtime-secret-19');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ phase: 'STOPPED', epoch: 0, execution_enabled: false,
    owner_binding_sha256: 'd167d266bdd34b51eb916816899830e9810c2d32283e61ebd0a6b5dc7bfe7897' });
  const second = construct(db, config); await second.initialized;
  expect(await second.control.runtime({ type: 'status', payload: {} })).toEqual(await first.control.runtime({ type: 'status', payload: {} }));
  expect(JSON.stringify((await first.control.getState(config.OWNER_SUB)))).not.toContain('owner_binding_sha256');
});

it('leaves the local runtime status shape unchanged', async () => {
  const local = construct(database(), access({ AUTH_MODE: 'local', INSTALLATION_ID: 'local-only' }));
  await local.initialized;
  expect(await local.control.runtime({ type: 'status', payload: {} })).toEqual({ ok: true,
    value: { phase: 'STOPPED', epoch: 0, execution_enabled: false } });
});

it.each([
  ['owner', { OWNER_SUB: 'different-owner' }],
  ['issuer', { ACCESS_ISSUER: 'https://other-team.cloudflareaccess.com' }],
  ['audience', { ACCESS_AUD: 'different-audience' }],
  ['installation', { INSTALLATION_ID: 'different-installation' }],
  ['local downgrade', { AUTH_MODE: 'local', INSTALLATION_ID: 'local-only', ACCESS_ISSUER: '', ACCESS_AUD: '', OWNER_SUB: '' }],
] as const)('rejects changed %s without overwriting the binding or private data', async (_name, changes) => {
  const db = database(), config = access();
  await construct(db, config).initialized;
  db.exec("INSERT INTO runtime_metadata(key,value_json) VALUES('private-canary',?)", JSON.stringify({ secret: 'PRIVATE_CANARY_83' }));
  const before = db.all('SELECT * FROM runtime_metadata ORDER BY key');

  await expect(construct(db, { ...config, ...changes }).initialized).rejects.toMatchObject({ code: 'OWNER_MIGRATION_REQUIRED' });
  expect(db.all('SELECT * FROM runtime_metadata ORDER BY key')).toEqual(before);
  expect(db.all("SELECT value_json FROM runtime_metadata WHERE key='private-canary'")).toEqual([
    { value_json: JSON.stringify({ secret: 'PRIVATE_CANARY_83' }) },
  ]);
});

it('refuses first Access adoption of populated unbound data without reassigning it', () => {
  const db = database();
  db.exec("INSERT INTO runtime_metadata(key,value_json) VALUES('private-canary',?)", JSON.stringify({ secret: 'PRIVATE_CANARY_97' }));
  const before = db.all('SELECT * FROM runtime_metadata ORDER BY key');
  expect(() => bindOwnerAuth(db, access())).toThrowError(expect.objectContaining({ code: 'OWNER_MIGRATION_REQUIRED' }));
  expect(db.all('SELECT * FROM runtime_metadata ORDER BY key')).toEqual(before);
  expect(ownerRows(db)).toEqual([]);
});

it('refuses unbound private objects even when no runtime metadata or commands exist', () => {
  const db = database();
  db.exec("INSERT INTO objects(id,kind,revision,body_json,created_at,updated_at) VALUES('private-object-43','memory',1,?, '2026-09-16T00:00:00Z','2026-09-16T00:00:00Z')", JSON.stringify({ text: 'PRIVATE_OBJECT_71' }));
  const before = db.all('SELECT * FROM objects');
  expect(() => bindOwnerAuth(db, access())).toThrowError(expect.objectContaining({ code: 'OWNER_MIGRATION_REQUIRED' }));
  expect(db.all('SELECT * FROM objects')).toEqual(before);
  expect(ownerRows(db)).toEqual([]);
});

it('leaves existing unbound local-only data unchanged', () => {
  const db = database();
  db.exec("INSERT INTO runtime_metadata(key,value_json) VALUES('local-canary','\"LOCAL_PRIVATE_19\"')");
  const before = db.all('SELECT * FROM runtime_metadata ORDER BY key');
  bindOwnerAuth(db, access({ AUTH_MODE: 'local', INSTALLATION_ID: 'local-only', ACCESS_ISSUER: '', ACCESS_AUD: '', OWNER_SUB: '' }));
  expect(db.all('SELECT * FROM runtime_metadata ORDER BY key')).toEqual(before);
  expect(ownerRows(db)).toEqual([]);
});

it.each([
  { ACCESS_ISSUER: 'http://owner-team.cloudflareaccess.com' },
  { ACCESS_ISSUER: 'https://example.com' },
  { ACCESS_AUD: '' },
  { OWNER_SUB: '' },
  { INSTALLATION_ID: '' },
])('does not write for invalid fresh Access configuration %#', changes => {
  const db = database(), before = db.all('SELECT * FROM runtime_metadata');
  expect(() => bindOwnerAuth(db, access(changes))).toThrowError(expect.objectContaining({ code: 'AUTH_CONFIGURATION_REQUIRED' }));
  expect(db.all('SELECT * FROM runtime_metadata')).toEqual(before);
});

it('retains the installation owner through application export and import', async () => {
  const db = database(), config = access();
  bindOwnerAuth(db, config);
  const directory = await mkdtemp(join(tmpdir(), 'hehe-owner-binding-'));
  const input = join(directory, 'control-export.json'), destination = join(directory, 'restored');
  try {
    await writeFile(input, exportControl(db, '2026-09-16T00:00:00.000Z'), { mode: 0o600 });
    expect(await importControlExport(input, destination)).toMatchObject({ status: 'verified', activation_allowed: false });
    const restored = new DatabaseSync(join(destination, 'control.sqlite'), { readOnly: true });
    try {
      expect(restored.prepare("SELECT value_json FROM runtime_metadata WHERE key='installation_owner'").all()).toEqual([
        { value_json: expectedBinding(config) },
      ]);
    } finally { restored.close(); }
    expect(JSON.parse(await readFile(join(destination, 'manifest.json'), 'utf8'))).toMatchObject({ counts: { runtime_metadata: 1 } });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('runs the hosted owner alpha through Worker runtime HTTP, persists its preview, and enforces the one-run quota', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-16T00:00:00.000Z'));
  const network = vi.fn(() => { throw new Error('Unexpected provider call'); });
  vi.stubGlobal('fetch', network);
  try {
    const db = database(), config = access(), policy = hostedPolicy(), token = 'hosted-runtime-token';
    let host = construct(db, config, { HEHEBOT_HOSTED_OWNER_ALPHA: hostedConfig(policy) });
    await host.initialized;
    let env = { ...config, RUNTIME_TOKEN: token, CONTROL: { getByName: () => host.control } } as unknown as Env;
    const runtime = async (type: string, payload: unknown, expected = 200) => {
      const response = await worker.fetch(new Request(`https://portal.example/internal/${type}`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }), env);
      expect(response.status, type).toBe(expected);
      return response.json() as Promise<any>;
    };
    expect(await runtime('status', {})).toEqual({ phase: 'STOPPED', epoch: 0, execution_enabled: false,
      owner_alpha: policy, owner_alpha_hosted: true, owner_binding_sha256: hostedDigest });
    expect(JSON.stringify((await host.control.getState(config.OWNER_SUB)))).not.toContain('owner_alpha_hosted');
    expect(db.all<{ value_json: string }>("SELECT value_json FROM runtime_metadata WHERE key='owner_alpha'")).toEqual([
      { value_json: JSON.stringify({ policy, admitted_run_ids: [] }) },
    ]);

    const identity = await runtime('boot', { boot_id: randomUUID() });
    await runtime('ready', { identity });
    const accepted = await host.control.accept(config.OWNER_SUB, randomUUID(), randomUUID(), {
      schema_version: 1, type: 'message.send', payload: { conversation_id: bot, text: 'Hosted bounded request' },
    });
    expect(accepted).toMatchObject({ ok: true, value: { status: 'applied' } });
    const claim = await runtime('claim', { identity });
    expect(claim).toMatchObject({ run: { id: (accepted as any).value.resource_id }, deadline_at: '2026-09-16T00:00:45.000Z' });
    const scope = { identity, run_id: claim.run.id, attempt: 1, native_ref: 'native:hosted-owner-alpha' };
    await runtime('submitted', scope);
    const exactPreview = { ...scope, version: 7, text: 'Exact hosted provisional reply', truncated: true };
    expect(await runtime('output-preview', exactPreview)).toEqual({ accepted: true });

    host = construct(db, config, { HEHEBOT_HOSTED_OWNER_ALPHA: hostedConfig(policy) });
    await host.initialized;
    env = { ...env, CONTROL: { getByName: () => host.control } } as unknown as Env;
    expect(await host.control.getState(config.OWNER_SUB)).toMatchObject({ ok: true, value: { output_previews: [{
      run_id: claim.run.id, attempt: 1, version: 7, text: exactPreview.text, truncated: true,
    }] } });
    expect(await runtime('status', {})).toMatchObject({ phase: 'READY', owner_alpha_hosted: true });
    const extra = await host.control.accept(config.OWNER_SUB, randomUUID(), randomUUID(), {
      schema_version: 1, type: 'message.send', payload: { conversation_id: bot, text: 'Over quota' },
    });
    expect(db.all('SELECT status FROM runs WHERE id=?', (extra as any).value.resource_id)).toEqual([{ status: 'waiting' }]);
    expect(await runtime('claim', { identity })).toBeNull();
    expect(network).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

it('binds a rotated runtime credential to the active successor and cannot mutate predecessor custody', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-16T00:00:00.000Z'));
  try {
    const db=database(),config=access(),policy=hostedPolicy(),oldBoot=randomUUID(),nextBoot=randomUUID(),transitionId=randomUUID();
    const successor={schema_version:1 as const,transition_id:transitionId,owner_binding_sha256:hostedDigest,
      predecessor:{session_id:policy.session_id,epoch:1,boot_id:oldBoot},retirement_receipt_sha256:'a'.repeat(64),
      successor:{policy:{session_id:randomUUID(),persona_id:policy.persona_id,expires_at:'2026-09-16T00:03:00.000Z',max_runs:1,max_task_seconds:45,
        text_only:{profile_version:'codex-text-only-v1' as const,profile_sha256:'b'.repeat(64)}},boot_id:nextBoot}};
    let host=construct(db,config,{HEHEBOT_HOSTED_OWNER_ALPHA:hostedConfig(policy),HEHEBOT_OWNER_ALPHA_SUCCESSOR:JSON.stringify(successor)});
    await host.initialized;
    const predecessor=(await host.control.runtime({type:'boot',payload:{boot_id:oldBoot}}) as any).value;
    vi.setSystemTime(new Date('2026-09-16T00:01:01.000Z'));
    db.exec("UPDATE lifecycle SET phase='RECOVERY_REQUIRED',desired_state='STOP',lease_until=?",policy.expires_at);
    const activation={schema_version:1 as const,type:'owner-alpha.activate' as const,payload:{transition_id:transitionId,envelope_sha256:ownerAlphaSuccessorSha256(successor)}};
    expect(await host.control.accept(config.OWNER_SUB,randomUUID(),await import('../src/worker/http').then(m=>m.digest(activation)),activation)).toMatchObject({ok:true,value:{status:'applied'}});

    // Reconstruction no longer depends on retaining the pending successor grant.
    host=construct(db,config,{HEHEBOT_HOSTED_OWNER_ALPHA:hostedConfig(policy)});await host.initialized;
    const authority=JSON.stringify({epoch:2,boot_id:nextBoot,transition_id:transitionId});
    const currentToken='successor-runtime-token',oldToken='predecessor-runtime-token';
    const env={...config,RUNTIME_TOKEN:currentToken,HEHEBOT_RUNTIME_GENERATION:authority,CONTROL:{getByName:()=>host.control}} as unknown as Env;
    const call=(token:string,type:string,payload:unknown)=>worker.fetch(new Request(`https://portal.example/internal/${type}`,{
      method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(payload)}),env);
    const before=custodyTables(db);
    for(const [type,payload] of [
      ['claim',{identity:predecessor}],
      ['submitted',{identity:predecessor,run_id:randomUUID(),attempt:1,native_ref:'predecessor-turn'}],
      ['complete',{identity:predecessor,run_id:randomUUID(),attempt:1,result:{status:'completed',text:'predecessor'}}],
    ] as const)expect((await call(oldToken,type,payload)).status,type).toBe(401);
    expect(custodyTables(db)).toEqual(before);

    for(const [type,payload] of [
      ['claim',{identity:predecessor}],
      ['submitted',{identity:predecessor,run_id:randomUUID(),attempt:1,native_ref:'predecessor-turn'}],
      ['complete',{identity:predecessor,run_id:randomUUID(),attempt:1,result:{status:'completed',text:'predecessor'}}],
    ] as const)expect((await call(currentToken,type,payload)).status,type).toBe(409);
    expect(custodyTables(db)).toEqual(before);
    expect((await call(currentToken,'status',{})).status).toBe(200);
    expect((await call(currentToken,'boot',{boot_id:oldBoot})).status).toBe(409);
    expect(custodyTables(db)).toEqual(before);
    for(const pin of [undefined,JSON.stringify({epoch:2,boot_id:nextBoot,transition_id:randomUUID()})]){
      env.HEHEBOT_RUNTIME_GENERATION=pin;
      expect((await call(currentToken,'status',{})).status).toBe(409);
      expect((await call(currentToken,'boot',{boot_id:nextBoot})).status).toBe(409);
      expect(custodyTables(db)).toEqual(before);
    }
    env.HEHEBOT_RUNTIME_GENERATION=JSON.stringify({epoch:2,boot_id:nextBoot,transition_id:transitionId,extra:true});
    expect((await call(currentToken,'status',{})).status).toBe(503);
    expect((await call(oldToken,'status',{})).status).toBe(401);
    expect(custodyTables(db)).toEqual(before);
  } finally { vi.useRealTimers(); }
});

it('separates manager and message-bound task credentials through the Worker and durable object', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-16T00:00:00.000Z'));
  const network=vi.fn(()=>{throw new Error('Unexpected provider call');});
  vi.stubGlobal('fetch',network);
  try {
    const db=database(),config=access(),policy=hostedPolicy(),boot=randomUUID();
    const initial=construct(db,config,{HEHEBOT_HOSTED_OWNER_ALPHA:hostedConfig(policy)});
    await initial.initialized;
    expect(await initial.control.runtime({type:'boot',payload:{boot_id:boot}})).toMatchObject({ok:true});
    vi.setSystemTime(new Date('2026-09-16T00:02:00.000Z'));
    await initial.control.getState(config.OWNER_SUB);
    const secrets={RUNTIME_TOKEN:'legacy-test-token',HEHEBOT_OWNER_ALPHA_MANAGER_TOKEN:'manager-test-'.repeat(4),HEHEBOT_OWNER_ALPHA_TASK_SIGNING_KEY:'signing-test-'.repeat(4)};
    const settings={...secrets,HEHEBOT_HOSTED_OWNER_ALPHA:hostedConfig(policy),
      HEHEBOT_OWNER_ALPHA_BOOTSTRAP:JSON.stringify({installation_id:config.INSTALLATION_ID,owner_id:config.OWNER_SUB,owner_binding_sha256:hostedDigest,
        policy_revision:'worker-trial',persona_id:bot,text_only:{profile_version:'codex-text-only-v1',profile_sha256:'c'.repeat(64)},
        expires_at:'2026-09-16T00:10:00.000Z',session_seconds:120,max_task_seconds:37,prior_cost_micro_usd:137000,
        prior_cost_source:'synthetic-test-only',total_cap_micro_usd:10000000,reservation_micro_usd:3000000}),
      HEHEBOT_OWNER_ALPHA_WAKE:JSON.stringify({url:'https://fixture.sprites.app'}),PROVIDER_TOKEN:'provider-fixture-'.repeat(3),HEHEBOT_OWNER_ALPHA_WAKE_TOKEN:'wake-fixture-'.repeat(3)};
    const host=construct(db,config,settings);await host.initialized;
    const env={...config,...settings,CONTROL:{getByName:()=>host.control}} as unknown as Env;
    const call=(token:string,type:string,payload:unknown={})=>worker.fetch(new Request(`https://portal.example/internal/${type}`,{
      method:'POST',headers:{Authorization:`Bearer ${token}`},body:JSON.stringify(payload),
    }),env);
    const manager=secrets.HEHEBOT_OWNER_ALPHA_MANAGER_TOKEN;
    expect(await (await call(manager,'manager/manifest')).json()).toBeNull();
    expect((await call(secrets.RUNTIME_TOKEN,'manager/manifest')).status).toBe(401);
    expect((await call(manager,'status')).status).toBe(401);
    expect((await call(secrets.RUNTIME_TOKEN,'status')).status).toBe(401);
    const report={epoch:1,boot_id:boot,session_id:policy.session_id,transition_id:null,observed_at:new Date().toISOString(),
      direct_child_stopped:true,execution_lock_free:true,session_lock_free:true,source:'trusted-fixture'};
    expect((await call(manager,'manager/retirement',report)).status).toBe(200);
    const before=custodyTables(db);
    await host.control.getState(config.OWNER_SUB);
    await host.control.getTimeline(config.OWNER_SUB,bot);
    expect(await (await call(manager,'manager/manifest')).json()).toBeNull();
    expect(custodyTables(db)).toEqual(before);
    const command={
      schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'Only this newly persisted message'},
    };
    const accepted=await host.control.accept(config.OWNER_SUB,randomUUID(),createHash('sha256').update(JSON.stringify(command)).digest('hex'),command) as any;
    expect(accepted).toMatchObject({ok:true,value:{status:'applied'}});
    const response=await call(manager,'manager/manifest');expect(response.status).toBe(200);
    const staged=await response.json() as any;
    expect(staged.grant).toMatchObject({run_id:accepted.value.resource_id,epoch:2,issued_at:'2026-09-16T00:02:00.000Z',expires_at:'2026-09-16T00:04:00.000Z'});
    expect(staged.policy).toMatchObject({persona_id:bot,max_runs:1,max_task_seconds:37,expires_at:staged.grant.expires_at});
    expect(await (await call(manager,'manager/manifest')).json()).toEqual(staged);
    expect((await call(staged.runtime_token,'manager/manifest')).status).toBe(401);
    expect((await call(staged.runtime_token,'manager/retirement',report)).status).toBe(401);
    expect((await call(staged.runtime_token,'status')).status).toBe(200);
    for(const grant of [{...staged.grant,run_id:randomUUID()},{...staged.grant,manifest_sha256:'e'.repeat(64)}]){
      const mismatched=await issueRuntimeTaskToken(grant,secrets.HEHEBOT_OWNER_ALPHA_TASK_SIGNING_KEY);
      expect((await call(mismatched,'status')).status).toBe(409);
    }
    const identity={epoch:staged.grant.epoch,boot_id:staged.grant.boot_id};
    expect((await call(staged.runtime_token,'submitted',{identity,run_id:randomUUID(),attempt:1,native_ref:'wrong-run'})).status).toBe(403);
    expect((await call(staged.runtime_token,'boot',{boot_id:identity.boot_id})).status).toBe(200);
    expect((await call(staged.runtime_token,'ready',{identity})).status).toBe(200);
    const claimed=await (await call(staged.runtime_token,'claim',{identity})).json() as any;
    expect(claimed.run.id).toBe(accepted.value.resource_id);
    vi.setSystemTime(new Date(staged.grant.expires_at));
    expect((await call(staged.runtime_token,'status')).status).toBe(401);
    expect(await (await call(manager,'manager/manifest')).json()).toBeNull();
    expect(network).not.toHaveBeenCalled();
  } finally {vi.useRealTimers();vi.unstubAllGlobals();}
});

it('denies hosted owner-alpha mutation, effects, completion and sleep without provider calls', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-16T00:00:00.000Z'));
  const network = vi.fn(() => { throw new Error('Unexpected provider call'); });
  vi.stubGlobal('fetch', network);
  try {
    const db = database(), config = access(), policy = hostedPolicy(), token = 'hosted-denial-token';
    const host = construct(db, config, { HEHEBOT_HOSTED_OWNER_ALPHA: hostedConfig(policy) });
    await host.initialized;
    const env = { ...config, RUNTIME_TOKEN: token, CONTROL: { getByName: () => host.control } } as unknown as Env;
    const call = async (type: string, payload: unknown) => worker.fetch(new Request(`https://portal.example/internal/${type}`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    }), env);
    const identity = await (await call('boot', { boot_id: randomUUID() })).json() as any;
    expect((await call('ready', { identity })).status).toBe(200);
    const accepted = await host.control.accept(config.OWNER_SUB, randomUUID(), randomUUID(), {
      schema_version: 1, type: 'message.send', payload: { conversation_id: bot, text: 'No effects' },
    }) as any;
    const claim = await (await call('claim', { identity })).json() as any;
    const scope = { identity, run_id: accepted.value.resource_id, attempt: 1 };
    expect(claim.run.id).toBe(scope.run_id);
    for (const [type, payload] of [
      ['complete', { ...scope, result: { status: 'completed', text: 'Denied final' } }],
      ['effect-intent', { identity, effect: { id: randomUUID(), run_id: scope.run_id, attempt: 1,
        action_key: 'synthetic:hosted-denied', classification: 'idempotent', authorization_ref: randomUUID(),
        request_digest: 'sha256:hosted-denied', provider_idempotency_key: 'hosted-denied' } }],
      ['effect-result', { ...scope, effect_id: randomUUID(), status: 'confirmed', receipt: {} }],
      ['agent-command', { ...scope, idempotency_key: randomUUID(), command: { schema_version: 1, type: 'routine.put', payload: routine() } }],
      ['prepare-sleep', { identity }],
      ['commit-sleep', { identity, stop_token: randomUUID(), queue_sequence: 1, checkpoint: { ok: true } }],
    ] as const) {
      const response = await call(type, payload);
      expect(response.status, type).toBe(409);
      expect(await response.json(), type).toMatchObject({ error: { code: 'CAPABILITY_UNAVAILABLE' } });
    }
    expect(db.all('SELECT * FROM effects')).toEqual([]);
    expect(db.all('SELECT result_json FROM attempts')).toEqual([{ result_json: null }]);
    expect(network).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

it('rolls back a wrong hosted pin on fresh data and preserves every existing custody table', async () => {
  const config = access(), policy = hostedPolicy();
  const fresh = database();
  await expect(construct(fresh, config, { HEHEBOT_HOSTED_OWNER_ALPHA: hostedConfig(policy, '0'.repeat(64)) }).initialized)
    .rejects.toMatchObject({ code: 'OWNER_BINDING_MISMATCH' });
  expect(ownerRows(fresh)).toEqual([]);
  expect(fresh.all('SELECT * FROM objects')).toEqual([]);
  expect(fresh.all("SELECT * FROM runtime_metadata WHERE key='owner_alpha'")).toEqual([]);

  const existing = database(), valid = construct(existing, config, { HEHEBOT_HOSTED_OWNER_ALPHA: hostedConfig(policy) });
  await valid.initialized;
  await valid.control.accept(config.OWNER_SUB, randomUUID(), randomUUID(), {
    schema_version: 1, type: 'message.send', payload: { conversation_id: bot, text: 'Retained custody' },
  });
  const before = custodyTables(existing);
  await expect(construct(existing, config, { HEHEBOT_HOSTED_OWNER_ALPHA: hostedConfig(policy, 'f'.repeat(64)) }).initialized)
    .rejects.toMatchObject({ code: 'OWNER_BINDING_MISMATCH' });
  expect(custodyTables(existing)).toEqual(before);
});

it('fails reconstruction for removed or changed hosted policy and cannot restart used boot state', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-16T00:00:00.000Z'));
  try {
    const db = database(), config = access(), policy = hostedPolicy();
    const first = construct(db, config, { HEHEBOT_HOSTED_OWNER_ALPHA: hostedConfig(policy) });
    await first.initialized;
    const identity = (await first.control.runtime({ type: 'boot', payload: { boot_id: randomUUID() } }) as any).value;
    const before = custodyTables(db);
    await expect(construct(db, config).initialized).rejects.toMatchObject({ code: 'INVALID_CONFIGURATION' });
    await expect(construct(db, config, { HEHEBOT_HOSTED_OWNER_ALPHA: hostedConfig({ ...policy, max_task_seconds: 44 }) }).initialized)
      .rejects.toMatchObject({ code: 'INVALID_CONFIGURATION' });
    expect(custodyTables(db)).toEqual(before);
    const restored = construct(db, config, { HEHEBOT_HOSTED_OWNER_ALPHA: hostedConfig(policy) });
    await restored.initialized;
    expect((await restored.control.runtime({ type: 'boot', payload: { boot_id: randomUUID() } }) as any)).toMatchObject({
      ok: false, error: { code: 'STALE_EPOCH' },
    });
    expect((await restored.control.runtime({ type: 'status', payload: {} }) as any).value).toMatchObject({
      phase: 'BOOTING', epoch: identity.epoch, owner_alpha_hosted: true,
    });
  } finally {
    vi.useRealTimers();
  }
});
