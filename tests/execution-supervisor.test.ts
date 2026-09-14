import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fixture, bot } from './helpers';
import { LifecycleCore } from '../src/core/lifecycle';
import { FileJournal } from '../runtime/file-journal.mjs';
import { ExecutionSupervisor } from '../runtime/execution-supervisor.mjs';

let f: ReturnType<typeof fixture>, life: LifecycleCore, directory: string, supervisor: any;
let calls: string[], cancellations: string[], releases: number, nativeCalls: number;
let hook: ((type: string) => Promise<void>) | undefined;
let eventBind: (id: string) => Promise<void>;
beforeEach(async () => {
  f = fixture(true); life = new LifecycleCore(f.store, f.core, { idleMode: true });
  f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=1,lease_until='2026-09-10T00:02:00.000Z'");
  const identity = life.registerBoot(randomUUID()); life.ready(identity);
  directory = await mkdtemp(join(tmpdir(), 'claw-supervisor-'));
  calls = []; cancellations = []; releases = 0; nativeCalls = 0; hook = undefined;
  eventBind = async () => {};
  const control = { request: async (type: string, p: any) => {
    calls.push(type);
    await hook?.(type);
    if (type === 'heartbeat') return life.heartbeat(p.identity, p.operations);
    if (type === 'claim') return life.claim(p.identity);
    if (type === 'submitted') return life.submitted(p.identity, p.run_id, p.attempt, p.native_ref);
    if (type === 'complete') return life.complete(p.identity, p.run_id, p.attempt, p.result);
    if (type === 'prepare-sleep') return life.prepareSleep(p.identity);
    if (type === 'commit-sleep') return life.commitSleep(p.identity, p.stop_token, p.queue_sequence, p.checkpoint);
    throw new Error('Unexpected request');
  } };
  supervisor = new ExecutionSupervisor({ control, identity, journal: new FileJournal(directory),
    installationId: 'test', personas: { [bot]: { agentId: 'assistant', model: 'gpt-5.4' } },
    native: {
      admissionReadiness: () => ({ allowed: true }), sleepReadiness: () => ({ allowed: true }),
      submit: async () => { nativeCalls++; return { nativeRunId: 'native-1', status: 'running' }; },
      cancel: async (id: string) => { cancellations.push(id); },
    },
    operations: async () => [], now: () => f.core.options.now().getTime(),
    events: { bind: (id: string) => eventBind(id) },
    activity: { ensure: async () => {}, releaseAfterDrain: async () => { releases++; } },
  });
});
afterEach(async () => {
  supervisor?.disconnect();
  await supervisor?.work;
  f.close(); await rm(directory, { recursive: true, force: true });
});
function enqueue() {
  return f.accept({ schema_version: 1, type: 'message.send', payload: { conversation_id: bot, text: 'Synthetic work' } }).resource_id!;
}
function settlement(row: any) {
  return { attemptId: row.attemptId, nativeRunId: row.nativeRunId, rootSettled: true,
    toolsSettled: true, childrenSettled: true, effectsSettled: true, outputCommitted: true,
    result: { status: 'completed', text: 'Exactly one result' } };
}

it('fenced SQLite dispatch, settlement, idle grace and drain release in order', async () => {
  const id = enqueue(), row = await supervisor.start();
  expect(calls.slice(0, 3)).toEqual(['heartbeat', 'claim', 'submitted']);
  await expect(supervisor.drain({ snapshot: 'one' })).rejects.toMatchObject({ code: 'SLEEP_DENIED' });
  await supervisor.complete(settlement(row));
  expect(f.store.run(id).status).toBe('completed');
  f.setNow('2026-09-10T00:01:00.000Z');
  await supervisor.drain({ snapshot: 'one' });
  expect(life.get().phase).toBe('IDLE_PERMITTED');
  expect(supervisor.phase).toBe('sleeping'); expect(releases).toBe(1);
  expect(calls.slice(-2)).toEqual(['prepare-sleep', 'commit-sleep']);
  expect(supervisor.timer).toBeNull();
  await expect(supervisor.dispatch()).rejects.toMatchObject({ code: 'EXECUTOR_FENCED' });
});

it('renews independently while native submission is unresolved', async () => {
  enqueue();
  let entered!: () => void, release!: () => void;
  const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  supervisor.native.submit = async () => { entered(); await pending; return { nativeRunId: 'native-1', status: 'running' }; };
  const started = supervisor.start(); await enteredPromise;
  f.setNow('2026-09-10T00:00:50.000Z');
  await supervisor.maintain();
  expect(life.get().lease_until).toBe('2026-09-10T00:02:20.000Z');
  release(); expect((await started).phase).toBe('running');
});

it('expired warm-resume lease cannot renew or admit another task', async () => {
  await supervisor.start(); const before = calls.length;
  f.setNow('2026-09-10T00:01:30.000Z');
  await expect(supervisor.maintain()).rejects.toMatchObject({ code: 'EXECUTOR_FENCED' });
  expect(calls.length).toBe(before); expect(supervisor.phase).toBe('recovery'); expect(releases).toBe(0);
});

it('disconnect while startup awaits heartbeat cannot resurrect admission', async () => {
  hook = async type => { if (type === 'heartbeat') supervisor.disconnect(); };
  await expect(supervisor.start()).rejects.toMatchObject({ code: 'EXECUTOR_FENCED' });
  expect(supervisor.phase).toBe('recovery'); expect(calls).toEqual(['heartbeat']);
});

it('lease expiration after claim prevents native submission and preserves uncertainty', async () => {
  enqueue();
  const request = supervisor.control.request;
  supervisor.control.request = async (type: string, p: any) => {
    const result = await request(type, p);
    if (type === 'claim') f.setNow('2026-09-10T00:01:30.000Z');
    return result;
  };
  const row = await supervisor.start();
  expect(row.phase).toBe('submission_unknown'); expect(nativeCalls).toBe(0);
  expect(supervisor.phase).toBe('recovery');
});

it('heartbeat cancellation names the exact native attempt and is not settlement', async () => {
  const id = enqueue(), row = await supervisor.start();
  f.db.exec("UPDATE runs SET status='cancelling' WHERE id=?", id);
  await supervisor.maintain();
  expect(cancellations).toEqual([row.attemptId]);
  expect(f.store.run(id).status).toBe('cancelling'); expect(releases).toBe(0);
});

it('incomplete child proof does not publish a result', async () => {
  const id = enqueue(), row = await supervisor.start();
  await expect(supervisor.complete({ ...settlement(row), childrenSettled: false })).rejects.toMatchObject({ code: 'NATIVE_SETTLEMENT_INCOMPLETE' });
  expect(f.store.run(id).status).toBe('running'); expect(supervisor.phase).toBe('running');
});

it('lost sleep commit acknowledgement retains the provider hold and stops requests', async () => {
  await supervisor.start(); f.setNow('2026-09-10T00:01:00.000Z');
  const request = supervisor.control.request;
  supervisor.control.request = async (type: string, p: any) => {
    const result = await request(type, p);
    if (type === 'commit-sleep') throw new Error('lost acknowledgement');
    return result;
  };
  await expect(supervisor.drain({ snapshot: 'one' })).rejects.toThrow('lost acknowledgement');
  expect(life.get().phase).toBe('IDLE_PERMITTED');
  expect(supervisor.phase).toBe('recovery'); expect(releases).toBe(0);
});

it('production compatibility gate runs before heartbeat and claim', async () => {
  supervisor.native.admissionReadiness = () => ({ allowed: false });
  await expect(supervisor.start()).rejects.toMatchObject({ code: 'COMPATIBILITY_GATE_BLOCKED' });
  expect(calls).toEqual([]);
});

it('binds acknowledged native events before reporting submission to the control plane', async () => {
  const id = enqueue(); let bound: string | undefined;
  eventBind = async attemptId => {
    bound = attemptId;
    expect(nativeCalls).toBe(1); expect(calls).not.toContain('submitted');
    expect(f.store.run(id).status).toBe('claimed');
  };
  const row = await supervisor.start();
  expect(bound).toBe(row.attemptId); expect(row.phase).toBe('running');
});

it.each(['journal failure', 'expired lease'])('event binding %s parks admitted work without replay or release', async failure => {
  const id = enqueue();
  eventBind = async () => {
    if (failure === 'journal failure') throw new Error('private diagnostic');
    f.setNow('2026-09-10T00:01:30.000Z');
  };
  const row = await supervisor.start();
  expect(row.phase).toBe('submission_unknown'); expect(supervisor.phase).toBe('recovery');
  expect(f.store.run(id).status).toBe('claimed'); expect(calls).not.toContain('submitted');
  await expect(supervisor.dispatch()).rejects.toMatchObject({ code: 'EXECUTOR_FENCED' });
  expect(nativeCalls).toBe(1); expect(releases).toBe(0);
});
