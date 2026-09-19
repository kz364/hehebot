import {createHash,randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {createLocalJWKSet,exportJWK,generateKeyPair,SignJWT} from 'jose';
import {PersonalControl} from '../src/worker/control-object';
import worker from '../src/worker/index';
import {TestDatabase,bot} from './helpers';
import {issueRuntimeTaskToken} from '../src/worker/auth';
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
async function ownerAssertion(subject='actual-owner'):Promise<Record<string,string>>{
 keys.resolve=createLocalJWKSet({keys:[{...await exportJWK(ownerKeyPair.publicKey),kid:'owner',alg:'RS256'}]});
 const token=await new SignJWT({iss:ISSUER,aud:'owner-aud',sub:subject,iat:Date.now()/1000,exp:Date.now()/1000+3600})
  .setProtectedHeader({alg:'RS256',kid:'owner'}).sign(ownerKeyPair.privateKey);
 return {'Cf-Access-Jwt-Assertion':token,Origin:ORIGIN};
}

const ISSUER='https://owner-history.cloudflareaccess.com',ORIGIN='https://owner.invalid';
const SESSION=randomUUID(),EPOCH_ONE_BOOT=randomUUID();
const TEXT_ONLY={profile_version:'codex-text-only-v1',profile_sha256:'c'.repeat(64)};
const HOSTED_POLICY={session_id:SESSION,persona_id:bot,expires_at:'2026-09-19T00:01:00.000Z',max_runs:1,max_task_seconds:30};

/** A retained message-bound bootstrap predecessor with real old-history rows. */
function harness(){
 const db=new TestDatabase();
 const auth={AUTH_MODE:'access',INSTALLATION_ID:'personal',ACCESS_ISSUER:ISSUER,ACCESS_AUD:'owner-aud',OWNER_SUB:'actual-owner'};
 const ownerBinding=createHash('sha256').update(JSON.stringify({auth_mode:'access',installation_id:'personal',issuer:ISSUER,audience:'owner-aud',owner_subject:'actual-owner'})).digest('hex');
 const bootstrap={installation_id:'personal',owner_id:'actual-owner',owner_binding_sha256:ownerBinding,policy_revision:'owner-continuation-v1',persona_id:bot,
  text_only:TEXT_ONLY,expires_at:'2026-09-19T00:20:00.000Z',session_seconds:180,max_task_seconds:37,
  prior_cost_micro_usd:1000000,prior_cost_source:'synthetic-baseline',total_cap_micro_usd:10000000,reservation_micro_usd:2000};
 const warm={schema_version:1,kind:'owner-alpha-warm-generation-v1',installation_id:'personal',owner_id:'actual-owner',
  owner_binding_sha256:ownerBinding,policy_revision:'warm-stage-a-v1',persona_id:bot,text_only:TEXT_ONLY,
  expires_at:'2026-09-19T00:20:00.000Z',max_task_seconds:30,max_admissions:2,
  prior_cost_micro_usd:1000000,prior_cost_source:'synthetic-baseline',total_cap_micro_usd:10000000,reservation_micro_usd:2000};
 const envFor=(mode:'bootstrap'|'warm'|'warm-replaced'|'warm-wrongowner'|'none')=>{
  const binding=ownerBinding,wrongOwner=mode==='warm-wrongowner';
  return {
   ...auth,...(wrongOwner?{OWNER_SUB:'someone-else'}:{}),EXECUTION_ENABLED:'false',NATIVE_VERIFIED:'false',PROVIDER_CONFIG:'{}',ACTION_POLICY_IDS:'[]',TOOL_POLICY_IDS:'[]',TRIGGER_CONFIG:'{}',
   HEHEBOT_HOSTED_OWNER_ALPHA:JSON.stringify({owner_binding_sha256:binding,policy:HOSTED_POLICY}),
   HEHEBOT_OWNER_ALPHA_MANAGER_TOKEN:'m'.repeat(40),HEHEBOT_OWNER_ALPHA_HOST_SIGNING_KEY:'h'.repeat(40),
   HEHEBOT_OWNER_ALPHA_TASK_SIGNING_KEY:'s'.repeat(40),RUNTIME_TOKEN:'r'.repeat(40),PROVIDER_TOKEN:'p'.repeat(40),
   HEHEBOT_OWNER_ALPHA_WAKE_TOKEN:'w'.repeat(40),
   ...(mode==='bootstrap'?{HEHEBOT_OWNER_ALPHA_WAKE:JSON.stringify({url:'https://fixture.sprites.app'}),HEHEBOT_OWNER_ALPHA_BOOTSTRAP:JSON.stringify(bootstrap)}:{}),
   ...(mode==='warm'||mode==='warm-replaced'||mode==='warm-wrongowner'?{
    HEHEBOT_OWNER_ALPHA_WAKE:JSON.stringify({url:'https://fixture.sprites.app'}),
    HEHEBOT_OWNER_ALPHA_WARM_GENERATION:JSON.stringify(mode==='warm-replaced'
     ?{...warm,expires_at:'2026-09-19T00:25:00.000Z'}
     :warm)}:{})
  } as unknown as Env;
 };
 let initialized:Promise<unknown>=Promise.resolve();
 const ctx={storage:{sql:{exec:(sql:string,...values:(string|number|null)[])=>{const rows=db.all(sql,...values);return {toArray:()=>rows};}},
  transactionSync:<T>(fn:()=>T)=>db.transaction(fn),
  getAlarm:vi.fn(async()=>null),setAlarm:vi.fn(async()=>{}),deleteAlarm:vi.fn(async()=>{})},
  blockConcurrencyWhile:(fn:()=>Promise<unknown>)=>{initialized=fn();}};
 let core:ControlCore,lifecycle:LifecycleCore,control:PersonalControl,env:Env;
 const reopen=async(mode:'bootstrap'|'warm'|'warm-replaced'|'warm-wrongowner'|'none')=>{
  env=envFor(mode);
  try{control=new PersonalControl(ctx as unknown as DurableObjectState,env);}
  finally{env.CONTROL={getByName:()=>control} as unknown as Env['CONTROL'];}
  await initialized;
  ({core,lifecycle}=control as unknown as {core:ControlCore;lifecycle:LifecycleCore});
 };
 const reopenError=async(mode:'bootstrap'|'warm'|'warm-replaced'|'warm-wrongowner'|'none')=>{
  try{await reopen(mode);return undefined;}catch(error){return error as {code:string;status:number};}
 };
 const request=(path:string,body:unknown,headers:Record<string,string>,idempotencyKey?:string)=>
  worker.fetch(new Request(ORIGIN+path,{method:body===undefined?'GET':'POST',
   headers:{'Content-Type':'application/json','Idempotency-Key':idempotencyKey??randomUUID(),...headers},
   body:body===undefined?undefined:JSON.stringify(body)}),env);
 const send=async(text:string,key:string)=>{
  const owner=await ownerAssertion();
  const r=await request('/v1/commands',{schema_version:1,type:'message.send',payload:{conversation_id:bot,text}},owner,key);
  expect(r.status).toBe(202);
  return r.json() as Promise<{id:string;resource_id:string;status:string;error:{code:string;message:string}|null}>;
 };
 return {db,reopen,reopenError,request,send,core:()=>core,lifecycle:()=>lifecycle,managerToken:'m'.repeat(40),taskSigningKey:'s'.repeat(40)};
}

/** Every pre-warm owner-alpha custody row keeps its exact bytes through warm
 * admissions, removal, replacement attempts, and retirement. */
function assertLegacyCustody(db:InstanceType<typeof TestDatabase>,legacyMap:Map<string,string>){
 const current=new Map(db.all<{key:string;value_json:string}>("SELECT key,value_json FROM runtime_metadata WHERE key LIKE 'owner_alpha%'").map(x=>[x.key,x.value_json]));
 for(const [key,value] of legacyMap)
  expect(current.get(key),`legacy row ${key} changed`).toBe(value);
}

it('transitions from a retained bootstrap generation into a warm generation without rewriting history',async()=>{
 vi.useFakeTimers({toFake:['Date']});
 vi.setSystemTime(new Date('2026-09-19T00:00:00.000Z'));
 const h=harness();
 try{
  const manager={Authorization:`Bearer ${h.managerToken}`};
  await h.reopen('bootstrap');
  const owner=await ownerAssertion();
  const readState=async()=>{const r=await h.request('/v1/state',undefined,owner);expect(r.status).toBe(200);
   return r.json() as Promise<{summary:Record<string,unknown>&{owner_alpha_warm?:{admissions_used:number;message_admission_available:boolean;generation:{epoch:number;expires_at:string}|null}&unknown,owner_alpha_bootstrap?:{message_admission_available:boolean}&unknown,owner_alpha_session?:unknown}}>;};
  // Epoch-1 hosted predecessor retires exactly.
  const identity1=h.lifecycle().registerBoot(EPOCH_ONE_BOOT);
  h.lifecycle().ready(identity1);
  vi.setSystemTime(new Date('2026-09-19T00:02:00.000Z'));
  h.lifecycle().watchdog();
  const initial={epoch:1,boot_id:EPOCH_ONE_BOOT,session_id:SESSION,transition_id:null,observed_at:'2026-09-19T00:02:00.000Z',
   direct_child_stopped:true,execution_lock_free:true,session_lock_free:true,source:'synthetic-manager-observation'};
  let r=await h.request('/internal/manager/retirement',initial,manager);
  expect(r.status).toBe(200);

  // A real message-bound bootstrap generation with old history.
  vi.setSystemTime(new Date('2026-09-19T00:02:30.000Z'));
  const first=await h.send('Remember the blue notebook.',randomUUID());
  expect(first.status).toBe('applied');
  const m=h.core().bootstrap.assignedManifest()!;
  expect(m.epoch).toBe(2);
  const identity2=h.lifecycle().registerBoot(m.boot_id);
  h.lifecycle().ready(identity2);
  expect(h.lifecycle().claim(identity2)?.run.id).toBe(m.run_id);
  h.lifecycle().submitted(identity2,m.run_id,1,'turn-one');
  h.lifecycle().coordinatorRelease(identity2,m.run_id,1,'turn-one','completed');
  h.lifecycle().complete(identity2,m.run_id,1,{status:'completed',text:'The notebook is blue.'},
   {...m.text_only,thread_id:'thread-one',turn_id:'turn-one',output_sha256:createHash('sha256').update('The notebook is blue.').digest('hex')});
  vi.setSystemTime(new Date(m.expires_at)); // 00:05:30
  h.lifecycle().watchdog();
  const bootstrapRetirement={epoch:2,boot_id:m.boot_id,session_id:m.session_id,transition_id:m.transition_id,observed_at:m.expires_at,
   direct_child_stopped:true,execution_lock_free:true,session_lock_free:true,source:'synthetic-manager-observation'};
  r=await h.request('/internal/manager/retirement',bootstrapRetirement,manager);
  expect(r.status).toBe(200);
  // Every pre-warm row, captured byte-for-byte before the transition.
  // Every pre-warm owner-alpha custody row, captured byte-for-byte.
  const legacyRows=h.db.all<{key:string;value_json:string}>("SELECT key,value_json FROM runtime_metadata WHERE key LIKE 'owner_alpha%' AND key NOT GLOB 'owner_alpha_warm%' AND key NOT GLOB 'owner_alpha_reservation:%:%' ORDER BY key");
  const legacyMap=new Map(legacyRows.map(x=>[x.key,x.value_json]));

  // Warm entry only from this exact retired predecessor, after bootstrap config removal.
  vi.setSystemTime(new Date('2026-09-19T00:05:31.000Z'));
  await h.reopen('warm');
  let summary=await readState();
  expect(summary.summary.owner_alpha_bootstrap).toBeUndefined();
  expect(summary.summary.owner_alpha_session).toBeUndefined();
  expect(summary.summary.owner_alpha_warm).toMatchObject({schema_version:1,kind:'owner-alpha-warm-summary-v1',
   policy_revision:'warm-stage-a-v1',policy_expires_at:'2026-09-19T00:20:00.000Z',max_admissions:2,admissions_used:0,message_admission_available:true,generation:null});

  const warmKey1=randomUUID(),warmFirst=await h.send('Remember the blue notebook.',warmKey1);
  expect(warmFirst.status).toBe('applied');
  const gen=h.core().ownerAlpha.activeGeneration() as WarmGenerationView;
  expect(gen.epoch).toBe(3);
  expect(gen.predecessor).toMatchObject({epoch:2,boot_id:m.boot_id,session_id:m.session_id});
  const m1=gen.authority.admissions[0];
  expect(m1.run_id).toBe(warmFirst.resource_id);
  expect(m1.expires_at).toBe('2026-09-19T00:06:01.000Z');
  expect(gen.policy.expires_at).toBe('2026-09-19T00:10:31.000Z'); // min(config 00:20, 00:05:31+300s)
  expect(h.db.all("SELECT key FROM runtime_metadata WHERE key='owner_alpha_warm_config:warm-stage-a-v1'")).toHaveLength(1);
  await h.lifecycle().deliverOwnerAlphaWake(gen.transition_id,async()=>{});
  expect(h.db.all("SELECT key FROM runtime_metadata WHERE key='owner_alpha_wake:3'")).toHaveLength(1);
  const custody1=Object.fromEntries(h.db.all<{key:string;value_json:string}>("SELECT key,value_json FROM runtime_metadata WHERE key GLOB 'owner_alpha_warm_*' ORDER BY key").map(x=>[x.key,x.value_json]));

  const identity3=h.lifecycle().registerBoot(gen.boot_id);
  h.lifecycle().ready(identity3);
  expect(h.lifecycle().claim(identity3)?.run.id).toBe(m1.run_id);
  h.lifecycle().submitted(identity3,m1.run_id,1,'turn-one');
  h.lifecycle().coordinatorRelease(identity3,m1.run_id,1,'turn-one','completed');
  h.lifecycle().complete(identity3,m1.run_id,1,{status:'completed',text:'The notebook is blue.'},
   {...m1.text_only,thread_id:'thread-one',turn_id:'turn-one',output_sha256:createHash('sha256').update('The notebook is blue.').digest('hex')});

  // Second admission in the same live generation; reconstruction between admissions.
  vi.setSystemTime(new Date('2026-09-19T00:06:20.000Z'));
  await h.reopen('warm');
  const warmSecond=await h.send('What color was the notebook?',randomUUID());
  expect(warmSecond.status).toBe('applied');
  const gen2=h.core().ownerAlpha.activeGeneration() as WarmGenerationView;
  expect(gen2.epoch).toBe(3);
  expect(gen2.authority.admissions).toHaveLength(2);
  const m2=gen2.authority.admissions[1];
  expect(m2.run_id).toBe(warmSecond.resource_id);
  expect(m2.expires_at).toBe('2026-09-19T00:06:50.000Z');
  expect(h.db.all("SELECT key FROM runtime_metadata WHERE key='owner_alpha_reservation:3:2'")).toHaveLength(1);
  // The generation descriptor and first manifest keep their exact bytes, and
  // every pre-warm legacy row is untouched.
  const custody2=Object.fromEntries(h.db.all<{key:string;value_json:string}>("SELECT key,value_json FROM runtime_metadata WHERE key GLOB 'owner_alpha_warm_*' ORDER BY key").map(x=>[x.key,x.value_json]));
  expect(custody2['owner_alpha_warm_generation:3']).toBe(custody1['owner_alpha_warm_generation:3']);
  expect(custody2['owner_alpha_warm_manifest:3:1']).toBe(custody1['owner_alpha_warm_manifest:3:1']);
  expect(custody2['owner_alpha_warm_config:warm-stage-a-v1']).toBe(custody1['owner_alpha_warm_config:warm-stage-a-v1']);
  assertLegacyCustody(h.db,legacyMap);
  // The second message in the READY generation creates no new wake intent.
  await h.lifecycle().deliverOwnerAlphaWake(gen2.transition_id,async()=>{});
  expect(h.db.all<{key:string}>("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_wake:*'").map(x=>x.key)).toEqual(['owner_alpha_wake:3']);

  const identity3b=identity3;
  expect(h.lifecycle().claim(identity3b)?.run.id).toBe(m2.run_id);
  h.lifecycle().submitted(identity3b,m2.run_id,1,'turn-two');
  h.lifecycle().coordinatorRelease(identity3b,m2.run_id,1,'turn-two','completed');
  h.lifecycle().complete(identity3b,m2.run_id,1,{status:'completed',text:'Blue.'},
   {...m2.text_only,thread_id:'thread-two',turn_id:'turn-two',output_sha256:createHash('sha256').update('Blue.').digest('hex')});
  // The lifetime ledger counts the baseline, the legacy reservation and both
  // warm reservations exactly once.
  expect(h.db.all<{key:string}>("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_reservation:*' ORDER BY key").map(x=>x.key))
   .toEqual(['owner_alpha_reservation:2','owner_alpha_reservation:3:1','owner_alpha_reservation:3:2']);

  // A valid, live legacy task JWT reaches no warm route on either family.
  vi.setSystemTime(new Date('2026-09-19T00:07:10.000Z'));
  const legacyTask=await issueRuntimeTaskToken({epoch:m.epoch,boot_id:m.boot_id,transition_id:m.transition_id,
   installation_id:m.installation_id,owner_binding_sha256:m.owner_binding_sha256,
   run_id:m.run_id,manifest_sha256:m.manifest_sha256,issued_at:'2026-09-19T00:07:05.000Z',expires_at:'2026-09-19T00:07:15.000Z'},h.taskSigningKey);
  const legacyHeaders={Authorization:`Bearer ${legacyTask}`};
  const warmScope={identity:{epoch:3,boot_id:gen.boot_id},run_id:m1.run_id,attempt:1};
  r=await h.request('/internal/warm/task/agent-routines',warmScope,legacyHeaders);
  expect(r.status).toBe(401);
  r=await h.request('/internal/warm/host/status',{},legacyHeaders);
  expect(r.status).toBe(401);
  r=await h.request('/internal/warm/host/claim',{identity:{epoch:3,boot_id:gen.boot_id}},legacyHeaders);
  expect(r.status).toBe(401);
  // Legacy routes never become a bypass into warm custody. The legacy task
  // JWT is not runtime authority (401) and even the valid legacy runtime
  // bearer reaches no legacy route while warm custody is live (404).
  r=await h.request('/internal/status',{},legacyHeaders);
  expect(r.status).toBe(401);
  const runtimeHeaders={Authorization:`Bearer ${'r'.repeat(40)}`};
  r=await h.request('/internal/status',{},runtimeHeaders);
  expect(r.status).toBe(404);
  r=await h.request('/internal/manager/manifest',{},manager);
  expect(r.status).toBe(404);
  // Removing the warm configuration while the generation is still live rejects
  // candidate messages without creating any run or event.
  vi.setSystemTime(new Date('2026-09-19T00:07:30.000Z'));
  const runCount=h.db.all('SELECT id FROM runs').length;
  await h.reopen('none');
  const removed=await h.send('One more after removal.',randomUUID());
  expect(removed.status).toBe('rejected');
  expect(removed.error).toMatchObject({code:'CAPABILITY_UNAVAILABLE'});
  expect(h.db.all('SELECT id FROM runs')).toHaveLength(runCount);
  expect(h.db.all("SELECT id FROM events WHERE id=? AND type='message.user'",removed.id)).toEqual([]);
  summary=await readState();
  expect(summary.summary.owner_alpha_warm).toMatchObject({admissions_used:2,message_admission_available:false,
   generation:{epoch:3,session_id:gen.policy.session_id,expires_at:'2026-09-19T00:10:31.000Z'}});
  r=await h.request('/internal/warm/manager/generation',{},manager);
  expect(r.status).toBe(404);
  r=await h.request('/internal/warm/host/status',{},legacyHeaders);
  expect(r.status).toBe(404);
  // Persisted custody remains reconstructible when the exact configuration returns.
  vi.setSystemTime(new Date('2026-09-19T00:07:40.000Z'));
  await h.reopen('warm');
  expect((h.core().ownerAlpha.activeGeneration() as WarmGenerationView).authority.admissions).toHaveLength(2);

  // Replacing the retained warm custody, or pointing the warm configuration at
  // a different authenticated owner, fails closed with no writes.
  const before=h.db.all('SELECT key,value_json FROM runtime_metadata ORDER BY key');
  vi.setSystemTime(new Date('2026-09-19T00:07:50.000Z'));
  let error=await h.reopenError('warm-replaced');
  expect(error).toMatchObject({code:'INVALID_CONFIGURATION'});
  vi.setSystemTime(new Date('2026-09-19T00:08:00.000Z'));
  error=await h.reopenError('warm-wrongowner');
  expect(error).toMatchObject({code:'INVALID_CONFIGURATION'});
  expect(h.db.all('SELECT key,value_json FROM runtime_metadata ORDER BY key')).toEqual(before);

  // Expiry rejects live credentials while the generation stays reconstructible.
  await h.reopen('warm');
  vi.setSystemTime(new Date('2026-09-19T00:10:32.000Z'));
  summary=await readState();
  expect(summary.summary.owner_alpha_warm).toMatchObject({admissions_used:2,message_admission_available:false,
   generation:{epoch:3,expires_at:'2026-09-19T00:10:31.000Z'}});
  r=await h.request('/internal/warm/manager/generation',{},manager);
  expect(r.status).toBe(200);
  expect(await r.json()).toBeNull();

  // Manager retirement after expiry using only manager authentication; it
  // settles nothing and admits no successor.
  vi.setSystemTime(new Date('2026-09-19T00:10:40.000Z'));
  await h.reopen('none');
  const warmRetirement={epoch:3,boot_id:gen.boot_id,session_id:gen.policy.session_id,transition_id:gen.transition_id,
   observed_at:'2026-09-19T00:10:31.000Z',direct_child_stopped:true,execution_lock_free:true,session_lock_free:true,source:'synthetic-manager-observation'};
  r=await h.request('/internal/warm/manager/retirement',warmRetirement,manager);
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({accepted:true});
  r=await h.request('/internal/warm/manager/retirement',warmRetirement,manager);
  expect(r.status).toBe(200);
  r=await h.request('/internal/warm/manager/retirement',{...warmRetirement,observed_at:'2026-09-19T00:10:32.000Z'},manager);
  expect(r.status).toBe(422);
  assertLegacyCustody(h.db,legacyMap);
  const retained=h.core().ownerAlpha.activeGeneration() as WarmGenerationView;
  expect(retained.epoch).toBe(3);
  expect(retained.authority.admissions.map(x=>x.manifest_sha256)).toEqual([m1.manifest_sha256,m2.manifest_sha256]);
  expect(h.lifecycle().get().epoch).toBe(3);
  expect(h.db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_warm_generation:*'")).toHaveLength(1);
  expect(h.db.all<{key:string}>("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_warm_manifest:*' ORDER BY key").map(x=>x.key)).toEqual(['owner_alpha_warm_manifest:3:1','owner_alpha_warm_manifest:3:2']);
  // Stage A admits no successor revision after retirement.
  const successor=await h.send('A fresh start.',randomUUID());
  expect(successor.status).toBe('rejected');
  expect(successor.error).toMatchObject({code:'CAPABILITY_UNAVAILABLE'});
 }finally{h.db.close();vi.useRealTimers();}
});
