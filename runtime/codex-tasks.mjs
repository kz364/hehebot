import { createHash } from 'node:crypto';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = code => { throw Object.assign(new Error(code), { code }); };

/** Mirrors observed native descendants into Worker task metadata. It never spawns
 * inference, grants child effects, or converts terminal turns to settled tasks.
 */
export class CodexTaskControl {
  #work = Promise.resolve();
  constructor({ adapter, control, journal, identity, attemptId, parent, assertLease }) {
    if (!adapter?.requireRun || !adapter?.cancelChild || !control?.request || !journal?.putIfAbsent ||
        typeof assertLease !== 'function' || typeof attemptId !== 'string' || !attemptId ||
        !Number.isSafeInteger(identity?.epoch) || typeof identity?.boot_id !== 'string' ||
        typeof parent?.runId !== 'string' || typeof parent?.personaId !== 'string' ||
        !Number.isSafeInteger(parent?.attempt) || parent.attempt < 1) fail('INVALID_TASK_CONTROL');
    this.adapter = adapter; this.control = control; this.journal = journal;
    this.attemptId = attemptId; this.assertLease = assertLease;
    this.identity = structuredClone(identity); this.parent = structuredClone(parent);
    this.key = `native-tasks-${hash(attemptId)}`;
  }

  /** @template T @param {() => Promise<T>} fn */
  serial(fn) {
    const next = this.#work.then(fn);
    this.#work = next.catch(() => {});
    return next;
  }

  async mapping() {
    const fingerprint = hash([this.identity, this.parent]);
    const prior = await this.journal.putIfAbsent(this.key, { fingerprint, children: {} });
    if (prior && prior.fingerprint !== fingerprint) fail('TASK_GRANT_CONFLICT');
    return prior ?? this.journal.get(this.key);
  }

  sync() {
    return this.serial(async () => {
      this.assertLease();
      const native = await this.adapter.requireRun(this.attemptId);
      let mapped = await this.mapping();
      const pending = Object.keys(native.childTurns ?? {}).filter(key => !mapped.children[key]?.runId || mapped.children[key]?.started !== true);
      if (Object.keys(native.childTurns ?? {}).length > 100) fail('CHILD_TASK_TRACKING_LIMIT');
      const owners = [[null, native], ...Object.entries(native.childObligations ?? {})];
      while (pending.length) {
        let progressed = false;
        for (let index = 0; index < pending.length;) {
          const key = pending[index], [threadId, turnId] = JSON.parse(key);
          const origins = owners.filter(([, owner]) => Object.values(owner.spawns ?? {}).some(spawn => spawn.receiverThreadIds.includes(threadId)));
          if (origins.length !== 1) fail('NATIVE_CHILD_ORIGIN_UNKNOWN');
          const parentKey = origins[0][0];
          const parentRun = parentKey === null ? this.parent.runId : mapped.children[parentKey]?.runId;
          if (!parentRun) { index++; continue; }
          const child = { parent_run_id: parentRun, parent_attempt: parentKey === null ? this.parent.attempt : 1,
            persona_id: this.parent.personaId, native_run_ref: `codex:${hash([threadId, turnId])}`,
            native_session_key: threadId, title: 'Native background task' };
          const prior = mapped.children[key];
          if (prior && hash(prior.receipt) !== hash(child)) fail('TASK_GRANT_CONFLICT');
          this.assertLease();
          mapped = await this.journal.update(this.key, { children: { ...mapped.children,
            [key]: { receipt: child, parentKey, runId: prior?.runId ?? null, started: false } } });
          this.assertLease();
          // The exact observed turn is registered and acknowledged atomically.
          // Replay reconciles this receipt, never resubmits inference or resurrects
          // a cancelled/terminal child after a lost response.
          const run = await this.control.request('native-child', { identity: this.identity, child, started: true });
          this.assertLease();
          if (typeof run?.id !== 'string' || !run.id || run.parent_run_id !== parentRun ||
              run.persona_id !== this.parent.personaId || run.current_attempt !== 1 || run.role !== 'background' ||
              !['running', 'finishing', 'cancelling', 'recovery_required', 'waiting', 'completed', 'failed', 'cancelled'].includes(run.status)) fail('INVALID_CHILD_TASK_RECEIPT');
          if (prior?.runId && prior.runId !== run.id) fail('TASK_GRANT_CONFLICT');
          mapped = await this.journal.update(this.key, { children: { ...mapped.children,
            [key]: { ...mapped.children[key], runId: run.id, started: true } } });
          pending.splice(index, 1); progressed = true;
        }
        if (!progressed) fail('NATIVE_CHILD_ORIGIN_UNKNOWN');
      }
      return mapped.children;
    });
  }

  cancel(runIds) {
    return this.serial(async () => {
      this.assertLease();
      const mapped = await this.mapping();
      const selected = new Set(runIds);
      // Propagate only down the persisted task tree, never to parents or siblings.
      let changed;
      do {
        changed = false;
        for (const child of Object.values(mapped.children)) if (child.runId && selected.has(child.receipt.parent_run_id) && !selected.has(child.runId)) {
          selected.add(child.runId); changed = true;
        }
      } while (changed);
      const outcomes = [];
      for (const [key, child] of Object.entries(mapped.children)) if (child.runId && selected.has(child.runId)) {
        this.assertLease();
        const [threadId, turnId] = JSON.parse(key);
        outcomes.push({ runId: child.runId, ...(await this.adapter.cancelChild(this.attemptId, { threadId, turnId })) });
        this.assertLease();
      }
      return outcomes;
    });
  }

  steer() {
    return this.serial(async () => {
      this.assertLease();
      const mapped = await this.mapping(), native = await this.adapter.requireRun(this.attemptId);
      const targets = [{ run_id: this.parent.runId, attempt: this.parent.attempt }];
      const known = new Map([[this.parent.runId, { attempt: this.parent.attempt, nativeRef: native.nativeRunId, target: null }]]);
      for (const [key, child] of Object.entries(mapped.children)) if (child.runId && child.started) {
        if (known.has(child.runId)) fail('TASK_GRANT_CONFLICT');
        const [threadId, turnId] = JSON.parse(key);
        known.set(child.runId, { attempt: 1, nativeRef: child.receipt.native_run_ref, target: { threadId, turnId } });
        targets.push({ run_id: child.runId, attempt: 1 });
      }
      if (targets.length > 101) fail('CHILD_TASK_TRACKING_LIMIT');
      this.assertLease();
      const pending = await this.control.request('steer-pending', { identity: this.identity, targets });
      this.assertLease();
      if (!Array.isArray(pending) || pending.length > 4 || new Set(pending.map(row => row?.command_id)).size !== pending.length ||
          pending.some(row => !row || !/^[0-9a-f-]{36}$/i.test(row.command_id ?? '') ||
            typeof row.text !== 'string' || !row.text.trim() || Buffer.byteLength(row.text) > 32768 ||
            !known.has(row.run_id) || known.get(row.run_id).attempt !== row.attempt || known.get(row.run_id).nativeRef !== row.native_ref)) fail('INVALID_STEERING_RECEIPT');
      const outcomes = [];
      for (const row of pending) {
        const selected = known.get(row.run_id), instruction = { commandId: row.command_id, text: row.text };
        let status;
        this.assertLease();
        try {
          const receipt = selected.target ? await this.adapter.steerChild(this.attemptId, selected.target, instruction)
            : await this.adapter.steer(this.attemptId, instruction);
          if (!['accepted', 'unknown'].includes(receipt?.status)) fail('INVALID_STEERING_RECEIPT');
          status = receipt.status === 'accepted' ? 'accepted' : 'outcome_unknown';
        } catch (error) {
          // This adapter error occurs before recording or sending new intent.
          // All transport/protocol uncertainty remains an unknown journal receipt.
          if (error.code !== 'TASK_NOT_RUNNING') throw error;
          status = 'not_delivered';
        }
        this.assertLease();
        await this.control.request('steer-result', { identity: this.identity, run_id: row.run_id,
          attempt: row.attempt, command_id: row.command_id, status });
        this.assertLease();
        outcomes.push({ command_id: row.command_id, status });
      }
      return outcomes;
    });
  }
}
