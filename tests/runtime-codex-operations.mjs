import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
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

test('interrupted root and nested spawns settle only invocation, preserving receiver startup and work', async t => {
  const f = await fixture(t), child = '["child","turn"]';
  const timing = { startedAt: '2026-09-14T01:02:00.000Z', lastProgressAt: '2026-09-14T01:03:00.000Z' };
  const inventory = receivers => ({ spawns: { spawn: { status: 'interrupted', receiverThreadIds: receivers } },
    operationTimes: { '["spawns","spawn"]': timing } });
  await f.journal.write('attempt-a', { status: 'finishing', rootSettled: true, ...inventory(['child']),
    childTurns: { [child]: 'inProgress' }, childObligations: { [child]: { ...inventory(['grandchild']), commands: { command: 'inProgress' } } } });
  const before = await f.journal.get('attempt-a'), rows = await f.operations.snapshot();
  assert.deepEqual(rows.map(row => [row.kind, row.status]), [
    ['tool', 'unknown'], ['inference', 'settled'], ['tool', 'settled'], ['child', 'settled'],
    ['child', 'active'], ['tool', 'active'], ['tool', 'settled'], ['child', 'active'],
  ]);
  assert.equal(rows.at(-1).started_at, timing.lastProgressAt);
  assert.equal(rows.at(-1).deadline_at, '2026-09-14T01:05:00.000Z');
  assert.notEqual(rows[2].id, rows[6].id);
  assert.deepEqual(await new CodexOperations(f.config).snapshot(), rows);
  assert.deepEqual(await f.journal.get('attempt-a'), before);
});

test('malformed root and child inventories cannot silently project as empty work', async t => {
  const f = await fixture(t), child = '["child","turn"]';
  const fields = ['commands', 'mcpCalls', 'fileChanges', 'dynamicCalls', 'webSearches', 'sleeps', 'compactions',
    'collabCalls', 'imageGenerations', 'reasoningItems', 'planItems', 'messageStarts', 'spawns'];
  for (const field of fields) for (const value of [null, [], ['inProgress'], false, 0, '', 'PRIVATE_INVENTORY']) {
    for (const nested of [false, true]) {
      const owner = { [field]: value };
      await f.journal.write('attempt-a', { status: 'running', ...(nested ? { childObligations: { [child]: owner } } : owner) });
      const before = await readFile(join(f.journal.directory, 'attempt-a.json'), 'utf8');
      await assert.rejects(f.operations.snapshot(), { code: 'INVALID_OPERATION_INVENTORY', message: 'INVALID_OPERATION_INVENTORY' });
      assert.equal(await readFile(join(f.journal.directory, 'attempt-a.json'), 'utf8'), before);
    }
  }
  for (const value of [null, [], false, 0, '', 'PRIVATE_CHILD']) {
    for (const patch of [{ childTurns: value }, { childObligations: value }, { childObligations: { [child]: value } }]) {
      await f.journal.write('attempt-a', { status: 'running', ...patch });
      await assert.rejects(f.operations.snapshot(), { code: 'INVALID_OPERATION_INVENTORY' });
    }
  }
  await f.journal.write('attempt-a', { status: 'running' });
  const legacy = await f.operations.snapshot();
  await f.journal.write('attempt-a', { status: 'running', ...Object.fromEntries(fields.map(field => [field, {}])), childTurns: {}, childObligations: {} });
  assert.deepEqual(await f.operations.snapshot(), legacy);
  assert.deepEqual(legacy.map(op => op.status), ['unknown', 'active']);
});

test('only valid exact-owner output completions settle message lifetimes', async t => {
  const f = await fixture(t), child = JSON.stringify(['child-a', 'turn-a']);
  for (const childOwner of [false, true]) {
    const write = owner => f.journal.write('attempt-a', { threadId: 'root', nativeRunId: 'turn-a', status: 'running',
      ...(childOwner ? { childTurns: { [child]: 'inProgress' }, childObligations: { [child]: owner }, outputItems: { same: 'a'.repeat(64) } } : owner) });
    for (const outputItems of [null, [], 'text', { same: null }, { same: true }, { same: 'a'.repeat(63) }, { same: 'A'.repeat(64) }, { '': 'a'.repeat(64) }]) {
      await write({ messageStarts: { same: true }, outputItems });
      await assert.rejects(f.operations.snapshot(), { code: 'INVALID_OUTPUT_COMPLETION' });
    }
    await write({ messageStarts: { same: true }, outputItems: { other: 'b'.repeat(64) } });
    const active = await f.operations.snapshot();
    assert.equal(active.at(-1).status, 'active');
    await write({ messageStarts: { same: true }, outputItems: { same: 'b'.repeat(64) } });
    const settled = await f.operations.snapshot();
    assert.equal(settled.at(-1).id, active.at(-1).id);
    assert.equal(settled.at(-1).status, 'settled');
    assert.equal(settled[0].status, 'unknown');
  }
});

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

test('coverage settles only for a pre-admitted matching text-only receipt without forbidden obligations', async t => {
  const f = await fixture(t), pin = { profile_version: 'codex-text-only-v1', profile_sha256: 'a'.repeat(64) };
  await f.journal.write('attempt-a', { threadId: 'thread', nativeRunId: 'turn', status: 'finishing', rootSettled: true,
    nativeOutcome: 'completed', textOnlyProfile: pin,
    textOnlyReceipt: { ...pin, thread_id: 'thread', turn_id: 'turn', output_sha256: 'b'.repeat(64) } });
  const snapshot = () => new CodexOperations({ ...f.config, textOnlyProfile: pin }).snapshot();
  assert.deepEqual((await snapshot()).map(row => row.status), ['settled', 'settled']);
  assert.equal((await f.operations.snapshot())[0].status, 'unknown');
  await f.journal.update('attempt-a', { textOnlyProfile: null });
  assert.equal((await snapshot())[0].status, 'unknown');
  await f.journal.update('attempt-a', { textOnlyProfile: pin });
  await f.journal.update('attempt-a', { commands: { forbidden: 'completed' } });
  assert.equal((await snapshot())[0].status, 'unknown');
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
    spawns: { valid: { status: 'failed' }, invalid: { status: 'declined' }, missing: null },
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

test('acknowledged children retain independent startup deadlines until exact turn evidence', async t => {
  const f = await fixture(t), timing = { startedAt: '2026-09-14T01:09:00.000Z', lastProgressAt: '2026-09-14T01:10:00.000Z' };
  await f.journal.putIfAbsent('attempt-a', { threadId: 'root', nativeRunId: 'turn', status: 'finishing', rootSettled: true,
    spawns: { spawn: { status: 'completed', receiverThreadIds: ['child-a', 'child-b'] } },
    operationTimes: { '["spawns","spawn"]': timing }, childTurns: { '["unrelated","turn"]': 'inProgress' } });
  const before = await f.journal.get('attempt-a');
  const first = (await f.operations.snapshot()).filter(op => op.kind === 'child' && op.deadline_at < f.config.deadlineAt);
  assert.equal(first.length, 2); assert.notEqual(first[0].id, first[1].id);
  assert.ok(first.every(op => op.status === 'active' && op.started_at === timing.lastProgressAt && op.last_progress_at === timing.lastProgressAt && op.deadline_at === '2026-09-14T01:12:00.000Z'));
  assert.deepEqual(await f.journal.get('attempt-a'), before);
  await f.journal.update('attempt-a', { childTurns: { '["child-a","turn"]': 'interrupted', '["child-b","turn"]': 'declined' } });
  const next = (await new CodexOperations(f.config).snapshot()).filter(op => first.some(prior => prior.id === op.id));
  assert.deepEqual(next, [{ ...first[0], status: 'settled' }, first[1]]);
  const capped = await new CodexOperations({ ...f.config, deadlineAt: '2026-09-14T01:11:00.000Z' }).snapshot();
  assert.ok(capped.filter(op => first.some(prior => prior.id === op.id)).every(op => op.deadline_at === '2026-09-14T01:11:00.000Z'));
});

test('nested startup uses its own spawn clock; incomplete and legacy spawns invent no clock', async t => {
  const f = await fixture(t);
  await f.journal.putIfAbsent('attempt-a', { status: 'running', spawns: {
    legacy: { status: 'completed', receiverThreadIds: ['legacy-child'] },
    open: { status: 'inProgress', receiverThreadIds: ['pending-child'] },
  }, operationTimes: { '["spawns","open"]': { startedAt: '2026-09-14T01:02:00.000Z', lastProgressAt: '2026-09-14T01:02:00.000Z' } },
  childObligations: { '["child","turn"]': { spawns: { nested: { status: 'failed', receiverThreadIds: ['grandchild'] } },
    operationTimes: { '["spawns","nested"]': { startedAt: '2026-09-14T01:17:00.000Z', lastProgressAt: '2026-09-14T01:19:00.000Z' } } } } });
  const startups = (await f.operations.snapshot()).filter(op => op.kind === 'child');
  assert.equal(startups.length, 1); assert.equal(startups[0].status, 'active');
  assert.equal(startups[0].started_at, '2026-09-14T01:19:00.000Z'); assert.equal(startups[0].deadline_at, f.config.deadlineAt);
});

test('post-tool quiet phases have independent capped five-minute deadlines without replay progress', async t => {
  const f = await fixture(t), key = '["commands","same"]';
  await f.journal.write('attempt-a', { status: 'finishing', rootSettled: true, commands: { same: 'completed' },
    quietPhases: { [key]: { status: 'completed', startedAt: '2026-09-14T01:10:00.000Z' } },
    childObligations: { '["child","turn"]': { commands: { same: 'completed' },
      quietPhases: { [key]: { status: 'inProgress', startedAt: '2026-09-14T01:18:00.000Z' } } } } });
  const before = await f.journal.get('attempt-a');
  const phases = (await f.operations.snapshot()).filter(op => op.kind === 'inference').slice(1);
  assert.deepEqual(phases.map(op => [op.status, op.started_at, op.deadline_at, op.last_progress_at]), [
    ['settled', '2026-09-14T01:10:00.000Z', '2026-09-14T01:15:00.000Z', '2026-09-14T01:10:00.000Z'],
    ['active', '2026-09-14T01:18:00.000Z', f.config.deadlineAt, '2026-09-14T01:18:00.000Z'],
  ]);
  assert.notEqual(phases[0].id, phases[1].id);
  assert.deepEqual((await new CodexOperations(f.config).snapshot()).filter(op => op.kind === 'inference').slice(1), phases);
  assert.deepEqual(await f.journal.get('attempt-a'), before);
  await f.journal.update('attempt-a', { commands: {} });
  await assert.rejects(f.operations.snapshot(), { code: 'INVALID_QUIET_PHASE' });
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

for (const field of ['reasoningItems', 'planItems'])
test(`${field} uses five-minute independent phase clocks, not tool clocks or root settlement`, async t => {
  const f = await fixture(t), key = JSON.stringify([field, 'same']);
  await f.journal.putIfAbsent('attempt-a', { status: 'finishing', rootSettled: true,
    [field]: { same: 'inProgress', legacy: 'completed', invalid: 'failed' },
    operationTimes: { [key]: { startedAt: '2026-09-14T01:10:00.000Z', lastProgressAt: '2026-09-14T01:10:00.000Z' } },
    childObligations: { '["child","turn"]': { [field]: { same: 'completed' },
      operationTimes: { [key]: { startedAt: '2026-09-14T01:18:00.000Z', lastProgressAt: '2026-09-14T01:18:30.000Z' } } } } });
  const rows = await f.operations.snapshot();
  assert.deepEqual(rows.slice(2).map(row => [row.kind, row.status, row.deadline_at]), [
    ['inference', 'active', '2026-09-14T01:15:00.000Z'], ['inference', 'settled', f.config.deadlineAt],
    ['inference', 'unknown', f.config.deadlineAt], ['inference', 'settled', f.config.deadlineAt],
  ]);
  assert.equal(rows[1].status, 'settled'); assert.equal(new Set(rows.map(row => row.id)).size, 6);
  assert.deepEqual(await new CodexOperations(f.config).snapshot(), rows);
});

for (const child of [false, true]) test(`orphan ${child ? 'child' : 'root'} clocks cannot disappear from live accounting`, async t => {
  const f = await fixture(t), at = '2026-09-14T01:10:00.000Z';
  const timing = { startedAt: at, lastProgressAt: at };
  for (const key of ['["commands","missing"]', '["mcpCalls","same"]', '["unknown","same"]', '["commands", "same"]', '["spawns","missing"]', '["commands","other-owner"]']) {
    const owner = { commands: { same: 'inProgress' }, operationTimes: { [key]: timing } };
    const other = { commands: { 'other-owner': 'inProgress' } };
    await f.journal.write('attempt-a', { status: 'running', ...(child ? other : owner),
      childObligations: { '["child","turn"]': child ? owner : other } });
    const path = f.journal.path('attempt-a'), before = await readFile(path), modified = (await stat(path)).mtimeMs;
    await assert.rejects(f.operations.snapshot(), { code: 'INVALID_OPERATION_TIMING' });
    assert.deepEqual(await readFile(path), before); assert.equal((await stat(path)).mtimeMs, modified);
  }
});

test('clock consumption keeps identical category/item keys independent across owners', async t => {
  const f = await fixture(t), at = '2026-09-14T01:10:00.000Z', later = '2026-09-14T01:17:00.000Z';
  const owner = startedAt => ({ commands: { same: 'inProgress' }, collabCalls: { '["wait","same"]': 'inProgress' },
    spawns: { same: { status: 'inProgress', receiverThreadIds: [] } }, operationTimes: Object.fromEntries(
      [['commands', 'same'], ['collabCalls', '["wait","same"]'], ['spawns', 'same']].map(key => [JSON.stringify(key), { startedAt, lastProgressAt: startedAt }])) });
  await f.journal.write('attempt-a', { status: 'running', ...owner(at), childObligations: { '["child","turn"]': owner(later) } });
  const rows = await f.operations.snapshot();
  assert.deepEqual(rows.slice(2).map(row => row.deadline_at), Array(3).fill('2026-09-14T01:12:00.000Z').concat(Array(3).fill('2026-09-14T01:19:00.000Z')));
  assert.equal(new Set(rows.map(row => row.id)).size, 8);
});

for (const timing of [null, {}, { startedAt: 'invalid', lastProgressAt: 'invalid' },
  { startedAt: '2026-09-14T01:10:00.000Z', lastProgressAt: '2026-09-14T01:09:59.999Z' }]) {
  test(`corrupt phase timing cannot silently fall back to the hard deadline: ${JSON.stringify(timing)}`, async t => {
    const f = await fixture(t);
    await f.journal.putIfAbsent('attempt-a', { commands: { c: 'inProgress' }, operationTimes: { '["commands","c"]': timing } });
    await assert.rejects(f.operations.snapshot(), { code: 'INVALID_OPERATION_TIMING' });
  });
}

test('declared shell-operation deadline extends only clocked commands, capped by the attempt deadline', async t => {
  const f = await fixture(t), child = '[\"child\",\"turn\"]';
  await f.journal.putIfAbsent('attempt-a', { status: 'running', threadId: 'root', nativeRunId: 'turn',
    commands: { clocked: 'inProgress', legacy: 'inProgress' }, mcpCalls: { concurrent: 'inProgress' },
    fileChanges: { change: 'inProgress' }, spawns: { spawn: { status: 'completed', receiverThreadIds: ['child-a'] } },
    quietPhases: { '[\"commands\",\"clocked\"]': { status: 'inProgress', startedAt: '2026-09-14T01:10:00.000Z' } },
    operationTimes: {
      '[\"commands\",\"clocked\"]': { startedAt: '2026-09-14T01:10:00.000Z', lastProgressAt: '2026-09-14T01:10:00.000Z' },
      '[\"mcpCalls\",\"concurrent\"]': { startedAt: '2026-09-14T01:10:00.000Z', lastProgressAt: '2026-09-14T01:10:00.000Z' },
      '[\"fileChanges\",\"change\"]': { startedAt: '2026-09-14T01:10:00.000Z', lastProgressAt: '2026-09-14T01:10:00.000Z' },
      '[\"spawns\",\"spawn\"]': { startedAt: '2026-09-14T01:09:00.000Z', lastProgressAt: '2026-09-14T01:10:00.000Z' },
    },
    childObligations: { [child]: { commands: { nested: 'inProgress' },
      operationTimes: { '[\"commands\",\"nested\"]': { startedAt: '2026-09-14T01:19:30.000Z', lastProgressAt: '2026-09-14T01:19:30.000Z' } } } } });
  const declared = await new CodexOperations({ ...f.config, shellOperationTimeoutMs: 240000 }).snapshot();
  assert.equal(declared.filter(op => op.started_at === '2026-09-14T01:10:00.000Z' && op.status === 'active' && op.kind === 'tool'
      && op.deadline_at === '2026-09-14T01:14:00.000Z').length, 1,
    'only the clocked root command carries the declared four-minute shell deadline');
  assert.equal(declared.filter(op => op.deadline_at === '2026-09-14T01:12:00.000Z').length, 3,
    'concurrent MCP, file changes and child startup still expire at two minutes');
  assert.equal(declared.find(op => op.started_at === '2026-09-14T01:19:30.000Z').deadline_at, '2026-09-14T01:20:00.000Z',
    'a nested clocked command is hard-clamped to the admitted attempt deadline');
  assert.equal(declared.find(op => op.last_progress_at === '2026-09-14T01:19:30.000Z').status, 'active',
    'the clamped nested command stays active until the attempt deadline');
  const legacy = declared.find(op => op.kind === 'tool' && op.started_at === f.config.startedAt && op.status === 'active' &&
    op.deadline_at === f.config.deadlineAt);
  assert.ok(legacy, 'the unclocked legacy command keeps the attempt deadline');
  assert.equal(declared.find(op => op.kind === 'inference' && op.started_at === '2026-09-14T01:10:00.000Z').deadline_at,
    '2026-09-14T01:15:00.000Z', 'quiet phases keep their independent five-minute bound');
  // The same journal projected without a declaration keeps the two-minute
  // command bound, matched by exact operation identity.
  const shellCommand = declared.find(op => op.deadline_at === '2026-09-14T01:14:00.000Z');
  const undeclared = await f.operations.snapshot();
  assert.equal(undeclared.find(op => op.id === shellCommand.id).deadline_at, '2026-09-14T01:12:00.000Z',
    'without a declaration the same clocked command expires at two minutes');
  // A nearer attempt deadline hard-clamps the declared shell bound at the root too.
  const clamped = await new CodexOperations({ ...f.config, deadlineAt: '2026-09-14T01:11:30.000Z', shellOperationTimeoutMs: 240000 }).snapshot();
  assert.equal(clamped.find(op => op.id === shellCommand.id).deadline_at, '2026-09-14T01:11:30.000Z',
    'the exact root command is clamped to the admitted attempt deadline');
});

for (const invalid of [120000, 600001, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '240000', null, true, {}]) {
  test(`shell-operation deadline must be an explicit safe integer in range: ${JSON.stringify(invalid)}`, () => {
    assert.throws(() => new CodexOperations({ journal: { get: async () => null }, attemptId: 'attempt-a',
      runId: '01234567-0123-4123-a123-012345678901', attempt: 1,
      startedAt: '2026-09-14T01:00:00.000Z', deadlineAt: '2026-09-14T01:20:00.000Z',
      shellOperationTimeoutMs: invalid }), { code: 'INVALID_OPERATION_CONFIGURATION' });
  });
}

test('shell-operation deadline boundaries are accepted and frozen with the binding', () => {
  const base = { journal: { get: async () => null }, attemptId: 'attempt-a', runId: '01234567-0123-4123-a123-012345678901',
    attempt: 1, startedAt: '2026-09-14T01:00:00.000Z', deadlineAt: '2026-09-14T01:20:00.000Z' };
  for (const value of [120001, 600000]) {
    const operations = new CodexOperations({ ...base, shellOperationTimeoutMs: value });
    assert.ok(Object.isFrozen(operations.binding), 'the declared deadline is frozen with the binding');
    assert.equal(operations.binding.shellOperationTimeoutMs, value);
  }
  const undeclared = new CodexOperations(base);
  assert.ok(Object.isFrozen(undeclared.binding));
  assert.ok(!Object.hasOwn(undeclared.binding, 'shellOperationTimeoutMs'), 'an undeclared binding keeps its exact shape');
});
