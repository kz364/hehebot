import {createHash} from 'node:crypto';
import {ControlError,requireThat} from './errors';
import {Store} from './store';
import {LifecycleCore} from './lifecycle';
import {warmLedgerUsed} from './owner-alpha-warm';
import type {ControlCore} from './control';
import type {OwnerAlphaGeneration,OwnerAlphaPolicy,BackgroundProfile} from './owner-alpha';
import type {OwnerAlphaRetirement} from './owner-alpha-bootstrap';
import type {Run} from './types';

/** Stage B background-generation contract. A default-off, versioned, finite
 * three-root generation that admits exactly three successive direct owner
 * messages (roles background/status/independent) within one boot/epoch. The
 * first root may spawn observed native descendants under the restricted
 * background profile; the status root stays unsettled until the coordinator
 * releases the background root, and the independent root is only admissible
 * after the status root settles canonically. Message-bound like the warm
 * generations, but with its own versioned manifest digest, one immutable
 * generation descriptor, and per-admission reservations under the existing
 * lifetime ledger prefix. Nothing here upgrades or reinterprets legacy or warm
 * configuration; their rows keep their exact meaning. */
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hex64=/^[0-9a-f]{64}$/;
const utc=(value:unknown):boolean=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const digest=(values:unknown[]):string=>createHash('sha256').update(JSON.stringify(values)).digest('hex');

export type BackgroundGenerationConfig={
 schema_version:1;kind:'owner-alpha-background-generation-v1';
 installation_id:string;owner_id:string;owner_binding_sha256:string;policy_revision:string;persona_id:string;
 background:BackgroundProfile;expires_at:string;max_task_seconds:number;max_admissions:3;
 prior_cost_micro_usd:number;prior_cost_source:string;total_cap_micro_usd:number;reservation_micro_usd:number;
 seed_retirement?:OwnerAlphaRetirement;
};
export type BackgroundPersistedConfig=Omit<BackgroundGenerationConfig,'seed_retirement'>;
export type BackgroundRole='background'|'status'|'independent';
export type BackgroundManifest={
 schema_version:1;kind:'owner-alpha-background-manifest-v1';admission:1|2|3;role:BackgroundRole;
 installation_id:string;owner_binding_sha256:string;run_id:string;persona_id:string;
 command_id:string;command_sha256:string;event_sequence:number;policy_revision:string;
 epoch:number;boot_id:string;transition_id:string;session_id:string;background:BackgroundProfile;
 issued_at:string;expires_at:string;reservation_micro_usd:number;generation_sha256:string;manifest_sha256:string;
 status_summary_sha256?:string;
};
export type BackgroundStatusSummary={
 schema_version:1;kind:'owner-alpha-background-status-summary-v1';
 generation:{epoch:number;generation_sha256:string};
 admissions:Array<{admission:1;role:'background';run_id:string;run_status:string;attempt_status:string|null;coordinator_released:boolean;
  deadline_at:string;child_count:number;manifest_sha256:string}>;
 computed_at:string;
};
export type BackgroundMessageBoundAuthority={kind:'owner-message-background-generation';config_sha256:string;generation_sha256:string;admissions:BackgroundManifest[]};
export type BackgroundGenerationView=OwnerAlphaGeneration&{authority:BackgroundMessageBoundAuthority};
export type BackgroundSummary={
 schema_version:1;kind:'owner-alpha-background-summary-v1';policy_revision:string;persona_id:string;policy_expires_at:string;
 max_admissions:3;admissions_used:number;message_admission_available:boolean;next_role:BackgroundRole|null;
 generation:{session_id:string;expires_at:string;epoch:number}|null;
};
const BACKGROUND_CONFIG_KEYS=['background','expires_at','installation_id','kind','max_admissions','max_task_seconds','owner_binding_sha256','owner_id','persona_id','policy_revision','prior_cost_micro_usd','prior_cost_source','reservation_micro_usd','schema_version','total_cap_micro_usd'];
const BACKGROUND_MANIFEST_KEYS=['admission','background','boot_id','command_id','command_sha256','epoch','event_sequence','expires_at','generation_sha256','installation_id','issued_at','kind','manifest_sha256','owner_binding_sha256','persona_id','policy_revision','reservation_micro_usd','role','run_id','schema_version','session_id','transition_id'];
const BACKGROUND_ROLES:BackgroundRole[]=['background','status','independent'];

function backgroundProfileValid(value:unknown):value is BackgroundProfile{
 const v=value as BackgroundProfile|undefined;
 return !!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')==='max_resident_child_threads,multi_agent_v1,profile_sha256,profile_version,wait_agent_enabled'&&
  v.profile_version==='codex-background-v2-restricted-v1'&&typeof v.profile_sha256==='string'&&hex64.test(v.profile_sha256)&&
  v.max_resident_child_threads===2&&v.wait_agent_enabled===false&&v.multi_agent_v1===false;
}
const backgroundProfileEqual=(a:BackgroundProfile,b:BackgroundProfile):boolean=>
 a.profile_version===b.profile_version&&a.profile_sha256===b.profile_sha256&&a.max_resident_child_threads===b.max_resident_child_threads&&
 a.wait_agent_enabled===b.wait_agent_enabled&&a.multi_agent_v1===b.multi_agent_v1;
function retirementShape(r:unknown):r is OwnerAlphaRetirement{
 const v=r as OwnerAlphaRetirement|undefined;
 return !!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')==='boot_id,direct_child_stopped,epoch,execution_lock_free,observed_at,session_id,session_lock_free,source,transition_id'&&
  Number.isSafeInteger(v.epoch)&&v.epoch>=1&&typeof v.boot_id==='string'&&uuid.test(v.boot_id)&&typeof v.session_id==='string'&&uuid.test(v.session_id)&&
  (v.transition_id===null||typeof v.transition_id==='string'&&uuid.test(v.transition_id))&&
  v.direct_child_stopped===true&&v.execution_lock_free===true&&v.session_lock_free===true&&
  typeof v.observed_at==='string'&&utc(v.observed_at)&&typeof v.source==='string'&&v.source.length>0&&v.source.length<=256;
}

/** Parse the explicit opt-in env configuration. Fail closed on any unknown or
 * missing shape; this never widens legacy or warm token semantics. */
export function parseOwnerAlphaBackground(value:string|undefined):BackgroundGenerationConfig|undefined{
 if(value===undefined||value==='')return undefined;
 let c:BackgroundGenerationConfig;
 try{c=JSON.parse(value);}catch{requireThat(false,'INVALID_CONFIGURATION','Invalid background owner-alpha generation JSON.',503);}
 const keys=[...BACKGROUND_CONFIG_KEYS,...(Object.hasOwn(c??{},'seed_retirement')?['seed_retirement']:[])];
 requireThat(c&&typeof c==='object'&&!Array.isArray(c)&&Object.keys(c).sort().join(',')===keys.sort().join(',')&&
  c.schema_version===1&&c.kind==='owner-alpha-background-generation-v1'&&c.max_admissions===3&&
  [c.installation_id,c.owner_id,c.policy_revision,c.prior_cost_source].every(v=>typeof v==='string'&&v.length>0&&v.length<=256)&&!/^(runtime|trigger):/.test(c.owner_id)&&
  typeof c.owner_binding_sha256==='string'&&hex64.test(c.owner_binding_sha256)&&
  typeof c.persona_id==='string'&&uuid.test(c.persona_id)&&backgroundProfileValid(c.background)&&
  typeof c.expires_at==='string'&&utc(c.expires_at)&&
  Number.isSafeInteger(c.max_task_seconds)&&c.max_task_seconds>=1&&c.max_task_seconds<=300&&
  [c.prior_cost_micro_usd,c.total_cap_micro_usd,c.reservation_micro_usd].every(n=>Number.isSafeInteger(n)&&n>=0)&&c.reservation_micro_usd>0,
  'INVALID_CONFIGURATION','Invalid background owner-alpha generation configuration.',503);
 if(Object.hasOwn(c,'seed_retirement'))requireThat(retirementShape(c.seed_retirement),'INVALID_CONFIGURATION','Invalid background seed retirement.',503);
 return {schema_version:1,kind:'owner-alpha-background-generation-v1',installation_id:c.installation_id,owner_id:c.owner_id,owner_binding_sha256:c.owner_binding_sha256,
  policy_revision:c.policy_revision,persona_id:c.persona_id,background:{...c.background},
  expires_at:c.expires_at,max_task_seconds:c.max_task_seconds,max_admissions:3,
  prior_cost_micro_usd:c.prior_cost_micro_usd,prior_cost_source:c.prior_cost_source,total_cap_micro_usd:c.total_cap_micro_usd,reservation_micro_usd:c.reservation_micro_usd,
  ...(Object.hasOwn(c,'seed_retirement')?{seed_retirement:c.seed_retirement}:{})};
}
/** Canonical digest over the persisted policy record; the env configuration's
 * optional seed retirement is deliberately excluded because it is not persisted
 * policy — only its observation is recorded once. */
export function backgroundConfigSha256(config:BackgroundPersistedConfig):string{
 return digest([config.schema_version,config.kind,config.installation_id,config.owner_id,config.owner_binding_sha256,config.policy_revision,config.persona_id,
  config.background.profile_version,config.background.profile_sha256,config.background.max_resident_child_threads,config.background.wait_agent_enabled,config.background.multi_agent_v1,
  config.expires_at,config.max_task_seconds,config.max_admissions,
  config.prior_cost_micro_usd,config.prior_cost_source,config.total_cap_micro_usd,config.reservation_micro_usd]);
}
/** Separate versioned manifest digest covering every admission binding plus the
 * role, frozen deadline, generation digest and — for the status root — the
 * immutable status-summary digest. Never reuse any other manifest digest. */
export function backgroundManifestSha256(m:Omit<BackgroundManifest,'manifest_sha256'>):string{
 return digest([m.schema_version,m.kind,m.admission,m.role,m.installation_id,m.owner_binding_sha256,m.run_id,m.persona_id,m.command_id,m.command_sha256,m.event_sequence,
  m.policy_revision,m.epoch,m.boot_id,m.transition_id,m.session_id,m.background.profile_version,m.background.profile_sha256,m.background.max_resident_child_threads,
  m.background.wait_agent_enabled,m.background.multi_agent_v1,m.issued_at,m.expires_at,m.reservation_micro_usd,m.generation_sha256,m.status_summary_sha256??null]);
}
/** Canonical digest of the immutable generation descriptor; admissions are
 * excluded so the digest survives later admissions without rewriting history. */
export function backgroundGenerationSha256(g:Omit<BackgroundGenerationView,'authority'>&{authority:Pick<BackgroundMessageBoundAuthority,'kind'|'config_sha256'>}):string{
 return digest([g.epoch,g.boot_id,g.transition_id,g.policy.session_id,g.policy.persona_id,g.policy.expires_at,g.policy.max_runs,g.policy.max_task_seconds,
  g.policy.background!.profile_version,g.policy.background!.profile_sha256,g.predecessor.epoch,g.predecessor.boot_id,g.predecessor.session_id,
  g.activation_command_id,g.activation_command_sha256,g.activation_event_sequence,g.authority.kind,g.authority.config_sha256]);
}

function readRow<T>(db:Store['db'],key:string):T|undefined{
 const row=db.all<{value_json:string}>('SELECT value_json FROM runtime_metadata WHERE key=?',key)[0];
 return row?JSON.parse(row.value_json) as T:undefined;
}
function putRow(db:Store['db'],key:string,value:unknown):void{
 db.exec('INSERT INTO runtime_metadata(key,value_json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json',key,JSON.stringify(value));
}
/** The one immutable persisted policy row. At most one revision may ever exist. */
export function persistedBackgroundConfigRow(db:Store['db']):{key:string;config:BackgroundPersistedConfig}|undefined{
 const rows=db.all<{key:string;value_json:string}>("SELECT key,value_json FROM runtime_metadata WHERE key GLOB 'owner_alpha_background_config:*'");
 requireThat(rows.length<=1,'INVALID_CONFIGURATION','Background generation policy history is inconsistent.',503);
 if(!rows.length)return undefined;
 let c:BackgroundPersistedConfig;
 try{c=JSON.parse(rows[0].value_json);}catch{throw new ControlError('INVALID_CONFIGURATION','Background generation policy record is unreadable.',503);}
 requireThat(c&&typeof c==='object'&&!Array.isArray(c)&&Object.keys(c).sort().join(',')===BACKGROUND_CONFIG_KEYS.join(',')&&
  c.schema_version===1&&c.kind==='owner-alpha-background-generation-v1'&&c.max_admissions===3&&
  [c.installation_id,c.owner_id,c.policy_revision,c.prior_cost_source].every(v=>typeof v==='string'&&v.length>0&&v.length<=256)&&!/^(runtime|trigger):/.test(c.owner_id)&&
  typeof c.owner_binding_sha256==='string'&&hex64.test(c.owner_binding_sha256)&&
  typeof c.persona_id==='string'&&uuid.test(c.persona_id)&&backgroundProfileValid(c.background)&&
  typeof c.expires_at==='string'&&utc(c.expires_at)&&
  Number.isSafeInteger(c.max_task_seconds)&&c.max_task_seconds>=1&&c.max_task_seconds<=300&&
  [c.prior_cost_micro_usd,c.total_cap_micro_usd,c.reservation_micro_usd].every(n=>Number.isSafeInteger(n)&&n>=0)&&c.reservation_micro_usd>0,
  'INVALID_CONFIGURATION','Background generation policy record is invalid.',503);
 requireThat(rows[0].key===`owner_alpha_background_config:${c.policy_revision}`,'INVALID_CONFIGURATION','Background generation policy key is invalid.',503);
 return {key:rows[0].key,config:c};
}
/** Sum the existing lifetime ledger: the trusted prior cost plus every strict
 * reservation row under the legacy owner_alpha_reservation:* prefix, including
 * the background per-admission suffixes. Fail closed on any corrupt entry. */
export function backgroundLedgerUsed(db:Store['db'],priorCostMicroUsd:number):number{
 return warmLedgerUsed(db,priorCostMicroUsd);
}
/** Observed coordinator release for one admitted root: the durable attempt row
 * carries a committed release whose native_ref equals its own native_run_ref. */
export function backgroundCoordinatorReleased(db:Store['db'],m:BackgroundManifest):boolean{
 const row=db.all<{native_run_ref:string|null;coordinator_release_json:string|null}>('SELECT native_run_ref,coordinator_release_json FROM attempts WHERE run_id=? AND attempt=1',m.run_id)[0];
 if(!row||row.native_run_ref===null||row.coordinator_release_json===null)return false;
 try{
  const release=JSON.parse(row.coordinator_release_json) as {native_ref?:unknown;outcome?:unknown};
  return release.native_ref===row.native_run_ref&&(release.outcome==='completed'||release.outcome==='failed'||release.outcome==='interrupted');
 }catch{return false;}
}
/** Exact settlement predicate for the status root: canonical background
 * completion with a matching stored receipt, settled coordinator release, and
 * no operations, effects, locks, questions, children or native links. Mirrors
 * the warm settlement predicate for this run only. */
export function backgroundRunSettled(store:Store,m:BackgroundManifest,epoch:number,bootId:string):boolean{
 const db=store.db;
 const rows=db.all<{run_status:string;attempt_status:string;result_json:string|null;native_run_ref:string|null;coordinator_release_json:string|null;proof:string|null;epoch:number;boot_id:string}>(
  `SELECT r.status AS run_status,a.status AS attempt_status,a.result_json,a.native_run_ref,a.coordinator_release_json,m.value_json AS proof,a.epoch,a.boot_id
   FROM attempts a JOIN runs r ON r.id=a.run_id LEFT JOIN runtime_metadata m ON m.key='owner_alpha_background_receipt:'||a.run_id||':1'
   WHERE a.run_id=? AND a.attempt=1`,m.run_id);
 const row=rows[0];
 if(rows.length!==1||!row||row.run_status!=='completed'||row.attempt_status!=='completed'||row.epoch!==epoch||row.boot_id!==bootId||!row.result_json||!row.proof)return false;
 let result:{status?:unknown},proof:{thread_id?:unknown;turn_id?:unknown;output_sha256?:unknown};
 try{result=JSON.parse(row.result_json);proof=JSON.parse(row.proof);}catch{return false;}
 if(result.status!=='completed'||typeof (result as {text?:unknown}).text!=='string'||
  typeof proof.thread_id!=='string'||proof.thread_id.length<1||proof.thread_id.length>256||
  proof.turn_id!==row.native_run_ref||proof.output_sha256!==createHash('sha256').update((result as {text:string}).text).digest('hex'))return false;
 if(row.coordinator_release_json!==JSON.stringify({native_ref:row.native_run_ref,outcome:'completed'}))return false;
 if(db.all(`SELECT a.run_id FROM attempts a WHERE a.run_id=? AND a.attempt=1 AND (
   EXISTS(SELECT 1 FROM operations o WHERE o.run_id=a.run_id AND o.attempt=a.attempt AND o.status<>'settled') OR
   EXISTS(SELECT 1 FROM effects e WHERE e.run_id=a.run_id AND e.status IN ('intent','dispatched','outcome_unknown')) OR
   EXISTS(SELECT 1 FROM resource_locks l WHERE l.run_id=a.run_id) OR
   EXISTS(SELECT 1 FROM native_task_links l WHERE l.run_id=a.run_id) OR
   EXISTS(SELECT 1 FROM runs c WHERE c.parent_run_id=a.run_id)) LIMIT 1`,m.run_id).length)return false;
 if(db.all<{value_json:string}>("SELECT value_json FROM runtime_metadata WHERE key GLOB 'native-question:*'").some(row=>{
  try{const question=JSON.parse(row.value_json) as {run_id?:unknown};return question.run_id===m.run_id;}catch{return true;}
 }))return false;
 return true;
}

/** Reconstruct the admissions view from the append-only per-admission manifest
 * rows. The generation descriptor row itself is write-once and carries no
 * admissions; each admitted manifest lives in its own immutable
 * owner_alpha_background_manifest:{epoch}:{admission} row. Fail closed on
 * missing, extra, unreadable or non-contiguous rows, and on roles that do not
 * match their ordinal position. */
export function backgroundAdmissionsView(store:Store,epoch:number):BackgroundManifest[]{
 requireThat(Number.isSafeInteger(epoch)&&epoch>=2,'INVALID_CONFIGURATION','Invalid background generation epoch.',503);
 const rows=store.db.all<{key:string;value_json:string}>("SELECT key,value_json FROM runtime_metadata WHERE key GLOB 'owner_alpha_background_manifest:*'");
 const manifests:BackgroundManifest[]=[];
 for(const row of rows){
  const match=/^owner_alpha_background_manifest:(\d+):([123])$/.exec(row.key);
  requireThat(!!match&&Number(match![1])===epoch,'INVALID_CONFIGURATION','Background manifest history is inconsistent.',503);
  let manifest:BackgroundManifest;
  try{manifest=JSON.parse(row.value_json) as BackgroundManifest;}catch{throw new ControlError('INVALID_CONFIGURATION','Background manifest record is unreadable.',503);}
  requireThat(typeof manifest==='object'&&manifest!==null&&!Array.isArray(manifest)&&manifest.admission===Number(match![2])&&manifest.role===BACKGROUND_ROLES[Number(match![2])-1],
   'INVALID_CONFIGURATION','Background manifest record is inconsistent.',503);
  manifests.push(manifest);
 }
 manifests.sort((a,b)=>a.admission-b.admission);
 requireThat(manifests.length>=1&&manifests.length<=3&&manifests.every((m,i)=>m.admission===i+1),
  'INVALID_CONFIGURATION','Background manifest history is inconsistent.',503);
 return manifests;
}

function statusSummaryShape(value:unknown):value is BackgroundStatusSummary{
 const s=value as BackgroundStatusSummary|undefined;
 return !!s&&typeof s==='object'&&!Array.isArray(s)&&Object.keys(s).sort().join(',')==='admissions,computed_at,generation,kind,schema_version'&&
  s.schema_version===1&&s.kind==='owner-alpha-background-status-summary-v1'&&
  !!s.generation&&typeof s.generation==='object'&&!Array.isArray(s.generation)&&Object.keys(s.generation).sort().join(',')==='epoch,generation_sha256'&&
  Number.isSafeInteger(s.generation.epoch)&&s.generation.epoch>=2&&typeof s.generation.generation_sha256==='string'&&hex64.test(s.generation.generation_sha256)&&
  typeof s.computed_at==='string'&&utc(s.computed_at)&&Array.isArray(s.admissions)&&s.admissions.length===1&&
  s.admissions.every(x=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')==='admission,attempt_status,child_count,coordinator_released,deadline_at,manifest_sha256,role,run_id,run_status'&&
   x.admission===1&&x.role==='background'&&typeof x.run_id==='string'&&uuid.test(x.run_id)&&typeof x.run_status==='string'&&
   (x.attempt_status===null||typeof x.attempt_status==='string')&&typeof x.coordinator_released==='boolean'&&
   typeof x.deadline_at==='string'&&utc(x.deadline_at)&&Number.isSafeInteger(x.child_count)&&x.child_count>=0&&
   typeof x.manifest_sha256==='string'&&hex64.test(x.manifest_sha256));
}

/** Strict read-time validation of a persisted background generation. Nothing
 * is repaired or rewritten; corrupt history stays unavailable. The admissions
 * are reconstructed from separate append-only manifest rows before this runs,
 * so a descriptor row that still carries admissions is itself invalid history. */
export function validateBackgroundGenerationView(store:Store,view:unknown):asserts view is BackgroundGenerationView{
 const db=store.db,g=view as Record<string,unknown>|undefined;
 requireThat(g&&typeof g==='object'&&!Array.isArray(g),'INVALID_CONFIGURATION','Invalid background generation record.',503);
 requireThat(Object.keys(g).sort().join(',')==='activation_command_id,activation_command_sha256,activation_event_sequence,authority,boot_id,epoch,policy,predecessor,transition_id','INVALID_CONFIGURATION','Invalid background generation record.',503);
 const w=view as unknown as BackgroundGenerationView;
 requireThat(Number.isSafeInteger(w.epoch)&&w.epoch>=2&&uuid.test(w.boot_id)&&uuid.test(w.transition_id)&&
  Number.isSafeInteger(w.activation_event_sequence)&&w.activation_event_sequence>=1&&uuid.test(w.activation_command_id)&&hex64.test(w.activation_command_sha256),
  'INVALID_CONFIGURATION','Invalid background generation record.',503);
 requireThat(w.policy&&Object.keys(w.policy).sort().join(',')==='background,expires_at,max_runs,max_task_seconds,persona_id,session_id'&&
  uuid.test(w.policy.session_id)&&uuid.test(w.policy.persona_id)&&utc(w.policy.expires_at)&&w.policy.max_runs===3&&
  Number.isSafeInteger(w.policy.max_task_seconds)&&w.policy.max_task_seconds>=1&&w.policy.max_task_seconds<=300&&backgroundProfileValid(w.policy.background),
  'INVALID_CONFIGURATION','Invalid background generation policy.',503);
 requireThat(w.predecessor&&Object.keys(w.predecessor).sort().join(',')==='boot_id,epoch,lease_until,phase,session_id'&&
  w.predecessor.epoch===w.epoch-1&&uuid.test(w.predecessor.boot_id)&&uuid.test(w.predecessor.session_id)&&
  w.predecessor.phase==='RECOVERY_REQUIRED'&&(w.predecessor.lease_until===null||utc(w.predecessor.lease_until)),
  'INVALID_CONFIGURATION','Invalid background generation predecessor.',503);
 const a=w.authority;
 requireThat(a&&Object.keys(a).sort().join(',')==='admissions,config_sha256,generation_sha256,kind'&&a.kind==='owner-message-background-generation'&&
  hex64.test(a.config_sha256)&&hex64.test(a.generation_sha256)&&Array.isArray(a.admissions)&&a.admissions.length>=1&&a.admissions.length<=3,
  'INVALID_CONFIGURATION','Invalid background generation authority.',503);
 const persisted=persistedBackgroundConfigRow(db);
 requireThat(persisted,'INVALID_CONFIGURATION','Background generation policy record is missing.',503);
 const c=persisted.config;
 requireThat(backgroundConfigSha256(c)===a.config_sha256,'INVALID_CONFIGURATION','Background generation policy digest is inconsistent.',503);
 requireThat(c.persona_id===w.policy.persona_id&&c.max_task_seconds===w.policy.max_task_seconds&&backgroundProfileEqual(c.background,w.policy.background)&&
  Date.parse(c.expires_at)>=Date.parse(w.policy.expires_at),'INVALID_CONFIGURATION','Background generation differs from its policy.',503);
 requireThat(backgroundGenerationSha256({...w,authority:{kind:a.kind,config_sha256:a.config_sha256}})===a.generation_sha256,'INVALID_CONFIGURATION','Background generation digest is inconsistent.',503);
 const first=a.admissions[0];
 requireThat(utc(first.issued_at),'INVALID_CONFIGURATION','Invalid background manifest record.',503);
 requireThat(w.policy.expires_at===new Date(Math.min(Date.parse(c.expires_at),Date.parse(first.issued_at)+300000)).toISOString(),'INVALID_CONFIGURATION','Background generation expiry is not its frozen cap.',503);
 for(let i=0;i<a.admissions.length;i++){
  const m=a.admissions[i],admission=i+1;
  const keys=[...BACKGROUND_MANIFEST_KEYS,...(m.role==='status'?['status_summary_sha256']:[])];
  requireThat(m&&typeof m==='object'&&!Array.isArray(m)&&Object.keys(m).sort().join(',')===keys.sort().join(',')&&
   m.schema_version===1&&m.kind==='owner-alpha-background-manifest-v1'&&m.admission===admission&&m.role===BACKGROUND_ROLES[i]&&
   (m.role!=='status'||typeof m.status_summary_sha256==='string'&&hex64.test(m.status_summary_sha256))&&
   m.epoch===w.epoch&&m.boot_id===w.boot_id&&m.transition_id===w.transition_id&&m.session_id===w.policy.session_id&&
   uuid.test(m.run_id)&&m.persona_id===c.persona_id&&m.installation_id===c.installation_id&&m.owner_binding_sha256===c.owner_binding_sha256&&
   m.policy_revision===c.policy_revision&&backgroundProfileEqual(m.background,c.background)&&m.reservation_micro_usd===c.reservation_micro_usd&&
   m.generation_sha256===a.generation_sha256&&uuid.test(m.command_id)&&hex64.test(m.command_sha256)&&
   Number.isSafeInteger(m.event_sequence)&&m.event_sequence>=1&&utc(m.issued_at)&&utc(m.expires_at)&&Date.parse(m.expires_at)>Date.parse(m.issued_at),
   'INVALID_CONFIGURATION','Invalid background manifest record.',503);
  requireThat(m.expires_at===new Date(Math.min(Date.parse(w.policy.expires_at),Date.parse(m.issued_at)+c.max_task_seconds*1000)).toISOString()&&
   Date.parse(m.expires_at)-Date.parse(m.issued_at)>=1000,'INVALID_CONFIGURATION','Background manifest deadline is not its frozen cap.',503);
  const {manifest_sha256:_,...unsigned}=m;
  requireThat(backgroundManifestSha256(unsigned)===m.manifest_sha256,'INVALID_CONFIGURATION','Background manifest digest is inconsistent.',503);
  if(admission===1)requireThat(m.command_id===w.activation_command_id&&m.command_sha256===w.activation_command_sha256&&m.event_sequence===w.activation_event_sequence,
   'INVALID_CONFIGURATION','Background activation differs from its first manifest.',503);
  else requireThat(m.event_sequence>first.event_sequence&&a.admissions.every(other=>other===m||other.run_id!==m.run_id&&other.command_id!==m.command_id),
   'INVALID_CONFIGURATION','Background later admissions must be distinct messages.',503);
  const command=db.all<{type:string;status:string;owner_id:string;resource_id:string|null;accepted_at:string;body_hash:string}>(
   'SELECT type,status,owner_id,resource_id,accepted_at,body_hash FROM commands WHERE id=?',m.command_id)[0];
  requireThat(command&&command.type==='message.send'&&command.status==='applied'&&command.owner_id===c.owner_id&&command.resource_id===m.run_id&&
   command.accepted_at<=m.issued_at&&command.body_hash===m.command_sha256,'INVALID_CONFIGURATION','Background manifest differs from its owner message.',503);
  const run=db.all<Pick<Run,'command_id'|'persona_id'|'role'|'parent_run_id'|'routine_id'|'occurrence_id'>>('SELECT command_id,persona_id,role,parent_run_id,routine_id,occurrence_id FROM runs WHERE id=?',m.run_id)[0];
  requireThat(run&&run.command_id===m.command_id&&run.persona_id===m.persona_id&&run.role==='coordinator'&&run.parent_run_id===null&&
   run.routine_id===null&&run.occurrence_id===null&&store.runHasNullRoom(m.run_id),
   'INVALID_CONFIGURATION','Background manifest differs from its admitted run.',503);
  requireThat(db.all("SELECT sequence FROM events WHERE id=? AND type='message.user' AND actor_id=? AND conversation_id=? AND sequence=? AND created_at<=?",
   m.command_id,c.owner_id,m.persona_id,m.event_sequence,m.issued_at).length===1,'INVALID_CONFIGURATION','Background manifest event binding is missing.',503);
  const reservation=db.all<{value_json:string}>('SELECT value_json FROM runtime_metadata WHERE key=?',`owner_alpha_reservation:${w.epoch}:${admission}`)[0];
  let saved:{manifest_sha256:string;micro_usd:number}|undefined;
  try{saved=reservation?JSON.parse(reservation.value_json):undefined;}catch{saved=undefined;}
  requireThat(saved&&Object.keys(saved).sort().join(',')==='manifest_sha256,micro_usd'&&saved.manifest_sha256===m.manifest_sha256&&
   saved.micro_usd===m.reservation_micro_usd,'INVALID_CONFIGURATION','Background reservation is missing or inconsistent.',503);
 }
 // The first root never settles: it is deliberately left unconfirmed while its
 // observed descendants run, and no completion path exists for it.
 const rootRun=db.all<{status:string}>('SELECT status FROM runs WHERE id=?',first.run_id)[0];
 requireThat(rootRun&&rootRun.status!=='completed','INVALID_CONFIGURATION','Background root never settles.',503);
 if(a.admissions.length>=2)requireThat(backgroundCoordinatorReleased(db,first),
  'INVALID_CONFIGURATION','Background status admission requires the observed coordinator release of the background root.',503);
 const statusManifest=a.admissions.find(m=>m.role==='status');
 if(statusManifest){
  const row=db.all<{value_json:string}>('SELECT value_json FROM runtime_metadata WHERE key=?',`owner_alpha_background_status:${w.epoch}:2`)[0];
  requireThat(row&&createHash('sha256').update(row.value_json).digest('hex')===statusManifest.status_summary_sha256,
   'INVALID_CONFIGURATION','Background status summary bytes are missing or inconsistent.',503);
  let summary:BackgroundStatusSummary;
  try{summary=JSON.parse(row.value_json);}catch{throw new ControlError('INVALID_CONFIGURATION','Background status summary is unreadable.',503);}
  requireThat(statusSummaryShape(summary)&&summary.generation.epoch===w.epoch&&summary.generation.generation_sha256===a.generation_sha256&&
   summary.computed_at===statusManifest.issued_at&&summary.admissions[0].run_id===first.run_id&&
   summary.admissions[0].manifest_sha256===first.manifest_sha256&&summary.admissions[0].deadline_at===first.expires_at,
   'INVALID_CONFIGURATION','Background status summary is inconsistent with its frozen manifest.',503);
 }
 if(a.admissions.length===3){
  const m2=a.admissions.find(m=>m.role==='status')!;
  requireThat(backgroundRunSettled(store,m2,w.epoch,w.boot_id),'INVALID_CONFIGURATION','Background independent admission requires the settled status root.',503);
 }
 requireThat(backgroundLedgerUsed(db,c.prior_cost_micro_usd)<=c.total_cap_micro_usd,'INVALID_CONFIGURATION','Background lifetime ledger exceeds its cap.',503);
 const baseline=readRow<Record<string,unknown>>(db,'owner_alpha_cost_baseline');
 requireThat(baseline&&Object.keys(baseline).sort().join(',')==='installation_id,owner_binding_sha256,prior_cost_micro_usd,prior_cost_source,total_cap_micro_usd'&&
  baseline.installation_id===c.installation_id&&baseline.owner_binding_sha256===c.owner_binding_sha256&&
  baseline.prior_cost_micro_usd===c.prior_cost_micro_usd&&baseline.prior_cost_source===c.prior_cost_source&&
  baseline.total_cap_micro_usd===c.total_cap_micro_usd,'INVALID_CONFIGURATION','Background cost baseline is missing or inconsistent.',503);
 if(w.epoch===2){
  const custody=readRow<{policy:OwnerAlphaPolicy}>(db,'owner_alpha');
  requireThat(custody&&custody.policy&&uuid.test(custody.policy.session_id)&&custody.policy.session_id===w.predecessor.session_id,
   'INVALID_CONFIGURATION','Background generation predecessor custody is missing.',503);
  const retirement=readRow<OwnerAlphaRetirement>(db,'owner_alpha_retirement:1');
  requireThat(retirementShape(retirement)&&retirement.epoch===1&&retirement.boot_id===w.predecessor.boot_id&&
   retirement.session_id===custody.policy.session_id&&retirement.transition_id===null&&
   retirement.observed_at>=custody.policy.expires_at,'INVALID_CONFIGURATION','Background generation predecessor retirement is missing.',503);
 }else{
  const priorRow=readRow<OwnerAlphaGeneration>(db,`owner_alpha_generation:${w.epoch-1}`);
  requireThat(priorRow&&priorRow.epoch===w.epoch-1&&'kind' in priorRow.authority&&priorRow.authority.kind!=='owner-message-warm-generation'&&
   priorRow.authority.kind!=='owner-message-background-generation'&&priorRow.boot_id===w.predecessor.boot_id&&
   priorRow.policy.session_id===w.predecessor.session_id,
   'INVALID_CONFIGURATION','Background generation predecessor is missing.',503);
  const retirement=readRow<OwnerAlphaRetirement>(db,`owner_alpha_retirement:${w.epoch-1}`);
  requireThat(retirementShape(retirement)&&retirement.epoch===priorRow.epoch&&retirement.boot_id===priorRow.boot_id&&
   retirement.session_id===priorRow.policy.session_id&&retirement.transition_id===priorRow.transition_id&&
   retirement.observed_at>=priorRow.policy.expires_at,'INVALID_CONFIGURATION','Background generation predecessor retirement is missing.',503);
 }
 // Background generation custody is exclusive with warm custody and terminal:
 // nothing may ever follow it in any chain.
 requireThat(!db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_warm_generation:*' LIMIT 1").length,
  'INVALID_CONFIGURATION','Background generation excludes warm custody.',503);
 requireThat(!db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_generation:*' AND CAST(substr(key,24) AS INTEGER)>?",w.epoch).length,
  'INVALID_CONFIGURATION','Nothing may follow a background generation.',503);
}

/** Trusted host configuration and observations, never message-supplied authority. */
export class OwnerAlphaBackground {
 private core:ControlCore;
 constructor(core:ControlCore){
  this.core=core;
  const c=core.options.ownerAlphaBackground;
  if(!c)return;
  // A fresh Durable Object constructs the core before installing its schema.
  // Existing custody must still validate even after configuration is removed.
  if(!core.store.db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='runtime_metadata'").length)return;
  const persisted=persistedBackgroundConfigRow(core.store.db);
  if(persisted){
   const {seed_retirement:_,...expected}=c;
   requireThat(JSON.stringify(persisted.config)===JSON.stringify(expected),'INVALID_CONFIGURATION','Background generation policy revision is immutable.',503);
  }
  if(core.store.db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_background_generation:*' LIMIT 1").length)core.ownerAlpha.activeGeneration();
 }
 private get config():BackgroundGenerationConfig|undefined{return this.core.options.ownerAlphaBackground;}
 retained():boolean{
  return this.core.store.db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_background_generation:*' LIMIT 1").length>0;
 }
 /** Validation-only: proves a further background admission would be admissible
  * right now. Never assigns anything or writes custody. */
 assertMessageAdmission():void{
  const c=this.config;
  requireThat(!!c,'CAPABILITY_UNAVAILABLE','Background generation admission is not configured.');
  const db=this.core.store.db,lifecycle=new LifecycleCore(this.core.store,this.core),state=lifecycle.get(),now=this.core.now();
  const rows=db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_background_generation:*'");
  requireThat(rows.length<=1,'INVALID_CONFIGURATION','Background generation history is inconsistent.',503);
  const prior=this.core.ownerAlpha.policy;
  if(!rows.length){
   requireThat(!this.core.options.ownerAlphaWarm&&!db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_warm_generation:*' LIMIT 1").length,
    'CAPABILITY_UNAVAILABLE','Background generation excludes warm custody.');
   requireThat(prior&&prior.expires_at<=now&&state.epoch>=1&&state.boot_id&&state.phase==='RECOVERY_REQUIRED'&&state.provider_ref_json==='{}'&&
    state.provider_operation_id===null&&state.lease_until!==null&&state.lease_until<=now,'CAPABILITY_UNAVAILABLE','Predecessor is not expired and retired.');
   requireThat(!this.core.store.get<{archived:boolean}>(c.persona_id,'persona').body.archived,'CAPABILITY_UNAVAILABLE','This bot is archived.');
   if(state.epoch===1){
    requireThat(!this.core.ownerAlpha.activeGeneration(),'CAPABILITY_UNAVAILABLE','Initial hosted predecessor must have no generation history.');
    requireThat(c.seed_retirement&&retirementShape(c.seed_retirement)&&c.seed_retirement.epoch===1&&c.seed_retirement.boot_id===state.boot_id&&
     c.seed_retirement.session_id===prior.session_id&&c.seed_retirement.transition_id===null&&
     c.seed_retirement.observed_at>=prior.expires_at&&c.seed_retirement.observed_at<=now,'CAPABILITY_UNAVAILABLE','Trusted seed retirement is missing.');
   }else{
    const predecessor=this.core.ownerAlpha.activeGeneration();
    requireThat(predecessor&&'kind' in predecessor.authority&&predecessor.authority.kind!=='owner-message-warm-generation'&&
     predecessor.authority.kind!=='owner-message-background-generation'&&predecessor.epoch===state.epoch&&
     predecessor.boot_id===state.boot_id&&predecessor.policy.expires_at<=now,
     'CAPABILITY_UNAVAILABLE','Background entry requires its exact retired legacy predecessor.');
    const retirement=readRow<OwnerAlphaRetirement>(db,`owner_alpha_retirement:${state.epoch}`);
    requireThat(retirement&&retirementShape(retirement)&&retirement.epoch===state.epoch&&retirement.boot_id===state.boot_id&&
     retirement.session_id===predecessor.policy.session_id&&retirement.transition_id===predecessor.transition_id&&
     retirement.observed_at>=predecessor.policy.expires_at&&retirement.observed_at<=now,
     'CAPABILITY_UNAVAILABLE','Trusted predecessor retirement is missing.');
   }
   lifecycle.assertOwnerAlphaSettlement(true);
   const baseline={installation_id:c.installation_id,owner_binding_sha256:c.owner_binding_sha256,prior_cost_micro_usd:c.prior_cost_micro_usd,
    prior_cost_source:c.prior_cost_source,total_cap_micro_usd:c.total_cap_micro_usd};
   const saved=readRow<typeof baseline>(db,'owner_alpha_cost_baseline');
   requireThat(!saved||JSON.stringify(saved)===JSON.stringify(baseline),'CAPABILITY_UNAVAILABLE','Cost baseline differs from the lifetime ledger.');
   const used=backgroundLedgerUsed(db,c.prior_cost_micro_usd);
   requireThat(Number.isSafeInteger(used+c.reservation_micro_usd)&&used+c.reservation_micro_usd<=c.total_cap_micro_usd,'BUDGET_EXCEEDED','Lifetime allowance is exhausted.',402);
   const persisted=persistedBackgroundConfigRow(db);
   if(persisted){
    const {seed_retirement:_,...expected}=c;
    requireThat(JSON.stringify(persisted.config)===JSON.stringify(expected),'CAPABILITY_UNAVAILABLE','Background generation policy revision is immutable.');
   }
   const expiresAt=new Date(Math.min(Date.parse(c.expires_at),Date.parse(now)+300000)).toISOString();
   requireThat(Date.parse(expiresAt)-Date.parse(now)>=1000,'CAPABILITY_UNAVAILABLE','Less than one second remains in the fixed background generation.');
   const deadline=new Date(Math.min(Date.parse(expiresAt),Date.parse(now)+c.max_task_seconds*1000)).toISOString();
   requireThat(Date.parse(deadline)-Date.parse(now)>=1000,'CAPABILITY_UNAVAILABLE','Less than one second remains for the background task.');
  }else{
   const generation=this.core.ownerAlpha.activeGeneration() as BackgroundGenerationView;
   requireThat('kind' in generation.authority&&generation.authority.kind==='owner-message-background-generation'&&
    generation.epoch===state.epoch&&generation.boot_id===state.boot_id,
    'CAPABILITY_UNAVAILABLE','Background generation is not the active lifecycle generation.');
   requireThat(generation.authority.admissions.length>=1&&generation.authority.admissions.length<=2,
    'CAPABILITY_UNAVAILABLE','Background generation has admitted its bounded messages.');
   requireThat(this.config,'CAPABILITY_UNAVAILABLE','Background generation policy configuration was removed.');
   requireThat(state.phase==='READY'&&Date.parse(generation.policy.expires_at)>Date.parse(now),
    'CAPABILITY_UNAVAILABLE','Background generation is not live for another message.');
   requireThat(state.lease_until!==null&&Date.parse(state.lease_until)>Date.parse(now),'CAPABILITY_UNAVAILABLE','Background generation lease has expired.');
   requireThat(!db.all("SELECT id FROM controller_operations WHERE status IN ('pending','submitted','unknown') LIMIT 1").length,
    'CAPABILITY_UNAVAILABLE','Controller activity blocks background admission.');
   const persisted=persistedBackgroundConfigRow(db);
   const {seed_retirement:_,...expected}=c;
   requireThat(persisted&&JSON.stringify(persisted.config)===JSON.stringify(expected),
    'CAPABILITY_UNAVAILABLE','Background generation policy revision is immutable.');
   const used=backgroundLedgerUsed(db,c.prior_cost_micro_usd);
   requireThat(Number.isSafeInteger(used+c.reservation_micro_usd)&&used+c.reservation_micro_usd<=c.total_cap_micro_usd,
    'BUDGET_EXCEEDED','Lifetime allowance is exhausted.',402);
   const deadline=new Date(Math.min(Date.parse(generation.policy.expires_at),Date.parse(now)+c.max_task_seconds*1000)).toISOString();
   requireThat(Date.parse(deadline)-Date.parse(now)>=1000,'CAPABILITY_UNAVAILABLE','Less than one second remains for the background task.');
   if(generation.authority.admissions.length===1){
    const m1=generation.authority.admissions[0];
    requireThat(backgroundCoordinatorReleased(db,m1),'RESOURCE_BUSY','Background admission requires the first root\'s coordinator release.',409);
   }else{
    const m2=generation.authority.admissions.find(m=>m.role==='status')!;
    requireThat(backgroundRunSettled(this.core.store,m2,generation.epoch,generation.boot_id),
     'CAPABILITY_UNAVAILABLE','Background admission requires canonical completion of the status root.');
   }
  }
 }
 /** Candidate gate plus full admission validation for an incoming message.send.
  * Silently ignores non-candidates so unrelated conversations keep legacy behavior. */
 assertMessageAdmissible(owner:string,commandId:string,conversationId:string):void{
  const c=this.config;
  if(!c){
   // Retained custody without configuration denies candidate messages; persisted
   // history supports denial and retirement, never replacement authority.
   if(this.retained()){
    const generation=this.core.ownerAlpha.activeGeneration() as BackgroundGenerationView;
    requireThat(conversationId!==generation.policy.persona_id,'CAPABILITY_UNAVAILABLE','Background generation admission is not configured.');
   }
   return;
  }
  if(conversationId!==c.persona_id||owner!==c.owner_id)return;
  requireThat(this.core.ownerAlpha.directMessage(c.persona_id,commandId,null,null,null,0,c.persona_id),
   'CAPABILITY_UNAVAILABLE','Background generation admission requires a direct owner message.');
  this.assertMessageAdmission();
 }
 /** Candidate gate without writes, for enqueue's admission computation. */
 messageAdmitted(persona:string,commandId:string|null,routine:string|null,occurrence:string|null,room:string|null):boolean{
  const c=this.config;
  if(!c||routine||occurrence||room||persona!==c.persona_id)return false;
  if(!this.core.ownerAlpha.directMessage(persona,commandId,null,null,null,0,c.persona_id))return false;
  try{this.assertMessageAdmission();return true;}catch{return false;}
 }
 summary():BackgroundSummary|undefined{
  const envConfig=this.config;
  const persisted=persistedBackgroundConfigRow(this.core.store.db);
  if(!envConfig&&!persisted)return undefined;
  const c=envConfig??{...persisted!.config};
  const generation=this.core.ownerAlpha.activeGeneration();
  const background=generation&&'kind' in generation.authority&&generation.authority.kind==='owner-message-background-generation'?generation as BackgroundGenerationView:undefined;
  let available=false;
  if(envConfig&&!this.core.options.testCampaignGrant){
   try{this.assertMessageAdmission();available=true;}catch{/* Unavailable admission is reported, never repaired. */}finally{}
  }
  const nextRole=available?BACKGROUND_ROLES[background?.authority.admissions.length??0]??null:null;
  return {schema_version:1,kind:'owner-alpha-background-summary-v1',policy_revision:c.policy_revision,persona_id:c.persona_id,policy_expires_at:c.expires_at,
   max_admissions:3,admissions_used:background?background.authority.admissions.length:0,message_admission_available:available,
   next_role:available?nextRole:null,
   generation:background?{session_id:background.policy.session_id,expires_at:background.policy.expires_at,epoch:background.epoch}:null};
 }
 /** Manager-only retirement observation. Valid after generation expiry; settles
  * nothing and admits no successor by itself. */
 recordRetirement(report:OwnerAlphaRetirement):void{
  requireThat(retirementShape(report),'INVALID_INPUT','Invalid trusted retirement observation.',422);
  this.core.store.db.transaction(()=>{
   const state=new LifecycleCore(this.core.store,this.core).get(),generation=this.core.ownerAlpha.activeGeneration() as BackgroundGenerationView|undefined;
   requireThat(generation&&'kind' in generation.authority&&generation.authority.kind==='owner-message-background-generation'&&
    report.epoch===state.epoch&&report.boot_id===state.boot_id&&report.session_id===generation.policy.session_id&&
    report.transition_id===generation.transition_id&&
    report.observed_at<=this.core.now()&&report.observed_at>=generation.policy.expires_at,
    'INVALID_INPUT','Retirement must identify the expired background generation and trusted stop/lock observations.',422);
   const key=`owner_alpha_retirement:${report.epoch}`,saved=readRow<OwnerAlphaRetirement>(this.core.store.db,key);
   requireThat(!saved||JSON.stringify(saved)===JSON.stringify(report),'REVISION_CONFLICT','Retirement observation is immutable.',422);
   if(!saved)putRow(this.core.store.db,key,report);
  });
 }
 /** Read the frozen status-summary bytes and verify the digest and exact shape
  * against the status manifest. Never recomputes anything from live state. */
 statusSummary(epoch:number):BackgroundStatusSummary{
  const generation=this.core.ownerAlpha.activeGeneration();
  requireThat(generation&&'kind' in generation.authority&&generation.authority.kind==='owner-message-background-generation'&&generation.epoch===epoch,
   'STALE_EPOCH','Background generation is not active.',409);
  const view=generation as BackgroundGenerationView;
  const m2=view.authority.admissions.find(m=>m.role==='status');
  requireThat(m2&&typeof m2.status_summary_sha256==='string','CAPABILITY_UNAVAILABLE','Background status summary is not available.',409);
  const row=this.core.store.db.all<{value_json:string}>('SELECT value_json FROM runtime_metadata WHERE key=?',`owner_alpha_background_status:${epoch}:2`)[0];
  requireThat(row&&createHash('sha256').update(row.value_json).digest('hex')===m2.status_summary_sha256,
   'INVALID_CONFIGURATION','Background status summary bytes are missing or inconsistent.',503);
  let summary:BackgroundStatusSummary;
  try{summary=JSON.parse(row.value_json);}catch{throw new ControlError('INVALID_CONFIGURATION','Background status summary is unreadable.',503);}
  requireThat(statusSummaryShape(summary)&&summary.generation.epoch===epoch&&
   summary.generation.generation_sha256===view.authority.generation_sha256&&summary.computed_at===m2.issued_at,
   'INVALID_CONFIGURATION','Background status summary is inconsistent with its frozen manifest.',503);
  return summary;
 }
 /** Computed exactly once at admission 2, from durable rows only. */
 private computeStatusSummary(m1:BackgroundManifest,epoch:number,generationSha256:string,now:string):BackgroundStatusSummary{
  const db=this.core.store.db;
  const row=db.all<{run_status:string;attempt_status:string|null;coordinator_release_json:string|null;child_count:number}>(
   `SELECT r.status AS run_status,a.status AS attempt_status,a.coordinator_release_json,
    (SELECT COUNT(*) FROM native_task_links n WHERE n.parent_run_id=r.id AND n.parent_attempt=1) AS child_count
    FROM runs r LEFT JOIN attempts a ON a.run_id=r.id AND a.attempt=1 WHERE r.id=?`,m1.run_id)[0];
  requireThat(row,'INVALID_CONFIGURATION','Background admitted run is missing.',503);
  return {schema_version:1,kind:'owner-alpha-background-status-summary-v1',
   generation:{epoch,generation_sha256:generationSha256},
   admissions:[{admission:1,role:'background',run_id:m1.run_id,run_status:row.run_status,attempt_status:row.attempt_status,
    coordinator_released:row.coordinator_release_json!==null,deadline_at:m1.expires_at,child_count:row.child_count,manifest_sha256:m1.manifest_sha256}],
   computed_at:now};
 }
 /** Only invoked within accept's transaction. The message precheck has already
  * proven admissibility; this appends the immutable admission atomically. */
 assignNewMessage(owner:string,commandId:string,runId:string):void{
  const c=this.config;
  if(!c||owner!==c.owner_id)return;
  const db=this.core.store.db,now=this.core.now();
  const run=db.all<Pick<Run,'persona_id'|'current_attempt'|'command_id'|'role'|'parent_run_id'|'routine_id'|'occurrence_id'>>('SELECT persona_id,current_attempt,command_id,role,parent_run_id,routine_id,occurrence_id FROM runs WHERE id=?',runId)[0];
  if(!run)throw new ControlError('NOT_FOUND','Run unavailable.',404);
  if(run.persona_id!==c.persona_id||run.current_attempt!==0||run.command_id!==commandId||run.role!=='coordinator'||run.parent_run_id||run.routine_id||run.occurrence_id||!this.core.store.runHasFalsyRoom(runId))return;
  const command=db.all<{body_hash:string;type:string;status:string;accepted_at:string;owner_id:string}>('SELECT * FROM commands WHERE id=?',commandId)[0];
  const event=db.all<{sequence:number}>("SELECT sequence FROM events WHERE id=? AND type='message.user' AND actor_id=? AND conversation_id=?",commandId,owner,c.persona_id)[0];
  requireThat(command&&command.type==='message.send'&&command.status==='accepted'&&command.accepted_at<=now&&command.owner_id===owner&&hex64.test(command.body_hash)&&
   event&&this.core.ownerAlpha.directMessage(c.persona_id,commandId,null,null,null,0,c.persona_id),
   'CAPABILITY_UNAVAILABLE','Background admission requires its exact owner message.');
  db.transaction(()=>{
   const state=new LifecycleCore(this.core.store,this.core).get();
   const rows=db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_background_generation:*'");
   requireThat(rows.length<=1,'INVALID_CONFIGURATION','Background generation history is inconsistent.',503);
   if(!rows.length){
    const prior=this.core.ownerAlpha.policy;
    requireThat(prior&&state.epoch>=1&&state.boot_id&&prior.expires_at<=now&&state.phase==='RECOVERY_REQUIRED'&&state.lease_until!==null&&state.lease_until<=now,
     'CAPABILITY_UNAVAILABLE','Background entry requires its exact retired predecessor.');
    const epoch=state.epoch+1,boot_id=this.core.options.uuid(),transition_id=this.core.options.uuid(),session_id=this.core.options.uuid();
    requireThat(!db.all("SELECT run_id FROM attempts WHERE boot_id=? LIMIT 1",boot_id).length,'INVALID_CONFIGURATION','Background boot identity is not fresh.',503);
    const persisted=persistedBackgroundConfigRow(db);
    const {seed_retirement:_,...policy}=c;
    if(persisted)requireThat(JSON.stringify(persisted.config)===JSON.stringify(policy),'CAPABILITY_UNAVAILABLE','Background generation policy revision is immutable.');
    const expiresAt=new Date(Math.min(Date.parse(c.expires_at),Date.parse(now)+300000)).toISOString();
    const deadline=new Date(Math.min(Date.parse(expiresAt),Date.parse(now)+c.max_task_seconds*1000)).toISOString();
    const authority:BackgroundMessageBoundAuthority={kind:'owner-message-background-generation',config_sha256:backgroundConfigSha256(policy),generation_sha256:'',admissions:[]};
    const generation:BackgroundGenerationView={epoch,boot_id,transition_id,
     policy:{session_id,persona_id:c.persona_id,expires_at:expiresAt,max_runs:3,max_task_seconds:c.max_task_seconds,background:{...c.background}},
     predecessor:{epoch:state.epoch,boot_id:state.boot_id!,session_id:prior.session_id,phase:state.phase,lease_until:state.lease_until},
     authority,activation_command_id:commandId,activation_command_sha256:command.body_hash,activation_event_sequence:event.sequence};
    authority.generation_sha256=backgroundGenerationSha256(generation);
    const unsigned={schema_version:1 as const,kind:'owner-alpha-background-manifest-v1' as const,admission:1 as const,role:'background' as const,
     installation_id:c.installation_id,owner_binding_sha256:c.owner_binding_sha256,run_id:runId,persona_id:c.persona_id,
     command_id:commandId,command_sha256:command.body_hash,event_sequence:event.sequence,policy_revision:c.policy_revision,
     epoch,boot_id,transition_id,session_id,background:{...c.background},
     issued_at:now,expires_at:deadline,reservation_micro_usd:c.reservation_micro_usd,generation_sha256:authority.generation_sha256};
    const manifest:BackgroundManifest={...unsigned,manifest_sha256:backgroundManifestSha256(unsigned)};
    if(state.epoch===1){
     requireThat(c.seed_retirement&&!readRow(db,'owner_alpha_retirement:1'),'CAPABILITY_UNAVAILABLE','Background seed retirement is already recorded.');
     putRow(db,'owner_alpha_retirement:1',c.seed_retirement);
    }else{
     const predecessor=this.core.ownerAlpha.activeGeneration()!;
     const retirement=readRow<OwnerAlphaRetirement>(db,`owner_alpha_retirement:${state.epoch}`);
     requireThat(retirement&&retirementShape(retirement)&&retirement.epoch===state.epoch&&retirement.boot_id===state.boot_id&&
      retirement.session_id===predecessor.policy.session_id&&retirement.transition_id===predecessor.transition_id,
      'CAPABILITY_UNAVAILABLE','Trusted predecessor retirement is missing.');
    }
    if(!persisted)putRow(db,`owner_alpha_background_config:${c.policy_revision}`,policy);
    if(!readRow(db,'owner_alpha_cost_baseline'))putRow(db,'owner_alpha_cost_baseline',
     {installation_id:c.installation_id,owner_binding_sha256:c.owner_binding_sha256,prior_cost_micro_usd:c.prior_cost_micro_usd,
      prior_cost_source:c.prior_cost_source,total_cap_micro_usd:c.total_cap_micro_usd});
    // The generation descriptor row is write-once and never carries the
    // admissions; each manifest row is appended separately and never rewritten.
    const key=`owner_alpha_background_generation:${epoch}`;
    const priorRow=db.all<{value_json:string}>('SELECT value_json FROM runtime_metadata WHERE key=?',key)[0];
    const generationJson=JSON.stringify(generation);
    requireThat(!priorRow||priorRow.value_json===generationJson,'INVALID_CONFIGURATION','Background generation descriptor is immutable.',503);
    if(!priorRow)db.exec('INSERT INTO runtime_metadata(key,value_json) VALUES(?,?)',key,generationJson);
    putRow(db,`owner_alpha_background_manifest:${epoch}:1`,manifest);
    putRow(db,`owner_alpha_reservation:${epoch}:1`,{manifest_sha256:manifest.manifest_sha256,micro_usd:c.reservation_micro_usd});
    db.exec("UPDATE lifecycle SET epoch=?,boot_id=?,phase='BOOTING',desired_state='RUN',lease_until=?,last_heartbeat=NULL,stop_token=NULL,wake_after_stop=0 WHERE singleton=1",
     epoch,boot_id,new Date(Math.min(Date.parse(expiresAt),Date.parse(now)+90000)).toISOString());
   }else{
    const generation=this.core.ownerAlpha.activeGeneration() as BackgroundGenerationView;
    requireThat('kind' in generation.authority&&generation.authority.kind==='owner-message-background-generation'&&
     (generation.authority.admissions.length===1||generation.authority.admissions.length===2)&&
     generation.epoch===state.epoch&&generation.boot_id===state.boot_id&&state.phase==='READY',
     'CAPABILITY_UNAVAILABLE','Background generation cannot admit another message.');
    requireThat(state.lease_until!==null&&Date.parse(state.lease_until)>Date.parse(now),'CAPABILITY_UNAVAILABLE','Background generation lease has expired.');
    const persisted=persistedBackgroundConfigRow(db);
    const {seed_retirement:_,...expected}=c;
    requireThat(persisted&&JSON.stringify(persisted.config)===JSON.stringify(expected),
     'CAPABILITY_UNAVAILABLE','Background generation policy revision is immutable.');
    const deadline=new Date(Math.min(Date.parse(generation.policy.expires_at),Date.parse(now)+c.max_task_seconds*1000)).toISOString();
    const unsigned={schema_version:1 as const,kind:'owner-alpha-background-manifest-v1' as const,
     installation_id:c.installation_id,owner_binding_sha256:c.owner_binding_sha256,run_id:runId,persona_id:c.persona_id,
     command_id:commandId,command_sha256:command.body_hash,event_sequence:event.sequence,policy_revision:c.policy_revision,
     epoch:generation.epoch,boot_id:generation.boot_id,transition_id:generation.transition_id,session_id:generation.policy.session_id,
     background:{...c.background},issued_at:now,expires_at:deadline,reservation_micro_usd:c.reservation_micro_usd,
     generation_sha256:generation.authority.generation_sha256};
    if(generation.authority.admissions.length===1){
     const m1=generation.authority.admissions[0];
     requireThat(backgroundCoordinatorReleased(db,m1),'RESOURCE_BUSY','Background admission requires the first root\'s coordinator release.',409);
     requireThat(!db.all("SELECT id FROM controller_operations WHERE status IN ('pending','submitted','unknown') LIMIT 1").length,
      'CAPABILITY_UNAVAILABLE','Controller activity blocks background admission.');
     const summary=this.computeStatusSummary(m1,generation.epoch,generation.authority.generation_sha256,now);
     const summaryJson=JSON.stringify(summary);
     requireThat(!readRow(db,`owner_alpha_background_status:${generation.epoch}:2`),'REVISION_CONFLICT','Background status summary is immutable.',409);
     const statusUnsigned={...unsigned,admission:2 as const,role:'status' as const,
      status_summary_sha256:createHash('sha256').update(summaryJson).digest('hex')};
     const manifest:BackgroundManifest={...statusUnsigned,manifest_sha256:backgroundManifestSha256(statusUnsigned)};
     // The status summary is frozen exactly once with the manifest that commits
     // it; its bytes are never recomputed on claim or reconstruction.
     putRow(db,`owner_alpha_background_status:${generation.epoch}:2`,summary);
     putRow(db,`owner_alpha_background_manifest:${generation.epoch}:2`,manifest);
     putRow(db,`owner_alpha_reservation:${generation.epoch}:2`,{manifest_sha256:manifest.manifest_sha256,micro_usd:c.reservation_micro_usd});
    }else{
     const m2=generation.authority.admissions.find(m=>m.role==='status')!;
     requireThat(backgroundRunSettled(this.core.store,m2,generation.epoch,generation.boot_id),
      'CAPABILITY_UNAVAILABLE','Background admission requires canonical completion of the status root.');
     requireThat(!db.all("SELECT id FROM controller_operations WHERE status IN ('pending','submitted','unknown') LIMIT 1").length,
      'CAPABILITY_UNAVAILABLE','Controller activity blocks background admission.');
     const independentUnsigned={...unsigned,admission:3 as const,role:'independent' as const};
     const manifest:BackgroundManifest={...independentUnsigned,manifest_sha256:backgroundManifestSha256(independentUnsigned)};
     // Only the manifest and reservation rows are appended; the write-once
     // generation descriptor row keeps its exact historical bytes and no new
     // generation is ever created.
     putRow(db,`owner_alpha_background_manifest:${generation.epoch}:3`,manifest);
     putRow(db,`owner_alpha_reservation:${generation.epoch}:3`,{manifest_sha256:manifest.manifest_sha256,micro_usd:c.reservation_micro_usd});
    }
   }
  });
 }
}
