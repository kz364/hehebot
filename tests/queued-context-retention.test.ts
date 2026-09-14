import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { LifecycleCore } from '../src/core/lifecycle';
import { FakeProvider } from '../src/providers';
import { fixture, bot, routine } from './helpers';
let f: ReturnType<typeof fixture>;
beforeEach(() => { f = fixture(true); });
afterEach(() => f.close());
const enqueue = () => f.core.enqueue(bot,'Original instruction 19',null,null,null);

it('drops unclaimed derived context at 30 days without renewing its age or changing custody', () => {
 const id = enqueue(); f.db.exec("UPDATE runs SET updated_at='2026-10-09T12:00:00.000Z' WHERE id=?", id);
 const run = f.store.run(id), state = f.db.all('SELECT * FROM lifecycle'), sequence = f.store.sequence();
 expect(f.core.nextQueuedContextExpiry()).toBe('2026-10-10T00:00:00.000Z');
 f.setNow('2026-10-09T23:59:59.999Z'); expect(f.core.expireQueuedContexts()).toBe(0);
 f.setNow('2026-10-10T00:00:00.000Z'); expect(f.core.expireQueuedContexts()).toBe(1);
 expect(f.store.run(id)).toEqual({...run,context_json:JSON.stringify({schema_version:1,instruction:'Original instruction 19',room_id:null})});
 expect(f.db.all('SELECT * FROM lifecycle')).toEqual(state); expect(f.store.sequence()).toBe(sequence);
 expect(f.core.expireQueuedContexts()).toBe(0); expect(f.core.nextQueuedContextExpiry()).toBe('2026-12-09T00:00:00.000Z');
});

it('rebuilds the full current authorized snapshot on claim while preserving instruction and room identity', () => {
 const room = randomUUID();
 expect(f.accept({schema_version:1,type:'room.put',payload:{id:room,expected_revision:0,name:'Room 43',member_ids:[bot],default_responder_id:bot}}).status).toBe('applied');
 const id = f.core.enqueue(bot,'Original room instruction 19',null,null,null,room);
 f.setNow('2026-10-10T00:00:00.000Z'); expect(f.core.expireQueuedContexts()).toBe(1);
 expect(f.accept({schema_version:1,type:'persona.put',payload:{id:bot,expected_revision:1,name:'Current persona',instructions:'Fresh instructions 71',tool_policy_ids:[],archived:false}}).status).toBe('applied');
 const life = new LifecycleCore(f.store,f.core);
 f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=1,lease_until='2026-10-10T00:02:00.000Z'");
 const identity = life.registerBoot(randomUUID()); life.ready(identity);
 const claimed = life.claim(identity)!; expect(claimed.run.id).toBe(id);
 const context = JSON.parse(claimed.run.context_json);
 expect(context).toMatchObject({instruction:'Original room instruction 19',room_id:room,persona:{revision:2,body:{instructions:'Fresh instructions 71'}},memories:[],skills:[],context_events:[],authorization_policy_ids:[]});
 expect(f.core.nextQueuedContextExpiry()).toBeNull();
});

it.each(['claimed','running','finishing','waiting','cancelling','recovery_required'])('preserves %s attempt context even long after 30 days', status => {
 const id = enqueue(); f.db.exec('UPDATE runs SET current_attempt=1,status=? WHERE id=?',status,id);
 const before = f.store.run(id);
 f.setNow('2027-01-01T00:00:00.000Z'); expect(f.core.expireQueuedContexts()).toBe(0);
 expect(f.core.nextQueuedContextExpiry()).toBeNull(); expect(f.store.run(id)).toEqual(before);
});

it('bounds cleanup and preserves a fresh queued snapshot beside old waiting work', () => {
 for(let i=0;i<101;i++) enqueue();
 f.db.exec("UPDATE runs SET status='waiting'");
 f.setNow('2026-10-09T00:00:00.000Z'); const fresh=enqueue(), before=f.store.run(fresh);
 f.setNow('2026-10-10T00:00:00.000Z'); expect(f.core.expireQueuedContexts()).toBe(100);
 expect(f.core.nextQueuedContextExpiry()).toBe(f.core.now()); expect(f.core.expireQueuedContexts()).toBe(1);
 expect(f.core.nextQueuedContextExpiry()).toBe('2026-11-08T00:00:00.000Z'); expect(f.store.run(fresh)).toEqual(before);
});

it('expires forwarded instructions by original receipt age and rejects retry without erasing the receipt', () => {
 const receipt=f.accept({schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'Original request 43'}});
 f.db.exec("UPDATE runs SET status='cancelled' WHERE id=?",receipt.resource_id!);
 f.setNow('2026-12-08T00:00:00.000Z');
 const id=f.core.enqueue(bot,'Forwarded request 43',receipt.id,null,null), before=f.store.run(id), lifecycle=f.db.all('SELECT * FROM lifecycle');
 expect(f.core.nextQueuedContextExpiry()).toBe('2026-12-09T00:00:00.000Z');
 f.setNow('2026-12-08T23:59:59.999Z'); expect(f.core.expireQueuedContexts()).toBe(0);
 f.setNow('2026-12-09T00:00:00.000Z'); expect(f.core.expireQueuedContexts()).toBe(1);
 expect(f.store.run(id)).toEqual({...before,context_json:'{}',status:'failed',error_code:'MESSAGE_EXPIRED',updated_at:f.core.now()});
 expect(f.core.receipt(receipt.id)).toEqual(receipt); expect(f.db.all('SELECT * FROM lifecycle')).toEqual(lifecycle);
 expect(f.accept({schema_version:1,type:'run.retry',payload:{run_id:id,expected_attempt:0}})).toMatchObject({status:'rejected',error:{code:'MESSAGE_EXPIRED'}});
 expect(f.db.all('SELECT * FROM attempts')).toEqual([]);
 expect(f.core.expireQueuedContexts()).toBe(0); expect(f.core.nextQueuedContextExpiry()).toBeNull();
});

it('claim and retry reject overdue unstarted work before cleanup and do not starve fresh work behind a backlog', () => {
 const waiting=enqueue(); f.db.exec("UPDATE runs SET status='waiting' WHERE id=?",waiting);
 for(let i=0;i<101;i++)enqueue();
 f.setNow('2026-12-09T00:00:00.000Z');
 const life=new LifecycleCore(f.store,f.core);
 f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=1,lease_until='2026-12-09T00:02:00.000Z'");
 const identity=life.registerBoot(randomUUID()); life.ready(identity);
 expect(life.claim(identity)).toBeNull();
 expect(f.accept({schema_version:1,type:'run.retry',payload:{run_id:waiting,expected_attempt:0}})).toMatchObject({status:'rejected',error:{code:'MESSAGE_EXPIRED'}});
 const fresh=enqueue(); expect(life.claim(identity)?.run.id).toBe(fresh);
 expect(f.core.expireQueuedContexts()).toBe(100); expect(f.core.nextQueuedContextExpiry()).toBe('2026-10-10T00:00:00.000Z');
 expect(f.core.expireQueuedContexts()).toBe(2); expect(f.core.nextQueuedContextExpiry()).toBeNull();
 expect(f.db.all('SELECT run_id FROM attempts')).toEqual([{run_id:fresh}]);
 expect(f.db.all("SELECT id FROM events WHERE type='run.input_expired'")).toHaveLength(102);
});

it('marks an expired unclaimed occurrence skipped while retaining its dedupe identity', () => {
 expect(f.accept({schema_version:1,type:'routine.put',payload:routine()}).status).toBe('applied');
 f.setNow('2026-09-10T00:15:00.000Z'); f.core.tick();
 const rows=f.db.all<Record<string,unknown>>('SELECT * FROM occurrences'); expect(rows).toHaveLength(1);
 expect(rows[0].status).toBe('queued');
 f.setNow('2026-12-09T00:15:00.000Z'); expect(f.core.expireQueuedContexts()).toBe(1);
 expect(f.db.all('SELECT * FROM occurrences')).toEqual([{...rows[0],status:'skipped'}]);
 expect(f.db.all('SELECT occurrence_id,status,current_attempt,context_json FROM runs')).toEqual([{occurrence_id:rows[0].id,status:'failed',current_attempt:0,context_json:'{}'}]);
 expect(f.db.all('SELECT * FROM attempts')).toEqual([]);
});

it.each([false,true])('does not wake for overdue input before cleanup, including expiry during observation (idle mode %s)', async idleMode => {
 const ref={provider:'fake' as const,id:'retention-provider'}, fake=new FakeProvider(()=>Date.parse(f.core.now()));
 fake.setPhase(ref,idleMode?'running':'stopped');
 const provider={id:fake.id,capabilities:{...fake.capabilities,...(idleMode?{stopMode:'provider-idle' as const}:{})},
  observe:async()=>{f.setNow('2026-12-09T00:00:00.000Z');return fake.observe(ref);},
  wake:fake.wake.bind(fake),stop:fake.stop.bind(fake),holdActivity:fake.holdActivity.bind(fake)};
 const life=new LifecycleCore(f.store,f.core,{idleMode});
 f.db.exec('UPDATE lifecycle SET provider_ref_json=?',JSON.stringify(ref));
 enqueue(); f.setNow('2026-12-08T23:59:59.999Z');
 await life.drive(provider); expect(fake.calls).toEqual([]);
 await life.drive(provider); expect(fake.calls).toEqual([]);
 expect(f.db.all('SELECT * FROM controller_operations')).toEqual([]);
 enqueue(); await life.drive(provider);
 expect(fake.calls.map(call=>call.action)).toEqual(['wake']);
});
