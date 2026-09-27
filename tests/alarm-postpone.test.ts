import { describe, expect, it, vi } from 'vitest';
vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }));
vi.mock('../DB/schema.sql', () => ({ default: '' }));
const { shouldSetAlarm } = await import('../src/worker/control-object');

// Live defect (2026-09-27): portal polls and runtime heartbeats re-armed the
// alarm to now+5 s on every request, so a queued wake waited until traffic
// stopped (29-61 s observed instead of ~5 s).
describe('alarm arming', () => {
  it('ingress never postpones an earlier pending alarm', () => {
    expect(shouldSetAlarm(1_000, 5_000)).toBe(false);
  });
  it('an earlier due time replaces a later alarm; none pending sets one', () => {
    expect(shouldSetAlarm(300_000, 5_000)).toBe(true);
    expect(shouldSetAlarm(null, 5_000)).toBe(true);
  });
});
