import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fixture, bot } from './helpers';
import { LifecycleCore, type Identity } from '../src/core/lifecycle';
import { ExecutionBridge } from '../runtime/execution-bridge.mjs';
import { FileJournal } from '../runtime/file-journal.mjs';
import { OpenClawAdapter } from '../runtime/openclaw-adapter.mjs';

let f: ReturnType<typeof fixture>, life: LifecycleCore, identity: Identity, directory: string;
let nativeCalls: number, lose: string | undefined;
beforeEach(async () => {
  f = fixture(true); life = new LifecycleCore(f.store, f.core);
  f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=1,lease_until='2026-09-10T00:02:00.000Z'");
  identity = life.registerBoot(randomUUID()); life.ready(identity);
  directory = await mkdtemp(join(tmpdir(), 'clawbot-bridge-'));
  nativeCalls = 0; lose = undefined;
});
afterEach(async () => { f.close(); await rm(directory, { recursive: true, force: true }); });
function enqueue() {
  return f.accept({ schema_version: 1, type: 'message.send', payload: { conversation_id: bot, text: 'Synthetic bridge request' } }).resource_id!;
}
function bridge(testMode = true) {
  const native = new OpenClawAdapter({ testMode, journal: new FileJournal(join(directory, 'native')), rpc: async () => {
    nativeCalls++;
    if (lose === 'native') throw new Error('lost native admission response');
    return { runId: 'native-bridge-result' };
  } });
  const control = { request: async (type: string, p: any) => {
    let result;
    if (type === 'claim') result = life.claim(p.identity);
    else if (type === 'submitted') result = life.submitted(p.identity, p.run_id, p.attempt, p.native_ref);
    else if (type === 'complete') result = life.complete(p.identity, p.run_id, p.attempt, p.result);
    else throw new Error('Unexpected control call');
    if (lose === type) throw new Error('lost acknowledgment after durable mutation');
    return result;
  } };
  return new ExecutionBridge({ control, native, journal: new FileJournal(join(directory, 'bridge')), identity,
    installationId: 'synthetic-installation', personas: { [bot]: { agentId: 'chief-of-staff', model: 'openai/gpt-5.5' } } });
}
function settled(row: any) {
  return { attemptId: row.attemptId, nativeRunId: row.nativeRunId, rootSettled: true, toolsSettled: true,
    childrenSettled: true, effectsSettled: true, outputCommitted: true,
    result: { status: 'completed', text: 'Durably returned to the portal' } };
}

it('sends skill descriptors while retaining the full admitted snapshot in custody', async () => {
  const id = enqueue(), skill = { id: randomUUID(), revision: 7, body: {
    name: 'Review', description: 'Review a draft', when_to_use: 'Before publishing', steps: ['PRIVATE PROCEDURE SENTINEL'],
  } };
  let input: any;
  const executor = new ExecutionBridge({
    control: { request: async (type: string, payload: any) => {
      if (type === 'submitted') return life.submitted(payload.identity, payload.run_id, payload.attempt, payload.native_ref);
      if (type !== 'claim') throw new Error('Unexpected control call');
      const result = life.claim(identity)!;
      const context = JSON.parse(result.run.context_json); context.skills = [skill];
      result.run.context_json = JSON.stringify(context);
      f.db.exec('UPDATE runs SET context_json=? WHERE id=?', result.run.context_json, id);
      return result;
    } },
    native: { admissionReadiness: () => ({ allowed: true }), submit: async (value: any) => {
      input = value; return { nativeRunId: 'descriptor-test', status: 'running' };
    } },
    journal: new FileJournal(join(directory, 'descriptor')), identity, installationId: 'synthetic-installation',
    personas: { [bot]: { agentId: 'chief-of-staff', model: 'gpt-5.4' } },
  });
  const row = await executor.claimNext();
  expect(JSON.parse(input.message).skills).toEqual([{ id: skill.id, revision: 7, name: 'Review',
    description: 'Review a draft', when_to_use: 'Before publishing', load_with: 'clawbot_read_skill' }]);
  expect(input.message).not.toContain('PRIVATE PROCEDURE SENTINEL');
  expect(JSON.parse(row.claim.run.context_json).skills).toEqual([skill]);
});

it('real SQLite claim → native adapter/journal → completion publishes exactly one attributed reply', async () => {
  const id = enqueue(), executor = bridge();
  const row = await executor.claimNext();
  expect(row.phase).toBe('running'); expect(f.store.run(id).status).toBe('running');
  await executor.complete(settled(row)); await executor.complete(settled(row));
  expect(nativeCalls).toBe(1);
  expect(f.store.run(id).status).toBe('completed');
  expect(f.store.conversationEvents(bot, undefined, 100).filter(e => e.type === 'run.result').map(e => e.payload.text)).toEqual(['Durably returned to the portal']);
});

it.each(['claim', 'native', 'submitted'])('lost %s acknowledgment survives journal reconstruction without resubmission', async loss => {
  const id = enqueue(); lose = loss;
  const before = await bridge().claimNext();
  lose = undefined;
  const after = await bridge().claimNext();
  expect(after.phase).toBe(before.phase);
  expect(after.phase).toBe(loss === 'claim' ? 'claim_unknown' : loss === 'native' ? 'submission_unknown' : 'submitted_unknown');
  expect(nativeCalls).toBe(loss === 'claim' ? 0 : 1);
  expect(f.db.all('SELECT attempt FROM attempts WHERE run_id=?', id)).toHaveLength(1);
});

it('lost complete acknowledgment can replay the identical result after reconstruction, never a second native turn', async () => {
  enqueue(); const executor = bridge(), row = await executor.claimNext();
  lose = 'complete'; await expect(executor.complete(settled(row))).rejects.toThrow('lost acknowledgment');
  lose = undefined; await bridge().complete(settled(row));
  expect(nativeCalls).toBe(1);
  expect(f.db.all("SELECT id FROM events WHERE type='run.result'")).toHaveLength(1);
  await expect(bridge().complete({ ...settled(row), result: { status: 'completed', text: 'Different reply' } })).rejects.toMatchObject({ code: 'RESULT_CONFLICT' });
});

it('root completion cannot bypass child/tool/effect/output settlement or exact identity', async () => {
  const id = enqueue(), executor = bridge(), row = await executor.claimNext();
  for (const field of ['toolsSettled', 'childrenSettled', 'effectsSettled', 'outputCommitted']) {
    await expect(executor.complete({ ...settled(row), [field]: false })).rejects.toMatchObject({ code: 'NATIVE_SETTLEMENT_INCOMPLETE' });
  }
  await expect(executor.complete({ ...settled(row), nativeRunId: 'sibling' })).rejects.toMatchObject({ code: 'SETTLEMENT_IDENTITY_MISMATCH' });
  expect(f.store.run(id).status).toBe('running');
  expect(f.db.all('SELECT * FROM outbox')).toHaveLength(0);
});

it('stale epoch blocks completion even with a local settled receipt', async () => {
  const id = enqueue(), executor = bridge(), row = await executor.claimNext();
  f.db.exec('UPDATE lifecycle SET epoch=2');
  await expect(executor.complete(settled(row))).rejects.toMatchObject({ code: 'STALE_EPOCH' });
  expect(f.store.run(id).status).toBe('running');
  expect(f.db.all('SELECT * FROM outbox')).toHaveLength(0);
});

it('production compatibility gate prevents even claiming a queued job', async () => {
  const id = enqueue();
  await expect(bridge(false).claimNext()).rejects.toMatchObject({ code: 'COMPATIBILITY_GATE_BLOCKED' });
  expect(nativeCalls).toBe(0); expect(f.store.run(id).status).toBe('queued');
  expect(f.db.all('SELECT * FROM attempts')).toHaveLength(0);
});
