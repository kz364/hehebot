import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { LifecycleCore, type HeartbeatOperation } from '../src/core/lifecycle';
import { NativeTaskLedger } from '../src/core/native-tasks';
import { EffectLedger } from '../src/core/effects';
import { ResourceLedger } from '../src/core/resources';
import type { MemoryPut } from '../src/core/types';
import { FileJournal } from '../runtime/file-journal.mjs';
import { ExecutionSupervisor } from '../runtime/execution-supervisor.mjs';
import { bot, otherBot, fixture } from './helpers';

it.each(['acknowledged', 'reply-lost'] as const)(
  'expiry targets the admitted runtime attempt with interrupt %s, retaining uncertain custody through the original grace', async interrupt => {
    const f = fixture(true), directory = await mkdtemp(join(tmpdir(), 'hehe-expiry-runtime-'));
    let supervisor: any;
    try {
      const life = new LifecycleCore(f.store, f.core, { idleMode: true });
      // Bootstrap only; admission, effects, locks and cancellation use public core APIs.
      f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=7,lease_until='2026-09-10T00:02:00.000Z'");
      const identity = life.registerBoot(randomUUID()); life.ready(identity);
      const enqueue = (persona: string) => f.accept({ schema_version: 1, type: 'message.send',
        payload: { conversation_id: persona, text: 'Synthetic expiry integration work' } }).resource_id!;
      const memory = (persona: string, expires_at: string | null) => {
        const source = randomUUID();
        f.store.event(source, persona, 'message.user', 'owner', null, { text: 'Synthetic source' }, f.core.now());
        const payload: MemoryPut = { id: randomUUID(), expected_revision: 0, scope: { kind: 'persona', id: persona },
          text: `Synthetic private context ${persona}/${expires_at}`, source_event_id: source, expires_at, sensitivity: 'ordinary' };
        expect(f.accept({ schema_version: 1, type: 'memory.put', payload }).status).toBe('applied');
        return payload;
      };
      const first = memory(bot, '2026-09-10T00:00:10.000Z');
      const second = memory(bot, '2026-09-10T00:00:25.000Z');
      const permanent = memory(bot, null), otherMemory = memory(otherBot, '2026-09-10T00:05:00.000Z');

      // An independently owned, still-running task survives its coordinator's completion.
      const otherRoot = enqueue(otherBot);
      expect(life.claim(identity)?.run.id).toBe(otherRoot);
      life.submitted(identity, otherRoot, 1, 'other-root-native-19');
      const other = new NativeTaskLedger(f.store, f.core, life).register(identity, {
        parent_run_id: otherRoot, parent_attempt: 1, persona_id: otherBot,
        native_run_ref: 'other-child-native-43', native_session_key: 'synthetic:other-child-43', title: 'Unrelated active task',
      }, true);
      life.complete(identity, otherRoot, 1, { status: 'completed', text: 'Coordinator only settled' });

      const runId = enqueue(bot), journal = new FileJournal(directory);
      const calls: string[] = [], cancellations: string[] = [], submissions: any[] = [];
      const replies: string[][] = [];
      let ensures = 0, releases = 0;
      const operations: HeartbeatOperation[] = [];
      const control = { request: async (type: string, p: any) => {
        calls.push(type);
        if (type === 'heartbeat') {
          const reply = life.heartbeat(p.identity, p.operations); replies.push(reply.cancellations); return reply;
        }
        if (type === 'claim') return life.claim(p.identity);
        if (type === 'submitted') return life.submitted(p.identity, p.run_id, p.attempt, p.native_ref);
        if (type === 'complete') return life.complete(p.identity, p.run_id, p.attempt, p.result);
        if (type === 'prepare-sleep') return life.prepareSleep(p.identity);
        if (type === 'commit-sleep') return life.commitSleep(p.identity, p.stop_token, p.queue_sequence, p.checkpoint);
        throw new Error(`Unexpected request: ${type}`);
      } };
      supervisor = new ExecutionSupervisor({ control, identity, journal, installationId: 'expiry-fixture',
        personas: { [bot]: { agentId: 'synthetic-target', model: 'gpt-5.4' } },
        native: {
          admissionReadiness: () => ({ allowed: true }), sleepReadiness: () => ({ allowed: true }),
          submit: async (input: any) => { submissions.push(input); return { nativeRunId: 'target-native-71', status: 'running' }; },
          cancel: async (attemptId: string) => {
            cancellations.push(attemptId);
            if (interrupt === 'reply-lost') throw new Error('Synthetic interrupt acknowledgement lost');
          },
        }, operations: async () => operations, now: () => f.core.options.now().getTime(),
        activity: { ensure: async () => { ensures++; }, releaseAfterDrain: async () => { releases++; } },
      });
      const row = await supervisor.start();
      expect(row.claim.run.id).toBe(runId);
      expect(row.claim.run.current_attempt).toBe(1);
      expect(row.attemptId).toBe(submissions[0].attemptId);
      expect(row.attemptId).not.toBe(row.nativeRunId);
      expect(JSON.parse(submissions[0].message).memories.map((m: MemoryPut) => m.id).sort())
        .toEqual([first.id, second.id, permanent.id].sort());
      expect(JSON.parse(f.store.run(other.id).context_json).memories.map((m: MemoryPut) => m.id)).toEqual([otherMemory.id]);

      const resources = new ResourceLedger(f.store, () => f.core.now());
      const effects = new EffectLedger(f.store, () => f.core.now());
      for (const [id, resource, status] of [[runId, 'browser:target-71', 'outcome_unknown'],
        [other.id, 'browser:unrelated-43', 'dispatched']] as const) {
        resources.acquire(id, 1, [resource]);
        const effect = effects.intent({ id: randomUUID(), run_id: id, attempt: 1, action_key: `read:${id}`,
          classification: 'read_only', authorization_ref: 'synthetic-read', request_digest: `request:${id}`, provider_idempotency_key: null });
        effects.transition(effect.id, id, status, null);
        operations.push({ id: randomUUID(), run_id: id, attempt: 1, kind: 'tool',
          status: id === runId ? 'unknown' : 'active', started_at: f.core.now(),
          deadline_at: row.claim.deadline_at, last_progress_at: f.core.now() });
      }
      await supervisor.maintain();
      const originalAttempts = f.db.all('SELECT * FROM attempts ORDER BY run_id,attempt');
      const originalEffects = f.db.all('SELECT * FROM effects ORDER BY id');
      const originalLocks = f.db.all('SELECT * FROM resource_locks ORDER BY resource_id');
      const originalOperations = f.db.all('SELECT * FROM operations ORDER BY id');
      const otherBefore = f.store.run(other.id), rootBefore = f.store.run(otherRoot);
      const outboxBefore = f.db.all('SELECT * FROM outbox ORDER BY id');
      const queueSequence = life.get().queue_sequence;
      const assertCustody = async () => {
        expect(f.store.run(other.id)).toEqual(otherBefore); expect(f.store.run(otherRoot)).toEqual(rootBefore);
        expect(f.db.all('SELECT * FROM attempts ORDER BY run_id,attempt')).toEqual(originalAttempts);
        expect(f.db.all('SELECT * FROM effects ORDER BY id')).toEqual(originalEffects);
        expect(f.db.all('SELECT * FROM resource_locks ORDER BY resource_id')).toEqual(originalLocks);
        expect(f.db.all('SELECT * FROM operations ORDER BY id')).toEqual(originalOperations);
        expect(f.db.all('SELECT * FROM outbox ORDER BY id')).toEqual(outboxBefore);
        expect(f.db.all('SELECT * FROM retry_queue')).toEqual([]);
        expect(f.db.all('SELECT id FROM runs')).toHaveLength(3);
        expect(life.get()).toMatchObject({ phase: 'READY', desired_state: 'RUN', queue_sequence: queueSequence });
        expect(await journal.get(supervisor.bridge.cursor)).toEqual(row);
        expect(submissions).toHaveLength(1); expect(releases).toBe(0);
        expect(calls).not.toContain('complete'); expect(calls).not.toContain('prepare-sleep'); expect(calls).not.toContain('commit-sleep');
      };

      f.setNow('2026-09-10T00:00:09.999Z');
      expect(f.core.expireMemories()).toBe(0); await supervisor.maintain();
      expect(f.store.run(runId).status).toBe('running'); expect(cancellations).toEqual([]);
      expect(replies.at(-1)).toEqual([]);

      f.setNow(first.expires_at!);
      expect(f.core.expireMemories()).toBe(1);
      expect(f.store.run(runId)).toMatchObject({ status: 'cancelling', error_code: 'CONTEXT_INVALIDATED', updated_at: first.expires_at });
      expect(JSON.parse(f.store.run(runId).context_json).memories.map((m: MemoryPut) => m.id).sort())
        .toEqual([second.id, permanent.id].sort());
      expect(cancellations).toEqual([]); // Control expiry itself never invokes the transport.
      const beforeEnsure = ensures;
      if (interrupt === 'reply-lost') await expect(supervisor.maintain()).rejects.toThrow('Synthetic interrupt acknowledgement lost');
      else await supervisor.maintain();
      expect(ensures).toBe(beforeEnsure + 1);
      expect(replies.at(-1)).toEqual([runId]); expect(cancellations).toEqual([row.attemptId]);
      await assertCustody();

      f.setNow(second.expires_at!); expect(f.core.expireMemories()).toBe(1);
      expect(f.store.run(runId).updated_at).toBe(first.expires_at);
      expect(JSON.parse(f.store.run(runId).context_json).memories.map((m: MemoryPut) => m.id)).toEqual([permanent.id]);
      f.setNow('2026-09-10T00:00:39.999Z'); life.watchdog();
      expect(f.store.run(runId).status).toBe('cancelling');
      f.setNow('2026-09-10T00:00:40.000Z'); life.watchdog();
      expect(f.store.run(runId)).toMatchObject({ status: 'recovery_required', error_code: 'CONTEXT_INVALIDATED', current_attempt: 1 });
      life.retryDue();
      // Even a full idle-grace interval after the first interrupt is not settlement.
      f.setNow('2026-09-10T00:01:10.000Z');
      if (interrupt === 'acknowledged') {
        await supervisor.maintain(); expect(replies.at(-1)).toEqual([runId]);
        expect(cancellations).toEqual([row.attemptId, row.attemptId]);
        await expect(supervisor.complete({ attemptId: row.attemptId, nativeRunId: row.nativeRunId,
          rootSettled: true, toolsSettled: false, childrenSettled: true, effectsSettled: false, outputCommitted: true,
          result: { status: 'cancelled', text: '' } })).rejects.toMatchObject({ code: 'NATIVE_SETTLEMENT_INCOMPLETE' });
        await expect(supervisor.dispatch()).resolves.toEqual(row);
        await expect(supervisor.drain({ snapshot: 'must-not-sleep' })).rejects.toMatchObject({ code: 'SLEEP_DENIED' });
        expect(supervisor.phase).toBe('running');
      } else {
        const before = [...calls];
        await expect(supervisor.maintain()).rejects.toMatchObject({ code: 'EXECUTOR_FENCED' });
        await expect(supervisor.dispatch()).rejects.toMatchObject({ code: 'EXECUTOR_FENCED' });
        await expect(supervisor.drain({ snapshot: 'must-not-sleep' })).rejects.toMatchObject({ code: 'EXECUTOR_FENCED' });
        expect(calls).toEqual(before); expect(cancellations).toEqual([row.attemptId]);
        expect(supervisor.phase).toBe('recovery'); expect(supervisor.timer).toBeNull();
      }
      expect(() => life.prepareSleep(identity)).toThrowError(expect.objectContaining({ code: 'SLEEP_DENIED' }));
      expect(() => resources.release(runId, 1, ['browser:target-71'])).toThrowError(expect.objectContaining({ code: 'OUTCOME_UNKNOWN' }));
      await assertCustody();
    } finally {
      supervisor?.disconnect(); await supervisor?.work;
      f.close(); await rm(directory, { recursive: true, force: true });
    }
  },
);
