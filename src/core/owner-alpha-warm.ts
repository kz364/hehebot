import {createHash} from 'node:crypto';
import {ControlError,requireThat} from './errors';
import {Store} from './store';
import {LifecycleCore} from './lifecycle';
import type {ControlCore} from './control';
import type {OwnerAlphaGeneration,OwnerAlphaPolicy,TextOnlyProfile} from './owner-alpha';
import type {OwnerAlphaRetirement} from './owner-alpha-bootstrap';
import type {Run} from './types';

/** Stage A warm-generation contract. A default-off, versioned, finite text-only
 * executor generation that admits exactly two successive direct owner messages
 * within one boot/epoch. Message-bound like the bootstrap generations, but with
 * a separate versioned manifest digest and per-admission reservations under the
 * existing lifetime ledger prefix. Nothing here upgrades or reinterprets legacy
 * bootstrap configuration; the old rows keep their exact meaning. */
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hex64=/^[0-9a-f]{64}$/;
const utc=(value:unknown):boolean=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const digest=(values:unknown[]):string=>createHash('sha256').update(JSON.stringify(values)).digest('hex');

export type WarmGenerationConfig={
 schema_version:1;kind:'owner-alpha-warm-generation-v1';
 installation_id:string;owner_id:string;owner_binding_sha256:string;policy_revision:string;persona_id:string;
 text_only:TextOnlyProfile;expires_at:string;max_task_seconds:number;max_admissions:2;
 prior_cost_micro_usd:number;prior_cost_source:string;total_cap_micro_usd:number;reservation_micro_usd:number;
 seed_retirement?:OwnerAlphaRetirement;
};
export type WarmPersistedConfig=Omit<WarmGenerationConfig,'seed_retirement'>;
export type WarmManifest={
 schema_version:1;kind:'owner-alpha-warm-manifest-v1';admission:1|2;
 installation_id:string;owner_binding_sha256:string;run_id:string;persona_id:string;
 command_id:string;command_sha256:string;event_sequence:number;policy_revision:string;
 epoch:number;boot_id:string;transition_id:string;session_id:string;text_only:TextOnlyProfile;
 issued_at:string;expires_at:string;reservation_micro_usd:number;generation_sha256:string;manifest_sha256:string;
};
export type WarmMessageBoundAuthority={kind:'owner-message-warm-generation';config_sha256:string;generation_sha256:string;admissions:WarmManifest[]};
export type WarmGenerationView=OwnerAlphaGeneration&{authority:WarmMessageBoundAuthority};
export type WarmSummary={
 schema_version:1;kind:'owner-alpha-warm-summary-v1';policy_revision:string;persona_id:string;policy_expires_at:string;
 max_admissions:2;admissions_used:number;message_admission_available:boolean;
 generation:{session_id:string;expires_at:string;epoch:number}|null;
};
const WARM_CONFIG_KEYS=['expires_at','installation_id','kind','max_admissions','max_task_seconds','owner_binding_sha256','owner_id','persona_id','policy_revision','prior_cost_micro_usd','prior_cost_source','reservation_micro_usd','schema_version','text_only','total_cap_micro_usd'];
const WARM_MANIFEST_KEYS=['admission','boot_id','command_id','command_sha256','epoch','event_sequence','expires_at','generation_sha256','installation_id','issued_at','kind','manifest_sha256','owner_binding_sha256','persona_id','policy_revision','reservation_micro_usd','run_id','schema_version','session_id','text_only','transition_id'];

function textOnlyValid(value:unknown):value is TextOnlyProfile{
 const text=value as TextOnlyProfile|undefined;
 return !!text&&typeof text==='object'&&!Array.isArray(text)&&Object.keys(text).sort().join(',')==='profile_sha256,profile_version'&&
  text.profile_version==='codex-text-only-v1'&&typeof text.profile_sha256==='string'&&hex64.test(text.profile_sha256);
}
const textOnlyEqual=(a:TextOnlyProfile,b:TextOnlyProfile):boolean=>a.profile_version===b.profile_version&&a.profile_sha256===b.profile_sha256;
function retirementShape(r:unknown):r is OwnerAlphaRetirement{
 const v=r as OwnerAlphaRetirement|undefined;


 return !!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')==='boot_id,direct_child_stopped,epoch,execution_lock_free,observed_at,session_id,session_lock_free,source,transition_id'&&
  Number.isSafeInteger(v.epoch)&&v.epoch>=1&&typeof v.boot_id==='string'&&uuid.test(v.boot_id)&&typeof v.session_id==='string'&&uuid.test(v.session_id)&&
  (v.transition_id===null||typeof v.transition_id==='string'&&uuid.test(v.transition_id))&&
  v.direct_child_stopped===true&&v.execution_lock_free===true&&v.session_lock_free===true&&
  typeof v.observed_at==='string'&&utc(v.observed_at)&&typeof v.source==='string'&&v.source.length>0&&v.source.length<=256;
}

/** Parse the explicit opt-in env configuration. Fail closed on any unknown or
 * missing shape; this never widens legacy bootstrap token semantics. */
export function parseOwnerAlphaWarm(value:string|undefined):WarmGenerationConfig|undefined{
 if(value===undefined||value==='')return undefined;
 let c:WarmGenerationConfig;
 try{c=JSON.parse(value);}catch{requireThat(false,'INVALID_CONFIGURATION','Invalid warm owner-alpha generation JSON.',503);}
 const keys=[...WARM_CONFIG_KEYS,...(Object.hasOwn(c??{},'seed_retirement')?['seed_retirement']:[])];
 requireThat(c&&typeof c==='object'&&!Array.isArray(c)&&Object.keys(c).sort().join(',')===keys.sort().join(',')&&
  c.schema_version===1&&c.kind==='owner-alpha-warm-generation-v1'&&c.max_admissions===2&&
  [c.installation_id,c.owner_id,c.policy_revision,c.prior_cost_source].every(v=>typeof v==='string'&&v.length>0&&v.length<=256)&&!/^(runtime|trigger):/.test(c.owner_id)&&
  typeof c.owner_binding_sha256==='string'&&hex64.test(c.owner_binding_sha256)&&
  typeof c.persona_id==='string'&&uuid.test(c.persona_id)&&textOnlyValid(c.text_only)&&
  typeof c.expires_at==='string'&&utc(c.expires_at)&&
  Number.isSafeInteger(c.max_task_seconds)&&c.max_task_seconds>=1&&c.max_task_seconds<=300&&
  [c.prior_cost_micro_usd,c.total_cap_micro_usd,c.reservation_micro_usd].every(n=>Number.isSafeInteger(n)&&n>=0)&&c.reservation_micro_usd>0,
  'INVALID_CONFIGURATION','Invalid warm owner-alpha generation configuration.',503);
 if(Object.hasOwn(c,'seed_retirement'))requireThat(retirementShape(c.seed_retirement),'INVALID_CONFIGURATION','Invalid warm seed retirement.',503);
 return {schema_version:1,kind:'owner-alpha-warm-generation-v1',installation_id:c.installation_id,owner_id:c.owner_id,owner_binding_sha256:c.owner_binding_sha256,
  policy_revision:c.policy_revision,persona_id:c.persona_id,text_only:{profile_version:'codex-text-only-v1',profile_sha256:c.text_only.profile_sha256},
  expires_at:c.expires_at,max_task_seconds:c.max_task_seconds,max_admissions:2,
  prior_cost_micro_usd:c.prior_cost_micro_usd,prior_cost_source:c.prior_cost_source,total_cap_micro_usd:c.total_cap_micro_usd,reservation_micro_usd:c.reservation_micro_usd,
  ...(Object.hasOwn(c,'seed_retirement')?{seed_retirement:c.seed_retirement}:{})};
}
/** Canonical digest over the persisted policy record; the env configuration's
 * optional seed retirement is deliberately excluded because it is not persisted
 * policy — only its observation is recorded once. */
export function warmConfigSha256(config:WarmPersistedConfig):string{
 return digest([config.schema_version,config.kind,config.installation_id,config.owner_id,config.owner_binding_sha256,config.policy_revision,config.persona_id,
  config.text_only.profile_version,config.text_only.profile_sha256,config.expires_at,config.max_task_seconds,config.max_admissions,
  config.prior_cost_micro_usd,config.prior_cost_source,config.total_cap_micro_usd,config.reservation_micro_usd]);
}
/** Separate versioned manifest digest covering every admission binding plus the
 * frozen deadline and generation digest. Never reuse the legacy ownerAlphaManifestSha256. */
export function warmManifestSha256(m:Omit<WarmManifest,'manifest_sha256'>):string{
 return digest([m.schema_version,m.kind,m.admission,m.installation_id,m.owner_binding_sha256,m.run_id,m.persona_id,m.command_id,m.command_sha256,m.event_sequence,
  m.policy_revision,m.epoch,m.boot_id,m.transition_id,m.session_id,m.text_only.profile_version,m.text_only.profile_sha256,m.issued_at,m.expires_at,m.reservation_micro_usd,m.generation_sha256]);
}
/** Canonical digest of the immutable generation descriptor; admissions are
 * excluded so the digest survives the second admission without rewriting history. */
export function warmGenerationSha256(g:Omit<WarmGenerationView,'authority'>&{authority:Pick<WarmMessageBoundAuthority,'kind'|'config_sha256'>}):string{
 return digest([g.epoch,g.boot_id,g.transition_id,g.policy.session_id,g.policy.persona_id,g.policy.expires_at,g.policy.max_runs,g.policy.max_task_seconds,
  g.policy.text_only!.profile_version,g.policy.text_only!.profile_sha256,g.predecessor.epoch,g.predecessor.boot_id,g.predecessor.session_id,
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
export function persistedWarmConfigRow(db:Store['db']):{key:string;config:WarmPersistedConfig}|undefined{
 const rows=db.all<{key:string;value_json:string}>("SELECT key,value_json FROM runtime_metadata WHERE key GLOB 'owner_alpha_warm_config:*'");
 requireThat(rows.length<=1,'INVALID_CONFIGURATION','Warm generation policy history is inconsistent.',503);
 if(!rows.length)return undefined;
 let c:WarmPersistedConfig;
 try{c=JSON.parse(rows[0].value_json);}catch{throw new ControlError('INVALID_CONFIGURATION','Warm generation policy record is unreadable.',503);}
 requireThat(c&&typeof c==='object'&&!Array.isArray(c)&&Object.keys(c).sort().join(',')===WARM_CONFIG_KEYS.join(',')&&
  c.schema_version===1&&c.kind==='owner-alpha-warm-generation-v1'&&c.max_admissions===2&&
  [c.installation_id,c.owner_id,c.policy_revision,c.prior_cost_source].every(v=>typeof v==='string'&&v.length>0&&v.length<=256)&&!/^(runtime|trigger):/.test(c.owner_id)&&
  typeof c.owner_binding_sha256==='string'&&hex64.test(c.owner_binding_sha256)&&
  typeof c.persona_id==='string'&&uuid.test(c.persona_id)&&textOnlyValid(c.text_only)&&
  typeof c.expires_at==='string'&&utc(c.expires_at)&&
  Number.isSafeInteger(c.max_task_seconds)&&c.max_task_seconds>=1&&c.max_task_seconds<=300&&
  [c.prior_cost_micro_usd,c.total_cap_micro_usd,c.reservation_micro_usd].every(n=>Number.isSafeInteger(n)&&n>=0)&&c.reservation_micro_usd>0,
  'INVALID_CONFIGURATION','Warm generation policy record is invalid.',503);
 requireThat(rows[0].key===`owner_alpha_warm_config:${c.policy_revision}`,'INVALID_CONFIGURATION','Warm generation policy key is invalid.',503);
 return {key:rows[0].key,config:c};
}
/** Sum the existing lifetime ledger: the trusted prior cost plus every strict
 * reservation row under the legacy owner_alpha_reservation:* prefix, including
 * the warm per-admission suffixes. Fail closed on any corrupt entry. */
export function warmLedgerUsed(db:Store['db'],priorCostMicroUsd:number):number{
 requireThat(Number.isSafeInteger(priorCostMicroUsd)&&priorCostMicroUsd>=0,'INVALID_CONFIGURATION','Cost ledger is inconsistent.',503);
 const rows=db.all<{key:string;value_json:string}>("SELECT key,value_json FROM runtime_metadata WHERE key GLOB 'owner_alpha_reservation:*'");
 let used=priorCostMicroUsd;
 for(const row of rows){
  requireThat(/^owner_alpha_reservation:\d+(:[123])?$/.test(row.key),'INVALID_CONFIGURATION','Cost ledger key is invalid.',503);
  let entry:{manifest_sha256:string;micro_usd:number};
  try{entry=JSON.parse(row.value_json);}catch{throw new ControlError('INVALID_CONFIGURATION','Cost ledger entry is unreadable.',503);}
  requireThat(!!entry&&typeof entry==='object'&&!Array.isArray(entry)&&Object.keys(entry).sort().join(',')==='manifest_sha256,micro_usd'&&
   typeof entry.manifest_sha256==='string'&&hex64.test(entry.manifest_sha256)&&Number.isSafeInteger(entry.micro_usd)&&entry.micro_usd>0,
   'INVALID_CONFIGURATION','Cost ledger entry is invalid.',503);
  used+=entry.micro_usd;
  requireThat(Number.isSafeInteger(used),'INVALID_CONFIGURATION','Cost ledger is inconsistent.',503);
 }
 return used;
}
/** Exact settlement predicate for one admitted warm manifest: canonical
 * text-only completion with a matching stored receipt, settled coordinator
 * release, and no operations, effects, locks, questions, children or native
 * links. Mirrors the legacy settlement predicates for this run only. */
export function warmRunSettled(store:Store,m:WarmManifest,textOnly:TextOnlyProfile,epoch:number,bootId:string):boolean{
 const db=store.db;
 const rows=db.all<{run_status:string;attempt_status:string;result_json:string|null;native_run_ref:string|null;coordinator_release_json:string|null;proof:string|null;epoch:number;boot_id:string}>(
  `SELECT r.status AS run_status,a.status AS attempt_status,a.result_json,a.native_run_ref,a.coordinator_release_json,m.value_json AS proof,a.epoch,a.boot_id
   FROM attempts a JOIN runs r ON r.id=a.run_id LEFT JOIN runtime_metadata m ON m.key='text_only_receipt:'||a.run_id||':'||a.attempt
   WHERE a.run_id=? AND a.attempt=1`,m.run_id);
 const row=rows[0];
 if(rows.length!==1||!row||row.run_status!=='completed'||row.attempt_status!=='completed'||row.epoch!==epoch||row.boot_id!==bootId||!row.result_json||!row.proof)return false;
 let result:{status?:unknown},proof:{profile_version?:unknown;profile_sha256?:unknown;turn_id?:unknown;output_sha256?:unknown};
 try{result=JSON.parse(row.result_json);proof=JSON.parse(row.proof);}catch{return false;}
 if(result.status!=='completed'||proof.profile_version!==textOnly.profile_version||proof.profile_sha256!==textOnly.profile_sha256||proof.turn_id!==row.native_run_ref||
  typeof (result as {text?:unknown}).text!=='string'||proof.output_sha256!==createHash('sha256').update((result as {text:string}).text).digest('hex'))return false;
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
export function assertWarmRunSettled(store:Store,m:WarmManifest,textOnly:TextOnlyProfile,epoch:number,bootId:string):void{
 requireThat(warmRunSettled(store,m,textOnly,epoch,bootId),'CAPABILITY_UNAVAILABLE','Warm admission requires canonical completion of its admitted task.');
}

/** Reconstruct the admissions view from the append-only per-admission manifest
 * rows. The generation descriptor row itself is write-once and carries no
 * admissions; each admitted manifest lives in its own immutable
 * owner_alpha_warm_manifest:{epoch}:{admission} row. Fail closed on missing,
 * extra, unreadable or non-contiguous rows. */
export function warmAdmissionsView(store:Store,epoch:number):WarmManifest[]{
 requireThat(Number.isSafeInteger(epoch)&&epoch>=2,'INVALID_CONFIGURATION','Invalid warm generation epoch.',503);
 const rows=store.db.all<{key:string;value_json:string}>("SELECT key,value_json FROM runtime_metadata WHERE key GLOB 'owner_alpha_warm_manifest:*'");
 const manifests:WarmManifest[]=[];
 for(const row of rows){
  const match=/^owner_alpha_warm_manifest:(\d+):([12])$/.exec(row.key);
  requireThat(!!match&&Number(match![1])===epoch,'INVALID_CONFIGURATION','Warm manifest history is inconsistent.',503);
  let manifest:WarmManifest;
  try{manifest=JSON.parse(row.value_json) as WarmManifest;}catch{throw new ControlError('INVALID_CONFIGURATION','Warm manifest record is unreadable.',503);}
  requireThat(typeof manifest==='object'&&manifest!==null&&!Array.isArray(manifest)&&manifest.admission===Number(match![2]),'INVALID_CONFIGURATION','Warm manifest record is inconsistent.',503);
  manifests.push(manifest);
 }
 manifests.sort((a,b)=>a.admission-b.admission);
 requireThat(manifests.length>=1&&manifests.length<=2&&manifests.every((m,i)=>m.admission===i+1),'INVALID_CONFIGURATION','Warm manifest history is inconsistent.',503);
 return manifests;
}

/** Strict read-time validation of a persisted warm generation. Nothing is
 * repaired or rewritten; corrupt history stays unavailable. The admissions are
 * reconstructed from separate append-only manifest rows before this runs, so a
 * descriptor row that still carries admissions is itself invalid history. */
export function validateWarmGenerationView(store:Store,view:unknown):asserts view is WarmGenerationView{
 const db=store.db,g=view as Record<string,unknown>|undefined;
 requireThat(g&&typeof g==='object'&&!Array.isArray(g),'INVALID_CONFIGURATION','Invalid warm generation record.',503);
 requireThat(Object.keys(g).sort().join(',')==='activation_command_id,activation_command_sha256,activation_event_sequence,authority,boot_id,epoch,policy,predecessor,transition_id','INVALID_CONFIGURATION','Invalid warm generation record.',503);
 const w=view as unknown as WarmGenerationView;
 requireThat(Number.isSafeInteger(w.epoch)&&w.epoch>=2&&uuid.test(w.boot_id)&&uuid.test(w.transition_id)&&
  Number.isSafeInteger(w.activation_event_sequence)&&w.activation_event_sequence>=1&&uuid.test(w.activation_command_id)&&hex64.test(w.activation_command_sha256),
  'INVALID_CONFIGURATION','Invalid warm generation record.',503);
 requireThat(w.policy&&Object.keys(w.policy).sort().join(',')==='expires_at,max_runs,max_task_seconds,persona_id,session_id,text_only'&&
  uuid.test(w.policy.session_id)&&uuid.test(w.policy.persona_id)&&utc(w.policy.expires_at)&&w.policy.max_runs===2&&
  Number.isSafeInteger(w.policy.max_task_seconds)&&w.policy.max_task_seconds>=1&&w.policy.max_task_seconds<=300&&textOnlyValid(w.policy.text_only),
  'INVALID_CONFIGURATION','Invalid warm generation policy.',503);
 requireThat(w.predecessor&&Object.keys(w.predecessor).sort().join(',')==='boot_id,epoch,lease_until,phase,session_id'&&
  w.predecessor.epoch===w.epoch-1&&uuid.test(w.predecessor.boot_id)&&uuid.test(w.predecessor.session_id)&&
  w.predecessor.phase==='RECOVERY_REQUIRED'&&(w.predecessor.lease_until===null||utc(w.predecessor.lease_until)),
  'INVALID_CONFIGURATION','Invalid warm generation predecessor.',503);
 const a=w.authority;
 requireThat(a&&Object.keys(a).sort().join(',')==='admissions,config_sha256,generation_sha256,kind'&&a.kind==='owner-message-warm-generation'&&
  hex64.test(a.config_sha256)&&hex64.test(a.generation_sha256)&&Array.isArray(a.admissions)&&a.admissions.length>=1&&a.admissions.length<=2,
  'INVALID_CONFIGURATION','Invalid warm generation authority.',503);
 const persisted=persistedWarmConfigRow(db);
 requireThat(persisted,'INVALID_CONFIGURATION','Warm generation policy record is missing.',503);
 const c=persisted.config;
 requireThat(warmConfigSha256(c)===a.config_sha256,'INVALID_CONFIGURATION','Warm generation policy digest is inconsistent.',503);
 requireThat(c.persona_id===w.policy.persona_id&&c.max_task_seconds===w.policy.max_task_seconds&&textOnlyEqual(c.text_only,w.policy.text_only)&&
  Date.parse(c.expires_at)>=Date.parse(w.policy.expires_at),'INVALID_CONFIGURATION','Warm generation differs from its policy.',503);
 requireThat(warmGenerationSha256({...w,authority:{kind:a.kind,config_sha256:a.config_sha256}})===a.generation_sha256,'INVALID_CONFIGURATION','Warm generation digest is inconsistent.',503);
 const first=a.admissions[0];
 requireThat(utc(first.issued_at),'INVALID_CONFIGURATION','Invalid warm manifest record.',503);
 requireThat(w.policy.expires_at===new Date(Math.min(Date.parse(c.expires_at),Date.parse(first.issued_at)+300000)).toISOString(),'INVALID_CONFIGURATION','Warm generation expiry is not its frozen cap.',503);
 for(let i=0;i<a.admissions.length;i++){
  const m=a.admissions[i],admission=i+1;
  requireThat(m&&typeof m==='object'&&!Array.isArray(m)&&Object.keys(m).sort().join(',')===WARM_MANIFEST_KEYS.join(',')&&
   m.schema_version===1&&m.kind==='owner-alpha-warm-manifest-v1'&&m.admission===admission&&m.epoch===w.epoch&&m.boot_id===w.boot_id&&
   m.transition_id===w.transition_id&&m.session_id===w.policy.session_id&&uuid.test(m.run_id)&&m.persona_id===c.persona_id&&
   m.installation_id===c.installation_id&&m.owner_binding_sha256===c.owner_binding_sha256&&m.policy_revision===c.policy_revision&&
   textOnlyEqual(m.text_only,c.text_only)&&m.reservation_micro_usd===c.reservation_micro_usd&&m.generation_sha256===a.generation_sha256&&
   uuid.test(m.command_id)&&hex64.test(m.command_sha256)&&Number.isSafeInteger(m.event_sequence)&&m.event_sequence>=1&&
   utc(m.issued_at)&&utc(m.expires_at)&&Date.parse(m.expires_at)>Date.parse(m.issued_at),
   'INVALID_CONFIGURATION','Invalid warm manifest record.',503);
  requireThat(m.expires_at===new Date(Math.min(Date.parse(w.policy.expires_at),Date.parse(m.issued_at)+c.max_task_seconds*1000)).toISOString()&&
   Date.parse(m.expires_at)-Date.parse(m.issued_at)>=1000,'INVALID_CONFIGURATION','Warm manifest deadline is not its frozen cap.',503);
  const {manifest_sha256:_,...unsigned}=m;
  requireThat(warmManifestSha256(unsigned)===m.manifest_sha256,'INVALID_CONFIGURATION','Warm manifest digest is inconsistent.',503);
  if(admission===1)requireThat(m.command_id===w.activation_command_id&&m.command_sha256===w.activation_command_sha256&&m.event_sequence===w.activation_event_sequence,
   'INVALID_CONFIGURATION','Warm activation differs from its first manifest.',503);
  else requireThat(m.event_sequence>first.event_sequence&&m.run_id!==first.run_id&&m.command_id!==first.command_id,
   'INVALID_CONFIGURATION','Warm second admission must be a distinct message.',503);
  const command=db.all<{type:string;status:string;owner_id:string;resource_id:string|null;accepted_at:string;body_hash:string}>(
   'SELECT type,status,owner_id,resource_id,accepted_at,body_hash FROM commands WHERE id=?',m.command_id)[0];
  requireThat(command&&command.type==='message.send'&&command.status==='applied'&&command.owner_id===c.owner_id&&command.resource_id===m.run_id&&
   command.accepted_at<=m.issued_at&&command.body_hash===m.command_sha256,'INVALID_CONFIGURATION','Warm manifest differs from its owner message.',503);
  const run=db.all<Pick<Run,'command_id'|'persona_id'|'role'|'parent_run_id'|'routine_id'|'occurrence_id'|'context_json'>>('SELECT command_id,persona_id,role,parent_run_id,routine_id,occurrence_id,context_json FROM runs WHERE id=?',m.run_id)[0];
  requireThat(run&&run.command_id===m.command_id&&run.persona_id===m.persona_id&&run.role==='coordinator'&&run.parent_run_id===null&&
   run.routine_id===null&&run.occurrence_id===null&&(JSON.parse(run.context_json) as {room_id?:string|null}).room_id===null,
   'INVALID_CONFIGURATION','Warm manifest differs from its admitted run.',503);
  requireThat(db.all("SELECT sequence FROM events WHERE id=? AND type='message.user' AND actor_id=? AND conversation_id=? AND sequence=? AND created_at<=?",
   m.command_id,c.owner_id,m.persona_id,m.event_sequence,m.issued_at).length===1,'INVALID_CONFIGURATION','Warm manifest event binding is missing.',503);
  const reservation=db.all<{value_json:string}>('SELECT value_json FROM runtime_metadata WHERE key=?',`owner_alpha_reservation:${w.epoch}:${admission}`)[0];
  let saved:{manifest_sha256:string;micro_usd:number}|undefined;
  try{saved=reservation?JSON.parse(reservation.value_json):undefined;}catch{saved=undefined;}
  requireThat(saved&&Object.keys(saved).sort().join(',')==='manifest_sha256,micro_usd'&&saved.manifest_sha256===m.manifest_sha256&&
   saved.micro_usd===m.reservation_micro_usd,'INVALID_CONFIGURATION','Warm reservation is missing or inconsistent.',503);
 }
 if(a.admissions.length===2)assertWarmRunSettled(store,first,c.text_only,w.epoch,w.boot_id);
 requireThat(warmLedgerUsed(db,c.prior_cost_micro_usd)<=c.total_cap_micro_usd,'INVALID_CONFIGURATION','Warm lifetime ledger exceeds its cap.',503);
 const baseline=readRow<Record<string,unknown>>(db,'owner_alpha_cost_baseline');
 requireThat(baseline&&Object.keys(baseline).sort().join(',')==='installation_id,owner_binding_sha256,prior_cost_micro_usd,prior_cost_source,total_cap_micro_usd'&&
  baseline.installation_id===c.installation_id&&baseline.owner_binding_sha256===c.owner_binding_sha256&&
  baseline.prior_cost_micro_usd===c.prior_cost_micro_usd&&baseline.prior_cost_source===c.prior_cost_source&&
  baseline.total_cap_micro_usd===c.total_cap_micro_usd,'INVALID_CONFIGURATION','Warm cost baseline is missing or inconsistent.',503);
 if(w.epoch===2){
  const custody=readRow<{policy:OwnerAlphaPolicy}>(db,'owner_alpha');
  requireThat(custody&&custody.policy&&uuid.test(custody.policy.session_id)&&custody.policy.session_id===w.predecessor.session_id,
   'INVALID_CONFIGURATION','Warm generation predecessor custody is missing.',503);
  const retirement=readRow<OwnerAlphaRetirement>(db,'owner_alpha_retirement:1');
  requireThat(retirementShape(retirement)&&retirement.epoch===1&&retirement.boot_id===w.predecessor.boot_id&&
   retirement.session_id===custody.policy.session_id&&retirement.transition_id===null&&
   retirement.observed_at>=custody.policy.expires_at,'INVALID_CONFIGURATION','Warm generation predecessor retirement is missing.',503);
 }else{
  const priorRow=readRow<OwnerAlphaGeneration>(db,`owner_alpha_generation:${w.epoch-1}`);
  requireThat(priorRow&&priorRow.epoch===w.epoch-1&&'kind' in priorRow.authority&&priorRow.authority.kind!=='owner-message-warm-generation'&&priorRow.authority.kind!=='owner-message-background-generation'&&
   priorRow.boot_id===w.predecessor.boot_id&&priorRow.policy.session_id===w.predecessor.session_id,
   'INVALID_CONFIGURATION','Warm generation predecessor is missing.',503);
  requireThat(priorRow.authority.manifest.policy_revision!==c.policy_revision,
   'INVALID_CONFIGURATION','Warm policy revision must differ from its message-bound predecessor.',503);
  const retirement=readRow<OwnerAlphaRetirement>(db,`owner_alpha_retirement:${w.epoch-1}`);
  requireThat(retirementShape(retirement)&&retirement.epoch===priorRow.epoch&&retirement.boot_id===priorRow.boot_id&&
   retirement.session_id===priorRow.policy.session_id&&retirement.transition_id===priorRow.transition_id&&
   retirement.observed_at>=priorRow.policy.expires_at,'INVALID_CONFIGURATION','Warm generation predecessor retirement is missing.',503);
 }
}

/** Trusted host configuration and observations, never message-supplied authority. */
export class OwnerAlphaWarm {
 private core:ControlCore;
 constructor(core:ControlCore){
  this.core=core;
  const c=core.options.ownerAlphaWarm;
  if(!c)return;
  // A fresh Durable Object constructs the core before installing its schema.
  // Existing custody must still validate even after configuration is removed.
  if(!core.store.db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='runtime_metadata'").length)return;
  const persisted=persistedWarmConfigRow(core.store.db);
  if(persisted){
   const {seed_retirement:_,...expected}=c;
   requireThat(JSON.stringify(persisted.config)===JSON.stringify(expected),'INVALID_CONFIGURATION','Warm generation policy revision is immutable.',503);
  }
  if(core.store.db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_warm_generation:*' LIMIT 1").length)core.ownerAlpha.activeGeneration();
 }
 private get config():WarmGenerationConfig|undefined{return this.core.options.ownerAlphaWarm;}
 retained():boolean{
  return this.core.store.db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_warm_generation:*' LIMIT 1").length>0;
 }
 /** Validation-only: proves a further warm admission would be admissible right
  * now. Never assigns anything or writes custody. */
 assertMessageAdmission():void{
  const c=this.config;
  requireThat(!!c,'CAPABILITY_UNAVAILABLE','Warm generation admission is not configured.');
  const db=this.core.store.db,lifecycle=new LifecycleCore(this.core.store,this.core),state=lifecycle.get(),now=this.core.now();
  const warmRows=db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_warm_generation:*'");
  requireThat(warmRows.length<=1,'INVALID_CONFIGURATION','Warm generation history is inconsistent.',503);
  const prior=this.core.ownerAlpha.policy;
  if(!warmRows.length){
   requireThat(prior&&prior.expires_at<=now&&state.epoch>=1&&state.boot_id&&state.phase==='RECOVERY_REQUIRED'&&state.provider_ref_json==='{}'&&
    state.provider_operation_id===null&&state.lease_until!==null&&state.lease_until<=now,'CAPABILITY_UNAVAILABLE','Predecessor is not expired and retired.');
   requireThat(!this.core.store.get<{archived:boolean}>(c.persona_id,'persona').body.archived,'CAPABILITY_UNAVAILABLE','This bot is archived.');
   const predecessor=this.core.ownerAlpha.activeGeneration();
   if(state.epoch===1){
    requireThat(!predecessor,'CAPABILITY_UNAVAILABLE','Initial hosted predecessor must have no generation history.');
    requireThat(c.seed_retirement&&retirementShape(c.seed_retirement)&&c.seed_retirement.epoch===1&&c.seed_retirement.boot_id===state.boot_id&&
     c.seed_retirement.session_id===prior.session_id&&c.seed_retirement.transition_id===null&&
     c.seed_retirement.observed_at>=prior.expires_at&&c.seed_retirement.observed_at<=now,'CAPABILITY_UNAVAILABLE','Trusted seed retirement is missing.');
   }else{
    const predecessor=this.core.ownerAlpha.activeGeneration();
    requireThat(predecessor&&'kind' in predecessor.authority&&predecessor.authority.kind!=='owner-message-warm-generation'&&predecessor.authority.kind!=='owner-message-background-generation'&&predecessor.epoch===state.epoch&&
     predecessor.boot_id===state.boot_id&&predecessor.policy.expires_at<=now,
     'CAPABILITY_UNAVAILABLE','Warm entry requires its exact retired legacy predecessor.');
    requireThat(predecessor.authority.manifest.policy_revision!==c.policy_revision,
     'CAPABILITY_UNAVAILABLE','Warm policy revision must differ from its message-bound predecessor.');
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
   const used=warmLedgerUsed(db,c.prior_cost_micro_usd);
   requireThat(Number.isSafeInteger(used+c.reservation_micro_usd)&&used+c.reservation_micro_usd<=c.total_cap_micro_usd,'CAPABILITY_UNAVAILABLE','Lifetime allowance is exhausted.');
   const persisted=persistedWarmConfigRow(db);
   if(persisted){
    const {seed_retirement:_,...expected}=c;
    requireThat(JSON.stringify(persisted.config)===JSON.stringify(expected),'CAPABILITY_UNAVAILABLE','Warm generation policy revision is immutable.');
   }
   const expiresAt=new Date(Math.min(Date.parse(c.expires_at),Date.parse(now)+300000)).toISOString();
   requireThat(Date.parse(expiresAt)-Date.parse(now)>=1000,'CAPABILITY_UNAVAILABLE','Less than one second remains in the fixed warm generation.');
   const deadline=new Date(Math.min(Date.parse(expiresAt),Date.parse(now)+c.max_task_seconds*1000)).toISOString();
   requireThat(Date.parse(deadline)-Date.parse(now)>=1000,'CAPABILITY_UNAVAILABLE','Less than one second remains for the warm task.');
  }else{
   const generation=this.core.ownerAlpha.activeGeneration() as WarmGenerationView;
   requireThat('kind' in generation.authority&&generation.authority.kind==='owner-message-warm-generation'&&generation.epoch===state.epoch&&generation.boot_id===state.boot_id,
    'CAPABILITY_UNAVAILABLE','Warm generation is not the active lifecycle generation.');
   requireThat(generation.authority.admissions.length===1,'CAPABILITY_UNAVAILABLE','Warm generation has admitted its bounded messages.');
   requireThat(this.config,'CAPABILITY_UNAVAILABLE','Warm generation policy configuration was removed.');
   requireThat(state.phase==='READY'&&Date.parse(generation.policy.expires_at)>Date.parse(now),'CAPABILITY_UNAVAILABLE','Warm generation is not live for another message.');
   requireThat(state.lease_until!==null&&Date.parse(state.lease_until)>Date.parse(now),'CAPABILITY_UNAVAILABLE','Warm generation lease has expired.');
   const m1=generation.authority.admissions[0];
   assertWarmRunSettled(this.core.store,m1,generation.policy.text_only!,generation.epoch,generation.boot_id);
   requireThat(!db.all("SELECT id FROM controller_operations WHERE status IN ('pending','submitted','unknown') LIMIT 1").length,
    'CAPABILITY_UNAVAILABLE','Controller activity blocks warm admission.');
   const used=warmLedgerUsed(db,c.prior_cost_micro_usd);
   requireThat(Number.isSafeInteger(used+c.reservation_micro_usd)&&used+c.reservation_micro_usd<=c.total_cap_micro_usd,'CAPABILITY_UNAVAILABLE','Lifetime allowance is exhausted.');
   const deadline=new Date(Math.min(Date.parse(generation.policy.expires_at),Date.parse(now)+c.max_task_seconds*1000)).toISOString();
   requireThat(Date.parse(deadline)-Date.parse(now)>=1000,'CAPABILITY_UNAVAILABLE','Less than one second remains for the warm task.');
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
    const generation=this.core.ownerAlpha.activeGeneration() as WarmGenerationView;
    requireThat(conversationId!==generation.policy.persona_id,'CAPABILITY_UNAVAILABLE','Warm generation admission is not configured.');
   }
   return;
  }
  if(conversationId!==c.persona_id||owner!==c.owner_id)return;
  requireThat(this.core.ownerAlpha.directMessage(c.persona_id,commandId,null,null,null,0,c.persona_id),
   'CAPABILITY_UNAVAILABLE','Warm generation admission requires a direct owner message.');
  this.assertMessageAdmission();
 }
 /** Candidate gate without writes, for enqueue's admission computation. */
 messageAdmitted(persona:string,commandId:string|null,routine:string|null,occurrence:string|null,room:string|null):boolean{
  const c=this.config;
  if(!c||routine||occurrence||room||persona!==c.persona_id)return false;
  if(!this.core.ownerAlpha.directMessage(persona,commandId,null,null,null,0,c.persona_id))return false;
  try{this.assertMessageAdmission();return true;}catch{return false;}
 }
 summary():WarmSummary|undefined{
  const envConfig=this.config;
  const persisted=persistedWarmConfigRow(this.core.store.db);
  if(!envConfig&&!persisted)return undefined;
  const c=envConfig??{...persisted!.config};
  const generation=this.core.ownerAlpha.activeGeneration();
  const warm=generation&&'kind' in generation.authority&&generation.authority.kind==='owner-message-warm-generation'?generation as WarmGenerationView:undefined;
  let available=false;
  if(envConfig&&!this.core.options.testCampaignGrant){
   try{this.assertMessageAdmission();available=true;}catch{/* Unavailable admission is reported, never repaired. */}
  }
  return {schema_version:1,kind:'owner-alpha-warm-summary-v1',policy_revision:c.policy_revision,persona_id:c.persona_id,policy_expires_at:c.expires_at,
   max_admissions:2,admissions_used:warm?warm.authority.admissions.length:0,message_admission_available:available,
   generation:warm?{session_id:warm.policy.session_id,expires_at:warm.policy.expires_at,epoch:warm.epoch}:null};
 }
 /** Manager-only retirement observation. Valid after generation expiry; settles
 * nothing and admits no successor by itself. */
 recordRetirement(report:OwnerAlphaRetirement):void{
  requireThat(retirementShape(report),'INVALID_INPUT','Invalid trusted retirement observation.',422);
  this.core.store.db.transaction(()=>{
   const state=new LifecycleCore(this.core.store,this.core).get(),generation=this.core.ownerAlpha.activeGeneration() as WarmGenerationView|undefined;
   requireThat(generation&&'kind' in generation.authority&&generation.authority.kind==='owner-message-warm-generation'&&
    report.epoch===state.epoch&&report.boot_id===state.boot_id&&report.session_id===generation.policy.session_id&&
    report.transition_id===generation.transition_id&&
    report.observed_at<=this.core.now()&&report.observed_at>=generation.policy.expires_at,
    'INVALID_INPUT','Retirement must identify the expired warm generation and trusted stop/lock observations.',422);
   const key=`owner_alpha_retirement:${report.epoch}`,saved=readRow<OwnerAlphaRetirement>(this.core.store.db,key);
   requireThat(!saved||JSON.stringify(saved)===JSON.stringify(report),'REVISION_CONFLICT','Retirement observation is immutable.',422);
   if(!saved)putRow(this.core.store.db,key,report);
  });
 }
 /** Only invoked within accept's transaction. The message precheck has already
  * proven admissibility; this appends the immutable admission atomically. */
 assignNewMessage(owner:string,commandId:string,runId:string):void{
  const c=this.config;
  if(!c||owner!==c.owner_id)return;
  const db=this.core.store.db,run=this.core.store.run(runId),now=this.core.now();
  if(run.persona_id!==c.persona_id||run.current_attempt!==0||run.command_id!==commandId||run.role!=='coordinator'||run.parent_run_id||run.routine_id||run.occurrence_id||(JSON.parse(run.context_json) as {room_id?:string|null}).room_id)return;
  const command=db.all<{body_hash:string;type:string;status:string;accepted_at:string;owner_id:string}>('SELECT * FROM commands WHERE id=?',commandId)[0];
  const event=db.all<{sequence:number}>("SELECT sequence FROM events WHERE id=? AND type='message.user' AND actor_id=? AND conversation_id=?",commandId,owner,c.persona_id)[0];
  requireThat(command&&command.type==='message.send'&&command.status==='accepted'&&command.accepted_at<=now&&command.owner_id===owner&&hex64.test(command.body_hash)&&
   event&&this.core.ownerAlpha.directMessage(c.persona_id,commandId,null,null,null,0,c.persona_id),
   'CAPABILITY_UNAVAILABLE','Warm admission requires its exact owner message.');
  db.transaction(()=>{
   const state=new LifecycleCore(this.core.store,this.core).get();
   const warmRows=db.all("SELECT key FROM runtime_metadata WHERE key GLOB 'owner_alpha_warm_generation:*'");
   requireThat(warmRows.length<=1,'INVALID_CONFIGURATION','Warm generation history is inconsistent.',503);
   if(!warmRows.length){
    const prior=this.core.ownerAlpha.policy;
    requireThat(prior&&state.epoch>=1&&state.boot_id&&prior.expires_at<=now&&state.phase==='RECOVERY_REQUIRED'&&state.lease_until!==null&&state.lease_until<=now,
     'CAPABILITY_UNAVAILABLE','Warm entry requires its exact retired predecessor.');
    const epoch=state.epoch+1,boot_id=this.core.options.uuid(),transition_id=this.core.options.uuid(),session_id=this.core.options.uuid();
    requireThat(!db.all("SELECT run_id FROM attempts WHERE boot_id=? LIMIT 1",boot_id).length,'INVALID_CONFIGURATION','Warm boot identity is not fresh.',503);
    const persisted=persistedWarmConfigRow(db);
    const {seed_retirement:_,...policy}=c;
    if(persisted)requireThat(JSON.stringify(persisted.config)===JSON.stringify(policy),'CAPABILITY_UNAVAILABLE','Warm generation policy revision is immutable.');
    const expiresAt=new Date(Math.min(Date.parse(c.expires_at),Date.parse(now)+300000)).toISOString();
    const deadline=new Date(Math.min(Date.parse(expiresAt),Date.parse(now)+c.max_task_seconds*1000)).toISOString();
    const authority:WarmMessageBoundAuthority={kind:'owner-message-warm-generation',config_sha256:warmConfigSha256(policy),generation_sha256:'',admissions:[]};
    const generation:WarmGenerationView={epoch,boot_id,transition_id,
     policy:{session_id,persona_id:c.persona_id,expires_at:expiresAt,max_runs:2,max_task_seconds:c.max_task_seconds,text_only:{...c.text_only}},
     predecessor:{epoch:state.epoch,boot_id:state.boot_id!,session_id:prior.session_id,phase:state.phase,lease_until:state.lease_until},
     authority,activation_command_id:commandId,activation_command_sha256:command.body_hash,activation_event_sequence:event.sequence};
    authority.generation_sha256=warmGenerationSha256(generation);
    const unsigned={schema_version:1 as const,kind:'owner-alpha-warm-manifest-v1' as const,admission:1 as const,installation_id:c.installation_id,
     owner_binding_sha256:c.owner_binding_sha256,run_id:runId,persona_id:c.persona_id,command_id:commandId,command_sha256:command.body_hash,
     event_sequence:event.sequence,policy_revision:c.policy_revision,epoch,boot_id,transition_id,session_id,text_only:{...c.text_only},
     issued_at:now,expires_at:deadline,reservation_micro_usd:c.reservation_micro_usd,generation_sha256:authority.generation_sha256};
    const manifest:WarmManifest={...unsigned,manifest_sha256:warmManifestSha256(unsigned)};
    if(state.epoch===1){
     requireThat(c.seed_retirement&&!readRow(db,'owner_alpha_retirement:1'),'CAPABILITY_UNAVAILABLE','Warm seed retirement is already recorded.');
     putRow(db,'owner_alpha_retirement:1',c.seed_retirement);
    }else{
     const predecessor=this.core.ownerAlpha.activeGeneration()!;
     const retirement=readRow<OwnerAlphaRetirement>(db,`owner_alpha_retirement:${state.epoch}`);
     requireThat(retirement&&retirementShape(retirement)&&retirement.epoch===state.epoch&&retirement.boot_id===state.boot_id&&
      retirement.session_id===predecessor.policy.session_id&&retirement.transition_id===predecessor.transition_id,
      'CAPABILITY_UNAVAILABLE','Trusted predecessor retirement is missing.');
    }
    if(!persisted)putRow(db,`owner_alpha_warm_config:${c.policy_revision}`,policy);
    if(!readRow(db,'owner_alpha_cost_baseline'))putRow(db,'owner_alpha_cost_baseline',
     {installation_id:c.installation_id,owner_binding_sha256:c.owner_binding_sha256,prior_cost_micro_usd:c.prior_cost_micro_usd,
      prior_cost_source:c.prior_cost_source,total_cap_micro_usd:c.total_cap_micro_usd});
    // The generation descriptor row is write-once and never carries the
    // admissions; each manifest row is appended separately and never rewritten.
    putRow(db,`owner_alpha_warm_generation:${epoch}`,generation);
    putRow(db,`owner_alpha_warm_manifest:${epoch}:1`,manifest);
    putRow(db,`owner_alpha_reservation:${epoch}:1`,{manifest_sha256:manifest.manifest_sha256,micro_usd:c.reservation_micro_usd});
    db.exec("UPDATE lifecycle SET epoch=?,boot_id=?,phase='BOOTING',desired_state='RUN',lease_until=?,last_heartbeat=NULL,stop_token=NULL,wake_after_stop=0 WHERE singleton=1",
     epoch,boot_id,new Date(Math.min(Date.parse(expiresAt),Date.parse(now)+90000)).toISOString());
   }else{
    const generation=this.core.ownerAlpha.activeGeneration() as WarmGenerationView;
    requireThat('kind' in generation.authority&&generation.authority.kind==='owner-message-warm-generation'&&generation.authority.admissions.length===1&&
     generation.epoch===state.epoch&&generation.boot_id===state.boot_id&&state.phase==='READY',
     'CAPABILITY_UNAVAILABLE','Warm generation cannot admit another message.');
    requireThat(state.lease_until!==null&&Date.parse(state.lease_until)>Date.parse(now),'CAPABILITY_UNAVAILABLE','Warm generation lease has expired.');
    const persisted=persistedWarmConfigRow(db);
    const {seed_retirement:_,...expected}=c;
    requireThat(persisted&&JSON.stringify(persisted.config)===JSON.stringify(expected),'CAPABILITY_UNAVAILABLE','Warm generation policy revision is immutable.');
    const deadline=new Date(Math.min(Date.parse(generation.policy.expires_at),Date.parse(now)+c.max_task_seconds*1000)).toISOString();
    const unsigned={schema_version:1 as const,kind:'owner-alpha-warm-manifest-v1' as const,admission:2 as const,installation_id:c.installation_id,
     owner_binding_sha256:c.owner_binding_sha256,run_id:runId,persona_id:c.persona_id,command_id:commandId,command_sha256:command.body_hash,
     event_sequence:event.sequence,policy_revision:c.policy_revision,epoch:generation.epoch,boot_id:generation.boot_id,
     transition_id:generation.transition_id,session_id:generation.policy.session_id,text_only:{...c.text_only},
     issued_at:now,expires_at:deadline,reservation_micro_usd:c.reservation_micro_usd,generation_sha256:generation.authority.generation_sha256};
    const manifest:WarmManifest={...unsigned,manifest_sha256:warmManifestSha256(unsigned)};
    // Only the manifest and reservation rows are appended; the write-once
    // generation descriptor row keeps its exact historical bytes.
    putRow(db,`owner_alpha_warm_manifest:${generation.epoch}:2`,manifest);
    putRow(db,`owner_alpha_reservation:${generation.epoch}:2`,{manifest_sha256:manifest.manifest_sha256,micro_usd:c.reservation_micro_usd});
   }
  });
 }
}
