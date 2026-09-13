import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LifecycleCore } from '../src/core/lifecycle';
import type { LifecycleCommand, RuntimeObservation, RuntimeProvider, RuntimeRef } from '../src/providers';
import { bot, fixture } from './helpers';

const ref: RuntimeRef = { provider: 'fly-sprites', id: 'synthetic-sprite' };
class IdleProvider implements RuntimeProvider {
  readonly id = 'fly-sprites' as const;
  readonly capabilities = { stopMode: 'provider-idle' as const, implemented: true, explicitWake: true,
    explicitStop: false, confirmedStop: false, persistence: 'filesystem' as const, activityHold: 'native' as const,
    maxSessionSeconds: null, restrictions: ['Synthetic provider; no real calls'] };
  calls: { action: string; epoch: number }[] = [];
  observation: RuntimeObservation = { phase: 'running', executionStopped: false, executionPaused: false, persistentState: 'retained', observedAt: 0 };
  async observe() { return this.observation; }
  async wake(_ref: RuntimeRef, command: LifecycleCommand) { this.calls.push({ action: 'wake', epoch: command.epoch }); }
  async stop(_ref: RuntimeRef, command: LifecycleCommand) { this.calls.push({ action: 'stop', epoch: command.epoch }); throw new Error('Idle provider cannot stop'); }
  async holdActivity() { /* Synthetic only. */ }
}
let f: ReturnType<typeof fixture>, life: LifecycleCore, provider: IdleProvider;
beforeEach(() => {
  f = fixture(true); life = new LifecycleCore(f.store, f.core, { idleMode: true }); provider = new IdleProvider();
  f.db.exec('UPDATE lifecycle SET provider_ref_json=?', JSON.stringify(ref));
});
afterEach(() => f.close());
function enqueue() { return f.accept({ schema_version: 1, type: 'message.send', payload: { conversation_id: bot, text: 'Synthetic read-only work' } }).resource_id!; }
async function completeAndPermitIdle() {
  const run = enqueue(); await life.drive(provider);
  const identity = life.registerBoot(randomUUID()); life.ready(identity);
  const claim = life.claim(identity)!; expect(claim.run.id).toBe(run);
  life.submitted(identity, run, 1, 'native-synthetic');
  life.complete(identity, run, 1, { status: 'completed', text: 'Synthetic result' });
  f.setNow('2026-09-10T00:01:00.000Z');
  const prepared = life.prepareSleep(identity);
  life.commitSleep(identity, prepared.stop_token, prepared.queue_sequence, { syntheticCheckpoint: true });
  return { run, identity };
}
describe('provider-managed Sprite idle lifecycle', () => {
  it('adopts first retained running resource with no stop claim, then admits authenticated work', async () => {
    const run = enqueue(); await life.drive(provider);
    expect(life.get()).toMatchObject({ phase: 'BOOTING', epoch: 1 });
    expect(provider.calls).toEqual([{ action: 'wake', epoch: 1 }]);
    const identity = life.registerBoot(randomUUID()); life.ready(identity);
    expect(life.claim(identity)?.run.id).toBe(run);
  });
  it('first paused resource can wake without being declared terminated', async () => {
    provider.observation = { phase: 'unknown', executionStopped: false, executionPaused: true, persistentState: 'retained', observedAt: 0 };
    enqueue(); await life.drive(provider);
    expect(life.get()).toMatchObject({ phase: 'BOOTING', epoch: 1 });
    expect(provider.calls).toEqual([{ action: 'wake', epoch: 1 }]);
    expect(provider.observation.executionStopped).toBe(false);
  });
  it('clean commit permits idle, revokes old identity and does not call stop', async () => {
    const { identity, run } = await completeAndPermitIdle();
    expect(f.store.run(run).status).toBe('completed');
    expect(life.get()).toMatchObject({ phase: 'IDLE_PERMITTED', boot_id: null, lease_until: null });
    await life.drive(provider);
    expect(provider.calls).toEqual([{ action: 'wake', epoch: 1 }]);
    expect(() => life.heartbeat(identity, [])).toThrowError(expect.objectContaining({ code: 'STALE_EPOCH' }));
  });
  it('new work after clean idle requires a new epoch and boot even if provider remains running', async () => {
    const { identity: old } = await completeAndPermitIdle();
    const nextRun = enqueue(); await life.drive(provider);
    expect(life.get()).toMatchObject({ phase: 'BOOTING', epoch: 2, boot_id: null });
    expect(provider.calls).toEqual([{ action: 'wake', epoch: 1 }, { action: 'wake', epoch: 2 }]);
    expect(() => life.heartbeat(old, [])).toThrowError(expect.objectContaining({ code: 'STALE_EPOCH' }));
    const next = life.registerBoot(randomUUID()); life.ready(next);
    expect(life.claim(next)?.run.id).toBe(nextRun);
  });
  it('idle permission and paused observation never authorize observeStopped cleanup', async () => {
    await completeAndPermitIdle();
    const paused: RuntimeObservation = { phase: 'unknown', executionStopped: false, executionPaused: true, persistentState: 'retained', observedAt: 0 };
    expect(() => life.observeStopped(paused)).toThrowError(expect.objectContaining({ code: 'CAPABILITY_UNAVAILABLE' }));
    expect(life.get().phase).toBe('IDLE_PERMITTED');
  });
  it('uncertain recovery refuses wake/stop/replacement and preserves queued work', async () => {
    const run = enqueue(); f.db.exec("UPDATE lifecycle SET phase='RECOVERY_REQUIRED',epoch=1");
    await expect(life.drive(provider)).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' });
    expect(life.get()).toMatchObject({ phase: 'RECOVERY_REQUIRED', epoch: 1 });
    expect(provider.calls).toEqual([]); expect(f.store.run(run).status).toBe('queued');
    expect(f.db.all('SELECT * FROM attempts')).toHaveLength(0);
    expect(f.db.all('SELECT * FROM retry_queue')).toHaveLength(0);
  });
  it('a noninitial STOPPED epoch cannot silently adopt a retained resource', async () => {
    enqueue(); f.db.exec("UPDATE lifecycle SET epoch=3,phase='STOPPED'");
    await expect(life.drive(provider)).rejects.toMatchObject({ code: 'CAPABILITY_UNAVAILABLE' });
    expect(provider.calls).toEqual([]); expect(life.get().epoch).toBe(3);
  });
});
