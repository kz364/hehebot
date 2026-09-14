import { createHash } from 'node:crypto';
import validateCommand from '../generated/validate-command.js';
import { ControlError, requireThat, safeError } from './errors';
import { Store } from './store';
import { dueOccurrences, nextDue, preview, validateSchedule } from './schedule';
import {SkillCatalog} from './skills';
import {BudgetLedger} from './budget';
import {controlMonitoring} from './monitoring';
import {TaskSteering} from './task-steering';
import {nativeDescendantsSettledSql} from './native-tasks';
import {EffectLedger} from './effects';
import type { Command, ContextSnapshot, MemoryPut, Options, PersonaPut, Receipt, RoomPut, RoomPublish, RoutinePut, Run, StoredObject, TimelineEvent } from './types';
// Copied followups retain their original command age, not their later queue time.
const queuedContextDueSql = `CASE WHEN json_type(r.context_json,'$.persona') IS NOT NULL
 THEN MIN(strftime('%Y-%m-%dT%H:%M:%fZ',r.created_at,'+30 days'),strftime('%Y-%m-%dT%H:%M:%fZ',COALESCE(c.accepted_at,r.created_at),'+90 days'))
 ELSE strftime('%Y-%m-%dT%H:%M:%fZ',COALESCE(c.accepted_at,r.created_at),'+90 days') END`;
export const DEFAULT_BOTS = [
 {id:'11111111-1111-4111-8111-111111111111',name:'Chief of Staff',instructions:'Coordinate the owner’s requests. Keep actions within explicit authorization.'},
 {id:'22222222-2222-4222-8222-222222222222',name:'Inbox Triage',instructions:'Review and organize information. Draft outgoing messages unless sending is explicitly authorized.'},
 {id:'33333333-3333-4333-8333-333333333333',name:'Travel',instructions:'Research and plan travel. Do not book or spend without explicit authorization.'}
];
export function parseCommand(value:unknown):Command {
 requireThat(validateCommand(value),'INVALID_INPUT','The command contains invalid or missing fields.',422);
 const command=value as Command;
 if(command.type==='message.send'||command.type==='run.steer') requireThat(new TextEncoder().encode(command.payload.text).length<=32768,'PAYLOAD_TOO_LARGE','Message exceeds 32768 bytes.',413);
 return command;
}
export class ControlCore {
 readonly budget:BudgetLedger;
 constructor(public store:Store,public options:Options){this.budget=new BudgetLedger(store,()=>this.now(),options.uuid);}
 now(){return this.options.now().toISOString();}
 seed():void {
  const count=this.store.db.all<{n:number}>('SELECT COUNT(*) AS n FROM objects')[0].n;
  if(count)return;
  this.store.db.transaction(()=>{for(const bot of DEFAULT_BOTS)this.store.put(bot.id,'persona',{...bot,expected_revision:0,tool_policy_ids:[],archived:false},0,'system',this.now());});
 }
 receipt(id:string):Receipt {
  const row=this.store.db.all<{id:string;status:Receipt['status'];accepted_at:string;resource_id:string|null;error_json:string|null}>('SELECT id,status,accepted_at,resource_id,error_json FROM commands WHERE id=?',id)[0];
  requireThat(row,'NOT_FOUND','Receipt unavailable.',404);
  return {id:row.id,status:row.status,accepted_at:row.accepted_at,resource_id:row.resource_id,error:row.error_json?JSON.parse(row.error_json):null};
 }
 accept(owner:string,key:string,hash:string,input:unknown):Receipt {
  requireThat(key.length>=16 && key.length<=128,'INVALID_INPUT','An idempotency key of 16–128 characters is required.',422);
  const command=parseCommand(input);
  const existing=this.store.db.all<{id:string;body_hash:string}>('SELECT id,body_hash FROM commands WHERE owner_id=? AND idempotency_key=?',owner,key)[0];
  if(existing){requireThat(existing.body_hash===hash,'IDEMPOTENCY_CONFLICT','This key was already used for different content.');return this.receipt(existing.id);}
  const id=this.options.uuid(),now=this.now();
  const insert=(status:Receipt['status'],resource:string|null,error:unknown)=>this.store.db.exec('INSERT INTO commands(id,owner_id,idempotency_key,body_hash,type,payload_json,status,accepted_at,resource_id,error_json) VALUES(?,?,?,?,?,?,?,?,?,?)',id,owner,key,hash,command.type,JSON.stringify(command.payload),status,now,resource,error?JSON.stringify(error):null);
  try {
   this.store.db.transaction(()=>{
    insert('accepted',null,null);
    const resource=this.apply(owner,id,command);
    this.store.db.exec("UPDATE commands SET status='applied',resource_id=? WHERE id=?",resource,id);
   });
  }catch(error){
   if(!(error instanceof ControlError))throw error;
   this.store.db.transaction(()=>insert('rejected',null,safeError(error)));
  }
  return this.receipt(id);
 }
 private apply(owner:string,commandId:string,command:Command):string {
  const now=this.now();
  const skills=new SkillCatalog(this.store,()=>this.now(),this.options.uuid);
  switch(command.type){
   case 'effect.reconcile':{
    const p=command.payload,id=new EffectLedger(this.store,()=>this.now()).reconcileStopped(owner,commandId,p);
    this.store.event(this.options.uuid(),this.store.run(p.run_id).persona_id,'effect.owner_reconciled',owner,commandId,
     {run_id:p.run_id,effect_id:id,attempt:p.expected_attempt,outcome:p.outcome},now);return id;
   }
   case 'budget.set':{
    const id=this.budget.set(owner,commandId,command.payload);this.reconcileBudget();return id;
   }
   case 'budget.override':{
    requireThat(this.budget.summary().revision===command.payload.expected_revision,'REVISION_CONFLICT','The budget policy changed. Review it before allowing this run.');
    const id=this.budget.override(owner,commandId,command.payload.run_id);this.reconcileBudget();return id;
   }
   case 'skill.propose':return skills.propose(owner,commandId,command.payload);
   case 'skill.review':return skills.review(owner,commandId,command.payload);
   case 'skill.enable':return skills.enable(owner,commandId,command.payload);
   case 'skill.delete':return skills.remove(owner,commandId,command.payload);
   case 'skill.restore':return skills.restore(owner,commandId,command.payload);
   case 'setup.adopt': {
    const p=command.payload;
    requireThat(createHash('sha256').update(JSON.stringify(p.commands)).digest('hex')===p.reviewed_hash,'REVISION_CONFLICT','The reviewed import changed.');
    requireThat(new Set(p.commands.map(x=>x.payload.id)).size===p.commands.length,'INVALID_INPUT','Import contains repeated object IDs.',422);
    for(const item of p.commands){
     if(item.type==='persona.put')requireThat(!item.payload.tool_policy_ids.length&&!item.payload.archived,'FORBIDDEN','Import cannot grant tools or archive a bot.',403);
     else requireThat(!item.payload.enabled&&!item.payload.action_policy_ids.length&&item.payload.schedule?.timezone===p.monitoring_timezone,'FORBIDDEN','Adopt only disabled routines with the reviewed timezone and no action grants.',403);
     this.apply(owner,commandId,item);
    }
    this.store.event(this.options.uuid(),null,'setup.adopted',owner,commandId,{count:p.commands.length,reviewed_hash:p.reviewed_hash,monitoring_timezone:p.monitoring_timezone,enabled:false},now);return commandId;
   }
   case 'run.steer': {
    requireThat(this.options.executionEnabled,'CAPABILITY_UNAVAILABLE','Native execution is not enabled and verified.');
    const p=command.payload;
    requireThat(p.text.trim().length>0,'INVALID_INPUT','Enter a steering instruction.',422);
    return new TaskSteering(this.store,()=>this.now()).queue(commandId,{run_id:p.run_id,attempt:p.expected_attempt});
   }
   case 'run.followup': {
    const p=command.payload,run=this.store.run(p.run_id);
    requireThat(run.role==='background','INVALID_INPUT','Select a background task for a targeted follow-up.',422);
    const id=this.options.uuid();
    this.store.db.exec("INSERT INTO task_followups(id,run_id,text,status,command_id,created_at) VALUES(?,?,?,'pending',?,?)",id,run.id,p.text,commandId,now);
    this.store.event(id,run.persona_id,'task.followup_queued',owner,commandId,{run_id:run.id,text:p.text,delivery:'after_native_settlement'},now);
    if(['completed','failed','cancelled'].includes(run.status))this.flushFollowups(run.id);
    return id;
   }
   case 'message.send': {
    const target=this.store.get<PersonaPut|RoomPut>(command.payload.conversation_id);
    requireThat(target.kind==='persona'||target.kind==='room','INVALID_INPUT','Choose a bot or room.',422);
    const persona=target.kind==='persona'?target.id:(target.body as RoomPut).default_responder_id;
    this.store.event(commandId,target.id,'message.user',owner,null,{text:command.payload.text},now);
    return this.enqueue(persona,command.payload.text,commandId,null,null,target.kind==='room'?target.id:null);
   }
   case 'persona.put': {
    const p=command.payload;
    requireThat(p.tool_policy_ids.every(x=>this.options.toolPolicyIds.includes(x)),'FORBIDDEN','A requested tool policy is not authorized.',403);
    const revision=this.store.put(p.id,'persona',p,p.expected_revision,owner,now,commandId);
    this.store.event(this.options.uuid(),p.id,'persona.updated',owner,commandId,{id:p.id,revision},now);return p.id;
   }
   case 'room.put': {
    const p=command.payload;
    requireThat(p.member_ids.includes(p.default_responder_id),'INVALID_INPUT','The default responder must be a room member.',422);
    p.member_ids.forEach(id=>this.activePersona(id));
    const revision=this.store.put(p.id,'room',p,p.expected_revision,owner,now,commandId);
    this.store.event(this.options.uuid(),p.id,'room.updated',owner,commandId,{id:p.id,revision},now);return p.id;
   }
   case 'routine.put': {
    const p=command.payload;this.activePersona(p.persona_id);
    requireThat(!this.store.db.all('SELECT id FROM objects WHERE id=? AND deleted_at IS NOT NULL',p.id).length,'NOT_FOUND','That routine was deleted.',404);
    requireThat(p.action_policy_ids.every(x=>this.options.actionPolicyIds.includes(x)),'FORBIDDEN','A requested action policy is not authorized.',403);
    if(p.schedule)validateSchedule(p.schedule);
    if(p.trigger_source_id)this.store.get(p.trigger_source_id,'trigger');
    if(p.enabled){const enabled=this.store.list<RoutinePut>('routine').filter(x=>x.body.enabled&&x.id!==p.id);requireThat(enabled.length<20,'INVALID_INPUT','At most 20 routines may be enabled.',422);}
    const revision=this.store.put(p.id,'routine',p,p.expected_revision,owner,now,commandId);
    this.store.db.exec("UPDATE runs SET status='cancelled',error_code='REVISION_CONFLICT',updated_at=? WHERE routine_id=? AND status IN ('queued','waiting')",now,p.id);
    this.store.db.exec("UPDATE occurrences SET status='superseded' WHERE routine_id=? AND status='queued'",p.id);
    this.store.db.exec('DELETE FROM schedule_state WHERE routine_id=?',p.id);
    const times=p.schedule?preview(p.schedule,now):[];
    if(p.enabled&&p.schedule)this.store.db.exec('INSERT INTO schedule_state(routine_id,routine_version,next_due_at) VALUES(?,?,?)',p.id,revision,times[0]);
    this.store.event(this.options.uuid(),p.persona_id,'routine.updated',owner,commandId,{id:p.id,revision,next_times:times,enabled:p.enabled},now);return p.id;
   }
   case 'routine.run': {
    const p=command.payload,routine=this.store.get<RoutinePut>(p.id,'routine');
    requireThat(routine.revision===p.expected_revision,'REVISION_CONFLICT','Reload the routine before running it.');
    requireThat(routine.body.action_policy_ids.every(id=>this.options.actionPolicyIds.includes(id)),'FORBIDDEN','A routine action policy is no longer authorized.',403);
    // An explicit one-off may run a paused routine, but never changes its schedule
    // or silently duplicates queued, cancelling or uncertain work.
    requireThat(!this.store.db.all("SELECT id FROM runs WHERE routine_id=? AND status NOT IN ('completed','failed','cancelled')",p.id).length,'RESOURCE_BUSY','This routine already has unfinished work.');
    return this.enqueue(routine.body.persona_id,routine.body.instructions,commandId,p.id,null);
   }
   case 'routine.delete': {
    const p=command.payload,routine=this.store.get<RoutinePut>(p.id,'routine');
    requireThat(routine.revision===p.expected_revision,'REVISION_CONFLICT','Reload the routine before deleting it.');
    this.store.db.exec('UPDATE objects SET deleted_at=?,updated_at=?,revision=revision+1 WHERE id=?',now,now,p.id);
    this.store.db.exec('DELETE FROM schedule_state WHERE routine_id=?',p.id);
    this.store.db.exec("UPDATE runs SET status='cancelled',error_code='ROUTINE_DELETED',updated_at=? WHERE routine_id=? AND status IN ('queued','waiting')",now,p.id);
    this.store.db.exec("UPDATE occurrences SET status='superseded' WHERE routine_id=? AND status='queued'",p.id);
    // Deleting future automation is not an implicit cancellation of admitted work.
    this.store.event(this.options.uuid(),routine.body.persona_id,'routine.deleted',owner,commandId,{id:p.id,revision:routine.revision+1,active_tasks_unchanged:true},now);
    return p.id;
   }
   case 'memory.put': {
    const p=command.payload;
    if(p.scope.kind!=='global')this.store.get(p.scope.id!,p.scope.kind);
    requireThat(this.store.db.all('SELECT id FROM events WHERE id=? UNION SELECT id FROM event_tombstones WHERE id=?',p.source_event_id,p.source_event_id).length,'INVALID_INPUT','Memory must reference an existing source event.',422);
    if(p.expires_at)requireThat(Date.parse(p.expires_at)>Date.parse(now),'INVALID_INPUT','Memory expiry must be in the future.',422);
    const revision=this.store.put(p.id,'memory',p,p.expected_revision,owner,now,p.source_event_id);
    this.store.event(this.options.uuid(),null,'memory.updated',owner,commandId,{id:p.id,revision,scope:p.scope},now);return p.id;
   }
   case 'memory.delete': {
    const p=command.payload;const memory=this.store.get<MemoryPut>(p.id,'memory');
    requireThat(memory.revision===p.expected_revision,'REVISION_CONFLICT','Reload memory before deleting.');
    this.purgeMemories([p.id],owner,commandId,p.purge_transcripts,now);return p.id;
   }
   case 'room.publish': return this.publishRoom(owner,commandId,command.payload);
   case 'run.cancel': {
    const run=this.store.run(command.payload.run_id);
    if(['completed','failed','cancelled'].includes(run.status))return run.id;
    const status=['queued','waiting'].includes(run.status)?'cancelled':'cancelling';
    this.store.db.exec("UPDATE runs SET status=?,error_code='OWNER_CANCELLED',updated_at=? WHERE id=?",status,now,run.id);
    this.store.event(this.options.uuid(),run.persona_id,'run.cancellation_requested',owner,commandId,{run_id:run.id,status,reason:command.payload.reason},now);return run.id;
   }
   case 'run.retry': {
    const run=this.store.run(command.payload.run_id);
    requireThat(run.current_attempt===command.payload.expected_attempt,'REVISION_CONFLICT','The attempt has changed.');
    requireThat(['failed','waiting','cancelled','recovery_required'].includes(run.status),'INVALID_INPUT','This run is not eligible for retry.',422);
    if(run.current_attempt===0){
     const received=run.command_id?this.store.db.all<{accepted_at:string}>('SELECT accepted_at FROM commands WHERE id=?',run.command_id)[0].accepted_at:run.created_at;
     requireThat(Date.parse(received)+90*86400000>this.options.now().getTime(),'MESSAGE_EXPIRED','This unstarted instruction expired. Send a fresh request.');
    }
    requireThat(run.current_attempt<3,'DEADLINE_EXCEEDED','This run has reached its retry limit.');
    const unsettledAttempt=this.store.db.all("SELECT run_id FROM attempts WHERE run_id=? AND status IN ('claimed','running')",run.id);
    requireThat(!unsettledAttempt.length,'CANCEL_UNCONFIRMED','The native attempt must settle before retrying.');
    requireThat(!this.store.db.all('SELECT resource_id FROM resource_locks WHERE run_id=?',run.id).length,'RESOURCE_BUSY','The prior task still owns a shared resource.');
    requireThat(run.role!=='background','CAPABILITY_UNAVAILABLE','Use a task follow-up after native settlement to ask the coordinator for a new background task.');
    const uncertain=this.store.db.all("SELECT id FROM effects WHERE run_id=? AND status IN ('intent','dispatched','outcome_unknown')",run.id);
    requireThat(!uncertain.length,'OUTCOME_UNKNOWN','Reconcile the external result before retrying.');
    const live=this.store.db.all("SELECT id FROM operations WHERE run_id=? AND status!='settled'",run.id);
    requireThat(!live.length,'CANCEL_UNCONFIRMED','The old execution has not settled.');
    // A new root attempt would invalidate the custody needed to reconcile its
    // old descendants. Root completion alone is not family settlement.
    const descendants=this.store.db.all(`SELECT r.id FROM runs r WHERE r.id=? AND NOT (${nativeDescendantsSettledSql})`,run.id);
    requireThat(!descendants.length,'CANCEL_UNCONFIRMED','Native descendants must settle before retrying their coordinator.');
    requireThat(!this.budget.blocks({...run,status:'queued'}),'BUDGET_BLOCKED','Review the budget and use an explicit one-run override.');
    this.store.db.exec('UPDATE runs SET status=?,error_code=?,updated_at=? WHERE id=?',this.options.executionEnabled?'queued':'waiting',this.options.executionEnabled?null:'CAPABILITY_UNAVAILABLE',now,run.id);
    if(this.options.executionEnabled)this.noteRunnable();return run.id;
   }
   case 'approval.resolve': {
    const p=command.payload;const a=this.store.get<{run_id:string;expires_at:string;status:string}>(p.approval_id,'approval');
    requireThat(a.revision===p.expected_revision,'REVISION_CONFLICT','Approval has changed.');
    requireThat(a.body.status==='pending'&&a.body.expires_at>now,'FORBIDDEN','This approval is no longer valid.',403);
    this.store.put(a.id,'approval',{...a.body,status:p.decision},a.revision,owner,now,commandId);
    const run=this.store.run(a.body.run_id);
    requireThat(run.status==='waiting'&&run.checkpoint_json,'INVALID_INPUT','This run has no resumable checkpoint.',422);
    this.store.db.exec('UPDATE runs SET status=?,updated_at=? WHERE id=?',p.decision==='deny'?'cancelled':this.options.executionEnabled?'queued':'waiting',now,run.id);
    if(p.decision==='approve'&&this.options.executionEnabled)this.noteRunnable();return a.id;
   }
  }
 }
 private budgetChanges(limit:number){
  const predicate=this.budget.admissionPredicate(),status=this.budget.summary().status;
  return this.store.db.all<Run&{budget_allowed:number}>(`WITH candidates AS (
   SELECT r.*,(${predicate.sql}) AS budget_allowed FROM runs r WHERE r.current_attempt=0
   AND (r.status='queued' OR (r.status='waiting' AND r.error_code IN ('BUDGET_UNKNOWN','BUDGET_BLOCKED'))))
   SELECT * FROM candidates WHERE (status='queued' AND NOT budget_allowed)
   OR (status='waiting' AND (budget_allowed OR error_code<>?)) ORDER BY created_at,id LIMIT ?`,...predicate.bindings,status,limit);
 }
 reconcileBudget():number {
  return this.store.db.transaction(()=>{
   const changes=this.budgetChanges(100),now=this.now(),reason=this.budget.summary().status;
   for(const run of changes){
    const status=run.budget_allowed&&this.options.executionEnabled?'queued':'waiting';
    const error=run.budget_allowed?(this.options.executionEnabled?null:'CAPABILITY_UNAVAILABLE'):reason;
    // Budget waiting does not renew the instruction's original age or settle work.
    this.store.db.exec('UPDATE runs SET status=?,error_code=? WHERE id=?',status,error,run.id);
    this.store.event(this.options.uuid(),run.persona_id,'run.budget_changed','system',run.command_id,{run_id:run.id,status,reason:error},now);
    if(status==='queued')this.noteRunnable();
   }
   return changes.length;
  });
 }
 nextBudgetMaintenance():string|null {
  return this.store.db.transaction(()=>{
   if(this.budgetChanges(1).length)return this.now();
   const summary=this.budget.summary();
   if(!summary.policy.enabled||!summary.policy.optional_routine_ids.length||summary.freshness!=='fresh'||!summary.report)return null;
   const [year,month]=summary.period.split('-').map(Number);
   return new Date(Math.min(Date.parse(summary.report.observed_at)+86400000,Date.UTC(year,month,1,-7))).toISOString();
  });
 }
 private purgeMemories(ids:string[],owner:string,commandId:string|null,purgeTranscripts:boolean,now:string):void {
  // Purge current and prior canonical text immediately; retain only tombstone identity.
  const selected=new Set(ids),keys=JSON.stringify(ids);
  this.store.db.exec("UPDATE objects SET body_json='{}',deleted_at=?,updated_at=?,revision=revision+1 WHERE id IN (SELECT value FROM json_each(?))",now,now,keys);
  this.store.db.exec("UPDATE object_revisions SET body_json='{}' WHERE object_id IN (SELECT value FROM json_each(?))",keys);
  this.store.db.exec("UPDATE commands SET payload_json='{}' WHERE type='memory.put' AND json_extract(payload_json,'$.id') IN (SELECT value FROM json_each(?))",keys);
  const runs=this.store.db.all<Run>("SELECT * FROM runs WHERE status IN ('queued','claimed','running','finishing','waiting','cancelling','recovery_required')");
  for(const run of runs){const context=JSON.parse(run.context_json) as ContextSnapshot;if(context.memories?.some(x=>selected.has(x.id)))this.store.db.exec("UPDATE runs SET status=?,error_code='CONTEXT_INVALIDATED',context_json=?,updated_at=? WHERE id=?",run.status==='recovery_required'?'recovery_required':['claimed','running','finishing','cancelling'].includes(run.status)?'cancelling':'cancelled',JSON.stringify({...context,memories:context.memories.filter(x=>!selected.has(x.id))}),now,run.id);}
  for(const id of ids)this.store.event(this.options.uuid(),null,'memory.deleted',owner,commandId,{id,transcript_cleanup_requested:purgeTranscripts,transcript_cleanup_status:purgeTranscripts?'requires_runtime_verification':'not_requested'},now);
 }
 nextMemoryExpiry():string|null {
  return this.store.db.all<{expires_at:string}>("SELECT json_extract(body_json,'$.expires_at') AS expires_at FROM objects WHERE kind='memory' AND deleted_at IS NULL AND json_extract(body_json,'$.expires_at') IS NOT NULL ORDER BY julianday(json_extract(body_json,'$.expires_at')),id LIMIT 1")[0]?.expires_at??null;
 }
 expireMemories():number {
  return this.store.db.transaction(()=>{
   const now=this.now();
   const due=this.store.db.all<{id:string}>("SELECT id FROM objects WHERE kind='memory' AND deleted_at IS NULL AND julianday(json_extract(body_json,'$.expires_at'))<=julianday(?) ORDER BY julianday(json_extract(body_json,'$.expires_at')),id LIMIT 100",now);
   if(due.length)this.purgeMemories(due.map(memory=>memory.id),'system:expiry',null,false,now);
   return due.length;
  });
 }
 nextCommandPayloadExpiry():string|null {
  const first=this.store.db.all<{accepted_at:string}>("SELECT accepted_at FROM commands WHERE payload_json!='{}' AND status IN ('applied','rejected') ORDER BY accepted_at LIMIT 1")[0];
  return first?new Date(Date.parse(first.accepted_at)+90*86400000).toISOString():null;
 }
 expireCommandPayloads():number {
  return this.store.db.transaction(()=>{
   const cutoff=new Date(this.options.now().getTime()-90*86400000).toISOString();
   const due=this.store.db.all<{id:string}>("SELECT id FROM commands WHERE payload_json!='{}' AND status IN ('applied','rejected') AND accepted_at<=? ORDER BY accepted_at,id LIMIT 100",cutoff);
   if(due.length)this.store.db.exec("UPDATE commands SET payload_json='{}' WHERE id IN (SELECT value FROM json_each(?))",JSON.stringify(due.map(command=>command.id)));
   return due.length;
  });
 }
 nextQueuedContextExpiry():string|null {
  return this.store.db.all<{due:string|null}>(`SELECT MIN(${queuedContextDueSql}) AS due FROM runs r LEFT JOIN commands c ON c.id=r.command_id WHERE r.current_attempt=0 AND r.status IN ('queued','waiting')`)[0].due;
 }
 expireQueuedContexts():number {
  return this.store.db.transaction(()=>{
   const now=this.now();
   const due=this.store.db.all<Run&{instruction_created_at:string}>(`SELECT r.*,COALESCE(c.accepted_at,r.created_at) AS instruction_created_at FROM runs r LEFT JOIN commands c ON c.id=r.command_id WHERE r.current_attempt=0 AND r.status IN ('queued','waiting') AND (${queuedContextDueSql})<=? ORDER BY (${queuedContextDueSql}),r.id LIMIT 100`,now);
   for(const run of due){
    if(Date.parse(run.instruction_created_at)+90*86400000<=Date.parse(now)){
     this.store.db.exec("UPDATE runs SET context_json='{}',status='failed',error_code='MESSAGE_EXPIRED',updated_at=? WHERE id=?",now,run.id);
     if(run.occurrence_id)this.store.db.exec("UPDATE occurrences SET status='skipped' WHERE id=? AND status='queued'",run.occurrence_id);
     this.store.event(this.options.uuid(),run.persona_id,'run.input_expired','system:expiry',run.command_id,{run_id:run.id,reason:'MESSAGE_EXPIRED',requires_fresh_request:true},now);
    }else{
     const {instruction,room_id}=JSON.parse(run.context_json) as ContextSnapshot;
     // Not an admitted authorization snapshot. Claim rebuilds all derived fields.
     this.store.db.exec('UPDATE runs SET context_json=? WHERE id=?',JSON.stringify({schema_version:1,instruction,room_id}),run.id);
    }
   }
   return due.length;
  });
 }
 nextFollowupExpiry():string|null {
  const first=this.store.db.all<{created_at:string}>("SELECT created_at FROM task_followups WHERE text!='' ORDER BY created_at,id LIMIT 1")[0];
  return first?new Date(Date.parse(first.created_at)+90*86400000).toISOString():null;
 }
 expireFollowups():number {
  return this.store.db.transaction(()=>{
   const now=this.now(),cutoff=new Date(this.options.now().getTime()-90*86400000).toISOString();
   const due=this.store.db.all<{id:string;run_id:string;status:string;command_id:string}>("SELECT id,run_id,status,command_id FROM task_followups WHERE text!='' AND created_at<=? ORDER BY created_at,id LIMIT 100",cutoff);
   for(const followup of due){
    this.store.db.exec("UPDATE task_followups SET text='',status=CASE WHEN status='pending' THEN 'expired' ELSE status END WHERE id=?",followup.id);
    if(followup.status==='pending')this.store.event(this.options.uuid(),this.store.run(followup.run_id).persona_id,'task.followup_expired','system:expiry',followup.command_id,{run_id:followup.run_id,followup_id:followup.id,reason:'MESSAGE_EXPIRED',requires_fresh_followup:true},now);
   }
   return due.length;
  });
 }
 flushFollowups(runId:string):void {
  const run=this.store.run(runId);
  if(!['completed','failed','cancelled'].includes(run.status))return;
  const cutoff=new Date(this.options.now().getTime()-90*86400000).toISOString();
  // Enforce the cutoff even when bounded physical cleanup has a backlog.
  for(const followup of this.store.db.all<{id:string;text:string;command_id:string}>("SELECT id,text,command_id FROM task_followups WHERE run_id=? AND status='pending' AND created_at>? ORDER BY created_at,id",runId,cutoff)){
   const coordinator=this.enqueue(run.persona_id,`Owner follow-up explicitly targets task ${run.id} (${run.title??'Task'}). The previous native execution is settled. Decide the next authorized action; do not resume any other task.\n\n${followup.text}`,followup.command_id,null,null);
   this.store.db.exec("UPDATE task_followups SET status='coordinator_queued',coordinator_run_id=? WHERE id=?",coordinator,followup.id);
  }
 }
 private activePersona(id:string):StoredObject<PersonaPut>{const p=this.store.get<PersonaPut>(id,'persona');requireThat(!p.body.archived,'CAPABILITY_UNAVAILABLE','This bot is archived.');return p;}
 private currentContextEvent(event:TimelineEvent,personaId:string,now:string):TimelineEvent {
  const unavailable=(event.payload.references as RoomPublish['references']).some(reference=>{
   let object:StoredObject;
   try{object=this.store.get(reference.id);}catch(error){if(error instanceof ControlError&&error.code==='NOT_FOUND')return true;throw error;}
   if(object.kind!==reference.kind||object.revision!==reference.revision)return true;
   if(object.kind==='memory'){
    const memory=object.body as unknown as MemoryPut;
    return Boolean(memory.expires_at&&Date.parse(memory.expires_at)<=Date.parse(now))||!(memory.scope.kind==='global'||memory.scope.kind==='persona'&&memory.scope.id===personaId);
   }
   return false;
  });
  return unavailable?{...event,payload:{...event.payload,references:[],context_unavailable:true,text:'This context update is unavailable because a referenced item changed or is no longer accessible.'}}:event;
 }
 context(personaId:string,instruction:string,routineId:string|null,roomId:string|null):ContextSnapshot {
  const persona=this.activePersona(personaId);
  const routine=routineId?this.store.get<RoutinePut>(routineId,'routine'):null;
  const now=this.now();
  const memories=this.store.list<MemoryPut>('memory').filter(m=>(!m.body.expires_at||Date.parse(m.body.expires_at)>Date.parse(now))&&(m.body.scope.kind==='global'||m.body.scope.kind==='persona'&&m.body.scope.id===personaId||m.body.scope.kind==='routine'&&m.body.scope.id===routineId));
  let contextEvents:ContextSnapshot['context_events']=[];
  let contextHistoryGap:ContextSnapshot['context_history_gap'];
  if(roomId){
   const room=this.store.get<RoomPut>(roomId,'room');requireThat(room.body.member_ids.includes(personaId),'FORBIDDEN','Bot is not in this room.',403);
   const cursor=this.store.db.all<{consumed_sequence:number}>('SELECT consumed_sequence FROM consumer_cursors WHERE consumer_id=? AND conversation_id=?',personaId,roomId)[0]?.consumed_sequence??0;
   const page=this.store.contextPage(roomId,personaId,cursor,now);
   if(cursor<page.expiredThrough)contextHistoryGap={requested_after:cursor,expired_through:page.expiredThrough};
   contextEvents=page.events.map(event=>this.currentContextEvent(event,personaId,now));
  }
  return {schema_version:1,persona,routine,memories,skills:new SkillCatalog(this.store,()=>this.now(),this.options.uuid).enabled(personaId),scope_key:`${personaId}/${routineId?`routine/${routineId}`:roomId?`room/${roomId}`:'personal'}`,instruction,room_id:roomId,context_events:contextEvents,context_history_gap:contextHistoryGap,task_summaries:this.store.db.all<{id:string;title:string|null;status:string;updated_at:string}>("SELECT id,title,status,updated_at FROM runs WHERE role='background' AND persona_id=? ORDER BY updated_at DESC LIMIT 30",personaId),authorization_policy_ids:routine?.body.action_policy_ids??[]};
 }
 enqueue(personaId:string,instruction:string,commandId:string|null,routineId:string|null,occurrenceId:string|null,roomId:string|null=null):string {
  const id=this.options.uuid(),now=this.now(),context=this.context(personaId,instruction,routineId,roomId);
  let status=this.options.executionEnabled?'queued':'waiting',reason:string|null=this.options.executionEnabled?null:'CAPABILITY_UNAVAILABLE';
  this.store.db.exec('INSERT INTO runs(id,command_id,occurrence_id,persona_id,routine_id,context_json,status,error_code,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',id,commandId,occurrenceId,personaId,routineId,JSON.stringify(context),status,reason,now,now);
  if(this.budget.blocks(this.store.run(id))){
   status='waiting';reason=this.budget.summary().status;
   this.store.db.exec('UPDATE runs SET status=?,error_code=? WHERE id=?',status,reason,id);
  }
  this.store.event(this.options.uuid(),roomId??personaId,'run.accepted','system',commandId,{run_id:id,status,reason:reason==='CAPABILITY_UNAVAILABLE'?'Runtime execution is not configured and verified yet.':reason},now);
  if(status==='queued')this.noteRunnable();return id;
 }
 private noteRunnable(){
  this.store.db.exec("UPDATE lifecycle SET queue_sequence=queue_sequence+1,desired_state='RUN',stop_token=CASE WHEN phase='DRAINING' THEN NULL ELSE stop_token END,wake_after_stop=CASE WHEN phase IN ('STOP_COMMITTED','STOPPING') THEN 1 ELSE wake_after_stop END,phase=CASE WHEN phase='DRAINING' THEN 'READY' ELSE phase END WHERE singleton=1");
 }
 private publishRoom(owner:string,commandId:string,p:RoomPublish):string {
  const room=this.store.get<RoomPut>(p.room_id,'room');
  requireThat(p.recipient_ids.every(id=>room.body.member_ids.includes(id)),'FORBIDDEN','Recipients must be room members.',403);
  for(const reference of p.references){const object=this.store.get(reference.id);requireThat(object.kind===reference.kind,'INVALID_INPUT','The referenced object kind does not match.',422);requireThat(object.revision===reference.revision,'REVISION_CONFLICT','A referenced item changed.');if(object.kind==='memory'){const m=object.body as unknown as MemoryPut;requireThat(m.scope.kind==='global'||m.scope.kind==='persona'&&p.recipient_ids.every(id=>id===m.scope.id),'FORBIDDEN','Private memory cannot be shared through this room update.',403);}}
  const payload=JSON.stringify(p),digest=createHash('sha256').update(payload).digest('hex');
  const prior=this.store.db.all<{id:string}>('SELECT event_id AS id FROM room_publications WHERE room_id=? AND actor_id=? AND cause_id=? AND payload_digest=?',p.room_id,owner,p.cause_id,digest)[0]
   ??this.store.db.all<{id:string}>('SELECT id FROM events WHERE conversation_id=? AND actor_id=? AND cause_id=? AND payload_json=?',p.room_id,owner,p.cause_id,payload)[0];if(prior)return prior.id;
  this.store.db.exec('INSERT INTO room_publications(event_id,room_id,actor_id,cause_id,payload_digest,kind,created_at) VALUES(?,?,?,?,?,?,?)',commandId,p.room_id,owner,p.cause_id,digest,p.kind,this.now());
  const sequence=this.store.event(commandId,p.room_id,`room.${p.kind}`,owner,p.cause_id,p as unknown as Record<string,unknown>,this.now());
  for(const recipient of p.recipient_ids)this.store.db.exec('INSERT INTO consumer_cursors(consumer_id,conversation_id,delivered_sequence,consumed_sequence) VALUES(?,?,?,0) ON CONFLICT(consumer_id,conversation_id) DO UPDATE SET delivered_sequence=excluded.delivered_sequence',recipient,p.room_id,sequence);
  if(p.kind==='action_request'){
   requireThat(p.recipient_ids.length<=2,'INVALID_INPUT','At most two bots may be requested at once.',422);
   const causalCount=this.store.db.all<{n:number}>("SELECT COUNT(*) AS n FROM (SELECT id FROM events WHERE cause_id=? AND type='room.action_request' UNION SELECT event_id FROM room_publications WHERE cause_id=? AND kind='action_request')",p.cause_id,p.cause_id)[0].n;
   requireThat(causalCount<=3,'DEADLINE_EXCEEDED','The bot collaboration budget is exhausted.');
   for(const recipient of p.recipient_ids)this.enqueue(recipient,p.text,commandId,null,null,p.room_id);
  }
  return commandId;
 }
 tick():void {
  const now=this.now();
  const due=this.store.db.all<{routine_id:string;routine_version:number;next_due_at:string}>('SELECT * FROM schedule_state WHERE next_due_at<=? ORDER BY next_due_at LIMIT 20',now);
  for(const item of due)this.store.db.transaction(()=>{
   const current=this.store.get<RoutinePut>(item.routine_id,'routine');
   if(!current.body.enabled||current.revision!==item.routine_version){this.store.db.exec('DELETE FROM schedule_state WHERE routine_id=?',item.routine_id);return;}
   const ticks=dueOccurrences(current.body,item.next_due_at,now);
   for(const nominal of ticks.selected){
    if(this.store.db.all('SELECT id FROM occurrences WHERE routine_id=? AND routine_version=? AND nominal_due_at=?',current.id,current.revision,nominal).length)continue;
    const id=this.options.uuid();
    const busy=this.store.db.all<Run>("SELECT * FROM runs WHERE routine_id=? AND status IN ('claimed','running','finishing','queued','waiting')",current.id);
    const skip=busy.length>0&&current.body.policy.overlap==='skip';
    if(busy.length&&current.body.policy.overlap==='queue_one'){
     for(const run of busy.filter(x=>x.occurrence_id&&['queued','waiting'].includes(x.status))){this.store.db.exec("UPDATE runs SET status='cancelled',updated_at=? WHERE id=?",now,run.id);if(run.occurrence_id)this.store.db.exec("UPDATE occurrences SET status='skipped' WHERE id=?",run.occurrence_id);}
    }
    this.store.db.exec('INSERT INTO occurrences(id,routine_id,routine_version,nominal_due_at,status,coalesced_count,created_at) VALUES(?,?,?,?,?,?,?)',id,current.id,current.revision,nominal,skip?'skipped':'queued',ticks.skipped,now);
    if(!skip)this.enqueue(current.body.persona_id,current.body.instructions,null,current.id,id);
   }
   this.store.db.exec('UPDATE schedule_state SET next_due_at=?,last_nominal_due_at=? WHERE routine_id=?',ticks.next,ticks.selected.at(-1)??null,current.id);
  });
 }
 state(after?:number,limit=100){
  const now=this.now();
  if(after!==undefined){const first=this.store.db.all<{seq:number}>('SELECT MIN(sequence) AS seq FROM events')[0].seq;if(after<this.store.retentionFloor(now)||first&&after<first-1)throw new ControlError('HISTORY_GAP','Fetch a new snapshot.');}
  const page=after===undefined?[]:this.store.events(after,limit,now);
  const runs=this.store.db.all<Run>('SELECT * FROM runs ORDER BY created_at DESC LIMIT 100');
  const steering=new TaskSteering(this.store,()=>now);
  return {next_cursor:String(after===undefined?this.store.sequence():page.at(-1)?.sequence??after),snapshot_required:false,events:page,
   budget:this.budget.summary(),
   monitoring:controlMonitoring(this.store,now,this.budget,this.options.executionEnabled),
   objects:after===undefined?(['persona','room','routine','memory','skill'] as const).flatMap(kind=>this.store.list(kind)):undefined,
   skill_enablements:after===undefined?this.store.db.all<{skill_id:string;persona_id:string;skill_revision:number;enabled:number}>('SELECT skill_id,persona_id,skill_revision,enabled FROM skill_enablements ORDER BY skill_id,persona_id').map(row=>({...row,enabled:Boolean(row.enabled)})):undefined,
   skill_proposals:after===undefined?this.store.db.all<{id:string;skill_id:string;proposal_revision:number;expected_skill_revision:number;body_json:string;provenance_json:string;status:string;executable_files_changed:number;created_at:string;reviewed_at:string|null}>("SELECT id,skill_id,proposal_revision,expected_skill_revision,body_json,provenance_json,status,executable_files_changed,created_at,reviewed_at FROM skill_proposals ORDER BY created_at,id").map(({body_json,provenance_json,executable_files_changed,...row})=>({...row,body:JSON.parse(body_json),provenance:JSON.parse(provenance_json),executable_files_changed:Boolean(executable_files_changed)})):undefined,
   steering:runs.flatMap(run=>steering.receipts({run_id:run.id,attempt:run.current_attempt})),
   runs:runs.map(({context_json,checkpoint_json,...rest})=>rest),
   summary:{phase:this.store.db.all<{phase:string}>('SELECT phase FROM lifecycle WHERE singleton=1')[0]?.phase??'STOPPED',queued_runs:this.store.db.all<{n:number}>("SELECT COUNT(*) AS n FROM runs WHERE status='queued'")[0].n,active_background:this.store.db.all<{n:number}>("SELECT COUNT(*) AS n FROM runs WHERE role='background' AND status IN ('claimed','running','finishing','cancelling')")[0].n,active_coordinators:this.store.db.all<{n:number}>("SELECT COUNT(*) AS n FROM runs WHERE role='coordinator' AND status IN ('claimed','running','finishing','cancelling')")[0].n,blocked_runs:this.store.db.all<{n:number}>("SELECT COUNT(*) AS n FROM runs WHERE status IN ('waiting','recovery_required')")[0].n,execution_enabled:this.options.executionEnabled},
   timeline:after===undefined?this.store.latestEvents(now):undefined};
 }
}
