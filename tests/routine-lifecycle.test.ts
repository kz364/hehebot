import {randomUUID} from 'node:crypto';
import {it,expect} from 'vitest';
import {fixture,routine} from './helpers';
import {LifecycleCore} from '../src/core/lifecycle';

it('manual execution of a paused routine deduplicates and does not enable or advance its schedule',()=>{
 const f=fixture(true);
 try{
  const r=routine({enabled:false});f.accept({schema_version:1,type:'routine.put',payload:r});
  const command={schema_version:1 as const,type:'routine.run' as const,payload:{id:r.id,expected_revision:1}};
  const key=randomUUID(),receipt=f.accept(command,key);
  expect(receipt.status).toBe('applied');expect(f.accept(command,key)).toEqual(receipt);
  const run=f.store.run(receipt.resource_id!);
  expect(run).toMatchObject({routine_id:r.id,status:'queued',occurrence_id:expect.any(String)});
  expect(f.db.all('SELECT * FROM occurrences')).toEqual([{id:run.occurrence_id,routine_id:r.id,routine_version:1,nominal_due_at:null,status:'queued',coalesced_count:0,created_at:f.core.now(),origin:'manual'}]);
  expect(f.store.get(r.id).body.enabled).toBe(false);expect(f.db.all('SELECT * FROM schedule_state')).toHaveLength(0);
  expect(f.accept(command)).toMatchObject({status:'rejected',error:{code:'RESOURCE_BUSY'}});
  expect(f.db.all('SELECT id FROM runs')).toHaveLength(1);
  expect(f.accept({...command,payload:{...command.payload,expected_revision:2}})).toMatchObject({status:'rejected',error:{code:'REVISION_CONFLICT'}});
  expect(f.db.all('SELECT id FROM occurrences')).toHaveLength(1);
 }finally{f.close();}
});

it('retains manual identity across attempts and creates a distinct occurrence for another command at the same clock',()=>{
 const f=fixture(true);
 try{
  const r=routine({enabled:false});f.accept({schema_version:1,type:'routine.put',payload:r});
  const command={schema_version:1 as const,type:'routine.run' as const,payload:{id:r.id,expected_revision:1}};
  const key=randomUUID(),receipt=f.accept(command,key),id=receipt.resource_id!,occurrence=f.store.run(id).occurrence_id;
  const life=new LifecycleCore(f.store,f.core);
  f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=1,lease_until='2026-09-10T00:02:00.000Z'");
  const identity=life.registerBoot(randomUUID());life.ready(identity);
  expect(life.claim(identity)?.run).toMatchObject({id,occurrence_id:occurrence,current_attempt:1});
  expect(f.db.all('SELECT status FROM occurrences')).toEqual([{status:'claimed'}]);
  life.complete(identity,id,1,{status:'failed',text:'Synthetic failure'});
  expect(f.accept({schema_version:1,type:'run.retry',payload:{run_id:id,expected_attempt:1}}).status).toBe('applied');
  expect(life.claim(identity)?.run).toMatchObject({id,occurrence_id:occurrence,current_attempt:2});
  life.complete(identity,id,2,{status:'completed',text:'Synthetic completion'});
  expect(f.db.all('SELECT status FROM occurrences')).toEqual([{status:'completed'}]);
  expect(f.accept(command,key)).toEqual(receipt);
  const second=f.accept(command);expect(second.status).toBe('applied');
  expect(f.store.run(second.resource_id!).occurrence_id).not.toBe(occurrence);
  expect(f.db.all('SELECT nominal_due_at,created_at,origin FROM occurrences')).toEqual(Array.from({length:2},()=>({nominal_due_at:null,created_at:f.core.now(),origin:'manual'})));
  expect(f.db.all('SELECT * FROM schedule_state')).toEqual([]);
 }finally{f.close();}
});

it.each(['queue_one','skip'] as const)('keeps manual work outside %s replacement and optional scheduled budget',overlap=>{
 const f=fixture(true);
 try{
  const r=routine();r.policy.overlap=overlap;f.accept({schema_version:1,type:'routine.put',payload:r});
  expect(f.accept({schema_version:1,type:'budget.set',payload:{expected_revision:0,enabled:true,monthly_cap_cents:500,optional_routine_ids:[r.id]}}).status).toBe('applied');
  const schedule=f.db.all('SELECT * FROM schedule_state');
  const receipt=f.accept({schema_version:1,type:'routine.run',payload:{id:r.id,expected_revision:1}}),manual=f.store.run(receipt.resource_id!);
  expect(manual.status).toBe('queued');expect(f.core.budget.blocks(manual)).toBe(false);
  expect(f.db.all('SELECT * FROM schedule_state')).toEqual(schedule);
  f.setNow('2026-09-10T00:15:00.000Z');f.core.tick();f.core.tick();
  f.setNow('2026-09-10T00:30:00.000Z');f.core.tick();f.core.tick();
  expect(f.store.run(manual.id)).toEqual(manual);
  expect(f.db.all("SELECT nominal_due_at,status FROM occurrences WHERE origin='scheduled' ORDER BY nominal_due_at")).toEqual([
   {nominal_due_at:'2026-09-10T00:15:00.000Z',status:'skipped'},
   {nominal_due_at:'2026-09-10T00:30:00.000Z',status:overlap==='skip'?'skipped':'queued'},
  ]);
  const scheduled=f.db.all<{id:string;status:string;error_code:string}>('SELECT id,status,error_code FROM runs WHERE id!=?',manual.id);
  expect(scheduled).toHaveLength(overlap==='skip'?0:2);
  if(overlap==='queue_one')expect(scheduled.map(run=>run.status).sort()).toEqual(['cancelled','waiting']);
  expect(scheduled.filter(run=>run.status==='waiting').every(run=>run.error_code==='BUDGET_UNKNOWN')).toBe(true);
 }finally{f.close();}
});

it('rolls back occurrence creation with a failed enqueue and does not grant revoked policies',()=>{
 const f=fixture(true);
 try{
  const r=routine({enabled:false}),command={schema_version:1 as const,type:'routine.run' as const,payload:{id:r.id,expected_revision:1}};
  f.accept({schema_version:1,type:'routine.put',payload:r});
  const before=f.db.all('SELECT * FROM commands');
  f.db.exec("CREATE TRIGGER reject_manual_run BEFORE INSERT ON runs BEGIN SELECT RAISE(ABORT,'synthetic enqueue failure'); END");
  expect(()=>f.accept(command)).toThrow('synthetic enqueue failure');
  expect(f.db.all('SELECT * FROM occurrences')).toEqual([]);expect(f.db.all('SELECT * FROM commands')).toEqual(before);
  f.db.exec('DROP TRIGGER reject_manual_run');
  const policy=randomUUID();f.core.options.actionPolicyIds=[policy];
  expect(f.accept({schema_version:1,type:'routine.put',payload:{...r,expected_revision:1,action_policy_ids:[policy]}}).status).toBe('applied');
  f.core.options.actionPolicyIds=[];
  expect(f.accept({...command,payload:{...command.payload,expected_revision:2}})).toMatchObject({status:'rejected',error:{code:'FORBIDDEN'}});
  expect(f.db.all('SELECT * FROM occurrences')).toEqual([]);
 }finally{f.close();}
});

it('deleting a routine removes future work but preserves admitted tasks and prevents resurrection',()=>{
 const f=fixture(true);
 try{
  const r=routine(),sibling=routine();
  for(const payload of [r,sibling])f.accept({schema_version:1,type:'routine.put',payload});
  const active=f.core.enqueue(r.persona_id,r.instructions,null,r.id,null);
  f.db.exec("UPDATE runs SET status='running' WHERE id=?",active);
  const pending=f.core.enqueue(r.persona_id,r.instructions,null,r.id,null);
  const before=f.store.run(active).context_json;
  const command={schema_version:1 as const,type:'routine.delete' as const,payload:{id:r.id,expected_revision:1}};
  const key=randomUUID(),receipt=f.accept(command,key);
  expect(receipt.status).toBe('applied');expect(f.accept(command,key)).toEqual(receipt);
  expect(f.store.run(active)).toMatchObject({status:'running',context_json:before});
  expect(f.store.run(pending).status).toBe('cancelled');
  expect(f.db.all('SELECT routine_id FROM schedule_state')).toEqual([{routine_id:sibling.id}]);
  expect(()=>f.store.get(r.id)).toThrow();
  expect(f.accept({schema_version:1,type:'routine.put',payload:{...r,expected_revision:2}})).toMatchObject({status:'rejected',error:{code:'NOT_FOUND'}});
  f.setNow('2026-09-10T00:15:00.000Z');f.core.tick();
  expect(f.db.all('SELECT id FROM runs WHERE routine_id=?',r.id)).toHaveLength(2);
 }finally{f.close();}
});
