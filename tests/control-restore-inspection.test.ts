import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { beforeEach, afterEach, it, expect } from 'vitest';
import { snapshotControl, verifyControl } from '../scripts/backup-control.mjs';
import { inspectControlRestore } from '../scripts/inspect-control-restore.mjs';
import {legacyOccurrences} from './legacy-occurrences';
import {legacyRuns} from './legacy-runs';

const schema = await readFile(process.env.HEHEBOT_RESTORE_TEST_SCHEMA ?? new URL('../DB/schema.sql', import.meta.url), 'utf8');
let directory: string, source: string, snapshot: string, db: DatabaseSync;
const canary = 'PRIVATE_RESTORE_CANARY_793';
const unavailableContext = {schema_version:1,native_child_context_unavailable:'CONTEXT_PREPARATION_LIMIT',
  instruction:canary,persona:{id:null},routine:null,room_id:null,scope_key:null,
  memories:[],skills:[],context_events:[],authorization_policy_ids:[]};
function run(id: string, parent: string | null, attempt = 1, status = 'completed', persona = 'persona-a') {
  const context = { schema_version: 1, persona: { id: persona }, routine: null, room_id: null, scope_key: `${persona}/personal`, instruction: canary };
  db.prepare('INSERT INTO runs(id,persona_id,context_json,role,parent_run_id,status,current_attempt,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(id, persona, JSON.stringify(context), parent ? 'background' : 'coordinator', parent, status, attempt, 't1', 't9');
  for (let n = 1; n <= attempt; n++) db.prepare('INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,native_run_ref,status,deadline_at,settled_at) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(id, n, `${id}/${n}`, n, `boot-${n}`, `${id}-native-${n}`, 'completed', 't9', 't8');
  if (parent) db.prepare('INSERT INTO native_task_links VALUES(?,?,?,?,?)').run(id, parent, 1, `${id}-native-${attempt}`, `${id}-thread`);
}
async function inspect() { await snapshotControl(source, snapshot); await verifyControl(snapshot); return inspectControlRestore(snapshot); }
async function fingerprint() {
  const paths = [source, ...((await readdir(snapshot)).sort().map(name => join(snapshot, name)))];
  return Promise.all(paths.map(async path => createHash('sha256').update(await readFile(path)).digest('hex')));
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'hehe-restore-inspect-'));
  source = join(directory, 'source.sqlite'); snapshot = join(directory, 'snapshot');
  await writeFile(source, '', { mode: 0o600 }); db = new DatabaseSync(source); db.exec(schema);
  db.exec("INSERT INTO objects VALUES('persona-a','persona',1,'{}',NULL,'t1','t1'); INSERT INTO objects VALUES('persona-b','persona',2,'{}',NULL,'t1','t1')");
  run('root-19', null, 2); run('child-73', 'root-19'); run('grandchild-41', 'child-73'); run('sibling-89', 'root-19', 1, 'completed', 'persona-b');
});
afterEach(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });

it('accepts settled nested historical lineage across a newer root attempt without claiming readiness', async () => {
  const report = await inspect();
  expect(report).toMatchObject({ snapshot_verified: true, semantic_status: 'no_detected_inconsistency', inconsistencies: {}, blockers: {}, external_readiness: 'unverified', coordinated_restore_ready: false });
  const before = await fingerprint(); expect(await inspectControlRestore(snapshot)).toEqual(report);
  expect(await fingerprint()).toEqual(before); expect(await readdir(snapshot)).toEqual(expect.arrayContaining(['control.sqlite', 'manifest.json']));
  expect((await readdir(snapshot)).length).toBe(2);
});

it.each(['CONTEXT_PREPARATION_LIMIT','MEMORY_PREPARATION_LIMIT'].flatMap(reason=>['cancelling','completed'].map(status=>({reason,status}))))('preserves native unavailable-context $reason/$status as a blocker, not corruption',async ({reason,status})=>{
  db.prepare('UPDATE runs SET context_json=?,status=? WHERE id=?').run(JSON.stringify({...unavailableContext,native_child_context_unavailable:reason}),status,'child-73');
  const report=await inspect();
  expect(report.semantic_status).toBe('no_detected_inconsistency');expect(report.inconsistencies).toEqual({});
  expect(report.blockers.NATIVE_CONTEXT_UNAVAILABLE).toBe(1);
  expect(report.coordinated_restore_ready).toBe(false);
  const before=await fingerprint();
  const cli=spawnSync(process.execPath,[decodeURIComponent(new URL('../scripts/inspect-control-restore.mjs', import.meta.url).pathname),snapshot],{encoding:'utf8'});
  expect(cli.status).toBe(2);expect(JSON.parse(cli.stdout)).toEqual(report);
  expect(cli.stdout+cli.stderr).not.toContain(canary);expect(await fingerprint()).toEqual(before);
});

it.each([false,true])('retains attempt-scoped refusal as a restore blocker without double counting (marker=%s)',async marker=>{
  if(marker)db.prepare('UPDATE runs SET context_json=? WHERE id=?').run(JSON.stringify(unavailableContext),'child-73');
  db.prepare('INSERT INTO runtime_metadata(key,value_json) VALUES(?,?)').run('native_context_unavailable:child-73:1',JSON.stringify('MEMORY_PREPARATION_LIMIT'));
  // Another attempt's record must not classify the current sibling snapshot.
  db.prepare('INSERT INTO runtime_metadata(key,value_json) VALUES(?,?)').run('native_context_unavailable:sibling-89:2',JSON.stringify('MEMORY_PREPARATION_LIMIT'));
  const report=await inspect();
  expect(report.inconsistencies).toEqual({});
  expect(report.blockers.NATIVE_CONTEXT_UNAVAILABLE).toBe(1);
  expect(report.coordinated_restore_ready).toBe(false);
});

it.each(['grant','extra-field','duplicate-key','unknown-reason','running','coordinator','missing-link'])('does not exempt a forged unavailable-context marker: %s',async kind=>{
  let context=JSON.stringify({...unavailableContext,...(kind==='grant'?{authorization_policy_ids:['forged-grant']}:{}),...(kind==='extra-field'?{extra:true}:{}),...(kind==='unknown-reason'?{native_child_context_unavailable:'UNKNOWN'}:{})});
  if(kind==='duplicate-key')context=context.slice(0,-1)+',"persona":{"id":null}}';
  db.prepare('UPDATE runs SET context_json=? WHERE id=?').run(context,'child-73');
  if(kind==='running')db.exec("UPDATE runs SET status='running' WHERE id='child-73'");
  if(kind==='coordinator')db.exec("UPDATE runs SET role='coordinator' WHERE id='child-73'");
  if(kind==='missing-link')db.exec("DELETE FROM native_task_links WHERE run_id='child-73'");
  const report=await inspect();
  expect(report.semantic_status).toBe('inconsistent');
  expect(report.inconsistencies.CONTEXT_IDENTITY_MISMATCH).toBe(1);
  expect(report.inconsistencies.ADMITTED_CONTEXT_IDENTITY_MISSING).toBe(1);
  expect(report.blockers.NATIVE_CONTEXT_UNAVAILABLE).toBeUndefined();
});

it('keeps exact schema8 history inspectable without flight tables', async () => {
  legacyRuns(db);
  legacyOccurrences(db);
  const links = db.prepare('SELECT * FROM native_task_links').all();
  db.exec('DROP TABLE native_task_links; CREATE TABLE native_task_links (run_id TEXT PRIMARY KEY REFERENCES runs(id),parent_run_id TEXT NOT NULL REFERENCES runs(id),parent_attempt INTEGER NOT NULL,native_run_ref TEXT NOT NULL UNIQUE,native_session_key TEXT NOT NULL UNIQUE)');
  for (const link of links) db.prepare('INSERT INTO native_task_links VALUES(?,?,?,?,?)').run(...Object.values(link));
  db.exec('DROP INDEX operations_run_status; DROP INDEX effects_run_status; DROP INDEX resource_locks_run; DROP INDEX runs_parent; DROP INDEX objects_memory_scope; ALTER TABLE attempts DROP COLUMN captured_routine_revision; ALTER TABLE attempts DROP COLUMN coordinator_release_json; DROP TABLE flight_restore_deadlines; UPDATE schema_versions SET version=8 WHERE version=18');
  const report = await inspect();
  expect(report.schema_version).toBe(8);
  expect(report.blockers).toEqual({});
  expect(report.coordinated_restore_ready).toBe(false);
});

it('counts pending and unknown flight restoration independently of terminal runs', async () => {
  const insert = db.prepare('INSERT INTO flight_restore_deadlines VALUES(?,?,?,?,?,?,?,?,?,?)');
  for (const [index, status] of ['pending', 'enqueued', 'outcome_unknown', 'confirmed', 'superseded'].entries()) {
    insert.run(canary, index + 1, '2026-09-20T21:00:00.000Z', 'Asia/Jakarta', '2026-09-19T21:00:00.000Z', 'routine', 'source', status, 'root-19', '{}');
  }
  const report = await inspect();
  expect(report.schema_version).toBe(18);
  expect(report.inconsistencies).toEqual({});
  expect(report.blockers).toEqual({ UNRESOLVED_FLIGHT_RESTORE: 3 });
  expect(JSON.stringify(report)).not.toContain(canary);
  expect(report.coordinated_restore_ready).toBe(false);
});

it('includes flight history in the combined semantic row limit', async () => {
  db.exec('BEGIN');
  const insert = db.prepare("INSERT INTO flight_restore_deadlines VALUES('leg',?,'departure','Asia/Jakarta','restore','routine','source','superseded',NULL,NULL)");
  for (let n = 0; n < 10000; n++) insert.run(n);
  db.exec('COMMIT');
  await expect(inspect()).rejects.toThrow('CONTROL_RESTORE_INSPECTION_FAILED');
});

function question(state = 'pending') {
  const answered = ['answered', 'response_unknown'].includes(state), taken = state === 'response_unknown';
  return { id: randomUUID(), version: state === 'closed' ? 2 : 1, revision: 1 + Number(answered) + Number(taken) + Number(['resolved', 'closed'].includes(state)),
    state, run_id: 'root-19', attempt: 1, epoch: 1, boot_id: 'boot-1', persona_id: 'persona-a', conversation_id: 'persona-a',
    connection_id: randomUUID(), request_id: 43, params: { threadId: 'root-thread', turnId: 'root-19-native-1', itemId: 'question-item',
      isBlocking: true, autoResolutionMs: null, questions: [{ id: 'q', header: 'Route', question: canary, isOther: true, isSecret: false, options: null }] },
    created_at: '2026-09-10T00:00:00.000Z', expires_at: '2026-09-10T00:15:00.000Z',
    answers: answered ? { q: { answers: [canary] } } : null, answer_owner_id: answered ? 'owner' : null,
    answer_command_id: answered ? randomUUID() : null, answered_at: answered ? '2026-09-10T00:01:00.000Z' : null,
    response_taken_at: taken ? '2026-09-10T00:02:00.000Z' : null, resolved_at: state === 'resolved' ? '2026-09-10T00:03:00.000Z' : null,
    ...(state === 'closed' ? { closed_at: '2026-09-10T00:04:00.000Z', close_owner_id: 'owner', close_command_id: randomUUID() } : {}) };
}
function storeQuestion(value: any) {
  db.prepare('INSERT INTO runtime_metadata(key,value_json) VALUES(?,?)').run(`native-question:${value.id}`, JSON.stringify(value));
}

it('preserves expired pending/answered/unknown question obligations on a terminated historical attempt', async () => {
  db.exec("UPDATE attempts SET status='terminated',settled_at='2026-09-10T00:03:00.000Z' WHERE run_id='root-19' AND attempt=1");
  for (const state of ['pending', 'answered', 'response_unknown', 'resolved', 'closed']) storeQuestion(question(state));
  db.prepare('INSERT INTO runtime_metadata VALUES(?,?)').run('roster-layout', '{}');
  const report = await inspect();
  expect(report.inconsistencies).toEqual({});
  expect(report.blockers).toEqual({ UNRESOLVED_NATIVE_QUESTION: 3 });
  const before = await fingerprint();
  const cli = spawnSync(process.execPath, [decodeURIComponent(new URL('../scripts/inspect-control-restore.mjs', import.meta.url).pathname), snapshot], { encoding: 'utf8' });
  expect(cli.status).toBe(2); expect(JSON.parse(cli.stdout)).toEqual(report);
  expect(cli.stdout + cli.stderr).not.toContain(canary);
  expect(report.coordinated_restore_ready).toBe(false); expect(await fingerprint()).toEqual(before);
});

it.each([
  [{ attempt: 9 }, 'NATIVE_QUESTION_ATTEMPT_MISMATCH'],
  [{ boot_id: 'another-boot' }, 'NATIVE_QUESTION_ATTEMPT_MISMATCH'],
  [{ epoch: 2 }, 'NATIVE_QUESTION_ATTEMPT_MISMATCH'],
  [{ params: { turnId: 'another-turn' } }, 'NATIVE_QUESTION_ATTEMPT_MISMATCH'],
  [{ conversation_id: 'persona-b' }, 'NATIVE_QUESTION_SCOPE_MISMATCH'],
  [{ persona_id: 'persona-b' }, 'NATIVE_QUESTION_SCOPE_MISMATCH'],
  [{ version: 2 }, 'NATIVE_QUESTION_CUSTODY_INVALID'],
  [{ state: 'mystery' }, 'NATIVE_QUESTION_CUSTODY_INVALID'],
  [{ state: 'resolved', resolved_at: null }, 'NATIVE_QUESTION_CUSTODY_INVALID'],
])('reports question custody defect %j without echoing question content', async (patch, code) => {
  storeQuestion({ ...question(), ...patch });
  const report = await inspect();
  expect(report.semantic_status).toBe('inconsistent'); expect(report.inconsistencies[code as string]).toBe(1);
  expect(JSON.stringify(report)).not.toContain(canary);
});

it('malformed question envelopes remain visible as inconsistencies and unresolved obligations', async () => {
  db.prepare('INSERT INTO runtime_metadata VALUES(?,?)').run('native-question:bad', '[]');
  const report = await inspect();
  expect(report.inconsistencies.NATIVE_QUESTION_CUSTODY_INVALID).toBe(1);
  expect(report.blockers.UNRESOLVED_NATIVE_QUESTION).toBe(1);
});

it.each([
  ['completed', '2026-09-10T00:03:00.000Z'],
  ['terminated', '2026-09-09T23:59:59.999Z'],
  ['terminated', '2026-09-10T00:04:00.001Z'],
])('does not accept closed custody with original attempt %s at %s', async (status, settledAt) => {
  db.prepare("UPDATE attempts SET status=?,settled_at=? WHERE run_id='root-19' AND attempt=1").run(status, settledAt);
  storeQuestion(question('closed'));
  const report = await inspect();
  expect(report.inconsistencies).toEqual({ NATIVE_QUESTION_CLOSURE_UNCONFIRMED: 1 });
  expect(report.blockers).toEqual({}); expect(report.coordinated_restore_ready).toBe(false);
});

it.each(['row-bytes', 'row-count'])('bounds native-question inspection by %s before emitting a report', async limit => {
  if (limit === 'row-bytes') storeQuestion({ ...question(), extra: 'x'.repeat(131072) });
  else {
    db.exec('BEGIN');
    const insert = db.prepare('INSERT INTO runtime_metadata VALUES(?,?)');
    for (let n = 0; n < 10000; n++) insert.run(`native-question:${n}`, '{}');
    db.exec('COMMIT');
  }
  await expect(inspect()).rejects.toThrow('CONTROL_RESTORE_INSPECTION_FAILED');
});

it('reports preserved recovery locks/effects/operations without declaring corruption or settlement', async () => {
  db.exec("UPDATE runs SET status='recovery_required' WHERE id='child-73'; UPDATE attempts SET status='terminated' WHERE run_id='child-73'; INSERT INTO resource_locks VALUES('secret-resource','child-73',1,'t1'); INSERT INTO effects VALUES('effect-53','child-73','action-secret','mutation','outcome_unknown','secret-policy','secret-digest',NULL,NULL,'t1'); INSERT INTO operations VALUES('op-43','child-73',1,'tool','unknown','t1','t9','t3')");
  const report = await inspect();
  expect(report.inconsistencies).toEqual({});
  expect(report.blockers).toMatchObject({ RECOVERY_RUN: 1, RETAINED_LOCK: 1, UNRESOLVED_EFFECT: 1, UNRESOLVED_OPERATION: 1, STALE_NATIVE_CUSTODY: 1 });
  const before = await fingerprint();
  const cli = decodeURIComponent(new URL('../scripts/inspect-control-restore.mjs', import.meta.url).pathname);
  const result = spawnSync(process.execPath, [cli, snapshot], { encoding: 'utf8' });
  expect(result.status).toBe(2); expect(JSON.parse(result.stdout)).toEqual(report);
  for (const value of [canary, 'secret-resource', 'secret-policy', 'secret-digest', 'child-73']) expect(result.stdout + result.stderr).not.toContain(value);
  expect(await fingerprint()).toEqual(before);
});

it('keeps obligations on terminal runs and historical lock owners explicitly blocked', async () => {
  db.exec("INSERT INTO resource_locks VALUES('resource-secret','root-19',1,'t1'); INSERT INTO effects VALUES('effect-53','root-19','action','mutation','dispatched','policy','digest',NULL,NULL,'t1'); INSERT INTO outbox VALUES('delivery','root-19','secret-destination','{}','outcome_unknown','t1','t1')");
  const report = await inspect();
  expect(report.inconsistencies).toEqual({});
  expect(report.blockers).toMatchObject({ HISTORICAL_LOCK_OWNER: 1, RETAINED_LOCK: 1, UNRESOLVED_EFFECT: 1, UNRESOLVED_DELIVERY: 1 });
});

it.each([
  ["UPDATE runs SET current_attempt=7 WHERE id='child-73'", 'CURRENT_ATTEMPT_MISSING'],
  ["UPDATE native_task_links SET parent_run_id='sibling-89' WHERE run_id='grandchild-41'", 'PARENT_ROLE_LINK_MISMATCH'],
  ["UPDATE native_task_links SET parent_attempt=47 WHERE run_id='child-73'", 'PARENT_ATTEMPT_MISSING'],
  ["UPDATE native_task_links SET native_run_ref='wrong-native-ref' WHERE run_id='child-73'", 'CHILD_NATIVE_REFERENCE_MISMATCH'],
  ["UPDATE attempts SET boot_id='wrong-boot' WHERE run_id='grandchild-41'", 'NATIVE_ATTEMPT_LEASE_MISMATCH'],
  ["INSERT INTO resource_locks VALUES('resource','child-73',93,'t1')", 'LOCK_ATTEMPT_MISSING'],
  ["UPDATE runs SET context_json='{\"persona\":{\"id\":\"persona-b\"}}' WHERE id='child-73'", 'CONTEXT_IDENTITY_MISMATCH'],
  ["UPDATE runs SET context_json='[]' WHERE id='child-73'", 'CONTEXT_IDENTITY_MISMATCH'],
  ["UPDATE runs SET context_json='{}' WHERE id='child-73'", 'ADMITTED_CONTEXT_IDENTITY_MISSING'],
  ["UPDATE runs SET context_json=json_set(context_json,'$.scope_key','persona-a/room/wrong') WHERE id='child-73'", 'CONTEXT_IDENTITY_MISMATCH'],
  ["INSERT INTO effects VALUES('bad-receipt','root-19','action','mutation','confirmed','policy','digest',NULL,'{}','t1')", 'TERMINAL_EFFECT_RECEIPT_INVALID'],
])('finds semantic defects after genuine SQLite/hash verification: %s', async (sql, code) => {
  db.exec(sql);
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  const report = await inspect(); expect(report.snapshot_verified).toBe(true);
  expect(report.semantic_status).toBe('inconsistent'); expect(report.inconsistencies[code]).toBe(1);
});

it.each(['same', 'parent', 'attempt', 'persona'])('inspects shared thread receipts with %s custody', async mode => {
  run('followup-97', mode === 'parent' ? 'child-73' : 'root-19', 1, 'completed', mode === 'persona' ? 'persona-b' : 'persona-a');
  db.exec("UPDATE native_task_links SET native_session_key='child-73-thread' WHERE run_id='followup-97'");
  if (mode === 'attempt') {
    db.exec("UPDATE native_task_links SET parent_attempt=2 WHERE run_id='followup-97'; UPDATE attempts SET epoch=2,boot_id='boot-2' WHERE run_id='followup-97'");
  }
  const report = await inspect();
  expect(report.inconsistencies).toEqual(mode === 'same' ? {} : { NATIVE_THREAD_CUSTODY_MISMATCH: 1 });
  expect(report.coordinated_restore_ready).toBe(false);
});

it('detects a cyclic child/grandchild lineage even when both parent link tables agree', async () => {
  db.exec("UPDATE runs SET parent_run_id='grandchild-41' WHERE id='child-73'; UPDATE native_task_links SET parent_run_id='grandchild-41' WHERE run_id='child-73'");
  const report = await inspect(); expect(report.inconsistencies).toEqual({ LINEAGE_CYCLE: 1 });
});

it('accepts unstarted retention-reduced contexts but requires admitted identity', async () => {
  run('expired-71', null, 0, 'failed'); run('waiting-57', null, 0, 'waiting');
  db.exec("UPDATE runs SET context_json='{}',error_code='MESSAGE_EXPIRED' WHERE id='expired-71'; UPDATE runs SET context_json='{\"schema_version\":1,\"instruction\":\"redacted\",\"room_id\":null}' WHERE id='waiting-57'");
  const report = await inspect(); expect(report.inconsistencies).toEqual({}); expect(report.blockers).toEqual({ PENDING_RUN: 1 });
});

it('reports actual active work separately from structural validity', async () => {
  db.exec("UPDATE runs SET status='running' WHERE id='root-19'; UPDATE attempts SET status='running',settled_at=NULL WHERE run_id='root-19' AND attempt=2");
  const report = await inspect(); expect(report.inconsistencies).toEqual({});
  expect(report.blockers).toEqual({ ACTIVE_RUN: 1, UNSETTLED_ATTEMPT: 1 });
});

it('propagates a stale ancestor through a completed parent to an active grandchild', async () => {
  db.exec("UPDATE runs SET status='running' WHERE id='grandchild-41'; UPDATE attempts SET status='running',settled_at=NULL WHERE run_id='grandchild-41'");
  const report = await inspect(); expect(report.inconsistencies).toEqual({});
  expect(report.blockers).toEqual({ ACTIVE_RUN: 1, STALE_NATIVE_CUSTODY: 1, UNSETTLED_ATTEMPT: 1 });
});

it('fails closed beyond the semantic row budget after snapshot verification', async () => {
  db.exec('BEGIN');
  for (let n = 0; n < 10000; n++) run(`queued-${n}`, null, 0, 'queued');
  db.exec('COMMIT');
  await snapshotControl(source, snapshot); await verifyControl(snapshot);
  await expect(inspectControlRestore(snapshot)).rejects.toThrow('CONTROL_RESTORE_INSPECTION_FAILED');
});

it('redacts CLI diagnostics and keeps failed verification separate from semantics', async () => {
  await inspect();
  const cli = decodeURIComponent(new URL('../scripts/inspect-control-restore.mjs', import.meta.url).pathname);
  const good = spawnSync(process.execPath, [cli, snapshot], { encoding: 'utf8' });
  expect(good.status).toBe(0); expect(JSON.parse(good.stdout).coordinated_restore_ready).toBe(false);
  for (const value of [canary, 'root-19', 'child-73', 'boot-1', 'persona-a', directory]) expect(good.stdout + good.stderr).not.toContain(value);
  await writeFile(join(snapshot, 'manifest.json'), canary, { mode: 0o600 });
  const bad = spawnSync(process.execPath, [cli, snapshot], { encoding: 'utf8' });
  expect(bad.status).toBe(1); expect(bad.stdout).toBe(''); expect(bad.stderr).toContain('CONTROL_RESTORE_INSPECTION_FAILED');
  expect(bad.stderr).not.toContain(canary); expect(bad.stderr).not.toContain(directory);
  await expect(inspectControlRestore(snapshot)).rejects.toThrow('CONTROL_RESTORE_INSPECTION_FAILED');
});
