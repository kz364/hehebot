import { readWappMcp } from './wappmcp-reads.mjs';

const fail = () => { throw Object.assign(new Error('WHATSAPP_OPERATION_INVALID'), { code: 'WHATSAPP_OPERATION_INVALID' }); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const time = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

/** Payload-free host records. An intent is uncertain after reconstruction; neither
 * cancellation nor an SDK rejection proves termination. A response settles only
 * this protocol invocation, never the browser/process or independent effects.
 */
export function readWappMcpOperations(value) {
  if (value === undefined) return {};
  if (!object(value) || Object.keys(value).length > 4096) fail();
  for (const [key, row] of Object.entries(value)) {
    if (!id(key) || !object(row) || Object.keys(row).length !== 3 ||
        !['intent', 'response'].includes(row.status) || !time(row.startedAt) || !time(row.deadlineAt) ||
        Date.parse(row.deadlineAt) <= Date.parse(row.startedAt) || Date.parse(row.deadlineAt) - Date.parse(row.startedAt) > 120000) fail();
  }
  return value;
}

/** Trusted single-executor assembly only. IDs and options must come from host
 * custody, not model arguments. call must resolve only on an actual MCP response,
 * never on local cancellation/close. This does not launch/register a connector.
 * Retained operation IDs are never replayed, even after a response.
 */
export function readJournaledWappMcp({ journal, attemptId, operationId }, grant, name, args, call, options) {
  if (!journal?.serial || !journal?.get || !journal?.write || !id(attemptId) || !id(operationId) ||
      typeof call !== 'function' || typeof options?.authorize !== 'function' || !time(options?.deadlineAt)) fail();
  return readWappMcp(grant, name, args, async (tool, admitted, transportOptions) => {
    const { signal, deadlineAt } = transportOptions;
    let waitDeadline = deadlineAt;
    const stopped = () => signal.aborted || Date.now() >= Date.parse(waitDeadline);
    await journal.serial(async () => {
      if (stopped()) fail();
      const row = await journal.get(attemptId);
      if (!row || row.attemptId !== attemptId || row.status !== 'running' || row.rootSettled === true || stopped()) fail();
      const operations = readWappMcpOperations(row.whatsappReads);
      if (Object.hasOwn(operations, operationId) || Object.keys(operations).length >= 4096) fail();
      const next = readWappMcpOperations({ ...operations,
        [operationId]: { status: 'intent', startedAt: new Date().toISOString(), deadlineAt } });
      await journal.write(attemptId, { ...row, whatsappReads: next });
    });
    // A queued/fsynced intent can outlive its authority. Never dispatch late.
    if (stopped()) fail();
    const currentAuthority = await transportOptions.revalidate();
    waitDeadline = currentAuthority.deadlineAt;
    if (stopped()) fail();
    const result = await call(tool, admitted, currentAuthority);
    if (stopped()) fail();
    // Only a protocol result object is eligible. Content validation and the final
    // authority check still happen inside readWappMcp before any data is released.
    if (!object(result)) fail();
    await journal.serial(async () => {
      if (stopped()) fail();
      const row = await journal.get(attemptId);
      if (!row || row.attemptId !== attemptId || stopped()) fail();
      const operations = readWappMcpOperations(row.whatsappReads);
      if (operations[operationId]?.status !== 'intent' || operations[operationId].deadlineAt !== deadlineAt) fail();
      await journal.write(attemptId, { ...row, whatsappReads: { ...operations,
        [operationId]: { ...operations[operationId], status: 'response' } } });
    });
    return result;
  }, options);
}
