import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LifecycleCore } from '../src/core/lifecycle';
import { parseLifecycleTimings } from '../src/core/lifecycle-config';
import type { LifecycleCommand, RuntimeObservation, RuntimeProvider, RuntimeRef } from '../src/providers';
import { bot, fixture } from './helpers';

const ref: RuntimeRef = { provider: 'fly-sprites', id: 'synthetic-sprite' };
class IdleProvider implements RuntimeProvider {
  readonly id = 'fly-sprites' as const;
  readonly capabilities = { stopMode: 'provider-idle' as const, implemented: true, explicitWake: true,
    explicitStop: false, confirmedStop: false, persistence: 'filesystem' as const, activityHold: 'native' as const,
    maxSessionSeconds: null, restrictions: ['Synthetic provider; no real calls'] };
  calls: number[] = [];
  observation: RuntimeObservation = { phase: 'running', executionStopped: false, executionPaused: false, persistentState: 'retained', observedAt: 0 };
  async observe() { return this.observation; }
  async wake(_ref: RuntimeRef, command: LifecycleCommand) { this.calls.push(command.epoch); }
  async stop() { throw new Error('Idle provider cannot stop'); }
  async holdActivity() { /* Synthetic only. */ }
}
let f: ReturnType<typeof fixture>, life: LifecycleCore, provider: IdleProvider;
const T0 = Date.parse('2026-09-10T00:00:00.000Z');
const at = (ms: number) => f.setNow(new Date(T0 + ms).toISOString());
beforeEach(() => {
  f = fixture(true); at(0);
  life = new LifecycleCore(f.store, f.core, { idleMode: true, ...parseLifecycleTimings({
    HEHEBOT_BOOT_DEADLINE_MS: '20000', HEHEBOT_SUCCESSOR_BACKOFF: '{"base_ms":5000,"max_ms":60000,"notify_after":2}' }) });
  provider = new IdleProvider();
  f.db.exec('UPDATE lifecycle SET provider_ref_json=?', JSON.stringify(ref));
});
afterEach(() => f.close());
const enqueue = () => f.accept({ schema_version: 1, type: 'message.send', payload: { conversation_id: bot, text: 'Synthetic work' } }).resource_id!;
const notices = () => f.db.all<{ payload_json: string }>("SELECT payload_json FROM events WHERE type='notice'").map(r => JSON.parse(r.payload_json));

describe('fast boot failure (configurable, provider-neutral)', () => {
  it('uses the configured boot deadline, then the heartbeat lease once ready', async () => {
    enqueue(); await life.drive(provider);
    expect(Date.parse(life.get().lease_until!) - T0).toBe(20000);
    const identity = life.registerBoot(randomUUID());
    expect(Date.parse(life.get().lease_until!) - T0).toBe(20000);
    life.ready(identity);
    expect(Date.parse(life.get().lease_until!) - T0).toBe(90000);
  });
  it('abandon ends the generation immediately; successors back off and the owner is told', async () => {
    const run = enqueue(); f.db.exec("UPDATE lifecycle SET phase='RECOVERY_REQUIRED',epoch=1");
    await life.drive(provider); expect(provider.calls).toEqual([2]);
    let identity = life.registerBoot(randomUUID());
    life.abandon(identity, 'CODEX_RPC_ERROR');
    expect(life.get().phase).toBe('RECOVERY_REQUIRED');
    // Backoff window 5 s: no successor yet.
    at(1000); await life.drive(provider); expect(provider.calls).toEqual([2]);
    at(6000); await life.drive(provider); expect(provider.calls).toEqual([2, 3]);
    expect(notices().filter(n => n.reason === 'RUNTIME_START_FAILING')).toHaveLength(1);
    expect(notices().find(n => n.reason === 'RUNTIME_START_FAILING').message).toContain('CODEX_RPC_ERROR');
    // Stale identity cannot abandon the new generation.
    expect(() => life.abandon(identity, 'X')).toThrow();
    identity = life.registerBoot(randomUUID()); life.ready(identity);
    life.claim(identity); life.submitted(identity, run, 1, 'native-synthetic');
    life.complete(identity, run, 1, { status: 'completed', text: 'ok' });
    const backoff = JSON.parse(f.db.all<{ value_json: string }>("SELECT value_json FROM runtime_metadata WHERE key='successor_backoff'")[0].value_json);
    expect(backoff).toMatchObject({ failures: 0, next_at: null });
  });
  it('an unanswered boot is abandoned at the deadline, not after the historical 120 s', async () => {
    enqueue(); await life.drive(provider);
    at(21000); life.watchdog();
    expect(life.get().phase).toBe('RECOVERY_REQUIRED');
  });
  it('rejects malformed timing config', () => {
    expect(() => parseLifecycleTimings({ HEHEBOT_BOOT_DEADLINE_MS: '10' })).toThrow();
    expect(() => parseLifecycleTimings({ HEHEBOT_SUCCESSOR_BACKOFF: '{"base_ms":9,"max_ms":1}' })).toThrow();
    expect(parseLifecycleTimings({})).toEqual({});
  });
  it('a claim without a tokenizer degrades with one owner-visible notice', async () => {
    enqueue(); await life.drive(provider);
    const identity = life.registerBoot(randomUUID()); life.ready(identity);
    life.claim(identity, undefined, undefined, [], 'coordinator', { code: 'MEMORY_TOKENIZER_UNCONFIGURED', model: 'gpt-5.6-luna' });
    expect(notices()).toEqual([expect.objectContaining({ kind: 'degraded', model: 'gpt-5.6-luna' })]);
  });
});
