import {createHash,randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {createLocalJWKSet,exportJWK,generateKeyPair,SignJWT} from 'jose';
import {PersonalControl} from '../src/worker/control-object';
import worker from '../src/worker/index';
import {TestDatabase,bot} from './helpers';
import {ROUTINE_MANAGE_POLICY} from '../src/core/agent-commands';
import {warmLedgerUsed} from '../src/core/owner-alpha-warm';
import type {ControlCore} from '../src/core/control';
import type {LifecycleCore} from '../src/core/lifecycle';
import type {BackgroundGenerationView,BackgroundManifest,BackgroundStatusSummary} from '../src/core/owner-alpha-background';

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

const ISSUER='https://owner-background.cloudflareaccess.com',ORIGIN='https://owner.invalid';
const SESSION=randomUUID(),EPOCH_ONE_BOOT=randomUUID();
const MANAGER_TOKEN='m'.repeat(40),HOST_SIGNING_KEY='b'.repeat(40),TASK_SIGNING_KEY='g'.repeat(40),RUNTIME_TOKEN='r'.repeat(40),WAKE_TOKEN='w'.repeat(40);
const HOSTED_POLICY={session_id:SESSION,persona_id:bot,expires_at:'2026-09-19T00:01:00.000Z',max_runs:1,max_task_seconds:30};
const BACKGROUND_PROFILE={profile_version:'codex-background-v2-restricted-v1',profile_sha256:'c'.repeat(64),max_resident_child_threads:2,wait_agent_enabled:false,multi_agent_v1:false};
const SEED_RETIREMENT={epoch:1,boot_id:EPOCH_ONE_BOOT,session_id:SESSION,transition_id:null,observed_at:'2026-09-19T00:01:30.000Z',
 direct_child_stopped:true,execution_lock_free:true,session_lock_free:true,source:'synthetic-manager-observation'};

/** Builds the signed-HTTP harness for one background-generation Durable Object. */
function harness(o:{cap?:number;legacyReservationMicroUsd?:number}={}){
 const db=new TestDatabase();
 const auth={AUTH_MODE:'access',INSTALLATION_ID:'personal',ACCESS_ISSUER:ISSUER,ACCESS_AUD:'owner-aud',OWNER_SUB:'actual-owner'};
 const ownerBinding=createHash('sha256').update(JSON.stringify({auth_mode:'access',installation_id:'personal',issuer:ISSUER,audience:'owner-aud',owner_subject:'actual-owner'})).digest('hex');
 const backgroundConfig={schema_version:1,kind:'owner-alpha-background-generation-v1',installation_id:'personal',owner_id:'actual-owner',
  owner_binding_sha256:ownerBinding,policy_revision:'background-stage-b-v1',persona_id:bot,background:BACKGROUND_PROFILE,
  expires_at:'2026-09-19T00:20:00.000Z',max_task_seconds:30,max_admissions:3,
  prior_cost_micro_usd:1000,prior_cost_source:'synthetic-baseline',total_cap_micro_usd:o.cap??10000000,reservation_micro_usd:2000,seed_retirement:SEED_RETIREMENT};
 const buildEnv=(withBackground:boolean,mutate?:(config:Record<string,unknown>)=>void,extra?:Record<string,string|undefined>)=>{
  const config=JSON.parse(JSON.stringify(backgroundConfig)) as Record<string,unknown>;
  mutate?.(config);
  const base={...auth,EXECUTION_ENABLED:'false',NATIVE_VERIFIED:'false',PROVIDER_CONFIG:'{}',ACTION_POLICY_IDS:'[]',TOOL_POLICY_IDS:'[]',TRIGGER_CONFIG:'{}',
   HEHEBOT_HOSTED_OWNER_ALPHA:JSON.stringify({owner_binding_sha256:ownerBinding,policy:HOSTED_POLICY}),
   HEHEBOT_OWNER_ALPHA_MANAGER_TOKEN:MANAGER_TOKEN,HEHEBOT_OWNER_ALPHA_BACKGROUND_HOST_SIGNING_KEY:HOST_SIGNING_KEY,
   HEHEBOT_OWNER_ALPHA_BACKGROUND_TASK_SIGNING_KEY:TASK_SIGNING_KEY,RUNTIME_TOKEN:RUNTIME_TOKEN,PROVIDER_TOKEN:'p'.repeat(40),
   HEHEBOT_OWNER_ALPHA_WAKE_TOKEN:WAKE_TOKEN,
   ...(withBackground?{HEHEBOT_OWNER_ALPHA_WAKE:JSON.stringify({url:'https://fixture.sprites.app'}),HEHEBOT_OWNER_ALPHA_BACKGROUND_GENERATION:JSON.stringify(config)}:{}),...extra};
  for(const [key,value] of Object.entries(base))if(value===undefined)delete (base as Record<string,string>)[key];
  return base as unknown as Env;
 };
 let initialized:Promise<unknown>=Promise.resolve();
 let seedLegacyReservation:()=>void=()=>{};
 let env:Env;
 const ctx={storage:{sql:{exec:(sql:string,...values:(string|number|null)[])=>{const rows=db.all(sql,...values);return {toArray:()=>rows};}},
  transactionSync:<T>(fn:()=>T)=>db.transaction(fn),
  getAlarm:vi.fn(async()=>null),setAlarm:vi.fn(async()=>{}),deleteAlarm:vi.fn(async()=>{})},
  blockConcurrencyWhile:(fn:()=>Promise<unknown>)=>{initialized=fn();}};
 let core:ControlCore,lifecycle:LifecycleCore,control:PersonalControl;
 const reopen=async(withBackground:boolean,mutate?:(config:Record<string,unknown>)=>void,extra?:Record<string,string|undefined>)=>{
  env=buildEnv(withBackground,mutate,extra);
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
 return {db,reopen,request,core:()=>core,lifecycle:()=>lifecycle,backgroundConfig};
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

type CommandReceipt={id:string;resource_id:string;status:string;error:{code:string;message:string}|null};

it('validates background generation fields without checkpoints and preserves strict room authority',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-09-19T00:00:00.000Z'));
 const h=harness();
 try{
  await h.reopen(true);retireEpochOne(h.lifecycle());
  const response=await h.request('/v1/commands',{schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'Projection fixture'}},await ownerAssertion());
  expect(response.status).toBe(202);const receipt=await response.json() as CommandReceipt;
  const original=h.db.all<{context_json:string}>('SELECT context_json FROM runs WHERE id=?',receipt.resource_id)[0].context_json;
  const context=JSON.stringify({...JSON.parse(original),padding:'界'.repeat(400000)}),checkpoint=JSON.stringify({padding:'x'.repeat(1100000)});
  h.db.exec('UPDATE runs SET context_json=?,checkpoint_json=? WHERE id=?',context,checkpoint,receipt.resource_id);
  const read=vi.spyOn(h.db,'all');
  try{
   expect(h.core().ownerAlpha.activeGeneration()?.epoch).toBe(2);
   const rows=read.mock.calls.flatMap(([sql,id],i)=>sql.includes('FROM runs WHERE id=?')&&id===receipt.resource_id?read.mock.results[i].value:[]);
   expect(rows.length).toBeGreaterThan(0);
   for(const row of rows){expect(row).not.toHaveProperty('context_json');expect(row).not.toHaveProperty('checkpoint_json');}
   expect(rows).toContainEqual({room_is_null:1});
   for(const row of rows.filter(row=>'command_id' in row))expect(Object.keys(row).sort()).toEqual(['command_id','occurrence_id','parent_run_id','persona_id','role','routine_id']);
  }finally{read.mockRestore();}
  expect(h.db.all('SELECT context_json,checkpoint_json FROM runs WHERE id=?',receipt.resource_id)).toEqual([{context_json:context,checkpoint_json:checkpoint}]);
  for(const [roomContext,allowed] of [['{"room_id":null,"room_id":"foreign"}',false],['{"room_id":"foreign","room_id":null}',true],['{"room_id":false}',false],['{}',false]] as const){
   h.db.exec('UPDATE runs SET context_json=? WHERE id=?',roomContext,receipt.resource_id);
   if(allowed)expect(h.core().ownerAlpha.activeGeneration()?.epoch).toBe(2);
   else expect(()=>h.core().ownerAlpha.activeGeneration()).toThrow('Background manifest differs from its admitted run.');
  }
 }finally{h.db.close();vi.useRealTimers();}
});

it('admits the finite three-root A/S/B generation across real SQLite and signed HTTP',async()=>{
 vi.useFakeTimers({toFake:['Date']});
 vi.setSystemTime(new Date('2026-09-19T00:00:00.000Z'));
 const h=harness();
 try{
  await h.reopen(true);
  const owner=await ownerAssertion();
  const manager={Authorization:`Bearer ${MANAGER_TOKEN}`};
  const runtime={Authorization:`Bearer ${RUNTIME_TOKEN}`};
  const readState=async()=>{const r=await h.request('/v1/state',undefined,owner);expect(r.status).toBe(200);
   return (await r.json() as {summary:Record<string,unknown>}).summary;};
  const send=async(text:string,key:string)=>{const r=await h.request('/v1/commands',{schema_version:1,type:'message.send',payload:{conversation_id:bot,text}},owner,key);
   expect(r.status).toBe(202);return r.json() as Promise<CommandReceipt>;};
  const runCount=()=>h.db.all<{n:number}>('SELECT COUNT(*) AS n FROM runs')[0].n;
  retireEpochOne(h.lifecycle());
  grantPersonaPolicy(h.db);

  // Before the first admission the summary reports the frozen contract.
  let summary=await readState();
  expect(summary.owner_alpha_background).toMatchObject({schema_version:1,kind:'owner-alpha-background-summary-v1',policy_revision:'background-stage-b-v1',
   persona_id:bot,policy_expires_at:'2026-09-19T00:20:00.000Z',max_admissions:3,admissions_used:0,message_admission_available:true,next_role:'background',generation:null});
  expect(summary.owner_alpha_session).toBeUndefined();
  expect(summary.owner_alpha_bootstrap).toBeUndefined();
  expect(summary.owner_alpha_warm).toBeUndefined();

  // Admission 1 (role background): one generation, one manifest, one reservation.
  vi.setSystemTime(new Date('2026-09-19T00:02:30.000Z'));
  const keyA=randomUUID(),a=await send('Draft the quarterly plan. CANARY-A-PROVISIONAL',keyA);
  expect(a.status).toBe('applied');
  const gen=h.core().ownerAlpha.activeGeneration() as BackgroundGenerationView;
  expect(gen.epoch).toBe(2);
  expect(gen.policy).toMatchObject({persona_id:bot,expires_at:'2026-09-19T00:07:30.000Z',max_runs:3,max_task_seconds:30,background:BACKGROUND_PROFILE});
  const m1=gen.authority.admissions[0] as BackgroundManifest;
  expect(m1).toMatchObject({admission:1,role:'background',run_id:a.resource_id,issued_at:'2026-09-19T00:02:30.000Z',expires_at:'2026-09-19T00:03:00.000Z'});
  expect(m1.status_summary_sha256).toBeUndefined();
  expect(h.db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_background_generation:*'")).toHaveLength(1);
  expect(h.db.all<{key:string}>("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_background_manifest:*' ORDER BY key").map(x=>x.key)).toEqual(['owner_alpha_background_manifest:2:1']);
  expect(h.db.all("SELECT key FROM runtime_metadata WHERE key='owner_alpha_reservation:2:1'")).toHaveLength(1);
  const custodyA=Object.fromEntries(h.db.all<{key:string;value_json:string}>("SELECT key,value_json FROM runtime_metadata WHERE key GLOB 'owner_alpha_background_*' ORDER BY key").map(r=>[r.key,r.value_json]));
  summary=await readState();
  expect(summary.owner_alpha_background).toMatchObject({admissions_used:1,message_admission_available:false,next_role:null,
   generation:{epoch:2,expires_at:'2026-09-19T00:07:30.000Z'}});
  expect(summary.owner_alpha_session).toBeUndefined();
  expect(summary.owner_alpha_warm).toBeUndefined();

  // Only admission 1 creates the once-only wake intent.
  await h.lifecycle().deliverOwnerAlphaWake(gen.transition_id,async()=>{});
  expect(h.db.all("SELECT key FROM runtime_metadata WHERE key='owner_alpha_wake:2'")).toHaveLength(1);
  await h.lifecycle().deliverOwnerAlphaWake(gen.transition_id,async()=>{});
  expect(h.db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_wake:*'")).toHaveLength(1);

  // The manager launch envelope is frozen at the first admission: repeated
  // reads at different times return identical bytes with zero writes.
  let r=await h.request('/internal/background/manager/generation',{},manager);
  expect(r.status).toBe(200);
  const launch=await r.json() as {schema_version:number;kind:string;generation:{epoch:number;boot_id:string;transition_id:string;session_id:string;generation_sha256:string;
   policy:{persona_id:string;expires_at:string;max_runs:number;max_task_seconds:number;background:typeof BACKGROUND_PROFILE};
   predecessor:{epoch:number;boot_id:string;session_id:string}};host_credential:{grant:{issued_at:string;expires_at:string},token:string}};
  expect(launch).toMatchObject({schema_version:1,kind:'owner-alpha-background-launch-v1'});
  expect(launch.generation).toMatchObject({epoch:2,boot_id:gen.boot_id,transition_id:gen.transition_id,session_id:gen.policy.session_id,
   generation_sha256:gen.authority.generation_sha256,predecessor:{epoch:1,boot_id:EPOCH_ONE_BOOT,session_id:SESSION}});
  expect(launch.generation.policy).toEqual({persona_id:bot,expires_at:'2026-09-19T00:07:30.000Z',max_runs:3,max_task_seconds:30,background:BACKGROUND_PROFILE});
  expect(launch.host_credential.grant).toEqual({installation_id:'personal',epoch:2,boot_id:gen.boot_id,transition_id:gen.transition_id,
   generation_sha256:gen.authority.generation_sha256,issued_at:'2026-09-19T00:02:30.000Z',expires_at:'2026-09-19T00:07:30.000Z'});
  expect(launch.host_credential.token.length).toBeGreaterThan(0);
  vi.setSystemTime(new Date('2026-09-19T00:02:32.000Z'));
  const metaBefore=JSON.stringify(h.db.all("SELECT key,value_json FROM runtime_metadata ORDER BY key"));
  r=await h.request('/internal/background/manager/generation',{},manager);
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual(launch);
  expect(JSON.stringify(h.db.all("SELECT key,value_json FROM runtime_metadata ORDER BY key"))).toBe(metaBefore);
  const host={Authorization:`Bearer ${launch.host_credential.token}`};
  const identity={epoch:2,boot_id:gen.boot_id};

  vi.setSystemTime(new Date('2026-09-19T00:02:30.500Z'));
  r=await h.request('/internal/background/host/boot',{boot_id:gen.boot_id},host);
  expect(r.status).toBe(200);
  r=await h.request('/internal/background/host/ready',{identity},host);
  expect(r.status).toBe(200);
  // A READY generation never yields a second launch envelope.
  r=await h.request('/internal/background/manager/generation',{},manager);
  expect(r.status).toBe(200);
  expect(await r.json()).toBeNull();
  r=await h.request('/internal/background/host/status',{},host);
  expect(r.status).toBe(200);
  const status=await r.json() as {phase:string;epoch:number;owner_alpha_background_generation?:unknown;owner_alpha_generation?:unknown;owner_alpha_warm_generation?:unknown};
  expect(status.phase).toBe('READY');
  expect(status.owner_alpha_background_generation).toEqual({epoch:2,boot_id:gen.boot_id,transition_id:gen.transition_id});
  expect(status.owner_alpha_generation).toBeUndefined();
  expect(status.owner_alpha_warm_generation).toBeUndefined();

  // A claims with the restricted per-task context and its own V2 flag.
  vi.setSystemTime(new Date('2026-09-19T00:02:31.000Z'));
  r=await h.request('/internal/background/host/claim',{identity},host);
  expect(r.status).toBe(200);
  const claimA=await r.json() as {schema_version:number;kind:string;run:{id:string;context_json:string};submission_key:string;deadline_at:string;
   role:string;background:typeof BACKGROUND_PROFILE;manifest:{admission:number;role:string;manifest_sha256:string;expires_at:string};
   task_credential:{token:string};status_summary?:unknown;owner_alpha_background?:true};
  expect(claimA).toMatchObject({schema_version:1,kind:'owner-alpha-background-claim-v1',role:'background',
   submission_key:`${m1.run_id}:1`,deadline_at:'2026-09-19T00:03:00.000Z',owner_alpha_background:true});
  expect(claimA.run.id).toBe(m1.run_id);
  expect(claimA.manifest).toEqual({admission:1,role:'background',manifest_sha256:m1.manifest_sha256,expires_at:'2026-09-19T00:03:00.000Z'});
  expect(claimA.background).toEqual(BACKGROUND_PROFILE);
  expect(claimA.status_summary).toBeUndefined();
  expect(claimA.task_credential.token.length).toBeGreaterThan(0);
  const contextA=JSON.parse(claimA.run.context_json) as Record<string,unknown>;
  expect(contextA).toMatchObject({schema_version:1,scope_key:`${bot}/background/${m1.run_id}`,room_id:null,instruction:'Draft the quarterly plan. CANARY-A-PROVISIONAL',memories:[]});
  expect(contextA.conversation_history).toBeUndefined();
  expect(contextA.task_summaries).toBeUndefined();
  const taskA={Authorization:`Bearer ${claimA.task_credential.token}`};
  const scopeA={identity,run_id:m1.run_id,attempt:1};

  // Bounded task reads pass the captured persona policy; other routes stay denied.
  r=await h.request('/internal/background/task/agent-routines',scopeA,taskA);
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({routines:[],next_cursor:null});
  r=await h.request('/internal/background/task/agent-skill',{...scopeA,skill_id:randomUUID()},taskA);
  expect(r.status).toBe(404);
  r=await h.request('/internal/background/task/agent-command',{...scopeA,idempotency_key:'k'.repeat(16),command:{schema_version:1,type:'routine.run',payload:{}}},taskA);
  expect(r.status).toBe(403);
  r=await h.request('/internal/background/task/steer-result',{...scopeA,command_id:randomUUID(),status:'not_delivered'},taskA);
  expect(r.status).toBe(403);
  const foreignRun=randomUUID();
  r=await h.request('/internal/background/task/agent-routines',{identity,run_id:foreignRun,attempt:1},taskA);
  expect(r.status).toBe(403);
  r=await h.request('/internal/background/task/agent-routines',{...scopeA,attempt:2},taskA);
  expect(r.status).toBe(403);
  // Crossed credentials: task on host, host on task, manager and legacy runtime tokens.
  r=await h.request('/internal/background/host/status',{},taskA);
  expect(r.status).toBe(401);
  r=await h.request('/internal/background/task/agent-routines',scopeA,host);
  expect(r.status).toBe(401);
  r=await h.request('/internal/background/host/status',{},manager);
  expect(r.status).toBe(401);
  r=await h.request('/internal/background/task/agent-routines',scopeA,manager);
  expect(r.status).toBe(401);
  r=await h.request('/internal/background/host/status',{},runtime);
  expect(r.status).toBe(401);
  r=await h.request('/internal/background/host/question-take',{identity,question_id:randomUUID(),connection_id:randomUUID()},host);
  expect(r.status).toBe(403);

  // A never completes: with or without any receipt.
  r=await h.request('/internal/background/host/complete',{...scopeA,result:{status:'completed',text:'The plan.'}},host);
  expect(r.status).toBe(409);
  expect(await r.json()).toMatchObject({error:{code:'CAPABILITY_UNAVAILABLE'}});
  r=await h.request('/internal/background/host/complete',{...scopeA,result:{status:'completed',text:'The plan.'},
   background_receipt:{thread_id:'thread-a',turn_id:'turn-a',output_sha256:createHash('sha256').update('The plan.').digest('hex')}},host);
  expect(r.status).toBe(409);
  expect(await r.json()).toMatchObject({error:{code:'CAPABILITY_UNAVAILABLE'}});

  // A's provisional output canary is recorded before S exists.
  vi.setSystemTime(new Date('2026-09-19T00:02:32.000Z'));
  r=await h.request('/internal/background/host/output-preview',{...scopeA,native_ref:'turn-a',version:1,text:'The quarterly plan is CANARY-A-PREVIEW',truncated:true},host);
  expect(r.status).toBe(200);
  r=await h.request('/internal/background/host/submitted',{...scopeA,native_ref:'turn-a'},host);
  expect(r.status).toBe(200);

  // A's observed native descendant: idempotent, never settlement.
  vi.setSystemTime(new Date('2026-09-19T00:02:32.200Z'));
  const childReceipt={parent_run_id:m1.run_id,parent_attempt:1,persona_id:bot,native_run_ref:'child-turn-one',native_session_key:'child-session-one',title:'CHILD-TITLE-CANARY'};
  r=await h.request('/internal/background/host/native-child',{identity,child:childReceipt,started:true},host);
  expect(r.status).toBe(200);
  const child=await r.json() as {id:string;status:string};
  expect(child.status).toBe('running');
  const runsAfterChild=runCount();
  r=await h.request('/internal/background/host/native-child',{identity,child:childReceipt,started:true},host);
  expect(r.status).toBe(200);
  expect(await r.json()).toMatchObject({id:child.id,status:'running'});
  expect(runCount()).toBe(runsAfterChild);
  r=await h.request('/internal/background/host/native-child',{identity,child:{...childReceipt,parent_run_id:child.id,parent_attempt:1,native_run_ref:'nested-turn',native_session_key:'nested-session',title:'NESTED'},started:true},host);
  expect(r.status).toBe(403);
  expect(await r.json()).toMatchObject({error:{code:'FORBIDDEN'}});

  // S is denied while A's coordinator lane is still occupied.
  vi.setSystemTime(new Date('2026-09-19T00:02:33.000Z'));
  const beforeS=runCount();
  let s=await send('Report the current status. CANARY-S-INSTRUCTION',randomUUID());
  expect(s.status).toBe('rejected');
  expect(s.error?.code).toBe('RESOURCE_BUSY');
  expect(runCount()).toBe(beforeS);

  // Trusted coordinator release of A: A stays unsettled, lane frees for S.
  vi.setSystemTime(new Date('2026-09-19T00:02:34.000Z'));
  r=await h.request('/internal/background/host/coordinator-release',{...scopeA,native_ref:'turn-a',outcome:'completed'},host);
  expect(r.status).toBe(200);
  expect(h.core().store.run(m1.run_id).status).toBe('running');
  summary=await readState();
  expect(summary.owner_alpha_background).toMatchObject({admissions_used:1,message_admission_available:true,next_role:'status'});

  // A still never completes after its release.
  r=await h.request('/internal/background/host/complete',{...scopeA,result:{status:'completed',text:'The plan.'},
   background_receipt:{thread_id:'thread-a',turn_id:'turn-a',output_sha256:createHash('sha256').update('The plan.').digest('hex')}},host);
  expect(r.status).toBe(409);
  expect(await r.json()).toMatchObject({error:{code:'CAPABILITY_UNAVAILABLE'}});

  // Admission 2 (role status) while A's registered child stays active.
  vi.setSystemTime(new Date('2026-09-19T00:02:36.000Z'));
  s=await send('Report the current status. CANARY-S-INSTRUCTION',randomUUID());
  expect(s.status).toBe('applied');
  const gen2=h.core().ownerAlpha.activeGeneration() as BackgroundGenerationView;
  expect(gen2.epoch).toBe(2);
  expect(gen2.boot_id).toBe(gen.boot_id);
  const m2=gen2.authority.admissions[1] as BackgroundManifest;
  expect(m2).toMatchObject({admission:2,role:'status',run_id:s.resource_id,issued_at:'2026-09-19T00:02:36.000Z',expires_at:'2026-09-19T00:03:06.000Z'});
  expect(typeof m2.status_summary_sha256).toBe('string');
  expect(h.db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_background_generation:*'")).toHaveLength(1);
  expect(h.db.all<{key:string}>("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_background_manifest:*' ORDER BY key").map(x=>x.key))
   .toEqual(['owner_alpha_background_manifest:2:1','owner_alpha_background_manifest:2:2']);
  expect(h.db.all("SELECT key FROM runtime_metadata WHERE key='owner_alpha_reservation:2:2'")).toHaveLength(1);
  expect(h.db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_wake:*'")).toHaveLength(1);
  expect(h.core().store.run(child.id).status).toBe('running');
  // The write-once descriptor and first manifest keep their exact bytes.
  const custodyAfterS=Object.fromEntries(h.db.all<{key:string;value_json:string}>("SELECT key,value_json FROM runtime_metadata WHERE key GLOB 'owner_alpha_background_*' ORDER BY key").map(r2=>[r2.key,r2.value_json]));
  expect(custodyAfterS['owner_alpha_background_generation:2']).toBe(custodyA['owner_alpha_background_generation:2']);
  expect(custodyAfterS['owner_alpha_background_manifest:2:1']).toBe(custodyA['owner_alpha_background_manifest:2:1']);

  // The frozen status summary bytes: admission 1 only, computed exactly once.
  const summaryRow=h.db.all<{value_json:string}>("SELECT value_json FROM runtime_metadata WHERE key='owner_alpha_background_status:2:2'")[0];
  expect(summaryRow).toBeTruthy();
  expect(createHash('sha256').update(summaryRow.value_json).digest('hex')).toBe(m2.status_summary_sha256);
  const frozen=JSON.parse(summaryRow.value_json) as BackgroundStatusSummary;
  expect(frozen).toMatchObject({schema_version:1,kind:'owner-alpha-background-status-summary-v1',
   generation:{epoch:2,generation_sha256:gen.authority.generation_sha256},computed_at:'2026-09-19T00:02:36.000Z'});
  expect(frozen.admissions).toEqual([{admission:1,role:'background',run_id:m1.run_id,run_status:'running',attempt_status:'running',
   coordinator_released:true,deadline_at:'2026-09-19T00:03:00.000Z',child_count:1,manifest_sha256:m1.manifest_sha256}]);
  expect(summaryRow.value_json).not.toContain('CANARY');

  // S claims with the frozen summary and no cross-task transcript.
  vi.setSystemTime(new Date('2026-09-19T00:02:37.000Z'));
  r=await h.request('/internal/background/host/claim',{identity},host);
  expect(r.status).toBe(200);
  const claimS=await r.json() as typeof claimA&{status_summary:BackgroundStatusSummary};
  expect(claimS).toMatchObject({schema_version:1,kind:'owner-alpha-background-claim-v1',role:'status',
   submission_key:`${m2.run_id}:1`,deadline_at:'2026-09-19T00:03:06.000Z'});
  expect(claimS.owner_alpha_background).toBeUndefined();
  expect(claimS.status_summary).toEqual(frozen);
  expect(claimS.manifest).toEqual({admission:2,role:'status',manifest_sha256:m2.manifest_sha256,expires_at:'2026-09-19T00:03:06.000Z'});
  const contextS=JSON.parse(claimS.run.context_json) as Record<string,unknown>;
  expect(contextS.scope_key).toBe(`${bot}/background/${m2.run_id}`);
  expect(contextS.memories).toEqual([]);
  expect(contextS.conversation_history).toBeUndefined();
  expect(contextS.task_summaries).toBeUndefined();
  expect(claimS.run.context_json).not.toContain('CANARY-A-PROVISIONAL');
  expect(claimS.run.context_json).not.toContain('CANARY-A-PREVIEW');
  expect(claimS.run.context_json).not.toContain('CHILD-TITLE-CANARY');
  const taskS={Authorization:`Bearer ${claimS.task_credential.token}`};
  const scopeS={identity,run_id:m2.run_id,attempt:1};
  r=await h.request('/internal/background/task/agent-routines',scopeS,taskS);
  expect(r.status).toBe(200);
  r=await h.request('/internal/background/task/agent-routines',scopeA,taskS);
  expect(r.status).toBe(403);

  // B is denied until S settles canonically.
  vi.setSystemTime(new Date('2026-09-19T00:02:38.000Z'));
  const beforeB=runCount();
  let b=await send('Compute the independent estimate. CANARY-B-INSTRUCTION',randomUUID());
  expect(b.status).toBe('rejected');
  expect(b.error?.code).toBe('CAPABILITY_UNAVAILABLE');
  expect(runCount()).toBe(beforeB);

  // S completion requires the exact root-only receipt.
  r=await h.request('/internal/background/host/complete',{...scopeS,result:{status:'completed',text:'Status report complete. SECRET-S-CANARY'}},host);
  expect(r.status).toBe(409);
  r=await h.request('/internal/background/host/complete',{...scopeS,result:{status:'completed',text:'Status report complete. SECRET-S-CANARY'},
   background_receipt:{thread_id:'thread-s',turn_id:'turn-s',output_sha256:createHash('sha256').update('wrong').digest('hex')}},host);
  expect(r.status).toBe(409);
  expect(await r.json()).toMatchObject({error:{code:'CAPABILITY_UNAVAILABLE'}});

  vi.setSystemTime(new Date('2026-09-19T00:02:39.500Z'));
  r=await h.request('/internal/background/host/submitted',{...scopeS,native_ref:'turn-s'},host);
  expect(r.status).toBe(200);
  vi.setSystemTime(new Date('2026-09-19T00:02:40.000Z'));
  r=await h.request('/internal/background/host/coordinator-release',{...scopeS,native_ref:'turn-s',outcome:'completed'},host);
  expect(r.status).toBe(200);
  vi.setSystemTime(new Date('2026-09-19T00:02:41.000Z'));
  const receiptS={thread_id:'thread-s',turn_id:'turn-s',output_sha256:createHash('sha256').update('Status report complete. SECRET-S-CANARY').digest('hex')};
  r=await h.request('/internal/background/host/complete',{...scopeS,result:{status:'completed',text:'Status report complete. SECRET-S-CANARY'},background_receipt:receiptS},host);
  expect(r.status).toBe(200);
  expect(h.core().store.run(m2.run_id).status).toBe('completed');
  expect(h.db.all("SELECT key FROM runtime_metadata WHERE key='owner_alpha_background_receipt:2'")).toEqual([]);
  expect(h.db.all<{value_json:string}>("SELECT value_json FROM runtime_metadata WHERE key=?",`owner_alpha_background_receipt:${m2.run_id}:1`).map(x=>x.value_json))
   .toEqual([JSON.stringify(receiptS)]);
  // Idempotent replay; conflicting text and mixed receipts are denied.
  r=await h.request('/internal/background/host/complete',{...scopeS,result:{status:'completed',text:'Status report complete. SECRET-S-CANARY'},background_receipt:receiptS},host);
  expect(r.status).toBe(200);
  r=await h.request('/internal/background/host/complete',{...scopeS,result:{status:'completed',text:'A different answer.'},
   background_receipt:{...receiptS,output_sha256:createHash('sha256').update('A different answer.').digest('hex')}},host);
  expect(r.status).toBe(409);
  expect(await r.json()).toMatchObject({error:{code:'RESULT_CONFLICT'}});
  r=await h.request('/internal/background/host/complete',{...scopeS,result:{status:'completed',text:'Status report complete. SECRET-S-CANARY'},background_receipt:receiptS,
   text_only_receipt:{profile_version:'codex-text-only-v1',profile_sha256:'c'.repeat(64),thread_id:'thread-s',turn_id:'turn-s',output_sha256:receiptS.output_sha256}},host);
  expect(r.status).toBe(409);
  expect(await r.json()).toMatchObject({error:{code:'CAPABILITY_UNAVAILABLE'}});
  // The frozen summary never recomputes after S settles.
  expect(h.db.all<{value_json:string}>("SELECT value_json FROM runtime_metadata WHERE key='owner_alpha_background_status:2:2'")[0].value_json).toBe(summaryRow.value_json);
  expect(h.core().background.statusSummary(2).admissions[0].run_status).toBe('running');

  // Admission 3 (role independent) after S settles.
  vi.setSystemTime(new Date('2026-09-19T00:02:45.000Z'));
  b=await send('Compute the independent estimate. CANARY-B-INSTRUCTION',randomUUID());
  expect(b.status).toBe('applied');
  const gen3=h.core().ownerAlpha.activeGeneration() as BackgroundGenerationView;
  const m3=gen3.authority.admissions[2] as BackgroundManifest;
  expect(m3).toMatchObject({admission:3,role:'independent',run_id:b.resource_id,issued_at:'2026-09-19T00:02:45.000Z',expires_at:'2026-09-19T00:03:15.000Z'});
  expect(h.db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_background_generation:*'")).toHaveLength(1);
  expect(h.db.all("SELECT key FROM runtime_metadata WHERE key='owner_alpha_reservation:2:3'")).toHaveLength(1);
  expect(h.db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_wake:*'")).toHaveLength(1);
  expect(h.core().store.run(child.id).status).toBe('running');
  summary=await readState();
  expect(summary.owner_alpha_background).toMatchObject({admissions_used:3,message_admission_available:false,next_role:null});

  // S never admits native descendants while claimed.
  r=await h.request('/internal/background/host/native-child',{identity,child:{...childReceipt,parent_run_id:m2.run_id,native_run_ref:'child-of-s',native_session_key:'session-of-s'},started:true},host);
  expect(r.status).toBe(403);
  expect(await r.json()).toMatchObject({error:{code:'FORBIDDEN'}});

  // The generation is finite: no fourth admission.
  vi.setSystemTime(new Date('2026-09-19T00:02:46.000Z'));
  const beforeFourth=runCount();
  const fourth=await send('One more thing.',randomUUID());
  expect(fourth.status).toBe('rejected');
  expect(fourth.error?.code).toBe('CAPABILITY_UNAVAILABLE');
  expect(runCount()).toBe(beforeFourth);

  // Claim with under one second remaining is denied before any mutation.
  vi.setSystemTime(new Date('2026-09-19T00:03:14.100Z'));
  r=await h.request('/internal/background/host/claim',{identity},host);
  expect(r.status).toBe(409);
  expect(await r.json()).toMatchObject({error:{code:'CAPABILITY_UNAVAILABLE'}});
  expect(h.db.all("SELECT * FROM attempts WHERE run_id=?",m3.run_id)).toEqual([]);
  // Exactly one second remaining is the accepted boundary.
  vi.setSystemTime(new Date('2026-09-19T00:03:14.000Z'));
  r=await h.request('/internal/background/host/claim',{identity},host);
  expect(r.status).toBe(200);
  const claimB=await r.json() as typeof claimA;
  expect(claimB).toMatchObject({schema_version:1,kind:'owner-alpha-background-claim-v1',role:'independent',
   submission_key:`${m3.run_id}:1`,deadline_at:'2026-09-19T00:03:15.000Z'});
  expect(claimB.owner_alpha_background).toBeUndefined();
  expect(claimB.status_summary).toBeUndefined();
  expect(claimB.run.context_json).not.toContain('SECRET-S-CANARY');
  expect(claimB.run.context_json).not.toContain('CANARY-A-PROVISIONAL');
  const contextB=JSON.parse(claimB.run.context_json) as Record<string,unknown>;
  expect(contextB.scope_key).toBe(`${bot}/background/${m3.run_id}`);
  expect(contextB.memories).toEqual([]);
  const taskB={Authorization:`Bearer ${claimB.task_credential.token}`};
  const scopeB={identity,run_id:m3.run_id,attempt:1};
  r=await h.request('/internal/background/task/agent-routines',scopeB,taskB);
  expect(r.status).toBe(200);
  // A claimed B root also never admits native descendants.
  r=await h.request('/internal/background/host/native-child',{identity,child:{...childReceipt,parent_run_id:m3.run_id,native_run_ref:'child-of-b',native_session_key:'session-of-b'},started:true},host);
  expect(r.status).toBe(403);
  expect(await r.json()).toMatchObject({error:{code:'FORBIDDEN'}});

  vi.setSystemTime(new Date('2026-09-19T00:03:14.200Z'));
  r=await h.request('/internal/background/host/submitted',{...scopeB,native_ref:'turn-b'},host);
  expect(r.status).toBe(200);
  vi.setSystemTime(new Date('2026-09-19T00:03:14.300Z'));
  r=await h.request('/internal/background/host/coordinator-release',{...scopeB,native_ref:'turn-b',outcome:'completed'},host);
  expect(r.status).toBe(200);
  vi.setSystemTime(new Date('2026-09-19T00:03:14.400Z'));
  const receiptB={thread_id:'thread-b',turn_id:'turn-b',output_sha256:createHash('sha256').update('Independent estimate complete.').digest('hex')};
  r=await h.request('/internal/background/host/complete',{...scopeB,result:{status:'completed',text:'Independent estimate complete.'},background_receipt:receiptB},host);
  expect(r.status).toBe(200);
  expect(h.core().store.run(m3.run_id).status).toBe('completed');
  r=await h.request('/internal/background/host/complete',{...scopeB,result:{status:'completed',text:'Independent estimate complete.'},background_receipt:receiptB},host);
  expect(r.status).toBe(200);
  r=await h.request('/internal/background/host/complete',{...scopeB,result:{status:'completed',text:'Rewritten.'},
   background_receipt:{...receiptB,output_sha256:createHash('sha256').update('Rewritten.').digest('hex')}},host);
  expect(r.status).toBe(409);
  r=await h.request('/internal/background/host/complete',{...scopeB,result:{status:'completed',text:'Independent estimate complete.'},background_receipt:receiptB,
   text_only_receipt:{profile_version:'codex-text-only-v1',profile_sha256:'c'.repeat(64),thread_id:'thread-b',turn_id:'turn-b',output_sha256:receiptB.output_sha256}},host);
  expect(r.status).toBe(409);
  expect(await r.json()).toMatchObject({error:{code:'CAPABILITY_UNAVAILABLE'}});

  // A remains unsettled while S and B are canonically settled.
  expect(h.core().store.run(m1.run_id).status).toBe('running');
  expect(warmLedgerUsed(h.db,1000)).toBe(7000); // baseline + three background reservations

  // Legacy and warm routes are not a bypass into the background generation.
  r=await h.request('/internal/status',{},runtime);
  expect(r.status).toBe(404);
  r=await h.request('/internal/warm/host/status',{},host);
  expect(r.status).toBe(404);
  r=await h.request('/internal/warm/manager/generation',{},manager);
  expect(r.status).toBe(404);
  r=await h.request('/internal/manager/manifest',{},manager);
  expect(r.status).toBe(404);

  // Reconstruction from durable rows: custody bytes and statuses are exact.
  const custodyBeforeReopen=Object.fromEntries(h.db.all<{key:string;value_json:string}>("SELECT key,value_json FROM runtime_metadata WHERE key GLOB 'owner_alpha_*' ORDER BY key").map(r2=>[r2.key,r2.value_json]));
  vi.setSystemTime(new Date('2026-09-19T00:03:20.000Z'));
  await h.reopen(true);
  const custodyAfterReopen=Object.fromEntries(h.db.all<{key:string;value_json:string}>("SELECT key,value_json FROM runtime_metadata WHERE key GLOB 'owner_alpha_*' ORDER BY key").map(r2=>[r2.key,r2.value_json]));
  expect(custodyAfterReopen).toEqual(custodyBeforeReopen);
  const reopened=h.core().ownerAlpha.activeGeneration() as BackgroundGenerationView;
  expect(reopened.epoch).toBe(2);
  expect(reopened.authority.admissions.map(x=>x.role)).toEqual(['background','status','independent']);
  expect(h.core().background.statusSummary(2)).toEqual(frozen);
  expect(h.core().store.run(m2.run_id).status).toBe('completed');
  expect(h.core().store.run(m3.run_id).status).toBe('completed');

  // Expired credentials are rejected while the retained generation stays live.
  vi.setSystemTime(new Date('2026-09-19T00:07:31.000Z'));
  r=await h.request('/internal/background/host/status',{},host);
  expect(r.status).toBe(401);
  r=await h.request('/internal/background/task/agent-routines',scopeB,taskB);
  expect(r.status).toBe(401);
  r=await h.request('/internal/background/manager/generation',{},manager);
  expect(r.status).toBe(200);
  expect(await r.json()).toBeNull();
  const expired=await send('After expiry.',randomUUID());
  expect(expired.status).toBe('rejected');
  expect(expired.error?.code).toBe('CAPABILITY_UNAVAILABLE');
  expect(runCount()).toBe(beforeFourth);
 }finally{h.db.close();vi.useRealTimers();}
});

it('denies the second admission when the lifetime budget is exhausted and never refunds',async()=>{
 vi.useFakeTimers({toFake:['Date']});
 vi.setSystemTime(new Date('2026-09-19T00:00:00.000Z'));
 const h=harness({cap:5500,legacyReservationMicroUsd:1500});
 try{
  await h.reopen(true);
  const owner=await ownerAssertion();
  const send=async(text:string,key:string)=>{const r=await h.request('/v1/commands',{schema_version:1,type:'message.send',payload:{conversation_id:bot,text}},owner,key);
   expect(r.status).toBe(202);return r.json() as Promise<CommandReceipt>;};
  retireEpochOne(h.lifecycle());
  grantPersonaPolicy(h.db);

  // Baseline 1000 + legacy reservation 1500 + A reservation 2000 = 4500 ≤ 5500.
  vi.setSystemTime(new Date('2026-09-19T00:02:30.000Z'));
  const a=await send('First admitted message.',randomUUID());
  expect(a.status).toBe('applied');
  expect(warmLedgerUsed(h.db,1000)).toBe(4500);

  // Complete A's coordinator release, then S would need 6500 > 5500.
  const gen=h.core().ownerAlpha.activeGeneration() as BackgroundGenerationView;
  const m1=gen.authority.admissions[0];
  const identity={epoch:2,boot_id:gen.boot_id};
  const boot=h.lifecycle().registerBoot(gen.boot_id);
  h.lifecycle().ready(boot);
  const claimed=h.lifecycle().claim(boot);
  expect(claimed?.run.id).toBe(m1.run_id);
  h.lifecycle().submitted(boot,m1.run_id,1,'turn-a');
  h.lifecycle().coordinatorRelease(boot,m1.run_id,1,'turn-a','completed');
  vi.setSystemTime(new Date('2026-09-19T00:02:36.000Z'));
  const s=await send('Second message over budget.',randomUUID());
  expect(s.status).toBe('rejected');
  expect(s.error?.code).toBe('BUDGET_EXCEEDED');
  expect(h.db.all("SELECT id FROM runs WHERE command_id=?",s.id)).toEqual([]);
  expect(h.db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_background_manifest:*'")).toHaveLength(1);
  expect(h.db.all("SELECT key FROM runtime_metadata WHERE key='owner_alpha_reservation:2:2'")).toEqual([]);
  expect(warmLedgerUsed(h.db,1000)).toBe(4500); // no reset, no refund
  expect(h.db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_wake:*'")).toHaveLength(0);
 }finally{h.db.close();vi.useRealTimers();}
});

it('fails closed when the configuration is removed and settles only via manager retirement',async()=>{
 vi.useFakeTimers({toFake:['Date']});
 vi.setSystemTime(new Date('2026-09-19T00:00:00.000Z'));
 const h=harness();
 try{
  await h.reopen(true);
  const owner=await ownerAssertion();
  const manager={Authorization:`Bearer ${MANAGER_TOKEN}`};
  const runtime={Authorization:`Bearer ${RUNTIME_TOKEN}`};
  const send=async(text:string,key:string)=>{const r=await h.request('/v1/commands',{schema_version:1,type:'message.send',payload:{conversation_id:bot,text}},owner,key);
   expect(r.status).toBe(202);return r.json() as Promise<CommandReceipt>;};
  retireEpochOne(h.lifecycle());
  grantPersonaPolicy(h.db);
  vi.setSystemTime(new Date('2026-09-19T00:02:30.000Z'));
  const a=await send('Draft the quarterly plan.',randomUUID());
  expect(a.status).toBe('applied');
  const gen=h.core().ownerAlpha.activeGeneration() as BackgroundGenerationView;
  const m1=gen.authority.admissions[0];
  const retirement={epoch:2,boot_id:gen.boot_id,session_id:gen.policy.session_id,transition_id:gen.transition_id,
   observed_at:'2026-09-19T00:07:30.000Z',direct_child_stopped:true,execution_lock_free:true,session_lock_free:true,source:'synthetic-manager-observation'};
  const identity={epoch:2,boot_id:gen.boot_id};
  const boot=h.lifecycle().registerBoot(gen.boot_id);
  h.lifecycle().ready(boot);
  h.lifecycle().claim(boot);
  const custody=Object.fromEntries(h.db.all<{key:string;value_json:string}>("SELECT key,value_json FROM runtime_metadata WHERE key GLOB 'owner_alpha_*' ORDER BY key").map(r=>[r.key,r.value_json]));

  // Removing the configuration mid-generation denies every route and message.
  vi.setSystemTime(new Date('2026-09-19T00:02:40.000Z'));
  await h.reopen(false);
  const removed=await send('One more after removal.',randomUUID());
  expect(removed.status).toBe('rejected');
  expect(removed.error?.code).toBe('CAPABILITY_UNAVAILABLE');
  expect(h.db.all("SELECT id FROM events WHERE id=? AND type='message.user'",removed.id)).toEqual([]);
  let r=await h.request('/internal/background/manager/generation',{},manager);
  expect(r.status).toBe(404);
  r=await h.request('/internal/status',{},runtime);
  expect(r.status).toBe(404);
  // Retirement stays reachable but rejects observations before expiry.
  r=await h.request('/internal/background/manager/retirement',{...retirement,observed_at:'2026-09-19T00:02:40.000Z'},manager);
  expect(r.status).toBe(422);
  expect(await r.json()).toMatchObject({error:{code:'INVALID_INPUT'}});
  expect(h.db.all("SELECT key FROM runtime_metadata WHERE key='owner_alpha_retirement:2'")).toEqual([]);

  // The exact configuration reconstructs the retained custody.
  vi.setSystemTime(new Date('2026-09-19T00:02:45.000Z'));
  await h.reopen(true);
  expect(Object.fromEntries(h.db.all<{key:string;value_json:string}>("SELECT key,value_json FROM runtime_metadata WHERE key GLOB 'owner_alpha_*' ORDER BY key").map(x=>[x.key,x.value_json]))).toEqual(custody);
  expect((h.core().ownerAlpha.activeGeneration() as BackgroundGenerationView).epoch).toBe(2);
  expect(h.lifecycle().get().epoch).toBe(2);

  // A changed configuration is denied; no fallback to legacy or warm.
  vi.setSystemTime(new Date('2026-09-19T00:02:50.000Z'));
  await expect(h.reopen(true,config=>{config.reservation_micro_usd=3000;})).rejects.toMatchObject({code:'INVALID_CONFIGURATION'});
  await expect(h.reopen(false,undefined,{HEHEBOT_OWNER_ALPHA_WARM_GENERATION:JSON.stringify({schema_version:1,kind:'owner-alpha-warm-generation-v1',installation_id:'personal',owner_id:'actual-owner',
    owner_binding_sha256:'0'.repeat(64),policy_revision:'warm-x',persona_id:bot,text_only:{profile_version:'codex-text-only-v1',profile_sha256:'c'.repeat(64)},
    expires_at:'2026-09-19T00:20:00.000Z',max_task_seconds:30,max_admissions:2,prior_cost_micro_usd:0,prior_cost_source:'x',total_cap_micro_usd:1000,reservation_micro_usd:1}),
   HEHEBOT_OWNER_ALPHA_HOST_SIGNING_KEY:'q'.repeat(40),HEHEBOT_OWNER_ALPHA_TASK_SIGNING_KEY:'t'.repeat(40)}))
   .rejects.toMatchObject({code:'INVALID_CONFIGURATION'});

  // After expiry the retained generation still denies messages; retirement is
  // manager-only, idempotent, and grants no successor.
  vi.setSystemTime(new Date('2026-09-19T00:07:31.000Z'));
  await h.reopen(false);
  const expired=await send('After expiry removal.',randomUUID());
  expect(expired.status).toBe('rejected');
  expect(expired.error?.code).toBe('CAPABILITY_UNAVAILABLE');
  r=await h.request('/internal/background/manager/retirement',retirement,manager);
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({accepted:true});
  r=await h.request('/internal/background/manager/retirement',retirement,manager);
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({accepted:true});
  r=await h.request('/internal/background/manager/retirement',{...retirement,observed_at:'2026-09-19T00:07:31.000Z'},manager);
  expect(r.status).toBe(422);
  expect(h.db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_generation:*'")).toEqual([]);
  expect(h.db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_warm_generation:*'")).toEqual([]);
  expect(h.db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_background_generation:*'")).toHaveLength(1);
  // No rollover: the exact background configuration still reconstructs only the
  // retired custody, and every further message stays denied.
  await h.reopen(true);
  const after=await send('No successor after retirement.',randomUUID());
  expect(after.status).toBe('rejected');
  expect(after.error?.code).toBe('CAPABILITY_UNAVAILABLE');
  // The unsettled first root keeps its durable state; no completion exists for it.
  expect(['claimed','recovery_required']).toContain(h.core().store.run(m1.run_id).status);
 }finally{h.db.close();vi.useRealTimers();}
});

it('cascades cancellation of A only to its descendants and keeps S/B unaffected',async()=>{
 vi.useFakeTimers({toFake:['Date']});
 vi.setSystemTime(new Date('2026-09-19T00:00:00.000Z'));
 const h=harness();
 try{
  await h.reopen(true);
  const owner=await ownerAssertion();
  const manager={Authorization:`Bearer ${MANAGER_TOKEN}`};
  const send=async(text:string,key:string)=>{const r=await h.request('/v1/commands',{schema_version:1,type:'message.send',payload:{conversation_id:bot,text}},owner,key);
   expect(r.status).toBe(202);return r.json() as Promise<CommandReceipt>;};
  retireEpochOne(h.lifecycle());
  grantPersonaPolicy(h.db);
  vi.setSystemTime(new Date('2026-09-19T00:02:30.000Z'));
  const a=await send('Draft the quarterly plan.',randomUUID());
  expect(a.status).toBe('applied');
  const gen=h.core().ownerAlpha.activeGeneration() as BackgroundGenerationView;
  const m1=gen.authority.admissions[0];
  const identity={epoch:2,boot_id:gen.boot_id};
  const r0=await h.request('/internal/background/manager/generation',{},manager);
  expect(r0.status).toBe(200);
  const launch=await r0.json() as {host_credential:{token:string}};
  const host={Authorization:`Bearer ${launch.host_credential.token}`};
  await h.request('/internal/background/host/boot',{boot_id:gen.boot_id},host);
  await h.request('/internal/background/host/ready',{identity},host);
  let r=await h.request('/internal/background/host/claim',{identity},host);
  const claimA=await r.json() as {run:{id:string}};
  const scopeA={identity,run_id:m1.run_id,attempt:1};
  await h.request('/internal/background/host/submitted',{...scopeA,native_ref:'turn-a'},host);
  const childReceipt={parent_run_id:m1.run_id,parent_attempt:1,persona_id:bot,native_run_ref:'child-turn-one',native_session_key:'child-session-one',title:'CHILD'};
  r=await h.request('/internal/background/host/native-child',{identity,child:childReceipt,started:true},host);
  const child=await r.json() as {id:string};
  await h.request('/internal/background/host/coordinator-release',{...scopeA,native_ref:'turn-a',outcome:'completed'},host);

  // S admitted and claimed while A's child stays active.
  vi.setSystemTime(new Date('2026-09-19T00:02:36.000Z'));
  const s=await send('Report the current status.',randomUUID());
  expect(s.status).toBe('applied');
  const m2=(h.core().ownerAlpha.activeGeneration() as BackgroundGenerationView).authority.admissions[1];
  r=await h.request('/internal/background/host/claim',{identity},host);
  expect(((await r.json()) as {run:{id:string}}).run.id).toBe(m2.run_id);
  const scopeS={identity,run_id:m2.run_id,attempt:1};
  await h.request('/internal/background/host/submitted',{...scopeS,native_ref:'turn-s'},host);

  // Exact cancellation of A cascades only to A's descendants.
  vi.setSystemTime(new Date('2026-09-19T00:02:40.000Z'));
  r=await h.request('/v1/commands',{schema_version:1,type:'run.cancel',payload:{run_id:m1.run_id,reason:'Owner requested cancellation.'}},owner,randomUUID());
  expect(r.status).toBe(202);
  expect(h.core().store.run(m1.run_id).status).toBe('cancelling');
  // The next host observation propagates cancellation to A's child only.
  await h.request('/internal/background/host/heartbeat',{identity,operations:[]},host);
  expect(h.core().store.run(child.id).status).toBe('cancelling');
  expect(h.core().store.run(m2.run_id).status).toBe('running');
  // A still never completes, with or without a receipt.
  r=await h.request('/internal/background/host/complete',{...scopeA,result:{status:'completed',text:'Done.'},
   background_receipt:{thread_id:'thread-a',turn_id:'turn-a',output_sha256:createHash('sha256').update('Done.').digest('hex')}},host);
  expect(r.status).toBe(409);
  expect(await r.json()).toMatchObject({error:{code:'CAPABILITY_UNAVAILABLE'}});

  // S settles canonically and B is admitted: A's cancellation changes nothing.
  vi.setSystemTime(new Date('2026-09-19T00:02:45.000Z'));
  await h.request('/internal/background/host/coordinator-release',{...scopeS,native_ref:'turn-s',outcome:'completed'},host);
  r=await h.request('/internal/background/host/complete',{...scopeS,result:{status:'completed',text:'Status report.'},
   background_receipt:{thread_id:'thread-s',turn_id:'turn-s',output_sha256:createHash('sha256').update('Status report.').digest('hex')}},host);
  expect(r.status).toBe(200);
  vi.setSystemTime(new Date('2026-09-19T00:02:50.000Z'));
  const b=await send('Compute the independent estimate.',randomUUID());
  expect(b.status).toBe('applied');
  const m3=(h.core().ownerAlpha.activeGeneration() as BackgroundGenerationView).authority.admissions[2];
  r=await h.request('/internal/background/host/claim',{identity},host);
  expect(((await r.json()) as {run:{id:string}}).run.id).toBe(m3.run_id);
  const scopeB={identity,run_id:m3.run_id,attempt:1};
  await h.request('/internal/background/host/submitted',{...scopeB,native_ref:'turn-b'},host);
  await h.request('/internal/background/host/coordinator-release',{...scopeB,native_ref:'turn-b',outcome:'completed'},host);
  r=await h.request('/internal/background/host/complete',{...scopeB,result:{status:'completed',text:'Estimate.'},
   background_receipt:{thread_id:'thread-b',turn_id:'turn-b',output_sha256:createHash('sha256').update('Estimate.').digest('hex')}},host);
  expect(r.status).toBe(200);
  expect(h.core().store.run(m1.run_id).status).toBe('cancelling');
  expect(h.core().store.run(child.id).status).toBe('cancelling');
  expect(warmLedgerUsed(h.db,1000)).toBe(7000);
 }finally{h.db.close();vi.useRealTimers();}
});

it('cancelling S leaves A and its descendants unchanged and blocks B forever',async()=>{
 vi.useFakeTimers({toFake:['Date']});
 vi.setSystemTime(new Date('2026-09-19T00:00:00.000Z'));
 const h=harness();
 try{
  await h.reopen(true);
  const owner=await ownerAssertion();
  const manager={Authorization:`Bearer ${MANAGER_TOKEN}`};
  const send=async(text:string,key:string)=>{const r=await h.request('/v1/commands',{schema_version:1,type:'message.send',payload:{conversation_id:bot,text}},owner,key);
   expect(r.status).toBe(202);return r.json() as Promise<CommandReceipt>;};
  retireEpochOne(h.lifecycle());
  grantPersonaPolicy(h.db);
  vi.setSystemTime(new Date('2026-09-19T00:02:30.000Z'));
  const a=await send('Draft the quarterly plan.',randomUUID());
  expect(a.status).toBe('applied');
  const gen=h.core().ownerAlpha.activeGeneration() as BackgroundGenerationView;
  const m1=gen.authority.admissions[0];
  const identity={epoch:2,boot_id:gen.boot_id};
  const r0=await h.request('/internal/background/manager/generation',{},manager);
  const launch=await r0.json() as {host_credential:{token:string}};
  const host={Authorization:`Bearer ${launch.host_credential.token}`};
  await h.request('/internal/background/host/boot',{boot_id:gen.boot_id},host);
  await h.request('/internal/background/host/ready',{identity},host);
  let r=await h.request('/internal/background/host/claim',{identity},host);
  const scopeA={identity,run_id:m1.run_id,attempt:1};
  await h.request('/internal/background/host/submitted',{...scopeA,native_ref:'turn-a'},host);
  const childReceipt={parent_run_id:m1.run_id,parent_attempt:1,persona_id:bot,native_run_ref:'child-turn-one',native_session_key:'child-session-one',title:'CHILD'};
  r=await h.request('/internal/background/host/native-child',{identity,child:childReceipt,started:true},host);
  const child=await r.json() as {id:string};
  await h.request('/internal/background/host/coordinator-release',{...scopeA,native_ref:'turn-a',outcome:'completed'},host);
  vi.setSystemTime(new Date('2026-09-19T00:02:36.000Z'));
  const s=await send('Report the current status.',randomUUID());
  expect(s.status).toBe('applied');
  const m2=(h.core().ownerAlpha.activeGeneration() as BackgroundGenerationView).authority.admissions[1];
  r=await h.request('/internal/background/host/claim',{identity},host);
  const scopeS={identity,run_id:m2.run_id,attempt:1};
  await h.request('/internal/background/host/submitted',{...scopeS,native_ref:'turn-s'},host);

  // Cancelling S touches neither A, its child, nor the coordinator lane.
  vi.setSystemTime(new Date('2026-09-19T00:02:45.000Z'));
  r=await h.request('/v1/commands',{schema_version:1,type:'run.cancel',payload:{run_id:m2.run_id,reason:'Owner requested cancellation.'}},owner,randomUUID());
  expect(r.status).toBe(202);
  expect(h.core().store.run(m2.run_id).status).toBe('cancelling');
  expect(h.core().store.run(m1.run_id).status).toBe('running');
  expect(h.core().store.run(child.id).status).toBe('running');
  // A cancelled S never settles, so B is denied with the exact same proof.
  r=await h.request('/internal/background/host/complete',{...scopeS,result:{status:'cancelled',text:''},
   background_receipt:{thread_id:'thread-s',turn_id:'turn-s',output_sha256:createHash('sha256').update('').digest('hex')}},host);
  expect(r.status).toBe(409);
  expect(await r.json()).toMatchObject({error:{code:'CAPABILITY_UNAVAILABLE'}});
  const b=await send('Compute the independent estimate.',randomUUID());
  expect(b.status).toBe('rejected');
  expect(b.error?.code).toBe('CAPABILITY_UNAVAILABLE');
  expect(h.db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_background_manifest:*'")).toHaveLength(2);
 }finally{h.db.close();vi.useRealTimers();}
});

it('fails closed when persisted generation bytes are tampered with',async()=>{
 vi.useFakeTimers({toFake:['Date']});
 vi.setSystemTime(new Date('2026-09-19T00:00:00.000Z'));
 const h=harness();
 try{
  await h.reopen(true);
  const owner=await ownerAssertion();
  const send=async(text:string,key:string)=>{const r=await h.request('/v1/commands',{schema_version:1,type:'message.send',payload:{conversation_id:bot,text}},owner,key);
   expect(r.status).toBe(202);return r.json() as Promise<CommandReceipt>;};
  retireEpochOne(h.lifecycle());
  grantPersonaPolicy(h.db);
  vi.setSystemTime(new Date('2026-09-19T00:02:30.000Z'));
  const a=await send('Draft the quarterly plan.',randomUUID());
  expect(a.status).toBe('applied');
  // Rewrite the manifest row with different bytes: validation fails closed.
  const row=h.db.all<{value_json:string}>("SELECT value_json FROM runtime_metadata WHERE key='owner_alpha_background_manifest:2:1'")[0];
  const tampered=JSON.parse(row.value_json) as Record<string,unknown>;
  tampered.expires_at='2026-09-19T00:03:30.000Z';
  h.db.exec("UPDATE runtime_metadata SET value_json=? WHERE key='owner_alpha_background_manifest:2:1'",JSON.stringify(tampered));
  await expect(h.reopen(true)).rejects.toMatchObject({code:'INVALID_CONFIGURATION'});
  // Restore, then tamper the write-once generation descriptor row.
  h.db.exec("UPDATE runtime_metadata SET value_json=? WHERE key='owner_alpha_background_manifest:2:1'",row.value_json);
  await h.reopen(true);
  const genRow=h.db.all<{value_json:string}>("SELECT value_json FROM runtime_metadata WHERE key='owner_alpha_background_generation:2'")[0];
  const tamperedGen=JSON.parse(genRow.value_json) as Record<string,unknown>;
  (tamperedGen.policy as Record<string,unknown>).expires_at='2026-09-19T00:08:30.000Z';
  h.db.exec("UPDATE runtime_metadata SET value_json=? WHERE key='owner_alpha_background_generation:2'",JSON.stringify(tamperedGen));
  await expect(h.reopen(true)).rejects.toMatchObject({code:'INVALID_CONFIGURATION'});
  h.db.exec("UPDATE runtime_metadata SET value_json=? WHERE key='owner_alpha_background_generation:2'",genRow.value_json);
  await h.reopen(true);
  // Advance to the status admission, freeze its summary, then tamper the frozen
  // status bytes: the digest no longer matches and reconstruction fails closed.
  const gen=h.core().ownerAlpha.activeGeneration() as BackgroundGenerationView;
  const m1=gen.authority.admissions[0];
  const identity={epoch:2,boot_id:gen.boot_id};
  const boot=h.lifecycle().registerBoot(gen.boot_id);
  h.lifecycle().ready(boot);
  h.lifecycle().claim(boot);
  h.lifecycle().submitted(boot,m1.run_id,1,'turn-a');
  h.lifecycle().coordinatorRelease(boot,m1.run_id,1,'turn-a','completed');
  vi.setSystemTime(new Date('2026-09-19T00:02:36.000Z'));
  const s=await send('Report the current status.',randomUUID());
  expect(s.status).toBe('applied');
  const statusRow=h.db.all<{value_json:string}>("SELECT value_json FROM runtime_metadata WHERE key='owner_alpha_background_status:2:2'")[0];
  const tamperedStatus=JSON.parse(statusRow.value_json) as BackgroundStatusSummary;
  tamperedStatus.admissions[0].run_status='completed';
  h.db.exec("UPDATE runtime_metadata SET value_json=? WHERE key='owner_alpha_background_status:2:2'",JSON.stringify(tamperedStatus));
  await expect(h.reopen(true)).rejects.toMatchObject({code:'INVALID_CONFIGURATION'});
 }finally{h.db.close();vi.useRealTimers();}
});

it('keeps background configuration exclusive with warm and legacy owner alpha',async()=>{
 vi.useFakeTimers({toFake:['Date']});
 vi.setSystemTime(new Date('2026-09-19T00:00:00.000Z'));
 const h=harness();
 try{
  await h.reopen(true);
  // Warm + background in one environment is rejected before any route exists.
  await expect(h.reopen(true,undefined,{HEHEBOT_OWNER_ALPHA_WARM_GENERATION:JSON.stringify({schema_version:1,kind:'owner-alpha-warm-generation-v1',installation_id:'personal',owner_id:'actual-owner',
    owner_binding_sha256:'0'.repeat(64),policy_revision:'warm-x',persona_id:bot,text_only:{profile_version:'codex-text-only-v1',profile_sha256:'c'.repeat(64)},
    expires_at:'2026-09-19T00:20:00.000Z',max_task_seconds:30,max_admissions:2,prior_cost_micro_usd:0,prior_cost_source:'x',total_cap_micro_usd:10000000,reservation_micro_usd:2000}),
   HEHEBOT_OWNER_ALPHA_HOST_SIGNING_KEY:'q'.repeat(40),HEHEBOT_OWNER_ALPHA_TASK_SIGNING_KEY:'t'.repeat(40)}))
   .rejects.toMatchObject({code:'INVALID_CONFIGURATION'});
  // Legacy owner alpha + background is rejected as well.
  await expect(h.reopen(true,undefined,{HEHEBOT_OWNER_ALPHA:'{"owner_id":"legacy"}'}))
   .rejects.toMatchObject({code:'INVALID_CONFIGURATION'});
 }finally{h.db.close();vi.useRealTimers();}
});

it('admits identical text at all three ordinals with the recorded roles only',async()=>{
 vi.useFakeTimers({toFake:['Date']});
 vi.setSystemTime(new Date('2026-09-19T00:00:00.000Z'));
 const h=harness();
 try{
  await h.reopen(true);
  const owner=await ownerAssertion();
  const send=async(key?:string)=>{const r=await h.request('/v1/commands',{schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'Remember the blue notebook.'}},owner,key??randomUUID());
   expect(r.status).toBe(202);return r.json() as Promise<CommandReceipt>;};
  retireEpochOne(h.lifecycle());
  grantPersonaPolicy(h.db);

  vi.setSystemTime(new Date('2026-09-19T00:02:30.000Z'));
  const a=await send();
  expect(a.status).toBe('applied');
  let gen=h.core().ownerAlpha.activeGeneration() as BackgroundGenerationView;
  const m1=gen.authority.admissions[0];
  const identity={epoch:2,boot_id:gen.boot_id};
  const boot=h.lifecycle().registerBoot(gen.boot_id);
  h.lifecycle().ready(boot);
  expect(h.lifecycle().claim(boot)?.run.id).toBe(m1.run_id);
  h.lifecycle().submitted(boot,m1.run_id,1,'turn-a');
  h.lifecycle().coordinatorRelease(boot,m1.run_id,1,'turn-a','completed');

  vi.setSystemTime(new Date('2026-09-19T00:02:36.000Z'));
  const s=await send();
  expect(s.status).toBe('applied');
  gen=h.core().ownerAlpha.activeGeneration() as BackgroundGenerationView;
  const m2=gen.authority.admissions[1];
  expect(h.lifecycle().claim(boot)?.run.id).toBe(m2.run_id);
  h.lifecycle().submitted(boot,m2.run_id,1,'turn-s');
  h.lifecycle().coordinatorRelease(boot,m2.run_id,1,'turn-s','completed');
  h.lifecycle().complete(boot,m2.run_id,1,{status:'completed',text:'Status.'},
   undefined,{thread_id:'thread-s',turn_id:'turn-s',output_sha256:createHash('sha256').update('Status.').digest('hex')});

  vi.setSystemTime(new Date('2026-09-19T00:02:45.000Z'));
  const b=await send();
  expect(b.status).toBe('applied');
  gen=h.core().ownerAlpha.activeGeneration() as BackgroundGenerationView;
  const m3=gen.authority.admissions[2];

  // Identical text: the same command digest at three distinct ordinals.
  expect(m1.command_sha256).toBe(m2.command_sha256);
  expect(m2.command_sha256).toBe(m3.command_sha256);
  expect([m1.role,m2.role,m3.role]).toEqual(['background','status','independent']);
  expect(new Set([m1.run_id,m2.run_id,m3.run_id]).size).toBe(3);
  expect(new Set([m1.command_id,m2.command_id,m3.command_id]).size).toBe(3);
  expect(m1.event_sequence).toBeLessThan(m2.event_sequence);
  expect(m2.event_sequence).toBeLessThan(m3.event_sequence);
  expect(m1.expires_at).toBe('2026-09-19T00:03:00.000Z');
  expect(m2.expires_at).toBe('2026-09-19T00:03:06.000Z');
  expect(m3.expires_at).toBe('2026-09-19T00:03:15.000Z');
  expect(warmLedgerUsed(h.db,1000)).toBe(7000);
 }finally{h.db.close();vi.useRealTimers();}
});
