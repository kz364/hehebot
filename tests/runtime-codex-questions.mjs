import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter, getEventListeners } from 'node:events';
import { PassThrough } from 'node:stream';
import { FileJournal } from '../runtime/file-journal.mjs';
import { CodexTransport } from '../runtime/codex-transport.mjs';
import { CodexQuestionBinding } from '../runtime/codex-questions.mjs';

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
const params = (itemId = 'item/one') => ({ threadId: 'root/one', turnId: 'turn/one', itemId, isBlocking: true,
  questions: [{ id: '__proto__', header: 'Synthetic', question: 'Private synthetic question', options: [{ label: 'Blue', description: 'One' }] },
    { id: 'skip', header: 'Skip', question: 'Synthetic skip', options: null }] });
const answer = () => ({ answers: Object.fromEntries([['__proto__', { answers: ['Blue'] }], ['skip', { answers: [] }]]) });
const resolved = (requestId = 71, threadId = 'root/one') => ({ method: 'serverRequest/resolved', params: { requestId, threadId } });
async function until(fn) { for (let n = 0; n < 200; n++) { if (await fn()) return; await sleep(5); } assert.fail('bounded fixture wait expired'); }
async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'question-binding-')), journal = new FileJournal(dir);
  const claim = { identity: { epoch: 7, boot_id: uuid(7) }, run_id: uuid(20), attempt: 2, attemptId: 'attempt-one', deadline_at: new Date(Date.now() + 60000).toISOString() };
  await journal.putIfAbsent(claim.attemptId, { threadId: 'root/one', nativeRunId: 'turn/one', rootSettled: false, status: 'running' });
  const calls = [], records = new Map(); let take = async () => ({ state: 'pending', answer: null });
  const control = { request: async (type, payload) => {
    calls.push({ type, payload: structuredClone(payload) });
    if (type === 'question-record') { records.set(payload.question.id, payload); return { id: payload.question.id }; }
    if (type === 'question-take') return take(payload);
    if (type === 'question-resolve') return { ok: true };
    assert.fail('unexpected endpoint');
  } };
  const binding = new CodexQuestionBinding({ journal, control, resolveBinding: async () => claim, pollMs: 10, timeoutMs: 1000, controlTimeoutMs: 200, ...options });
  const child = new EventEmitter(); Object.assign(child, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill() {} });
  const writes = []; child.stdin.on('data', bytes => writes.push(JSON.parse(bytes.toString())));
  const transport = new CodexTransport(child, { onUserInput: binding.onUserInput, timeoutMs: 2000 });
  const notificationErrors = []; transport.on('notification', m => { void binding.onNotification(m).catch(e => notificationErrors.push(e)); });
  transport.on('disconnect', () => binding.close());
  t.after(async () => { binding.close(); transport.close(); await sleep(220); await rm(dir, { recursive: true, force: true }); });
  const rows = async () => Promise.all((await readdir(dir)).filter(n => n.startsWith('question_') && n.endsWith('.json')).map(async n => JSON.parse(await readFile(join(dir, n), 'utf8'))));
  return { dir, journal, claim, calls, control, records, binding, transport, writes, notificationErrors, rows,
    setTake(fn) { take = fn; }, send(id = 71, p = params()) { child.stdout.write(JSON.stringify({ method: 'item/tool/requestUserInput', id, params: p }) + '\n'); },
    notify(m = resolved()) { child.stdout.write(JSON.stringify(m) + '\n'); } };
}

test('real transport returns exact answers only after durable handoff; later resolved uses original custody after terminal', async t => {
  const f = await fixture(t); let polls = 0;
  f.setTake(async () => ++polls === 1 ? { state: 'pending', answer: null } : { state: 'response_unknown', answer: answer() });
  f.send(); await until(() => f.writes.length === 1);
  assert.deepEqual(f.writes[0], { id: 71, result: answer() }); assert.equal((await f.rows())[0].phase, 'handoff_unknown');
  const disk = JSON.stringify(await f.rows()); assert.ok(!disk.includes('Private synthetic question')); assert.ok(!disk.includes('Blue'));
  await f.journal.update('attempt-one', { rootSettled: true, status: 'finishing' });
  f.binding.resolveBinding = () => null; f.notify(); await until(async () => (await f.rows())[0].phase === 'resolved');
  assert.equal(f.calls.filter(c => c.type === 'question-resolve').length, 1); f.notify(); await sleep(15);
  assert.equal(f.calls.filter(c => c.type === 'question-resolve').length, 1);
  assert.deepEqual(f.calls.at(-1).payload, { identity: f.claim.identity, question_id: (await f.rows())[0].questionId, connection_id: f.binding.connectionId });
});
test('typed IDs do not collide and wrong thread/string resolution cannot cancel numeric request', async t => {
  const f = await fixture(t); f.send(71); f.send('71', params('item/two'));
  await until(() => f.records.size === 2); f.notify(resolved(71, 'unrelated')); f.notify(resolved('missing'));
  await sleep(20); assert.equal(f.calls.filter(c => c.type === 'question-resolve').length, 0);
  f.notify(resolved('71')); await until(() => f.calls.some(c => c.type === 'question-resolve'));
  assert.equal((await f.rows()).find(r => r.requestId === 71).resolutionObserved, false);
  assert.equal(f.writes.length, 0); assert.equal(f.transport.closed, false);
  f.notify(resolved(71)); await until(() => f.calls.filter(c => c.type === 'question-resolve').length === 2);
});
for (const kind of ['thread', 'child', 'turn', 'settled', 'status', 'deadline', 'binding']) test(`rejects ${kind} root without recording`, async t => {
  const f = await fixture(t), p = params();
  if (kind === 'thread') p.threadId = 'unrelated';
  if (kind === 'child') { p.threadId = 'child'; await f.journal.update('attempt-one', { childObligations: { child: { threadId: 'child', nativeRunId: p.turnId } } }); }
  if (kind === 'turn') p.turnId = 'wrong';
  if (kind === 'settled') await f.journal.update('attempt-one', { rootSettled: true });
  if (kind === 'status') await f.journal.update('attempt-one', { status: 'submission_unknown' });
  if (kind === 'deadline') f.claim.deadline_at = '2020-01-01T00:00:00.000Z';
  if (kind === 'binding') f.binding.resolveBinding = () => null;
  await assert.rejects(f.binding.onUserInput(p, { signal: new AbortController().signal, requestId: 71 })); assert.equal(f.calls.length, 0);
});
test('unknown take is not retried and fresh binding cannot replay the durable same-item custody', async t => {
  const f = await fixture(t); f.setTake(async () => { throw new Error('PRIVATE upstream'); });
  await assert.rejects(f.binding.onUserInput(params(), { signal: new AbortController().signal, requestId: 71 }), { message: 'QUESTION_CALLBACK_STOPPED' });
  assert.equal((await f.rows())[0].phase, 'take_unknown'); const before = JSON.stringify(await f.rows());
  const reopened = new CodexQuestionBinding({ journal: new FileJournal(f.dir), control: f.control, resolveBinding: () => f.claim });
  assert.notEqual(reopened.connectionId, f.binding.connectionId);
  await assert.rejects(reopened.onUserInput(params(), { signal: new AbortController().signal, requestId: 71 }));
  await reopened.onNotification(resolved()); assert.equal(JSON.stringify(await f.rows()), before); reopened.close();
  assert.equal(f.calls.filter(c => c.type === 'question-take').length, 1);
});
for (const state of ['response_unknown', 'resolved', 'answered']) test(`${state} null stops rather than delivering or repolling`, async t => {
  const f = await fixture(t); f.setTake(async () => ({ state, answer: null }));
  await assert.rejects(f.binding.onUserInput(params(), { signal: new AbortController().signal, requestId: 71 }));
  assert.equal(f.calls.filter(c => c.type === 'question-take').length, 1); assert.equal(f.writes.length, 0);
});
test('abort before admission records nothing and removes signal listeners', async t => {
  const wait = deferred(), f = await fixture(t, { resolveBinding: () => wait.promise }), abort = new AbortController();
  const result = f.binding.onUserInput(params(), { signal: abort.signal, requestId: 71 }); abort.abort();
  await assert.rejects(result); wait.resolve(f.claim); await sleep(15);
  assert.equal(f.calls.length, 0); assert.equal(getEventListeners(abort.signal, 'abort').length, 0);
});
test('resolution during record waits for exact record outcome and never polls', async t => {
  const f = await fixture(t), wait = deferred(), original = f.control.request; let entered = false;
  f.control.request = async (type, p) => { if (type === 'question-record') { entered = true; await wait.promise; } return original(type, p); };
  const result = f.binding.onUserInput(params(), { signal: new AbortController().signal, requestId: 71 }); const rejected = assert.rejects(result);
  await until(() => entered); const resolution = f.binding.onNotification(resolved());
  wait.resolve(); await rejected; await resolution;
  assert.deepEqual(f.calls.map(c => c.type), ['question-record', 'question-resolve']); assert.equal((await f.rows())[0].phase, 'resolved');
});
test('resolve-versus-inflight take suppresses late answer and resolves after uncertainty is persisted', async t => {
  const f = await fixture(t), wait = deferred(); f.setTake(() => wait.promise); f.send();
  await until(() => f.calls.some(c => c.type === 'question-take')); f.notify();
  wait.resolve({ state: 'response_unknown', answer: answer() });
  await until(async () => (await f.rows())[0].phase === 'resolved'); assert.equal(f.writes.length, 0);
  assert.deepEqual(f.calls.map(c => c.type), ['question-record', 'question-take', 'question-resolve']);
});
test('disconnect during take cannot send a late answer and does not manufacture resolution', async t => {
  const f = await fixture(t), wait = deferred(); f.setTake(() => wait.promise); f.send();
  await until(() => f.calls.some(c => c.type === 'question-take')); f.transport.close(); wait.resolve({ state: 'response_unknown', answer: answer() });
  await until(async () => (await f.rows())[0].phase === 'handoff_unknown'); assert.equal(f.writes.length, 0);
  assert.equal(f.calls.filter(c => c.type === 'question-resolve').length, 0);
});
for (const failure of ['journal', 'handoff', 'record', 'timeout', 'answer']) test(`retains uncertainty on ${failure} failure without retry`, async t => {
  const f = await fixture(t, { controlTimeoutMs: 1000, timeoutMs: 5000 }), original = f.journal.update.bind(f.journal);
  let handoffAttempted = false;
  if (failure === 'journal') f.journal.update = async () => { throw new Error('PRIVATE disk'); };
  if (failure === 'handoff') f.journal.update = async (key, patch) => { if (patch.phase === 'handoff_unknown') { handoffAttempted = true; throw new Error('PRIVATE disk'); } return original(key, patch); };
  if (failure === 'record') f.control.request = async () => { throw new Error('PRIVATE network'); };
  f.setTake(async () => failure === 'timeout' ? new Promise(() => {}) : { state: 'response_unknown', answer: failure === 'answer' ? { answers: {} } : answer() });
  await assert.rejects(f.binding.onUserInput(params(), { signal: new AbortController().signal, requestId: 71 }), { message: 'QUESTION_CALLBACK_STOPPED' });
  const beforeTake = ['journal', 'record'].includes(failure);
  assert.equal((await f.rows())[0].phase, beforeTake ? 'record_unknown' : 'take_unknown');
  assert.equal(f.calls.filter(c => c.type === 'question-take').length, beforeTake ? 0 : 1);
  assert.equal(handoffAttempted, failure === 'handoff');
});
test('changed bridge identity before take is fenced; no inference from matching turn', async t => {
  const f = await fixture(t); let reads = 0;
  f.binding.resolveBinding = () => ({ ...f.claim, identity: { ...f.claim.identity, epoch: ++reads === 1 ? 7 : 8 } });
  await assert.rejects(f.binding.onUserInput(params(), { signal: new AbortController().signal, requestId: 71 }));
  assert.deepEqual(f.calls.map(c => c.type), ['question-record']);
});
test('settlement between polls still allows original native resolution', async t => {
  const f = await fixture(t);
  f.setTake(async () => { await f.journal.update('attempt-one', { rootSettled: true, status: 'finishing' }); return { state: 'pending', answer: null }; });
  await assert.rejects(f.binding.onUserInput(params(), { signal: new AbortController().signal, requestId: 71 }));
  await f.binding.onNotification(resolved()); assert.equal((await f.rows())[0].phase, 'resolved');
});
test('unrelated admitted root stays pending when first root receives its answer', async t => {
  const f = await fixture(t), other = { ...f.claim, run_id: uuid(21), attemptId: 'attempt-two' };
  await f.journal.putIfAbsent('attempt-two', { threadId: 'root/two', nativeRunId: 'turn/two', rootSettled: false, status: 'running' });
  f.binding.resolveBinding = ({ threadId }) => threadId === 'root/one' ? f.claim : other;
  f.setTake(async p => f.records.get(p.question_id).run_id === f.claim.run_id ? { state: 'response_unknown', answer: answer() } : { state: 'pending', answer: null });
  f.send(71); f.send(72, { ...params(), threadId: 'root/two', turnId: 'turn/two' });
  await until(() => f.writes.length === 1 && f.records.size === 2); assert.equal(f.writes[0].id, 71);
  f.notify(); await until(async () => (await f.rows()).find(r => r.requestId === 71).phase === 'resolved');
  assert.equal((await f.rows()).find(r => r.requestId === 72).resolutionObserved, false); assert.equal(f.transport.closed, false);
});
test('timeout stops polling without settlement or retained abort listeners', async t => {
  const f = await fixture(t, { timeoutMs: 80 }), abort = new AbortController();
  await assert.rejects(f.binding.onUserInput(params(), { signal: abort.signal, requestId: 71 }));
  const row = (await f.rows())[0];
  assert.equal(Date.parse(row.wait.deadlineAt) - Date.parse(row.wait.startedAt), 80);
  assert.notEqual(row.phase, 'resolved'); assert.equal(row.resolutionObserved, false);
  const count = f.calls.length; await sleep(30); assert.equal(f.calls.length, count);
  assert.equal(getEventListeners(abort.signal, 'abort').length, 0); assert.equal(f.calls.filter(c => c.type === 'question-resolve').length, 0);
});
test('persisted callback deadline is capped by the original task, not by a fresh poll', async t => {
  const f = await fixture(t, { timeoutMs: 900000 });
  f.setTake(async () => ({ state: 'response_unknown', answer: answer() }));
  await f.binding.onUserInput(params(), { signal: new AbortController().signal, requestId: 71 });
  const row = (await f.rows())[0];
  assert.equal(row.wait.deadlineAt, f.claim.deadline_at);
  assert.ok(Date.parse(row.wait.deadlineAt) - Date.parse(row.wait.startedAt) <= 60000);
  f.notify(); await until(async () => (await f.rows())[0].phase === 'resolved');
  assert.deepEqual((await f.rows())[0].wait, row.wait);
});
for (const held of ['journal', 'record']) test(`task deadline aborts initial ${held} wait exactly, without replaying late results`, async t => {
  const now = Date.parse('2026-09-16T02:00:00.000Z');
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now });
  const entered = deferred(), release = deferred(), rows = new Map(), calls = [];
  const claim = { identity: { epoch: 7, boot_id: uuid(7) }, run_id: uuid(20), attempt: 2,
    attemptId: 'attempt-one', deadline_at: new Date(now + 500).toISOString() };
  rows.set(claim.attemptId, { threadId: 'root/one', nativeRunId: 'turn/one', rootSettled: false, status: 'running' });
  const journal = {
    get: async key => rows.get(key),
    putIfAbsent: async (key, row) => {
      if (held === 'journal') { entered.resolve(); await release.promise; }
      rows.set(key, row); return null;
    },
    update: async (key, patch) => { rows.set(key, { ...rows.get(key), ...patch }); },
  };
  const binding = new CodexQuestionBinding({ journal, resolveBinding: async () => claim,
    timeoutMs: 5000, controlTimeoutMs: 2000, control: { request: async (type, payload) => {
      calls.push(type); assert.equal(type, 'question-record');
      entered.resolve(); await release.promise; return { id: payload.question.id };
    } } });
  let stopped = false;
  const callback = binding.onUserInput(params(), { signal: new AbortController().signal, requestId: 71 })
    .then(() => assert.fail('late answer'), cause => { assert.equal(cause.code, 'QUESTION_CALLBACK_STOPPED'); stopped = true; });
  try {
    await entered.promise;
    t.mock.timers.tick(499); await new Promise(resolve => setImmediate(resolve));
    assert.equal(stopped, false);
    t.mock.timers.tick(1); await new Promise(resolve => setImmediate(resolve));
    assert.equal(stopped, true); await callback;
    release.resolve(); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, held === 'record' ? ['question-record'] : []);
    const row = [...rows.values()].find(row => row.questionId);
    assert.equal(row.wait.deadlineAt, claim.deadline_at);
    assert.equal(row.resolutionObserved, false); assert.notEqual(row.phase, 'resolved');
  } finally { release.resolve(); binding.close(); t.mock.timers.reset(); await callback; }
});

test('failed resolution retains observed/unknown evidence and never retries duplicate notification', async t => {
  const f = await fixture(t); f.setTake(async () => ({ state: 'response_unknown', answer: answer() }));
  await f.binding.onUserInput(params(), { signal: new AbortController().signal, requestId: 71 });
  let resolutions = 0; f.control.request = async () => { resolutions++; throw new Error('PRIVATE error'); };
  await assert.rejects(f.binding.onNotification(resolved()), { message: 'QUESTION_RESOLUTION_UNKNOWN' });
  await f.binding.onNotification(resolved()); assert.equal(resolutions, 1);
  assert.equal((await f.rows())[0].phase, 'resolve_unknown'); assert.equal((await f.rows())[0].resolutionObserved, true);
});
test('configuration, question bounds and capacity are enforced locally', async t => {
  const f = await fixture(t, { maxRequests: 1 });
  for (const bad of [{ pollMs: 0 }, { timeoutMs: 900001 }, { controlTimeoutMs: 60001 }, { maxRequests: 65 }])
    assert.throws(() => new CodexQuestionBinding({ journal: f.journal, control: f.control, resolveBinding: () => f.claim, ...bad }), { code: 'QUESTION_INVALID_CONFIGURATION' });
  const p = params(); p.questions[0].isSecret = true;
  await assert.rejects(f.binding.onUserInput(p, { signal: new AbortController().signal, requestId: 71 }));
  const abort = new AbortController(), first = f.binding.onUserInput(params(), { signal: abort.signal, requestId: 71 }); const rejected = assert.rejects(first);
  await assert.rejects(f.binding.onUserInput(params('item/two'), { signal: new AbortController().signal, requestId: '71' })); abort.abort(); await rejected;
  assert.equal(f.calls.length, 0);
});
