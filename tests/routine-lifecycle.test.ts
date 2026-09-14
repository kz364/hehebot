import {randomUUID} from 'node:crypto';
import {it,expect} from 'vitest';
import {fixture,routine} from './helpers';

it('manual execution of a paused routine deduplicates and does not enable or advance its schedule',()=>{
 const f=fixture(true);
 try{
  const r=routine({enabled:false});f.accept({schema_version:1,type:'routine.put',payload:r});
  const command={schema_version:1 as const,type:'routine.run' as const,payload:{id:r.id,expected_revision:1}};
  const key=randomUUID(),receipt=f.accept(command,key);
  expect(receipt.status).toBe('applied');expect(f.accept(command,key)).toEqual(receipt);
  expect(f.store.run(receipt.resource_id!)).toMatchObject({routine_id:r.id,status:'queued',occurrence_id:null});
  expect(f.store.get(r.id).body.enabled).toBe(false);expect(f.db.all('SELECT * FROM schedule_state')).toHaveLength(0);
  expect(f.accept(command)).toMatchObject({status:'rejected',error:{code:'RESOURCE_BUSY'}});
  expect(f.db.all('SELECT id FROM runs')).toHaveLength(1);
  expect(f.accept({...command,payload:{...command.payload,expected_revision:2}})).toMatchObject({status:'rejected',error:{code:'REVISION_CONFLICT'}});
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
