import { createHash } from 'node:crypto';
import { readQuietPhases } from './codex-quiet-phases.mjs';
import { readWappMcpOperations } from './wappmcp-operations.mjs';

const fail = code => { throw Object.assign(new Error(code), { code }); };
const entries = value => {
  if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) fail('INVALID_OPERATION_INVENTORY');
  return Object.entries(value ?? {});
};
const uuid = value => {
  const hex = createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

/** Host-owned heartbeat projection. Invocation termination is not effect settlement.
 * All records charge the admitted logical root task, including descendant work.
 * An unresolved coverage record deliberately prevents completion and sleep until
 * supported native coverage, external effects and recovery are established.
 */
export class CodexOperations {
  constructor({ journal, attemptId, runId, attempt, startedAt, deadlineAt, textOnlyProfile = null, backgroundRole = null, shellOperationTimeoutMs = /** @type {number | undefined} */ (undefined) }) {
    if (!journal?.get || !/^[a-zA-Z0-9_-]{1,128}$/.test(attemptId ?? '') ||
        !/^[0-9a-f-]{36}$/i.test(runId ?? '') || !Number.isSafeInteger(attempt) || attempt < 1 ||
        !Number.isFinite(Date.parse(startedAt)) || !Number.isFinite(Date.parse(deadlineAt)) ||
        Date.parse(deadlineAt) <= Date.parse(startedAt) ||
        shellOperationTimeoutMs !== undefined && (typeof shellOperationTimeoutMs !== 'number' ||
          !Number.isSafeInteger(shellOperationTimeoutMs) || shellOperationTimeoutMs < 120001 || shellOperationTimeoutMs > 600000)
      ) fail('INVALID_OPERATION_CONFIGURATION');
    this.journal = journal;
    this.binding = Object.freeze({ attemptId, runId, attempt, startedAt, deadlineAt,
      ...(shellOperationTimeoutMs !== undefined ? { shellOperationTimeoutMs } : {}) });
    this.textOnlyProfile = textOnlyProfile && structuredClone(textOnlyProfile);
    this.backgroundRole = backgroundRole;
  }

  async snapshot() {
    const { attemptId, runId, attempt, startedAt, deadlineAt, shellOperationTimeoutMs } = this.binding;
    const row = await this.journal.get(attemptId);
    const operations = [];
    const add = (key, kind, status, timing = undefined, timeoutMs = undefined) => {
      if (operations.length === 4096) fail('NATIVE_OPERATION_LIMIT');
      if (timing !== undefined && (!timing || typeof timing !== 'object' || Array.isArray(timing) || !['startedAt', 'lastProgressAt'].every(key => typeof timing[key] === 'string' && Number.isFinite(Date.parse(timing[key])) &&
          new Date(timing[key]).toISOString() === timing[key]) || timing.lastProgressAt < timing.startedAt)) fail('INVALID_OPERATION_TIMING');
      operations.push({ id: uuid([attemptId, runId, attempt, key]), run_id: runId, attempt,
        kind, status, started_at: timing?.startedAt ?? startedAt,
        // Only an explicitly declared shell timeout may extend a clocked
        // command beyond two minutes; every other clocked tool stays at two
        // minutes, and no deadline may exceed the admitted attempt deadline.
        deadline_at: timing ? new Date(Math.min(Date.parse(timing.startedAt) + (kind === 'inference' ? 300000 : timeoutMs ?? 120000), Date.parse(deadlineAt))).toISOString() : deadlineAt,
        // Reading the same journal is not fresh native progress.
        last_progress_at: timing?.lastProgressAt ?? startedAt });
    };
    const status = (value, terminal) => value === 'inProgress' ? 'active'
      : terminal.includes(value) ? 'settled' : 'unknown';
    const observedChildren = new Set();
    for (const [key, value] of entries(row?.childTurns)) {
      if (!['inProgress', 'completed', 'failed', 'interrupted'].includes(value)) continue;
      let identity;
      try { identity = JSON.parse(key); } catch { fail('INVALID_CHILD_IDENTITY'); }
      if (!Array.isArray(identity) || identity.length !== 2 || !identity.every(id => typeof id === 'string' && id.length > 0 && id.length <= 256)) fail('INVALID_CHILD_IDENTITY');
      observedChildren.add(identity[0]);
    }
    const textOnlySettled = this.textOnlyProfile?.profile_version === 'codex-text-only-v1' && row?.textOnlyReceipt &&
      row.rootSettled === true && row.nativeOutcome === 'completed' &&
      row.textOnlyProfile?.profile_version === this.textOnlyProfile.profile_version &&
      row.textOnlyProfile?.profile_sha256 === this.textOnlyProfile.profile_sha256 &&
      row.textOnlyReceipt.profile_version === this.textOnlyProfile.profile_version &&
      row.textOnlyReceipt.profile_sha256 === this.textOnlyProfile.profile_sha256 &&
      row.textOnlyReceipt.thread_id === row.threadId && row.textOnlyReceipt.turn_id === row.nativeRunId &&
      !Object.keys(row.childTurns ?? {}).length && !Object.keys(row.childObligations ?? {}).length &&
      ['commands', 'mcpCalls', 'fileChanges', 'dynamicCalls', 'webSearches', 'sleeps', 'compactions', 'collabCalls', 'imageGenerations', 'spawns', 'v2Activities', 'planItems', 'whatsappReads']
        .every(field => !Object.keys(row[field] ?? {}).length);
    // Background roots (roles status/independent) settle their coverage through
    // the root-only background receipt: same thread and turn binding, settled
    // root, completed native outcome and no descendant obligations. Allowed
    // tool activity (for example the independent root's read-only MCP reads)
    // settles through its own operations, so coverage never depends on their
    // absence here. The background root itself never journals a receipt, so
    // its coverage stays unknown exactly like its never-settling family.
    const backgroundSettled = ['status', 'independent'].includes(this.backgroundRole) && !this.textOnlyProfile && row?.backgroundReceipt &&
      row.rootSettled === true && row.nativeOutcome === 'completed' &&
      Object.keys(row.backgroundReceipt).sort().join(',') === 'output_sha256,thread_id,turn_id' &&
      /^[a-f0-9]{64}$/.test(row.backgroundReceipt.output_sha256 ?? '') &&
      row.backgroundReceipt.thread_id === row.threadId && row.backgroundReceipt.turn_id === row.nativeRunId &&
      !Object.keys(row.childTurns ?? {}).length && !Object.keys(row.childObligations ?? {}).length;
    add(['coverage'], 'tool', textOnlySettled || backgroundSettled ? 'settled' : 'unknown');
    add(['root'], 'inference', row?.rootSettled === true ? 'settled'
      : row?.status === 'cancelling' ? 'cancelling' : row?.status === 'running' ? 'active' : 'unknown');
    if (!row) return operations;
    for (const [id, record] of Object.entries(readWappMcpOperations(row.whatsappReads))) {
      add(['whatsappRead', id], 'tool', record.status === 'response' ? 'settled' : 'unknown',
        { startedAt: record.startedAt, lastProgressAt: record.startedAt });
      operations.at(-1).deadline_at = new Date(Math.min(Date.parse(record.deadlineAt), Date.parse(deadlineAt))).toISOString();
    }
    if (row.initialInference !== undefined) {
      if (!['inProgress', 'completed'].includes(row.initialInference)) fail('INVALID_OPERATION_TIMING');
      const start = new Date(startedAt).toISOString();
      add(['initialInference'], 'inference', status(row.initialInference, ['completed']), { startedAt: start, lastProgressAt: start });
    }
    const items = (owner, identity) => {
      if (!owner || typeof owner !== 'object' || Array.isArray(owner)) fail('INVALID_OPERATION_INVENTORY');
      for (const [key, phase] of Object.entries(readQuietPhases(owner.quietPhases))) {
        const [field, id] = JSON.parse(key);
        if (!Object.hasOwn(owner[field] ?? {}, id)) fail('INVALID_QUIET_PHASE');
        add([identity, 'quietInference', key], 'inference', status(phase.status, ['completed']),
          { startedAt: phase.startedAt, lastProgressAt: phase.startedAt });
      }
      if (owner !== row && (owner.initialInference !== undefined || owner.initialInferenceAt !== undefined)) {
        if (!['inProgress', 'completed'].includes(owner.initialInference) || typeof owner.initialInferenceAt !== 'string') fail('INVALID_OPERATION_TIMING');
        add([identity, 'initialInference'], 'inference', status(owner.initialInference, ['completed']),
          { startedAt: owner.initialInferenceAt, lastProgressAt: owner.initialInferenceAt });
      }
      if (owner.operationTimes !== undefined && (!owner.operationTimes || typeof owner.operationTimes !== 'object' || Array.isArray(owner.operationTimes))) fail('INVALID_OPERATION_TIMING');
      const clocks = new Map(Object.entries(owner.operationTimes ?? {}));
      const takeClock = (field, id) => {
        const key = JSON.stringify([field, id]), timing = clocks.get(key);
        clocks.delete(key);
        return timing;
      };
      if (owner.outputItems !== undefined && (!owner.outputItems || typeof owner.outputItems !== 'object' || Array.isArray(owner.outputItems))) fail('INVALID_OUTPUT_COMPLETION');
      for (const [id, digest] of Object.entries(owner.outputItems ?? {})) {
        if (!id || id.length > 256 || typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest)) fail('INVALID_OUTPUT_COMPLETION');
      }
      for (const [id, marker] of entries(owner.messageStarts)) {
        if (marker !== true) fail('INVALID_OPERATION_TIMING');
        add([identity, 'messageStarts', id], 'inference', Object.hasOwn(owner.outputItems ?? {}, id) ? 'settled' : 'active', takeClock('messageStarts', id));
      }
      for (const field of ['commands', 'mcpCalls', 'fileChanges', 'dynamicCalls', 'webSearches', 'sleeps', 'compactions', 'collabCalls', 'imageGenerations', 'reasoningItems', 'planItems']) {
        const terminal = ['webSearches', 'sleeps', 'compactions', 'imageGenerations', 'reasoningItems', 'planItems'].includes(field) ? ['completed']
          : ['completed', 'failed', ...(['commands', 'fileChanges'].includes(field) ? ['declined'] : field === 'collabCalls' ? ['interrupted'] : [])];
        for (const [id, value] of entries(owner[field])) add([identity, field, id], ['reasoningItems', 'planItems'].includes(field) ? 'inference' : 'tool', status(value, terminal), takeClock(field, id), field === 'commands' ? shellOperationTimeoutMs : undefined);
      }
      for (const [id, spawn] of entries(owner.spawns)) {
        const timing = takeClock('spawns', id);
        add([identity, 'spawns', id], 'tool', status(spawn?.status, ['completed', 'failed', 'interrupted']), timing);
        // A terminal spawn's observed progress time is immutable. Acknowledged
        // receivers need their own bound before any child turn arrives; observing
        // that turn ends startup only, never its work or descendants.
        if (timing && (['completed', 'failed', 'interrupted'].includes(spawn?.status) ||
            spawn?.status === 'observed' && spawn?.source === 'v2Activity')) {
          if (!Array.isArray(spawn.receiverThreadIds) || !spawn.receiverThreadIds.every(id => typeof id === 'string' && id.length > 0 && id.length <= 256) ||
              new Set(spawn.receiverThreadIds).size !== spawn.receiverThreadIds.length) fail('INVALID_CHILD_IDENTITY');
          for (const receiver of spawn.receiverThreadIds) add([identity, 'childStartup', id, receiver], 'child',
            observedChildren.has(receiver) ? 'settled' : 'active', { startedAt: timing.lastProgressAt, lastProgressAt: timing.lastProgressAt });
        }
      }
      for (const [id, activity] of entries(owner.v2Activities)) {
        if (!id || id.length > 256 || !activity || typeof activity !== 'object' || Array.isArray(activity) ||
            !['started', 'interacted', 'interrupted', 'completed'].includes(activity.kind) ||
            typeof activity.targetThreadId !== 'string' || !activity.targetThreadId || activity.targetThreadId.length > 256) fail('INVALID_OPERATION_INVENTORY');
        add([identity, 'v2Activity', id], 'tool', 'unknown');
      }
      // No sibling, category alias or omitted item can consume this owner's
      // remaining clocks. Reject the whole snapshot instead of hiding deadlines.
      if (clocks.size) fail('INVALID_OPERATION_TIMING');
    };
    items(row, [row.threadId, row.nativeRunId]);
    for (const [key, value] of entries(row.childTurns)) add(['child', key], 'child', status(value, ['completed', 'failed', 'interrupted']));
    for (const [key, owner] of entries(row.childObligations)) items(owner, key);
    return operations;
  }
}
