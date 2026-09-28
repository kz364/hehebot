// Secret names only; values are set through Wrangler secret bindings, never committed.
// No top-level import: this file must stay an ambient script (not a module),
// or the global `interface Env`/`declare namespace Cloudflare` merges below
// silently stop applying. Reference workers-types inline instead.
type __R2Bucket = import('@cloudflare/workers-types').R2Bucket;
declare namespace Cloudflare {
 interface Env { HEHEBOT_TEST_REVOKED?:string; }
 // V-Backups: R2 binding and age recipient are only present in the env.hehebot
 // named environment (see wrangler.jsonc); optional here so other envs/tests
 // that omit them still type-check. Absent/empty means the feature is off.
 interface Env { BACKUPS?:__R2Bucket; HEHEBOT_BACKUP_AGE_RECIPIENT?:string; }
 interface Env { HEHEBOT_TEST_ACCESS?:string; HEHEBOT_TEST_CAMPAIGN?:string; }
 interface Env { HEHEBOT_OWNER_ALPHA_BOOTSTRAP?:string; HEHEBOT_OWNER_ALPHA_MANAGER_TOKEN?:string; HEHEBOT_OWNER_ALPHA_TASK_SIGNING_KEY?:string; }
 interface Env { HEHEBOT_OWNER_ALPHA_WAKE?:string; HEHEBOT_OWNER_ALPHA_WAKE_TOKEN?:string; }
 interface Env { HEHEBOT_OWNER_ALPHA_WARM_GENERATION?:string; HEHEBOT_OWNER_ALPHA_HOST_SIGNING_KEY?:string; }
 interface Env { HEHEBOT_OWNER_ALPHA_BACKGROUND_GENERATION?:string; HEHEBOT_OWNER_ALPHA_BACKGROUND_HOST_SIGNING_KEY?:string; HEHEBOT_OWNER_ALPHA_BACKGROUND_TASK_SIGNING_KEY?:string; }
 interface Env { HEHEBOT_STUCK_POLICY?:string; HEHEBOT_BOOT_DEADLINE_MS?:string; HEHEBOT_SUCCESSOR_BACKOFF?:string; HEHEBOT_RUNTIME_GENERATION?:string; HEHEBOT_OWNER_ALPHA_SUCCESSOR?:string; HEHEBOT_HOSTED_OWNER_ALPHA?:string; HEHEBOT_OWNER_ALPHA?:string; NATIVE_DELEGATIONS?:string; FLIGHT_RESTORE_VERIFIED?:string; FLIGHT_RESTORE_POLICY_ID?:string; PROVIDER_TOKEN?: string; SPRITE_WAKE_TOKEN?: string; RUNTIME_TOKEN?: string; TRIGGER_SECRETS?: string; HEHEBOT_METERING_RATES?: string; HEHEBOT_DEBUG?: string; }
 // Web Push (TODO.md "Push notifications"). Push stays disabled -- and the
 // portal hides its toggle -- unless all three are set. See docs/PUSH.md for
 // key formats and the exact `wrangler secret put` commands.
 interface Env { HEHEBOT_VAPID_PUBLIC_KEY?:string; HEHEBOT_VAPID_PRIVATE_KEY?:string; HEHEBOT_VAPID_SUBJECT?:string; }
}

interface Env { HEHEBOT_TEST_REVOKED?:string; }
interface Env { BACKUPS?:__R2Bucket; HEHEBOT_BACKUP_AGE_RECIPIENT?:string; }
interface Env { HEHEBOT_TEST_ACCESS?:string; HEHEBOT_TEST_CAMPAIGN?:string; }
interface Env { HEHEBOT_OWNER_ALPHA_BOOTSTRAP?:string; HEHEBOT_OWNER_ALPHA_MANAGER_TOKEN?:string; HEHEBOT_OWNER_ALPHA_TASK_SIGNING_KEY?:string; }
interface Env { HEHEBOT_OWNER_ALPHA_WAKE?:string; HEHEBOT_OWNER_ALPHA_WAKE_TOKEN?:string; }
interface Env { HEHEBOT_OWNER_ALPHA_WARM_GENERATION?:string; HEHEBOT_OWNER_ALPHA_HOST_SIGNING_KEY?:string; }
interface Env { HEHEBOT_OWNER_ALPHA_BACKGROUND_GENERATION?:string; HEHEBOT_OWNER_ALPHA_BACKGROUND_HOST_SIGNING_KEY?:string; HEHEBOT_OWNER_ALPHA_BACKGROUND_TASK_SIGNING_KEY?:string; }
interface Env { HEHEBOT_STUCK_POLICY?:string; HEHEBOT_BOOT_DEADLINE_MS?:string; HEHEBOT_SUCCESSOR_BACKOFF?:string; HEHEBOT_RUNTIME_GENERATION?:string; HEHEBOT_OWNER_ALPHA_SUCCESSOR?:string; HEHEBOT_HOSTED_OWNER_ALPHA?:string; HEHEBOT_OWNER_ALPHA?:string; NATIVE_DELEGATIONS?:string; FLIGHT_RESTORE_VERIFIED?:string; FLIGHT_RESTORE_POLICY_ID?:string; PROVIDER_TOKEN?: string; SPRITE_WAKE_TOKEN?: string; RUNTIME_TOKEN?: string; TRIGGER_SECRETS?: string; HEHEBOT_METERING_RATES?: string; HEHEBOT_DEBUG?: string; }
interface Env { HEHEBOT_VAPID_PUBLIC_KEY?:string; HEHEBOT_VAPID_PRIVATE_KEY?:string; HEHEBOT_VAPID_SUBJECT?:string; }
