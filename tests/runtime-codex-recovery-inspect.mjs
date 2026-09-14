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
