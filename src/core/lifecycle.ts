import { ControlError, requireThat } from './errors';
import { Store } from './store';
import type { ControlCore } from './control';
import type { ContextSnapshot, Operation, Run } from './types';
import type { RuntimeProvider, RuntimeRef, RuntimeObservation } from '../providers';
export type Phase='STOPPED'|'START_REQUESTED'|'BOOTING'|'READY'|'DRAINING'|'STOP_COMMITTED'|'STOPPING'|'RECOVERY_REQUIRED'|'IDLE_PERMITTED';
export type Lifecycle={singleton:number;provider_ref_json:string;boot_id:string|null;epoch:number;phase:Phase;desired_state:'RUN'|'STOP';lease_until:string|null;last_heartbeat:string|null;queue_sequence:number;stop_token:string|null;provider_operation_id:string|null;wake_after_stop:number};
export type Identity={epoch:number;boot_id:string};
export type HeartbeatOperation=Operation & {run_id:string;attempt:number};
export class LifecycleCore {
 constructor(public store:Store,public core:ControlCore,private options:{idleMode?:boolean}={}){}
 get():Lifecycle{return this.store.db.all<Lifecycle>('SELECT * FROM lifecycle WHERE singleton=1')[0];}
 initialize(ref:RuntimeRef|Record<string,never>):void{this.store.db.exec("INSERT OR IGNORE INTO lifecycle(singleton,provider_ref_json,epoch,phase,desired_state,queue_sequence,wake_after_stop) VALUES(1,?,0,'STOPPED','STOP',0,0)",JSON.stringify(ref));}
 private active():boolean{
  const budget=this.core.budget.admissionPredicate();
  return this.store.db.all("SELECT resource_id FROM resource_locks LIMIT 1").length>0 || this.store.db.all(`SELECT r.id FROM runs r WHERE r.status IN ('claimed','running','finishing','cancelling','recovery_required') OR (r.status='queued' AND (${budget.sql})) LIMIT 1`,...budget.bindings).length>0 || this.store.db.all("SELECT id FROM operations WHERE status!='settled' LIMIT 1").length>0 || this.store.db.all("SELECT e.id FROM effects e JOIN runs r ON r.id=e.run_id WHERE e.status IN ('intent','dispatched') OR (e.status='outcome_unknown' AND r.status IN ('claimed','running','finishing','cancelling')) LIMIT 1").length>0;
 }
 nextClaimableRun():Run|undefined {
  return this.store.db.transaction(()=>{
   const cutoff=new Date(this.core.options.now().getTime()-90*86400000).toISOString(),budget=this.core.budget.admissionPredicate();
   return this.store.db.all<Run>(`SELECT r.* FROM runs r LEFT JOIN commands c ON c.id=r.command_id WHERE r.role='coordinator' AND r.status='queued' AND (r.current_attempt>0 OR COALESCE(c.accepted_at,r.created_at)>?) AND (${budget.sql}) ORDER BY r.created_at,r.id LIMIT 1`,cutoff,...budget.bindings)[0];
  });
 }
 private touch():void{this.store.db.exec("INSERT INTO runtime_metadata(key,value_json) VALUES('last_activity',?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json",JSON.stringify(this.core.now()));}
 private identity(identity:Identity,allowBoot=false):Lifecycle {
  const state=this.get();
  requireThat(Number.isSafeInteger(identity.epoch)&&identity.epoch===state.epoch&&identity.boot_id===state.boot_id,'STALE_EPOCH','The executor no longer owns this runtime.');
  requireThat(state.lease_until!==null&&state.lease_until>this.core.now(),'STALE_EPOCH','The executor lease expired.');
  requireThat((allowBoot?['BOOTING','READY','DRAINING']:['READY','DRAINING']).includes(state.phase),'STALE_EPOCH','Runtime admission is closed.');return state;
 }
 authorizeAttempt(identity:Identity,runId:string,attempt:number):void {
  this.identity(identity);
  const row=this.store.db.all<{epoch:number;boot_id:string}>('SELECT epoch,boot_id FROM attempts WHERE run_id=? AND attempt=?',runId,attempt)[0];
  requireThat(row,'REVISION_CONFLICT','Attempt is unavailable.');
  requireThat(row.epoch===identity.epoch&&row.boot_id===identity.boot_id,'STALE_EPOCH','Attempt belongs to a different executor.');
 }
 registerBoot(bootId:string):Identity {
  return this.store.db.transaction(()=>{
   const state=this.get();requireThat(state.phase==='BOOTING','STALE_EPOCH','No boot is expected.');
   requireThat(state.lease_until!==null&&state.lease_until>this.core.now(),'STALE_EPOCH','The expected boot window expired.');
   requireThat(!state.boot_id||state.boot_id===bootId,'STALE_EPOCH','Another boot already owns this epoch.');
   requireThat(/^[0-9a-f-]{36}$/i.test(bootId),'INVALID_INPUT','Invalid boot identity.',422);
   this.store.db.exec('UPDATE lifecycle SET boot_id=?,lease_until=?,last_heartbeat=? WHERE singleton=1',bootId,new Date(this.core.options.now().getTime()+90000).toISOString(),this.core.now());
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
   for(const op of operations){
    const run=this.store.run(op.run_id);
    requireThat(run.current_attempt===op.attempt&&['claimed','running','finishing','cancelling','recovery_required'].includes(run.status),'STALE_EPOCH','Operation does not belong to an active attempt.');
    const attempt=this.store.db.all<{epoch:number;boot_id:string}>('SELECT epoch,boot_id FROM attempts WHERE run_id=? AND attempt=?',run.id,op.attempt)[0];
    requireThat(attempt?.epoch===identity.epoch&&attempt.boot_id===identity.boot_id,'STALE_EPOCH','Attempt belongs to a different executor.');
    const old=this.store.db.all<{run_id:string;attempt:number;status:string}>('SELECT run_id,attempt,status FROM operations WHERE id=?',op.id)[0];
    requireThat(!old||old.run_id===run.id&&old.attempt===op.attempt,'INVALID_INPUT','Operation identity was reused.',422);
    requireThat(old?.status!=='settled'||op.status==='settled','INVALID_INPUT','A settled operation cannot become active.',422);
    this.store.db.exec('INSERT INTO operations(id,run_id,attempt,kind,status,started_at,deadline_at,last_progress_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,last_progress_at=excluded.last_progress_at',op.id,run.id,op.attempt,op.kind,op.status,op.started_at,op.deadline_at,op.last_progress_at);
   }
   const lease=new Date(this.core.options.now().getTime()+90000).toISOString();
   this.store.db.exec('UPDATE lifecycle SET lease_until=?,last_heartbeat=? WHERE singleton=1',lease,this.core.now());
   if(this.active())this.touch();
   return {lease_until:lease,cancellations:this.store.db.all<{id:string}>("SELECT id FROM runs WHERE status IN ('cancelling','recovery_required')").map(x=>x.id)};
  });
 }
 claim(identity:Identity):{run:Run;submission_key:string;deadline_at:string}|null {
  return this.store.db.transaction(()=>{
   const state=this.identity(identity);requireThat(state.phase==='READY','STALE_EPOCH','Runtime is draining.');
   requireThat(this.core.options.executionEnabled,'CAPABILITY_UNAVAILABLE','Execution has not been enabled.');
   if(this.store.db.all("SELECT id FROM runs WHERE role='coordinator' AND status IN ('claimed','running','finishing','cancelling') LIMIT 1").length)return null;
   const run=this.nextClaimableRun();if(!run)return null;
   const prior=JSON.parse(run.context_json) as Pick<ContextSnapshot,'instruction'|'room_id'>;
   const context=this.core.context(run.persona_id,prior.instruction,run.routine_id,prior.room_id);
   const attempt=run.current_attempt+1,submissionKey=`${run.id}:${attempt}`,deadline=new Date(this.core.options.now().getTime()+20*60000).toISOString();
   this.store.db.exec("UPDATE runs SET status='claimed',current_attempt=?,context_json=?,updated_at=? WHERE id=?",attempt,JSON.stringify(context),this.core.now(),run.id);
   this.store.db.exec("INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,status,deadline_at,started_at) VALUES(?,?,?,?,?,'claimed',?,?)",run.id,attempt,submissionKey,identity.epoch,identity.boot_id,deadline,this.core.now());
   if(run.occurrence_id)this.store.db.exec("UPDATE occurrences SET status='claimed' WHERE id=?",run.occurrence_id);
   for(const event of context.context_events)this.store.db.exec('UPDATE consumer_cursors SET consumed_sequence=MAX(consumed_sequence,?) WHERE consumer_id=? AND conversation_id=?',event.sequence,run.persona_id,context.room_id);
   this.touch();return {run:this.store.run(run.id),submission_key:submissionKey,deadline_at:deadline};
  });
 }
 submitted(identity:Identity,runId:string,attempt:number,nativeRef:string):void {
  this.store.db.transaction(()=>{
   this.authorizeAttempt(identity,runId,attempt);const run=this.store.run(runId);
   requireThat(run.current_attempt===attempt&&run.status==='claimed','REVISION_CONFLICT','Run is not awaiting submission.');
   const row=this.store.db.all<{native_run_ref:string|null}>('SELECT native_run_ref FROM attempts WHERE run_id=? AND attempt=?',runId,attempt)[0];
   requireThat(row.native_run_ref===null||row.native_run_ref===nativeRef,'REVISION_CONFLICT','Native submission identity already belongs to a different receipt.');
   this.store.db.exec("UPDATE attempts SET native_run_ref=?,status='running' WHERE run_id=? AND attempt=?",nativeRef,runId,attempt);
   this.store.db.exec("UPDATE runs SET status='running',updated_at=? WHERE id=?",this.core.now(),runId);this.touch();
  });
 }
 complete(identity:Identity,runId:string,attempt:number,result:{status:'completed'|'failed'|'cancelled'|'waiting';text:string;error_code?:string;checkpoint?:Record<string,unknown>}):void {
  this.store.db.transaction(()=>{
   this.authorizeAttempt(identity,runId,attempt);const run=this.store.run(runId);
   requireThat(run.current_attempt===attempt,'REVISION_CONFLICT','Attempt has changed.');
   if(['completed','failed','cancelled'].includes(run.status))return;
   requireThat(['claimed','running','finishing','cancelling','recovery_required'].includes(run.status),'REVISION_CONFLICT','Run is not active.');
   requireThat(!this.store.db.all("SELECT id FROM operations WHERE run_id=? AND attempt=? AND status!='settled'",runId,attempt).length,'CANCEL_UNCONFIRMED','Live operations have not settled.');
   requireThat(!this.store.db.all('SELECT resource_id FROM resource_locks WHERE run_id=?',runId).length,'RESOURCE_BUSY','Release scoped resources after tool settlement before completing.');
   requireThat(!this.store.db.all("SELECT id FROM effects WHERE run_id=? AND status IN ('intent','dispatched','outcome_unknown')",runId).length,'OUTCOME_UNKNOWN','An external effect needs reconciliation.');
   requireThat(result.status!=='waiting'||result.checkpoint,'INVALID_INPUT','Waiting requires a durable checkpoint.',422);
   if(['OWNER_CANCELLED','CONTEXT_INVALIDATED'].includes(run.error_code??'')){
    requireThat(result.status==='cancelled','CONTEXT_INVALIDATED','Cancellation must settle before any result is published.');
    result={status:'cancelled',text:'',error_code:run.error_code!};
   }
   const now=this.core.now();
   this.store.db.exec('UPDATE attempts SET status=?,settled_at=?,result_json=? WHERE run_id=? AND attempt=?',result.status,now,JSON.stringify(result),runId,attempt);
   this.store.db.exec('UPDATE runs SET status=?,error_code=?,checkpoint_json=?,updated_at=? WHERE id=?',result.status,result.error_code??null,result.checkpoint?JSON.stringify(result.checkpoint):null,now,runId);
   this.store.db.exec("INSERT INTO outbox(id,run_id,destination,payload_json,status,created_at,updated_at) VALUES(?,?,'portal',?,'delivered',?,?) ON CONFLICT(run_id,destination) DO UPDATE SET payload_json=excluded.payload_json,status='delivered',updated_at=excluded.updated_at",this.core.options.uuid(),runId,JSON.stringify(result),now,now);
   this.store.event(this.core.options.uuid(),run.persona_id,'run.result','runtime',run.command_id,{run_id:runId,role:run.role,title:run.title,...result},now);
   if(['completed','failed','cancelled'].includes(result.status))this.core.flushFollowups(runId);
   if(run.occurrence_id&&result.status!=='waiting')this.store.db.exec('UPDATE occurrences SET status=? WHERE id=?',result.status==='completed'?'completed':'failed',run.occurrence_id);
   if(result.status==='failed'&&result.error_code)this.scheduleRetry(this.store.run(runId),result.error_code);
   this.touch();
  });
 }
 prepareSleep(identity:Identity):{stop_token:string;queue_sequence:number} {
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
  this.store.db.transaction(()=>{
   const state=this.identity(identity);
   requireThat(state.phase==='DRAINING'&&state.stop_token===token&&state.queue_sequence===queueSequence&&!this.active(),'SLEEP_DENIED','New work or activity invalidated the stop.');
   requireThat(Object.keys(checkpoint).length>0,'INVALID_INPUT','A checkpoint receipt is required.',422);
   this.store.db.exec("INSERT INTO runtime_metadata(key,value_json) VALUES('checkpoint',?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json",JSON.stringify(checkpoint));
   if(this.options.idleMode)this.store.db.exec("UPDATE lifecycle SET phase='IDLE_PERMITTED',desired_state='STOP',boot_id=NULL,lease_until=NULL WHERE singleton=1");
   else this.store.db.exec("UPDATE lifecycle SET phase='STOP_COMMITTED',desired_state='STOP' WHERE singleton=1");
  });
 }
 private scheduleRetry(run:Run,reason:string):void {
  if(run.role==='background'||run.current_attempt>=3 || !['TEMPORARY_UNAVAILABLE','DEADLINE_EXCEEDED','STALE_EPOCH','CANCEL_UNCONFIRMED'].includes(reason))return;
  const effects=this.store.db.all<{classification:string;status:string;receipt_json:string|null}>('SELECT classification,status,receipt_json FROM effects WHERE run_id=?',run.id);
  if(effects.some(x=>['intent','dispatched','outcome_unknown'].includes(x.status)||x.classification==='mutation'||x.classification==='idempotent'&&!x.receipt_json))return;
  if(this.store.db.all("SELECT id FROM operations WHERE run_id=? AND status!='settled'",run.id).length)return;
  const due=new Date(this.core.options.now().getTime()+(run.current_attempt<=1?10000:60000)).toISOString();
  this.store.db.exec('INSERT INTO retry_queue(run_id,due_at,reason) VALUES(?,?,?) ON CONFLICT(run_id) DO NOTHING',run.id,due,reason);
  this.store.db.exec("UPDATE runs SET status='waiting',error_code=?,checkpoint_json=?,updated_at=? WHERE id=?",reason,JSON.stringify({retry_at:due}),this.core.now(),run.id);
 }
 retryDue():void {
  this.store.db.transaction(()=>{
   for(const retry of this.store.db.all<{run_id:string}>('SELECT run_id FROM retry_queue WHERE due_at<=?',this.core.now())){
    const run=this.store.run(retry.run_id);
    if(run.status==='waiting'&&this.core.options.executionEnabled){
     this.store.db.exec("UPDATE runs SET status='queued',updated_at=? WHERE id=?",this.core.now(),run.id);
     this.store.db.exec("UPDATE lifecycle SET queue_sequence=queue_sequence+1,desired_state='RUN',phase=CASE WHEN phase='DRAINING' THEN 'READY' ELSE phase END,stop_token=CASE WHEN phase='DRAINING' THEN NULL ELSE stop_token END,wake_after_stop=CASE WHEN phase IN ('STOP_COMMITTED','STOPPING') THEN 1 ELSE wake_after_stop END WHERE singleton=1");
    }
    this.store.db.exec('DELETE FROM retry_queue WHERE run_id=?',run.id);
   }
  });
 }
 watchdog():void {
  this.store.db.transaction(()=>{
   const now=this.core.now(),state=this.get();
   const overdue=this.store.db.all<{run_id:string}>("SELECT run_id FROM attempts WHERE status IN ('claimed','running') AND deadline_at<=?",now);
   const ops=this.store.db.all<{run_id:string}>("SELECT DISTINCT run_id FROM operations WHERE status='active' AND deadline_at<=?",now);
   for(const id of new Set([...overdue,...ops].map(x=>x.run_id)))this.store.db.exec("UPDATE runs SET status='cancelling',error_code='DEADLINE_EXCEEDED',updated_at=? WHERE id=? AND status IN ('claimed','running','finishing')",now,id);
   const cancelledBefore=new Date(this.core.options.now().getTime()-30000).toISOString();
   const unsettled=this.store.db.all<Run>("SELECT * FROM runs WHERE status='cancelling' AND updated_at<=?",cancelledBefore);
   if(unsettled.length){
    for(const run of unsettled)this.store.db.exec("UPDATE runs SET status='recovery_required',error_code=CASE WHEN error_code IN ('OWNER_CANCELLED','CONTEXT_INVALIDATED') THEN error_code ELSE 'CANCEL_UNCONFIRMED' END,updated_at=? WHERE id=?",now,run.id);
    // An unconfirmed task cancellation cannot terminate unrelated native work.
    for(const run of unsettled)this.store.db.exec("UPDATE effects SET status='outcome_unknown',updated_at=? WHERE run_id=? AND status IN ('intent','dispatched')",now,run.id);
   }
   if(state.lease_until&&state.lease_until<=now&&['READY','DRAINING','BOOTING','START_REQUESTED'].includes(state.phase)){
    this.store.db.exec("UPDATE lifecycle SET phase='RECOVERY_REQUIRED',desired_state='STOP' WHERE singleton=1");
    this.store.db.exec("UPDATE runs SET status='recovery_required',error_code=CASE WHEN error_code IN ('OWNER_CANCELLED','CONTEXT_INVALIDATED') THEN error_code ELSE 'STALE_EPOCH' END,updated_at=? WHERE status IN ('claimed','running','finishing','cancelling')",now);
    this.store.db.exec("UPDATE effects SET status='outcome_unknown',updated_at=? WHERE status IN ('intent','dispatched')",now);
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
   this.store.db.exec('DELETE FROM resource_locks');
   this.store.db.exec("UPDATE attempts SET status='terminated',settled_at=? WHERE status IN ('claimed','running')",this.core.now());
   this.store.db.exec("UPDATE effects SET status='outcome_unknown',updated_at=? WHERE status IN ('intent','dispatched')",this.core.now());
   this.store.db.exec("UPDATE runs SET status='recovery_required',error_code='OUTCOME_UNKNOWN',updated_at=? WHERE status IN ('claimed','running','finishing','cancelling')",this.core.now());
   for(const run of this.store.db.all<Run>("SELECT * FROM runs WHERE status='recovery_required'"))this.scheduleRetry(run,run.error_code??'OUTCOME_UNKNOWN');
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
   const idleObservation=await provider.observe(ref);state=this.get();
   // Observation is an await boundary. A different alarm/boot may have won.
   if(!['STOPPED','IDLE_PERMITTED'].includes(state.phase)||!this.nextClaimableRun())return;
   requireThat(provider.capabilities.explicitWake&&idleObservation.persistentState==='retained'&&(idleObservation.phase==='running'||idleObservation.executionPaused===true),'CAPABILITY_UNAVAILABLE','The same persistent runtime is not confirmed available.');
   await this.requestWake(provider,ref,state);return;
  }
  const observation=await provider.observe(ref);
  state=this.get();
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
