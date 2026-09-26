import {createHash} from 'node:crypto';
import {requireThat} from './errors';
import type {ControlCore} from './control';
import type {Command,ContextSnapshot,PersonaPut,StoredObject,Run} from './types';

export type TestCampaignGrant={campaign_id:string;actor_id:string;persona_id:string;owner_binding_sha256:string;issued_at:string;expires_at:string;max_submissions:number};
const text='Reply exactly: HEHEBOT_NATIVE_TEST_OK. Do not use tools or access other data.';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const body=(id:string):PersonaPut=>({id,expected_revision:0,name:'Native synthetic test',instructions:text,tool_policy_ids:[],archived:false});
const command=(id:string):Command=>({schema_version:1,type:'message.send',payload:{conversation_id:id,text}});
const grantKey=(id:string)=>`test_campaign:${id}`;
const markerKey=(actor:string,key:string)=>`test_campaign_command:${hash([actor,key])}`;
type Provenance={grant:TestCampaignGrant;persona:StoredObject<PersonaPut>};
type CommandRow={id:string;owner_id:string;idempotency_key:string;body_hash:string;type:string;payload_json:string;resource_id:string|null};
export function parseTestCampaignGrant(raw:string|undefined):TestCampaignGrant|undefined {
 if(raw===undefined||raw==='')return undefined;
 let g:TestCampaignGrant;try{g=JSON.parse(raw);}catch{requireThat(false,'INVALID_CONFIGURATION','Invalid test campaign JSON.',503);}
 const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
 const utc=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
 requireThat(g&&typeof g==='object'&&!Array.isArray(g)&&Object.keys(g).sort().join(',')==='actor_id,campaign_id,expires_at,issued_at,max_submissions,owner_binding_sha256,persona_id'&&
  uuid(g.campaign_id)&&uuid(g.persona_id)&&typeof g.actor_id==='string'&&/^test-service:[A-Za-z0-9._-]{1,256}$/.test(g.actor_id)&&
  typeof g.owner_binding_sha256==='string'&&/^[0-9a-f]{64}$/.test(g.owner_binding_sha256)&&utc(g.issued_at)&&utc(g.expires_at)&&
  Date.parse(g.expires_at)>Date.parse(g.issued_at)&&Date.parse(g.expires_at)-Date.parse(g.issued_at)<=86400000&&Number.isInteger(g.max_submissions)&&g.max_submissions>=1&&g.max_submissions<=6,
  'INVALID_CONFIGURATION','Invalid test campaign grant.',503);
 return {campaign_id:g.campaign_id,actor_id:g.actor_id,persona_id:g.persona_id,owner_binding_sha256:g.owner_binding_sha256,issued_at:g.issued_at,expires_at:g.expires_at,max_submissions:g.max_submissions};
}
export class TestCampaign {
 constructor(private core:ControlCore){}
 private read<T>(key:string):T|undefined {const row=this.core.store.db.all<{value_json:string}>('SELECT value_json FROM runtime_metadata WHERE key=?',key)[0];return row?JSON.parse(row.value_json):undefined;}
 private put(key:string,value:unknown){this.core.store.db.exec('INSERT INTO runtime_metadata(key,value_json) VALUES(?,?)',key,JSON.stringify(value));}
 private configured(){const g=parseTestCampaignGrant(JSON.stringify(this.core.options.testCampaignGrant));requireThat(g,'FORBIDDEN','Test campaign unavailable.',403);requireThat(g.owner_binding_sha256===this.core.options.ownerBindingSha256,'FORBIDDEN','Test campaign owner binding mismatch.',403);return g;}
 private provenance(){const g=this.configured(),p=this.read<Provenance>(grantKey(g.campaign_id));requireThat(p&&hash(p.grant)===hash(g)&&hash(p.persona.body)===hash(body(g.persona_id))&&p.persona.id===g.persona_id&&p.persona.kind==='persona'&&p.persona.revision===1&&p.persona.deleted_at===null,'FORBIDDEN','Test campaign provenance is missing or changed.',403);return p;}
 private actor(actor:string){const p=this.provenance();requireThat(actor===p.grant.actor_id&&this.core.now()>=p.grant.issued_at&&this.core.now()<p.grant.expires_at,'FORBIDDEN','Test campaign authority unavailable.',403);return p;}
 private persona(p:Provenance){requireThat(hash(this.core.store.get(p.grant.persona_id,'persona'))===hash(p.persona),'FORBIDDEN','Synthetic persona changed.',403);}
 initialize():void {
  if(!this.core.options.testCampaignGrant)return;
  const g=this.configured();this.core.store.db.transaction(()=>{
   if(this.read(grantKey(g.campaign_id))){this.persona(this.provenance());return;}
   if(this.core.now()>=g.expires_at)return;
   requireThat(!this.core.store.db.all('SELECT id FROM objects WHERE id=?',g.persona_id).length,'FORBIDDEN','Cannot adopt an existing persona.',403);
   this.core.store.put(g.persona_id,'persona',body(g.persona_id),0,g.actor_id,this.core.now());
   this.put(grantKey(g.campaign_id),{grant:g,persona:this.core.store.get(g.persona_id,'persona')});
  });
 }
 private owned(actor:string,id:string){
  const p=this.actor(actor),c=this.core.store.db.all<CommandRow>('SELECT * FROM commands WHERE id=?',id)[0];
  requireThat(c&&c.owner_id===actor&&this.read<string>(markerKey(actor,c.idempotency_key))===hash(p)&&c.type==='message.send'&&c.body_hash===hash(command(p.grant.persona_id))&&hash(JSON.parse(c.payload_json))===hash(command(p.grant.persona_id).payload),'NOT_FOUND','Test command unavailable.',404);
  return {p,c};
 }
 private status(id:string){
  const r=this.core.store.db.all<Pick<Run,'status'>>('SELECT status FROM runs WHERE id=?',id)[0];
  requireThat(r,'NOT_FOUND','Run unavailable.',404);return r.status;
 }
 submit(actor:string,key:string){return this.core.store.db.transaction(()=>{
  const p=this.actor(actor);this.persona(p);
  const prior=this.core.store.db.all<{id:string}>('SELECT id FROM commands WHERE owner_id=? AND idempotency_key=?',actor,key)[0];
  if(prior)return this.receipt(actor,prior.id);
  const b=this.core.bootstrap.config;
  // An operator-configured unused-admission grant still goes through the normal
  // exact-custody checks. This principal cannot supply or replace that evidence.
  requireThat(b&&b.owner_id===actor&&b.persona_id===p.grant.persona_id&&b.owner_binding_sha256===p.grant.owner_binding_sha256&&b.expires_at<=p.grant.expires_at&&!b.claimed_pre_turn_quarantine&&!this.core.options.executionEnabled,'CAPABILITY_UNAVAILABLE','Test admission is unavailable.');
  // Count durable markers, not successful results: uncertainty never refunds a slot.
  const count=this.core.store.db.all<{n:number}>("SELECT COUNT(*) AS n FROM runtime_metadata WHERE key GLOB 'test_campaign_command:*' AND value_json=?",JSON.stringify(hash(p)))[0].n;
  requireThat(count<p.grant.max_submissions,'CAPABILITY_UNAVAILABLE','Test campaign submission limit reached.');
  const priorCommands=this.core.store.db.all<CommandRow>('SELECT * FROM commands WHERE owner_id=?',actor);
  for(const c of priorCommands)if(this.read<string>(markerKey(actor,c.idempotency_key))===hash(p)){
   const status=c.resource_id?this.status(c.resource_id):null;
   requireThat(status!==null&&['completed','failed','cancelled'].includes(status),'RESOURCE_BUSY','An earlier test is unsettled.');
  }
  this.put(markerKey(actor,key),hash(p));
  const input=command(p.grant.persona_id),receipt=this.core.accept(actor,key,hash(input),input),m=this.core.bootstrap.assignedManifest();
  requireThat(receipt.status==='applied'&&receipt.resource_id&&m?.command_id===receipt.id&&m.run_id===receipt.resource_id&&this.status(receipt.resource_id)==='queued','CAPABILITY_UNAVAILABLE','Test admission did not assign a fresh runnable manifest.');
  this.actor(actor);
  return receipt;
 });}
 receipt(actor:string,id:string){this.owned(actor,id);return this.core.receipt(id);}
 run(actor:string,id:string){
  const r=this.core.store.db.all<Pick<Run,'id'|'command_id'|'persona_id'|'parent_run_id'|'routine_id'|'occurrence_id'|'status'|'current_attempt'|'created_at'|'updated_at'>>('SELECT id,command_id,persona_id,parent_run_id,routine_id,occurrence_id,status,current_attempt,created_at,updated_at FROM runs WHERE id=?',id)[0];
  requireThat(r,'NOT_FOUND','Run unavailable.',404);
  requireThat(r.command_id,'NOT_FOUND','Test run unavailable.',404);const {c,p}=this.owned(actor,r.command_id);
  requireThat(c.resource_id===id&&r.persona_id===p.grant.persona_id&&!r.parent_run_id&&!r.routine_id&&!r.occurrence_id,'NOT_FOUND','Test run unavailable.',404);
  const event=this.core.store.db.all<{payload_json:string}>("SELECT payload_json FROM events WHERE type='run.result' AND actor_id='runtime' AND cause_id=? AND json_extract(payload_json,'$.run_id')=? ORDER BY sequence DESC LIMIT 1",c.id,id)[0];
  const result=event?JSON.parse(event.payload_json):null;
  return {id:r.id,command_id:r.command_id,status:r.status,current_attempt:r.current_attempt,created_at:r.created_at,updated_at:r.updated_at,result:result?{status:result.status,text:result.text}:null};
 }
 context(commandId:string,personaId:string,instruction:string,routineId:string|null,roomId:string|null):ContextSnapshot {
  const c=this.core.store.db.all<CommandRow>('SELECT * FROM commands WHERE id=?',commandId)[0];
  requireThat(c,'FORBIDDEN','Test command unavailable.',403);const {p}=this.owned(c.owner_id,commandId);this.persona(p);
  requireThat(personaId===p.grant.persona_id&&instruction===text&&routineId===null&&roomId===null,'FORBIDDEN','Test scope changed.',403);
  return {schema_version:1,persona:p.persona,routine:null,memories:[],skills:[],scope_key:`${personaId}/personal`,instruction:text,room_id:null,context_events:[],authorization_policy_ids:[]};
 }
}
