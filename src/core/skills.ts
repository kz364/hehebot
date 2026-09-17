import {requireThat} from './errors';
import {Store} from './store';
import type {SkillBody,SkillProposal,StoredObject} from './types';
import validateCommand from '../generated/validate-command.js';

type ProposalRow={id:string;skill_id:string;proposal_revision:number;expected_skill_revision:number;body_json:string;provenance_json:string;status:string;executable_files_changed:number};
const normalized=(value:string)=>value.trim().toLocaleLowerCase('en-US').replace(/\s+/g,' ');

export class SkillCatalog {
 constructor(private store:Store,private now:()=>string,private uuid:()=>string){}
 private validateProposal(p:SkillProposal):void {
  requireThat(!p.executable_files_changed,'CAPABILITY_UNAVAILABLE','Executable skill files require a separately configured capability review.');
  // Restores and imported pending proposals do not pass command ingress with
  // their retained body. Reuse the canonical schema before accepting that data.
  requireThat(validateCommand({schema_version:1,type:'skill.propose',payload:p}),'INVALID_INPUT','The skill proposal contains invalid or missing fields.',422);
  const references=p.body.references??[];
  requireThat(new Set(references.map(reference=>reference.name)).size===references.length,'INVALID_INPUT','Supporting reference names must be unique.',422);
 }
 history(skillId:string,before?:number,limit=10){
  requireThat(before===undefined||Number.isSafeInteger(before)&&before>0,'INVALID_INPUT','Invalid revision cursor.',422);
  requireThat(Number.isInteger(limit)&&limit>=1&&limit<=20,'INVALID_INPUT','Limit must be 1–20.',422);
  const current=this.store.get(skillId,'skill');
  const rows=this.store.db.all<{revision:number;body_json:string;created_at:string}>(
   'SELECT revision,body_json,created_at FROM object_revisions WHERE object_id=? AND (? IS NULL OR revision<?) ORDER BY revision DESC LIMIT ?',skillId,before??null,before??null,limit+1);
  const revisions=rows.slice(0,limit).map(({body_json,...row})=>({...row,body:JSON.parse(body_json) as SkillBody}));
  return {skill_id:skillId,current_revision:current.revision,revisions,next_cursor:rows.length>limit?revisions.at(-1)!.revision:null};
 }
 propose(owner:string,commandId:string,p:SkillProposal):string {
  this.validateProposal(p);
  const existing=this.store.db.all<{revision:number;kind:string;deleted_at:string|null}>('SELECT revision,kind,deleted_at FROM objects WHERE id=?',p.skill_id)[0];
  requireThat((existing?.revision??0)===p.expected_skill_revision&&(!existing||existing.kind==='skill'&&!existing.deleted_at),'REVISION_CONFLICT','Reload the skill before proposing this change.');
  const duplicate=this.store.list<SkillBody>('skill').find(x=>x.id!==p.skill_id&&normalized(x.body.name)===normalized(p.body.name));
  requireThat(!duplicate,'UPDATE_EXISTING_SKILL','A skill with this name already exists; propose an update to its stable ID.',409);
  const pending=this.store.db.all<ProposalRow>("SELECT * FROM skill_proposals WHERE skill_id=? AND status='pending' ORDER BY proposal_revision DESC LIMIT 1",p.skill_id)[0];
  requireThat(!pending,'REVISION_CONFLICT','Review or reject the pending proposal before staging another.');
  const next=(this.store.db.all<{n:number}>('SELECT COALESCE(MAX(proposal_revision),0)+1 AS n FROM skill_proposals WHERE skill_id=?',p.skill_id)[0]?.n??1);
  this.store.db.exec("INSERT INTO skill_proposals(id,skill_id,proposal_revision,expected_skill_revision,body_json,provenance_json,status,executable_files_changed,actor_id,command_id,created_at) VALUES(?,?,?,?,?,?,'pending',?,?,?,?)",p.proposal_id,p.skill_id,next,p.expected_skill_revision,JSON.stringify(p.body),JSON.stringify(p.provenance),0,owner,commandId,this.now());
  this.store.event(this.uuid(),null,'skill.proposal_staged',owner,commandId,{proposal_id:p.proposal_id,skill_id:p.skill_id,proposal_revision:next,provenance:p.provenance,executable_files_changed:false},this.now());
  return p.proposal_id;
 }
 review(owner:string,commandId:string,p:{proposal_id:string;expected_proposal_revision:number;decision:'approve'|'reject'}):string {
  const row=this.store.db.all<ProposalRow>('SELECT * FROM skill_proposals WHERE id=?',p.proposal_id)[0];
  requireThat(row&&row.status==='pending','REVISION_CONFLICT','This proposal is no longer pending.');
  requireThat(row.proposal_revision===p.expected_proposal_revision,'REVISION_CONFLICT','Reload the proposal before reviewing it.');
  if(p.decision==='approve'){
   const body=JSON.parse(row.body_json) as SkillBody;
   this.validateProposal({proposal_id:row.id,skill_id:row.skill_id,expected_skill_revision:row.expected_skill_revision,body,provenance:JSON.parse(row.provenance_json),executable_files_changed:!!row.executable_files_changed});
   const duplicate=this.store.list<SkillBody>('skill').find(x=>x.id!==row.skill_id&&normalized(x.body.name)===normalized(body.name));
   requireThat(!duplicate,'UPDATE_EXISTING_SKILL','A skill with this name was approved while this proposal was pending; update its stable ID.',409);
   const revision=this.store.put(row.skill_id,'skill',body,row.expected_skill_revision,owner,this.now(),commandId);
   this.store.db.exec('UPDATE skill_enablements SET skill_revision=?,updated_at=? WHERE skill_id=? AND enabled=1',revision,this.now(),row.skill_id);
  }
  this.store.db.exec('UPDATE skill_proposals SET status=?,reviewed_by=?,reviewed_at=? WHERE id=?',p.decision==='approve'?'approved':'rejected',owner,this.now(),p.proposal_id);
  this.store.event(this.uuid(),null,`skill.proposal_${p.decision==='approve'?'approved':'rejected'}`,owner,commandId,{proposal_id:p.proposal_id,skill_id:row.skill_id},this.now());
  return row.skill_id;
 }
 enable(owner:string,commandId:string,p:{skill_id:string;expected_skill_revision:number;persona_id:string;enabled:boolean}):string {
  const skill=this.store.get<SkillBody>(p.skill_id,'skill');
  requireThat(skill.revision===p.expected_skill_revision,'REVISION_CONFLICT','Reload the skill before changing enablement.');
  const persona=this.store.get<{archived:boolean}>(p.persona_id,'persona');requireThat(!persona.body.archived,'CAPABILITY_UNAVAILABLE','This bot is archived.');
  this.store.db.exec('INSERT INTO skill_enablements(skill_id,persona_id,skill_revision,enabled,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(skill_id,persona_id) DO UPDATE SET skill_revision=excluded.skill_revision,enabled=excluded.enabled,updated_at=excluded.updated_at',p.skill_id,p.persona_id,skill.revision,p.enabled?1:0,this.now());
  this.store.event(this.uuid(),p.persona_id,'skill.enablement_updated',owner,commandId,{skill_id:p.skill_id,skill_revision:skill.revision,enabled:p.enabled},this.now());return p.skill_id;
 }
 remove(owner:string,commandId:string,p:{id:string;expected_revision:number}):string {
  const skill=this.store.get(p.id,'skill');requireThat(skill.revision===p.expected_revision,'REVISION_CONFLICT','Reload the skill before deleting it.');
  this.store.db.exec('UPDATE objects SET deleted_at=?,updated_at=?,revision=revision+1 WHERE id=?',this.now(),this.now(),p.id);
  this.store.db.exec('UPDATE skill_enablements SET enabled=0,updated_at=? WHERE skill_id=?',this.now(),p.id);
  this.store.event(this.uuid(),null,'skill.deleted',owner,commandId,{skill_id:p.id,revision:skill.revision+1},this.now());return p.id;
 }
 restore(owner:string,commandId:string,p:{proposal_id:string;skill_id:string;expected_skill_revision:number;source_revision:number}):string {
  const current=this.store.get(p.skill_id,'skill');requireThat(current.revision===p.expected_skill_revision,'REVISION_CONFLICT','Reload the skill before restoring it.');
  const source=this.store.db.all<{body_json:string}>('SELECT body_json FROM object_revisions WHERE object_id=? AND revision=?',p.skill_id,p.source_revision)[0];requireThat(source,'NOT_FOUND','That skill revision is unavailable.',404);
  return this.propose(owner,commandId,{proposal_id:p.proposal_id,skill_id:p.skill_id,expected_skill_revision:p.expected_skill_revision,body:JSON.parse(source.body_json),provenance:{kind:'owner',source_ref:`restore:${p.skill_id}:${p.source_revision}`},executable_files_changed:false});
 }
 enabled(personaId:string):StoredObject<SkillBody>[] {
  return this.store.db.all<{id:string;revision:number;body_json:string;created_at:string;updated_at:string}>("SELECT o.id,e.skill_revision AS revision,r.body_json,o.created_at,o.updated_at FROM skill_enablements e JOIN objects o ON o.id=e.skill_id AND o.deleted_at IS NULL JOIN object_revisions r ON r.object_id=e.skill_id AND r.revision=e.skill_revision WHERE e.persona_id=? AND e.enabled=1 ORDER BY o.created_at,o.id",personaId).map(({body_json,...row})=>({...row,kind:'skill',deleted_at:null,body:JSON.parse(body_json)}));
 }
}
