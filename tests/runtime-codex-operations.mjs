import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileJournal } from '../runtime/file-journal.mjs';
import { CodexOperations } from '../runtime/codex-operations.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'hehebot-operations-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const journal = new FileJournal(directory);
  const config = { journal, attemptId: 'attempt-a', runId: '01234567-0123-4123-a123-012345678901', attempt: 2,
    startedAt: '2026-09-14T01:00:00.000Z', deadlineAt: '2026-09-14T01:20:00.000Z' };
  return { journal, config, operations: new CodexOperations(config) };
}

test('root and child terminal observations never erase open tools or settle coverage', async t => {
  const f = await fixture(t), child = JSON.stringify(['child-a', 'same-turn']);
  await f.journal.putIfAbsent('attempt-a', { threadId: 'root', nativeRunId: 'same-turn', status: 'finishing', rootSettled: true,
    commands: { same: 'inProgress' }, mcpCalls: { same: 'failed' }, childTurns: { [child]: 'interrupted' },
    childObligations: { [child]: { commands: { same: 'inProgress' } } } });
  const first = await f.operations.snapshot();
  assert.equal(first.length, 6); assert.equal(new Set(first.map(op => op.id)).size, 6);
  assert.deepEqual(first.map(op => [op.kind, op.status]), [['tool', 'unknown'], ['inference', 'settled'],
    ['tool', 'active'], ['tool', 'settled'], ['child', 'settled'], ['tool', 'active']]);
  assert.ok(first.every(op => op.run_id === f.config.runId && op.attempt === 2 && op.last_progress_at === f.config.startedAt));
  await f.journal.update('attempt-a', { commands: { same: 'completed' } });
  const reopened = new CodexOperations({ ...f.config, journal: new FileJournal(f.journal.directory) });
  const next = await reopened.snapshot();
  assert.deepEqual(next.map(op => op.id), first.map(op => op.id));
  assert.equal(next[2].status, 'settled'); assert.equal(next[5].status, 'active'); assert.equal(next[0].status, 'unknown');
  assert.ok(next.every(op => !Object.hasOwn(op, 'effectsSettled')));
});

test('missing submission remains unknown, and task/attempt identities never share operation IDs', async t => {
  const f = await fixture(t), first = await f.operations.snapshot();
  assert.deepEqual(first.map(op => op.status), ['unknown', 'unknown']);
  const other = await new CodexOperations({ ...f.config, attempt: 3 }).snapshot();
  assert.ok(other.every(op => !first.some(prior => prior.id === op.id)));
  await f.journal.putIfAbsent('attempt-a', { status: 'cancelling', rootSettled: false });
  assert.deepEqual((await f.operations.snapshot()).map(op => op.status), ['unknown', 'cancelling']);
});

test('heartbeat cap fails closed rather than dropping live obligations', async t => {
  const f = await fixture(t);
  await f.journal.putIfAbsent('attempt-a', { status: 'running', commands: Object.fromEntries(Array.from({ length: 98 }, (_, i) => [String(i), 'inProgress'])) });
  assert.equal((await f.operations.snapshot()).length, 100);
  await f.journal.update('attempt-a', { mcpCalls: { overflow: 'inProgress' } });
  await assert.rejects(f.operations.snapshot(), { code: 'NATIVE_OPERATION_LIMIT' });
});

test('file and dynamic lifetimes charge distinct operations even with reused item IDs', async t => {
  const f = await fixture(t), child = '["child","turn"]';
  await f.journal.putIfAbsent('attempt-a', { status: 'finishing', rootSettled: true,
    fileChanges: { same: 'declined' }, dynamicCalls: { same: 'inProgress' },
    childObligations: { [child]: { fileChanges: { same: 'inProgress' }, dynamicCalls: { same: 'failed' } } } });
  const rows = await f.operations.snapshot();
  assert.equal(new Set(rows.map(row => row.id)).size, 6);
  assert.deepEqual(rows.map(row => row.status), ['unknown', 'settled', 'settled', 'active', 'active', 'settled']);
  assert.ok(rows.every(row => row.run_id === f.config.runId && row.attempt === 2));
  assert.deepEqual(await f.operations.snapshot(), rows);
});
