import {randomUUID} from 'node:crypto';
import {afterEach,beforeEach,expect,it} from 'vitest';
import {fixture,bot,routine} from './helpers';
let f:ReturnType<typeof fixture>;
beforeEach(()=>{f=fixture(true);});afterEach(()=>f.close());
const read=()=>f.core.state().monitoring;
const codes=()=>read().alerts.map(alert=>alert.code);
const enqueue=()=>f.accept({schema_version:1,type:'message.send',payload:{conversation_id:bot,text:'Synthetic private canary 19-43'}}).resource_id!;
it('reports no verified backup or native settlement and performs no writes',()=>{
 const before=f.db.all<{n:number}>('SELECT total_changes() AS n')[0].n;
 expect(read()).toMatchObject({scope:'control-plane-only',queue:{count:0,oldest_request_age_seconds:null},operations:[],effects:[],locks:0,backup:{status:'unverified',last_verified_at:null},alerts:[]});
 expect(f.db.all<{n:number}>('SELECT total_changes() AS n')[0].n).toBe(before);
 enqueue();expect(codes()).toContain('BACKUP_UNVERIFIED');
});
it('alerts strictly after 45-second heartbeat and 120-second request age boundaries',()=>{
 enqueue();f.db.exec("UPDATE lifecycle SET phase='READY',last_heartbeat=?",f.core.now());
 f.setNow('2026-09-10T00:00:45.000Z');expect(codes()).not.toContain('HEARTBEAT_STALE');
 f.setNow('2026-09-10T00:00:45.001Z');expect(codes()).toContain('HEARTBEAT_STALE');
 f.setNow('2026-09-10T00:02:00.000Z');expect(codes()).not.toContain('QUEUE_DELAYED');
 f.setNow('2026-09-10T00:02:00.001Z');expect(codes()).toContain('QUEUE_DELAYED');
 expect(read().queue.oldest_request_age_seconds).toBe(120.001);
 f.core.options.executionEnabled=false;expect(codes()).not.toContain('QUEUE_DELAYED');expect(codes()).not.toContain('HEARTBEAT_STALE');
});
it('missing and future heartbeat observations are unknown, not fresh or asleep',()=>{
 f.db.exec("UPDATE lifecycle SET phase='READY',last_heartbeat=NULL");expect(codes()).toContain('HEARTBEAT_UNKNOWN');
 f.db.exec("UPDATE lifecycle SET last_heartbeat='2026-09-11T00:00:00.000Z'");expect(read().lease.heartbeat_age_seconds).toBeNull();expect(codes()).toContain('HEARTBEAT_UNKNOWN');
 f.db.exec("UPDATE lifecycle SET phase='STOPPED'");expect(codes()).not.toContain('HEARTBEAT_UNKNOWN');
});
it('excludes expired and budget-blocked queued rows from ready-request age',()=>{
 const expired=enqueue();f.setNow('2026-12-09T00:00:00.000Z');expect(read().queue.count).toBe(0);
 const r=routine();f.accept({schema_version:1,type:'routine.put',payload:r});
 f.accept({schema_version:1,type:'budget.set',payload:{expected_revision:0,enabled:true,monthly_cap_cents:500,optional_routine_ids:[r.id]}});
 f.setNow('2026-12-09T00:15:00.000Z');f.core.tick();f.db.exec("UPDATE runs SET status='queued',error_code=NULL WHERE id<>?",expired);
 expect(read().queue).toEqual({count:0,oldest_request_age_seconds:null});
 const fresh=enqueue();expect(read().queue).toEqual({count:1,oldest_request_age_seconds:0});
 expect(f.store.run(fresh).status).toBe('queued');expect(f.store.run(expired).current_attempt).toBe(0);
});
it('groups unresolved obligations without leaking IDs, payloads or changing their status',()=>{
 const run=enqueue(),now=f.core.now();
 f.db.exec("UPDATE runs SET status='cancelling',current_attempt=1 WHERE id=?",run);
 f.db.exec("INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,status,deadline_at) VALUES(?,1,'synthetic-key',1,'synthetic-boot','running',?)",run,now);
 for(const [kind,status] of [['tool','active'],['tool','active'],['child','unknown'],['tool','settled']])f.db.exec('INSERT INTO operations VALUES(?,?,1,?,?,?,?,?)',randomUUID(),run,kind,status,now,now,now);
 for(const status of ['outcome_unknown','outcome_unknown','dispatched','confirmed'])f.db.exec("INSERT INTO effects(id,run_id,action_key,classification,status,authorization_ref,request_digest,receipt_json,updated_at) VALUES(?,?,?,'mutation',?,'private-policy','private-digest','{\"canary\":\"private receipt 71\"}',?)",randomUUID(),run,randomUUID(),status,now);
 f.db.exec("INSERT INTO resource_locks VALUES('private-resource',?,1,?)",run,now);
 const before=f.db.all<{n:number}>('SELECT total_changes() AS n')[0].n,result=read();
 expect(result.operations).toEqual([{kind:'child',status:'unknown',count:1},{kind:'tool',status:'active',count:2}]);
 expect(result.effects).toEqual([{status:'dispatched',count:1},{status:'outcome_unknown',count:2}]);
 expect(result).toMatchObject({overdue_operations:3,locks:1,tasks:{cancelling:1,recovery:0}});
 expect(result.alerts).toEqual(expect.arrayContaining([{code:'OUTCOME_UNKNOWN',severity:'error',count:2},{code:'CANCEL_UNCONFIRMED',severity:'error',count:1}]));
 expect(JSON.stringify(result)).not.toMatch(/private|canary|synthetic-key/);expect(JSON.stringify(result)).not.toContain(run);
 expect(f.db.all<{n:number}>('SELECT total_changes() AS n')[0].n).toBe(before);
});
it('flags schedule lag strictly above five minutes without ticking the schedule',()=>{
 const r=routine();f.accept({schema_version:1,type:'routine.put',payload:r});
 f.setNow('2026-09-10T00:20:00.000Z');expect(read().schedules).toEqual({overdue:1,lag_seconds:300});expect(codes()).not.toContain('SCHEDULE_DELAYED');
 f.setNow('2026-09-10T00:20:00.001Z');expect(codes()).toContain('SCHEDULE_DELAYED');expect(f.db.all('SELECT * FROM occurrences')).toEqual([]);
});
