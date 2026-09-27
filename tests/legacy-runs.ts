import type {DatabaseSync} from 'node:sqlite';

// Exact pre-G-row (v16) canonical schema: no bot_messages table (added at v17),
// and runs.status has no 'interrupted' terminal state (added at v18). Mirrors
// scripts/import-control-export.mjs's legacy reconstruction so a v9-v16 fixture
// built from the current (v18) bootstrap matches its pinned schema hash.
export const legacyRunsSql = `CREATE TABLE runs (
 id TEXT PRIMARY KEY, command_id TEXT REFERENCES commands(id), occurrence_id TEXT UNIQUE REFERENCES occurrences(id),
 persona_id TEXT NOT NULL REFERENCES objects(id), routine_id TEXT REFERENCES objects(id),
 context_json TEXT NOT NULL CHECK(json_valid(context_json)),
 role TEXT NOT NULL DEFAULT 'coordinator' CHECK(role IN ('coordinator','background')),
 parent_run_id TEXT REFERENCES runs(id), title TEXT,
 status TEXT NOT NULL CHECK(status IN ('queued','claimed','running','finishing','completed','waiting','failed','cancelling','cancelled','recovery_required')),
 current_attempt INTEGER NOT NULL DEFAULT 0, error_code TEXT, checkpoint_json TEXT,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
)`;

/** Reconstruct a v9-v16 test fixture from the current (v18) bootstrap schema:
 * drop bot_messages and rebuild runs without 'interrupted', preserving existing
 * rows, foreign keys and any indexes still present on runs at call time. */
export function legacyRuns(db:DatabaseSync):void {
 db.exec('BEGIN; PRAGMA defer_foreign_keys=ON');
 try{
  db.exec('DROP TABLE IF EXISTS bot_messages');
  // V9 (v19): room_turn_log/passes/pending did not exist pre-v19 either.
  db.exec('DROP TABLE IF EXISTS room_turn_pending; DROP TABLE IF EXISTS room_turn_passes; DROP TABLE IF EXISTS room_turn_log');
  const indexes=db.prepare("SELECT sql FROM sqlite_schema WHERE type='index' AND tbl_name='runs' AND sql IS NOT NULL").all() as {sql:string}[];
  db.exec('CREATE TABLE legacy_runs_rows AS SELECT id,command_id,occurrence_id,persona_id,routine_id,context_json,role,parent_run_id,title,status,current_attempt,error_code,checkpoint_json,created_at,updated_at FROM runs');
  db.exec('DROP TABLE runs');db.exec(legacyRunsSql);
  db.exec('INSERT INTO runs SELECT * FROM legacy_runs_rows; DROP TABLE legacy_runs_rows');
  for(const {sql} of indexes)db.exec(sql);
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Invalid legacy runs fixture references');
  db.exec('PRAGMA defer_foreign_keys=OFF; COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
}
