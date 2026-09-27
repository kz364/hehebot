import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LifecycleCore, type Identity, type HeartbeatOperation } from '../src/core/lifecycle';
import { NativeTaskLedger } from '../src/core/native-tasks';
import { ResourceLedger } from '../src/core/resources';
import { EffectLedger } from '../src/core/effects';
import { ControlCore } from '../src/core/control';
import { Store } from '../src/core/store';
import { FakeProvider, type RuntimeRef } from '../src/providers';
import { fixture, bot, TestDatabase } from './helpers';
let f: ReturnType<typeof fixture>, life: LifecycleCore, identity: Identity;
const ref: RuntimeRef = { provider: 'fake', id: 'synthetic-runtime' };
beforeEach(() => {
  f = fixture(true); life = new LifecycleCore(f.store, f.core);
  f.db.exec("UPDATE lifecycle SET provider_ref_json=?,phase='BOOTING',epoch=1,lease_until='2026-09-10T00:02:00.000Z'", JSON.stringify(ref));
  identity = life.registerBoot(randomUUID()); life.ready(identity);
});
afterEach(() => f.close());
function enqueue() { return f.accept({ schema_version: 1, type: 'message.send', payload: { conversation_id: bot, text: 'Synthetic task' } }).resource_id!; }
function claimed() { const id = enqueue(); const claim = life.claim(identity)!; expect(claim.run.id).toBe(id); return claim; }
function operation(run_id: string, kind: HeartbeatOperation['kind'] = 'inference'): HeartbeatOperation {
  return { id: randomUUID(), run_id, attempt: 1, kind, status: 'active', started_at: f.core.now(), last_progress_at: f.core.now(), deadline_at: '2026-09-10T00:20:00.000Z' };
}
function unknownEffect(runId: string) {
  f.db.exec("INSERT INTO effects(id,run_id,action_key,classification,status,authorization_ref,request_digest,updated_at) VALUES(?,?,?,'mutation','outcome_unknown','synthetic-authorization','synthetic-digest',?)", randomUUID(), runId, randomUUID(), f.core.now());
}
describe('executor leases and attempts', () => {
  it('stop recovery loads only metadata-eligible automatic retry candidates without discarding other custody', () => {
    const cases = [
      ['coordinator',1,'TEMPORARY_UNAVAILABLE',true], ['coordinator',2,'DEADLINE_EXCEEDED',true],
      ['coordinator',1,'STALE_EPOCH',true], ['coordinator',1,'CANCEL_UNCONFIRMED',true],
      ['background',1,'STALE_EPOCH',false], ['coordinator',3,'STALE_EPOCH',false],
      ['coordinator',1,null,false], ['coordinator',1,'OWNER_CANCELLED',false],
      ['coordinator',1,'OUTCOME_UNKNOWN',false],
    ] as const;
    const ids = cases.map(([role, attempt, reason]) => {
      const id = enqueue();
      f.db.exec("UPDATE runs SET status='recovery_required',role=?,current_attempt=?,error_code=?,checkpoint_json=? WHERE id=?", role, attempt, reason, JSON.stringify({ cursor: id }), id);
      return id;
    });
    const before = ids.map(id => f.store.run(id));
    f.db.exec("UPDATE lifecycle SET phase='RECOVERY_REQUIRED'");
    const read = vi.spyOn(f.db, 'all');
    try {
      life.observeStopped({ phase: 'stopped', executionStopped: true, persistentState: 'retained', observedAt: Date.now() });
      const rows = read.mock.calls.flatMap(([sql], index) => sql.includes('SELECT id,role,current_attempt,error_code FROM runs')
        ? read.mock.results[index].value as Array<{id:string}> : []);
      expect(rows.map(row => row.id).sort()).toEqual(ids.slice(0,4).sort());
    } finally { read.mockRestore(); }
    for (const [i, [, attempt, reason, eligible]] of cases.entries()) {
      expect(f.store.run(ids[i])).toEqual({ ...before[i], status: eligible ? 'waiting' : 'recovery_required' });
      expect(f.db.all('SELECT due_at,reason FROM retry_queue WHERE run_id=?', ids[i])).toEqual(eligible
        ? [{ due_at: attempt === 2 ? '2026-09-10T00:01:00.000Z' : '2026-09-10T00:00:10.000Z', reason }] : []);
    }
  });

  it.each([
    ['idempotent', null, false], ['idempotent', 'null', true], ['idempotent', 'false', true],
    ['idempotent', '0', true], ['idempotent', '""', true], ['mutation', '{}', false],
    ['read_only', null, true], ['idempotent', JSON.stringify({ padding: 'x'.repeat(1100000) }), true],
  ] as const)('retry effect admission preserves receipt-text semantics (case %#)', (classification, receipt, allowed) => {
    const id = claimed().run.id;
    for (let i = 0; i < 40; i++) f.db.exec("INSERT INTO effects(id,run_id,action_key,classification,status,authorization_ref,request_digest,receipt_json,updated_at) VALUES(?,?,?,'read_only','confirmed','test','digest','{}',?)", randomUUID(), id, randomUUID(), f.core.now());
    f.db.exec("INSERT INTO effects(id,run_id,action_key,classification,status,authorization_ref,request_digest,receipt_json,updated_at) VALUES(?,?,?,?,'failed','test','digest',?,?)", randomUUID(), id, randomUUID(), classification, receipt, f.core.now());
    const effects = f.db.all('SELECT * FROM effects'), read = vi.spyOn(f.db, 'all');
    try {
      life.complete(identity, id, 1, { status: 'failed', text: '', error_code: 'TEMPORARY_UNAVAILABLE', checkpoint: { cursor: 71 } });
      for (const [index, [sql]] of read.mock.calls.entries()) if (sql.includes('FROM effects WHERE run_id=?')) {
        const rows = read.mock.results[index].value as Array<Record<string, unknown>>;
        expect(rows.length).toBeLessThanOrEqual(1);
        for (const row of rows) expect(row).not.toHaveProperty('receipt_json');
      }
    } finally { read.mockRestore(); }
    expect(f.store.run(id)).toMatchObject({ status: allowed ? 'waiting' : 'failed', current_attempt: 1,
      checkpoint_json: JSON.stringify({ cursor: 71 }), error_code: 'TEMPORARY_UNAVAILABLE' });
    expect(f.db.all('SELECT run_id,due_at,reason FROM retry_queue')).toEqual(allowed
      ? [{ run_id: id, due_at: '2026-09-10T00:00:10.000Z', reason: 'TEMPORARY_UNAVAILABLE' }] : []);
    expect(f.db.all('SELECT * FROM effects')).toEqual(effects);
  });

  it.each(['operations','resource_locks','effects'] as const)('completion reads one %s blocker without changing custody', table => {
    const id = claimed().run.id;
    life.submitted(identity, id, 1, 'completion-blockers');
    if (table === 'operations') life.heartbeat(identity, Array.from({ length: 40 }, () => operation(id, 'tool')));
    if (table === 'resource_locks') {
      const ledger = new ResourceLedger(f.store, () => f.core.now());
      for (let i = 0; i < 40; i++) ledger.acquire(id, 1, [`browser:blocker-${i}`]);
    }
    if (table === 'effects') for (let i = 0; i < 40; i++) unknownEffect(id);
    const before = f.db.all(`SELECT * FROM ${table}`), run = f.store.run(id);
    const attempts = f.db.all('SELECT * FROM attempts WHERE run_id=?', id);
    const read = vi.spyOn(f.db, 'all');
    try {
      expect(() => life.complete(identity, id, 1, { status: 'completed', text: 'Not yet' }))
        .toThrowError(expect.objectContaining({ code: table === 'operations' ? 'CANCEL_UNCONFIRMED' : table === 'resource_locks' ? 'RESOURCE_BUSY' : 'OUTCOME_UNKNOWN' }));
      const rows = read.mock.calls.flatMap(([sql], index) => sql.includes(`FROM ${table} WHERE run_id=?`)
        ? [read.mock.results[index].value as unknown[]] : []);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toHaveLength(1);
    } finally { read.mockRestore(); }
    expect(f.db.all(`SELECT * FROM ${table}`)).toEqual(before);
    expect(f.store.run(id)).toEqual(run);
    expect(f.db.all('SELECT * FROM attempts WHERE run_id=?', id)).toEqual(attempts);
    expect(f.db.all("SELECT id FROM events WHERE type='run.result'")).toEqual([]);
  });

  it('does not let settled history consume the unresolved-family threshold', () => {
    for (let i = 0; i < 40; i++) {
      const id = enqueue();
      f.db.exec("UPDATE runs SET status='completed',current_attempt=1 WHERE id=?", id);
    }
    for (let i = 0; i < 32; i++) {
      const id = enqueue();
      f.db.exec("UPDATE runs SET status='completed',current_attempt=1 WHERE id=?", id);
      unknownEffect(id);
    }
    const next = enqueue(), effects = f.db.all('SELECT * FROM effects');
    expect(life.claim(identity)).toBeNull();
    expect(f.store.run(next).current_attempt).toBe(0);
    expect(f.db.all('SELECT * FROM effects')).toEqual(effects);
  });

  it.each([31,32,40])('stops unresolved-family counting at its admission threshold (%i retained families)', count => {
    // Synthetic restored terminal inventory: each root still owns an unknown
    // effect. The next admission must count custody, not terminal run labels.
    const ids = Array.from({ length: count }, () => enqueue());
    for (const id of ids) {
      f.db.exec("UPDATE runs SET status='completed',current_attempt=1 WHERE id=?", id);
      unknownEffect(id);
    }
    const next = enqueue(), effects = f.db.all('SELECT * FROM effects');
    let visits = 0, queries = 0;
    f.db.sqlite.function('family_scan_probe', () => { visits++; return 1; });
    const all = f.db.all.bind(f.db);
    const read = vi.spyOn(f.db, 'all').mockImplementation((sql, ...values) => {
      if (sql.includes('COUNT(*) AS count FROM') && sql.includes("r.role='coordinator' AND r.current_attempt>0")) {
        queries++;
        sql = sql.replace("r.role='coordinator' AND r.current_attempt>0", "r.role='coordinator' AND r.current_attempt>0 AND family_scan_probe()");
      }
      return all(sql, ...values);
    });
    let result;
    try { result = life.claim(identity); } finally { read.mockRestore(); }
    expect(queries).toBe(1);
    expect(visits).toBe(Math.min(count, 32));
    expect(result?.run.id ?? null).toBe(count < 32 ? next : null);
    expect(f.store.run(next).current_attempt).toBe(count < 32 ? 1 : 0);
    expect(f.db.all('SELECT * FROM effects')).toEqual(effects);
  });

  it.each(['running','cancelling','completed'] as const)('cancels %s using metadata without historical bodies or grace renewal',status=>{
    const id=claimed().run.id;life.submitted(identity,id,1,'cancel-native');
    const context=JSON.stringify({padding:'界'.repeat(400000)}),checkpoint=JSON.stringify({padding:'x'.repeat(1100000)});
    f.db.exec('UPDATE runs SET status=?,context_json=?,checkpoint_json=? WHERE id=?',status,context,checkpoint,id);
    const initial=f.store.run(id),attempts=f.db.all('SELECT * FROM attempts WHERE run_id=?',id);
    const cancel=()=>f.accept({schema_version:1,type:'run.cancel',payload:{run_id:id,reason:'Stop exact task'}});
    const read=vi.spyOn(f.db,'all');
    try{
      f.setNow('2026-09-10T00:00:10.000Z');expect(cancel().status).toBe('applied');
      f.setNow('2026-09-10T00:00:20.000Z');expect(cancel().status).toBe('applied');
      const returned=read.mock.calls.flatMap(([sql],index)=>sql.includes('FROM runs WHERE id=?')?read.mock.results[index].value:[]);
      expect(returned).toEqual([
        {id,persona_id:bot,status,updated_at:initial.updated_at},
        {id,persona_id:bot,status:status==='completed'?'completed':'cancelling',updated_at:status==='running'?'2026-09-10T00:00:10.000Z':initial.updated_at}
      ]);
    }finally{read.mockRestore();}
    expect(f.store.run(id)).toMatchObject({context_json:context,checkpoint_json:checkpoint,
      status:status==='completed'?'completed':'cancelling',updated_at:status==='running'?'2026-09-10T00:00:10.000Z':initial.updated_at});
    expect(f.db.all('SELECT * FROM attempts WHERE run_id=?',id)).toEqual(attempts);
  });

  it.each(['completed','failed','waiting'] as const)('completes %s without historical snapshot hydration',status=>{
    const id=claimed().run.id;life.submitted(identity,id,1,'completion-native');
    const context=JSON.stringify({padding:'界'.repeat(400000)}),checkpoint=JSON.stringify({padding:'x'.repeat(1100000)});
    f.db.exec('UPDATE runs SET context_json=?,checkpoint_json=? WHERE id=?',context,checkpoint,id);
    const result={status,text:'Exact result',...(status==='failed'?{error_code:'TEMPORARY_UNAVAILABLE'}:{}),...(status==='waiting'?{checkpoint:{cursor:'next-page'}}:{})};
    const read=vi.spyOn(f.db,'all');
    try{
      life.complete(identity,id,1,result);
      life.complete(identity,id,1,result);
      expect(()=>life.complete(identity,id,1,{...result,text:'Different result'})).toThrowError(expect.objectContaining({code:'RESULT_CONFLICT'}));
      const rows=read.mock.calls.flatMap(([sql],index)=>sql.includes('FROM runs WHERE id=?')?read.mock.results[index].value:[]);
      expect(rows.length).toBeGreaterThanOrEqual(3);
      for(const row of rows){expect(row).not.toHaveProperty('context_json');expect(row).not.toHaveProperty('checkpoint_json');}
    }finally{read.mockRestore();}
    expect(f.store.run(id)).toMatchObject({context_json:context,status:status==='failed'?'waiting':status,
      checkpoint_json:status==='failed'?JSON.stringify({retry_at:'2026-09-10T00:00:10.000Z'}):status==='waiting'?JSON.stringify({cursor:'next-page'}):null});
    expect(f.db.all('SELECT status,result_json FROM attempts WHERE run_id=?',id)).toEqual([{status,result_json:JSON.stringify(result)}]);
    expect(f.db.all('SELECT payload_json FROM outbox WHERE run_id=?',id)).toEqual([{payload_json:JSON.stringify(result)}]);
    expect(f.db.all('SELECT run_id,due_at,reason FROM retry_queue WHERE run_id=?',id)).toEqual(status==='failed'?[{run_id:id,due_at:'2026-09-10T00:00:10.000Z',reason:'TEMPORARY_UNAVAILABLE'}]:[]);
  });

  it.each(['running','cancelling','recovery_required'] as const)('heartbeats %s operation custody without historical snapshot hydration',status=>{
    const id=claimed().run.id;life.submitted(identity,id,1,'heartbeat-native');
    const context=JSON.stringify({padding:'界'.repeat(400000)}),checkpoint=JSON.stringify({padding:'x'.repeat(1100000)});
    f.db.exec('UPDATE runs SET status=?,context_json=?,checkpoint_json=? WHERE id=?',status,context,checkpoint,id);
    const op=operation(id,'tool'),read=vi.spyOn(f.db,'all');
    try{
      const heartbeat=life.heartbeat(identity,[op]);
      expect(heartbeat.cancellations.includes(id)).toBe(status!=='running');
      life.heartbeat(identity,[{...op,status:'settled'}]);
      const rows=read.mock.calls.flatMap(([sql],index)=>sql.includes('FROM runs WHERE id=?')?read.mock.results[index].value:[]);
      expect(rows).toEqual([{id,current_attempt:1,status},{id,current_attempt:1,status}]);
    }finally{read.mockRestore();}
    expect(f.db.all('SELECT * FROM operations WHERE id=?',op.id)).toEqual([{...op,status:'settled'}]);
    expect(f.store.run(id)).toMatchObject({status,context_json:context,checkpoint_json:checkpoint});
  });

  it.each([false,true])('acknowledges native receipts without historical body reads: expired=%s',expired=>{
    const id=claimed().run.id,context=JSON.stringify({...JSON.parse(f.store.run(id).context_json),padding:'界'.repeat(400000)});
    const checkpoint=JSON.stringify({padding:'x'.repeat(1100000)});
    f.db.exec("UPDATE runs SET context_json=?,checkpoint_json=?,error_code='RETAINED_REASON' WHERE id=?",context,checkpoint,id);
    f.db.exec('UPDATE attempts SET deadline_at=? WHERE run_id=?',new Date(Date.parse(f.core.now())+(expired?-1:60000)).toISOString(),id);
    const read=vi.spyOn(f.db,'all');
    try{
      life.submitted(identity,id,1,'bounded-ack');
      life.submitted(identity,id,1,'bounded-ack');
      const rows=read.mock.calls.flatMap(([sql],index)=>sql.includes('FROM runs WHERE id=?')?[read.mock.results[index].value]:[]);
      expect(rows).toEqual([
        [{current_attempt:1,status:'claimed',error_code:'RETAINED_REASON'}],
        [{current_attempt:1,status:expired?'cancelling':'running',error_code:expired?'DEADLINE_EXCEEDED':'RETAINED_REASON'}]
      ]);
    }finally{read.mockRestore();}
    expect(f.store.run(id)).toMatchObject({context_json:context,checkpoint_json:checkpoint,status:expired?'cancelling':'running'});
    expect(f.db.all('SELECT native_run_ref,status FROM attempts WHERE run_id=?',id)).toEqual([{native_run_ref:'bounded-ack',status:'running'}]);
  });
  it('holds quiet claimed/running inference even without tool records', () => {
    const claim = claimed(); f.setNow('2026-09-10T00:01:00.000Z');
    expect(() => life.prepareSleep(identity)).toThrowError(expect.objectContaining({ code: 'SLEEP_DENIED' }));
    life.submitted(identity, claim.run.id, 1, 'native-synthetic');
    expect(() => life.prepareSleep(identity)).toThrowError(expect.objectContaining({ code: 'SLEEP_DENIED' }));
    expect(life.claim(identity)).toBe(null);
  });
  it.each(['tool', 'child', 'transfer', 'node', 'flush', 'delivery'] as const)('%s operation blocks terminal completion and sleep', (kind) => {
    const claim = claimed(), op = operation(claim.run.id, kind); life.heartbeat(identity, [op]);
    expect(() => life.complete(identity, claim.run.id, 1, { status: 'completed', text: 'Synthetic result' })).toThrowError(expect.objectContaining({ code: 'CANCEL_UNCONFIRMED' }));
    f.setNow('2026-09-10T00:01:00.000Z');
    expect(() => life.prepareSleep(identity)).toThrowError(expect.objectContaining({ code: 'SLEEP_DENIED' }));
    life.heartbeat(identity, [{ ...op, status: 'settled' }]);
    expect(() => life.complete(identity, claim.run.id, 1, { status: 'completed', text: 'Synthetic result' })).not.toThrow();
  });
  it('stale epoch/boot or expired heartbeat cannot extend lease', () => {
    const lease = life.get().lease_until;
    for (const stale of [{ ...identity, epoch: 0 }, { ...identity, boot_id: randomUUID() }]) expect(() => life.heartbeat(stale, [])).toThrowError(expect.objectContaining({ code: 'STALE_EPOCH' }));
    expect(life.get().lease_until).toBe(lease);
    f.setNow('2026-09-10T00:01:30.000Z');
    expect(() => life.heartbeat(identity, [])).toThrowError(expect.objectContaining({ code: 'STALE_EPOCH' }));
    expect(life.get().lease_until).toBe(lease);
  });
  it('expired boot registration cannot resurrect lease before watchdog', () => {
    f.db.exec("UPDATE lifecycle SET phase='BOOTING'");
    f.setNow('2026-09-10T00:02:01.000Z');
    expect(() => life.registerBoot(identity.boot_id)).toThrowError(expect.objectContaining({ code: 'STALE_EPOCH' }));
  });
  it('retains a first root submission receipt after deadline without reopening execution', () => {
    const claim = claimed();
    f.db.exec("UPDATE attempts SET deadline_at='2026-09-10T00:00:10.000Z' WHERE run_id=?", claim.run.id);
    f.setNow('2026-09-10T00:00:10.001Z');
    life.submitted(identity, claim.run.id, 1, 'late-root-receipt');
    const run = f.store.run(claim.run.id), attempts = f.db.all('SELECT * FROM attempts');
    expect(run).toMatchObject({ status: 'cancelling', error_code: 'DEADLINE_EXCEEDED' });
    expect(attempts).toEqual([expect.objectContaining({ native_run_ref: 'late-root-receipt', status: 'running' })]);
    expect(life.heartbeat(identity, []).cancellations).toContain(claim.run.id);
    f.setNow('2026-09-10T00:00:20.000Z');
    life.submitted(identity, claim.run.id, 1, 'late-root-receipt');
    expect(f.store.run(claim.run.id)).toEqual(run); expect(f.db.all('SELECT * FROM attempts')).toEqual(attempts);
  });
  it('submission cannot replace an already registered native child identity', () => {
    const parent = claimed();
    life.submitted(identity, parent.run.id, 1, 'native-root-19');
    const child = new NativeTaskLedger(f.store, f.core, life).register(identity, {
      parent_run_id: parent.run.id, parent_attempt: 1, persona_id: bot,
      native_run_ref: 'native-child-43', native_session_key: 'child-thread-71', title: 'Synthetic child',
    });
    const before = f.db.all('SELECT * FROM attempts WHERE run_id=?', child.id);
    expect(() => life.submitted(identity, child.id, 1, 'native-child-103'))
      .toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
    expect(f.db.all('SELECT * FROM attempts WHERE run_id=?', child.id)).toEqual(before);
    expect(f.store.run(child.id).status).toBe('claimed');
    life.submitted(identity, child.id, 1, 'native-child-43');
    expect(f.db.all('SELECT status,native_run_ref FROM attempts WHERE run_id=?', child.id))
      .toEqual([{ status: 'running', native_run_ref: 'native-child-43' }]);
    expect(f.store.run(child.id).status).toBe('running');
  });
  it('rejects wrong attempt and prevents settled operation resurrection', () => {
    const claim = claimed(), op = operation(claim.run.id);
    expect(() => life.submitted(identity, claim.run.id, 2, 'native')).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
    expect(() => life.heartbeat(identity, [{ ...op, attempt: 2 }])).toThrowError(expect.objectContaining({ code: 'STALE_EPOCH' }));
    life.heartbeat(identity, [{ ...op, status: 'settled' }]);
    expect(() => life.heartbeat(identity, [op])).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(() => life.complete(identity, claim.run.id, 2, { status: 'completed', text: '' })).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
  });
  it.each(['2026-09-10T01:02:00+01:00', '2026-09-09T23:02:00-01:00'])('canonicalizes offset deadlines before watchdog comparisons: %s', deadline => {
    const claim = claimed(), op = { ...operation(claim.run.id, 'tool'), deadline_at: deadline,
      started_at: '2026-09-10T07:00:00+07:00', last_progress_at: '2026-09-10T07:00:01+07:00' };
    life.heartbeat(identity, [op]);
    expect(f.db.all('SELECT started_at,deadline_at,last_progress_at FROM operations WHERE id=?', op.id)).toEqual([
      { started_at: '2026-09-10T00:00:00.000Z', deadline_at: '2026-09-10T00:02:00.000Z', last_progress_at: '2026-09-10T00:00:01.000Z' },
    ]);
    f.db.exec("UPDATE lifecycle SET lease_until='2026-09-10T00:10:00.000Z'");
    f.setNow('2026-09-10T00:01:59.999Z'); life.watchdog(); expect(f.store.run(claim.run.id).status).toBe('claimed');
    f.setNow('2026-09-10T00:02:00.000Z'); life.watchdog(); expect(f.store.run(claim.run.id).status).toBe('cancelling');
  });
  it.each([
    { kind: 'node' }, { started_at: '2026-09-10T00:00:00.001Z' }, { deadline_at: '2026-09-10T00:19:59.999Z' },
    { last_progress_at: '2026-09-09T23:59:59.999Z' },
  ])('rejects changed operation custody or regressing progress atomically: %j', patch => {
    const claim = claimed(), op = operation(claim.run.id); life.heartbeat(identity, [op]);
    const before = f.db.all('SELECT * FROM operations'), lease = life.get();
    f.setNow('2026-09-10T00:00:10.000Z');
    expect(() => life.heartbeat(identity, [operation(claim.run.id), { ...op, ...patch } as HeartbeatOperation]))
      .toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    expect(f.db.all('SELECT * FROM operations')).toEqual(before); expect(life.get()).toEqual(lease);
  });
  it('accepts equivalent offset replay and advances progress without changing the deadline', () => {
    const claim = claimed(), op = operation(claim.run.id); life.heartbeat(identity, [op]);
    life.heartbeat(identity, [{ ...op, started_at: '2026-09-10T07:00:00+07:00', deadline_at: '2026-09-10T07:20:00+07:00', last_progress_at: '2026-09-10T07:00:10+07:00' }]);
    expect(f.db.all('SELECT started_at,deadline_at,last_progress_at FROM operations WHERE id=?', op.id)).toEqual([
      { started_at: op.started_at, deadline_at: op.deadline_at, last_progress_at: '2026-09-10T00:00:10.000Z' },
    ]);
  });
  it.each([
    { deadline_at: '2026-09-10T07:20:00.001+07:00' },
    { started_at: '2026-09-10T00:02:00.001Z', deadline_at: '2026-09-10T00:02:00.000Z', last_progress_at: '2026-09-10T00:02:00.001Z' },
    { last_progress_at: '2026-09-09T23:59:59.999Z' },
  ])('rejects new operation timing outside its attempt envelope atomically: %j', patch => {
    const claim = claimed(), before = life.get();
    f.setNow('2026-09-10T00:00:10.000Z');
    const invalid = { ...operation(claim.run.id), started_at: '2026-09-10T00:00:00.000Z', ...patch };
    expect(() => life.heartbeat(identity, [operation(claim.run.id), invalid]))
      .toThrowError(expect.objectContaining({ code: 'INVALID_INPUT', status: 422 }));
    expect(f.db.all('SELECT * FROM operations')).toEqual([]);
    expect(life.get()).toEqual(before);
  });
  it('accepts an exact hard-deadline boundary and late progress without extending custody', () => {
    const claim = claimed(), op = { ...operation(claim.run.id), started_at: claim.deadline_at,
      deadline_at: '2026-09-10T07:20:00+07:00', last_progress_at: claim.deadline_at };
    f.db.exec("UPDATE lifecycle SET lease_until='2026-09-10T00:21:00.000Z'");
    f.setNow(claim.deadline_at);
    life.heartbeat(identity, [op]);
    f.setNow('2026-09-10T00:20:00.001Z');
    life.heartbeat(identity, [{ ...op, status: 'settled', last_progress_at: '2026-09-10T00:20:00.001Z' }]);
    expect(f.db.all('SELECT started_at,deadline_at,last_progress_at,status FROM operations WHERE id=?', op.id)).toEqual([
      { started_at: claim.deadline_at, deadline_at: claim.deadline_at, last_progress_at: '2026-09-10T00:20:00.001Z', status: 'settled' },
    ]);
  });
  it('canonicalizes retained offset custody only on equivalent authorized replay', () => {
    const claim = claimed(), op = operation(claim.run.id); life.heartbeat(identity, [op]);
    f.db.exec('UPDATE operations SET started_at=?,deadline_at=?,last_progress_at=? WHERE id=?',
      '2026-09-10T07:00:00+07:00', '2026-09-10T07:20:00+07:00', '2026-09-10T07:00:00+07:00', op.id);
    life.heartbeat(identity, [op]);
    expect(f.db.all('SELECT * FROM operations WHERE id=?', op.id)).toEqual([op]);
  });
  it.each(['invalid', '2016-12-31T23:59:60Z', '9999-12-31T23:59:59-01:00'])('rejects nonrepresentable operation time without page writes: %s', deadline_at => {
    const claim = claimed(), before = life.get();
    expect(() => life.heartbeat(identity, [operation(claim.run.id), { ...operation(claim.run.id), deadline_at }]))
      .toThrowError(expect.objectContaining({ code: 'INVALID_INPUT', status: 422 }));
    expect(f.db.all('SELECT * FROM operations')).toEqual([]); expect(life.get()).toEqual(before);
  });
  it.each(['running','cancelling','completed','waiting','recovery_required'])('identical submission receipt replay leaves %s work and every table unchanged', status => {
    const id = claimed().run.id;
    life.submitted(identity, id, 1, 'native-receipt-71');
    f.db.exec('UPDATE runs SET status=? WHERE id=?', status, id);
    f.setNow('2026-09-10T00:00:20.000Z');
    const before = f.db.all<{ n:number }>('SELECT total_changes() AS n')[0].n;
    life.submitted(identity, id, 1, 'native-receipt-71');
    expect(f.db.all<{ n:number }>('SELECT total_changes() AS n')[0].n).toBe(before);
    expect(f.store.run(id).status).toBe(status);
    expect(() => life.submitted(identity, id, 1, 'native-receipt-17')).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
    expect(() => life.submitted({ ...identity, epoch: 2 }, id, 1, 'native-receipt-71')).toThrowError(expect.objectContaining({ code: 'STALE_EPOCH' }));
  });
  it('unacknowledged cancellation is not authority for a new submission registration', () => {
    const id = claimed().run.id;
    f.accept({ schema_version: 1, type: 'run.cancel', payload: { run_id: id, reason: 'Stop before acknowledgment' } });
    expect(() => life.submitted(identity, id, 1, 'never-registered')).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
    expect(f.db.all('SELECT native_run_ref FROM attempts WHERE run_id=?', id)).toEqual([{ native_run_ref: null }]);
    expect(f.store.run(id).status).toBe('cancelling');
  });
  it('completion replay uses retained receipts and cannot overwrite a checkpoint or acknowledge a pruned result', () => {
    const id = claimed().run.id;
    const result = { status: 'waiting' as const, text: 'Owner input needed', checkpoint: { cursor: 43, draft: 'first' } };
    life.complete(identity, id, 1, result);
    const before = f.db.all('SELECT * FROM attempts WHERE run_id=?', id);
    for (const change of [{ text: 'Different' }, { checkpoint: { cursor: 71, draft: 'first' } }, { status: 'completed' as const }]) {
      expect(() => life.complete(identity, id, 1, { ...result, ...change }))
        .toThrowError(expect.objectContaining({ code: 'RESULT_CONFLICT' }));
    }
    expect(f.db.all('SELECT * FROM attempts WHERE run_id=?', id)).toEqual(before);
    // Missing retained evidence cannot become a new publication or an acknowledgment.
    f.db.exec('UPDATE attempts SET result_json=NULL WHERE run_id=?', id);
    expect(() => life.complete(identity, id, 1, result)).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
    expect(f.db.all("SELECT id FROM events WHERE type='run.result'")).toHaveLength(1);
  });
  it('retry-queued receipt replay preserves admission state, but a new attempt or epoch fences it', () => {
    const id = claimed().run.id;
    const result = { status: 'failed' as const, text: 'Read unavailable', error_code: 'TEMPORARY_UNAVAILABLE' };
    life.complete(identity, id, 1, result);
    f.setNow('2026-09-10T00:00:11.000Z'); life.retryDue();
    expect(f.store.run(id).status).toBe('queued');
    life.complete(identity, id, 1, result);
    expect(f.store.run(id).status).toBe('queued');
    const next = life.claim(identity)!;
    expect(next.run.current_attempt).toBe(2);
    expect(() => life.complete(identity, id, 1, result)).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
    f.db.exec('UPDATE lifecycle SET epoch=2');
    expect(() => life.complete(identity, id, 1, result)).toThrowError(expect.objectContaining({ code: 'STALE_EPOCH' }));
    expect(f.db.all("SELECT id FROM events WHERE type='run.result'")).toHaveLength(1);
  });
  it('root retry waits for nested descendants while preserving their original parent attempt', () => {
    const root = claimed().run;
    life.submitted(identity, root.id, 1, 'root-retry');
    const native = new NativeTaskLedger(f.store, f.core, life);
    const spawn = (parent: string, ref: string) => native.register(identity, { parent_run_id: parent,
      parent_attempt: 1, persona_id: bot, native_run_ref: ref, native_session_key: ref, title: ref }, true);
    const child = spawn(root.id, 'retry-child'), grandchild = spawn(child.id, 'retry-grandchild');
    life.complete(identity, child.id, 1, { status: 'completed', text: '' });
    life.complete(identity, root.id, 1, { status: 'failed', text: '' });
    const retry = () => f.accept({ schema_version: 1, type: 'run.retry', payload: { run_id: root.id, expected_attempt: 1 } });
    expect(retry()).toMatchObject({ status: 'rejected', error: { code: 'CANCEL_UNCONFIRMED' } });
    expect(f.store.run(root.id)).toMatchObject({ status: 'failed', current_attempt: 1 });
    expect(f.store.run(grandchild.id)).toMatchObject({ status: 'running', current_attempt: 1 });
    life.complete(identity, grandchild.id, 1, { status: 'completed', text: '' });
    expect(retry()).toMatchObject({ status: 'applied', resource_id: root.id });
    expect(life.claim(identity)?.run).toMatchObject({ id: root.id, current_attempt: 2 });
  });
  it('rechecks late child observations before claim without hiding independent queued work', () => {
    const root = claimed().run;
    life.submitted(identity, root.id, 1, 'late-root');
    life.complete(identity, root.id, 1, { status: 'failed', text: '' });
    expect(f.accept({ schema_version: 1, type: 'run.retry', payload: { run_id: root.id, expected_attempt: 1 } })).toMatchObject({ status: 'applied' });
    const child = new NativeTaskLedger(f.store, f.core, life).register(identity, { parent_run_id: root.id,
      parent_attempt: 1, persona_id: bot, native_run_ref: 'late-child', native_session_key: 'late-child', title: 'Late observation' }, true);
    expect(life.claim(identity)).toBeNull();
    f.setNow('2026-09-10T00:00:01.000Z');
    const other = enqueue();
    expect(life.claim(identity)?.run.id).toBe(other);
    life.complete(identity, other, 1, { status: 'completed', text: '' });
    expect(f.store.run(root.id).current_attempt).toBe(1);
    life.complete(identity, child.id, 1, { status: 'completed', text: '' });
    expect(life.claim(identity)?.run).toMatchObject({ id: root.id, current_attempt: 2 });
  });
  it.each(['running', 'unknown-effect'] as const)('disk-restored automatic retry retains late grandchild %s custody without blocking unrelated work', async retained => {
    const root = claimed().run;
    life.submitted(identity, root.id, 1, 'automatic-root');
    const result = { status: 'failed' as const, text: 'Retryable read', error_code: 'TEMPORARY_UNAVAILABLE', checkpoint: { cursor: 43 } };
    life.complete(identity, root.id, 1, result);
    f.setNow('2026-09-10T00:00:10.000Z'); life.retryDue();
    expect(f.store.run(root.id)).toMatchObject({ status: 'queued', current_attempt: 1 });
    expect(f.db.all('SELECT * FROM retry_queue')).toEqual([]);
    // Native observations may arrive after the timer queues the next attempt.
    const native = new NativeTaskLedger(f.store, f.core, life);
    const spawn = (parent: string, ref: string) => native.register(identity, { parent_run_id: parent,
      parent_attempt: 1, persona_id: bot, native_run_ref: ref, native_session_key: `thread-${ref}`, title: ref }, true);
    const child = spawn(root.id, 'automatic-child'), grandchild = spawn(child.id, 'automatic-grandchild');
    life.complete(identity, child.id, 1, { status: 'completed', text: '' });
    if (retained === 'unknown-effect') {
      life.complete(identity, grandchild.id, 1, { status: 'completed', text: '' });
      unknownEffect(grandchild.id); // Restored terminal metadata cannot hide unresolved effect evidence.
    }
    const links = f.db.all('SELECT * FROM native_task_links ORDER BY run_id');
    const attempts = f.db.all('SELECT * FROM attempts ORDER BY run_id,attempt');
    const effects = f.db.all('SELECT * FROM effects');
    // Restore a closed SQLite backup, then reopen its post-admission writes too.
    // This does not simulate native process loss or authorize executor takeover.
    const dir = mkdtempSync(join(tmpdir(), 'hehebot-retry-reopen-')), file = join(dir, 'control.db');
    let db: TestDatabase | undefined;
    try {
      await backup(f.db.sqlite, file);
      db = new TestDatabase(new DatabaseSync(file));
      const store = new Store(db), core = new ControlCore(store, f.core.options);
      const restored = new LifecycleCore(store, core);
      restored.retryDue();
      restored.complete(identity, root.id, 1, result); // Exact old receipt must not undo the queued retry.
      expect(restored.claim(identity)).toBeNull();
      expect(store.run(root.id)).toMatchObject({ status: 'queued', current_attempt: 1, checkpoint_json: JSON.stringify(result.checkpoint) });
      expect(db.all('SELECT * FROM attempts ORDER BY run_id,attempt')).toEqual(attempts);
      expect(db.all('SELECT * FROM native_task_links ORDER BY run_id')).toEqual(links);
      expect(db.all('SELECT * FROM effects')).toEqual(effects);
      f.setNow('2026-09-10T00:00:11.000Z');
      const command = { schema_version: 1, type: 'message.send', payload: { conversation_id: bot, text: 'Independent disk-restored task' } } as const;
      const receipt = core.accept('owner', randomUUID(), createHash('sha256').update(JSON.stringify(command)).digest('hex'), command);
      expect(receipt.status).toBe('applied');
      const independent = receipt.resource_id!;
      expect(restored.claim(identity)?.run.id).toBe(independent);
      restored.complete(identity, independent, 1, { status: 'completed', text: '' });
      expect(store.run(root.id).current_attempt).toBe(1);
      expect(restored.claim(identity)).toBeNull();
      if (retained === 'running') {
        restored.complete(identity, grandchild.id, 1, { status: 'completed', text: '' });
        const next = restored.claim(identity)!;
        expect(next.run).toMatchObject({ id: root.id, current_attempt: 2, checkpoint_json: JSON.stringify(result.checkpoint) });
        expect(next.submission_key).toBe(`${root.id}:2`);
        expect(db.all('SELECT * FROM attempts WHERE run_id=? AND attempt=1', root.id)).toEqual(attempts.filter(row => (row as {run_id:string}).run_id === root.id));
        expect(db.all('SELECT * FROM native_task_links ORDER BY run_id')).toEqual(links);
      }
      const persistedRoot = store.run(root.id), persistedAttempts = db.all('SELECT * FROM attempts ORDER BY run_id,attempt');
      db.close(); db = undefined;
      db = new TestDatabase(new DatabaseSync(file));
      const reopenedStore = new Store(db), reopenedCore = new ControlCore(reopenedStore, f.core.options);
      const reopened = new LifecycleCore(reopenedStore, reopenedCore);
      expect(reopenedStore.run(root.id)).toEqual(persistedRoot);
      expect(reopenedStore.run(independent).status).toBe('completed');
      expect(db.all('SELECT * FROM attempts ORDER BY run_id,attempt')).toEqual(persistedAttempts);
      expect(db.all('SELECT * FROM native_task_links ORDER BY run_id')).toEqual(links);
      expect(db.all('SELECT * FROM effects')).toEqual(effects);
      expect(reopened.claim(identity)).toBeNull();
      expect(() => reopened.prepareSleep(identity)).toThrowError(expect.objectContaining({
        code: 'SLEEP_DENIED', message: 'Work or unresolved effects prevent sleep.',
      }));
      expect(f.store.run(root.id).current_attempt).toBe(1); // Disk writes never used the source connection.
    } finally {
      try { db?.close(); } finally { rmSync(dir, { recursive: true, force: true }); }
    }
  });
  it.each(['attempt','operation','lock','effect'] as const)('terminal descendant status does not hide a retained %s during retry admission', kind => {
    const root = claimed().run;
    life.submitted(identity, root.id, 1, 'retained-root');
    const child = new NativeTaskLedger(f.store, f.core, life).register(identity, { parent_run_id: root.id,
      parent_attempt: 1, persona_id: bot, native_run_ref: 'retained-child', native_session_key: 'retained-child', title: 'Retained evidence' }, true);
    life.complete(identity, root.id, 1, { status: 'failed', text: '' });
    if(kind === 'operation')life.heartbeat(identity, [operation(child.id)]);
    if(kind === 'lock')new ResourceLedger(f.store, () => f.core.now()).acquire(child.id, 1, ['calendar:retained']);
    if(kind === 'effect')unknownEffect(child.id);
    // Simulate restored, inconsistent terminal metadata; independent evidence
    // must still prevent a new root attempt even when the run status is final.
    f.db.exec("UPDATE runs SET status='completed' WHERE id=?", child.id);
    if(kind !== 'attempt')f.db.exec("UPDATE attempts SET status='completed',settled_at=? WHERE run_id=?", f.core.now(), child.id);
    expect(f.accept({ schema_version: 1, type: 'run.retry', payload: { run_id: root.id, expected_attempt: 1 } }))
      .toMatchObject({ status: 'rejected', error: { code: 'CANCEL_UNCONFIRMED' } });
    f.db.exec("UPDATE runs SET status='queued' WHERE id=?", root.id);
    expect(life.claim(identity)).toBeNull();
    expect(f.store.run(root.id).current_attempt).toBe(1);
  });
  it.each(['claimed', 'running', 'finishing'])('expired %s tasks cannot expand resource custody but can replay and release held locks', status => {
    const runId = claimed().run.id, resources = new ResourceLedger(f.store, () => f.core.now());
    f.db.exec('UPDATE runs SET status=? WHERE id=?', status, runId);
    f.db.exec("UPDATE attempts SET deadline_at='2026-09-10T00:00:10.000Z' WHERE run_id=?", runId);
    f.setNow('2026-09-10T00:00:09.999Z'); resources.acquire(runId, 1, ['browser:a']);
    const held = f.db.all('SELECT * FROM resource_locks');
    for (const now of ['2026-09-10T00:00:10.000Z', '2026-09-10T00:00:10.001Z']) {
      f.setNow(now);
      expect(() => resources.acquire(runId, 1, ['browser:a', 'calendar:z'])).toThrowError(expect.objectContaining({ code: 'DEADLINE_EXCEEDED' }));
      expect(f.db.all('SELECT * FROM resource_locks')).toEqual(held);
      resources.acquire(runId, 1, ['browser:a']);
      expect(f.db.all('SELECT * FROM resource_locks')).toEqual(held);
    }
    resources.release(runId, 1, ['browser:a']);
    expect(f.db.all('SELECT * FROM resource_locks')).toEqual([]);
    expect(() => resources.acquire(runId, 1, ['browser:a'])).toThrowError(expect.objectContaining({ code: 'DEADLINE_EXCEEDED' }));
  });
  it('unknown effects block completion and retry after provider stop', () => {
    const claim = claimed(); unknownEffect(claim.run.id);
    expect(() => life.complete(identity, claim.run.id, 1, { status: 'completed', text: '' })).toThrowError(expect.objectContaining({ code: 'OUTCOME_UNKNOWN' }));
    f.db.exec("UPDATE lifecycle SET phase='RECOVERY_REQUIRED'");
    life.observeStopped({ phase: 'stopped', executionStopped: true, persistentState: 'retained', observedAt: Date.now() });
    expect(f.accept({ schema_version: 1, type: 'run.retry', payload: { run_id: claim.run.id, expected_attempt: 1 } })).toMatchObject({ status: 'rejected', error: { code: 'OUTCOME_UNKNOWN' } });
  });
  it.each(['read_only','idempotent'] as const)('stopped executor does not retry an unknown %s effect with a retained receipt', classification => {
    const id = claimed().run.id;
    life.submitted(identity, id, 1, 'uncertain-read');
    new ResourceLedger(f.store, () => f.core.now()).acquire(id, 1, ['browser:uncertain-read']);
    const effectId = randomUUID(), receipt = JSON.stringify({ prior_response: 'Not settlement proof' });
    f.db.exec("INSERT INTO effects(id,run_id,action_key,classification,status,authorization_ref,request_digest,receipt_json,updated_at) VALUES(?,?,?,?,'dispatched','test','digest',?,?)", effectId, id, randomUUID(), classification, receipt, f.core.now());
    f.setNow('2026-09-10T00:03:00.000Z');
    life.watchdog();
    // V2 (ARCHITECTURE_V2 A3): a lost lease interrupts the attempt in place of
    // the old recovery_required+STALE_EPOCH detour; interrupted is terminal.
    expect(f.store.run(id)).toMatchObject({ status: 'interrupted', error_code: 'STALE_EPOCH' });
    const effects = f.db.all('SELECT * FROM effects'), locks = f.db.all('SELECT * FROM resource_locks');
    expect(effects).toEqual([expect.objectContaining({ id: effectId, classification, status: 'outcome_unknown', receipt_json: receipt })]);
    const stopped = { phase: 'stopped' as const, executionStopped: true, persistentState: 'retained' as const, observedAt: Date.now() };
    life.observeStopped(stopped); life.observeStopped(stopped);
    expect(f.db.all('SELECT * FROM retry_queue')).toEqual([]);
    expect(f.store.run(id)).toMatchObject({ status: 'interrupted', error_code: 'STALE_EPOCH', current_attempt: 1 });
    expect(f.db.all('SELECT * FROM effects')).toEqual(effects);
    expect(f.db.all('SELECT * FROM resource_locks')).toEqual(locks);
    expect(f.db.all('SELECT status,settled_at FROM attempts WHERE run_id=?', id))
      .toEqual([{ status: 'terminated', settled_at: f.core.now() }]);
    f.setNow('2026-09-10T00:04:00.000Z'); life.retryDue();
    expect(f.store.run(id).status).toBe('interrupted');
  });

  it.each(['intent','dispatched','outcome_unknown'] as const)('retains %s effect locks across confirmed stop and rejects competing work until reconciliation', effectStatus => {
    const claim = claimed(), runId = claim.run.id, resources = new ResourceLedger(f.store, () => f.core.now());
    life.submitted(identity, runId, 1, 'native-root');
    const child = new NativeTaskLedger(f.store, f.core, life).register(identity, { parent_run_id: runId, parent_attempt: 1,
      persona_id: bot, native_run_ref: 'native-child', native_session_key: 'thread-child', title: 'Unrelated resource' });
    resources.acquire(runId, 1, ['calendar:remote']); resources.acquire(child.id, 1, ['browser:local']);
    unknownEffect(runId); f.db.exec('UPDATE effects SET status=? WHERE run_id=?', effectStatus, runId);
    expect(() => resources.release(runId, 1, ['calendar:remote'])).toThrowError(expect.objectContaining({ code: 'OUTCOME_UNKNOWN' }));
    f.db.exec("UPDATE lifecycle SET phase='RECOVERY_REQUIRED'");
    const observation = { phase: 'stopped' as const, executionStopped: true, persistentState: 'retained' as const, observedAt: Date.now() };
    life.observeStopped(observation); life.observeStopped(observation);
    expect(f.db.all('SELECT resource_id,run_id,attempt FROM resource_locks')).toEqual([{ resource_id: 'calendar:remote', run_id: runId, attempt: 1 }]);
    expect(f.db.all('SELECT status FROM effects WHERE run_id=?', runId)).toEqual([{ status: 'outcome_unknown' }]);
    expect(() => life.heartbeat(identity, [])).toThrowError(expect.objectContaining({ code: 'STALE_EPOCH' }));
    f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=2,lease_until='2026-09-10T00:02:00.000Z'");
    const nextIdentity = life.registerBoot(randomUUID()); life.ready(nextIdentity);
    const next = enqueue(); expect(life.claim(nextIdentity)?.run.id).toBe(next);
    expect(() => resources.acquire(next, 1, ['calendar:remote'])).toThrowError(expect.objectContaining({ code: 'RESOURCE_BUSY' }));
    const effect = f.db.all<{id:string}>('SELECT id FROM effects WHERE run_id=?', runId)[0].id;
    const ledger = new EffectLedger(f.store, () => f.core.now());
    expect(() => ledger.transition(effect, runId, 'confirmed', null)).toThrow();
    ledger.transition(effect, runId, 'confirmed', { destination_id: 'synthetic-reconciled-37' });
    resources.release(runId, 1, ['calendar:remote']); resources.acquire(next, 1, ['calendar:remote']);
    expect(f.db.all('SELECT run_id FROM resource_locks')).toEqual([{run_id:next}]);
  });
  it.each([1048576,1048577].flatMap(bytes=>['outcome_unknown','confirmed'].map(status=>({bytes,status}))))('bounds reconciliation receipt bytes at $bytes for $status',({bytes,status})=>{
    const runId=claimed().run.id;unknownEffect(runId);
    f.db.exec("UPDATE lifecycle SET phase='RECOVERY_REQUIRED'");
    life.observeStopped({phase:'stopped',executionStopped:true,persistentState:'retained',observedAt:Date.now()});
    const id=f.db.all<{id:string}>('SELECT id FROM effects WHERE run_id=?',runId)[0].id;
    const base=JSON.stringify({kind:'owner_reconciliation',owner_id:'owner',evidence_ref:'manual:limit-17',padding:'界'.repeat(340000)});
    const receipt=base+' '.repeat(bytes-Buffer.byteLength(base));
    expect(receipt.length).toBeLessThan(1048576);
    f.db.exec('UPDATE effects SET status=?,receipt_json=? WHERE id=?',status,receipt,id);
    const before=f.db.all('SELECT * FROM effects WHERE id=?',id),read=vi.spyOn(f.db,'all');
    try{
      const result=f.accept({schema_version:1,type:'effect.reconcile',payload:{run_id:runId,expected_attempt:1,effect_id:id,expected_request_digest:'synthetic-digest',outcome:'confirmed',evidence_ref:'manual:limit-17'}});
      expect(result).toMatchObject(bytes===1048576?{status:'applied'}:{status:'rejected',error:{code:'RECEIPT_PREPARATION_LIMIT'}});
      const reads=read.mock.calls.flatMap(([sql,effectId],i)=>sql.includes('FROM effects WHERE id=?')&&effectId===id?[read.mock.results[i].value]:[]);
      expect(reads.length).toBeGreaterThan(0);
      if(bytes>1048576)for(const rows of reads)for(const row of rows)expect(row.receipt_json).not.toBe(receipt);
    }finally{read.mockRestore();}
    if(bytes>1048576||status==='confirmed')expect(f.db.all('SELECT * FROM effects WHERE id=?',id)).toEqual(before);
    else expect(f.db.all<{receipt_json:string}>('SELECT receipt_json FROM effects WHERE id=?',id)[0].receipt_json).not.toBe(receipt);
  });

  it('keeps saved command replay and digest precedence when an effect receipt later exceeds the limit',()=>{
    const runId=claimed().run.id;unknownEffect(runId);
    f.db.exec("UPDATE lifecycle SET phase='RECOVERY_REQUIRED'");
    life.observeStopped({phase:'stopped',executionStopped:true,persistentState:'retained',observedAt:Date.now()});
    const id=f.db.all<{id:string}>('SELECT id FROM effects WHERE run_id=?',runId)[0].id;
    const command={schema_version:1 as const,type:'effect.reconcile' as const,payload:{run_id:runId,expected_attempt:1,effect_id:id,expected_request_digest:'synthetic-digest',outcome:'confirmed' as const,evidence_ref:'manual:replay-71'}},key=randomUUID();
    const accepted=f.accept(command,key);expect(accepted.status).toBe('applied');
    f.db.exec('UPDATE effects SET receipt_json=? WHERE id=?',JSON.stringify({padding:'界'.repeat(400000)}),id);
    const before=f.db.all('SELECT * FROM effects WHERE id=?',id);
    expect(f.accept(command,key)).toEqual(accepted);
    expect(f.accept({...command,payload:{...command.payload,expected_request_digest:'wrong'}})).toMatchObject({status:'rejected',error:{code:'REVISION_CONFLICT'}});
    expect(f.accept(command)).toMatchObject({status:'rejected',error:{code:'RECEIPT_PREPARATION_LIMIT'}});
    expect(f.db.all('SELECT * FROM effects WHERE id=?',id)).toEqual(before);
  });

  it.each(['confirmed','failed','wrong-digest'])('reconciles stopped effects without historical run bodies: %s',outcome=>{
    const runId=claimed().run.id;unknownEffect(runId);
    f.db.exec("UPDATE lifecycle SET phase='RECOVERY_REQUIRED'");
    life.observeStopped({phase:'stopped',executionStopped:true,persistentState:'retained',observedAt:Date.now()});
    f.db.exec('UPDATE runs SET context_json=?,checkpoint_json=? WHERE id=?',JSON.stringify({padding:'界'.repeat(400000)}),JSON.stringify({padding:'x'.repeat(1100000)}),runId);
    const run=f.store.run(runId),effect=f.db.all<{id:string}>('SELECT * FROM effects WHERE run_id=?',runId)[0],state=life.get();
    const command={schema_version:1 as const,type:'effect.reconcile' as const,payload:{run_id:runId,expected_attempt:1,effect_id:effect.id,
      expected_request_digest:outcome==='wrong-digest'?'wrong':'synthetic-digest',outcome:outcome==='failed'?'failed' as const:'confirmed' as const,evidence_ref:'manual:review-91'}};
    const read=vi.spyOn(f.db,'all');
    try{
      expect(f.accept(command)).toMatchObject(outcome==='wrong-digest'?{status:'rejected',error:{code:'REVISION_CONFLICT'}}:{status:'applied'});
      const reads=read.mock.calls.flatMap(([sql,id],i)=>sql.includes('FROM runs WHERE id=?')&&id===runId?[read.mock.results[i].value]:[]);
      expect(reads.length).toBeGreaterThan(0);
      for(const rows of reads)for(const row of rows){expect(row).not.toHaveProperty('context_json');expect(row).not.toHaveProperty('checkpoint_json');}
    }finally{read.mockRestore();}
    expect(f.store.run(runId)).toEqual(run);expect(life.get()).toEqual(state);
    const after=f.db.all<{status:string;receipt_json:string}>('SELECT * FROM effects WHERE id=?',effect.id)[0];
    if(outcome==='wrong-digest')expect(after).toEqual(effect);
    else{
      expect(after.status).toBe(outcome);
      expect(JSON.parse(after.receipt_json)).toMatchObject({kind:'owner_reconciliation',owner_id:'owner',evidence_ref:'manual:review-91',attempt:1});
      expect(f.db.all<{conversation_id:string}>("SELECT conversation_id FROM events WHERE type='effect.owner_reconciled'")).toEqual([{conversation_id:bot}]);
    }
  });

  it('bounds recovery effect metadata without exposing provider keys or enabling decisions before termination', () => {
    const root=claimed().run.id;
    for(let i=0;i<21;i++)unknownEffect(root);
    f.db.exec("UPDATE effects SET provider_idempotency_key='private-provider-key'");
    f.db.exec("UPDATE runs SET status='recovery_required' WHERE id=?",root);
    const before=f.db.all('SELECT * FROM effects ORDER BY id');
    const recovery=f.core.state().recovery[0];
    expect(recovery).toMatchObject({run_id:root,executor_terminated:false,can_decide_effects:false,can_recover:false,effects_truncated:true});
    expect(recovery.effects).toHaveLength(20);
    expect(JSON.stringify(recovery)).not.toContain('private-provider-key');
    expect(f.db.all('SELECT * FROM effects ORDER BY id')).toEqual(before);
  });
  it('pages old recovery tasks independently of recent runs and retained events, without crossing conversations', () => {
    const room=randomUUID();
    f.store.put(room,'room',{name:'Recovery room',member_ids:[bot],default_responder_id:bot},0,'owner',f.core.now());
    const old=Array.from({length:23},()=>f.core.enqueue(bot,'private-recovery-context',null,null,null)).sort();
    for(const id of old)f.db.exec("UPDATE runs SET status='recovery_required',context_json=json_set(context_json,'$.room_id',?) WHERE id=?",room,id);
    f.db.exec("UPDATE runs SET context_json=json_set(context_json,'$.padding',?),checkpoint_json=? WHERE id=?",
      '界'.repeat(400000),JSON.stringify({private_checkpoint:'x'.repeat(1100000)}),old[0]);
    f.setNow('2026-09-10T00:01:00.000Z');
    for(let i=0;i<137;i++)f.core.enqueue(bot,'newer task',null,null,null);
    expect(f.core.state().recovery).toEqual([]);
    const before=f.db.all('SELECT * FROM runs ORDER BY id');
    const read=vi.spyOn(f.db,'all');
    let first:ReturnType<typeof f.core.recoveryPage>;
    try{
      first=f.core.recoveryPage(bot);
      f.core.recoveryPage(room,undefined,100);
      const pages=read.mock.calls.flatMap(([sql],index)=>sql.includes("FROM runs WHERE status IN ('recovery_required','interrupted')")?[read.mock.results[index].value]:[]);
      expect(pages).toHaveLength(2);
      expect(pages.map(rows=>rows.length)).toEqual([21,23]);
      for(const rows of pages)for(const row of rows){
        expect(Object.keys(row)).not.toContain('context_json');
        expect(Object.keys(row)).not.toContain('checkpoint_json');
      }
    }finally{read.mockRestore();}
    expect(first.runs.map(run=>run.id)).toEqual(old.slice(0,20));
    expect(first.runs).toEqual(old.slice(0,20).map(id=>{
      const {context_json,checkpoint_json,...metadata}=f.store.run(id);return metadata;
    }));
    expect(first.next_cursor).toBe(old[19]);
    expect(first.recovery).toHaveLength(20);
    expect(JSON.stringify(first)).not.toContain('private-recovery-context');
    const last=f.core.recoveryPage(bot,first.next_cursor!);
    expect(last.runs.map(run=>run.id)).toEqual(old.slice(20));expect(last.next_cursor).toBeNull();
    expect(f.core.recoveryPage(room,undefined,100).runs.map(run=>run.id)).toEqual(old);
    expect(f.core.recoveryPage('22222222-2222-4222-8222-222222222222').runs).toEqual([]);
    expect(f.db.all('SELECT * FROM runs ORDER BY id')).toEqual(before);
    // Removing the cursor row cannot shift or repeat the next page.
    f.db.exec("UPDATE runs SET status='failed' WHERE id=?",old[19]);
    expect(f.core.recoveryPage(bot,first.next_cursor!).runs.map(run=>run.id)).toEqual(old.slice(20));
    for(const cursor of ['', 'private-text', "' OR 1=1--"])
      expect(()=>f.core.recoveryPage(bot,cursor)).toThrowError(expect.objectContaining({code:'INVALID_INPUT'}));
    for(const limit of [0,101,1.5,NaN])expect(()=>f.core.recoveryPage(bot,undefined,limit)).toThrow();
  });
  it.each(['settled','live-attempt','unknown-effect'])('owner recovery reads no historical bodies: %s',kind=>{
    const runId=claimed().run.id;
    if(kind==='unknown-effect')unknownEffect(runId);
    if(kind==='live-attempt')f.db.exec("UPDATE runs SET status='recovery_required' WHERE id=?",runId);
    else{
      f.db.exec("UPDATE lifecycle SET phase='RECOVERY_REQUIRED'");
      life.observeStopped({phase:'stopped',executionStopped:true,persistentState:'retained',observedAt:Date.now()});
    }
    const context=JSON.stringify({padding:'界'.repeat(400000)}),checkpoint=JSON.stringify({padding:'x'.repeat(1100000)});
    f.db.exec('UPDATE runs SET context_json=?,checkpoint_json=? WHERE id=?',context,checkpoint,runId);
    const before=f.store.run(runId),state=life.get(),read=vi.spyOn(f.db,'all');
    try{
      expect(f.accept({schema_version:1,type:'run.recover',payload:{run_id:runId,expected_attempt:1,release_resources:true}}))
        .toMatchObject(kind==='settled'?{status:'applied'}:{status:'rejected',error:{code:kind==='live-attempt'?'CANCEL_UNCONFIRMED':'OUTCOME_UNKNOWN'}});
      const reads=read.mock.calls.flatMap(([sql,id],i)=>sql.includes('FROM runs WHERE id=?')&&id===runId?[read.mock.results[i].value]:[]);
      expect(reads.length).toBeGreaterThan(0);
      for(const rows of reads)for(const row of rows){expect(row).not.toHaveProperty('context_json');expect(row).not.toHaveProperty('checkpoint_json');}
    }finally{read.mockRestore();}
    expect(f.store.run(runId)).toMatchObject({context_json:context,checkpoint_json:checkpoint,current_attempt:1});
    if(kind==='settled')expect(f.store.run(runId)).toMatchObject({status:'failed',error_code:'EXECUTOR_STOPPED'});
    else expect(f.store.run(runId)).toEqual(before);
    expect(life.get()).toEqual(state);
  });

  it('owner recovery closes stopped descendants bottom-up only after effect decisions and never retries them', () => {
    const root = claimed().run.id;
    life.submitted(identity,root,1,'recover-root');
    const native = new NativeTaskLedger(f.store,f.core,life);
    const spawn = (ref:string) => native.register(identity,{parent_run_id:root,parent_attempt:1,persona_id:bot,native_run_ref:ref,native_session_key:ref,title:ref},true).id;
    const child = spawn('recover-child'), sibling = spawn('recover-sibling');
    const resources = new ResourceLedger(f.store,()=>f.core.now());
    resources.acquire(child,1,['mail:child']); resources.acquire(sibling,1,['mail:sibling']);
    unknownEffect(child); unknownEffect(sibling);
    const recover = (id:string,key=randomUUID()) => f.accept({schema_version:1,type:'run.recover',payload:{run_id:id,expected_attempt:1,release_resources:true}},key);
    expect(recover(child).status).toBe('rejected');
    f.db.exec("UPDATE lifecycle SET phase='RECOVERY_REQUIRED'");
    life.observeStopped({phase:'stopped',executionStopped:true,persistentState:'retained',observedAt:Date.now()});
    f.core.options.executionEnabled=false;
    const recoveryState=(id:string)=>f.core.state().recovery.find(row=>row.run_id===id);
    expect(recoveryState(child)).toMatchObject({executor_terminated:true,can_decide_effects:true,can_recover:false,retained_locks:1});
    expect(recoveryState(root)).toMatchObject({descendants_unsettled:true,can_recover:false});
    expect(recover(root)).toMatchObject({status:'rejected',error:{code:'CANCEL_UNCONFIRMED'}});
    expect(recover(child)).toMatchObject({status:'rejected',error:{code:'OUTCOME_UNKNOWN'}});
    const decide = (id:string) => {
      const effect=f.db.all<{id:string;request_digest:string}>('SELECT id,request_digest FROM effects WHERE run_id=?',id)[0];
      expect(f.accept({schema_version:1,type:'effect.reconcile',payload:{run_id:id,expected_attempt:1,effect_id:effect.id,expected_request_digest:effect.request_digest,outcome:'confirmed',evidence_ref:'manual:verified-43'}}).status).toBe('applied');
    };
    decide(child);
    expect(recoveryState(child)).toMatchObject({can_recover:true,effects:[]});
    // Restored stale lock metadata must roll back even a preceding valid release.
    f.db.exec("INSERT INTO resource_locks VALUES('mail:stale',?,2,?)",child,f.core.now());
    const held=f.db.all('SELECT * FROM resource_locks ORDER BY resource_id');
    expect(recoveryState(child)).toMatchObject({can_recover:false,stale_locks:true});
    expect(recover(child)).toMatchObject({status:'rejected',error:{code:'FORBIDDEN'}});
    expect(f.db.all('SELECT * FROM resource_locks ORDER BY resource_id')).toEqual(held);
    expect(f.store.run(child).status).toBe('recovery_required');
    f.db.exec("DELETE FROM resource_locks WHERE resource_id='mail:stale'");
    const key=randomUUID(), first=recover(child,key);
    expect(first.status).toBe('applied'); expect(recover(child,key)).toEqual(first);
    expect(recoveryState(child)).toBeUndefined();
    expect(f.db.all('SELECT resource_id FROM resource_locks')).toEqual([{resource_id:'mail:sibling'}]);
    expect(recover(root).status).toBe('rejected');
    decide(sibling); expect(recover(sibling).status).toBe('applied'); expect(recover(root).status).toBe('applied');
    expect(f.db.all('SELECT status,current_attempt,error_code FROM runs')).toEqual(Array.from({length:3},()=>({status:'failed',current_attempt:1,error_code:'EXECUTOR_STOPPED'})));
    expect(f.db.all('SELECT status FROM attempts')).toEqual(Array.from({length:3},()=>({status:'terminated'})));
    expect(f.db.all('SELECT * FROM resource_locks')).toEqual([]); expect(f.db.all('SELECT * FROM retry_queue')).toEqual([]);
    expect(f.db.all('SELECT phase,boot_id FROM lifecycle')).toEqual([{phase:'STOPPED',boot_id:null}]);
  });
  it.each(['OWNER_CANCELLED','CONTEXT_INVALIDATED'])('preserves %s through direct stop and owner recovery', reason => {
    const root=claimed().run.id;
    f.db.exec("UPDATE runs SET status='cancelling',error_code=? WHERE id=?",reason,root);
    f.db.exec("UPDATE lifecycle SET phase='RECOVERY_REQUIRED'");
    life.observeStopped({phase:'stopped',executionStopped:true,persistentState:'retained',observedAt:Date.now()});
    expect(f.accept({schema_version:1,type:'run.recover',payload:{run_id:root,expected_attempt:1,release_resources:true}}).status).toBe('applied');
    expect(f.store.run(root)).toMatchObject({status:'cancelled',error_code:reason});
  });
  it('waiting requires checkpoint and terminal result is durable/idempotent', () => {
    const claim = claimed();
    expect(() => life.complete(identity, claim.run.id, 1, { status: 'waiting', text: '' })).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
    life.complete(identity, claim.run.id, 1, { status: 'completed', text: 'Synthetic result' });
    life.complete(identity, claim.run.id, 1, { status: 'completed', text: 'Synthetic result' });
    expect(() => life.complete(identity, claim.run.id, 1, { status: 'completed', text: 'Conflicting result' }))
      .toThrowError(expect.objectContaining({ code: 'RESULT_CONFLICT' }));
    f.db.exec('UPDATE attempts SET result_json=NULL WHERE run_id=?', claim.run.id);
    expect(() => life.complete(identity, claim.run.id, 1, { status: 'completed', text: 'Synthetic result' }))
      .toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
    expect(f.db.all('SELECT * FROM outbox')).toHaveLength(1);
    expect(f.db.all("SELECT * FROM events WHERE type='run.result'")).toHaveLength(1);
  });
  it('publishes a final_text bot.message once when the turn sent none, and never when one already exists', () => {
    const withTool = claimed().run.id;
    f.db.exec("INSERT INTO events(id,conversation_id,type,actor_id,cause_id,payload_json,created_at) VALUES(?,?,?,?,?,?,?)",
      randomUUID(), bot, 'bot.message', bot, withTool, JSON.stringify({ text: 'Sent by the tool', run_id: withTool, attempt: 1, task_run_id: null, origin: 'tool', reply_to_event_id: null }), f.core.now());
    f.db.exec("INSERT INTO bot_messages(message_key,run_id,attempt,event_sequence,origin,created_at) VALUES(?,?,?,?,?,?)",
      `${withTool}:1:synthetic`, withTool, 1, f.store.db.all<{ sequence: number }>("SELECT sequence FROM events WHERE type='bot.message'")[0].sequence, 'tool', f.core.now());
    life.complete(identity, withTool, 1, { status: 'completed', text: 'Final assistant text' });
    expect(f.db.all("SELECT origin FROM bot_messages WHERE run_id=?", withTool)).toEqual([{ origin: 'tool' }]);
    expect(f.db.all("SELECT * FROM events WHERE type='bot.message' AND cause_id=?", withTool)).toHaveLength(1);

    const withoutTool = claimed().run.id;
    life.complete(identity, withoutTool, 1, { status: 'completed', text: 'Only the final reply' });
    const rows = f.db.all<{ origin: string; event_sequence: number }>("SELECT origin,event_sequence FROM bot_messages WHERE run_id=?", withoutTool);
    expect(rows).toEqual([{ origin: 'final_text', event_sequence: rows[0].event_sequence }]);
    const event = f.db.all<{ payload_json: string; actor_id: string; conversation_id: string; cause_id: string }>("SELECT payload_json,actor_id,conversation_id,cause_id FROM events WHERE sequence=?", rows[0].event_sequence)[0];
    expect(JSON.parse(event.payload_json)).toEqual({ text: 'Only the final reply', run_id: withoutTool, attempt: 1, task_run_id: null, origin: 'final_text', reply_to_event_id: null });
    expect(event).toMatchObject({ actor_id: bot, conversation_id: bot, cause_id: withoutTool });
    // Replaying the identical completion receipt must not publish a second message.
    life.complete(identity, withoutTool, 1, { status: 'completed', text: 'Only the final reply' });
    expect(f.db.all("SELECT * FROM bot_messages WHERE run_id=?", withoutTool)).toHaveLength(1);

    const empty = claimed().run.id;
    life.complete(identity, empty, 1, { status: 'completed', text: '' });
    expect(f.db.all("SELECT * FROM bot_messages WHERE run_id=?", empty)).toHaveLength(0);
  });
});
describe('drain, stop and takeover races', () => {
  it('requires the full idle grace before preparing sleep', () => {
    f.setNow('2026-09-10T00:00:59.999Z');
    expect(() => life.prepareSleep(identity)).toThrowError(expect.objectContaining({ code: 'SLEEP_DENIED' }));
    f.setNow('2026-09-10T00:01:00.000Z'); expect(life.prepareSleep(identity).stop_token).toBeTruthy();
  });
  it('new admission before commit invalidates stop token and returns READY', () => {
    f.setNow('2026-09-10T00:01:00.000Z'); const prepared = life.prepareSleep(identity);
    enqueue();
    expect(life.get()).toMatchObject({ phase: 'READY', stop_token: null, desired_state: 'RUN' });
    expect(() => life.commitSleep(identity, prepared.stop_token, prepared.queue_sequence, { synthetic: true })).toThrowError(expect.objectContaining({ code: 'SLEEP_DENIED' }));
  });
  it('new admission after commit survives stop and requests the next wake', async () => {
    const provider = new FakeProvider(); provider.setPhase(ref, 'running');
    f.setNow('2026-09-10T00:01:00.000Z'); const prepared = life.prepareSleep(identity);
    life.commitSleep(identity, prepared.stop_token, prepared.queue_sequence, { synthetic: true });
    enqueue(); expect(life.get()).toMatchObject({ phase: 'STOP_COMMITTED', wake_after_stop: 1 });
    await life.drive(provider); expect(life.get().phase).toBe('STOPPING');
    expect(provider.calls.map(c => c.action)).toEqual(['stop']);
    await life.drive(provider); expect(provider.calls).toHaveLength(1);
    provider.setPhase(ref, 'stopped'); await life.drive(provider);
    expect(provider.calls.map(c => c.action)).toEqual(['stop', 'wake']);
    expect(life.get()).toMatchObject({ phase: 'BOOTING', epoch: 2, wake_after_stop: 0 });
  });
  it('does not apply a stopped observation to a replacement recovery epoch and active attempt', async () => {
    const claim = claimed(), op = operation(claim.run.id); life.submitted(identity, claim.run.id, 1, 'old-root'); life.heartbeat(identity, [op]);
    f.db.exec("UPDATE lifecycle SET phase='RECOVERY_REQUIRED',provider_operation_id='old-controller-operation'");
    const provider = new FakeProvider(); provider.setPhase(ref, 'stopped');
    const observe = provider.observe.bind(provider);
    provider.observe = async observedRef => {
      const result = await observe(observedRef), nextBoot = randomUUID();
      f.db.exec("UPDATE lifecycle SET epoch=2,boot_id=?,provider_ref_json=?,provider_operation_id='new-controller-operation'", nextBoot, JSON.stringify({ ...ref, id: 'replacement-runtime' }));
      f.db.exec('UPDATE attempts SET epoch=2,boot_id=? WHERE run_id=? AND attempt=1', nextBoot, claim.run.id);
      return result;
    };
    await life.drive(provider);
    expect(f.db.all('SELECT status,epoch FROM attempts WHERE run_id=?', claim.run.id)).toEqual([{ status: 'running', epoch: 2 }]);
    expect(f.db.all('SELECT status FROM operations WHERE id=?', op.id)).toEqual([{ status: 'active' }]);
    expect(f.store.run(claim.run.id).status).toBe('running');
    expect(provider.calls).toEqual([]);
  });
  it.each([
    ['boot_id', randomUUID()],
    ['provider_ref_json', JSON.stringify({ ...ref, id: 'replacement-runtime' })],
    ['provider_operation_id', 'replacement-controller-operation'],
  ] as const)('discards a stopped observation when same-epoch %s ownership changes', async (field, replacement) => {
    const claim = claimed(), op = operation(claim.run.id); life.submitted(identity, claim.run.id, 1, 'same-epoch-root'); life.heartbeat(identity, [op]);
    f.db.exec("UPDATE lifecycle SET phase='RECOVERY_REQUIRED',provider_operation_id='original-controller-operation'");
    const provider = new FakeProvider(); provider.setPhase(ref, 'stopped');
    const observe = provider.observe.bind(provider);
    provider.observe = async observedRef => { const result = await observe(observedRef); f.db.exec(`UPDATE lifecycle SET ${field}=?`, replacement); return result; };
    await life.drive(provider);
    expect(f.db.all('SELECT status FROM operations WHERE id=?', op.id)).toEqual([{ status: 'active' }]);
    expect(f.store.run(claim.run.id).status).toBe('running');
    expect(provider.calls).toEqual([]);
  });
  it('applies a stopped observation when captured lifecycle ownership still matches', async () => {
    const claim = claimed(), op = operation(claim.run.id); life.submitted(identity, claim.run.id, 1, 'matching-root'); life.heartbeat(identity, [op]);
    f.db.exec("UPDATE lifecycle SET phase='RECOVERY_REQUIRED',provider_operation_id='matching-controller-operation'");
    const provider = new FakeProvider(); provider.setPhase(ref, 'stopped');
    await life.drive(provider);
    expect(life.get()).toMatchObject({ phase: 'STOPPED', boot_id: null, provider_operation_id: null });
    expect(f.db.all('SELECT status FROM operations WHERE id=?', op.id)).toEqual([{ status: 'settled' }]);
    expect(f.store.run(claim.run.id).status).toBe('recovery_required');
  });
  it('provider-confirmed stop is required before clearing operation leases', () => {
    const claim = claimed(), op = operation(claim.run.id); life.heartbeat(identity, [op]);
    f.db.exec("UPDATE lifecycle SET phase='RECOVERY_REQUIRED'");
    expect(() => life.observeStopped({ phase: 'stopping', executionStopped: false, persistentState: 'retained', observedAt: Date.now() })).toThrow();
    expect(f.db.all('SELECT status FROM operations')[0]).toEqual({ status: 'active' });
    life.observeStopped({ phase: 'stopped', executionStopped: true, persistentState: 'retained', observedAt: Date.now() });
    expect(f.db.all('SELECT status FROM operations')[0]).toEqual({ status: 'settled' });
    expect(f.store.run(claim.run.id).status).toBe('recovery_required');
  });
  it('expired executor loses ownership and pending effects become unknown', () => {
    const claim = claimed(); unknownEffect(claim.run.id);
    f.db.exec("UPDATE effects SET status='dispatched'");
    f.setNow('2026-09-10T00:01:31.000Z'); life.watchdog();
    expect(life.get().phase).toBe('RECOVERY_REQUIRED');
    // V2 (ARCHITECTURE_V2 A3): the lease-loss fence now interrupts the attempt
    // directly instead of parking it as recovery_required+STALE_EPOCH.
    expect(f.store.run(claim.run.id).status).toBe('interrupted');
    expect(f.db.all('SELECT status FROM effects')[0]).toEqual({ status: 'outcome_unknown' });
  });

  it('escalates exact cancellation deadlines without returning historical snapshots to JavaScript', () => {
    const root = claimed().run, tasks = new NativeTaskLedger(f.store, f.core, life);
    const children = Array.from({ length: 3 }, () => tasks.register(identity, { parent_run_id: root.id,
      parent_attempt: 1, persona_id: bot, native_run_ref: randomUUID(), native_session_key: randomUUID(), title: 'Observed child' }));
    const runs = [root, ...children], reasons = ['OWNER_CANCELLED', 'CONTEXT_INVALIDATED', 'MEMORY_PREPARATION_LIMIT', 'OWNER_CANCELLED'];
    const context = JSON.stringify({ ...JSON.parse(root.context_json), historical: '界'.repeat(350000) });
    const checkpoint = JSON.stringify({ historical: 'x'.repeat(1048576) });
    new ResourceLedger(f.store, () => f.core.now()).acquire(root.id, 1, ['browser:held']);
    runs.forEach((run, i) => {
      f.db.exec("UPDATE runs SET status='cancelling',error_code=?,context_json=?,checkpoint_json=?,updated_at=? WHERE id=?",
        reasons[i], context, checkpoint, i === 3 ? '2026-09-10T00:00:00.001Z' : f.core.now(), run.id);
      unknownEffect(run.id);
    });
    f.db.exec("UPDATE effects SET status=CASE WHEN run_id=? THEN 'confirmed' ELSE 'dispatched' END", children[0].id);
    const attempts = f.db.all('SELECT * FROM attempts ORDER BY run_id'), links = f.db.all('SELECT * FROM native_task_links ORDER BY run_id');
    const locks = f.db.all('SELECT * FROM resource_locks');
    f.setNow('2026-09-10T00:00:30.000Z');
    const read = vi.spyOn(f.db, 'all');
    try {
      life.watchdog();
      const index = read.mock.calls.findIndex(([sql]) => sql.includes("FROM runs r WHERE r.status='cancelling'"));
      expect(index).toBeGreaterThanOrEqual(0);
      const rows = read.mock.results[index].value as Record<string, unknown>[];
      expect(rows.map(row => Object.keys(row))).toEqual([['id'], ['id'], ['id']]);
      expect(rows.map(row => row.id).sort()).toEqual(runs.slice(0, 3).map(run => run.id).sort());
    } finally { read.mockRestore(); }
    runs.forEach((run, i) => {
      expect(f.store.run(run.id)).toMatchObject({ context_json: context, checkpoint_json: checkpoint,
        status: i === 3 ? 'cancelling' : 'interrupted', error_code: i === 2 ? 'CANCEL_UNCONFIRMED' : reasons[i] });
      expect(f.db.all('SELECT status FROM effects WHERE run_id=?', run.id)).toEqual([
        { status: i === 1 ? 'confirmed' : i === 3 ? 'dispatched' : 'outcome_unknown' },
      ]);
    });
    expect(f.db.all('SELECT * FROM attempts ORDER BY run_id')).toEqual(attempts);
    expect(f.db.all('SELECT * FROM native_task_links ORDER BY run_id')).toEqual(links);
    expect(f.db.all('SELECT * FROM resource_locks')).toEqual(locks);
    expect(life.get().phase).toBe('READY');
    expect(() => life.prepareSleep(identity)).toThrowError(expect.objectContaining({ code: 'SLEEP_DENIED' }));
    f.setNow('2026-09-10T00:00:30.001Z'); life.watchdog();
    expect(f.store.run(children[2].id)).toMatchObject({ status: 'interrupted', error_code: 'OWNER_CANCELLED' });
    expect(f.db.all('SELECT status FROM effects WHERE run_id=?', children[2].id)).toEqual([{ status: 'outcome_unknown' }]);
  });
});

describe('runtime ref adoption', () => {
  it('adopts a configured runtime only while the lifecycle has never started', () => {
    const g = fixture(true);
    try {
      g.db.exec("UPDATE lifecycle SET provider_ref_json='{}',epoch=0,phase='STOPPED',boot_id=NULL,provider_operation_id=NULL");
      const core = new LifecycleCore(g.store, g.core);
      core.initialize(ref);
      expect(core.get().provider_ref_json).toBe(JSON.stringify(ref));
      core.initialize({ provider: 'fake', id: 'other-runtime' });
      expect(core.get().provider_ref_json).toBe(JSON.stringify(ref));
      g.db.exec("UPDATE lifecycle SET provider_ref_json='{}',epoch=1");
      core.initialize(ref);
      expect(core.get().provider_ref_json).toBe('{}');
    } finally { g.close(); }
  });
});
