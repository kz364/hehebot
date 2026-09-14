#!/usr/bin/env node
import { DatabaseSync } from 'node:sqlite';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyControl } from './backup-control.mjs';

export const MAX_SEMANTIC_ROWS = 10000;
export const MAX_SEMANTIC_BYTES = 64 * 1024 * 1024;
const tables = ['runs', 'attempts', 'native_task_links', 'resource_locks', 'effects', 'operations', 'outbox'];
/** @returns {never} */
const fail = () => { throw new Error('CONTROL_RESTORE_INSPECTION_FAILED'); };

/** Read-only diagnostic counts, never a restore or external-custody authorization. */
export async function inspectControlRestore(directory) {
  try {
    const manifest = await verifyControl(directory);
    const schemaVersion = manifest.schemaVersions.at(-1);
    const inspectedTables = schemaVersion >= 9 ? [...tables, 'flight_restore_deadlines'] : tables;
    if (manifest.bytes > MAX_SEMANTIC_BYTES || inspectedTables.reduce((sum, table) => sum + manifest.counts[table], 0) > MAX_SEMANTIC_ROWS) fail();
    const db = new DatabaseSync(join(directory, 'control.sqlite'), { readOnly: true, allowExtension: false });
    const issues = {}, blockers = {};
    const count = (group, code, sql) => {
      const n = db.prepare(`SELECT count(*) AS n FROM (${sql})`).get().n;
      if (n) group[code] = n;
    };
    try {
      db.exec('PRAGMA query_only=ON; BEGIN');
      if (db.prepare('SELECT count(*) AS n FROM runs WHERE length(id)>512 OR length(parent_run_id)>512').get().n) fail();
      count(issues, 'CURRENT_ATTEMPT_MISSING', `SELECT r.id FROM runs r WHERE r.current_attempt<0 OR
        (r.current_attempt>0 AND NOT EXISTS(SELECT 1 FROM attempts a WHERE a.run_id=r.id AND a.attempt=r.current_attempt)) OR
        (r.current_attempt=0 AND r.status IN ('claimed','running','finishing'))`);
      count(issues, 'PARENT_ROLE_LINK_MISMATCH', `SELECT r.id FROM runs r LEFT JOIN native_task_links n ON n.run_id=r.id WHERE
        (r.role='coordinator' AND (r.parent_run_id IS NOT NULL OR n.run_id IS NOT NULL)) OR
        (r.role='background' AND (r.parent_run_id IS NULL OR n.run_id IS NULL OR n.parent_run_id!=r.parent_run_id))`);
      count(issues, 'PARENT_ATTEMPT_MISSING', `SELECT n.run_id FROM native_task_links n WHERE NOT EXISTS
        (SELECT 1 FROM attempts a WHERE a.run_id=n.parent_run_id AND a.attempt=n.parent_attempt)`);
      count(issues, 'CHILD_NATIVE_REFERENCE_MISMATCH', `SELECT n.run_id FROM native_task_links n WHERE
        length(n.native_run_ref)=0 OR length(n.native_run_ref)>256 OR length(n.native_session_key)=0 OR length(n.native_session_key)>512 OR
        NOT EXISTS(SELECT 1 FROM attempts a WHERE a.run_id=n.run_id AND a.native_run_ref=n.native_run_ref)`);
      count(issues, 'LOCK_ATTEMPT_MISSING', `SELECT l.run_id FROM resource_locks l WHERE NOT EXISTS
        (SELECT 1 FROM attempts a WHERE a.run_id=l.run_id AND a.attempt=l.attempt)`);
      count(issues, 'NATIVE_ATTEMPT_LEASE_MISMATCH', `SELECT n.run_id FROM native_task_links n
        JOIN attempts p ON p.run_id=n.parent_run_id AND p.attempt=n.parent_attempt WHERE
        EXISTS(SELECT 1 FROM attempts a WHERE a.run_id=n.run_id AND a.native_run_ref=n.native_run_ref) AND
        NOT EXISTS(SELECT 1 FROM attempts a WHERE a.run_id=n.run_id AND a.native_run_ref=n.native_run_ref AND a.epoch=p.epoch AND a.boot_id=p.boot_id)`);
      // Context JSON is SQLite-valid already, but may carry contradictory typed identity fields.
      count(issues, 'CONTEXT_IDENTITY_MISMATCH', `SELECT r.id FROM runs r WHERE json_type(context_json)!='object' OR
        (json_type(context_json,'$.persona') IS NOT NULL AND json_type(context_json,'$.persona')!='object') OR
        (json_type(context_json,'$.persona.id') IS NOT NULL AND
          (json_type(context_json,'$.persona.id')!='text' OR json_extract(context_json,'$.persona.id')!=r.persona_id)) OR
        (json_type(context_json,'$.routine.id') IS NOT NULL AND
          (json_type(context_json,'$.routine.id')!='text' OR json_extract(context_json,'$.routine.id') IS NOT r.routine_id)) OR
        (json_type(context_json,'$.room_id') IS NOT NULL AND json_type(context_json,'$.room_id') NOT IN ('text','null')) OR
        (json_type(context_json,'$.scope_key') IS NOT NULL AND json_extract(context_json,'$.scope_key') IS NOT
          (r.persona_id||'/'||CASE WHEN r.routine_id IS NOT NULL THEN 'routine/'||r.routine_id
            WHEN json_type(context_json,'$.room_id')='text' THEN 'room/'||json_extract(context_json,'$.room_id') ELSE 'personal' END))`);
      count(issues, 'ADMITTED_CONTEXT_IDENTITY_MISSING', `SELECT id FROM runs WHERE current_attempt>0 AND
        (json_type(context_json,'$.persona.id') IS NOT 'text' OR json_type(context_json,'$.scope_key') IS NOT 'text' OR
         json_type(context_json,'$.room_id') IS NULL OR
         (routine_id IS NULL AND json_type(context_json,'$.routine') IS NOT 'null') OR
         (routine_id IS NOT NULL AND json_type(context_json,'$.routine.id') IS NOT 'text'))`);
      count(issues, 'TERMINAL_EFFECT_RECEIPT_INVALID', `SELECT id FROM effects WHERE status IN ('confirmed','failed') AND
        (receipt_json IS NULL OR json_type(receipt_json)!='object' OR NOT EXISTS(SELECT 1 FROM json_each(receipt_json)))`);

      const rows = db.prepare('SELECT id,parent_run_id FROM runs ORDER BY id').all();
      const parents = new Map(rows.map(row => [row.id, row.parent_run_id]));
      const visited = new Set(); let cycles = 0;
      for (const row of rows) {
        const path = new Set(); let id = row.id;
        while (id !== null && parents.has(id) && !visited.has(id)) {
          if (path.has(id)) { cycles++; break; }
          path.add(id); id = parents.get(id);
        }
        for (const id of path) visited.add(id);
      }
      if (cycles) issues.LINEAGE_CYCLE = cycles;

      count(blockers, 'ACTIVE_RUN', "SELECT id FROM runs WHERE status IN ('claimed','running','finishing','cancelling')");
      count(blockers, 'PENDING_RUN', "SELECT id FROM runs WHERE status IN ('queued','waiting')");
      count(blockers, 'RECOVERY_RUN', "SELECT id FROM runs WHERE status='recovery_required'");
      count(blockers, 'UNSETTLED_ATTEMPT', "SELECT run_id FROM attempts WHERE status NOT IN ('completed','failed','cancelled','terminated')");
      count(blockers, 'UNRESOLVED_OPERATION', "SELECT id FROM operations WHERE status!='settled'");
      count(blockers, 'UNRESOLVED_EFFECT', "SELECT id FROM effects WHERE status IN ('intent','dispatched','outcome_unknown')");
      count(blockers, 'RETAINED_LOCK', 'SELECT resource_id FROM resource_locks');
      count(blockers, 'HISTORICAL_LOCK_OWNER', 'SELECT l.resource_id FROM resource_locks l JOIN runs r ON r.id=l.run_id WHERE l.attempt!=r.current_attempt');
      count(blockers, 'UNRESOLVED_DELIVERY', "SELECT id FROM outbox WHERE status IN ('pending','outcome_unknown')");
      if (schemaVersion >= 9) count(blockers, 'UNRESOLVED_FLIGHT_RESTORE',
        "SELECT leg_id FROM flight_restore_deadlines WHERE status IN ('pending','enqueued','outcome_unknown')");
      // Preserve healthy historical trees, but carry stale custody through every ancestor.
      const stale = new Set(db.prepare(`SELECT n.run_id FROM native_task_links n JOIN runs r ON r.id=n.run_id
        JOIN runs p ON p.id=n.parent_run_id WHERE
        n.parent_attempt!=p.current_attempt OR NOT EXISTS(SELECT 1 FROM attempts a WHERE a.run_id=r.id AND a.attempt=r.current_attempt AND a.native_run_ref=n.native_run_ref)`)
        .all().map(row => row.run_id));
      const pending = db.prepare(`SELECT r.id FROM runs r WHERE r.role='background' AND
        (r.status NOT IN ('completed','failed','cancelled') OR
         EXISTS(SELECT 1 FROM attempts a WHERE a.run_id=r.id AND a.status NOT IN ('completed','failed','cancelled','terminated')) OR
         EXISTS(SELECT 1 FROM resource_locks l WHERE l.run_id=r.id) OR
         EXISTS(SELECT 1 FROM operations o WHERE o.run_id=r.id AND o.status!='settled') OR
         EXISTS(SELECT 1 FROM effects e WHERE e.run_id=r.id AND e.status IN ('intent','dispatched','outcome_unknown')) OR
         EXISTS(SELECT 1 FROM outbox o WHERE o.run_id=r.id AND o.status IN ('pending','outcome_unknown')))`)
        .all();
      const custody = new Map(); let staleCount = 0;
      for (const row of pending) {
        const path = new Set(); let id = row.id;
        while (id !== null && parents.has(id) && !custody.has(id) && !stale.has(id) && !path.has(id)) {
          path.add(id); id = parents.get(id);
        }
        const invalid = stale.has(id) || custody.get(id) === true;
        for (const id of path) custody.set(id, invalid);
        if (invalid) staleCount++;
      }
      if (staleCount) blockers.STALE_NATIVE_CUSTODY = staleCount;
    } finally { db.close(); }
    const after = await verifyControl(directory);
    if (JSON.stringify(after) !== JSON.stringify(manifest)) fail();
    const sorted = group => Object.fromEntries(Object.entries(group).sort(([a], [b]) => a.localeCompare(b)));
    return { version: 1, snapshot_verified: true, schema_version: schemaVersion,
      semantic_status: Object.keys(issues).length ? 'inconsistent' : 'no_detected_inconsistency',
      inconsistencies: sorted(issues), blockers: sorted(blockers),
      external_readiness: 'unverified', coordinated_restore_ready: false };
  } catch { return fail(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) fail();
    const report = await inspectControlRestore(process.argv[2]);
    console.log(JSON.stringify(report));
    if (report.semantic_status === 'inconsistent' || Object.keys(report.blockers).length) process.exitCode = 2;
  } catch { console.error('CONTROL_RESTORE_INSPECTION_FAILED'); process.exitCode = 1; }
}
