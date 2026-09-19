import {createHash,randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {createLocalJWKSet,exportJWK,generateKeyPair,SignJWT} from 'jose';
import {PersonalControl} from '../src/worker/control-object';
import worker from '../src/worker/index';
import {TestDatabase,bot} from './helpers';
import type {ControlCore} from '../src/core/control';
import type {LifecycleCore} from '../src/core/lifecycle';
vi.mock('cloudflare:workers',()=>({DurableObject:class{constructor(public ctx:unknown,public env:unknown){}}}));
vi.mock('../DB/schema.sql',()=>({default:''}));
const keys=vi.hoisted(()=>({resolve:undefined as unknown}));
vi.mock('jose',async original=>({...await original<typeof import('jose')>(),createRemoteJWKSet:()=>keys.resolve}));

it('continues ordinary owner messages only after exact retirement, across DO reconstruction without replay',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-09-19T00:00:00.000Z'));
 const db=new TestDatabase();try{
  const issuer='https://owner-continuation.cloudflareaccess.com',origin='https://owner.invalid';
  const auth={AUTH_MODE:'access',INSTALLATION_ID:'personal',ACCESS_ISSUER:issuer,ACCESS_AUD:'owner-aud',OWNER_SUB:'actual-owner'};
  const binding=createHash('sha256').update(JSON.stringify({auth_mode:auth.AUTH_MODE,installation_id:auth.INSTALLATION_ID,issuer,audience:auth.ACCESS_AUD,owner_subject:auth.OWNER_SUB})).digest('hex');
  const policy={session_id:randomUUID(),persona_id:bot,expires_at:'2026-09-19T00:01:00.000Z',max_runs:1,max_task_seconds:30};
  const bootstrap={installation_id:'personal',owner_id:auth.OWNER_SUB,owner_binding_sha256:binding,policy_revision:'owner-continuation-v1',persona_id:bot,
   text_only:{profile_version:'codex-text-only-v1',profile_sha256:'c'.repeat(64)},expires_at:'2026-09-19T00:20:00.000Z',session_seconds:180,max_task_seconds:37,
   prior_cost_micro_usd:1000000,prior_cost_source:'synthetic-baseline',total_cap_micro_usd:10000000,reservation_micro_usd:1000000};
  let initialized:Promise<unknown>=Promise.resolve();
  const ctx={storage:{sql:{exec:(sql:string,...values:(string|number|null)[])=>{const rows=db.all(sql,...values);return {toArray:()=>rows};}},transactionSync:<T>(fn:()=>T)=>db.transaction(fn),
   getAlarm:vi.fn(async()=>null),setAlarm:vi.fn(async()=>{}),deleteAlarm:vi.fn(async()=>{})},blockConcurrencyWhile:(fn:()=>Promise<unknown>)=>{initialized=fn();}};
  const env={...auth,EXECUTION_ENABLED:'false',NATIVE_VERIFIED:'false',PROVIDER_CONFIG:'{}',ACTION_POLICY_IDS:'[]',TOOL_POLICY_IDS:'[]',TRIGGER_CONFIG:'{}',
   HEHEBOT_HOSTED_OWNER_ALPHA:JSON.stringify({owner_binding_sha256:binding,policy}),HEHEBOT_OWNER_ALPHA_BOOTSTRAP:JSON.stringify(bootstrap),
   HEHEBOT_OWNER_ALPHA_MANAGER_TOKEN:'m'.repeat(40),HEHEBOT_OWNER_ALPHA_TASK_SIGNING_KEY:'s'.repeat(40),PROVIDER_TOKEN:'p'.repeat(40),
   HEHEBOT_OWNER_ALPHA_WAKE_TOKEN:'w'.repeat(40),HEHEBOT_OWNER_ALPHA_WAKE:JSON.stringify({url:'https://fixture.sprites.app'})} as unknown as Env;
  let core:ControlCore,lifecycle:LifecycleCore;
  const reopen=async()=>{
   const control=new PersonalControl(ctx as unknown as DurableObjectState,env);await initialized;
   env.CONTROL={getByName:()=>control} as unknown as Env['CONTROL'];
   ({core,lifecycle}=control as unknown as {core:ControlCore;lifecycle:LifecycleCore});
  };
  await reopen();
  const pair=await generateKeyPair('RS256');keys.resolve=createLocalJWKSet({keys:[{...await exportJWK(pair.publicKey),kid:'owner',alg:'RS256'}]});
  const token=await new SignJWT({iss:issuer,aud:auth.ACCESS_AUD,sub:auth.OWNER_SUB,iat:Date.now()/1000,exp:Date.now()/1000+3600}).setProtectedHeader({alg:'RS256',kid:'owner'}).sign(pair.privateKey);
  const request=(path:string,body?:unknown,key:string=randomUUID())=>worker.fetch(new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{
   ...(path.startsWith('/internal/manager/')?{Authorization:`Bearer ${env.HEHEBOT_OWNER_ALPHA_MANAGER_TOKEN}`}:{'Cf-Access-Jwt-Assertion':token}),
   Origin:origin,'Content-Type':'application/json','Idempotency-Key':key},body:body===undefined?undefined:JSON.stringify(body)}),env);
  const readState=async()=>{const r=await request('/v1/state');expect(r.status).toBe(200);return r.json() as Promise<ReturnType<ControlCore['state']>>;};
  const send=async(text:string,key:string)=>{const r=await request('/v1/commands',{schema_version:1,type:'message.send',payload:{conversation_id:bot,text}},key);expect(r.status).toBe(202);return r.json() as Promise<{id:string;resource_id:string;status:string}>;};
  const identity=lifecycle!.registerBoot(randomUUID());lifecycle!.ready(identity);
  vi.setSystemTime(new Date('2026-09-19T00:02:00.000Z'));lifecycle!.watchdog();
  const initial={...identity,session_id:policy.session_id,transition_id:null,observed_at:new Date().toISOString(),direct_child_stopped:true,execution_lock_free:true,session_lock_free:true,source:'synthetic-manager-observation'};
  expect((await request('/internal/manager/retirement',initial)).status).toBe(200);
  expect((await readState()).summary.owner_alpha_bootstrap?.message_admission_available).toBe(true);
  const firstKey=randomUUID(),first=await send('Remember the blue notebook.',firstKey),m=core!.bootstrap.assignedManifest()!;
  expect(m.run_id).toBe(first.resource_id);expect(m.epoch).toBe(2);
  const next={epoch:m.epoch,boot_id:m.boot_id};lifecycle!.registerBoot(next.boot_id);lifecycle!.ready(next);
  expect(lifecycle!.claim(next)?.run.id).toBe(first.resource_id);
  lifecycle!.submitted(next,first.resource_id,1,'turn-one');lifecycle!.coordinatorRelease(next,first.resource_id,1,'turn-one','completed');
  // Native completion is synthetic here; real native execution is a separate gate.
  lifecycle!.complete(next,first.resource_id,1,{status:'completed',text:'The notebook is blue.'},{...m.text_only,thread_id:'thread-one',turn_id:'turn-one',output_sha256:createHash('sha256').update('The notebook is blue.').digest('hex')});
  expect((await readState()).summary.owner_alpha_bootstrap?.message_admission_available).toBe(false);
  vi.setSystemTime(new Date(m.expires_at));lifecycle!.watchdog();await reopen();
  expect((await readState()).summary.owner_alpha_bootstrap?.message_admission_available).toBe(false);
  expect((await request('/internal/manager/retirement',initial)).status).toBe(422);
  const retirement={...initial,...next,session_id:m.session_id,transition_id:m.transition_id,observed_at:m.expires_at};
  expect((await request('/internal/manager/retirement',retirement)).status).toBe(200);
  await reopen();expect((await readState()).summary.owner_alpha_bootstrap?.message_admission_available).toBe(true);
  const before=JSON.stringify(db.all('SELECT * FROM runs ORDER BY id'));
  expect(await send('Remember the blue notebook.',firstKey)).toEqual(first);
  expect(await (await request(`/v1/receipts/${first.id}`)).json()).toEqual(first);
  expect(JSON.stringify(db.all('SELECT * FROM runs ORDER BY id'))).toBe(before);
  expect(core!.bootstrap.assignedManifest()).toEqual(m);
  const second=await send('What color was the notebook?',randomUUID()),successor=core!.bootstrap.assignedManifest()!;
  expect(successor).toMatchObject({epoch:3,run_id:second.resource_id,policy_revision:bootstrap.policy_revision,issued_at:m.expires_at});
  expect(successor.command_id).not.toBe(m.command_id);expect(successor.session_id).not.toBe(m.session_id);
  expect(core!.store.run(first.resource_id).status).toBe('completed');
  const secondIdentity={epoch:successor.epoch,boot_id:successor.boot_id};lifecycle!.registerBoot(secondIdentity.boot_id);lifecycle!.ready(secondIdentity);
  const secondClaim=lifecycle!.claim(secondIdentity)!;
  expect(secondClaim.run.id).toBe(second.resource_id);
  expect(JSON.parse(secondClaim.run.context_json).conversation_history.messages).toMatchObject([{command_id:first.id,text:'Remember the blue notebook.',
   completed_reply:{run_id:first.resource_id,attempt:1,text:'The notebook is blue.',truncated:false}}]);
  lifecycle!.submitted(secondIdentity,second.resource_id,1,'turn-two');lifecycle!.coordinatorRelease(secondIdentity,second.resource_id,1,'turn-two','completed');
  lifecycle!.complete(secondIdentity,second.resource_id,1,{status:'completed',text:'Blue.'},{...successor.text_only,thread_id:'thread-two',turn_id:'turn-two',output_sha256:createHash('sha256').update('Blue.').digest('hex')});
  await reopen();
  expect(core!.store.run(second.resource_id).status).toBe('completed');
  expect(db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_reservation:*'")).toHaveLength(2);
  expect(db.all("SELECT key FROM runtime_metadata WHERE key='owner_alpha_cost_baseline'")).toHaveLength(1);
  expect((await readState()).summary.owner_alpha_bootstrap?.message_admission_available).toBe(false);
 }finally{db.close();vi.useRealTimers();}
});
