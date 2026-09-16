import {describe,it,expect} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {migrateApplication} from '../src/core/migrations';
import type {Database,SqlValue} from '../src/core/store';
function legacy(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE schema_versions(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
 INSERT INTO schema_versions VALUES(1,'2026-09-01T00:00:00Z');
 CREATE TABLE commands(id TEXT PRIMARY KEY,payload_json TEXT,accepted_at TEXT DEFAULT '2026-09-01T00:00:00.000Z',status TEXT DEFAULT 'applied');
 CREATE TABLE runs(id TEXT PRIMARY KEY,status TEXT,context_json TEXT,command_id TEXT REFERENCES commands(id));
 CREATE TABLE attempts(run_id TEXT REFERENCES runs(id),attempt INTEGER,status TEXT,settled_at TEXT,result_json TEXT);
 CREATE TABLE objects(id TEXT PRIMARY KEY,body_json TEXT);
 CREATE TABLE events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,conversation_id TEXT,type TEXT NOT NULL,actor_id TEXT NOT NULL,cause_id TEXT,payload_json TEXT NOT NULL,created_at TEXT NOT NULL);
 INSERT INTO commands(id,payload_json) VALUES('command-1','{"text":"synthetic preserved command"}');
 INSERT INTO runs VALUES('run-1','waiting','{"synthetic":"preserve context"}','command-1');
 INSERT INTO objects VALUES('object-1','{"synthetic":"preserve object"}');`);
 const db:Database={all:<T>(sql:string,...values:SqlValue[])=>sqlite.prepare(sql).all(...values) as T[],exec:(sql:string,...values:SqlValue[])=>{sqlite.prepare(sql).run(...values);},transaction:<T>(fn:()=>T)=>{sqlite.exec('BEGIN');try{const value=fn();sqlite.exec('COMMIT');return value;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 return{sqlite,db};
}
describe('application v1 migration',()=>{
 it('preserves existing rows and identity while adding native task metadata; rerun is idempotent',()=>{
  const {db,sqlite}=legacy();try{
   const commands=db.all('SELECT * FROM commands'),objects=db.all('SELECT * FROM objects');
   migrateApplication(db,'2026-09-10T00:00:00Z');
   expect(db.all('SELECT * FROM commands')).toEqual(commands);expect(db.all('SELECT * FROM objects')).toEqual(objects);
   expect(db.all('SELECT * FROM runs')).toEqual([{id:'run-1',status:'waiting',context_json:'{"synthetic":"preserve context"}',command_id:'command-1',role:'coordinator',parent_run_id:null,title:null}]);
   expect(db.all("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('native_task_links','resource_locks','task_followups','skill_proposals','skill_enablements')")).toHaveLength(5);
   expect(db.all('SELECT * FROM room_publications')).toEqual([]);
   migrateApplication(db,'2026-09-11T00:00:00Z');expect(db.all('SELECT * FROM schema_versions')).toHaveLength(10);
   expect(db.all<{applied_at:string}>('SELECT applied_at FROM schema_versions WHERE version=2')[0].applied_at).toBe('2026-09-10T00:00:00Z');
   expect(db.all<{applied_at:string}>('SELECT applied_at FROM schema_versions WHERE version=3')[0].applied_at).toBe('2026-09-10T00:00:00Z');
   expect(db.all<{applied_at:string}>('SELECT applied_at FROM schema_versions WHERE version=4')[0].applied_at).toBe('2026-09-10T00:00:00Z');
   expect(db.all('SELECT * FROM event_tombstones')).toEqual([]);
   expect(db.all('SELECT * FROM context_retention')).toEqual([]);
  }finally{sqlite.close();}
 });
 it('rolls back partial ALTER changes if a later migration statement fails',()=>{
  const {db,sqlite}=legacy();try{
   sqlite.exec('CREATE TABLE resource_locks(resource_id TEXT PRIMARY KEY)');
   expect(()=>migrateApplication(db,'2026-09-10T00:00:00Z')).toThrow();
   expect(db.all<{name:string}>('PRAGMA table_info(runs)').some(c=>c.name==='role')).toBe(false);
   expect(db.all("SELECT name FROM sqlite_master WHERE name='native_task_links'")).toHaveLength(0);
   expect(db.all('SELECT * FROM runs')).toHaveLength(1);expect(db.all('SELECT version FROM schema_versions')).toEqual([{version:1}]);
  }finally{sqlite.close();}
 });
 it('rolls back publication migration on index conflict and preserves the v3 checkpoint',()=>{
  const {db,sqlite}=legacy();try{
   migrateApplication(db,'2026-09-10T00:00:00Z');
   sqlite.exec('ALTER TABLE attempts DROP COLUMN coordinator_release_json; DROP TABLE room_publications; DROP TABLE event_tombstones; DROP TABLE context_retention; DROP INDEX events_created; DROP INDEX commands_payload_expiry; DROP INDEX attempts_result_expiry; DELETE FROM schema_versions WHERE version>=4; CREATE INDEX room_publications_cause ON objects(id)');
   const before=db.all('SELECT * FROM runs');
   expect(()=>migrateApplication(db,'2026-09-11T00:00:00Z')).toThrow();
   expect(db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='room_publications'")).toEqual([]);
   expect(db.all('SELECT MAX(version) AS version FROM schema_versions')).toEqual([{version:3}]);
   expect(db.all('SELECT * FROM runs')).toEqual(before);
   sqlite.exec('DROP INDEX room_publications_cause');
   migrateApplication(db,'2026-09-12T00:00:00Z');
   expect(db.all('SELECT MAX(version) AS version FROM schema_versions')).toEqual([{version:10}]);
  }finally{sqlite.close();}
 });
 it('preserves v7 followups and foreign keys, and rolls back a failed table replacement',()=>{
  const {db,sqlite}=legacy();try{
   migrateApplication(db,'2026-09-10T00:00:00Z');
   sqlite.exec('ALTER TABLE attempts DROP COLUMN coordinator_release_json');
   sqlite.exec("DELETE FROM schema_versions WHERE version>=8; DROP TABLE task_followups; CREATE TABLE task_followups (id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES runs(id),text TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending','coordinator_queued')),command_id TEXT NOT NULL REFERENCES commands(id),created_at TEXT NOT NULL,coordinator_run_id TEXT REFERENCES runs(id)); INSERT INTO task_followups VALUES('pending-19','run-1','Keep pending 43','pending','command-1','2026-09-01T00:00:00.000Z',NULL),('queued-71','run-1','Keep queued 103','coordinator_queued','command-1','2026-09-02T00:00:00.000Z','run-1'); CREATE INDEX task_followups_expiry ON objects(id)");
   const before=db.all('SELECT * FROM task_followups ORDER BY id');
   expect(()=>migrateApplication(db,'2026-09-11T00:00:00Z')).toThrow();
   expect(db.all('SELECT * FROM task_followups ORDER BY id')).toEqual(before);
   expect(db.all('SELECT MAX(version) AS version FROM schema_versions')).toEqual([{version:7}]);
   expect(()=>db.exec("UPDATE task_followups SET status='expired'")).toThrow();
   sqlite.exec('DROP INDEX task_followups_expiry'); migrateApplication(db,'2026-09-12T00:00:00Z');
   expect(db.all('SELECT * FROM task_followups ORDER BY id')).toEqual(before);
   expect(()=>db.exec("UPDATE task_followups SET command_id='missing'")).toThrow();
   db.exec("UPDATE task_followups SET status='expired',text='' WHERE id='pending-19'");
   migrateApplication(db,'2026-09-13T00:00:00Z');
   expect(db.all("SELECT status,text FROM task_followups WHERE id='pending-19'")).toEqual([{status:'expired',text:''}]);
  }finally{sqlite.close();}
 });
 it('adopts existing v8 flight deadlines without rewriting pending or uncertain work',()=>{
  const {db,sqlite}=legacy();try{
   migrateApplication(db,'2026-09-10T00:00:00Z');
   sqlite.exec('ALTER TABLE attempts DROP COLUMN coordinator_release_json; DELETE FROM schema_versions WHERE version=10');
   sqlite.exec("DELETE FROM schema_versions WHERE version=9; INSERT INTO flight_restore_deadlines VALUES('leg-a',3,'2026-10-01T12:00:00Z','Asia/Jakarta','2026-10-01T00:00:00Z','routine-a','source-a','outcome_unknown','run-1',NULL),('leg-b',7,'2026-10-03T12:00:00Z','UTC','2026-10-03T00:00:00Z','routine-b','source-b','pending',NULL,NULL)");
   const before=db.all('SELECT * FROM flight_restore_deadlines ORDER BY leg_id');
   migrateApplication(db,'2026-09-12T00:00:00Z');migrateApplication(db,'2026-09-13T00:00:00Z');
   expect(db.all('SELECT * FROM flight_restore_deadlines ORDER BY leg_id')).toEqual(before);
   expect(db.all('SELECT * FROM schema_versions WHERE version=9')).toEqual([{version:9,applied_at:'2026-09-12T00:00:00Z'}]);
   sqlite.exec('ALTER TABLE attempts DROP COLUMN coordinator_release_json; DELETE FROM schema_versions WHERE version>=9; ALTER TABLE flight_restore_deadlines ADD COLUMN unexpected TEXT');
   expect(()=>migrateApplication(db,'2026-09-14T00:00:00Z')).toThrowError(expect.objectContaining({code:'SCHEMA_MISMATCH'}));
   expect(db.all('SELECT MAX(version) AS version FROM schema_versions')).toEqual([{version:8}]);
   expect(db.all('SELECT leg_id,status FROM flight_restore_deadlines ORDER BY leg_id')).toEqual([{leg_id:'leg-a',status:'outcome_unknown'},{leg_id:'leg-b',status:'pending'}]);
  }finally{sqlite.close();}
 });
 it('migrates v9 attempts without manufacturing release and rolls back a failed version write',()=>{
  const {db,sqlite}=legacy();try{
   migrateApplication(db,'2026-09-10T00:00:00Z');
   sqlite.exec("ALTER TABLE attempts DROP COLUMN coordinator_release_json; DELETE FROM schema_versions WHERE version=10; INSERT INTO attempts VALUES('run-1',3,'running',NULL,NULL),('run-1',2,'completed','earlier','{\"text\":\"preserve\"}'); CREATE TRIGGER reject_v10 BEFORE INSERT ON schema_versions WHEN NEW.version=10 BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
   const before=db.all('SELECT * FROM attempts');
   expect(()=>migrateApplication(db,'2026-09-11T00:00:00Z')).toThrow('synthetic failure');
   expect(db.all('SELECT * FROM attempts')).toEqual(before);
   expect(db.all('SELECT MAX(version) AS version FROM schema_versions')).toEqual([{version:9}]);
   sqlite.exec('DROP TRIGGER reject_v10');
   migrateApplication(db,'2026-09-12T00:00:00Z');
   expect(db.all('SELECT * FROM attempts')).toEqual(before.map(row=>({...row as object,coordinator_release_json:null})));
   db.exec('UPDATE attempts SET coordinator_release_json=? WHERE attempt=3',JSON.stringify({native_ref:'root-73',outcome:'interrupted'}));
   const released=db.all('SELECT * FROM attempts');migrateApplication(db,'2026-09-13T00:00:00Z');
   expect(db.all('SELECT * FROM attempts')).toEqual(released);
   expect(db.all('SELECT * FROM schema_versions WHERE version=10')).toEqual([{version:10,applied_at:'2026-09-12T00:00:00Z'}]);
  }finally{sqlite.close();}
 });
 it('rejects unknown future schema without changing application data',()=>{
  const {db,sqlite}=legacy();try{sqlite.exec("INSERT INTO schema_versions VALUES(99,'future')");const before=db.all('SELECT * FROM runs');expect(()=>migrateApplication(db,'2026-09-10T00:00:00Z')).toThrow();expect(db.all('SELECT * FROM runs')).toEqual(before);}finally{sqlite.close();}
 });
});
