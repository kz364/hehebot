import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fixture, bot, otherBot } from './helpers';
import { LifecycleCore } from '../src/core/lifecycle';
import { FileJournal } from '../runtime/file-journal.mjs';
import { CodexOperations } from '../runtime/codex-operations.mjs';
import { ExecutionSupervisor } from '../runtime/execution-supervisor.mjs';

let f: ReturnType<typeof fixture>, life: LifecycleCore, directory: string, supervisor: any;
let calls: string[], cancellations: string[], releases: number, nativeCalls: number;
let hook: ((type: string) => Promise<void>) | undefined;
let eventBind: (id: string) => Promise<void>;
beforeEach(async () => {
  f = fixture(true); life = new LifecycleCore(f.store, f.core, { idleMode: true });
  f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=1,lease_until='2026-09-10T00:02:00.000Z'");
  const identity = life.registerBoot(randomUUID()); life.ready(identity);
  directory = await mkdtemp(join(tmpdir(), 'hehe-supervisor-'));
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

it.each(['commit_unknown', 'committed'])('prior %s drain intent cannot be overwritten or reused', async phase => {
  await supervisor.start(); f.setNow('2026-09-10T00:01:00.000Z');
  const key = `drain-${supervisor.bridge.cursor}`, prior = { checkpoint: { snapshot: 'original' },
    stop: { stop_token: 'old-token', queue_sequence: 17 }, phase };
  await supervisor.journal.putIfAbsent(key, prior);
  await expect(supervisor.drain({ snapshot: 'replacement' })).rejects.toMatchObject({ code: 'DRAIN_REPLAY_FORBIDDEN' });
  expect(supervisor.phase).toBe('recovery'); expect(releases).toBe(0);
  expect(calls).not.toContain('commit-sleep');
  expect(await supervisor.journal.get(key)).toEqual(prior);
  expect(f.db.all("SELECT value_json FROM runtime_metadata WHERE key='checkpoint'")).toHaveLength(0);
});

it('a null drain record is corruption, not permission to insert a fresh intent', async () => {
  await supervisor.start(); f.setNow('2026-09-10T00:01:00.000Z');
  const path = join(directory, `drain-${supervisor.bridge.cursor}.json`);
  await writeFile(path, 'null', { mode: 0o600 });
  await expect(supervisor.drain({ snapshot: 'replacement' })).rejects.toMatchObject({ code: 'INVALID_JOURNAL_RECORD' });
  expect(await readFile(path, 'utf8')).toBe('null');
  expect(supervisor.phase).toBe('recovery'); expect(releases).toBe(0);
  expect(calls).not.toContain('commit-sleep');
  expect(f.db.all("SELECT value_json FROM runtime_metadata WHERE key='checkpoint'")).toHaveLength(0);
});

it.each(['journal-read', 'prepare-sleep', 'commit-sleep'])('drain detaches nested checkpoint state before %s caller mutation', async boundary => {
  await supervisor.start(); f.setNow('2026-09-10T00:01:00.000Z');
  const checkpoint = { snapshot: 'original', nested: { generation: 17 }, files: ['one'] };
  hook = async type => {
    if (type === boundary) { checkpoint.snapshot = 'changed'; checkpoint.nested.generation = 43; checkpoint.files.push('two'); }
  };
  const get = supervisor.journal.get.bind(supervisor.journal);
  supervisor.journal.get = async (key: string) => {
    const result = await get(key);
    if (key === supervisor.bridge.cursor) await hook?.('journal-read');
    return result;
  };
  await supervisor.drain(checkpoint);
  const expected = { snapshot: 'original', nested: { generation: 17 }, files: ['one'] };
  expect((await supervisor.journal.get(`drain-${supervisor.bridge.cursor}`)).checkpoint).toEqual(expected);
  expect(JSON.parse(f.db.all<{ value_json: string }>("SELECT value_json FROM runtime_metadata WHERE key='checkpoint'")[0].value_json)).toEqual(expected);
  expect(supervisor.phase).toBe('sleeping'); expect(releases).toBe(1);
});

it('nonserializable or empty wire checkpoints fail before prepare without poisoning the supervisor', async () => {
  await supervisor.start(); f.setNow('2026-09-10T00:01:00.000Z');
  const cyclic: any = {}; cyclic.self = cyclic;
  for (const checkpoint of [cyclic, { value: 1n }, { value: undefined }, { toJSON: () => [] }]) {
    await expect(supervisor.drain(checkpoint)).rejects.toMatchObject({ code: 'INVALID_CHECKPOINT' });
    expect(supervisor.phase).toBe('running'); expect(releases).toBe(0);
    expect(calls).not.toContain('prepare-sleep');
  }
  await supervisor.drain({ snapshot: 'valid-after-rejection' });
  expect(supervisor.phase).toBe('sleeping'); expect(releases).toBe(1);
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

it.each(['activity', 'operations', 'reply'])('lease expiry during %s cannot revive local admission', async boundary => {
  await supervisor.start();
  const originalLease = supervisor.leaseUntil, before = calls.length;
  f.setNow('2026-09-10T00:00:50.000Z');
  const expire = () => f.setNow('2026-09-10T00:01:30.000Z');
  if (boundary === 'activity') supervisor.activity.ensure = async () => { expire(); };
  if (boundary === 'operations') supervisor.operations = async () => { expire(); return []; };
  if (boundary === 'reply') {
    const request = supervisor.control.request;
    supervisor.control.request = async (type: string, p: any) => {
      const reply = await request(type, p);
      expire(); // Server renewed on time; delivery resumes after the old local lease.
      return reply;
    };
  }
  await expect(supervisor.maintain()).rejects.toMatchObject({ code: 'EXECUTOR_FENCED' });
  expect(calls.slice(before)).toEqual(boundary === 'reply' ? ['heartbeat'] : []);
  expect(life.get().lease_until).toBe(boundary === 'reply'
    ? '2026-09-10T00:02:20.000Z' : '2026-09-10T00:01:30.000Z');
  expect(supervisor.leaseUntil).toBe(originalLease);
  expect(supervisor.phase).toBe('recovery');
  await expect(supervisor.dispatch()).rejects.toMatchObject({ code: 'EXECUTOR_FENCED' });
  expect(nativeCalls).toBe(0); expect(releases).toBe(0);
});

it.each(['activity', 'operations', 'reply'])('startup disconnect during %s preserves the local fence', async boundary => {
  if (boundary === 'activity') supervisor.activity.ensure = async () => { supervisor.disconnect(); };
  if (boundary === 'operations') supervisor.operations = async () => { supervisor.disconnect(); return []; };
  if (boundary === 'reply') {
    const request = supervisor.control.request;
    supervisor.control.request = async (type: string, p: any) => {
      const reply = await request(type, p);
      supervisor.disconnect();
      return reply;
    };
  }
  await expect(supervisor.start()).rejects.toMatchObject({ code: 'EXECUTOR_FENCED' });
  expect(calls).toEqual(boundary === 'reply' ? ['heartbeat'] : []);
  expect(supervisor.leaseUntil).toBe(0);
  expect(supervisor.phase).toBe('recovery'); expect(releases).toBe(0);
});

it('disconnect while startup awaits heartbeat cannot resurrect admission', async () => {
  hook = async type => { if (type === 'heartbeat') supervisor.disconnect(); };
  await expect(supervisor.start()).rejects.toMatchObject({ code: 'EXECUTOR_FENCED' });
  expect(supervisor.phase).toBe('recovery'); expect(calls).toEqual(['heartbeat']);
});

it('reports every operation across bounded pages and preserves earlier cancellation replies', async () => {
  const id = enqueue(), row = await supervisor.start();
  const operations = Array.from({ length: 201 }, (_, i) => ({ id: randomUUID(), run_id: id, attempt: 1,
    kind: 'tool', status: i === 100 ? 'unknown' : 'active', started_at: f.core.now(),
    deadline_at: row.claim.deadline_at, last_progress_at: f.core.now() }));
  supervisor.operations = async () => operations;
  const request = supervisor.control.request, pages: any[][] = [];
  supervisor.control.request = async (type: string, payload: any) => {
    const reply = await request(type, payload);
    if (type === 'heartbeat') {
      pages.push(payload.operations);
      // Cancellation can appear in an earlier page, not only the final reply.
      return { ...reply, cancellations: pages.length === 1 ? [id] : [] };
    }
    return reply;
  };
  await supervisor.maintain();
  expect(pages.map(page => page.length)).toEqual([100, 100, 1]);
  expect(pages.flat()).toEqual(operations);
  expect(cancellations).toEqual([row.attemptId]);
  expect(f.db.all('SELECT id FROM operations')).toHaveLength(201);
  operations.forEach((op, i) => { if (i !== 100 && i !== 200) op.status = 'settled'; });
  await supervisor.maintain();
  expect(f.db.all("SELECT id FROM operations WHERE status='unknown'")).toEqual([{ id: operations[100].id }]);
  expect(f.db.all("SELECT id FROM operations WHERE status='active'")).toEqual([{ id: operations[200].id }]);
  await expect(supervisor.complete(settlement(row))).rejects.toThrow();
  expect(f.store.run(id).status).toBe('running'); expect(releases).toBe(0);
});

it.each(['before', 'after', 'expired', 'disconnected', 'invalid-reply'])('partial heartbeat %s failure stops later pages and retains custody', async boundary => {
  const id = enqueue(), row = await supervisor.start(), originalLease = supervisor.leaseUntil;
  const operations = Array.from({ length: 201 }, () => ({ id: randomUUID(), run_id: id, attempt: 1,
    kind: 'tool', status: 'active', started_at: f.core.now(), deadline_at: row.claim.deadline_at, last_progress_at: f.core.now() }));
  supervisor.operations = async () => operations;
  const request = supervisor.control.request; let pages = 0;
  supervisor.control.request = async (type: string, payload: any) => {
    if (type !== 'heartbeat') return request(type, payload);
    pages++;
    if (pages === 2 && boundary === 'before') throw new Error('not sent');
    const reply = await request(type, payload);
    if (pages === 2) {
      if (boundary === 'expired') f.setNow('2026-09-10T00:01:30.000Z');
      if (boundary === 'disconnected') supervisor.disconnect();
      if (boundary === 'after') throw new Error('lost reply');
      if (boundary === 'invalid-reply') return { ...reply, cancellations: null };
    }
    return reply;
  };
  f.setNow('2026-09-10T00:00:50.000Z');
  await expect(supervisor.maintain()).rejects.toThrow();
  expect(pages).toBe(2);
  expect(f.db.all('SELECT id FROM operations')).toHaveLength(boundary === 'before' ? 100 : 200);
  expect(supervisor.leaseUntil).toBe(originalLease);
  expect(supervisor.phase).toBe('recovery'); expect(releases).toBe(0); expect(cancellations).toEqual([]);
  expect(nativeCalls).toBe(1); expect(f.store.run(id).status).toBe('running');
  await expect(supervisor.dispatch()).rejects.toThrow(); expect(pages).toBe(2);
});

it.each([null, {}, Array(4097).fill({})])('rejects malformed or unbounded operation snapshots before sending any page', async operations => {
  await supervisor.start(); const before = calls.length;
  supervisor.operations = async () => operations;
  await expect(supervisor.maintain()).rejects.toThrow();
  expect(calls.length).toBe(before); expect(supervisor.phase).toBe('recovery'); expect(releases).toBe(0);
});

it.each([false, true])('1000 passive publications add zero native submissions with existing work=%s', async active => {
  const roomId = randomUUID();
  expect(f.accept({ schema_version: 1, type: 'room.put', payload: { id: roomId, expected_revision: 0,
    name: 'Passive supervisor fixture', member_ids: [bot, otherBot], default_responder_id: bot } }).status).toBe('applied');
  if (active) enqueue();
  await supervisor.start(); await supervisor.dispatch();
  expect(nativeCalls).toBe(active ? 1 : 0);
  const before = f.db.all('SELECT * FROM runs'), originalAttempts = f.db.all('SELECT * FROM attempts');
  const sequence = life.get().queue_sequence;
  for (let i = 0; i < 1000; i++) {
    expect(f.accept({ schema_version: 1, type: 'room.publish', payload: { room_id: roomId,
      kind: 'context_update', recipient_ids: [i % 3 === 0 ? otherBot : bot], text: `Passive ${i}`,
      references: [], cause_id: randomUUID() } }).status).toBe('applied');
    if (i % 100 === 99) { await supervisor.maintain(); await supervisor.dispatch(); }
  }
  expect(nativeCalls).toBe(active ? 1 : 0); expect(cancellations).toEqual([]); expect(releases).toBe(0);
  expect(supervisor.phase).toBe('running'); expect(life.get().queue_sequence).toBe(sequence);
  expect(f.db.all('SELECT * FROM runs')).toEqual(before); expect(f.db.all('SELECT * FROM attempts')).toEqual(originalAttempts);
  expect(f.db.all("SELECT id FROM events WHERE type='room.context_update'")).toHaveLength(1000);
  expect(f.db.all('SELECT * FROM task_followups')).toEqual([]); expect(f.db.all('SELECT * FROM outbox')).toEqual([]);
});

it.each([
  { name: 'orphan clock', patch: { operationTimes: { '["commands","missing"]': { startedAt: '2026-09-10T00:00:00.000Z', lastProgressAt: '2026-09-10T00:00:00.000Z' } } }, code: 'INVALID_OPERATION_TIMING', heartbeatCalls: 0 },
  { name: 'null inventory', patch: { commands: null }, code: 'INVALID_OPERATION_INVENTORY', heartbeatCalls: 0 },
  { name: 'invalid completion', patch: { outputItems: { message: false } }, code: 'INVALID_OUTPUT_COMPLETION', heartbeatCalls: 0 },
  { name: 'start beyond hard deadline', patch: { commands: { valid: 'inProgress', late: 'inProgress' }, operationTimes: { '["commands","late"]': { startedAt: '2026-09-10T00:21:00.000Z', lastProgressAt: '2026-09-10T00:21:00.000Z' } } }, code: 'INVALID_INPUT', heartbeatCalls: 1 },
])('$name fences maintenance without losing prior custody or replaying work', async ({ patch, code, heartbeatCalls }) => {
  const id = enqueue(); await supervisor.start(); await supervisor.dispatch();
  const journal = new FileJournal(directory), now = f.core.now();
  await journal.putIfAbsent('snapshot-proof', { status: 'running', commands: { valid: 'inProgress' } });
  const projection = new CodexOperations({ journal, attemptId: 'snapshot-proof', runId: id, attempt: 1,
    startedAt: now, deadlineAt: '2026-09-10T00:20:00.000Z' });
  supervisor.operations = () => projection.snapshot();
  await supervisor.maintain();
  const operations = f.db.all('SELECT * FROM operations ORDER BY id'), attempts = f.db.all('SELECT * FROM attempts'),
    runs = f.db.all('SELECT * FROM runs'), lease = life.get(), localLease = supervisor.leaseUntil;
  expect(operations).toHaveLength(3);
  await journal.update('snapshot-proof', patch);
  const before = calls.length, original = await readFile(journal.path('snapshot-proof'));
  f.setNow('2026-09-10T00:00:10.000Z');
  await expect(supervisor.maintain()).rejects.toMatchObject({ code });
  expect(calls.slice(before)).toEqual(Array(heartbeatCalls).fill('heartbeat'));
  expect(supervisor.phase).toBe('recovery'); expect(supervisor.timer).toBeNull(); expect(releases).toBe(0);
  expect(f.db.all('SELECT * FROM operations ORDER BY id')).toEqual(operations);
  expect(f.db.all('SELECT * FROM attempts')).toEqual(attempts); expect(f.db.all('SELECT * FROM runs')).toEqual(runs);
  expect(life.get()).toEqual(lease); expect(supervisor.leaseUntil).toBe(localLease);
  expect(nativeCalls).toBe(1); expect(cancellations).toEqual([]); expect(f.store.run(id).status).toBe('running');
  expect(await readFile(journal.path('snapshot-proof'))).toEqual(original);
  const fencedCalls = calls.length;
  await expect(supervisor.dispatch()).rejects.toMatchObject({ code: 'EXECUTOR_FENCED' });
  await expect(supervisor.maintain()).rejects.toMatchObject({ code: 'EXECUTOR_FENCED' });
  expect(calls.length).toBe(fencedCalls); expect(nativeCalls).toBe(1); expect(releases).toBe(0);
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

it('maintenance synchronizes child identities before delivering targeted cancellations', async () => {
  const id = enqueue(); await supervisor.start();
  f.db.exec("UPDATE runs SET status='cancelling' WHERE id=?", id);
  const order: string[] = [];
  supervisor.children = {
    sync: async () => { expect(calls.at(-1)).toBe('heartbeat'); order.push('sync'); },
    cancel: async (ids: string[]) => { expect(ids).toEqual([id]); order.push('cancel'); },
  };
  await supervisor.maintain();
  expect(order).toEqual(['sync', 'cancel']); expect(cancellations).toHaveLength(1);
  expect(f.store.run(id).status).toBe('cancelling'); expect(releases).toBe(0);
});

it('lease loss during child synchronization prevents native cancellation and releases nothing', async () => {
  const id = enqueue(); await supervisor.start();
  f.db.exec("UPDATE runs SET status='cancelling' WHERE id=?", id);
  supervisor.children = {
    sync: async () => { f.setNow('2026-09-10T00:01:30.000Z'); },
    cancel: async () => { throw new Error('must not reach child interrupt'); },
  };
  await expect(supervisor.maintain()).rejects.toMatchObject({ code: 'EXECUTOR_FENCED' });
  expect(supervisor.phase).toBe('recovery'); expect(cancellations).toEqual([]); expect(releases).toBe(0);
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

it.each(['prepare', 'commit', 'journal', 'release'].flatMap(boundary =>
  ['disconnect', 'expiry'].map(reason => ({ boundary, reason }))))('drain fences $reason after $boundary without claiming sleep or replaying release', async ({ boundary, reason }) => {
  await supervisor.start(); f.setNow('2026-09-10T00:01:00.000Z');
  const invalidate = () => {
    if (reason === 'disconnect') supervisor.disconnect();
    else f.setNow(new Date(supervisor.leaseUntil).toISOString());
  };
  const request = supervisor.control.request;
  supervisor.control.request = async (type: string, p: any) => {
    const result = await request(type, p);
    if (type === (boundary === 'prepare' ? 'prepare-sleep' : boundary === 'commit' ? 'commit-sleep' : 'none')) invalidate();
    return result;
  };
  const update = supervisor.journal.update.bind(supervisor.journal);
  supervisor.journal.update = async (key: string, value: any) => {
    const result = await update(key, value);
    if (boundary === 'journal' && key.startsWith('drain-')) invalidate();
    return result;
  };
  supervisor.activity.releaseAfterDrain = async () => { releases++; if (boundary === 'release') invalidate(); };
  await expect(supervisor.drain({ snapshot: 'fenced' })).rejects.toMatchObject({ code: 'EXECUTOR_FENCED' });
  expect(supervisor.phase).toBe('recovery'); expect(supervisor.timer).toBeNull();
  expect(releases).toBe(boundary === 'release' ? 1 : 0);
  const record = await supervisor.journal.get(`drain-${supervisor.bridge.cursor}`);
  if (boundary === 'prepare') {
    expect(record).toBeNull(); expect(calls).not.toContain('commit-sleep');
  } else expect(record.phase).toBe(boundary === 'commit' ? 'commit_unknown' : 'committed');
  const before = [...calls];
  await expect(supervisor.drain({ snapshot: 'retry' })).rejects.toMatchObject({ code: 'EXECUTOR_FENCED' });
  expect(calls).toEqual(before); expect(releases).toBe(boundary === 'release' ? 1 : 0);
});

it('drain can finish one millisecond before the original lease expiry', async () => {
  await supervisor.start(); f.setNow('2026-09-10T00:01:00.000Z');
  supervisor.activity.releaseAfterDrain = async () => { releases++; f.setNow(new Date(supervisor.leaseUntil - 1).toISOString()); };
  await supervisor.drain({ snapshot: 'within-lease' });
  expect(supervisor.phase).toBe('sleeping'); expect(releases).toBe(1);
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

it('recovers one lost Worker submission reply while retaining exact native execution and cancellation', async () => {
  const id = enqueue(), request = supervisor.control.request; let submissions = 0;
  supervisor.control.request = async (type: string, payload: any) => {
    const result = await request(type, payload);
    if (type === 'submitted' && ++submissions === 1) {
      f.accept({ schema_version: 1, type: 'run.cancel', payload: { run_id: id, reason: 'Cancel during lost reply' } });
      throw new Error('lost submission reply');
    }
    return result;
  };
  const row = await supervisor.start();
  expect(row.phase).toBe('running'); expect(supervisor.phase).toBe('running');
  expect(calls.filter(type => type === 'submitted')).toHaveLength(2); expect(nativeCalls).toBe(1);
  expect(f.store.run(id).status).toBe('cancelling');
  await supervisor.maintain(); expect(cancellations).toEqual([row.attemptId]); expect(releases).toBe(0);
});

it.each(['lost-again', 'expired', 'disconnected'])('bounds submission receipt reconciliation after %s', async failure => {
  enqueue(); const request = supervisor.control.request; let submissions = 0;
  supervisor.control.request = async (type: string, payload: any) => {
    const result = await request(type, payload);
    if (type === 'submitted') {
      submissions++;
      if (failure === 'expired') f.setNow('2026-09-10T00:01:30.000Z');
      if (failure === 'disconnected') supervisor.disconnect();
      throw new Error('submission reply unavailable');
    }
    return result;
  };
  await expect(supervisor.start()).rejects.toThrow();
  expect(submissions).toBe(failure === 'lost-again' ? 2 : 1); expect(nativeCalls).toBe(1);
  expect(supervisor.phase).toBe('recovery'); expect(releases).toBe(0);
  expect((await supervisor.journal.get(supervisor.bridge.cursor)).phase).toBe('submitted_unknown');
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
