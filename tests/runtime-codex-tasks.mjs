import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexTaskControl } from '../runtime/codex-tasks.mjs';
import { FileJournal } from '../runtime/file-journal.mjs';

const identity = { epoch: 7, boot_id: 'boot-usage' };
const parent = { runId: 'root-run', personaId: 'persona-a', attempt: 3 };
const counts = totalTokens => ({ inputTokens: 2, cachedInputTokens: 1, cacheWriteInputTokens: 0,
  outputTokens: 3, reasoningOutputTokens: 1, totalTokens });
const usage = totalTokens => ({ total: counts(totalTokens), last: counts(totalTokens), modelContextWindow: 120000 });

class Journal {
  rows = new Map();
  async putIfAbsent(key, value) {
    if (this.rows.has(key)) return structuredClone(this.rows.get(key));
    this.rows.set(key, structuredClone(value)); return null;
  }
  async get(key) { return structuredClone(this.rows.get(key) ?? null); }
  async update(key, patch) {
    const row = { ...this.rows.get(key), ...structuredClone(patch) };
    this.rows.set(key, row); return structuredClone(row);
  }
}

async function fixture(native, request, assertLease = () => {}) {
  const journal = new Journal();
  const control = new CodexTaskControl({
    adapter: { requireRun: async () => structuredClone(native), cancelChild: async () => ({}) },
    control: { request }, journal, identity, attemptId: 'attempt-native', parent, assertLease,
  });
  await control.mapping();
  return { control, journal };
}

test('reverse-order registration resolves each thread origin only once per snapshot', async () => {
  const key = i => JSON.stringify([`thread-${i}`, `turn-${i}`]);
  const native = { childTurns: {}, spawns: { root: { receiverThreadIds: ['thread-1'] } }, childObligations: {} };
  for (let i = 24; i >= 1; i--) {
    native.childTurns[key(i)] = 'inProgress';
    native.childObligations[key(i)] = { spawns: i === 24 ? {} : { next: { receiverThreadIds: [`thread-${i + 1}`] } } };
  }
  const calls = [], f = await fixture(native, async (type, payload) => {
    assert.equal(type, 'native-child'); assert.equal(payload.started, true);
    assert.deepEqual(payload.identity, identity);
    const i = Number(payload.child.native_session_key.slice(7));
    assert.equal(payload.child.parent_run_id, i === 1 ? parent.runId : `run-${i - 1}`);
    assert.equal(payload.child.parent_attempt, i === 1 ? 3 : 1);
    calls.push(i);
    return { id: `run-${i}`, parent_run_id: payload.child.parent_run_id,
      persona_id: parent.personaId, current_attempt: 1, role: 'background', status: 'recovery_required' };
  });
  let reads = 0;
  f.control.adapter.requireRun = async () => {
    const snapshot = structuredClone(native);
    for (const owner of [snapshot, ...Object.values(snapshot.childObligations)]) {
      const spawns = owner.spawns;
      Object.defineProperty(owner, 'spawns', { get() { reads++; return spawns; } });
    }
    return snapshot;
  };
  const children = await f.control.sync();
  assert.deepEqual(calls, Array.from({ length: 24 }, (_, i) => i + 1));
  assert.equal(Object.keys(children).length, 24);
  assert.ok(Object.values(children).every(child => child.started === true));
  assert.ok(reads <= 24 * 25, `Origin scans ${reads} exceed one per thread`);
  await f.control.sync();
  assert.equal(calls.length, 24, 'Acknowledged children must not be registered again');
});

test('origin cache does not survive uncertain registration or hide a new conflicting owner', async () => {
  const key = '["child","turn"]';
  const native = { childTurns: { [key]: 'inProgress' }, spawns: {
    a: { receiverThreadIds: ['child'] }, b: { receiverThreadIds: ['child'] },
  }, childObligations: {} };
  let calls = 0;
  const f = await fixture(native, async () => { calls++; throw new Error('uncertain response'); });
  await assert.rejects(f.control.sync(), /uncertain response/);
  const pending = await f.journal.get(f.control.key);
  assert.equal(pending.children[key].runId, null);
  assert.equal(pending.children[key].started, false);
  native.childObligations['["other","turn"]'] = { spawns: { conflicting: { receiverThreadIds: ['child'] } } };
  await assert.rejects(f.control.sync(), { code: 'NATIVE_CHILD_ORIGIN_UNKNOWN' });
  assert.equal(calls, 1);
  assert.deepEqual(await f.journal.get(f.control.key), pending);
});

for (const cycle of [false, true]) test(`restored reverse-order cancellation walks each edge once (synthetic cycle=${cycle})`, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'hehe-task-cancel-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const f = await fixture({}, () => assert.fail('Cancellation must not admit control work'));
  const journal = new FileJournal(directory), before = await f.control.mapping();
  for (let i = 96; i >= 1; i--) before.children[JSON.stringify([`thread-${i}`, `turn-${i}`])] = {
    runId: `run-${i}`, started: true, receipt: { parent_run_id: i === 1 ? parent.runId : `run-${i - 1}` },
  };
  before.children['["sibling","turn"]'] = { runId: 'sibling', receipt: { parent_run_id: 'run-31' } };
  before.children['["unacknowledged","turn"]'] = { runId: null, receipt: { parent_run_id: 'run-32' } };
  if (cycle) before.children['["thread-32","turn-32"]'].receipt.parent_run_id = 'run-96';
  before.usagePublications = { 'run-32': { version: 1, pending: { identity, run_id: 'run-32',
    attempt: 1, native_ref: 'child-native', version: 1, usage: usage(7) } } };
  await journal.write(f.control.key, before);
  const calls = [], restored = new CodexTaskControl({ ...f.control, journal: new FileJournal(directory),
    adapter: { ...f.control.adapter, cancelChild: async (attempt, target) => {
      assert.equal(attempt, 'attempt-native'); calls.push(target); return { status: 'unknown' };
    } },
  });
  let reads = 0;
  const mapping = restored.mapping.bind(restored);
  restored.mapping = async () => {
    const row = await mapping();
    for (const child of Object.values(row.children)) {
      const parentId = child.receipt.parent_run_id;
      Object.defineProperty(child.receipt, 'parent_run_id', { get() { reads++; return parentId; } });
    }
    return row;
  };
  const outcomes = await restored.cancel(['run-32', 'run-32', 'missing']);
  const ids = Array.from({ length: 65 }, (_, i) => 96 - i);
  assert.deepEqual(calls, ids.map(i => ({ threadId: `thread-${i}`, turnId: `turn-${i}` })));
  assert.deepEqual(outcomes, ids.map(i => ({ runId: `run-${i}`, status: 'unknown' })));
  assert.deepEqual(await new FileJournal(directory).get(restored.key), before);
  assert.ok(reads <= 2 * 97, `Parent edge reads ${reads} exceed two passes over registered children`);
});

test('publishes exact root and registered-child snapshots independently and skips absent usage', async () => {
  const childKey = '["child-thread","child-turn"]';
  const native = { nativeRunId: 'root-native', tokenUsage: usage(9), childObligations: {
    [childKey]: { tokenUsage: usage(4) }, '["absent","turn"]': {} },
  };
  const calls = [];
  const f = await fixture(native, async (type, payload) => { calls.push({ type, payload }); return { accepted: true }; });
  await f.journal.update(f.control.key, { children: {
    [childKey]: { runId: 'child-run', started: true, receipt: { native_run_ref: 'child-native' } },
    '["absent","turn"]': { runId: 'absent-run', started: true, receipt: { native_run_ref: 'absent-native' } },
  } });
  await f.control.publishOutputs(); await f.control.publishOutputs();
  assert.deepEqual(calls, [
    { type: 'token-usage', payload: { identity, run_id: 'root-run', attempt: 3, native_ref: 'root-native', version: 1, usage: usage(9) } },
    { type: 'token-usage', payload: { identity, run_id: 'child-run', attempt: 1, native_ref: 'child-native', version: 1, usage: usage(4) } },
  ]);
});

test('publishes duplicate suppression and decreases with monotonic versions', async () => {
  const native = { nativeRunId: 'root-native', tokenUsage: usage(20) };
  const calls = [], f = await fixture(native, async (_type, payload) => { calls.push(payload); return { accepted: true }; });
  await f.control.publishOutputs(); await f.control.publishOutputs();
  native.tokenUsage = usage(7); await f.control.publishOutputs();
  assert.deepEqual(calls.map(row => [row.version, row.usage.total.totalTokens]), [[1, 20], [2, 7]]);
});

test('retries an uncertain exact payload before a changed snapshot', async () => {
  const native = { nativeRunId: 'root-native', tokenUsage: usage(11) };
  const calls = []; let first = true;
  const f = await fixture(native, async (_type, payload) => {
    calls.push(structuredClone(payload));
    if (first) { first = false; throw new Error('unknown response'); }
    return { accepted: true };
  });
  await assert.rejects(f.control.publishOutputs(), /unknown response/);
  native.tokenUsage = usage(19);
  await f.control.publishOutputs(); await f.control.publishOutputs();
  assert.deepEqual(calls.map(row => [row.version, row.usage.total.totalTokens]), [[1, 11], [1, 11], [2, 19]]);
  assert.deepEqual(calls[1], calls[0]);
});

test('usage fence is durable and lease loss before dispatch preserves pending payload', async () => {
  const native = { nativeRunId: 'root-native', tokenUsage: usage(5) };
  const fencedCalls = [], fenced = await fixture(native, async (_type, payload) => {
    fencedCalls.push(payload); return { accepted: false, reason: 'USAGE_FENCED' };
  });
  await fenced.control.publishOutputs(); native.tokenUsage = usage(6); await fenced.control.publishOutputs();
  assert.equal(fencedCalls.length, 1);

  let leaseChecks = 0, dispatches = 0;
  const lost = await fixture(native, async () => { dispatches++; return { accepted: true }; }, () => {
    leaseChecks++; if (leaseChecks === 2) throw Object.assign(new Error('fenced'), { code: 'EXECUTOR_FENCED' });
  });
  await assert.rejects(lost.control.publishOutputs(), error => error.code === 'EXECUTOR_FENCED');
  assert.equal(dispatches, 0);
  const state = await lost.journal.get(lost.control.key);
  assert.deepEqual(state.usagePublications['root-run'].pending,
    { identity, run_id: 'root-run', attempt: 3, native_ref: 'root-native', version: 1, usage: usage(6) });
});
