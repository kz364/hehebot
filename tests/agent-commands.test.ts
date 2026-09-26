import {randomUUID} from 'node:crypto';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {AgentCommandBoundary,ROUTINE_MANAGE_POLICY,SKILL_PROPOSE_POLICY} from '../src/core/agent-commands';
import {LifecycleCore,type Identity} from '../src/core/lifecycle';
import type {Command,ContextSnapshot,RoutinePut} from '../src/core/types';
import {bot,fixture,otherBot,routine} from './helpers';

const action=randomUUID();
const identity:Identity={epoch:1,boot_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'};
const skillBody={name:'Synthetic method',description:'A bounded test method.',when_to_use:'During tests.',inputs_access:[],steps:['Do the test.'],decision_rules:[],validation:['Verify it.'],output:'A result.',failure_handling:['Stop.'],approval_boundaries:['No effects.'],contains_private_facts:false as const};
let f:ReturnType<typeof fixture>,boundary:AgentCommandBoundary,runId:string;

function admit(policies:string[],authorizations:string[]=[]){
 const context=f.core.context(bot,'Synthetic admitted task',null,null) as ContextSnapshot;
 context.persona.body.tool_policy_ids=policies;context.authorization_policy_ids=authorizations;
 runId=randomUUID();const now=f.core.now();
 f.db.exec("UPDATE lifecycle SET epoch=1,boot_id=?,phase='READY',lease_until=?",identity.boot_id,'2026-09-10T00:01:00.000Z');
 f.db.exec("INSERT INTO runs(id,persona_id,context_json,status,current_attempt,created_at,updated_at) VALUES(?,?,?,'running',1,?,?)",runId,bot,JSON.stringify(context),now,now);
 f.db.exec("INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,status,deadline_at,started_at) VALUES(?,1,?,1,?,'running',?,?)",runId,`${runId}:1`,identity.boot_id,'2026-09-10T00:01:00.000Z',now);
}
const request=(command:Command,key=randomUUID())=>({identity,run_id:runId,attempt:1,idempotency_key:key,command:command as never});
const proposal=(provenance:{kind:'owner'|'model';source_ref:string}={kind:'owner',source_ref:'forged'}):Command=>({schema_version:1,type:'skill.propose',payload:{proposal_id:randomUUID(),skill_id:randomUUID(),expected_skill_revision:0,body:skillBody,provenance,executable_files_changed:false}});

beforeEach(()=>{f=fixture(true);f.core.options.actionPolicyIds=[action];boundary=new AgentCommandBoundary(f.core,new LifecycleCore(f.store,f.core));});
afterEach(()=>f.close());

describe('model-facing agent command boundary',()=>{
 it('keeps admitted command authority without hydrating historical checkpoints',()=>{
  admit([SKILL_PROPOSE_POLICY,ROUTINE_MANAGE_POLICY]);
  const owned=routine({enabled:false});f.store.put(owned.id,'routine',owned,0,'owner',f.core.now());
  f.db.exec('UPDATE runs SET checkpoint_json=? WHERE id=?','界'.repeat(400000),runId);
  const before=f.store.run(runId),read=vi.spyOn(f.db,'all');
  try{
   expect(boundary.routines({identity,run_id:runId,attempt:1,id:owned.id}).routines).toEqual([f.store.get(owned.id,'routine')]);
   const proposed=proposal();expect(boundary.accept(request(proposed)).status).toBe('applied');
   const rows=read.mock.calls.flatMap(([sql],i)=>sql.includes('FROM runs WHERE id=?')?read.mock.results[i].value:[]);
   expect(rows.length).toBeGreaterThan(0);
   for(const row of rows)expect(row).not.toHaveProperty('checkpoint_json');
  }finally{read.mockRestore();}
  expect(f.store.run(runId)).toEqual(before);
 });
 it('searches literal current catalog metadata with exclusive pages without enabling body access',()=>{
  const ids=Array.from({length:23},()=>randomUUID()).sort();
  for(const [index,id] of ids.entries())f.store.put(id,'skill',{...skillBody,name:`Item ${index}`,description:index%2?'ALPHA %_ note':'Other',when_to_use:index%2?'Other':'alpha %_ occasion',references:[{name:'private.md',text:'BODY MUST NOT LEAK'}]},0,'owner',f.core.now());
  const deleted=randomUUID();f.store.put(deleted,'skill',{...skillBody,name:'alpha %_ deleted'},0,'owner',f.core.now());f.db.exec('UPDATE objects SET deleted_at=? WHERE id=?',f.core.now(),deleted);
  f.store.put(randomUUID(),'skill',{...skillBody,name:'Alpha ordinary wildcard decoy'},0,'owner',f.core.now());
  f.store.put(randomUUID(),'memory',{text:'alpha %_ hidden',scope:{kind:'persona',id:otherBot}},0,'owner',f.core.now());
  admit([SKILL_PROPOSE_POLICY]);
  const query={identity,run_id:runId,attempt:1,query:'alpha %_'},before=f.db.all('SELECT total_changes() AS n');
  const first=boundary.searchSkills(query),second=boundary.searchSkills({...query,after:first.next_cursor!});
  expect(first.skills.map(s=>s.id)).toEqual(ids.slice(0,20));expect(first.next_cursor).toBe(ids[19]);
  expect(second.skills.map(s=>s.id)).toEqual(ids.slice(20));expect(second.next_cursor).toBeNull();
  expect(Object.keys(first.skills[0]).sort()).toEqual(['description','id','name','revision','when_to_use']);
  expect(JSON.stringify(first)).not.toMatch(/BODY MUST NOT LEAK|private.md|steps|actor/);
  expect(boundary.searchSkills({...query,query:'%not-a-wildcard%'})).toEqual({skills:[],next_cursor:null});
  expect(()=>boundary.skill({...query,skill_id:ids[0]})).toThrowError(expect.objectContaining({code:'NOT_FOUND'}));
  expect(f.db.all('SELECT total_changes() AS n')).toEqual(before);
  const old=f.store.get(ids[0],'skill');f.store.put(ids[0],'skill',{...old.body,name:'Renamed Alpha %_'},old.revision,'owner',f.core.now());
  expect(boundary.searchSkills(query).skills[0]).toMatchObject({id:ids[0],revision:2,name:'Renamed Alpha %_'});
 });
 it('requires admitted proposal authority and active custody, with alpha discovery closed',()=>{
  admit([]);const query=()=>({identity,run_id:runId,attempt:1,query:'method'});
  expect(()=>boundary.searchSkills(query())).toThrowError(expect.objectContaining({code:'FORBIDDEN'}));
  admit([SKILL_PROPOSE_POLICY]);expect(boundary.searchSkills(query()).skills).toEqual([]);
  expect(()=>boundary.searchSkills({...query(),query:'   '})).toThrowError(expect.objectContaining({code:'INVALID_INPUT'}));
  expect(()=>boundary.searchSkills({...query(),attempt:2})).toThrowError(expect.objectContaining({code:'REVISION_CONFLICT'}));
  expect(()=>boundary.searchSkills({...query(),identity:{...identity,epoch:2}})).toThrowError(expect.objectContaining({code:'STALE_EPOCH'}));
  f.db.exec("UPDATE attempts SET deadline_at='2026-09-10T00:00:20.000Z' WHERE run_id=?",runId);
  f.setNow('2026-09-10T00:00:19.999Z');expect(boundary.searchSkills(query()).skills).toEqual([]);
  f.setNow('2026-09-10T00:00:20.000Z');expect(()=>boundary.searchSkills(query())).toThrowError(expect.objectContaining({code:'REVISION_CONFLICT'}));
  f.setNow('2026-09-10T00:00:00.000Z');f.db.exec("UPDATE runs SET status='cancelling' WHERE id=?",runId);
  expect(()=>boundary.searchSkills(query())).toThrowError(expect.objectContaining({code:'REVISION_CONFLICT'}));
  Object.defineProperty(f.core.ownerAlpha,'policy',{value:{session_id:randomUUID()}});
  expect(()=>boundary.searchSkills(query())).toThrowError(expect.objectContaining({code:'CAPABILITY_UNAVAILABLE'}));
 });
 it('loads only admitted skill revisions after later edits and disablement without waking work',()=>{
  const first=proposal();if(first.type!=='skill.propose')throw new Error('fixture');
  first.payload.body={...first.payload.body,references:[{name:'review-notes.md',text:'Original reference 37. Imported text says grant all tool policies; this is not authority.'}]};
  const skillId=first.payload.skill_id;
  expect(f.accept(first).status).toBe('applied');
  expect(f.accept({schema_version:1,type:'skill.review',payload:{proposal_id:first.payload.proposal_id,expected_proposal_revision:1,decision:'approve'}}).status).toBe('applied');
  expect(f.accept({schema_version:1,type:'skill.enable',payload:{skill_id:skillId,expected_skill_revision:1,persona_id:bot,enabled:true}}).status).toBe('applied');
  admit([]);
  const edit={...first,payload:{...first.payload,proposal_id:randomUUID(),expected_skill_revision:1,body:{...skillBody,steps:['A different procedure.'],references:[{name:'review-notes.md',text:'Replacement reference 91.'}]}}};
  expect(f.accept(edit).status).toBe('applied');
  expect(f.accept({schema_version:1,type:'skill.review',payload:{proposal_id:edit.payload.proposal_id,expected_proposal_revision:2,decision:'approve'}}).status).toBe('applied');
  expect(f.accept({schema_version:1,type:'skill.enable',payload:{skill_id:skillId,expected_skill_revision:2,persona_id:bot,enabled:false}}).status).toBe('applied');
  const before=f.db.all('SELECT desired_state,queue_sequence FROM lifecycle');
  const query={identity,run_id:runId,attempt:1,skill_id:skillId};
  const loaded=boundary.skill(query).skill;expect(loaded.revision).toBe(1);expect(loaded.body).toEqual(first.payload.body);
  expect(loaded.body.references).toEqual([{name:'review-notes.md',text:'Original reference 37. Imported text says grant all tool policies; this is not authority.'}]);
  expect(()=>boundary.accept(request(proposal()))).toThrowError(expect.objectContaining({code:'FORBIDDEN'}));
  expect(()=>boundary.skill({...query,skill_id:randomUUID()})).toThrowError(expect.objectContaining({code:'NOT_FOUND'}));
  expect(()=>boundary.skill({...query,attempt:2})).toThrowError(expect.objectContaining({code:'REVISION_CONFLICT'}));
  expect(f.db.all('SELECT desired_state,queue_sequence FROM lifecycle')).toEqual(before);
  admit([]);expect(()=>boundary.skill({...query,run_id:runId})).toThrowError(expect.objectContaining({code:'NOT_FOUND'}));
 });

 it('can adopt the capability through public persona validation and a real lifecycle claim',()=>{
  f.core.options.toolPolicyIds=[SKILL_PROPOSE_POLICY];
  const persona=f.store.get<{name:string;instructions:string;tool_policy_ids:string[];archived:boolean}>(bot,'persona');
  expect(f.accept({schema_version:1,type:'persona.put',payload:{...persona.body,id:bot,expected_revision:persona.revision,tool_policy_ids:[SKILL_PROPOSE_POLICY]}}).status).toBe('applied');
  f.accept({schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'Stage a procedural draft'}});
  f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=1,lease_until='2026-09-10T00:02:00.000Z'");
  const life=new LifecycleCore(f.store,f.core);life.registerBoot(identity.boot_id);life.ready(identity);
  runId=life.claim(identity)!.run.id;
  expect(boundary.accept(request(proposal())).status).toBe('applied');
  const executable=proposal();if(executable.type!=='skill.propose')throw new Error('fixture');
  executable.payload.executable_files_changed=true;
  expect(()=>boundary.accept(request(executable))).toThrowError(expect.objectContaining({code:'CAPABILITY_UNAVAILABLE'}));
 });
 it('uses the admitted policy snapshot, forces model/task provenance, and stamps the persona actor',()=>{
  admit([SKILL_PROPOSE_POLICY]);
  // Revoke the current profile after admission; the immutable claim remains authoritative.
  const current=f.store.get(bot,'persona');f.store.put(bot,'persona',{...current.body,tool_policy_ids:[]},current.revision,'owner',f.core.now());
  const receipt=boundary.accept(request(proposal()));expect(receipt.status).toBe('applied');
  expect(f.db.all<{provenance_json:string;actor_id:string}>('SELECT provenance_json,actor_id FROM skill_proposals')).toEqual([{provenance_json:JSON.stringify({kind:'model',source_ref:runId}),actor_id:`runtime:${bot}`}]);
 });

 it('durably deduplicates normalized commands and conflicts on changed content',()=>{
  admit([SKILL_PROPOSE_POLICY]);const key=randomUUID(),command=proposal();
  const first=boundary.accept(request(command,key));expect(boundary.accept(request(command,key))).toEqual(first);
  const changed={...command,payload:{...command.payload,body:{...skillBody,name:'Changed'}}} as Command;
  expect(()=>boundary.accept(request(changed,key))).toThrowError(expect.objectContaining({code:'IDEMPOTENCY_CONFLICT'}));
  expect(f.db.all('SELECT id FROM commands')).toHaveLength(1);
 });

 it('rejects stale identities, prior attempts, and terminal runs',()=>{
  admit([SKILL_PROPOSE_POLICY]);const command=proposal();
  expect(()=>boundary.accept({...request(command),identity:{...identity,epoch:2}})).toThrowError(expect.objectContaining({code:'STALE_EPOCH'}));
  expect(()=>boundary.accept({...request(command),attempt:2})).toThrowError(expect.objectContaining({code:'REVISION_CONFLICT'}));
  f.db.exec("UPDATE runs SET status='completed' WHERE id=?",runId);
  expect(()=>boundary.accept(request(command))).toThrowError(expect.objectContaining({code:'REVISION_CONFLICT'}));
 });

 it.each(['claimed','running','finishing'])('rejects expired %s task commands and reads before watchdog reconciliation',status=>{
  admit([SKILL_PROPOSE_POLICY,ROUTINE_MANAGE_POLICY]);
  f.db.exec('UPDATE runs SET status=? WHERE id=?',status,runId);
  // Leave the executor lease alive well beyond this task deadline.
  f.db.exec("UPDATE attempts SET deadline_at='2026-09-10T00:00:20.000Z' WHERE run_id=?",runId);
  const query={identity,run_id:runId,attempt:1},command=proposal();
  f.setNow('2026-09-10T00:00:19.999Z');
  const receipt=boundary.accept(request(command));expect(receipt.status).toBe('applied');
  expect(boundary.routines(query).routines).toEqual([]);
  const before={commands:f.db.all('SELECT * FROM commands'),runs:f.db.all('SELECT * FROM runs'),
   attempts:f.db.all('SELECT * FROM attempts'),lifecycle:f.db.all('SELECT * FROM lifecycle'),skills:f.db.all('SELECT * FROM skill_proposals')};
  for(const time of ['2026-09-10T00:00:20.000Z','2026-09-10T00:00:20.001Z']){
   f.setNow(time);
   expect(()=>boundary.accept(request(proposal()))).toThrowError(expect.objectContaining({code:'REVISION_CONFLICT'}));
   expect(()=>boundary.accept(request({schema_version:1,type:'routine.put',payload:routine()}))).toThrowError(expect.objectContaining({code:'REVISION_CONFLICT'}));
   expect(()=>boundary.routines(query)).toThrowError(expect.objectContaining({code:'REVISION_CONFLICT'}));
   expect(()=>boundary.skill({...query,skill_id:randomUUID()})).toThrowError(expect.objectContaining({code:'REVISION_CONFLICT'}));
  }
  expect({commands:f.db.all('SELECT * FROM commands'),runs:f.db.all('SELECT * FROM runs'),
   attempts:f.db.all('SELECT * FROM attempts'),lifecycle:f.db.all('SELECT * FROM lifecycle'),skills:f.db.all('SELECT * FROM skill_proposals')}).toEqual(before);
 });

 it('rejects owner-only review and requires the matching scoped capability',()=>{
  admit([]);
  expect(()=>boundary.accept(request(proposal()))).toThrowError(expect.objectContaining({code:'FORBIDDEN'}));
  const review:Command={schema_version:1,type:'skill.review',payload:{proposal_id:randomUUID(),expected_proposal_revision:1,decision:'approve'}};
  expect(()=>boundary.accept(request(review))).toThrowError(expect.objectContaining({code:'FORBIDDEN'}));
  const reconcile:Command={schema_version:1,type:'effect.reconcile',payload:{run_id:runId,expected_attempt:1,effect_id:randomUUID(),expected_request_digest:'digest',outcome:'confirmed',evidence_ref:'owner-claim'}};
  expect(()=>boundary.accept(request(reconcile))).toThrowError(expect.objectContaining({code:'FORBIDDEN'}));
  expect(()=>boundary.accept(request({schema_version:1,type:'run.recover',payload:{run_id:runId,expected_attempt:1,release_resources:true}}))).toThrowError(expect.objectContaining({code:'FORBIDDEN'}));
  expect(()=>boundary.accept(request({schema_version:1,type:'question.answer',payload:{question_id:randomUUID(),expected_revision:1,answers:{destination:{answers:['West']}}}}))).toThrowError(expect.objectContaining({code:'FORBIDDEN'}));
  expect(f.db.all('SELECT id FROM commands')).toEqual([]);
 });

 it('bounds routine ownership and action grants to the admitted snapshot',()=>{
  admit([ROUTINE_MANAGE_POLICY],[action]);
  const expanded:Command={schema_version:1,type:'routine.put',payload:routine({action_policy_ids:[randomUUID()]})};
  expect(()=>boundary.accept(request(expanded))).toThrowError(expect.objectContaining({code:'FORBIDDEN'}));
  const wrongPersona:Command={schema_version:1,type:'routine.put',payload:routine({persona_id:otherBot,action_policy_ids:[action]})};
  expect(()=>boundary.accept(request(wrongPersona))).toThrowError(expect.objectContaining({code:'FORBIDDEN'}));
  const owned=routine({persona_id:otherBot});f.store.put(owned.id,'routine',owned,0,'owner',f.core.now());
  const overwrite:Command={schema_version:1,type:'routine.put',payload:{...owned,expected_revision:1,persona_id:bot}};
  expect(()=>boundary.accept(request(overwrite))).toThrowError(expect.objectContaining({code:'FORBIDDEN'}));
 });

 it('admits the routine.put contract within the persona scope',()=>{
  admit([ROUTINE_MANAGE_POLICY],[action]);const payload:RoutinePut=routine({action_policy_ids:[action]});
  expect(boundary.accept(request({schema_version:1,type:'routine.put',payload})).status).toBe('applied');
  expect(f.store.get<RoutinePut>(payload.id,'routine').body.persona_id).toBe(bot);
 });

 it('run and delete preserve ownership, action limits, and deletion receipt dedupe',()=>{
  admit([ROUTINE_MANAGE_POLICY]);
  const owned=routine({enabled:false}),foreign=routine({persona_id:otherBot}),privileged=routine({action_policy_ids:[action]});
  for(const payload of [owned,foreign,privileged])expect(f.accept({schema_version:1,type:'routine.put',payload}).status).toBe('applied');
  for(const type of ['routine.run','routine.delete'] as const){
   expect(()=>boundary.accept(request({schema_version:1,type,payload:{id:foreign.id,expected_revision:1}}))).toThrowError(expect.objectContaining({code:'FORBIDDEN'}));
  }
  expect(()=>boundary.accept(request({schema_version:1,type:'routine.run',payload:{id:privileged.id,expected_revision:1}}))).toThrowError(expect.objectContaining({code:'FORBIDDEN'}));
  const run=boundary.accept(request({schema_version:1,type:'routine.run',payload:{id:owned.id,expected_revision:1}}));
  expect(run.status).toBe('applied');expect(f.store.run(run.resource_id!).persona_id).toBe(bot);
  const deletion=request({schema_version:1,type:'routine.delete',payload:{id:owned.id,expected_revision:1}});
  const receipt=boundary.accept(deletion);expect(receipt.status).toBe('applied');expect(boundary.accept(deletion)).toEqual(receipt);
  expect(f.store.run(run.resource_id!).status).toBe('cancelled');
 });

 it('routine queries paginate only the admitted bot without creating commands, runs or wakes',()=>{
  admit([ROUTINE_MANAGE_POLICY]);
  const ids=Array.from({length:22},()=>randomUUID()).sort();
  for(const id of ids)f.store.put(id,'routine',routine({id,enabled:false}),0,'owner',f.core.now());
  const foreign=routine({persona_id:otherBot});f.store.put(foreign.id,'routine',foreign,0,'owner',f.core.now());
  const query={identity,run_id:runId,attempt:1};
  const before=f.db.all('SELECT desired_state,queue_sequence FROM lifecycle');
  const first=boundary.routines(query);expect(first.routines.map(x=>x.id)).toEqual(ids.slice(0,20));expect(first.next_cursor).toBe(ids[19]);
  const second=boundary.routines({...query,after:first.next_cursor!});expect(second.routines.map(x=>x.id)).toEqual(ids.slice(20));expect(second.next_cursor).toBeNull();
  expect(boundary.routines({...query,id:ids[3]}).routines.map(x=>x.id)).toEqual([ids[3]]);
  expect(boundary.routines({...query,id:foreign.id}).routines).toEqual([]);
  expect(f.db.all('SELECT desired_state,queue_sequence FROM lifecycle')).toEqual(before);
  expect(f.db.all('SELECT id FROM commands')).toHaveLength(0);expect(f.db.all('SELECT id FROM runs')).toHaveLength(1);
  expect(()=>boundary.routines({...query,id:ids[0],after:ids[1]})).toThrowError(expect.objectContaining({code:'INVALID_INPUT'}));
  expect(()=>boundary.routines({...query,attempt:2})).toThrowError(expect.objectContaining({code:'REVISION_CONFLICT'}));
 });
});
