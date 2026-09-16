import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecutionBridge } from '../runtime/execution-bridge.mjs';
import { FileJournal } from '../runtime/file-journal.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'hehe-families-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const journal = new FileJournal(directory), calls = [];
  let claims = 0, submissions = 0, lose = false;
  const bridge = new ExecutionBridge({ journal, identity: { epoch: 7, boot_id: 'boot-39' }, installationId: 'family-test',
    personas: { bot: { agentId: 'assistant', model: 'synthetic' } },
    native: { admissionReadiness: () => ({ allowed: true }), submit: async () => ({ status: 'running', nativeRunId: `native-${++submissions}` }) },
    control: { request: async (type, payload) => {
      calls.push({ type, payload: structuredClone(payload) });
      if (type === 'claim') {
        const id = `run-${++claims}`;
        return { submission_key: `${id}:1`, deadline_at: '2091-04-07T00:00:00Z',
          run: { id, current_attempt: 1, persona_id: 'bot', context_json: '{"instruction":"keep original"}' } };
      }
      if (type === 'coordinator-release') {
        const durable = await bridge.families();
        assert.equal(durable.find(row => row.claim.run.id === payload.run_id).coordinatorRelease.acknowledged, false);
        if (lose) throw Error('lost release ACK');
      }
      return {};
    } },
  });
  const root = row => ({ attemptId: row.attemptId, nativeRunId: row.nativeRunId, rootSettled: true, nativeOutcome: 'completed' });
  const settlement = row => ({ ...root(row), toolsSettled: true, childrenSettled: true, effectsSettled: true,
    outputCommitted: true, result: { status: 'completed', text: `Result for ${row.claim.run.id}` } });
  return { bridge, journal, calls, root, settlement, lose: value => { lose = value; }, counts: () => ({ claims, submissions }) };
}

test('released root retains exact family while a fresh coordinator is admitted; completion selects the old attempt', async t => {
  const f = await fixture(t), a = await f.bridge.claimNext();
  await assert.rejects(f.bridge.releaseCoordinator({ ...f.root(a), rootSettled: false }), { code: 'NATIVE_ROOT_NOT_TERMINAL' });
  await f.bridge.releaseCoordinator(f.root(a));
  const b = await f.bridge.claimNext();
  assert.notEqual(a.attemptId, b.attemptId);
  const rows = await f.bridge.families();
  assert.deepEqual(rows.map(row => [row.claim.run.id, row.phase]), [['run-1', 'running'], ['run-2', 'running']]);
  assert.deepEqual(rows[0].claim, a.claim);
  assert.equal(rows[0].coordinatorRelease.acknowledged, true);
  await assert.rejects(f.bridge.complete(f.root(a)), { code: 'NATIVE_SETTLEMENT_INCOMPLETE' });
  await f.bridge.complete(f.settlement(a));
  assert.equal((await f.journal.get(f.bridge.cursor)).attemptId, b.attemptId);
  assert.deepEqual((await f.bridge.families()).map(row => row.phase), ['complete', 'running']);
  assert.deepEqual(f.calls.filter(call => call.type === 'complete').map(call => call.payload.run_id), ['run-1']);
});

test('lost release ACK fences new claims; only identical durable release can be acknowledged', async t => {
  const f = await fixture(t), a = await f.bridge.claimNext();
  f.lose(true);
  await assert.rejects(f.bridge.releaseCoordinator(f.root(a)), /lost release ACK/);
  assert.equal((await f.bridge.claimNext()).phase, 'released');
  assert.deepEqual(f.counts(), { claims: 1, submissions: 1 });
  await assert.rejects(f.bridge.releaseCoordinator({ ...f.root(a), nativeOutcome: 'failed' }), { code: 'COORDINATOR_RELEASE_CONFLICT' });
  await assert.rejects(f.bridge.releaseCoordinator({ ...f.root(a), nativeRunId: 'foreign' }), { code: 'SETTLEMENT_IDENTITY_MISMATCH' });
  f.lose(false);
  await f.bridge.releaseCoordinator(f.root(a));
  const receipts = f.calls.filter(call => call.type === 'coordinator-release');
  assert.equal(receipts.length, 2); assert.deepEqual(receipts[0], receipts[1]);
  await f.bridge.claimNext();
  assert.deepEqual(f.counts(), { claims: 2, submissions: 2 });
});

test('failed family-custody write never sends release or advances admission', async t => {
  const f = await fixture(t), a = await f.bridge.claimNext();
  const update = f.journal.update.bind(f.journal);
  f.journal.update = async (id, patch) => {
    if (patch.families) throw Error('durability failed');
    return update(id, patch);
  };
  await assert.rejects(f.bridge.releaseCoordinator(f.root(a)), /durability failed/);
  assert.equal(f.calls.some(call => call.type === 'coordinator-release'), false);
  assert.equal((await f.bridge.claimNext()).attemptId, a.attemptId);
  assert.deepEqual(f.counts(), { claims: 1, submissions: 1 });
});

test('32 unresolved families bound admission without dropping the oldest custody', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 32; i++) {
    const row = await f.bridge.claimNext();
    await f.bridge.releaseCoordinator(f.root(row));
  }
  await f.bridge.claimNext();
  assert.deepEqual(f.counts(), { claims: 32, submissions: 32 });
  assert.equal((await f.bridge.families()).length, 32);
  assert.equal((await f.bridge.families())[0].claim.run.id, 'run-1');
});
