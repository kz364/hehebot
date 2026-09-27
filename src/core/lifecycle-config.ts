import { requireThat } from './errors';
import type { SuccessorBackoff } from './lifecycle';

/** Provider-neutral lifecycle timings from Worker vars. Unset keeps the
 * historical lease windows and no backoff; malformed values fail closed.
 *  HEHEBOT_BOOT_DEADLINE_MS    wake -> ready window before the generation is abandoned
 *  HEHEBOT_SUCCESSOR_BACKOFF   {"base_ms","max_ms","notify_after"} for successive failed starts */
export function parseLifecycleTimings(env:{HEHEBOT_BOOT_DEADLINE_MS?:string;HEHEBOT_SUCCESSOR_BACKOFF?:string}):{bootDeadlineMs?:number;backoff?:SuccessorBackoff} {
 const out:{bootDeadlineMs?:number;backoff?:SuccessorBackoff}={};
 if(env.HEHEBOT_BOOT_DEADLINE_MS){
  const value=Number(env.HEHEBOT_BOOT_DEADLINE_MS);
  requireThat(Number.isInteger(value)&&value>=2000&&value<=600000,'INVALID_CONFIGURATION','HEHEBOT_BOOT_DEADLINE_MS must be 2000..600000.',503);
  out.bootDeadlineMs=value;
 }
 if(env.HEHEBOT_SUCCESSOR_BACKOFF){
  let raw:unknown;try{raw=JSON.parse(env.HEHEBOT_SUCCESSOR_BACKOFF);}catch{raw=null;}
  const b=raw as {base_ms?:unknown;max_ms?:unknown;notify_after?:unknown}|null;
  const int=(v:unknown,min:number,max:number)=>Number.isInteger(v)&&(v as number)>=min&&(v as number)<=max;
  requireThat(!!b&&typeof b==='object'&&Object.keys(b).every(k=>['base_ms','max_ms','notify_after'].includes(k))&&
   int(b.base_ms,0,3600000)&&int(b.max_ms,0,86400000)&&(b.max_ms as number)>=(b.base_ms as number)&&int(b.notify_after,1,1000),
   'INVALID_CONFIGURATION','HEHEBOT_SUCCESSOR_BACKOFF must be {"base_ms","max_ms","notify_after"}.',503);
  out.backoff={baseMs:b!.base_ms as number,maxMs:b!.max_ms as number,notifyAfter:b!.notify_after as number};
 }
 return out;
}
