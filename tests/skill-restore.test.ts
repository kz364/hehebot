import {randomUUID} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {bot,fixture,otherBot} from './helpers';
import {LifecycleCore} from '../src/core/lifecycle';
import type {SkillBody} from '../src/core/types';

// Independent, asymmetric authored expectations: restoring must copy the whole
// historical body, not merge arrays or keep the current name/approval boundary.
const v1:SkillBody={name:'Reviewed draft',description:'Prepare a draft only.',when_to_use:'For a synthetic form.',inputs_access:['Reviewed fields'],steps:['Inspect','Fill'],decision_rules:['Stop on mismatch'],validation:['Check preview'],output:'Draft preview',failure_handling:['Report mismatch'],approval_boundaries:['Never submit'],contains_private_facts:false};
const v2:SkillBody={name:'Read-only audit',description:'Audit without filling.',when_to_use:'For an audit request.',inputs_access:['Synthetic page','Audit checklist'],steps:['Read'],decision_rules:['Skip unknown fields','Flag omissions'],validation:['Count omissions','Check labels'],output:'Audit report',failure_handling:['Stop and explain','Retain draft'],approval_boundaries:['Never fill','Never send'],contains_private_facts:false};
type Fixture=ReturnType<typeof fixture>;
const propose=(f:Fixture,skill:string,revision:number,body:SkillBody)=>{
 const id=randomUUID();
 expect(f.accept({schema_version:1,type:'skill.propose',payload:{proposal_id:id,skill_id:skill,expected_skill_revision:revision,body,provenance:{kind:'import',source_ref:'synthetic:procedure'},executable_files_changed:false}}).status).toBe('applied');
 return id;
};
const review=(id:string,revision:number,decision:'approve'|'reject'='approve')=>({schema_version:1 as const,type:'skill.review' as const,payload:{proposal_id:id,expected_proposal_revision:revision,decision}});
const restore=(skill:string,current=2,source=1)=>({schema_version:1 as const,type:'skill.restore' as const,payload:{proposal_id:randomUUID(),skill_id:skill,expected_skill_revision:current,source_revision:source}});
const seed=(f:Fixture)=>{
 const skill=randomUUID();
 expect(f.accept(review(propose(f,skill,0,v1),1)).status).toBe('applied');
 expect(f.accept(review(propose(f,skill,1,v2),2)).status).toBe('applied');
 return skill;
};
const enable=(f:Fixture,skill:string,persona=bot,enabled=true)=>expect(f.accept({schema_version:1,type:'skill.enable',payload:{skill_id:skill,expected_skill_revision:2,persona_id:persona,enabled}}).status).toBe('applied');
const proposalRow=(f:Fixture,id:string)=>f.db.all<{body_json:string;provenance_json:string;status:string;proposal_revision:number;expected_skill_revision:number;actor_id:string;command_id:string;executable_files_changed:number}>('SELECT * FROM skill_proposals WHERE id=?',id)[0];
const custody=(f:Fixture)=>({objects:f.db.all('SELECT * FROM objects ORDER BY id'),history:f.db.all('SELECT * FROM object_revisions ORDER BY object_id,revision'),proposals:f.db.all('SELECT * FROM skill_proposals ORDER BY id'),enablements:f.db.all('SELECT * FROM skill_enablements ORDER BY skill_id,persona_id'),events:f.db.all('SELECT * FROM events ORDER BY sequence'),runs:f.db.all('SELECT * FROM runs ORDER BY id'),lifecycle:f.db.all('SELECT * FROM lifecycle')});

describe('historical skill restore custody through commands and SQLite',()=>{
 it('stages owner-attributed v1 without activation; rejection preserves v2 and enablements',()=>{
  const f=fixture();try{
   const skill=seed(f);enable(f,skill);const before=custody(f),command=restore(skill),receipt=f.accept(command);
   expect(receipt.status).toBe('applied');expect(receipt.resource_id).toBe(command.payload.proposal_id);
   const row=proposalRow(f,command.payload.proposal_id);
   expect(row).toMatchObject({status:'pending',proposal_revision:3,expected_skill_revision:2,actor_id:'owner',command_id:receipt.id,executable_files_changed:0});
   expect(JSON.parse(row.body_json)).toEqual(v1);
   expect(JSON.parse(row.provenance_json)).toEqual({kind:'owner',source_ref:`restore:${skill}:1`});
   expect(custody(f)).toMatchObject({objects:before.objects,history:before.history,enablements:before.enablements,runs:before.runs,lifecycle:before.lifecycle});
   expect(f.core.context(bot,'pending',null,null).skills).toMatchObject([{id:skill,revision:2,body:v2}]);
   expect(f.accept(review(command.payload.proposal_id,3,'reject')).status).toBe('applied');
   expect(proposalRow(f,command.payload.proposal_id).status).toBe('rejected');
   expect(custody(f)).toMatchObject({objects:before.objects,history:before.history,enablements:before.enablements});
   expect(f.accept(review(command.payload.proposal_id,3)).error?.code).toBe('REVISION_CONFLICT');
  }finally{f.close();}
 });

 it('approves as v3, preserves real admitted v2 context, and changes only future enabled-bot context',()=>{
  const f=fixture(true);try{
   const skill=seed(f);enable(f,skill);enable(f,skill,otherBot);enable(f,skill,otherBot,false);
   expect(f.accept({schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'Audit this synthetic form'}}).status).toBe('applied');
   f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=1,lease_until='2026-09-10T00:02:00.000Z'");
   const life=new LifecycleCore(f.store,f.core),identity=life.registerBoot(randomUUID());life.ready(identity);
   const claim=life.claim(identity)!;expect(claim).toBeTruthy();
   const pinned=f.store.run(claim.run.id).context_json;
   expect(JSON.parse(pinned).skills).toMatchObject([{id:skill,revision:2,body:v2}]);
   const command=restore(skill);expect(f.accept(command).status).toBe('applied');
   expect(f.accept(review(command.payload.proposal_id,3)).status).toBe('applied');
   expect(f.store.get(skill,'skill')).toMatchObject({revision:3,body:v1});
   expect(f.store.run(claim.run.id).context_json).toBe(pinned);
   expect(f.core.context(bot,'future',null,null).skills).toMatchObject([{id:skill,revision:3,body:v1}]);
   expect(f.core.context(otherBot,'disabled sibling',null,null).skills).toEqual([]);
   expect(f.db.all('SELECT persona_id,skill_revision,enabled FROM skill_enablements WHERE skill_id=? ORDER BY persona_id',skill)).toEqual([{persona_id:bot,skill_revision:3,enabled:1},{persona_id:otherBot,skill_revision:2,enabled:0}].sort((a,b)=>a.persona_id.localeCompare(b.persona_id)));
   const history=f.db.all<{revision:number;body_json:string;actor_id:string}>('SELECT revision,body_json,actor_id FROM object_revisions WHERE object_id=? ORDER BY revision',skill);
   expect(history.map(r=>({revision:r.revision,body:JSON.parse(r.body_json),actor:r.actor_id}))).toEqual([{revision:1,body:v1,actor:'owner'},{revision:2,body:v2,actor:'owner'},{revision:3,body:v1,actor:'owner'}]);
  }finally{f.close();}
 });

 it('rejects stale current and absent source revisions without changing custody',()=>{
  const f=fixture();try{
   const skill=seed(f),before=custody(f);
   expect(f.accept(restore(skill,1,1)).error?.code).toBe('REVISION_CONFLICT');
   expect(f.accept(restore(skill,2,3)).error?.code).toBe('NOT_FOUND');
   expect(custody(f)).toEqual(before);
   // A current source is valid: source identifies content, not a required rollback distance.
   const current=restore(skill,2,2);expect(f.accept(current).status).toBe('applied');
   expect(JSON.parse(proposalRow(f,current.payload.proposal_id).body_json)).toEqual(v2);
  }finally{f.close();}
 });

 it('requires the exact proposal revision and blocks a second pending restore',()=>{
  const f=fixture();try{
   const skill=seed(f),command=restore(skill);expect(f.accept(command).status).toBe('applied');const before=custody(f);
   expect(f.accept(review(command.payload.proposal_id,2)).error?.code).toBe('REVISION_CONFLICT');
   expect(f.accept(restore(skill,2,2)).error?.code).toBe('REVISION_CONFLICT');expect(custody(f)).toEqual(before);
   expect(f.accept(review(command.payload.proposal_id,3,'reject')).status).toBe('applied');
   const retry=restore(skill);expect(f.accept(retry).status).toBe('applied');
   expect(proposalRow(f,retry.payload.proposal_id).proposal_revision).toBe(4);
   expect(f.accept(review(retry.payload.proposal_id,4)).status).toBe('applied');
   expect(f.store.get(skill,'skill')).toMatchObject({revision:3,body:v1});
  }finally{f.close();}
 });

 it('does not borrow another skill history or resurrect a deleted skill',()=>{
  const f=fixture();try{
   const skill=seed(f),missing=randomUUID();
   expect(f.accept(restore(missing)).error?.code).toBe('NOT_FOUND');
   // Simulate a missing historical row; other skill histories cannot fill the gap.
   const sibling=randomUUID();expect(f.accept(review(propose(f,sibling,0,{...v1,name:'Sibling draft'}),1)).status).toBe('applied');
   f.db.exec('DELETE FROM object_revisions WHERE object_id=? AND revision=1',skill);
   const before=custody(f);expect(f.accept(restore(skill)).error?.code).toBe('NOT_FOUND');expect(custody(f)).toEqual(before);
   expect(f.accept({schema_version:1,type:'skill.delete',payload:{id:skill,expected_revision:2}}).status).toBe('applied');
   const deleted=custody(f);expect(f.accept(restore(skill,3,2)).error?.code).toBe('NOT_FOUND');expect(custody(f)).toEqual(deleted);
  }finally{f.close();}
 });

 it('rejects approval if deletion changes the current revision after staging',()=>{
  const f=fixture();try{
   const skill=seed(f);enable(f,skill);const command=restore(skill);expect(f.accept(command).status).toBe('applied');
   expect(f.accept({schema_version:1,type:'skill.delete',payload:{id:skill,expected_revision:2}}).status).toBe('applied');
   const before=custody(f);expect(f.accept(review(command.payload.proposal_id,3)).error?.code).toBe('REVISION_CONFLICT');
   expect(custody(f)).toEqual(before);expect(proposalRow(f,command.payload.proposal_id).status).toBe('pending');
  }finally{f.close();}
 });

 it.each(['before staging','before approval'] as const)('checks historical duplicate names %s',timing=>{
  const f=fixture();try{
   const skill=seed(f),command=restore(skill);
   if(timing==='before approval')expect(f.accept(command).status).toBe('applied');
   const sibling=randomUUID();expect(f.accept(review(propose(f,sibling,0,{...v1,name:'  REVIEWED   DRAFT  '}),1)).status).toBe('applied');
   const before=custody(f);
   expect(f.accept(timing==='before staging'?command:review(command.payload.proposal_id,3)).error?.code).toBe('UPDATE_EXISTING_SKILL');
   expect(custody(f)).toEqual(before);expect(f.store.get(skill,'skill')).toMatchObject({revision:2,body:v2});
  }finally{f.close();}
 });

 it('replays restore and approval receipts without staging or applying twice, even after state changes',()=>{
  const f=fixture();try{
   const skill=seed(f),command=restore(skill),restoreKey=randomUUID(),staged=f.accept(command,restoreKey);
   expect(staged.status).toBe('applied');let before=custody(f);
   expect(f.accept(command,restoreKey)).toEqual(staged);expect(custody(f)).toEqual(before);
   const approval=review(command.payload.proposal_id,3),reviewKey=randomUUID(),approved=f.accept(approval,reviewKey);
   expect(approved.status).toBe('applied');before=custody(f);
   const changes=f.db.all('SELECT total_changes() AS n');
   expect(f.accept(command,restoreKey)).toEqual(staged);expect(f.accept(approval,reviewKey)).toEqual(approved);
   expect(f.db.all('SELECT total_changes() AS n')).toEqual(changes);expect(custody(f)).toEqual(before);
   expect(()=>f.accept({...command,payload:{...command.payload,source_revision:2}},restoreKey)).toThrowError(expect.objectContaining({code:'IDEMPOTENCY_CONFLICT'}));
   expect(f.accept(approval).error?.code).toBe('REVISION_CONFLICT');expect(custody(f)).toEqual(before);
   expect(f.store.get(skill,'skill')).toMatchObject({revision:3,body:v1});
  }finally{f.close();}
 });
});
