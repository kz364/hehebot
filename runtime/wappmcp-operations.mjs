import { createHash } from 'node:crypto';
import validateRuntime from '../src/generated/validate-runtime.js';
import { captureWappMcpResult, readWappMcp } from './wappmcp-reads.mjs';

const fail = () => { throw Object.assign(new Error('WHATSAPP_OPERATION_INVALID'), { code: 'WHATSAPP_OPERATION_INVALID' }); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const time = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

/** Host-only binding to one already connected MCP client. Does not install,
 * connect, register tools or assert artifact/process readiness. operationId must
 * come from host call custody, not model arguments. Reopening with changed task
 * custody is forbidden; timeout/SDK errors retain journaled uncertainty.
 */
export function createWappMcpReader({ journal, attemptId, controlClient, mcpClient, identity, runId, attempt, deadlineAt, grant }) {
  if (!journal?.putIfAbsent || !journal?.serial || !journal?.get || !journal?.write || !id(attemptId) ||
      typeof controlClient?.request !== 'function' || typeof mcpClient?.callTool !== 'function' || !time(deadlineAt)) fail();
  let custody;
  try { custody = structuredClone({ identity, run_id: runId, attempt, deadlineAt, grant }); } catch { fail(); }
  const fingerprint = createHash('sha256').update(JSON.stringify(custody)).digest('hex');
  const bindingId = `whatsapp-binding-${createHash('sha256').update(attemptId).digest('hex')}`;
  const authorize = async ({ name, chatId }) => {
    const payload = {
      identity: structuredClone(custody.identity), run_id: custody.run_id, attempt: custody.attempt, name, chatId,
    };
    if (!validateRuntime({ type: 'whatsapp-read-authorize', payload })) fail();
    const prior = await journal.putIfAbsent(bindingId, { fingerprint });
    if (prior && prior.fingerprint !== fingerprint) fail();
    return controlClient.request('whatsapp-read-authorize', payload);
  };
  return (operationId, name, args, signal) => readJournaledWappMcp(
    { journal, attemptId, operationId }, custody.grant, name, args,
    (tool, admitted, options) => {
      const timeout = Date.parse(options.deadlineAt) - Date.now();
      if (options.signal.aborted || timeout <= 0) fail();
      // Use the SDK's default result schema, never repair incompatible results.
      return mcpClient.callTool({ name: tool, arguments: admitted }, undefined,
        { signal: options.signal, timeout, resetTimeoutOnProgress: false });
    }, { deadlineAt: custody.deadlineAt, authorize, ...(signal === undefined ? {} : { signal }) });
}

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
    let result = await call(tool, admitted, currentAuthority);
    if (stopped()) fail();
    // Only a protocol result object is eligible. Content validation and the final
    // authority check still happen inside readWappMcp before any data is released.
    if (!object(result)) fail();
    result = captureWappMcpResult(result);
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
