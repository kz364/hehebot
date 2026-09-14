import { createHash } from 'node:crypto';

const fail = code => { throw Object.assign(new Error(code), { code }); };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Claim-to-result custody, not an agent loop. The native driver owns tools and children.
 * One fenced, single-writer supervisor owns this journal. No process takeover or sleep
 * authorization is inferred here. Production driver admission remains fail-closed.
 */
export class ExecutionBridge {
  #busy = false;
  constructor({ control, native, journal, identity, installationId, personas }) {
    if (!control?.request || !native?.submit || !native?.admissionReadiness || !journal?.putIfAbsent ||
        !Number.isSafeInteger(identity?.epoch) || typeof identity.boot_id !== 'string' ||
        typeof installationId !== 'string' || !personas) fail('INVALID_BRIDGE_CONFIGURATION');
    Object.assign(this, { control, native, journal, identity, installationId, personas });
    this.cursor = `dispatch-${hash(identity)}`;
  }
  async claimNext() {
    if (this.#busy) fail('DISPATCH_BUSY');
    this.#busy = true;
    try {
      if (this.native.admissionReadiness().allowed !== true) fail('COMPATIBILITY_GATE_BLOCKED');
      const prior = await this.journal.get(this.cursor);
      if (prior && prior.phase !== 'complete') return prior;
      // An unanswered claim can already own work. Never issue another claim after restart.
      if (prior) await this.journal.update(this.cursor, { phase: 'claim_unknown', claim: null, attemptId: null, nativeRunId: null, result: null });
      else await this.journal.putIfAbsent(this.cursor, { phase: 'claim_unknown', identity: this.identity });
      let claim;
      try { claim = await this.control.request('claim', { identity: this.identity }); }
      catch { return this.journal.update(this.cursor, { phase: 'claim_unknown' }); }
      if (claim === null) return this.journal.update(this.cursor, { phase: 'complete' });
      if (!claim?.run?.id || !Number.isSafeInteger(claim.run.current_attempt) ||
          claim.submission_key !== `${claim.run.id}:${claim.run.current_attempt}`) fail('INVALID_CLAIM');
      await this.journal.update(this.cursor, { phase: 'claimed', claim });
      const persona = this.personas[claim.run.persona_id];
      if (!persona?.agentId || !persona.model) fail('NATIVE_PERSONA_UNMAPPED');
      const context = JSON.parse(claim.run.context_json);
      const input = {
        attemptId: hash([this.installationId, claim.submission_key]), installationId: this.installationId,
        personaId: persona.agentId, model: persona.model,
        scope: claim.run.routine_id ? 'routine' : 'conversation',
        scopeId: claim.run.routine_id ?? context.room_id ?? claim.run.persona_id,
        message: JSON.stringify({ ...context, skills: (context.skills ?? []).map(skill => ({
          id: skill.id, revision: skill.revision, name: skill.body.name,
          description: skill.body.description, when_to_use: skill.body.when_to_use,
          load_with: 'hehebot_read_skill',
        })) }),
      };
      await this.journal.update(this.cursor, { phase: 'submission_unknown', attemptId: input.attemptId });
      let submitted;
      try { submitted = await this.native.submit(input); }
      catch { return this.journal.get(this.cursor); }
      if (!submitted?.nativeRunId || submitted.recoveryRequired || submitted.status !== 'running') return this.journal.get(this.cursor);
      await this.journal.update(this.cursor, { phase: 'submitted_unknown', nativeRunId: submitted.nativeRunId });
      try {
        await this.control.request('submitted', { identity: this.identity, run_id: claim.run.id,
          attempt: claim.run.current_attempt, native_ref: submitted.nativeRunId });
      } catch { return this.journal.get(this.cursor); }
      return this.journal.update(this.cursor, { phase: 'running' });
    } finally { this.#busy = false; }
  }
  /** Called by the trusted native event reconciler, never directly by model output.
   * Root termination/abort ACK alone cannot produce a complete settlement receipt.
   */
  async complete(observation) {
    if (this.#busy) fail('DISPATCH_BUSY');
    this.#busy = true;
    try {
      const row = await this.journal.get(this.cursor);
      if (!row?.claim || !['running', 'complete_pending', 'complete'].includes(row.phase)) fail('RECOVERY_REQUIRED');
      if (observation?.nativeRunId !== row.nativeRunId || observation.attemptId !== row.attemptId) fail('SETTLEMENT_IDENTITY_MISMATCH');
      if (!['rootSettled', 'toolsSettled', 'childrenSettled', 'effectsSettled', 'outputCommitted'].every(key => observation[key] === true)) fail('NATIVE_SETTLEMENT_INCOMPLETE');
      const result = observation.result;
      if (!result || !['completed', 'failed', 'cancelled', 'waiting'].includes(result.status) || typeof result.text !== 'string' ||
          result.status === 'waiting' && !result.checkpoint) fail('INVALID_NATIVE_RESULT');
      if (row.result && hash(row.result) !== hash(result)) fail('RESULT_CONFLICT');
      if (row.phase === 'complete') return row;
      await this.journal.update(this.cursor, { phase: 'complete_pending', result });
      // Control completion is idempotent for the same fenced attempt. Explicit replay
      // sends the persisted identical result; it never resubmits native inference.
      await this.control.request('complete', { identity: this.identity, run_id: row.claim.run.id,
        attempt: row.claim.run.current_attempt, result });
      return this.journal.update(this.cursor, { phase: 'complete' });
    } finally { this.#busy = false; }
  }
}
