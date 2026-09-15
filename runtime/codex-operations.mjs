import { createHash } from 'node:crypto';

const fail = code => { throw Object.assign(new Error(code), { code }); };
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
  constructor({ journal, attemptId, runId, attempt, startedAt, deadlineAt }) {
    if (!journal?.get || !/^[a-zA-Z0-9_-]{1,128}$/.test(attemptId ?? '') ||
        !/^[0-9a-f-]{36}$/i.test(runId ?? '') || !Number.isSafeInteger(attempt) || attempt < 1 ||
        !Number.isFinite(Date.parse(startedAt)) || !Number.isFinite(Date.parse(deadlineAt)) ||
        Date.parse(deadlineAt) <= Date.parse(startedAt)) fail('INVALID_OPERATION_CONFIGURATION');
    this.journal = journal;
    this.binding = Object.freeze({ attemptId, runId, attempt, startedAt, deadlineAt });
  }

  async snapshot() {
    const { attemptId, runId, attempt, startedAt, deadlineAt } = this.binding;
    const row = await this.journal.get(attemptId);
    const operations = [];
    const add = (key, kind, status, timing = undefined) => {
      if (operations.length === 4096) fail('NATIVE_OPERATION_LIMIT');
      if (timing !== undefined && (!timing || typeof timing !== 'object' || Array.isArray(timing) || !['startedAt', 'lastProgressAt'].every(key => typeof timing[key] === 'string' && Number.isFinite(Date.parse(timing[key])) &&
          new Date(timing[key]).toISOString() === timing[key]) || timing.lastProgressAt < timing.startedAt)) fail('INVALID_OPERATION_TIMING');
      operations.push({ id: uuid([attemptId, runId, attempt, key]), run_id: runId, attempt,
        kind, status, started_at: timing?.startedAt ?? startedAt,
        deadline_at: timing ? new Date(Math.min(Date.parse(timing.startedAt) + (kind === 'inference' ? 300000 : 120000), Date.parse(deadlineAt))).toISOString() : deadlineAt,
        // Reading the same journal is not fresh native progress.
        last_progress_at: timing?.lastProgressAt ?? startedAt });
    };
    const status = (value, terminal) => value === 'inProgress' ? 'active'
      : terminal.includes(value) ? 'settled' : 'unknown';
    add(['coverage'], 'tool', 'unknown');
    add(['root'], 'inference', row?.rootSettled === true ? 'settled'
      : row?.status === 'cancelling' ? 'cancelling' : row?.status === 'running' ? 'active' : 'unknown');
    if (!row) return operations;
    const items = (owner, identity) => {
      if (owner.operationTimes !== undefined && (!owner.operationTimes || typeof owner.operationTimes !== 'object' || Array.isArray(owner.operationTimes))) fail('INVALID_OPERATION_TIMING');
      for (const field of ['commands', 'mcpCalls', 'fileChanges', 'dynamicCalls', 'webSearches', 'sleeps', 'compactions', 'collabCalls', 'imageGenerations', 'reasoningItems']) {
        const terminal = ['webSearches', 'sleeps', 'compactions', 'imageGenerations', 'reasoningItems'].includes(field) ? ['completed']
          : ['completed', 'failed', ...(['commands', 'fileChanges'].includes(field) ? ['declined'] : field === 'collabCalls' ? ['interrupted'] : [])];
        for (const [id, value] of Object.entries(owner[field] ?? {})) add([identity, field, id], field === 'reasoningItems' ? 'inference' : 'tool', status(value, terminal), owner.operationTimes?.[JSON.stringify([field, id])]);
      }
      for (const [id, spawn] of Object.entries(owner.spawns ?? {})) {
        add([identity, 'spawns', id], 'tool', status(spawn?.status, ['completed', 'failed']), owner.operationTimes?.[JSON.stringify(['spawns', id])]);
      }
    };
    items(row, [row.threadId, row.nativeRunId]);
    for (const [key, value] of Object.entries(row.childTurns ?? {})) add(['child', key], 'child', status(value, ['completed', 'failed', 'interrupted']));
    for (const [key, owner] of Object.entries(row.childObligations ?? {})) items(owner, key);
    return operations;
  }
}
