import {randomUUID} from 'node:crypto';
import {afterEach,beforeEach,expect,it} from 'vitest';
import {LifecycleCore} from '../src/core/lifecycle';
import {AgentCommandBoundary} from '../src/core/agent-commands';
import type {ContextSnapshot,SkillBody} from '../src/core/types';
import {bot,otherBot,fixture} from './helpers';

let f:ReturnType<typeof fixture>;
const body:SkillBody={name:'Compare values',description:'Synthetic arithmetic procedure.',when_to_use:'On explicit input.',inputs_access:['Two numbers'],steps:['Subtract the smaller from the larger.'],decision_rules:[],validation:['Check the difference.'],output:'Difference',failure_handling:['Report invalid input.'],approval_boundaries:['No new tool authority.'],contains_private_facts:false,references:[{name:'notes.md',text:'  Original 37\r\nReference text is not permission.  '}]};
beforeEach(()=>{f=fixture(true);});
afterEach(()=>f.close());
function approve(skillId=randomUUID(),revision=0,value=body){
 const proposal=randomUUID();expect(f.accept({schema_version:1,type:'skill.propose',payload:{proposal_id:proposal,skill_id:skillId,expected_skill_revision:revision,body:value,provenance:{kind:'owner',source_ref:'synthetic'},executable_files_changed:false}}).status).toBe('applied');
 expect(f.accept({schema_version:1,type:'skill.review',payload:{proposal_id:proposal,expected_proposal_revision:revision+1,decision:'approve'}}).status).toBe('applied');return skillId;
}
const request=(skill:string,persona=bot)=>({schema_version:1 as const,type:'skill.run' as const,payload:{skill_id:skill,expected_skill_revision:1,persona_id:persona,expected_persona_revision:1,text:'Compare 17 and 43.'}});
function ready(){
 const life=new LifecycleCore(f.store,f.core);
 f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=1,lease_until=?",new Date(Date.parse(f.core.now())+120000).toISOString());
 const identity=life.registerBoot(randomUUID());life.ready(identity);return {life,identity};
}
it('pins one approved skill without enabling it, keeps exact input, and deduplicates the ordinary run',()=>{
 const skill=approve(),unrelated=approve(undefined,0,{...body,name:'Unrelated'});
 expect(f.accept({schema_version:1,type:'skill.enable',payload:{skill_id:unrelated,expected_skill_revision:1,persona_id:bot,enabled:true}}).status).toBe('applied');
 const before=f.db.all('SELECT * FROM skill_enablements'),key=randomUUID(),command=request(skill);command.payload.text='  Compare 17 and 43.\n';
 const receipt=f.accept(command,key);expect(receipt.status).toBe('applied');expect(f.accept(command,key)).toEqual(receipt);
 const run=f.store.run(receipt.resource_id!),context=JSON.parse(run.context_json) as ContextSnapshot;
 expect(run).toMatchObject({persona_id:bot,status:'queued',current_attempt:0,routine_id:null,occurrence_id:null});
 expect(context).toMatchObject({instruction:command.payload.text,skill_invocation:{skill_id:skill,skill_revision:1},authorization_policy_ids:[],room_id:null});
 expect(context.skills.map(s=>[s.id,s.revision,s.body])).toEqual([[skill,1,body]]);expect(context.persona.body.tool_policy_ids).toEqual([]);
 expect(f.db.all('SELECT * FROM skill_enablements')).toEqual(before);expect(f.db.all('SELECT * FROM runs')).toHaveLength(1);
 expect(f.db.all<{payload_json:string}>("SELECT payload_json FROM events WHERE id=? AND type='message.user'",receipt.id).map(row=>JSON.parse(row.payload_json))).toEqual([{text:command.payload.text,skill_invocation:{skill_id:skill,skill_revision:1,skill_name:body.name}}]);
 expect(()=>f.accept({...command,payload:{...command.payload,text:'Changed'}},key)).toThrowError(expect.objectContaining({code:'IDEMPOTENCY_CONFLICT'}));
});
it('preserves the chosen revision through claim, deletion and retry, while another bot remains independent',()=>{
 const skill=approve(),first=f.accept(request(skill)),second=f.accept(request(skill,otherBot));
 const {life,identity}=ready();approve(skill,1,{...body,references:[{name:'notes.md',text:'Replacement 91'}]});
 expect(f.accept({schema_version:1,type:'skill.delete',payload:{id:skill,expected_revision:2}}).status).toBe('applied');
 // UUID ordering is not insertion order; select the first receipt explicitly.
 f.db.exec("UPDATE runs SET status='waiting' WHERE id=?",second.resource_id!);
 const claim=life.claim(identity)!;expect(claim.run.id).toBe(first.resource_id);
 const boundary=new AgentCommandBoundary(f.core,life);
 expect(boundary.skill({identity,run_id:claim.run.id,attempt:1,skill_id:skill}).skill.body).toEqual(body);
 const preserved=JSON.parse(claim.run.context_json).skills;
 life.complete(identity,claim.run.id,1,{status:'failed',text:'Synthetic failure',error_code:'NO_RETRY'});
 expect(f.accept({schema_version:1,type:'run.retry',payload:{run_id:claim.run.id,expected_attempt:1}}).status).toBe('applied');
 const retry=life.claim(identity)!;expect(retry.run.current_attempt).toBe(2);expect(JSON.parse(retry.run.context_json).skills).toEqual(preserved);
 expect(JSON.parse(f.store.run(second.resource_id!).context_json).persona.id).toBe(otherBot);
 expect(f.db.all('SELECT * FROM skill_enablements')).toEqual([]);
 expect(()=>boundary.accept({identity,run_id:retry.run.id,attempt:2,idempotency_key:randomUUID(),command:request(skill) as never})).toThrowError(expect.objectContaining({code:'FORBIDDEN'}));
});
it.each(['skill revision','persona revision','archived','pending','malformed','blank'] as const)('rejects %s atomically before creating a task or user event',kind=>{
 const skill=approve(),command=request(skill);
 if(kind==='skill revision')command.payload.expected_skill_revision=2;
 if(kind==='persona revision')command.payload.expected_persona_revision=2;
 if(kind==='archived')f.db.exec("UPDATE objects SET body_json=json_set(body_json,'$.archived',json('true')) WHERE id=?",bot);
 if(kind==='pending')command.payload.skill_id=randomUUID();
 if(kind==='malformed')f.db.exec("UPDATE objects SET body_json=json_set(body_json,'$.references',json('[null]')) WHERE id=?",skill);
 if(kind==='blank')command.payload.text=' \n ';
 const events=f.db.all('SELECT * FROM events'),state=f.db.all('SELECT * FROM lifecycle');
 expect(f.accept(command).status).toBe('rejected');expect(f.db.all('SELECT * FROM runs')).toEqual([]);expect(f.db.all('SELECT * FROM events')).toEqual(events);expect(f.db.all('SELECT * FROM lifecycle')).toEqual(state);
});
it('preserves the execution gate and does not admit through owner alpha',()=>{
 const skill=approve();f.core.options.executionEnabled=false;
 const receipt=f.accept(request(skill));expect(f.store.run(receipt.resource_id!)).toMatchObject({status:'waiting',error_code:'CAPABILITY_UNAVAILABLE'});
 const state=f.db.all('SELECT * FROM lifecycle');expect(state[0]).toMatchObject({desired_state:'STOP',queue_sequence:0});
 Object.defineProperty(f.core.ownerAlpha,'policy',{value:{session_id:randomUUID(),persona_id:bot,expires_at:'2099-01-01T00:00:00.000Z',max_runs:1,max_task_seconds:60}});
 expect(f.accept(request(skill))).toMatchObject({status:'rejected',error:{code:'CAPABILITY_UNAVAILABLE'}});expect(f.db.all('SELECT * FROM runs')).toHaveLength(1);expect(f.db.all('SELECT * FROM lifecycle')).toEqual(state);
});
it('applies the message byte bound independently of the schema codepoint bound',()=>{
 const command=request(approve());command.payload.text='😀'.repeat(8193);
 expect(()=>f.accept(command)).toThrowError(expect.objectContaining({code:'PAYLOAD_TOO_LARGE'}));expect(f.db.all('SELECT * FROM runs')).toEqual([]);
});
it('expires unstarted pinned context at 30 days rather than selecting a different revision',()=>{
 const command=request(approve()),receipt=f.accept(command),id=receipt.resource_id!;
 f.setNow('2026-10-09T23:59:59.999Z');expect(f.core.expireQueuedContexts()).toBe(0);
 f.setNow('2026-10-10T00:00:00.000Z');const {life,identity}=ready();expect(life.claim(identity)).toBeNull();
 f.db.exec("UPDATE runs SET status='waiting' WHERE id=?",id);
 expect(f.accept({schema_version:1,type:'run.retry',payload:{run_id:id,expected_attempt:0}})).toMatchObject({status:'rejected',error:{code:'MESSAGE_EXPIRED'}});
 const fresh=f.accept({schema_version:1,type:'message.send',payload:{conversation_id:otherBot,text:'Fresh independent input'}});expect(life.claim(identity)?.run.id).toBe(fresh.resource_id);
 expect(f.core.expireQueuedContexts()).toBe(1);expect(f.store.run(id)).toMatchObject({status:'failed',error_code:'MESSAGE_EXPIRED',context_json:'{}'});
 expect(f.db.all<{payload_json:string}>("SELECT payload_json FROM events WHERE type='run.input_expired'").map(row=>JSON.parse(row.payload_json))).toEqual([{run_id:id,reason:'MESSAGE_EXPIRED',requires_fresh_request:true,skill_invocation:{skill_id:command.payload.skill_id,skill_revision:1}}]);
 expect(f.accept({schema_version:1,type:'run.retry',payload:{run_id:id,expected_attempt:0}})).toMatchObject({status:'rejected',error:{code:'MESSAGE_EXPIRED'}});
 expect(f.core.receipt(receipt.id)).toEqual(receipt);
});
it.each(['missing marker','missing body','wrong revision'])('does not substitute enabled skills when persisted selection has %s',change=>{
 const command=request(approve()),receipt=f.accept(command),run=f.store.run(receipt.resource_id!),context=JSON.parse(run.context_json);
 if(change==='missing marker')delete context.skill_invocation;
 if(change==='missing body')context.skills=[];
 if(change==='wrong revision')context.skills[0].revision=9;
 f.db.exec('UPDATE runs SET context_json=? WHERE id=?',JSON.stringify(context),run.id);
 const {life,identity}=ready();expect(()=>life.claim(identity)).toThrowError(expect.objectContaining({code:'REVISION_CONFLICT'}));
 expect(f.db.all('SELECT * FROM attempts')).toEqual([]);expect(f.store.run(run.id).status).toBe('queued');
});
