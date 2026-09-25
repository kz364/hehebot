import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ResultRetention } from '../src/core/result-retention';
import { bot, fixture, otherBot, routine } from './helpers';

let f: ReturnType<typeof fixture>;
beforeEach(() => { f = fixture(); });
afterEach(() => f.close());

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

it.each(['persona','room','routine'])('does not hydrate historical bodies for %s task pages',scope=>{
  const target=routine({id:uuid(80),persona_id:bot}),room=uuid(81);
  f.store.put(target.id,'routine',target,0,'owner',f.core.now());
  f.store.put(room,'room',{name:'Scoped room',member_ids:[bot],default_responder_id:bot},0,'owner',f.core.now());
  insertRun(uuid(1),target.id,bot,'waiting');insertRun(uuid(2),target.id,bot,'completed');
  f.db.exec("UPDATE runs SET context_json=json_set(context_json,'$.room_id',?,'$.padding',?),checkpoint_json=?",
    room,'界'.repeat(400000),JSON.stringify({private_checkpoint:'x'.repeat(1100000)}));
  const before=f.db.all('SELECT * FROM runs ORDER BY id');
  const read=vi.spyOn(f.db,'all');
  try{
    const page=scope==='routine'?f.core.routineTaskPage(target.id,undefined,1):f.core.taskPage(scope==='room'?room:bot,undefined,1);
    const index=read.mock.calls.findIndex(([sql])=>sql.includes('FROM runs r LEFT JOIN commands'));
    expect(index).toBeGreaterThanOrEqual(0);
    const rows=read.mock.results[index].value;
    expect(rows.map((row:{id:string})=>row.id)).toEqual(scope==='routine'?[uuid(1),uuid(2)]:[uuid(1)]);
    for(const row of rows){expect(row).not.toHaveProperty('context_json');expect(row).not.toHaveProperty('checkpoint_json');}
    const {context_json,checkpoint_json,...metadata}=f.store.run(uuid(1));
    expect(page.runs[0]).toMatchObject({...metadata,request_status:null});
    expect(page.counts).toEqual({total:scope==='routine'?2:1,waiting:1,recovery:0});
    expect(page.next_cursor).toBe(scope==='routine'?uuid(1):null);
  }finally{read.mockRestore();}
  expect(f.db.all('SELECT * FROM runs ORDER BY id')).toEqual(before);
});

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

it('separates exact current-attempt execution from mixed run-level delivery without exposing content or destinations', () => {
 const target = routine({ id: uuid(80) }), foreign = routine({ id: uuid(81), persona_id: otherBot });
 for (const value of [target, foreign]) f.store.put(value.id, 'routine', value, 0, 'owner', f.core.now());
 insertRun(uuid(1), target.id, bot, 'finishing', 2); insertRun(uuid(2), foreign.id, otherBot, 'completed', 2);
 f.db.exec("INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,status,deadline_at) VALUES(?,2,'FOREIGN_SUBMISSION',1,'FOREIGN_BOOT','failed',?)", uuid(2), f.core.now());
 for (const attempt of [1, 2, 3]) f.db.exec(`INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,native_run_ref,status,deadline_at,started_at,settled_at,result_json,coordinator_release_json)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, uuid(1), attempt, `SECRET_SUBMISSION_${attempt}`, 1, 'SECRET_BOOT', 'SECRET_NATIVE', attempt === 2 ? 'running' : 'completed', '2026-09-10T01:00:00.000Z',
  `2026-09-10T00:00:0${attempt}.000Z`, attempt === 2 ? null : '2026-09-10T00:01:00.000Z', attempt === 2 ? null : '{"text":"SECRET_RESULT"}', attempt === 2 ? '{"outcome":"completed","native_ref":"SECRET_NATIVE"}' : null);
 const statuses = ['delivered', 'pending', 'pending', 'failed', 'outcome_unknown'];
 statuses.forEach((status, index) => f.db.exec('INSERT INTO outbox(id,run_id,destination,payload_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)', uuid(20 + index), uuid(1), index === 0 ? 'portal' : `SECRET_DESTINATION_${index}`, '{"text":"SECRET_PAYLOAD"}', status, '2026-09-09T00:00:00.000Z', '2026-09-09T00:01:00.000Z'));
 f.db.exec("INSERT INTO outbox VALUES(?,?,?,'{}','delivered',?,?)", uuid(30), uuid(2), 'portal', f.core.now(), f.core.now());
 const tables = ['runs', 'attempts', 'outbox', 'operations', 'effects', 'events', 'lifecycle'];
 const before = tables.map(table => f.db.all(`SELECT * FROM ${table} ORDER BY 1`));
 const page = f.core.routineTaskPage(target.id);
 expect(page.runs).toHaveLength(1);
 expect(page.runs[0]).toMatchObject({ execution: { attempt: 2, status: 'running', started_at: '2026-09-10T00:00:02.000Z', settled_at: null, result_body_retained: false },
  run_delivery: { counts: { pending: 2, delivered: 1, failed: 1, outcome_unknown: 1 }, portal: { status: 'delivered', updated_at: '2026-09-09T00:01:00.000Z' } } });
 expect(JSON.stringify(page)).not.toMatch(/SECRET_|result_json|payload_json|destination|coordinator_release|submission_key|native_run_ref|boot_id/);
 expect(tables.map(table => f.db.all(`SELECT * FROM ${table} ORDER BY 1`))).toEqual(before);
 const conversation = f.core.taskPage(bot).runs[0];
 expect(conversation).not.toHaveProperty('execution'); expect(conversation).not.toHaveProperty('run_delivery');
});

it('does not substitute prior or future execution records for an absent current attempt, or fabricate delivery', () => {
 const target = routine({ id: uuid(80) }); f.store.put(target.id, 'routine', target, 0, 'owner', f.core.now());
 insertRun(uuid(1), target.id, bot, 'queued', 2);
 for (const attempt of [1, 3]) f.db.exec("INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,status,deadline_at) VALUES(?,?,?,1,'boot','completed',?)", uuid(1), attempt, `submission-${attempt}`, f.core.now());
 expect(f.core.routineTaskPage(target.id).runs[0]).toMatchObject({ execution: null, run_delivery: { counts: { pending: 0, delivered: 0, failed: 0, outcome_unknown: 0 }, portal: null } });
 f.db.exec('UPDATE runs SET current_attempt=0 WHERE id=?', uuid(1));
 expect(f.core.routineTaskPage(target.id).runs[0]).toMatchObject({ execution: null });
});

it('preserves recorded completion and portal status after actual result-body expiry', () => {
 const target = routine({ id: uuid(80) }); f.store.put(target.id, 'routine', target, 0, 'owner', f.core.now());
 insertRun(uuid(1), target.id, bot, 'completed', 1);
 f.db.exec(`INSERT INTO attempts(run_id,attempt,submission_key,epoch,boot_id,status,deadline_at,started_at,settled_at,result_json)
  VALUES(?,1,'submission',1,'boot','completed',?,NULL,?,'{"text":"EXPIRED_PRIVATE_RESULT"}')`, uuid(1), f.core.now(), f.core.now());
 f.db.exec("INSERT INTO outbox VALUES(?,?,'portal','{\"text\":\"EXPIRED_PRIVATE_RESULT\"}','delivered',?,?)", uuid(20), uuid(1), f.core.now(), f.core.now());
 const before = f.core.routineTaskPage(target.id).runs[0];
 expect(before).toMatchObject({ execution: { attempt: 1, status: 'completed', started_at: null, settled_at: '2026-09-10T00:00:00.000Z', result_body_retained: true } });
 f.setNow('2026-12-09T00:00:00.000Z');
 expect(new ResultRetention(f.store, () => f.core.now()).prune()).toBe(1);
 const after = f.core.routineTaskPage(target.id).runs[0];
 expect(after).toEqual({ ...before, execution: { attempt: 1, status: 'completed', started_at: null, settled_at: '2026-09-10T00:00:00.000Z', result_body_retained: false } });
 expect(JSON.stringify([before, after])).not.toContain('EXPIRED_PRIVATE_RESULT');
});
