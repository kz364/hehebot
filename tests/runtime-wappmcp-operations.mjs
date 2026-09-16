import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileJournal } from '../runtime/file-journal.mjs';
import { CodexOperations } from '../runtime/codex-operations.mjs';
import { readJournaledWappMcp } from '../runtime/wappmcp-operations.mjs';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const tool = 'whatsapp_get_chat_messages';
const grant = { chatIds: ['PRIVATE_CHAT@g.us'], tools: [tool] };
const reply = { structuredContent: [] };
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'hehe-wapp-operations-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const journal = new FileJournal(directory), attemptId = 'attempt-19';
  await journal.putIfAbsent(attemptId, { attemptId, status: 'running', rootSettled: false });
  const options = { deadlineAt: new Date(Date.now() + 60000).toISOString(), authorize: () => true };
  const config = { journal, attemptId, runId: '01234567-0123-4123-a123-012345678901', attempt: 3,
    startedAt: new Date().toISOString(), deadlineAt: options.deadlineAt };
  const read = (operationId, call, extra = {}, binding = {}) => readJournaledWappMcp(
    { journal, attemptId, operationId, ...binding }, grant, tool, { chatId: grant.chatIds[0] }, call, { ...options, ...extra });
  return { journal, attemptId, options, config, read, snapshot: () => new CodexOperations(config).snapshot() };
}

test('fsynced intent precedes dispatch; actual response settles only invocation and payload never enters journal', async t => {
  const f = await fixture(t);
  let before;
  const result = await f.read('read-47', async (_, __, { deadlineAt }) => {
    const row = await new FileJournal(f.journal.directory).get(f.attemptId);
    assert.equal(row.whatsappReads['read-47'].status, 'intent');
    assert.equal(row.whatsappReads['read-47'].deadlineAt, deadlineAt);
    before = await f.snapshot(); assert.equal(before[2].status, 'unknown');
    return reply;
  });
  assert.deepEqual(result, { chatId: grant.chatIds[0], coverage: 'unknown', messages: [] });
  const after = await f.snapshot();
  assert.equal(after[2].status, 'settled'); assert.equal(after[2].id, before[2].id);
  assert.equal(after[2].last_progress_at, before[2].last_progress_at);
  assert.equal(after[0].status, 'unknown');
  assert.doesNotMatch(await readFile(f.journal.path(f.attemptId), 'utf8'), /PRIVATE_CHAT|structuredContent|messages/);
  let replays = 0;
  await assert.rejects(f.read('read-47', () => { replays++; return reply; }), { code: 'WHATSAPP_READ_FAILED' });
  assert.equal(replays, 0);
});

test('timeout, SDK rejection and late response retain unknown records across reconstruction and forbid replay', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const f = await fixture(t), dispatched = deferred(), late = deferred();
  const result = f.read('timed-19', async () => { dispatched.resolve(); return late.promise; }, {
    authorize: () => ({ allowed: true, deadline_at: new Date(37).toISOString() }),
  });
  const rejected = assert.rejects(result, { code: 'WHATSAPP_READ_STOPPED' });
  await dispatched.promise;
  t.mock.timers.tick(36); assert.equal((await f.snapshot())[2].deadline_at, new Date(37).toISOString());
  t.mock.timers.tick(1); await rejected;
  const before = await f.journal.get(f.attemptId);
  late.resolve(reply); await new Promise(setImmediate);
  assert.deepEqual(await f.journal.get(f.attemptId), before);
  await assert.rejects(f.read('failed-83', async () => { throw Error('PRIVATE_SDK_ERROR'); }), { code: 'WHATSAPP_READ_FAILED' });
  const reopened = new FileJournal(f.journal.directory);
  const rows = await new CodexOperations({ ...f.config, journal: reopened }).snapshot();
  assert.deepEqual(rows.slice(2).map(row => row.status), ['unknown', 'unknown']);
  let replays = 0;
  await assert.rejects(f.read('timed-19', () => { replays++; return reply; }, {}, { journal: reopened }), { code: 'WHATSAPP_READ_FAILED' });
  assert.equal(replays, 0);
  assert.doesNotMatch(JSON.stringify(await reopened.get(f.attemptId)), /PRIVATE_SDK/);
});

test('concurrent sibling reads preserve both intents and cancellation cannot settle the cancelled read', async t => {
  const f = await fixture(t), started = deferred(), late = deferred(), controller = new AbortController();
  const first = f.read('read-a', async () => { started.resolve(); return late.promise; }, { signal: controller.signal });
  const rejected = assert.rejects(first, { code: 'WHATSAPP_READ_STOPPED' });
  await started.promise;
  const second = await f.read('read-b', async () => reply);
  controller.abort(); await rejected; late.resolve(reply); await new Promise(setImmediate);
  assert.deepEqual(second.messages, []);
  const records = (await f.journal.get(f.attemptId)).whatsappReads;
  assert.equal(records['read-a'].status, 'intent'); assert.equal(records['read-b'].status, 'response');
  await f.journal.update(f.attemptId, { status: 'finishing', rootSettled: true });
  assert.deepEqual((await f.snapshot()).map(row => row.status), ['unknown', 'settled', 'unknown', 'settled']);
});

test('blocked intent/response writes stay bounded; late persistence cannot dispatch or release data', async t => {
  for (const holdAt of [1, 2]) {
    const f = await fixture(t), entered = deferred(), release = deferred(), written = deferred(), controller = new AbortController();
    const write = f.journal.write.bind(f.journal); let calls = 0, writes = 0;
    f.journal.write = async (...args) => {
      if (++writes !== holdAt) return write(...args);
      entered.resolve(); await release.promise; const row = await write(...args); written.resolve(); return row;
    };
    const result = f.read('blocked-41', () => { calls++; return reply; }, { signal: controller.signal });
    const rejected = assert.rejects(result, { code: 'WHATSAPP_READ_STOPPED' });
    await entered.promise; controller.abort(); await rejected;
    release.resolve(); await written.promise; await f.journal.serial(async () => {});
    assert.equal(calls, holdAt - 1);
    const operations = await f.snapshot();
    // A response observed before abort may finish persisting afterward, but it
    // cannot return data to the cancelled caller or settle browser coverage.
    assert.equal(operations[2].status, holdAt === 1 ? 'unknown' : 'settled');
    assert.equal(operations[0].status, 'unknown');
  }
});

test('intent write failure prevents dispatch; lost response write retains uncertainty without retry', async t => {
  for (const failAt of [1, 2]) {
    const f = await fixture(t), write = f.journal.write.bind(f.journal); let writes = 0, calls = 0;
    f.journal.write = async (...args) => { if (++writes === failAt) throw Error('PRIVATE_DISK'); return write(...args); };
    await assert.rejects(f.read('write-failed', async () => { calls++; return reply; }), { code: 'WHATSAPP_READ_FAILED' });
    assert.equal(calls, failAt - 1);
    const row = await f.journal.get(f.attemptId);
    if (failAt === 1) assert.equal(row.whatsappReads, undefined);
    else assert.equal(row.whatsappReads['write-failed'].status, 'intent');
  }
});

test('authority revoked while intent persists prevents dispatch and retains non-replayable intent', async t => {
  const f = await fixture(t), write = f.journal.write.bind(f.journal);
  let persisted = false, calls = 0;
  f.journal.write = async (...args) => { const row = await write(...args); persisted = true; return row; };
  await assert.rejects(f.read('revoked-at-write', () => { calls++; return reply; }, {
    authorize: () => !persisted,
  }));
  assert.equal(calls, 0, 'revoked authority must be checked after the durable intent wait');
  assert.equal((await f.journal.get(f.attemptId)).whatsappReads['revoked-at-write'].status, 'intent');
  await assert.rejects(f.read('revoked-at-write', () => { calls++; return reply; }));
  assert.equal(calls, 0);
});

for (const completedAt of [36, 37]) test(`post-intent authority cap bounds transport at ${completedAt}ms`, async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const f = await fixture(t), entered = deferred(), released = deferred();
  let checks = 0;
  const result = f.read('tightened', async (_, __, options) => {
    assert.equal(options.deadlineAt, new Date(37).toISOString());
    assert.deepEqual(Object.keys(options).sort(), ['deadlineAt', 'signal']);
    entered.resolve(); return released.promise;
  }, { authorize: request => {
    assert.deepEqual(request, { name: tool, chatId: grant.chatIds[0] });
    assert.equal(Object.isFrozen(request), true);
    return { allowed: true, deadline_at: new Date(++checks === 2 ? 37 : 100).toISOString() };
  } });
  const observed = result.then(value => ({ value }), error => ({ error }));
  await entered.promise;
  // The durable intent keeps its original custody bound; later checks may only
  // tighten the live wait, never rewrite intent or imply settlement on timeout.
  assert.equal((await f.journal.get(f.attemptId)).whatsappReads.tightened.deadlineAt, new Date(100).toISOString());
  t.mock.timers.tick(completedAt); released.resolve(reply);
  const outcome = await observed;
  if (completedAt === 36) {
    assert.deepEqual(outcome.value, { chatId: grant.chatIds[0], messages: [], coverage: 'unknown' });
    assert.equal(checks, 3);
  } else {
    assert.equal(outcome.error.code, 'WHATSAPP_READ_STOPPED');
    await new Promise(setImmediate);
    assert.equal((await f.journal.get(f.attemptId)).whatsappReads.tightened.status, 'intent');
  }
});

test('tightened cap guards response persistence even before its timer callback runs', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const f = await fixture(t); let checks = 0;
  await assert.rejects(f.read('clock-before-timer', () => {
    t.mock.timers.setTime(37); // Move the clock without running timer callbacks.
    return reply;
  }, { authorize: () => ({ allowed: true, deadline_at: new Date(++checks === 2 ? 37 : 100).toISOString() }) }));
  assert.equal((await f.journal.get(f.attemptId)).whatsappReads['clock-before-timer'].status, 'intent');
});

for (const reason of ['timeout', 'cancel']) test(`post-intent authorization ${reason} never dispatches after a late allow`, async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const f = await fixture(t), entered = deferred(), late = deferred(), controller = new AbortController();
  let checks = 0, calls = 0;
  const result = f.read('pending-check', () => { calls++; return reply; }, {
    deadlineAt: new Date(37).toISOString(), signal: controller.signal,
    authorize: () => { if (++checks === 1) return true; entered.resolve(); return late.promise; },
  });
  const rejected = assert.rejects(result, { code: 'WHATSAPP_READ_STOPPED' });
  await entered.promise;
  if (reason === 'cancel') controller.abort(); else t.mock.timers.tick(37);
  await rejected;
  late.resolve({ allowed: true, deadline_at: new Date(500).toISOString() });
  await new Promise(setImmediate); t.mock.timers.tick(1000);
  assert.equal(calls, 0);
  assert.equal((await f.journal.get(f.attemptId)).whatsappReads['pending-check'].status, 'intent');
  assert.equal(checks, 2);
});

test('invalid authority and foreign or terminal attempt deny without creating an operation', async t => {
  const f = await fixture(t); let calls = 0;
  const call = () => { calls++; return reply; };
  await assert.rejects(f.read('denied', call, { authorize: () => false }), { code: 'WHATSAPP_READ_DENIED' });
  for (const patch of [{ attemptId: 'other' }, { attemptId: f.attemptId, status: 'cancelling' },
    { status: 'running', rootSettled: true }]) {
    await f.journal.update(f.attemptId, patch);
    await assert.rejects(f.read('denied', call), { code: 'WHATSAPP_READ_FAILED' });
    assert.equal((await f.journal.get(f.attemptId)).whatsappReads, undefined);
  }
  assert.throws(() => f.read('bad', call, { authorize: undefined }), { code: 'WHATSAPP_OPERATION_INVALID' });
  assert.throws(() => f.read('bad', call, { deadlineAt: undefined }), { code: 'WHATSAPP_OPERATION_INVALID' });
  assert.equal(calls, 0);
});

test('corrupt retained records fail projection and dispatch without repair or omission', async t => {
  const f = await fixture(t), valid = { status: 'intent', startedAt: f.config.startedAt, deadlineAt: f.config.deadlineAt };
  for (const whatsappReads of [null, [], { read: {} }, { read: { ...valid, status: 'cancelled' } },
    { read: { ...valid, extra: true } }, { read: { ...valid, deadlineAt: valid.startedAt } },
    { read: { ...valid, deadlineAt: new Date(Date.parse(valid.startedAt) + 120001).toISOString() } }]) {
    await f.journal.update(f.attemptId, { whatsappReads });
    const before = await readFile(f.journal.path(f.attemptId), 'utf8');
    await assert.rejects(f.snapshot(), { code: 'WHATSAPP_OPERATION_INVALID' });
    let calls = 0;
    await assert.rejects(f.read('new', () => { calls++; return reply; }), { code: 'WHATSAPP_READ_FAILED' });
    assert.equal(calls, 0);
    assert.equal(await readFile(f.journal.path(f.attemptId), 'utf8'), before);
  }
});

test('simultaneous intents preserve siblings and an identical ID can dispatch only once', async t => {
  const f = await fixture(t); let calls = 0;
  const call = async () => { calls++; return reply; };
  const results = await Promise.allSettled([f.read('first', call), f.read('second', call), f.read('first', call)]);
  assert.deepEqual(results.map(result => result.status), ['fulfilled', 'fulfilled', 'rejected']);
  assert.equal(calls, 2);
  assert.deepEqual(Object.keys((await f.journal.get(f.attemptId)).whatsappReads).sort(), ['first', 'second']);
});
