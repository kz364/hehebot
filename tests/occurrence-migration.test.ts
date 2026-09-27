import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {migrateApplication} from '../src/core/migrations';
import type {Database,SqlValue} from '../src/core/store';
import {legacyOccurrencesSql} from './legacy-occurrences';

const schema=readFileSync(new URL('../DB/schema.sql',import.meta.url),'utf8');
const prior=schema.replace(/CREATE TABLE "occurrences" \([\s\S]*?\n\);/,legacyOccurrencesSql+';').replace('VALUES (19,','VALUES (12,').replace(/^CREATE INDEX (objects_memory_scope|runs_parent|operations_run_status|effects_run_status|resource_locks_run|bot_messages_run_attempt) .*\n/gm,'').replace(/\n-- Committed bot messages[\s\S]*?CREATE TABLE bot_messages \([\s\S]*?\n\);\n/,'\n');
const schemaRows=(sqlite:DatabaseSync)=>sqlite.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name").all();
function fixture(migrated=true){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec(migrated?prior:schema);
 sqlite.exec(`INSERT INTO objects VALUES('routine-19','routine',73,'{}',NULL,'t1','t2'),('persona-31','persona',2,'{}',NULL,'t1','t2');
  INSERT INTO occurrences(id,routine_id,routine_version,nominal_due_at,status,coalesced_count,created_at)
   VALUES('occurrence-43','routine-19',7,'2026-09-17T03:15:00.000Z','claimed',5,'t3'),('occurrence-89','routine-19',11,'2026-09-17T04:30:00.000Z','failed',2,'t4');
  INSERT INTO runs(id,occurrence_id,persona_id,routine_id,context_json,status,current_attempt,created_at,updated_at)
   VALUES('run-59','occurrence-43','persona-31','routine-19','{}','running',1,'t3','t5');
  INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,status,deadline_at,captured_routine_revision)
   VALUES('run-59',1,'submission-67',3,'boot-71','running','t9',7);`);
 const db:Database={all:<T>(sql:string,...values:SqlValue[])=>sqlite.prepare(sql).all(...values) as T[],exec:(sql,...values)=>{sqlite.prepare(sql).run(...values);},transaction:<T>(fn:()=>T)=>{sqlite.exec('BEGIN');try{const result=fn();sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}}};
 return{sqlite,db};
}

describe('v13 occurrence origin migration',()=>{
 it('preserves live referenced rows and exact schema, then reruns without changes',()=>{
  const {sqlite,db}=fixture(),fresh=new DatabaseSync(':memory:');try{
   fresh.exec(schema);
   const occurrences=db.all('SELECT * FROM occurrences'),runs=db.all('SELECT * FROM runs'),attempts=db.all('SELECT * FROM attempts');
   migrateApplication(db,'2026-09-17T06:00:00.000Z');
   expect(db.all('SELECT * FROM occurrences')).toEqual(occurrences.map(row=>({...row as object,origin:'scheduled'})));
   expect(db.all('SELECT * FROM runs')).toEqual(runs);expect(db.all('SELECT * FROM attempts')).toEqual(attempts);
   expect(schemaRows(sqlite)).toEqual(schemaRows(fresh));
   expect(createHash('sha256').update(JSON.stringify(schemaRows(sqlite))).digest('hex')).toBe('444bb7e91df0388dff09520398bc9cc24e3b5c7347f9244983a79a6521228f10');
   expect(db.all('PRAGMA foreign_key_check')).toEqual([]);
   expect(db.all('PRAGMA foreign_keys')).toEqual([{foreign_keys:1}]);
   expect(db.all('PRAGMA defer_foreign_keys')).toEqual([{defer_foreign_keys:0}]);
   const before=db.all('SELECT total_changes() AS n');migrateApplication(db,'later');
   expect(db.all('SELECT total_changes() AS n')).toEqual(before);
   expect(db.all('SELECT * FROM schema_versions WHERE version=13')).toEqual([{version:13,applied_at:'2026-09-17T06:00:00.000Z'}]);
  }finally{sqlite.close();fresh.close();}
 });
 it.each(['version','foreign-key','final-write'])('rolls back %s failure after parent replacement, with live references intact',failure=>{
  const {sqlite,db}=fixture();try{
   if(failure==='version')sqlite.exec("CREATE TRIGGER reject_v13 BEFORE INSERT ON schema_versions WHEN NEW.version=13 BEGIN SELECT RAISE(ABORT,'synthetic v13 failure'); END");
   const before=schemaRows(sqlite),occurrences=db.all('SELECT * FROM occurrences'),runs=db.all('SELECT * FROM runs');
   const injected:Database={...db,exec:(sql,...values)=>{db.exec(sql,...values);if((failure==='foreign-key'&&sql==='ALTER TABLE occurrences_v13 RENAME TO occurrences')||(failure==='final-write'&&sql==='INSERT INTO schema_versions(version,applied_at) VALUES(13,?)'))db.exec("UPDATE runs SET occurrence_id='missing' WHERE id='run-59'");}};
   expect(()=>migrateApplication(injected,'now')).toThrow();
   expect(schemaRows(sqlite)).toEqual(before);expect(db.all('SELECT * FROM occurrences')).toEqual(occurrences);expect(db.all('SELECT * FROM runs')).toEqual(runs);
   expect(db.all('SELECT MAX(version) AS version FROM schema_versions')).toEqual([{version:12}]);
   expect(db.all('PRAGMA foreign_keys')).toEqual([{foreign_keys:1}]);expect(db.all('PRAGMA defer_foreign_keys')).toEqual([{defer_foreign_keys:0}]);
   expect(()=>db.exec("UPDATE runs SET occurrence_id='missing' WHERE id='run-59'")).toThrow();
  }finally{sqlite.close();}
 });
 it.each([false,true])('enforces manual/null and scheduled/non-null constraints and dedupe (migrated=%s)',migrated=>{
  const {sqlite,db}=fixture(migrated);try{
   migrateApplication(db,'now');
   const insert=(id:string,due:string|null,origin:string|null)=>db.exec("INSERT INTO occurrences(id,routine_id,routine_version,nominal_due_at,status,created_at,origin) VALUES(?,'routine-19',7,?,'queued','t6',?)",id,due,origin);
   insert('manual-1',null,'manual');insert('manual-2',null,'manual');
   insert('scheduled-1','2026-09-17T06:15:00.000Z','scheduled');
   expect(()=>insert('duplicate','2026-09-17T03:15:00.000Z','scheduled')).toThrow();
   for(const [due,origin] of [[null,'scheduled'],['due','manual'],[null,'other'],[null,null]])expect(()=>insert('invalid',due,origin)).toThrow();
   db.exec("INSERT INTO occurrences(id,routine_id,routine_version,nominal_due_at,status,created_at) VALUES('default','routine-19',7,'next','queued','t7')");
   expect(db.all("SELECT origin FROM occurrences WHERE id='default'")).toEqual([{origin:'scheduled'}]);
   expect(db.all("SELECT id,nominal_due_at FROM occurrences WHERE origin='manual' ORDER BY id")).toEqual([{id:'manual-1',nominal_due_at:null},{id:'manual-2',nominal_due_at:null}]);
  }finally{sqlite.close();}
 });
});
