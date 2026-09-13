import type {Database} from './store';
import {requireThat} from './errors';
/** Preserve local v1 records when adding native task metadata. No native DB edits. */
export function migrateApplication(db:Database,now:string):void {
 const version=db.all<{version:number}>('SELECT MAX(version) AS version FROM schema_versions')[0].version;
 if(version===1)db.transaction(()=>{
  for(const sql of [
   "ALTER TABLE runs ADD COLUMN role TEXT NOT NULL DEFAULT 'coordinator' CHECK(role IN ('coordinator','background'))",
   'ALTER TABLE runs ADD COLUMN parent_run_id TEXT REFERENCES runs(id)',
   'ALTER TABLE runs ADD COLUMN title TEXT',
   'CREATE TABLE native_task_links (run_id TEXT PRIMARY KEY REFERENCES runs(id),parent_run_id TEXT NOT NULL REFERENCES runs(id),parent_attempt INTEGER NOT NULL,native_run_ref TEXT NOT NULL UNIQUE,native_session_key TEXT NOT NULL UNIQUE)',
   'CREATE TABLE resource_locks (resource_id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES runs(id),attempt INTEGER NOT NULL,acquired_at TEXT NOT NULL)',
   "CREATE TABLE task_followups (id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES runs(id),text TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending','coordinator_queued')),command_id TEXT NOT NULL REFERENCES commands(id),created_at TEXT NOT NULL,coordinator_run_id TEXT REFERENCES runs(id))",
  ])db.exec(sql);
  db.exec('INSERT INTO schema_versions(version,applied_at) VALUES(2,?)',now);
 });
 requireThat([1,2].includes(version),'SCHEMA_MISMATCH','Storage schema needs a supported migration.',503);
}
