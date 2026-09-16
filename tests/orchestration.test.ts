import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ControlCore } from '../src/core/control';
import { Store } from '../src/core/store';
import { LifecycleCore, type Identity } from '../src/core/lifecycle';
import { NativeTaskLedger, type NativeChildReceipt } from '../src/core/native-tasks';
import { ResourceLedger } from '../src/core/resources';
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
  it('records observed children idempotently and frees coordinator admission while a child remains active', () => {
    const p = parent(), input = receipt(p), child = tasks.register(identity, input);
    expect(child).toMatchObject({ role: 'background', parent_run_id: p, status: 'claimed', current_attempt: 1 });
    expect(f.db.all('SELECT native_run_ref,epoch,boot_id FROM attempts WHERE run_id=?', child.id)).toEqual([{ native_run_ref: input.native_run_ref, epoch: identity.epoch, boot_id: identity.boot_id }]);
    expect(tasks.register(identity, input).id).toBe(child.id);
    const next = message('What is the status?'); expect(life.claim(identity)).toBeNull();
    finish(p);
    expect(life.claim(identity)?.run.id).toBe(next);
    expect(f.store.run(child.id)).toEqual(child);
    expect(f.db.all('SELECT * FROM native_task_links')).toHaveLength(1);
  });

  it('preserves two child inputs and identities when an ambiguous ordinary message arrives', () => {
    const p = parent(), a = tasks.register(identity, receipt(p)), b = tasks.register(identity, receipt(p, 'Task B'));
    const links = f.db.all('SELECT * FROM native_task_links ORDER BY run_id');
    finish(p);
    const request = message('Change the time');
    const coordinator = life.claim(identity)!.run;
    expect(coordinator.id).toBe(request); expect(coordinator.role).toBe('coordinator');
    expect(f.store.run(a.id)).toEqual(a); expect(f.store.run(b.id)).toEqual(b);
    expect(f.db.all('SELECT * FROM native_task_links ORDER BY run_id')).toEqual(links);
    expect(f.db.all('SELECT * FROM task_followups')).toHaveLength(0);
    // Whether a native model asks for clarification remains a live gate.
  });

  it('keeps targeted followup pending until settlement and emits one separate coordinator continuation', () => {
    const p = parent(), a = tasks.register(identity, receipt(p)), b = tasks.register(identity, receipt(p, 'Task B'));
    finish(p);
    const accepted = f.accept({ schema_version: 1, type: 'run.followup', payload: { run_id: a.id, text: 'Move this appointment to 10:00' } });
    expect(accepted.status).toBe('applied'); f.core.flushFollowups(a.id);
    expect(f.db.all('SELECT status FROM task_followups')).toEqual([{ status: 'pending' }]);
    expect(life.claim(identity)).toBeNull(); expect(f.store.run(a.id)).toEqual(a);
    finish(a.id); f.core.flushFollowups(a.id);
    const rows = f.db.all<{ status: string; coordinator_run_id: string }>('SELECT status,coordinator_run_id FROM task_followups');
    expect(rows).toHaveLength(1); expect(rows[0].status).toBe('coordinator_queued');
    const next = life.claim(identity)!.run;
    expect(next.id).toBe(rows[0].coordinator_run_id); expect(next.role).toBe('coordinator');
    expect(JSON.parse(next.context_json).instruction).toContain(a.id);
    expect(JSON.parse(next.context_json).instruction).toContain('Move this appointment to 10:00');
    expect(f.store.run(b.id)).toEqual(b);
  });

  it.each([false,true])('terminal owner cancellation releases a waiting-task followup only after descendants settle: nested=%s', nested => {
    const p=parent(),a=tasks.register(identity,receipt(p)),b=tasks.register(identity,receipt(p,'Unrelated sibling'));
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
    expect(f.store.run(b.id)).toEqual(b);
    expect(f.db.all('SELECT status FROM attempts WHERE run_id=?',a.id)).toEqual([{status:'waiting'}]);
  });

  it('defers a task followup through its live grandchild, then queues it once without waiting for an unrelated sibling', () => {
    const p=parent(),a=tasks.register(identity,receipt(p)),b=tasks.register(identity,receipt(p,'Unrelated sibling'));
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
    expect(f.store.run(b.id)).toEqual(b);
  });
  it('cancels only B while A and its currently claimed coordinator remain unchanged', () => {
    const p = parent(), a = tasks.register(identity, receipt(p)), b = tasks.register(identity, receipt(p, 'Task B'));
    const beforeParent = f.store.run(p);
    expect(f.accept({ schema_version: 1, type: 'run.cancel', payload: { run_id: b.id, reason: 'Owner selected B' } }).status).toBe('applied');
    expect(f.store.run(b.id).status).toBe('cancelling');
    expect(f.store.run(a.id)).toEqual(a); expect(f.store.run(p)).toEqual(beforeParent);
    expect(life.heartbeat(identity, []).cancellations).toEqual([b.id]);
  });

  it('keeps task A and coordinator alive when task B ignores cancellation', () => {
    const p = parent(), a = tasks.register(identity, receipt(p)), b = tasks.register(identity, receipt(p, 'Task B'));
    resources.acquire(b.id, 1, ['browser:tab:b']);
    f.accept({schema_version:1,type:'run.cancel',payload:{run_id:b.id,reason:'Stop B'}});
    f.setNow('2026-09-10T00:00:31.000Z');life.watchdog();
    expect(life.get().phase).toBe('READY');expect(f.store.run(a.id)).toEqual(a);
    expect(f.store.run(b.id).status).toBe('recovery_required');
    expect(life.heartbeat(identity,[]).cancellations).toContain(b.id);
    expect(f.accept({schema_version:1,type:'run.retry',payload:{run_id:b.id,expected_attempt:1}}).error?.code).toBe('CANCEL_UNCONFIRMED');
    resources.release(b.id,1,['browser:tab:b']);life.complete(identity,b.id,1,{status:'cancelled',text:''});
    expect(f.store.run(a.id)).toEqual(a);expect(f.store.run(p).status).toBe('claimed');
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
    f.accept({ schema_version: 1, type: 'run.followup', payload: { run_id: child.id, text: 'Use the second date' } });
    const store = new Store(f.db), core = new ControlCore(store, f.core.options), restartedLife = new LifecycleCore(store, core);
    expect(new NativeTaskLedger(store, core, restartedLife).register(identity, input).id).toBe(child.id);
    expect(store.run(child.id)).toEqual(child);
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

  it('registers same-task descendants under background parents without widening persona authority', () => {
    const p = parent(), child = tasks.register(identity, receipt(p));
    const input = receipt(child.id, 'Nested native work');
    const grandchild = tasks.register(identity, input);
    expect(grandchild).toMatchObject({ parent_run_id: child.id, persona_id: bot, role: 'background', status: 'claimed' });
    expect(JSON.parse(grandchild.context_json)).toEqual({ ...JSON.parse(child.context_json), instruction: input.title });
    expect(tasks.register(identity, input).id).toBe(grandchild.id);
    f.core.options.delegations = { [bot]: [otherBot] };
    expect(() => tasks.register(identity, { ...receipt(child.id), persona_id: otherBot })).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
    f.accept({ schema_version: 1, type: 'run.cancel', payload: { run_id: child.id, reason: 'Stop nested work' } });
    expect(tasks.register(identity, receipt(child.id, 'Late observed descendant')).status).toBe('cancelling');
    f.db.exec('UPDATE runs SET current_attempt=2 WHERE id=?', p);
    expect(() => tasks.register(identity, receipt(p))).toThrowError(expect.objectContaining({ code: 'STALE_EPOCH' }));
    expect(f.db.all('SELECT * FROM native_task_links')).toHaveLength(3);
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
