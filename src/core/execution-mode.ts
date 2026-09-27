import {requireThat} from './errors';

/** V8: the explicit hosted execution mode for the v2 architecture path
 * (ARCHITECTURE_V2 A1–A4). Off unless `HEHEBOT_EXECUTION_MODE` is exactly
 * `v2`. When on, it is the single switch that admits ordinary execution
 * (claim/heartbeat/complete/sleep through `/internal/*` with RUNTIME_TOKEN) and
 * the per-persona coordinator inbox, without the legacy NATIVE_VERIFIED gate
 * (whose recursive-settlement proof ARCHITECTURE_V2 §9 superseded). It never
 * coexists with an owner-alpha or test-campaign configuration, so the staged
 * owner-alpha code stays intact but unreachable from this mode. */
export type ExecutionMode='v2';
export type ExecutionModeEnv={
 HEHEBOT_EXECUTION_MODE?:string;AUTH_MODE?:string;OWNER_SUB?:string;EXECUTION_ENABLED?:string;PROVIDER_CONFIG?:string;RUNTIME_TOKEN?:string;
 HEHEBOT_OWNER_ALPHA?:string;HEHEBOT_HOSTED_OWNER_ALPHA?:string;HEHEBOT_OWNER_ALPHA_BOOTSTRAP?:string;HEHEBOT_OWNER_ALPHA_WARM_GENERATION?:string;
 HEHEBOT_OWNER_ALPHA_BACKGROUND_GENERATION?:string;HEHEBOT_OWNER_ALPHA_SUCCESSOR?:string;HEHEBOT_TEST_ACCESS?:string;HEHEBOT_TEST_CAMPAIGN?:string;
};
const unset=(value:string|undefined)=>value===undefined||value==='';
export function parseExecutionMode(env:ExecutionModeEnv):ExecutionMode|undefined {
 if(unset(env.HEHEBOT_EXECUTION_MODE))return undefined;
 requireThat(env.HEHEBOT_EXECUTION_MODE==='v2','INVALID_CONFIGURATION','Unknown execution mode.',503);
 let provider:{provider?:unknown;ref?:{id?:unknown}}|undefined;
 try{provider=JSON.parse(env.PROVIDER_CONFIG??'{}');}catch{provider=undefined;}
 // Hosted uses the Sprites provider; the fake provider is loopback-only rehearsal.
 const providerOk=!!provider&&typeof provider==='object'&&typeof provider.ref?.id==='string'&&
  (provider.provider==='fly-sprites'||provider.provider==='fake'&&env.AUTH_MODE==='local');
 requireThat(env.EXECUTION_ENABLED==='true'&&providerOk&&typeof env.RUNTIME_TOKEN==='string'&&env.RUNTIME_TOKEN.length>=32&&
  typeof env.OWNER_SUB==='string'&&env.OWNER_SUB.length>0&&(env.AUTH_MODE==='access'||env.AUTH_MODE==='local'),
  'INVALID_CONFIGURATION','v2 execution mode requires EXECUTION_ENABLED, one owner, a runtime provider and a runtime token.',503);
 requireThat([env.HEHEBOT_OWNER_ALPHA,env.HEHEBOT_HOSTED_OWNER_ALPHA,env.HEHEBOT_OWNER_ALPHA_BOOTSTRAP,env.HEHEBOT_OWNER_ALPHA_WARM_GENERATION,
  env.HEHEBOT_OWNER_ALPHA_BACKGROUND_GENERATION,env.HEHEBOT_OWNER_ALPHA_SUCCESSOR,env.HEHEBOT_TEST_ACCESS,env.HEHEBOT_TEST_CAMPAIGN].every(unset),
  'INVALID_CONFIGURATION','v2 execution mode cannot be combined with owner-alpha or test-campaign configuration.',503);
 return 'v2';
}
