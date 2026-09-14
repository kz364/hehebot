import { Store } from './store';
import type {ControlCore} from './control';
import { requireThat } from './errors';
import type {ContextSnapshot,Run} from './types';
import type {Identity,LifecycleCore} from './lifecycle';
export type NativeChildReceipt={parent_run_id:string;parent_attempt:number;persona_id:string;native_run_ref:string;native_session_key:string;title:string};
/** Metadata ledger for observed native child receipts. The harness owns child
 * dispatch; mapping Codex thread/turn identities into this ledger remains separate integration. */
export class NativeTaskLedger {
 constructor(private store:Store,private core:ControlCore,private lifecycle:LifecycleCore){}
 register(identity:Identity,input:NativeChildReceipt):Run {
  return this.store.db.transaction(()=>{
   this.lifecycle.authorizeAttempt(identity,input.parent_run_id,input.parent_attempt);
   const parent=this.store.run(input.parent_run_id);
   requireThat(parent.role==='coordinator','INVALID_INPUT','Only a coordinator receipt can register a native background task.',422);
   requireThat(input.persona_id===parent.persona_id||this.core.options.delegations?.[parent.persona_id]?.includes(input.persona_id),'FORBIDDEN','Native delegation target is not authorized.',403);
   requireThat(input.native_run_ref.length>0&&input.native_run_ref.length<=256&&input.native_session_key.length>0&&input.native_session_key.length<=512&&input.title.length>0&&input.title.length<=200,'INVALID_INPUT','Invalid native child receipt.',422);
   const existing=this.store.db.all<{run_id:string;parent_run_id:string;parent_attempt:number;native_session_key:string}>('SELECT * FROM native_task_links WHERE native_run_ref=?',input.native_run_ref)[0];
   if(existing){requireThat(existing.parent_run_id===parent.id&&existing.parent_attempt===input.parent_attempt&&existing.native_session_key===input.native_session_key&&this.store.run(existing.run_id).persona_id===input.persona_id,'IDEMPOTENCY_CONFLICT','Native child identity was reused.');return this.store.run(existing.run_id);}
   const oldContext=JSON.parse(parent.context_json) as ContextSnapshot;
   const context=input.persona_id===parent.persona_id?{...oldContext,instruction:input.title}:this.core.context(input.persona_id,input.title,null,oldContext.room_id);
   const id=this.core.options.uuid(),now=this.core.now();
   const cancellation=['cancelled','cancelling','recovery_required'].includes(parent.status);
   this.store.db.exec("INSERT INTO runs(id,command_id,persona_id,routine_id,context_json,status,current_attempt,error_code,created_at,updated_at,role,parent_run_id,title) VALUES(?,?,?,?,?,?,1,?,?,?,'background',?,?)",id,parent.command_id,input.persona_id,input.persona_id===parent.persona_id?parent.routine_id:null,JSON.stringify(context),cancellation?'cancelling':'claimed',cancellation?'OWNER_CANCELLED':null,now,now,parent.id,input.title);
   this.store.db.exec("INSERT INTO attempts(run_id,attempt,submission_key,native_run_ref,epoch,boot_id,status,deadline_at,started_at) VALUES(?,1,?,?,?,?,?,?,?)",id,`native:${input.native_run_ref}`,input.native_run_ref,identity.epoch,identity.boot_id,'claimed',new Date(this.core.options.now().getTime()+20*60000).toISOString(),now);
   this.store.db.exec('INSERT INTO native_task_links(run_id,parent_run_id,parent_attempt,native_run_ref,native_session_key) VALUES(?,?,?,?,?)',id,parent.id,input.parent_attempt,input.native_run_ref,input.native_session_key);
   this.store.event(this.core.options.uuid(),input.persona_id,'task.registered','native',parent.command_id,{run_id:id,parent_run_id:parent.id,title:input.title,status:cancellation?'cancelling':'claimed'},now);
   return this.store.run(id);
  });
 }
}
