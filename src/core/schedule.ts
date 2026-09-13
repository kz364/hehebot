import { CronExpressionParser } from 'cron-parser';
import { ControlError, requireThat } from './errors';
import type { RoutinePut } from './types';
const MAX_SCAN = 10000;
function formatter(timezone:string):Intl.DateTimeFormat {
 return new Intl.DateTimeFormat('sv-SE',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
}
function wallEpoch(wall:string):number { return Date.parse(wall.replace(' ','T')+':00Z'); }
export function validateSchedule(schedule:NonNullable<RoutinePut['schedule']>, minimumMinutes=15):void {
 try {
  const fields=schedule.cron.trim().split(/\s+/);
  requireThat(fields.length===5 && fields.every(f=>/^[\d*,/\-]+$/.test(f)),'INVALID_INPUT','Use a five-field numeric cron expression.',422);
  requireThat(fields[2]==='*' || fields[4]==='*','INVALID_INPUT','Restrict either day of month or day of week, not both.',422);
  new Intl.DateTimeFormat('en',{timeZone:schedule.timezone}).format();
  const exp=CronExpressionParser.parse(schedule.cron,{tz:schedule.timezone,currentDate:'2026-01-01T00:00:00Z'});
  let previous=exp.next().getTime();
  for(let i=0;i<400;i++){const next=exp.next().getTime();requireThat(next-previous>=minimumMinutes*60000,'INVALID_INPUT',`Schedules must be at least ${minimumMinutes} minutes apart.`,422);previous=next;}
 } catch(e) { if(e instanceof ControlError)throw e;throw new ControlError('INVALID_INPUT','The cron expression or timezone is invalid.',422); }
}
/** Enforce skip on spring-forward gaps and first occurrence only on fall-back folds. */
export function nextDue(schedule:NonNullable<RoutinePut['schedule']>,after:string):string {
 const exp=CronExpressionParser.parse(schedule.cron,{tz:schedule.timezone,currentDate:after});
 const format=formatter(schedule.timezone);
 for(let i=0;i<MAX_SCAN;i++) {
  const date=exp.next().toDate();
  // cron-parser can shift a nonexistent hour to the next existing hour. Reject
  // candidates whose wall-clock fields don't satisfy the owner's original cron.
  const wall=format.format(date);
  const parts=wall.match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
  if(!parts) throw new ControlError('INTERNAL_ERROR','Timezone conversion failed.',500);
  const localIso=`${parts[1]}-${parts[2]}-${parts[3]}T${parts[4]}:${parts[5]}:00Z`;
  const check=CronExpressionParser.parse(schedule.cron,{tz:'UTC',currentDate:new Date(new Date(localIso).getTime()-1000)}).next().toISOString();
  if(check!==new Date(localIso).toISOString())continue;
  // On repeated minutes, only the earlier physical instant is admissible.
  const earlier=new Date(date.getTime()-3*3600000);
  const offset=wallEpoch(wall)-date.getTime();
  const priorOffset=wallEpoch(format.format(earlier))-earlier.getTime();
  const fold=priorOffset-offset;
  const repeated=fold>0 && format.format(new Date(date.getTime()-fold))===wall;
  if(!repeated)return date.toISOString();
 }
 throw new ControlError('INVALID_INPUT','No bounded next schedule time was found.',422);
}
export function preview(schedule:NonNullable<RoutinePut['schedule']>,after:string,count=3):string[] {
 const out:string[]=[];let at=after;for(let i=0;i<count;i++){at=nextDue(schedule,at);out.push(at);}return out;
}
export function dueOccurrences(routine:RoutinePut,next:string,now:string):{selected:string[];skipped:number;next:string} {
 if(!routine.schedule)return {selected:[],skipped:0,next};
 const eligible:string[]=[];let skipped=0,at=next,count=0;
 while(at<=now && count++<MAX_SCAN){
  if(new Date(now).getTime()-new Date(at).getTime()<=routine.policy.max_lateness_seconds*1000)eligible.push(at);else skipped++;
  at=nextDue(routine.schedule,at);
 }
 if(at<=now)throw new ControlError('DEADLINE_EXCEEDED','Schedule catch-up exceeded its scan limit.');
 if(routine.policy.misfire==='skip'){
  const exact=eligible.filter(x=>new Date(now).getTime()-new Date(x).getTime()<60000);
  return {selected:exact.slice(-1),skipped:skipped+eligible.length-exact.slice(-1).length,next:at};
 }
 const cap=routine.policy.misfire==='coalesce'?1:routine.policy.max_replay;
 return {selected:eligible.slice(-cap),skipped:skipped+Math.max(0,eligible.length-cap),next:at};
}
