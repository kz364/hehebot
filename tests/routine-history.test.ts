import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { bot, fixture, otherBot, routine } from './helpers';

let f: ReturnType<typeof fixture>;
beforeEach(() => { f = fixture(); });
afterEach(() => f.close());

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function insertRun(id: string, routineId: string, personaId: string, status: string, attempt = 0, occurrenceId: string | null = null) {
  f.db.exec(`INSERT INTO runs(id,occurrence_id,persona_id,routine_id,context_json,status,current_attempt,error_code,checkpoint_json,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`, id, occurrenceId, personaId, routineId,
  JSON.stringify({ private: `PRIVATE_CONTEXT_${id}`, scope_key: `${personaId}/routine/${routineId}` }), status, attempt,
  status === 'recovery_required' ? 'OUTCOME_UNKNOWN' : null, JSON.stringify({ private: `PRIVATE_CHECKPOINT_${id}` }),
  `2026-09-10T00:00:${id.slice(-2)}.000Z`, `2026-09-10T00:00:${id.slice(-2)}.000Z`);
}

it('pages every routine status by immutable UUID and keeps full-scope counts independent of the cursor', () => {
  const target = routine({ id: uuid(90), persona_id: bot }), sibling = routine({ id: uuid(91), persona_id: bot });
  const foreign = routine({ id: uuid(92), persona_id: otherBot });
  for (const value of [target, sibling, foreign]) f.store.put(value.id, 'routine', value, 0, 'owner', f.core.now());

  const statuses = ['completed', 'waiting', 'failed', 'recovery_required', 'queued', 'cancelled', 'running'] as const;
  const targetIds = statuses.map((status, index) => {
    const id = uuid(index + 1);
    if (index === 4) {
      const occurrence = uuid(70);
      f.db.exec("INSERT INTO occurrences(id,routine_id,routine_version,nominal_due_at,status,created_at) VALUES(?,?,1,?,'queued',?)", occurrence, target.id, '2026-09-10T00:00:00.000Z', f.core.now());
      insertRun(id, target.id, bot, status, 0, occurrence);
    } else insertRun(id, target.id, bot, status, status === 'recovery_required' || status === 'running' ? 2 : 0);
    return id;
  });
  insertRun(uuid(30), sibling.id, bot, 'waiting');
  insertRun(uuid(31), foreign.id, otherBot, 'completed');
  insertRun(uuid(32), foreign.id, otherBot, 'failed');

  const recovering = targetIds[3], running = targetIds[6];
  for (const id of [recovering, running]) {
    f.db.exec("INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,native_run_ref,status,deadline_at) VALUES(?,?,?,1,?,?,'running',?)",
      id, 2, `submission-${id}`, randomUUID(), `native-${id}`, '2026-09-10T01:00:00.000Z');
  }
  f.db.exec('INSERT INTO runtime_metadata(key,value_json) VALUES(?,?)', `output-preview:${running}`, JSON.stringify({ run_id: running, attempt: 2, native_ref: `native-${running}`, version: 3, text: 'CURRENT_ATTEMPT_OUTPUT', truncated: false, expires_at: '2026-12-10T00:00:00.000Z' }));
  f.db.exec('INSERT INTO runtime_metadata(key,value_json) VALUES(?,?)', `output-preview:${recovering}`, JSON.stringify({ run_id: recovering, attempt: 1, native_ref: 'old-native', version: 9, text: 'STALE_ATTEMPT_OUTPUT', truncated: false, expires_at: '2026-12-10T00:00:00.000Z' }));

  const tables = ['runs', 'attempts', 'runtime_metadata', 'operations', 'effects', 'lifecycle'];
  const before = tables.map(table => f.db.all(`SELECT * FROM ${table} ORDER BY 1`));
  const first = f.core.routineTaskPage(target.id, undefined, 3);
  const second = f.core.routineTaskPage(target.id, first.next_cursor!, 3);
  const third = f.core.routineTaskPage(target.id, second.next_cursor!, 3);

  expect(first.counts).toEqual({ total: 7, waiting: 1, recovery: 1 });
  expect(second.counts).toEqual(first.counts); expect(third.counts).toEqual(first.counts);
  expect([...first.runs, ...second.runs, ...third.runs].map(run => run.id)).toEqual(targetIds);
  expect(first.next_cursor).toBe(uuid(3)); expect(second.next_cursor).toBe(uuid(6)); expect(third.next_cursor).toBeNull();
  expect([...first.runs, ...second.runs, ...third.runs].map(run => run.status)).toEqual(statuses);
  expect([...first.output_previews, ...second.output_previews, ...third.output_previews]).toEqual([{ run_id: running, attempt: 2, version: 3, text: 'CURRENT_ATTEMPT_OUTPUT', truncated: false }]);
  expect([...first.recovery, ...second.recovery, ...third.recovery]).toEqual([expect.objectContaining({ run_id: recovering, attempt: 2 })]);
  expect(JSON.stringify([first, second, third])).not.toMatch(/PRIVATE_CONTEXT|PRIVATE_CHECKPOINT|STALE_ATTEMPT_OUTPUT|context_json|checkpoint_json/);
  expect(tables.map(table => f.db.all(`SELECT * FROM ${table} ORDER BY 1`))).toEqual(before);
});

it('requires a live routine and validates the same UUID/limit bounds as task pages', () => {
  const live = routine({ id: uuid(80) });
  f.store.put(live.id, 'routine', live, 0, 'owner', f.core.now());
  expect(f.core.routineTaskPage(live.id)).toMatchObject({ counts: { total: 0, waiting: 0, recovery: 0 }, runs: [], next_cursor: null });
  for (const cursor of ['', 'not-a-uuid', "' OR 1=1"]) expect(() => f.core.routineTaskPage(live.id, cursor)).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
  for (const limit of [0, 11, 1.5, Number.NaN]) expect(() => f.core.routineTaskPage(live.id, undefined, limit)).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
  const nonRoutine = randomUUID(); f.store.put(nonRoutine, 'memory', { text: 'not routine' }, 0, 'owner', f.core.now());
  for (const id of [randomUUID(), nonRoutine]) expect(() => f.core.routineTaskPage(id)).toThrowError(expect.objectContaining({ code: 'NOT_FOUND', status: 404 }));
  f.db.exec("UPDATE objects SET deleted_at=? WHERE id=?", f.core.now(), live.id);
  expect(() => f.core.routineTaskPage(live.id)).toThrowError(expect.objectContaining({ code: 'NOT_FOUND', status: 404 }));
});

it('leaves neighboring conversation history unfinished-only', () => {
  const target = routine({ id: uuid(81), persona_id: bot }); f.store.put(target.id, 'routine', target, 0, 'owner', f.core.now());
  insertRun(uuid(1), target.id, bot, 'completed'); insertRun(uuid(2), target.id, bot, 'waiting');
  expect(f.core.routineTaskPage(target.id).runs.map(run => run.id)).toEqual([uuid(1), uuid(2)]);
  expect(f.core.taskPage(bot).runs.map(run => run.id)).toEqual([uuid(2)]);
});

it('projects durable attempt attribution without fallback to the live routine or private snapshot',()=>{
 const target=routine({id:uuid(80)});f.store.put(target.id,'routine',target,0,'owner',f.core.now());
 const captured=f.core.context(bot,'PRIVATE_INSTRUCTIONS',target.id,null);
 const run=f.core.enqueue(bot,'PRIVATE_INSTRUCTIONS',null,target.id,null);
 f.db.exec("UPDATE runs SET current_attempt=1,status='running' WHERE id=?",run);
 f.store.put(target.id,'routine',{...target,instructions:'NEW_PRIVATE_INSTRUCTIONS'},1,'owner',f.core.now());
 const read=()=>f.core.routineTaskPage(target.id).runs[0];
 expect(read()).toMatchObject({captured_routine_revision:null,attempt_revisions:[]});
 f.db.exec("INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,status,deadline_at,captured_routine_revision) VALUES(?,1,?,1,'boot','running',?,1)",run,`${run}:1`,f.core.now());
 expect(read()).toMatchObject({captured_routine_revision:1});
 expect(JSON.stringify(read())).not.toMatch(/PRIVATE_INSTRUCTIONS|context_json|checkpoint_json/);
 expect(f.core.taskPage(bot).runs[0]).not.toHaveProperty('captured_routine_revision');
 for(const value of [{}, {...captured,routine:{...captured.routine,id:uuid(81)}}, {...captured,routine:{...captured.routine,revision:'1'}}, {...captured,routine:{...captured.routine,body:{...target,persona_id:otherBot}}}]){
  f.db.exec('UPDATE runs SET context_json=? WHERE id=?',JSON.stringify(value),run);
  expect(read()).toMatchObject({captured_routine_revision:1});
 }
 f.db.exec('UPDATE runs SET context_json=?,current_attempt=0 WHERE id=?',JSON.stringify(captured),run);
 expect(read()).toMatchObject({captured_routine_revision:null});
 // Missing attempt attribution must not be reconstructed from a newer context.
 f.db.exec('UPDATE runs SET context_json=?,current_attempt=2 WHERE id=?',JSON.stringify(f.core.context(bot,'RETRY_PRIVATE',target.id,null)),run);
 f.db.exec("INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,status,deadline_at) VALUES(?,2,?,1,'boot','running',?)",run,`${run}:2`,f.core.now());
 expect(read()).toMatchObject({captured_routine_revision:null,attempt_revisions:[{attempt:2,captured_routine_revision:null},{attempt:1,captured_routine_revision:1}]});
 for(const attempt of [3,4,5])f.db.exec("INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,status,deadline_at,captured_routine_revision) VALUES(?,?,?,1,'boot','failed',?,?)",run,attempt,`${run}:${attempt}`,f.core.now(),attempt+10);
 f.db.exec('UPDATE runs SET current_attempt=5 WHERE id=?',run);
 expect(read()).toMatchObject({captured_routine_revision:15,attempt_revisions:[{attempt:5,captured_routine_revision:15},{attempt:4,captured_routine_revision:14},{attempt:3,captured_routine_revision:13}]});
});
