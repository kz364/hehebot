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

it('integrates signed service identity with real DO admission, rate limits and own canonical result',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-09-19T00:00:00.000Z'));
 const db=new TestDatabase();try{
  const issuer='https://campaign-http.cloudflareaccess.com',origin='https://campaign.invalid',client='test-orb.access',actor=`test-service:${client}`;
  const auth={AUTH_MODE:'access',INSTALLATION_ID:'personal',ACCESS_ISSUER:issuer,ACCESS_AUD:'owner-aud',OWNER_SUB:'real-owner'};
  const binding=createHash('sha256').update(JSON.stringify({auth_mode:auth.AUTH_MODE,installation_id:auth.INSTALLATION_ID,issuer,audience:auth.ACCESS_AUD,owner_subject:auth.OWNER_SUB})).digest('hex');
  const grant={campaign_id:randomUUID(),actor_id:actor,persona_id:randomUUID(),owner_binding_sha256:binding,issued_at:new Date().toISOString(),expires_at:'2026-09-20T00:00:00.000Z',max_submissions:2};
  const policy={session_id:randomUUID(),persona_id:bot,expires_at:'2026-09-19T00:01:00.000Z',max_runs:1,max_task_seconds:30};
  const bootstrap={installation_id:'personal',owner_id:actor,owner_binding_sha256:binding,policy_revision:'http-test-v1',persona_id:grant.persona_id,
   text_only:{profile_version:'codex-text-only-v1',profile_sha256:'c'.repeat(64)},expires_at:grant.expires_at,session_seconds:180,max_task_seconds:37,prior_cost_micro_usd:1000000,prior_cost_source:'test',total_cap_micro_usd:10000000,reservation_micro_usd:1000000};
  let initialized:Promise<unknown>=Promise.resolve();const setAlarm=vi.fn(async()=>{});
  const ctx={storage:{sql:{exec:(sql:string,...values:(string|number|null)[])=>{const rows=db.all(sql,...values);return {toArray:()=>rows};}},transactionSync:<T>(fn:()=>T)=>db.transaction(fn),getAlarm:vi.fn(async()=>null),setAlarm,deleteAlarm:vi.fn(async()=>{})},blockConcurrencyWhile:(fn:()=>Promise<unknown>)=>{initialized=fn();}};
  const env={...auth,EXECUTION_ENABLED:'false',NATIVE_VERIFIED:'false',PROVIDER_CONFIG:'{}',ACTION_POLICY_IDS:'[]',TOOL_POLICY_IDS:'[]',TRIGGER_CONFIG:'{}',
   HEHEBOT_HOSTED_OWNER_ALPHA:JSON.stringify({owner_binding_sha256:binding,policy}),HEHEBOT_OWNER_ALPHA_BOOTSTRAP:JSON.stringify(bootstrap),
   HEHEBOT_OWNER_ALPHA_MANAGER_TOKEN:'m'.repeat(40),HEHEBOT_OWNER_ALPHA_TASK_SIGNING_KEY:'s'.repeat(40),PROVIDER_TOKEN:'p'.repeat(40),HEHEBOT_OWNER_ALPHA_WAKE_TOKEN:'w'.repeat(40),HEHEBOT_OWNER_ALPHA_WAKE:JSON.stringify({url:'https://test.sprites.app'}),
   HEHEBOT_TEST_ACCESS:JSON.stringify({issuer,audience:'test-aud',client_id:client,expires_at:grant.expires_at}),HEHEBOT_TEST_CAMPAIGN:JSON.stringify(grant)} as unknown as Env;
  const control=new PersonalControl(ctx as unknown as DurableObjectState,env);await initialized;
  env.CONTROL={getByName:()=>control} as unknown as Env['CONTROL'];
  const {core,lifecycle}=control as unknown as {core:ControlCore;lifecycle:LifecycleCore};
  const identity=lifecycle.registerBoot(randomUUID());lifecycle.ready(identity);
  vi.setSystemTime(new Date('2026-09-19T00:02:00.000Z'));lifecycle.watchdog();
  core.bootstrap.recordRetirement({...identity,session_id:policy.session_id,transition_id:null,observed_at:new Date().toISOString(),direct_child_stopped:true,execution_lock_free:true,session_lock_free:true,source:'synthetic-stop-observation'});
  const pair=await generateKeyPair('RS256');keys.resolve=createLocalJWKSet({keys:[{...await exportJWK(pair.publicKey),kid:'http-test',alg:'RS256'}]});
  const token=await new SignJWT({iss:issuer,aud:'test-aud',sub:'',common_name:client,iat:Date.now()/1000,exp:Date.now()/1000+3600}).setProtectedHeader({alg:'RS256',kid:'http-test'}).sign(pair.privateKey);
  const key=randomUUID(),request=(path:string,body?:unknown)=>worker.fetch(new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{'Cf-Access-Jwt-Assertion':token,'Idempotency-Key':key,'Content-Type':'application/json',Origin:origin},body:body===undefined?undefined:JSON.stringify(body)}),env);
  setAlarm.mockClear();const response=await request('/v1/test/commands',{campaign_id:grant.campaign_id});expect(response.status).toBe(202);
  const receipt=await response.json() as {id:string;resource_id:string;status:string};expect(receipt.status).toBe('applied');expect(setAlarm).toHaveBeenCalledTimes(1);
  expect(db.all<{owner_id:string}>('SELECT owner_id FROM commands WHERE id=?',receipt.id)[0].owner_id).toBe(actor);
  expect(await (await request('/v1/test/commands',{campaign_id:grant.campaign_id})).json()).toEqual(receipt);
  expect((await request('/v1/test/commands',{campaign_id:grant.campaign_id})).status).toBe(429);
  const manifest=core.bootstrap.assignedManifest()!,next={epoch:manifest.epoch,boot_id:manifest.boot_id};lifecycle.registerBoot(next.boot_id);lifecycle.ready(next);lifecycle.claim(next);
  lifecycle.submitted(next,receipt.resource_id,1,'native-test');lifecycle.coordinatorRelease(next,receipt.resource_id,1,'native-test','completed');
  lifecycle.complete(next,receipt.resource_id,1,{status:'completed',text:'HEHEBOT_NATIVE_TEST_OK'},{...manifest.text_only,thread_id:'synthetic-thread',turn_id:'native-test',output_sha256:createHash('sha256').update('HEHEBOT_NATIVE_TEST_OK').digest('hex')});
  setAlarm.mockClear();const first=await (await request(`/v1/test/runs/${receipt.resource_id}`)).json();
  expect(first).toMatchObject({status:'completed',result:{status:'completed',text:'HEHEBOT_NATIVE_TEST_OK'}});
  expect(await (await request(`/v1/test/runs/${receipt.resource_id}`)).json()).toEqual(first);expect(setAlarm).not.toHaveBeenCalled();
  for(let i=0;i<58;i++)expect((await request(`/v1/test/receipts/${receipt.id}`)).status).toBe(200);
  expect((await request(`/v1/test/receipts/${receipt.id}`)).status).toBe(429);
  expect(db.all("SELECT key FROM runtime_metadata WHERE key='installation_owner'")).toHaveLength(1);
 }finally{db.close();vi.useRealTimers();}
});
