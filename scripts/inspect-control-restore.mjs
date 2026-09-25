#!/usr/bin/env node
import { DatabaseSync } from 'node:sqlite';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyControl } from './backup-control.mjs';

export const MAX_SEMANTIC_ROWS = 10000;
export const MAX_SEMANTIC_BYTES = 64 * 1024 * 1024;
const tables = ['runs', 'attempts', 'native_task_links', 'resource_locks', 'effects', 'operations', 'outbox', 'runtime_metadata'];
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
    const count = (group, code, sql, ...values) => {
      const n = db.prepare(`SELECT count(*) AS n FROM (${sql})`).get(...values).n;
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
      count(issues, 'NATIVE_THREAD_CUSTODY_MISMATCH', `SELECT n.native_session_key FROM native_task_links n
        JOIN runs r ON r.id=n.run_id GROUP BY n.native_session_key HAVING
        count(DISTINCT n.parent_run_id)>1 OR count(DISTINCT n.parent_attempt)>1 OR count(DISTINCT r.persona_id)>1`);
      count(issues, 'CHILD_NATIVE_REFERENCE_MISMATCH', `SELECT n.run_id FROM native_task_links n WHERE
        length(n.native_run_ref)=0 OR length(n.native_run_ref)>256 OR length(n.native_session_key)=0 OR length(n.native_session_key)>512 OR
        NOT EXISTS(SELECT 1 FROM attempts a WHERE a.run_id=n.run_id AND a.native_run_ref=n.native_run_ref)`);
      count(issues, 'LOCK_ATTEMPT_MISSING', `SELECT l.run_id FROM resource_locks l WHERE NOT EXISTS
        (SELECT 1 FROM attempts a WHERE a.run_id=l.run_id AND a.attempt=l.attempt)`);
      count(issues, 'NATIVE_ATTEMPT_LEASE_MISMATCH', `SELECT n.run_id FROM native_task_links n
        JOIN attempts p ON p.run_id=n.parent_run_id AND p.attempt=n.parent_attempt WHERE
        EXISTS(SELECT 1 FROM attempts a WHERE a.run_id=n.run_id AND a.native_run_ref=n.native_run_ref) AND
        NOT EXISTS(SELECT 1 FROM attempts a WHERE a.run_id=n.run_id AND a.native_run_ref=n.native_run_ref AND a.epoch=p.epoch AND a.boot_id=p.boot_id)`);
      // Native overflow records custody without an admitted context. Recognize
      // only its exact small representation outside executable run states;
      // a marker alone must never hide contradictory identity or extra grants.
      const unavailable = db.prepare(`SELECT r.id,r.context_json FROM runs r WHERE r.role='background' AND r.current_attempt=1
        AND r.status IN ('cancelling','recovery_required','waiting','completed','failed','cancelled')
        AND length(CAST(r.context_json AS BLOB))<=4096
        AND json_extract(r.context_json,'$.native_child_context_unavailable') IN ('CONTEXT_PREPARATION_LIMIT','MEMORY_PREPARATION_LIMIT')
        AND EXISTS(SELECT 1 FROM native_task_links n JOIN attempts a ON a.run_id=n.run_id AND a.attempt=1
          WHERE n.run_id=r.id AND n.parent_run_id=r.parent_run_id AND a.native_run_ref=n.native_run_ref)`).all().filter(row => {
        const context = JSON.parse(row.context_json);
        return typeof context.instruction === 'string' && context.instruction.length > 0 && context.instruction.length <= 200 &&
          ['CONTEXT_PREPARATION_LIMIT','MEMORY_PREPARATION_LIMIT'].includes(context.native_child_context_unavailable) &&
          row.context_json === JSON.stringify({schema_version:1,native_child_context_unavailable:context.native_child_context_unavailable,
            instruction:context.instruction,persona:{id:null},routine:null,room_id:null,scope_key:null,
            memories:[],skills:[],context_events:[],authorization_policy_ids:[]});
      }).map(row => row.id);
      const unavailableIds = JSON.stringify(unavailable);
      if (unavailable.length) blockers.NATIVE_CONTEXT_UNAVAILABLE = unavailable.length;
      // Context JSON is SQLite-valid already, but may carry contradictory typed identity fields.
      count(issues, 'CONTEXT_IDENTITY_MISMATCH', `SELECT r.id FROM runs r WHERE r.id NOT IN (SELECT value FROM json_each(?)) AND (json_type(context_json)!='object' OR
        (json_type(context_json,'$.persona') IS NOT NULL AND json_type(context_json,'$.persona')!='object') OR
        (json_type(context_json,'$.persona.id') IS NOT NULL AND
          (json_type(context_json,'$.persona.id')!='text' OR json_extract(context_json,'$.persona.id')!=r.persona_id)) OR
        (json_type(context_json,'$.routine.id') IS NOT NULL AND
          (json_type(context_json,'$.routine.id')!='text' OR json_extract(context_json,'$.routine.id') IS NOT r.routine_id)) OR
        (json_type(context_json,'$.room_id') IS NOT NULL AND json_type(context_json,'$.room_id') NOT IN ('text','null')) OR
        (json_type(context_json,'$.scope_key') IS NOT NULL AND json_extract(context_json,'$.scope_key') IS NOT
          (r.persona_id||'/'||CASE WHEN r.routine_id IS NOT NULL THEN 'routine/'||r.routine_id
            WHEN json_type(context_json,'$.room_id')='text' THEN 'room/'||json_extract(context_json,'$.room_id') ELSE 'personal' END)))`, unavailableIds);
      count(issues, 'ADMITTED_CONTEXT_IDENTITY_MISSING', `SELECT id FROM runs WHERE id NOT IN (SELECT value FROM json_each(?)) AND current_attempt>0 AND
        (json_type(context_json,'$.persona.id') IS NOT 'text' OR json_type(context_json,'$.scope_key') IS NOT 'text' OR
         json_type(context_json,'$.room_id') IS NULL OR
         (routine_id IS NULL AND json_type(context_json,'$.routine') IS NOT 'null') OR
         (routine_id IS NOT NULL AND json_type(context_json,'$.routine.id') IS NOT 'text'))`, unavailableIds);
      count(issues, 'TERMINAL_EFFECT_RECEIPT_INVALID', `SELECT id FROM effects WHERE status IN ('confirmed','failed') AND
        (receipt_json IS NULL OR json_type(receipt_json)!='object' OR NOT EXISTS(SELECT 1 FROM json_each(receipt_json)))`);

      // Inspect durable custody independently of task status. An expired question
      // or terminated attempt can still retain an unknown answer handoff.
      const questions = "FROM runtime_metadata m WHERE m.key GLOB 'native-question:*'";
      if (db.prepare(`SELECT count(*) AS n ${questions} AND length(CAST(m.value_json AS BLOB))>131072`).get().n) fail();
      count(issues, 'NATIVE_QUESTION_CUSTODY_INVALID', `SELECT m.key ${questions} AND (
        json_type(m.value_json) IS NOT 'object' OR
        json_type(m.value_json,'$.id') IS NOT 'text' OR m.key IS NOT 'native-question:'||json_extract(m.value_json,'$.id') OR
        json_type(m.value_json,'$.run_id') IS NOT 'text' OR json_type(m.value_json,'$.attempt') IS NOT 'integer' OR json_extract(m.value_json,'$.attempt')<1 OR
        json_type(m.value_json,'$.epoch') IS NOT 'integer' OR json_extract(m.value_json,'$.epoch')<0 OR
        json_type(m.value_json,'$.boot_id') IS NOT 'text' OR json_type(m.value_json,'$.persona_id') IS NOT 'text' OR
        json_type(m.value_json,'$.conversation_id') IS NOT 'text' OR json_type(m.value_json,'$.params.turnId') IS NOT 'text' OR
        NOT COALESCE((json_extract(m.value_json,'$.version')=1 AND json_extract(m.value_json,'$.state') IN ('pending','answered','response_unknown','resolved')) OR
          (json_extract(m.value_json,'$.version')=2 AND json_extract(m.value_json,'$.state')='closed'),0) OR
        (json_extract(m.value_json,'$.state')='resolved' AND json_type(m.value_json,'$.resolved_at') IS NOT 'text') OR
        (json_extract(m.value_json,'$.state')='closed' AND (json_type(m.value_json,'$.closed_at') IS NOT 'text' OR json_type(m.value_json,'$.resolved_at') IS NOT 'null')))`);
      count(issues, 'NATIVE_QUESTION_ATTEMPT_MISMATCH', `SELECT m.key ${questions} AND NOT EXISTS
        (SELECT 1 FROM attempts a WHERE a.run_id=json_extract(m.value_json,'$.run_id') AND a.attempt=json_extract(m.value_json,'$.attempt') AND
          a.epoch=json_extract(m.value_json,'$.epoch') AND a.boot_id=json_extract(m.value_json,'$.boot_id') AND a.native_run_ref=json_extract(m.value_json,'$.params.turnId'))`);
      count(issues, 'NATIVE_QUESTION_SCOPE_MISMATCH', `SELECT m.key ${questions} AND NOT EXISTS
        (SELECT 1 FROM runs r WHERE r.id=json_extract(m.value_json,'$.run_id') AND r.role='coordinator' AND r.parent_run_id IS NULL AND
          r.persona_id=json_extract(m.value_json,'$.persona_id') AND COALESCE(json_extract(r.context_json,'$.room_id'),r.persona_id)=json_extract(m.value_json,'$.conversation_id'))`);
      count(issues, 'NATIVE_QUESTION_CLOSURE_UNCONFIRMED', `SELECT m.key ${questions} AND json_extract(m.value_json,'$.state')='closed' AND NOT EXISTS
        (SELECT 1 FROM attempts a WHERE a.run_id=json_extract(m.value_json,'$.run_id') AND a.attempt=json_extract(m.value_json,'$.attempt') AND a.status='terminated' AND
          a.settled_at>=COALESCE(json_extract(m.value_json,'$.response_taken_at'),json_extract(m.value_json,'$.answered_at'),json_extract(m.value_json,'$.created_at')) AND
          a.settled_at<=json_extract(m.value_json,'$.closed_at'))`);
      count(blockers, 'UNRESOLVED_NATIVE_QUESTION', `SELECT m.key ${questions} AND
        COALESCE(json_extract(m.value_json,'$.state'),'') NOT IN ('resolved','closed')`);

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
