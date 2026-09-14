import type {Database} from './store';
import {requireThat} from './errors';
/** Preserve local v1 records when adding native task metadata. No native DB edits. */
export function migrateApplication(db:Database,now:string):void {
 let version=db.all<{version:number}>('SELECT MAX(version) AS version FROM schema_versions')[0].version;
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
 if(version===1)version=2;
 if(version===2)db.transaction(()=>{
  db.exec("CREATE TABLE skill_proposals (id TEXT PRIMARY KEY,skill_id TEXT NOT NULL,proposal_revision INTEGER NOT NULL,expected_skill_revision INTEGER NOT NULL,body_json TEXT NOT NULL CHECK(json_valid(body_json)),provenance_json TEXT NOT NULL CHECK(json_valid(provenance_json)),status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),executable_files_changed INTEGER NOT NULL CHECK(executable_files_changed IN (0,1)),actor_id TEXT NOT NULL,command_id TEXT NOT NULL REFERENCES commands(id),reviewed_by TEXT,created_at TEXT NOT NULL,reviewed_at TEXT,UNIQUE(skill_id,proposal_revision))");
  db.exec('CREATE INDEX skill_proposals_status ON skill_proposals(status,created_at)');
  db.exec("CREATE TABLE skill_enablements (skill_id TEXT NOT NULL REFERENCES objects(id),persona_id TEXT NOT NULL REFERENCES objects(id),skill_revision INTEGER NOT NULL,enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),updated_at TEXT NOT NULL,PRIMARY KEY(skill_id,persona_id))");
  db.exec('INSERT INTO schema_versions(version,applied_at) VALUES(3,?)',now);
 });
 if(version===2)version=3;
 if(version===3)db.transaction(()=>{
  db.exec('CREATE TABLE room_publications (event_id TEXT PRIMARY KEY,room_id TEXT NOT NULL,actor_id TEXT NOT NULL,cause_id TEXT NOT NULL,payload_digest TEXT NOT NULL,kind TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(room_id,actor_id,cause_id,payload_digest))');
  db.exec('CREATE INDEX room_publications_cause ON room_publications(cause_id,kind)');
  db.exec('INSERT INTO schema_versions(version,applied_at) VALUES(4,?)',now);
 });
 requireThat([3,4].includes(version),'SCHEMA_MISMATCH','Storage schema needs a supported migration.',503);
}
