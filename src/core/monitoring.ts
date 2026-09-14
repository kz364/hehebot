import type {Store} from './store';
import type {BudgetLedger} from './budget';

/** Content-free observations, not an alternative admission or sleep predicate. */
export function controlMonitoring(store:Store,now:string,budget:BudgetLedger,executionEnabled:boolean){
 return store.db.transaction(()=>{
  const time=Date.parse(now),predicate=budget.admissionPredicate();
  const age=(value:string|null)=>{
   const parsed=value===null?NaN:Date.parse(value);
   return Number.isFinite(parsed)&&parsed<=time?(time-parsed)/1000:null;
  };
  const lifecycle=store.db.all<{phase:string;last_heartbeat:string|null;lease_until:string|null}>('SELECT phase,last_heartbeat,lease_until FROM lifecycle WHERE singleton=1')[0];
  const expected_running=executionEnabled&&Boolean(lifecycle&&['BOOTING','READY','DRAINING'].includes(lifecycle.phase));
  const heartbeat_age_seconds=age(lifecycle?.last_heartbeat??null);
  const queue=store.db.all<{count:number;oldest_at:string|null}>(`SELECT COUNT(*) AS count,MIN(COALESCE(c.accepted_at,r.created_at)) AS oldest_at
   FROM runs r LEFT JOIN commands c ON c.id=r.command_id WHERE r.role='coordinator' AND r.status='queued'
   AND (r.current_attempt>0 OR COALESCE(c.accepted_at,r.created_at)>?) AND (${predicate.sql})`,new Date(time-90*86400000).toISOString(),...predicate.bindings)[0];
  const operations=store.db.all<{kind:string;status:string;count:number}>("SELECT kind,status,COUNT(*) AS count FROM operations WHERE status!='settled' GROUP BY kind,status ORDER BY kind,status");
  const overdue_operations=store.db.all<{count:number}>("SELECT COUNT(*) AS count FROM operations WHERE status!='settled' AND deadline_at<=?",now)[0].count;
  const effects=store.db.all<{status:string;count:number}>("SELECT status,COUNT(*) AS count FROM effects WHERE status IN ('intent','dispatched','outcome_unknown') GROUP BY status ORDER BY status");
  const locks=store.db.all<{count:number}>('SELECT COUNT(*) AS count FROM resource_locks')[0].count;
  const tasks=store.db.all<{cancelling:number;recovery:number}>("SELECT COALESCE(SUM(status='cancelling'),0) AS cancelling,COALESCE(SUM(status='recovery_required'),0) AS recovery FROM runs WHERE status IN ('cancelling','recovery_required')")[0];
  const schedule=store.db.all<{overdue:number;oldest_due_at:string|null}>('SELECT COUNT(*) AS overdue,MIN(next_due_at) AS oldest_due_at FROM schedule_state WHERE next_due_at<?',now)[0];
  const unknown=effects.find(effect=>effect.status==='outcome_unknown')?.count??0;
  const oldest_request_age_seconds=age(queue.oldest_at),schedule_lag_seconds=age(schedule.oldest_due_at)??0;
  const alerts:Array<{code:string;severity:'warning'|'error';count?:number}>=[];
  if(expected_running&&(heartbeat_age_seconds===null||heartbeat_age_seconds>45))alerts.push({code:heartbeat_age_seconds===null?'HEARTBEAT_UNKNOWN':'HEARTBEAT_STALE',severity:'warning'});
  if(executionEnabled&&oldest_request_age_seconds!==null&&oldest_request_age_seconds>120)alerts.push({code:'QUEUE_DELAYED',severity:'warning',count:queue.count});
  if(tasks.cancelling)alerts.push({code:'CANCEL_UNCONFIRMED',severity:'error',count:tasks.cancelling});
  if(tasks.recovery)alerts.push({code:'RECOVERY_REQUIRED',severity:'error',count:tasks.recovery});
  if(unknown)alerts.push({code:'OUTCOME_UNKNOWN',severity:'error',count:unknown});
  if(overdue_operations)alerts.push({code:'OPERATION_OVERDUE',severity:'error',count:overdue_operations});
  if(schedule_lag_seconds>300)alerts.push({code:'SCHEDULE_DELAYED',severity:'warning',count:schedule.overdue});
  if(store.db.all("SELECT id FROM commands WHERE status='applied' LIMIT 1").length)alerts.push({code:'BACKUP_UNVERIFIED',severity:'warning'});
  return {scope:'control-plane-only' as const,observed_at:now,
   lease:{expected_running,last_heartbeat:lifecycle?.last_heartbeat??null,heartbeat_age_seconds,lease_until:lifecycle?.lease_until??null},
   queue:{count:queue.count,oldest_request_age_seconds},operations,overdue_operations,effects,locks,
   tasks,schedules:{overdue:schedule.overdue,lag_seconds:schedule_lag_seconds},
   backup:{status:'unverified' as const,last_verified_at:null},alerts};
 });
}
