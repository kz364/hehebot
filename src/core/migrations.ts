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
 if(version===10)version=11;
 if(version===11)db.transaction(()=>{
  // Historical attempts have no captured attribution; never infer it from current context.
  db.exec("ALTER TABLE attempts ADD COLUMN captured_routine_revision INTEGER CHECK(captured_routine_revision IS NULL OR (typeof(captured_routine_revision)='integer' AND captured_routine_revision>0 AND captured_routine_revision<=9007199254740991))");
  db.exec('INSERT INTO schema_versions(version,applied_at) VALUES(12,?)',now);
 });
 if(version===11)version=12;
 if(version===12)db.transaction(()=>{
  // runs references occurrences with NO ACTION, never CASCADE/SET NULL. Keep
  // those references and FK enforcement intact while replacing the parent.
  db.exec('PRAGMA defer_foreign_keys=ON');
  try{
   db.exec(`CREATE TABLE occurrences_v13 (
 id TEXT PRIMARY KEY, routine_id TEXT NOT NULL REFERENCES objects(id), routine_version INTEGER NOT NULL,
 nominal_due_at TEXT, status TEXT NOT NULL CHECK(status IN ('queued','claimed','completed','skipped','superseded','failed')),
 coalesced_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
 origin TEXT NOT NULL DEFAULT 'scheduled' CHECK(origin IN ('scheduled','manual')),
 CHECK((origin='scheduled' AND nominal_due_at IS NOT NULL) OR (origin='manual' AND nominal_due_at IS NULL)),
 UNIQUE(routine_id,routine_version,nominal_due_at)
)`);
   db.exec("INSERT INTO occurrences_v13 SELECT id,routine_id,routine_version,nominal_due_at,status,coalesced_count,created_at,'scheduled' FROM occurrences");
   db.exec('DROP TABLE occurrences');
   db.exec('ALTER TABLE occurrences_v13 RENAME TO occurrences');
   db.exec('INSERT INTO schema_versions(version,applied_at) VALUES(13,?)',now);
   requireThat(db.all('PRAGMA foreign_key_check').length===0,'SCHEMA_MISMATCH','Occurrence migration must preserve foreign keys.',503);
  }finally{
   // SQLite retains the DROP's deferred violation counter after a valid rebuild.
   // OFF clears it, not validates it: the scan above is mandatory; any error
   // still escapes the callback and rolls back the entire transaction.
   db.exec('PRAGMA defer_foreign_keys=OFF');
  }
 });
 if(version===12)version=13;
 if(version===13)db.transaction(()=>{
  const sql="CREATE INDEX objects_memory_scope ON objects(json_extract(body_json,'$.scope.kind'),json_extract(body_json,'$.scope.id'),created_at,id) WHERE kind='memory' AND deleted_at IS NULL";
  if(!db.all("SELECT name FROM sqlite_schema WHERE name='objects_memory_scope'").length){
   // Bound table rows visited, new entries, JSON and non-JSON key input.
   // Refuse before DDL; never prune owner data to make a migration fit.
   const scanned=db.all<{rows:number}>('SELECT COUNT(*) AS rows FROM (SELECT 1 FROM objects LIMIT 100001)')[0].rows;
   requireThat(scanned<=100000,'MIGRATION_WORK_LIMIT',
    'Memory index construction exceeds the 100000-object scan limit. Explicit reconciliation is required; no data was deleted.',503);
   const work=db.all<{rows:number;bytes:number;key_bytes:number}>(`SELECT COUNT(*) AS rows,COALESCE(SUM(bytes),0) AS bytes,COALESCE(SUM(key_bytes),0) AS key_bytes FROM (
    SELECT length(CAST(body_json AS BLOB)) AS bytes,
     length(CAST(id AS BLOB))+length(CAST(created_at AS BLOB)) AS key_bytes FROM objects
    WHERE kind='memory' AND deleted_at IS NULL LIMIT 10001
   )`)[0];
   requireThat(work.rows<=10000&&work.bytes<=67108864&&work.key_bytes<=4194304,'MIGRATION_WORK_LIMIT',
    'Memory index construction exceeds 10000 active records, 64 MiB of raw JSON or 4 MiB of ID/timestamp keys. Explicit reconciliation is required; no memory was deleted.',503);
  }
  db.exec(sql.replace('CREATE INDEX','CREATE INDEX IF NOT EXISTS'));
  requireThat(db.all<{sql:string}>("SELECT sql FROM sqlite_schema WHERE name='objects_memory_scope'")[0]?.sql===sql,
   'SCHEMA_MISMATCH','Memory scope index needs explicit reconciliation.',503);
  db.exec('INSERT INTO schema_versions(version,applied_at) VALUES(14,?)',now);
 });
 if(version===13)version=14;
 if(version===14)db.transaction(()=>{
  const sql='CREATE INDEX runs_parent ON runs(parent_run_id,id)';
  db.exec(sql.replace('CREATE INDEX','CREATE INDEX IF NOT EXISTS'));
  requireThat(db.all<{sql:string}>("SELECT sql FROM sqlite_schema WHERE name='runs_parent'")[0]?.sql===sql,
   'SCHEMA_MISMATCH','Run parent index needs explicit reconciliation.',503);
  db.exec('INSERT INTO schema_versions(version,applied_at) VALUES(15,?)',now);
 });
 if(version===14)version=15;
 if(version===15)db.transaction(()=>{
  let rows=0,bytes=0;
  const pending:string[]=[];
  for(const [name,table,columns] of [
   ['operations_run_status','operations','run_id,status'],
   ['effects_run_status','effects','run_id,status'],
   ['resource_locks_run','resource_locks','run_id'],
  ]){
   const sql=`CREATE INDEX ${name} ON ${table}(${columns})`;
   const existing=db.all<{sql:string}>('SELECT sql FROM sqlite_schema WHERE name=?',name)[0];
   if(existing){requireThat(existing.sql===sql,'SCHEMA_MISMATCH','Settlement index needs explicit reconciliation.',503);continue;}
   // Bound aggregate construction input before any DDL. Eight bytes reserve
   // the largest rowid key; this is not a bound on SQLite's total allocation.
   const size=columns.split(',').map(column=>`length(CAST(${column} AS BLOB))`).join('+')+'+8';
   const work=db.all<{rows:number;bytes:number}>(`SELECT COUNT(*) AS rows,COALESCE(SUM(${size}),0) AS bytes FROM (SELECT ${columns} FROM ${table} LIMIT ?)`,100000-rows+1)[0];
   rows+=work.rows;bytes+=work.bytes;
   requireThat(rows<=100000&&bytes<=4194304,'MIGRATION_WORK_LIMIT',
    'Settlement index construction exceeds 100000 rows or 4 MiB of key input. Explicit reconciliation is required; no custody data was deleted.',503);
   pending.push(sql);
  }
  for(const sql of pending)db.exec(sql);
  db.exec('INSERT INTO schema_versions(version,applied_at) VALUES(16,?)',now);
 });
 if(version===15)version=16;
 if(version===16)db.transaction(()=>{
  // Guarded/idempotent like the v13-v15 index migrations: a downstream test or
  // deployment may re-run this step while the table already exists.
  // Exact text match with DB/schema.sql's bot_messages definition: fresh bootstrap
  // and migration must produce byte-identical sqlite_schema for the export pin.
  const tableSql=`CREATE TABLE bot_messages (
 message_key TEXT PRIMARY KEY, run_id TEXT NOT NULL, attempt INTEGER NOT NULL,
 event_sequence INTEGER NOT NULL, origin TEXT NOT NULL CHECK(origin IN ('tool','final_text')), created_at TEXT NOT NULL
)`;
  db.exec(tableSql.replace('CREATE TABLE','CREATE TABLE IF NOT EXISTS'));
  requireThat(db.all<{sql:string}>("SELECT sql FROM sqlite_schema WHERE name='bot_messages'")[0]?.sql===tableSql,
   'SCHEMA_MISMATCH','Bot message schema needs explicit reconciliation.',503);
  const indexSql='CREATE INDEX bot_messages_run_attempt ON bot_messages(run_id,attempt)';
  db.exec(indexSql.replace('CREATE INDEX','CREATE INDEX IF NOT EXISTS'));
  requireThat(db.all<{sql:string}>("SELECT sql FROM sqlite_schema WHERE name='bot_messages_run_attempt'")[0]?.sql===indexSql,
   'SCHEMA_MISMATCH','Bot message index needs explicit reconciliation.',503);
  db.exec('INSERT INTO schema_versions(version,applied_at) VALUES(17,?)',now);
 });
 if(version===16)version=17;
 if(version===17)db.transaction(()=>{
  // V2 (ARCHITECTURE_V2 A3): 'interrupted' is a new terminal run status. SQLite
  // cannot ALTER a CHECK constraint, so rebuild the table like the v12/v13
  // rebuilds did. Existing hosted rows in recovery_required are NOT rewritten:
  // only new interruptions use the new status.
  db.exec('PRAGMA defer_foreign_keys=ON');
  try{
   db.exec(`CREATE TABLE runs_v18 (
 id TEXT PRIMARY KEY, command_id TEXT REFERENCES commands(id), occurrence_id TEXT UNIQUE REFERENCES occurrences(id),
 persona_id TEXT NOT NULL REFERENCES objects(id), routine_id TEXT REFERENCES objects(id),
 context_json TEXT NOT NULL CHECK(json_valid(context_json)),
 role TEXT NOT NULL DEFAULT 'coordinator' CHECK(role IN ('coordinator','background')),
 parent_run_id TEXT REFERENCES runs_v18(id), title TEXT,
 status TEXT NOT NULL CHECK(status IN ('queued','claimed','running','finishing','completed','waiting','failed','cancelling','cancelled','recovery_required','interrupted')),
 current_attempt INTEGER NOT NULL DEFAULT 0, error_code TEXT, checkpoint_json TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)`);
   db.exec(`INSERT INTO runs_v18 SELECT id,command_id,occurrence_id,persona_id,routine_id,context_json,role,parent_run_id,title,status,current_attempt,error_code,checkpoint_json,created_at,updated_at FROM runs`);
   db.exec('DROP TABLE runs');
   db.exec('ALTER TABLE runs_v18 RENAME TO runs');
   db.exec('CREATE INDEX runs_status_created ON runs(status,created_at)');
   db.exec('CREATE INDEX runs_parent ON runs(parent_run_id,id)');
   db.exec('INSERT INTO schema_versions(version,applied_at) VALUES(18,?)',now);
   requireThat(db.all('PRAGMA foreign_key_check').length===0,'SCHEMA_MISMATCH','Run interruption migration must preserve foreign keys.',503);
   const tableSql=`CREATE TABLE "runs" (
 id TEXT PRIMARY KEY, command_id TEXT REFERENCES commands(id), occurrence_id TEXT UNIQUE REFERENCES occurrences(id),
 persona_id TEXT NOT NULL REFERENCES objects(id), routine_id TEXT REFERENCES objects(id),
 context_json TEXT NOT NULL CHECK(json_valid(context_json)),
 role TEXT NOT NULL DEFAULT 'coordinator' CHECK(role IN ('coordinator','background')),
 parent_run_id TEXT REFERENCES "runs"(id), title TEXT,
 status TEXT NOT NULL CHECK(status IN ('queued','claimed','running','finishing','completed','waiting','failed','cancelling','cancelled','recovery_required','interrupted')),
 current_attempt INTEGER NOT NULL DEFAULT 0, error_code TEXT, checkpoint_json TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)`;
   requireThat(db.all<{sql:string}>("SELECT sql FROM sqlite_schema WHERE name='runs'")[0]?.sql===tableSql,
    'SCHEMA_MISMATCH','Run schema needs explicit reconciliation.',503);
  }finally{
   // Mirror the v12 pattern: OFF clears SQLite's deferred violation counter
   // after a valid rebuild; the mandatory scan above already ran inside the try.
   db.exec('PRAGMA defer_foreign_keys=OFF');
  }
 });
 if(version===17)version=18;
 if(version===18)db.transaction(()=>{
  // V9 (ARCHITECTURE_V2 A8): the bounded room turn scheduler's own bookkeeping.
  // room_turn_log is the append-only ledger of scheduled/settled/skipped turns
  // (one row per turn attempt at a member; a SKIPPED row never gets a run_id).
  // It is what hop depth, per-owner-message contribution counts and "is a turn
  // for this room currently in flight" are computed from -- never by parsing
  // context_json in SQL. room_turn_passes is bot_messages' sibling: the
  // dedupe/marker table for the explicit hehebot_pass_turn tool call.
  // Guarded/idempotent like the v16 bot_messages migration: a downstream test
  // or deployment may re-run this step while the tables already exist.
  const logSql=`CREATE TABLE room_turn_log (
 id TEXT PRIMARY KEY, room_id TEXT NOT NULL, member_id TEXT NOT NULL, root_cause_id TEXT NOT NULL,
 hop INTEGER NOT NULL, run_id TEXT, outcome TEXT CHECK(outcome IS NULL OR outcome IN ('SENT','PASS','SKIPPED','TIMEOUT','ERROR')),
 created_at TEXT NOT NULL
)`;
  db.exec(logSql.replace('CREATE TABLE','CREATE TABLE IF NOT EXISTS'));
  requireThat(db.all<{sql:string}>("SELECT sql FROM sqlite_schema WHERE name='room_turn_log'")[0]?.sql===logSql,
   'SCHEMA_MISMATCH','Room turn log schema needs explicit reconciliation.',503);
  db.exec('CREATE INDEX IF NOT EXISTS room_turn_log_room ON room_turn_log(room_id,created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS room_turn_log_cause ON room_turn_log(root_cause_id)');
  const passesSql=`CREATE TABLE room_turn_passes (
 run_id TEXT NOT NULL, attempt INTEGER NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(run_id,attempt)
)`;
  db.exec(passesSql.replace('CREATE TABLE','CREATE TABLE IF NOT EXISTS'));
  requireThat(db.all<{sql:string}>("SELECT sql FROM sqlite_schema WHERE name='room_turn_passes'")[0]?.sql===passesSql,
   'SCHEMA_MISMATCH','Room turn passes schema needs explicit reconciliation.',503);
  const pendingSql=`CREATE TABLE room_turn_pending (
 room_id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('owner','candidate')),
 member_id TEXT, text TEXT, root_cause_id TEXT NOT NULL, hop INTEGER NOT NULL, created_at TEXT NOT NULL
)`;
  db.exec(pendingSql.replace('CREATE TABLE','CREATE TABLE IF NOT EXISTS'));
  requireThat(db.all<{sql:string}>("SELECT sql FROM sqlite_schema WHERE name='room_turn_pending'")[0]?.sql===pendingSql,
   'SCHEMA_MISMATCH','Room turn pending schema needs explicit reconciliation.',503);
  db.exec('INSERT INTO schema_versions(version,applied_at) VALUES(19,?)',now);
 });
 if(version===18)version=19;
 if(version===19)db.transaction(()=>{
  // Push notifications (TODO.md "Push notifications"): one row per browser
  // subscription (endpoint hashed for the primary key so an oversized endpoint
  // string is never indexed), plus a per-persona send-collapse timestamp.
  // ARCHITECTURE_V2 A6 broadcasts committed events to /v1/stream sockets on
  // commit; this is that hook's push sibling (see control-object.ts).
  const subsSql=`CREATE TABLE push_subscriptions (
 endpoint_sha256 TEXT PRIMARY KEY, endpoint TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
 owner_id TEXT NOT NULL, created_at TEXT NOT NULL
)`;
  db.exec(subsSql.replace('CREATE TABLE','CREATE TABLE IF NOT EXISTS'));
  requireThat(db.all<{sql:string}>("SELECT sql FROM sqlite_schema WHERE name='push_subscriptions'")[0]?.sql===subsSql,
   'SCHEMA_MISMATCH','Push subscription schema needs explicit reconciliation.',503);
  const throttleSql='CREATE TABLE push_throttle (persona_id TEXT PRIMARY KEY, sent_at TEXT NOT NULL)';
  db.exec(throttleSql.replace('CREATE TABLE','CREATE TABLE IF NOT EXISTS'));
  requireThat(db.all<{sql:string}>("SELECT sql FROM sqlite_schema WHERE name='push_throttle'")[0]?.sql===throttleSql,
   'SCHEMA_MISMATCH','Push throttle schema needs explicit reconciliation.',503);
  db.exec('INSERT INTO schema_versions(version,applied_at) VALUES(20,?)',now);
 });
 if(version===19)version=20;
 requireThat([16,17,18,19,20].includes(version),'SCHEMA_MISMATCH','Storage schema needs a supported migration.',503);
}
