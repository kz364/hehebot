import type {DatabaseSync} from 'node:sqlite';

// Exact v1-v12 canonical schema, not a v13 table with its origin merely removed.
export const legacyOccurrencesSql = `CREATE TABLE occurrences (
 id TEXT PRIMARY KEY, routine_id TEXT NOT NULL REFERENCES objects(id), routine_version INTEGER NOT NULL,
 nominal_due_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('queued','claimed','completed','skipped','superseded','failed')),
 coalesced_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
 UNIQUE(routine_id,routine_version,nominal_due_at)
)`;

/** Reconstruct a legacy test fixture, preserving its scheduled rows and references. */
export function legacyOccurrences(db:DatabaseSync):void {
 db.exec('BEGIN; PRAGMA defer_foreign_keys=ON');
 try{
  db.exec('CREATE TABLE legacy_occurrence_rows AS SELECT id,routine_id,routine_version,nominal_due_at,status,coalesced_count,created_at FROM occurrences');
  db.exec('DROP TABLE occurrences');db.exec(legacyOccurrencesSql);
  db.exec('INSERT INTO occurrences SELECT * FROM legacy_occurrence_rows; DROP TABLE legacy_occurrence_rows');
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Invalid legacy fixture references');
  db.exec('PRAGMA defer_foreign_keys=OFF; COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
}
