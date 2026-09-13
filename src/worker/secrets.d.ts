// Secret names only; values are set through Wrangler secret bindings, never committed.
declare namespace Cloudflare {
 interface Env { NATIVE_DELEGATIONS?:string; FLIGHT_RESTORE_VERIFIED?:string; FLIGHT_RESTORE_POLICY_ID?:string; PROVIDER_TOKEN?: string; SPRITE_WAKE_TOKEN?: string; RUNTIME_TOKEN?: string; TRIGGER_SECRETS?: string; }
}

interface Env { NATIVE_DELEGATIONS?:string; FLIGHT_RESTORE_VERIFIED?:string; FLIGHT_RESTORE_POLICY_ID?:string; PROVIDER_TOKEN?: string; SPRITE_WAKE_TOKEN?: string; RUNTIME_TOKEN?: string; TRIGGER_SECRETS?: string; }
