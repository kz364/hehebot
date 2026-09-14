import {createHash} from 'node:crypto';
import {requireThat} from './errors';
import type {LifecycleCore,Identity} from './lifecycle';
import {parseCommand,type ControlCore} from './control';
import type {Command,ContextSnapshot,RoutinePut} from './types';

// Stable IDs in the existing UUID tool-policy registry. Installing code does not
// grant these capabilities: operator configuration and persona adoption are required.
export const SKILL_PROPOSE_POLICY='46b2cbdd-d227-4f54-bffa-33148aad0134';
export const ROUTINE_MANAGE_POLICY='f0ff3ead-1e31-4f83-bbc2-aa25f069a962';

export type AgentCommand=Extract<Command,{type:'skill.propose'|'routine.put'}>;
export type AgentCommandRequest={identity:Identity;run_id:string;attempt:number;idempotency_key:string;command:AgentCommand};

/** The only bridge from model output to owner command storage. */
export class AgentCommandBoundary {
 constructor(private core:ControlCore,private lifecycle:LifecycleCore){}
 accept(request:AgentCommandRequest){
  this.lifecycle.authorizeAttempt(request.identity,request.run_id,request.attempt);
  const run=this.core.store.run(request.run_id);
  requireThat(run.current_attempt===request.attempt&&['claimed','running','finishing'].includes(run.status),'REVISION_CONFLICT','The admitted attempt is no longer active.');
  const snapshot=JSON.parse(run.context_json) as ContextSnapshot;
  requireThat(snapshot.persona.id===run.persona_id,'FORBIDDEN','The admitted persona does not match this run.',403);

  // Validate before narrowing so owner-only or malformed commands cannot be smuggled
  // through the runtime envelope.
  const supplied=parseCommand(request.command);
  requireThat(supplied.type==='skill.propose'||supplied.type==='routine.put','FORBIDDEN','This command is not available to a model.',403);
  const policies=snapshot.persona.body.tool_policy_ids;
  let command:AgentCommand;
  if(supplied.type==='skill.propose'){
   requireThat(policies.includes(SKILL_PROPOSE_POLICY),'FORBIDDEN','The admitted persona snapshot cannot propose skills.',403);
   requireThat(!supplied.payload.executable_files_changed,'CAPABILITY_UNAVAILABLE','Executable skill files require separate review.');
   command={...supplied,payload:{...supplied.payload,provenance:{kind:'model',source_ref:request.run_id}}};
  }else{
   requireThat(policies.includes(ROUTINE_MANAGE_POLICY),'FORBIDDEN','The admitted persona snapshot cannot manage routines.',403);
   requireThat(supplied.payload.persona_id===run.persona_id,'FORBIDDEN','A model may manage only its admitted persona routines.',403);
   const existing=this.core.store.db.all<{kind:string;body_json:string;deleted_at:string|null}>('SELECT kind,body_json,deleted_at FROM objects WHERE id=?',supplied.payload.id)[0];
   if(existing){
    requireThat(existing.kind==='routine'&&!existing.deleted_at,'FORBIDDEN','The target is not an active routine.',403);
    requireThat((JSON.parse(existing.body_json) as RoutinePut).persona_id===run.persona_id,'FORBIDDEN','A model may not overwrite another persona’s routine.',403);
   }
   requireThat(supplied.payload.action_policy_ids.every(id=>snapshot.authorization_policy_ids.includes(id)),'FORBIDDEN','Routine actions must remain within the admitted authorization snapshot.',403);
   command=supplied;
  }
  const actor=`runtime:${run.persona_id}`;
  const hash=createHash('sha256').update(JSON.stringify(command)).digest('hex');
  return this.core.accept(actor,request.idempotency_key,hash,command);
 }
}
