import { constants } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { OBSERVED_COLLAB_TOOLS, projectTokenUsage } from './codex-adapter.mjs';
import { readQuietPhases } from './codex-quiet-phases.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,256}$/.test(value);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
const require = condition => { if (!condition) throw Error('INVALID_RECORD'); };
const identity = value => object(value) && Number.isSafeInteger(value.epoch) && value.epoch > 0 && uuid(value.boot_id) &&
  Object.keys(value).every(key => ['epoch', 'boot_id'].includes(key));
const entries = value => { require(value === undefined || object(value)); const rows = Object.entries(value ?? {}); require(rows.length <= 4096); return rows; };

/** Offline diagnostic only. Caller must stop the executor and hold its actual
 * kernel directory lock. This function cannot prove custody or coherent state.
 * Never instantiate FileJournal: inspection must not create directories or write.
 */
export async function inspectCodexRecovery(directory) {
  const report = { recoveryRequired: true, resumeAllowed: false, sleepAllowed: false,
    snapshotConsistency: 'not-established; stopped executor kernel lock required',
    service: null, dispatch: null, native: null, issues: [],
    questions: { complete: false, total: 0, unresolved: 0, resolutionObserved: 0, phases: {} },
    coverage: 'unknown; observed terminal events do not settle effects' };
  const issue = code => { if (!report.issues.includes(code)) report.issues.push(code); };
  const read = async (key, optional = false, maxBytes = 1048576) => {
    let fd;
    try {
      require(/^[a-zA-Z0-9_-]{1,128}$/.test(key));
      fd = await open(join(directory, `${key}.json`), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const before = await fd.stat();
      require(before.isFile() && before.uid === process.getuid() && (before.mode & 0o077) === 0 && before.size > 0 && before.size <= maxBytes);
      const buffer = Buffer.alloc(maxBytes + 1); let size = 0;
      while (size < buffer.length) {
        const { bytesRead } = await fd.read(buffer, size, buffer.length - size, null);
        if (!bytesRead) break;
        size += bytesRead;
      }
      const after = await fd.stat();
      require(size === before.size && after.size === before.size && after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs);
      const row = JSON.parse(buffer.subarray(0, size).toString('utf8'));
      require(object(row)); return row;
    } catch (error) {
      if (!optional || error.code !== 'ENOENT') issue(error.code === 'ENOENT' ? 'RECORD_MISSING' : 'RECORD_UNREADABLE_OR_CHANGED');
      return null;
    } finally { await fd?.close(); }
  };
  try {
    require(typeof directory === 'string' && isAbsolute(directory) && resolve(directory) === directory && await realpath(directory) === directory);
    const stat = await lstat(directory);
    require(stat.isDirectory() && stat.uid === process.getuid() && (stat.mode & 0o077) === 0);
  } catch { issue('PRIVATE_CANONICAL_DIRECTORY_REQUIRED'); return report; }
  // Question custody outlives the current dispatch. Inspect it even when the
  // service/cursor is missing; never open grants, auth files, or unrelated rows.
  try {
    let scanned = 0, candidates = 0, invalid = false;
    const text = (value, max) => typeof value === 'string' && value.length > 0 &&
      value.length <= max * 2 && [...value].length <= max && !/\p{Cs}/u.test(value);
    const questionUuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
    const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
    for await (const entry of await opendir(directory)) {
      if (++scanned > 16384) throw Error('SCAN_LIMIT');
      if (!entry.name.startsWith('question_')) continue;
      if (++candidates > 4096) throw Error('SCAN_LIMIT');
      try {
        require(/^question_[a-f0-9]{64}\.json$/.test(entry.name));
        const row = await read(entry.name.slice(0, -5), false, 16384);
        require(exact(row, ['version', 'questionId', 'connectionId', 'requestId', 'binding', 'threadId', 'turnId', 'itemId', 'inputSha256', 'phase', 'resolutionObserved',
          ...(Object.hasOwn(row, 'wait') ? ['wait'] : [])]));
        const binding = row.binding;
        require(row.version === 1 && questionUuid(row.questionId) && questionUuid(row.connectionId) &&
          (Number.isSafeInteger(row.requestId) || text(row.requestId, 128)) &&
          ['threadId', 'turnId', 'itemId'].every(key => text(row[key], 256)) && /^[a-f0-9]{64}$/.test(row.inputSha256));
        require(exact(binding, ['identity', 'run_id', 'attempt', 'attemptId', 'deadline_at']) &&
          exact(binding.identity, ['epoch', 'boot_id']) && Number.isSafeInteger(binding.identity.epoch) && binding.identity.epoch >= 0 &&
          questionUuid(binding.identity.boot_id) && questionUuid(binding.run_id) && Number.isSafeInteger(binding.attempt) && binding.attempt > 0 &&
          /^[a-zA-Z0-9_-]{1,128}$/.test(binding.attemptId) && typeof binding.deadline_at === 'string' &&
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(binding.deadline_at) &&
          new Date(binding.deadline_at).toISOString() === binding.deadline_at);
        require(entry.name === `question_${hash([binding.attemptId, row.threadId, row.turnId, row.itemId])}.json` &&
          ['record_unknown', 'waiting', 'take_unknown', 'handoff_unknown', 'resolve_unknown', 'resolved'].includes(row.phase) &&
          typeof row.resolutionObserved === 'boolean' && (row.phase !== 'resolved' || row.resolutionObserved));
        if (Object.hasOwn(row, 'wait')) {
          require(exact(row.wait, ['startedAt', 'deadlineAt']) && ['startedAt', 'deadlineAt'].every(key =>
            typeof row.wait[key] === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.wait[key]) && new Date(row.wait[key]).toISOString() === row.wait[key]) &&
            row.wait.deadlineAt > row.wait.startedAt && row.wait.deadlineAt <= binding.deadline_at &&
            Date.parse(row.wait.deadlineAt) - Date.parse(row.wait.startedAt) <= 900000);
          (report.questions.waits ??= []).push({ ...row.wait, phase: row.phase });
        }
        report.questions.total++;
        report.questions.phases[row.phase] = (report.questions.phases[row.phase] ?? 0) + 1;
        if (row.phase !== 'resolved') report.questions.unresolved++;
        if (row.resolutionObserved) report.questions.resolutionObserved++;
      } catch { invalid = true; issue('QUESTION_RECORD_INVALID_OR_UNREADABLE'); }
    }
    report.questions.complete = !invalid;
  } catch { issue('QUESTION_SCAN_INCOMPLETE'); }
  if (report.questions.unresolved) issue('QUESTION_CUSTODY_UNRESOLVED');
  const service = await read('service');
  if (!service) return report;
  try {
    require(['boot_unknown', 'starting', 'running', 'recovery'].includes(service.phase));
    require(service.identity === undefined || identity(service.identity));
    require(service.bootId === undefined || uuid(service.bootId));
    require(!service.identity || !service.bootId || service.identity.boot_id === service.bootId);
    report.service = { phase: service.phase, epoch: service.identity?.epoch ?? null,
      bootId: service.identity?.boot_id ?? service.bootId ?? null };
    if (!service.identity) { issue('SERVICE_IDENTITY_UNKNOWN'); return report; }
  } catch { issue('SERVICE_RECORD_INVALID'); return report; }
  const dispatch = await read(`dispatch-${hash(service.identity)}`);
  if (!dispatch) return report;
  try {
    require(identity(dispatch.identity) && dispatch.identity.epoch === service.identity.epoch && dispatch.identity.boot_id === service.identity.boot_id);
    require(['claim_unknown', 'claimed', 'submission_unknown', 'submitted_unknown', 'running', 'complete_pending', 'complete'].includes(dispatch.phase));
    const run = dispatch.claim?.run;
    require(!dispatch.claim || (object(run) && uuid(run.id) && Number.isSafeInteger(run.current_attempt) && run.current_attempt > 0 &&
      dispatch.claim.submission_key === `${run.id}:${run.current_attempt}`));
    report.dispatch = { phase: dispatch.phase, runId: run?.id ?? null, attempt: run?.current_attempt ?? null,
      attemptId: /^[a-f0-9]{64}$/.test(dispatch.attemptId ?? '') ? dispatch.attemptId : null };
    // A reused cursor can retain an old attemptId after claim_unknown/empty claim.
    // Never attach that stale native record to a new or unknown claim.
    if (!run || ['claim_unknown', 'claimed'].includes(dispatch.phase)) {
      report.dispatch.attemptId = null; issue('DISPATCH_NATIVE_BINDING_UNKNOWN'); return report;
    }
    require(report.dispatch.attemptId !== null);
  } catch { report.dispatch = null; issue('DISPATCH_RECORD_INVALID'); return report; }
  const native = await read(report.dispatch.attemptId);
  if (!native) return report;
  try {
    require(native.attemptId === report.dispatch.attemptId);
    require(['thread_unknown', 'submission_unknown', 'running', 'recovery_required', 'cancelling', 'finishing'].includes(native.status));
    require(native.threadId == null || id(native.threadId)); require(native.nativeRunId == null || id(native.nativeRunId));
    require(dispatch.nativeRunId == null || (id(dispatch.nativeRunId) && dispatch.nativeRunId === native.nativeRunId));
    require(typeof native.rootSettled === 'boolean');
    require(!native.rootSettled || (id(native.threadId) && id(native.nativeRunId) && ['completed', 'failed', 'interrupted'].includes(native.nativeOutcome)));
    require(native.rootSettled || (native.nativeOutcome === undefined && native.status !== 'finishing'));
    require(native.initialInference === undefined || ['inProgress', 'completed'].includes(native.initialInference));
    const root = { threadId: native.threadId ?? null, turnId: native.nativeRunId ?? null,
      status: native.status, observedTerminal: native.rootSettled,
      ...(native.initialInference === undefined ? {} : { initialInference: native.initialInference }) };
    if (native.tokenUsage !== undefined) root.tokenUsage = projectTokenUsage(native.tokenUsage);
    const children = [], obligations = [], origins = new Map();
    const items = (owner, threadId, turnId) => {
      require(object(owner));
      for (const [key, phase] of Object.entries(readQuietPhases(owner.quietPhases))) {
        const [field, itemId] = JSON.parse(key);
        require(Object.hasOwn(owner[field] ?? {}, itemId) && obligations.length < 4096);
        obligations.push({ threadId, turnId, kind: 'quietInference', itemId: key,
          status: phase.status, timing: { startedAt: phase.startedAt, lastProgressAt: phase.startedAt },
          ...(phase.endedAt === undefined ? {} : { endedAt: phase.endedAt,
            durationMs: Date.parse(phase.endedAt) - Date.parse(phase.startedAt) }) });
      }
      const clocks = new Map(entries(owner.operationTimes));
      for (const field of ['commands', 'mcpCalls', 'spawns', 'fileChanges', 'dynamicCalls', 'webSearches', 'sleeps', 'compactions', 'imageGenerations', 'collabCalls', 'reasoningItems', 'planItems', 'messageStarts']) for (const [key, item] of entries(owner[field])) {
        let itemId = key, tool;
        if (field === 'collabCalls') {
          const pair = JSON.parse(key);
          require(Array.isArray(pair) && pair.length === 2 && OBSERVED_COLLAB_TOOLS.includes(pair[0]) && JSON.stringify(pair) === key);
          [tool, itemId] = pair;
        }
        if (field === 'messageStarts') require(item === true);
        const status = field === 'messageStarts' ? Object.hasOwn(owner.outputItems ?? {}, key) ? 'completed' : 'inProgress' : field === 'spawns' ? item?.status : item;
        const states = ['webSearches', 'sleeps', 'compactions', 'imageGenerations', 'reasoningItems', 'planItems'].includes(field) ? ['inProgress', 'completed']
          : ['inProgress', 'completed', 'failed', ...(['commands', 'fileChanges'].includes(field) ? ['declined'] : field === 'collabCalls' ? ['interrupted'] : [])];
        require(typeof itemId === 'string' && itemId.length > 0 && itemId.length <= 256 && states.includes(status) && obligations.length < 4096);
        obligations.push({ threadId, turnId, kind: field, itemId, status, ...(tool ? { tool } : {}) });
        const timingKey = JSON.stringify([field, key]);
        if (clocks.has(timingKey)) {
          const timing = clocks.get(timingKey);
          require(object(timing) && ['startedAt', 'lastProgressAt'].every(key => typeof timing[key] === 'string' &&
            Number.isFinite(Date.parse(timing[key])) && new Date(timing[key]).toISOString() === timing[key]) && timing.lastProgressAt >= timing.startedAt);
          obligations.at(-1).timing = { startedAt: timing.startedAt, lastProgressAt: timing.lastProgressAt };
          clocks.delete(timingKey);
        }
        if (field === 'spawns') {
          require(Array.isArray(item.receiverThreadIds) && item.receiverThreadIds.length <= 100);
          for (const receiver of item.receiverThreadIds) {
            require(id(receiver) && receiver !== native.threadId && receiver !== threadId && !origins.has(receiver));
            origins.set(receiver, threadId);
          }
          obligations.at(-1).receiverThreadIds = [...item.receiverThreadIds];
        }
      }
      // A clock must identify an observed operation in this exact owner, not a
      // sibling's matching item ID or a noncanonical/unknown inventory key.
      require(clocks.size === 0);
    };
    items(native, root.threadId, root.turnId);
    const turns = entries(native.childTurns);
    for (const [key, status] of turns) {
      const pair = JSON.parse(key);
      require(Array.isArray(pair) && pair.length === 2 && pair.every(id) && pair[0] !== native.threadId && JSON.stringify(pair) === key);
      require(['inProgress', 'completed', 'failed', 'interrupted'].includes(status));
      children.push({ threadId: pair[0], turnId: pair[1], status });
      const owner = native.childObligations?.[key] ?? {};
      if (owner.tokenUsage !== undefined) children.at(-1).tokenUsage = projectTokenUsage(owner.tokenUsage);
      if (owner.initialInference !== undefined || owner.initialInferenceAt !== undefined) {
        require(['inProgress', 'completed'].includes(owner.initialInference) && typeof owner.initialInferenceAt === 'string' &&
          Number.isFinite(Date.parse(owner.initialInferenceAt)) && new Date(owner.initialInferenceAt).toISOString() === owner.initialInferenceAt);
        Object.assign(children.at(-1), { initialInference: owner.initialInference, initialInferenceAt: owner.initialInferenceAt });
      }
      items(owner, pair[0], pair[1]);
    }
    for (const [key] of entries(native.childObligations)) require(turns.some(([turn]) => turn === key));
    for (const child of children) {
      let current = child.threadId; const seen = new Set();
      while (current !== root.threadId) { require(!seen.has(current) && origins.has(current)); seen.add(current); current = origins.get(current); }
    }
    report.native = { root, children, observations: obligations };
    if (!root.threadId || !root.turnId || !dispatch.nativeRunId) issue('NATIVE_ACKNOWLEDGEMENT_UNKNOWN');
    for (const [receiver] of origins) if (!children.some(child => child.threadId === receiver)) issue('CHILD_TURN_UNKNOWN');
    for (const child of children) {
      const cancellation = await read(`cancel-child-${hash([native.attemptId, child.threadId, child.turnId])}`, true);
      if (cancellation) {
        require(cancellation.threadId === child.threadId && cancellation.turnId === child.turnId && ['unknown', 'accepted'].includes(cancellation.status));
        child.cancelAcknowledgement = cancellation.status;
      }
    }
  } catch { report.native = null; issue('NATIVE_RECORD_INVALID_OR_CONTRADICTORY'); }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) { process.stderr.write('Usage: codex-recovery-inspect.mjs ABSOLUTE_PRIVATE_JOURNAL_DIR\n'); process.exitCode = 64; }
  else {
    try { const result = await inspectCodexRecovery(process.argv[2]); console.log(JSON.stringify(result, null, 2)); process.exitCode = result.issues.length ? 2 : 0; }
    catch { process.stderr.write('Recovery inspection failed; state remains unknown.\n'); process.exitCode = 2; }
  }
}
