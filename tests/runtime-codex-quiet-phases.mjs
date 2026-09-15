import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileJournal } from '../runtime/file-journal.mjs';
import { CodexAdapter } from '../runtime/codex-adapter.mjs';
import { CodexOperations } from '../runtime/codex-operations.mjs';
import { advanceQuietPhases, readQuietPhases } from '../runtime/codex-quiet-phases.mjs';

const at = '2026-09-15T01:00:00.000Z', later = '2026-09-15T01:01:00.000Z';
const first = '["commands","z"]', second = '["commands","a"]';
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'hehe-quiet-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const journal = new FileJournal(directory);
  await journal.putIfAbsent('attempt', { threadId: 'root', nativeRunId: 'turn', rootSettled: false, status: 'running' });
  const adapter = new CodexAdapter({ journal, cwd: directory, testMode: true, rpc: () => assert.fail('no native calls') });
  const item = (id, status, observedAt, threadId = 'root') => adapter.observe('attempt', {
    method: status === 'inProgress' ? 'item/started' : 'item/completed',
    params: { threadId, turnId: 'turn', item: { id, type: 'commandExecution', status } },
  }, observedAt);
  return { journal, adapter, item };
}

test('phase order survives equal timestamps and cannot reopen an old completed phase', () => {
  const one = advanceQuietPhases(undefined, at, first);
  const two = advanceQuietPhases(one, at, second);
  assert.deepEqual(one, { [first]: { status: 'inProgress', startedAt: at } });
  assert.deepEqual(two, { [first]: { status: 'completed', startedAt: at, endedAt: at }, [second]: { status: 'inProgress', startedAt: at } });
  const closed = advanceQuietPhases(two, undefined);
  assert.deepEqual(advanceQuietPhases(closed, later, first), closed);
  assert.deepEqual(readQuietPhases(undefined), {});
});

test('invalid phase state, multiple active records and backwards clocks refuse without mutation', () => {
  const valid = { [first]: { status: 'inProgress', startedAt: later } };
  for (const value of [null, [], { x: {} }, { '["commands", "z"]': valid[first] },
    { [first]: { status: 'failed', startedAt: at } }, { [first]: { status: 'inProgress', startedAt: 'bad' } },
    { [first]: { ...valid[first], text: 'PRIVATE' } }, { ...valid, [second]: valid[first] }]) {
    assert.throws(() => readQuietPhases(value), { code: 'INVALID_QUIET_PHASE' });
  }
  assert.throws(() => advanceQuietPhases(valid, at, second), { code: 'INVALID_QUIET_PHASE' });
  assert.deepEqual(valid, { [first]: { status: 'inProgress', startedAt: later } });
});

test('only the last parallel tool completion opens quiet time; duplicate/history items cannot reset it', async t => {
  const f = await fixture(t);
  await f.item('z', 'inProgress', at); await f.item('a', 'inProgress', at);
  await f.item('z', 'completed', later);
  assert.equal((await f.journal.get('attempt')).quietPhases, undefined);
  await f.item('a', 'completed', later);
  const phases = { [second]: { status: 'inProgress', startedAt: later } };
  assert.deepEqual((await f.journal.get('attempt')).quietPhases, phases);
  await f.item('a', 'completed', '2026-09-15T01:04:00.000Z');
  await f.item('history', 'completed', undefined);
  assert.deepEqual((await f.journal.get('attempt')).quietPhases, phases);
  await f.item('next', 'inProgress', later);
  assert.deepEqual((await f.journal.get('attempt')).quietPhases, { [second]: { status: 'completed', startedAt: later, endedAt: later } });
  await f.item('next', 'completed', later);
  const next = (await f.journal.get('attempt')).quietPhases;
  assert.equal(next['["commands","next"]'].status, 'inProgress');
  assert.equal(next[second].status, 'completed');
  assert.deepEqual((await new CodexAdapter({ journal: f.journal, cwd: f.journal.directory, rpc: () => {} }).requireRun('attempt')).quietPhases, next);
});

for (const threadId of ['root', 'child']) test(`live ${threadId} message silence is bounded; replay and history cannot refresh it`, async t => {
  const f = await fixture(t), key = '["child","turn"]', phaseKey = '["outputItems","message"]';
  if (threadId === 'child') await f.journal.update('attempt', {
    spawns: { s: { status: 'completed', receiverThreadIds: ['child'] } }, childTurns: { [key]: 'inProgress' },
  });
  const message = (id, time) => f.adapter.observe('attempt', { method: 'item/completed',
    params: { threadId, turnId: 'turn', item: { id, type: 'agentMessage', text: 'Still working' } } }, time);
  const owner = row => threadId === 'root' ? row : row.childObligations[key];
  await message('message', at);
  assert.deepEqual(owner(await f.journal.get('attempt')).quietPhases, { [phaseKey]: { status: 'inProgress', startedAt: at } });
  await message('message', later); await message('history', undefined);
  assert.deepEqual(owner(await f.journal.get('attempt')).quietPhases, { [phaseKey]: { status: 'inProgress', startedAt: at } });
  const operations = new CodexOperations({ journal: f.journal, attemptId: 'attempt',
    runId: '01234567-0123-4123-a123-012345678901', attempt: 1, startedAt: at, deadlineAt: '2026-09-15T01:20:00.000Z' });
  const phase = (await operations.snapshot()).find(op => op.deadline_at === '2026-09-15T01:05:00.000Z');
  assert.equal(phase.status, 'active'); assert.equal(phase.last_progress_at, at);
  await f.adapter.observe('attempt', { method: 'turn/completed', params: { threadId: 'root', turn: { id: 'turn', status: 'completed' } } }, later);
  assert.equal(owner(await f.journal.get('attempt')).quietPhases[phaseKey].status, threadId === 'root' ? 'completed' : 'inProgress');
  if (threadId === 'child') await f.adapter.observe('attempt', { method: 'turn/completed', params: { threadId, turn: { id: 'turn', status: 'completed' } } });
  await message('late', later);
  assert.deepEqual(owner(await f.journal.get('attempt')).quietPhases, { [phaseKey]: { status: 'completed', startedAt: at,
    ...(threadId === 'root' ? { endedAt: later } : {}) } });
});

test('activity duration preserves the first live end and never invents history-only durations', () => {
  const open = advanceQuietPhases(undefined, at, first);
  const end = '2026-09-15T01:02:17.321Z';
  const closed = advanceQuietPhases(open, end);
  assert.equal(Date.parse(closed[first].endedAt) - Date.parse(closed[first].startedAt), 137321);
  assert.deepEqual(advanceQuietPhases(closed, '2026-09-15T01:04:00.000Z'), closed);
  const historical = advanceQuietPhases(open, undefined);
  assert.equal(advanceQuietPhases(historical, end)[first].endedAt, undefined);
  for (const value of [{ ...open[first], endedAt: end }, { ...closed[first], endedAt: 'bad' },
    { ...closed[first], endedAt: '2026-09-15T00:59:59.999Z' }]) {
    assert.throws(() => readQuietPhases({ [first]: value }), { code: 'INVALID_QUIET_PHASE' });
  }
});

test('a message during an active tool does not invent idle inference', async t => {
  const f = await fixture(t);
  await f.item('tool', 'inProgress', at);
  await f.adapter.observe('attempt', { method: 'item/completed', params: {
    threadId: 'root', turnId: 'turn', item: { id: 'message', type: 'agentMessage', text: 'Tool is running' },
  } }, later);
  assert.equal((await f.journal.get('attempt')).quietPhases, undefined);
  await f.item('tool', 'completed', later);
  assert.deepEqual((await f.journal.get('attempt')).quietPhases, { '["commands","tool"]': { status: 'inProgress', startedAt: later } });
});

test('root completion leaves child quiet time intact; exact child terminal readback closes it', async t => {
  const f = await fixture(t), key = '["child","turn"]';
  await f.journal.update('attempt', { spawns: { s: { status: 'completed', receiverThreadIds: ['child'] } }, childTurns: { [key]: 'inProgress' } });
  await f.item('z', 'inProgress', at, 'child'); await f.item('z', 'completed', later, 'child');
  await f.adapter.observe('attempt', { method: 'turn/completed', params: { threadId: 'root', turn: { id: 'turn', status: 'completed' } } }, later);
  assert.equal((await f.journal.get('attempt')).childObligations[key].quietPhases[first].status, 'inProgress');
  await f.adapter.observe('attempt', { method: 'turn/completed', params: { threadId: 'child', turn: { id: 'turn', status: 'interrupted' } } });
  assert.deepEqual((await f.journal.get('attempt')).childObligations[key].quietPhases[first], { status: 'completed', startedAt: later });
  await f.item('late', 'completed', later, 'child');
  assert.equal(Object.keys((await f.journal.get('attempt')).childObligations[key].quietPhases).length, 1);
});
