import { createHash } from 'node:crypto';

const fail = code => { throw Object.assign(new Error(code), { code }); };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// G4 (GROK_ALIGNMENT A4, docs/AGENT_MODEL.md routing table): concise coordinator
// routing guidance, composed into the turn only for a coordinator run (never a
// background task, which has no task tools) and only naming tools this persona
// actually has. There is no separate base-instructions prompt string in this
// codebase; context (including persona.body.instructions) is delivered as this
// JSON message, so this is where turn guidance is assembled.
const TASK_TOOL_GUIDANCE = Object.freeze({
  hehebot_start_task: 'For work that would block the conversation, call hehebot_start_task to run it independently in the background; it returns immediately and never waits.',
  hehebot_list_tasks: 'For a status question, call hehebot_list_tasks (and hehebot_task_detail) and answer from that; do not start or change a task just to answer a question.',
  hehebot_task_detail: null,
  hehebot_steer_task: 'To redirect a task while it is actively running, call hehebot_steer_task; if it reports not_running, queue a hehebot_queue_followup instead.',
  hehebot_queue_followup: 'hehebot_queue_followup delivers as the task\'s next turn once its current turn ends.',
  hehebot_cancel_task: 'Call hehebot_cancel_task to stop a task the owner no longer wants.',
});
function coordinatorGuidance(allowedTools = []) {
  const lines = allowedTools.map(name => TASK_TOOL_GUIDANCE[name]).filter(Boolean);
  if (!lines.length) return undefined;
  return ['You are the coordinator for this conversation. Reply to the owner only through hehebot_send_message.',
    ...lines, 'When a background task completes, fails, is cancelled or needs input, you are woken with its result; relay it to the owner via hehebot_send_message.'].join(' ');
}
// G4b (GROK_ALIGNMENT A4, docs/AGENT_MODEL.md): concise instructions composed
// only into a coordinator task run's own isolated turn (never the coordinator's).
function taskExecutorGuidance(personaName) {
  return `You are a task executor${personaName ? ` for ${personaName}` : ''}. ` +
    'Post progress or results with hehebot_send_message sparingly, not for every step. ' +
    'Your final answer is relayed to the owner by the coordinator; you do not talk to the owner directly.';
}

/** Claim-to-result custody, not an agent loop. The native driver owns tools and children.
 * One fenced, single-writer supervisor owns this journal. No process takeover or sleep
 * authorization is inferred here. Production driver admission remains fail-closed.
 */
export class ExecutionBridge {
  #busy = false;
  constructor({ control, native, journal, identity, installationId, personas, claimStage = null, lane = 'coordinator',
    memoryCounter = /** @type {null | ((input: {selected_model: string, global: string, scoped: string}) => Promise<any>)} */ (null) }) {
    if (!control?.request || !native?.submit || !native?.admissionReadiness || !journal?.putIfAbsent ||
        !Number.isSafeInteger(identity?.epoch) || typeof identity.boot_id !== 'string' ||
        typeof installationId !== 'string' || !personas ||
        claimStage !== null && typeof claimStage !== 'function' ||
        !['coordinator', 'background'].includes(lane) ||
        memoryCounter !== null && typeof memoryCounter !== 'function') fail('INVALID_BRIDGE_CONFIGURATION');
    Object.assign(this, { control, native, journal, identity, installationId, personas, claimStage, lane });
    this.memoryCounter = memoryCounter;
    // G4b: the background task lane gets its own journal cursor/dispatch slot so
    // it never contends with, or is confused for, the coordinator's own single
    // dispatch record. The coordinator's cursor format is unchanged (existing
    // recovery tooling -- codex-recovery-inspect.mjs -- keys off dispatch-${hash(identity)}).
    this.cursor = lane === 'background' ? `dispatch-background-${hash(identity)}` : `dispatch-${hash(identity)}`;
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
        // Completed families leave custody once their lane advances — except
        // independently admitted background roots, whose thread bindings stay
        // durable for the background receipt checks. The background root never
        // completes, so only its status/independent siblings are retained.
        families = [...families.filter(value => value.phase !== 'complete' || value.claim?.role !== undefined), family];
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
      // Capture host configuration before any await. The same selection must
      // reach both Worker custody and native submission for this attempt.
      const personas = structuredClone(this.personas);
      const persona_models = Object.fromEntries(Object.entries(personas).map(([id, persona]) => [id, persona.model]));
      const memory_read_personas = Object.entries(personas).filter(([, persona]) => persona.allowedTools?.includes('hehebot_read_memory')).map(([id]) => id);
      const prior = await this.journal.get(this.cursor);
      if (prior && !['complete', 'released'].includes(prior.phase)) return prior;
      if (prior?.phase === 'released' && !prior.families?.find(row => row.attemptId === prior.attemptId)?.coordinatorRelease?.acknowledged) return prior;
      if ((prior?.families ?? []).filter(row => row.phase !== 'complete').length >= 32) return prior;
      let preparation, memory_budget;
      if (this.memoryCounter) {
        // Preparation/counting cannot own an attempt. Do not journal claim_unknown
        // until a claim can actually be sent, and never fall back on count failure.
        preparation = structuredClone(await this.control.request('memory-prepare', { identity: this.identity, persona_models, memory_read_personas }));
        if (preparation === null || preparation?.blocked === true &&
            ['MEMORY_PREPARATION_LIMIT', 'CONTEXT_PREPARATION_LIMIT'].includes(preparation.reason) && typeof preparation.run_id === 'string') {
          const empty = { phase: 'complete', claim: null, attemptId: null, nativeRunId: null, result: null };
          if (!prior) await this.journal.putIfAbsent(this.cursor, { ...empty, identity: this.identity });
          else await this.journal.update(this.cursor, empty);
          return this.journal.get(this.cursor);
        }
        if (!preparation || Object.keys(preparation).sort().join(',') !== 'attempt,global,run_id,schema_version,scoped,selected_model,sha256' ||
            preparation.schema_version !== 1 || typeof preparation.run_id !== 'string' || !preparation.run_id ||
            !Number.isSafeInteger(preparation.attempt) || preparation.attempt < 1 ||
            !Object.values(persona_models).includes(preparation.selected_model) ||
            typeof preparation.global !== 'string' || typeof preparation.scoped !== 'string') fail('INVALID_MEMORY_PREPARATION');
        const { schema_version, run_id, attempt, selected_model, global, scoped } = preparation;
        if (hash({ schema_version, run_id, attempt, selected_model, global, scoped }) !== preparation.sha256) fail('INVALID_MEMORY_PREPARATION');
        const counts = await this.memoryCounter({ selected_model, global, scoped });
        if (counts?.schema_version !== 1 || counts.selected_model !== selected_model ||
            counts.tokenizer !== 'gpt-tokenizer@4.0.0/o200k_base/ordinary-v1' ||
            ![counts.global_tokens, counts.scoped_tokens].every(count => Number.isSafeInteger(count) && count >= 0)) fail('INVALID_MEMORY_COUNT');
        memory_budget = { schema_version, run_id, attempt, selected_model, sha256: preparation.sha256,
          tokenizer: counts.tokenizer, global_tokens: counts.global_tokens, scoped_tokens: counts.scoped_tokens };
      }
      // An unanswered claim can already own work. Never issue another claim after restart.
      if (prior) await this.journal.update(this.cursor, { phase: 'claim_unknown', claim: null, attemptId: null, nativeRunId: null, result: null });
      else await this.journal.putIfAbsent(this.cursor, { phase: 'claim_unknown', identity: this.identity });
      let claim;
      try { claim = await this.control.request('claim', { identity: this.identity, persona_models,
        ...(this.lane === 'background' ? { lane: 'background' } : {}), ...(memory_budget ? { memory_budget, memory_read_personas } : {}) }); }
      catch { return this.journal.update(this.cursor, { phase: 'claim_unknown' }); }
      if (claim === null) return this.journal.update(this.cursor, { phase: 'complete' });
      if (!claim?.run?.id || !Number.isSafeInteger(claim.run.current_attempt) ||
          claim.submission_key !== `${claim.run.id}:${claim.run.current_attempt}` ||
          Object.hasOwn(claim, 'owner_alpha_background') && claim.owner_alpha_background !== true) fail('INVALID_CLAIM');
      claim = structuredClone(claim);
      const background = Object.hasOwn(claim, 'owner_alpha_background');
      // Staged background-family claims carry an explicit role; only the frozen
      // status summary ever composes into a restricted prompt, never caller text.
      if (claim.role !== undefined && !['background', 'status', 'independent'].includes(claim.role)) fail('INVALID_CLAIM');
      if (claim.role === 'status' && (claim.status_summary === undefined || claim.status_summary === null)) fail('INVALID_CLAIM');
      if (claim.text_only !== undefined && (!claim.text_only || claim.owner_alpha_background ||
          claim.text_only.profile_version !== 'codex-text-only-v1' || !/^[0-9a-f]{64}$/.test(claim.text_only.profile_sha256 ?? ''))) fail('INVALID_CLAIM');
      // Versioned claim staging runs after the base shape checks and before the
      // journal takes custody: the staged claim is what gets journaled, so the
      // raw task credential never reaches the journal or the native adapter.
      if (this.claimStage) claim = await this.claimStage(claim);
      await this.journal.update(this.cursor, { phase: 'claimed', claim });
      const persona = personas[claim.run.persona_id];
      if (!persona?.agentId || !persona.model) fail('NATIVE_PERSONA_UNMAPPED');
      const context = JSON.parse(claim.run.context_json);
      if (Object.hasOwn(context, 'selected_model') && context.selected_model !== persona.model) fail('SELECTED_MODEL_MISMATCH');
      if (memory_budget && (claim.run.id !== memory_budget.run_id || claim.run.current_attempt !== memory_budget.attempt ||
          context.selected_model !== memory_budget.selected_model || hash(context.memory_budget ?? null) !== hash(memory_budget) ||
          !Array.isArray(context.memories) ||
          JSON.stringify(context.memories.filter(record => record.body.scope.kind === 'global')) !== preparation.global ||
          JSON.stringify(context.memories.filter(record => record.body.scope.kind !== 'global')) !== preparation.scoped)) fail('MEMORY_CLAIM_MISMATCH');
      const input = {
        attemptId: hash([this.installationId, claim.submission_key]), installationId: this.installationId,
        personaId: persona.agentId, model: persona.model,
        // G4c: routing metadata only -- codex-service.mjs's native.submit reads
        // this to pick the correct lane's supervisor/bridge cursor, then strips
        // it before the actual CodexAdapter.submit() call (whose input allowlist
        // never includes `lane`).
        ...(this.lane === 'background' ? { lane: 'background' } : {}),
        ...(background ? { ownerAlphaBackground: true } : {}),
        scope: claim.run.routine_id ? 'routine' : 'conversation',
        // G4b: a coordinator task run gets its own scope, keyed by its own run
        // id -- never the coordinator's persona/room scope -- so the native
        // adapter opens an isolated Codex thread for it, never the coordinator's.
        scopeId: claim.run.routine_id ?? context.room_id ?? (context.coordinator_task ? claim.run.id : claim.run.persona_id),
        message: JSON.stringify({ ...context, skills: (context.skills ?? []).map(skill => ({
          id: skill.id, revision: skill.revision, name: skill.body.name,
          description: skill.body.description, when_to_use: skill.body.when_to_use,
          load_with: 'hehebot_read_skill',
        })), ...(claim.role === 'status' ? { background_status_summary: claim.status_summary } : {}),
          ...(claim.run.current_attempt > 1 && claim.run.checkpoint_json
            ? { durable_checkpoint: JSON.parse(claim.run.checkpoint_json) } : {}),
          ...(claim.run.role !== 'background' && claim.role === undefined
            ? (guidance => guidance ? { coordinator_guidance: guidance } : {})(coordinatorGuidance(persona.allowedTools))
            : {}),
          ...(claim.run.role === 'background' && claim.role === undefined && context.coordinator_task
            ? { task_guidance: taskExecutorGuidance(persona.agentId) } : {}) }),
      };
      await this.journal.update(this.cursor, { phase: 'submission_unknown', attemptId: input.attemptId });
      let submitted;
      try { submitted = await this.native.submit(input); }
      catch { return this.journal.get(this.cursor); }
      if (!submitted?.nativeRunId || submitted.recoveryRequired || submitted.status !== 'running') return this.journal.get(this.cursor);
      await this.journal.update(this.cursor, { phase: 'submitted_unknown', nativeRunId: submitted.nativeRunId,
        ...((claim.text_only || claim.role !== undefined) ? { nativeThreadId: submitted.threadId } : {}) });
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
      const receipt = observation.text_only_receipt;
      const backgroundReceipt = observation.background_receipt;
      if (Boolean(row.claim.text_only) !== Boolean(receipt)) fail('TEXT_ONLY_RECEIPT_MISMATCH');
      if (receipt && (Object.keys(receipt).sort().join(',') !== 'output_sha256,profile_sha256,profile_version,thread_id,turn_id' ||
          receipt.profile_version !== row.claim.text_only.profile_version || receipt.profile_sha256 !== row.claim.text_only.profile_sha256 ||
          receipt.thread_id !== row.nativeThreadId || receipt.turn_id !== row.nativeRunId ||
          receipt.output_sha256 !== createHash('sha256').update(result?.text ?? '').digest('hex'))) fail('TEXT_ONLY_RECEIPT_MISMATCH');
      // Background-family settlement: the background root never completes, and
      // status/independent roots settle only with a covering background receipt
      // bound to this family's journaled native thread and turn.
      const backgroundRoot = row.claim.role !== undefined;
      if (backgroundRoot && row.claim.role === 'background') fail('BACKGROUND_ROOT_NOT_COMPLETABLE');
      if (backgroundRoot !== Boolean(backgroundReceipt)) fail('BACKGROUND_RECEIPT_MISMATCH');
      if (backgroundReceipt && (Object.keys(backgroundReceipt).sort().join(',') !== 'output_sha256,thread_id,turn_id' ||
          backgroundReceipt.thread_id !== row.nativeThreadId || backgroundReceipt.turn_id !== row.nativeRunId ||
          backgroundReceipt.output_sha256 !== createHash('sha256').update(result?.text ?? '').digest('hex'))) fail('BACKGROUND_RECEIPT_MISMATCH');
      if (!result || !['completed', 'failed', 'cancelled', 'waiting'].includes(result.status) || typeof result.text !== 'string' ||
          result.status === 'waiting' && !result.checkpoint) fail('INVALID_NATIVE_RESULT');
      if (row.result && hash(row.result) !== hash(result)) fail('RESULT_CONFLICT');
      if (row.textOnlyReceipt && hash(row.textOnlyReceipt) !== hash(receipt)) fail('RESULT_CONFLICT');
      if (row.backgroundReceipt && hash(row.backgroundReceipt) !== hash(backgroundReceipt)) fail('RESULT_CONFLICT');
      if (row.phase === 'complete') return row;
      const update = async patch => {
        if (!archived) return this.journal.update(this.cursor, patch);
        const next = { ...row, ...patch };
        await this.journal.update(this.cursor, { families: cursor.families.map(family => family.attemptId === row.attemptId ? next : family) });
        return next;
      };
      await update({ phase: 'complete_pending', result, ...(receipt ? { textOnlyReceipt: receipt } : {}),
        ...(backgroundReceipt ? { backgroundReceipt } : {}) });
      // Control completion is idempotent for the same fenced attempt. Explicit replay
      // sends the persisted identical result; it never resubmits native inference.
      await this.control.request('complete', { identity: this.identity, run_id: row.claim.run.id,
        attempt: row.claim.run.current_attempt, result, ...(receipt ? { text_only_receipt: receipt } : {}),
        ...(backgroundReceipt ? { background_receipt: backgroundReceipt } : {}) });
      return update({ phase: 'complete', result, ...(receipt ? { textOnlyReceipt: receipt } : {}),
        ...(backgroundReceipt ? { backgroundReceipt } : {}) });
    } finally { this.#busy = false; }
  }
}
