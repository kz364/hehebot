import { Store } from './store';
import type {ControlCore} from './control';
import { requireThat } from './errors';
import type {ContextSnapshot,Run} from './types';
import type {Identity,LifecycleCore} from './lifecycle';
export type NativeChildReceipt={parent_run_id:string;parent_attempt:number;persona_id:string;native_run_ref:string;native_session_key:string;title:string};
// Correlated to runs alias r. Recheck at admission: a late native observation
// can arrive after an owner queues retry but before the next attempt is claimed.
export const nativeDescendantsSettledSql = `NOT EXISTS(
 WITH RECURSIVE family(id) AS (
  SELECT id FROM runs WHERE parent_run_id=r.id
  UNION SELECT child.id FROM runs child JOIN family f ON child.parent_run_id=f.id
 ) SELECT 1 FROM runs d JOIN family f ON f.id=d.id WHERE
  d.status NOT IN ('completed','failed','cancelled')
  OR EXISTS(SELECT 1 FROM attempts a WHERE a.run_id=d.id AND a.status IN ('claimed','running'))
  OR EXISTS(SELECT 1 FROM operations o WHERE o.run_id=d.id AND o.status!='settled')
  OR EXISTS(SELECT 1 FROM resource_locks l WHERE l.run_id=d.id)
  OR EXISTS(SELECT 1 FROM effects e WHERE e.run_id=d.id AND e.status IN ('intent','dispatched','outcome_unknown'))
)`;
/** Metadata ledger for observed native child receipts. The harness owns dispatch;
 * CodexTaskControl maps exact observed thread/turn ancestry into these records. */
export class NativeTaskLedger {
 constructor(private store:Store,private core:ControlCore,private lifecycle:LifecycleCore){}
 private acknowledgeStart(identity:Identity,input:NativeChildReceipt,run:Run):Run {
  requireThat(run.current_attempt===1,'STALE_EPOCH','Native child attempt has changed.');
  this.lifecycle.authorizeAttempt(identity,run.id,1);
  const attempt=this.store.db.all<{native_run_ref:string}>('SELECT native_run_ref FROM attempts WHERE run_id=? AND attempt=1',run.id)[0];
  requireThat(attempt.native_run_ref===input.native_run_ref,'REVISION_CONFLICT','Native child receipt does not match its attempt.');
  // A repeated observation is not new inference and must never undo cancellation,
  // recovery, waiting or terminal state. It only acknowledges a claimed start.
  if(run.status==='claimed')this.lifecycle.submitted(identity,run.id,1,input.native_run_ref);
  return this.store.run(run.id);
 }
 register(identity:Identity,input:NativeChildReceipt,started=false):Run {
  requireThat(!this.core.ownerAlpha.policy||this.core.ownerAlpha.policy.background_first_root,'CAPABILITY_UNAVAILABLE','Owner alpha does not admit native children.');
  return this.store.db.transaction(()=>{
   this.lifecycle.authorizeAttempt(identity,input.parent_run_id,input.parent_attempt);
   const parent=this.store.run(input.parent_run_id);
   requireThat(!this.core.ownerAlpha.policy||this.core.ownerAlpha.backgroundRoot(parent.id)&&parent.role==='coordinator'&&input.persona_id===parent.persona_id,'FORBIDDEN','Owner-alpha child must belong directly to the selected root and persona.',403);
   requireThat(parent.current_attempt===input.parent_attempt,'STALE_EPOCH','Native parent attempt is no longer current.');
   requireThat(input.persona_id===parent.persona_id||parent.role==='coordinator'&&this.core.options.delegations?.[parent.persona_id]?.includes(input.persona_id),'FORBIDDEN','Native delegation target is not authorized.',403);
   requireThat(input.native_run_ref.length>0&&input.native_run_ref.length<=256&&input.native_session_key.length>0&&input.native_session_key.length<=512&&input.title.length>0&&input.title.length<=200,'INVALID_INPUT','Invalid native child receipt.',422);
   const conflictingThread=this.store.db.all(`SELECT n.run_id FROM native_task_links n JOIN runs r ON r.id=n.run_id
    WHERE n.native_session_key=? AND (n.parent_run_id!=? OR n.parent_attempt!=? OR r.persona_id!=?) LIMIT 1`,input.native_session_key,parent.id,input.parent_attempt,input.persona_id);
   requireThat(!conflictingThread.length,'IDEMPOTENCY_CONFLICT','Native child thread custody was reused.');
   const existing=this.store.db.all<{run_id:string;parent_run_id:string;parent_attempt:number;native_session_key:string}>('SELECT * FROM native_task_links WHERE native_run_ref=?',input.native_run_ref)[0];
   if(existing){requireThat(existing.parent_run_id===parent.id&&existing.parent_attempt===input.parent_attempt&&existing.native_session_key===input.native_session_key&&this.store.run(existing.run_id).persona_id===input.persona_id,'IDEMPOTENCY_CONFLICT','Native child identity was reused.');this.core.ownerAlpha.authorize(existing.run_id,1);const run=this.store.run(existing.run_id);return started?this.acknowledgeStart(identity,input,run):run;}
   const oldContext=JSON.parse(parent.context_json) as ContextSnapshot;
   const context=input.persona_id===parent.persona_id?{...oldContext,instruction:input.title}:this.core.context(input.persona_id,input.title,null,oldContext.room_id);
   const id=this.core.options.uuid(),now=this.core.now();
   const parentAttempt=this.store.db.all<{deadline_at:string;captured_routine_revision:number|null}>('SELECT deadline_at,captured_routine_revision FROM attempts WHERE run_id=? AND attempt=?',parent.id,input.parent_attempt)[0];
   const deadline=parentAttempt.deadline_at;
   // Revoked alpha context stays revoked even when its deadline also expired.
   const revoked=this.core.ownerAlpha.policy&&['OWNER_CANCELLED','CONTEXT_INVALIDATED'].includes(parent.error_code??'');
   const cancelCode=revoked?parent.error_code:deadline<=now?'DEADLINE_EXCEEDED':['cancelled','cancelling','recovery_required'].includes(parent.status)?parent.error_code??'OWNER_CANCELLED':null;
   const cancellation=cancelCode!==null;
   this.store.db.exec("INSERT INTO runs(id,command_id,persona_id,routine_id,context_json,status,current_attempt,error_code,created_at,updated_at,role,parent_run_id,title) VALUES(?,?,?,?,?,?,1,?,?,?,'background',?,?)",id,parent.command_id,input.persona_id,input.persona_id===parent.persona_id?parent.routine_id:null,JSON.stringify(context),cancellation?'cancelling':'claimed',cancelCode,now,now,parent.id,input.title);
   this.store.db.exec("INSERT INTO attempts(run_id,attempt,submission_key,native_run_ref,epoch,boot_id,status,deadline_at,started_at,captured_routine_revision) VALUES(?,1,?,?,?,?,?,?,?,?)",id,`native:${input.native_run_ref}`,input.native_run_ref,identity.epoch,identity.boot_id,'claimed',deadline,now,input.persona_id===parent.persona_id?parentAttempt.captured_routine_revision:null);
   this.store.db.exec('INSERT INTO native_task_links(run_id,parent_run_id,parent_attempt,native_run_ref,native_session_key) VALUES(?,?,?,?,?)',id,parent.id,input.parent_attempt,input.native_run_ref,input.native_session_key);
   this.store.event(this.core.options.uuid(),input.persona_id,'task.registered','native',parent.command_id,{run_id:id,parent_run_id:parent.id,title:input.title,status:cancellation?'cancelling':'claimed'},now);
   const run=this.store.run(id);return started?this.acknowledgeStart(identity,input,run):run;
  });
 }
}
