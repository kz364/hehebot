import {randomUUID} from 'node:crypto';
import {afterEach,beforeEach,expect,it} from 'vitest';
import {fixture,bot} from './helpers';
import {LifecycleCore,type Identity} from '../src/core/lifecycle';
import {NativeTaskLedger} from '../src/core/native-tasks';
import {TaskSteering} from '../src/core/task-steering';
import {EffectLedger} from '../src/core/effects';
import {ResourceLedger} from '../src/core/resources';
import validateRuntime from '../src/generated/validate-runtime.js';
import {parseCommand} from '../src/core/control';

let f:ReturnType<typeof fixture>,life:LifecycleCore,identity:Identity,ledger:TaskSteering,root:string,a:string,b:string;
const target=(run_id=a)=>({run_id,attempt:1});
const command=(run_id=a,text='Use tomorrow for task A')=>({schema_version:1 as const,type:'run.steer' as const,payload:{run_id,expected_attempt:1,text}});
const pending=(ids=[a,b,root])=>ledger.pending(identity,ids.map(target),life);
beforeEach(()=>{
 f=fixture(true);life=new LifecycleCore(f.store,f.core);ledger=new TaskSteering(f.store,()=>f.core.now());
 f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=3,lease_until='2026-09-10T00:02:00.000Z'");
 identity=life.registerBoot(randomUUID());life.ready(identity);
 root=f.accept({schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'Independent root'}}).resource_id!;
 life.claim(identity);life.submitted(identity,root,1,'native-root');
 const tasks=new NativeTaskLedger(f.store,f.core,life);
 const spawn=(name:string)=>tasks.register(identity,{parent_run_id:root,parent_attempt:1,persona_id:bot,native_run_ref:`native-${name}`,native_session_key:`thread-${name}`,title:name},true).id;
 a=spawn('A');b=spawn('B');
});
afterEach(()=>f.close());

it('keeps ordinary messages and deferred followups separate from exact owner steering without touching task state',()=>{
 f.accept({schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'Independent question, not steering'}});
 expect(pending()).toEqual([]);
 const runs=f.db.all('SELECT * FROM runs ORDER BY id'),attempts=f.db.all('SELECT * FROM attempts ORDER BY run_id');
 expect(f.accept({schema_version:1,type:'run.followup',payload:{run_id:b,text:'After B finishes'}}).status).toBe('applied');
 expect(pending()).toEqual([]);
 const id=f.accept(command()).id;
 expect(pending()).toEqual([{command_id:id,...target(),native_ref:'native-A',text:'Use tomorrow for task A'}]);
 expect(pending([b,root])).toEqual([]);
 expect(f.db.all('SELECT * FROM runs ORDER BY id')).toEqual(runs);expect(f.db.all('SELECT * FROM attempts ORDER BY run_id')).toEqual(attempts);
 expect(JSON.stringify(f.db.all('SELECT * FROM runtime_metadata'))).not.toContain('Use tomorrow');
 expect(f.db.all('SELECT * FROM task_followups')).toHaveLength(1);
});

it('preserves original receipts on owner replay, rejects changed command and serializes pending/unknown steering',()=>{
 const key=randomUUID(),first=f.accept(command(),key);
 expect(first.status).toBe('applied');expect(f.accept(command(),key)).toEqual(first);
 expect(()=>f.accept(command(a,'Changed'),key)).toThrowError(expect.objectContaining({code:'IDEMPOTENCY_CONFLICT'}));
 expect(f.accept(command(a,'Another')).error?.code).toBe('RESOURCE_BUSY');
 ledger.result(identity,target(),first.id,'outcome_unknown',life);
 expect(pending()).toEqual([]);expect(f.accept(command(a,'Blind retry')).error?.code).toBe('RESOURCE_BUSY');
 expect(()=>ledger.result(identity,target(),first.id,'accepted',life)).toThrowError(expect.objectContaining({code:'REVISION_CONFLICT'}));
 expect(f.accept(command(),key)).toEqual(first);
});

it('records late acknowledgement after completion without inventing consumption, releasing locks or changing effects',()=>{
 new ResourceLedger(f.store,()=>f.core.now()).acquire(b,1,['browser:b']);
 const effects=new EffectLedger(f.store,()=>f.core.now()),eid=randomUUID();
 effects.intent({id:eid,run_id:b,attempt:1,action_key:'uncertain-b',classification:'read_only',authorization_ref:'read',request_digest:'digest',provider_idempotency_key:null});
 effects.transition(eid,b,'outcome_unknown',null);
 const before=f.db.all('SELECT * FROM effects'),locks=f.db.all('SELECT * FROM resource_locks');
 life.complete(identity,root,1,{status:'completed',text:'Parent only'});
 const receipt=f.accept(command());expect(receipt.status).toBe('applied');
 life.complete(identity,a,1,{status:'completed',text:'A done'});expect(pending()).toEqual([]);
 ledger.result(identity,target(),receipt.id,'accepted',life);ledger.result(identity,target(),receipt.id,'accepted',life);
 expect(f.db.all('SELECT * FROM effects')).toEqual(before);expect(f.db.all('SELECT * FROM resource_locks')).toEqual(locks);
 expect(f.store.run(b).status).toBe('running');expect(f.accept(command()).error?.code).toBe('TASK_NOT_RUNNING');
 expect(()=>life.prepareSleep(identity)).toThrow();
});

it('rejects unknown target effects and preserves a pending instruction if uncertainty appears before delivery',()=>{
 const effects=new EffectLedger(f.store,()=>f.core.now()),id=randomUUID();
 effects.intent({id,run_id:a,attempt:1,action_key:'uncertain-a',classification:'read_only',authorization_ref:'read',request_digest:'digest',provider_idempotency_key:null});
 const receipt=f.accept(command());expect(pending()).toHaveLength(1);
 effects.transition(id,a,'outcome_unknown',null);expect(pending()).toEqual([]);
 expect(f.accept(command()).error?.code).toBe('OUTCOME_UNKNOWN');
 effects.transition(id,a,'confirmed',{synthetic:true});expect(pending()[0].command_id).toBe(receipt.id);
});

it('fences new admission and delivery at exact deadline or lease boundary, but admits late result reconciliation',()=>{
 const receipt=f.accept(command());
 f.db.exec("UPDATE attempts SET deadline_at='2026-09-10T00:00:01.000Z' WHERE run_id=?",a);
 f.setNow('2026-09-10T00:00:00.999Z');expect(pending()).toHaveLength(1);
 f.setNow('2026-09-10T00:00:01.000Z');expect(pending()).toEqual([]);expect(f.accept(command()).error?.code).toBe('TASK_NOT_RUNNING');
 ledger.result(identity,target(),receipt.id,'accepted',life);
 f.setNow(life.get().lease_until!);
 expect(()=>pending()).toThrowError(expect.objectContaining({code:'STALE_EPOCH'}));
 expect(()=>ledger.result(identity,target(),receipt.id,'accepted',life)).toThrowError(expect.objectContaining({code:'STALE_EPOCH'}));
});

it('does not deliver pruned/rejected command text or retarget changed native identity and attempts',()=>{
 const receipt=f.accept(command()),original=f.db.all<{payload_json:string}>('SELECT payload_json FROM commands WHERE id=?',receipt.id)[0].payload_json;
 f.db.exec("UPDATE commands SET payload_json='{}' WHERE id=?",receipt.id);expect(pending()).toEqual([]);
 f.db.exec("UPDATE commands SET payload_json=?,status='rejected' WHERE id=?",original,receipt.id);expect(pending()).toEqual([]);
 f.db.exec("UPDATE commands SET status='applied' WHERE id=?",receipt.id);expect(pending()).toHaveLength(1);
 f.db.exec("UPDATE attempts SET native_run_ref='replacement' WHERE run_id=?",a);expect(pending()).toEqual([]);
 expect(()=>ledger.result(identity,target(),receipt.id,'accepted',life)).toThrowError(expect.objectContaining({code:'STALE_EPOCH'}));
 f.db.exec('UPDATE runs SET current_attempt=2 WHERE id=?',a);expect(pending()).toEqual([]);
 expect(f.accept(command()).error?.code).toBe('REVISION_CONFLICT');
});

it('requires exact receipts/custody and strict schemas; closed production gates never accept steering',()=>{
 expect(()=>ledger.queue(randomUUID(),target())).toThrowError(expect.objectContaining({code:'FORBIDDEN'}));
 const receipt=f.accept(command());
 expect(()=>ledger.result(identity,target(b),receipt.id,'accepted',life)).toThrowError(expect.objectContaining({code:'NOT_FOUND'}));
 expect(()=>ledger.result({...identity,boot_id:randomUUID()},target(),receipt.id,'accepted',life)).toThrowError(expect.objectContaining({code:'STALE_EPOCH'}));
 expect(()=>ledger.pending(identity,[target(),target()],life)).toThrowError(expect.objectContaining({code:'INVALID_INPUT'}));
 expect(()=>parseCommand({...command(),payload:{...command().payload,sandbox:'danger'}})).toThrow();
 expect(()=>parseCommand(command(a,'界'.repeat(12000)))).toThrowError(expect.objectContaining({code:'PAYLOAD_TOO_LARGE'}));
 expect(validateRuntime({type:'steer-result',payload:{identity,...target(),command_id:receipt.id,status:'consumed'}})).toBe(false);
 expect(validateRuntime({type:'steer-pending',payload:{identity,targets:[target()],text:'injected'}})).toBe(false);
 f.core.options.executionEnabled=false;expect(f.accept(command(b)).error?.code).toBe('CAPABILITY_UNAVAILABLE');
});

it('bounds worst-case escaped delivery bytes and exposes content-free receipts without losing later pending work',()=>{
 const tasks=new NativeTaskLedger(f.store,f.core,life),ids=[a,b,root];
 for(const name of ['C','D'])ids.push(tasks.register(identity,{parent_run_id:root,parent_attempt:1,persona_id:bot,native_run_ref:`native-${name}`,native_session_key:`thread-${name}`,title:name},true).id);
 const text='\u0001'.repeat(32768),receipts=ids.map(id=>f.accept(command(id,text)));
 expect(receipts.every(receipt=>receipt.status==='applied')).toBe(true);
 const first=pending(ids);expect(first).toHaveLength(4);expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThan(1048576);
 first.forEach(row=>ledger.result(identity,target(row.run_id),row.command_id,'accepted',life));
 const last=pending(ids);expect(last).toHaveLength(1);
 expect(new Set([...first,...last].map(row=>row.command_id))).toEqual(new Set(receipts.map(row=>row.id)));
 const projected=f.core.state().steering;
 expect(projected).toHaveLength(5);expect(projected.filter(row=>row.status==='pending')).toHaveLength(1);
 expect(projected.every(row=>Object.keys(row).sort().join(',')==='attempt,command_id,created_at,run_id,status')).toBe(true);
 expect(JSON.stringify(projected)).not.toContain('native-');
});
