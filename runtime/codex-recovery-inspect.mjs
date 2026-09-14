import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

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
    coverage: 'unknown; observed terminal events do not settle effects' };
  const issue = code => { if (!report.issues.includes(code)) report.issues.push(code); };
  const read = async (key, optional = false) => {
    let fd;
    try {
      require(/^[a-zA-Z0-9_-]{1,128}$/.test(key));
      fd = await open(join(directory, `${key}.json`), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const before = await fd.stat();
      require(before.isFile() && before.uid === process.getuid() && (before.mode & 0o077) === 0 && before.size > 0 && before.size <= 1048576);
      const buffer = Buffer.alloc(1048577); let size = 0;
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
    const root = { threadId: native.threadId ?? null, turnId: native.nativeRunId ?? null,
      status: native.status, observedTerminal: native.rootSettled };
    const children = [], obligations = [], origins = new Map();
    const items = (owner, threadId, turnId) => {
      require(object(owner));
      for (const field of ['commands', 'mcpCalls', 'spawns']) for (const [itemId, item] of entries(owner[field])) {
        const status = field === 'spawns' ? item?.status : item;
        require(id(itemId) && ['inProgress', 'completed', 'failed', ...(field === 'commands' ? ['declined'] : [])].includes(status));
        obligations.push({ threadId, turnId, kind: field, itemId, status });
        if (field === 'spawns') {
          require(Array.isArray(item.receiverThreadIds) && item.receiverThreadIds.length <= 100);
          for (const receiver of item.receiverThreadIds) {
            require(id(receiver) && receiver !== native.threadId && receiver !== threadId && !origins.has(receiver));
            origins.set(receiver, threadId);
          }
          obligations.at(-1).receiverThreadIds = [...item.receiverThreadIds];
        }
      }
    };
    items(native, root.threadId, root.turnId);
    const turns = entries(native.childTurns);
    for (const [key, status] of turns) {
      const pair = JSON.parse(key);
      require(Array.isArray(pair) && pair.length === 2 && pair.every(id) && pair[0] !== native.threadId && JSON.stringify(pair) === key);
      require(['inProgress', 'completed', 'failed', 'interrupted'].includes(status));
      children.push({ threadId: pair[0], turnId: pair[1], status });
      items(native.childObligations?.[key] ?? {}, pair[0], pair[1]);
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
