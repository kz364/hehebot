import {createHash} from 'node:crypto';
import {requireThat} from './errors';
import type {LifecycleCore,Identity} from './lifecycle';
import {parseCommand,type ControlCore} from './control';
import type {Command,ContextSnapshot,RoutinePut,MemoryPut,Run} from './types';
import {MEMORY_TOKENIZER,MEMORY_READ_POLICY,projectMemory} from './memory-context';

// Stable IDs in the existing UUID tool-policy registry. Installing code does not
// grant these capabilities: operator configuration and persona adoption are required.
export const SKILL_PROPOSE_POLICY='46b2cbdd-d227-4f54-bffa-33148aad0134';
export const ROUTINE_MANAGE_POLICY='f0ff3ead-1e31-4f83-bbc2-aa25f069a962';
export {MEMORY_READ_POLICY} from './memory-context';

export type AgentCommand=Extract<Command,{type:'skill.propose'|'routine.put'|'routine.run'|'routine.delete'}>;
export type AgentScope={identity:Identity;run_id:string;attempt:number};
export type AgentCommandRequest=AgentScope & {idempotency_key:string;command:AgentCommand};
export type AgentRoutineQuery=AgentScope & {id?:string;after?:string};
export type AgentSkillQuery=AgentScope & {skill_id:string};
export type AgentSkillSearch=AgentScope & {query:string;after?:string};
export type AgentMemoryRead=AgentScope & {read_id:string;memory_id:string;revision:number;offset:number;limit:number};
export type AgentMemoryReserve=AgentMemoryRead & {sha256:string;selected_model:string;tokenizer:typeof MEMORY_TOKENIZER;tokens:number};
type MemoryReadLedger={version:1;baseline:string;global:number;scoped:number;reads:Array<{id:string;fingerprint:string}>};

/** The only bridge from model output to owner command storage. */
export class AgentCommandBoundary {
 constructor(private core:ControlCore,private lifecycle:LifecycleCore){}
 private admitted(request:AgentScope){
  this.lifecycle.authorizeAttempt(request.identity,request.run_id,request.attempt);
  const run=this.core.store.db.all<Pick<Run,'id'|'persona_id'|'routine_id'|'current_attempt'|'status'|'error_code'|'context_json'>>(
   'SELECT id,persona_id,routine_id,current_attempt,status,error_code,context_json FROM runs WHERE id=?',request.run_id)[0];
  requireThat(run,'NOT_FOUND','Run unavailable.',404);
  const alpha=!!this.core.ownerAlpha.policy;
  requireThat(!alpha||!['OWNER_CANCELLED','CONTEXT_INVALIDATED'].includes(run.error_code??''),'REVISION_CONFLICT','The owner revoked this admitted context.');
  requireThat(run.current_attempt===request.attempt&&(alpha?['claimed','running','finishing','cancelling','recovery_required']:['claimed','running','finishing']).includes(run.status),'REVISION_CONFLICT','The admitted attempt is no longer active.');
  const attempt=this.core.store.db.all<{deadline_at:string}>('SELECT deadline_at FROM attempts WHERE run_id=? AND attempt=?',request.run_id,request.attempt)[0];
  requireThat(alpha||Date.parse(attempt.deadline_at)>Date.parse(this.core.now()),'REVISION_CONFLICT','The admitted attempt deadline has expired.');
  const snapshot=JSON.parse(run.context_json) as ContextSnapshot;
  requireThat(snapshot.persona.id===run.persona_id,'FORBIDDEN','The admitted persona does not match this run.',403);
  return {run,snapshot};
 }
 private memoryRead(request:AgentMemoryRead){
  requireThat(this.core.options.executionEnabled&&!this.core.ownerAlpha.policy,'CAPABILITY_UNAVAILABLE','Memory retrieval requires ordinary execution.');
  const {run,snapshot}=this.admitted(request),budget=snapshot.memory_budget;
  requireThat(snapshot.persona.body.tool_policy_ids.includes(MEMORY_READ_POLICY),'FORBIDDEN','This task has no memory retrieval grant.',403);
  requireThat(budget&&budget.run_id===run.id&&budget.attempt===request.attempt&&budget.selected_model===snapshot.selected_model&&budget.tokenizer===MEMORY_TOKENIZER,
   'CAPABILITY_UNAVAILABLE','This task has no supported memory budget receipt.');
  requireThat(Number.isSafeInteger(request.offset)&&request.offset>=0&&request.offset<=16000&&Number.isSafeInteger(request.limit)&&request.limit>=1&&request.limit<=2000,
   'INVALID_INPUT','Memory range is out of bounds.',422);
  const admitted=snapshot.memories.find(memory=>memory.id===request.memory_id&&memory.revision===request.revision);
  requireThat(admitted,'NOT_FOUND','Memory pointer is not in this admitted context.',404);
  const scope=admitted.body.scope;
  requireThat(scope.kind==='global'&&scope.id===null||scope.kind==='persona'&&scope.id===run.persona_id||scope.kind==='routine'&&scope.id===run.routine_id&&run.routine_id!==null,
   'FORBIDDEN','Memory scope is not admitted.',403);
  // Enforce current revision and scope in SQL before returning a body to JS.
  const row=this.core.store.db.all<{body_json:string}>(`SELECT body_json FROM objects WHERE id=? AND kind='memory' AND revision=? AND deleted_at IS NULL
   AND json_extract(body_json,'$.scope.kind')=? AND json_extract(body_json,'$.scope.id') IS ?`,admitted.id,admitted.revision,scope.kind,scope.id)[0];
  requireThat(row,'MEMORY_PREPARATION_STALE','Memory changed after admission.');
  const memory={id:admitted.id,revision:admitted.revision,body:JSON.parse(row.body_json) as MemoryPut};
  const {representation,...source}=admitted;
  const expected=representation?projectMemory({...source,body:memory.body}):{body:memory.body,representation:undefined};
  requireThat(JSON.stringify(expected.body)===JSON.stringify(admitted.body)&&JSON.stringify(expected.representation)===JSON.stringify(admitted.representation),
   'MEMORY_PREPARATION_STALE','Memory source changed after admission.');
  const expiry=memory.body.expires_at;
  requireThat(!expiry||Date.parse(expiry)>Date.parse(this.core.now()),'MEMORY_PREPARATION_STALE','Memory expired.');
  const points=Array.from(memory.body.text);
  requireThat(request.offset<points.length,'INVALID_INPUT','Memory range starts past the source.',422);
  const end=Math.min(points.length,request.offset+request.limit),bucket=scope.kind==='global'?'global' as const:'scoped' as const;
  const text=JSON.stringify({schema_version:1,memory:{id:memory.id,revision:memory.revision,scope,text:points.slice(request.offset,end).join(''),
   source_event_id:memory.body.source_event_id,expires_at:expiry,sensitivity:memory.body.sensitivity,explicit_constraint:memory.body.explicit_constraint},
   range:{offset:request.offset,end,total_code_points:points.length,truncated:request.offset>0||end<points.length}});
  const deadline=this.core.store.db.all<{deadline_at:string}>('SELECT deadline_at FROM attempts WHERE run_id=? AND attempt=?',run.id,request.attempt)[0].deadline_at;
  const not_after=new Date(Math.min(Date.parse(deadline),Date.parse(this.lifecycle.get().lease_until!),expiry?Date.parse(expiry):Infinity)).toISOString();
  const sha256=createHash('sha256').update(JSON.stringify([1,request.identity.epoch,request.identity.boot_id,request.run_id,request.attempt,
   request.read_id,request.memory_id,request.revision,request.offset,request.limit,budget.sha256,budget.selected_model,bucket,text])).digest('hex');
  return {budget,preparation:{schema_version:1 as const,read_id:request.read_id,run_id:run.id,attempt:request.attempt,selected_model:budget.selected_model,
   baseline_sha256:budget.sha256,tokenizer:MEMORY_TOKENIZER,bucket,sha256,text,not_after} as const};
 }
 prepareMemoryRead(request:AgentMemoryRead){
  return this.core.store.db.transaction(()=>this.memoryRead(request).preparation);
 }
 reserveMemoryRead(request:AgentMemoryReserve){
  return this.core.store.db.transaction(()=>{
   // Strip count-only fields before reproducing the immutable read identity.
   const {sha256,selected_model,tokenizer,tokens,...read}=request;
   const {budget,preparation}=this.memoryRead(read);
   requireThat(sha256===preparation.sha256&&selected_model===preparation.selected_model&&tokenizer===MEMORY_TOKENIZER,
    'MEMORY_PREPARATION_STALE','Read bytes or tokenizer changed before reservation.');
   requireThat(Number.isSafeInteger(tokens)&&tokens>0,'INVALID_INPUT','Read token count must be a positive safe integer.',422);
   const key=`memory-read:${read.run_id}:${read.attempt}`,db=this.core.store.db;
   const row=db.all<{value_json:string}>('SELECT value_json FROM runtime_metadata WHERE key=?',key)[0];
   const ledger:MemoryReadLedger=row?JSON.parse(row.value_json):{version:1,baseline:budget.sha256,global:budget.global_tokens,scoped:budget.scoped_tokens,reads:[]};
   requireThat(ledger.version===1&&ledger.baseline===budget.sha256,'MEMORY_PREPARATION_STALE','The admitted budget changed.');
   const fingerprint=createHash('sha256').update(JSON.stringify([sha256,selected_model,tokenizer,tokens])).digest('hex');
   const prior=ledger.reads.find(item=>item.id===read.read_id);
   if(prior){
    requireThat(prior.fingerprint===fingerprint,'IDEMPOTENCY_CONFLICT','Read identity was reused with changed input.');
    // A reconciled charge never authorizes a second model-visible emission.
    return {read_id:read.read_id,sha256,reserved:true as const,delivery_allowed:false as const,not_after:preparation.not_after};
   }
   requireThat(ledger.reads.length<64,'MEMORY_PREPARATION_LIMIT','The task read work limit is exhausted.');
   ledger[preparation.bucket]+=tokens;
   requireThat(Number.isSafeInteger(ledger.global)&&Number.isSafeInteger(ledger.scoped)&&ledger.global>=0&&ledger.scoped>=0&&ledger.global<=4000&&ledger.scoped<=8000,
    'MEMORY_BUDGET_EXCEEDED','Cumulative memory exposure exceeds the task budget.');
   ledger.reads.push({id:read.read_id,fingerprint});
   db.exec('INSERT INTO runtime_metadata(key,value_json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json',key,JSON.stringify(ledger));
   return {read_id:read.read_id,sha256,reserved:true as const,delivery_allowed:true as const,not_after:preparation.not_after};
  });
 }
 searchSkills(request:AgentSkillSearch){
  requireThat(!this.core.ownerAlpha.policy,'CAPABILITY_UNAVAILABLE','Owner alpha does not permit catalog discovery.');
  const {snapshot}=this.admitted(request);
  requireThat(snapshot.persona.body.tool_policy_ids.includes(SKILL_PROPOSE_POLICY),'FORBIDDEN','The admitted persona cannot discover skills for proposals.',403);
  requireThat(request.query.trim().length>0,'INVALID_INPUT','Enter a nonblank skill search.',422);
  // Literal substring matching, not SQL wildcard syntax or semantic ranking.
  // Catalog discovery never adds these procedures to the admitted body loader.
  const rows=this.core.store.db.all<{id:string;revision:number;name:string;description:string;when_to_use:string}>(`SELECT id,revision,json_extract(body_json,'$.name') AS name,json_extract(body_json,'$.description') AS description,json_extract(body_json,'$.when_to_use') AS when_to_use
   FROM objects WHERE kind='skill' AND deleted_at IS NULL AND id>?
   AND (instr(lower(json_extract(body_json,'$.name')),lower(?))>0 OR instr(lower(json_extract(body_json,'$.description')),lower(?))>0 OR instr(lower(json_extract(body_json,'$.when_to_use')),lower(?))>0)
   ORDER BY id LIMIT 21`,request.after??'',request.query,request.query,request.query);
  return {skills:rows.slice(0,20),next_cursor:rows.length>20?rows[19].id:null};
 }
 skill(request:AgentSkillQuery){
  const {snapshot}=this.admitted(request);
  const skill=snapshot.skills.find(item=>item.id===request.skill_id);
  requireThat(skill,'NOT_FOUND','This skill is not enabled in the admitted task snapshot.',404);
  return {skill};
 }
 routines(request:AgentRoutineQuery){
  const {run,snapshot}=this.admitted(request);
  requireThat(snapshot.persona.body.tool_policy_ids.includes(ROUTINE_MANAGE_POLICY),'FORBIDDEN','The admitted persona cannot inspect routines.',403);
  requireThat(!(request.id&&request.after),'INVALID_INPUT','Choose a routine ID or a pagination cursor, not both.',422);
  const rows=this.core.store.db.all<{id:string}>("SELECT id FROM objects WHERE kind='routine' AND deleted_at IS NULL AND json_extract(body_json,'$.persona_id')=? AND (? IS NULL OR id=?) AND id>? ORDER BY id LIMIT 21",run.persona_id,request.id??null,request.id??null,request.after??'');
  return {routines:rows.slice(0,20).map(row=>this.core.store.get<RoutinePut>(row.id,'routine')),next_cursor:rows.length>20?rows[19].id:null};
 }
 accept(request:AgentCommandRequest){
  requireThat(!this.core.ownerAlpha.policy,'CAPABILITY_UNAVAILABLE','Owner alpha does not permit agent mutations.');
  const {run,snapshot}=this.admitted(request);

  // Validate before narrowing so owner-only or malformed commands cannot be smuggled
  // through the runtime envelope.
  const supplied=parseCommand(request.command);
  requireThat(supplied.type==='skill.propose'||supplied.type==='routine.put'||supplied.type==='routine.run'||supplied.type==='routine.delete','FORBIDDEN','This command is not available to a model.',403);
  const policies=snapshot.persona.body.tool_policy_ids;
  let command:AgentCommand;
  if(supplied.type==='skill.propose'){
   requireThat(policies.includes(SKILL_PROPOSE_POLICY),'FORBIDDEN','The admitted persona snapshot cannot propose skills.',403);
   requireThat(!supplied.payload.executable_files_changed,'CAPABILITY_UNAVAILABLE','Executable skill files require separate review.');
   command={...supplied,payload:{...supplied.payload,provenance:{kind:'model',source_ref:request.run_id}}};
  }else{
   requireThat(policies.includes(ROUTINE_MANAGE_POLICY),'FORBIDDEN','The admitted persona snapshot cannot manage routines.',403);
   if(supplied.type==='routine.put')requireThat(supplied.payload.persona_id===run.persona_id,'FORBIDDEN','A model may manage only its admitted persona routines.',403);
   const existing=this.core.store.db.all<{kind:string;body_json:string;deleted_at:string|null}>('SELECT kind,body_json,deleted_at FROM objects WHERE id=?',supplied.payload.id)[0];
   if(existing){
    requireThat(existing.kind==='routine'&&(!existing.deleted_at||supplied.type==='routine.delete'),'FORBIDDEN','The target is not an active routine.',403);
    requireThat((JSON.parse(existing.body_json) as RoutinePut).persona_id===run.persona_id,'FORBIDDEN','A model may not overwrite another persona’s routine.',403);
   }
   if(supplied.type==='routine.put'||supplied.type==='routine.run'){
    const actions=supplied.type==='routine.put'?supplied.payload.action_policy_ids:existing?(JSON.parse(existing.body_json) as RoutinePut).action_policy_ids:[];
    requireThat(actions.every(id=>snapshot.authorization_policy_ids.includes(id)),'FORBIDDEN','Routine actions must remain within the admitted authorization snapshot.',403);
   }
   command=supplied;
  }
  const actor=`runtime:${run.persona_id}`;
  const hash=createHash('sha256').update(JSON.stringify(command)).digest('hex');
  return this.core.accept(actor,request.idempotency_key,hash,command);
 }
}
