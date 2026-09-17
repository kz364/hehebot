import {randomUUID} from 'node:crypto';
import {afterEach,beforeEach,expect,it} from 'vitest';
import {fixture,bot,otherBot,routine} from './helpers';
import {LifecycleCore,type Identity} from '../src/core/lifecycle';
import {NativeTaskLedger} from '../src/core/native-tasks';

let f:ReturnType<typeof fixture>,life:LifecycleCore,identity:Identity;
beforeEach(()=>{
 f=fixture(true);life=new LifecycleCore(f.store,f.core);
 f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=1,lease_until='2026-09-10T00:02:00.000Z'");
 identity=life.registerBoot(randomUUID());life.ready(identity);
});
afterEach(()=>f.close());
function start(){
 const r=routine({enabled:false});expect(f.accept({schema_version:1,type:'routine.put',payload:r}).status).toBe('applied');
 const receipt=f.accept({schema_version:1,type:'routine.run',payload:{id:r.id,expected_revision:1}});
 expect(receipt.status).toBe('applied');const claim=life.claim(identity)!;expect(claim.run.id).toBe(receipt.resource_id);
 return {r,run:claim.run};
}
const revisions=(id:string)=>f.db.all('SELECT attempt,captured_routine_revision FROM attempts WHERE run_id=? ORDER BY attempt',id);

it('atomically captures each claim revision and retains earlier attribution after retry and context removal',()=>{
 const {r,run}=start();expect(revisions(run.id)).toEqual([{attempt:1,captured_routine_revision:1}]);
 expect(f.accept({schema_version:1,type:'routine.put',payload:{...r,expected_revision:1,instructions:'Revision two'}}).status).toBe('applied');
 life.complete(identity,run.id,1,{status:'failed',text:'Synthetic settled failure'});
 expect(f.accept({schema_version:1,type:'run.retry',payload:{run_id:run.id,expected_attempt:1}}).status).toBe('applied');
 expect(life.claim(identity)?.run.current_attempt).toBe(2);
 expect(revisions(run.id)).toEqual([{attempt:1,captured_routine_revision:1},{attempt:2,captured_routine_revision:2}]);
 f.db.exec("UPDATE runs SET context_json='{}' WHERE id=?",run.id);
 const row=f.core.routineTaskPage(r.id).runs[0];
 expect(row).toMatchObject({captured_routine_revision:2,attempt_revisions:[{attempt:2,captured_routine_revision:2},{attempt:1,captured_routine_revision:1}]});
 expect(JSON.stringify(row)).not.toMatch(/Revision two|context_json/);
});

it('inherits exact parent-attempt attribution only for same-persona children and never invents legacy values',()=>{
 const {r,run}=start(),ledger=new NativeTaskLedger(f.store,f.core,life);
 f.core.options.delegations={[bot]:[otherBot]};
 expect(f.accept({schema_version:1,type:'routine.put',payload:{...r,expected_revision:1,instructions:'New current routine'}}).status).toBe('applied');
 const observe=(persona:string)=>ledger.register(identity,{parent_run_id:run.id,parent_attempt:1,persona_id:persona,native_run_ref:randomUUID(),native_session_key:randomUUID(),title:'Synthetic child'});
 const child=observe(bot),foreign=observe(otherBot);
 expect(revisions(child.id)).toEqual([{attempt:1,captured_routine_revision:1}]);
 expect(revisions(foreign.id)).toEqual([{attempt:1,captured_routine_revision:null}]);
 expect(foreign.routine_id).toBeNull();
 f.db.exec('UPDATE attempts SET captured_routine_revision=NULL WHERE run_id=?',run.id);
 expect(revisions(observe(bot).id)).toEqual([{attempt:1,captured_routine_revision:null}]);
});

it('rolls back claim and context replacement if attempt insertion fails',()=>{
 const r=routine({enabled:false});f.accept({schema_version:1,type:'routine.put',payload:r});
 const id=f.accept({schema_version:1,type:'routine.run',payload:{id:r.id,expected_revision:1}}).resource_id!;
 const before=f.store.run(id);
 f.db.exec("CREATE TRIGGER reject_attempt BEFORE INSERT ON attempts BEGIN SELECT RAISE(ABORT,'synthetic attempt failure'); END");
 expect(()=>life.claim(identity)).toThrow('synthetic attempt failure');
 expect(f.store.run(id)).toEqual(before);expect(revisions(id)).toEqual([]);
});

it('ordinary chat attempts have no routine revision',()=>{
 f.accept({schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'Synthetic message'}});
 const run=life.claim(identity)!.run;
 expect(revisions(run.id)).toEqual([{attempt:1,captured_routine_revision:null}]);
});
