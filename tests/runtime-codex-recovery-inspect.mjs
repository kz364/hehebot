import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, lstat, writeFile, symlink, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { FileJournal } from '../runtime/file-journal.mjs';
import { inspectCodexRecovery } from '../runtime/codex-recovery-inspect.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const boot = '11111111-1111-4111-8111-111111111111', runId = '22222222-2222-4222-8222-222222222222';
const identity = { epoch: 19, boot_id: boot }, attemptId = 'a'.repeat(64);
const childKey = JSON.stringify(['child-43', 'turn-71']);
const canary = 'PRIVATE_PROMPT_AND_TOKEN_CANARY_99';
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'hehe-recovery-inspect-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const journal = new FileJournal(directory), cursor = `dispatch-${hash(identity)}`;
  await journal.write('service', { phase: 'recovery', bootId: boot, identity, ignored: canary });
  await journal.write(cursor, { identity, phase: 'running', attemptId, nativeRunId: 'turn-23',
    claim: { submission_key: `${runId}:7`, run: { id: runId, current_attempt: 7, context_json: canary } } });
  const native = { attemptId, threadId: 'root-19', nativeRunId: 'turn-23', status: 'finishing', rootSettled: true,
    nativeOutcome: 'completed', commands: { 'root-command': 'inProgress' },
    spawns: { spawn: { status: 'completed', receiverThreadIds: ['child-43'], args: canary } },
    childTurns: { [childKey]: 'interrupted' }, childObligations: { [childKey]: { mcpCalls: { 'child-call': 'completed' },
      commands: { 'child-command': 'inProgress' }, ignored: canary } }, prompt: canary, fingerprint: canary };
  await journal.write(attemptId, native);
  await journal.write(`cancel-child-${hash([attemptId, 'child-43', 'turn-71'])}`, { threadId: 'child-43', turnId: 'turn-71', status: 'accepted', ignored: canary });
  // These must not be opened at all (not merely redacted after loading).
  await symlink(join(directory, 'missing-private-credentials'), join(directory, `grant-${attemptId}.json`));
  await writeFile(join(directory, 'auth.json'), canary, { mode: 0o000 });
  return { directory, journal, cursor, native };
}
async function snapshot(directory) {
  return Promise.all((await readdir(directory)).sort().map(async name => {
    const path = join(directory, name), stat = await lstat(path);
    return { name, ino: stat.ino, size: stat.size, mode: stat.mode, mtime: stat.mtimeMs,
      body: stat.isSymbolicLink() || name === 'auth.json' ? null : await readFile(path, 'utf8') };
  }));
}

test('private real journal projects asymmetric identities and obligations without mutation or secret disclosure', async t => {
  const f = await fixture(t), before = await snapshot(f.directory);
  const report = await inspectCodexRecovery(f.directory);
  assert.deepEqual(report.issues, []);
  assert.deepEqual(report.service, { phase: 'recovery', epoch: 19, bootId: boot });
  assert.deepEqual(report.dispatch, { phase: 'running', runId, attempt: 7, attemptId });
  assert.equal(report.native.root.threadId, 'root-19'); assert.equal(report.native.root.turnId, 'turn-23');
  assert.deepEqual(report.native.children, [{ threadId: 'child-43', turnId: 'turn-71', status: 'interrupted', cancelAcknowledgement: 'accepted' }]);
  assert.deepEqual(report.native.observations.filter(row => row.status === 'inProgress'), [
    { threadId: 'root-19', turnId: 'turn-23', kind: 'commands', itemId: 'root-command', status: 'inProgress' },
    { threadId: 'child-43', turnId: 'turn-71', kind: 'commands', itemId: 'child-command', status: 'inProgress' },
  ]);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_|context_json|fingerprint|grant-|auth.json|ignored|prompt/);
  assert.equal(report.resumeAllowed, false); assert.equal(report.sleepAllowed, false); assert.equal(report.recoveryRequired, true);
  assert.deepEqual(await snapshot(f.directory), before);
});

test('initial inference is reported without guessing legacy state or mutating custody', async t => {
  const f = await fixture(t);
  for (const initialInference of ['inProgress', 'completed']) {
    await f.journal.write(attemptId, { ...f.native, initialInference });
    const before = await snapshot(f.directory), report = await inspectCodexRecovery(f.directory);
    assert.equal(report.native.root.initialInference, initialInference); assert.equal(report.resumeAllowed, false);
    assert.deepEqual(await snapshot(f.directory), before);
  }
  await f.journal.write(attemptId, { ...f.native, initialInference: 'failed' });
  assert.equal((await inspectCodexRecovery(f.directory)).native, null);
});

test('usage diagnostics retain separate native snapshots, omit unknown and reject invalid counters', async t => {
  const f = await fixture(t);
  assert.equal(Object.hasOwn((await inspectCodexRecovery(f.directory)).native.root, 'tokenUsage'), false);
  const counts = { inputTokens: 31, cachedInputTokens: 7, cacheWriteInputTokens: 0, outputTokens: 13, reasoningOutputTokens: 5, totalTokens: 44 };
  const usage = { total: counts, last: counts, modelContextWindow: null };
  const childUsage = { ...usage, total: { ...counts, totalTokens: 2 } };
  await f.journal.write(attemptId, { ...f.native, tokenUsage: { ...usage, ignored: canary },
    childObligations: { [childKey]: { ...f.native.childObligations[childKey], tokenUsage: childUsage } } });
  const before = await snapshot(f.directory), report = await inspectCodexRecovery(f.directory);
  assert.deepEqual(report.native.root.tokenUsage, usage);
  assert.deepEqual(report.native.children[0].tokenUsage, childUsage);
  assert.deepEqual(await snapshot(f.directory), before); assert.doesNotMatch(JSON.stringify(report), /PRIVATE_/);
  await f.journal.write(attemptId, { ...f.native, tokenUsage: { ...usage, total: { ...counts, totalTokens: -1 } } });
  assert.equal((await inspectCodexRecovery(f.directory)).native, null);
});

test('child initial phase inspection preserves its clock and rejects missing timing', async t => {
  const f = await fixture(t), phase = { initialInference: 'inProgress', initialInferenceAt: '2026-09-15T01:02:00.000Z' };
  await f.journal.write(attemptId, { ...f.native, childObligations: { [childKey]: phase } });
  const before = await snapshot(f.directory), report = await inspectCodexRecovery(f.directory);
  assert.equal(report.native.children[0].initialInferenceAt, phase.initialInferenceAt);
  assert.equal(report.native.children[0].initialInference, 'inProgress');
  assert.deepEqual(await snapshot(f.directory), before);
  await f.journal.write(attemptId, { ...f.native, childObligations: { [childKey]: { initialInference: 'inProgress' } } });
  assert.equal((await inspectCodexRecovery(f.directory)).native, null);
});

test('quiet phases are content-free, owner-bound observations and malformed state invalidates inspection', async t => {
  const f = await fixture(t), startedAt = '2026-09-15T01:02:00.000Z', key = '["mcpCalls","child-call"]';
  const owner = { ...f.native.childObligations[childKey], quietPhases: { [key]: { startedAt, status: 'completed' } } };
  await f.journal.write(attemptId, { ...f.native, childObligations: { [childKey]: owner } });
  const before = await snapshot(f.directory), report = await inspectCodexRecovery(f.directory);
  assert.deepEqual(report.native.observations.find(row => row.kind === 'quietInference'), {
    threadId: 'child-43', turnId: 'turn-71', kind: 'quietInference', itemId: key,
    status: 'completed', timing: { startedAt, lastProgressAt: startedAt },
  });
  assert.deepEqual(await snapshot(f.directory), before); assert.equal(report.resumeAllowed, false);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_/);
  for (const quietPhases of [null, { '["mcpCalls","missing"]': owner.quietPhases[key] },
    { [key]: { ...owner.quietPhases[key], secret: canary } }]) {
    await f.journal.write(attemptId, { ...f.native, childObligations: { [childKey]: { ...owner, quietPhases } } });
    assert.equal((await inspectCodexRecovery(f.directory)).native, null);
  }
});

test('recovery includes every recorded tool category with exact root/child and collaboration identity', async t => {
  const f = await fixture(t);
  await f.journal.write(attemptId, { ...f.native, fileChanges: { 'file/19': 'declined' }, dynamicCalls: { 'same-item': 'failed' },
    reasoningItems: { reasoning: 'inProgress' },
    webSearches: { search: 'completed' }, sleeps: { sleep: 'inProgress' }, compactions: { compact: 'completed' },
    imageGenerations: { image: 'inProgress' }, collabCalls: { '["wait","same-item"]': 'interrupted', '["sendMessage","same-item"]': 'completed' },
    childObligations: { [childKey]: { ...f.native.childObligations[childKey], dynamicCalls: { 'same-item': 'inProgress' },
      collabCalls: { '["wait","same-item"]': 'inProgress' } } } });
  const before = await snapshot(f.directory), report = await inspectCodexRecovery(f.directory);
  assert.deepEqual(report.issues, []);
  const root = report.native.observations.filter(row => row.threadId === 'root-19');
  for (const [kind, itemId, status] of [['fileChanges', 'file/19', 'declined'], ['dynamicCalls', 'same-item', 'failed'],
    ['webSearches', 'search', 'completed'], ['sleeps', 'sleep', 'inProgress'], ['compactions', 'compact', 'completed'], ['imageGenerations', 'image', 'inProgress'], ['reasoningItems', 'reasoning', 'inProgress']]) {
    assert.deepEqual(root.find(row => row.kind === kind), { threadId: 'root-19', turnId: 'turn-23', kind, itemId, status });
  }
  assert.deepEqual(root.filter(row => row.kind === 'collabCalls').map(({ tool, itemId, status }) => ({ tool, itemId, status })),
    [{ tool: 'wait', itemId: 'same-item', status: 'interrupted' }, { tool: 'sendMessage', itemId: 'same-item', status: 'completed' }]);
  assert.deepEqual(report.native.observations.find(row => row.threadId === 'child-43' && row.kind === 'collabCalls'),
    { threadId: 'child-43', turnId: 'turn-71', kind: 'collabCalls', itemId: 'same-item', status: 'inProgress', tool: 'wait' });
  assert.equal(report.resumeAllowed, false); assert.equal(report.sleepAllowed, false);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_/); assert.deepEqual(await snapshot(f.directory), before);
});

test('inspection preserves exact root and child operation clocks without copying extra fields', async t => {
  const f = await fixture(t);
  const first = { startedAt: '2026-09-15T01:02:00.000Z', lastProgressAt: '2026-09-15T01:03:00.000Z' };
  const second = { startedAt: '2026-09-15T01:04:00.000Z', lastProgressAt: '2026-09-15T01:04:17.000Z' };
  await f.journal.write(attemptId, { ...f.native, operationTimes: { '["commands","root-command"]': { ...first, secret: canary } },
    childObligations: { [childKey]: { ...f.native.childObligations[childKey],
      operationTimes: { '["commands","child-command"]': second } } } });
  const before = await snapshot(f.directory), report = await inspectCodexRecovery(f.directory);
  assert.deepEqual(report.issues, []);
  assert.deepEqual(report.native.observations.find(row => row.itemId === 'root-command').timing, first);
  assert.deepEqual(report.native.observations.find(row => row.itemId === 'child-command').timing, second);
  assert.equal(Object.hasOwn(report.native.observations.find(row => row.itemId === 'child-call'), 'timing'), false);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_|secret/);
  assert.deepEqual(await snapshot(f.directory), before);
  assert.equal(report.resumeAllowed, false); assert.equal(report.sleepAllowed, false);
});

test('clock lookup preserves nested collaboration keys and same item IDs across categories and owners', async t => {
  const f = await fixture(t), at = '2026-09-15T01:02:00.000Z', later = '2026-09-15T01:03:00.000Z';
  const root = { startedAt: at, lastProgressAt: at }, child = { startedAt: later, lastProgressAt: later };
  const categories = ['commands', 'mcpCalls', 'fileChanges', 'dynamicCalls', 'webSearches', 'sleeps', 'compactions', 'imageGenerations', 'reasoningItems'];
  const inventory = Object.fromEntries(categories.map(field => [field, { same: 'inProgress' }]));
  inventory.collabCalls = { '["wait","same"]': 'inProgress', '["sendMessage","same"]': 'completed' };
  const clocks = timing => Object.fromEntries([...categories.map(field => [JSON.stringify([field, 'same']), timing]),
    [JSON.stringify(['collabCalls', '["wait","same"]']), timing], [JSON.stringify(['collabCalls', '["sendMessage","same"]']), timing]]);
  await f.journal.write(attemptId, { ...f.native, ...inventory, operationTimes: {
    ...clocks(root), '["spawns","spawn"]': root }, childObligations: { [childKey]: { ...inventory, operationTimes: clocks(child) } } });
  const report = await inspectCodexRecovery(f.directory);
  assert.deepEqual(report.issues, []);
  assert.equal(report.native.observations.length, 23);
  for (const observation of report.native.observations) assert.deepEqual(observation.timing, observation.threadId === 'root-19' ? root : child);
  assert.deepEqual(report.native.observations.filter(row => row.kind === 'collabCalls').map(row => row.tool), ['wait', 'sendMessage', 'wait', 'sendMessage']);
  await f.journal.write(attemptId, { ...f.native, childObligations: { [childKey]: {
    ...f.native.childObligations[childKey], operationTimes: { '["commands","root-command"]': root } } } });
  assert.equal((await inspectCodexRecovery(f.directory)).native, null);
});

test('invalid or orphan phase clocks reject the entire native report without modification', async t => {
  const f = await fixture(t), at = '2026-09-15T01:02:00.000Z';
  const valid = { startedAt: at, lastProgressAt: at };
  for (const clocks of [null, [], { '["commands","root-command"]': null },
    { '["commands","root-command"]': { startedAt: at } },
    { '["commands","root-command"]': { startedAt: '2026-09-15T01:02:00Z', lastProgressAt: at } },
    { '["commands","root-command"]': { startedAt: at, lastProgressAt: '2026-09-15T01:01:59.999Z' } },
    { '["commands", "root-command"]': valid }, { '["unknown","root-command"]': valid },
    { '["commands","missing"]': valid }, { '["commands","root-command"]': { ...valid, startedAt: canary } }]) {
    await f.journal.write(attemptId, { ...f.native, operationTimes: clocks });
    const before = await snapshot(f.directory), report = await inspectCodexRecovery(f.directory);
    assert.equal(report.native, null); assert.ok(report.issues.includes('NATIVE_RECORD_INVALID_OR_CONTRADICTORY'));
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE_/);
    assert.deepEqual(await snapshot(f.directory), before);
  }
});

test('malformed extended observations reject the native projection instead of hiding active work', async t => {
  const f = await fixture(t);
  for (const patch of [{ dynamicCalls: { item: 'declined' } }, { webSearches: { item: 'failed' } },
    { reasoningItems: { item: 'failed' } },
    { imageGenerations: { item: 'success' } }, { fileChanges: { item: { status: 'completed', secret: canary } } },
    { collabCalls: { '["unknownTool","item"]': 'completed' } }, { collabCalls: { '["wait", "item"]': 'completed' } },
    { collabCalls: { '["wait",19]': 'completed' } }, { collabCalls: { item: 'completed' } }]) {
    await f.journal.write(attemptId, { ...f.native, ...patch });
    const report = await inspectCodexRecovery(f.directory);
    assert.equal(report.native, null); assert.ok(report.issues.includes('NATIVE_RECORD_INVALID_OR_CONTRADICTORY'));
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE_/);
  }
});

test('total observation bound covers all categories rather than allowing each category a full output budget', async t => {
  const f = await fixture(t);
  const many = Object.fromEntries(Array.from({ length: 4096 }, (_, i) => [`item-${i}`, 'inProgress']));
  const row = { ...f.native, commands: {}, spawns: {}, childTurns: {}, childObligations: {}, dynamicCalls: many };
  await f.journal.write(attemptId, row);
  assert.equal((await inspectCodexRecovery(f.directory)).native.observations.length, 4096);
  await f.journal.write(attemptId, { ...row, sleeps: { extra: 'inProgress' } });
  const report = await inspectCodexRecovery(f.directory);
  assert.equal(report.native, null); assert.ok(report.issues.includes('NATIVE_RECORD_INVALID_OR_CONTRADICTORY'));
});

test('question custody survives absent service records and reports only phase counts without writes', async t => {
  const f = await fixture(t);
  for (const [index, phase] of ['waiting', 'take_unknown', 'handoff_unknown', 'resolved'].entries()) {
    const itemId = `private-item-${index}`, key = `question_${hash([attemptId, 'private/thread', 'private/turn', itemId])}`;
    await f.journal.write(key, { version: 1, questionId: runId, connectionId: boot, requestId: index % 2 ? String(index) : index,
      binding: { identity: { ...identity, epoch: 3 }, run_id: boot, attempt: 2, attemptId, deadline_at: '2020-01-01T00:00:00.000Z' },
      threadId: 'private/thread', turnId: 'private/turn', itemId, inputSha256: 'b'.repeat(64), phase,
      resolutionObserved: ['take_unknown', 'resolved'].includes(phase) });
  }
  await rm(join(f.directory, 'service.json'));
  const before = await snapshot(f.directory), report = await inspectCodexRecovery(f.directory);
  assert.deepEqual(report.questions, { complete: true, total: 4, unresolved: 3, resolutionObserved: 2,
    phases: { waiting: 1, take_unknown: 1, handoff_unknown: 1, resolved: 1 } });
  assert.ok(report.issues.includes('QUESTION_CUSTODY_UNRESOLVED')); assert.ok(report.issues.includes('RECORD_MISSING'));
  assert.doesNotMatch(JSON.stringify(report), /private|inputSha256|questionId|connectionId/);
  assert.equal(report.resumeAllowed, false); assert.equal(report.sleepAllowed, false);
  assert.deepEqual(await snapshot(f.directory), before);
});

test('invalid question phase, identity, filename, secret fields and links make counts explicitly incomplete', async t => {
  const f = await fixture(t), key = `question_${hash([attemptId, 'thread', 'turn', 'item'])}`;
  const row = { version: 1, questionId: runId, connectionId: boot, requestId: '71',
    binding: { identity, run_id: runId, attempt: 7, attemptId, deadline_at: '2026-09-15T00:00:00.000Z' },
    threadId: 'thread', turnId: 'turn', itemId: 'item', inputSha256: 'c'.repeat(64), phase: 'resolved', resolutionObserved: true };
  for (const patch of [{ phase: 'accepted' }, { resolutionObserved: false }, { questionId: 71 }, { questionId: '0'.repeat(36) }, { requestId: {} },
    { itemId: 'different-item' }, { answers: canary }, { binding: { ...row.binding, attempt: 0 } }]) {
    await f.journal.write(key, { ...row, ...patch });
    const report = await inspectCodexRecovery(f.directory);
    assert.equal(report.questions.complete, false); assert.equal(report.questions.total, 0);
    assert.ok(report.issues.includes('QUESTION_RECORD_INVALID_OR_UNREADABLE')); assert.doesNotMatch(JSON.stringify(report), /PRIVATE_/);
  }
  await f.journal.write(key, row);
  assert.deepEqual((await inspectCodexRecovery(f.directory)).questions,
    { complete: true, total: 1, unresolved: 0, resolutionObserved: 1, phases: { resolved: 1 } });
  await rm(join(f.directory, `${key}.json`));
  await symlink('/does-not-exist', join(f.directory, `${key}.json`));
  assert.equal((await inspectCodexRecovery(f.directory)).questions.complete, false);
  await rm(join(f.directory, `${key}.json`));
  await writeFile(join(f.directory, `${key}.json`), ' '.repeat(16385), { mode: 0o600 });
  assert.equal((await inspectCodexRecovery(f.directory)).questions.complete, false);
  await rm(join(f.directory, `${key}.json`));
  await writeFile(join(f.directory, 'question_bad.json'), canary, { mode: 0o600 });
  assert.equal((await inspectCodexRecovery(f.directory)).questions.complete, false);
});

test('question scan stops at bounded candidate count instead of reporting a complete empty inventory', async t => {
  const f = await fixture(t);
  for (let index = 0; index < 4096; index++) await writeFile(join(f.directory, `question_bad_${index}`), '', { mode: 0o600 });
  assert.equal((await inspectCodexRecovery(f.directory)).issues.includes('QUESTION_SCAN_INCOMPLETE'), false);
  await writeFile(join(f.directory, 'question_bad_4096'), '', { mode: 0o600 });
  const report = await inspectCodexRecovery(f.directory);
  assert.equal(report.questions.complete, false); assert.ok(report.issues.includes('QUESTION_SCAN_INCOMPLETE'));
  assert.equal(report.resumeAllowed, false); assert.equal(report.sleepAllowed, false);
});

test('missing records and unknown claim never infer a native binding from stale attempt fields', async t => {
  const f = await fixture(t);
  await f.journal.update(f.cursor, { phase: 'claim_unknown', claim: null });
  let report = await inspectCodexRecovery(f.directory);
  assert.equal(report.native, null); assert.ok(report.issues.includes('DISPATCH_NATIVE_BINDING_UNKNOWN'));
  assert.equal(report.dispatch.attemptId, null);
  await f.journal.update(f.cursor, { phase: 'claimed', claim: {
    submission_key: `${boot}:11`, run: { id: boot, current_attempt: 11 },
  } });
  report = await inspectCodexRecovery(f.directory);
  assert.equal(report.dispatch.runId, boot); assert.equal(report.dispatch.attempt, 11);
  assert.equal(report.dispatch.attemptId, null); assert.equal(report.native, null);
  await rm(join(f.directory, `${f.cursor}.json`));
  report = await inspectCodexRecovery(f.directory); assert.ok(report.issues.includes('RECORD_MISSING'));
  await f.journal.write('service', { phase: 'boot_unknown', bootId: boot });
  report = await inspectCodexRecovery(f.directory);
  assert.equal(report.service.epoch, null); assert.equal(report.service.bootId, boot);
  assert.ok(report.issues.includes('SERVICE_IDENTITY_UNKNOWN'));
  await rm(join(f.directory, 'service.json'));
  assert.ok((await inspectCodexRecovery(f.directory)).issues.includes('RECORD_MISSING'));
});

test('contradictory boot, dispatch, root, child origin and cancellation records remain unknown', async t => {
  const f = await fixture(t);
  await f.journal.update('service', { bootId: runId });
  assert.ok((await inspectCodexRecovery(f.directory)).issues.includes('SERVICE_RECORD_INVALID'));
  await f.journal.update('service', { bootId: boot });
  await f.journal.update(f.cursor, { identity: { ...identity, epoch: 43 } });
  assert.ok((await inspectCodexRecovery(f.directory)).issues.includes('DISPATCH_RECORD_INVALID'));
  await f.journal.update(f.cursor, { identity });
  for (const patch of [{ nativeRunId: 'wrong-turn' }, { attemptId: 'b'.repeat(64) },
    { spawns: {} }, { rootSettled: true, nativeOutcome: 'inProgress' },
    { rootSettled: false }, { childObligations: { [childKey]: canary } },
    { childObligations: { '["other","turn"]': {} } }, { commands: { item: canary } }]) {
    await f.journal.write(attemptId, { ...f.native, ...patch });
    const report = await inspectCodexRecovery(f.directory);
    assert.equal(report.native, null); assert.ok(report.issues.includes('NATIVE_RECORD_INVALID_OR_CONTRADICTORY'));
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE_/);
  }
  await f.journal.write(attemptId, f.native);
  await f.journal.update(`cancel-child-${hash([attemptId, 'child-43', 'turn-71'])}`, { turnId: 'wrong-turn' });
  assert.equal((await inspectCodexRecovery(f.directory)).native, null);
});

test('unsafe files, symlinks, corruption, oversize and noncanonical directories fail without disclosure', async t => {
  const f = await fixture(t), path = join(f.directory, 'service.json');
  for (const body of [canary, '[]', 'x'.repeat(1048577)]) {
    await writeFile(path, body);
    const report = await inspectCodexRecovery(f.directory);
    assert.ok(report.issues.includes('RECORD_UNREADABLE_OR_CHANGED')); assert.doesNotMatch(JSON.stringify(report), /PRIVATE_/);
  }
  await writeFile(path, '{}'); await chmod(path, 0o644);
  assert.ok((await inspectCodexRecovery(f.directory)).issues.includes('RECORD_UNREADABLE_OR_CHANGED'));
  await rm(path); await symlink('/does-not-exist', path);
  assert.ok((await inspectCodexRecovery(f.directory)).issues.includes('RECORD_UNREADABLE_OR_CHANGED'));
  assert.ok((await inspectCodexRecovery(f.directory + '/.')).issues.includes('PRIVATE_CANONICAL_DIRECTORY_REQUIRED'));
  assert.ok((await inspectCodexRecovery(join(f.directory, 'missing'))).issues.includes('PRIVATE_CANONICAL_DIRECTORY_REQUIRED'));
});

test('terminal observations and accepted cancellation never authorize recovery or sleep; missing child turn stays unknown', async t => {
  const f = await fixture(t);
  await f.journal.write(attemptId, { ...f.native, commands: {}, childObligations: {} });
  let report = await inspectCodexRecovery(f.directory);
  assert.equal(report.recoveryRequired, true); assert.equal(report.resumeAllowed, false); assert.equal(report.sleepAllowed, false);
  await f.journal.write(attemptId, { ...f.native, childTurns: {}, childObligations: {} });
  report = await inspectCodexRecovery(f.directory); assert.ok(report.issues.includes('CHILD_TURN_UNKNOWN'));
  assert.deepEqual(report.native.observations.find(item => item.kind === 'spawns').receiverThreadIds, ['child-43']);
});

test('CLI under existing kernel directory lock emits only read-only diagnostic JSON', async t => {
  const f = await fixture(t), before = await snapshot(f.directory);
  const { stdout, stderr } = await promisify(execFile)('flock', ['--nonblock', '--conflict-exit-code', '73', '--no-fork', f.directory,
    process.execPath, 'runtime/codex-recovery-inspect.mjs', f.directory]);
  assert.equal(stderr, ''); assert.equal(JSON.parse(stdout).resumeAllowed, false); assert.doesNotMatch(stdout, /PRIVATE_/);
  await assert.rejects(promisify(execFile)('flock', ['--no-fork', f.directory,
    'flock', '--nonblock', '--conflict-exit-code', '73', '--no-fork', f.directory,
    process.execPath, 'runtime/codex-recovery-inspect.mjs', f.directory]), error => error.code === 73 && error.stdout === '');
  assert.deepEqual(await snapshot(f.directory), before);
});
