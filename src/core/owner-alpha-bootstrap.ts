import {createHash} from 'node:crypto';
import {ControlError,requireThat} from './errors';
import type {ControlCore} from './control';
import {LifecycleCore} from './lifecycle';
import type {OwnerAlphaSuccessor,TextOnlyProfile} from './owner-alpha';
import type {Store} from './store';
import type {Run} from './types';

export type OwnerAlphaUnusedRecovery={kind:'unused-before-staging-v1';installation_id:string;owner_binding_sha256:string;
 predecessor:Pick<OwnerAlphaManifest,'manifest_sha256'|'epoch'|'boot_id'|'transition_id'|'session_id'|'run_id'>;
 evidence:{sha256:string;observed_at:string;source:string};successor_policy_revision:string;expires_at:string};
export type OwnerAlphaUnusedDisposition={grant:OwnerAlphaUnusedRecovery;successor_manifest_sha256:string;successor_epoch:number;successor_run_id:string};
export type UnusedMessageBoundAuthority={kind:'owner-message-unused-recovery';manifest:OwnerAlphaManifest;disposition_sha256:string};
export type OwnerAlphaClaimedPreTurnQuarantine=Omit<OwnerAlphaUnusedRecovery,'kind'|'predecessor'>&{
 kind:'claimed-pre-turn-quarantine-v1';predecessor:OwnerAlphaUnusedRecovery['predecessor']&{
 attempt:1;submission_key:string;native_attempt_id:string;native_fingerprint:string}};
export type OwnerAlphaClaimedPreTurnDisposition={grant:OwnerAlphaClaimedPreTurnQuarantine;successor_manifest_sha256:string;successor_epoch:number;successor_run_id:string};
export type ClaimedPreTurnMessageBoundAuthority={kind:'owner-message-claimed-pre-turn-quarantine';manifest:OwnerAlphaManifest;disposition_sha256:string};

export type OwnerAlphaRetirement={epoch:number;boot_id:string;session_id:string;transition_id:string|null;
 observed_at:string;direct_child_stopped:true;execution_lock_free:true;session_lock_free:true;source:string};
export type OwnerAlphaBootstrapConfig={installation_id:string;owner_id:string;owner_binding_sha256:string;
 policy_revision:string;persona_id:string;text_only:TextOnlyProfile;expires_at:string;session_seconds:number;max_task_seconds:number;
 prior_cost_micro_usd:number;prior_cost_source:string;total_cap_micro_usd:number;reservation_micro_usd:number;
 seed_retirement?:OwnerAlphaRetirement;unused_recovery?:OwnerAlphaUnusedRecovery;claimed_pre_turn_quarantine?:OwnerAlphaClaimedPreTurnQuarantine};
export type OwnerAlphaManifest={installation_id:string;owner_binding_sha256:string;run_id:string;persona_id:string;
 command_id:string;command_sha256:string;event_sequence:number;policy_revision:string;epoch:number;boot_id:string;transition_id:string;
 session_id:string;text_only:TextOnlyProfile;issued_at:string;expires_at:string;reservation_micro_usd:number;manifest_sha256:string};
export type MessageBoundAuthority=OwnerAlphaSuccessor&{kind:'owner-message';manifest:OwnerAlphaManifest};
export type OwnerAlphaBootstrapSummary={policy_revision:string;persona_id:string;expires_at:string;max_task_seconds:number;message_admission_available:boolean};
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Canonical field order is independent of transport JSON key order.
export function ownerAlphaManifestSha256(m:Omit<OwnerAlphaManifest,'manifest_sha256'>):string {
 return digest([m.installation_id,m.owner_binding_sha256,m.run_id,m.persona_id,m.command_id,m.command_sha256,m.event_sequence,
  m.policy_revision,m.epoch,m.boot_id,m.transition_id,m.session_id,m.text_only.profile_version,m.text_only.profile_sha256,
  m.issued_at,m.expires_at,m.reservation_micro_usd]);
}
const utc=(v:string)=>Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
export function parseOwnerAlphaUnusedRecovery(value:unknown):OwnerAlphaUnusedRecovery {
 const r=value as OwnerAlphaUnusedRecovery;
 const fields=(v:unknown,keys:string)=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===keys;
 const id=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
 const hash=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
 requireThat(fields(r,'evidence,expires_at,installation_id,kind,owner_binding_sha256,predecessor,successor_policy_revision')&&r.kind==='unused-before-staging-v1'&&
  [r.installation_id,r.successor_policy_revision].every(v=>typeof v==='string'&&v.length>0&&v.length<=256)&&hash(r.owner_binding_sha256)&&
  fields(r.predecessor,'boot_id,epoch,manifest_sha256,run_id,session_id,transition_id')&&hash(r.predecessor.manifest_sha256)&&Number.isSafeInteger(r.predecessor.epoch)&&r.predecessor.epoch>=2&&
  [r.predecessor.boot_id,r.predecessor.transition_id,r.predecessor.session_id,r.predecessor.run_id].every(id)&&
  fields(r.evidence,'observed_at,sha256,source')&&hash(r.evidence.sha256)&&typeof r.evidence.observed_at==='string'&&utc(r.evidence.observed_at)&&typeof r.evidence.source==='string'&&r.evidence.source.length>0&&r.evidence.source.length<=256&&
  typeof r.expires_at==='string'&&utc(r.expires_at)&&r.expires_at>r.evidence.observed_at,'INVALID_CONFIGURATION','Invalid unused-before-staging recovery grant.',503);
 return {kind:r.kind,installation_id:r.installation_id,owner_binding_sha256:r.owner_binding_sha256,
  predecessor:{manifest_sha256:r.predecessor.manifest_sha256,epoch:r.predecessor.epoch,boot_id:r.predecessor.boot_id,transition_id:r.predecessor.transition_id,session_id:r.predecessor.session_id,run_id:r.predecessor.run_id},
  evidence:{sha256:r.evidence.sha256,observed_at:r.evidence.observed_at,source:r.evidence.source},successor_policy_revision:r.successor_policy_revision,expires_at:r.expires_at};
}
export function parseOwnerAlphaClaimedPreTurnQuarantine(value:unknown):OwnerAlphaClaimedPreTurnQuarantine {
 const q=value as OwnerAlphaClaimedPreTurnQuarantine,p=q?.predecessor;
 requireThat(q&&q.kind==='claimed-pre-turn-quarantine-v1'&&p&&typeof p==='object'&&!Array.isArray(p)&&
  Object.keys(p).sort().join(',')==='attempt,boot_id,epoch,manifest_sha256,native_attempt_id,native_fingerprint,run_id,session_id,submission_key,transition_id'&&
  p.attempt===1&&p.submission_key===`${p.run_id}:1`&&p.native_attempt_id===digest([q.installation_id,p.submission_key])&&
  typeof p.native_fingerprint==='string'&&/^[0-9a-f]{64}$/.test(p.native_fingerprint),'INVALID_CONFIGURATION','Invalid claimed-pre-turn quarantine grant.',503);
 const {attempt,submission_key,native_attempt_id,native_fingerprint,...predecessor}=p;
 // Reuse strict identity/evidence syntax only, never unused-custody semantics.
 const common=parseOwnerAlphaUnusedRecovery({...q,kind:'unused-before-staging-v1',predecessor});
 return {...common,kind:q.kind,predecessor:{...common.predecessor,attempt,submission_key,native_attempt_id,native_fingerprint}};
}
/** This corroborates a trusted quarantine marker; it never proves absence of native effects. */
export function assertClaimedPreTurnQuarantineCustody(store:Store,grant:OwnerAlphaClaimedPreTurnQuarantine,prior:OwnerAlphaManifest,now:string):void {
 const {attempt,submission_key,native_attempt_id:_,native_fingerprint:__,...p}=grant.predecessor,db=store.db,run=store.run(p.run_id);
 const attempts=db.all<{run_id:string;attempt:number;epoch:number;boot_id:string;submission_key:string;status:string;deadline_at:string;native_run_ref:string|null;result_json:string|null;coordinator_release_json:string|null;settled_at:string|null}>(
  'SELECT * FROM attempts WHERE run_id=? OR epoch=? OR boot_id=?',p.run_id,p.epoch,p.boot_id),a=attempts[0];
 requireThat(grant.installation_id===prior.installation_id&&grant.owner_binding_sha256===prior.owner_binding_sha256&&Object.entries(p).every(([key,value])=>prior[key as keyof typeof p]===value)&&
  grant.evidence.observed_at>=prior.expires_at&&grant.evidence.observed_at<=now&&now<grant.expires_at&&grant.successor_policy_revision!==prior.policy_revision&&
  run.current_attempt===1&&run.status==='recovery_required'&&run.checkpoint_json===null&&attempts.length===1&&a.run_id===p.run_id&&a.attempt===attempt&&a.epoch===p.epoch&&a.boot_id===p.boot_id&&
  a.submission_key===submission_key&&a.status==='claimed'&&utc(a.deadline_at)&&a.deadline_at<=now&&a.native_run_ref===null&&a.result_json===null&&a.coordinator_release_json===null&&a.settled_at===null,
  'CAPABILITY_UNAVAILABLE','Claimed quarantine does not match exact unresolved predecessor custody.');
 requireThat(!db.all('SELECT id FROM runs WHERE parent_run_id=? LIMIT 1',p.run_id).length&&
  !db.all('SELECT run_id FROM native_task_links WHERE run_id=? OR parent_run_id=? LIMIT 1',p.run_id,p.run_id).length&&
  !db.all('SELECT id FROM operations WHERE run_id=? LIMIT 1',p.run_id).length&&!db.all('SELECT id FROM effects WHERE run_id=? LIMIT 1',p.run_id).length&&
  !db.all('SELECT resource_id FROM resource_locks WHERE run_id=? LIMIT 1',p.run_id).length&&!db.all('SELECT run_id FROM retry_queue WHERE run_id=? LIMIT 1',p.run_id).length&&
  !db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'native-question:*' AND (json_extract(value_json,'$.run_id')=? OR json_extract(value_json,'$.epoch')=? OR json_extract(value_json,'$.boot_id')=?) LIMIT 1",p.run_id,p.epoch,p.boot_id).length&&
  !db.all('SELECT key FROM runtime_metadata WHERE key GLOB ?',`text_only_receipt:${p.run_id}:*`).length&&
  !db.all('SELECT id FROM controller_operations WHERE epoch=? LIMIT 1',p.epoch).length,'CAPABILITY_UNAVAILABLE','Activity contradicts claimed-pre-turn quarantine.');
}
/** Negative database checks corroborate explicit trusted evidence; they never create it. */
export function assertUnusedRecoveryCustody(store:Store,grant:OwnerAlphaUnusedRecovery,prior:OwnerAlphaManifest,now:string):void {
 const p=grant.predecessor,db=store.db,run=store.run(p.run_id);
 requireThat(grant.installation_id===prior.installation_id&&grant.owner_binding_sha256===prior.owner_binding_sha256&&
  Object.entries(p).every(([key,value])=>prior[key as keyof typeof p]===value)&&grant.evidence.observed_at>=prior.expires_at&&grant.evidence.observed_at<=now&&now<grant.expires_at&&
  grant.successor_policy_revision!==prior.policy_revision&&run.current_attempt===0&&run.status==='queued'&&run.checkpoint_json===null,
  'CAPABILITY_UNAVAILABLE','Unused recovery does not match expired predecessor custody.');
 requireThat(!db.all('SELECT run_id FROM attempts WHERE run_id=? OR epoch=? OR boot_id=? LIMIT 1',p.run_id,p.epoch,p.boot_id).length&&
  !db.all('SELECT id FROM runs WHERE parent_run_id=? LIMIT 1',p.run_id).length&&
  !db.all('SELECT run_id FROM native_task_links WHERE run_id=? OR parent_run_id=? LIMIT 1',p.run_id,p.run_id).length&&
  !db.all('SELECT id FROM operations WHERE run_id=? LIMIT 1',p.run_id).length&&!db.all('SELECT id FROM effects WHERE run_id=? LIMIT 1',p.run_id).length&&
  !db.all('SELECT resource_id FROM resource_locks WHERE run_id=? LIMIT 1',p.run_id).length&&!db.all('SELECT run_id FROM retry_queue WHERE run_id=? LIMIT 1',p.run_id).length&&
  !db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'native-question:*' AND (json_extract(value_json,'$.run_id')=? OR json_extract(value_json,'$.epoch')=? OR json_extract(value_json,'$.boot_id')=?) LIMIT 1",p.run_id,p.epoch,p.boot_id).length&&
  !db.all('SELECT id FROM controller_operations WHERE epoch=? LIMIT 1',p.epoch).length,
  'CAPABILITY_UNAVAILABLE','Activity contradicts unused-before-staging evidence.');
}
export function parseOwnerAlphaBootstrap(value:string|undefined):OwnerAlphaBootstrapConfig|undefined {
 if(value===undefined||value==='')return undefined;
 let c:OwnerAlphaBootstrapConfig;
 try{c=JSON.parse(value);}catch{requireThat(false,'INVALID_CONFIGURATION','Invalid automatic owner-alpha JSON.',503);}
 const keys=['installation_id','owner_id','owner_binding_sha256','policy_revision','persona_id','text_only','expires_at','session_seconds','max_task_seconds','prior_cost_micro_usd','prior_cost_source','total_cap_micro_usd','reservation_micro_usd',...(Object.hasOwn(c??{},'seed_retirement')?['seed_retirement']:[]),...(Object.hasOwn(c??{},'unused_recovery')?['unused_recovery']:[]),...(Object.hasOwn(c??{},'claimed_pre_turn_quarantine')?['claimed_pre_turn_quarantine']:[])];
 requireThat(c&&typeof c==='object'&&!Array.isArray(c)&&Object.keys(c).sort().join(',')===keys.sort().join(',')&&
  [c.installation_id,c.owner_id,c.policy_revision,c.prior_cost_source].every(v=>typeof v==='string'&&v.length>0&&v.length<=256)&&!/^(runtime|trigger):/.test(c.owner_id)&&
  typeof c.owner_binding_sha256==='string'&&/^[0-9a-f]{64}$/.test(c.owner_binding_sha256)&&typeof c.persona_id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c.persona_id)&&
  c.text_only&&Object.keys(c.text_only).sort().join(',')==='profile_sha256,profile_version'&&c.text_only.profile_version==='codex-text-only-v1'&&/^[0-9a-f]{64}$/.test(c.text_only.profile_sha256)&&typeof c.expires_at==='string'&&utc(c.expires_at)&&
  [c.session_seconds,c.max_task_seconds].every(n=>Number.isSafeInteger(n)&&n>=1&&n<=300)&&
  [c.prior_cost_micro_usd,c.total_cap_micro_usd,c.reservation_micro_usd].every(n=>Number.isSafeInteger(n)&&n>=0)&&c.reservation_micro_usd>0,
  'INVALID_CONFIGURATION','Invalid automatic owner-alpha configuration.',503);
 if(Object.hasOwn(c,'seed_retirement'))validateRetirement(c.seed_retirement!);
 const recovery=Object.hasOwn(c,'unused_recovery')?parseOwnerAlphaUnusedRecovery(c.unused_recovery):undefined;
 const quarantine=Object.hasOwn(c,'claimed_pre_turn_quarantine')?parseOwnerAlphaClaimedPreTurnQuarantine(c.claimed_pre_turn_quarantine):undefined;
 requireThat(!(recovery&&quarantine),'INVALID_CONFIGURATION','Recovery authorities are mutually exclusive.',503);
 return {installation_id:c.installation_id,owner_id:c.owner_id,owner_binding_sha256:c.owner_binding_sha256,policy_revision:c.policy_revision,persona_id:c.persona_id,
  text_only:{profile_version:c.text_only.profile_version,profile_sha256:c.text_only.profile_sha256},expires_at:c.expires_at,session_seconds:c.session_seconds,max_task_seconds:c.max_task_seconds,
  prior_cost_micro_usd:c.prior_cost_micro_usd,prior_cost_source:c.prior_cost_source,total_cap_micro_usd:c.total_cap_micro_usd,reservation_micro_usd:c.reservation_micro_usd,...(c.seed_retirement?{seed_retirement:c.seed_retirement}:{}),...(recovery?{unused_recovery:recovery}:{}),...(quarantine?{claimed_pre_turn_quarantine:quarantine}:{})};
}
function validateRetirement(r:OwnerAlphaRetirement):void {
 requireThat(r&&typeof r==='object'&&!Array.isArray(r)&&Object.keys(r).sort().join(',')==='boot_id,direct_child_stopped,epoch,execution_lock_free,observed_at,session_id,session_lock_free,source,transition_id'&&
  Number.isSafeInteger(r.epoch)&&r.epoch>=1&&typeof r.boot_id==='string'&&typeof r.session_id==='string'&&(r.transition_id===null||typeof r.transition_id==='string')&&
  r.direct_child_stopped===true&&r.execution_lock_free===true&&r.session_lock_free===true&&typeof r.observed_at==='string'&&utc(r.observed_at)&&typeof r.source==='string'&&r.source.length>0&&r.source.length<=256,
  'INVALID_INPUT','Invalid trusted retirement observation.',422);
}
/** Trusted host configuration and observations, never message-supplied authority. */
export class OwnerAlphaBootstrap {
 readonly config:OwnerAlphaBootstrapConfig|undefined;
 constructor(private core:ControlCore){
  this.config=core.options.ownerAlphaBootstrap?parseOwnerAlphaBootstrap(JSON.stringify(core.options.ownerAlphaBootstrap)):undefined;
  // A fresh Durable Object constructs the core before installing its schema.
  // Existing custody must still validate even after configuration is removed.
  if(core.store.db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='runtime_metadata'").length&&
   core.store.db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_claimed_pre_turn_disposition:*' OR (key GLOB 'owner_alpha_generation:*' AND json_extract(value_json,'$.authority.kind')='owner-message-claimed-pre-turn-quarantine') LIMIT 1").length)core.ownerAlpha.activeGeneration();
  const c=this.config;if(!c)return;
  requireThat(!core.options.executionEnabled&&!!core.options.ownerAlpha,
   'INVALID_CONFIGURATION','Invalid automatic owner-alpha configuration.',503);
  this.configuredRecovery();
  this.configuredQuarantine();
 }
 private read<T>(key:string):T|undefined {const row=this.core.store.db.all<{value_json:string}>('SELECT value_json FROM runtime_metadata WHERE key=?',key)[0];return row?JSON.parse(row.value_json) as T:undefined;}
 private put(key:string,value:unknown){this.core.store.db.exec('INSERT INTO runtime_metadata(key,value_json) VALUES(?,?)',key,JSON.stringify(value));}
 private configuredRecovery():OwnerAlphaUnusedRecovery|undefined {
  const grant=this.config?.unused_recovery;if(!grant)return undefined;
  const consumed=this.read<OwnerAlphaUnusedDisposition>(`owner_alpha_unused_disposition:${grant.predecessor.epoch}`);
  requireThat(!consumed||JSON.stringify(consumed.grant)===JSON.stringify(grant),'INVALID_CONFIGURATION','Consumed unused recovery authorization is immutable.',503);
  return consumed?undefined:grant;
 }
 private configuredQuarantine():OwnerAlphaClaimedPreTurnQuarantine|undefined {
  const grant=this.config?.claimed_pre_turn_quarantine;if(!grant)return undefined;
  const consumed=this.read<OwnerAlphaClaimedPreTurnDisposition>(`owner_alpha_claimed_pre_turn_disposition:${grant.predecessor.epoch}`);
  requireThat(!consumed||JSON.stringify(consumed.grant)===JSON.stringify(grant),'INVALID_CONFIGURATION','Consumed claimed quarantine authorization is immutable.',503);
  return consumed?undefined:grant;
 }
 assignedManifest():OwnerAlphaManifest|undefined {
  this.configuredRecovery();
  this.configuredQuarantine();
  const generation=this.core.ownerAlpha.activeGeneration();
  // Warm generations carry their own versioned manifests; never reinterpret them
  // as the bootstrap's single-run assignment.
  return generation&&'kind' in generation.authority&&generation.authority.kind!=='owner-message-warm-generation'&&generation.authority.kind!=='owner-message-background-generation'?structuredClone(generation.authority.manifest):undefined;
 }
 summary():OwnerAlphaBootstrapSummary|undefined {
  const c=this.config;if(!c)return undefined;
  let available=false;
  // This projection serves the owner portal, not the delegated service route.
  // Keep the policy visible/read-only without advertising another actor's grant.
  if(!this.core.options.testCampaignGrant){
   try{this.admission();available=true;}catch{/* Corrupt or incomplete trusted evidence is unavailable, never repaired here. */}
  }
  return {policy_revision:c.policy_revision,persona_id:c.persona_id,expires_at:c.expires_at,max_task_seconds:c.max_task_seconds,message_admission_available:available};
 }
 private admission(){
  const c=this.config!,db=this.core.store.db,lifecycle=new LifecycleCore(this.core.store,this.core),state=lifecycle.get(),prior=this.core.ownerAlpha.policy,now=this.core.now();
  requireThat(prior&&state.epoch>=1&&state.boot_id&&state.phase==='RECOVERY_REQUIRED'&&state.provider_ref_json==='{}'&&state.provider_operation_id===null&&
   prior.expires_at<=now&&state.lease_until!==null&&state.lease_until<=now,'CAPABILITY_UNAVAILABLE','Predecessor is not expired and retired.');
  requireThat(!this.core.store.get<{archived:boolean}>(c.persona_id,'persona').body.archived,'CAPABILITY_UNAVAILABLE','This bot is archived.');
  const recovery=this.configuredRecovery(),quarantine=this.configuredQuarantine();let retirement:OwnerAlphaRetirement|undefined;
  if(quarantine){
   const generation=this.core.ownerAlpha.activeGeneration();
   requireThat(generation&&'kind' in generation.authority&&generation.authority.kind!=='owner-message-warm-generation'&&generation.authority.kind!=='owner-message-background-generation'&&quarantine.predecessor.epoch===state.epoch&&quarantine.predecessor.boot_id===state.boot_id&&
    quarantine.installation_id===c.installation_id&&quarantine.owner_binding_sha256===c.owner_binding_sha256&&quarantine.successor_policy_revision===c.policy_revision&&
    !this.read(`owner_alpha_bootstrap_policy:${c.policy_revision}`),'CAPABILITY_UNAVAILABLE','Quarantine requires its exact predecessor and one new policy revision.');
   assertClaimedPreTurnQuarantineCustody(this.core.store,quarantine,generation.authority.manifest,now);
   requireThat(!db.all("SELECT id FROM controller_operations WHERE status IN ('pending','submitted','unknown') LIMIT 1").length,'CAPABILITY_UNAVAILABLE','Controller activity blocks quarantine.');
  }else if(recovery){
   const generation=this.core.ownerAlpha.activeGeneration();
   requireThat(generation&&'kind' in generation.authority&&generation.authority.kind!=='owner-message-warm-generation'&&generation.authority.kind!=='owner-message-background-generation'&&recovery.predecessor.epoch===state.epoch&&recovery.predecessor.boot_id===state.boot_id&&
    recovery.installation_id===c.installation_id&&recovery.owner_binding_sha256===c.owner_binding_sha256&&recovery.successor_policy_revision===c.policy_revision&&
    !this.read(`owner_alpha_bootstrap_policy:${c.policy_revision}`),'CAPABILITY_UNAVAILABLE','Unused recovery requires its exact predecessor and one new policy revision.');
   assertUnusedRecoveryCustody(this.core.store,recovery,generation.authority.manifest,now);
   requireThat(!db.all("SELECT id FROM controller_operations WHERE status IN ('pending','submitted','unknown') LIMIT 1").length,'CAPABILITY_UNAVAILABLE','Controller activity blocks recovery.');
  }else{
   lifecycle.assertOwnerAlphaSettlement(true);
   retirement=this.read<OwnerAlphaRetirement>(`owner_alpha_retirement:${state.epoch}`)??c.seed_retirement;
   requireThat(!!retirement,'CAPABILITY_UNAVAILABLE','Trusted predecessor retirement is missing.');validateRetirement(retirement);
   requireThat(retirement.epoch===state.epoch&&retirement.boot_id===state.boot_id&&retirement.session_id===prior.session_id&&retirement.transition_id===(this.core.ownerAlpha.activeGeneration()?.transition_id??null)&&
    retirement.observed_at>=prior.expires_at&&retirement.observed_at<=now,'CAPABILITY_UNAVAILABLE','Trusted predecessor retirement is stale.');
  }
  const baseline={installation_id:c.installation_id,owner_binding_sha256:c.owner_binding_sha256,prior_cost_micro_usd:c.prior_cost_micro_usd,prior_cost_source:c.prior_cost_source,total_cap_micro_usd:c.total_cap_micro_usd};
  const {seed_retirement:_,unused_recovery:__,claimed_pre_turn_quarantine:___,...policy}=c,policyKey=`owner_alpha_bootstrap_policy:${c.policy_revision}`;
  const savedPolicy=this.read(policyKey),saved=this.read<typeof baseline>('owner_alpha_cost_baseline');
  requireThat(!savedPolicy||JSON.stringify(savedPolicy)===JSON.stringify(policy),'CAPABILITY_UNAVAILABLE','Automatic policy revision is immutable.');
  requireThat(!saved||JSON.stringify(saved)===JSON.stringify(baseline),'CAPABILITY_UNAVAILABLE','Cost baseline differs from the lifetime ledger.');
  const reservations=db.all<{value_json:string}>("SELECT value_json FROM runtime_metadata WHERE key GLOB 'owner_alpha_reservation:*'").map(r=>JSON.parse(r.value_json) as {micro_usd:number});
  requireThat((!!saved||reservations.length===0)&&reservations.every(r=>Number.isSafeInteger(r.micro_usd)&&r.micro_usd>0),'CAPABILITY_UNAVAILABLE','Cost ledger is inconsistent.');
  const used=reservations.reduce((sum,r)=>sum+r.micro_usd,c.prior_cost_micro_usd);
  requireThat(Number.isSafeInteger(used+c.reservation_micro_usd)&&used+c.reservation_micro_usd<=c.total_cap_micro_usd,'CAPABILITY_UNAVAILABLE','Lifetime allowance is exhausted.');
  const expires_at=new Date(Math.min(Date.parse(c.expires_at),Date.parse(now)+c.session_seconds*1000,recovery?Date.parse(recovery.expires_at):Infinity,quarantine?Date.parse(quarantine.expires_at):Infinity)).toISOString();
  requireThat(Date.parse(expires_at)-Date.parse(now)>=1000,'CAPABILITY_UNAVAILABLE','Less than one second remains in the fixed trial.');
  return {lifecycle,state,prior,now,retirement,recovery,quarantine,baseline,policy,policyKey,savedPolicy,saved,expires_at};
 }
 recordRetirement(report:OwnerAlphaRetirement):void {
  validateRetirement(report);
  this.core.store.db.transaction(()=>{
   const state=new LifecycleCore(this.core.store,this.core).get(),generation=this.core.ownerAlpha.activeGeneration();
   requireThat(report.epoch===state.epoch&&report.boot_id===state.boot_id&&report.session_id===this.core.ownerAlpha.policy?.session_id&&
    report.transition_id===(generation?.transition_id??null)&&report.direct_child_stopped===true&&report.execution_lock_free===true&&report.session_lock_free===true&&
    utc(report.observed_at)&&report.observed_at<=this.core.now()&&report.observed_at>=this.core.ownerAlpha.policy!.expires_at&&
    typeof report.source==='string'&&report.source.length>0,
    'INVALID_INPUT','Retirement must identify the expired current generation and trusted stop/lock observations.',422);
   const key=`owner_alpha_retirement:${report.epoch}`,saved=this.read<OwnerAlphaRetirement>(key);
   requireThat(!saved||JSON.stringify(saved)===JSON.stringify(report),'REVISION_CONFLICT','Retirement observation is immutable.');
   if(!saved)this.put(key,report);
  });
 }
 /** Only invoked within accept's transaction before its new command becomes applied. */
 assignNewMessage(owner:string,commandId:string,runId:string):void {
  const c=this.config;if(!c||owner!==c.owner_id||this.core.now()>=c.expires_at)return;
  const db=this.core.store.db,now=this.core.now();
  const run=db.all<Omit<Run,'context_json'|'checkpoint_json'>>('SELECT id,command_id,occurrence_id,persona_id,routine_id,status,current_attempt,error_code,created_at,updated_at,role,parent_run_id,title FROM runs WHERE id=?',runId)[0];
  if(!run)throw new ControlError('NOT_FOUND','Run unavailable.',404);
  if(run.persona_id!==c.persona_id||run.current_attempt!==0||run.command_id!==commandId||run.role!=='coordinator'||run.parent_run_id||run.routine_id||run.occurrence_id||!this.core.store.runHasFalsyRoom(runId))return;
  if(this.core.budget.blocks(run))return;
  const command=db.all<{body_hash:string;type:string;status:string;accepted_at:string;owner_id:string}>('SELECT * FROM commands WHERE id=?',commandId)[0];
  const event=db.all<{sequence:number}>("SELECT sequence FROM events WHERE id=? AND type='message.user' AND actor_id=? AND conversation_id=?",commandId,owner,c.persona_id)[0];
  if(!command||command.type!=='message.send'||command.status!=='accepted'||command.accepted_at>now||command.owner_id!==owner||!/^[0-9a-f]{64}$/.test(command.body_hash)||!event||!this.core.ownerAlpha.directMessage(c.persona_id,commandId,null,null,null,0,c.persona_id))return;
  // A savepoint makes a blocked assignment leave the independently accepted message waiting.
  try{db.transaction(()=>{
   const {lifecycle,state,prior,now,retirement,recovery,quarantine,baseline,policy,policyKey,savedPolicy,saved,expires_at}=this.admission();
   if(retirement&&!this.read(`owner_alpha_retirement:${state.epoch}`))this.recordRetirement(retirement);
   const epoch=state.epoch+1,boot_id=this.core.options.uuid(),transition_id=this.core.options.uuid(),session_id=this.core.options.uuid();
   const unsigned={installation_id:c.installation_id,owner_binding_sha256:c.owner_binding_sha256,run_id:runId,persona_id:c.persona_id,command_id:commandId,command_sha256:command.body_hash,
    event_sequence:event.sequence,policy_revision:c.policy_revision,epoch,boot_id,transition_id,session_id,text_only:c.text_only,issued_at:now,expires_at,reservation_micro_usd:c.reservation_micro_usd};
   const manifest:OwnerAlphaManifest={...unsigned,manifest_sha256:ownerAlphaManifestSha256(unsigned)};
   if(quarantine){
    const disposition:OwnerAlphaClaimedPreTurnDisposition={grant:quarantine,successor_manifest_sha256:manifest.manifest_sha256,successor_epoch:epoch,successor_run_id:runId};
    lifecycle.assignClaimedPreTurnOwnerMessage({kind:'owner-message-claimed-pre-turn-quarantine',manifest,disposition_sha256:digest(disposition)},owner,commandId);
    this.put(`owner_alpha_claimed_pre_turn_disposition:${state.epoch}`,disposition);
   }else if(recovery){
    const disposition:OwnerAlphaUnusedDisposition={grant:recovery,successor_manifest_sha256:manifest.manifest_sha256,successor_epoch:epoch,successor_run_id:runId};
    lifecycle.assignUnusedOwnerMessage({kind:'owner-message-unused-recovery',manifest,disposition_sha256:digest(disposition)},owner,commandId);
    this.put(`owner_alpha_unused_disposition:${state.epoch}`,disposition);
   }else{
    const envelope:OwnerAlphaSuccessor={schema_version:1,transition_id,owner_binding_sha256:c.owner_binding_sha256,predecessor:{session_id:prior.session_id,epoch:state.epoch,boot_id:state.boot_id!},retirement_receipt_sha256:digest(retirement),
     successor:{boot_id,policy:{session_id,persona_id:c.persona_id,expires_at,max_runs:1,max_task_seconds:c.max_task_seconds,text_only:c.text_only}}};
    lifecycle.assignOwnerMessage({...envelope,kind:'owner-message',manifest},owner,commandId);
   }
   if(!savedPolicy)this.put(policyKey,policy);
   if(!saved)this.put('owner_alpha_cost_baseline',baseline);
   this.put(`owner_alpha_reservation:${epoch}`,{manifest_sha256:manifest.manifest_sha256,micro_usd:c.reservation_micro_usd});
   db.exec("UPDATE runs SET status='queued',error_code=NULL WHERE id=?",runId);
   db.exec("UPDATE events SET payload_json=json_set(payload_json,'$.status','queued','$.reason',NULL) WHERE type='run.accepted' AND cause_id=? AND json_extract(payload_json,'$.run_id')=?",commandId,runId);
   db.exec('UPDATE lifecycle SET queue_sequence=queue_sequence+1 WHERE singleton=1');
  });}catch(error){if(!(error instanceof ControlError))throw error;}
 }
}
