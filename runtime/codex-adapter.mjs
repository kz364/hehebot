import { createHash } from 'node:crypto';

export const PINNED_CODEX = '0.154.0';
export const OBSERVED_COLLAB_TOOLS = Object.freeze(['sendInput', 'resumeAgent', 'wait', 'closeAgent', 'sendMessage', 'followupTask', 'interruptAgent', 'listAgents']);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = code => { throw Object.assign(new Error(code), { code }); };
const observationOwners = row => [row, ...Object.values(row.childObligations ?? {})];
const hasReceiver = (row, threadId) => observationOwners(row).some(owner => Object.values(owner.spawns ?? {}).some(spawn => spawn.receiverThreadIds.includes(threadId)));

/** Trusted router projection, not a native receipt or settlement assertion. */
export function projectOutputMessage(item) {
  if (typeof item.text !== 'string' || ![undefined, null, 'commentary', 'final_answer'].includes(item.phase)) fail('CODEX_PROTOCOL_ERROR');
  let text = item.text.slice(0, 8192);
  if (text.length < item.text.length && /[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
  return { text, truncated: text.length < item.text.length, outputDigest: hash([item.text, item.phase ?? null]) };
}

/** Supported app-server calls only. One durable native thread per admitted attempt.
 * Production admission awaits real authentication and whole-operation settlement tests.
 */
export class CodexAdapter {
  #observations = Promise.resolve();
  #permissionsProfile;
  constructor({ rpc, journal, cwd, testMode = false, dynamicTools = [], mcpServers = {}, permissionsProfile = undefined }) {
    if (typeof rpc !== 'function' || !journal?.putIfAbsent || !cwd?.startsWith('/') || !Array.isArray(dynamicTools) || dynamicTools.length > 64 ||
        !mcpServers || typeof mcpServers !== 'object' || Array.isArray(mcpServers) || Object.keys(mcpServers).length > 64 ||
        permissionsProfile !== undefined && (typeof permissionsProfile !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(permissionsProfile))) fail('INVALID_CONFIGURATION');
    Object.assign(this, { rpc, journal, cwd, testMode });
    this.dynamicTools = structuredClone(dynamicTools);
    this.mcpServers = structuredClone(mcpServers);
    this.#permissionsProfile = permissionsProfile;
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
    const values = keys.map(key => input[key]);
    const legacyFingerprintInput = Object.keys(this.mcpServers).length ? [values, this.dynamicTools, this.mcpServers]
      : this.dynamicTools.length ? [values, this.dynamicTools] : values;
    const fingerprint = hash(this.#permissionsProfile === undefined ? legacyFingerprintInput
      : [legacyFingerprintInput, { permissionsProfile: this.#permissionsProfile }]);
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
        cwd: this.cwd, model: input.model, approvalPolicy: 'untrusted', ephemeral: false,
        ...(this.#permissionsProfile === undefined ? { sandbox: 'read-only' } : { permissions: this.#permissionsProfile }),
        ...(this.dynamicTools.length ? { dynamicTools: this.dynamicTools } : {}),
        ...(Object.keys(this.mcpServers).length ? { config: { mcp_servers: this.mcpServers } } : {}),
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
  async steer(attemptId, instruction) {
    const row = await this.requireRun(attemptId);
    return this.#steer(attemptId, instruction, { threadId: row.threadId, turnId: row.nativeRunId }, row.status === 'running', false);
  }

  /** Host-selected observed descendant only. Parent completion does not prevent
   * steering an active child; acknowledgement does not prove consumption.
   */
  async steerChild(attemptId, target, instruction) {
    if (!target || Object.keys(target).some(key => !['threadId', 'turnId'].includes(key)) ||
        ![target.threadId, target.turnId].every(id => typeof id === 'string' && id.length > 0 && id.length <= 256)) fail('INVALID_STEER_TARGET');
    const row = await this.requireRun(attemptId);
    const key = JSON.stringify([target.threadId, target.turnId]);
    if (!hasReceiver(row, target.threadId) || !Object.hasOwn(row.childTurns ?? {}, key)) fail('SETTLEMENT_IDENTITY_MISMATCH');
    return this.#steer(attemptId, instruction, target, row.childTurns[key] === 'inProgress', true);
  }

  async #steer(attemptId, instruction, target, active, child) {
    if (!instruction || Object.keys(instruction).some(key => !['commandId', 'text'].includes(key)) ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(instruction.commandId ?? '') || typeof instruction.text !== 'string' ||
        !instruction.text.trim() || instruction.text.length > 100000) fail('INVALID_STEERING');
    const { commandId, text } = instruction;
    const key = `steer-${hash([attemptId, commandId])}`;
    // Preserve old root receipts. Child fingerprints bind the exact namespace,
    // so a reused owner command cannot retarget a sibling or another child turn.
    const fingerprint = hash(child ? [target.threadId, target.turnId, text] : text);
    const replay = prior => {
      if (prior.fingerprint !== fingerprint) fail('IDEMPOTENCY_CONFLICT');
      return prior;
    };
    const recorded = await this.journal.get(key);
    if (recorded) return replay(recorded);
    if (!active) fail('TASK_NOT_RUNNING');
    const prior = await this.journal.putIfAbsent(key, { fingerprint, status: 'unknown' });
    if (prior) {
      return replay(prior);
    }
    try {
      const reply = await this.rpc('turn/steer', { threadId: target.threadId, expectedTurnId: target.turnId,
        input: [{ type: 'text', text }], clientUserMessageId: commandId });
      if (reply?.turnId !== target.turnId) fail('CODEX_PROTOCOL_ERROR');
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
    if (!hasReceiver(row, threadId) ||
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

  observe(attemptId, notification, observedAt = undefined) {
    const next = this.#observations.then(() => this.#observeOne(attemptId, notification, observedAt));
    this.#observations = next.catch(() => {});
    return next;
  }
  async #observeOne(attemptId, notification, observedAt) {
    if (observedAt !== undefined && (typeof observedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(observedAt) ||
        !Number.isFinite(Date.parse(observedAt)) || new Date(observedAt).toISOString() !== observedAt)) fail('INVALID_OBSERVATION_TIME');
    const row = await this.requireRun(attemptId);
    const params = notification?.params;
    const childKey = JSON.stringify([params?.threadId, params?.turnId]);
    const childItem = params?.threadId !== row.threadId && Object.hasOwn(row.childTurns ?? {}, childKey);
    const owner = childItem ? row.childObligations?.[childKey] ?? {} : row;
    const save = patch => this.journal.update(attemptId, childItem
      ? { childObligations: { ...row.childObligations, [childKey]: { ...owner, ...patch } } } : patch);
    const saveOperation = (field, itemKey, prior, status, patch) => {
      const timingKey = JSON.stringify([field, itemKey]);
      if (owner.operationTimes !== undefined && (!owner.operationTimes || typeof owner.operationTimes !== 'object' || Array.isArray(owner.operationTimes))) fail('INVALID_OPERATION_TIMING');
      const timing = owner.operationTimes?.[timingKey];
      if (timing !== undefined && (!timing || typeof timing !== 'object' || Array.isArray(timing) ||
          !['startedAt', 'lastProgressAt'].every(key => typeof timing[key] === 'string' && Number.isFinite(Date.parse(timing[key])) && new Date(timing[key]).toISOString() === timing[key]) ||
          timing.lastProgressAt < timing.startedAt)) fail('INVALID_OPERATION_TIMING');
      let operationTimes;
      // Only a live host-observed start establishes a phase clock. History reads
      // and duplicate starts cannot invent or advance native progress.
      if (observedAt !== undefined && prior !== status && (timing || !prior && status === 'inProgress')) {
        if (timing && observedAt < timing.lastProgressAt) fail('INVALID_OBSERVATION_TIME');
        operationTimes = { ...owner.operationTimes, [timingKey]: {
          startedAt: timing?.startedAt ?? observedAt, lastProgressAt: observedAt,
        } };
      }
      return save({ ...patch, ...(operationTimes ? { operationTimes } : {}) });
    };
    if (notification?.method === 'item/completed' && params?.item?.type === 'agentMessage') {
      if (!childItem && (params.threadId !== row.threadId || params.turnId !== row.nativeRunId)) fail('SETTLEMENT_IDENTITY_MISMATCH');
      const { id } = params.item;
      if (typeof id !== 'string' || !id || id.length > 256) fail('CODEX_PROTOCOL_ERROR');
      const message = Object.hasOwn(params.item, 'outputDigest') ? params.item : projectOutputMessage(params.item);
      if (typeof message.text !== 'string' || message.text.length > 8192 || typeof message.truncated !== 'boolean' ||
          !/^[0-9a-f]{64}$/.test(message.outputDigest)) fail('CODEX_PROTOCOL_ERROR');
      const seen = owner.outputItems ?? {}, prior = Object.hasOwn(seen, id) ? seen[id] : null;
      if (prior) {
        if (prior !== message.outputDigest) fail('OUTPUT_MESSAGE_CONFLICT');
        return row; // Old item replay cannot replace the latest display snapshot.
      }
      if (observationOwners(row).reduce((n, value) => n + Object.keys(value.outputItems ?? {}).length, 0) >= 1024 ||
          !owner.outputPreview && observationOwners(row).filter(value => value.outputPreview).length >= 101) fail('OUTPUT_TRACKING_LIMIT');
      return save({ outputItems: { ...seen, [id]: message.outputDigest }, outputPreview: {
        version: (owner.outputPreview?.version ?? 0) + 1, text: message.text, truncated: message.truncated,
      } });
    }
    if (['turn/started', 'turn/completed'].includes(notification?.method) && params?.threadId !== row.threadId) {
      if (!hasReceiver(row, params?.threadId)) fail('SETTLEMENT_IDENTITY_MISMATCH');
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
      if ((!childItem && (params.threadId !== row.threadId || params.turnId !== row.nativeRunId)) ||
          params.item.senderThreadId !== params.threadId) fail('SETTLEMENT_IDENTITY_MISMATCH');
      const { id, status, receiverThreadIds } = params.item;
      if (typeof id !== 'string' || !id || id.length > 256 ||
          !(notification.method === 'item/started' ? ['inProgress'] : ['completed', 'failed', 'interrupted']).includes(status) ||
          !Array.isArray(receiverThreadIds) || receiverThreadIds.length > 100 ||
          !receiverThreadIds.every(child => typeof child === 'string' && child.length > 0 && child.length <= 256 && child !== row.threadId && child !== params.threadId) ||
          new Set(receiverThreadIds).size !== receiverThreadIds.length) fail('CODEX_PROTOCOL_ERROR');
      // A newly spawned thread has one native origin. Reject ancestry cycles and
      // adoption through a second spawn, including different turns of one sender.
      for (const candidate of observationOwners(row)) for (const [otherId, spawn] of Object.entries(candidate.spawns ?? {})) {
        if ((candidate !== owner || otherId !== id) && spawn.receiverThreadIds.some(child => receiverThreadIds.includes(child))) fail('SETTLEMENT_IDENTITY_MISMATCH');
      }
      const spawns = { ...owner.spawns };
      const prior = Object.hasOwn(spawns, id) ? spawns[id] : undefined;
      const receivers = [...receiverThreadIds].sort();
      if (prior && (prior.receiverThreadIds.some(child => !receivers.includes(child)) ||
          prior.status !== 'inProgress' && (prior.status !== status || JSON.stringify(prior.receiverThreadIds) !== JSON.stringify(receivers)))) fail('SETTLEMENT_CONFLICT');
      if (!prior && Object.keys(spawns).length >= 4096) fail('SPAWN_TRACKING_LIMIT');
      // A completed spawn invocation acknowledges children, not their settlement
      // or authorization. Keep receivers even when the parent root completes.
      Object.defineProperty(spawns, id, { value: { status, receiverThreadIds: receivers }, enumerable: true, writable: true, configurable: true });
      return saveOperation('spawns', id, prior?.status, status, { spawns });
    }
    const field = params?.item?.type === 'commandExecution' ? 'commands' : params?.item?.type === 'mcpToolCall' ? 'mcpCalls'
      : params?.item?.type === 'fileChange' ? 'fileChanges' : params?.item?.type === 'dynamicToolCall' ? 'dynamicCalls'
      : params?.item?.type === 'webSearch' ? 'webSearches' : params?.item?.type === 'sleep' ? 'sleeps'
      : params?.item?.type === 'contextCompaction' ? 'compactions'
      : params?.item?.type === 'imageGeneration' ? 'imageGenerations'
      : params?.item?.type === 'reasoning' ? 'reasoningItems'
      : params?.item?.type === 'collabAgentToolCall' && OBSERVED_COLLAB_TOOLS.includes(params.item.tool) ? 'collabCalls' : null;
    if (['item/started', 'item/completed'].includes(notification?.method) && field) {
      if (!childItem && (params.threadId !== row.threadId || params.turnId !== row.nativeRunId)) fail('SETTLEMENT_IDENTITY_MISMATCH');
      if (field === 'collabCalls' && params.item.senderThreadId !== params.threadId) fail('SETTLEMENT_IDENTITY_MISMATCH');
      const { id } = params.item;
      // These variants lack a closed native success/failure enum. Track lifecycle
      // termination only; never persist their payload-supplied status strings.
      const status = ['webSearches', 'sleeps', 'compactions', 'imageGenerations', 'reasoningItems'].includes(field)
        ? notification.method === 'item/started' ? 'inProgress' : 'completed' : params.item.status;
      const terminal = ['commands', 'fileChanges'].includes(field) ? ['completed', 'failed', 'declined']
        : field === 'collabCalls' ? ['completed', 'failed', 'interrupted'] : ['completed', 'failed'];
      if (typeof id !== 'string' || !id || id.length > 256 ||
          !(notification.method === 'item/started' ? ['inProgress'] : terminal).includes(status)) fail('CODEX_PROTOCOL_ERROR');
      const obligations = { ...owner[field] };
      const itemKey = field === 'collabCalls' ? JSON.stringify([params.item.tool, id]) : id;
      const prior = Object.hasOwn(obligations, itemKey) ? obligations[itemKey] : undefined;
      if (prior && prior !== 'inProgress') {
        if (prior !== status) fail('SETTLEMENT_CONFLICT');
        return row;
      }
      if (!Object.hasOwn(obligations, itemKey) && Object.keys(obligations).length >= 4096) fail('COMMAND_TRACKING_LIMIT');
      // Persist starts even if history omits them. Root completion cannot remove
      // these obligations; command recovery requires an exact status-bearing item.
      Object.defineProperty(obligations, itemKey, { value: status, enumerable: true, writable: true, configurable: true });
      // An MCP terminal response settles only the invocation, not external effects.
      return saveOperation(field, itemKey, prior, status, { [field]: obligations });
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
  async reconcileChild(attemptId, target) {
    if (!target || Object.keys(target).some(key => !['threadId', 'turnId'].includes(key)) ||
        ![target.threadId, target.turnId].every(id => typeof id === 'string' && id.length > 0 && id.length <= 256)) fail('INVALID_RECONCILIATION_TARGET');
    const row = await this.requireRun(attemptId), { threadId, turnId } = target;
    const turnKey = JSON.stringify([threadId, turnId]);
    if (!Object.hasOwn(row.childTurns ?? {}, turnKey)) fail('SETTLEMENT_IDENTITY_MISMATCH');
    const parents = [[row.threadId, row], ...Object.entries(row.childObligations ?? {}).map(([key, owner]) => [JSON.parse(key)[0], owner])]
      .flatMap(([parent, owner]) => Object.values(owner.spawns ?? {}).filter(spawn => spawn.receiverThreadIds.includes(threadId)).map(() => parent));
    if (parents.length !== 1) fail('SETTLEMENT_IDENTITY_MISMATCH');
    const reply = await this.rpc('thread/read', { threadId, includeTurns: true });
    if (reply?.thread?.id !== threadId || reply.thread.source?.subAgent?.thread_spawn?.parent_thread_id !== parents[0] ||
        !Array.isArray(reply.thread.turns)) fail('CODEX_PROTOCOL_ERROR');
    const matches = reply.thread.turns.filter(turn => turn?.id === turnId);
    if (matches.length !== 1) fail('RECONCILIATION_INCOMPLETE');
    return this.#reconcileHistory(attemptId, threadId, matches[0]);
  }

  async reconcile(attemptId) {
    const row = await this.requireRun(attemptId);
    const reply = await this.rpc('thread/read', { threadId: row.threadId, includeTurns: true });
    if (reply?.thread?.id !== row.threadId || !Array.isArray(reply.thread.turns)) fail('CODEX_PROTOCOL_ERROR');
    const matches = reply.thread.turns.filter(turn => turn?.id === row.nativeRunId);
    if (matches.length !== 1) fail('RECONCILIATION_INCOMPLETE');
    return this.#reconcileHistory(attemptId, row.threadId, matches[0]);
  }

  #reconcileHistory(attemptId, threadId, turn) {
    // Serialize with live notifications, re-read current observations after the
    // RPC, and validate the entire patch before one durable update.
    const next = this.#observations.then(async () => {
      const row = await this.requireRun(attemptId);
      const child = threadId !== row.threadId, key = JSON.stringify([threadId, turn.id]);
      if (child ? !hasReceiver(row, threadId) || !Object.hasOwn(row.childTurns ?? {}, key)
        : turn.id !== row.nativeRunId) fail('SETTLEMENT_IDENTITY_MISMATCH');
      if (!['inProgress', 'completed', 'failed', 'interrupted'].includes(turn.status) ||
          turn.items !== undefined && !Array.isArray(turn.items)) fail('CODEX_PROTOCOL_ERROR');
      const prior = child ? row.childTurns[key] : row.rootSettled ? row.nativeOutcome : 'inProgress';
      if (prior !== 'inProgress' && prior !== turn.status) fail('SETTLEMENT_CONFLICT');
      const owner = child ? row.childObligations?.[key] ?? {} : row;
      const recovered = {};
      for (const [field, type] of Object.entries({ commands: 'commandExecution', mcpCalls: 'mcpToolCall',
        dynamicCalls: 'dynamicToolCall', fileChanges: 'fileChange' })) {
        const values = { ...owner[field] }; let changed = false;
        for (const [id, status] of Object.entries(values)) {
          const matches = (turn.items ?? []).filter(item => item?.id === id);
          if (!matches.length) continue; // Omitted history is not a terminal receipt.
          if (matches.length !== 1) fail('RECONCILIATION_INCOMPLETE');
          const item = matches[0];
          const states = ['inProgress', 'completed', 'failed', ...(['commands', 'fileChanges'].includes(field) ? ['declined'] : [])];
          if (item.type !== type || !states.includes(item.status)) fail('CODEX_PROTOCOL_ERROR');
          if (status !== 'inProgress' && status !== item.status) fail('SETTLEMENT_CONFLICT');
          if (status !== item.status) { values[id] = item.status; changed = true; }
        }
        if (changed) recovered[field] = values;
      }
      const patch = {};
      if (prior !== turn.status) {
        if (child) patch.childTurns = { ...row.childTurns, [key]: turn.status };
        else Object.assign(patch, { rootSettled: true, status: 'finishing', nativeOutcome: turn.status });
      }
      if (Object.keys(recovered).length) {
        if (child) patch.childObligations = { ...row.childObligations, [key]: { ...owner, ...recovered } };
        else Object.assign(patch, recovered);
      }
      // No new items, statusless-tool inference, descendant census, or effect
      // settlement. Identical readback produces no journal write.
      return Object.keys(patch).length ? this.journal.update(attemptId, patch) : row;
    });
    this.#observations = next.catch(() => {});
    return next;
  }
}
