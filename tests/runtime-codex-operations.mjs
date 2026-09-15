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

test('snapshot spans heartbeat pages but fails closed at its bounded inventory limit', async t => {
  const f = await fixture(t);
  await f.journal.putIfAbsent('attempt-a', { status: 'running', commands: Object.fromEntries(Array.from({ length: 4094 }, (_, i) => [String(i), i % 3 ? 'completed' : 'inProgress'])) });
  const rows = await f.operations.snapshot();
  assert.equal(rows.length, 4096);
  assert.equal(new Set(rows.map(row => row.id)).size, 4096);
  assert.equal(rows.at(-1).status, 'settled');
  assert.equal(rows.at(-2).status, 'active');
  assert.equal(rows[0].status, 'unknown');
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

test('statusless and collaboration lifetimes remain separate from coverage and inference', async t => {
  const f = await fixture(t);
  await f.journal.putIfAbsent('attempt-a', { status: 'running', webSearches: { same: 'completed' },
    sleeps: { same: 'inProgress' }, compactions: { same: 'completed' }, collabCalls: { '["wait","same"]': 'interrupted' }, imageGenerations: { same: 'inProgress' } });
  const rows = await f.operations.snapshot();
  assert.equal(new Set(rows.map(row => row.id)).size, 7);
  assert.deepEqual(rows.map(row => row.status), ['unknown', 'active', 'settled', 'active', 'settled', 'settled', 'active']);
  assert.ok(rows.every(row => row.last_progress_at === f.config.startedAt));
});

for (const child of [false, true]) test(`invalid ${child ? 'child' : 'root'} tool statuses remain unknown rather than borrowing another kind's terminal enum`, async t => {
  const f = await fixture(t), key = '["child","turn"]';
  const owner = {
    commands: { valid: 'declined', invalid: 'interrupted' },
    mcpCalls: { valid: 'failed', invalid: 'declined' },
    fileChanges: { valid: 'declined', invalid: 'interrupted' },
    dynamicCalls: { valid: 'completed', invalid: 'interrupted' },
    webSearches: { valid: 'completed', invalid: 'failed' },
    sleeps: { valid: 'completed', invalid: 'declined' },
    compactions: { valid: 'completed', invalid: 'failed' },
    collabCalls: { '["wait","valid"]': 'interrupted', '["wait","invalid"]': 'declined' },
    imageGenerations: { valid: 'completed', invalid: 'interrupted' },
    spawns: { valid: { status: 'failed' }, invalid: { status: 'interrupted' }, missing: null },
  };
  await f.journal.putIfAbsent('attempt-a', { status: 'running', threadId: 'root', nativeRunId: 'turn', rootSettled: false,
    ...(child ? { childObligations: { [key]: owner } } : owner) });
  const before = await f.journal.get('attempt-a');
  const rows = await f.operations.snapshot();
  assert.deepEqual(rows.slice(2).map(row => row.status), [...Array.from({ length: 10 }, () => ['settled', 'unknown']).flat(), 'unknown']);
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  assert.deepEqual(await f.journal.get('attempt-a'), before);
  assert.deepEqual(await f.operations.snapshot(), rows);
  assert.equal(rows[0].status, 'unknown');
});

test('child turn status accepts interruption but never tool-only decline', async t => {
  const f = await fixture(t);
  await f.journal.putIfAbsent('attempt-a', { status: 'running', childTurns: {
    '["child-a","turn"]': 'interrupted', '["child-b","turn"]': 'declined', '["child-c","turn"]': 'inProgress',
  } });
  assert.deepEqual((await f.operations.snapshot()).slice(2).map(row => [row.kind, row.status]),
    [['child', 'settled'], ['child', 'unknown'], ['child', 'active']]);
});

test('late root and child tools use independent two-minute clocks capped by the task deadline', async t => {
  const f = await fixture(t), key = '["commands","same"]';
  await f.journal.putIfAbsent('attempt-a', { status: 'running', commands: { same: 'inProgress' },
    operationTimes: { [key]: { startedAt: '2026-09-14T01:10:00.000Z', lastProgressAt: '2026-09-14T01:10:00.000Z' } },
    childObligations: { '["child","turn"]': { commands: { same: 'inProgress' },
      operationTimes: { [key]: { startedAt: '2026-09-14T01:19:30.000Z', lastProgressAt: '2026-09-14T01:19:30.000Z' } } } } });
  const before = await f.journal.get('attempt-a'), rows = await f.operations.snapshot();
  assert.deepEqual(rows.slice(2).map(row => [row.started_at, row.deadline_at, row.last_progress_at]), [
    ['2026-09-14T01:10:00.000Z', '2026-09-14T01:12:00.000Z', '2026-09-14T01:10:00.000Z'],
    ['2026-09-14T01:19:30.000Z', '2026-09-14T01:20:00.000Z', '2026-09-14T01:19:30.000Z'],
  ]);
  assert.notEqual(rows[2].id, rows[3].id);
  assert.deepEqual(await new CodexOperations(f.config).snapshot(), rows);
  assert.deepEqual(await f.journal.get('attempt-a'), before);
});

test('initial silence has a replay-stable five-minute bound distinct from root and coverage', async t => {
  const f = await fixture(t);
  await f.journal.putIfAbsent('attempt-a', { status: 'running', initialInference: 'inProgress' });
  const rows = await f.operations.snapshot();
  assert.equal(rows.length, 3); assert.equal(rows[2].kind, 'inference'); assert.equal(rows[2].status, 'active');
  assert.equal(rows[2].deadline_at, '2026-09-14T01:05:00.000Z'); assert.equal(rows[1].deadline_at, f.config.deadlineAt);
  assert.deepEqual(await new CodexOperations(f.config).snapshot(), rows);
  await f.journal.update('attempt-a', { initialInference: 'completed' });
  const completed = await f.operations.snapshot();
  assert.deepEqual(completed[2], { ...rows[2], status: 'settled' }); assert.equal(completed[1].status, 'active');
  const capped = await new CodexOperations({ ...f.config, deadlineAt: '2026-09-14T01:03:00.000Z' }).snapshot();
  assert.equal(capped[2].deadline_at, '2026-09-14T01:03:00.000Z');
  await f.journal.update('attempt-a', { initialInference: 'failed' });
  await assert.rejects(f.operations.snapshot(), { code: 'INVALID_OPERATION_TIMING' });
});

test('child initial phase is independent, capped, replay stable and refuses incomplete clocks', async t => {
  const f = await fixture(t), key = '["child","turn"]';
  const child = { initialInference: 'inProgress', initialInferenceAt: '2026-09-14T01:17:00.000Z' };
  await f.journal.putIfAbsent('attempt-a', { status: 'finishing', rootSettled: true,
    childTurns: { [key]: 'inProgress' }, childObligations: { [key]: child } });
  const first = await f.operations.snapshot(), phase = first.at(-1);
  assert.equal(phase.kind, 'inference'); assert.equal(phase.status, 'active');
  assert.equal(phase.started_at, child.initialInferenceAt); assert.equal(phase.deadline_at, f.config.deadlineAt);
  const uncapped = await new CodexOperations({ ...f.config, deadlineAt: '2026-09-14T01:30:00.000Z' }).snapshot();
  assert.equal(uncapped.at(-1).deadline_at, '2026-09-14T01:22:00.000Z');
  assert.deepEqual(await new CodexOperations(f.config).snapshot(), first);
  await f.journal.update('attempt-a', { childObligations: { [key]: { ...child, initialInference: 'completed' } } });
  assert.deepEqual((await f.operations.snapshot()).at(-1), { ...phase, status: 'settled' });
  for (const invalid of [{ initialInference: 'inProgress' }, { initialInferenceAt: child.initialInferenceAt }, { ...child, initialInferenceAt: 'bad' }]) {
    await f.journal.update('attempt-a', { childObligations: { [key]: invalid } });
    await assert.rejects(f.operations.snapshot(), { code: 'INVALID_OPERATION_TIMING' });
  }
});

test('reasoning uses five-minute independent phase clocks, not tool clocks or root settlement', async t => {
  const f = await fixture(t), key = '["reasoningItems","same"]';
  await f.journal.putIfAbsent('attempt-a', { status: 'finishing', rootSettled: true,
    reasoningItems: { same: 'inProgress', legacy: 'completed', invalid: 'failed' },
    operationTimes: { [key]: { startedAt: '2026-09-14T01:10:00.000Z', lastProgressAt: '2026-09-14T01:10:00.000Z' } },
    childObligations: { '["child","turn"]': { reasoningItems: { same: 'completed' },
      operationTimes: { [key]: { startedAt: '2026-09-14T01:18:00.000Z', lastProgressAt: '2026-09-14T01:18:30.000Z' } } } } });
  const rows = await f.operations.snapshot();
  assert.deepEqual(rows.slice(2).map(row => [row.kind, row.status, row.deadline_at]), [
    ['inference', 'active', '2026-09-14T01:15:00.000Z'], ['inference', 'settled', f.config.deadlineAt],
    ['inference', 'unknown', f.config.deadlineAt], ['inference', 'settled', f.config.deadlineAt],
  ]);
  assert.equal(rows[1].status, 'settled'); assert.equal(new Set(rows.map(row => row.id)).size, 6);
  assert.deepEqual(await new CodexOperations(f.config).snapshot(), rows);
});

for (const timing of [null, {}, { startedAt: 'invalid', lastProgressAt: 'invalid' },
  { startedAt: '2026-09-14T01:10:00.000Z', lastProgressAt: '2026-09-14T01:09:59.999Z' }]) {
  test(`corrupt phase timing cannot silently fall back to the hard deadline: ${JSON.stringify(timing)}`, async t => {
    const f = await fixture(t);
    await f.journal.putIfAbsent('attempt-a', { commands: { c: 'inProgress' }, operationTimes: { '["commands","c"]': timing } });
    await assert.rejects(f.operations.snapshot(), { code: 'INVALID_OPERATION_TIMING' });
  });
}
