import {ControlError,requireThat} from '../core/errors';

export type HostedOwnerWake={transition_id?:string;url:string};
const secret=(value:unknown):value is string=>typeof value==='string'&&value.length>=32&&value.length<=16384&&!/[\r\n\0]/.test(value);

/** Only locally assigned stages and numeric status are safe to log, never upstream text. */
export class HostedWakeDeliveryError extends ControlError {
 constructor(public phase:'request'|'response'|'receipt'|'timeout',public upstreamStatus:number|null){
  super('HOSTED_WAKE_OUTCOME_UNKNOWN','Hosted wake delivery is unconfirmed; it will not be retried.',503);
 }
}

/** Operator-pinned destination, never provider provisioning. Automatic mode gets
 * its transition from the exact durable assignment rather than deployment env. */
export function parseHostedOwnerWake(raw:string|undefined,hosted:boolean,providerToken?:string,wakeToken?:string,bootstrap=false):HostedOwnerWake|undefined {
 if(!raw)return undefined;
 let value:HostedOwnerWake,url:URL;
 try{value=JSON.parse(raw);url=new URL(value.url);}catch{throw new ControlError('INVALID_CONFIGURATION','Invalid hosted wake configuration.',503);}
 requireThat(hosted&&value&&Object.keys(value).sort().join(',')===(bootstrap?'url':'transition_id,url')&&
  (bootstrap||typeof value.transition_id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.transition_id))&&
  url.protocol==='https:'&&/^[a-z0-9-]+\.sprites\.app$/.test(url.hostname)&&!url.port&&!url.username&&!url.password&&url.pathname==='/'&&!url.search&&!url.hash&&
  secret(providerToken)&&secret(wakeToken),'INVALID_CONFIGURATION','Invalid hosted wake configuration.',503);
 return Object.freeze({...(!bootstrap?{transition_id:value.transition_id}:{}),url:url.origin});
}

/** One bounded notification only. No service start, redirect, retry or readiness claim. */
export async function sendHostedOwnerWake(config:HostedOwnerWake,command:{epoch:number;operationId:string},providerToken:string,wakeToken:string,fetcher:typeof fetch=fetch):Promise<void>{
 requireThat((config.transition_id===undefined||command.operationId===config.transition_id)&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(command.operationId)&&Number.isSafeInteger(command.epoch)&&command.epoch>=2&&secret(providerToken)&&secret(wakeToken),
  'INVALID_CONFIGURATION','Invalid hosted wake notification.',503);
 const controller=new AbortController();let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 let timer:ReturnType<typeof setTimeout>|undefined;
 let phase:HostedWakeDeliveryError['phase']='request',upstreamStatus:number|null=null;
 const failure=()=>new HostedWakeDeliveryError(phase,upstreamStatus);
 const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{phase='timeout';controller.abort();void reader?.cancel().catch(()=>{});reject(failure());},15000);});
 const request=(async()=>{
  // Workers rejects redirect:'error' before dispatch. Manual + exact202 rejects
  // redirects without following them or forwarding credentials to another URL.
  const response=await fetcher(new URL('/wake',config.url),{method:'POST',headers:{Authorization:`Bearer ${providerToken}`,'x-hehe-wake-token':wakeToken,'Content-Type':'application/json'},body:JSON.stringify(command),redirect:'manual',signal:controller.signal});
  if(controller.signal.aborted)throw failure();
  phase='response';upstreamStatus=response.status;
  if(response.status!==202||response.redirected||response.headers.get('content-type')?.split(';')[0].trim()!=='application/json'||!response.body){void response.body?.cancel().catch(()=>{});throw failure();}
  phase='receipt';
  reader=response.body.getReader();let size=0,text='';const decoder=new TextDecoder('utf-8',{fatal:true});
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>4096)throw failure();text+=decoder.decode(value,{stream:true});}
  text+=decoder.decode();const receipt=JSON.parse(text);
  if(receipt?.accepted!==true||receipt.epoch!==command.epoch)throw failure();
 })();
 try{await Promise.race([request,timeout]);}catch{throw failure();}
 finally{clearTimeout(timer);controller.abort();void reader?.cancel().catch(()=>{});}
}
