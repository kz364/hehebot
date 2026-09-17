import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { LifecycleCore } from '../src/core/lifecycle';
import { ResultRetention } from '../src/core/result-retention';
import { fixture, bot } from './helpers';

let f: ReturnType<typeof fixture>, retention: ResultRetention;
beforeEach(() => { f = fixture(true); retention = new ResultRetention(f.store, () => f.core.now()); });
afterEach(() => f.close());
function finish(status: 'completed' | 'failed' | 'cancelled' | 'waiting' = 'completed') {
 const life = new LifecycleCore(f.store, f.core);
 f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=epoch+1,boot_id=NULL,lease_until=?", new Date(Date.parse(f.core.now()) + 90000).toISOString());
 const identity = life.registerBoot(randomUUID()); life.ready(identity);
 const id = f.accept({schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'Input 19'}}).resource_id!;
 expect(life.claim(identity)?.run.id).toBe(id);
 life.complete(identity, id, 1, {status,text:'Result canary 43',...(status === 'waiting' ? {checkpoint:{cursor:71}} : {})});
 return id;
}

it.each(['completed','failed','cancelled'] as const)('expires %s result copies exactly at 90 days, preserving structural records', status => {
 const id = finish(status);
 f.db.exec('UPDATE attempts SET captured_routine_revision=73 WHERE run_id=?',id);
 const attempt = f.db.all('SELECT * FROM attempts')[0] as object, delivery = f.db.all('SELECT * FROM outbox')[0] as object;
 const runs = f.db.all('SELECT * FROM runs'), lifecycle = f.db.all('SELECT * FROM lifecycle');
 expect(retention.nextDue()).toBe('2026-12-09T00:00:00.000Z');
 f.setNow('2026-12-08T23:59:59.999Z'); expect(retention.prune()).toBe(0);
 f.setNow('2026-12-09T00:00:00.000Z'); expect(retention.prune()).toBe(1);
 expect(f.db.all('SELECT * FROM attempts WHERE run_id=?', id)).toEqual([{...attempt,result_json:null}]);
 expect(f.db.all('SELECT * FROM outbox')).toEqual([{...delivery,payload_json:'{}'}]);
 expect(f.db.all('SELECT * FROM runs')).toEqual(runs); expect(f.db.all('SELECT * FROM lifecycle')).toEqual(lifecycle);
 expect(retention.prune()).toBe(0); expect(retention.nextDue()).toBeNull();
});

it.each(['waiting','recovery_required','pending','outcome_unknown','operation','effect','lock','retry'] as const)('preserves %s custody and payloads', obstacle => {
 const id = finish(obstacle === 'waiting' ? 'waiting' : 'completed');
 if (obstacle === 'recovery_required') f.db.exec("UPDATE runs SET status='recovery_required' WHERE id=?", id);
 if (obstacle === 'pending' || obstacle === 'outcome_unknown') f.db.exec('UPDATE outbox SET status=? WHERE run_id=?', obstacle, id);
 if (obstacle === 'operation') f.db.exec("INSERT INTO operations VALUES('op',?,1,'child','unknown',?,?,?)", id, f.core.now(), f.core.now(), f.core.now());
 if (obstacle === 'effect') f.db.exec("INSERT INTO effects(id,run_id,action_key,classification,status,authorization_ref,request_digest,updated_at) VALUES('effect',?,'key','mutation','outcome_unknown','policy','digest',?)", id, f.core.now());
 if (obstacle === 'lock') f.db.exec("INSERT INTO resource_locks VALUES('resource',?,1,?)", id, f.core.now());
 if (obstacle === 'retry') f.db.exec("INSERT INTO retry_queue VALUES(?,?,'synthetic')", id, f.core.now());
 const tables = ['runs','attempts','outbox','operations','effects','resource_locks','retry_queue'];
 const before = tables.map(table => f.db.all(`SELECT * FROM ${table}`));
 f.setNow('2026-12-09T00:00:00.000Z');
 expect(retention.nextDue()).toBeNull(); expect(retention.prune()).toBe(0);
 expect(tables.map(table => f.db.all(`SELECT * FROM ${table}`))).toEqual(before);
});

it('ages the replacement portal copy by the current settlement, never by delivery or old creation time', () => {
 const id = finish();
 f.db.exec("INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,native_run_ref,status,deadline_at,started_at,settled_at,result_json) SELECT run_id,2,'second',epoch,boot_id,native_run_ref,status,deadline_at,started_at,'2026-09-11T00:00:00.000Z','{\"text\":\"New result 103\"}' FROM attempts WHERE run_id=?", id);
 f.db.exec('UPDATE runs SET current_attempt=2 WHERE id=?', id);
 f.db.exec("UPDATE outbox SET payload_json='{\"text\":\"New result 103\"}',updated_at='2026-12-09T00:00:00.000Z' WHERE run_id=?", id);
 f.setNow('2026-12-09T00:00:00.000Z'); expect(retention.prune()).toBe(1);
 expect(f.db.all<{payload_json:string}>('SELECT payload_json FROM outbox')[0].payload_json).toContain('103');
 expect(retention.nextDue()).toBe('2026-12-10T00:00:00.000Z');
 f.setNow('2026-12-10T00:00:00.000Z'); expect(retention.prune()).toBe(1);
 expect(f.db.all('SELECT payload_json FROM outbox')).toEqual([{payload_json:'{}'}]);
});

it('bounds cleanup to 100 attempts and rolls back both copies on a write failure', () => {
 const id = finish();
 for (let attempt = 2; attempt <= 101; attempt++) f.db.exec('INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,native_run_ref,status,deadline_at,started_at,settled_at,result_json) SELECT run_id,?,?,epoch,boot_id,native_run_ref,status,deadline_at,started_at,settled_at,result_json FROM attempts WHERE run_id=? AND attempt=1', attempt, `submission-${attempt}`, id);
 f.setNow('2026-12-09T00:00:00.000Z');
 f.db.sqlite.exec("CREATE TRIGGER deny_result_prune BEFORE UPDATE ON outbox BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
 expect(() => retention.prune()).toThrow('synthetic failure');
 expect(f.db.all('SELECT run_id FROM attempts WHERE result_json IS NOT NULL')).toHaveLength(101);
 f.db.sqlite.exec('DROP TRIGGER deny_result_prune');
 expect(retention.prune()).toBe(100); expect(retention.nextDue()).toBe(f.core.now());
 expect(retention.prune()).toBe(1); expect(retention.nextDue()).toBeNull();
});
