import {beforeAll,beforeEach,afterEach,expect,it,vi} from 'vitest';
import {createLocalJWKSet,exportJWK,generateKeyPair,SignJWT} from 'jose';
import worker from '../src/worker/index';

// Exercise production routing and signature verification; RPC/core custody is
// exercised separately. No test may call generic owner/runtime RPCs here.
vi.mock('../src/worker/control-object',()=>({PersonalControl:class{}}));
const keys=vi.hoisted(()=>({resolve:undefined as unknown}));
vi.mock('jose',async original=>({...await original<typeof import('jose')>(),createRemoteJWKSet:()=>keys.resolve}));
const origin='https://test-route.invalid',issuer='https://test-route.cloudflareaccess.com';
const now=new Date('2026-09-19T09:00:00.000Z'),seconds=now.getTime()/1000;
const campaign='11111111-2222-4333-8444-555555555555',id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const config={issuer,audience:'test-audience',client_id:'designated-orb.access',expires_at:'2026-09-20T09:00:00.000Z'};
const actor=`test-service:${config.client_id}`;
let service:string,owner:string,wrong:string;
const submitTest=vi.fn(async()=>({ok:true,value:{id,status:'applied'}}));
const readTest=vi.fn(async()=>({ok:true,value:{id,status:'queued'}}));
const unexpected=vi.fn(()=>{throw Error('Unexpected generic authority');});
const env={AUTH_MODE:'access',ACCESS_ISSUER:issuer,ACCESS_AUD:'owner-audience',OWNER_SUB:'real-owner',INSTALLATION_ID:'personal',
 HEHEBOT_TEST_ACCESS:JSON.stringify(config),CONTROL:{getByName:()=>({submitTest,readTest,getState:unexpected,accept:unexpected,runtime:unexpected})},ASSETS:{fetch:unexpected}} as unknown as Env;
beforeAll(async()=>{
 const pair=await generateKeyPair('RS256');
 keys.resolve=createLocalJWKSet({keys:[{...await exportJWK(pair.publicKey),kid:'route',alg:'RS256'}]});
 const sign=(claims:Record<string,unknown>)=>new SignJWT({iss:issuer,iat:seconds,exp:seconds+3600,...claims}).setProtectedHeader({alg:'RS256',kid:'route'}).sign(pair.privateKey);
 service=await sign({aud:config.audience,sub:'',common_name:config.client_id});
 owner=await sign({aud:'owner-audience',sub:'real-owner'});
 wrong=await sign({aud:config.audience,sub:'',common_name:'different-orb.access'});
});
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(now);vi.clearAllMocks();});
afterEach(()=>vi.useRealTimers());
function request(path:string,jwt=service,body?:unknown,headers:Record<string,string>={}){
 return worker.fetch(new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{'Cf-Access-Jwt-Assertion':jwt,'Content-Type':'application/json','Idempotency-Key':'synthetic-idempotency-key-47',...headers},body:body===undefined?undefined:JSON.stringify(body)}),env);
}

it('routes only fixed campaign submission and own-resource reads under the service actor',async()=>{
 const response=await request('/v1/test/commands',service,{campaign_id:campaign},{Origin:origin});
 expect(response.status).toBe(202);expect(response.headers.get('Cache-Control')).toBe('no-store');
 expect(submitTest).toHaveBeenCalledExactlyOnceWith(actor,campaign,'synthetic-idempotency-key-47');
 for(const kind of ['receipts','runs'])expect((await request(`/v1/test/${kind}/${id}`)).status).toBe(200);
 expect(readTest.mock.calls).toEqual([[actor,'receipts',id],[actor,'runs',id]]);
 expect(unexpected).not.toHaveBeenCalled();
});

it('never maps a service token to owner/internal authority or owner token to test authority',async()=>{
 for(const path of ['/','/app.js','/v1/state','/v1/export/control','/v1/commands'])expect((await request(path)).status).toBe(401);
 for(const token of [owner,wrong,''])expect((await request(`/v1/test/runs/${id}`,token)).status).toBe(401);
 expect((await request('/v1/test/export')).status).toBe(404);
 expect((await request('/internal/status',service,{})).status).toBe(503);
 expect(submitTest).not.toHaveBeenCalled();expect(readTest).not.toHaveBeenCalled();expect(unexpected).not.toHaveBeenCalled();
});

it('rejects arbitrary text, query credentials, cross-origin browser posts and expired grants before RPC',async()=>{
 for(const body of [{campaign_id:campaign,text:'read owner history'},{campaign_id:campaign,persona_id:id},{}])expect((await request('/v1/test/commands',service,body)).status).toBe(422);
 expect((await request(`/v1/test/runs/${id}?token=not-a-real-secret`)).status).toBe(422);
 expect((await request('/v1/test/commands',service,{campaign_id:campaign},{Origin:'https://foreign.invalid'})).status).toBe(403);
 expect((await request('/v1/test/commands',service,{campaign_id:campaign},{Origin:origin,'Sec-Fetch-Site':'cross-site'})).status).toBe(403);
 vi.setSystemTime(new Date(config.expires_at));expect((await request(`/v1/test/runs/${id}`)).status).toBe(401);
 expect(submitTest).not.toHaveBeenCalled();expect(readTest).not.toHaveBeenCalled();
});

it('keeps the new routes off without explicit test configuration',async()=>{
 const response=await worker.fetch(new Request(origin+`/v1/test/runs/${id}`,{headers:{'Cf-Access-Jwt-Assertion':service}}),{...env,HEHEBOT_TEST_ACCESS:undefined});
 expect(response.status).toBe(404);expect(readTest).not.toHaveBeenCalled();
});
