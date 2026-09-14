import { createHash } from 'node:crypto';

export const PINNED_CODEX = '0.154.0';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = code => { throw Object.assign(new Error(code), { code }); };

/** Supported app-server calls only. One durable native thread per admitted attempt.
 * Production admission awaits real authentication and whole-operation settlement tests.
 */
export class CodexAdapter {
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
  async observe(attemptId, notification) {
    const row = await this.requireRun(attemptId);
    if (notification?.method !== 'turn/completed') return row;
    const params = notification.params;
    if (params?.threadId !== row.threadId || params?.turn?.id !== row.nativeRunId) fail('SETTLEMENT_IDENTITY_MISMATCH');
    if (!['completed', 'interrupted', 'failed'].includes(params.turn.status)) fail('CODEX_PROTOCOL_ERROR');
    // A terminal root is deliberately not a complete receipt or permission to sleep.
    return this.journal.update(attemptId, { rootSettled: true, status: 'finishing', nativeOutcome: params.turn.status });
  }
}
