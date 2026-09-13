import { requireThat } from './errors';
import type { Store } from './store';

export const FLIGHT_RESTORE_SQL = `CREATE TABLE IF NOT EXISTS flight_restore_deadlines (
 leg_id TEXT NOT NULL, revision INTEGER NOT NULL, departure_at TEXT NOT NULL, departure_zone TEXT NOT NULL,
 restore_at TEXT NOT NULL, routine_id TEXT NOT NULL, source_ref TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','enqueued','confirmed','superseded','outcome_unknown')),
 run_id TEXT, receipt_json TEXT, PRIMARY KEY(leg_id,revision)
)`;
export type FlightRestoreInput = {leg_id:string;revision:number;departure_at:string;departure_zone:string;routine_id:string;source_ref:string};
export type FlightRestoreJob = FlightRestoreInput & {restore_at:string;occurrence_key:string};
type Row=FlightRestoreInput & {restore_at:string;status:string;run_id:string|null;receipt_json:string|null};
function timestamp(value:string):Date {
 const m=typeof value==='string'&&value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/);
 requireThat(m,'INVALID_DEPARTURE','Use a complete departure timestamp with an explicit offset.',422);
 const [year,month,day,hour,minute,second]=m.slice(1,7).map(Number);
 requireThat(year>=1900&&month>=1&&month<=12&&day>=1&&day<=new Date(Date.UTC(year,month,0)).getUTCDate()&&hour<24&&minute<60&&second<60,'INVALID_DEPARTURE','Departure timestamp is invalid.',422);
 if(m[8]!=='Z'){const [h,min]=m[8].slice(1).split(':').map(Number);requireThat(h<=14&&min<60&&(h!==14||min===0),'INVALID_DEPARTURE','Departure offset is invalid.',422);}
 const parsed=new Date(value);requireThat(Number.isFinite(parsed.getTime()),'INVALID_DEPARTURE','Departure timestamp is invalid.',422);return parsed;
}
/** Owner-proposed convention: 04:00 Singapore on the departure's Singapore date,
 * versus departure minus 8h; choose the earlier absolute instant. */
export function flightRestoreDeadline(departureAt:string,departureZone:string):string {
 const departure=timestamp(departureAt);
 requireThat(typeof departureZone==='string'&&/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+$/.test(departureZone),'INVALID_TIMEZONE','Use a named IANA departure timezone.',422);
 try{new Intl.DateTimeFormat('en',{timeZone:departureZone}).format(departure);}catch{requireThat(false,'INVALID_TIMEZONE','Departure timezone is invalid.',422);}
 const singaporeDate=new Date(departure.getTime()+8*3600000).toISOString().slice(0,10);
 const four=Date.parse(`${singaporeDate}T04:00:00+08:00`);
 return new Date(Math.min(four,departure.getTime()-8*3600000)).toISOString();
}
const job=(row:Row):FlightRestoreJob=>({leg_id:row.leg_id,revision:row.revision,departure_at:row.departure_at,departure_zone:row.departure_zone,restore_at:row.restore_at,routine_id:row.routine_id,source_ref:row.source_ref,occurrence_key:`flight-restore:${row.leg_id}:${row.revision}`});
export class FlightRestoreLedger {
 constructor(private readonly store:Store){}
 initialize():void{this.store.db.exec(FLIGHT_RESTORE_SQL);}
 put(input:FlightRestoreInput):FlightRestoreJob {
  requireThat(/^[A-Za-z0-9_-]{1,128}$/.test(input.leg_id)&&Number.isSafeInteger(input.revision)&&input.revision>=1&&typeof input.routine_id==='string'&&input.routine_id.length>0&&typeof input.source_ref==='string'&&input.source_ref.length>0&&input.source_ref.length<=512,'INVALID_FLIGHT_LEG','Flight leg identity, revision and provenance are required.',422);
  const value={...input,departure_at:timestamp(input.departure_at).toISOString(),restore_at:flightRestoreDeadline(input.departure_at,input.departure_zone)};
  return this.store.db.transaction(()=>{
   const existing=this.store.db.all<Row>('SELECT * FROM flight_restore_deadlines WHERE leg_id=? ORDER BY revision DESC LIMIT 1',input.leg_id)[0];
   if(existing?.revision===input.revision){requireThat(['departure_at','departure_zone','routine_id','source_ref','restore_at'].every(k=>existing[k as keyof Row]===value[k as keyof typeof value]),'REVISION_CONFLICT','Flight revision has different contents.');return job(existing);}
   requireThat(input.revision===(existing?.revision??0)+1,'REVISION_CONFLICT','Flight revision must follow the current revision.');
   this.store.db.exec("UPDATE flight_restore_deadlines SET status='superseded' WHERE leg_id=? AND status='pending'",input.leg_id);
   this.store.db.exec("INSERT INTO flight_restore_deadlines(leg_id,revision,departure_at,departure_zone,restore_at,routine_id,source_ref,status) VALUES(?,?,?,?,?,?,?,'pending')",value.leg_id,value.revision,value.departure_at,value.departure_zone,value.restore_at,value.routine_id,value.source_ref);
   return job({...value,status:'pending',run_id:null,receipt_json:null});
  });
 }
 private pending():Row[]{return this.store.db.all<Row>("SELECT d.* FROM flight_restore_deadlines d WHERE d.status='pending' AND NOT EXISTS(SELECT 1 FROM flight_restore_deadlines b WHERE b.leg_id=d.leg_id AND b.status IN ('enqueued','outcome_unknown')) ORDER BY d.restore_at,d.leg_id");}
 nextDue():string|null{return this.pending()[0]?.restore_at??null;}
 due(now:string):FlightRestoreJob[]{const instant=timestamp(now).toISOString();return this.pending().filter(row=>row.restore_at<=instant).map(job);}
 /** Caller enqueues the configured canonical routine in the SAME DB transaction.
  * Callback must be synchronous and durable; external calls do not belong here. */
 reconcile(now:string,enqueue:(job:FlightRestoreJob)=>string):number {
  return this.store.db.transaction(()=>{const due=this.due(now);for(const item of due){const runId=enqueue(item);requireThat(typeof runId==='string'&&runId.length>0,'INVALID_RUN','Enqueue must return a durable run ID.');this.store.db.exec("UPDATE flight_restore_deadlines SET status='enqueued',run_id=? WHERE leg_id=? AND revision=? AND status='pending'",runId,item.leg_id,item.revision);}return due.length;});
 }
 markUnknown(legId:string,revision:number,runId:string):void{this.update(legId,revision,runId,'outcome_unknown',null);}
 confirm(legId:string,revision:number,runId:string,receipt:Record<string,unknown>):void {
  requireThat(receipt&&typeof receipt==='object'&&!Array.isArray(receipt)&&Object.keys(receipt).length>0&&JSON.stringify(receipt).length<=16384,'INVALID_RECEIPT','Verified external receipt is required.',422);
  this.update(legId,revision,runId,'confirmed',JSON.stringify(receipt));
 }
 private update(legId:string,revision:number,runId:string,status:string,receipt:string|null):void {
  this.store.db.transaction(()=>{const row=this.store.db.all<Row>('SELECT * FROM flight_restore_deadlines WHERE leg_id=? AND revision=?',legId,revision)[0];requireThat(row&&row.run_id===runId,'INVALID_RUN','Restoration run does not match.');if(row.status==='confirmed'){requireThat(status==='confirmed'&&row.receipt_json===receipt,'REVISION_CONFLICT','Confirmed restoration cannot be rewritten.');return;}requireThat(['enqueued','outcome_unknown'].includes(row.status),'INVALID_STATE','Restoration has not been enqueued.');this.store.db.exec('UPDATE flight_restore_deadlines SET status=?,receipt_json=? WHERE leg_id=? AND revision=?',status,receipt,legId,revision);});
 }
}
