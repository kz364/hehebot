import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fixture, bot } from './helpers';
import { LifecycleCore, type Identity } from '../src/core/lifecycle';
import { NativeTaskLedger } from '../src/core/native-tasks';
import { TaskSteering } from '../src/core/task-steering';
import { OutputPreviews } from '../src/core/output-preview';
import { FileJournal } from '../runtime/file-journal.mjs';
import { CodexAdapter } from '../runtime/codex-adapter.mjs';
import { CodexTaskControl } from '../runtime/codex-tasks.mjs';

let f: ReturnType<typeof fixture>, life: LifecycleCore, identity: Identity, directory: string;
let journal: FileJournal, adapter: CodexAdapter, parentId: string, lostAck: boolean, leased: boolean;
let registrations: any[], interrupts: any[];
beforeEach(async () => {
  f = fixture(true); life = new LifecycleCore(f.store, f.core);
  f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=1,lease_until='2026-09-10T00:02:00.000Z'");
  identity = life.registerBoot(randomUUID()); life.ready(identity);
  parentId = f.accept({ schema_version: 1, type: 'message.send', payload: { conversation_id: bot, text: 'Synthetic task' } }).resource_id!;
  expect(life.claim(identity)?.run.id).toBe(parentId);
  directory = await mkdtemp(join(tmpdir(), 'hehebot-task-control-')); journal = new FileJournal(directory);
  registrations = []; interrupts = []; lostAck = false; leased = true;
  adapter = new CodexAdapter({ journal, cwd: directory, rpc: async (method: string, params: any) => { interrupts.push({ method, params }); return {}; } });
  await journal.putIfAbsent('native', { threadId: 'root', nativeRunId: 'turn', status: 'running', rootSettled: false });
});
afterEach(async () => { f.close(); await rm(directory, { recursive: true, force: true }); });
function mapper(parent = { runId: parentId, personaId: bot, attempt: 1 }) {
  const tasks = new NativeTaskLedger(f.store, f.core, life);
  return new CodexTaskControl({ adapter, journal: new FileJournal(directory), identity, attemptId: 'native', parent,
    assertLease: () => { if (!leased) throw Object.assign(new Error('fenced'), { code: 'EXECUTOR_FENCED' }); },
    control: { request: async (method: string, p: any) => {
      const steering = new TaskSteering(f.store, () => f.core.now());
      if (method === 'output-preview') {
        const {identity: caller,...preview}=p;
        try { new OutputPreviews(f.store,()=>f.core.now()).record(caller,preview,life); }
        catch(error:any) { if(error.code==='OUTPUT_FENCED')return {accepted:false,reason:'OUTPUT_FENCED'};throw error; }
        if(lostAck){lostAck=false;throw new Error('lost acknowledgement');}
        return {accepted:true};
      }
      if (method === 'steer-pending') return steering.pending(p.identity, p.targets, life);
      if (method === 'steer-result') { steering.result(p.identity, p, p.command_id, p.status, life); return { ok: true }; }
      expect(method).toBe('native-child'); expect(p.started).toBe(true); registrations.push(p.child);
      const run = tasks.register(p.identity, p.child, p.started);
      if (lostAck) { lostAck = false; throw new Error('lost acknowledgement'); }
      return run;
    } },
  });
}
async function spawn(thread: string, receiver: string) {
  await adapter.observe('native', { method: 'item/completed', params: { threadId: thread, turnId: 'turn',
    item: { id: `spawn-${receiver}`, type: 'collabAgentToolCall', tool: 'spawnAgent', senderThreadId: thread, status: 'completed', receiverThreadIds: [receiver] } } });
  await adapter.observe('native', { method: 'turn/started', params: { threadId: receiver, turn: { id: 'turn', status: 'inProgress' } } });
}

it('publishes recovered exact root and child replies once without changing task custody', async () => {
  life.submitted(identity, parentId, 1, 'turn');
  await spawn('root', 'child-a');
  const tasks = mapper(), mapped = await tasks.sync();
  const childId = mapped['["child-a","turn"]'].runId;
  const runs = f.db.all('SELECT * FROM runs'), attempts = f.db.all('SELECT * FROM attempts');
  adapter = new CodexAdapter({ journal: new FileJournal(directory), cwd: directory, rpc: async (method: string, params: any) => {
    expect(method).toBe('thread/read');
    return { thread: { id: params.threadId,
      ...(params.threadId === 'child-a' ? { source: { subAgent: { thread_spawn: { parent_thread_id: 'root' } } } } : {}),
      turns: [{ id: 'turn', status: 'completed', items: [{ id: 'message', type: 'agentMessage',
        text: params.threadId === 'root' ? 'Recovered root reply' : 'Recovered child reply', phase: 'final_answer' }] }] } };
  } });
  await adapter.reconcile('native');
  await adapter.reconcileChild('native', { threadId: 'child-a', turnId: 'turn' });
  let publications = 0;
  const request = tasks.control.request;
  tasks.control.request = async (method: string, params: any) => {
    if (method === 'output-preview') publications++;
    return request(method, params);
  };
  await tasks.publishOutputs();
  await tasks.publishOutputs();
  expect(publications).toBe(2);
  const previews = new OutputPreviews(f.store, () => f.core.now());
  expect(previews.read(parentId, 1)?.text).toBe('Recovered root reply');
  expect(previews.read(childId, 1)?.text).toBe('Recovered child reply');
  expect(f.db.all('SELECT * FROM runs')).toEqual(runs);
  expect(f.db.all('SELECT * FROM attempts')).toEqual(attempts);
  expect(adapter.sleepReadiness().allowed).toBe(false);
});

it('publishes exact root/child messages with lost-ack replay and cancellation fencing, never settling work',async()=>{
 life.submitted(identity,parentId,1,'turn');
 await spawn('root','child-a');await spawn('root','child-b');const tasks=mapper(),mapped=await tasks.sync();
 const message=(threadId:string,text:string,id='message-31')=>adapter.observe('native',{method:'item/completed',params:{threadId,turnId:'turn',item:{type:'agentMessage',id,text,phase:'final_answer'}}});
 await message('root','Root provisional');await message('child-a','Child provisional');await message('child-b','Sibling provisional');
 const before=f.db.all('SELECT * FROM attempts');
 lostAck=true;await expect(tasks.publishOutputs()).rejects.toThrow('lost acknowledgement');
 await mapper().publishOutputs();
 expect(f.core.state().output_previews).toHaveLength(3);
 const preview=new OutputPreviews(f.store,()=>f.core.now()),child=mapped['["child-a","turn"]'].runId,sibling=mapped['["child-b","turn"]'].runId;
 expect(preview.read(child,1)?.text).toBe('Child provisional');expect(preview.read(sibling,1)?.text).toBe('Sibling provisional');
 expect(f.db.all('SELECT * FROM attempts')).toEqual(before);expect(interrupts).toEqual([]);
 f.accept({schema_version:1,type:'run.cancel',payload:{run_id:child,reason:'Stop child'}});
 await message('child-a','Too late','message-43');await message('child-b','Sibling continues','message-43');
 await mapper().publishOutputs();expect(preview.read(child,1)).toBeNull();expect(preview.read(sibling,1)?.text).toBe('Sibling continues');
 leased=false;await expect(tasks.publishOutputs()).rejects.toMatchObject({code:'EXECUTOR_FENCED'});
 expect(adapter.sleepReadiness().allowed).toBe(false);
});

it('reconciles lost registration acknowledgements with identical receipts and preserves nested task identity', async () => {
  await spawn('root', 'child-a'); await spawn('root', 'child-b'); await spawn('child-a', 'grandchild');
  lostAck = true;
  await expect(mapper().sync()).rejects.toThrow('lost acknowledgement');
  expect(f.db.all('SELECT * FROM native_task_links')).toHaveLength(1);
  expect(f.db.all("SELECT status FROM runs WHERE role='background'")).toEqual([{ status: 'running' }]);
  const first = registrations[0], restored = mapper();
  const mapped = await restored.sync();
  expect(registrations[1]).toEqual(first);
  expect(f.db.all('SELECT * FROM native_task_links')).toHaveLength(3);
  const a = mapped['["child-a","turn"]'], b = mapped['["child-b","turn"]'], grand = mapped['["grandchild","turn"]'];
  expect(f.store.run(grand.runId)).toMatchObject({ parent_run_id: a.runId, persona_id: bot, status: 'running' });
  expect(Object.values(mapped).every((child: any) => child.started === true)).toBe(true);
  expect(a.receipt.native_run_ref).not.toBe(b.receipt.native_run_ref);
  await restored.sync(); expect(registrations).toHaveLength(4);
  f.accept({ schema_version: 1, type: 'run.cancel', payload: { run_id: a.runId, reason: 'Stop only this subtree' } });
  const cancellations = life.heartbeat(identity, []).cancellations;
  await restored.cancel(cancellations); await restored.cancel(cancellations);
  expect(interrupts).toEqual([
    { method: 'turn/interrupt', params: { threadId: 'child-a', turnId: 'turn' } },
    { method: 'turn/interrupt', params: { threadId: 'grandchild', turnId: 'turn' } },
  ]);
  expect(f.store.run(b.runId).status).toBe('running'); expect(f.store.run(parentId).status).toBe('claimed');
  expect((await journal.get('native')).childTurns['["grandchild","turn"]']).toBe('inProgress');
  expect(adapter.sleepReadiness().allowed).toBe(false);
  await expect(mapper({ runId: randomUUID(), personaId: bot, attempt: 1 }).sync()).rejects.toMatchObject({ code: 'TASK_GRANT_CONFLICT' });
});

it('maps sequential flat V2 child turns to distinct replay-stable receipts and exact provisional outputs', async () => {
  life.submitted(identity, parentId, 1, 'turn');
  const activity = (id: string, method: 'item/started' | 'item/completed', kind: 'started' | 'interacted', target: string) =>
    adapter.observe('native', { method, params: { threadId: 'root', turnId: 'turn', item: {
      id, type: 'subAgentActivity', kind, agentThreadId: target, agentPath: '/private/model/path',
    } } });
  const turn = (threadId: string, turnId: string, status: 'inProgress' | 'completed') => adapter.observe('native', {
    method: status === 'inProgress' ? 'turn/started' : 'turn/completed',
    params: { threadId, turn: { id: turnId, status } },
  });
  const output = (threadId: string, turnId: string, id: string, text: string) => adapter.observe('native', {
    method: 'item/completed', params: { threadId, turnId,
      item: { id, type: 'agentMessage', text, phase: 'final_answer' } },
  });

  await activity('spawn-a', 'item/started', 'started', 'child-a');
  await activity('spawn-a', 'item/completed', 'started', 'child-a');
  await turn('child-a', 'turn-a-1', 'inProgress');
  await output('child-a', 'turn-a-1', 'answer-a-1', 'A first provisional');
  await turn('child-a', 'turn-a-1', 'completed');
  await activity('interact-a', 'item/started', 'interacted', 'child-a');
  await activity('interact-a', 'item/completed', 'interacted', 'child-a');
  await turn('child-a', 'turn-a-2', 'inProgress');
  await output('child-a', 'turn-a-2', 'answer-a-2', 'A second provisional');
  await turn('child-a', 'turn-a-2', 'completed');
  await activity('spawn-b', 'item/started', 'started', 'child-b');
  await activity('spawn-b', 'item/completed', 'started', 'child-b');
  await turn('child-b', 'turn-b-1', 'inProgress');
  await output('child-b', 'turn-b-1', 'answer-b-1', 'B provisional');

  lostAck = true;
  await expect(mapper().sync()).rejects.toThrow('lost acknowledgement');
  const acknowledged = f.db.all('SELECT * FROM native_task_links');
  expect(acknowledged).toHaveLength(1);

  journal = new FileJournal(directory);
  adapter = new CodexAdapter({ journal, cwd: directory,
    rpc: async (method: string, params: any) => { interrupts.push({ method, params }); return {}; } });
  const reopened = mapper(), mapped = await reopened.sync();
  const keys = ['["child-a","turn-a-1"]', '["child-a","turn-a-2"]', '["child-b","turn-b-1"]'];
  expect(Object.keys(mapped).sort()).toEqual([...keys].sort());
  expect(new Set(keys.map(key => mapped[key].runId)).size).toBe(3);
  expect(keys.map(key => mapped[key].receipt.native_session_key)).toEqual(['child-a', 'child-a', 'child-b']);
  expect(new Set(keys.map(key => mapped[key].receipt.native_run_ref)).size).toBe(3);
  expect(keys.map(key => mapped[key].receipt)).toEqual(registrations.slice(-3));

  const links = f.db.all<any>('SELECT * FROM native_task_links ORDER BY native_run_ref');
  expect(links).toHaveLength(3);
  expect(links).toEqual(expect.arrayContaining(acknowledged));
  expect(links.every(row => row.parent_run_id === parentId && row.parent_attempt === 1)).toBe(true);
  expect(links.filter(row => row.native_session_key === 'child-a')).toHaveLength(2);
  const beforeReplay = { links: structuredClone(links), children: structuredClone(mapped) };
  await mapper().sync();
  expect(f.db.all('SELECT * FROM native_task_links ORDER BY native_run_ref')).toEqual(beforeReplay.links);
  expect((await journal.get(reopened.key)).children).toEqual(beforeReplay.children);

  await reopened.publishOutputs();
  const previews = new OutputPreviews(f.store, () => f.core.now());
  expect(keys.map(key => [mapped[key].runId, previews.read(mapped[key].runId, 1)?.text])).toEqual([
    [mapped[keys[0]].runId, 'A first provisional'],
    [mapped[keys[1]].runId, 'A second provisional'],
    [mapped[keys[2]].runId, 'B provisional'],
  ]);
  expect(keys.map(key => f.store.run(mapped[key].runId).status)).toEqual(['running', 'running', 'running']);
  expect(f.store.run(parentId).status).toBe('running');
  expect(f.db.all("SELECT status FROM attempts WHERE run_id IN (?,?,?) ORDER BY run_id",
    ...keys.map(key => mapped[key].runId))).toEqual([{ status: 'running' }, { status: 'running' }, { status: 'running' }]);
  expect(adapter.sleepReadiness().allowed).toBe(false);
});

it('lease loss after durable mapping intent prevents control dispatch and cancellation', async () => {
  await spawn('root', 'child-a');
  const tasks = mapper(), update = tasks.journal.update.bind(tasks.journal);
  tasks.journal.update = async (id: string, patch: any) => {
    const result = await update(id, patch); leased = false; return result;
  };
  await expect(tasks.sync()).rejects.toMatchObject({ code: 'EXECUTOR_FENCED' });
  expect(registrations).toEqual([]); expect(f.db.all('SELECT * FROM native_task_links')).toHaveLength(0);
  await expect(tasks.cancel([parentId])).rejects.toMatchObject({ code: 'EXECUTOR_FENCED' }); expect(interrupts).toEqual([]);
  leased = true;
  const recovered = await mapper().sync(); expect(Object.values(recovered)).toHaveLength(1);
  expect(f.db.all('SELECT * FROM native_task_links')).toHaveLength(1);
});

it('an unattributed turn cannot manufacture a Worker child or issue an interrupt', async () => {
  await journal.update('native', { childTurns: { '["stranger","turn"]': 'inProgress' } });
  await expect(mapper().sync()).rejects.toMatchObject({ code: 'NATIVE_CHILD_ORIGIN_UNKNOWN' });
  expect(registrations).toEqual([]); expect(await mapper().cancel([randomUUID()])).toEqual([]);
  expect(interrupts).toEqual([]);
});

it('lost start acknowledgement followed by cancellation reconciles without resurrecting the child', async () => {
  await spawn('root', 'child-a'); lostAck = true;
  await expect(mapper().sync()).rejects.toThrow('lost acknowledgement');
  const childId = f.db.all<{ id: string }>("SELECT id FROM runs WHERE role='background'")[0].id;
  f.accept({ schema_version: 1, type: 'run.cancel', payload: { run_id: childId, reason: 'Cancel before acknowledgement arrives' } });
  const before = f.store.run(childId);
  const mapped = await mapper().sync();
  expect(mapped['["child-a","turn"]']).toMatchObject({ runId: childId, started: true });
  expect(f.store.run(childId)).toEqual(before); expect(interrupts).toEqual([]);
  expect(f.db.all('SELECT * FROM native_task_links')).toHaveLength(1);
});

it('legacy mapped children acknowledge once; existing cancellation and terminal state survive replay', async () => {
  await spawn('root', 'child-a');
  const tasks = mapper();
  const mapped = await tasks.sync(), key = '["child-a","turn"]', child = mapped[key];
  // Reproduce the previous journal format and its metadata-only Worker state.
  f.db.exec("UPDATE runs SET status='claimed' WHERE id=?", child.runId);
  f.db.exec("UPDATE attempts SET status='claimed' WHERE run_id=?", child.runId);
  await journal.update(tasks.key, { children: { [key]: { receipt: child.receipt, parentKey: child.parentKey, runId: child.runId } } });
  expect((await mapper().sync())[key]).toMatchObject({ runId: child.runId, started: true });
  expect(f.store.run(child.runId).status).toBe('running');
  life.complete(identity, child.runId, 1, { status: 'completed', text: 'Synthetic externally settled test child' });
  const before = f.store.run(child.runId);
  // Lose only the local acknowledgement marker: the exact Worker receipt remains.
  await journal.update(tasks.key, { children: { [key]: { ...child, started: false } } });
  await mapper().sync(); expect(f.store.run(child.runId)).toEqual(before);
  expect(interrupts).toEqual([]);
});

it('atomic start rejects contradictory child custody and rolls back partial registration on acknowledgement failure', () => {
  const ledger = new NativeTaskLedger(f.store, f.core, life);
  const receipt = { parent_run_id: parentId, parent_attempt: 1, persona_id: bot,
    native_run_ref: 'synthetic-child-43', native_session_key: 'thread-71', title: 'Observed native child' };
  const child = ledger.register(identity, receipt);
  expect(child.status).toBe('claimed');
  f.db.exec("UPDATE attempts SET native_run_ref='contradictory-103' WHERE run_id=?", child.id);
  expect(() => ledger.register(identity, receipt, true)).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
  expect(f.store.run(child.id).status).toBe('claimed');
  const runs = f.db.all('SELECT * FROM runs'), links = f.db.all('SELECT * FROM native_task_links'), events = f.db.all('SELECT * FROM events');
  const original = life.submitted;
  life.submitted = () => { throw new Error('synthetic persistence failure'); };
  expect(() => ledger.register(identity, { ...receipt, native_run_ref: 'another-211', native_session_key: 'another-thread-307' }, true)).toThrow('synthetic persistence failure');
  life.submitted = original;
  expect(f.db.all('SELECT * FROM runs')).toEqual(runs); expect(f.db.all('SELECT * FROM native_task_links')).toEqual(links);
  expect(f.db.all('SELECT * FROM events')).toEqual(events);
});

it('reconciliation cannot replace a persisted Worker child or accept a metadata-only start reply', async () => {
  await spawn('root', 'child-a');
  const tasks = mapper(), key = '["child-a","turn"]', child = (await tasks.sync())[key];
  const original = tasks.control.request;
  for (const [patch, code] of [[{ id: randomUUID() }, 'TASK_GRANT_CONFLICT'], [{ status: 'claimed' }, 'INVALID_CHILD_TASK_RECEIPT']] as const) {
    await journal.update(tasks.key, { children: { [key]: { ...child, started: false } } });
    tasks.control.request = async (method: string, payload: any) => ({ ...await original(method, payload), ...patch });
    await expect(tasks.sync()).rejects.toMatchObject({ code });
    expect((await journal.get(tasks.key)).children[key]).toMatchObject({ runId: child.runId, started: false });
    expect(f.store.run(child.runId).status).toBe('running');
  }
  expect(interrupts).toEqual([]);
});

it('delivers exact root and child owner steering with durable replay after lost Worker receipt, leaving siblings unchanged', async () => {
  life.submitted(identity, parentId, 1, 'turn');
  await spawn('root', 'child-a'); await spawn('root', 'child-b');
  adapter = new CodexAdapter({ journal, cwd: directory,
    rpc: async (method: string, params: any) => { interrupts.push({ method, params }); return { turnId: params.expectedTurnId }; } });
  const tasks = mapper(), mapped = await tasks.sync(), child = mapped['["child-a","turn"]'], sibling = mapped['["child-b","turn"]'];
  const before = f.store.run(sibling.runId);
  const steer = (run_id: string, text: string) => f.accept({ schema_version: 1, type: 'run.steer', payload: { run_id, expected_attempt: 1, text } });
  const rootCommand = steer(parentId, 'Root instruction');
  expect(await tasks.steer()).toEqual([{ command_id: rootCommand.id, status: 'accepted' }]);
  const childCommand = steer(child.runId, 'Use tomorrow for child A');
  const original = tasks.control.request;
  tasks.control.request = async (method: string, p: any) => {
    if (method === 'steer-result') throw new Error('Worker request lost');
    return original(method, p);
  };
  await expect(tasks.steer()).rejects.toThrow('Worker request lost');
  expect(await mapper().steer()).toEqual([{ command_id: childCommand.id, status: 'accepted' }]);
  expect(await mapper().steer()).toEqual([]);
  expect(interrupts).toEqual([
    { method: 'turn/steer', params: { threadId: 'root', expectedTurnId: 'turn', input: [{ type: 'text', text: 'Root instruction' }], clientUserMessageId: rootCommand.id } },
    { method: 'turn/steer', params: { threadId: 'child-a', expectedTurnId: 'turn', input: [{ type: 'text', text: 'Use tomorrow for child A' }], clientUserMessageId: childCommand.id } },
  ]);
  expect(f.store.run(sibling.runId)).toEqual(before); expect(f.store.run(parentId).status).toBe('running');
  expect(adapter.sleepReadiness().allowed).toBe(false);
});

it('keeps native steering uncertainty durable and rejects foreign or lease-expired deliveries before native RPC', async () => {
  await spawn('root', 'child-a');
  const tasks = mapper(), child = (await tasks.sync())['["child-a","turn"]'];
  const receipt = f.accept({ schema_version: 1, type: 'run.steer', payload: { run_id: child.runId, expected_attempt: 1, text: 'A instruction' } });
  const original = tasks.control.request;
  tasks.control.request = async (method: string, p: any) => {
    const result = await original(method, p);
    return method === 'steer-pending' ? result.map((row: any) => ({ ...row, native_ref: 'foreign' })) : result;
  };
  await expect(tasks.steer()).rejects.toMatchObject({ code: 'INVALID_STEERING_RECEIPT' });expect(interrupts).toEqual([]);
  tasks.control.request = async (method: string, p: any) => { const result = await original(method, p); leased = false; return result; };
  await expect(tasks.steer()).rejects.toMatchObject({ code: 'EXECUTOR_FENCED' });expect(interrupts).toEqual([]);
  leased = true;
  // Fixture returns an invalid native ACK. This is uncertainty, not non-delivery.
  expect(await mapper().steer()).toEqual([{ command_id: receipt.id, status: 'outcome_unknown' }]);
  expect(await mapper().steer()).toEqual([]);expect(interrupts).toHaveLength(1);
  expect(f.accept({ schema_version: 1, type: 'run.steer', payload: { run_id: child.runId, expected_attempt: 1, text: 'Unsafe retry' } }).error?.code).toBe('RESOURCE_BUSY');
});
