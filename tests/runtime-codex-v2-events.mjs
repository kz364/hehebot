import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexEventRouter } from '../runtime/codex-events.mjs';
import { CodexAdapter } from '../runtime/codex-adapter.mjs';
import { CodexOperations } from '../runtime/codex-operations.mjs';
import { FileJournal } from '../runtime/file-journal.mjs';
import { inspectCodexRecovery } from '../runtime/codex-recovery-inspect.mjs';

const time = '2026-09-16T10:00:00.000Z';
// Exact flat public shape captured by the pinned native V2 fixture.
const activity = (itemId, kind, target, threadId = 'root', turnId = 'root-turn') => ({
  method: kind === 'started' ? 'item/started' : 'item/completed', params: { threadId, turnId, item: {
    id: itemId, type: 'subAgentActivity', kind, agentThreadId: target, agentPath: '/private/model/path',
  } },
});
const turn = (threadId, turnId, status = 'inProgress') => ({ method: status === 'inProgress' ? 'turn/started' : 'turn/completed',
  params: { threadId, turn: { id: turnId, status } } });

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'hehe-v2-events-'));
  const journal = new FileJournal(directory), transport = new EventEmitter(), recoveries = [];
  const adapter = new CodexAdapter({ journal, cwd: directory, rpc: async () => { throw Error('unexpected RPC'); } });
  const router = new CodexEventRouter({ transport, adapter, now: () => Date.parse(time), onRecovery: row => recoveries.push(row.code) });
  await journal.putIfAbsent('attempt', { attemptId: 'attempt', threadId: 'root', nativeRunId: 'root-turn', status: 'running', rootSettled: false });
  await router.bind('attempt');
  t.after(async () => { router.close(); await router.tail; await rm(directory, { recursive: true, force: true }); });
  const emit = async event => { transport.emit('notification', event); await router.flush(); };
  return { journal, adapter, router, recoveries, emit };
}

test('early child turn binds after a content-free V2 started activity and keeps its admitted root', async t => {
  const f = await fixture(t);
  await f.emit(turn('child-a', 'turn-a'));
  assert.equal(f.router.pending.length, 1);
  await f.emit(activity('spawn-a', 'started', 'child-a'));
  let row = await f.journal.get('attempt');
  assert.deepEqual(row.spawns['spawn-a'], { status: 'observed', source: 'v2Activity', receiverThreadIds: ['child-a'] });
  assert.deepEqual(row.v2Activities['spawn-a'], { kind: 'started', targetThreadId: 'child-a' });
  assert.equal(row.childTurns['["child-a","turn-a"]'], 'inProgress');
  assert.doesNotMatch(JSON.stringify(row), /model\/path/);
  await f.emit(turn('child-a', 'turn-followup'));
  row = await f.journal.get('attempt');
  assert.equal(row.childTurns['["child-a","turn-followup"]'], 'inProgress');
  assert.equal(f.recoveries.length, 0);
});

test('sequential observed children survive omission and activities never settle children or root', async t => {
  const f = await fixture(t);
  await f.emit(activity('spawn-a', 'started', 'child-a'));
  await f.emit(turn('child-a', 'turn-a'));
  await f.emit(turn('child-a', 'turn-a', 'completed'));
  await f.emit(activity('spawn-b', 'started', 'child-b'));
  await f.emit(turn('child-b', 'turn-b'));
  for (const kind of ['interacted', 'completed']) await f.emit(activity(`${kind}-b`, kind, 'child-b'));
  await f.emit(turn('root', 'root-turn', 'completed'));
  const row = await f.journal.get('attempt');
  assert.deepEqual(Object.keys(row.spawns), ['spawn-a', 'spawn-b']);
  assert.equal(row.childTurns['["child-b","turn-b"]'], 'inProgress');
  assert.equal(row.rootSettled, true);
  assert.equal(row.v2Activities['completed-b'].kind, 'completed');
});

test('V2 acknowledgement has stable startup clock and unknown activity operations', async t => {
  const f = await fixture(t);
  await f.emit(activity('spawn-a', 'started', 'child-a'));
  await f.emit(activity('interact-a', 'interacted', 'child-a'));
  const before = await f.journal.get('attempt');
  await f.emit(activity('spawn-a', 'started', 'child-a'));
  assert.deepEqual(await f.journal.get('attempt'), before);
  const operations = await new CodexOperations({ journal: f.journal, attemptId: 'attempt',
    runId: '00000000-0000-4000-8000-000000000001', attempt: 1,
    startedAt: '2026-09-16T09:59:00.000Z', deadlineAt: '2026-09-16T10:10:00.000Z' }).snapshot();
  const startup = operations.find(row => row.kind === 'child');
  assert.equal(startup.started_at, time); assert.equal(startup.deadline_at, '2026-09-16T10:02:00.000Z');
  assert.equal(operations.filter(row => row.id !== startup.id && row.status === 'unknown').length >= 3, true);
});

test('changed identity, foreign targets, duplicate origins and V1/V2 IDs fail without writes', async t => {
  for (const mutate of [
    async f => { await f.emit(activity('spawn-a', 'started', 'child-a')); return activity('spawn-a', 'started', 'child-b'); },
    async f => activity('foreign', 'interacted', 'unknown'),
    async f => { await f.emit(activity('spawn-a', 'started', 'child-a')); return activity('spawn-b', 'started', 'child-a'); },
  ]) {
    const f = await fixture(t), event = await mutate(f), before = await f.journal.get('attempt');
    await f.emit(event); assert.deepEqual(await f.journal.get('attempt'), before);
    assert.deepEqual(f.recoveries, ['NATIVE_EVENT_RECONCILIATION_FAILED']);
  }
  const f = await fixture(t);
  await f.journal.update('attempt', { spawns: { same: { status: 'completed', receiverThreadIds: ['old-child'] } } });
  const before = await f.journal.get('attempt'); await f.emit(activity('same', 'started', 'new-child'));
  assert.deepEqual(await f.journal.get('attempt'), before);
  assert.deepEqual(f.recoveries, ['NATIVE_EVENT_RECONCILIATION_FAILED']);
});

test('paired completion is a no-write replay and child-to-root interactions keep the same tree', async t => {
  const f = await fixture(t);
  const event = activity('spawn-a', 'started', 'child-a');
  await f.emit(event);
  const update = f.journal.update.bind(f.journal);
  f.journal.update = () => assert.fail('paired activity completion must not rewrite custody or clocks');
  await f.emit({ ...event, method: 'item/completed' });
  assert.deepEqual(f.recoveries, []);
  f.journal.update = update;
  await f.emit(turn('child-a', 'turn-a'));
  await f.emit(activity('to-parent', 'interacted', 'root', 'child-a', 'turn-a'));
  const row = await f.journal.get('attempt');
  assert.deepEqual(row.childObligations['["child-a","turn-a"]'].v2Activities['to-parent'],
    { kind: 'interacted', targetThreadId: 'root' });
  assert.equal(row.rootSettled, false);
  const before = await f.journal.get('attempt');
  await f.emit({ method: 'item/completed', params: { threadId: 'root', turnId: 'root-turn', item: {
    type: 'collabAgentToolCall', id: 'spawn-a', tool: 'sendMessage', status: 'completed', senderThreadId: 'root',
  } } });
  assert.deepEqual(await f.journal.get('attempt'), before);
  assert.deepEqual(f.recoveries, ['NATIVE_EVENT_RECONCILIATION_FAILED']);
});

test('malformed kinds and activity limit cannot create or change native custody', async t => {
  for (const invalid of [activity('bad', 'unknown', 'child'), activity('bad', 'started', 'root')]) {
    const f = await fixture(t), before = await f.journal.get('attempt');
    await f.emit(invalid);
    assert.deepEqual(await f.journal.get('attempt'), before);
    assert.deepEqual(f.recoveries, ['NATIVE_EVENT_INVALID']);
  }
  const f = await fixture(t);
  await f.emit(activity('spawn-a', 'started', 'child-a'));
  const row = await f.journal.get('attempt');
  const records = Object.fromEntries(Array.from({ length: 4095 }, (_, index) =>
    [`activity-${index}`, { kind: 'interacted', targetThreadId: 'child-a' }]));
  await f.journal.update('attempt', { v2Activities: { ...records, ...row.v2Activities } });
  const before = await f.journal.get('attempt');
  await f.emit(activity('overflow', 'interacted', 'child-a'));
  assert.deepEqual(await f.journal.get('attempt'), before);
  assert.deepEqual(f.recoveries, ['NATIVE_EVENT_RECONCILIATION_FAILED']);
});

test('offline inspection retains observed V2 origin and unknown activity without model path text', async t => {
  const f = await fixture(t);
  await f.emit(activity('spawn-a', 'started', 'child-a'));
  await f.emit(turn('child-a', 'turn-a'));
  await f.emit(activity('done-a', 'completed', 'child-a'));
  const native = await f.journal.get('attempt');
  f.router.close();
  const identity = { epoch: 1, boot_id: '10000000-0000-4000-8000-000000000001' };
  const attemptId = 'a'.repeat(64), runId = '20000000-0000-4000-8000-000000000001';
  const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  await f.journal.putIfAbsent('service', { phase: 'recovery', identity });
  await f.journal.putIfAbsent(`dispatch-${hash(identity)}`, { phase: 'running', identity, attemptId,
    nativeRunId: 'root-turn', claim: { submission_key: `${runId}:1`, run: { id: runId, current_attempt: 1 } } });
  await f.journal.putIfAbsent(attemptId, { ...native, attemptId });
  const report = await inspectCodexRecovery(f.adapter.cwd);
  assert.deepEqual(report.issues, []);
  assert.deepEqual(report.native.children, [{ threadId: 'child-a', turnId: 'turn-a', status: 'inProgress',
    initialInference: 'inProgress', initialInferenceAt: time }]);
  assert.equal(report.native.observations.filter(item => item.kind === 'v2Activity' && item.status === 'unknown').length, 2);
  assert.equal(report.native.observations.find(item => item.kind === 'spawns').source, 'v2Activity');
  assert.equal(report.resumeAllowed, false); assert.equal(report.sleepAllowed, false);
  assert.doesNotMatch(JSON.stringify(report), /private\/model\/path/);
});
