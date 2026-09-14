import { afterEach, beforeEach, expect, it } from 'vitest';
import { fixture, bot } from './helpers';
let f: ReturnType<typeof fixture>, target: string;
beforeEach(() => {
 f = fixture();
 target = f.accept({schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'Synthetic target'}}).resource_id!;
 // Storage-only target fixture: no native settlement or dispatch is asserted.
 f.db.exec("UPDATE runs SET role='background' WHERE id=?", target);
});
afterEach(() => f.close());
function followup(text = 'Deferred canary 43') {
 return f.accept({schema_version:1,type:'run.followup',payload:{run_id:target,text}});
}
it('expires pending text at 90 days without changing the target or requesting a wake', () => {
 const receipt = followup(), before = f.db.all('SELECT * FROM task_followups')[0] as object;
 const runs = f.db.all('SELECT * FROM runs'), lifecycle = f.db.all('SELECT * FROM lifecycle');
 expect(f.core.nextFollowupExpiry()).toBe('2026-12-09T00:00:00.000Z');
 f.setNow('2026-12-08T23:59:59.999Z'); expect(f.core.expireFollowups()).toBe(0);
 f.setNow('2026-12-09T00:00:00.000Z'); expect(f.core.expireFollowups()).toBe(1);
 expect(f.db.all('SELECT * FROM task_followups')).toEqual([{...before,text:'',status:'expired'}]);
 expect(f.core.receipt(receipt.id)).toEqual(receipt);
 expect(f.db.all('SELECT * FROM runs')).toEqual(runs); expect(f.db.all('SELECT * FROM lifecycle')).toEqual(lifecycle);
 const events = f.db.all<{payload_json:string}>("SELECT payload_json FROM events WHERE type='task.followup_expired'");
 expect(events).toHaveLength(1); expect(JSON.parse(events[0].payload_json)).toEqual({run_id:target,followup_id:receipt.resource_id,reason:'MESSAGE_EXPIRED',requires_fresh_followup:true});
 expect(f.core.expireFollowups()).toBe(0); expect(f.core.nextFollowupExpiry()).toBeNull();
});
it('never dispatches overdue text even when cleanup is backlogged, but still accepts a fresh followup', () => {
 for (let i=0;i<101;i++) followup(`Old deferred ${i}`);
 f.setNow('2026-09-10T00:00:00.001Z'); const last = followup('Newest expired 71');
 f.setNow('2026-12-09T00:00:00.001Z'); expect(f.core.expireFollowups()).toBe(100);
 expect(f.db.all('SELECT status FROM task_followups WHERE id=?', last.resource_id!)).toEqual([{status:'pending'}]);
 f.db.exec("UPDATE runs SET status='completed' WHERE id=?", target);
 f.core.flushFollowups(target);
 expect(f.db.all('SELECT id FROM runs')).toHaveLength(1);
 expect(f.core.expireFollowups()).toBe(2); expect(f.core.expireFollowups()).toBe(0);
 const fresh = followup('Fresh instruction 103');
 expect(f.db.all('SELECT id FROM runs')).toHaveLength(2);
 expect(f.db.all('SELECT status FROM task_followups WHERE id=?', fresh.resource_id!)).toEqual([{status:'coordinator_queued'}]);
 expect(f.core.nextFollowupExpiry()).toBe('2027-03-09T00:00:00.001Z');
});
it('preserves dispatched identity and captured work when redacting the redundant followup copy', () => {
 followup(); f.setNow('2026-12-08T23:59:59.999Z');
 f.db.exec("UPDATE runs SET status='completed' WHERE id=?", target); f.core.flushFollowups(target);
 const followups = f.db.all('SELECT * FROM task_followups') as object[], runs = f.db.all('SELECT * FROM runs');
 expect(followups).toHaveLength(1); expect(runs).toHaveLength(2);
 f.setNow('2026-12-09T00:00:00.000Z'); expect(f.core.expireFollowups()).toBe(1);
 expect(f.db.all('SELECT * FROM task_followups')).toEqual(followups.map(row => ({...row,text:''})));
 expect(f.db.all('SELECT * FROM runs')).toEqual(runs);
 expect(f.db.all("SELECT id FROM events WHERE type='task.followup_expired'")).toHaveLength(0);
 f.core.flushFollowups(target); expect(f.db.all('SELECT id FROM runs')).toHaveLength(2);
});
