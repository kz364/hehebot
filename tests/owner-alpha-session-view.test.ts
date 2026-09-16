import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {fixture,bot} from './helpers';
import {ControlCore} from '../src/core/control';
import {LifecycleCore} from '../src/core/lifecycle';

it('projects only public policy and durable admissions, independently of queue and visible runs',()=>{
 const f=fixture();
 try{
  expect(f.core.state().summary).not.toHaveProperty('owner_alpha');
  expect(f.core.state().summary).not.toHaveProperty('owner_alpha_session');
  const policy={session_id:randomUUID(),persona_id:bot,expires_at:'2026-09-10T00:01:00.000Z',max_runs:2,max_task_seconds:37};
  const core=new ControlCore(f.store,{...f.core.options,ownerAlpha:policy});core.ownerAlpha.initialize();
  const expected={persona_id:bot,expires_at:policy.expires_at,max_runs:2,admitted_runs:0,max_task_seconds:37};
  expect(core.state().summary).toMatchObject({owner_alpha:true,owner_alpha_session:expected});
  const message=()=>core.accept('owner',randomUUID(),randomUUID(),{schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'Synthetic request'}});
  message();message();
  expect(core.state().summary).toMatchObject({queued_runs:2,owner_alpha_session:expected});
  // Use the admission authority, not UI previews or the bounded public run list.
  const lifecycle=new LifecycleCore(f.store,core),identity=lifecycle.registerBoot(randomUUID());lifecycle.ready(identity);
  const first=lifecycle.claim(identity)!;
  expect(core.state().summary).toMatchObject({owner_alpha_session:{...expected,admitted_runs:1}});
  f.db.exec("UPDATE runs SET status='cancelled' WHERE id=?",first.run.id);
  const restarted=new ControlCore(f.store,{...f.core.options,ownerAlpha:policy});
  restarted.ownerAlpha.initialize();
  const summary=restarted.state().summary;
  expect(summary).toMatchObject({owner_alpha:true,owner_alpha_session:{...expected,admitted_runs:1}});
  expect(summary.owner_alpha_session).toEqual({...expected,admitted_runs:1});
  expect(JSON.stringify(summary)).not.toContain(policy.session_id);
  f.setNow(policy.expires_at);
  expect(restarted.state().summary).toMatchObject({owner_alpha_session:{...expected,admitted_runs:1}});
  f.db.exec("DELETE FROM runtime_metadata WHERE key='owner_alpha'");
  expect(()=>restarted.state()).toThrow('custody is missing');
 }finally{f.close();}
});
