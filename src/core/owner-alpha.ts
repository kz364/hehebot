import { requireThat } from './errors';
import type { Store } from './store';
import type { Run } from './types';

export type TextOnlyProfile={profile_version:'codex-text-only-v1';profile_sha256:string};
export type OwnerAlphaPolicy = { session_id:string; persona_id:string; expires_at:string; max_runs:number; max_task_seconds:number; background_first_root?:true;text_only?:TextOnlyProfile };
const key='owner_alpha';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type OwnerAlphaEnv={AUTH_MODE?:string;EXECUTION_ENABLED?:string;NATIVE_VERIFIED?:string;PROVIDER_CONFIG?:string};
type HostedOwnerAlphaEnv=OwnerAlphaEnv&{HEHEBOT_OWNER_ALPHA?:string};
function parsePolicy(value:unknown):OwnerAlphaPolicy {
 const p=value as Record<string,unknown>|undefined;
 const keys=['expires_at','max_runs','max_task_seconds','persona_id','session_id',...(Object.hasOwn(p??{},'background_first_root')?['background_first_root']:[]),...(Object.hasOwn(p??{},'text_only')?['text_only']:[])].sort().join(',');
 const text=p?.text_only as Record<string,unknown>|undefined;
 requireThat(p&&typeof p==='object'&&!Array.isArray(p)&&Object.keys(p).sort().join(',')===keys&&(!Object.hasOwn(p,'background_first_root')||p.background_first_root===true)&&
  (!Object.hasOwn(p,'text_only')||text&&typeof text==='object'&&!Array.isArray(text)&&Object.keys(text).sort().join(',')==='profile_sha256,profile_version'&&text.profile_version==='codex-text-only-v1'&&typeof text.profile_sha256==='string'&&/^[0-9a-f]{64}$/.test(text.profile_sha256))&&!(p.background_first_root&&p.text_only)&&
  typeof p.session_id==='string'&&uuid.test(p.session_id)&&typeof p.persona_id==='string'&&uuid.test(p.persona_id)&&
  typeof p.expires_at==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(p.expires_at)&&Number.isFinite(Date.parse(p.expires_at))&&new Date(p.expires_at).toISOString()===p.expires_at&&
  Number.isInteger(p.max_runs)&&Number(p.max_runs)>=1&&Number(p.max_runs)<=3&&Number.isInteger(p.max_task_seconds)&&Number(p.max_task_seconds)>=1&&Number(p.max_task_seconds)<=300,
  'INVALID_CONFIGURATION','Invalid owner-alpha policy.',503);
 return {session_id:p.session_id as string,persona_id:p.persona_id as string,expires_at:p.expires_at as string,max_runs:p.max_runs as number,max_task_seconds:p.max_task_seconds as number,...(p.background_first_root===true?{background_first_root:true as const}:{}),...(text?{text_only:{profile_version:'codex-text-only-v1' as const,profile_sha256:text.profile_sha256 as string}}:{})};
}
function emptyProvider(provider:unknown):boolean {
 return !!provider&&typeof provider==='object'&&!Array.isArray(provider)&&Object.keys(provider).length===0;
}
export function parseOwnerAlpha(value:string|undefined,env:{AUTH_MODE?:string;EXECUTION_ENABLED?:string;NATIVE_VERIFIED?:string;PROVIDER_CONFIG?:string}):OwnerAlphaPolicy|undefined {
 if(value===undefined||value==='')return undefined;
 let parsed:unknown,provider:unknown;
 try{parsed=JSON.parse(value);provider=JSON.parse(env.PROVIDER_CONFIG??'{}');}catch{requireThat(false,'INVALID_CONFIGURATION','Invalid owner-alpha configuration.',503);}
 requireThat(env.AUTH_MODE==='local'&&env.EXECUTION_ENABLED==='false'&&env.NATIVE_VERIFIED==='false'&&emptyProvider(provider),'INVALID_CONFIGURATION','Owner alpha requires local auth, false production gates and no provider.',503);
 return parsePolicy(parsed);
}
export function parseHostedOwnerAlpha(value:string|undefined,env:HostedOwnerAlphaEnv):{policy:OwnerAlphaPolicy;ownerBindingSha256:string}|undefined {
 if(value===undefined||value==='')return undefined;
 let envelope:Record<string,unknown>|undefined,provider:unknown;
 try{envelope=JSON.parse(value);provider=JSON.parse(env.PROVIDER_CONFIG??'{}');}catch{requireThat(false,'INVALID_CONFIGURATION','Invalid hosted owner-alpha configuration.',503);}
 requireThat(env.AUTH_MODE==='access'&&env.EXECUTION_ENABLED==='false'&&env.NATIVE_VERIFIED==='false'&&emptyProvider(provider)&&
  (env.HEHEBOT_OWNER_ALPHA===undefined||env.HEHEBOT_OWNER_ALPHA===''),'INVALID_CONFIGURATION','Hosted owner alpha requires Access auth, false production gates, no provider and no local owner alpha.',503);
 requireThat(envelope&&typeof envelope==='object'&&!Array.isArray(envelope)&&Object.keys(envelope).sort().join(',')==='owner_binding_sha256,policy'&&
  typeof envelope.owner_binding_sha256==='string'&&/^[0-9a-f]{64}$/.test(envelope.owner_binding_sha256),'INVALID_CONFIGURATION','Invalid hosted owner-alpha envelope.',503);
 return {policy:parsePolicy(envelope.policy),ownerBindingSha256:envelope.owner_binding_sha256};
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
     custody.admitted_run_ids.every(id=>attempts.some(a=>a.run_id===id))&&attempts.every(a=>this.validAttempt(a.run_id,a.attempt,custody))&&
     this.store.db.all<{run_id:string}>('SELECT run_id FROM native_task_links').every(link=>attempts.some(a=>a.run_id===link.run_id)&&!custody.admitted_run_ids.includes(link.run_id)),
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
 backgroundRoot(runId:string):boolean {return this.policy?.background_first_root===true&&this.read().admitted_run_ids[0]===runId;}
 propagateCancellation():void {
  if(!this.policy?.background_first_root)return;
  const custody=this.read(),rootId=custody.admitted_run_ids[0];if(!rootId)return;
  const root=this.store.run(rootId);
  if(!['cancelling','cancelled','recovery_required'].includes(root.status))return;
  for(const child of this.store.db.all<Run>('SELECT * FROM runs WHERE parent_run_id=?',rootId)){
   requireThat(this.validAttempt(child.id,1,custody),'STALE_EPOCH','Owner-alpha child custody is inconsistent.');
   if(!['claimed','running','finishing','cancelling','recovery_required'].includes(child.status))continue;
   const revoked=['OWNER_CANCELLED','CONTEXT_INVALIDATED'].includes(root.error_code??'');
   if(['cancelling','recovery_required'].includes(child.status)&&(!revoked||child.error_code===root.error_code))continue;
   this.store.db.exec('UPDATE runs SET status=?,error_code=?,updated_at=? WHERE id=?',child.status==='recovery_required'?'recovery_required':'cancelling',root.error_code??'OWNER_CANCELLED',['cancelling','recovery_required'].includes(child.status)?child.updated_at:this.now(),child.id);
  }
 }
 private validAttempt(runId:string,attempt:number,custody:Custody):boolean {
  const run=this.store.db.all<Run>('SELECT * FROM runs WHERE id=?',runId)[0];
  const row=this.store.db.all<{epoch:number;boot_id:string;deadline_at:string;started_at:string;native_run_ref:string|null;submission_key:string}>('SELECT * FROM attempts WHERE run_id=? AND attempt=?',runId,attempt)[0];
  const state=this.store.db.all<{epoch:number;boot_id:string}>('SELECT epoch,boot_id FROM lifecycle')[0];
  if(!run||!row||attempt!==1||run.current_attempt!==1||run.persona_id!==this.policy!.persona_id||state.epoch!==1||row.epoch!==1||row.boot_id!==state.boot_id)return false;
  const link=this.store.db.all<{parent_run_id:string;parent_attempt:number;native_run_ref:string;native_session_key:string}>('SELECT * FROM native_task_links WHERE run_id=?',runId)[0];
  if(custody.admitted_run_ids.includes(runId))return run.role==='coordinator'&&run.parent_run_id===null&&!link&&row.submission_key===`${runId}:1`&&
   this.directMessage(run.persona_id,run.command_id,run.routine_id,run.occurrence_id,JSON.parse(run.context_json).room_id??null)&&
   Number.isFinite(Date.parse(row.started_at))&&Number.isFinite(Date.parse(row.deadline_at))&&row.deadline_at<=this.policy!.expires_at&&Date.parse(row.deadline_at)<=Date.parse(row.started_at)+this.policy!.max_task_seconds*1000;
  if(!this.policy!.background_first_root||!link||run.role!=='background'||link.parent_run_id!==custody.admitted_run_ids[0]||run.parent_run_id!==link.parent_run_id||link.parent_attempt!==1||!link.native_session_key||!link.native_run_ref||row.native_run_ref!==link.native_run_ref||row.submission_key!==`native:${link.native_run_ref}`)return false;
  if(!this.validAttempt(link.parent_run_id,1,custody))return false;
  const parent=this.store.run(link.parent_run_id);
  const parentAttempt=this.store.db.all<{deadline_at:string}>('SELECT deadline_at FROM attempts WHERE run_id=? AND attempt=1',parent.id)[0];
  return row.deadline_at===parentAttempt.deadline_at&&run.command_id===parent.command_id&&run.routine_id===parent.routine_id&&run.occurrence_id===null;
 }
 authorize(runId:string,attempt:number):void {
  if(!this.policy)return;
  requireThat(this.validAttempt(runId,attempt,this.read()),'STALE_EPOCH','Attempt is not owned by this owner-alpha session.');
 }
 textOnly(runId:string):TextOnlyProfile|undefined {
  if(!this.policy?.text_only||!this.read().admitted_run_ids.includes(runId))return undefined;
  return this.policy.text_only;
 }
}
