import {describe,it,expect,vi} from 'vitest';
import {FlightRestoreIntegration,FLIGHT_ROUTINES,validateFlightPayload} from '../src/core/flight-integration';
import type {LifecycleCore} from '../src/core/lifecycle';
import {fixture,routine} from './helpers';
const policy='44444444-4444-4444-8444-444444444444';
const identity={epoch:1,boot_id:'boot'};
const leg={leg_id:'synthetic',revision:1,departure_at:'2026-09-10T06:00:00+08:00',departure_zone:'Asia/Singapore',source_ref:'synthetic-mail'};
function setup(){const f=fixture(true);f.core.options.actionPolicyIds.push(policy);for(const id of [FLIGHT_ROUTINES.triage,FLIGHT_ROUTINES.restore])f.store.put(id,'routine',routine({id,persona_id:FLIGHT_ROUTINES.inbox,action_policy_ids:[policy]}),0,'owner',f.core.now());const auth=vi.fn();const service=new FlightRestoreIntegration(f.store,f.core,{authorizeAttempt:auth} as unknown as LifecycleCore,{enabled:true,policyId:policy});service.initialize();const run=f.core.enqueue(FLIGHT_ROUTINES.inbox,'synthetic',null,FLIGHT_ROUTINES.triage,null);f.db.exec("UPDATE runs SET status='running',current_attempt=1 WHERE id=?",run);return {...f,service,run,auth};}
describe('authenticated canonical flight integration',()=>{
 it('registers only canonical triage and enqueues one canonical restore across alarm/daily calls',()=>{const f=setup();try{const payload={identity,run_id:f.run,attempt:1,leg};f.service.register(payload);expect(f.auth).toHaveBeenCalledWith(identity,f.run,1);expect(f.service.reconcile()).toBe(1);expect(f.service.reconcile()).toBe(0);expect(f.db.all<{routine_id:string}>('SELECT routine_id FROM runs WHERE id!=?',f.run)[0].routine_id).toBe(FLIGHT_ROUTINES.restore);}finally{f.close();}});
 it('rejects arbitrary routine injection and stale authority before registration',()=>{const f=setup();try{expect(()=>validateFlightPayload('flight-register',{identity,run_id:f.run,attempt:1,leg:{...leg,routine_id:'evil'}})).toThrow();f.auth.mockImplementation(()=>{throw Error('stale');});expect(()=>f.service.register({identity,run_id:f.run,attempt:1,leg})).toThrow();expect(f.service.ledger.nextDue()).toBeNull();}finally{f.close();}});
 it('disabled restore routine prevents registration and alarm churn',()=>{const f=setup();try{const r=f.store.get(FLIGHT_ROUTINES.restore);f.store.put(r.id,'routine',{...r.body,enabled:false},r.revision,'owner',f.core.now());expect(()=>f.service.register({identity,run_id:f.run,attempt:1,leg})).toThrow();expect(f.service.nextDue()).toBeNull();}finally{f.close();}});
 it('requires current running attempt and pinned policy',()=>{const f=setup();try{f.db.exec("UPDATE runs SET current_attempt=2 WHERE id=?",f.run);expect(()=>f.service.register({identity,run_id:f.run,attempt:1,leg})).toThrow();}finally{f.close();}});
 it('cannot confirm through a made-up receipt effect or triage run',()=>{const f=setup();try{f.service.register({identity,run_id:f.run,attempt:1,leg});f.service.reconcile();expect(()=>f.service.confirm({identity,run_id:f.run,attempt:1,leg_id:leg.leg_id,revision:1,effect_id:'fake'})).toThrow();const id=f.db.all<{id:string}>('SELECT id FROM runs WHERE id!=?',f.run)[0].id;f.db.exec("UPDATE runs SET status='running',current_attempt=1 WHERE id=?",id);expect(()=>f.service.confirm({identity,run_id:id,attempt:1,leg_id:leg.leg_id,revision:1,effect_id:'fake'})).toThrow();}finally{f.close();}});
});

describe('flight alarm and receipt regressions',()=>{
 it('authorizes registration without hydrating historical checkpoints',()=>{
  const f=setup();try{
   f.db.exec('UPDATE runs SET checkpoint_json=? WHERE id=?','界'.repeat(400000),f.run);
   const before=f.store.run(f.run),read=vi.spyOn(f.db,'all');
   try{
    f.service.register({identity,run_id:f.run,attempt:1,leg});
    expect(f.service.ledger.nextDue()).toBe('2026-09-09T14:00:00.000Z');
    const rows=read.mock.calls.flatMap(([sql],i)=>sql.includes('FROM runs WHERE id=?')?read.mock.results[i].value:[]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty('checkpoint_json');
   }finally{read.mockRestore();}
   expect(f.store.run(f.run)).toEqual(before);
  }finally{f.close();}
 });
 it('cron queue_one replaces cron work without cancelling a queued per-leg deadline',()=>{
  const f=setup();try{
   f.service.register({identity,run_id:f.run,attempt:1,leg});f.service.reconcile();
   const deadline=f.db.all<{run_id:string}>('SELECT run_id FROM flight_restore_deadlines')[0].run_id;
   const r=f.store.get(FLIGHT_ROUTINES.restore);
   f.db.exec('INSERT INTO schedule_state(routine_id,routine_version,next_due_at) VALUES(?,?,?)',r.id,r.revision,f.core.now());
   f.core.tick();const cron=f.db.all<{id:string}>("SELECT id FROM runs WHERE routine_id=? AND occurrence_id IS NOT NULL AND status='queued'",r.id)[0].id;
   f.setNow('2026-09-10T00:15:00.000Z');f.core.tick();
   expect(f.store.run(deadline).status).toBe('queued');expect(f.store.run(cron).status).toBe('cancelled');
   expect(f.db.all("SELECT id FROM runs WHERE routine_id=? AND occurrence_id IS NOT NULL AND status='queued'",r.id)).toHaveLength(1);
   expect(f.service.reconcile()).toBe(0);
  }finally{f.close();}
 });
 it('confirms only with a matching durable effect receipt and repeats idempotently',()=>{
  const f=setup();try{
   f.service.register({identity,run_id:f.run,attempt:1,leg});f.service.reconcile();
   const run=f.db.all<{run_id:string}>('SELECT run_id FROM flight_restore_deadlines')[0].run_id;
   f.db.exec("UPDATE runs SET status='running',current_attempt=1 WHERE id=?",run);
   const receipt=JSON.stringify({labels_verified:['INBOX'],message_ref:'synthetic-mail'});
   f.db.exec("INSERT INTO effects(id,run_id,action_key,classification,status,authorization_ref,request_digest,receipt_json,updated_at) VALUES(?,?,?,'mutation','confirmed',?,?,?,?)",'effect-1',run,`flight-restore:${leg.leg_id}:1`,policy,'synthetic-digest',receipt,f.core.now());
   const payload={identity,run_id:run,attempt:1,leg_id:leg.leg_id,revision:1,effect_id:'effect-1'};
   f.service.confirm(payload);f.service.confirm(payload);
   expect(f.db.all<{status:string;receipt_json:string}>('SELECT status,receipt_json FROM flight_restore_deadlines')[0]).toMatchObject({status:'confirmed',receipt_json:receipt});
  }finally{f.close();}
 });
 it('daily reconciliation requires canonical running restore context and current identity',()=>{
  const f=setup();try{
   f.service.register({identity,run_id:f.run,attempt:1,leg});
   expect(()=>f.service.reconcileFromRun({identity,run_id:f.run,attempt:1})).toThrow();
   const daily=f.core.enqueue(FLIGHT_ROUTINES.inbox,'daily recovery',null,FLIGHT_ROUTINES.restore,null);
   f.db.exec("UPDATE runs SET status='running',current_attempt=1 WHERE id=?",daily);
   expect(f.service.reconcileFromRun({identity,run_id:daily,attempt:1})).toBe(1);
   f.auth.mockImplementation(()=>{throw Error('stale identity');});
   expect(()=>f.service.reconcileFromRun({identity,run_id:daily,attempt:1})).toThrow();
  }finally{f.close();}
 });
 it('arbitrary operator policies and missing pinned run policy cannot authorize registration',()=>{
  const f=setup();try{
   const arbitrary=new FlightRestoreIntegration(f.store,f.core,{authorizeAttempt:f.auth} as unknown as LifecycleCore,{enabled:true,policyId:'55555555-5555-4555-8555-555555555555'});
   expect(()=>arbitrary.register({identity,run_id:f.run,attempt:1,leg})).toThrow();
   const context=JSON.parse(f.store.run(f.run).context_json);context.authorization_policy_ids=[];
   f.db.exec('UPDATE runs SET context_json=? WHERE id=?',JSON.stringify(context),f.run);
   expect(()=>f.service.register({identity,run_id:f.run,attempt:1,leg})).toThrow();
   expect(f.service.ledger.nextDue()).toBeNull();
  }finally{f.close();}
 });
});
