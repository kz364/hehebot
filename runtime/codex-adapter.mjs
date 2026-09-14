import { createHash } from 'node:crypto';

export const PINNED_CODEX = '0.154.0';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = code => { throw Object.assign(new Error(code), { code }); };

/** Supported app-server calls only. One durable native thread per admitted attempt.
 * Production admission awaits real authentication and whole-operation settlement tests.
 */
export class CodexAdapter {
  #observations = Promise.resolve();
  constructor({ rpc, journal, cwd, testMode = false }) {
    if (typeof rpc !== 'function' || !journal?.putIfAbsent || !cwd?.startsWith('/')) fail('INVALID_CONFIGURATION');
    Object.assign(this, { rpc, journal, cwd, testMode });
  }
  admissionReadiness() {
    return { allowed: this.testMode === true, productionVerified: false };
  }
  sleepReadiness() {
    return { allowed: false, blockers: ['CODEX_DESCENDANT_SETTLEMENT_UNVERIFIED', 'CODEX_RESTART_RECONCILIATION_UNVERIFIED'] };
  }
  async submit(input) {
    const keys = ['attemptId', 'installationId', 'personaId', 'scope', 'scopeId', 'message', 'model'];
    if (!input || Object.keys(input).some(key => !keys.includes(key)) ||
        !['attemptId', 'installationId', 'personaId', 'scopeId'].every(key => /^[a-zA-Z0-9_-]{1,128}$/.test(input[key] ?? '')) ||
        !['routine', 'conversation'].includes(input.scope) || typeof input.message !== 'string' ||
        !input.message.trim() || input.message.length > 100000 ||
        typeof input.model !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(input.model)) fail('INVALID_SUBMISSION');
    if (!this.admissionReadiness().allowed) fail('COMPATIBILITY_GATE_BLOCKED');
    const fingerprint = hash(keys.map(key => input[key]));
    const prior = await this.journal.putIfAbsent(input.attemptId, {
      attemptId: input.attemptId, fingerprint, status: 'thread_unknown', threadId: null,
      nativeRunId: null, rootSettled: false, cancelAcknowledged: false,
    });
    if (prior) {
      if (prior.fingerprint !== fingerprint) fail('IDEMPOTENCY_CONFLICT');
      return { ...prior, recoveryRequired: prior.status !== 'running' };
    }
    try {
      const started = await this.rpc('thread/start', {
        cwd: this.cwd, model: input.model, approvalPolicy: 'untrusted', sandbox: 'read-only', ephemeral: false,
      });
      if (typeof started?.thread?.id !== 'string' || !started.thread.id) fail('CODEX_PROTOCOL_ERROR');
      // Persist the native thread before turn/start; even a successful thread start is not inference.
      await this.journal.update(input.attemptId, { threadId: started.thread.id, status: 'submission_unknown' });
      const reply = await this.rpc('turn/start', { threadId: started.thread.id,
        input: [{ type: 'text', text: input.message }], clientUserMessageId: input.attemptId });
      if (typeof reply?.turn?.id !== 'string' || !reply.turn.id) fail('CODEX_PROTOCOL_ERROR');
      return await this.journal.update(input.attemptId, {
        nativeRunId: reply.turn.id, status: 'running',
      });
    } catch {
      return this.journal.update(input.attemptId, { status: 'recovery_required', recoveryRequired: true,
        error: 'SUBMISSION_OUTCOME_UNKNOWN' });
    }
  }
  async requireRun(attemptId) {
    const row = await this.journal.get(attemptId);
    if (!row?.threadId || !row.nativeRunId) fail('SUBMISSION_OUTCOME_UNKNOWN');
    return row;
  }
  async steer(attemptId, { commandId, text }) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(commandId ?? '') || typeof text !== 'string' || !text.trim() || text.length > 100000) fail('INVALID_STEERING');
    const row = await this.requireRun(attemptId);
    if (row.status !== 'running') fail('TASK_NOT_RUNNING');
    const key = `steer-${hash([attemptId, commandId])}`;
    const fingerprint = hash(text);
    const prior = await this.journal.putIfAbsent(key, { fingerprint, status: 'unknown' });
    if (prior) {
      if (prior.fingerprint !== fingerprint) fail('IDEMPOTENCY_CONFLICT');
      return prior;
    }
    try {
      const reply = await this.rpc('turn/steer', { threadId: row.threadId, expectedTurnId: row.nativeRunId,
        input: [{ type: 'text', text }], clientUserMessageId: commandId });
      if (reply?.turnId !== row.nativeRunId) fail('CODEX_PROTOCOL_ERROR');
      return this.journal.update(key, { status: 'accepted' });
    } catch { return this.journal.get(key); }
  }
  async cancel(attemptId) {
    const row = await this.requireRun(attemptId);
    if (row.status !== 'running') return row;
    await this.journal.update(attemptId, { status: 'cancelling' });
    try {
      await this.rpc('turn/interrupt', { threadId: row.threadId, turnId: row.nativeRunId });
      return this.journal.update(attemptId, { cancelAcknowledged: true });
    } catch { return this.journal.get(attemptId); }
  }

  /** Host-authorized cancellation of one observed child turn. Never broadens to
   * the parent, a sibling, or the latest turn; acceptance is not settlement.
   */
  async cancelChild(attemptId, target) {
    if (!target || Object.keys(target).some(key => !['threadId', 'turnId'].includes(key)) ||
        ![target.threadId, target.turnId].every(id => typeof id === 'string' && id.length > 0 && id.length <= 256)) fail('INVALID_CANCEL_TARGET');
    const row = await this.requireRun(attemptId);
    const { threadId, turnId } = target;
    const turnKey = JSON.stringify([threadId, turnId]);
    if (!Object.values(row.spawns ?? {}).some(spawn => spawn.receiverThreadIds.includes(threadId)) ||
        !Object.hasOwn(row.childTurns ?? {}, turnKey)) fail('SETTLEMENT_IDENTITY_MISMATCH');
    const key = `cancel-child-${hash([attemptId, threadId, turnId])}`;
    const prior = await this.journal.get(key);
    if (prior) return prior;
    if (row.childTurns[turnKey] !== 'inProgress') return { status: 'already_terminal', nativeOutcome: row.childTurns[turnKey] };
    const existing = await this.journal.putIfAbsent(key, { threadId, turnId, status: 'unknown' });
    if (existing) return existing;
    try {
      await this.rpc('turn/interrupt', { threadId, turnId });
      return this.journal.update(key, { status: 'accepted' });
    } catch { return this.journal.get(key); }
  }

  observe(attemptId, notification) {
    const next = this.#observations.then(() => this.#observeOne(attemptId, notification));
    this.#observations = next.catch(() => {});
    return next;
  }
  async #observeOne(attemptId, notification) {
    const row = await this.requireRun(attemptId);
    const params = notification?.params;
    if (['turn/started', 'turn/completed'].includes(notification?.method) && params?.threadId !== row.threadId) {
      if (!Object.values(row.spawns ?? {}).some(spawn => spawn.receiverThreadIds.includes(params?.threadId))) fail('SETTLEMENT_IDENTITY_MISMATCH');
      const id = params?.turn?.id, status = params?.turn?.status;
      if (typeof id !== 'string' || !id || id.length > 256 ||
          !(notification.method === 'turn/started' ? ['inProgress'] : ['completed', 'failed', 'interrupted']).includes(status)) fail('CODEX_PROTOCOL_ERROR');
      const childTurns = { ...row.childTurns }, key = JSON.stringify([params.threadId, id]);
      const prior = Object.hasOwn(childTurns, key) ? childTurns[key] : undefined;
      if (prior && prior !== 'inProgress' && prior !== status) fail('SETTLEMENT_CONFLICT');
      if (!prior && Object.keys(childTurns).length >= 4096) fail('CHILD_TURN_TRACKING_LIMIT');
      Object.defineProperty(childTurns, key, { value: status, enumerable: true, writable: true, configurable: true });
      // This settles only an observed child turn, never its tools or descendants.
      return this.journal.update(attemptId, { childTurns });
    }
    if (['item/started', 'item/completed'].includes(notification?.method) &&
        params?.item?.type === 'collabAgentToolCall' && params.item.tool === 'spawnAgent') {
      if (params.threadId !== row.threadId || params.turnId !== row.nativeRunId ||
          params.item.senderThreadId !== row.threadId) fail('SETTLEMENT_IDENTITY_MISMATCH');
      const { id, status, receiverThreadIds } = params.item;
      if (typeof id !== 'string' || !id || id.length > 256 ||
          !(notification.method === 'item/started' ? ['inProgress'] : ['completed', 'failed']).includes(status) ||
          !Array.isArray(receiverThreadIds) || receiverThreadIds.length > 100 ||
          !receiverThreadIds.every(child => typeof child === 'string' && child.length > 0 && child.length <= 256 && child !== row.threadId) ||
          new Set(receiverThreadIds).size !== receiverThreadIds.length) fail('CODEX_PROTOCOL_ERROR');
      const spawns = { ...row.spawns };
      const prior = Object.hasOwn(spawns, id) ? spawns[id] : undefined;
      const receivers = [...receiverThreadIds].sort();
      if (prior && (prior.receiverThreadIds.some(child => !receivers.includes(child)) ||
          prior.status !== 'inProgress' && (prior.status !== status || JSON.stringify(prior.receiverThreadIds) !== JSON.stringify(receivers)))) fail('SETTLEMENT_CONFLICT');
      if (!prior && Object.keys(spawns).length >= 4096) fail('SPAWN_TRACKING_LIMIT');
      // A completed spawn invocation acknowledges children, not their settlement
      // or authorization. Keep receivers even when the parent root completes.
      Object.defineProperty(spawns, id, { value: { status, receiverThreadIds: receivers }, enumerable: true, writable: true, configurable: true });
      return this.journal.update(attemptId, { spawns });
    }
    const field = params?.item?.type === 'commandExecution' ? 'commands' : params?.item?.type === 'mcpToolCall' ? 'mcpCalls' : null;
    if (['item/started', 'item/completed'].includes(notification?.method) && field) {
      if (params.threadId !== row.threadId || params.turnId !== row.nativeRunId) fail('SETTLEMENT_IDENTITY_MISMATCH');
      const { id, status } = params.item;
      const terminal = field === 'commands' ? ['completed', 'failed', 'declined'] : ['completed', 'failed'];
      if (typeof id !== 'string' || !id || id.length > 256 ||
          !(notification.method === 'item/started' ? ['inProgress'] : terminal).includes(status)) fail('CODEX_PROTOCOL_ERROR');
      const obligations = { ...row[field] };
      const prior = Object.hasOwn(obligations, id) ? obligations[id] : undefined;
      if (prior && prior !== 'inProgress') {
        if (prior !== status) fail('SETTLEMENT_CONFLICT');
        return row;
      }
      if (!Object.hasOwn(obligations, id) && Object.keys(obligations).length >= 4096) fail('COMMAND_TRACKING_LIMIT');
      // Persist starts even if history omits them. A root/history snapshot cannot
      // remove these obligations; only a matching native terminal event can.
      Object.defineProperty(obligations, id, { value: status, enumerable: true, writable: true, configurable: true });
      // An MCP terminal response settles only the invocation, not external effects.
      return this.journal.update(attemptId, { [field]: obligations });
    }
    if (notification?.method !== 'turn/completed') return row;
    if (params?.threadId !== row.threadId || params?.turn?.id !== row.nativeRunId) fail('SETTLEMENT_IDENTITY_MISMATCH');
    if (!['completed', 'interrupted', 'failed'].includes(params.turn.status)) fail('CODEX_PROTOCOL_ERROR');
    if (row.rootSettled) {
      if (row.nativeOutcome !== params.turn.status) fail('SETTLEMENT_CONFLICT');
      return row;
    }
    // A terminal root is deliberately not a complete receipt or permission to sleep.
    return this.journal.update(attemptId, { rootSettled: true, status: 'finishing', nativeOutcome: params.turn.status });
  }

  /** Read-only recovery for a durably acknowledged turn. Never infer a missing turn
   * ID from position, a matching prompt, or the most recent turn in a thread.
   */
  async reconcile(attemptId) {
    const row = await this.requireRun(attemptId);
    const reply = await this.rpc('thread/read', { threadId: row.threadId, includeTurns: true });
    if (reply?.thread?.id !== row.threadId || !Array.isArray(reply.thread.turns)) fail('CODEX_PROTOCOL_ERROR');
    const matches = reply.thread.turns.filter(turn => turn?.id === row.nativeRunId);
    if (matches.length !== 1) fail('RECONCILIATION_INCOMPLETE');
    const turn = matches[0];
    if (turn.status === 'inProgress') {
      if (row.rootSettled) fail('SETTLEMENT_CONFLICT');
      return row;
    }
    return this.observe(attemptId, { method: 'turn/completed', params: { threadId: row.threadId, turn } });
  }
}
