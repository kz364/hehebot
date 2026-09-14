import {describe,it,expect} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {migrateApplication} from '../src/core/migrations';
import type {Database,SqlValue} from '../src/core/store';
function legacy(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE schema_versions(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
 INSERT INTO schema_versions VALUES(1,'2026-09-01T00:00:00Z');
 CREATE TABLE commands(id TEXT PRIMARY KEY,payload_json TEXT);
 CREATE TABLE runs(id TEXT PRIMARY KEY,status TEXT,context_json TEXT,command_id TEXT REFERENCES commands(id));
 CREATE TABLE objects(id TEXT PRIMARY KEY,body_json TEXT);
 CREATE TABLE events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,conversation_id TEXT,type TEXT NOT NULL,actor_id TEXT NOT NULL,cause_id TEXT,payload_json TEXT NOT NULL,created_at TEXT NOT NULL);
 INSERT INTO commands VALUES('command-1','{"text":"synthetic preserved command"}');
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
   migrateApplication(db,'2026-09-11T00:00:00Z');expect(db.all('SELECT * FROM schema_versions')).toHaveLength(5);
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
   sqlite.exec('DROP TABLE room_publications; DROP TABLE event_tombstones; DROP TABLE context_retention; DROP INDEX events_created; DELETE FROM schema_versions WHERE version>=4; CREATE INDEX room_publications_cause ON objects(id)');
   const before=db.all('SELECT * FROM runs');
   expect(()=>migrateApplication(db,'2026-09-11T00:00:00Z')).toThrow();
   expect(db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='room_publications'")).toEqual([]);
   expect(db.all('SELECT MAX(version) AS version FROM schema_versions')).toEqual([{version:3}]);
   expect(db.all('SELECT * FROM runs')).toEqual(before);
   sqlite.exec('DROP INDEX room_publications_cause');
   migrateApplication(db,'2026-09-12T00:00:00Z');
   expect(db.all('SELECT MAX(version) AS version FROM schema_versions')).toEqual([{version:5}]);
  }finally{sqlite.close();}
 });
 it('rejects unknown future schema without changing application data',()=>{
  const {db,sqlite}=legacy();try{sqlite.exec("INSERT INTO schema_versions VALUES(99,'future')");const before=db.all('SELECT * FROM runs');expect(()=>migrateApplication(db,'2026-09-10T00:00:00Z')).toThrow();expect(db.all('SELECT * FROM runs')).toEqual(before);}finally{sqlite.close();}
 });
});
