import type {Database} from './store';
import {requireThat} from './errors';
import {FLIGHT_RESTORE_SQL} from './flight-restore';
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
 if(version===3)version=4;
 if(version===4)db.transaction(()=>{
  db.exec('CREATE INDEX events_created ON events(created_at,sequence)');
  db.exec('CREATE TABLE event_tombstones (id TEXT PRIMARY KEY,sequence INTEGER NOT NULL UNIQUE,conversation_id TEXT,created_at TEXT NOT NULL)');
  db.exec('CREATE INDEX event_tombstones_conversation ON event_tombstones(conversation_id,sequence)');
  db.exec('CREATE TABLE context_retention (consumer_id TEXT NOT NULL,conversation_id TEXT NOT NULL,pruned_through INTEGER NOT NULL,PRIMARY KEY(consumer_id,conversation_id))');
  db.exec('INSERT INTO schema_versions(version,applied_at) VALUES(5,?)',now);
 });
 if(version===4)version=5;
 if(version===5)db.transaction(()=>{
  db.exec("CREATE INDEX commands_payload_expiry ON commands(accepted_at,id) WHERE payload_json!='{}' AND status IN ('applied','rejected')");
  db.exec('INSERT INTO schema_versions(version,applied_at) VALUES(6,?)',now);
 });
 if(version===5)version=6;
 if(version===6)db.transaction(()=>{
  db.exec("CREATE INDEX attempts_result_expiry ON attempts(settled_at,run_id,attempt) WHERE result_json IS NOT NULL AND settled_at IS NOT NULL AND status IN ('completed','failed','cancelled')");
  db.exec('INSERT INTO schema_versions(version,applied_at) VALUES(7,?)',now);
 });
 if(version===6)version=7;
 if(version===7)db.transaction(()=>{
  db.exec("CREATE TABLE task_followups_retained (id TEXT PRIMARY KEY,run_id TEXT NOT NULL REFERENCES runs(id),text TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending','coordinator_queued','expired')),command_id TEXT NOT NULL REFERENCES commands(id),created_at TEXT NOT NULL,coordinator_run_id TEXT REFERENCES runs(id))");
  db.exec('INSERT INTO task_followups_retained SELECT id,run_id,text,status,command_id,created_at,coordinator_run_id FROM task_followups');
  db.exec('DROP TABLE task_followups');
  db.exec('ALTER TABLE task_followups_retained RENAME TO task_followups');
  db.exec("CREATE INDEX task_followups_expiry ON task_followups(created_at,id) WHERE text!=''");
  db.exec('INSERT INTO schema_versions(version,applied_at) VALUES(8,?)',now);
 });
 if(version===7)version=8;
 if(version===8)db.transaction(()=>{
  // Previously created by FlightRestoreIntegration at startup, outside the
  // canonical schema. Adopt that exact table without replacing its deadlines.
  db.exec(FLIGHT_RESTORE_SQL);
  const sql=db.all<{sql:string}>("SELECT sql FROM sqlite_schema WHERE type='table' AND name='flight_restore_deadlines'")[0]?.sql;
  requireThat(sql===FLIGHT_RESTORE_SQL.replace(' IF NOT EXISTS',''),'SCHEMA_MISMATCH','Flight deadline schema needs explicit reconciliation.',503);
  db.exec('INSERT INTO schema_versions(version,applied_at) VALUES(9,?)',now);
 });
 if(version===8)version=9;
 if(version===9)db.transaction(()=>{
  db.exec('ALTER TABLE attempts ADD COLUMN coordinator_release_json TEXT CHECK(coordinator_release_json IS NULL OR json_valid(coordinator_release_json))');
  db.exec('INSERT INTO schema_versions(version,applied_at) VALUES(10,?)',now);
 });
 if(version===9)version=10;
 if(version===10)db.transaction(()=>{
  // A thread retains its original custody across distinct turn receipts.
  db.exec('CREATE TABLE native_task_links_v11 (run_id TEXT PRIMARY KEY REFERENCES runs(id),parent_run_id TEXT NOT NULL REFERENCES runs(id),parent_attempt INTEGER NOT NULL,native_run_ref TEXT NOT NULL UNIQUE,native_session_key TEXT NOT NULL)');
  db.exec('INSERT INTO native_task_links_v11 SELECT run_id,parent_run_id,parent_attempt,native_run_ref,native_session_key FROM native_task_links');
  db.exec('DROP TABLE native_task_links');
  db.exec('ALTER TABLE native_task_links_v11 RENAME TO native_task_links');
  db.exec('CREATE INDEX native_task_links_session ON native_task_links(native_session_key)');
  db.exec('INSERT INTO schema_versions(version,applied_at) VALUES(11,?)',now);
 });
 requireThat([10,11].includes(version),'SCHEMA_MISMATCH','Storage schema needs a supported migration.',503);
}
