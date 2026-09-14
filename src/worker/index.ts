import { unwrap } from './rpc';
import { PersonalControl } from './control-object';
import { authenticateOwner, assertSameOrigin, verifyRuntimeToken, verifyWebhook } from './auth';
import { ControlError, requireThat, safeError } from '../core/errors';
import { digest, json, parseJson, readBounded } from './http';
export { PersonalControl };
export default {
 async fetch(request:Request,env:Env):Promise<Response>{
  const requestId=crypto.randomUUID();
  try{
   const url=new URL(request.url),path=url.pathname;
   const control=env.CONTROL.getByName(env.INSTALLATION_ID);
   if(path.startsWith('/internal/')){
    requireThat(request.method==='POST','NOT_FOUND','Route unavailable.',404);verifyRuntimeToken(request,env.RUNTIME_TOKEN);
    const payload=parseJson(await readBounded(request));return json(unwrap(await control.runtime({type:path.slice('/internal/'.length),payload})));
   }
   if(path.startsWith('/v1/triggers/')){
    requireThat(request.method==='POST','NOT_FOUND','Route unavailable.',404);
    const source=path.slice('/v1/triggers/'.length);requireThat(/^[0-9a-f-]{36}$/i.test(source),'NOT_FOUND','Trigger unavailable.',404);
    const secrets=JSON.parse(env.TRIGGER_SECRETS??'{}') as Record<string,string>,raw=await readBounded(request);
    requireThat(typeof secrets[source]==='string','NOT_FOUND','Trigger unavailable.',404);
    const auth=await verifyWebhook(raw,request.headers,secrets[source]);const payload=parseJson(raw);
    requireThat(payload&&typeof payload==='object'&&!Array.isArray(payload),'INVALID_INPUT','Invalid event.',422);
    const event=payload as Record<string,unknown>;
    requireThat(event.schema_version===1&&typeof event.type==='string'&&event.type.length<=80&&event.data&&typeof event.data==='object'&&!Array.isArray(event.data)&&Object.keys(event).every(k=>['schema_version','type','data'].includes(k)),'INVALID_INPUT','Invalid event envelope.',422);
    return json(unwrap(await control.trigger(source,auth.eventId,await digest(raw,true),event.type,event.data as Record<string,unknown>)),202);
   }
   // Auth is applied before assets as well as API. Local dev is loopback-only.
   const owner=await authenticateOwner(request,env);
   if(path==='/v1/commands'&&request.method==='POST'){
    assertSameOrigin(request);requireThat(request.headers.get('Content-Type')?.split(';')[0]==='application/json','INVALID_INPUT','Use application/json.',422);
    const input=parseJson(await readBounded(request));const key=request.headers.get('Idempotency-Key')??'';
    return json(unwrap(await control.accept(owner,key,await digest(input),input)),202);
   }
   if(path==='/v1/state'&&request.method==='GET'){
    const after=url.searchParams.get('after'),limit=Number(url.searchParams.get('limit')??100);
    requireThat(after===null||/^\d+$/.test(after)&&Number.isSafeInteger(Number(after)),'INVALID_INPUT','Invalid cursor.',422);
    requireThat(Number.isInteger(limit)&&limit>=1&&limit<=100,'INVALID_INPUT','Limit must be 1–100.',422);
    return json(unwrap(await control.getState(owner,after===null?undefined:Number(after),limit)));
   }
   if(path==='/v1/export/control'&&request.method==='GET')return new Response(unwrap(await control.getControlExport(owner)),{headers:{'Content-Type':'application/json','Content-Disposition':'attachment; filename="hehebot-control-export.json"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
   const conversation=path.match(/^\/v1\/conversations\/([0-9a-f-]{36})\/events$/i);
   if(conversation&&request.method==='GET'){const before=url.searchParams.get('before');requireThat(before===null||/^\d+$/.test(before)&&Number.isSafeInteger(Number(before)),'INVALID_INPUT','Invalid history cursor.',422);return json(unwrap(await control.getTimeline(owner,conversation[1],before===null?undefined:Number(before))));}
   const recovery=path.match(/^\/v1\/conversations\/([0-9a-f-]{36})\/recovery$/i);
   if(recovery&&request.method==='GET')return json(unwrap(await control.getRecovery(owner,recovery[1],url.searchParams.get('after')??undefined,Number(url.searchParams.get('limit')??20))));
   const receipt=path.match(/^\/v1\/receipts\/([0-9a-f-]{36})$/i);
   if(receipt&&request.method==='GET')return json(unwrap(await control.getReceipt(owner,receipt[1])));
   if(path.startsWith('/v1/')||!['GET','HEAD'].includes(request.method))throw new ControlError('NOT_FOUND','Route unavailable.',404);
   const response=await env.ASSETS.fetch(request);const headers=new Headers(response.headers);
   headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
   headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','same-origin');headers.set('Cache-Control','private, no-store');
   return new Response(response.body,{status:response.status,headers});
  }catch(error){
   const status=error instanceof ControlError?error.status:500;
   if(status>=500)console.error(JSON.stringify({event:'request.failed',request_id:requestId,code:safeError(error).code}));
   const response=json({error:safeError(error),request_id:requestId},status);if(status===429)response.headers.set('Retry-After','60');return response;
  }
 }
} satisfies ExportedHandler<Env>;
