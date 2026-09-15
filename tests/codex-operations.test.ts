import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { CodexOperations } from '../runtime/codex-operations.mjs';
import { FileJournal } from '../runtime/file-journal.mjs';
import { LifecycleCore, type HeartbeatOperation } from '../src/core/lifecycle';
import { fixture, bot } from './helpers';

it.each(['message', 'plan'])('overlapping streams preserve the remaining %s deadline and cancellation grace', async remaining => {
  const f = fixture(true), directory = await mkdtemp(join(tmpdir(), 'hehebot-overlap-deadline-'));
  try {
    const life = new LifecycleCore(f.store, f.core);
    f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=1,lease_until='2026-09-10T00:02:00.000Z'");
    const identity = life.registerBoot(randomUUID()); life.ready(identity);
    f.accept({ schema_version: 1, type: 'message.send', payload: { conversation_id: bot, text: 'Synthetic overlapping streams' } });
    const claim = life.claim(identity)!; life.submitted(identity, claim.run.id, 1, 'turn');
    const journal = new FileJournal(directory);
    const row = { status: 'running', threadId: 'root', nativeRunId: 'turn', messageStarts: { message: true },
      planItems: { plan: 'inProgress' }, operationTimes: {
        '["messageStarts","message"]': { startedAt: '2026-09-10T00:07:00.000Z', lastProgressAt: '2026-09-10T00:07:00.000Z' },
        '["planItems","plan"]': { startedAt: '2026-09-10T00:08:00.000Z', lastProgressAt: '2026-09-10T00:08:00.000Z' },
      } };
    await journal.write('native-attempt', row);
    const projection = new CodexOperations({ journal, attemptId: 'native-attempt', runId: claim.run.id, attempt: 1,
      startedAt: f.core.now(), deadlineAt: claim.deadline_at });
    const heartbeat = async () => life.heartbeat(identity, await projection.snapshot() as HeartbeatOperation[]);
    // Advance the fixture clock without exercising the independent lease-expiry path.
    f.db.exec("UPDATE lifecycle SET lease_until='2026-09-10T00:20:00.000Z'");
    f.setNow('2026-09-10T00:11:59.998Z'); await heartbeat();
    expect(f.db.all('SELECT deadline_at FROM operations WHERE kind=? AND deadline_at<? ORDER BY deadline_at', 'inference', claim.deadline_at))
      .toEqual([{ deadline_at: '2026-09-10T00:12:00.000Z' }, { deadline_at: '2026-09-10T00:13:00.000Z' }]);
    await journal.update('native-attempt', remaining === 'message' ? { planItems: { plan: 'completed' } }
      : { outputItems: { message: 'a'.repeat(64) } });
    await heartbeat();
    const deadline = remaining === 'message' ? '2026-09-10T00:12:00.000Z' : '2026-09-10T00:13:00.000Z';
    if (remaining === 'plan') {
      f.setNow('2026-09-10T00:12:00.000Z'); life.watchdog();
      expect(f.store.run(claim.run.id).status).toBe('running');
    }
    f.setNow(new Date(Date.parse(deadline) - 1).toISOString()); await heartbeat(); life.watchdog();
    expect(f.store.run(claim.run.id).status).toBe('running');
    f.setNow(deadline); life.watchdog();
    expect(f.store.run(claim.run.id)).toMatchObject({ status: 'cancelling', error_code: 'DEADLINE_EXCEEDED', updated_at: deadline });
    expect((await heartbeat()).cancellations).toEqual([claim.run.id]);
    f.setNow(new Date(Date.parse(deadline) + 29999).toISOString()); await heartbeat(); life.watchdog();
    expect(f.store.run(claim.run.id)).toMatchObject({ status: 'cancelling', updated_at: deadline });
    f.setNow(new Date(Date.parse(deadline) + 30000).toISOString()); life.watchdog();
    expect(f.store.run(claim.run.id)).toMatchObject({ status: 'recovery_required', error_code: 'CANCEL_UNCONFIRMED' });
    expect(f.db.all("SELECT status FROM attempts WHERE run_id=?", claim.run.id)).toEqual([{ status: 'running' }]);
    expect(f.db.all("SELECT id FROM operations WHERE status='active'")).toHaveLength(2);
    expect(f.db.all("SELECT id FROM operations WHERE status='unknown'")).toHaveLength(1);
    expect(f.db.all('SELECT run_id FROM retry_queue')).toEqual([]);
    expect(() => life.prepareSleep(identity)).toThrowError(expect.objectContaining({ code: 'SLEEP_DENIED' }));
  } finally { f.close(); await rm(directory, { recursive: true, force: true }); }
});

it('persists native invocation states into SQLite without authorizing result publication or sleep', async () => {
  const f = fixture(true), directory = await mkdtemp(join(tmpdir(), 'hehebot-operation-control-'));
  try {
    const life = new LifecycleCore(f.store, f.core);
    f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=1,lease_until='2026-09-10T00:02:00.000Z'");
    const identity = life.registerBoot(randomUUID()); life.ready(identity);
    f.accept({ schema_version: 1, type: 'message.send', payload: { conversation_id: bot, text: 'Synthetic operation accounting' } });
    const claim = life.claim(identity)!;
    const journal = new FileJournal(directory);
    const child = JSON.stringify(['child-a', 'turn']);
    await journal.putIfAbsent('native-attempt', { threadId: 'root', nativeRunId: 'turn', rootSettled: true,
      status: 'finishing', childTurns: { [child]: 'completed' },
      childObligations: { [child]: { mcpCalls: { call: 'inProgress' } } } });
    const operations = new CodexOperations({ journal, attemptId: 'native-attempt', runId: claim.run.id,
      attempt: claim.run.current_attempt, startedAt: f.core.now(), deadlineAt: claim.deadline_at });
    const heartbeat = async () => life.heartbeat(identity, await operations.snapshot() as HeartbeatOperation[]);
    await heartbeat();
    expect(f.db.all<{kind: string; status: string}>('SELECT kind,status FROM operations ORDER BY kind,status')).toEqual([
      { kind: 'child', status: 'settled' }, { kind: 'inference', status: 'settled' },
      { kind: 'tool', status: 'active' }, { kind: 'tool', status: 'unknown' },
    ]);
    await journal.update('native-attempt', { childObligations: { [child]: { mcpCalls: { call: 'completed' } } } });
    await heartbeat(); await heartbeat();
    expect(f.db.all('SELECT id FROM operations')).toHaveLength(4);
    expect(f.db.all("SELECT id FROM operations WHERE status='active'")).toHaveLength(0);
    expect(f.db.all("SELECT id FROM operations WHERE status='unknown'")).toHaveLength(1);
    expect(() => life.complete(identity, claim.run.id, 1, { status: 'completed', text: 'Not authorized' }))
      .toThrowError(expect.objectContaining({ code: 'CANCEL_UNCONFIRMED' }));
    expect(() => life.prepareSleep(identity)).toThrowError(expect.objectContaining({ code: 'SLEEP_DENIED' }));
    expect(f.store.run(claim.run.id).status).toBe('claimed');
  } finally { f.close(); await rm(directory, { recursive: true, force: true }); }
});

it.each(['tool', 'initial', 'child', 'startup', 'quiet'])('Worker watchdog cancels at the %s phase deadline, not after the hard deadline', async phase => {
  const f = fixture(true), directory = await mkdtemp(join(tmpdir(), 'hehebot-tool-deadline-'));
  try {
    const life = new LifecycleCore(f.store, f.core);
    f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=1,lease_until='2026-09-10T00:02:00.000Z'");
    const identity = life.registerBoot(randomUUID()); life.ready(identity);
    f.accept({ schema_version: 1, type: 'message.send', payload: { conversation_id: bot, text: 'Synthetic phase deadline' } });
    const claim = life.claim(identity)!; life.submitted(identity, claim.run.id, 1, 'turn');
    const journal = new FileJournal(directory);
    await journal.putIfAbsent('native-attempt', { status: 'running', threadId: 'root', nativeRunId: 'turn',
      ...(phase === 'initial' ? { initialInference: 'inProgress' } : phase === 'child' ? {
        childTurns: { '["child","turn"]': 'inProgress' }, childObligations: { '["child","turn"]': {
          initialInference: 'inProgress', initialInferenceAt: '2026-09-10T00:07:00.000Z' } },
      } : phase === 'startup' ? { spawns: { spawn: { status: 'completed', receiverThreadIds: ['child'] } },
        operationTimes: { '["spawns","spawn"]': { startedAt: '2026-09-10T00:09:00.000Z', lastProgressAt: '2026-09-10T00:10:00.000Z' } },
      } : phase === 'quiet' ? { commands: { call: 'completed' },
        quietPhases: { '["commands","call"]': { status: 'inProgress', startedAt: '2026-09-10T00:07:00.000Z' } },
      } : { commands: { call: 'inProgress' },
        operationTimes: { '["commands","call"]': { startedAt: '2026-09-10T00:10:00.000Z', lastProgressAt: '2026-09-10T00:10:00.000Z' } } }) });
    const projection = new CodexOperations({ journal, attemptId: 'native-attempt', runId: claim.run.id, attempt: 1,
      startedAt: f.core.now(), deadlineAt: claim.deadline_at });
    // Isolate the phase watchdog from the independently tested heartbeat lease.
    f.db.exec("UPDATE lifecycle SET lease_until='2026-09-10T00:20:00.000Z'");
    f.setNow(phase === 'initial' ? '2026-09-10T00:04:59.999Z' : '2026-09-10T00:11:59.999Z');
    life.heartbeat(identity, await projection.snapshot() as HeartbeatOperation[]); life.watchdog();
    expect(f.store.run(claim.run.id).status).toBe('running');
    f.setNow(phase === 'initial' ? '2026-09-10T00:05:00.000Z' : '2026-09-10T00:12:00.000Z'); life.watchdog();
    expect(f.store.run(claim.run.id)).toMatchObject({ status: 'cancelling', error_code: 'DEADLINE_EXCEEDED' });
    expect(f.db.all("SELECT id FROM operations WHERE status='active'")).toHaveLength(phase === 'child' ? 3 : 2);
    expect(f.db.all("SELECT status FROM attempts WHERE run_id=?", claim.run.id)).toEqual([{ status: 'running' }]);
  } finally { f.close(); await rm(directory, { recursive: true, force: true }); }
});
