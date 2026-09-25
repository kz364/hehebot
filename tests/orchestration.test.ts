import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ControlCore } from '../src/core/control';
import { Store } from '../src/core/store';
import { LifecycleCore, type Identity } from '../src/core/lifecycle';
import { NativeTaskLedger, type NativeChildReceipt } from '../src/core/native-tasks';
import { ResourceLedger } from '../src/core/resources';
import { EffectLedger } from '../src/core/effects';
import { ControlError } from '../src/core/errors';
import { fixture, bot, otherBot } from './helpers';

// Local metadata/lifecycle acceptance only. No native turns, latency, connectors or OAuth exercised.
let f: ReturnType<typeof fixture>, life: LifecycleCore, identity: Identity, tasks: NativeTaskLedger, resources: ResourceLedger;
beforeEach(() => {
  f = fixture(true); life = new LifecycleCore(f.store, f.core);
  f.db.exec("UPDATE lifecycle SET provider_ref_json=?,phase='BOOTING',epoch=1,lease_until='2026-09-10T00:02:00.000Z'", JSON.stringify({ provider: 'fake', id: 'orchestration-fixture' }));
  identity = life.registerBoot(randomUUID()); life.ready(identity);
  tasks = new NativeTaskLedger(f.store, f.core, life);
  resources = new ResourceLedger(f.store, () => f.core.now());
});
afterEach(() => f.close());
function message(text = 'Synthetic independent task', persona = bot) {
  return f.accept({ schema_version: 1, type: 'message.send', payload: { conversation_id: persona, text } }).resource_id!;
}
function parent() { const id = message(); expect(life.claim(identity)?.run.id).toBe(id); return id; }
function receipt(parentId: string, title = 'Task A'): NativeChildReceipt {
  return { parent_run_id: parentId, parent_attempt: 1, persona_id: bot, native_run_ref: randomUUID(), native_session_key: `agent:test:subagent:${randomUUID()}`, title };
}
function finish(id: string) { life.complete(identity, id, 1, { status: 'completed', text: 'Synthetic settled result' }); }

describe('O01–O08 local orchestration metadata boundaries', () => {
  it.each([false, true])('returns metadata without hydrating child snapshots on new/replayed observations (started=%s)', started => {
    const p = parent(), input = receipt(p);
    f.db.exec("UPDATE runs SET context_json=json_set(context_json,'$.padding',?),checkpoint_json=? WHERE id=?", '界'.repeat(400000), JSON.stringify({padding:'p'.repeat(1100000)}), p);
    const parentBefore=f.store.run(p);
    const read = vi.spyOn(f.db, 'all');
    try {
      const child = tasks.register(identity, input, started);
      expect(child).not.toHaveProperty('context_json');
      expect(child).not.toHaveProperty('checkpoint_json');
      expect(child).toMatchObject({parent_run_id:p,persona_id:bot,role:'background',current_attempt:1,status:'cancelling',error_code:'CONTEXT_PREPARATION_LIMIT'});
      const childReads = read.mock.calls.flatMap(([sql,id],i) => sql.includes('FROM runs WHERE id=?') && id === child.id ? [read.mock.results[i].value] : []);
      expect(childReads.length).toBeGreaterThan(0);
      for (const rows of childReads) for (const row of rows) {
        expect(row).not.toHaveProperty('context_json');
        expect(row).not.toHaveProperty('checkpoint_json');
      }
      const parentReads=read.mock.calls.flatMap(([sql,id],i)=>sql.includes('FROM runs WHERE id=?')&&id===p?[read.mock.results[i].value]:[]);
      expect(parentReads.length).toBeGreaterThan(0);
      for(const rows of parentReads)for(const row of rows)expect(row).not.toHaveProperty('checkpoint_json');
      read.mockClear();
      f.db.exec('UPDATE runs SET checkpoint_json=? WHERE id=?', JSON.stringify({padding:'x'.repeat(1100000)}), child.id);
      const retained = f.store.run(child.id); read.mockClear();
      expect(tasks.register(identity, input, started)).toEqual(child);
      for (let i=0;i<read.mock.calls.length;i++) {
        const [sql]=read.mock.calls[i];
        if (sql.includes('FROM runs WHERE id=?')) for (const row of read.mock.results[i].value) {
          expect(row).not.toHaveProperty('context_json');
          expect(row).not.toHaveProperty('checkpoint_json');
        }
      }
      expect(f.store.run(child.id)).toEqual(retained);
      expect(f.store.run(p)).toEqual(parentBefore);
    } finally { read.mockRestore(); }
  });

  it.each([1048576,1048577])('bounds native clone preparation at %s raw UTF-8 bytes while retaining observed custody', bytes => {
    const p=parent(),input=receipt(p,'Bounded child'),snapshot={...JSON.parse(f.store.run(p).context_json),padding:'界'.repeat(340000)};
    const base=JSON.stringify(snapshot),source=base+' '.repeat(bytes-Buffer.byteLength(base));
    expect(Buffer.byteLength(source)).toBe(bytes);expect(source.length).toBeLessThan(1048576);
    f.db.exec('UPDATE runs SET context_json=? WHERE id=?',source,p);
    const before=f.store.run(p),read=vi.spyOn(f.db,'all');
    let child:ReturnType<typeof tasks.register>;
    try{
      child=tasks.register(identity,input,true);
      const reads=read.mock.calls.flatMap(([sql,id],i)=>sql.includes('FROM runs WHERE id=?')&&id===p?read.mock.results[i].value:[]);
      expect(reads.filter(row=>row&&typeof row==='object'&&'context_json' in row)).toEqual([{context_json:bytes===1048576?source:null}]);
    }finally{read.mockRestore();}
    expect(f.store.run(p)).toEqual(before);
    expect(f.db.all('SELECT parent_run_id,parent_attempt,native_run_ref,native_session_key FROM native_task_links WHERE run_id=?',child!.id))
      .toEqual([{parent_run_id:p,parent_attempt:1,native_run_ref:input.native_run_ref,native_session_key:input.native_session_key}]);
    if(bytes===1048576){
      expect(child!).toMatchObject({status:'running',error_code:null});
      expect(f.store.run(child!.id).context_json).toBe(JSON.stringify({...snapshot,instruction:input.title}));
    }else{
      expect(child!).toMatchObject({status:'cancelling',error_code:'CONTEXT_PREPARATION_LIMIT'});
      expect(JSON.parse(f.store.run(child!.id).context_json)).toEqual({schema_version:1,native_child_context_unavailable:'CONTEXT_PREPARATION_LIMIT',
        instruction:input.title,persona:{id:null},routine:null,room_id:null,scope_key:null,memories:[],skills:[],context_events:[],authorization_policy_ids:[]});
      expect(f.db.all('SELECT status,settled_at FROM attempts WHERE run_id=?',child!.id)).toEqual([{status:'claimed',settled_at:null}]);
      expect(life.heartbeat(identity,[]).cancellations).toContain(child!.id);
      expect(f.core.taskPage(bot).runs.some(row=>row.id===child!.id)).toBe(true);
    }
    expect(tasks.register(identity,input,true)).toEqual(child!);
    expect(()=>tasks.register(identity,{...input,native_session_key:'conflicting'})).toThrowError(expect.objectContaining({code:'IDEMPOTENCY_CONFLICT'}));
  });

  it('retains non-authorizing overflow ancestry after terminal results clear cancellation errors',()=>{
    const p=parent(),room=randomUUID(),input=receipt(p);
    const source=`{"room_id":null,"room_id":"${room}","scope_key":"${bot}/personal","scope_key":"${bot}/room/${room}","padding":"${'界'.repeat(400000)}"}`;
    f.db.exec('UPDATE runs SET context_json=? WHERE id=?',source,p);
    const child=tasks.register(identity,input,true);
    expect(f.core.context(bot,'Independent request',null,null).task_summaries?.some(row=>row.id===child.id)).toBe(false);
    expect(f.db.all("SELECT id FROM runs WHERE role='background' AND json_extract(context_json,'$.room_id')=?",room)).toEqual([]);
    expect(()=>resources.acquire(child.id,1,['overflow-resource'])).toThrowError(expect.objectContaining({code:'REVISION_CONFLICT'}));
    expect(()=>new EffectLedger(f.store,()=>f.core.now()).intent({id:randomUUID(),run_id:child.id,attempt:1,action_key:randomUUID(),classification:'read_only',authorization_ref:'',request_digest:'test',provider_idempotency_key:null}))
      .toThrowError(expect.objectContaining({code:'REVISION_CONFLICT'}));
    finish(child.id);expect(f.store.run(child.id)).toMatchObject({status:'completed',error_code:null});
    const nested=tasks.register(identity,receipt(child.id,'Late observation'),true);
    expect(nested).toMatchObject({status:'cancelling',error_code:'CONTEXT_PREPARATION_LIMIT',parent_run_id:child.id});
    expect(JSON.parse(f.store.run(nested.id).context_json).native_child_context_unavailable).toBe('CONTEXT_PREPARATION_LIMIT');
    finish(p);expect(()=>life.prepareSleep(identity)).toThrowError(expect.objectContaining({code:'SLEEP_DENIED'}));
    f.setNow('2026-09-10T00:00:31.000Z');life.watchdog();
    expect(f.store.run(nested.id)).toMatchObject({status:'recovery_required',error_code:'CANCEL_UNCONFIRMED'});
    expect(()=>life.prepareSleep(identity)).toThrowError(expect.objectContaining({code:'SLEEP_DENIED'}));
    life.complete(identity,nested.id,1,{status:'cancelled',text:''});
    expect(f.store.run(p).context_json).toBe(source);
  });

  it.each(['OWNER_CANCELLED','DEADLINE_EXCEEDED'])('keeps %s ahead of historical context overflow',reason=>{
    const p=parent();f.db.exec('UPDATE runs SET context_json=? WHERE id=?',JSON.stringify({padding:'界'.repeat(400000)}),p);
    if(reason==='OWNER_CANCELLED')f.accept({schema_version:1,type:'run.cancel',payload:{run_id:p,reason:'Stop'}});
    else f.db.exec('UPDATE attempts SET deadline_at=? WHERE run_id=?',f.core.now(),p);
    expect(tasks.register(identity,receipt(p),true)).toMatchObject({status:'cancelling',error_code:reason});
  });

  it('retains authorized cross-persona overflow custody without preparing replacement authority',()=>{
    const p=parent();f.core.options.delegations={[bot]:[otherBot]};
    const source=JSON.stringify({padding:'界'.repeat(400000)});
    f.db.exec('UPDATE runs SET context_json=? WHERE id=?',source,p);
    const prepare=vi.spyOn(f.core,'context');
    try{
      const child=tasks.register(identity,{...receipt(p),persona_id:otherBot},true);
      expect(child).toMatchObject({persona_id:otherBot,parent_run_id:p,status:'cancelling',error_code:'CONTEXT_PREPARATION_LIMIT'});
      expect(prepare).not.toHaveBeenCalled();
      expect(f.core.taskPage(otherBot).runs.some(row=>row.id===child.id)).toBe(true);
      expect(f.store.run(p).context_json).toBe(source);
    }finally{prepare.mockRestore();}
  });

  it.each([null, 'historical-room'])('normalizes historical duplicate keys before freezing native child authority: last room=%s', room => {
    const p=parent(), original=JSON.parse(f.store.run(p).context_json);
    const input=receipt(p,'Child "instruction"\n\ud800');
    const source=JSON.stringify(original).slice(0,-1)+',"instruction":"first","instruction":"last",'+
      '"room_id":"earlier-room","room_id":'+JSON.stringify(room)+','+
      '"scope_key":"earlier-scope","scope_key":"frozen-scope",'+
      '"authorization_policy_ids":["earlier-grant"],"authorization_policy_ids":["frozen-grant"],'+
      '"unknown":{"nested":{"grant":"first","grant":"last"},"number":1e400}}';
    f.db.exec('UPDATE runs SET context_json=? WHERE id=?',source,p);
    const child=tasks.register(identity,input,true);
    const stored=f.store.run(child.id);
    expect(JSON.parse(stored.context_json)).toEqual({...original,instruction:input.title,room_id:room,
      scope_key:'frozen-scope',authorization_policy_ids:['frozen-grant'],unknown:{nested:{grant:'last'},number:null}});
    expect(f.db.all("SELECT json_extract(context_json,'$.room_id') AS room,json_extract(context_json,'$.scope_key') AS scope,json_extract(context_json,'$.authorization_policy_ids[0]') AS grant_id FROM runs WHERE id=?",child.id))
      .toEqual([{room,scope:'frozen-scope',grant_id:'frozen-grant'}]);
    expect(f.store.run(p).context_json).toBe(source);
    expect(tasks.register(identity,input,true)).toEqual(child);
    expect(f.store.run(child.id)).toEqual(stored);
  });

  it.each([
    ['NUL-suffixed root key','{"instruction\\u0000suffix":"keep","instruction":"old"}',
      '{"instruction\\u0000suffix":"keep","instruction":"new"}'],
    ['nested key order and string escape','{"instruction":"old","extra":{"2":0,"1":0},"label":"\\u0061"}',
      '{"instruction":"new","extra":{"1":0,"2":0},"label":"a"}'],
  ])('preserves exact JS child representation for %s',(_label,source,expected)=>{
    const p=parent(),input=receipt(p,'new');
    f.db.exec('UPDATE runs SET context_json=? WHERE id=?',source,p);
    const child=tasks.register(identity,input),stored=f.store.run(child.id);
    expect(stored.context_json).toBe(expected);
    expect(f.store.run(p).context_json).toBe(source);
    expect(tasks.register(identity,input)).toEqual(child);
    expect(f.store.run(child.id)).toEqual(stored);
    // Even a stringify fixed point can alias $.instruction in SQLite; merely
    // excluding duplicates/unsafe numbers is not a normalization invariant.
    const sqlCopy=f.db.all<{copy:string}>("SELECT json_set(?,'$.instruction',json(?)) AS copy",source,JSON.stringify(input.title))[0].copy;
    expect(sqlCopy).not.toBe(expected);
  });

  it('records observed children idempotently and frees coordinator admission while a child remains active', () => {
    const p = parent(), input = receipt(p), child = tasks.register(identity, input);
    expect(child).toMatchObject({ role: 'background', parent_run_id: p, status: 'claimed', current_attempt: 1 });
    expect(f.db.all('SELECT native_run_ref,epoch,boot_id FROM attempts WHERE run_id=?', child.id)).toEqual([{ native_run_ref: input.native_run_ref, epoch: identity.epoch, boot_id: identity.boot_id }]);
    expect(tasks.register(identity, input).id).toBe(child.id);
    const next = message('What is the status?'); expect(life.claim(identity)).toBeNull();
    finish(p);
    expect(life.claim(identity)?.run.id).toBe(next);
    const {context_json,checkpoint_json,...metadata}=f.store.run(child.id);
    expect(metadata).toEqual(child);
    expect(JSON.parse(context_json).instruction).toBe(input.title);
    expect(checkpoint_json).toBeNull();
    expect(f.db.all('SELECT * FROM native_task_links')).toHaveLength(1);
  });

  it('preserves two child inputs and identities when an ambiguous ordinary message arrives', () => {
    const p = parent(), a = tasks.register(identity, receipt(p)), b = tasks.register(identity, receipt(p, 'Task B'));
    const beforeA=f.store.run(a.id),beforeB=f.store.run(b.id);
    const links = f.db.all('SELECT * FROM native_task_links ORDER BY run_id');
    finish(p);
    const request = message('Change the time');
    const coordinator = life.claim(identity)!.run;
    expect(coordinator.id).toBe(request); expect(coordinator.role).toBe('coordinator');
    expect(f.store.run(a.id)).toEqual(beforeA); expect(f.store.run(b.id)).toEqual(beforeB);
    expect(f.db.all('SELECT * FROM native_task_links ORDER BY run_id')).toEqual(links);
    expect(f.db.all('SELECT * FROM task_followups')).toHaveLength(0);
    // Whether a native model asks for clarification remains a live gate.
  });

  it('keeps targeted followup pending until settlement and emits one separate coordinator continuation', () => {
    const p = parent(), a = tasks.register(identity, receipt(p)), b = tasks.register(identity, receipt(p, 'Task B'));
    const beforeA=f.store.run(a.id),beforeB=f.store.run(b.id);
    finish(p);
    const accepted = f.accept({ schema_version: 1, type: 'run.followup', payload: { run_id: a.id, text: 'Move this appointment to 10:00' } });
    expect(accepted.status).toBe('applied'); f.core.flushFollowups(a.id);
    expect(f.db.all('SELECT status FROM task_followups')).toEqual([{ status: 'pending' }]);
    expect(life.claim(identity)).toBeNull(); expect(f.store.run(a.id)).toEqual(beforeA);
    finish(a.id); f.core.flushFollowups(a.id);
    const rows = f.db.all<{ status: string; coordinator_run_id: string }>('SELECT status,coordinator_run_id FROM task_followups');
    expect(rows).toHaveLength(1); expect(rows[0].status).toBe('coordinator_queued');
    const next = life.claim(identity)!.run;
    expect(next.id).toBe(rows[0].coordinator_run_id); expect(next.role).toBe('coordinator');
    expect(JSON.parse(next.context_json).instruction).toContain(a.id);
    expect(JSON.parse(next.context_json).instruction).toContain('Move this appointment to 10:00');
    expect(f.store.run(b.id)).toEqual(beforeB);
  });

  it.each([false,true])('terminal owner cancellation releases a waiting-task followup only after descendants settle: nested=%s', nested => {
    const p=parent(),a=tasks.register(identity,receipt(p)),b=tasks.register(identity,receipt(p,'Unrelated sibling'));
    const beforeB=f.store.run(b.id);
    const grandchild=nested?tasks.register(identity,receipt(a.id,'Nested work')):null;
    finish(p);
    life.complete(identity,a.id,1,{status:'waiting',text:'Checkpointed fixture',checkpoint:{fixture:'restartable'}});
    const followup=f.accept({schema_version:1,type:'run.followup',payload:{run_id:a.id,text:'Review this cancelled task only'}});
    expect(followup.status).toBe('applied');
    expect(f.db.all('SELECT status FROM task_followups')).toEqual([{status:'pending'}]);
    const key=randomUUID(),command={schema_version:1 as const,type:'run.cancel' as const,payload:{run_id:a.id,reason:'Stop checkpointed task'}};
    const accepted=f.accept(command,key);expect(accepted.status).toBe('applied');
    expect(f.store.run(a.id).status).toBe('cancelled');
    if(grandchild){
      expect(f.db.all('SELECT status FROM task_followups')).toEqual([{status:'pending'}]);
      expect(life.claim(identity)).toBeNull();
      finish(grandchild.id);
    }
    const queued=f.db.all<{status:string;coordinator_run_id:string}>('SELECT status,coordinator_run_id FROM task_followups WHERE id=?',followup.resource_id!)[0];
    expect(queued.status).toBe('coordinator_queued');
    const continuation=life.claim(identity)!.run;
    expect(continuation.id).toBe(queued.coordinator_run_id);
    expect(JSON.parse(continuation.context_json).instruction).toContain(a.id);
    expect(JSON.parse(continuation.context_json).instruction).toContain('Review this cancelled task only');
    expect(f.accept(command,key)).toEqual(accepted);
    f.core.flushFollowups(a.id);
    expect(f.db.all('SELECT id FROM runs WHERE command_id=?',followup.id)).toHaveLength(1);
    expect(f.store.run(b.id)).toEqual(beforeB);
    expect(f.db.all('SELECT status FROM attempts WHERE run_id=?',a.id)).toEqual([{status:'waiting'}]);
  });

  it('defers a task followup through its live grandchild, then queues it once without waiting for an unrelated sibling', () => {
    const p=parent(),a=tasks.register(identity,receipt(p)),b=tasks.register(identity,receipt(p,'Unrelated sibling'));
    const beforeB=f.store.run(b.id);
    const grandchild=tasks.register(identity,receipt(a.id,'Nested work'));
    const accepted=f.accept({schema_version:1,type:'run.followup',payload:{run_id:a.id,text:'Use the reconciled result from A only'}});
    finish(p);finish(a.id);
    expect(f.db.all('SELECT status FROM task_followups')).toEqual([{status:'pending'}]);
    expect(f.db.all('SELECT id FROM runs')).toHaveLength(4);
    finish(grandchild.id);
    f.core.flushFollowups(grandchild.id);
    const queued=f.db.all<{coordinator_run_id:string}>('SELECT coordinator_run_id FROM task_followups WHERE id=?',accepted.resource_id!)[0];
    expect(queued.coordinator_run_id).toBeTruthy();
    expect(JSON.parse(f.store.run(queued.coordinator_run_id).context_json).instruction).toContain(a.id);
    expect(f.db.all('SELECT id FROM runs')).toHaveLength(5);
    expect(f.store.run(b.id)).toEqual(beforeB);
  });
  it('cancels only B while A and its currently claimed coordinator remain unchanged', () => {
    const p = parent(), a = tasks.register(identity, receipt(p)), b = tasks.register(identity, receipt(p, 'Task B'));
    const beforeA=f.store.run(a.id);
    const beforeParent = f.store.run(p);
    expect(f.accept({ schema_version: 1, type: 'run.cancel', payload: { run_id: b.id, reason: 'Owner selected B' } }).status).toBe('applied');
    expect(f.store.run(b.id).status).toBe('cancelling');
    expect(f.store.run(a.id)).toEqual(beforeA); expect(f.store.run(p)).toEqual(beforeParent);
    expect(life.heartbeat(identity, []).cancellations).toEqual([b.id]);
  });

  it('keeps task A and coordinator alive when task B ignores cancellation', () => {
    const p = parent(), a = tasks.register(identity, receipt(p)), b = tasks.register(identity, receipt(p, 'Task B'));
    const beforeA=f.store.run(a.id);
    resources.acquire(b.id, 1, ['browser:tab:b']);
    f.accept({schema_version:1,type:'run.cancel',payload:{run_id:b.id,reason:'Stop B'}});
    f.setNow('2026-09-10T00:00:31.000Z');life.watchdog();
    expect(life.get().phase).toBe('READY');expect(f.store.run(a.id)).toEqual(beforeA);
    expect(f.store.run(b.id).status).toBe('recovery_required');
    expect(life.heartbeat(identity,[]).cancellations).toContain(b.id);
    expect(f.accept({schema_version:1,type:'run.retry',payload:{run_id:b.id,expected_attempt:1}}).error?.code).toBe('CANCEL_UNCONFIRMED');
    resources.release(b.id,1,['browser:tab:b']);life.complete(identity,b.id,1,{status:'cancelled',text:''});
    expect(f.store.run(a.id)).toEqual(beforeA);expect(f.store.run(p).status).toBe('claimed');
  });

  it('rolls back a contended resource set and admits unrelated chat without releasing the owner lock', () => {
    const p = parent(), a = tasks.register(identity, receipt(p)), b = tasks.register(identity, receipt(p, 'Task B'));
    resources.acquire(a.id, 1, ['calendar:shared:event:z']);
    expect(() => resources.acquire(b.id, 1, ['browser:tab:a', 'calendar:shared:event:z'])).toThrowError(expect.objectContaining({ code: 'RESOURCE_BUSY' }));
    expect(f.db.all('SELECT resource_id,run_id FROM resource_locks')).toEqual([{ resource_id: 'calendar:shared:event:z', run_id: a.id }]);
    expect(() => resources.release(b.id, 1, ['calendar:shared:event:z'])).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
    finish(p); const question = message('Unrelated question', otherBot);
    expect(life.claim(identity)?.run.id).toBe(question);
    expect(() => finish(a.id)).toThrowError(expect.objectContaining({ code: 'RESOURCE_BUSY' }));
    resources.release(a.id, 1, ['calendar:shared:event:z']); finish(a.id);
  });

  it('reconstructs task and pending-followup metadata through fresh service objects over the same database', () => {
    const p = parent(), input = receipt(p), child = tasks.register(identity, input);
    const beforeChild=f.store.run(child.id);
    f.accept({ schema_version: 1, type: 'run.followup', payload: { run_id: child.id, text: 'Use the second date' } });
    const store = new Store(f.db), core = new ControlCore(store, f.core.options), restartedLife = new LifecycleCore(store, core);
    expect(new NativeTaskLedger(store, core, restartedLife).register(identity, input).id).toBe(child.id);
    expect(store.run(child.id)).toEqual(beforeChild);
    restartedLife.complete(identity, child.id, 1, { status: 'completed', text: 'Recovered result' });
    expect(f.db.all("SELECT * FROM task_followups WHERE status='coordinator_queued'")).toHaveLength(1);
    expect(f.db.all('SELECT * FROM native_task_links')).toHaveLength(1);
    // Database reopening/provider cold-wake and native receipt recovery are separate live tests.
  });

  it('holds the runtime awake after coordinator completion until its background child settles', () => {
    const p = parent(), child = tasks.register(identity, receipt(p)); finish(p);
    f.setNow('2026-09-10T00:01:00.000Z');
    expect(() => life.prepareSleep(identity)).toThrowError(expect.objectContaining({ code: 'SLEEP_DENIED' }));
    finish(child.id); life.heartbeat(identity, []);
    f.setNow('2026-09-10T00:02:00.000Z');
    expect(life.prepareSleep(identity).stop_token).toBeTruthy();
  });

  it('rejects reused native identity and unapproved cross-persona receipts without extra rows', () => {
    const p = parent(), input = receipt(p); tasks.register(identity, input);
    expect(() => tasks.register(identity, { ...input, native_session_key: 'different' })).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
    expect(() => tasks.register(identity, { ...receipt(p), persona_id: otherBot })).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(f.db.all('SELECT * FROM native_task_links')).toHaveLength(1);
  });

  it('keeps all target constraints and starts a delegated child at the record limit', () => {
    const p = parent(); f.core.options.delegations = { [bot]: [otherBot] };
    const ids = Array.from({ length: 64 }, () => randomUUID());
    for (const id of ids) f.store.put(id, 'memory', { scope: { kind: 'persona', id: otherBot },
      text: `Constraint ${id}: do not send.`, explicit_constraint: true, expires_at: null }, 0, 'owner', f.core.now());
    const child = tasks.register(identity, { ...receipt(p), persona_id: otherBot }, true);
    expect(child).toMatchObject({ status: 'running', error_code: null });
    const memories = JSON.parse(f.store.run(child.id).context_json).memories;
    expect(memories.map((m: { id: string }) => m.id).sort()).toEqual(ids.sort());
    expect(memories.every((m: { body: { explicit_constraint: boolean; text: string } }) => m.body.explicit_constraint && m.body.text.endsWith('do not send.'))).toBe(true);
    expect(life.heartbeat(identity, []).cancellations).not.toContain(child.id);
  });

  it('retains exact legacy refusal provenance before completion clears the last error',()=>{
    const p=parent();f.core.options.delegations={[bot]:[otherBot]};
    const child=tasks.register(identity,{...receipt(p),persona_id:otherBot},true);
    const original=f.store.run(child.id).context_json;
    resources.acquire(child.id,1,['legacy-refusal-resource']);
    f.db.exec("UPDATE runs SET status='cancelling',error_code='MEMORY_PREPARATION_LIMIT' WHERE id=?",child.id);
    expect(()=>finish(child.id)).toThrowError(expect.objectContaining({code:'RESOURCE_BUSY'}));
    expect(f.db.all('SELECT key FROM runtime_metadata WHERE key=?',`native_context_unavailable:${child.id}:1`)).toEqual([]);
    resources.release(child.id,1,['legacy-refusal-resource']);
    finish(child.id);
    expect(f.store.run(child.id)).toMatchObject({status:'completed',error_code:null,context_json:original});
    expect(f.db.all('SELECT value_json FROM runtime_metadata WHERE key=?',`native_context_unavailable:${child.id}:1`))
      .toEqual([{value_json:JSON.stringify('MEMORY_PREPARATION_LIMIT')}]);
    finish(child.id); // Exact replay keeps the result receipt unchanged.
    const nested=tasks.register(identity,{...receipt(child.id),persona_id:otherBot},true);
    expect(nested).toMatchObject({status:'cancelling',error_code:'MEMORY_PREPARATION_LIMIT'});
    expect(JSON.parse(f.store.run(nested.id).context_json).persona.id).toBeNull();
    const other=tasks.register(identity,{...receipt(p),persona_id:otherBot},true);
    f.db.exec('INSERT INTO runtime_metadata(key,value_json) VALUES(?,?)',`native_context_unavailable:${other.id}:2`,JSON.stringify('MEMORY_PREPARATION_LIMIT'));
    finish(other.id);
    expect(tasks.register(identity,{...receipt(other.id),persona_id:otherBot},true).status).toBe('running');
  });

  it.each(['cancelling','recovery_required'])('preserves known legacy memory refusal through descendant settlement (%s)',status=>{
    const p=parent();f.core.options.delegations={[bot]:[otherBot]};
    const child=tasks.register(identity,{...receipt(p),persona_id:otherBot},true);
    // Old versions retained a complete-looking snapshot with memory omitted.
    // Only the surviving refusal is evidence; an empty memory array is not.
    f.db.exec('UPDATE runs SET status=?,error_code=? WHERE id=?',status,'MEMORY_PREPARATION_LIMIT',child.id);
    const historical=f.store.run(child.id);
    const nested=tasks.register(identity,{...receipt(child.id),persona_id:otherBot},true);
    expect(nested).toMatchObject({status:'cancelling',error_code:'MEMORY_PREPARATION_LIMIT'});
    expect(JSON.parse(f.store.run(nested.id).context_json)).toMatchObject({
      native_child_context_unavailable:'MEMORY_PREPARATION_LIMIT',persona:{id:null},memories:[],skills:[],authorization_policy_ids:[]});
    expect(f.store.run(child.id)).toEqual(historical);
    finish(nested.id);
    const late=tasks.register(identity,{...receipt(nested.id),persona_id:otherBot},true);
    expect(late).toMatchObject({status:'cancelling',error_code:'MEMORY_PREPARATION_LIMIT'});
    expect(life.heartbeat(identity,[]).cancellations).toContain(late.id);
  });

  it('keeps late descendants non-authorizing after delegated memory overflow settles',()=>{
    const p=parent();f.core.options.delegations={[bot]:[otherBot]};
    const memory=randomUUID();
    f.store.put(memory,'memory',{scope:{kind:'persona',id:otherBot},text:'界'.repeat(50000),explicit_constraint:true,expires_at:null},0,'owner',f.core.now());
    const input={...receipt(p),persona_id:otherBot},child=tasks.register(identity,input,true);
    expect(child).toMatchObject({status:'cancelling',error_code:'MEMORY_PREPARATION_LIMIT'});
    finish(child.id);expect(f.store.run(child.id)).toMatchObject({status:'completed',error_code:null});
    const settled=f.store.run(child.id);
    const nested=tasks.register(identity,{...receipt(child.id,'Late delegated descendant'),persona_id:otherBot},true);
    expect(nested).toMatchObject({status:'cancelling',error_code:'MEMORY_PREPARATION_LIMIT'});
    for(const id of [child.id,nested.id])expect(JSON.parse(f.store.run(id).context_json)).toMatchObject({
      native_child_context_unavailable:'MEMORY_PREPARATION_LIMIT',persona:{id:null},scope_key:null,authorization_policy_ids:[],memories:[]});
    expect(f.store.run(child.id)).toEqual(settled);
    expect(f.store.get(memory,'memory').body.text).toBe('界'.repeat(50000));
    expect(life.heartbeat(identity,[]).cancellations).toContain(nested.id);
    expect(()=>resources.acquire(nested.id,1,['late-memory-resource'])).toThrowError(expect.objectContaining({code:'REVISION_CONFLICT'}));
  });

  it.each(['record-count', 'legacy-body'])('retains observed delegated custody when memory preparation exceeds %s', kind => {
    const p = parent(), originalParent = f.store.run(p);
    f.core.options.delegations = { [bot]: [otherBot] };
    for (let i = 0; i < (kind === 'record-count' ? 65 : 1); i++) {
      f.store.put(randomUUID(), 'memory', { scope: { kind: 'persona', id: otherBot },
        text: kind === 'legacy-body' ? '界'.repeat(50000) : `Constraint ${i}: never send without approval.`,
        explicit_constraint: true, expires_at: null }, 0, 'owner', f.core.now());
    }
    const sources = f.db.all("SELECT * FROM objects WHERE kind='memory' ORDER BY id");
    const input = { ...receipt(p), persona_id: otherBot };
    const child = tasks.register(identity, input, true);
    expect(child).toMatchObject({ parent_run_id: p, persona_id: otherBot, status: 'cancelling', error_code: 'MEMORY_PREPARATION_LIMIT', current_attempt: 1 });
    expect(JSON.parse(f.store.run(child.id).context_json)).toMatchObject({ native_child_context_unavailable: 'MEMORY_PREPARATION_LIMIT', persona: { id: null }, memories: [], instruction: input.title });
    expect(f.db.all('SELECT parent_run_id,parent_attempt,native_run_ref,native_session_key FROM native_task_links WHERE run_id=?', child.id))
      .toEqual([{ parent_run_id: p, parent_attempt: 1, native_run_ref: input.native_run_ref, native_session_key: input.native_session_key }]);
    expect(f.db.all('SELECT status,settled_at,native_run_ref,epoch,boot_id FROM attempts WHERE run_id=?', child.id))
      .toEqual([{ status: 'claimed', settled_at: null, native_run_ref: input.native_run_ref, epoch: identity.epoch, boot_id: identity.boot_id }]);
    expect(f.store.run(p)).toEqual(originalParent);
    expect(f.db.all("SELECT * FROM objects WHERE kind='memory' ORDER BY id")).toEqual(sources);
    expect(life.heartbeat(identity, []).cancellations).toContain(child.id);
    expect(() => new EffectLedger(f.store, () => f.core.now()).intent({ id: randomUUID(), run_id: child.id, attempt: 1,
      action_key: randomUUID(), classification: 'read_only', authorization_ref: '', request_digest: 'test', provider_idempotency_key: null }))
      .toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
    // Lost acknowledgements and removal of the overflow never restart inference.
    f.db.exec("UPDATE objects SET deleted_at=? WHERE kind='memory'", f.core.now());
    expect(tasks.register(identity, input, true)).toEqual(child);
    const nested = tasks.register(identity, { ...receipt(child.id), persona_id: otherBot }, true);
    expect(nested).toMatchObject({ status: 'cancelling', error_code: 'MEMORY_PREPARATION_LIMIT', parent_run_id: child.id });
    finish(p);
    expect(() => life.prepareSleep(identity)).toThrowError(expect.objectContaining({ code: 'SLEEP_DENIED' }));
    f.setNow('2026-09-10T00:00:31.000Z'); life.watchdog();
    expect(f.store.run(child.id)).toMatchObject({ status: 'recovery_required', error_code: 'CANCEL_UNCONFIRMED' });
    expect(f.accept({ schema_version: 1, type: 'run.retry', payload: { run_id: child.id, expected_attempt: 1 } }).error?.code).toBe('CANCEL_UNCONFIRMED');
    expect(() => life.prepareSleep(identity)).toThrowError(expect.objectContaining({ code: 'SLEEP_DENIED' }));
    expect(f.db.all('SELECT status,settled_at FROM attempts WHERE run_id=?', child.id)).toEqual([{ status: 'claimed', settled_at: null }]);
    life.complete(identity, child.id, 1, { status: 'cancelled', text: '' });
    expect(() => life.prepareSleep(identity)).toThrowError(expect.objectContaining({ code: 'SLEEP_DENIED' }));
    life.complete(identity, nested.id, 1, { status: 'cancelled', text: '' });
    life.heartbeat(identity, []); f.setNow('2026-09-10T00:02:00.000Z');
    expect(life.prepareSleep(identity).stop_token).toBeTruthy();
  });

  it.each(['OWNER_CANCELLED', 'DEADLINE_EXCEEDED'])('keeps %s ahead of a delegated memory limit', reason => {
    const p = parent(); f.core.options.delegations = { [bot]: [otherBot] };
    f.store.put(randomUUID(), 'memory', { scope: { kind: 'persona', id: otherBot }, text: 'x'.repeat(140000), expires_at: null }, 0, 'owner', f.core.now());
    if (reason === 'OWNER_CANCELLED') f.accept({ schema_version: 1, type: 'run.cancel', payload: { run_id: p, reason: 'Stop' } });
    else f.db.exec('UPDATE attempts SET deadline_at=? WHERE run_id=?', f.core.now(), p);
    expect(tasks.register(identity, { ...receipt(p), persona_id: otherBot }, true)).toMatchObject({ status: 'cancelling', error_code: reason });
  });

  it('does not turn an authorization failure into a delegated cancellation receipt', () => {
    const p = parent(); f.core.options.delegations = { [bot]: [otherBot] };
    const context = vi.spyOn(f.core, 'context').mockImplementation(() => { throw new ControlError('FORBIDDEN', 'Target context is not authorized.'); });
    try {
      expect(() => tasks.register(identity, { ...receipt(p), persona_id: otherBot }, true)).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
      expect(f.db.all('SELECT * FROM native_task_links')).toHaveLength(0);
      expect(f.db.all('SELECT id FROM runs')).toEqual([{ id: p }]);
    } finally { context.mockRestore(); }
  });

  it('registers same-task descendants under background parents without widening persona authority', () => {
    const p = parent(), child = tasks.register(identity, receipt(p));
    const input = receipt(child.id, 'Nested native work');
    const grandchild = tasks.register(identity, input);
    expect(grandchild).toMatchObject({ parent_run_id: child.id, persona_id: bot, role: 'background', status: 'claimed' });
    expect(JSON.parse(f.store.run(grandchild.id).context_json)).toEqual({ ...JSON.parse(f.store.run(child.id).context_json), instruction: input.title });
    expect(tasks.register(identity, input).id).toBe(grandchild.id);
    f.core.options.delegations = { [bot]: [otherBot] };
    expect(() => tasks.register(identity, { ...receipt(child.id), persona_id: otherBot })).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
    f.accept({ schema_version: 1, type: 'run.cancel', payload: { run_id: child.id, reason: 'Stop nested work' } });
    expect(tasks.register(identity, receipt(child.id, 'Late observed descendant')).status).toBe('cancelling');
    f.db.exec('UPDATE runs SET current_attempt=2 WHERE id=?', p);
    expect(() => tasks.register(identity, receipt(p))).toThrowError(expect.objectContaining({ code: 'STALE_EPOCH' }));
    expect(f.db.all('SELECT * FROM native_task_links')).toHaveLength(3);
  });

  it.each(['2026-09-10T00:00:29.999Z', '2026-09-10T00:00:30.000Z'])('late child start preserves its receipt and enforces the inherited deadline: %s', now => {
    const p = parent(), deadline = '2026-09-10T00:00:30.000Z';
    f.db.exec('UPDATE attempts SET deadline_at=? WHERE run_id=?', deadline, p);
    const input = receipt(p), child = tasks.register(identity, input);
    f.setNow(now);
    const started = tasks.register(identity, input, true), expired = now === deadline;
    expect(started).toMatchObject({ id: child.id, status: expired ? 'cancelling' : 'running', error_code: expired ? 'DEADLINE_EXCEEDED' : null });
    expect(f.db.all('SELECT native_run_ref,status,deadline_at FROM attempts WHERE run_id=?', child.id)).toEqual([
      { native_run_ref: input.native_run_ref, status: 'running', deadline_at: deadline },
    ]);
    expect(life.heartbeat(identity, []).cancellations.includes(child.id)).toBe(expired);
    f.setNow('2026-09-10T00:00:40.000Z');
    expect(tasks.register(identity, input, true)).toEqual(started);
    if (expired) {
      f.setNow('2026-09-10T00:01:00.000Z'); life.watchdog();
      expect(f.store.run(child.id).status).toBe('recovery_required');
    }
  });

  it('descendants inherit the original hard deadline instead of extending it at each spawn', () => {
    const p = parent(), deadline = '2026-09-10T00:00:30.000Z';
    f.db.exec('UPDATE attempts SET deadline_at=? WHERE run_id=?', deadline, p);
    f.setNow('2026-09-10T00:00:19.000Z');
    const child = tasks.register(identity, receipt(p));
    expect(child.status).toBe('claimed');
    expect(f.db.all('SELECT deadline_at FROM attempts WHERE run_id=?', child.id)).toEqual([{ deadline_at: deadline }]);
    f.setNow(deadline);
    const late = tasks.register(identity, receipt(child.id));
    expect(late).toMatchObject({ status: 'cancelling', error_code: 'DEADLINE_EXCEEDED' });
    expect(f.db.all('SELECT deadline_at FROM attempts WHERE run_id=?', late.id)).toEqual([{ deadline_at: deadline }]);
    expect(life.heartbeat(identity, []).cancellations).toContain(late.id);
  });
});
