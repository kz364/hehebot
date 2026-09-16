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
  /** Released coordinators remain active families, not completed tasks. */
  async families() {
    const row = await this.journal.get(this.cursor);
    if (!row) return [];
    const { families = [], ...current } = row;
    return current.attemptId && !families.some(family => family.attemptId === current.attemptId)
      ? [...families, current] : families;
  }
  async releaseCoordinator(observation) {
    if (this.#busy) fail('DISPATCH_BUSY');
    this.#busy = true;
    try {
      observation = structuredClone(observation);
      const row = await this.journal.get(this.cursor);
      if (!row?.claim || !['running', 'released'].includes(row.phase)) fail('RECOVERY_REQUIRED');
      if (observation?.attemptId !== row.attemptId || observation.nativeRunId !== row.nativeRunId) fail('SETTLEMENT_IDENTITY_MISMATCH');
      if (observation.rootSettled !== true || !['completed', 'failed', 'interrupted'].includes(observation.nativeOutcome)) fail('NATIVE_ROOT_NOT_TERMINAL');
      const payload = { identity: structuredClone(this.identity), run_id: row.claim.run.id,
        attempt: row.claim.run.current_attempt, native_ref: row.nativeRunId, outcome: observation.nativeOutcome };
      let families = row.families ?? [];
      let family = families.find(value => value.attemptId === row.attemptId);
      if (family?.coordinatorRelease && hash(family.coordinatorRelease.payload) !== hash(payload)) fail('COORDINATOR_RELEASE_CONFLICT');
      if (!family) {
        const { families: _history, ...current } = row;
        family = { ...current, coordinatorRelease: { payload, acknowledged: false } };
        families = [...families.filter(value => value.phase !== 'complete'), family];
        if (families.length > 32) fail('FAMILY_CAPACITY_EXCEEDED');
        // One fsynced record retains the old family before the lane can advance.
        await this.journal.update(this.cursor, { phase: 'released', families });
      }
      if (!family.coordinatorRelease.acknowledged) {
        const reply = await this.control.request('coordinator-release', family.coordinatorRelease.payload);
        if (!reply || typeof reply !== 'object' || Array.isArray(reply) ||
            Object.keys(reply).length !== 0 && !(Object.keys(reply).length === 1 && reply.ok === true)) fail('INVALID_COORDINATOR_RELEASE_ACK');
        family = { ...family, coordinatorRelease: { ...family.coordinatorRelease, acknowledged: true } };
        families = families.map(value => value.attemptId === family.attemptId ? family : value);
        await this.journal.update(this.cursor, { families });
      }
      return family;
    } finally { this.#busy = false; }
  }
  async claimNext() {
    if (this.#busy) fail('DISPATCH_BUSY');
    this.#busy = true;
    try {
      if (this.native.admissionReadiness().allowed !== true) fail('COMPATIBILITY_GATE_BLOCKED');
      const prior = await this.journal.get(this.cursor);
      if (prior && !['complete', 'released'].includes(prior.phase)) return prior;
      if (prior?.phase === 'released' && !prior.families?.find(row => row.attemptId === prior.attemptId)?.coordinatorRelease?.acknowledged) return prior;
      if ((prior?.families ?? []).filter(row => row.phase !== 'complete').length >= 32) return prior;
      // An unanswered claim can already own work. Never issue another claim after restart.
      if (prior) await this.journal.update(this.cursor, { phase: 'claim_unknown', claim: null, attemptId: null, nativeRunId: null, result: null });
      else await this.journal.putIfAbsent(this.cursor, { phase: 'claim_unknown', identity: this.identity });
      let claim;
      try { claim = await this.control.request('claim', { identity: this.identity }); }
      catch { return this.journal.update(this.cursor, { phase: 'claim_unknown' }); }
      if (claim === null) return this.journal.update(this.cursor, { phase: 'complete' });
      if (!claim?.run?.id || !Number.isSafeInteger(claim.run.current_attempt) ||
          claim.submission_key !== `${claim.run.id}:${claim.run.current_attempt}` ||
          Object.hasOwn(claim, 'owner_alpha_background') && claim.owner_alpha_background !== true) fail('INVALID_CLAIM');
      claim = structuredClone(claim);
      const background = Object.hasOwn(claim, 'owner_alpha_background');
      await this.journal.update(this.cursor, { phase: 'claimed', claim });
      const persona = this.personas[claim.run.persona_id];
      if (!persona?.agentId || !persona.model) fail('NATIVE_PERSONA_UNMAPPED');
      const context = JSON.parse(claim.run.context_json);
      const input = {
        attemptId: hash([this.installationId, claim.submission_key]), installationId: this.installationId,
        personaId: persona.agentId, model: persona.model,
        ...(background ? { ownerAlphaBackground: true } : {}),
        scope: claim.run.routine_id ? 'routine' : 'conversation',
        scopeId: claim.run.routine_id ?? context.room_id ?? claim.run.persona_id,
        message: JSON.stringify({ ...context, skills: (context.skills ?? []).map(skill => ({
          id: skill.id, revision: skill.revision, name: skill.body.name,
          description: skill.body.description, when_to_use: skill.body.when_to_use,
          load_with: 'hehebot_read_skill',
        })), ...(claim.run.current_attempt > 1 && claim.run.checkpoint_json
          ? { durable_checkpoint: JSON.parse(claim.run.checkpoint_json) } : {}) }),
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
  /** Replay only a durably acknowledged native turn's Worker registration.
   * Never infer a native ID, issue another claim, or call thread/turn start. */
  async acknowledgeSubmission() {
    if (this.#busy) fail('DISPATCH_BUSY');
    this.#busy = true;
    try {
      if (this.native.admissionReadiness().allowed !== true) fail('COMPATIBILITY_GATE_BLOCKED');
      const row = await this.journal.get(this.cursor), claim = row?.claim;
      if (row?.phase !== 'submitted_unknown' || row.identity?.epoch !== this.identity.epoch || row.identity?.boot_id !== this.identity.boot_id ||
          !claim?.run?.id || !Number.isSafeInteger(claim.run.current_attempt) || claim.run.current_attempt < 1 ||
          claim.submission_key !== `${claim.run.id}:${claim.run.current_attempt}` ||
          row.attemptId !== hash([this.installationId, claim.submission_key]) || typeof row.nativeRunId !== 'string' || !row.nativeRunId) fail('RECOVERY_REQUIRED');
      await this.control.request('submitted', { identity: this.identity, run_id: claim.run.id,
        attempt: claim.run.current_attempt, native_ref: row.nativeRunId });
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
      // Capture the wire value before the first await. Caller mutations must not
      // change identity, settlement proof or the result after journal custody.
      try { observation = JSON.parse(JSON.stringify(observation)); }
      catch { fail('INVALID_NATIVE_RESULT'); }
      const cursor = await this.journal.get(this.cursor);
      const archived = cursor?.families?.find(row => row.attemptId === observation?.attemptId);
      const row = archived ?? cursor;
      if (!row?.claim || !['running', 'complete_pending', 'complete'].includes(row.phase)) fail('RECOVERY_REQUIRED');
      if (observation?.nativeRunId !== row.nativeRunId || observation.attemptId !== row.attemptId) fail('SETTLEMENT_IDENTITY_MISMATCH');
      if (!['rootSettled', 'toolsSettled', 'childrenSettled', 'effectsSettled', 'outputCommitted'].every(key => observation[key] === true)) fail('NATIVE_SETTLEMENT_INCOMPLETE');
      const result = observation.result;
      if (!result || !['completed', 'failed', 'cancelled', 'waiting'].includes(result.status) || typeof result.text !== 'string' ||
          result.status === 'waiting' && !result.checkpoint) fail('INVALID_NATIVE_RESULT');
      if (row.result && hash(row.result) !== hash(result)) fail('RESULT_CONFLICT');
      if (row.phase === 'complete') return row;
      const update = async patch => {
        if (!archived) return this.journal.update(this.cursor, patch);
        const next = { ...row, ...patch };
        await this.journal.update(this.cursor, { families: cursor.families.map(family => family.attemptId === row.attemptId ? next : family) });
        return next;
      };
      await update({ phase: 'complete_pending', result });
      // Control completion is idempotent for the same fenced attempt. Explicit replay
      // sends the persisted identical result; it never resubmits native inference.
      await this.control.request('complete', { identity: this.identity, run_id: row.claim.run.id,
        attempt: row.claim.run.current_attempt, result });
      return update({ phase: 'complete', result });
    } finally { this.#busy = false; }
  }
}
