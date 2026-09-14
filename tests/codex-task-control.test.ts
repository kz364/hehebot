import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fixture, bot } from './helpers';
import { LifecycleCore, type Identity } from '../src/core/lifecycle';
import { NativeTaskLedger } from '../src/core/native-tasks';
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
      expect(method).toBe('native-child'); registrations.push(p.child);
      const run = tasks.register(p.identity, p.child);
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

it('reconciles lost registration acknowledgements with identical receipts and preserves nested task identity', async () => {
  await spawn('root', 'child-a'); await spawn('root', 'child-b'); await spawn('child-a', 'grandchild');
  lostAck = true;
  await expect(mapper().sync()).rejects.toThrow('lost acknowledgement');
  expect(f.db.all('SELECT * FROM native_task_links')).toHaveLength(1);
  const first = registrations[0], restored = mapper();
  const mapped = await restored.sync();
  expect(registrations[1]).toEqual(first);
  expect(f.db.all('SELECT * FROM native_task_links')).toHaveLength(3);
  const a = mapped['["child-a","turn"]'], b = mapped['["child-b","turn"]'], grand = mapped['["grandchild","turn"]'];
  expect(f.store.run(grand.runId)).toMatchObject({ parent_run_id: a.runId, persona_id: bot, status: 'claimed' });
  expect(a.receipt.native_run_ref).not.toBe(b.receipt.native_run_ref);
  await restored.sync(); expect(registrations).toHaveLength(4);
  f.accept({ schema_version: 1, type: 'run.cancel', payload: { run_id: a.runId, reason: 'Stop only this subtree' } });
  const cancellations = life.heartbeat(identity, []).cancellations;
  await restored.cancel(cancellations); await restored.cancel(cancellations);
  expect(interrupts).toEqual([
    { method: 'turn/interrupt', params: { threadId: 'child-a', turnId: 'turn' } },
    { method: 'turn/interrupt', params: { threadId: 'grandchild', turnId: 'turn' } },
  ]);
  expect(f.store.run(b.runId).status).toBe('claimed'); expect(f.store.run(parentId).status).toBe('claimed');
  expect((await journal.get('native')).childTurns['["grandchild","turn"]']).toBe('inProgress');
  expect(adapter.sleepReadiness().allowed).toBe(false);
  await expect(mapper({ runId: randomUUID(), personaId: bot, attempt: 1 }).sync()).rejects.toMatchObject({ code: 'TASK_GRANT_CONFLICT' });
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
