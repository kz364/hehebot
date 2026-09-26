import { ControlError, HostedWakeDeliveryError, requireThat } from './errors';
import { Store } from './store';
import {prepareMemory,validateMemoryBudget,type MemoryBudgetReceipt} from './memory-context';
import type { ControlCore } from './control';
import { nativeDescendantsSettledSql } from './native-tasks';
import type { ContextSnapshot, Operation, Run } from './types';
import type { RuntimeProvider, RuntimeRef, RuntimeObservation } from '../providers';
import {createHash} from 'node:crypto';
import type {TextOnlyReceipt,BackgroundReceipt} from './runtime-types';
import {ownerAlphaSuccessorSha256,parseOwnerAlphaSuccessor,type OwnerAlphaGeneration,type OwnerAlphaSuccessor} from './owner-alpha';
import {assertUnusedRecoveryCustody,assertClaimedPreTurnQuarantineCustody,type ClaimedPreTurnMessageBoundAuthority,type MessageBoundAuthority,type UnusedMessageBoundAuthority} from './owner-alpha-bootstrap';
import type {Command} from './types';
const hex64=/^[0-9a-f]{64}$/;
export type Phase='STOPPED'|'START_REQUESTED'|'BOOTING'|'READY'|'DRAINING'|'STOP_COMMITTED'|'STOPPING'|'RECOVERY_REQUIRED'|'IDLE_PERMITTED';
export type Lifecycle={singleton:number;provider_ref_json:string;boot_id:string|null;epoch:number;phase:Phase;desired_state:'RUN'|'STOP';lease_until:string|null;last_heartbeat:string|null;queue_sequence:number;stop_token:string|null;provider_operation_id:string|null;wake_after_stop:number};
export type Identity={epoch:number;boot_id:string};
export type CoordinatorOutcome='completed'|'failed'|'interrupted';
export type HeartbeatOperation=Operation & {run_id:string;attempt:number};
// NULL context marks a refused historical read, never a partial execution context.
type PendingRun=Run|(Omit<Run,'context_json'>&{context_json:null});
function operationTime(value:string):string {
 const instant=Date.parse(value);
 requireThat(Number.isFinite(instant),'INVALID_INPUT','Invalid operation timestamp.',422);
 const canonical=new Date(instant).toISOString();
 requireThat(canonical.length===24,'INVALID_INPUT','Operation timestamp is outside the supported UTC range.',422);
 return canonical;
}
export class LifecycleCore {
 constructor(public store:Store,public core:ControlCore,private options:{idleMode?:boolean}={}){}
 get():Lifecycle{return this.store.db.all<Lifecycle>('SELECT * FROM lifecycle WHERE singleton=1')[0];}
 initialize(ref:RuntimeRef|Record<string,never>):void{this.store.db.exec("INSERT OR IGNORE INTO lifecycle(singleton,provider_ref_json,epoch,phase,desired_state,queue_sequence,wake_after_stop) VALUES(1,?,0,'STOPPED','STOP',0,0)",JSON.stringify(ref));this.core.ownerAlpha.initialize();}
 activateOwnerAlphaSuccessor(command:Extract<Command,{type:'owner-alpha.activate'}>,ownerId:string,ownerCommandId:string):{owner_alpha_generation:{epoch:number;boot_id:string;transition_id:string}} {
  return this.activateGeneration(command,ownerId,ownerCommandId);
 }
 /** Internal issuance path; the bootstrap owns message admission and cost reservation. */
 assignOwnerMessage(authority:MessageBoundAuthority,ownerId:string,ownerCommandId:string):void {
  const {kind:_,manifest:__,...envelope}=authority;
  this.activateGeneration({schema_version:1,type:'owner-alpha.activate',payload:{transition_id:envelope.transition_id,envelope_sha256:ownerAlphaSuccessorSha256(envelope)}},ownerId,ownerCommandId,authority);
 }
 /** Separate owner-configured unused disposition; never a native retirement claim. */
 assignUnusedOwnerMessage(authority:UnusedMessageBoundAuthority,ownerId:string,commandId:string):void {
  const c=this.core.bootstrap.config!,grant=c.unused_recovery,prior=this.core.ownerAlpha.activeGeneration(),state=this.get(),now=this.core.now(),m=authority.manifest;
  requireThat(grant&&prior&&'kind' in prior.authority&&prior.authority.kind!=='owner-message-warm-generation'&&prior.authority.kind!=='owner-message-background-generation'&&state.phase==='RECOVERY_REQUIRED'&&state.epoch===grant.predecessor.epoch&&state.boot_id===grant.predecessor.boot_id&&
   state.provider_ref_json==='{}'&&state.provider_operation_id===null&&state.lease_until!==null&&state.lease_until<=now&&prior.policy.expires_at<=now&&
   m.epoch===state.epoch+1&&m.command_id===commandId&&m.policy_revision===grant.successor_policy_revision&&m.policy_revision===c.policy_revision&&m.expires_at<=grant.expires_at&&m.expires_at<=c.expires_at&&ownerId===c.owner_id&&
   !this.store.db.all('SELECT key FROM runtime_metadata WHERE key=?',`owner_alpha_unused_disposition:${state.epoch}`).length,
   'CAPABILITY_UNAVAILABLE','Unused recovery requires its unconsumed owner-configured authority.');
  assertUnusedRecoveryCustody(this.store,grant,prior.authority.manifest,now);
  const command=this.store.db.all<{body_hash:string}>("SELECT body_hash FROM commands WHERE id=? AND owner_id=? AND status='accepted' AND type='message.send'",commandId,ownerId)[0];
  requireThat(command&&command.body_hash===m.command_sha256,'FORBIDDEN','Unused successor requires its new owner message.',403);
  const policy={session_id:m.session_id,persona_id:m.persona_id,expires_at:m.expires_at,max_runs:1,max_task_seconds:c.max_task_seconds,text_only:c.text_only};
  this.assertFreshOwnerAlphaGeneration({transition_id:m.transition_id,successor:{boot_id:m.boot_id,policy}},commandId);
  const generation:OwnerAlphaGeneration={epoch:m.epoch,boot_id:m.boot_id,transition_id:m.transition_id,policy,authority,
   predecessor:{epoch:state.epoch,boot_id:state.boot_id!,session_id:prior.policy.session_id,phase:state.phase,lease_until:state.lease_until},
   activation_command_id:commandId,activation_command_sha256:command.body_hash,activation_event_sequence:m.event_sequence};
  this.store.db.exec('INSERT INTO runtime_metadata(key,value_json) VALUES(?,?)',`owner_alpha_generation:${m.epoch}`,JSON.stringify(generation));
  const lease=new Date(Math.min(Date.parse(m.expires_at),Date.parse(now)+90000)).toISOString();
  this.store.db.exec("UPDATE lifecycle SET epoch=?,boot_id=?,phase='BOOTING',desired_state='RUN',lease_until=?,last_heartbeat=NULL,stop_token=NULL,wake_after_stop=0 WHERE singleton=1",m.epoch,m.boot_id,lease);
 }
 /** Quarantine retains the predecessor's startup uncertainty; this never settles it. */
 assignClaimedPreTurnOwnerMessage(authority:ClaimedPreTurnMessageBoundAuthority,ownerId:string,commandId:string):void {
  const c=this.core.bootstrap.config!,grant=c.claimed_pre_turn_quarantine,prior=this.core.ownerAlpha.activeGeneration(),state=this.get(),now=this.core.now(),m=authority.manifest;
  requireThat(grant&&prior&&'kind' in prior.authority&&prior.authority.kind!=='owner-message-warm-generation'&&prior.authority.kind!=='owner-message-background-generation'&&state.phase==='RECOVERY_REQUIRED'&&state.epoch===grant.predecessor.epoch&&state.boot_id===grant.predecessor.boot_id&&
   state.provider_ref_json==='{}'&&state.provider_operation_id===null&&state.lease_until!==null&&state.lease_until<=now&&prior.policy.expires_at<=now&&
   m.epoch===state.epoch+1&&m.command_id===commandId&&m.policy_revision===grant.successor_policy_revision&&m.policy_revision===c.policy_revision&&m.expires_at<=grant.expires_at&&m.expires_at<=c.expires_at&&ownerId===c.owner_id&&
   !this.store.db.all('SELECT key FROM runtime_metadata WHERE key=?',`owner_alpha_claimed_pre_turn_disposition:${state.epoch}`).length,
   'CAPABILITY_UNAVAILABLE','Claimed quarantine requires its unconsumed owner-configured authority.');
  assertClaimedPreTurnQuarantineCustody(this.store,grant,prior.authority.manifest,now);
  const command=this.store.db.all<{body_hash:string}>("SELECT body_hash FROM commands WHERE id=? AND owner_id=? AND status='accepted' AND type='message.send'",commandId,ownerId)[0];
  requireThat(command&&command.body_hash===m.command_sha256,'FORBIDDEN','Quarantine successor requires its new owner message.',403);
  const policy={session_id:m.session_id,persona_id:m.persona_id,expires_at:m.expires_at,max_runs:1,max_task_seconds:c.max_task_seconds,text_only:c.text_only};
  this.assertFreshOwnerAlphaGeneration({transition_id:m.transition_id,successor:{boot_id:m.boot_id,policy}},commandId);
  const generation:OwnerAlphaGeneration={epoch:m.epoch,boot_id:m.boot_id,transition_id:m.transition_id,policy,authority,
   predecessor:{epoch:state.epoch,boot_id:state.boot_id!,session_id:prior.policy.session_id,phase:state.phase,lease_until:state.lease_until},
   activation_command_id:commandId,activation_command_sha256:command.body_hash,activation_event_sequence:m.event_sequence};
  this.store.db.exec('INSERT INTO runtime_metadata(key,value_json) VALUES(?,?)',`owner_alpha_generation:${m.epoch}`,JSON.stringify(generation));
  const lease=new Date(Math.min(Date.parse(m.expires_at),Date.parse(now)+90000)).toISOString();
  this.store.db.exec("UPDATE lifecycle SET epoch=?,boot_id=?,phase='BOOTING',desired_state='RUN',lease_until=?,last_heartbeat=NULL,stop_token=NULL,wake_after_stop=0 WHERE singleton=1",m.epoch,m.boot_id,lease);
 }
 private assertFreshOwnerAlphaGeneration(envelope:Pick<OwnerAlphaSuccessor,'transition_id'|'successor'>,ownerCommandId:string):void {
  const state=this.get(),now=this.core.now(),freshIds=[envelope.transition_id,envelope.successor.boot_id,envelope.successor.policy.session_id].map(value=>value.toLowerCase());
  requireThat(new Set(freshIds).size===3&&envelope.successor.policy.expires_at>now&&Date.parse(envelope.successor.policy.expires_at)<=Date.parse(now)+300000&&
   !this.store.db.all('SELECT key FROM runtime_metadata WHERE key=?',`owner_alpha_generation:${state.epoch+1}`).length&&
   !this.store.db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_generation:*' AND (lower(json_extract(value_json,'$.transition_id')) IN (?,?,?) OR lower(json_extract(value_json,'$.boot_id')) IN (?,?,?) OR lower(json_extract(value_json,'$.policy.session_id')) IN (?,?,?) OR lower(json_extract(value_json,'$.predecessor.boot_id')) IN (?,?,?) OR lower(json_extract(value_json,'$.predecessor.session_id')) IN (?,?,?)) LIMIT 1",
    ...Array(5).fill(freshIds).flat()).length&&
   !this.store.db.all('SELECT run_id FROM attempts WHERE boot_id=? LIMIT 1',envelope.successor.boot_id).length&&
   !this.store.db.all('SELECT id FROM commands WHERE id=? AND id<>?',envelope.transition_id,ownerCommandId).length,'INVALID_CONFIGURATION','Successor identities or expiry are not fresh.',503);
 }
 /** Read-only settlement checks shared by issuance and bootstrap availability. */
 assertOwnerAlphaSettlement(automatic=false):void {
  const priorGeneration=this.core.ownerAlpha.activeGeneration();
  if(priorGeneration){
   // A background generation is terminal: nothing may ever follow it, so a
   // predecessor here is always a legacy or warm generation with a text-only profile.
   const priorTextOnly=priorGeneration.policy.text_only;
   requireThat(!!priorTextOnly,'CAPABILITY_UNAVAILABLE','A background generation has no successor.');
   const attempts=this.store.db.all<{status:string;attempt_status:string;result_json:string|null;proof:string|null;native_run_ref:string|null;coordinator_release_json:string|null}>(
    `SELECT r.status,a.status AS attempt_status,a.result_json,m.value_json AS proof,a.native_run_ref,a.coordinator_release_json FROM attempts a JOIN runs r ON r.id=a.run_id
     LEFT JOIN runtime_metadata m ON m.key='text_only_receipt:'||a.run_id||':'||a.attempt WHERE a.epoch=? AND a.boot_id=?`,priorGeneration.epoch,priorGeneration.boot_id);
   requireThat(!automatic||attempts.length>0,'CAPABILITY_UNAVAILABLE','Automatic rollover requires observed completion, not an unclaimed or uncertain launch.');
   requireThat(attempts.every(a=>{
    if(a.status!=='completed'||a.attempt_status!=='completed'||!a.result_json||!a.proof)return false;
    const result=JSON.parse(a.result_json),proof=JSON.parse(a.proof);
    return result.status==='completed'&&typeof result.text==='string'&&proof.profile_version===priorTextOnly!.profile_version&&
     proof.profile_sha256===priorTextOnly!.profile_sha256&&proof.turn_id===a.native_run_ref&&
     proof.output_sha256===createHash('sha256').update(result.text).digest('hex')&&
     a.coordinator_release_json===JSON.stringify({native_ref:a.native_run_ref,outcome:'completed'});
   }),'CAPABILITY_UNAVAILABLE','Owner-alpha predecessor has not completed through matching stored text-only receipts.');
   requireThat(!this.store.db.all(`SELECT a.run_id FROM attempts a WHERE a.epoch=? AND a.boot_id=? AND (
    EXISTS(SELECT 1 FROM operations o WHERE o.run_id=a.run_id AND o.attempt=a.attempt AND o.status<>'settled') OR
    EXISTS(SELECT 1 FROM effects e WHERE e.run_id=a.run_id AND e.status IN ('intent','dispatched','outcome_unknown')) OR
    EXISTS(SELECT 1 FROM resource_locks l WHERE l.run_id=a.run_id)) LIMIT 1`,priorGeneration.epoch,priorGeneration.boot_id).length&&
    !this.core.questions.list().some(question=>this.store.db.all('SELECT run_id FROM attempts WHERE run_id=? AND epoch=? AND boot_id=? LIMIT 1',question.run_id,priorGeneration.epoch,priorGeneration.boot_id).length),
    'RESOURCE_BUSY','Owner-alpha predecessor still has unsettled activity.');
   requireThat(!this.store.db.all('SELECT id FROM controller_operations WHERE epoch=? LIMIT 1',priorGeneration.epoch).length,
    'RESOURCE_BUSY','Owner-alpha predecessor has controller activity.');
  }
  requireThat(!this.store.db.all('SELECT id FROM controller_operations WHERE status IN (\'pending\',\'submitted\',\'unknown\') LIMIT 1').length,'RESOURCE_BUSY','A controller operation is still pending.');
 }
 private activateGeneration(command:Extract<Command,{type:'owner-alpha.activate'}>,ownerId:string,ownerCommandId:string,message?:MessageBoundAuthority):{owner_alpha_generation:{epoch:number;boot_id:string;transition_id:string}} {
  return this.store.db.transaction(()=>{
   const {kind:_,manifest:__,...messageEnvelope}=message??{};
   const envelope=parseOwnerAlphaSuccessor(JSON.stringify(message?messageEnvelope:this.core.options.ownerAlphaSuccessor))!;
   requireThat(!!envelope&&command.payload.transition_id===envelope.transition_id&&command.payload.envelope_sha256===ownerAlphaSuccessorSha256(envelope)&&(message?this.core.bootstrap.config?.owner_binding_sha256:this.core.options.ownerBindingSha256)===envelope.owner_binding_sha256,
    'FORBIDDEN','Owner-alpha activation does not match the configured grant and owner binding.',403);
   this.core.ownerAlpha.initialize();
   const priorGeneration=this.core.ownerAlpha.activeGeneration();
   requireThat(!this.core.options.executionEnabled&&envelope.predecessor.epoch===(priorGeneration?.epoch??1),'CAPABILITY_UNAVAILABLE','Owner-alpha successor must name the current generation.');
   const now=this.core.now(),state=this.get(),stored=this.store.db.all<{owner_id:string;type:string;payload_json:string;body_hash:string;status:string}>('SELECT owner_id,type,payload_json,body_hash,status FROM commands WHERE id=?',ownerCommandId)[0];
   const storedPayload=stored&&JSON.parse(stored.payload_json) as Record<string,unknown>;
   requireThat(!!stored&&stored.owner_id===ownerId&&!/^(runtime|trigger):/.test(ownerId)&&(message?
    stored.type==='message.send'&&stored.status==='accepted'&&message.manifest.command_id===ownerCommandId&&message.manifest.command_sha256===stored.body_hash:
    stored.type==='owner-alpha.activate'&&stored.status==='accepted'&&
    Object.keys(storedPayload).sort().join(',')==='envelope_sha256,transition_id'&&storedPayload.transition_id===command.payload.transition_id&&storedPayload.envelope_sha256===command.payload.envelope_sha256),
    'FORBIDDEN','Owner-alpha activation command does not match the trusted envelope.',403);
   requireThat(state.phase==='RECOVERY_REQUIRED'&&state.epoch===envelope.predecessor.epoch&&state.boot_id===envelope.predecessor.boot_id&&state.provider_ref_json==='{}'&&state.provider_operation_id===null,
    'STALE_EPOCH','Owner-alpha predecessor lifecycle does not match the retired generation.');
   requireThat(this.core.ownerAlpha.policy?.session_id===envelope.predecessor.session_id&&this.core.ownerAlpha.policy.expires_at<=now&&state.lease_until!==null&&state.lease_until<=now,
    'CAPABILITY_UNAVAILABLE','Owner-alpha predecessor policy and lease must be expired.');
   this.assertOwnerAlphaSettlement(!!message);
   this.assertFreshOwnerAlphaGeneration(envelope,ownerCommandId);
   const persona=this.store.get<{archived:boolean}>(envelope.successor.policy.persona_id,'persona');requireThat(!persona.body.archived,'CAPABILITY_UNAVAILABLE','This bot is archived.');
   const epoch=state.epoch+1,lease=new Date(Math.min(Date.parse(envelope.successor.policy.expires_at),Date.parse(now)+90000)).toISOString();
   const cutoff=message?.manifest.event_sequence??this.store.event(ownerCommandId,null,'owner-alpha.activated',ownerId,ownerCommandId,{epoch},now);
   const generation:OwnerAlphaGeneration={epoch,boot_id:envelope.successor.boot_id,transition_id:envelope.transition_id,policy:envelope.successor.policy,
    predecessor:{epoch:state.epoch,boot_id:state.boot_id!,session_id:envelope.predecessor.session_id,phase:state.phase,lease_until:state.lease_until},authority:message??envelope,
    activation_command_id:ownerCommandId,activation_command_sha256:stored.body_hash,activation_event_sequence:cutoff};
   this.store.db.exec('INSERT INTO runtime_metadata(key,value_json) VALUES(?,?)',`owner_alpha_generation:${epoch}`,JSON.stringify(generation));
   this.store.db.exec("UPDATE lifecycle SET epoch=?,boot_id=?,phase='BOOTING',desired_state='RUN',lease_until=?,last_heartbeat=NULL,stop_token=NULL,wake_after_stop=0 WHERE singleton=1",epoch,envelope.successor.boot_id,lease);
   return {owner_alpha_generation:{epoch,boot_id:envelope.successor.boot_id,transition_id:envelope.transition_id}};
  });
 }
 async deliverOwnerAlphaWake(transitionId:string,send:(command:{epoch:number;operationId:string})=>Promise<void>):Promise<void> {
  const intent=this.store.db.transaction(()=>{
   const generation=this.core.ownerAlpha.activeGeneration();
   const state=this.get(),now=this.core.now();
   if(!generation||generation.transition_id!==transitionId||this.core.options.executionEnabled||state.phase!=='BOOTING'||
    state.epoch!==generation.epoch||state.boot_id!==generation.boot_id||state.provider_ref_json!=='{}'||state.provider_operation_id!==null||
    generation.policy.expires_at<=now||state.lease_until===null||state.lease_until<=now)return undefined;
   const key=`owner_alpha_wake:${generation.epoch}`;
   if(this.store.db.all('SELECT key FROM runtime_metadata WHERE key=?',key).length)return undefined;
   // Staging, portal reads and watchdog alarms do not authorize compute. Only
   // already-persisted work that passes the existing admission gates may wake.
   if(!this.nextClaimableRun())return undefined;
   const value={epoch:generation.epoch,boot_id:generation.boot_id,transition_id:generation.transition_id,status:'unknown' as const};
   const valueJson=JSON.stringify(value);
   this.store.db.exec('INSERT INTO runtime_metadata(key,value_json) VALUES(?,?)',key,valueJson);
   return {key,value,valueJson};
  });
  if(!intent)return;
  try{await send({epoch:intent.value.epoch,operationId:intent.value.transition_id});}
  catch(error){
   if(error instanceof HostedWakeDeliveryError){
    // Preserve UNKNOWN and the exact intent; diagnostics never authorize replay.
    this.store.db.exec('UPDATE runtime_metadata SET value_json=? WHERE key=? AND value_json=?',JSON.stringify({...intent.value,
     error_code:'HOSTED_WAKE_OUTCOME_UNKNOWN',request_phase:error.phase,upstream_status:error.upstreamStatus}),intent.key,intent.valueJson);
   }
   throw error;
  }
  this.store.db.transaction(()=>{
   this.store.db.exec('UPDATE runtime_metadata SET value_json=? WHERE key=? AND value_json=?',JSON.stringify({...intent.value,status:'queued'}),intent.key,intent.valueJson);
  });
 }
 private active():boolean{
  const budget=this.core.budget.admissionPredicate();
  // Expiry and answer handoff do not settle the native request. Even stale
  // obligations need explicit reconciliation before the runtime may sleep.
  if(this.core.questions.list().length)return true;
  return this.store.db.all("SELECT resource_id FROM resource_locks LIMIT 1").length>0 || this.store.db.all(`SELECT r.id FROM runs r WHERE r.status IN ('claimed','running','finishing','cancelling','recovery_required') OR (r.status='queued' AND (${budget.sql})) LIMIT 1`,...budget.bindings).length>0 || this.store.db.all("SELECT id FROM operations WHERE status!='settled' LIMIT 1").length>0 || this.store.db.all("SELECT e.id FROM effects e JOIN runs r ON r.id=e.run_id WHERE e.status IN ('intent','dispatched') OR (e.status='outcome_unknown' AND r.status IN ('claimed','running','finishing','cancelling')) LIMIT 1").length>0;
 }
 nextClaimableRun():PendingRun|undefined {
  return this.store.db.transaction(()=>{
   if(this.core.ownerAlpha.policy&&!this.core.ownerAlpha.available())return undefined;
   const cutoff=new Date(this.core.options.now().getTime()-90*86400000).toISOString(),budget=this.core.budget.admissionPredicate();
   const skillCutoff=new Date(this.core.options.now().getTime()-30*86400000).toISOString();
   const questions=[...new Set(this.core.questions.list().map(question=>question.run_id))];
   const alpha=this.core.ownerAlpha.policy;
   const assigned=this.core.bootstrap.assignedManifest();
   // One MiB combined UTF-8 historical bodies per candidate. SQLite still
   // inspects stored values; this bounds returned bytes, not SQL work/storage.
   const snapshotFits='length(CAST(r.context_json AS BLOB))+COALESCE(length(CAST(r.checkpoint_json AS BLOB)),0)<=1048576';
   return this.store.db.all<PendingRun>(`SELECT r.id,r.command_id,r.occurrence_id,r.persona_id,r.routine_id,r.status,r.current_attempt,r.error_code,r.created_at,r.updated_at,r.role,r.parent_run_id,r.title,
    CASE WHEN ${snapshotFits} THEN r.context_json END AS context_json,
    CASE WHEN ${snapshotFits} THEN r.checkpoint_json END AS checkpoint_json
    FROM runs r LEFT JOIN commands c ON c.id=r.command_id WHERE r.role='coordinator' AND r.status='queued' AND (r.current_attempt>0 OR COALESCE(c.accepted_at,r.created_at)>?) AND (${budget.sql}) AND (${nativeDescendantsSettledSql}) ${questions.length?`AND r.id NOT IN (${questions.map(()=>'?').join(',')})`:''}
    AND (r.current_attempt>0 OR json_type(r.context_json,'$.skill_invocation') IS NULL OR r.created_at>?)
    ${assigned?'AND r.id=?':''}
    ${alpha?`AND r.current_attempt=0 AND r.persona_id=? AND r.routine_id IS NULL AND r.occurrence_id IS NULL AND json_extract(r.context_json,'$.room_id') IS NULL AND c.type='message.send' AND c.owner_id NOT GLOB 'runtime:*' AND c.owner_id NOT GLOB 'trigger:*' AND json_extract(c.payload_json,'$.conversation_id')=r.persona_id AND EXISTS(SELECT 1 FROM events ev WHERE ev.id=r.command_id AND ev.type='message.user' AND ev.actor_id=c.owner_id AND ev.sequence>?)`:''}
    ORDER BY r.created_at,r.id LIMIT 1`,cutoff,...budget.bindings,...questions,skillCutoff,...(assigned?[assigned.run_id]:[]),...(alpha?[alpha.persona_id,assigned?assigned.event_sequence-1:this.core.ownerAlpha.cutoff()]:[]))[0];
  });
 }
 private touch():void{this.store.db.exec("INSERT INTO runtime_metadata(key,value_json) VALUES('last_activity',?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json",JSON.stringify(this.core.now()));}
 private identity(identity:Identity,allowBoot=false):Lifecycle {
  const state=this.get();
  requireThat(Number.isSafeInteger(identity.epoch)&&identity.epoch===state.epoch&&identity.boot_id===state.boot_id,'STALE_EPOCH','The executor no longer owns this runtime.');
  requireThat(state.lease_until!==null&&state.lease_until>this.core.now(),'STALE_EPOCH','The executor lease expired.');
  requireThat((allowBoot?['BOOTING','READY','DRAINING']:['READY','DRAINING']).includes(state.phase),'STALE_EPOCH','Runtime admission is closed.');
  this.core.ownerAlpha.propagateCancellation();return state;
 }
 authorizeAttempt(identity:Identity,runId:string,attempt:number):void {
  this.identity(identity);
  this.core.ownerAlpha.authorize(runId,attempt);
  const row=this.store.db.all<{epoch:number;boot_id:string}>('SELECT epoch,boot_id FROM attempts WHERE run_id=? AND attempt=?',runId,attempt)[0];
  requireThat(row,'REVISION_CONFLICT','Attempt is unavailable.');
  requireThat(row.epoch===identity.epoch&&row.boot_id===identity.boot_id,'STALE_EPOCH','Attempt belongs to a different executor.');
 }
 registerBoot(bootId:string):Identity {
  return this.store.db.transaction(()=>{
   if(this.core.ownerAlpha.policy&&this.get().phase==='STOPPED'){
    this.core.ownerAlpha.initialize();
    requireThat(this.get().epoch===0&&this.core.ownerAlpha.available()&&!this.store.db.all('SELECT run_id FROM attempts LIMIT 1').length,'STALE_EPOCH','Owner-alpha boot requires fresh custody and an unexpired session.');
    this.store.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=1,desired_state='RUN',lease_until=? WHERE singleton=1",new Date(this.core.options.now().getTime()+90000).toISOString());
   }
   const state=this.get();requireThat(state.phase==='BOOTING','STALE_EPOCH','No boot is expected.');
   requireThat(state.lease_until!==null&&state.lease_until>this.core.now(),'STALE_EPOCH','The expected boot window expired.');
   requireThat(!state.boot_id||state.boot_id===bootId,'STALE_EPOCH','Another boot already owns this epoch.');
   requireThat(/^[0-9a-f-]{36}$/i.test(bootId),'INVALID_INPUT','Invalid boot identity.',422);
   const generation=this.core.ownerAlpha.activeGeneration();
   this.store.db.exec('UPDATE lifecycle SET boot_id=?,lease_until=?,last_heartbeat=? WHERE singleton=1',bootId,new Date(generation?Math.min(Date.parse(generation.policy.expires_at),this.core.options.now().getTime()+90000):this.core.options.now().getTime()+90000).toISOString(),this.core.now());
   return {epoch:state.epoch,boot_id:bootId};
  });
 }
 ready(identity:Identity):void {
  this.store.db.transaction(()=>{this.identity(identity,true);this.store.db.exec("UPDATE lifecycle SET phase='READY' WHERE singleton=1");this.touch();});
 }
 heartbeat(identity:Identity,operations:HeartbeatOperation[]):{lease_until:string;cancellations:string[]} {
  requireThat(operations.length<=100,'INVALID_INPUT','Too many operation records.',422);
  return this.store.db.transaction(()=>{
   this.identity(identity);
   for(const input of operations){
    const op={...input,started_at:operationTime(input.started_at),deadline_at:operationTime(input.deadline_at),last_progress_at:operationTime(input.last_progress_at)};
    const run=this.store.db.all<Pick<Run,'id'|'current_attempt'|'status'>>('SELECT id,current_attempt,status FROM runs WHERE id=?',op.run_id)[0];
    requireThat(run,'NOT_FOUND','Run unavailable.',404);
    this.core.ownerAlpha.authorize(run.id,op.attempt);
    requireThat(run.current_attempt===op.attempt&&['claimed','running','finishing','cancelling','recovery_required'].includes(run.status),'STALE_EPOCH','Operation does not belong to an active attempt.');
    const attempt=this.store.db.all<{epoch:number;boot_id:string;deadline_at:string}>('SELECT epoch,boot_id,deadline_at FROM attempts WHERE run_id=? AND attempt=?',run.id,op.attempt)[0];
    requireThat(attempt?.epoch===identity.epoch&&attempt.boot_id===identity.boot_id,'STALE_EPOCH','Attempt belongs to a different executor.');
    requireThat(op.started_at<=op.deadline_at&&op.deadline_at<=operationTime(attempt.deadline_at)&&op.last_progress_at>=op.started_at,'INVALID_INPUT','Operation timing exceeds its attempt or is out of order.',422);
    const old=this.store.db.all<HeartbeatOperation>('SELECT * FROM operations WHERE id=?',op.id)[0];
    requireThat(!old||old.run_id===run.id&&old.attempt===op.attempt,'INVALID_INPUT','Operation identity was reused.',422);
    requireThat(!old||old.kind===op.kind&&operationTime(old.started_at)===op.started_at&&operationTime(old.deadline_at)===op.deadline_at,'INVALID_INPUT','Operation custody changed.',422);
    requireThat(!old||operationTime(old.last_progress_at)<=op.last_progress_at,'INVALID_INPUT','Operation progress moved backwards.',422);
    requireThat(old?.status!=='settled'||op.status==='settled','INVALID_INPUT','A settled operation cannot become active.',422);
    this.store.db.exec('INSERT INTO operations(id,run_id,attempt,kind,status,started_at,deadline_at,last_progress_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,started_at=excluded.started_at,deadline_at=excluded.deadline_at,last_progress_at=excluded.last_progress_at',op.id,run.id,op.attempt,op.kind,op.status,op.started_at,op.deadline_at,op.last_progress_at);
   }
   const generation=this.core.ownerAlpha.activeGeneration(),renewed=this.core.options.now().getTime()+90000;
   const lease=new Date(generation?Math.min(Date.parse(generation.policy.expires_at),renewed):renewed).toISOString();
   this.store.db.exec('UPDATE lifecycle SET lease_until=?,last_heartbeat=? WHERE singleton=1',lease,this.core.now());
   if(this.active())this.touch();
   return {lease_until:lease,cancellations:this.store.db.all<{id:string}>("SELECT id FROM runs WHERE status IN ('cancelling','recovery_required')").map(x=>x.id)};
  });
 }
 prepareMemory(identity:Identity,personaModels:Record<string,string>,memoryReadPersonas:string[]=[]) {
  return this.store.db.transaction(()=>{
   const state=this.identity(identity);requireThat(state.phase==='READY','STALE_EPOCH','Runtime is draining.');
   requireThat(this.core.options.executionEnabled&&!this.core.ownerAlpha.policy,'CAPABILITY_UNAVAILABLE','Memory preparation requires ordinary execution admission.');
   const run=this.nextClaimableRun();if(!run)return null;
   if(run.context_json===null){
    this.blockMemoryPreparation(run,'CONTEXT_PREPARATION_LIMIT');
    return {blocked:true as const,run_id:run.id,reason:'CONTEXT_PREPARATION_LIMIT'};
   }
   try {
    const model=Object.hasOwn(personaModels,run.persona_id)?personaModels[run.persona_id]:undefined;
    return prepareMemory(this.store,run,model!,this.core.now(),memoryReadPersonas).preparation;
   } catch(error) {
    if(!(error instanceof ControlError)||error.code!=='MEMORY_PREPARATION_LIMIT')throw error;
    this.blockMemoryPreparation(run,error.code);
    return {blocked:true as const,run_id:run.id,reason:error.code};
   }
  });
 }
 private blockMemoryPreparation(run:Pick<Run,'id'|'persona_id'|'command_id'>,reason:string):void {
  this.store.db.exec("UPDATE runs SET status='waiting',error_code=?,updated_at=? WHERE id=?",reason,this.core.now(),run.id);
  this.store.event(this.core.options.uuid(),run.persona_id,'run.waiting','system',run.command_id,
   {run_id:run.id,reason,message:reason==='CONTEXT_PREPARATION_LIMIT'?
    'Historical context and checkpoint exceed the combined read limit. Stored data was retained and no attempt was started.':
    'Memory preparation blocked before execution. No memory was truncated and no attempt was started.'},this.core.now());
 }
 claim(identity:Identity,personaModels?:Record<string,string>,memoryBudget?:MemoryBudgetReceipt,memoryReadPersonas:string[]=[]):{run:Run;submission_key:string;deadline_at:string;owner_alpha_background?:true;text_only?:import('./owner-alpha').TextOnlyProfile}|null {
  return this.store.db.transaction(()=>{
   const state=this.identity(identity);requireThat(state.phase==='READY','STALE_EPOCH','Runtime is draining.');
   requireThat(this.core.options.executionEnabled||this.core.ownerAlpha.policy,'CAPABILITY_UNAVAILABLE','Execution has not been enabled.');
   const current=this.core.ownerAlpha.activeGeneration();
   // Root inference release is not family settlement. Uncertain roots block;
   // provider-confirmed process termination retains the existing recovery path.
   if(this.store.db.all(`SELECT r.id FROM runs r WHERE r.role='coordinator' AND r.status IN ('claimed','running','finishing','cancelling','recovery_required')
   AND NOT (r.status='recovery_required' AND EXISTS(SELECT 1 FROM attempts a WHERE a.run_id=r.id AND a.attempt=r.current_attempt AND a.status='terminated' AND a.settled_at IS NOT NULL)) AND NOT EXISTS(
    SELECT 1 FROM attempts a WHERE a.run_id=r.id AND a.attempt=r.current_attempt AND a.epoch=? AND a.boot_id=?
    AND json_extract(a.coordinator_release_json,'$.native_ref')=a.native_run_ref
    AND json_extract(a.coordinator_release_json,'$.outcome') IN ('completed','failed','interrupted')
   ) ${current?'AND EXISTS(SELECT 1 FROM attempts current_attempt WHERE current_attempt.run_id=r.id AND current_attempt.attempt=r.current_attempt AND current_attempt.epoch=? AND current_attempt.boot_id=?)':''} LIMIT 1`,identity.epoch,identity.boot_id,...(current?[current.epoch,current.boot_id]:[])).length)return null;
   // Match the runtime's bounded family registry without evicting old custody.
   // Admission only needs the threshold, not a census beyond it.
   const unresolved=this.store.db.all<{count:number}>(`SELECT COUNT(*) AS count FROM (SELECT 1 FROM runs r WHERE r.role='coordinator' AND r.current_attempt>0 AND ${current?'EXISTS(SELECT 1 FROM attempts current_attempt WHERE current_attempt.run_id=r.id AND current_attempt.attempt=r.current_attempt AND current_attempt.epoch=? AND current_attempt.boot_id=?) AND ':''}(
    r.status IN ('claimed','running','finishing','cancelling','recovery_required')
    OR EXISTS(SELECT 1 FROM attempts a WHERE a.run_id=r.id AND a.status IN ('claimed','running'))
    OR EXISTS(SELECT 1 FROM operations o WHERE o.run_id=r.id AND o.status!='settled')
    OR EXISTS(SELECT 1 FROM resource_locks l WHERE l.run_id=r.id)
    OR EXISTS(SELECT 1 FROM effects e WHERE e.run_id=r.id AND e.status IN ('intent','dispatched','outcome_unknown'))
    OR NOT (${nativeDescendantsSettledSql})
   ) LIMIT 32)`,...(current?[current.epoch,current.boot_id]:[]))[0].count;
   if(unresolved>=32)return null;
   const run=this.nextClaimableRun();if(!run)return null;
   if(run.context_json===null){this.blockMemoryPreparation(run,'CONTEXT_PREPARATION_LIMIT');return null;}
   let prepared:ReturnType<typeof prepareMemory>|undefined;
   if(memoryBudget){
    requireThat(!this.core.ownerAlpha.policy,'CAPABILITY_UNAVAILABLE','Staged alpha does not permit generic memory preparation.');
    const model=personaModels&&Object.hasOwn(personaModels,run.persona_id)?personaModels[run.persona_id]:undefined;
    prepared=prepareMemory(this.store,run,model!,this.core.now(),memoryReadPersonas);
    if(!validateMemoryBudget(prepared.preparation,memoryBudget)){
     this.blockMemoryPreparation(run,'MEMORY_BUDGET_EXCEEDED');return null;
    }
   }
   const prior=JSON.parse(run.context_json) as ContextSnapshot;
   // Background-generation admitted roots claim the restricted per-task snapshot
   // (§9): no shared conversation history, task summaries, or WhatsApp grants
   // may reach A/S/B through the generic context composition.
   const backgroundRootRole=this.core.ownerAlpha.backgroundCompletionRole(run.id);
   let context:ContextSnapshot;
   try{context=backgroundRootRole?this.core.backgroundContext(run.persona_id,prior.instruction,run.id):
    this.core.context(run.persona_id,prior.instruction,run.routine_id,prior.room_id,run.command_id,prepared?.memories);}
   catch(error){
    if(!(error instanceof ControlError)||error.code!=='MEMORY_PREPARATION_LIMIT')throw error;
    this.blockMemoryPreparation(run,error.code);return null;
   }
   if(memoryBudget)context.memory_budget={...memoryBudget};
   if(personaModels!==undefined){
    const model=Object.hasOwn(personaModels,run.persona_id)?personaModels[run.persona_id]:undefined;
    requireThat(typeof model==='string'&&/^[a-zA-Z0-9._-]{1,128}$/.test(model),'NATIVE_PERSONA_UNMAPPED','The runtime must declare the selected persona model.');
    context.selected_model=model;
   }
   const command=run.command_id?this.store.db.all<{type:string}>('SELECT type FROM commands WHERE id=?',run.command_id)[0]:null;
   if(command?.type==='skill.run'||prior.skill_invocation){
    const selected=prior.skill_invocation;
    requireThat(command?.type==='skill.run'&&selected&&prior.skills?.length===1&&prior.skills[0].id===selected.skill_id&&prior.skills[0].revision===selected.skill_revision,'REVISION_CONFLICT','The explicitly selected skill snapshot is unavailable. Send a fresh request.');
    context.skill_invocation=selected;context.skills=prior.skills;
   }
   const attempt=run.current_attempt+1,submissionKey=`${run.id}:${attempt}`,deadline=this.core.ownerAlpha.policy?this.core.ownerAlpha.admit(run):new Date(this.core.options.now().getTime()+20*60000).toISOString();
   this.store.db.exec("UPDATE runs SET status='claimed',current_attempt=?,context_json=?,updated_at=? WHERE id=?",attempt,JSON.stringify(context),this.core.now(),run.id);
   this.store.db.exec("INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,status,deadline_at,started_at,captured_routine_revision) VALUES(?,?,?,?,?,'claimed',?,?,?)",run.id,attempt,submissionKey,identity.epoch,identity.boot_id,deadline,this.core.now(),context.routine?.revision??null);
   if(run.occurrence_id)this.store.db.exec("UPDATE occurrences SET status='claimed' WHERE id=?",run.occurrence_id);
   for(const event of context.context_events)this.store.db.exec('UPDATE consumer_cursors SET consumed_sequence=MAX(consumed_sequence,?) WHERE consumer_id=? AND conversation_id=?',event.sequence,run.persona_id,context.room_id);
   const textOnly=this.core.ownerAlpha.textOnly(run.id);
   this.touch();return {run:this.store.run(run.id),submission_key:submissionKey,deadline_at:deadline,...(this.core.ownerAlpha.backgroundRoot(run.id)?{owner_alpha_background:true as const}:{}),...(textOnly?{text_only:textOnly}:{})};
  });
 }
 submitted(identity:Identity,runId:string,attempt:number,nativeRef:string):void {
  this.store.db.transaction(()=>{
   this.authorizeAttempt(identity,runId,attempt);
   const run=this.store.db.all<Pick<Run,'current_attempt'|'status'|'error_code'>>('SELECT current_attempt,status,error_code FROM runs WHERE id=?',runId)[0];
   requireThat(run,'NOT_FOUND','Run unavailable.',404);
   requireThat(run.current_attempt===attempt,'REVISION_CONFLICT','Attempt has changed.');
   const row=this.store.db.all<{native_run_ref:string|null;status:string;deadline_at:string}>('SELECT native_run_ref,status,deadline_at FROM attempts WHERE run_id=? AND attempt=?',runId,attempt)[0];
   requireThat(row.native_run_ref===null||row.native_run_ref===nativeRef,'REVISION_CONFLICT','Native submission identity already belongs to a different receipt.');
   // A registered receipt survives a lost reply and later cancellation/settlement.
   // A child may have a native ref while still claimed; that is not a start ACK.
   if(row.native_run_ref===nativeRef&&row.status!=='claimed')return;
   if(this.core.ownerAlpha.policy&&row.status==='claimed'&&['cancelling','recovery_required'].includes(run.status)){
    // A delayed alpha ACK is custody, not renewed permission to execute.
    this.store.db.exec("UPDATE attempts SET native_run_ref=?,status='running' WHERE run_id=? AND attempt=?",nativeRef,runId,attempt);
    return;
   }
   requireThat(run.status==='claimed','REVISION_CONFLICT','Run is not awaiting submission.');
   const now=this.core.now(),expired=row.deadline_at<=now;
   // Retain late native receipts, but expose cancellation without waiting for an alarm.
   this.store.db.exec("UPDATE attempts SET native_run_ref=?,status='running' WHERE run_id=? AND attempt=?",nativeRef,runId,attempt);
   this.store.db.exec('UPDATE runs SET status=?,error_code=?,updated_at=? WHERE id=?',expired?'cancelling':'running',expired?'DEADLINE_EXCEEDED':run.error_code,now,runId);this.touch();
  });
 }
 coordinatorRelease(identity:Identity,runId:string,attempt:number,nativeRef:string,outcome:CoordinatorOutcome):void {
  this.store.db.transaction(()=>{
   this.authorizeAttempt(identity,runId,attempt);
   const run=this.store.db.all<Pick<Run,'current_attempt'|'role'|'status'>>('SELECT current_attempt,role,status FROM runs WHERE id=?',runId)[0];
   requireThat(run,'NOT_FOUND','Run unavailable.',404);
   requireThat(run.current_attempt===attempt,'REVISION_CONFLICT','Attempt has changed.');
   requireThat(run.role==='coordinator','FORBIDDEN','Only a coordinator may release its inference lane.');
   requireThat(['completed','failed','interrupted'].includes(outcome),'INVALID_INPUT','Invalid root terminal outcome.',422);
   const row=this.store.db.all<{native_run_ref:string|null;coordinator_release_json:string|null;status:string;result_json:string|null}>('SELECT native_run_ref,coordinator_release_json,status,result_json FROM attempts WHERE run_id=? AND attempt=?',runId,attempt)[0];
   requireThat(!!nativeRef&&row.native_run_ref===nativeRef,'REVISION_CONFLICT','Root native identity does not match its attempt.');
   const receipt=JSON.stringify({native_ref:nativeRef,outcome});
   if(row.coordinator_release_json!==null){
    requireThat(row.coordinator_release_json===receipt,'IDEMPOTENCY_CONFLICT','Coordinator release differs from its committed receipt.');
    return;
   }
   requireThat(['running','finishing','cancelling','recovery_required'].includes(run.status)&&row.status==='running'&&row.result_json===null,'REVISION_CONFLICT','Coordinator attempt is not awaiting root settlement.');
   // Trusted runtime observation only: do not settle operations, publish a result,
   // touch deadlines/lease/activity, clear cancellation, or revive an old epoch.
   this.store.db.exec('UPDATE attempts SET coordinator_release_json=? WHERE run_id=? AND attempt=?',receipt,runId,attempt);
  });
 }
 complete(identity:Identity,runId:string,attempt:number,result:{status:'completed'|'failed'|'cancelled'|'waiting';text:string;error_code?:string;checkpoint?:Record<string,unknown>},textOnlyReceipt?:TextOnlyReceipt,backgroundReceipt?:BackgroundReceipt):void {
  const textOnly=this.core.ownerAlpha.textOnly(runId);
  const backgroundRole=this.core.ownerAlpha.backgroundCompletionRole(runId);
  const backgroundSettling=backgroundRole==='status'||backgroundRole==='independent';
  requireThat(!this.core.ownerAlpha.policy||!!textOnly||backgroundSettling,'CAPABILITY_UNAVAILABLE','Owner alpha cannot assert family settlement.');
  requireThat(!textOnlyReceipt||!!textOnly,'CAPABILITY_UNAVAILABLE','Text-only completion is unavailable for this attempt.');
  requireThat(!backgroundReceipt||backgroundSettling,'CAPABILITY_UNAVAILABLE','Background completion is unavailable for this attempt.');
  requireThat(!textOnlyReceipt||!backgroundReceipt,'INVALID_INPUT','Choose exactly one completion receipt.',422);
  this.store.db.transaction(()=>{
   this.authorizeAttempt(identity,runId,attempt);
   const run=this.store.db.all<Pick<Run,'id'|'current_attempt'|'role'|'parent_run_id'|'status'|'error_code'|'persona_id'|'command_id'|'title'|'occurrence_id'>>('SELECT id,current_attempt,role,parent_run_id,status,error_code,persona_id,command_id,title,occurrence_id FROM runs WHERE id=?',runId)[0];
   requireThat(run,'NOT_FOUND','Run unavailable.',404);
   requireThat(run.current_attempt===attempt,'REVISION_CONFLICT','Attempt has changed.');
   const proofKey=`text_only_receipt:${runId}:${attempt}`;
   let proof:string|undefined;
   if(textOnly){
    const row=this.store.db.all<{native_run_ref:string|null;coordinator_release_json:string|null}>('SELECT native_run_ref,coordinator_release_json FROM attempts WHERE run_id=? AND attempt=?',runId,attempt)[0];
    requireThat(!!textOnlyReceipt&&textOnlyReceipt.profile_version===textOnly.profile_version&&textOnlyReceipt.profile_sha256===textOnly.profile_sha256&&textOnlyReceipt.turn_id===row.native_run_ref&&
     row.coordinator_release_json===JSON.stringify({native_ref:row.native_run_ref,outcome:'completed'})&&run.role==='coordinator'&&run.parent_run_id===null&&
     result.status==='completed'&&!Object.hasOwn(result,'error_code')&&!Object.hasOwn(result,'checkpoint')&&createHash('sha256').update(result.text).digest('hex')===textOnlyReceipt.output_sha256,
     'CAPABILITY_UNAVAILABLE','Text-only completion receipt does not prove this exact result.');
    requireThat(!this.store.db.all('SELECT id FROM runs WHERE parent_run_id=? LIMIT 1',runId).length&&!this.store.db.all('SELECT run_id FROM native_task_links WHERE run_id=? OR parent_run_id=? LIMIT 1',runId,runId).length,
     'CANCEL_UNCONFIRMED','Text-only completion requires no child history.');
    requireThat(!this.store.db.all('SELECT id FROM effects WHERE run_id=? LIMIT 1',runId).length,'OUTCOME_UNKNOWN','Text-only completion requires no effect history.');
    proof=JSON.stringify({profile_version:textOnlyReceipt!.profile_version,profile_sha256:textOnlyReceipt!.profile_sha256,
     thread_id:textOnlyReceipt!.thread_id,turn_id:textOnlyReceipt!.turn_id,output_sha256:textOnlyReceipt!.output_sha256});
    const prior=this.store.db.all<{value_json:string}>('SELECT value_json FROM runtime_metadata WHERE key=?',proofKey)[0];
    requireThat(!prior||prior.value_json===proof,'RESULT_CONFLICT','Text-only receipt differs from committed evidence.');
   }
   const backgroundProofKey=`owner_alpha_background_receipt:${runId}:1`;
   if(backgroundSettling){
    const row=this.store.db.all<{native_run_ref:string|null;coordinator_release_json:string|null}>('SELECT native_run_ref,coordinator_release_json FROM attempts WHERE run_id=? AND attempt=?',runId,attempt)[0];
    requireThat(!!backgroundReceipt&&typeof backgroundReceipt.thread_id==='string'&&backgroundReceipt.thread_id.length>=1&&backgroundReceipt.thread_id.length<=256&&
     typeof backgroundReceipt.turn_id==='string'&&backgroundReceipt.turn_id.length>=1&&backgroundReceipt.turn_id.length<=256&&
     typeof backgroundReceipt.output_sha256==='string'&&hex64.test(backgroundReceipt.output_sha256)&&
     !!row&&backgroundReceipt.turn_id===row.native_run_ref&&row.native_run_ref!==null&&
     row.coordinator_release_json===JSON.stringify({native_ref:row.native_run_ref,outcome:'completed'})&&
     run.role==='coordinator'&&run.parent_run_id===null&&result.status==='completed'&&!Object.hasOwn(result,'error_code')&&!Object.hasOwn(result,'checkpoint')&&
     createHash('sha256').update(result.text).digest('hex')===backgroundReceipt.output_sha256,
     'CAPABILITY_UNAVAILABLE','Background completion receipt does not prove this exact result.');
    requireThat(!this.store.db.all('SELECT id FROM runs WHERE parent_run_id=? LIMIT 1',runId).length&&!this.store.db.all('SELECT run_id FROM native_task_links WHERE run_id=? OR parent_run_id=? LIMIT 1',runId,runId).length,
     'CANCEL_UNCONFIRMED','Background completion requires no child history.');
    requireThat(!this.store.db.all('SELECT id FROM effects WHERE run_id=? LIMIT 1',runId).length,'OUTCOME_UNKNOWN','Background completion requires no effect history.');
    const backgroundProof=JSON.stringify({thread_id:backgroundReceipt!.thread_id,turn_id:backgroundReceipt!.turn_id,output_sha256:backgroundReceipt!.output_sha256});
    const priorBackground=this.store.db.all<{value_json:string}>('SELECT value_json FROM runtime_metadata WHERE key=?',backgroundProofKey)[0];
    requireThat(!priorBackground||priorBackground.value_json===backgroundProof,'RESULT_CONFLICT','Background receipt differs from committed evidence.');
   }
   if(['OWNER_CANCELLED','CONTEXT_INVALIDATED'].includes(run.error_code??'')){
    requireThat(result.status==='cancelled','CONTEXT_INVALIDATED','Cancellation must settle before any result is published.');
    result={status:'cancelled',text:'',error_code:run.error_code!};
   }
   // The attempt receipt, not the run's mutable waiting/retry status, owns replay.
   // An identical acknowledgment performs no new settlement or publication.
   const receipt=this.store.db.all<{result_json:string|null}>('SELECT result_json FROM attempts WHERE run_id=? AND attempt=?',runId,attempt)[0];
   if(receipt.result_json!==null){
    requireThat(receipt.result_json===JSON.stringify(result),'RESULT_CONFLICT','Attempt result differs from its committed receipt.');
    requireThat(!textOnly||this.store.db.all('SELECT key FROM runtime_metadata WHERE key=?',proofKey).length===1,'RESULT_CONFLICT','Text-only completion evidence is missing.');
    requireThat(!backgroundSettling||this.store.db.all('SELECT key FROM runtime_metadata WHERE key=?',backgroundProofKey).length===1,'RESULT_CONFLICT','Background completion evidence is missing.');
    return;
   }
   requireThat(['claimed','running','finishing','cancelling','recovery_required'].includes(run.status),'REVISION_CONFLICT','Run is not active.');
   requireThat(!this.store.db.all("SELECT id FROM operations WHERE run_id=? AND attempt=? AND status!='settled' LIMIT 1",runId,attempt).length,'CANCEL_UNCONFIRMED','Live operations have not settled.');
   requireThat(!this.core.questions.list().some(question=>question.run_id===runId),'CANCEL_UNCONFIRMED','A native question remains unresolved.');
   requireThat(!this.store.db.all('SELECT resource_id FROM resource_locks WHERE run_id=? LIMIT 1',runId).length,'RESOURCE_BUSY','Release scoped resources after tool settlement before completing.');
   requireThat(!this.store.db.all("SELECT id FROM effects WHERE run_id=? AND status IN ('intent','dispatched','outcome_unknown') LIMIT 1",runId).length,'OUTCOME_UNKNOWN','An external effect needs reconciliation.');
   requireThat(result.status!=='waiting'||result.checkpoint,'INVALID_INPUT','Waiting requires a durable checkpoint.',422);
   const now=this.core.now();
   if(proof)this.store.db.exec('INSERT INTO runtime_metadata(key,value_json) VALUES(?,?)',proofKey,proof);
   if(backgroundSettling)this.store.db.exec('INSERT INTO runtime_metadata(key,value_json) VALUES(?,?)',backgroundProofKey,
    JSON.stringify({thread_id:backgroundReceipt!.thread_id,turn_id:backgroundReceipt!.turn_id,output_sha256:backgroundReceipt!.output_sha256}));
   // Preserve known legacy refusal before the result clears mutable run errors.
   // This is attempt-scoped evidence, not a rewrite of its historical snapshot.
   if(run.role==='background'&&run.error_code==='MEMORY_PREPARATION_LIMIT'&&this.store.db.all('SELECT run_id FROM native_task_links WHERE run_id=? AND parent_run_id=?',runId,run.parent_run_id).length)
    this.store.db.exec('INSERT INTO runtime_metadata(key,value_json) VALUES(?,?) ON CONFLICT(key) DO NOTHING',`native_context_unavailable:${runId}:${attempt}`,JSON.stringify('MEMORY_PREPARATION_LIMIT'));
   this.store.db.exec('UPDATE attempts SET status=?,settled_at=?,result_json=? WHERE run_id=? AND attempt=?',result.status,now,JSON.stringify(result),runId,attempt);
   this.store.db.exec('UPDATE runs SET status=?,error_code=?,checkpoint_json=?,updated_at=? WHERE id=?',result.status,result.error_code??null,result.checkpoint?JSON.stringify(result.checkpoint):null,now,runId);
   this.store.db.exec("INSERT INTO outbox(id,run_id,destination,payload_json,status,created_at,updated_at) VALUES(?,?,'portal',?,'delivered',?,?) ON CONFLICT(run_id,destination) DO UPDATE SET payload_json=excluded.payload_json,status='delivered',updated_at=excluded.updated_at",this.core.options.uuid(),runId,JSON.stringify(result),now,now);
   this.store.event(this.core.options.uuid(),run.persona_id,'run.result','runtime',run.command_id,{run_id:runId,role:run.role,title:run.title,...result},now);
   if(['completed','failed','cancelled'].includes(result.status))this.core.flushFollowups(runId);
   if(run.occurrence_id&&result.status!=='waiting')this.store.db.exec('UPDATE occurrences SET status=? WHERE id=?',result.status==='completed'?'completed':'failed',run.occurrence_id);
   // Settlement and follow-up enqueueing do not change id, role or current_attempt.
   if(result.status==='failed'&&result.error_code)this.scheduleRetry(run,result.error_code);
   this.touch();
  });
 }
 prepareSleep(identity:Identity):{stop_token:string;queue_sequence:number} {
  requireThat(!this.core.ownerAlpha.policy,'CAPABILITY_UNAVAILABLE','Owner alpha does not permit sleep.');
  return this.store.db.transaction(()=>{
   const state=this.identity(identity);
   requireThat(!this.active(),'SLEEP_DENIED','Work or unresolved effects prevent sleep.');
   const last=this.store.db.all<{value_json:string}>("SELECT value_json FROM runtime_metadata WHERE key='last_activity'")[0];
   requireThat(last&&this.core.options.now().getTime()-Date.parse(JSON.parse(last.value_json))>=60000,'SLEEP_DENIED','Idle grace has not elapsed.');
   const token=this.core.options.uuid();this.store.db.exec("UPDATE lifecycle SET phase='DRAINING',stop_token=? WHERE singleton=1",token);
   return {stop_token:token,queue_sequence:state.queue_sequence};
  });
 }
 commitSleep(identity:Identity,token:string,queueSequence:number,checkpoint:Record<string,unknown>):void {
  requireThat(!this.core.ownerAlpha.policy,'CAPABILITY_UNAVAILABLE','Owner alpha does not permit sleep.');
  this.store.db.transaction(()=>{
   const state=this.identity(identity);
   requireThat(state.phase==='DRAINING'&&state.stop_token===token&&state.queue_sequence===queueSequence&&!this.active(),'SLEEP_DENIED','New work or activity invalidated the stop.');
   requireThat(Object.keys(checkpoint).length>0,'INVALID_INPUT','A checkpoint receipt is required.',422);
   this.store.db.exec("INSERT INTO runtime_metadata(key,value_json) VALUES('checkpoint',?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json",JSON.stringify(checkpoint));
   if(this.options.idleMode)this.store.db.exec("UPDATE lifecycle SET phase='IDLE_PERMITTED',desired_state='STOP',boot_id=NULL,lease_until=NULL WHERE singleton=1");
   else this.store.db.exec("UPDATE lifecycle SET phase='STOP_COMMITTED',desired_state='STOP' WHERE singleton=1");
  });
 }
 private scheduleRetry(run:Pick<Run,'id'|'role'|'current_attempt'>,reason:string):void {
  if(this.core.ownerAlpha.policy)return;
  if(run.role==='background'||run.current_attempt>=3 || !['TEMPORARY_UNAVAILABLE','DEADLINE_EXCEEDED','STALE_EPOCH','CANCEL_UNCONFIRMED'].includes(reason))return;
  if(this.core.questions.list().some(question=>question.run_id===run.id))return;
  // Receipt presence follows the stored TEXT's truthiness, not its JSON value.
  if(this.store.db.all(`SELECT id FROM effects WHERE run_id=? AND (
   status IN ('intent','dispatched','outcome_unknown') OR classification='mutation'
   OR (classification='idempotent' AND (receipt_json IS NULL OR receipt_json=''))
  ) LIMIT 1`,run.id).length)return;
  if(this.store.db.all("SELECT id FROM operations WHERE run_id=? AND status!='settled' LIMIT 1",run.id).length)return;
  const due=new Date(this.core.options.now().getTime()+(run.current_attempt<=1?10000:60000)).toISOString();
  this.store.db.exec('INSERT INTO retry_queue(run_id,due_at,reason) VALUES(?,?,?) ON CONFLICT(run_id) DO NOTHING',run.id,due,reason);
  this.store.db.exec("UPDATE runs SET status='waiting',error_code=?,checkpoint_json=COALESCE(checkpoint_json,?),updated_at=? WHERE id=?",reason,JSON.stringify({retry_at:due}),this.core.now(),run.id);
 }
 retryDue():void {
  this.store.db.transaction(()=>{
   for(const retry of this.store.db.all<{run_id:string}>('SELECT run_id FROM retry_queue WHERE due_at<=?',this.core.now())){
    const run=this.store.db.all<Pick<Run,'id'|'status'>>('SELECT id,status FROM runs WHERE id=?',retry.run_id)[0];
    requireThat(run,'NOT_FOUND','Run unavailable.',404);
    if(run.status==='waiting'&&this.core.questions.list().some(question=>question.run_id===run.id)){
     this.store.db.exec("UPDATE runs SET status='recovery_required',error_code='NATIVE_QUESTION_UNRESOLVED',updated_at=? WHERE id=?",this.core.now(),run.id);
    }else if(run.status==='waiting'){
     // Disabled admission pauses the timer; it must not discard durable work.
     if(!this.core.options.executionEnabled)continue;
     this.store.db.exec("UPDATE runs SET status='queued',updated_at=? WHERE id=?",this.core.now(),run.id);
     this.store.db.exec("UPDATE lifecycle SET queue_sequence=queue_sequence+1,desired_state='RUN',phase=CASE WHEN phase='DRAINING' THEN 'READY' ELSE phase END,stop_token=CASE WHEN phase='DRAINING' THEN NULL ELSE stop_token END,wake_after_stop=CASE WHEN phase IN ('STOP_COMMITTED','STOPPING') THEN 1 ELSE wake_after_stop END WHERE singleton=1");
    }
    this.store.db.exec('DELETE FROM retry_queue WHERE run_id=?',run.id);
   }
  });
 }
 private retainNativeMemoryRefusals(runId?:string,identity?:Identity):void {
  // Called inside the recovery transaction, before replacing its error code.
  // SQL copies only exact attempt identity and a constant reason, never context.
  this.store.db.exec(`INSERT INTO runtime_metadata(key,value_json)
   SELECT 'native_context_unavailable:'||r.id||':'||r.current_attempt,? FROM runs r
   JOIN native_task_links n ON n.run_id=r.id AND n.parent_run_id=r.parent_run_id
   JOIN attempts a ON a.run_id=r.id AND a.attempt=r.current_attempt AND a.native_run_ref=n.native_run_ref
   WHERE r.role='background' AND r.error_code='MEMORY_PREPARATION_LIMIT'
    AND r.status IN ('claimed','running','finishing','cancelling')
    ${runId?'AND r.id=?':''} ${identity?'AND a.epoch=? AND a.boot_id=?':''}
   ON CONFLICT(key) DO NOTHING`,JSON.stringify('MEMORY_PREPARATION_LIMIT'),...(runId?[runId]:[]),...(identity?[identity.epoch,identity.boot_id]:[]));
 }
 watchdog():void {
  this.store.db.transaction(()=>{
   const now=this.core.now(),state=this.get();
   this.core.ownerAlpha.propagateCancellation();
   const current=this.core.ownerAlpha.activeGeneration();
   const generationFence=current?' AND epoch=? AND boot_id=?':'';
   const overdue=this.store.db.all<{run_id:string}>(`SELECT run_id FROM attempts WHERE status IN ('claimed','running') AND deadline_at<=?${generationFence}`,now,...(current?[current.epoch,current.boot_id]:[]));
   const ops=this.store.db.all<{run_id:string}>(`SELECT DISTINCT o.run_id FROM operations o JOIN attempts a ON a.run_id=o.run_id AND a.attempt=o.attempt WHERE o.status='active' AND o.deadline_at<=?${current?' AND a.epoch=? AND a.boot_id=?':''}`,now,...(current?[current.epoch,current.boot_id]:[]));
   for(const id of new Set([...overdue,...ops].map(x=>x.run_id)))this.store.db.exec("UPDATE runs SET status='cancelling',error_code='DEADLINE_EXCEEDED',updated_at=? WHERE id=? AND status IN ('claimed','running','finishing')",now,id);
   this.core.questions.expireCallbacks();
   const cancelledBefore=new Date(this.core.options.now().getTime()-30000).toISOString();
   const unsettled=this.store.db.all<{id:string}>(`SELECT r.id FROM runs r WHERE r.status='cancelling' AND r.updated_at<=? ${current?'AND EXISTS(SELECT 1 FROM attempts a WHERE a.run_id=r.id AND a.attempt=r.current_attempt AND a.epoch=? AND a.boot_id=?)':''}`,cancelledBefore,...(current?[current.epoch,current.boot_id]:[]));
   if(unsettled.length){
    for(const run of unsettled){
     this.retainNativeMemoryRefusals(run.id);
     this.store.db.exec("UPDATE runs SET status='recovery_required',error_code=CASE WHEN error_code IN ('OWNER_CANCELLED','CONTEXT_INVALIDATED') THEN error_code ELSE 'CANCEL_UNCONFIRMED' END,updated_at=? WHERE id=?",now,run.id);
    }
    // An unconfirmed task cancellation cannot terminate unrelated native work.
    for(const run of unsettled)this.store.db.exec("UPDATE effects SET status='outcome_unknown',updated_at=? WHERE run_id=? AND status IN ('intent','dispatched')",now,run.id);
   }
   if(state.lease_until&&state.lease_until<=now&&['READY','DRAINING','BOOTING','START_REQUESTED'].includes(state.phase)){
    this.retainNativeMemoryRefusals(undefined,current??undefined);
    this.store.db.exec("UPDATE lifecycle SET phase='RECOVERY_REQUIRED',desired_state='STOP' WHERE singleton=1");
    this.store.db.exec(`UPDATE runs SET status='recovery_required',error_code=CASE WHEN error_code IN ('OWNER_CANCELLED','CONTEXT_INVALIDATED') THEN error_code ELSE 'STALE_EPOCH' END,updated_at=? WHERE status IN ('claimed','running','finishing','cancelling') ${current?'AND EXISTS(SELECT 1 FROM attempts a WHERE a.run_id=runs.id AND a.attempt=runs.current_attempt AND a.epoch=? AND a.boot_id=?)':''}`,now,...(current?[current.epoch,current.boot_id]:[]));
    this.store.db.exec(`UPDATE effects SET status='outcome_unknown',updated_at=? WHERE status IN ('intent','dispatched') ${current?'AND EXISTS(SELECT 1 FROM runs r JOIN attempts a ON a.run_id=r.id AND a.attempt=r.current_attempt WHERE r.id=effects.run_id AND a.epoch=? AND a.boot_id=?)':''}`,now,...(current?[current.epoch,current.boot_id]:[]));
   }
  });
 }
 /** Only provider-confirmed process termination permits clearing live operation leases. */
 observeStopped(observation:RuntimeObservation):void {
  requireThat(observation.executionStopped&&observation.persistentState==='retained','CAPABILITY_UNAVAILABLE','Provider has not confirmed a retained, stopped runtime.');
  this.store.db.transaction(()=>{
   const state=this.get();requireThat(['STOPPING','STOP_COMMITTED','RECOVERY_REQUIRED','STOPPED'].includes(state.phase),'REVISION_CONFLICT','Unexpected stop observation.');
   this.store.db.exec("UPDATE lifecycle SET phase='STOPPED',boot_id=NULL,lease_until=NULL,stop_token=NULL,provider_operation_id=NULL WHERE singleton=1");
   this.store.db.exec("UPDATE operations SET status='settled' WHERE status!='settled'");
   // Process termination does not settle a remote effect. Without a per-effect
   // resource mapping, retain every lock owned by an unresolved effect's task.
   this.store.db.exec("DELETE FROM resource_locks WHERE NOT EXISTS(SELECT 1 FROM effects e WHERE e.run_id=resource_locks.run_id AND e.status IN ('intent','dispatched','outcome_unknown'))");
   this.store.db.exec("UPDATE attempts SET status='terminated',settled_at=? WHERE status IN ('claimed','running')",this.core.now());
   this.store.db.exec("UPDATE effects SET status='outcome_unknown',updated_at=? WHERE status IN ('intent','dispatched')",this.core.now());
   this.retainNativeMemoryRefusals();
   this.store.db.exec("UPDATE runs SET status='recovery_required',error_code=CASE WHEN error_code IN ('OWNER_CANCELLED','CONTEXT_INVALIDATED') THEN error_code ELSE 'OUTCOME_UNKNOWN' END,updated_at=? WHERE status IN ('claimed','running','finishing','cancelling')",this.core.now());
   for(const run of this.store.db.all<Pick<Run,'id'|'role'|'current_attempt'|'error_code'>>("SELECT id,role,current_attempt,error_code FROM runs WHERE status='recovery_required'"))this.scheduleRetry(run,run.error_code??'OUTCOME_UNKNOWN');
  });
 }
 private async requestWake(provider:RuntimeProvider,ref:RuntimeRef,state:Lifecycle):Promise<void> {
  const operation=this.core.options.uuid(),epoch=state.epoch+1;
  this.store.db.transaction(()=>{this.store.db.exec("UPDATE lifecycle SET phase='START_REQUESTED',epoch=?,boot_id=NULL,provider_operation_id=?,wake_after_stop=0,lease_until=? WHERE singleton=1",epoch,operation,new Date(this.core.options.now().getTime()+120000).toISOString());this.store.db.exec("INSERT INTO controller_operations(id,kind,epoch,status,created_at) VALUES(?,'wake',?,'pending',?)",operation,epoch,this.core.now());});
  try{await provider.wake(ref,{operationId:operation,epoch});this.store.db.exec("UPDATE lifecycle SET phase='BOOTING',lease_until=? WHERE singleton=1 AND provider_operation_id=? AND phase='START_REQUESTED'",new Date(this.core.options.now().getTime()+120000).toISOString(),operation);this.store.db.exec("UPDATE controller_operations SET status='submitted' WHERE id=?",operation);}
  catch(error){this.store.db.exec("UPDATE controller_operations SET status='unknown',error_code='TEMPORARY_UNAVAILABLE' WHERE id=?",operation);this.store.db.exec("UPDATE lifecycle SET phase='RECOVERY_REQUIRED',desired_state='STOP' WHERE singleton=1 AND provider_operation_id=?",operation);throw error;}
 }
 async drive(provider:RuntimeProvider):Promise<void> {
  this.watchdog();this.retryDue();let state=this.get();const ref=JSON.parse(state.provider_ref_json) as RuntimeRef;
  if(!this.core.options.executionEnabled)return;
  if(this.options.idleMode){
   requireThat(provider.capabilities.stopMode==='provider-idle','CAPABILITY_UNAVAILABLE','Provider idle mode does not match the configured lifecycle.');
   requireThat(!['RECOVERY_REQUIRED','STOPPING','STOP_COMMITTED'].includes(state.phase),'CAPABILITY_UNAVAILABLE','Unsettled work needs explicit recovery; provider idle cannot prove termination.');
   const queued=Boolean(this.nextClaimableRun());
   if(!queued||!['STOPPED','IDLE_PERMITTED'].includes(state.phase))return;
   requireThat(state.phase==='IDLE_PERMITTED'||state.epoch===0,'CAPABILITY_UNAVAILABLE','Existing ownership requires a clean idle handoff.');
   requireThat(!this.store.db.all("SELECT id FROM runs WHERE status IN ('claimed','running','finishing','cancelling') LIMIT 1").length&&!this.store.db.all("SELECT id FROM operations WHERE status!='settled' LIMIT 1").length,'CAPABILITY_UNAVAILABLE','Live work prevents idle admission.');
   const observedState=state,idleObservation=await provider.observe(ref);state=this.get();
   // Observation is an await boundary. A different alarm/boot may have won.
   if(state.epoch!==observedState.epoch||state.boot_id!==observedState.boot_id||state.provider_ref_json!==observedState.provider_ref_json||state.provider_operation_id!==observedState.provider_operation_id)return;
   if(!['STOPPED','IDLE_PERMITTED'].includes(state.phase)||!this.nextClaimableRun())return;
   requireThat(provider.capabilities.explicitWake&&idleObservation.persistentState==='retained'&&(idleObservation.phase==='running'||idleObservation.executionPaused===true),'CAPABILITY_UNAVAILABLE','The same persistent runtime is not confirmed available.');
   await this.requestWake(provider,ref,state);return;
  }
  const observedState=state,observation=await provider.observe(ref);
  state=this.get();
  if(state.epoch!==observedState.epoch||state.boot_id!==observedState.boot_id||state.provider_ref_json!==observedState.provider_ref_json||state.provider_operation_id!==observedState.provider_operation_id)return;
  if(observation.executionStopped&&['STOPPING','STOP_COMMITTED','RECOVERY_REQUIRED'].includes(state.phase)){this.observeStopped(observation);state=this.get();}
  if(state.phase==='STOPPED'&&this.nextClaimableRun()){
   requireThat(provider.capabilities.explicitWake&&provider.capabilities.explicitStop&&provider.capabilities.confirmedStop,'CAPABILITY_UNAVAILABLE','This provider needs a verified lifecycle bridge before execution.');
   requireThat(observation.executionStopped&&observation.persistentState==='retained','CAPABILITY_UNAVAILABLE','Existing runtime ownership is uncertain.');
   await this.requestWake(provider,ref,state);
  }else if(['STOP_COMMITTED','RECOVERY_REQUIRED'].includes(state.phase)&&!observation.executionStopped){
   requireThat(provider.capabilities.explicitStop,'CAPABILITY_UNAVAILABLE','Provider cannot explicitly stop this runtime.');
   const operation=this.core.options.uuid();
   this.store.db.transaction(()=>{this.store.db.exec("UPDATE lifecycle SET phase='STOPPING',provider_operation_id=? WHERE singleton=1",operation);this.store.db.exec("INSERT INTO controller_operations(id,kind,epoch,status,created_at) VALUES(?,'stop',?,'pending',?)",operation,state.epoch,this.core.now());});
   try{await provider.stop(ref,{operationId:operation,epoch:state.epoch});this.store.db.exec("UPDATE controller_operations SET status='submitted' WHERE id=?",operation);}
   catch(error){this.store.db.exec("UPDATE controller_operations SET status='unknown',error_code='TEMPORARY_UNAVAILABLE' WHERE id=?",operation);this.store.db.exec("UPDATE lifecycle SET phase='RECOVERY_REQUIRED' WHERE singleton=1 AND provider_operation_id=?",operation);throw error;}
  }
 }
}
