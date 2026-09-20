import {createHash} from 'node:crypto';
import { ControlError, requireThat } from './errors';
import type { Store } from './store';
import type { Run } from './types';
import {ownerAlphaManifestSha256,parseOwnerAlphaUnusedRecovery,assertUnusedRecoveryCustody,parseOwnerAlphaClaimedPreTurnQuarantine,assertClaimedPreTurnQuarantineCustody,type ClaimedPreTurnMessageBoundAuthority,type OwnerAlphaClaimedPreTurnDisposition,type UnusedMessageBoundAuthority,type OwnerAlphaUnusedDisposition,type MessageBoundAuthority,type OwnerAlphaManifest,type OwnerAlphaBootstrapConfig} from './owner-alpha-bootstrap';
import {warmAdmissionsView,validateWarmGenerationView,type WarmManifest,type WarmMessageBoundAuthority,type WarmGenerationView} from './owner-alpha-warm';
import {backgroundAdmissionsView,validateBackgroundGenerationView,type BackgroundManifest,type BackgroundMessageBoundAuthority,type BackgroundGenerationView,type BackgroundRole} from './owner-alpha-background';

export type TextOnlyProfile={profile_version:'codex-text-only-v1';profile_sha256:string};
/** Restricted V2 background profile; only the first (role background) root may observe native descendants. */
export type BackgroundProfile={profile_version:'codex-background-v2-restricted-v1';profile_sha256:string;max_resident_child_threads:2;wait_agent_enabled:false;multi_agent_v1:false};
export type OwnerAlphaPolicy = { session_id:string; persona_id:string; expires_at:string; max_runs:number; max_task_seconds:number; background_first_root?:true;text_only?:TextOnlyProfile };
export type OwnerAlphaSuccessor = {
 schema_version:1;
 transition_id:string;
 owner_binding_sha256:string;
 predecessor:{session_id:string;epoch:number;boot_id:string};
 // Operator recovery-disposition evidence: credential revocation, absent/disabled
 // autostart and process retirement (observed restart for the legacy profile).
 // Later completed text-only sessions still need operator stop evidence, not
 // merely the database settlement gate below. This digest is not proof of
 // historical settlement or universal containment; old custody remains unknown
 // and replay forbidden. The server binds the receipt, not physical evidence.
 retirement_receipt_sha256:string;
 successor:{policy:OwnerAlphaPolicy&{text_only:TextOnlyProfile};boot_id:string};
};
export type OwnerAlphaSuccessorBinding = {
 ownerBindingSha256:string;
 predecessorPolicy:OwnerAlphaPolicy;
 epoch:number;
 bootId:string;
 retirementReceiptSha256:string;
};
const key='owner_alpha';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha256=/^[0-9a-f]{64}$/;
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
export function parseOwnerAlphaSuccessor(value:string|undefined):OwnerAlphaSuccessor|undefined {
 if(value===undefined||value==='')return undefined;
 let e:Record<string,unknown>|undefined;
 try{e=JSON.parse(value);}catch{requireThat(false,'INVALID_CONFIGURATION','Invalid owner-alpha successor configuration.',503);}
 const predecessor=e?.predecessor as Record<string,unknown>|undefined;
 const successor=e?.successor as Record<string,unknown>|undefined;
 requireThat(e&&typeof e==='object'&&!Array.isArray(e)&&Object.keys(e).sort().join(',')==='owner_binding_sha256,predecessor,retirement_receipt_sha256,schema_version,successor,transition_id'&&
  e.schema_version===1&&typeof e.transition_id==='string'&&uuid.test(e.transition_id)&&typeof e.owner_binding_sha256==='string'&&sha256.test(e.owner_binding_sha256)&&
  predecessor&&typeof predecessor==='object'&&!Array.isArray(predecessor)&&Object.keys(predecessor).sort().join(',')==='boot_id,epoch,session_id'&&
  typeof predecessor.session_id==='string'&&uuid.test(predecessor.session_id)&&Number.isSafeInteger(predecessor.epoch)&&Number(predecessor.epoch)>=1&&Number(predecessor.epoch)<Number.MAX_SAFE_INTEGER&&typeof predecessor.boot_id==='string'&&uuid.test(predecessor.boot_id)&&
  typeof e.retirement_receipt_sha256==='string'&&sha256.test(e.retirement_receipt_sha256)&&successor&&typeof successor==='object'&&!Array.isArray(successor)&&Object.keys(successor).sort().join(',')==='boot_id,policy'&&
  typeof successor.boot_id==='string'&&uuid.test(successor.boot_id)&&successor.boot_id.toLowerCase()!==predecessor.boot_id.toLowerCase(),
  'INVALID_CONFIGURATION','Invalid owner-alpha successor configuration.',503);
 const policy=parsePolicy(successor.policy);
 requireThat(!!policy.text_only&&!policy.background_first_root&&policy.session_id.toLowerCase()!==predecessor.session_id.toLowerCase(),'INVALID_CONFIGURATION','Invalid owner-alpha successor policy.',503);
 return {schema_version:1,transition_id:e.transition_id as string,owner_binding_sha256:e.owner_binding_sha256 as string,
  predecessor:{session_id:predecessor.session_id as string,epoch:predecessor.epoch as number,boot_id:predecessor.boot_id as string},retirement_receipt_sha256:e.retirement_receipt_sha256 as string,
  successor:{policy:policy as OwnerAlphaPolicy&{text_only:TextOnlyProfile},boot_id:successor.boot_id as string}};
}
export function ownerAlphaSuccessorSha256(envelope:OwnerAlphaSuccessor):string {
 const parsed=parseOwnerAlphaSuccessor(JSON.stringify(envelope));
 requireThat(!!parsed,'INVALID_CONFIGURATION','Owner-alpha successor configuration is missing.',503);
 return createHash('sha256').update(JSON.stringify(parsed)).digest('hex');
}
export function assertOwnerAlphaSuccessorBinding(envelope:OwnerAlphaSuccessor,binding:OwnerAlphaSuccessorBinding):void {
 requireThat(sha256.test(binding.ownerBindingSha256)&&Number.isSafeInteger(binding.epoch)&&binding.epoch>=1&&uuid.test(binding.bootId)&&sha256.test(binding.retirementReceiptSha256)&&
  envelope.owner_binding_sha256===binding.ownerBindingSha256&&envelope.predecessor.session_id===binding.predecessorPolicy.session_id&&envelope.predecessor.epoch===binding.epoch&&
  envelope.predecessor.boot_id===binding.bootId&&envelope.retirement_receipt_sha256===binding.retirementReceiptSha256,
  'INVALID_CONFIGURATION','Owner-alpha successor binding does not match trusted retirement inputs.',503);
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
type Custody={policy:OwnerAlphaPolicy;admitted_run_ids:string[];binding?:OwnerAlphaManifest;warm?:{manifests:WarmManifest[]};background?:{manifests:BackgroundManifest[]}};
export type OwnerAlphaGeneration={
 epoch:number;boot_id:string;transition_id:string;policy:OwnerAlphaPolicy&({text_only:TextOnlyProfile;background?:never}|{background:BackgroundProfile;text_only?:never});
 predecessor:{epoch:number;boot_id:string;session_id:string;phase:string;lease_until:string|null};
 authority:OwnerAlphaSuccessor|MessageBoundAuthority|UnusedMessageBoundAuthority|ClaimedPreTurnMessageBoundAuthority|WarmMessageBoundAuthority|BackgroundMessageBoundAuthority;activation_command_id:string;activation_command_sha256:string;activation_event_sequence:number;
};
/** Immutable local-session policy; each durable admitted ID consumes one run forever. */
export class OwnerAlpha {
 constructor(private store:Store,readonly configuredPolicy:OwnerAlphaPolicy|undefined,private now:()=>string){}
 get policy():OwnerAlphaPolicy|undefined{return this.activeGeneration()?.policy??this.configuredPolicy;}
 private generations():OwnerAlphaGeneration[]{
  const rows=this.store.db.all<{key:string;value_json:string}>("SELECT key,value_json FROM runtime_metadata WHERE key GLOB 'owner_alpha_generation:*' ORDER BY CAST(substr(key,24) AS INTEGER)").map(row=>{
   const generation=JSON.parse(row.value_json) as OwnerAlphaGeneration;
   requireThat(row.key===`owner_alpha_generation:${generation?.epoch}`&&Number.isSafeInteger(generation?.epoch)&&generation.epoch>=2&&Number.isSafeInteger(generation.activation_event_sequence)&&generation.activation_event_sequence>=0&&
    generation.predecessor?.epoch===generation.epoch-1&&generation.predecessor.phase==='RECOVERY_REQUIRED'&&uuid.test(generation.activation_command_id),
    'INVALID_CONFIGURATION','Invalid owner-alpha generation record.',503);
   const command=this.store.db.all<{payload_json:string;body_hash:string;type:string;owner_id:string;status:string;resource_id:string;accepted_at:string}>('SELECT payload_json,body_hash,type,owner_id,status,resource_id,accepted_at FROM commands WHERE id=?',generation.activation_command_id)[0];
   if('kind' in generation.authority&&generation.authority.kind!=='owner-message-warm-generation'&&generation.authority.kind!=='owner-message-background-generation'){
    const m=generation.authority.manifest;
    const run=this.store.db.all<Run>('SELECT * FROM runs WHERE id=?',m.run_id)[0];
    const policyRow=this.store.db.all<{value_json:string}>('SELECT value_json FROM runtime_metadata WHERE key=?',`owner_alpha_bootstrap_policy:${m.policy_revision}`)[0];
    const config=policyRow?JSON.parse(policyRow.value_json) as OwnerAlphaBootstrapConfig:undefined;
    const reservation=this.store.db.all<{value_json:string}>('SELECT value_json FROM runtime_metadata WHERE key=?',`owner_alpha_reservation:${generation.epoch}`)[0];
    const retirement=this.store.db.all<{value_json:string}>('SELECT value_json FROM runtime_metadata WHERE key=?',`owner_alpha_retirement:${generation.predecessor.epoch}`)[0];
    requireThat(config&&command?.type==='message.send'&&command.status==='applied'&&command.owner_id===config.owner_id&&
     command.resource_id===m.run_id&&command.accepted_at<=m.issued_at&&
     m.manifest_sha256===ownerAlphaManifestSha256(m)&&m.command_id===generation.activation_command_id&&m.command_sha256===command.body_hash&&command.body_hash===generation.activation_command_sha256&&
     m.event_sequence===generation.activation_event_sequence&&m.epoch===generation.epoch&&m.boot_id===generation.boot_id&&m.transition_id===generation.transition_id&&m.session_id===generation.policy.session_id&&
     m.installation_id===config.installation_id&&m.owner_binding_sha256===config.owner_binding_sha256&&m.policy_revision===config.policy_revision&&m.persona_id===config.persona_id&&
     m.reservation_micro_usd===config.reservation_micro_usd&&reservation&&JSON.parse(reservation.value_json).manifest_sha256===m.manifest_sha256&&JSON.parse(reservation.value_json).micro_usd===m.reservation_micro_usd&&
     JSON.stringify(m.text_only)===JSON.stringify(config.text_only)&&JSON.stringify(generation.policy.text_only)===JSON.stringify(config.text_only)&&generation.policy.max_runs===1&&generation.policy.max_task_seconds===config.max_task_seconds&&
     m.expires_at===generation.policy.expires_at&&m.expires_at<=config.expires_at&&m.expires_at>m.issued_at&&Date.parse(m.expires_at)<=Date.parse(m.issued_at)+config.session_seconds*1000&&
     run&&run.command_id===m.command_id&&run.persona_id===m.persona_id&&run.role==='coordinator'&&run.parent_run_id===null&&run.routine_id===null&&run.occurrence_id===null&&JSON.parse(run.context_json).room_id===null&&
     this.store.db.all("SELECT sequence FROM events WHERE id=? AND type='message.user' AND actor_id=? AND conversation_id=? AND sequence=? AND created_at<=?",m.command_id,command.owner_id,m.persona_id,m.event_sequence,m.issued_at).length===1&&
     this.directMessage(m.persona_id,m.command_id,null,null,null,m.event_sequence-1,m.persona_id),
     'INVALID_CONFIGURATION','Message-bound generation differs from its admission binding.',503);
    if(generation.authority.kind==='owner-message'){
     const {manifest:_,kind:__,...envelope}=generation.authority;
     requireThat(retirement&&createHash('sha256').update(retirement.value_json).digest('hex')===envelope.retirement_receipt_sha256&&
      envelope.transition_id===generation.transition_id&&envelope.predecessor.epoch===generation.predecessor.epoch&&envelope.predecessor.session_id===generation.predecessor.session_id&&envelope.predecessor.boot_id===generation.predecessor.boot_id&&
      envelope.successor.boot_id===generation.boot_id&&JSON.stringify(parseOwnerAlphaSuccessor(JSON.stringify(envelope))?.successor.policy)===JSON.stringify(generation.policy),'INVALID_CONFIGURATION','Invalid retired message authority.',503);
    }else{
     const quarantine=generation.authority.kind==='owner-message-claimed-pre-turn-quarantine';
     const row=this.store.db.all<{value_json:string}>('SELECT value_json FROM runtime_metadata WHERE key=?',`${quarantine?'owner_alpha_claimed_pre_turn_disposition':'owner_alpha_unused_disposition'}:${generation.predecessor.epoch}`)[0];
     const priorRow=this.store.db.all<{value_json:string}>('SELECT value_json FROM runtime_metadata WHERE key=?',`owner_alpha_generation:${generation.predecessor.epoch}`)[0];
     requireThat((quarantine||generation.authority.kind==='owner-message-unused-recovery')&&row&&priorRow&&createHash('sha256').update(row.value_json).digest('hex')===generation.authority.disposition_sha256,'INVALID_CONFIGURATION','Disposition binding is missing.',503);
     const disposition=JSON.parse(row.value_json) as OwnerAlphaUnusedDisposition|OwnerAlphaClaimedPreTurnDisposition,grant=quarantine?parseOwnerAlphaClaimedPreTurnQuarantine(disposition.grant):parseOwnerAlphaUnusedRecovery(disposition.grant),prior=JSON.parse(priorRow.value_json) as OwnerAlphaGeneration;
     requireThat(Object.keys(disposition).sort().join(',')==='grant,successor_epoch,successor_manifest_sha256,successor_run_id'&&JSON.stringify(grant)===JSON.stringify(disposition.grant)&&
      'kind' in prior.authority&&prior.authority.kind!=='owner-message-warm-generation'&&prior.authority.kind!=='owner-message-background-generation'&&disposition.successor_epoch===m.epoch&&disposition.successor_run_id===m.run_id&&disposition.successor_manifest_sha256===m.manifest_sha256&&
      grant.predecessor.epoch===generation.predecessor.epoch&&grant.predecessor.boot_id===generation.predecessor.boot_id&&grant.predecessor.session_id===generation.predecessor.session_id&&
      grant.successor_policy_revision===m.policy_revision&&grant.installation_id===m.installation_id&&grant.owner_binding_sha256===m.owner_binding_sha256&&m.expires_at<=grant.expires_at&&
      generation.predecessor.lease_until!==null&&generation.predecessor.lease_until<=m.issued_at,'INVALID_CONFIGURATION','Disposition differs from its successor.',503);
     if(grant.kind==='claimed-pre-turn-quarantine-v1')assertClaimedPreTurnQuarantineCustody(this.store,grant,prior.authority.manifest,m.issued_at);
     else assertUnusedRecoveryCustody(this.store,grant,prior.authority.manifest,m.issued_at);
    }
    return generation;
   }
   requireThat(command?.type==='owner-alpha.activate'&&command.status==='applied'&&!/^(runtime|trigger):/.test(command.owner_id),
    'INVALID_CONFIGURATION','Owner-alpha activation receipt is missing.',503);
   requireThat(this.store.db.all("SELECT sequence FROM events WHERE id=? AND type='owner-alpha.activated' AND actor_id=? AND cause_id=? AND sequence=? AND json_extract(payload_json,'$.epoch')=?",
    generation.activation_command_id,command.owner_id,generation.activation_command_id,generation.activation_event_sequence,generation.epoch).length===1,
    'INVALID_CONFIGURATION','Owner-alpha admission cutoff differs from its activation event.',503);
   const envelope=parseOwnerAlphaSuccessor(JSON.stringify(generation.authority));
   const payload={transition_id:generation.transition_id,envelope_sha256:ownerAlphaSuccessorSha256(envelope!)};
   const commandPayload=JSON.parse(command.payload_json) as Record<string,unknown>;
   requireThat(envelope&&Object.keys(commandPayload).sort().join(',')==='envelope_sha256,transition_id'&&commandPayload.transition_id===payload.transition_id&&commandPayload.envelope_sha256===payload.envelope_sha256&&command.body_hash===generation.activation_command_sha256&&
    envelope.transition_id===generation.transition_id&&envelope.predecessor.session_id===generation.predecessor.session_id&&envelope.predecessor.boot_id===generation.predecessor.boot_id&&
    envelope.successor.boot_id===generation.boot_id&&JSON.stringify(envelope.successor.policy)===JSON.stringify(generation.policy),
    'INVALID_CONFIGURATION','Owner-alpha generation differs from its activation receipt.',503);
   return generation;
  });
  for(let i=0;i<rows.length;i++){
   const generation=rows[i],prior=rows[i-1];
   requireThat(generation.epoch===i+2&&(!prior||generation.predecessor.boot_id===prior.boot_id&&generation.predecessor.session_id===prior.policy.session_id&&generation.activation_event_sequence>prior.activation_event_sequence),
    'INVALID_CONFIGURATION','Owner-alpha generation chain is not contiguous.',503);
  }
  const warmRows=this.store.db.all<{key:string;value_json:string}>("SELECT key,value_json FROM runtime_metadata WHERE key GLOB 'owner_alpha_warm_generation:*' ORDER BY CAST(substr(key,29) AS INTEGER)");
  requireThat(warmRows.length<=1,'INVALID_CONFIGURATION','Warm generation history is inconsistent.',503);
  const warm=warmRows.map(row=>{
   let generation:OwnerAlphaGeneration;
   try{generation=JSON.parse(row.value_json) as OwnerAlphaGeneration;}catch{throw new ControlError('INVALID_CONFIGURATION','Warm generation record is unreadable.',503);}
   requireThat(row.key===`owner_alpha_warm_generation:${generation?.epoch}`&&Number.isSafeInteger(generation?.epoch)&&generation.epoch>=2,'INVALID_CONFIGURATION','Invalid warm generation record.',503);
   // The persisted descriptor is write-once and carries no admissions; the
   // admissions view is reconstructed from separate append-only manifest rows.
   const persistedAuthority=generation.authority as WarmMessageBoundAuthority;
   requireThat('kind' in persistedAuthority&&persistedAuthority.kind==='owner-message-warm-generation'&&Array.isArray(persistedAuthority.admissions)&&persistedAuthority.admissions.length===0,
    'INVALID_CONFIGURATION','Invalid warm generation record.',503);
   generation={...generation,authority:{...persistedAuthority,admissions:warmAdmissionsView(this.store,generation.epoch)}};
   validateWarmGenerationView(this.store,generation);
   return generation as WarmGenerationView;
  });
  const backgroundRows=this.store.db.all<{key:string;value_json:string}>("SELECT key,value_json FROM runtime_metadata WHERE key GLOB 'owner_alpha_background_generation:*' ORDER BY CAST(substr(key,35) AS INTEGER)");
  requireThat(backgroundRows.length<=1,'INVALID_CONFIGURATION','Background generation history is inconsistent.',503);
  const background=backgroundRows.map(row=>{
   let generation:OwnerAlphaGeneration;
   try{generation=JSON.parse(row.value_json) as OwnerAlphaGeneration;}catch{throw new ControlError('INVALID_CONFIGURATION','Background generation record is unreadable.',503);}
   requireThat(row.key===`owner_alpha_background_generation:${generation?.epoch}`&&Number.isSafeInteger(generation?.epoch)&&generation.epoch>=2,'INVALID_CONFIGURATION','Invalid background generation record.',503);
   // The persisted descriptor is write-once and carries no admissions; the
   // admissions view is reconstructed from separate append-only manifest rows.
   const persistedAuthority=generation.authority as BackgroundMessageBoundAuthority;
   requireThat('kind' in persistedAuthority&&persistedAuthority.kind==='owner-message-background-generation'&&Array.isArray(persistedAuthority.admissions)&&persistedAuthority.admissions.length===0,
    'INVALID_CONFIGURATION','Invalid background generation record.',503);
   generation={...generation,authority:{...persistedAuthority,admissions:backgroundAdmissionsView(this.store,generation.epoch)}};
   validateBackgroundGenerationView(this.store,generation);
   return generation as BackgroundGenerationView;
  });
  const all=[...rows,...warm,...background].sort((x,y)=>x.epoch-y.epoch);
  for(let i=0;i<all.length;i++){
   const generation=all[i],prior=all[i-1];
   requireThat(generation.epoch===i+2&&(!prior||generation.predecessor.boot_id===prior.boot_id&&generation.predecessor.session_id===prior.policy.session_id&&generation.activation_event_sequence>prior.activation_event_sequence),
    'INVALID_CONFIGURATION','Owner-alpha generation chain is not contiguous.',503);
  }
  const identities=all.flatMap(g=>[g.boot_id,g.transition_id,g.policy.session_id]);
  requireThat(new Set(identities.map(value=>value.toLowerCase())).size===identities.length,'INVALID_CONFIGURATION','Owner-alpha generation identities are not unique.',503);
  return all;
 }
 private generationCustody(generation:OwnerAlphaGeneration):Custody {
  if('kind' in generation.authority&&generation.authority.kind==='owner-message-background-generation')return {policy:generation.policy,background:{manifests:structuredClone(generation.authority.admissions)},
   // Only the admitted coordinator roots are in custody; observed native
   // descendants validate through their native_task_links, never this list.
   // Admission order, not run_id order, so the first root stays the first root.
   admitted_run_ids:generation.authority.admissions.map(m=>m.run_id)};
  if('kind' in generation.authority&&generation.authority.kind==='owner-message-warm-generation')return {policy:generation.policy,warm:{manifests:structuredClone(generation.authority.admissions)},admitted_run_ids:this.store.db.all<{run_id:string}>(
   'SELECT run_id FROM attempts WHERE epoch=? AND boot_id=? ORDER BY run_id',generation.epoch,generation.boot_id).map(row=>row.run_id)};
  return {policy:generation.policy,...('kind' in generation.authority?{binding:generation.authority.manifest}:{}),admitted_run_ids:this.store.db.all<{run_id:string}>(
   'SELECT run_id FROM attempts WHERE epoch=? AND boot_id=? ORDER BY run_id',generation.epoch,generation.boot_id).map(row=>row.run_id)};
 }
 activeGeneration():OwnerAlphaGeneration|undefined {
  const rows=this.generations();if(!rows.length)return undefined;
  const state=this.store.db.all<{epoch:number;boot_id:string|null}>('SELECT epoch,boot_id FROM lifecycle')[0];
  const generation=rows.at(-1)!;
  requireThat(generation.epoch===state.epoch&&generation.boot_id===state.boot_id,'INVALID_CONFIGURATION','Active owner-alpha generation differs from lifecycle.',503);
  return generation;
 }
 generationFor(epoch:number,bootId:string):OwnerAlphaGeneration|undefined{return this.generations().find(g=>g.epoch===epoch&&g.boot_id===bootId);}
 private read():Custody {
  const row=this.store.db.all<{value_json:string}>('SELECT value_json FROM runtime_metadata WHERE key=?',key)[0];
  requireThat(row,'INVALID_CONFIGURATION','Owner-alpha custody is missing.',503);
  const saved=JSON.parse(row.value_json) as Custody;
  requireThat(JSON.stringify(saved.policy)===JSON.stringify(this.configuredPolicy)&&Array.isArray(saved.admitted_run_ids)&&saved.admitted_run_ids.every(id=>typeof id==='string'&&uuid.test(id))&&new Set(saved.admitted_run_ids).size===saved.admitted_run_ids.length&&saved.admitted_run_ids.length<=this.configuredPolicy!.max_runs,'INVALID_CONFIGURATION','Owner-alpha custody differs from configuration.',503);
  return saved;
 }
 initialize():void {
  this.store.db.transaction(()=>{
   const saved=this.store.db.all('SELECT key FROM runtime_metadata WHERE key=?',key).length;
   if(saved){
    const custody=this.read(),generations=this.generations();
    const state=this.store.db.all<{epoch:number;phase:string;boot_id:string|null;lease_until:string|null;provider_ref_json:string;provider_operation_id:string|null}>('SELECT epoch,phase,boot_id,lease_until,provider_ref_json,provider_operation_id FROM lifecycle')[0];
    const attempts=this.store.db.all<{run_id:string;attempt:number;epoch:number;boot_id:string}>('SELECT run_id,attempt,epoch,boot_id FROM attempts');
    const originalBoot=generations[0]?.predecessor.boot_id??(state?.epoch===1?state.boot_id:null);
    requireThat(state&&state.provider_ref_json==='{}'&&state.provider_operation_id===null&&
     (state.epoch===0&&state.phase==='STOPPED'&&state.boot_id===null&&state.lease_until===null&&attempts.length===0||
      state.epoch>=1&&['BOOTING','READY','RECOVERY_REQUIRED'].includes(state.phase)&&typeof state.boot_id==='string'&&uuid.test(state.boot_id))&&
     custody.admitted_run_ids.every(id=>attempts.some(a=>a.run_id===id&&a.epoch===1&&a.boot_id===originalBoot))&&attempts.every(a=>{
      const generation=generations.find(g=>g.epoch===a.epoch&&g.boot_id===a.boot_id),selected=generation?this.generationCustody(generation):(a.epoch===1&&a.boot_id===originalBoot?custody:undefined);
      return !!selected&&this.validAttempt(a.run_id,a.attempt,selected,a.epoch,a.boot_id,generation?.activation_event_sequence??0);
     })&&
     this.store.db.all<{run_id:string}>('SELECT run_id FROM native_task_links').every(link=>attempts.some(a=>a.run_id===link.run_id)&&!custody.admitted_run_ids.includes(link.run_id)),
     'INVALID_CONFIGURATION','Owner-alpha attempt custody is inconsistent.',503);
    requireThat(generations.length===0?state.epoch<=1:!!this.activeGeneration(),'INVALID_CONFIGURATION','Owner-alpha generation history is inconsistent.',503);
    for(const generation of generations)requireThat(uuid.test(generation.boot_id)&&uuid.test(generation.transition_id)&&(!!generation.policy.text_only!==!!generation.policy.background)&&
     (generation.epoch===2?generation.predecessor.session_id===custody.policy.session_id:true)&&
     this.generationCustody(generation).admitted_run_ids.length<=generation.policy.max_runs&&attempts.filter(a=>a.epoch===generation.epoch).every(a=>this.validAttempt(a.run_id,a.attempt,this.generationCustody(generation),a.epoch,a.boot_id,generation.activation_event_sequence)),
     'INVALID_CONFIGURATION','Owner-alpha generation custody is inconsistent.',503);
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
 available():boolean {
  if(!this.policy||this.now()>=this.policy.expires_at)return false;
  const generation=this.activeGeneration(),epoch=generation?.epoch??1;
  return this.store.db.all<{count:number}>("SELECT COUNT(*) AS count FROM attempts a JOIN runs r ON r.id=a.run_id WHERE a.epoch=? AND r.role='coordinator' AND r.parent_run_id IS NULL",epoch)[0].count<this.policy.max_runs;
 }
 private custody():Custody{const generation=this.activeGeneration();return generation?this.generationCustody(generation):this.read();}
 cutoff():number{
  const generation=this.activeGeneration();
  if(generation&&'kind' in generation.authority&&(generation.authority.kind==='owner-message-warm-generation'||generation.authority.kind==='owner-message-background-generation'))
   // Admitted warm/background messages sit AT their manifest event, not strictly after the
   // activation event like a legacy generation, so the cutoff is one below the
   // latest admitted sequence: claim selection uses `sequence > cutoff`.
   return Math.max(...generation.authority.admissions.map(m=>m.event_sequence))-1;
  return generation?.activation_event_sequence??0;
 }
 summary(){const policy=this.policy;if(!policy)return undefined;const custody=this.custody();return {policy,admittedRuns:custody.admitted_run_ids.length,generation:this.activeGeneration()};}
 directMessage(persona:string,commandId:string|null,routine:string|null,occurrence:string|null,room:string|null,cutoff=this.cutoff(),expectedPersona=this.policy?.persona_id):boolean {
  if(!expectedPersona||persona!==expectedPersona||!commandId||routine||occurrence||room)return false;
  const command=this.store.db.all<{type:string;owner_id:string;payload_json:string}>('SELECT type,owner_id,payload_json FROM commands WHERE id=?',commandId)[0];
  const event=this.store.db.all<{sequence:number;actor_id:string}>("SELECT sequence,actor_id FROM events WHERE id=? AND type='message.user'",commandId)[0];
  return !!command&&command.type==='message.send'&&!/^(runtime|trigger):/.test(command.owner_id)&&!!event&&event.actor_id===command.owner_id&&event.sequence>cutoff&&JSON.parse(command.payload_json).conversation_id===persona;
 }
 eligible(run:Run):boolean {
  const custody=this.custody();
  if(custody.background){
   const m=custody.background.manifests.find(item=>item.run_id===run.id);
   return !!m&&run.role==='coordinator'&&run.parent_run_id===null&&run.current_attempt===0&&
    this.directMessage(run.persona_id,run.command_id,run.routine_id,run.occurrence_id,JSON.parse(run.context_json).room_id??null,m.event_sequence-1,custody.policy.persona_id);
  }
  if(custody.warm){
   const m=custody.warm.manifests.find(item=>item.run_id===run.id);
   return !!m&&run.role==='coordinator'&&run.parent_run_id===null&&run.current_attempt===0&&
    this.directMessage(run.persona_id,run.command_id,run.routine_id,run.occurrence_id,JSON.parse(run.context_json).room_id??null,m.event_sequence-1,custody.policy.persona_id);
  }
  const binding=custody.binding;
  return (!binding||run.id===binding.run_id&&run.command_id===binding.command_id)&&run.role==='coordinator'&&run.current_attempt===0&&this.directMessage(run.persona_id,run.command_id,run.routine_id,run.occurrence_id,JSON.parse(run.context_json).room_id??null,binding?binding.event_sequence-1:this.cutoff());
 }
 admit(run:Run):string {
  const generation=this.activeGeneration();
  if(generation&&'kind' in generation.authority&&(generation.authority.kind==='owner-message-warm-generation'||generation.authority.kind==='owner-message-background-generation')){
   const m=generation.authority.admissions.find(item=>item.run_id===run.id);
   // A full second must remain so the separately signed task credential always
   // covers at least one whole JWT second after its deterministic iat; a claim
   // in the deadline's final partial second is rejected before any attempt row.
   requireThat(m&&run.current_attempt===0&&this.eligible(run)&&Date.parse(m.expires_at)-Date.parse(this.now())>=1000,
    'CAPABILITY_UNAVAILABLE','Owner-alpha admission is closed.');
   return m.expires_at;
  }
  requireThat(this.available()&&this.eligible(run),'CAPABILITY_UNAVAILABLE','Owner-alpha admission is closed.');
  if(!this.activeGeneration()){
   const saved=this.read();saved.admitted_run_ids.push(run.id);
   this.store.db.exec('UPDATE runtime_metadata SET value_json=? WHERE key=?',JSON.stringify(saved),key);
  }
  return new Date(Math.min(Date.parse(this.policy!.expires_at),Date.parse(this.now())+this.policy!.max_task_seconds*1000)).toISOString();
 }
 backgroundRoot(runId:string):boolean {
  if(!this.policy)return false;
  if(this.policy.background_first_root===true&&this.custody().admitted_run_ids[0]===runId)return true;
  const custody=this.custody();
  return !!custody.background&&custody.background.manifests.some(m=>m.role==='background'&&m.run_id===runId);
 }
 /** Manifest role of a background-generation root run; null for any other run. */
 backgroundCompletionRole(runId:string):BackgroundRole|null{
  const generation=this.activeGeneration();
  if(!generation||!('kind' in generation.authority)||generation.authority.kind!=='owner-message-background-generation')return null;
  return generation.authority.admissions.find(m=>m.run_id===runId)?.role??null;
 }
 propagateCancellation():void {
  if(!this.policy)return;
  const custody=this.custody();
  let rootId:string|undefined;
  if(this.policy?.background_first_root)rootId=custody.admitted_run_ids[0];
  else if(custody.background)rootId=custody.background.manifests.find(m=>m.role==='background')?.run_id;
  if(!rootId)return;
  const root=this.store.run(rootId);
  if(!['cancelling','cancelled','recovery_required'].includes(root.status))return;
  for(const child of this.store.db.all<Run>('SELECT * FROM runs WHERE parent_run_id=?',rootId)){
   const attempt=this.store.db.all<{epoch:number;boot_id:string}>('SELECT epoch,boot_id FROM attempts WHERE run_id=? AND attempt=1',child.id)[0];
   requireThat(!!attempt&&this.validAttempt(child.id,1,custody,attempt.epoch,attempt.boot_id),'STALE_EPOCH','Owner-alpha child custody is inconsistent.');
   if(!['claimed','running','finishing','cancelling','recovery_required'].includes(child.status))continue;
   const revoked=['OWNER_CANCELLED','CONTEXT_INVALIDATED'].includes(root.error_code??'');
   if(['cancelling','recovery_required'].includes(child.status)&&(!revoked||child.error_code===root.error_code))continue;
   this.store.db.exec('UPDATE runs SET status=?,error_code=?,updated_at=? WHERE id=?',child.status==='recovery_required'?'recovery_required':'cancelling',root.error_code??'OWNER_CANCELLED',['cancelling','recovery_required'].includes(child.status)?child.updated_at:this.now(),child.id);
  }
 }
 private validAttempt(runId:string,attempt:number,custody:Custody,epoch:number,bootId:string,cutoff=0):boolean {
  const run=this.store.db.all<Run>('SELECT * FROM runs WHERE id=?',runId)[0];
  const row=this.store.db.all<{epoch:number;boot_id:string;deadline_at:string;started_at:string;native_run_ref:string|null;submission_key:string}>('SELECT * FROM attempts WHERE run_id=? AND attempt=?',runId,attempt)[0];
  if(!run||!row||attempt!==1||run.current_attempt!==1||run.persona_id!==custody.policy.persona_id||row.epoch!==epoch||row.boot_id!==bootId)return false;
  if(custody.binding&&(runId!==custody.binding.run_id||run.command_id!==custody.binding.command_id||epoch!==custody.binding.epoch||bootId!==custody.binding.boot_id))return false;
  const link=this.store.db.all<{parent_run_id:string;parent_attempt:number;native_run_ref:string;native_session_key:string}>('SELECT * FROM native_task_links WHERE run_id=?',runId)[0];
  if(custody.background){
   const m=custody.background.manifests.find(item=>item.run_id===runId);
   if(m)return !link&&row.submission_key===`${runId}:1`&&run.command_id===m.command_id&&epoch===m.epoch&&bootId===m.boot_id&&
    this.directMessage(run.persona_id,run.command_id,run.routine_id,run.occurrence_id,JSON.parse(run.context_json).room_id??null,m.event_sequence-1,custody.policy.persona_id)&&
    row.deadline_at===m.expires_at&&row.deadline_at<=custody.policy.expires_at&&
    Date.parse(row.deadline_at)<=Date.parse(m.issued_at)+custody.policy.max_task_seconds*1000&&Number.isFinite(Date.parse(row.started_at));
   // Observed native descendants of the role-background root inherit its frozen deadline.
   if(!link||run.role!=='background'||run.parent_run_id!==link.parent_run_id)return false;
   const root=custody.background.manifests.find(item=>item.role==='background');
   if(!root||link.parent_run_id!==root.run_id||link.parent_attempt!==1||!link.native_session_key||!link.native_run_ref||run.parent_run_id!==root.run_id)return false;
   if(row.native_run_ref!==link.native_run_ref||row.submission_key!==`native:${link.native_run_ref}`)return false;
   if(!this.validAttempt(root.run_id,1,custody,epoch,bootId))return false;
   const parentAttempt=this.store.db.all<{deadline_at:string}>('SELECT deadline_at FROM attempts WHERE run_id=? AND attempt=1',root.run_id)[0];
   return !!parentAttempt&&row.deadline_at===parentAttempt.deadline_at&&row.deadline_at<=custody.policy.expires_at&&
    Number.isFinite(Date.parse(row.started_at));
  }
  if(custody.warm){
   const m=custody.warm.manifests.find(item=>item.run_id===runId);
   return !!m&&!link&&row.submission_key===`${runId}:1`&&run.command_id===m.command_id&&epoch===m.epoch&&bootId===m.boot_id&&
    this.directMessage(run.persona_id,run.command_id,run.routine_id,run.occurrence_id,JSON.parse(run.context_json).room_id??null,m.event_sequence-1,custody.policy.persona_id)&&
    row.deadline_at===m.expires_at&&row.deadline_at<=custody.policy.expires_at&&
    Date.parse(row.deadline_at)<=Date.parse(m.issued_at)+custody.policy.max_task_seconds*1000&&Number.isFinite(Date.parse(row.started_at));
  }
  if(custody.admitted_run_ids.includes(runId))return run.role==='coordinator'&&run.parent_run_id===null&&!link&&row.submission_key===`${runId}:1`&&
   this.directMessage(run.persona_id,run.command_id,run.routine_id,run.occurrence_id,JSON.parse(run.context_json).room_id??null,custody.binding?custody.binding.event_sequence-1:cutoff,custody.policy.persona_id)&&
   Number.isFinite(Date.parse(row.started_at))&&Number.isFinite(Date.parse(row.deadline_at))&&row.deadline_at<=custody.policy.expires_at&&Date.parse(row.deadline_at)<=Date.parse(row.started_at)+custody.policy.max_task_seconds*1000;
  if(!custody.policy.background_first_root||!link||run.role!=='background'||link.parent_run_id!==custody.admitted_run_ids[0]||run.parent_run_id!==link.parent_run_id||link.parent_attempt!==1||!link.native_session_key||!link.native_run_ref||row.native_run_ref!==link.native_run_ref||row.submission_key!==`native:${link.native_run_ref}`)return false;
  if(!this.validAttempt(link.parent_run_id,1,custody,epoch,bootId))return false;
  const parent=this.store.run(link.parent_run_id);
  const parentAttempt=this.store.db.all<{deadline_at:string}>('SELECT deadline_at FROM attempts WHERE run_id=? AND attempt=1',parent.id)[0];
  return row.deadline_at===parentAttempt.deadline_at&&run.command_id===parent.command_id&&run.routine_id===parent.routine_id&&run.occurrence_id===null;
 }
 authorize(runId:string,attempt:number):void {
  if(!this.policy)return;
  const row=this.store.db.all<{epoch:number;boot_id:string}>('SELECT epoch,boot_id FROM attempts WHERE run_id=? AND attempt=?',runId,attempt)[0];
  const generation=row&&this.generationFor(row.epoch,row.boot_id),custody=generation?this.generationCustody(generation):(row?.epoch===1?this.read():undefined);
  requireThat(!!custody&&this.validAttempt(runId,attempt,custody,row.epoch,row.boot_id,generation?.activation_event_sequence??0),'STALE_EPOCH','Attempt is not owned by this owner-alpha session.');
 }
 textOnly(runId:string):TextOnlyProfile|undefined {
  if(!this.configuredPolicy&&!this.generations().length)return undefined;
  const row=this.store.db.all<{epoch:number;boot_id:string}>('SELECT epoch,boot_id FROM attempts WHERE run_id=? AND attempt=(SELECT current_attempt FROM runs WHERE id=?)',runId,runId)[0];
  if(!row)return undefined;const generation=this.generationFor(row.epoch,row.boot_id),custody=generation?this.generationCustody(generation):(row.epoch===1?this.read():undefined);
  return custody?.policy.text_only&&custody.admitted_run_ids.includes(runId)?custody.policy.text_only:undefined;
 }
}
