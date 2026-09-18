import {createHash} from 'node:crypto';
import {ControlError,requireThat} from './errors';
import type {ControlCore} from './control';
import {LifecycleCore} from './lifecycle';
import type {OwnerAlphaSuccessor,TextOnlyProfile} from './owner-alpha';

export type OwnerAlphaRetirement={epoch:number;boot_id:string;session_id:string;transition_id:string|null;
 observed_at:string;direct_child_stopped:true;execution_lock_free:true;session_lock_free:true;source:string};
export type OwnerAlphaBootstrapConfig={installation_id:string;owner_id:string;owner_binding_sha256:string;
 policy_revision:string;persona_id:string;text_only:TextOnlyProfile;expires_at:string;session_seconds:number;max_task_seconds:number;
 prior_cost_micro_usd:number;prior_cost_source:string;total_cap_micro_usd:number;reservation_micro_usd:number;
 seed_retirement?:OwnerAlphaRetirement};
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
export function parseOwnerAlphaBootstrap(value:string|undefined):OwnerAlphaBootstrapConfig|undefined {
 if(value===undefined||value==='')return undefined;
 let c:OwnerAlphaBootstrapConfig;
 try{c=JSON.parse(value);}catch{requireThat(false,'INVALID_CONFIGURATION','Invalid automatic owner-alpha JSON.',503);}
 const keys=['installation_id','owner_id','owner_binding_sha256','policy_revision','persona_id','text_only','expires_at','session_seconds','max_task_seconds','prior_cost_micro_usd','prior_cost_source','total_cap_micro_usd','reservation_micro_usd',...(Object.hasOwn(c??{},'seed_retirement')?['seed_retirement']:[])];
 requireThat(c&&typeof c==='object'&&!Array.isArray(c)&&Object.keys(c).sort().join(',')===keys.sort().join(',')&&
  [c.installation_id,c.owner_id,c.policy_revision,c.prior_cost_source].every(v=>typeof v==='string'&&v.length>0&&v.length<=256)&&!/^(runtime|trigger):/.test(c.owner_id)&&
  typeof c.owner_binding_sha256==='string'&&/^[0-9a-f]{64}$/.test(c.owner_binding_sha256)&&typeof c.persona_id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c.persona_id)&&
  c.text_only&&Object.keys(c.text_only).sort().join(',')==='profile_sha256,profile_version'&&c.text_only.profile_version==='codex-text-only-v1'&&/^[0-9a-f]{64}$/.test(c.text_only.profile_sha256)&&typeof c.expires_at==='string'&&utc(c.expires_at)&&
  [c.session_seconds,c.max_task_seconds].every(n=>Number.isSafeInteger(n)&&n>=1&&n<=300)&&
  [c.prior_cost_micro_usd,c.total_cap_micro_usd,c.reservation_micro_usd].every(n=>Number.isSafeInteger(n)&&n>=0)&&c.reservation_micro_usd>0,
  'INVALID_CONFIGURATION','Invalid automatic owner-alpha configuration.',503);
 if(Object.hasOwn(c,'seed_retirement'))validateRetirement(c.seed_retirement!);
 return {installation_id:c.installation_id,owner_id:c.owner_id,owner_binding_sha256:c.owner_binding_sha256,policy_revision:c.policy_revision,persona_id:c.persona_id,
  text_only:{profile_version:c.text_only.profile_version,profile_sha256:c.text_only.profile_sha256},expires_at:c.expires_at,session_seconds:c.session_seconds,max_task_seconds:c.max_task_seconds,
  prior_cost_micro_usd:c.prior_cost_micro_usd,prior_cost_source:c.prior_cost_source,total_cap_micro_usd:c.total_cap_micro_usd,reservation_micro_usd:c.reservation_micro_usd,...(c.seed_retirement?{seed_retirement:c.seed_retirement}:{})};
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
  const c=this.config;if(!c)return;
  requireThat(!core.options.executionEnabled&&!!core.options.ownerAlpha,
   'INVALID_CONFIGURATION','Invalid automatic owner-alpha configuration.',503);
 }
 private read<T>(key:string):T|undefined {const row=this.core.store.db.all<{value_json:string}>('SELECT value_json FROM runtime_metadata WHERE key=?',key)[0];return row?JSON.parse(row.value_json) as T:undefined;}
 private put(key:string,value:unknown){this.core.store.db.exec('INSERT INTO runtime_metadata(key,value_json) VALUES(?,?)',key,JSON.stringify(value));}
 assignedManifest():OwnerAlphaManifest|undefined {
  const generation=this.core.ownerAlpha.activeGeneration();
  return generation&&'kind' in generation.authority?structuredClone(generation.authority.manifest):undefined;
 }
 summary():OwnerAlphaBootstrapSummary|undefined {
  const c=this.config;if(!c)return undefined;
  let available=false;
  try{this.admission();available=true;}catch{/* Corrupt or incomplete trusted evidence is unavailable, never repaired here. */}
  return {policy_revision:c.policy_revision,persona_id:c.persona_id,expires_at:c.expires_at,max_task_seconds:c.max_task_seconds,message_admission_available:available};
 }
 private admission(){
  const c=this.config!,db=this.core.store.db,lifecycle=new LifecycleCore(this.core.store,this.core),state=lifecycle.get(),prior=this.core.ownerAlpha.policy,now=this.core.now();
  requireThat(prior&&state.epoch>=1&&state.boot_id&&state.phase==='RECOVERY_REQUIRED'&&state.provider_ref_json==='{}'&&state.provider_operation_id===null&&
   prior.expires_at<=now&&state.lease_until!==null&&state.lease_until<=now,'CAPABILITY_UNAVAILABLE','Predecessor is not expired and retired.');
  requireThat(!this.core.store.get<{archived:boolean}>(c.persona_id,'persona').body.archived,'CAPABILITY_UNAVAILABLE','This bot is archived.');
  lifecycle.assertOwnerAlphaSettlement(true);
  const retirement=this.read<OwnerAlphaRetirement>(`owner_alpha_retirement:${state.epoch}`)??c.seed_retirement;
  requireThat(!!retirement,'CAPABILITY_UNAVAILABLE','Trusted predecessor retirement is missing.');validateRetirement(retirement);
  requireThat(retirement.epoch===state.epoch&&retirement.boot_id===state.boot_id&&retirement.session_id===prior.session_id&&retirement.transition_id===(this.core.ownerAlpha.activeGeneration()?.transition_id??null)&&
   retirement.observed_at>=prior.expires_at&&retirement.observed_at<=now,'CAPABILITY_UNAVAILABLE','Trusted predecessor retirement is stale.');
  const baseline={installation_id:c.installation_id,owner_binding_sha256:c.owner_binding_sha256,prior_cost_micro_usd:c.prior_cost_micro_usd,prior_cost_source:c.prior_cost_source,total_cap_micro_usd:c.total_cap_micro_usd};
  const {seed_retirement:_,...policy}=c,policyKey=`owner_alpha_bootstrap_policy:${c.policy_revision}`;
  const savedPolicy=this.read(policyKey),saved=this.read<typeof baseline>('owner_alpha_cost_baseline');
  requireThat(!savedPolicy||JSON.stringify(savedPolicy)===JSON.stringify(policy),'CAPABILITY_UNAVAILABLE','Automatic policy revision is immutable.');
  requireThat(!saved||JSON.stringify(saved)===JSON.stringify(baseline),'CAPABILITY_UNAVAILABLE','Cost baseline differs from the lifetime ledger.');
  const reservations=db.all<{value_json:string}>("SELECT value_json FROM runtime_metadata WHERE key GLOB 'owner_alpha_reservation:*'").map(r=>JSON.parse(r.value_json) as {micro_usd:number});
  requireThat((!!saved||reservations.length===0)&&reservations.every(r=>Number.isSafeInteger(r.micro_usd)&&r.micro_usd>0),'CAPABILITY_UNAVAILABLE','Cost ledger is inconsistent.');
  const used=reservations.reduce((sum,r)=>sum+r.micro_usd,c.prior_cost_micro_usd);
  requireThat(Number.isSafeInteger(used+c.reservation_micro_usd)&&used+c.reservation_micro_usd<=c.total_cap_micro_usd,'CAPABILITY_UNAVAILABLE','Lifetime allowance is exhausted.');
  const expires_at=new Date(Math.min(Date.parse(c.expires_at),Date.parse(now)+c.session_seconds*1000)).toISOString();
  requireThat(Date.parse(expires_at)-Date.parse(now)>=1000,'CAPABILITY_UNAVAILABLE','Less than one second remains in the fixed trial.');
  return {lifecycle,state,prior,now,retirement,baseline,policy,policyKey,savedPolicy,saved,expires_at};
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
  const db=this.core.store.db,run=this.core.store.run(runId),now=this.core.now();
  if(run.persona_id!==c.persona_id||run.current_attempt!==0||run.command_id!==commandId||run.role!=='coordinator'||run.parent_run_id||run.routine_id||run.occurrence_id||JSON.parse(run.context_json).room_id)return;
  if(this.core.budget.blocks(run))return;
  const command=db.all<{body_hash:string;type:string;status:string;accepted_at:string;owner_id:string}>('SELECT * FROM commands WHERE id=?',commandId)[0];
  const event=db.all<{sequence:number}>("SELECT sequence FROM events WHERE id=? AND type='message.user' AND actor_id=? AND conversation_id=?",commandId,owner,c.persona_id)[0];
  if(!command||command.type!=='message.send'||command.status!=='accepted'||command.accepted_at>now||command.owner_id!==owner||!/^[0-9a-f]{64}$/.test(command.body_hash)||!event||!this.core.ownerAlpha.directMessage(c.persona_id,commandId,null,null,null,0,c.persona_id))return;
  // A savepoint makes a blocked assignment leave the independently accepted message waiting.
  try{db.transaction(()=>{
   const {lifecycle,state,prior,now,retirement,baseline,policy,policyKey,savedPolicy,saved,expires_at}=this.admission();
   if(!this.read(`owner_alpha_retirement:${state.epoch}`))this.recordRetirement(retirement);
   const epoch=state.epoch+1,boot_id=this.core.options.uuid(),transition_id=this.core.options.uuid(),session_id=this.core.options.uuid();
   const unsigned={installation_id:c.installation_id,owner_binding_sha256:c.owner_binding_sha256,run_id:runId,persona_id:c.persona_id,command_id:commandId,command_sha256:command.body_hash,
    event_sequence:event.sequence,policy_revision:c.policy_revision,epoch,boot_id,transition_id,session_id,text_only:c.text_only,issued_at:now,expires_at,reservation_micro_usd:c.reservation_micro_usd};
   const manifest:OwnerAlphaManifest={...unsigned,manifest_sha256:ownerAlphaManifestSha256(unsigned)};
   const envelope:OwnerAlphaSuccessor={schema_version:1,transition_id,owner_binding_sha256:c.owner_binding_sha256,predecessor:{session_id:prior.session_id,epoch:state.epoch,boot_id:state.boot_id!},retirement_receipt_sha256:digest(retirement),
    successor:{boot_id,policy:{session_id,persona_id:c.persona_id,expires_at,max_runs:1,max_task_seconds:c.max_task_seconds,text_only:c.text_only}}};
   lifecycle.assignOwnerMessage({...envelope,kind:'owner-message',manifest},owner,commandId);
   if(!savedPolicy)this.put(policyKey,policy);
   if(!saved)this.put('owner_alpha_cost_baseline',baseline);
   this.put(`owner_alpha_reservation:${epoch}`,{manifest_sha256:manifest.manifest_sha256,micro_usd:c.reservation_micro_usd});
   db.exec("UPDATE runs SET status='queued',error_code=NULL WHERE id=?",runId);
   db.exec("UPDATE events SET payload_json=json_set(payload_json,'$.status','queued','$.reason',NULL) WHERE type='run.accepted' AND cause_id=? AND json_extract(payload_json,'$.run_id')=?",commandId,runId);
   db.exec('UPDATE lifecycle SET queue_sequence=queue_sequence+1 WHERE singleton=1');
  });}catch(error){if(!(error instanceof ControlError))throw error;}
 }
}
