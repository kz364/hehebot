import { readFileSync } from 'node:fs';

const CGROUP_ROOT = '/sys/fs/cgroup';

/** Finds this process's cgroup v2 directory from /proc/self/cgroup, falling
 * back to the cgroup root if that can't be read. Never throws: an unreadable
 * or missing cgroup just means the sampler reports itself unavailable. */
export function defaultCgroupReader() {
  let base = CGROUP_ROOT;
  try {
    const content = readFileSync('/proc/self/cgroup', 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    // cgroup v2 unified hierarchy is a single "0::/path" line; if a hybrid
    // system also lists v1 controllers, prefer the v2 ("0::") entry.
    const line = lines.find(l => l.startsWith('0::')) ?? lines[0];
    const relative = line?.split(':')[2];
    if (typeof relative === 'string' && relative.startsWith('/')) base = `${CGROUP_ROOT}${relative}`;
  } catch { /* use the cgroup root */ }
  return {
    cpuUsageUsec() {
      const match = /^usage_usec (\d+)$/m.exec(readFileSync(`${base}/cpu.stat`, 'utf8'));
      if (!match) throw new Error('CPU_STAT_UNAVAILABLE');
      return Number(match[1]);
    },
    memoryCurrentBytes() {
      const value = Number(readFileSync(`${base}/memory.current`, 'utf8').trim());
      if (!Number.isFinite(value)) throw new Error('MEMORY_CURRENT_UNAVAILABLE');
      return value;
    },
  };
}

/**
 * Self-metering sampler: reads cgroup v2 CPU (cpu.stat usage_usec, as a delta)
 * and memory (memory.current, integrated as GB-seconds) on an interval, and
 * flushes accumulated totals to `report()` on a slower interval and on stop().
 *
 * Never throws and never blocks the caller's main work: a broken reader
 * degrades to cgroup_available:false with zeroed totals for that period, and
 * a rejected/throwing report() is swallowed (optionally surfaced to onDebug).
 * There is no retry — a dropped report is a small, bounded gap in the ledger,
 * never a reason to fail or delay the runtime.
 */
export function createMeteringSampler({ reader = defaultCgroupReader(), report,
  sampleIntervalMs = 15000, reportIntervalMs = 60000, now = Date.now, onDebug } = {}) {
  if (typeof report !== 'function') throw new Error('METERING_REPORT_REQUIRED');
  let sampleTimer = null, reportTimer = null, stopped = true;
  let lastCpuUsec = null, lastSampleAt = null, intervalStart = null;
  let cpuSeconds = 0, gbSeconds = 0, samples = 0, cgroupAvailable = false;

  const sampleOnce = () => {
    const at = now();
    let cpuUsec = null, memBytes = null, ok = false;
    try { cpuUsec = reader.cpuUsageUsec(); memBytes = reader.memoryCurrentBytes(); ok = true; }
    catch (error) { onDebug?.({ event: 'metering.sample_failed', code: error?.code ?? error?.message ?? 'unknown' }); }
    if (ok) {
      const elapsedSec = lastSampleAt !== null ? Math.max(0, (at - lastSampleAt) / 1000) : 0;
      if (lastCpuUsec !== null && elapsedSec > 0) cpuSeconds += Math.max(0, (cpuUsec - lastCpuUsec) / 1_000_000);
      if (elapsedSec > 0) gbSeconds += (memBytes / 1_073_741_824) * elapsedSec;
      lastCpuUsec = cpuUsec;
      cgroupAvailable = true;
      samples += 1;
    } else {
      // A broken reader must not poison the next successful delta.
      lastCpuUsec = null;
    }
    lastSampleAt = at;
  };

  const flush = () => {
    const at = now();
    const interval_seconds = Math.max(0, (at - (intervalStart ?? at)) / 1000);
    intervalStart = at;
    if (interval_seconds <= 0) return;
    const payload = { interval_seconds, cpu_seconds: cpuSeconds, gb_seconds: gbSeconds, samples, cgroup_available: cgroupAvailable };
    cpuSeconds = 0; gbSeconds = 0; samples = 0; cgroupAvailable = false;
    try {
      Promise.resolve(report(payload)).catch(error => onDebug?.({ event: 'metering.report_failed', code: error?.code ?? error?.message ?? 'unknown' }));
    } catch (error) { onDebug?.({ event: 'metering.report_failed', code: error?.code ?? error?.message ?? 'unknown' }); }
  };

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      intervalStart = now();
      sampleOnce();
      sampleTimer = setInterval(sampleOnce, sampleIntervalMs);
      sampleTimer.unref?.();
      reportTimer = setInterval(flush, reportIntervalMs);
      reportTimer.unref?.();
    },
    /** Final sample + flush, then stop the timers. Safe to call more than once. */
    stop() {
      if (stopped) return;
      stopped = true;
      if (sampleTimer) { clearInterval(sampleTimer); sampleTimer = null; }
      if (reportTimer) { clearInterval(reportTimer); reportTimer = null; }
      sampleOnce();
      flush();
    },
  };
}
