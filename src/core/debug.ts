/** Optional structured debug logging (docs/METERING.md "Debug logging"),
 * gated by the HEHEBOT_DEBUG environment value ("1"); zero cost when unset
 * or any other value. Each event is a single console.log(JSON.stringify(...))
 * line so `wrangler tail` can show it. Callers pass component/event plus a
 * details object of ids, types, status/outcome codes and durations only --
 * never message text, tokens, secrets or headers. */
export interface DebugEnv{HEHEBOT_DEBUG?:string}
export function debugEnabled(env:DebugEnv):boolean{return env.HEHEBOT_DEBUG==='1';}
export function debugLog(env:DebugEnv,component:string,event:string,details:Record<string,unknown>):void{
 if(!debugEnabled(env))return;
 try{console.log(JSON.stringify({ts:new Date().toISOString(),component,event,...details}));}catch{/* logging must never fail the caller's work */}
}
