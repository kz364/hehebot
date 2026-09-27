import test from 'node:test';
import assert from 'node:assert/strict';
import { createMeteringSampler } from '../runtime/metering-sampler.mjs';

function fakeClock() {
  let now = 1_000_000;
  return { now: () => now, advance: ms => { now += ms; } };
}
function fakeReader(script) {
  // script: array of {cpu, mem} or {throw:true} consumed in order, last value repeats.
  let i = 0;
  return {
    cpuUsageUsec() { const s = script[Math.min(i, script.length - 1)]; if (s.throw) throw new Error('CPU_STAT_UNAVAILABLE'); return s.cpu; },
    memoryCurrentBytes() { const s = script[Math.min(i, script.length - 1)]; if (s.throw) throw new Error('MEMORY_CURRENT_UNAVAILABLE'); i++; return s.mem; },
  };
}

test('accumulates CPU-seconds and GB-seconds as deltas across samples, and flushes on the report interval', () => {
  const clock = fakeClock();
  const reports = [];
  // usage_usec grows by 2,000,000 (2 cpu-seconds) per 10s tick; memory pinned at 1 GiB.
  const reader = fakeReader([
    { cpu: 0, mem: 1_073_741_824 }, { cpu: 2_000_000, mem: 1_073_741_824 }, { cpu: 4_000_000, mem: 1_073_741_824 },
  ]);
  const sampler = createMeteringSampler({ reader, report: r => reports.push(r), sampleIntervalMs: 10_000, reportIntervalMs: 20_000, now: clock.now });
  sampler.start(); // first sample at t=0, no delta yet
  clock.advance(10_000); sampler.stop(); // triggers a final sample + flush manually below via stop
  assert.equal(reports.length, 1);
  const [report] = reports;
  assert.equal(report.cgroup_available, true);
  assert.ok(report.interval_seconds >= 10 && report.interval_seconds <= 10.001);
  assert.equal(report.cpu_seconds, 2); // one 2,000,000 usec delta
  assert.ok(Math.abs(report.gb_seconds - 10) < 0.01); // 1 GiB for 10s = 10 GB-seconds
  assert.equal(report.samples, 2); // initial sample + the one on stop()
});

test('a broken reader degrades to cgroup_available:false with zero totals, never throws', () => {
  const clock = fakeClock();
  const reports = [];
  const debugEvents = [];
  const reader = fakeReader([{ throw: true }]);
  const sampler = createMeteringSampler({ reader, report: r => reports.push(r), sampleIntervalMs: 5000, reportIntervalMs: 5000,
    now: clock.now, onDebug: e => debugEvents.push(e) });
  assert.doesNotThrow(() => sampler.start());
  clock.advance(5000);
  assert.doesNotThrow(() => sampler.stop());
  assert.equal(reports.length, 1);
  assert.deepEqual(reports[0], { interval_seconds: 5, cpu_seconds: 0, gb_seconds: 0, samples: 0, cgroup_available: false });
  assert.ok(debugEvents.some(e => e.event === 'metering.sample_failed'));
});

test('a throwing/rejecting report() is swallowed and surfaced only through onDebug', async () => {
  const clock = fakeClock();
  const debugEvents = [];
  const reader = fakeReader([{ cpu: 0, mem: 0 }]);
  const sampler = createMeteringSampler({ reader, report: () => { throw new Error('network down'); }, sampleIntervalMs: 1000, reportIntervalMs: 1000,
    now: clock.now, onDebug: e => debugEvents.push(e) });
  sampler.start();
  clock.advance(1000);
  assert.doesNotThrow(() => sampler.stop());
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(debugEvents.some(e => e.event === 'metering.report_failed'));
});

test('stop() is idempotent and a zero-length interval is not reported', () => {
  const clock = fakeClock();
  const reports = [];
  const reader = fakeReader([{ cpu: 0, mem: 0 }]);
  const sampler = createMeteringSampler({ reader, report: r => reports.push(r), now: clock.now });
  sampler.start();
  sampler.stop(); // stop() at the same instant as start() -> 0s interval, nothing to report
  sampler.stop(); // second call is a no-op, must not throw or double-report
  assert.equal(reports.length, 0);
});

test('report() requires a function', () => {
  assert.throws(() => createMeteringSampler({}), { message: 'METERING_REPORT_REQUIRED' });
});
