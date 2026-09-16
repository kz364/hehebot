import { ExecutionBridge } from './execution-bridge.mjs';

const fail = code => { throw Object.assign(new Error(code), { code }); };

/** One externally fenced, OS-locked writer per installation. Native reconciliation
 * supplies operation snapshots and settlement receipts; model text cannot supply them.
 * Heartbeat scheduling is independent of slow claim/submission/completion work.
 */
export class ExecutionSupervisor {
  constructor({ control, native, journal, identity, installationId, personas, activity,
    operations, events = /** @type {{bind: (attemptId: string) => Promise<void>} | null} */ (null),
    children = /** @type {{sync: () => Promise<unknown>, cancel: (runIds: string[]) => Promise<unknown>, steer?: () => Promise<unknown>, publishOutputs?: () => Promise<unknown>} | null} */ (null),
    now = Date.now, intervalMs = 20000, onRecovery = () => {} }) {
    if (!activity?.ensure || !activity?.releaseAfterDrain || typeof operations !== 'function' ||
        (events && typeof events.bind !== 'function') ||
        (children && (typeof children.sync !== 'function' || typeof children.cancel !== 'function')) ||
        !Number.isInteger(intervalMs) || intervalMs < 1 || intervalMs > 30000) fail('INVALID_SUPERVISOR_CONFIGURATION');
    Object.assign(this, { control, native, journal, identity, activity, operations, children, now, intervalMs, onRecovery });
    this.phase = 'stopped';
    this.leaseUntil = 0;
    this.timer = null;
    this.maintenance = null;
    this.work = Promise.resolve();
    this.idleSince = null;
    // Revalidate immediately before native admission, including after a slow claim.
    const guardedNative = {
      admissionReadiness: () => native.admissionReadiness(),
      submit: async input => {
        this.assertLease();
        const submitted = await native.submit(input);
        if (submitted?.nativeRunId && submitted.status === 'running' && !submitted.recoveryRequired) {
          this.assertLease();
          // The router subscribes before dispatch and uses only persisted native IDs.
          // Any buffered events must be accounted for before acknowledging admission.
          await events?.bind(input.attemptId);
          this.assertLease();
        }
        return submitted;
      },
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
    const phase = this.phase, previousLease = this.leaseUntil;
    const assertAuthority = () => {
      if (this.phase !== phase || !['starting', 'running'].includes(phase) ||
          (phase === 'running' && this.now() >= previousLease)) fail('EXECUTOR_FENCED');
    };
    assertAuthority();
    const operations = await this.operations();
    assertAuthority();
    if (!Array.isArray(operations) || operations.length > 4096) fail('INVALID_OPERATION_SNAPSHOT');
    const cancellations = new Set();
    let until;
    // Worker requests remain bounded at 100. Retain every observation, including
    // settled history; partial delivery cannot authorize completion or local renewal.
    for (let offset = 0; offset < Math.max(operations.length, 1); offset += 100) {
      assertAuthority();
      const reply = await this.control.request('heartbeat', { identity: this.identity, operations: operations.slice(offset, offset + 100) });
      // Every page must arrive within the original local lease, even if the Worker
      // already renewed. Starting has no prior lease but still fences disconnect.
      assertAuthority();
      until = Date.parse(reply?.lease_until);
      if (!Number.isFinite(until) || until <= this.now() || !Array.isArray(reply.cancellations) ||
          !reply.cancellations.every(id => typeof id === 'string')) fail('INVALID_HEARTBEAT');
      for (const id of reply.cancellations) cancellations.add(id);
    }
    this.leaseUntil = until;
    return [...cancellations];
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
        // The installed task controller uses durable native lineage. Registration
        // and interrupt acknowledgement never imply child/effect settlement.
        await this.children?.sync();
        this.assertLease();
        await this.children?.cancel(cancellations);
        this.assertLease();
        const row = await this.journal.get(this.bridge.cursor);
        if (row?.phase === 'running' && cancellations.includes(row.claim.run.id)) {
          // The native adapter durably records interrupt intent before sending it.
          this.assertLease();
          await this.native.cancel(row.attemptId);
        }
        this.assertLease();
        await this.children?.steer?.();
        this.assertLease();
        await this.children?.publishOutputs?.();
        this.assertLease();
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
      try {
        this.assertLease();
        let row = await this.bridge.claimNext();
        if (row.phase === 'submitted_unknown') {
          this.assertLease();
          // One bounded retry of the exact Worker receipt, never native admission.
          row = await this.bridge.acknowledgeSubmission();
        }
        if (!['running', 'complete'].includes(row.phase)) {
          this.recover('DISPATCH_OUTCOME_UNKNOWN');
          return row;
        }
        this.assertLease();
        if (row.phase === 'complete') this.idleSince ??= this.now();
        else this.idleSince = null;
        return row;
      } catch (error) { this.recover('DISPATCH_OUTCOME_UNKNOWN'); throw error; }
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
      if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint) || !Object.keys(checkpoint).length) fail('INVALID_CHECKPOINT');
      let snapshot;
      try { snapshot = JSON.parse(JSON.stringify(checkpoint)); }
      catch { fail('INVALID_CHECKPOINT'); }
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) || !Object.keys(snapshot).length) fail('INVALID_CHECKPOINT');
      const row = await this.journal.get(this.bridge.cursor);
      if (row?.phase !== 'complete') fail('SLEEP_DENIED');
      if (this.maintenance) await this.maintenance;
      this.assertLease();
      if (this.native.sleepReadiness().allowed !== true) fail('SLEEP_DENIED');
      this.phase = 'draining';
      clearTimeout(this.timer);
      this.timer = null;
      const assertDraining = () => {
        if (this.phase !== 'draining' || this.now() >= this.leaseUntil) fail('EXECUTOR_FENCED');
        // Opening readiness is not settlement proof across awaited control,
        // journal or provider work. A later observation can revoke it.
        if (this.native.sleepReadiness().allowed !== true) fail('SLEEP_DENIED');
      };
      try {
        const stop = await this.control.request('prepare-sleep', { identity: this.identity });
        assertDraining();
        if (typeof stop?.stop_token !== 'string' || !stop.stop_token || !Number.isSafeInteger(stop.queue_sequence)) fail('INVALID_DRAIN_RESPONSE');
        const key = `drain-${this.bridge.cursor}`;
        const existing = await this.journal.putIfAbsent(key, { checkpoint: snapshot, stop, phase: 'commit_unknown' });
        if (existing !== null) fail('DRAIN_REPLAY_FORBIDDEN');
        assertDraining();
        await this.control.request('commit-sleep', { identity: this.identity, ...stop, checkpoint: snapshot });
        assertDraining();
        await this.journal.update(key, { phase: 'committed' });
        assertDraining();
        await this.activity.releaseAfterDrain({ controlCommitted: true, nativeSettled: true, checkpointDurable: true });
        assertDraining();
        this.phase = 'sleeping';
        this.leaseUntil = 0;
      } catch (error) { this.recover('DRAIN_OUTCOME_UNKNOWN'); throw error; }
    });
  }

  disconnect() { this.recover('NATIVE_DISCONNECTED'); }
}
