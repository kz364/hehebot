import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenClawAdapter, sessionKey } from '../runtime/openclaw-adapter.mjs';
import { FileJournal } from '../runtime/file-journal.mjs';
const input = { attemptId: 'attempt-1', installationId: 'owner-1', personaId: 'research', scope: 'routine', scopeId: 'routine-1', message: 'Synthetic read-only test', model: 'openai/gpt-5.5' };
async function fixture(t, rpc, testMode = true) {
  const dir = await mkdtemp(join(tmpdir(), 'claw-runtime-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const journal = new FileJournal(dir);
  return { adapter: new OpenClawAdapter({ rpc, journal, testMode }), journal, dir };
}
test('production admission fails closed before journal or transport', async (t) => {
  let calls = 0;
  const { adapter, journal } = await fixture(t, async () => { calls++; }, false);
  await assert.rejects(adapter.submit(input), { code: 'COMPATIBILITY_GATE_BLOCKED' });
  assert.equal(calls, 0); assert.equal(await journal.get(input.attemptId), null);
});
test('intent durable before submit; concurrent duplicate causes one native call', async (t) => {
  let calls = 0;
  const { adapter, journal } = await fixture(t, async (method, params) => {
    calls++; assert.equal(method, 'agent'); assert.equal((await journal.get(input.attemptId)).status, 'submitting');
    assert.equal(params.deliver, false); assert.equal(params.disableMessageTool, true);
    assert.equal(params.idempotencyKey, input.attemptId); return { runId: 'native-1' };
  });
  await Promise.all([adapter.submit(input), adapter.submit(input)]);
  assert.equal(calls, 1); assert.equal((await journal.get(input.attemptId)).nativeRunId, 'native-1');
  await assert.rejects(adapter.submit({ ...input, message: 'different' }), { code: 'IDEMPOTENCY_CONFLICT' });
});
test('lost submit response and process restart never resubmit', async (t) => {
  let calls = 0;
  const { adapter, dir } = await fixture(t, async () => { calls++; throw new Error('secret prompt/token must not persist'); });
  assert.equal((await adapter.submit(input)).error, 'SUBMISSION_OUTCOME_UNKNOWN');
  const next = new OpenClawAdapter({ journal: new FileJournal(dir), testMode: true, rpc: async () => { calls++; } });
  assert.equal((await next.submit(input)).recoveryRequired, true); assert.equal(calls, 1);
});
test('quiet inference and wait timeout preserve active run; root completion still denies sleep', async (t) => {
  let terminal = false;
  const { adapter } = await fixture(t, async (method) => method === 'agent' ? { runId: 'native-1' } : { runId: 'native-1', status: terminal ? 'ok' : 'timeout' });
  await adapter.submit(input);
  assert.equal((await adapter.observe(input.attemptId)).status, 'running');
  terminal = true;
  assert.equal((await adapter.observe(input.attemptId)).status, 'finishing');
  assert.equal(adapter.sleepReadiness().allowed, false);
});
test('cancel names exact run and acknowledgment is never terminal proof', async (t) => {
  const { adapter } = await fixture(t, async (method, params) => {
    if (method === 'agent') return { runId: 'native-1' };
    assert.equal(method, 'chat.abort'); assert.equal(params.runId, 'native-1');
    assert.equal(params.sessionKey, sessionKey(input)); return { ok: true, aborted: true, runIds: ['native-1'] };
  });
  await adapter.submit(input);
  const row = await adapter.cancel(input.attemptId);
  assert.equal(row.cancelAcknowledged, true); assert.equal(row.rootSettled, false); assert.equal(row.status, 'cancelling');
});
test('scope mapping separates installation, persona, routine and conversation', () => {
  const variants = [input, { ...input, scopeId: 'routine-2' }, { ...input, scope: 'conversation' },
    { ...input, personaId: 'helper' }, { ...input, installationId: 'owner-2' }, { ...input, attemptId: 'attempt-2' }];
  assert.equal(new Set(variants.map(sessionKey)).size, variants.length);
  assert.throws(() => sessionKey({ ...input, scopeId: '../state' }), { code: 'INVALID_SCOPE' });
});
test('future fields and paid provider route rejected', async (t) => {
  const { adapter } = await fixture(t, async () => assert.fail('must not submit'));
  await assert.rejects(adapter.submit({ ...input, provider: 'paid' }), { code: 'INVALID_SUBMISSION' });
  await assert.rejects(adapter.submit({ ...input, model: 'anthropic/model' }), { code: 'INVALID_SUBMISSION' });
});
test('malformed native result parks uncertain instead of allowing replay', async (t) => {
  let calls = 0;
  const { adapter } = await fixture(t, async () => { calls++; return { accepted: true }; });
  assert.equal((await adapter.submit(input)).status, 'recovery_required');
  await adapter.submit(input); assert.equal(calls, 1);
});

test('parallel messages to one persona/conversation have independent native task sessions', { timeout: 2000 }, async (t) => {
  const calls = [];
  let releaseBoth;
  const bothAdmitted = new Promise(resolve => { releaseBoth = resolve; });
  const { adapter, journal } = await fixture(t, async (method, params) => {
    calls.push({ method, params });
    if (calls.length === 2) releaseBoth();
    await bothAdmitted;
    return { runId: `native-${params.idempotencyKey}` };
  });
  const firstInput = { ...input, scope: 'conversation', scopeId: 'conversation-1' };
  const secondInput = { ...firstInput, attemptId: 'attempt-2', message: 'Separate synthetic message' };
  const [first, second] = await Promise.all([adapter.submit(firstInput), adapter.submit(secondInput)]);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.method === 'agent')); // No steer or cancel request.
  assert.notEqual(first.sessionKey, second.sessionKey);
  assert.notEqual(first.nativeRunId, second.nativeRunId);
  assert.equal(calls[0].params.agentId, calls[1].params.agentId);
  assert.notEqual(calls[0].params.sessionKey, calls[1].params.sessionKey);
  assert.equal((await journal.get(firstInput.attemptId)).status, 'running');
  assert.equal((await journal.get(secondInput.attemptId)).status, 'running');
  assert.equal((await adapter.submit(firstInput)).nativeRunId, first.nativeRunId);
  assert.equal(calls.length, 2); // Per-attempt replay still deduplicates.
});
test('native task session identity requires a nonempty valid attempt', () => {
  assert.throws(() => sessionKey({ ...input, attemptId: undefined }), { code: 'INVALID_SCOPE' });
  assert.throws(() => sessionKey({ ...input, attemptId: '' }), { code: 'INVALID_SCOPE' });
});
