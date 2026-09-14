import { Store } from './store';
import { requireThat } from './errors';
import type { Identity, LifecycleCore } from './lifecycle';

export type SteeringTarget={run_id:string;attempt:number};
export type SteeringOutcome='accepted'|'outcome_unknown'|'not_delivered';
type SteeringRecord=SteeringTarget & {command_id:string;epoch:number;boot_id:string;native_ref:string;status:'pending'|SteeringOutcome;created_at:string};
const key=(target:SteeringTarget,commandId:string)=>`steer:${target.run_id}:${target.attempt}:${commandId}`;

// Settled delivery metadata is audit (30d); unresolved delivery is recovery state.
// Never turn pending/unknown into not_delivered merely because time passed.
const expiredCandidates=`FROM runtime_metadata m
 JOIN runs r ON r.id=json_extract(m.value_json,'$.run_id')
 JOIN attempts a ON a.run_id=r.id AND a.attempt=json_extract(m.value_json,'$.attempt')
 WHERE m.key GLOB 'steer:*' AND json_extract(m.value_json,'$.status') IN ('accepted','not_delivered')
 AND r.status IN ('completed','failed','cancelled') AND a.status IN ('completed','failed','cancelled') AND a.settled_at IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM retry_queue q WHERE q.run_id=r.id)
 AND NOT EXISTS(SELECT 1 FROM operations o WHERE o.run_id=r.id AND o.status!='settled')
 AND NOT EXISTS(SELECT 1 FROM resource_locks l WHERE l.run_id=r.id)
 AND NOT EXISTS(SELECT 1 FROM effects e WHERE e.run_id=r.id AND e.status IN ('intent','dispatched','outcome_unknown'))`;

/** Owner intent and delivery receipt only. Text stays in the original command;
 * native acceptance is neither consumption nor task/effect settlement.
 */
export class TaskSteering {
 constructor(private store:Store,private now:()=>string){}
 nextExpiry():string|null {
  return this.store.db.all<{due:string|null}>(`SELECT strftime('%Y-%m-%dT%H:%M:%fZ',MIN(json_extract(m.value_json,'$.created_at')),'+30 days') AS due ${expiredCandidates}`)[0].due;
 }
 prune():number {
  return this.store.db.transaction(()=>{
   const cutoff=new Date(Date.parse(this.now())-30*86400000).toISOString();
   const rows=this.store.db.all<{key:string}>(`SELECT m.key ${expiredCandidates}
    AND json_extract(m.value_json,'$.created_at')<=? ORDER BY json_extract(m.value_json,'$.created_at'),m.key LIMIT 100`,cutoff);
   for(const row of rows)this.store.db.exec('DELETE FROM runtime_metadata WHERE key=?',row.key);
   return rows.length;
  });
 }
 private current(target:SteeringTarget){
  const run=this.store.run(target.run_id);
  requireThat(run.current_attempt===target.attempt,'REVISION_CONFLICT','The selected task attempt changed.');
  const attempt=this.store.db.all<{epoch:number;boot_id:string;native_run_ref:string|null;deadline_at:string}>('SELECT epoch,boot_id,native_run_ref,deadline_at FROM attempts WHERE run_id=? AND attempt=?',target.run_id,target.attempt)[0];
  requireThat(attempt?.native_run_ref,'TASK_NOT_RUNNING','The task has no acknowledged native identity.');
  return {run,attempt};
 }
 queue(commandId:string,target:SteeringTarget):string {
  return this.store.db.transaction(()=>{
   requireThat(this.store.db.all("SELECT id FROM commands WHERE id=? AND type='run.steer' AND status IN ('accepted','applied') AND json_extract(payload_json,'$.run_id')=? AND json_extract(payload_json,'$.expected_attempt')=?",commandId,target.run_id,target.attempt).length,'FORBIDDEN','An exact owner steering command is required.',403);
   const {run,attempt}=this.current(target),now=this.now();
   requireThat(run.status==='running'&&attempt.deadline_at>now,'TASK_NOT_RUNNING','Select a running task before its deadline.');
   const state=this.store.db.all<{epoch:number;boot_id:string;lease_until:string;phase:string}>('SELECT epoch,boot_id,lease_until,phase FROM lifecycle WHERE singleton=1')[0];
   requireThat(state?.phase==='READY'&&state.lease_until>now&&state.epoch===attempt.epoch&&state.boot_id===attempt.boot_id,'STALE_EPOCH','The task executor is not available for steering.');
   requireThat(!this.store.db.all("SELECT id FROM effects WHERE run_id=? AND status='outcome_unknown' LIMIT 1",run.id).length,'OUTCOME_UNKNOWN','Reconcile uncertain effects before changing this task.');
   requireThat(!this.store.db.all("SELECT key FROM runtime_metadata WHERE key GLOB ? AND json_extract(value_json,'$.status') IN ('pending','outcome_unknown') LIMIT 1",`steer:${run.id}:${target.attempt}:*`).length,'RESOURCE_BUSY','This task already has pending or uncertain steering.');
   const row:SteeringRecord={...target,command_id:commandId,epoch:attempt.epoch,boot_id:attempt.boot_id,native_ref:attempt.native_run_ref!,status:'pending',created_at:now};
   this.store.db.exec('INSERT INTO runtime_metadata(key,value_json) VALUES(?,?)',key(target,commandId),JSON.stringify(row));
   return commandId;
  });
 }
 pending(identity:Identity,targets:SteeringTarget[],lifecycle:LifecycleCore){
  return this.store.db.transaction(()=>{
   requireThat(targets.length>0&&targets.length<=101&&new Set(targets.map(t=>`${t.run_id}:${t.attempt}`)).size===targets.length,'INVALID_INPUT','Select distinct task attempts.',422);
   for(const target of targets)lifecycle.authorizeAttempt(identity,target.run_id,target.attempt);
   const now=this.now(),cutoff=new Date(Date.parse(now)-90*86400000).toISOString();
   const rows=this.store.db.all<{value_json:string;text:string}>(`SELECT m.value_json,json_extract(c.payload_json,'$.text') AS text
    FROM runtime_metadata m JOIN commands c ON c.id=json_extract(m.value_json,'$.command_id')
    JOIN runs r ON r.id=json_extract(m.value_json,'$.run_id')
    JOIN attempts a ON a.run_id=r.id AND a.attempt=r.current_attempt
    WHERE (${targets.map(()=> 'm.key GLOB ?').join(' OR ')})
    AND json_extract(m.value_json,'$.status')='pending' AND json_extract(m.value_json,'$.epoch')=? AND json_extract(m.value_json,'$.boot_id')=?
    AND r.status='running' AND r.current_attempt=json_extract(m.value_json,'$.attempt')
    AND a.epoch=? AND a.boot_id=? AND a.native_run_ref=json_extract(m.value_json,'$.native_ref') AND a.deadline_at>?
    AND c.type='run.steer' AND c.status='applied' AND c.accepted_at>?
    AND json_extract(c.payload_json,'$.run_id')=r.id AND json_extract(c.payload_json,'$.expected_attempt')=r.current_attempt
    AND json_type(c.payload_json,'$.text')='text'
    AND NOT EXISTS (SELECT 1 FROM effects e WHERE e.run_id=r.id AND e.status='outcome_unknown')
    ORDER BY c.accepted_at,c.id LIMIT 4`,...targets.map(t=>`steer:${t.run_id}:${t.attempt}:*`),identity.epoch,identity.boot_id,identity.epoch,identity.boot_id,now,cutoff);
   return rows.map(({value_json,text})=>{const row=JSON.parse(value_json) as SteeringRecord;return {command_id:row.command_id,run_id:row.run_id,attempt:row.attempt,native_ref:row.native_ref,text};});
  });
 }
 result(identity:Identity,target:SteeringTarget,commandId:string,status:SteeringOutcome,lifecycle:LifecycleCore):void {
  this.store.db.transaction(()=>{
   lifecycle.authorizeAttempt(identity,target.run_id,target.attempt);
   requireThat(['accepted','outcome_unknown','not_delivered'].includes(status),'INVALID_INPUT','Invalid steering outcome.',422);
   const stored=this.store.db.all<{value_json:string}>('SELECT value_json FROM runtime_metadata WHERE key=?',key(target,commandId))[0];
   requireThat(stored,'NOT_FOUND','Steering receipt unavailable.',404);
   const row=JSON.parse(stored.value_json) as SteeringRecord,{attempt}=this.current(target);
   requireThat(row.epoch===identity.epoch&&row.boot_id===identity.boot_id&&row.native_ref===attempt.native_run_ref,'STALE_EPOCH','Steering belongs to another native attempt.');
   requireThat(row.status==='pending'||row.status===status,'REVISION_CONFLICT','The steering outcome is already recorded.');
   if(row.status===status)return;
   this.store.db.exec('UPDATE runtime_metadata SET value_json=? WHERE key=?',JSON.stringify({...row,status}),key(target,commandId));
  });
 }
 receipts(target:SteeringTarget){
  return this.store.db.all<{value_json:string}>("SELECT value_json FROM runtime_metadata WHERE key GLOB ? ORDER BY CASE WHEN json_extract(value_json,'$.status') IN ('pending','outcome_unknown') THEN 0 ELSE 1 END,json_extract(value_json,'$.created_at') DESC,key DESC LIMIT 5",`steer:${target.run_id}:${target.attempt}:*`).map(({value_json})=>{
   const {command_id,run_id,attempt,status,created_at}=JSON.parse(value_json) as SteeringRecord;
   return {command_id,run_id,attempt,status,created_at};
  });
 }
}
