import { createHash } from 'node:crypto';
import { buildToolDefinitions, createAgentToolsHandler } from './agent-tools.mjs';
import { mapMemoryResponse } from './memory-read.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const denied = code => ({ success: false, contentItems: [{ type: 'inputText', text: code }] });

/** Root-scoped supported dynamic tools. The host supplies the admitted grant;
 * neither tool arguments nor inherited child state select its authority.
 */
export function createCodexTools({ adapter, attemptId, controlClient, grant, contracts, memoryCounter, now = Date.now }) {
  if (!adapter?.requireRun || !adapter?.journal?.putIfAbsent || typeof attemptId !== 'string') throw new Error('INVALID_CONFIGURATION');
  grant = structuredClone(grant);
  const handler = createAgentToolsHandler({ controlClient, config: grant, contracts, memoryCounter, now });
  const tools = buildToolDefinitions(contracts).filter(tool => grant.allowedTools.includes(tool.name))
    .map(tool => ({ type: 'function', ...tool }));
  const allowed = new Set(tools.map(tool => tool.name));
  return {
    tools,
    async handle(params, { signal } = {}) {
      if (!params || Object.keys(params).some(key => !['threadId', 'turnId', 'callId', 'namespace', 'tool', 'arguments'].includes(key)) ||
          ![params.threadId, params.turnId, params.callId].every(id => typeof id === 'string' && id.length > 0 && id.length <= 256) ||
          params.namespace !== null || !allowed.has(params.tool)) return denied('CODEX_TOOL_DENIED');
      params = structuredClone(params);
      if (signal?.aborted) return denied('CODEX_TOOL_ABORTED');
      let row;
      try { row = await adapter.requireRun(attemptId); }
      catch (error) {
        if (error.code === 'SUBMISSION_OUTCOME_UNKNOWN') return denied('CODEX_TOOL_IDENTITY_DENIED');
        throw error;
      }
      if (row.threadId !== params.threadId || row.nativeRunId !== params.turnId ||
          row.status !== 'running' || row.rootSettled || row.recoveryRequired) return denied('CODEX_TOOL_IDENTITY_DENIED');
      const grantFingerprint = hash([params.threadId, params.turnId, grant]);
      const binding = await adapter.journal.putIfAbsent(`dynamic-grant-${hash(attemptId)}`, { fingerprint: grantFingerprint });
      if (binding && binding.fingerprint !== grantFingerprint) return denied('CODEX_TOOL_GRANT_CONFLICT');
      const key = `dynamic-call-${hash([attemptId, params.callId])}`;
      const fingerprint = hash([params.threadId, params.turnId, params.tool, params.arguments]);
      const prior = await adapter.journal.putIfAbsent(key, { fingerprint, status: 'unknown' });
      if (prior) {
        if (prior.fingerprint !== fingerprint) return denied('CODEX_TOOL_CALL_CONFLICT');
        if (params.tool === 'hehebot_read_memory') return denied('CODEX_MEMORY_READ_REPLAY_DENIED');
        return prior.status === 'completed' ? prior.result : denied('CODEX_TOOL_OUTCOME_UNKNOWN');
      }
      // Recheck custody after durable intent and before any control-plane call.
      const current = await adapter.requireRun(attemptId);
      if (signal?.aborted || current.threadId !== params.threadId || current.nativeRunId !== params.turnId ||
          current.status !== 'running' || current.rootSettled || current.recoveryRequired) return denied('CODEX_TOOL_IDENTITY_DENIED');
      const response = await handler({ jsonrpc: '2.0', id: params.callId, method: 'tools/call',
        params: { name: params.tool, arguments: params.arguments } }, { signal });
      // A transport/server failure may follow a committed control command. Keep
      // the intent unknown; never automatically replay this invocation.
      if (response?.error?.code === -32000) return denied('CODEX_TOOL_OUTCOME_UNKNOWN');
      const result = mapMemoryResponse(response, value => value?.error ? denied('CODEX_TOOL_ARGUMENTS_DENIED') : {
        success: value.result.isError !== true,
        contentItems: value.result.content.map(item => ({ type: 'inputText', text: item.text })),
      });
      if (params.tool === 'hehebot_read_memory') {
        // No content enters the durable replay journal. The transport resolves
        // this single-use handle only immediately before its synchronous write.
        // Keep the intent unknown: consumption is never acknowledged here.
        return result;
      }
      await adapter.journal.update(key, { status: 'completed', result });
      return result;
    },
  };
}
