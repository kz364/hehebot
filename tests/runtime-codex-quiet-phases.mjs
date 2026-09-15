import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileJournal } from '../runtime/file-journal.mjs';
import { CodexAdapter } from '../runtime/codex-adapter.mjs';
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
  assert.deepEqual(two, { [first]: { status: 'completed', startedAt: at }, [second]: { status: 'inProgress', startedAt: at } });
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
  assert.deepEqual((await f.journal.get('attempt')).quietPhases, { [second]: { status: 'completed', startedAt: later } });
  await f.item('next', 'completed', later);
  const next = (await f.journal.get('attempt')).quietPhases;
  assert.equal(next['["commands","next"]'].status, 'inProgress');
  assert.equal(next[second].status, 'completed');
  assert.deepEqual((await new CodexAdapter({ journal: f.journal, cwd: f.journal.directory, rpc: () => {} }).requireRun('attempt')).quietPhases, next);
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
