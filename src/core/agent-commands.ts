import {createHash} from 'node:crypto';
import {requireThat} from './errors';
import type {LifecycleCore,Identity} from './lifecycle';
import {parseCommand,type ControlCore} from './control';
import type {Command,ContextSnapshot,RoutinePut} from './types';

// Stable IDs in the existing UUID tool-policy registry. Installing code does not
// grant these capabilities: operator configuration and persona adoption are required.
export const SKILL_PROPOSE_POLICY='46b2cbdd-d227-4f54-bffa-33148aad0134';
export const ROUTINE_MANAGE_POLICY='f0ff3ead-1e31-4f83-bbc2-aa25f069a962';

export type AgentCommand=Extract<Command,{type:'skill.propose'|'routine.put'|'routine.run'|'routine.delete'}>;
export type AgentScope={identity:Identity;run_id:string;attempt:number};
export type AgentCommandRequest=AgentScope & {idempotency_key:string;command:AgentCommand};
export type AgentRoutineQuery=AgentScope & {id?:string;after?:string};
export type AgentSkillQuery=AgentScope & {skill_id:string};
export type AgentSkillSearch=AgentScope & {query:string;after?:string};

/** The only bridge from model output to owner command storage. */
export class AgentCommandBoundary {
 constructor(private core:ControlCore,private lifecycle:LifecycleCore){}
 private admitted(request:AgentScope){
  this.lifecycle.authorizeAttempt(request.identity,request.run_id,request.attempt);
  const run=this.core.store.run(request.run_id);
  const alpha=!!this.core.ownerAlpha.policy;
  requireThat(!alpha||!['OWNER_CANCELLED','CONTEXT_INVALIDATED'].includes(run.error_code??''),'REVISION_CONFLICT','The owner revoked this admitted context.');
  requireThat(run.current_attempt===request.attempt&&(alpha?['claimed','running','finishing','cancelling','recovery_required']:['claimed','running','finishing']).includes(run.status),'REVISION_CONFLICT','The admitted attempt is no longer active.');
  const attempt=this.core.store.db.all<{deadline_at:string}>('SELECT deadline_at FROM attempts WHERE run_id=? AND attempt=?',request.run_id,request.attempt)[0];
  requireThat(alpha||Date.parse(attempt.deadline_at)>Date.parse(this.core.now()),'REVISION_CONFLICT','The admitted attempt deadline has expired.');
  const snapshot=JSON.parse(run.context_json) as ContextSnapshot;
  requireThat(snapshot.persona.id===run.persona_id,'FORBIDDEN','The admitted persona does not match this run.',403);
  return {run,snapshot};
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
