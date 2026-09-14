import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { LifecycleCore } from '../src/core/lifecycle';
import { fixture, bot } from './helpers';
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
 expect(f.core.expireQueuedContexts()).toBe(0); expect(f.core.nextQueuedContextExpiry()).toBeNull();
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
