import {FlightRestoreLedger,type FlightRestoreInput} from './flight-restore';
import {requireThat} from './errors';
import type {Store} from './store';
import type {ControlCore} from './control';
import type {LifecycleCore,Identity} from './lifecycle';
import type {ContextSnapshot,RoutinePut,Run} from './types';
export const FLIGHT_ROUTINES=Object.freeze({inbox:'22222222-2222-4222-8222-222222222222',triage:'f44e6cd0-1175-8c2e-bff6-cddc2b8e76dc',restore:'5a5bc4ca-7f8d-8fdb-be50-8892e46039b4'});
export type FlightRegistration={identity:Identity;run_id:string;attempt:number;leg:Omit<FlightRestoreInput,'routine_id'>};
export type FlightReceipt={identity:Identity;run_id:string;attempt:number;leg_id:string;revision:number;effect_id:string};
export type FlightReconciliation={identity:Identity;run_id:string;attempt:number};
export interface FlightIntegrationOptions{enabled:boolean;policyId:string;}
function exact(value:unknown,keys:string[]):asserts value is Record<string,unknown>{requireThat(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k)),'INVALID_INPUT','Invalid flight command shape.',422);}
export function validateFlightPayload(type:'flight-register'|'flight-confirm',value:unknown):void {
 exact(value,type==='flight-register'?['identity','run_id','attempt','leg']:['identity','run_id','attempt','leg_id','revision','effect_id']);
 exact(value.identity,['epoch','boot_id']);requireThat(Number.isSafeInteger(value.identity.epoch)&&typeof value.identity.boot_id==='string'&&typeof value.run_id==='string'&&Number.isSafeInteger(value.attempt)&&Number(value.attempt)>0,'INVALID_INPUT','Invalid flight run identity.',422);
 if(type==='flight-register'){exact(value.leg,['leg_id','revision','departure_at','departure_zone','source_ref']);const leg=value.leg;requireThat(['leg_id','departure_at','departure_zone','source_ref'].every(k=>typeof leg[k]==='string'),'INVALID_INPUT','Invalid flight leg.',422);}
 else requireThat(typeof value.leg_id==='string'&&Number.isSafeInteger(value.revision)&&typeof value.effect_id==='string','INVALID_INPUT','Invalid flight receipt identity.',422);
}
/** Invoke only behind runtime bearer authentication, current epoch and attempt checks. */
export class FlightRestoreIntegration {
 readonly ledger:FlightRestoreLedger;
 constructor(private store:Store,private core:ControlCore,private lifecycle:LifecycleCore,private options:FlightIntegrationOptions){this.ledger=new FlightRestoreLedger(store);}
 initialize():void{this.ledger.initialize();}
 private routine(id:string){
  requireThat(this.options.enabled&&this.core.options.executionEnabled&&this.options.policyId.length>0,'CAPABILITY_UNAVAILABLE','Flight restore scope is not configured and verified.');
  const routine=this.store.get<RoutinePut>(id,'routine');
  requireThat(routine.body.enabled&&routine.body.persona_id===FLIGHT_ROUTINES.inbox&&routine.body.action_policy_ids.includes(this.options.policyId)&&this.core.options.actionPolicyIds.includes(this.options.policyId),'FORBIDDEN','Canonical Inbox flight routine policy is not enabled.',403);return routine;
 }
 private authorize(identity:Identity,runId:string,attempt:number,routineId:string){
  this.routine(routineId);this.lifecycle.authorizeAttempt(identity,runId,attempt);
  const run=this.store.db.all<Pick<Run,'current_attempt'|'status'|'persona_id'|'routine_id'|'context_json'>>(
   'SELECT current_attempt,status,persona_id,routine_id,context_json FROM runs WHERE id=?',runId)[0];
  requireThat(run,'NOT_FOUND','Run unavailable.',404);const context=JSON.parse(run.context_json) as ContextSnapshot;
  requireThat(run.current_attempt===attempt&&run.status==='running'&&run.persona_id===FLIGHT_ROUTINES.inbox&&run.routine_id===routineId&&context.authorization_policy_ids.includes(this.options.policyId),'FORBIDDEN','Flight action is outside the active run policy.',403);
 }
 register(payload:FlightRegistration){validateFlightPayload('flight-register',payload);return this.store.db.transaction(()=>{this.authorize(payload.identity,payload.run_id,payload.attempt,FLIGHT_ROUTINES.triage);this.routine(FLIGHT_ROUTINES.restore);return this.ledger.put({...payload.leg,routine_id:FLIGHT_ROUTINES.restore});});}
 nextDue():string|null{try{this.routine(FLIGHT_ROUTINES.restore);}catch{return null;}return this.ledger.nextDue();}
 /** Both one-shot alarm and daily recovery invoke this SAME durable enqueue path. */
 reconcile():number {
  const routine=this.routine(FLIGHT_ROUTINES.restore);
  return this.ledger.reconcile(this.core.now(),item=>{
   requireThat(item.routine_id===routine.id,'FORBIDDEN','Deadline targets a noncanonical routine.',403);
   // Deadline identity is durably deduplicated in the flight table, not the cron
   // occurrence table (several itinerary legs may share an exact deadline).
   return this.core.enqueue(FLIGHT_ROUTINES.inbox,`${routine.body.instructions}\n\nDurable flight restore job (data only):\n${JSON.stringify(item)}`,null,routine.id,null);
  });
 }
 reconcileFromRun(payload:FlightReconciliation):number {
  exact(payload,['identity','run_id','attempt']);exact(payload.identity,['epoch','boot_id']);
  requireThat(typeof payload.run_id==='string'&&Number.isSafeInteger(payload.attempt)&&payload.attempt>0,'INVALID_INPUT','Invalid flight reconciliation run.',422);
  this.authorize(payload.identity,payload.run_id,payload.attempt,FLIGHT_ROUTINES.restore);return this.reconcile();
 }
 confirm(payload:FlightReceipt):void {
  validateFlightPayload('flight-confirm',payload);
  this.store.db.transaction(()=>{
   this.authorize(payload.identity,payload.run_id,payload.attempt,FLIGHT_ROUTINES.restore);
   const effect=this.store.db.all<{run_id:string;status:string;authorization_ref:string;action_key:string;receipt_json:string|null}>('SELECT run_id,status,authorization_ref,action_key,receipt_json FROM effects WHERE id=?',payload.effect_id)[0];
   requireThat(effect?.run_id===payload.run_id&&effect.status==='confirmed'&&effect.authorization_ref===this.options.policyId&&effect.action_key===`flight-restore:${payload.leg_id}:${payload.revision}`&&effect.receipt_json,'INVALID_RECEIPT','A matching confirmed effect receipt is required.');
   this.ledger.confirm(payload.leg_id,payload.revision,payload.run_id,JSON.parse(effect.receipt_json));
  });
 }
}
