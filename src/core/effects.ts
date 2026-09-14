import { Store } from './store';
import { requireThat } from './errors';
import type { ContextSnapshot } from './types';
export type EffectIntent={id:string;run_id:string;attempt:number;action_key:string;classification:'read_only'|'idempotent'|'mutation';authorization_ref:string;request_digest:string;provider_idempotency_key:string|null};
export class EffectLedger {
 constructor(private store:Store,private now:()=>string){}
 intent(input:EffectIntent):{id:string;status:string}{return this.store.db.transaction(()=>{
  const run=this.store.run(input.run_id);
  requireThat(run.current_attempt===input.attempt&&run.status==='running','REVISION_CONFLICT','Effect is not associated with a running attempt.');
  const context=JSON.parse(run.context_json) as ContextSnapshot;
  if(input.classification!=='read_only')requireThat(context.authorization_policy_ids.includes(input.authorization_ref),'FORBIDDEN','This effect is not authorized by the run policy.',403);
  if(input.classification==='idempotent')requireThat(input.provider_idempotency_key,'INVALID_INPUT','Idempotent effects require a provider key.',422);
  const existing=this.store.db.all<Pick<EffectIntent,'id'|'request_digest'|'run_id'|'classification'|'authorization_ref'|'provider_idempotency_key'>&{status:string}>('SELECT * FROM effects WHERE action_key=?',input.action_key)[0];
  if(existing){requireThat(existing.request_digest===input.request_digest&&existing.run_id===input.run_id&&existing.classification===input.classification&&existing.authorization_ref===input.authorization_ref&&existing.provider_idempotency_key===input.provider_idempotency_key,'IDEMPOTENCY_CONFLICT','Effect key conflicts with an existing action.');return {id:existing.id,status:existing.status};}
  this.store.db.exec("INSERT INTO effects(id,run_id,action_key,classification,status,authorization_ref,request_digest,provider_idempotency_key,updated_at) VALUES(?,?,?,?,'intent',?,?,?,?)",input.id,input.run_id,input.action_key,input.classification,input.authorization_ref,input.request_digest,input.provider_idempotency_key,this.now());
  return {id:input.id,status:'intent'};
 });}
 transition(id:string,runId:string,status:'dispatched'|'confirmed'|'failed'|'outcome_unknown',receipt:Record<string,unknown>|null):void{
  this.store.db.transaction(()=>{
   const existing=this.store.db.all<{status:string;run_id:string}>('SELECT status,run_id FROM effects WHERE id=?',id)[0];
   requireThat(existing?.run_id===runId,'NOT_FOUND','Effect unavailable.',404);
   const allowed:Record<string,string[]>={intent:['dispatched','failed','outcome_unknown'],dispatched:['confirmed','failed','outcome_unknown'],outcome_unknown:['confirmed','failed'],confirmed:[],failed:[]};
   if(existing.status===status)return;
   requireThat(allowed[existing.status]?.includes(status),'REVISION_CONFLICT','Effect cannot make that transition.');
   requireThat(!['confirmed','failed'].includes(status)||receipt&&Object.keys(receipt).length>0,'INVALID_INPUT','A destination receipt or reconciliation record is required.',422);
   this.store.db.exec('UPDATE effects SET status=?,receipt_json=?,updated_at=? WHERE id=?',status,receipt?JSON.stringify(receipt):null,this.now(),id);
  });
 }
}
