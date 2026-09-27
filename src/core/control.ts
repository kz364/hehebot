import { createHash } from 'node:crypto';
import validateCommand from '../generated/validate-command.js';
import { ControlError, requireThat, safeError } from './errors';
import { Store } from './store';
import { dueOccurrences, nextDue, preview, validateSchedule } from './schedule';
import {SkillCatalog} from './skills';
import {BudgetLedger} from './budget';
import {RosterLedger} from './roster';
import {NativeQuestionLedger} from './native-questions';
import {LifecycleCore} from './lifecycle';
import {controlMonitoring} from './monitoring';
import {TaskSteering} from './task-steering';
import {nativeDescendantsSettledSql} from './native-tasks';
import {EffectLedger} from './effects';
import {ResourceLedger} from './resources';
import {OutputPreviews} from './output-preview';
import {TokenUsageSnapshots} from './token-usage';
import {captureWhatsAppReadPolicies} from './whatsapp-access';
import {OwnerAlpha,ownerAlphaSuccessorSha256} from './owner-alpha';
import {OwnerAlphaBootstrap} from './owner-alpha-bootstrap';
import {OwnerAlphaWarm} from './owner-alpha-warm';
import {OwnerAlphaBackground} from './owner-alpha-background';
import {TestCampaign} from './test-campaign';
import {timelineExpirySql} from './timeline-retention';
import {memorySourceDigest,memorySnapshot as readMemorySnapshot} from './memory-context';
import type { Command, ContextSnapshot, MemoryPut, Options, PersonaPut, Receipt, RoomPut, RoomPublish, RoutinePut, Run, SkillBody, StoredObject, TimelineEvent } from './types';
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
 if(command.type==='message.send'||command.type==='run.steer'||command.type==='skill.run') requireThat(new TextEncoder().encode(command.payload.text).length<=32768,'PAYLOAD_TOO_LARGE','Message exceeds 32768 bytes.',413);
 return command;
}
export class ControlCore {
 readonly budget:BudgetLedger;
 readonly questions:NativeQuestionLedger;
 readonly ownerAlpha:OwnerAlpha;
 readonly bootstrap:OwnerAlphaBootstrap;
 readonly warm:OwnerAlphaWarm;
 readonly background:OwnerAlphaBackground;
 constructor(public store:Store,public options:Options){
  requireThat(!options.ownerAlpha||!options.executionEnabled,'INVALID_CONFIGURATION','Owner alpha cannot enable production execution.',503);
  requireThat(!options.ownerAlphaSuccessor||!options.executionEnabled,'INVALID_CONFIGURATION','Owner alpha successor cannot enable production execution.',503);
  requireThat(!options.ownerAlphaWarm||!options.executionEnabled,'INVALID_CONFIGURATION','Warm owner alpha cannot enable production execution.',503);
  requireThat(!options.ownerAlphaWarm||!options.ownerAlphaBootstrap&&!options.ownerAlphaSuccessor,'INVALID_CONFIGURATION','Warm owner alpha is mutually exclusive with bootstrap and successor configuration.',503);
  requireThat(!options.ownerAlphaWarm||!options.testCampaignGrant,'INVALID_CONFIGURATION','Warm owner alpha is mutually exclusive with test campaign grants.',503);
  requireThat(!options.ownerAlphaWarm||!!options.ownerAlpha,'INVALID_CONFIGURATION','Warm owner alpha requires the hosted owner-alpha policy.',503);
  requireThat(!options.ownerAlphaBackground||!options.executionEnabled,'INVALID_CONFIGURATION','Background owner alpha cannot enable production execution.',503);
  requireThat(!options.ownerAlphaBackground||!options.ownerAlphaBootstrap&&!options.ownerAlphaSuccessor&&!options.ownerAlphaWarm,'INVALID_CONFIGURATION','Background owner alpha is mutually exclusive with bootstrap, successor and warm configuration.',503);
  requireThat(!options.ownerAlphaBackground||!options.testCampaignGrant,'INVALID_CONFIGURATION','Background owner alpha is mutually exclusive with test campaign grants.',503);
  requireThat(!options.ownerAlphaBackground||!!options.ownerAlpha,'INVALID_CONFIGURATION','Background owner alpha requires the hosted owner-alpha policy.',503);
  this.ownerAlpha=new OwnerAlpha(store,options.ownerAlpha,()=>this.now());
  this.budget=new BudgetLedger(store,()=>this.now(),options.uuid);
  this.questions=new NativeQuestionLedger(store,new LifecycleCore(store,this),()=>this.now());
  this.bootstrap=new OwnerAlphaBootstrap(this);
  this.warm=new OwnerAlphaWarm(this);
  this.background=new OwnerAlphaBackground(this);
 }
 now(){return this.options.now().toISOString();}
 schedulePreview(cron:string,timezone:string){
  requireThat(typeof cron==='string'&&cron.length>=1&&cron.length<=128&&typeof timezone==='string'&&timezone.length>=1&&timezone.length<=80,'INVALID_INPUT','Provide a bounded cron expression and timezone.',422);
  const schedule={cron,timezone};validateSchedule(schedule);const observed_at=this.now();
  return {schedule,observed_at,next_times:preview(schedule,observed_at,3)};
 }
 routinePreflight(id:string){
  const routine=this.store.get<RoutinePut>(id,'routine'),observed_at=this.now(),blockers=this.routineRunBlockers(routine);
  return {routine_id:routine.id,routine_revision:routine.revision,persona_id:routine.body.persona_id,observed_at,
   enabled:routine.body.enabled,schedule:routine.body.schedule,next_times:routine.body.schedule?preview(routine.body.schedule,observed_at):[],policy:routine.body.policy,
   manual_run:{command_allowed:blockers.length===0,blockers:blockers.map(({code,message})=>({code,message})),execution_enabled:this.options.executionEnabled},
   limitations:['Observation only; the command rechecks current revision and authority. A paused routine may run once without resuming.',
    'Schedule times are a preview, not admission or delivery promises. Connector credentials, model access, inputs and effect approvals are not verified.']};
 }
 private routineRunBlockers(routine:StoredObject<RoutinePut>):ControlError[]{
  const blockers:ControlError[]=[];
  if(!routine.body.action_policy_ids.every(id=>this.options.actionPolicyIds.includes(id)))blockers.push(new ControlError('FORBIDDEN','A routine action policy is no longer authorized.',403));
  if(this.store.db.all("SELECT id FROM runs WHERE routine_id=? AND status NOT IN ('completed','failed','cancelled') LIMIT 1",routine.id).length)blockers.push(new ControlError('RESOURCE_BUSY','This routine already has unfinished work.'));
  try{this.activePersona(routine.body.persona_id);}catch(error){if(!(error instanceof ControlError))throw error;blockers.push(error);}
  return blockers;
 }
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
 // Owner-scoped lookup by the client's Idempotency-Key, for durable-outbox
 // reconciliation after a page reload or a lost response (ARCHITECTURE_V2 A5).
 // Only this owner's own commands are visible; an unknown key is NOT_FOUND.
 receiptByIdempotencyKey(owner:string,key:string):Receipt {
  const row=this.store.db.all<{id:string}>('SELECT id FROM commands WHERE owner_id=? AND idempotency_key=?',owner,key)[0];
  requireThat(row,'NOT_FOUND','Receipt unavailable.',404);
  return this.receipt(row.id);
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
    const resource=this.apply(owner,id,command,key);
    if(command.type==='message.send'){this.bootstrap.assignNewMessage(owner,id,resource);this.warm.assignNewMessage(owner,id,resource);this.background.assignNewMessage(owner,id,resource);}
    this.store.db.exec("UPDATE commands SET status='applied',resource_id=? WHERE id=?",resource,id);
   });
  }catch(error){
   if(!(error instanceof ControlError))throw error;
   this.store.db.transaction(()=>insert('rejected',null,safeError(error)));
  }
  return this.receipt(id);
 }
 private apply(owner:string,commandId:string,command:Command,idempotencyKey:string):string {
  const now=this.now();
  const skills=new SkillCatalog(this.store,()=>this.now(),this.options.uuid);
  switch(command.type){
   case 'owner-alpha.activate':{
    const grant=this.options.ownerAlphaSuccessor;
    requireThat(!!grant&&!!this.options.ownerBindingSha256,'CAPABILITY_UNAVAILABLE','Owner-alpha successor activation is not configured.');
    requireThat(command.payload.transition_id===grant.transition_id&&command.payload.envelope_sha256===ownerAlphaSuccessorSha256(grant),'FORBIDDEN','Owner-alpha activation does not match the configured grant.',403);
    return new LifecycleCore(this.store,this).activateOwnerAlphaSuccessor(command,owner,commandId).owner_alpha_generation.transition_id;
   }
   case 'run.recover':{
    const p=command.payload,run=this.store.db.all<Pick<Run,'id'|'current_attempt'|'status'|'error_code'|'occurrence_id'|'persona_id'>>('SELECT id,current_attempt,status,error_code,occurrence_id,persona_id FROM runs WHERE id=?',p.run_id)[0];
    if(!run)throw new ControlError('NOT_FOUND','Run unavailable.',404);
    // V2 (ARCHITECTURE_V2 A2/A3): 'interrupted' is the other terminal attempt
    // state that can still be sitting on unresolved custody (unreconciled
    // effects, held locks, or an open stopped-executor question) needing this
    // same explicit owner recovery close-out.
    requireThat(run.current_attempt===p.expected_attempt&&(run.status==='recovery_required'||run.status==='interrupted'),'REVISION_CONFLICT','Select the current recovery-required attempt.');
    const attempt=this.store.db.all<{status:string}>('SELECT status FROM attempts WHERE run_id=? AND attempt=?',run.id,p.expected_attempt)[0];
    requireThat(run.status==='interrupted'||attempt?.status==='terminated','CANCEL_UNCONFIRMED','Confirmed executor termination is required before closing recovery.');
    requireThat(!this.questions.list().some(question=>question.run_id===run.id),'CANCEL_UNCONFIRMED','Close unresolved stopped-executor questions before closing recovery.');
    requireThat(!this.store.db.all("SELECT id FROM operations WHERE run_id=? AND status!='settled' LIMIT 1",run.id).length,'CANCEL_UNCONFIRMED','The old execution has not settled.');
    requireThat(!this.store.db.all("SELECT id FROM effects WHERE run_id=? AND status IN ('intent','dispatched','outcome_unknown') LIMIT 1",run.id).length,'OUTCOME_UNKNOWN','Reconcile every external effect before closing recovery.');
    requireThat(!this.store.db.all(`SELECT r.id FROM runs r WHERE r.id=? AND NOT (${nativeDescendantsSettledSql})`,run.id).length,'CANCEL_UNCONFIRMED','Recover descendants before their parent.');
    const resources=this.store.db.all<{resource_id:string}>('SELECT resource_id FROM resource_locks WHERE run_id=?',run.id).map(row=>row.resource_id);
    new ResourceLedger(this.store,()=>this.now()).release(run.id,p.expected_attempt,resources);
    const cancelled=['OWNER_CANCELLED','CONTEXT_INVALIDATED'].includes(run.error_code??''),status=cancelled?'cancelled':'failed';
    this.store.db.exec('UPDATE runs SET status=?,error_code=?,updated_at=? WHERE id=?',status,cancelled?run.error_code:'EXECUTOR_STOPPED',now,run.id);
    this.store.db.exec('DELETE FROM retry_queue WHERE run_id=?',run.id);
    if(run.occurrence_id)this.store.db.exec("UPDATE occurrences SET status='failed' WHERE id=?",run.occurrence_id);
    this.store.event(this.options.uuid(),run.persona_id,'run.owner_recovered',owner,commandId,{run_id:run.id,attempt:p.expected_attempt,status,released_resources:resources.length},now);
    this.flushFollowups(run.id);return run.id;
   }
   case 'effect.reconcile':{
    const p=command.payload,id=new EffectLedger(this.store,()=>this.now()).reconcileStopped(owner,commandId,p);
    const run=this.store.db.all<Pick<Run,'persona_id'>>('SELECT persona_id FROM runs WHERE id=?',p.run_id)[0];
    this.store.event(this.options.uuid(),run.persona_id,'effect.owner_reconciled',owner,commandId,
     {run_id:p.run_id,effect_id:id,attempt:p.expected_attempt,outcome:p.outcome},now);return id;
   }
   case 'question.answer':return this.questions.answer(owner,commandId,command.payload);
   case 'question.close':return this.questions.closeStopped(owner,commandId,command.payload);
   case 'roster.set':return new RosterLedger(this.store,()=>this.now()).set(owner,commandId,command.payload);
   case 'budget.set':{
    const id=this.budget.set(owner,commandId,command.payload);this.reconcileBudget();return id;
   }
   case 'budget.override':{
    requireThat(this.budget.summary().revision===command.payload.expected_revision,'REVISION_CONFLICT','The budget policy changed. Review it before allowing this run.');
    const id=this.budget.override(owner,commandId,command.payload.run_id);this.reconcileBudget();return id;
   }
   case 'skill.propose':return skills.propose(owner,commandId,command.payload);
   case 'skill.propose_from_task':{
    requireThat(!this.ownerAlpha.policy,'CAPABILITY_UNAVAILABLE','Task-sourced skill drafts are unavailable in owner-alpha sessions.');
    requireThat(!/^(runtime|trigger):/.test(owner),'FORBIDDEN','Only the owner may select a task as a skill draft source.',403);
    const p=command.payload,run=this.store.db.all<Pick<Run,'id'|'persona_id'|'current_attempt'>>('SELECT id,persona_id,current_attempt FROM runs WHERE id=?',p.source_run_id)[0];
    requireThat(run,'NOT_FOUND','Run unavailable.',404);
    requireThat(run.current_attempt===p.expected_attempt,'REVISION_CONFLICT','The source task attempt changed. Review it before staging this draft.');
    requireThat(this.store.db.all('SELECT run_id FROM attempts WHERE run_id=? AND attempt=?',run.id,p.expected_attempt).length===1,'NOT_FOUND','The source attempt record is unavailable.',404);
    // Record identity only: task input/output may be private, provisional or
    // expired. The owner supplies a separate procedure for normal staged review.
    return skills.propose(owner,commandId,{proposal_id:p.proposal_id,skill_id:p.skill_id,expected_skill_revision:p.expected_skill_revision,body:p.body,
     provenance:{kind:'task',source_ref:`task:${run.persona_id}/${run.id}/${p.expected_attempt}`},executable_files_changed:false});
   }
   case 'skill.review':return skills.review(owner,commandId,command.payload);
   case 'skill.enable':return skills.enable(owner,commandId,command.payload);
   case 'skill.delete':return skills.remove(owner,commandId,command.payload);
   case 'skill.restore':return skills.restore(owner,commandId,command.payload);
   case 'skill.run': {
    requireThat(!this.ownerAlpha.policy,'CAPABILITY_UNAVAILABLE','Run skill once is unavailable in owner-alpha sessions.');
    requireThat(!/^(runtime|trigger):/.test(owner),'FORBIDDEN','Only the owner may explicitly run a skill.',403);
    const p=command.payload,persona=this.activePersona(p.persona_id),skill=skills.approvedForRun(p.skill_id,p.expected_skill_revision);
    requireThat(persona.revision===p.expected_persona_revision,'REVISION_CONFLICT','Reload the bot before running this skill.');
    requireThat(p.text.trim().length>0,'INVALID_INPUT','Enter input for this skill run.',422);
    this.store.event(commandId,persona.id,'message.user',owner,null,{text:p.text,skill_invocation:{skill_id:skill.id,skill_revision:skill.revision,skill_name:skill.body.name}},now);
    return this.enqueue(persona.id,p.text,commandId,null,null,null,skill);
   }
   case 'setup.adopt': {
    const p=command.payload;
    requireThat(createHash('sha256').update(JSON.stringify(p.commands)).digest('hex')===p.reviewed_hash,'REVISION_CONFLICT','The reviewed import changed.');
    requireThat(new Set(p.commands.map(x=>x.payload.id)).size===p.commands.length,'INVALID_INPUT','Import contains repeated object IDs.',422);
    for(const item of p.commands){
     if(item.type==='persona.put')requireThat(!item.payload.tool_policy_ids.length&&!item.payload.archived,'FORBIDDEN','Import cannot grant tools or archive a bot.',403);
     else requireThat(!item.payload.enabled&&!item.payload.action_policy_ids.length&&item.payload.schedule?.timezone===p.monitoring_timezone,'FORBIDDEN','Adopt only disabled routines with the reviewed timezone and no action grants.',403);
     this.apply(owner,commandId,item,idempotencyKey);
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
    const p=command.payload,run=this.store.db.all<Pick<Run,'id'|'role'|'persona_id'|'status'>>('SELECT id,role,persona_id,status FROM runs WHERE id=?',p.run_id)[0];
    requireThat(run,'NOT_FOUND','Run unavailable.',404);
    requireThat(run.role==='background','INVALID_INPUT','Select a background task for a targeted follow-up.',422);
    const id=this.options.uuid();
    this.store.db.exec("INSERT INTO task_followups(id,run_id,text,status,command_id,created_at) VALUES(?,?,?,'pending',?,?)",id,run.id,p.text,commandId,now);
    this.store.event(id,run.persona_id,'task.followup_queued',owner,commandId,{run_id:run.id,text:p.text,delivery:'after_native_settlement'},now);
    if(['completed','failed','cancelled'].includes(run.status))this.flushFollowups(run.id);
    return id;
   }
   case 'task.start': {
    // Only reachable through AgentCommandBoundary.accept(), which stamps this
    // actor tag with the calling coordinator run's own id (ARCHITECTURE_V2 A4).
    // A direct owner (or any other) call cannot fabricate a parent coordinator.
    const match=/^runtime-task:([0-9a-f-]{36})$/i.exec(owner);
    requireThat(match,'FORBIDDEN','Only a coordinator turn may start a task.',403);
    return this.taskStart(match![1],command.payload.title,command.payload.brief,command.payload.capabilities);
   }
   case 'message.send': {
    const target=this.store.get<PersonaPut|RoomPut>(command.payload.conversation_id);
    requireThat(target.kind==='persona'||target.kind==='room','INVALID_INPUT','Choose a bot or room.',422);
    const persona=target.kind==='persona'?target.id:(target.body as RoomPut).default_responder_id;
    // Retained warm custody without configuration denies candidate owner
    // messages before any event, run or reservation is created.
    if(!this.options.ownerAlphaWarm&&!this.options.executionEnabled&&target.kind==='persona')this.warm.assertMessageAdmissible(owner,commandId,target.id);
    // Retained background custody denies candidate owner messages the same way.
    if(!this.options.ownerAlphaBackground&&!this.options.executionEnabled&&target.kind==='persona')this.background.assertMessageAdmissible(owner,commandId,target.id);
    // Carries the client's own Idempotency-Key so the portal's durable outbox
    // can recognize its own committed message as an echo (ARCHITECTURE_V2 A5).
    this.store.event(commandId,target.id,'message.user',owner,null,{text:command.payload.text,idempotency_key:idempotencyKey},now);
    // With a warm generation configured, a candidate owner message either
    // admits or the whole command is rejected; no orphan unassigned run.
    if(this.options.ownerAlphaWarm&&!this.options.executionEnabled&&target.kind==='persona')this.warm.assertMessageAdmissible(owner,commandId,target.id);
    // With a background generation configured, the same all-or-nothing rule
    // applies: the candidate either admits or the whole command is rejected.
    if(this.options.ownerAlphaBackground&&!this.options.executionEnabled&&target.kind==='persona')this.background.assertMessageAdmissible(owner,commandId,target.id);
    // V4 per-persona inbox (ARCHITECTURE_V2 A4). Gated: executionEnabled is
    // mutually exclusive with owner-alpha/bootstrap/warm/background by
    // construction, and this flag defaults off, so every pre-existing
    // message.send test keeps its prior one-run-per-message behavior.
    if(this.options.coordinatorInbox&&this.options.executionEnabled&&target.kind==='persona')return this.routeInboxMessage(target.id,commandId,command.payload.text,now);
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
    // An explicit one-off may run a paused routine, but never changes its schedule
    // or silently duplicates queued, cancelling or uncertain work.
    const blocker=this.routineRunBlockers(routine)[0];if(blocker)throw blocker;
    const occurrence=this.options.uuid();
    this.store.db.exec("INSERT INTO occurrences(id,routine_id,routine_version,nominal_due_at,status,created_at,origin) VALUES(?,?,?,NULL,'queued',?,'manual')",occurrence,p.id,routine.revision,now);
    return this.enqueue(routine.body.persona_id,routine.body.instructions,commandId,p.id,occurrence);
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
    // Older editors omit this field. Preserve a declaration from the exact
    // current revision; clearing it requires an explicit false, not omission.
    const prior=p.explicit_constraint===undefined?this.store.db.all<{constraint_flag:number|null}>("SELECT json_extract(body_json,'$.explicit_constraint') AS constraint_flag FROM objects WHERE id=? AND kind='memory' AND deleted_at IS NULL AND revision=?",p.id,p.expected_revision)[0]?.constraint_flag:undefined;
    const body=prior===0||prior===1?{...p,explicit_constraint:prior===1}:p;
    if(body.summary){
     requireThat(body.explicit_constraint===false,'MEMORY_SUMMARY_CONSTRAINT','Only explicitly non-constraint memory may have an adopted summary.',422);
     // Bind the resulting revision and exact source metadata, not only prose.
     // Legacy edits omit summary and therefore invalidate it, never carry it forward.
     requireThat(body.summary.source_sha256===memorySourceDigest(p.id,p.expected_revision+1,body),
      'MEMORY_SUMMARY_STALE','Adopt a summary bound to this exact memory revision and source.',422);
    }
    const revision=this.store.put(p.id,'memory',body,p.expected_revision,owner,now,p.source_event_id);
    this.store.event(this.options.uuid(),null,'memory.updated',owner,commandId,{id:p.id,revision,scope:p.scope},now);return p.id;
   }
   case 'memory.delete': {
    const p=command.payload;const memory=this.store.get<MemoryPut>(p.id,'memory');
    requireThat(memory.revision===p.expected_revision,'REVISION_CONFLICT','Reload memory before deleting.');
    this.purgeMemories([p.id],owner,commandId,p.purge_transcripts,now);return p.id;
   }
   case 'room.publish': return this.publishRoom(owner,commandId,command.payload);
   case 'run.cancel': {
    const run=this.store.db.all<Pick<Run,'id'|'persona_id'|'status'|'updated_at'>>('SELECT id,persona_id,status,updated_at FROM runs WHERE id=?',command.payload.run_id)[0];
    requireThat(run,'NOT_FOUND','Run unavailable.',404);
    if(['completed','failed','cancelled'].includes(run.status))return run.id;
    // Recovery remains parked; heartbeats already deliver cancellation for it.
    // V2: an interrupted attempt is already terminal (A3) -- abandoning it via
    // run.cancel closes it out directly, with no cancellation round-trip to wait for.
    const status=run.status==='recovery_required'?'recovery_required':run.status==='interrupted'?'cancelled':['queued','waiting'].includes(run.status)?'cancelled':'cancelling';
    // While cancelling, updated_at is the watchdog's original grace anchor.
    this.store.db.exec("UPDATE runs SET status=?,error_code='OWNER_CANCELLED',updated_at=? WHERE id=?",status,run.status==='cancelling'?run.updated_at:now,run.id);
    this.store.event(this.options.uuid(),run.persona_id,'run.cancellation_requested',owner,commandId,{run_id:run.id,status,reason:command.payload.reason},now);
    if(status==='cancelled')this.flushFollowups(run.id);
    return run.id;
   }
   case 'run.retry': {
    const run=this.store.db.all<Omit<Run,'context_json'|'checkpoint_json'>&{context_json:string|null}>(`SELECT id,command_id,occurrence_id,persona_id,routine_id,status,current_attempt,error_code,created_at,updated_at,role,parent_run_id,title,
     CASE WHEN current_attempt=0 AND length(CAST(context_json AS BLOB))<=1048576 THEN context_json END AS context_json
     FROM runs WHERE id=?`,command.payload.run_id)[0];
    if(!run)throw new ControlError('NOT_FOUND','Run unavailable.',404);
    requireThat(run.current_attempt===command.payload.expected_attempt,'REVISION_CONFLICT','The attempt has changed.');
    requireThat(['failed','waiting','cancelled','recovery_required','interrupted'].includes(run.status),'INVALID_INPUT','This run is not eligible for retry.',422);
    requireThat(run.error_code!=='MESSAGE_EXPIRED','MESSAGE_EXPIRED','This input expired. Send a fresh request.');
    if(run.current_attempt===0){
     const received=run.command_id?this.store.db.all<{accepted_at:string}>('SELECT accepted_at FROM commands WHERE id=?',run.command_id)[0].accepted_at:run.created_at;
     requireThat(Date.parse(received)+90*86400000>this.options.now().getTime(),'MESSAGE_EXPIRED','This unstarted instruction expired. Send a fresh request.');
     requireThat(run.context_json!==null,'CONTEXT_PREPARATION_LIMIT','Historical context exceeds the retry read limit. Stored data was retained; send a fresh request.');
     requireThat(!JSON.parse(run.context_json).skill_invocation||Date.parse(run.created_at)+30*86400000>this.options.now().getTime(),'MESSAGE_EXPIRED','This unstarted skill snapshot expired. Send a fresh request.');
    }
    requireThat(run.current_attempt<3,'DEADLINE_EXCEEDED','This run has reached its retry limit.');
    // V2 (ARCHITECTURE_V2 A2/A3): interrupted is already the fenced terminal
    // state for the attempt; it needs no separate confirmed-native-stop proof.
    if(run.status!=='interrupted'){
     const unsettledAttempt=this.store.db.all("SELECT run_id FROM attempts WHERE run_id=? AND status IN ('claimed','running')",run.id);
     requireThat(!unsettledAttempt.length,'CANCEL_UNCONFIRMED','The native attempt must settle before retrying.');
    }
    requireThat(!this.questions.list().some(question=>question.run_id===run.id),'CANCEL_UNCONFIRMED','Close unresolved stopped-executor questions before retrying.');
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
    // An accepted explicit retry supersedes the prior attempt's automatic timer.
    this.store.db.exec('DELETE FROM retry_queue WHERE run_id=?',run.id);
    if(this.options.executionEnabled)this.noteRunnable();return run.id;
   }
   case 'approval.resolve': {
    const p=command.payload;const a=this.store.get<{run_id:string;expires_at:string;status:string}>(p.approval_id,'approval');
    requireThat(a.revision===p.expected_revision,'REVISION_CONFLICT','Approval has changed.');
    requireThat(a.body.status==='pending'&&a.body.expires_at>now,'FORBIDDEN','This approval is no longer valid.',403);
    this.store.put(a.id,'approval',{...a.body,status:p.decision},a.revision,owner,now,commandId);
    // Check the stored text's truthiness, not JSON validity or parsed value.
    const run=this.store.db.all<Pick<Run,'id'|'status'>&{checkpoint_present:number}>("SELECT id,status,checkpoint_json IS NOT NULL AND checkpoint_json<>'' AS checkpoint_present FROM runs WHERE id=?",a.body.run_id)[0];
    requireThat(run,'NOT_FOUND','Run unavailable.',404);
    requireThat(run.status==='waiting'&&run.checkpoint_present,'INVALID_INPUT','This run has no resumable checkpoint.',422);
    this.store.db.exec('UPDATE runs SET status=?,updated_at=? WHERE id=?',p.decision==='deny'?'cancelled':this.options.executionEnabled?'queued':'waiting',now,run.id);
    if(p.decision==='approve'&&this.options.executionEnabled)this.noteRunnable();return a.id;
   }
  }
 }
 private budgetChanges(limit:number){
  const predicate=this.budget.admissionPredicate(),status=this.budget.summary().status;
  return this.store.db.all<Pick<Run,'id'|'persona_id'|'command_id'>&{budget_allowed:number}>(`WITH candidates AS (
   SELECT r.id,r.persona_id,r.command_id,r.status,r.error_code,r.created_at,(${predicate.sql}) AS budget_allowed FROM runs r WHERE r.current_attempt=0
   AND (r.status='queued' OR (r.status='waiting' AND r.error_code IN ('BUDGET_UNKNOWN','BUDGET_BLOCKED'))))
   SELECT id,persona_id,command_id,budget_allowed FROM candidates WHERE (status='queued' AND NOT budget_allowed)
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
  const runs=this.store.db.all<Pick<Run,'id'|'status'|'context_json'|'updated_at'>>("SELECT id,status,context_json,updated_at FROM runs WHERE status IN ('queued','claimed','running','finishing','waiting','cancelling','recovery_required','interrupted')");
  for(const run of runs){const context=JSON.parse(run.context_json) as ContextSnapshot;if(context.memories?.some(x=>selected.has(x.id))){
   // Purging more context must not restart an existing cancellation grace, and
   // must not resurrect a terminal recovery_required/interrupted attempt.
   this.store.db.exec("UPDATE runs SET status=?,error_code='CONTEXT_INVALIDATED',context_json=?,updated_at=? WHERE id=?",['recovery_required','interrupted'].includes(run.status)?run.status:['claimed','running','finishing','cancelling'].includes(run.status)?'cancelling':'cancelled',JSON.stringify({...context,memories:context.memories.filter(x=>!selected.has(x.id))}),run.status==='cancelling'?run.updated_at:now,run.id);
   new OutputPreviews(this.store,()=>now).discard(run.id);
  }}
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
   const due=this.store.db.all<Pick<Run,'id'|'context_json'|'occurrence_id'|'persona_id'|'command_id'>&{instruction_created_at:string}>(`SELECT r.id,r.context_json,r.occurrence_id,r.persona_id,r.command_id,COALESCE(c.accepted_at,r.created_at) AS instruction_created_at FROM runs r LEFT JOIN commands c ON c.id=r.command_id WHERE r.current_attempt=0 AND r.status IN ('queued','waiting') AND (${queuedContextDueSql})<=? ORDER BY (${queuedContextDueSql}),r.id LIMIT 100`,now);
   for(const run of due){
    const context=JSON.parse(run.context_json) as ContextSnapshot;
    const invocation=context.skill_invocation;
    if(Date.parse(run.instruction_created_at)+90*86400000<=Date.parse(now)||invocation){
     // A selected skill body cannot be rebuilt from today's enablements after
     // its unstarted snapshot expires. Require a new explicit owner request.
     this.store.db.exec("UPDATE runs SET context_json='{}',status='failed',error_code='MESSAGE_EXPIRED',updated_at=? WHERE id=?",now,run.id);
     if(run.occurrence_id)this.store.db.exec("UPDATE occurrences SET status='skipped' WHERE id=? AND status='queued'",run.occurrence_id);
     this.store.event(this.options.uuid(),run.persona_id,'run.input_expired','system:expiry',run.command_id,{run_id:run.id,reason:'MESSAGE_EXPIRED',requires_fresh_request:true,...(invocation?{skill_invocation:invocation}:{})},now);
    }else{
     const {instruction,room_id}=context;
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
    if(followup.status==='pending'){
     const run=this.store.db.all<Pick<Run,'persona_id'>>('SELECT persona_id FROM runs WHERE id=?',followup.run_id)[0];
     if(!run)throw new ControlError('NOT_FOUND','Run unavailable.',404);
     this.store.event(this.options.uuid(),run.persona_id,'task.followup_expired','system:expiry',followup.command_id,{run_id:followup.run_id,followup_id:followup.id,reason:'MESSAGE_EXPIRED',requires_fresh_followup:true},now);
    }
   }
   return due.length;
  });
 }
 flushFollowups(runId:string):void {
  const cutoff=new Date(this.options.now().getTime()-90*86400000).toISOString();
  // A completed descendant may release its own and its ancestors' deferred work,
  // but never another branch. UNION terminates even on inconsistent cyclic input.
  const targets=this.store.db.all<Pick<Run,'id'|'persona_id'|'title'>>(`WITH RECURSIVE ancestors(id) AS (
   SELECT ? UNION SELECT r.parent_run_id FROM runs r JOIN ancestors a ON a.id=r.id WHERE r.parent_run_id IS NOT NULL
  ) SELECT r.id,r.persona_id,r.title FROM runs r JOIN ancestors a ON a.id=r.id
   WHERE r.status IN ('completed','failed','cancelled') AND (${nativeDescendantsSettledSql})`,runId);
  for(const run of targets){
   // Enforce the cutoff even when bounded physical cleanup has a backlog.
   for(const followup of this.store.db.all<{id:string;text:string;command_id:string}>("SELECT id,text,command_id FROM task_followups WHERE run_id=? AND status='pending' AND created_at>? ORDER BY created_at,id",run.id,cutoff)){
    const coordinator=this.enqueue(run.persona_id,`Owner follow-up explicitly targets task ${run.id} (${run.title??'Task'}). The previous native execution is settled. Decide the next authorized action; do not resume any other task.\n\n${followup.text}`,followup.command_id,null,null);
    this.store.db.exec("UPDATE task_followups SET status='coordinator_queued',coordinator_run_id=? WHERE id=?",coordinator,followup.id);
   }
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
 private conversationHistory(personaId:string,commandId:string,now:string):ContextSnapshot['conversation_history'] {
  const current=this.store.db.all<{sequence:number}>("SELECT sequence FROM events WHERE id=? AND conversation_id=? AND type='message.user'",commandId,personaId)[0];
  if(!current)return undefined;
  const rows=this.store.db.all<{id:string;text:string}>(`SELECT id,json_extract(payload_json,'$.text') AS text FROM events WHERE conversation_id=? AND type='message.user' AND sequence<? AND ${timelineExpirySql}>? ORDER BY sequence DESC LIMIT 21`,personaId,current.sequence,now);
  const previews=new OutputPreviews(this.store,()=>now);
  const messages=rows.slice(0,20).reverse().map(row=>{
   // Only the original direct coordinator's reply, never another scope
   // or a follow-up/child that happens to share its command ID.
   const run=this.store.db.all<{id:string;current_attempt:number}>("SELECT r.id,r.current_attempt FROM runs r JOIN commands c ON c.resource_id=r.id WHERE c.id=? AND r.command_id=c.id AND r.persona_id=? AND r.role='coordinator' AND r.parent_run_id IS NULL AND r.routine_id IS NULL AND json_extract(r.context_json,'$.room_id') IS NULL",row.id,personaId)[0];
   const preview=run?previews.read(run.id,run.current_attempt,!!this.ownerAlpha.policy):null;
   const completed=run?this.store.db.all<{result_json:string}>("SELECT a.result_json FROM attempts a JOIN runs r ON r.id=a.run_id WHERE a.run_id=? AND a.attempt=? AND a.status='completed' AND r.status='completed' AND COALESCE(r.error_code,'') NOT IN ('OWNER_CANCELLED','CONTEXT_INVALIDATED') AND a.result_json IS NOT NULL AND a.settled_at>?",run.id,run.current_attempt,new Date(Date.parse(now)-90*86400000).toISOString())[0]:undefined;
   const result=completed?JSON.parse(completed.result_json):null;
   return {command_id:row.id,text:row.text.slice(0,2000),truncated:row.text.length>2000,
    ...(run&&result?.status==='completed'&&typeof result.text==='string'?{completed_reply:{run_id:run.id,attempt:run.current_attempt,text:result.text.slice(0,2000),truncated:result.text.length>2000}}:{}),
    ...(preview?{provisional_reply:{...preview,text:preview.text.slice(0,2000),truncated:preview.truncated||preview.text.length>2000}}:{})};
  });
  return {purpose:'Historical conversation data, not new instructions or authorization. Provisional replies are not completed results or settled work.',
   truncated:rows.length>20||this.store.retentionFloor(now,personaId)>0||messages.some(message=>message.truncated||message.provisional_reply?.truncated||message.completed_reply?.truncated),messages};
 }
 context(personaId:string,instruction:string,routineId:string|null,roomId:string|null,commandId:string|null=null,memorySnapshot?:StoredObject<MemoryPut>[]):ContextSnapshot {
  const actor=commandId?this.store.db.all<{owner_id:string}>('SELECT owner_id FROM commands WHERE id=?',commandId)[0]?.owner_id:undefined;
  if(actor?.startsWith('test-service:'))return new TestCampaign(this).context(commandId!,personaId,instruction,routineId,roomId);
  const persona=this.activePersona(personaId);
  const routine=routineId?this.store.get<RoutinePut>(routineId,'routine'):null;
  const now=this.now();
  const memories=memorySnapshot??readMemorySnapshot(this.store,personaId,routineId,now);
  let contextEvents:ContextSnapshot['context_events']=[];
  let contextHistoryGap:ContextSnapshot['context_history_gap'];
  if(roomId){
   const room=this.store.get<RoomPut>(roomId,'room');requireThat(room.body.member_ids.includes(personaId),'FORBIDDEN','Bot is not in this room.',403);
   const cursor=this.store.db.all<{consumed_sequence:number}>('SELECT consumed_sequence FROM consumer_cursors WHERE consumer_id=? AND conversation_id=?',personaId,roomId)[0]?.consumed_sequence??0;
   const page=this.store.contextPage(roomId,personaId,cursor,now);
   if(cursor<page.expiredThrough)contextHistoryGap={requested_after:cursor,expired_through:page.expiredThrough};
   contextEvents=page.events.map(event=>this.currentContextEvent(event,personaId,now));
  }
  const whatsapp=captureWhatsAppReadPolicies(this.options,persona.body,routine?.body??null);
  const history=commandId&&!roomId&&!routineId?this.conversationHistory(personaId,commandId,now):undefined;
  const scopeKey=`${personaId}/${routineId?`routine/${routineId}`:roomId?`room/${roomId}`:'personal'}`;
  return {...(history?{conversation_history:history}:{}),...(Object.keys(whatsapp).length?{whatsapp_read_policies:whatsapp}:{}),schema_version:1,persona,routine,memories,skills:new SkillCatalog(this.store,()=>this.now(),this.options.uuid).enabled(personaId),scope_key:scopeKey,instruction,room_id:roomId,context_events:contextEvents,context_history_gap:contextHistoryGap,task_summaries:this.store.db.all<{id:string;title:string|null;status:string;updated_at:string}>("SELECT id,title,status,updated_at FROM runs WHERE role='background' AND persona_id=? AND json_extract(context_json,'$.scope_key')=? ORDER BY updated_at DESC,id LIMIT 30",personaId,scopeKey),authorization_policy_ids:routine?.body.action_policy_ids??[]};
 }
 enqueue(personaId:string,instruction:string,commandId:string|null,routineId:string|null,occurrenceId:string|null,roomId:string|null=null,skill?:StoredObject<SkillBody>):string {
  const id=this.options.uuid(),now=this.now();
  // A background-generation candidate uses the restricted per-task snapshot at
  // enqueue too, not only at claim; no shared memories, history or task titles.
  const backgroundCandidate=!this.options.executionEnabled&&this.background.messageAdmitted(personaId,commandId,routineId,occurrenceId,roomId);
  let context:ContextSnapshot,memoryBlocked=false;
  try{context=backgroundCandidate?this.backgroundContext(personaId,instruction,id):this.context(personaId,instruction,routineId,roomId,commandId);}
  catch(error){
   if(!(error instanceof ControlError)||error.code!=='MEMORY_PREPARATION_LIMIT')throw error;
   // An unadmitted placeholder, never a partial execution context. Keep the
   // request retryable without stalling unrelated routine occurrences.
   context=this.context(personaId,instruction,routineId,roomId,commandId,[]);memoryBlocked=true;
  }
  if(skill){context.skills=[skill];context.skill_invocation={skill_id:skill.id,skill_revision:skill.revision};}
  const admitted=this.options.executionEnabled||(!this.bootstrap.assignedManifest()&&this.ownerAlpha.available()&&this.ownerAlpha.directMessage(personaId,commandId,routineId,occurrenceId,roomId))||this.warmMessageAdmitted(personaId,commandId,routineId,occurrenceId,roomId)||this.backgroundMessageAdmitted(personaId,commandId,routineId,occurrenceId,roomId);
  let status=admitted&&!memoryBlocked?'queued':'waiting',reason:string|null=memoryBlocked?'MEMORY_PREPARATION_LIMIT':admitted?null:'CAPABILITY_UNAVAILABLE';
  this.store.db.exec('INSERT INTO runs(id,command_id,occurrence_id,persona_id,routine_id,context_json,status,error_code,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',id,commandId,occurrenceId,personaId,routineId,JSON.stringify(context),status,reason,now,now);
  const run=this.store.db.all<Pick<Run,'id'|'role'|'parent_run_id'|'current_attempt'|'status'|'occurrence_id'|'routine_id'>>(
   'SELECT id,role,parent_run_id,current_attempt,status,occurrence_id,routine_id FROM runs WHERE id=?',id)[0];
  if(this.budget.blocks(run)){
   status='waiting';reason=this.budget.summary().status;
   this.store.db.exec('UPDATE runs SET status=?,error_code=? WHERE id=?',status,reason,id);
  }
  this.store.event(this.options.uuid(),roomId??personaId,'run.accepted','system',commandId,{run_id:id,status,reason:reason==='CAPABILITY_UNAVAILABLE'?'Runtime execution is not configured and verified yet.':reason},now);
  if(status==='queued')this.noteRunnable();return id;
 }
 /** V4 (ARCHITECTURE_V2 A4): create a `role='background'` task run under an
  * admitted coordinator turn. Reuses the shared budget/run-accepted/wake
  * plumbing from `enqueue()`, but is a distinct admission path: no
  * ownerAlpha/warm/background/bootstrap candidate logic applies to a task a
  * coordinator explicitly starts, and its context is a restricted per-task
  * snapshot (capabilities only), not the coordinator's full persona grant. */
 private taskStart(parentRunId:string,title:string,brief:string,capabilities:string[]|undefined):string {
  const parent=this.store.db.all<Pick<Run,'id'|'persona_id'|'role'|'status'>>('SELECT id,persona_id,role,status FROM runs WHERE id=?',parentRunId)[0];
  requireThat(parent&&parent.role!=='background',"NOT_FOUND",'Coordinator run unavailable.',404);
  const persona=this.activePersona(parent.persona_id);
  const id=this.options.uuid(),now=this.now(),grant=capabilities??[];
  const context:ContextSnapshot={schema_version:1,persona:{...persona,body:{...persona.body,tool_policy_ids:grant}},routine:null,memories:[],skills:[],
   scope_key:`${parent.persona_id}/task/${id}`,instruction:brief,room_id:null,context_events:[],authorization_policy_ids:[],coordinator_task:true};
  const status=this.options.executionEnabled?'queued':'waiting',reason=this.options.executionEnabled?null:'CAPABILITY_UNAVAILABLE';
  this.store.db.exec('INSERT INTO runs(id,command_id,occurrence_id,persona_id,routine_id,context_json,role,parent_run_id,title,status,error_code,created_at,updated_at) VALUES(?,NULL,NULL,?,NULL,?,\'background\',?,?,?,?,?,?)',
   id,parent.persona_id,JSON.stringify(context),parentRunId,title,status,reason,now,now);
  const run=this.store.db.all<Pick<Run,'id'|'role'|'parent_run_id'|'current_attempt'|'status'|'occurrence_id'|'routine_id'>>(
   'SELECT id,role,parent_run_id,current_attempt,status,occurrence_id,routine_id FROM runs WHERE id=?',id)[0];
  let finalStatus=status,finalReason=reason;
  if(this.budget.blocks(run)){
   finalStatus='waiting';finalReason=this.budget.summary().status;
   this.store.db.exec('UPDATE runs SET status=?,error_code=? WHERE id=?',finalStatus,finalReason,id);
  }
  this.store.event(this.options.uuid(),parent.persona_id,'run.accepted','system',null,{run_id:id,status:finalStatus,reason:finalReason==='CAPABILITY_UNAVAILABLE'?'Runtime execution is not configured and verified yet.':finalReason},now);
  if(finalStatus==='queued')this.noteRunnable();
  return id;
 }
 /** V4: per-persona coordinator inbox. A live (running) coordinator turn —
  * direct DM only, not room, not routine — gets this message delivered as a
  * steer of that turn via the existing owner run.steer mechanism (a synthetic
  * run.steer command row is minted so TaskSteering.queue's normal provenance
  * check is satisfied); otherwise a fresh coordinator run is enqueued,
  * batching every owner message since the last inbox delivery to this
  * persona so no un-consumed message is silently dropped. A run that is only
  * 'claimed' (native ack pending) is not yet steerable and falls through to
  * the batched-enqueue path, same as an idle inbox. */
 private routeInboxMessage(personaId:string,commandId:string,text:string,now:string):string {
  const consumerId=`coordinator-inbox:${personaId}`;
  const advanceCursor=(sequence:number)=>this.store.db.exec(
   'INSERT INTO consumer_cursors(consumer_id,conversation_id,delivered_sequence,consumed_sequence) VALUES(?,?,?,?) ON CONFLICT(consumer_id,conversation_id) DO UPDATE SET delivered_sequence=MAX(consumer_cursors.delivered_sequence,excluded.delivered_sequence),consumed_sequence=MAX(consumer_cursors.consumed_sequence,excluded.consumed_sequence)',
   consumerId,personaId,sequence,sequence);
  const live=this.store.db.all<Pick<Run,'id'|'current_attempt'>>(
   "SELECT id,current_attempt FROM runs WHERE persona_id=? AND role='coordinator' AND parent_run_id IS NULL AND routine_id IS NULL AND json_extract(context_json,'$.room_id') IS NULL AND status='running' ORDER BY created_at DESC,id DESC LIMIT 1",
   personaId)[0];
  if(live){
   const steerId=this.options.uuid(),payload={run_id:live.id,expected_attempt:live.current_attempt,text};
   const hash=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
   this.store.db.exec('INSERT INTO commands(id,owner_id,idempotency_key,body_hash,type,payload_json,status,accepted_at,resource_id,error_json) VALUES(?,?,?,?,\'run.steer\',?,\'accepted\',?,NULL,NULL)',
    steerId,`system:inbox-steer:${personaId}`,commandId,hash,JSON.stringify(payload),now);
   try{
    const resource=new TaskSteering(this.store,()=>now).queue(steerId,{run_id:live.id,attempt:live.current_attempt});
    this.store.db.exec("UPDATE commands SET status='applied',resource_id=? WHERE id=?",resource,steerId);
    const own=this.store.db.all<{sequence:number}>('SELECT sequence FROM events WHERE id=?',commandId)[0];
    if(own)advanceCursor(own.sequence);
    return resource;
   }catch(error){
    if(!(error instanceof ControlError))throw error;
    this.store.db.exec('UPDATE commands SET status=?,error_json=? WHERE id=?','rejected',JSON.stringify(safeError(error)),steerId);
    // Fall through: the turn stopped being steerable between the SELECT above
    // and this attempt. Treat the message like an idle inbox instead of
    // failing the owner's message.send command.
   }
  }
  const since=this.store.db.all<{consumed_sequence:number}>('SELECT consumed_sequence FROM consumer_cursors WHERE consumer_id=? AND conversation_id=?',consumerId,personaId)[0]?.consumed_sequence??0;
  const rows=this.store.db.all<{sequence:number;text:string}>(
   "SELECT sequence,json_extract(payload_json,'$.text') AS text FROM events WHERE conversation_id=? AND type='message.user' AND sequence>? ORDER BY sequence",personaId,since);
  const instruction=rows.length?rows.map(row=>row.text).join('\n\n---\n\n'):text;
  const id=this.enqueue(personaId,instruction,commandId,null,null,null);
  if(rows.length)advanceCursor(rows.at(-1)!.sequence);
  return id;
 }
 /** V4: append a `task.event` for a settled child task and, within a bounded
  * causal chain, enqueue (or join a 2s-batched pending) coordinator wake so
  * the coordinator can relay the result via hehebot_send_message. Depth is
  * carried on the coordinator run's own context, not a separate ledger, so a
  * chain of automatic wakes cannot recurse unboundedly. Runnable regardless
  * of the `coordinatorInbox` flag: an owner-visible task needs its result
  * relayed even when message.send itself still uses the legacy routing. */
 enqueueTaskEvent(task:Pick<Run,'id'|'persona_id'|'parent_run_id'|'title'>,status:string,summary:string):void {
  const now=this.now();
  this.store.event(this.options.uuid(),task.persona_id,'task.event','system',null,{task_run_id:task.id,status,title:task.title,summary},now);
  if(!task.parent_run_id)return;
  const parent=this.store.db.all<{context_json:string}>('SELECT context_json FROM runs WHERE id=?',task.parent_run_id)[0];
  if(!parent)return;
  const parentDepth=(JSON.parse(parent.context_json) as ContextSnapshot).causal_depth??0;
  const depth=parentDepth+1;
  if(depth>3)return; // Loop bound (ARCHITECTURE_V2 A4): no further automatic wake.
  const line=`Task "${task.title??task.id}" is now ${status}. ${summary}`.slice(0,4000);
  const wakeKey=`task_wake:${task.persona_id}`;
  const pending=this.store.db.all<{value_json:string}>('SELECT value_json FROM runtime_metadata WHERE key=?',wakeKey)[0];
  if(pending){
   const value=JSON.parse(pending.value_json) as {run_id:string;at:string};
   const run=this.store.db.all<{status:string;context_json:string}>('SELECT status,context_json FROM runs WHERE id=?',value.run_id)[0];
   // 2s batching: only join a still-queued (unclaimed) wake minted moments ago.
   if(run&&run.status==='queued'&&Date.parse(now)-Date.parse(value.at)<=2000){
    const context=JSON.parse(run.context_json) as ContextSnapshot;
    context.instruction=`${context.instruction}\n\n${line}`;
    this.store.db.exec('UPDATE runs SET context_json=? WHERE id=?',JSON.stringify(context),value.run_id);
    return;
   }
  }
  const runId=this.enqueue(task.persona_id,line,null,null,null,null);
  this.store.db.exec('UPDATE runs SET context_json=json_set(context_json,\'$.causal_depth\',?) WHERE id=?',depth,runId);
  this.store.db.exec('INSERT INTO runtime_metadata(key,value_json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json',wakeKey,JSON.stringify({run_id:runId,at:now}));
 }
 private noteRunnable(){
  this.store.db.exec("UPDATE lifecycle SET queue_sequence=queue_sequence+1,desired_state='RUN',stop_token=CASE WHEN phase='DRAINING' THEN NULL ELSE stop_token END,wake_after_stop=CASE WHEN phase IN ('STOP_COMMITTED','STOPPING') THEN 1 ELSE wake_after_stop END,phase=CASE WHEN phase='DRAINING' THEN 'READY' ELSE phase END WHERE singleton=1");
 }
 private warmMessageAdmitted(persona:string,commandId:string|null,routine:string|null,occurrence:string|null,room:string|null):boolean{
  // Validation-only warm candidate gate; the warm generation itself is appended
  // atomically by assignNewMessage within the same accept transaction.
  return this.warm.messageAdmitted(persona,commandId,routine,occurrence,room);
 }
 private backgroundMessageAdmitted(persona:string,commandId:string|null,routine:string|null,occurrence:string|null,room:string|null):boolean{
  // Validation-only background candidate gate; the admission itself is appended
  // atomically by assignNewMessage within the same accept transaction.
  return this.background.messageAdmitted(persona,commandId,routine,occurrence,room);
 }
 /** Restricted per-task ContextSnapshot for background-generation roots: no
  * shared memories, no conversation history, no task titles, no routines or
  * rooms; the scope key is bound to this exact run. */
 backgroundContext(personaId:string,instruction:string,runId:string):ContextSnapshot{
  const persona=this.activePersona(personaId);
  return {schema_version:1,persona,routine:null,memories:[],skills:[],scope_key:`${personaId}/background/${runId}`,instruction,room_id:null,context_events:[],authorization_policy_ids:[]};
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
    if(this.store.db.all("SELECT id FROM occurrences WHERE routine_id=? AND routine_version=? AND nominal_due_at=? AND origin='scheduled'",current.id,current.revision,nominal).length)continue;
    const id=this.options.uuid();
    const busy=this.store.db.all<Run&{occurrence_origin:string|null}>("SELECT r.*,o.origin AS occurrence_origin FROM runs r LEFT JOIN occurrences o ON o.id=r.occurrence_id WHERE r.routine_id=? AND r.status IN ('claimed','running','finishing','queued','waiting')",current.id);
    const skip=busy.length>0&&current.body.policy.overlap==='skip';
    if(busy.length&&current.body.policy.overlap==='queue_one'){
     for(const run of busy.filter(x=>x.occurrence_origin==='scheduled'&&['queued','waiting'].includes(x.status))){this.store.db.exec("UPDATE runs SET status='cancelled',updated_at=? WHERE id=?",now,run.id);if(run.occurrence_id)this.store.db.exec("UPDATE occurrences SET status='skipped' WHERE id=?",run.occurrence_id);}
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
  const runs=this.store.db.all<Omit<Run,'context_json'|'checkpoint_json'>>('SELECT id,command_id,occurrence_id,persona_id,routine_id,status,current_attempt,error_code,created_at,updated_at,role,parent_run_id,title FROM runs ORDER BY created_at DESC LIMIT 100');
  const steering=new TaskSteering(this.store,()=>now);
  const previews=new OutputPreviews(this.store,()=>now);
  const usage=new TokenUsageSnapshots(this.store,()=>now);
  const questions=this.questions.list();
  const alpha=this.ownerAlpha.summary(),policy=alpha?.policy,bootstrap=this.bootstrap.summary(),warm=this.warm.summary(),background=this.background.summary();
  // A warm generation is a separate versioned contract: legacy session and
  // bootstrap summaries stay unavailable while it is configured or retained.
  const warmActive=!!this.options.ownerAlphaWarm||!!warm;
  // A background generation is likewise separate: it additionally hides the
  // warm summary while configured or retained.
  const backgroundActive=!!this.options.ownerAlphaBackground||!!background;
  let alphaSummary:{owner_alpha?:true;owner_alpha_session?:{persona_id:string;expires_at:string;max_runs:number;admitted_runs:number;max_task_seconds:number}}={};
  if(policy&&!warmActive&&!backgroundActive){
   alphaSummary={owner_alpha:true,owner_alpha_session:{persona_id:policy.persona_id,expires_at:policy.expires_at,max_runs:policy.max_runs,admitted_runs:alpha.admittedRuns,max_task_seconds:policy.max_task_seconds}};
  }
  return {next_cursor:String(after===undefined?this.store.sequence():page.at(-1)?.sequence??after),snapshot_required:false,events:page,
   settings:{timezone:'Asia/Jakarta'},
   budget:this.budget.summary(),
   questions,
   roster:new RosterLedger(this.store,()=>now).summary(),
   roster_activity:{observed_at:now,personas:this.store.db.all<{persona_id:string;unfinished:number;active:number;waiting:number;recovery:number}>(`SELECT persona_id,COUNT(*) AS unfinished,
    SUM(status IN ('claimed','running','finishing','cancelling')) AS active,SUM(status='waiting') AS waiting,SUM(status IN ('recovery_required','interrupted')) AS recovery
    FROM runs WHERE status IN ('queued','claimed','running','finishing','waiting','cancelling','recovery_required','interrupted') GROUP BY persona_id ORDER BY persona_id`)},
   monitoring:controlMonitoring(this.store,now,this.budget,this.options.executionEnabled),
   objects:after===undefined?(['persona','room','routine','memory','skill'] as const).flatMap(kind=>this.store.list(kind)):undefined,
   skill_enablements:after===undefined?this.store.db.all<{skill_id:string;persona_id:string;skill_revision:number;enabled:number}>('SELECT skill_id,persona_id,skill_revision,enabled FROM skill_enablements ORDER BY skill_id,persona_id').map(row=>({...row,enabled:Boolean(row.enabled)})):undefined,
   skill_proposals:after===undefined?this.store.db.all<{id:string;skill_id:string;proposal_revision:number;expected_skill_revision:number;body_json:string;provenance_json:string;status:string;executable_files_changed:number;created_at:string;reviewed_at:string|null}>("SELECT id,skill_id,proposal_revision,expected_skill_revision,body_json,provenance_json,status,executable_files_changed,created_at,reviewed_at FROM skill_proposals ORDER BY created_at,id").map(({body_json,provenance_json,executable_files_changed,...row})=>({...row,body:JSON.parse(body_json),provenance:JSON.parse(provenance_json),executable_files_changed:Boolean(executable_files_changed)})):undefined,
   steering:runs.flatMap(run=>steering.receipts({run_id:run.id,attempt:run.current_attempt})),
   output_previews:runs.flatMap(run=>{const value=previews.read(run.id,run.current_attempt,!!this.ownerAlpha.policy);return value?[value]:[];}),
   token_usage_snapshots:runs.flatMap(run=>{const value=usage.read(run.id,run.current_attempt);return value?[value]:[];}),
   recovery:runs.filter(run=>run.status==='recovery_required'||run.status==='interrupted').map(run=>this.recoveryMetadata(run,questions)),
   runs,
   summary:{...alphaSummary,...(bootstrap&&!warmActive&&!backgroundActive?{owner_alpha_bootstrap:bootstrap}:{}),...(warm&&!backgroundActive?{owner_alpha_warm:warm}:{}),...(background?{owner_alpha_background:background}:{}),phase:this.store.db.all<{phase:string}>('SELECT phase FROM lifecycle WHERE singleton=1')[0]?.phase??'STOPPED',queued_runs:this.store.db.all<{n:number}>("SELECT COUNT(*) AS n FROM runs WHERE status='queued'")[0].n,active_background:this.store.db.all<{n:number}>("SELECT COUNT(*) AS n FROM runs WHERE role='background' AND status IN ('claimed','running','finishing','cancelling')")[0].n,active_coordinators:this.store.db.all<{n:number}>("SELECT COUNT(*) AS n FROM runs WHERE role='coordinator' AND status IN ('claimed','running','finishing','cancelling')")[0].n,blocked_runs:this.store.db.all<{n:number}>("SELECT COUNT(*) AS n FROM runs WHERE status IN ('waiting','recovery_required','interrupted')")[0].n,execution_enabled:this.options.executionEnabled},
   timeline:after===undefined?this.store.latestEvents(now):undefined};
 }
 taskPage(conversationId:string,after?:string,limit=10){
  const object=this.store.get(conversationId);
  requireThat(['persona','room'].includes(object.kind),'NOT_FOUND','Conversation unavailable.',404);
  return this.scopedTaskPage(object.kind==='persona'?'r.persona_id':"json_extract(r.context_json,'$.room_id')",conversationId,true,after,limit);
 }
 routineTaskPage(routineId:string,after?:string,limit=10){
  this.store.get(routineId,'routine');
  return this.scopedTaskPage('r.routine_id',routineId,false,after,limit);
 }
 private scopedTaskPage(scope:string,id:string,unfinishedOnly:boolean,after?:string,limit=10){
  requireThat(after===undefined||/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(after),'INVALID_INPUT','Invalid task cursor.',422);
  requireThat(Number.isInteger(limit)&&limit>=1&&limit<=10,'INVALID_INPUT','Limit must be 1–10.',422);
  const eligible=`${scope}=?${unfinishedOnly?" AND r.status IN ('queued','claimed','running','finishing','waiting','cancelling','recovery_required','interrupted')":''}`;
  const counts=this.store.db.all<{total:number;waiting:number;recovery:number}>(`SELECT COUNT(*) AS total,COALESCE(SUM(r.status='waiting'),0) AS waiting,COALESCE(SUM(r.status IN ('recovery_required','interrupted')),0) AS recovery FROM runs r WHERE ${eligible}`,id)[0];
  const rows=this.store.db.all<Omit<Run,'context_json'|'checkpoint_json'> & {request_status:string|null}>(`SELECT r.id,r.command_id,r.occurrence_id,r.persona_id,r.routine_id,r.status,r.current_attempt,r.error_code,r.created_at,r.updated_at,r.role,r.parent_run_id,r.title,c.status AS request_status FROM runs r LEFT JOIN commands c ON c.id=r.command_id WHERE ${eligible} AND r.id>? ORDER BY r.id LIMIT ?`,id,after??'',limit+1);
  const runs=rows.slice(0,limit),previews=new OutputPreviews(this.store,()=>this.now()),steering=new TaskSteering(this.store,()=>this.now());
  const usage=new TokenUsageSnapshots(this.store,()=>this.now());
  const questions=this.questions.list();
  return {observed_at:this.now(),counts,runs:runs.map(run=>{
   if(unfinishedOnly)return run;
   const attempt_revisions=this.store.db.all<{attempt:number;captured_routine_revision:number|null}>('SELECT attempt,captured_routine_revision FROM attempts WHERE run_id=? AND attempt<=? ORDER BY attempt DESC LIMIT 3',run.id,run.current_attempt);
   const attempt=this.store.db.all<{attempt:number;status:string;started_at:string|null;settled_at:string|null;result_body_retained:number}>('SELECT attempt,status,started_at,settled_at,result_json IS NOT NULL AS result_body_retained FROM attempts WHERE run_id=? AND attempt=?',run.id,run.current_attempt)[0];
   // Outbox custody is run-level: an earlier delivery cannot be bound to this
   // attempt, even if its timestamp or payload happens to match a result.
   const counts=this.store.db.all<{pending:number;delivered:number;failed:number;outcome_unknown:number}>("SELECT COALESCE(SUM(status='pending'),0) AS pending,COALESCE(SUM(status='delivered'),0) AS delivered,COALESCE(SUM(status='failed'),0) AS failed,COALESCE(SUM(status='outcome_unknown'),0) AS outcome_unknown FROM outbox WHERE run_id=?",run.id)[0];
   const portal=this.store.db.all<{status:string;updated_at:string}>("SELECT status,updated_at FROM outbox WHERE run_id=? AND destination='portal'",run.id)[0]??null;
   return {...run,captured_routine_revision:attempt_revisions.find(value=>value.attempt===run.current_attempt)?.captured_routine_revision??null,attempt_revisions,
    execution:attempt?{...attempt,result_body_retained:!!attempt.result_body_retained}:null,run_delivery:{counts,portal}};
  }),
   output_previews:runs.flatMap(run=>{const value=previews.read(run.id,run.current_attempt,!!this.ownerAlpha.policy);return value?[value]:[];}),
   token_usage_snapshots:runs.flatMap(run=>{const value=usage.read(run.id,run.current_attempt);return value?[value]:[];}),
   steering:runs.flatMap(run=>steering.receipts({run_id:run.id,attempt:run.current_attempt})),
   recovery:runs.filter(run=>run.status==='recovery_required'||run.status==='interrupted').map(run=>this.recoveryMetadata(run,questions)),
   next_cursor:rows.length>limit?runs.at(-1)!.id:null};
 }
 recoveryPage(conversationId:string,after?:string,limit=20){
  requireThat(after===undefined||/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(after),'INVALID_INPUT','Invalid recovery cursor.',422);
  requireThat(Number.isInteger(limit)&&limit>=1&&limit<=100,'INVALID_INPUT','Limit must be 1–100.',422);
  const object=this.store.get(conversationId);
  requireThat(['persona','room'].includes(object.kind),'NOT_FOUND','Conversation unavailable.',404);
  // Keyset by immutable ID, independent of timeline retention and newest-run
  // windows. Restart pagination to see concurrent arrivals before the cursor.
  const rows=this.store.db.all<Omit<Run,'context_json'|'checkpoint_json'>>(`SELECT id,command_id,occurrence_id,persona_id,routine_id,status,current_attempt,error_code,created_at,updated_at,role,parent_run_id,title FROM runs WHERE status IN ('recovery_required','interrupted') AND ${object.kind==='persona'?'persona_id':"json_extract(context_json,'$.room_id')"}=? AND id>? ORDER BY id LIMIT ?`,conversationId,after??'',limit+1);
  const runs=rows.slice(0,limit),questions=this.questions.list();
  return {runs,recovery:runs.map(run=>this.recoveryMetadata(run,questions)),next_cursor:rows.length>limit?runs.at(-1)!.id:null};
 }
 private recoveryMetadata(run:Pick<Run,'id'|'current_attempt'|'status'>,unresolvedQuestions:ReadonlyArray<{run_id:string}>){
  // V2 (ARCHITECTURE_V2 A2/A3): an interrupted attempt is fenced by the epoch
  // advance itself, not by a confirmed provider stop. Treat it the same as a
  // provider-confirmed 'terminated' attempt for reconciliation purposes.
  const terminated=run.status==='interrupted'||this.store.db.all<{status:string}>('SELECT status FROM attempts WHERE run_id=? AND attempt=?',run.id,run.current_attempt)[0]?.status==='terminated';
  const operations=this.store.db.all("SELECT id FROM operations WHERE run_id=? AND status!='settled' LIMIT 1",run.id).length>0;
  const effects=this.store.db.all<{id:string;status:string;classification:string;action_key:string;request_digest:string}>("SELECT id,status,classification,action_key,request_digest FROM effects WHERE run_id=? AND status IN ('intent','dispatched','outcome_unknown') ORDER BY id LIMIT 21",run.id);
  const descendants=this.store.db.all(`SELECT r.id FROM runs r WHERE r.id=? AND NOT (${nativeDescendantsSettledSql})`,run.id).length>0;
  const locks=this.store.db.all<{n:number;stale:number}>('SELECT count(*) AS n,COALESCE(SUM(attempt!=?),0) AS stale FROM resource_locks WHERE run_id=?',run.current_attempt,run.id)[0];
  const questions=unresolvedQuestions.filter(question=>question.run_id===run.id).length;
  return {run_id:run.id,attempt:run.current_attempt,executor_terminated:terminated,unresolved_operations:operations,
   unresolved_questions:questions,descendants_unsettled:descendants,retained_locks:locks.n,stale_locks:locks.stale>0,effects:effects.slice(0,20),effects_truncated:effects.length>20,
   can_decide_effects:terminated&&!operations,can_recover:terminated&&!operations&&!effects.length&&!descendants&&!locks.stale&&!questions};
 }
}
