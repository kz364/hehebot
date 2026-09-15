import { OBSERVED_COLLAB_TOOLS, projectOutputMessage, projectTokenUsage } from './codex-adapter.mjs';

const fail = code => { throw Object.assign(new Error(code), { code }); };

/** Routes supported observations, not settlement authorization. Subscribe before
 * submission and bind only durably acknowledged IDs. Unknown early events remain
 * buffered; they never select a task by prompt text, timing, or turn position.
 */
export class CodexEventRouter {
  constructor({ transport, adapter, onRecovery, maxPending = 256, maxBindings = 100, now = Date.now }) {
    if (!transport?.on || !transport?.off || !adapter?.observe || !adapter?.requireRun || typeof onRecovery !== 'function' ||
        !Number.isSafeInteger(maxPending) || maxPending < 1 || maxPending > 4096 ||
        !Number.isSafeInteger(maxBindings) || maxBindings < 1 || maxBindings > 1000 || typeof now !== 'function') fail('INVALID_EVENT_ROUTER');
    Object.assign(this, { transport, adapter, onRecovery, maxPending, maxBindings });
    this.bindings = new Map(); this.pending = []; this.tail = Promise.resolve(); this.closed = false;
    this.childOwners = new Map(); this.childBindings = new Map();
    this.notification = value => {
      try {
        const event = this.project(value);
        if (!event || this.closed) return;
        event.observedAt = new Date(now()).toISOString();
        if (this.pending.length >= this.maxPending) return this.recover('NATIVE_EVENT_OVERFLOW');
        this.pending.push(event);
        void this.flush();
      } catch { this.recover('NATIVE_EVENT_INVALID'); }
    };
    this.disconnected = () => this.recover('NATIVE_DISCONNECTED');
    transport.on('notification', this.notification); transport.on('disconnect', this.disconnected);
  }

  project(value) {
    const method = value?.method, params = value?.params;
    if (method === 'thread/tokenUsage/updated') {
      const { threadId, turnId } = params ?? {};
      if (![threadId, turnId].every(id => typeof id === 'string' && id.length > 0 && id.length <= 256)) fail('INVALID_EVENT_IDENTITY');
      return { key: JSON.stringify([threadId, turnId]), notification: {
        method, params: { threadId, turnId, tokenUsage: projectTokenUsage(params.tokenUsage) },
      } };
    }
    const spawn = params?.item?.type === 'collabAgentToolCall' && params.item.tool === 'spawnAgent';
    const collab = params?.item?.type === 'collabAgentToolCall' && OBSERVED_COLLAB_TOOLS.includes(params.item.tool);
    const boundaryOnly = ['webSearch', 'sleep', 'contextCompaction', 'imageGeneration', 'reasoning', 'agentMessage'].includes(params?.item?.type);
    const turn = ['turn/started', 'turn/completed'].includes(method);
    const message = method === 'item/completed' && params?.item?.type === 'agentMessage';
    if (!turn &&
        !message && !(['item/started', 'item/completed'].includes(method) && (spawn || collab || boundaryOnly || ['commandExecution', 'mcpToolCall', 'fileChange', 'dynamicToolCall'].includes(params?.item?.type)))) return null;
    const threadId = params?.threadId, turnId = turn ? params?.turn?.id : params?.turnId;
    if (![threadId, turnId].every(id => typeof id === 'string' && id.length > 0 && id.length <= 256)) fail('INVALID_EVENT_IDENTITY');
    if (turn) {
      if (!(method === 'turn/started' ? ['inProgress'] : ['completed', 'interrupted', 'failed']).includes(params.turn.status)) fail('INVALID_EVENT_STATUS');
    } else {
      const terminal = ['commandExecution', 'fileChange'].includes(params.item.type) ? ['completed', 'failed', 'declined']
        : spawn || collab ? ['completed', 'failed', 'interrupted'] : ['completed', 'failed'];
      if (typeof params.item.id !== 'string' || !params.item.id || params.item.id.length > 256 ||
          !message && !boundaryOnly && !(method === 'item/started' ? ['inProgress'] : terminal).includes(params.item.status)) fail('INVALID_EVENT_ITEM');
      if (collab && params.item.senderThreadId !== threadId) fail('INVALID_EVENT_IDENTITY');
      if (spawn && (params.item.senderThreadId !== threadId || !Array.isArray(params.item.receiverThreadIds) ||
          params.item.receiverThreadIds.length > 100 ||
          !params.item.receiverThreadIds.every(id => typeof id === 'string' && id.length > 0 && id.length <= 256 && id !== threadId) ||
          new Set(params.item.receiverThreadIds).size !== params.item.receiverThreadIds.length)) fail('INVALID_SPAWN_IDENTITY');
    }
    // Only explicit user-visible agent messages retain bounded display text.
    // Command/tool payloads and reasoning are never projected into previews.
    const notification = turn
      ? { method, params: { threadId, turn: { id: turnId, status: params.turn.status } } }
      : { method, params: { threadId, turnId, item: { id: params.item.id, type: params.item.type,
        ...(boundaryOnly ? {} : { status: params.item.status }) } } };
    if (spawn) Object.assign(notification.params.item, { tool: 'spawnAgent', senderThreadId: threadId, receiverThreadIds: [...params.item.receiverThreadIds] });
    if (collab) Object.assign(notification.params.item, { tool: params.item.tool, senderThreadId: threadId });
    if (message) notification.params.item = { id: params.item.id, type: 'agentMessage', ...projectOutputMessage(params.item) };
    return { key: JSON.stringify([threadId, turnId]), notification };
  }

  async bind(attemptId) {
    if (this.closed) fail('EVENT_ROUTER_FENCED');
    const row = await this.adapter.requireRun(attemptId);
    if (this.closed) fail('EVENT_ROUTER_FENCED');
    const key = JSON.stringify([row.threadId, row.nativeRunId]);
    const existing = this.bindings.get(key);
    if (existing && existing !== attemptId || this.childOwners.has(row.threadId)) { this.recover('NATIVE_IDENTITY_CONFLICT'); fail('NATIVE_IDENTITY_CONFLICT'); }
    if (!existing && this.bindings.size >= this.maxBindings) { this.recover('NATIVE_BINDING_LIMIT'); fail('NATIVE_BINDING_LIMIT'); }
    this.bindings.set(key, attemptId);
    try { this.bindChildren(attemptId, row); }
    catch { this.recover('NATIVE_IDENTITY_CONFLICT'); fail('NATIVE_IDENTITY_CONFLICT'); }
    await this.flush();
    if (this.closed) fail('EVENT_ROUTER_FENCED');
  }

  bindChildren(attemptId, row) {
    const spawns = [row, ...Object.values(row.childObligations ?? {})].flatMap(owner => Object.values(owner.spawns ?? {}));
    for (const spawn of spawns) for (const threadId of spawn.receiverThreadIds) {
      const prior = this.childOwners.get(threadId);
      if (prior && prior !== attemptId || [...this.bindings.keys()].some(key => JSON.parse(key)[0] === threadId)) fail('NATIVE_IDENTITY_CONFLICT');
      if (!prior && this.childOwners.size >= this.maxBindings) fail('NATIVE_BINDING_LIMIT');
      this.childOwners.set(threadId, attemptId);
    }
    for (const key of Object.keys(row.childTurns ?? {})) {
      if (this.childOwners.get(JSON.parse(key)[0]) !== attemptId) fail('NATIVE_IDENTITY_CONFLICT');
      this.childBindings.set(key, attemptId);
    }
  }

  flush() {
    const work = this.tail.then(async () => {
      if (this.closed) return;
      for (let index = 0; index < this.pending.length;) {
        const event = this.pending[index];
        const isTurn = ['turn/started', 'turn/completed'].includes(event.notification.method);
        const attemptId = this.bindings.get(event.key) ?? (isTurn ? this.childOwners.get(event.notification.params.threadId) : this.childBindings.get(event.key));
        if (!attemptId) {
          // A known root thread executing another turn is not an early child or
          // an unbound new root. Its prior turn's terminal flag cannot cover it.
          if ([...this.bindings.keys()].some(key => JSON.parse(key)[0] === event.notification.params.threadId)) {
            this.recover('NATIVE_ROOT_TURN_UNBOUND'); return;
          }
          index++; continue;
        }
        const row = await this.adapter.observe(attemptId, event.notification, event.observedAt);
        this.bindChildren(attemptId, row);
        this.pending.splice(index, 1);
        // A spawn receipt may make earlier child observations attributable.
        index = 0;
        if (this.closed) return;
      }
    });
    this.tail = work.catch(() => this.recover('NATIVE_EVENT_RECONCILIATION_FAILED'));
    return this.tail;
  }

  recover(code) {
    if (this.closed) return;
    this.close();
    this.onRecovery({ code });
  }

  close() {
    this.closed = true;
    this.transport.off('notification', this.notification);
    this.transport.off('disconnect', this.disconnected);
    // Preserve unprocessed observations for inspection; never infer settlement.
  }
}
