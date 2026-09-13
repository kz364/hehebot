import { createHash } from 'node:crypto';

export const PINNED_OPENCLAW = '2026.9.3';
export const NATIVE_CAPABILITIES = Object.freeze({
  version: PINNED_OPENCLAW,
  rpcSchemasInspected: true,
  liveSubmissionVerified: false,
  durableCorrelationVerified: false,
  completeActivityVerified: false,
  descendantCancellationVerified: false,
  contextIsolationVerified: false,
  oauthRestartVerified: false,
  productionInference: false,
  productionSleep: false,
});

export class RuntimeError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = (code) => { throw new RuntimeError(code); };
const id = (s) => typeof s === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(s);
const hash = (s) => createHash('sha256').update(s).digest('hex');

/** One native transcript per attempt; conversation continuity is supplied as scoped context.
 * New messages never target an existing task session. Not an OS/retrieval sandbox. */
export function sessionKey({ installationId, personaId, scope, scopeId, attemptId }) {
  if (![installationId, personaId, scopeId, attemptId].every(id) || !['routine', 'conversation'].includes(scope)) fail('INVALID_SCOPE');
  return `agent:${personaId.toLowerCase()}:portal:${hash(JSON.stringify([installationId, personaId, scope, scopeId, attemptId]))}`;
}

/** All transport and persistence are injected. journal.putIfAbsent must be durable and atomic.
 * Production wiring is intentionally blocked pending the live compatibility gates.
 */
export class OpenClawAdapter {
  constructor({ rpc, journal, testMode = false }) {
    if (typeof rpc !== 'function' || !journal) fail('INVALID_DEPENDENCY');
    this.rpc = rpc;
    this.journal = journal;
    this.testMode = testMode;
  }
  async submit(input) {
    const keys = ['attemptId', 'installationId', 'personaId', 'scope', 'scopeId', 'message', 'model'];
    if (!input || Object.keys(input).some((k) => !keys.includes(k)) || !id(input.attemptId) ||
        typeof input.message !== 'string' || !input.message.trim() || input.message.length > 100_000 ||
        typeof input.model !== 'string' || !/^openai\/[a-zA-Z0-9._-]+$/.test(input.model)) fail('INVALID_SUBMISSION');
    const key = sessionKey(input);
    if (!this.testMode) fail('COMPATIBILITY_GATE_BLOCKED');
    const fingerprint = hash(JSON.stringify(keys.map((k) => input[k])));
    const row = { attemptId: input.attemptId, fingerprint, sessionKey: key,
      agentId: input.personaId.toLowerCase(), status: 'submitting', nativeRunId: null,
      operations: [], rootSettled: false, outboxCommitted: false, cancelAcknowledged: false };
    const existing = await this.journal.putIfAbsent(input.attemptId, row);
    if (existing) {
      if (existing.fingerprint !== fingerprint) fail('IDEMPOTENCY_CONFLICT');
      // Never resend an ambiguous intent, including after a native Gateway restart.
      return { ...existing, recoveryRequired: !existing.nativeRunId };
    }
    try {
      const reply = await this.rpc('agent', {
        message: input.message, agentId: row.agentId, sessionKey: key,
        model: input.model, deliver: false, disableMessageTool: true,
        idempotencyKey: input.attemptId,
      });
      if (!reply || typeof reply.runId !== 'string' || !reply.runId) fail('NATIVE_PROTOCOL_ERROR');
      return await this.journal.update(input.attemptId, { nativeRunId: reply.runId, status: 'running' });
    } catch {
      // Even an error response can follow admission. Raw errors may contain prompts/tokens.
      return await this.journal.update(input.attemptId, { status: 'recovery_required', error: 'SUBMISSION_OUTCOME_UNKNOWN' });
    }
  }
  async observe(attemptId, timeoutMs = 0) {
    const row = await this.requireRun(attemptId);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 60_000) fail('INVALID_TIMEOUT');
    const reply = await this.rpc('agent.wait', { runId: row.nativeRunId, timeoutMs });
    if (!reply || !['ok', 'error', 'timeout', 'pending'].includes(reply.status) ||
        (reply.runId !== undefined && reply.runId !== row.nativeRunId)) fail('NATIVE_PROTOCOL_ERROR');
    if (['timeout', 'pending'].includes(reply.status)) return row;
    // Native root terminal is not proof that tools/children/outbox have settled.
    return this.journal.update(attemptId, { rootSettled: true, nativeOutcome: reply.status, status: 'finishing' });
  }
  async cancel(attemptId) {
    const row = await this.requireRun(attemptId);
    await this.journal.update(attemptId, { status: 'cancelling' });
    const reply = await this.rpc('chat.abort', { sessionKey: row.sessionKey, agentId: row.agentId, runId: row.nativeRunId });
    if (!reply || typeof reply.aborted !== 'boolean' || !Array.isArray(reply.runIds)) fail('NATIVE_PROTOCOL_ERROR');
    return this.journal.update(attemptId, { cancelAcknowledged: reply.aborted && reply.runIds.includes(row.nativeRunId) });
  }
  async requireRun(attemptId) {
    if (!id(attemptId)) fail('INVALID_ATTEMPT');
    const row = await this.journal.get(attemptId);
    if (!row?.nativeRunId) fail('SUBMISSION_OUTCOME_UNKNOWN');
    return row;
  }
  // No event stream or timeout can accidentally promote an unverified runtime to sleep-safe.
  sleepReadiness() { return { allowed: false, blockers: ['NATIVE_ACTIVITY_COVERAGE_UNVERIFIED', 'NATIVE_CANCELLATION_UNVERIFIED', 'NATIVE_CHECKPOINT_UNVERIFIED'] }; }
}
