// Secret names only; values are set through Wrangler secret bindings, never committed.
declare namespace Cloudflare {
 interface Env { HEHEBOT_RUNTIME_GENERATION?:string; HEHEBOT_OWNER_ALPHA_SUCCESSOR?:string; HEHEBOT_HOSTED_OWNER_ALPHA?:string; HEHEBOT_OWNER_ALPHA?:string; NATIVE_DELEGATIONS?:string; FLIGHT_RESTORE_VERIFIED?:string; FLIGHT_RESTORE_POLICY_ID?:string; PROVIDER_TOKEN?: string; SPRITE_WAKE_TOKEN?: string; RUNTIME_TOKEN?: string; TRIGGER_SECRETS?: string; }
}

interface Env { HEHEBOT_RUNTIME_GENERATION?:string; HEHEBOT_OWNER_ALPHA_SUCCESSOR?:string; HEHEBOT_HOSTED_OWNER_ALPHA?:string; HEHEBOT_OWNER_ALPHA?:string; NATIVE_DELEGATIONS?:string; FLIGHT_RESTORE_VERIFIED?:string; FLIGHT_RESTORE_POLICY_ID?:string; PROVIDER_TOKEN?: string; SPRITE_WAKE_TOKEN?: string; RUNTIME_TOKEN?: string; TRIGGER_SECRETS?: string; }
