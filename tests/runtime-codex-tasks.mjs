import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CodexTaskControl } from '../runtime/codex-tasks.mjs';

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
