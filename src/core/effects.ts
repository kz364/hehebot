import { Store } from './store';
import { requireThat } from './errors';
import type { ContextSnapshot, PayloadMap } from './types';
export type EffectIntent={id:string;run_id:string;attempt:number;action_key:string;classification:'read_only'|'idempotent'|'mutation';authorization_ref:string;request_digest:string;provider_idempotency_key:string|null};
export class EffectLedger {
 constructor(private store:Store,private now:()=>string){}
 reconcileStopped(owner:string,commandId:string,input:PayloadMap['effect.reconcile']):string {
  return this.store.db.transaction(()=>{
   const run=this.store.db.all<{id:string;current_attempt:number}>('SELECT id,current_attempt FROM runs WHERE id=?',input.run_id)[0];
   requireThat(run,'NOT_FOUND','Run unavailable.',404);
   requireThat(run.current_attempt===input.expected_attempt,'REVISION_CONFLICT','The attempt has changed.');
   const attempt=this.store.db.all<{status:string}>('SELECT status FROM attempts WHERE run_id=? AND attempt=?',run.id,input.expected_attempt)[0];
   requireThat(attempt?.status==='terminated','CANCEL_UNCONFIRMED','Confirmed executor termination is required before an owner effect decision.');
   requireThat(!this.store.db.all("SELECT id FROM operations WHERE run_id=? AND status!='settled' LIMIT 1",run.id).length,'CANCEL_UNCONFIRMED','The old execution has not settled.');
   const effect=this.store.db.all<{run_id:string;request_digest:string;status:string;receipt_json:string|null;receipt_too_large:number|null}>(`SELECT run_id,request_digest,status,
    length(CAST(receipt_json AS BLOB))>1048576 AS receipt_too_large,
    CASE WHEN length(CAST(receipt_json AS BLOB))<=1048576 THEN receipt_json END AS receipt_json FROM effects WHERE id=?`,input.effect_id)[0];
   requireThat(effect?.run_id===run.id,'NOT_FOUND','Effect unavailable.',404);
   requireThat(effect.request_digest===input.expected_request_digest,'REVISION_CONFLICT','Review the exact effect before recording its outcome.');
   requireThat(!effect.receipt_too_large,'RECEIPT_PREPARATION_LIMIT','Historical effect receipt exceeds the reconciliation read limit. Stored evidence and outcome were retained.');
   const previous=effect.receipt_json?JSON.parse(effect.receipt_json):null;
   if(effect.status===input.outcome&&previous?.kind==='owner_reconciliation'&&previous.owner_id===owner&&previous.evidence_ref===input.evidence_ref)return input.effect_id;
   requireThat(effect.status==='outcome_unknown','REVISION_CONFLICT','Only an unresolved stopped effect accepts an owner decision.');
   this.transition(input.effect_id,run.id,input.outcome,{kind:'owner_reconciliation',owner_id:owner,command_id:commandId,evidence_ref:input.evidence_ref,attempt:input.expected_attempt});
   return input.effect_id;
  });
 }
 intent(input:EffectIntent):{id:string;status:string}{return this.store.db.transaction(()=>{
  const run=this.store.db.all<{id:string;current_attempt:number;status:string;context_json:string|null}>(`SELECT id,current_attempt,status,
   CASE WHEN length(CAST(context_json AS BLOB))<=1048576 THEN context_json END AS context_json FROM runs WHERE id=?`,input.run_id)[0];
  requireThat(run,'NOT_FOUND','Run unavailable.',404);
  requireThat(run.current_attempt===input.attempt&&run.status==='running','REVISION_CONFLICT','Effect is not associated with a running attempt.');
  requireThat(run.context_json!==null,'CONTEXT_PREPARATION_LIMIT','Historical context exceeds the effect authorization read limit. Stored context and effects were retained.');
  const context=JSON.parse(run.context_json) as ContextSnapshot;
  if(input.classification!=='read_only')requireThat(context.authorization_policy_ids.includes(input.authorization_ref),'FORBIDDEN','This effect is not authorized by the run policy.',403);
  if(input.classification==='idempotent')requireThat(input.provider_idempotency_key,'INVALID_INPUT','Idempotent effects require a provider key.',422);
  const existing=this.store.db.all<Pick<EffectIntent,'id'|'request_digest'|'run_id'|'classification'|'authorization_ref'|'provider_idempotency_key'>&{status:string}>('SELECT id,request_digest,run_id,classification,authorization_ref,provider_idempotency_key,status FROM effects WHERE action_key=?',input.action_key)[0];
  if(existing){requireThat(existing.request_digest===input.request_digest&&existing.run_id===input.run_id&&existing.classification===input.classification&&existing.authorization_ref===input.authorization_ref&&existing.provider_idempotency_key===input.provider_idempotency_key,'IDEMPOTENCY_CONFLICT','Effect key conflicts with an existing action.');return {id:existing.id,status:existing.status};}
  this.requireDeadline(run.id,input.attempt);
  this.store.db.exec("INSERT INTO effects(id,run_id,action_key,classification,status,authorization_ref,request_digest,provider_idempotency_key,updated_at) VALUES(?,?,?,?,'intent',?,?,?,?)",input.id,input.run_id,input.action_key,input.classification,input.authorization_ref,input.request_digest,input.provider_idempotency_key,this.now());
  return {id:input.id,status:'intent'};
 });}
 private requireDeadline(runId:string,attempt:number):void {
  const row=this.store.db.all<{deadline_at:string}>('SELECT deadline_at FROM attempts WHERE run_id=? AND attempt=?',runId,attempt)[0];
  requireThat(row&&row.deadline_at>this.now(),'DEADLINE_EXCEEDED','The effect attempt deadline has expired.');
 }
 transition(id:string,runId:string,status:'dispatched'|'confirmed'|'failed'|'outcome_unknown',receipt:Record<string,unknown>|null):void{
  this.store.db.transaction(()=>{
   const existing=this.store.db.all<{status:string;run_id:string}>('SELECT status,run_id FROM effects WHERE id=?',id)[0];
   requireThat(existing?.run_id===runId,'NOT_FOUND','Effect unavailable.',404);
   const allowed:Record<string,string[]>={intent:['dispatched','failed','outcome_unknown'],dispatched:['confirmed','failed','outcome_unknown'],outcome_unknown:['confirmed','failed'],confirmed:[],failed:[]};
   if(existing.status===status)return;
   requireThat(allowed[existing.status]?.includes(status),'REVISION_CONFLICT','Effect cannot make that transition.');
   // Deadline expiry blocks a new dispatch, not late outcome/receipt recording.
   if(status==='dispatched'){
    const run=this.store.db.all<{status:string;current_attempt:number}>('SELECT status,current_attempt FROM runs WHERE id=?',runId)[0];
    requireThat(run,'NOT_FOUND','Run unavailable.',404);
    requireThat(run.status==='running','REVISION_CONFLICT','New effects cannot dispatch in this task state.');
    this.requireDeadline(runId,run.current_attempt);
   }
   requireThat(!['confirmed','failed'].includes(status)||receipt&&Object.keys(receipt).length>0,'INVALID_INPUT','A destination receipt or reconciliation record is required.',422);
   this.store.db.exec('UPDATE effects SET status=?,receipt_json=?,updated_at=? WHERE id=?',status,receipt?JSON.stringify(receipt):null,this.now(),id);
  });
 }
}
