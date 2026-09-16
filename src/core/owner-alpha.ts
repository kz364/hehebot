import { requireThat } from './errors';
import type { Store } from './store';
import type { Run } from './types';

export type OwnerAlphaPolicy = { session_id:string; persona_id:string; expires_at:string; max_runs:number; max_task_seconds:number };
const key='owner_alpha';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseOwnerAlpha(value:string|undefined,env:{AUTH_MODE?:string;EXECUTION_ENABLED?:string;NATIVE_VERIFIED?:string;PROVIDER_CONFIG?:string}):OwnerAlphaPolicy|undefined {
 if(value===undefined||value==='')return undefined;
 let p:Record<string,unknown>|undefined,provider:unknown;
 try{p=JSON.parse(value);provider=JSON.parse(env.PROVIDER_CONFIG??'{}');}catch{requireThat(false,'INVALID_CONFIGURATION','Invalid owner-alpha configuration.',503);}
 requireThat(env.AUTH_MODE==='local'&&env.EXECUTION_ENABLED==='false'&&env.NATIVE_VERIFIED==='false'&&provider&&typeof provider==='object'&&!Array.isArray(provider)&&Object.keys(provider).length===0,'INVALID_CONFIGURATION','Owner alpha requires local auth, false production gates and no provider.',503);
 requireThat(p&&typeof p==='object'&&!Array.isArray(p)&&Object.keys(p).sort().join(',')==='expires_at,max_runs,max_task_seconds,persona_id,session_id'&&
  typeof p.session_id==='string'&&uuid.test(p.session_id)&&typeof p.persona_id==='string'&&uuid.test(p.persona_id)&&
  typeof p.expires_at==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(p.expires_at)&&Number.isFinite(Date.parse(p.expires_at))&&new Date(p.expires_at).toISOString()===p.expires_at&&
  Number.isInteger(p.max_runs)&&Number(p.max_runs)>=1&&Number(p.max_runs)<=3&&Number.isInteger(p.max_task_seconds)&&Number(p.max_task_seconds)>=1&&Number(p.max_task_seconds)<=300,
  'INVALID_CONFIGURATION','Invalid owner-alpha policy.',503);
 return {session_id:p.session_id as string,persona_id:p.persona_id as string,expires_at:p.expires_at as string,max_runs:p.max_runs as number,max_task_seconds:p.max_task_seconds as number};
}
type Custody={policy:OwnerAlphaPolicy;admitted_run_ids:string[]};
/** Immutable local-session policy; each durable admitted ID consumes one run forever. */
export class OwnerAlpha {
 constructor(private store:Store,readonly policy:OwnerAlphaPolicy|undefined,private now:()=>string){}
 private read():Custody {
  const row=this.store.db.all<{value_json:string}>('SELECT value_json FROM runtime_metadata WHERE key=?',key)[0];
  requireThat(row,'INVALID_CONFIGURATION','Owner-alpha custody is missing.',503);
  const saved=JSON.parse(row.value_json) as Custody;
  requireThat(JSON.stringify(saved.policy)===JSON.stringify(this.policy)&&Array.isArray(saved.admitted_run_ids)&&saved.admitted_run_ids.every(id=>typeof id==='string'&&uuid.test(id))&&new Set(saved.admitted_run_ids).size===saved.admitted_run_ids.length&&saved.admitted_run_ids.length<=this.policy!.max_runs,'INVALID_CONFIGURATION','Owner-alpha custody differs from configuration.',503);
  return saved;
 }
 initialize():void {
  this.store.db.transaction(()=>{
   const saved=this.store.db.all('SELECT key FROM runtime_metadata WHERE key=?',key).length;
   if(saved){
    const custody=this.read();
    const state=this.store.db.all<{epoch:number;phase:string;boot_id:string|null;lease_until:string|null;provider_ref_json:string;provider_operation_id:string|null}>('SELECT epoch,phase,boot_id,lease_until,provider_ref_json,provider_operation_id FROM lifecycle')[0];
    const attempts=this.store.db.all<{run_id:string;attempt:number;epoch:number;boot_id:string}>('SELECT run_id,attempt,epoch,boot_id FROM attempts');
    requireThat(state&&state.provider_ref_json==='{}'&&state.provider_operation_id===null&&
     (state.epoch===0&&state.phase==='STOPPED'&&state.boot_id===null&&state.lease_until===null&&attempts.length===0||
      state.epoch===1&&['BOOTING','READY','RECOVERY_REQUIRED'].includes(state.phase)&&typeof state.boot_id==='string'&&uuid.test(state.boot_id))&&
     attempts.length===custody.admitted_run_ids.length&&attempts.every(a=>a.attempt===1&&a.epoch===1&&a.boot_id===state.boot_id&&custody.admitted_run_ids.includes(a.run_id)),
     'INVALID_CONFIGURATION','Owner-alpha attempt custody is inconsistent.',503);
    return;
   }
   if(!this.policy)return;
   const state=this.store.db.all<{epoch:number;phase:string;provider_ref_json:string;boot_id:string|null;lease_until:string|null;provider_operation_id:string|null}>('SELECT epoch,phase,provider_ref_json,boot_id,lease_until,provider_operation_id FROM lifecycle')[0];
   requireThat(state?.epoch===0&&state.phase==='STOPPED'&&state.provider_ref_json==='{}'&&state.boot_id===null&&state.lease_until===null&&state.provider_operation_id===null&&
    !this.store.db.all('SELECT run_id FROM attempts LIMIT 1').length&&!this.store.db.all('SELECT id FROM operations LIMIT 1').length&&
    !this.store.db.all('SELECT id FROM effects LIMIT 1').length&&!this.store.db.all('SELECT resource_id FROM resource_locks LIMIT 1').length&&
    !this.store.db.all('SELECT id FROM controller_operations LIMIT 1').length,'INVALID_CONFIGURATION','Owner alpha requires fresh stopped local custody.',503);
   this.store.db.exec('INSERT INTO runtime_metadata(key,value_json) VALUES(?,?)',key,JSON.stringify({policy:this.policy,admitted_run_ids:[]}));
  });
 }
 available():boolean {return !!this.policy&&this.now()<this.policy.expires_at&&this.read().admitted_run_ids.length<this.policy.max_runs;}
 directMessage(persona:string,commandId:string|null,routine:string|null,occurrence:string|null,room:string|null):boolean {
  if(!this.policy||persona!==this.policy.persona_id||!commandId||routine||occurrence||room)return false;
  const command=this.store.db.all<{type:string;owner_id:string;payload_json:string}>('SELECT type,owner_id,payload_json FROM commands WHERE id=?',commandId)[0];
  return !!command&&command.type==='message.send'&&!/^(runtime|trigger):/.test(command.owner_id)&&JSON.parse(command.payload_json).conversation_id===persona;
 }
 eligible(run:Run):boolean {
  return run.role==='coordinator'&&run.current_attempt===0&&this.directMessage(run.persona_id,run.command_id,run.routine_id,run.occurrence_id,JSON.parse(run.context_json).room_id??null);
 }
 admit(run:Run):string {
  requireThat(this.available()&&this.eligible(run),'CAPABILITY_UNAVAILABLE','Owner-alpha admission is closed.');
  const saved=this.read();saved.admitted_run_ids.push(run.id);
  this.store.db.exec('UPDATE runtime_metadata SET value_json=? WHERE key=?',JSON.stringify(saved),key);
  return new Date(Math.min(Date.parse(this.policy!.expires_at),Date.parse(this.now())+this.policy!.max_task_seconds*1000)).toISOString();
 }
 authorize(runId:string,attempt:number):void {
  if(!this.policy)return;
  const run=this.store.run(runId);
  requireThat(attempt===1&&run.current_attempt===attempt&&run.role==='coordinator'&&run.persona_id===this.policy.persona_id&&this.read().admitted_run_ids.includes(runId),'STALE_EPOCH','Attempt is not owned by this owner-alpha session.');
 }
}
