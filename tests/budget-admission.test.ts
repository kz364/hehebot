import {randomUUID} from 'node:crypto';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {fixture,bot,routine} from './helpers';
import {LifecycleCore} from '../src/core/lifecycle';
import {FakeProvider} from '../src/providers';
let f:ReturnType<typeof fixture>;
beforeEach(()=>{f=fixture(true);});
afterEach(()=>f.close());
function optional(){const r=routine();expect(f.accept({schema_version:1,type:'routine.put',payload:r}).status).toBe('applied');return r;}
function policy(ids:string[],expected_revision=0){return f.accept({schema_version:1,type:'budget.set',payload:{expected_revision,enabled:true,monthly_cap_cents:500,optional_routine_ids:ids}});}
function due(){f.setNow('2026-09-10T00:15:00.000Z');f.core.tick();return f.db.all<{id:string}>('SELECT id FROM runs')[0].id;}
function ready(){const life=new LifecycleCore(f.store,f.core);f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=1,lease_until=?",new Date(f.core.options.now().getTime()+90000).toISOString());const identity=life.registerBoot(randomUUID());life.ready(identity);return {life,identity};}
it.each([false,true])('budget maintenance returns metadata without historical snapshots: allowed=%s',allowed=>{
 const r=optional();policy([r.id]);const id=due();
 const context=JSON.stringify({padding:'界'.repeat(400000)}),checkpoint=JSON.stringify({padding:'x'.repeat(1100000)});
 f.db.exec('UPDATE runs SET context_json=?,checkpoint_json=? WHERE id=?',context,checkpoint,id);
 if(allowed)f.core.budget.report({period:'2026-09',projected_cents:499,observed_at:f.core.now(),source_ref:'synthetic:maintenance'});
 else f.db.exec("UPDATE runs SET status='queued',error_code=NULL WHERE id=?",id);
 const before=f.store.run(id),read=vi.spyOn(f.db,'all');
 try{
  expect(f.core.nextBudgetMaintenance()).toBe(f.core.now());expect(f.core.reconcileBudget()).toBe(1);
  const returned=read.mock.calls.flatMap(([sql],index)=>sql.includes('WITH candidates AS')?read.mock.results[index].value:[]);
  expect(returned).toEqual(Array.from({length:2},()=>({id,persona_id:bot,command_id:before.command_id,budget_allowed:allowed?1:0})));
 }finally{read.mockRestore();}
 expect(f.store.run(id)).toEqual({...before,status:allowed?'queued':'waiting',error_code:allowed?null:'BUDGET_UNKNOWN'});
 expect(f.core.reconcileBudget()).toBe(0);
});

it('parks optional occurrences without a wake but still admits explicit owner work',()=>{
 const r=optional();expect(policy([r.id]).status).toBe('applied');const run=due();
 expect(f.store.run(run)).toMatchObject({status:'waiting',error_code:'BUDGET_UNKNOWN',current_attempt:0});
 expect(f.db.all('SELECT queue_sequence,desired_state FROM lifecycle')).toEqual([{queue_sequence:0,desired_state:'STOP'}]);
 const manual=f.accept({schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'Independent owner request'}});
 expect(manual.status).toBe('applied');expect(f.store.run(manual.resource_id!).status).toBe('queued');
 const {life,identity}=ready();expect(life.claim(identity)?.run.id).toBe(manual.resource_id);
});
it('owner override is revision checked and only requeues its selected occurrence',()=>{
 const r=optional();policy([r.id]);const run=due(),original=f.store.run(run);
 const stale=f.accept({schema_version:1,type:'budget.override',payload:{run_id:run,expected_revision:2}});
 expect(stale).toMatchObject({status:'rejected',error:{code:'REVISION_CONFLICT'}});
 const receipt=f.accept({schema_version:1,type:'budget.override',payload:{run_id:run,expected_revision:1}});
 expect(receipt.status).toBe('applied');expect(f.store.run(run)).toMatchObject({status:'queued',current_attempt:0,command_id:original.command_id,created_at:original.created_at});
 const {life,identity}=ready();expect(life.claim(identity)?.run.id).toBe(run);
});
it('policy revision changes invalidate an unclaimed override without renewing instruction age',()=>{
 const r=optional();policy([r.id]);const run=due(),original=f.store.run(run);
 expect(f.accept({schema_version:1,type:'budget.override',payload:{run_id:run,expected_revision:1}}).status).toBe('applied');
 expect(policy([r.id],1).status).toBe('applied');
 expect(f.store.run(run)).toMatchObject({status:'waiting',error_code:'BUDGET_UNKNOWN',created_at:original.created_at,command_id:original.command_id});
 const {life,identity}=ready();expect(life.claim(identity)).toBeNull();
});
it('claim enforces exact 24-hour projection expiry without waiting for maintenance',()=>{
 const r=optional();policy([r.id]);f.core.budget.report({period:'2026-09',projected_cents:499,observed_at:f.core.now(),source_ref:'synthetic:19'});const run=due();
 expect(f.store.run(run).status).toBe('queued');f.setNow('2026-09-11T00:00:00.000Z');
 const {life,identity}=ready();expect(life.claim(identity)).toBeNull();expect(f.store.run(run).current_attempt).toBe(0);
});
it('an over-cap report leaves an already claimed occurrence and its identity untouched',()=>{
 const r=optional();policy([r.id]);f.core.budget.report({period:'2026-09',projected_cents:499,observed_at:f.core.now(),source_ref:'synthetic:19'});const run=due();
 const {life,identity}=ready();life.claim(identity);const admitted=f.store.run(run);
 f.core.budget.report({period:'2026-09',projected_cents:501,observed_at:f.core.now(),source_ref:'synthetic:43'});f.core.reconcileBudget();
 expect(f.store.run(run)).toEqual(admitted);
});
it('freshness expiring during provider observation does not start the provider',async()=>{
 const r=optional();policy([r.id]);f.core.budget.report({period:'2026-09',projected_cents:499,observed_at:f.core.now(),source_ref:'synthetic:19'});due();
 const provider=new FakeProvider(),life=new LifecycleCore(f.store,f.core);f.db.exec('UPDATE lifecycle SET provider_ref_json=?',JSON.stringify({provider:'fake',id:'synthetic-runtime'}));
 const observe=provider.observe.bind(provider);provider.observe=async ref=>{const result=await observe(ref);f.setNow('2026-09-11T00:00:00.000Z');return result;};
 await life.drive(provider);expect(provider.calls).toEqual([]);
});
it('keeps overrides behind execution gates and rejects ordinary retry as a budget bypass',()=>{
 f.core.options.executionEnabled=false;const r=optional();policy([r.id]);const run=due();
 expect(f.accept({schema_version:1,type:'run.retry',payload:{run_id:run,expected_attempt:0}})).toMatchObject({status:'rejected',error:{code:'BUDGET_BLOCKED'}});
 expect(f.accept({schema_version:1,type:'budget.override',payload:{run_id:run,expected_revision:1}}).status).toBe('applied');
 expect(f.store.run(run)).toMatchObject({status:'waiting',error_code:'CAPABILITY_UNAVAILABLE',current_attempt:0});
 expect(f.db.all('SELECT queue_sequence,desired_state FROM lifecycle')).toEqual([{queue_sequence:0,desired_state:'STOP'}]);
});
it('bounds reconciliation, finds later eligible work before LIMIT, and never keeps blocked work awake',()=>{
 const r=optional();policy([r.id]);const first=due();
 for(let i=0;i<137;i++){
  const occurrence=randomUUID();f.db.exec("INSERT INTO occurrences(id,routine_id,routine_version,nominal_due_at,status,created_at) VALUES(?,?,1,?,'queued',?)",occurrence,r.id,`synthetic-${i}`,f.core.now());
  f.core.enqueue(bot,'Synthetic backlog',null,r.id,occurrence);
 }
 // Simulate report expiry before physical waiting-state reconciliation.
 f.db.exec("UPDATE runs SET status='queued',error_code=NULL");
 expect(f.core.reconcileBudget()).toBe(100);expect(f.core.nextBudgetMaintenance()).toBe(f.core.now());
 const {life,identity}=ready();expect(life.claim(identity)).toBeNull();
 f.setNow('2026-09-10T00:16:00.000Z');expect(()=>life.prepareSleep(identity)).not.toThrow();
 expect(f.core.reconcileBudget()).toBe(38);expect(f.core.nextBudgetMaintenance()).toBeNull();
 const queued=f.accept({schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'Independent later work'}}).resource_id;
 expect(life.claim(identity)?.run.id).toBe(queued);expect(f.store.run(first).current_attempt).toBe(0);
});
