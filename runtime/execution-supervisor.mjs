import { ExecutionBridge } from './execution-bridge.mjs';

const fail = code => { throw Object.assign(new Error(code), { code }); };

/** One externally fenced, OS-locked writer per installation. Native reconciliation
 * supplies operation snapshots and settlement receipts; model text cannot supply them.
 * Heartbeat scheduling is independent of slow claim/submission/completion work.
 */
export class ExecutionSupervisor {
  constructor({ control, native, journal, identity, installationId, personas, activity,
    operations, now = Date.now, intervalMs = 20000, onRecovery = () => {} }) {
    if (!activity?.ensure || !activity?.releaseAfterDrain || typeof operations !== 'function' ||
        !Number.isInteger(intervalMs) || intervalMs < 1 || intervalMs > 30000) fail('INVALID_SUPERVISOR_CONFIGURATION');
    Object.assign(this, { control, native, journal, identity, activity, operations, now, intervalMs, onRecovery });
    this.phase = 'stopped';
    this.leaseUntil = 0;
    this.timer = null;
    this.maintenance = null;
    this.work = Promise.resolve();
    this.idleSince = null;
    // Revalidate immediately before native admission, including after a slow claim.
    const guardedNative = {
      admissionReadiness: () => native.admissionReadiness(),
      submit: input => { this.assertLease(); return native.submit(input); },
    };
    this.bridge = new ExecutionBridge({ control, native: guardedNative, journal, identity, installationId, personas });
  }

  assertLease() {
    if (this.phase !== 'running' || this.now() >= this.leaseUntil) fail('EXECUTOR_FENCED');
  }

  recover(code) {
    if (this.phase === 'recovery') return;
    this.phase = 'recovery';
    clearTimeout(this.timer);
    this.timer = null;
    // No release, cancellation inference, process takeover, or replay on uncertainty.
    this.onRecovery({ code });
  }

  async start() {
    if (this.phase !== 'stopped') fail('SUPERVISOR_ALREADY_STARTED');
    if (this.native.admissionReadiness().allowed !== true) fail('COMPATIBILITY_GATE_BLOCKED');
    this.phase = 'starting';
    try {
      await this.activity.ensure();
      await this.heartbeat();
      if (this.phase !== 'starting') fail('EXECUTOR_FENCED');
      this.phase = 'running';
      this.schedule();
      return await this.dispatch();
    } catch (error) { this.recover('START_FAILED'); throw error; }
  }

  async heartbeat() {
    const reply = await this.control.request('heartbeat', { identity: this.identity, operations: await this.operations() });
    const until = Date.parse(reply?.lease_until);
    if (!Number.isFinite(until) || until <= this.now() || !Array.isArray(reply.cancellations) ||
        !reply.cancellations.every(id => typeof id === 'string')) fail('INVALID_HEARTBEAT');
    this.leaseUntil = until;
    return reply.cancellations;
  }

  schedule() {
    if (this.phase !== 'running') return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.maintain().then(() => this.schedule()).catch(() => {});
    }, this.intervalMs);
  }

  maintain() {
    if (this.maintenance) return this.maintenance;
    this.maintenance = (async () => {
      try {
        this.assertLease(); // A resumed process must not renew an already-expired lease.
        await this.activity.ensure();
        const cancellations = await this.heartbeat();
        this.assertLease();
        const row = await this.journal.get(this.bridge.cursor);
        if (row?.phase === 'running' && cancellations.includes(row.claim.run.id)) {
          // The native adapter durably records interrupt intent before sending it.
          this.assertLease();
          await this.native.cancel(row.attemptId);
        }
      } catch (error) { this.recover('MAINTENANCE_FAILED'); throw error; }
    })().finally(() => { this.maintenance = null; });
    return this.maintenance;
  }

  serialized(fn) {
    const next = this.work.then(fn);
    this.work = next.catch(() => {});
    return next;
  }

  dispatch() {
    return this.serialized(async () => {
      this.assertLease();
      const row = await this.bridge.claimNext();
      if (!['running', 'complete'].includes(row.phase)) {
        this.recover('DISPATCH_OUTCOME_UNKNOWN');
        return row;
      }
      if (row.phase === 'complete') this.idleSince ??= this.now();
      else this.idleSince = null;
      return row;
    });
  }

  complete(observation) {
    return this.serialized(async () => {
      this.assertLease();
      // Missing settlement proof rejects without changing the current active task.
      const row = await this.bridge.complete(observation);
      this.idleSince = this.now();
      return row;
    });
  }

  drain(checkpoint) {
    return this.serialized(async () => {
      this.assertLease();
      if (this.native.sleepReadiness().allowed !== true || this.idleSince === null ||
          this.now() - this.idleSince < 60000) fail('SLEEP_DENIED');
      const row = await this.journal.get(this.bridge.cursor);
      if (row?.phase !== 'complete') fail('SLEEP_DENIED');
      if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint) || !Object.keys(checkpoint).length) fail('INVALID_CHECKPOINT');
      if (this.maintenance) await this.maintenance;
      this.assertLease();
      this.phase = 'draining';
      clearTimeout(this.timer);
      this.timer = null;
      try {
        const stop = await this.control.request('prepare-sleep', { identity: this.identity });
        if (typeof stop?.stop_token !== 'string' || !stop.stop_token || !Number.isSafeInteger(stop.queue_sequence)) fail('INVALID_DRAIN_RESPONSE');
        const key = `drain-${this.bridge.cursor}`;
        await this.journal.putIfAbsent(key, { checkpoint, stop, phase: 'commit_unknown' });
        if (this.phase !== 'draining' || this.now() >= this.leaseUntil) fail('EXECUTOR_FENCED');
        await this.control.request('commit-sleep', { identity: this.identity, ...stop, checkpoint });
        await this.journal.update(key, { phase: 'committed' });
        if (this.phase !== 'draining') fail('EXECUTOR_FENCED');
        await this.activity.releaseAfterDrain({ controlCommitted: true, nativeSettled: true, checkpointDurable: true });
        this.phase = 'sleeping';
        this.leaseUntil = 0;
      } catch (error) { this.recover('DRAIN_OUTCOME_UNKNOWN'); throw error; }
    });
  }

  disconnect() { this.recover('NATIVE_DISCONNECTED'); }
}
