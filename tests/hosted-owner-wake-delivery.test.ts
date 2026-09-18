import {expect,it,vi} from 'vitest';
import {parseHostedOwnerWake,sendHostedOwnerWake} from '../src/worker/hosted-owner-wake';

const config={transition_id:'33333333-3333-4333-8333-333333333333',url:'https://hehebot-fixture.sprites.app'};
const provider='p'.repeat(40),token='w'.repeat(40),command={epoch:4,operationId:config.transition_id};

it('defaults off and permits only a hosted, privately authenticated pinned Sprite destination',()=>{
 expect(parseHostedOwnerWake(undefined,false)).toBeUndefined();
 expect(parseHostedOwnerWake(JSON.stringify(config),true,provider,token)).toEqual(config);
 for(const url of ['http://hehebot-fixture.sprites.app','https://hehebot-fixture.sprites.app.attacker.test',config.url+'/other',config.url+'?token=x','https://user@hehebot-fixture.sprites.app']){
  expect(()=>parseHostedOwnerWake(JSON.stringify({...config,url}),true,provider,token)).toThrow('Invalid hosted wake configuration');
 }
 expect(()=>parseHostedOwnerWake(JSON.stringify(config),false,provider,token)).toThrow();
 expect(()=>parseHostedOwnerWake(JSON.stringify(config),true,provider,'secret\nvalue')).toThrow();
});

it('sends the exact staged notification once without service start or redirect',async()=>{
 const fetcher=vi.fn(async(input:URL|RequestInfo,init?:RequestInit)=>{
  expect(String(input)).toBe(config.url+'/wake');
  expect(init?.redirect).toBe('error');expect(init?.method).toBe('POST');
  expect(init?.headers).toEqual({Authorization:`Bearer ${provider}`,'x-hehe-wake-token':token,'Content-Type':'application/json'});
  expect(JSON.parse(init?.body as string)).toEqual(command);
  return Response.json({accepted:true,epoch:4},{status:202});
 });
 await sendHostedOwnerWake(config,command,provider,token,fetcher as typeof fetch);
 expect(fetcher).toHaveBeenCalledTimes(1);
});

it('wrong receipt and transport secrets yield fixed unknown errors with no retries',async()=>{
 for(const response of [Response.json({accepted:true,epoch:3},{status:202}),new Response('private error body',{status:403}),Response.json({accepted:true,epoch:4},{status:200}),new Response('x'.repeat(4097),{status:202,headers:{'content-type':'application/json'}})]){
  const fetcher=vi.fn(async()=>response);
  await expect(sendHostedOwnerWake(config,command,provider,token,fetcher as typeof fetch)).rejects.toMatchObject({code:'HOSTED_WAKE_OUTCOME_UNKNOWN',message:'Hosted wake delivery is unconfirmed; it will not be retried.'});
  expect(fetcher).toHaveBeenCalledTimes(1);
 }
 const fetcher=vi.fn(async()=>{throw Error(provider);});
 await expect(sendHostedOwnerWake(config,command,provider,token,fetcher as typeof fetch)).rejects.not.toThrow(provider);
 expect(fetcher).toHaveBeenCalledTimes(1);
});

it('absolute timeout bounds a held receipt stream, cancels it and does not retry',async()=>{
 vi.useFakeTimers();
 try{
  let cancelled=false;
  const fetcher=vi.fn(async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}),{status:202,headers:{'content-type':'application/json'}}));
  const pending=sendHostedOwnerWake(config,command,provider,token,fetcher as typeof fetch);
  const rejected=expect(pending).rejects.toMatchObject({code:'HOSTED_WAKE_OUTCOME_UNKNOWN'});
  await vi.advanceTimersByTimeAsync(15000);await rejected;
  expect(cancelled).toBe(true);expect(fetcher).toHaveBeenCalledTimes(1);
 }finally{vi.useRealTimers();}
});
