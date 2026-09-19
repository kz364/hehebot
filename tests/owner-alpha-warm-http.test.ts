import {createHash,randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {createLocalJWKSet,exportJWK,generateKeyPair,SignJWT} from 'jose';
import {PersonalControl} from '../src/worker/control-object';
import worker from '../src/worker/index';
import {TestDatabase,bot} from './helpers';
import {ROUTINE_MANAGE_POLICY} from '../src/core/agent-commands';
import {warmLedgerUsed} from '../src/core/owner-alpha-warm';
import type {TextOnlyProfile} from '../src/core/owner-alpha';
import type {ControlCore} from '../src/core/control';
import type {LifecycleCore} from '../src/core/lifecycle';
import type {WarmGenerationView} from '../src/core/owner-alpha-warm';
vi.mock('cloudflare:workers',()=>({DurableObject:class{constructor(public ctx:unknown,public env:unknown){}}}));
vi.mock('../DB/schema.sql',()=>({default:''}));
const keys=vi.hoisted(()=>({resolve:undefined as unknown}));
vi.mock('jose',async original=>({...await original<typeof import('jose')>(),createRemoteJWKSet:()=>keys.resolve}));
// The worker caches one JWKS resolver per issuer; every test in this file must
// sign owner tokens with the same key pair or later tests fail authentication.
const ownerKeyPair=await generateKeyPair('RS256');
async function ownerAssertion():Promise<Record<string,string>>{
 keys.resolve=createLocalJWKSet({keys:[{...await exportJWK(ownerKeyPair.publicKey),kid:'owner',alg:'RS256'}]});
 const token=await new SignJWT({iss:ISSUER,aud:'owner-aud',sub:'actual-owner',iat:Date.now()/1000,exp:Date.now()/1000+3600})
  .setProtectedHeader({alg:'RS256',kid:'owner'}).sign(ownerKeyPair.privateKey);
 return {'Cf-Access-Jwt-Assertion':token,Origin:ORIGIN};
}

const ISSUER='https://owner-warm.cloudflareaccess.com',ORIGIN='https://owner.invalid';
const SESSION=randomUUID(),EPOCH_ONE_BOOT=randomUUID();
const TEXT_ONLY:TextOnlyProfile={profile_version:'codex-text-only-v1',profile_sha256:'c'.repeat(64)};
const HOSTED_POLICY={session_id:SESSION,persona_id:bot,expires_at:'2026-09-19T00:01:00.000Z',max_runs:1,max_task_seconds:30};
const SEED_RETIREMENT={epoch:1,boot_id:EPOCH_ONE_BOOT,session_id:SESSION,transition_id:null,observed_at:'2026-09-19T00:01:30.000Z',
 direct_child_stopped:true,execution_lock_free:true,session_lock_free:true,source:'synthetic-manager-observation'};

function harness(o:{cap?:number;legacyReservationMicroUsd?:number;tamperWarmBinding?:boolean}={}){
 const db=new TestDatabase();
 const auth={AUTH_MODE:'access',INSTALLATION_ID:'personal',ACCESS_ISSUER:ISSUER,ACCESS_AUD:'owner-aud',OWNER_SUB:'actual-owner'};
 const ownerBinding=createHash('sha256').update(JSON.stringify({auth_mode:'access',installation_id:'personal',issuer:ISSUER,audience:'owner-aud',owner_subject:'actual-owner'})).digest('hex');
 const warmConfig={schema_version:1,kind:'owner-alpha-warm-generation-v1',installation_id:'personal',owner_id:'actual-owner',
  owner_binding_sha256:o.tamperWarmBinding?'0'.repeat(64):ownerBinding,policy_revision:'warm-stage-a-v1',persona_id:bot,text_only:TEXT_ONLY,
  expires_at:'2026-09-19T00:20:00.000Z',max_task_seconds:30,max_admissions:2,
  prior_cost_micro_usd:1000,prior_cost_source:'synthetic-baseline',total_cap_micro_usd:o.cap??10000000,reservation_micro_usd:2000,seed_retirement:SEED_RETIREMENT};
 const buildEnv=(withWarm:boolean)=>({
  ...auth,EXECUTION_ENABLED:'false',NATIVE_VERIFIED:'false',PROVIDER_CONFIG:'{}',ACTION_POLICY_IDS:'[]',TOOL_POLICY_IDS:'[]',TRIGGER_CONFIG:'{}',
  HEHEBOT_HOSTED_OWNER_ALPHA:JSON.stringify({owner_binding_sha256:ownerBinding,policy:HOSTED_POLICY}),
  HEHEBOT_OWNER_ALPHA_MANAGER_TOKEN:'m'.repeat(40),HEHEBOT_OWNER_ALPHA_HOST_SIGNING_KEY:'h'.repeat(40),
  HEHEBOT_OWNER_ALPHA_TASK_SIGNING_KEY:'s'.repeat(40),RUNTIME_TOKEN:'r'.repeat(40),PROVIDER_TOKEN:'p'.repeat(40),
  HEHEBOT_OWNER_ALPHA_WAKE_TOKEN:'w'.repeat(40),
  ...(withWarm?{HEHEBOT_OWNER_ALPHA_WAKE:JSON.stringify({url:'https://fixture.sprites.app'}),HEHEBOT_OWNER_ALPHA_WARM_GENERATION:JSON.stringify(warmConfig)}:{})
 }) as unknown as Env;
 let initialized:Promise<unknown>=Promise.resolve();
 let seedLegacyReservation:()=>void=()=>{};
 let env:Env;
 const ctx={storage:{sql:{exec:(sql:string,...values:(string|number|null)[])=>{const rows=db.all(sql,...values);return {toArray:()=>rows};}},
  transactionSync:<T>(fn:()=>T)=>db.transaction(fn),
  getAlarm:vi.fn(async()=>null),setAlarm:vi.fn(async()=>{}),deleteAlarm:vi.fn(async()=>{})},
  blockConcurrencyWhile:(fn:()=>Promise<unknown>)=>{initialized=fn();}};
 let core:ControlCore,lifecycle:LifecycleCore,control:PersonalControl;
 const reopen=async(withWarm:boolean)=>{
  env=buildEnv(withWarm);
  try{control=new PersonalControl(ctx as unknown as DurableObjectState,env);}
  finally{env.CONTROL={getByName:()=>control} as unknown as Env['CONTROL'];}
  await initialized;
  ({core,lifecycle}=control as unknown as {core:ControlCore;lifecycle:LifecycleCore});
  seedLegacyReservation();
 };
 const request=(path:string,body:unknown,headers:Record<string,string>,idempotencyKey?:string)=>
  worker.fetch(new Request(ORIGIN+path,{method:body===undefined?'GET':'POST',
   headers:{'Content-Type':'application/json','Idempotency-Key':idempotencyKey??randomUUID(),...headers},
   body:body===undefined?undefined:JSON.stringify(body)}),env);
 if(o.legacyReservationMicroUsd)seedLegacyReservation=()=>db.exec('INSERT INTO runtime_metadata(key,value_json) VALUES(?,?)',
  'owner_alpha_reservation:1',JSON.stringify({manifest_sha256:'d'.repeat(64),micro_usd:o.legacyReservationMicroUsd}));
 return {db,reopen,request,control:()=>control,core:()=>core,lifecycle:()=>lifecycle,warmConfig};
}

/** Boots the epoch-1 hosted predecessor to its exact retired state. */
function retireEpochOne(lifecycle:LifecycleCore){
 const identity=lifecycle.registerBoot(EPOCH_ONE_BOOT);
 lifecycle.ready(identity);
 vi.setSystemTime(new Date('2026-09-19T00:02:00.000Z'));
 lifecycle.watchdog();
 return identity;
}

/** Grants the captured persona policy bounded model reads require. */
function grantPersonaPolicy(db:InstanceType<typeof TestDatabase>){
 const personaRow=db.all<{body_json:string}>("SELECT body_json FROM objects WHERE id=? AND kind='persona'",bot)[0];
 db.exec("UPDATE objects SET body_json=? WHERE id=? AND kind='persona'",
  JSON.stringify({...JSON.parse(personaRow.body_json),tool_policy_ids:[ROUTINE_MANAGE_POLICY]}),bot);
}

it('admits two successive owner messages into one finite warm generation across real DO reconstruction',async()=>{
 vi.useFakeTimers({toFake:['Date']});
 vi.setSystemTime(new Date('2026-09-19T00:00:00.000Z'));
 const h=harness();
 try{
  await h.reopen(true);
  const owner=await ownerAssertion();
  const manager={Authorization:`Bearer ${'m'.repeat(40)}`};
  const runtime={Authorization:`Bearer ${'r'.repeat(40)}`};
  const readState=async()=>{const r=await h.request('/v1/state',undefined,owner);expect(r.status).toBe(200);const s=await r.json() as {summary:Record<string,unknown>&{owner_alpha_warm?:{policy_expires_at:string;generation:{epoch:number;session_id:string;expires_at:string}|null}&unknown,owner_alpha_session?:unknown,owner_alpha_bootstrap?:unknown}};return s;};
  const send=async(text:string,key:string)=>{const r=await h.request('/v1/commands',{schema_version:1,type:'message.send',payload:{conversation_id:bot,text}},owner,key);
   expect(r.status).toBe(202);return r.json() as Promise<{id:string;resource_id:string;status:string;error:{code:string;message:string}|null}>;};
  retireEpochOne(h.lifecycle());

  let summary=await readState();
  expect(summary.summary.owner_alpha_warm).toMatchObject({schema_version:1,kind:'owner-alpha-warm-summary-v1',policy_revision:'warm-stage-a-v1',
   persona_id:bot,policy_expires_at:'2026-09-19T00:20:00.000Z',max_admissions:2,admissions_used:0,message_admission_available:true,generation:null});
  expect(summary.summary.owner_alpha_session).toBeUndefined();
  expect(summary.summary.owner_alpha_bootstrap).toBeUndefined();

  grantPersonaPolicy(h.db);

  // First message creates the generation and its manifest atomically.
  vi.setSystemTime(new Date('2026-09-19T00:02:30.000Z'));
  const key1=randomUUID(),first=await send('Remember the blue notebook.',key1);
  expect(first.status).toBe('applied');
  const gen1=h.core().ownerAlpha.activeGeneration() as WarmGenerationView;
  expect(gen1.epoch).toBe(2);
  const m1=gen1.authority.admissions[0];
  expect(m1.admission).toBe(1);
  expect(m1.run_id).toBe(first.resource_id);
  expect(m1.expires_at).toBe('2026-09-19T00:03:00.000Z');
  expect(gen1.policy.expires_at).toBe('2026-09-19T00:07:30.000Z'); // min(config 00:20, first admission+300s)
  expect(h.db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_warm_generation:*'")).toHaveLength(1);
  expect(h.db.all<{key:string}>("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_warm_manifest:*'").map(x=>x.key)).toEqual(['owner_alpha_warm_manifest:2:1']);
  expect(h.db.all("SELECT key FROM runtime_metadata WHERE key='owner_alpha_reservation:2:1'")).toHaveLength(1);
  summary=await readState();
  expect(summary.summary.owner_alpha_warm).toMatchObject({admissions_used:1,message_admission_available:false,
   generation:{epoch:2,session_id:gen1.policy.session_id,expires_at:'2026-09-19T00:07:30.000Z'}});
  expect(summary.summary.owner_alpha_session).toBeUndefined();
  expect(summary.summary.owner_alpha_bootstrap).toBeUndefined();
  // The write-once generation descriptor and first manifest rows, captured now.
  const custody1=Object.fromEntries(h.db.all<{key:string;value_json:string}>("SELECT key,value_json FROM runtime_metadata WHERE key GLOB 'owner_alpha_warm_*' ORDER BY key").map(r=>[r.key,r.value_json]));

  // Only the first admitted message creates the once-only wake intent.
  await h.lifecycle().deliverOwnerAlphaWake(gen1.transition_id,async()=>{});
  expect(h.db.all("SELECT key FROM runtime_metadata WHERE key='owner_alpha_wake:2'")).toHaveLength(1);
  await h.lifecycle().deliverOwnerAlphaWake(gen1.transition_id,async()=>{});
  expect(h.db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_wake:*'")).toHaveLength(1);

  // The manager sees the launch envelope only while BOOTING and live. The
  // host credential is frozen at the generation's first admission: repeated
  // reads at different times return the identical envelope with zero writes.
  let r=await h.request('/internal/warm/manager/generation',{},manager);
  expect(r.status).toBe(200);
  const launch=await r.json() as {schema_version:number;kind:string;generation:{epoch:number;boot_id:string;transition_id:string;session_id:string;generation_sha256:string;
   policy:{persona_id:string;expires_at:string;max_runs:number;max_task_seconds:number;text_only:{profile_version:string;profile_sha256:string}};
   predecessor:{epoch:number;boot_id:string;session_id:string}};host_credential:{grant:{issued_at:string;expires_at:string},token:string}};
  expect(launch).toMatchObject({schema_version:1,kind:'owner-alpha-warm-launch-v1'});
  expect(launch.generation).toMatchObject({epoch:2,boot_id:gen1.boot_id,transition_id:gen1.transition_id,session_id:gen1.policy.session_id,
   generation_sha256:gen1.authority.generation_sha256});
  expect(launch.generation.policy).toMatchObject({persona_id:bot,expires_at:'2026-09-19T00:07:30.000Z',max_runs:2,max_task_seconds:30,text_only:TEXT_ONLY});
  expect(launch.generation.predecessor).toMatchObject({epoch:1,boot_id:EPOCH_ONE_BOOT,session_id:SESSION});
  expect(launch.host_credential.grant).toMatchObject({issued_at:'2026-09-19T00:02:30.000Z',expires_at:'2026-09-19T00:07:30.000Z'});
  expect(launch.host_credential.token.length).toBeGreaterThan(0);
  vi.setSystemTime(new Date('2026-09-19T00:02:34.000Z'));
  const metaBefore=JSON.stringify(h.db.all("SELECT key,value_json FROM runtime_metadata ORDER BY key"));
  r=await h.request('/internal/warm/manager/generation',{},manager);
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual(launch);
  expect(JSON.stringify(h.db.all("SELECT key,value_json FROM runtime_metadata ORDER BY key"))).toBe(metaBefore);
  const host={Authorization:`Bearer ${launch.host_credential.token}`};

  r=await h.request('/internal/warm/host/boot',{boot_id:gen1.boot_id},host);
  expect(r.status).toBe(200);
  r=await h.request('/internal/warm/host/ready',{identity:{epoch:2,boot_id:gen1.boot_id}},host);
  expect(r.status).toBe(200);

  // A READY generation never yields a second launch envelope.
  r=await h.request('/internal/warm/manager/generation',{},manager);
  expect(r.status).toBe(200);
  expect(await r.json()).toBeNull();

  r=await h.request('/internal/warm/host/status',{},host);
  expect(r.status).toBe(200);
  const status=await r.json() as {phase:string;epoch:number;owner_alpha_warm_generation?:unknown;owner_alpha_generation?:unknown};
  expect(status.phase).toBe('READY');
  expect(status.owner_alpha_warm_generation).toEqual({epoch:2,boot_id:gen1.boot_id,transition_id:gen1.transition_id});
  expect(status.owner_alpha_generation).toBeUndefined();

  // A trusted host claim returns the exact task credential and immutable
  // descriptor. The frozen deadline is exactly one second away, the boundary
  // a delayed claim must not extend.
  vi.setSystemTime(new Date('2026-09-19T00:02:59.000Z'));
  r=await h.request('/internal/warm/host/claim',{identity:{epoch:2,boot_id:gen1.boot_id}},host);
  expect(r.status).toBe(200);
  const claim1=await r.json() as {schema_version:number;kind:string;run:{id:string;current_attempt:number};submission_key:string;
   deadline_at:string;text_only:{profile_version:string};manifest:{admission:number;manifest_sha256:string;expires_at:string};
   task_credential:{token:string}};
  expect(claim1).toMatchObject({schema_version:1,kind:'owner-alpha-warm-claim-v1'});
  expect(claim1.run.id).toBe(m1.run_id);
  expect(claim1.deadline_at).toBe('2026-09-19T00:03:00.000Z');
  expect(claim1.manifest).toMatchObject({admission:1,manifest_sha256:m1.manifest_sha256,expires_at:'2026-09-19T00:03:00.000Z'});
  expect(claim1.text_only).toEqual(TEXT_ONLY);
  expect(claim1.task_credential.token.length).toBeGreaterThan(0);
  const task1={Authorization:`Bearer ${claim1.task_credential.token}`};
  const scope1={identity:{epoch:2,boot_id:gen1.boot_id},run_id:m1.run_id,attempt:1};

  // Authorized bounded model reads: routines pass the captured persona policy; skills keep enabled-skill semantics.
  r=await h.request('/internal/warm/task/agent-routines',scope1,task1);
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({routines:[],next_cursor:null});
  r=await h.request('/internal/warm/task/agent-skill',{...scope1,skill_id:randomUUID()},task1);
  expect(r.status).toBe(404);
  // Task-credential allowlist and scope denials while the frozen credential is live.
  r=await h.request('/internal/warm/task/agent-command',{...scope1,idempotency_key:'k'.repeat(16),command:{schema_version:1,type:'routine.run',payload:{}}},task1);
  expect(r.status).toBe(403);
  r=await h.request('/internal/warm/task/agent-skill-search',{...scope1,query:'notebook'},task1);
  expect(r.status).toBe(403);
  r=await h.request('/internal/warm/task/steer-result',{...scope1,command_id:randomUUID(),status:'not_delivered'},task1);
  expect(r.status).toBe(403);
  r=await h.request('/internal/warm/task/question-take',{identity:{epoch:2,boot_id:gen1.boot_id},question_id:randomUUID(),connection_id:randomUUID()},task1);
  expect(r.status).toBe(403);
  const foreignRun=randomUUID();
  r=await h.request('/internal/warm/task/agent-routines',{identity:{epoch:2,boot_id:gen1.boot_id},run_id:foreignRun,attempt:1},task1);
  expect(r.status).toBe(403);
  r=await h.request('/internal/warm/task/agent-routines',{...scope1,attempt:2},task1);
  expect(r.status).toBe(403);
  r=await h.request('/internal/warm/host/status',{},task1);
  expect(r.status).toBe(401);
  r=await h.request('/internal/warm/host/claim',{identity:{epoch:2,boot_id:gen1.boot_id}},task1);
  expect(r.status).toBe(401);

  // Host-only observations stay bound to the admitted attempt.
  r=await h.request('/internal/warm/host/steer-pending',{identity:{epoch:2,boot_id:gen1.boot_id},targets:[{run_id:m1.run_id,attempt:1}]},host);
  expect(r.status).toBe(200);
  r=await h.request('/internal/warm/host/output-preview',{...scope1,native_ref:'turn-one',version:1,text:'The notebook is',truncated:true},host);
  expect(r.status).toBe(200);
  const usage={inputTokens:1,cachedInputTokens:0,cacheWriteInputTokens:0,outputTokens:1,reasoningOutputTokens:0,totalTokens:2};
  r=await h.request('/internal/warm/host/token-usage',{...scope1,native_ref:'turn-one',version:1,usage:{total:usage,last:usage,modelContextWindow:null}},host);
  expect(r.status).toBe(200);

  vi.setSystemTime(new Date('2026-09-19T00:02:59.400Z'));
  r=await h.request('/internal/warm/host/submitted',{...scope1,native_ref:'turn-one'},host);
  expect(r.status).toBe(200);
  r=await h.request('/internal/warm/host/coordinator-release',{...scope1,native_ref:'turn-one',outcome:'completed'},host);
  expect(r.status).toBe(200);
  r=await h.request('/internal/warm/host/complete',{...scope1,result:{status:'completed',text:'The notebook is blue.'},
   text_only_receipt:{...TEXT_ONLY,thread_id:'thread-one',turn_id:'turn-one',
    output_sha256:createHash('sha256').update('The notebook is blue.').digest('hex')}},host);
  expect(r.status).toBe(200);
  expect(h.core().store.run(m1.run_id).status).toBe('completed');

  summary=await readState();
  expect(summary.summary.owner_alpha_warm).toMatchObject({admissions_used:1,message_admission_available:true});

  // Reconstruction between admissions: same DO custody, no second boot or epoch.
  // The second message repeats the first text with a fresh idempotency key:
  // identical command digests are distinct admissions.
  vi.setSystemTime(new Date('2026-09-19T00:03:50.000Z'));
  await h.reopen(true);
  const second=await send('Remember the blue notebook.',randomUUID());
  expect(second.status).toBe('applied');
  const gen2=h.core().ownerAlpha.activeGeneration() as WarmGenerationView;
  expect(gen2.epoch).toBe(2);
  expect(gen2.boot_id).toBe(gen1.boot_id);
  expect(h.lifecycle().get().epoch).toBe(2);
  const m2=gen2.authority.admissions[1];
  expect(m2).toMatchObject({admission:2,run_id:second.resource_id});
  expect(m2.manifest_sha256).not.toBe(m1.manifest_sha256);
  expect(m2.command_id).not.toBe(m1.command_id);
  expect(m2.run_id).not.toBe(m1.run_id);
  expect(m2.event_sequence).toBeGreaterThan(m1.event_sequence);
  expect(m2.command_sha256).toBe(m1.command_sha256); // repeated text, fresh key
  expect(m2.session_id).toBe(m1.session_id);
  expect(m2.expires_at).toBe('2026-09-19T00:04:20.000Z'); // frozen at admission 00:03:50+30s
  expect(h.db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_warm_generation:*'")).toHaveLength(1);
  expect(h.db.all<{key:string}>("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_warm_manifest:*' ORDER BY key").map(x=>x.key))
   .toEqual(['owner_alpha_warm_manifest:2:1','owner_alpha_warm_manifest:2:2']);
  expect(h.db.all("SELECT key FROM runtime_metadata WHERE key='owner_alpha_reservation:2:2'")).toHaveLength(1);
  // The write-once generation descriptor and the first manifest keep their
  // exact bytes across the second admission and reconstruction.
  const custody2=Object.fromEntries(h.db.all<{key:string;value_json:string}>("SELECT key,value_json FROM runtime_metadata WHERE key GLOB 'owner_alpha_warm_*' ORDER BY key").map(r=>[r.key,r.value_json]));
  expect(custody2['owner_alpha_warm_generation:2']).toBe(custody1['owner_alpha_warm_generation:2']);
  expect(custody2['owner_alpha_warm_manifest:2:1']).toBe(custody1['owner_alpha_warm_manifest:2:1']);
  expect(custody2['owner_alpha_warm_reservation:2:1']).toBe(custody1['owner_alpha_warm_reservation:2:1']);

  summary=await readState();
  expect(summary.summary.owner_alpha_warm).toMatchObject({admissions_used:2,message_admission_available:false,
   generation:{epoch:2,expires_at:'2026-09-19T00:07:30.000Z'}});
  expect(summary.summary.owner_alpha_session).toBeUndefined();

  // Task 2 in the already READY generation creates no new wake intent.
  await h.lifecycle().deliverOwnerAlphaWake(gen2.transition_id,async()=>{});
  expect(h.db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_wake:*'")).toHaveLength(1);

  // Renew the lease before the message-1 admission lease expires.
  vi.setSystemTime(new Date('2026-09-19T00:03:55.000Z'));
  r=await h.request('/internal/warm/host/heartbeat',{identity:{epoch:2,boot_id:gen1.boot_id},operations:[]},host);
  expect(r.status).toBe(200);

  // A delayed claim in the frozen deadline's final partial second is rejected
  // before any claim or attempt mutation: no orphan attempt, no new window.
  vi.setSystemTime(new Date('2026-09-19T00:04:19.900Z'));
  r=await h.request('/internal/warm/host/claim',{identity:{epoch:2,boot_id:gen1.boot_id}},host);
  expect(r.status).toBe(409);
  expect(await r.json()).toMatchObject({error:{code:'CAPABILITY_UNAVAILABLE'}});
  expect(h.db.all("SELECT * FROM attempts WHERE run_id=?",m2.run_id)).toEqual([]);
  // Zero token seconds remaining: the claim second equals the deadline second.
  vi.setSystemTime(new Date('2026-09-19T00:04:20.000Z'));
  r=await h.request('/internal/warm/host/claim',{identity:{epoch:2,boot_id:gen1.boot_id}},host);
  expect(r.status).toBe(409);
  expect(await r.json()).toMatchObject({error:{code:'CAPABILITY_UNAVAILABLE'}});
  expect(h.db.all("SELECT * FROM attempts WHERE run_id=?",m2.run_id)).toEqual([]);
  // Exactly one second remaining is the accepted boundary.
  vi.setSystemTime(new Date('2026-09-19T00:04:19.000Z'));
  r=await h.request('/internal/warm/host/claim',{identity:{epoch:2,boot_id:gen1.boot_id}},host);
  expect(r.status).toBe(200);
  const claim2=await r.json() as {kind:string;run:{id:string};deadline_at:string;task_credential:{token:string}};
  expect(claim2.kind).toBe('owner-alpha-warm-claim-v1');
  expect(claim2.run.id).toBe(m2.run_id);
  expect(claim2.deadline_at).toBe('2026-09-19T00:04:20.000Z'); // frozen, not claim-time+30s (00:04:49)
  expect(h.db.all<{attempt:number}>("SELECT attempt FROM attempts WHERE run_id=?",m2.run_id)).toEqual([{attempt:1}]);
  const task2={Authorization:`Bearer ${claim2.task_credential.token}`};
  const scope2={identity:{epoch:2,boot_id:gen1.boot_id},run_id:m2.run_id,attempt:1};

  r=await h.request('/internal/warm/task/agent-routines',scope2,task2);
  expect(r.status).toBe(200);
  // The second frozen credential is bound to its own manifest only.
  r=await h.request('/internal/warm/task/agent-command',{...scope2,idempotency_key:'j'.repeat(16),command:{schema_version:1,type:'routine.put',payload:{}}},task2);
  expect(r.status).toBe(403);
  r=await h.request('/internal/warm/task/agent-routines',{identity:{epoch:2,boot_id:gen1.boot_id},run_id:m1.run_id,attempt:1},task2);
  expect(r.status).toBe(403);
  r=await h.request('/internal/warm/host/status',{},task2);
  expect(r.status).toBe(401);

  vi.setSystemTime(new Date('2026-09-19T00:04:19.300Z'));
  await h.request('/internal/warm/host/submitted',{...scope2,native_ref:'turn-two'},host);
  await h.request('/internal/warm/host/coordinator-release',{...scope2,native_ref:'turn-two',outcome:'completed'},host);
  r=await h.request('/internal/warm/host/complete',{...scope2,result:{status:'completed',text:'Blue.'},
   text_only_receipt:{...TEXT_ONLY,thread_id:'thread-two',turn_id:'turn-two',output_sha256:createHash('sha256').update('Blue.').digest('hex')}},host);
  expect(r.status).toBe(200);
  expect(h.core().store.run(m1.run_id).status).toBe('completed');
  expect(h.core().store.run(m2.run_id).status).toBe('completed');
  expect(warmLedgerUsed(h.db,1000)).toBe(5000); // baseline + both warm reservations, exactly once

  // At most two admissions; no extending policy or refunding reservations.
  vi.setSystemTime(new Date('2026-09-19T00:04:25.000Z'));
  const third=await send('And one more thing.',randomUUID());
  expect(third.status).toBe('rejected');
  expect(third.error?.code).toBe('CAPABILITY_UNAVAILABLE');
  expect(h.db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_reservation:*'")).toHaveLength(2);

  // Same-command replay returns the identical receipt and changes nothing.
  const before=JSON.stringify([h.db.all('SELECT * FROM runtime_metadata ORDER BY key'),h.db.all('SELECT * FROM runs ORDER BY id'),
   h.db.all('SELECT * FROM commands ORDER BY id'),h.db.all('SELECT * FROM attempts ORDER BY run_id,attempt')]);
  expect(await send('Remember the blue notebook.',key1)).toEqual(first);
  const after=JSON.stringify([h.db.all('SELECT * FROM runtime_metadata ORDER BY key'),h.db.all('SELECT * FROM runs ORDER BY id'),
   h.db.all('SELECT * FROM commands ORDER BY id'),h.db.all('SELECT * FROM attempts ORDER BY run_id,attempt')]);
  expect(after).toBe(before);

  // Crossed credentials with valid signatures and shapes are denied on both families.
  vi.setSystemTime(new Date('2026-09-19T00:04:35.000Z'));
  r=await h.request('/internal/warm/task/agent-routines',scope2,host);
  expect(r.status).toBe(401);
  r=await h.request('/internal/warm/host/status',{},runtime);
  expect(r.status).toBe(401);
  r=await h.request('/internal/warm/host/agent-routines',scope2,host);
  expect(r.status).toBe(403);
  r=await h.request('/internal/warm/host/question-take',{identity:{epoch:2,boot_id:gen1.boot_id},question_id:randomUUID(),connection_id:randomUUID()},host);
  expect(r.status).toBe(403);
  r=await h.request('/internal/warm/host/steer-result',{...scope2,command_id:randomUUID(),status:'not_delivered'},host);
  expect(r.status).toBe(403);
  r=await h.request('/internal/warm/host/submitted',{identity:{epoch:2,boot_id:gen1.boot_id},run_id:foreignRun,attempt:1,native_ref:'turn-x'},host);
  expect(r.status).toBe(403);
  r=await h.request('/internal/warm/host/steer-pending',{identity:{epoch:2,boot_id:gen1.boot_id},targets:[{run_id:foreignRun,attempt:1}]},host);
  expect(r.status).toBe(403);

  // Legacy routes are not a bypass into the warm generation.
  r=await h.request('/internal/manager/manifest',{},manager);
  expect(r.status).toBe(404);
  r=await h.request('/internal/status',{},runtime);
  expect(r.status).toBe(404);

  // Removing the configuration while the generation is still live rejects
  // candidate owner messages before any event, run or reservation is created.
  vi.setSystemTime(new Date('2026-09-19T00:04:40.000Z'));
  const runCount=h.db.all('SELECT id FROM runs').length;
  await h.reopen(false);
  const removedKey=randomUUID(),removed=await send('One more after removal.',removedKey);
  expect(removed.status).toBe('rejected');
  expect(removed.error).toMatchObject({code:'CAPABILITY_UNAVAILABLE'});
  expect(h.db.all('SELECT id FROM runs')).toHaveLength(runCount);
  expect(h.db.all("SELECT id FROM events WHERE id=? AND type='message.user'",removed.id)).toEqual([]);
  summary=await readState();
  expect(summary.summary.owner_alpha_warm).toMatchObject({admissions_used:2,message_admission_available:false,
   generation:{epoch:2,session_id:gen1.policy.session_id,expires_at:'2026-09-19T00:07:30.000Z'}});
  r=await h.request('/internal/warm/manager/generation',{},manager);
  expect(r.status).toBe(404);
  r=await h.request('/internal/warm/host/status',{},host);
  expect(r.status).toBe(404);

  // Expired credentials are rejected while the retained generation stays live.
  await h.reopen(true);
  vi.setSystemTime(new Date('2026-09-19T00:07:31.000Z'));
  r=await h.request('/internal/warm/host/status',{},host);
  expect(r.status).toBe(401);
  r=await h.request('/internal/warm/task/agent-routines',scope2,task2);
  expect(r.status).toBe(401);
  r=await h.request('/internal/warm/manager/generation',{},manager);
  expect(r.status).toBe(200);
  expect(await r.json()).toBeNull();

  // Removing the configuration after expiry stays fail-closed while custody
  // remains reconstructible.
  vi.setSystemTime(new Date('2026-09-19T00:08:00.000Z'));
  await h.reopen(false);
  summary=await readState();
  expect(summary.summary.owner_alpha_warm).toMatchObject({admissions_used:2,message_admission_available:false,
   generation:{epoch:2,session_id:gen1.policy.session_id,expires_at:'2026-09-19T00:07:30.000Z'}});
  expect(summary.summary.owner_alpha_session).toBeUndefined();
  expect(summary.summary.owner_alpha_bootstrap).toBeUndefined();
  r=await h.request('/internal/status',{},runtime);
  expect(r.status).toBe(404);
  r=await h.request('/internal/warm/manager/generation',{},manager);
  expect(r.status).toBe(404);
  r=await h.request('/internal/warm/host/status',{},host);
  expect(r.status).toBe(404);
  const queued=await send('One more after expiry removal.',randomUUID());
  expect(queued.status).toBe('rejected');
  expect(queued.error).toMatchObject({code:'CAPABILITY_UNAVAILABLE'});
  expect(h.db.all('SELECT id FROM runs')).toHaveLength(runCount);

  // Manager retirement works after expiry using only manager authentication.
  const retirement={epoch:2,boot_id:gen1.boot_id,session_id:gen1.policy.session_id,transition_id:gen1.transition_id,
   observed_at:'2026-09-19T00:07:30.000Z',direct_child_stopped:true,execution_lock_free:true,session_lock_free:true,source:'synthetic-manager-observation'};
  r=await h.request('/internal/warm/manager/retirement',retirement,manager);
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({accepted:true});
  r=await h.request('/internal/warm/manager/retirement',retirement,manager);
  expect(r.status).toBe(200);
  r=await h.request('/internal/warm/manager/retirement',{...retirement,observed_at:'2026-09-19T00:07:31.000Z'},manager);
  expect(r.status).toBe(422);
  const retained=h.core().ownerAlpha.activeGeneration() as WarmGenerationView;
  expect(retained.epoch).toBe(2);
  expect(retained.authority.admissions.map(x=>x.manifest_sha256)).toEqual([m1.manifest_sha256,m2.manifest_sha256]);
  expect(h.lifecycle().get().epoch).toBe(2);
  expect(h.db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_warm_generation:*'")).toHaveLength(1);
  expect(h.db.all<{key:string}>("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_warm_manifest:*' ORDER BY key").map(x=>x.key))
   .toEqual(['owner_alpha_warm_manifest:2:1','owner_alpha_warm_manifest:2:2']);
 }finally{h.db.close();vi.useRealTimers();}
});

it('admits distinct messages that share one wall-clock timestamp and repeated text',async()=>{
 vi.useFakeTimers({toFake:['Date']});
 vi.setSystemTime(new Date('2026-09-19T00:00:00.000Z'));
 const h=harness();
 try{
  await h.reopen(true);
  const owner=await ownerAssertion();
  const send=async(text:string,key:string)=>{const r=await h.request('/v1/commands',{schema_version:1,type:'message.send',payload:{conversation_id:bot,text}},owner,key);
   expect(r.status).toBe(202);return r.json() as Promise<{id:string;resource_id:string;status:string;error:{code:string}|null}>;};
  retireEpochOne(h.lifecycle());
  grantPersonaPolicy(h.db);

  // First message and its canonical completion, all at 00:02:30–00:02:40.
  vi.setSystemTime(new Date('2026-09-19T00:02:30.000Z'));
  const first=await send('Remember the blue notebook.',randomUUID());
  expect(first.status).toBe('applied');
  const gen1=h.core().ownerAlpha.activeGeneration() as WarmGenerationView;
  const m1=gen1.authority.admissions[0];
  const lifecycle=h.lifecycle(),identity=lifecycle.registerBoot(gen1.boot_id);
  lifecycle.ready(identity);
  expect(lifecycle.claim(identity)?.run.id).toBe(m1.run_id);
  lifecycle.submitted(identity,m1.run_id,1,'turn-one');
  lifecycle.coordinatorRelease(identity,m1.run_id,1,'turn-one','completed');
  lifecycle.complete(identity,m1.run_id,1,{status:'completed',text:'The notebook is blue.'},
   {...TEXT_ONLY,thread_id:'thread-one',turn_id:'turn-one',output_sha256:createHash('sha256').update('The notebook is blue.').digest('hex')});
  const custody1=Object.fromEntries(h.db.all<{key:string;value_json:string}>("SELECT key,value_json FROM runtime_metadata WHERE key GLOB 'owner_alpha_warm_*' ORDER BY key").map(r=>[r.key,r.value_json]));

  // The second admission lands on the exact first-admission millisecond.
  vi.setSystemTime(new Date('2026-09-19T00:02:30.000Z'));
  const second=await send('Remember the blue notebook.',randomUUID());
  expect(second.status).toBe('applied');
  const gen2=h.core().ownerAlpha.activeGeneration() as WarmGenerationView;
  expect(gen2.authority.admissions).toHaveLength(2);
  const m2=gen2.authority.admissions[1];
  expect(m2.issued_at).toBe(m1.issued_at);
  expect(m2.event_sequence).toBeGreaterThan(m1.event_sequence);
  expect(m2.command_id).not.toBe(m1.command_id);
  expect(m2.run_id).not.toBe(m1.run_id);
  expect(m2.command_sha256).toBe(m1.command_sha256);
  expect(m2.expires_at).toBe(m1.expires_at);
  expect(m2.manifest_sha256).not.toBe(m1.manifest_sha256);
  expect(h.db.all("SELECT key FROM runtime_metadata WHERE key='owner_alpha_reservation:2:2'")).toHaveLength(1);
  // First custody is unchanged, including the write-once generation descriptor.
  const custody2=Object.fromEntries(h.db.all<{key:string;value_json:string}>("SELECT key,value_json FROM runtime_metadata WHERE key GLOB 'owner_alpha_warm_*' ORDER BY key").map(r=>[r.key,r.value_json]));
  expect(custody2['owner_alpha_warm_generation:2']).toBe(custody1['owner_alpha_warm_generation:2']);
  expect(custody2['owner_alpha_warm_manifest:2:1']).toBe(custody1['owner_alpha_warm_manifest:2:1']);
  expect(custody2['owner_alpha_warm_reservation:2:1']).toBe(custody1['owner_alpha_warm_reservation:2:1']);

  // Reconstruction across a reopen keeps both distinct admissions.
  await h.reopen(true);
  const gen3=h.core().ownerAlpha.activeGeneration() as WarmGenerationView;
  expect(gen3.authority.admissions.map(m=>m.manifest_sha256)).toEqual([m1.manifest_sha256,m2.manifest_sha256]);
  expect(gen3.authority.generation_sha256).toBe(m1.generation_sha256);
  expect(h.core().warm.summary()).toMatchObject({admissions_used:2,message_admission_available:false});

  // At most two admissions even at identical timestamps.
  const third=await send('And one more thing.',randomUUID());
  expect(third.status).toBe('rejected');
  expect(third.error?.code).toBe('CAPABILITY_UNAVAILABLE');
 }finally{h.db.close();vi.useRealTimers();}
});

it('rejects a second admission when the executor lease has expired under a still-READY generation',async()=>{
 vi.useFakeTimers({toFake:['Date']});
 vi.setSystemTime(new Date('2026-09-19T00:00:00.000Z'));
 const h=harness();
 try{
  await h.reopen(true);
  const owner=await ownerAssertion();
  retireEpochOne(h.lifecycle());

  vi.setSystemTime(new Date('2026-09-19T00:02:30.000Z'));
  const first=h.core().accept('actual-owner',randomUUID(),createHash('sha256').update('first').digest('hex'),
   {schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'Remember the blue notebook.'}});
  expect(first.status).toBe('applied');
  const gen=h.core().ownerAlpha.activeGeneration() as WarmGenerationView;
  const m1=gen.authority.admissions[0];
  const lifecycle=h.lifecycle(),identity=lifecycle.registerBoot(gen.boot_id);
  lifecycle.ready(identity);
  expect(lifecycle.claim(identity)?.run.id).toBe(m1.run_id);
  lifecycle.submitted(identity,m1.run_id,1,'turn-one');
  lifecycle.coordinatorRelease(identity,m1.run_id,1,'turn-one','completed');
  lifecycle.complete(identity,m1.run_id,1,{status:'completed',text:'The notebook is blue.'},
   {...TEXT_ONLY,thread_id:'thread-one',turn_id:'turn-one',output_sha256:createHash('sha256').update('The notebook is blue.').digest('hex')});
  const runsBefore=JSON.stringify(h.db.all('SELECT * FROM runs ORDER BY id'));
  const metaBefore=JSON.stringify(h.db.all("SELECT key,value_json FROM runtime_metadata WHERE key GLOB 'owner_alpha_warm_*' ORDER BY key"));

  // The admission lease (00:04:01) is gone but the watchdog has not run: the
  // generation is still READY and unexpired (00:07:30).
  vi.setSystemTime(new Date('2026-09-19T00:04:30.000Z'));
  expect(lifecycle.get().phase).toBe('READY');
  const second=h.core().accept('actual-owner',randomUUID(),createHash('sha256').update('second').digest('hex'),
   {schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'What color was the notebook?'}});
  expect(second.status).toBe('rejected');
  expect(second.error).toMatchObject({code:'CAPABILITY_UNAVAILABLE',message:'Warm generation lease has expired.'});
  // No second manifest, reservation, run or wake intent was created.
  expect(h.db.all<{key:string}>("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_warm_manifest:*'").map(x=>x.key)).toEqual(['owner_alpha_warm_manifest:2:1']);
  expect(h.db.all("SELECT key FROM runtime_metadata WHERE key='owner_alpha_reservation:2:2'")).toEqual([]);
  expect(h.db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_wake:*'")).toEqual([]);
  expect(JSON.stringify(h.db.all('SELECT * FROM runs ORDER BY id'))).toBe(runsBefore);
  const metaAfter=JSON.stringify(h.db.all("SELECT key,value_json FROM runtime_metadata WHERE key GLOB 'owner_alpha_warm_*' ORDER BY key"));
  expect(metaAfter).toBe(metaBefore);
  expect(h.core().warm.summary()).toMatchObject({admissions_used:1,message_admission_available:false});
 }finally{h.db.close();vi.useRealTimers();}
});

it('rejects a mismatched warm owner binding before any write or admission',async()=>{
 vi.useFakeTimers({toFake:['Date']});
 vi.setSystemTime(new Date('2026-09-19T00:00:00.000Z'));
 const h=harness({tamperWarmBinding:true});
 try{
  await expect(h.reopen(true)).rejects.toMatchObject({code:'OWNER_BINDING_MISMATCH',status:503});
  // The failed initialization rolled its binding transaction back: nothing was
  // written and no warm custody exists.
  expect(h.db.all('SELECT * FROM runtime_metadata')).toEqual([]);
  expect(h.db.all('SELECT * FROM runs')).toEqual([]);
  // The half-initialized Durable Object fails closed on HTTP too: the exact
  // initialization error is returned and no run is ever admitted.
  const owner=await ownerAssertion();
  const r=await h.request('/v1/commands',{schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'Remember the blue notebook.'}},owner,randomUUID());
  expect(r.status).toBe(503);
  expect(await r.json()).toMatchObject({error:{code:'OWNER_BINDING_MISMATCH'}});
  expect(h.db.all('SELECT * FROM runs')).toEqual([]);
  expect(h.db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_warm_*'")).toEqual([]);
 }finally{h.db.close();vi.useRealTimers();}
});

it('bounds the second admission by the shared lifetime ledger including an old unknown reservation',async()=>{
 vi.useFakeTimers({toFake:['Date']});
 vi.setSystemTime(new Date('2026-09-19T00:00:00.000Z'));
 // Nonzero baseline 1000 + old unknown reservation 1500 + first warm reservation 2000 = 4500 <= cap 5500;
 // the second warm reservation would reach 6500 and must be refused without refunding anything.
 const h=harness({cap:5500,legacyReservationMicroUsd:1500});
 try{
  await h.reopen(true);
  const owner=await ownerAssertion();
  const send=async(text:string,key:string)=>{const r=await h.request('/v1/commands',{schema_version:1,type:'message.send',payload:{conversation_id:bot,text}},owner,key);
   expect(r.status).toBe(202);return r.json() as Promise<{resource_id:string;status:string;error:{code:string;message:string}|null}>;};
  retireEpochOne(h.lifecycle());

  vi.setSystemTime(new Date('2026-09-19T00:02:30.000Z'));
  const first=await send('Remember the blue notebook.',randomUUID());
  expect(first.status).toBe('applied');
  const lifecycle=h.lifecycle(),gen=h.core().ownerAlpha.activeGeneration() as WarmGenerationView;
  const m1=gen.authority.admissions[0];
  expect(m1.run_id).toBe(first.resource_id);

  const identity=lifecycle.registerBoot(gen.boot_id);
  lifecycle.ready(identity);
  expect(lifecycle.claim(identity)?.run.id).toBe(m1.run_id);
  lifecycle.submitted(identity,m1.run_id,1,'turn-one');
  lifecycle.coordinatorRelease(identity,m1.run_id,1,'turn-one','completed');
  lifecycle.complete(identity,m1.run_id,1,{status:'completed',text:'The notebook is blue.'},
   {profile_version:'codex-text-only-v1',profile_sha256:'c'.repeat(64),thread_id:'thread-one',turn_id:'turn-one',
    output_sha256:createHash('sha256').update('The notebook is blue.').digest('hex')});
  expect(warmLedgerUsed(h.db,1000)).toBe(4500);

  vi.setSystemTime(new Date('2026-09-19T00:03:50.000Z'));
  const second=await send('What color was the notebook?',randomUUID());
  expect(second.status).toBe('rejected');
  expect(second.error).toMatchObject({code:'CAPABILITY_UNAVAILABLE',message:'Lifetime allowance is exhausted.'});
  expect(h.db.all<{key:string}>("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_reservation:*' ORDER BY key").map(x=>x.key))
   .toEqual(['owner_alpha_reservation:1','owner_alpha_reservation:2:1']);
  // No orphan unassigned run was created for the refused message.
  expect(h.db.all('SELECT id FROM runs WHERE id!=?',first.resource_id)).toEqual([]);
  expect(h.core().store.run(first.resource_id).status).toBe('completed');
 }finally{h.db.close();vi.useRealTimers();}
});
