import { EventEmitter } from 'node:events';
import { StringDecoder } from 'node:string_decoder';
import { spawn } from 'node:child_process';

const validUserInputTimeout = value => value === undefined || Number.isSafeInteger(value) && value >= 1 && value <= 900000;

/** Codex 0.154.0's supported stdio protocol. Never retries a request. */
export class CodexTransport extends EventEmitter {
  constructor(child, { timeoutMs = 30000, userInputTimeoutMs, maxFrameBytes = 8 * 1024 * 1024, maxPending = 64, onToolCall = null, onUserInput = null } = {}) {
    super();
    if (onToolCall !== null && typeof onToolCall !== 'function') throw new Error('INVALID_TOOL_HANDLER');
    if (onUserInput !== null && typeof onUserInput !== 'function') throw new Error('INVALID_USER_INPUT_HANDLER');
    if (!validUserInputTimeout(userInputTimeoutMs)) throw new Error('INVALID_USER_INPUT_TIMEOUT');
    this.child = child;
    this.timeoutMs = timeoutMs;
    this.userInputTimeoutMs = userInputTimeoutMs ?? timeoutMs;
    this.maxFrameBytes = maxFrameBytes;
    this.maxPending = maxPending;
    this.backpressured = false;
    this.pending = new Map();
    this.onToolCall = onToolCall;
    this.onUserInput = onUserInput;
    this.serverCalls = new Map();
    this.seenServerCalls = new Set();
    this.sequence = 0;
    this.closed = false;
    child.stdin.on('drain', () => { this.backpressured = false; });
    const decoder = new StringDecoder('utf8');
    let buffer = '';
    child.stdout.on('data', chunk => {
      if (this.closed) return;
      buffer += decoder.write(chunk);
      let end;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (Buffer.byteLength(line) > maxFrameBytes) return this.fail('CODEX_FRAME_TOO_LARGE');
        if (!line.trim()) continue;
        try { this.receive(JSON.parse(line)); }
        catch { return this.fail('CODEX_INVALID_FRAME'); }
      }
      if (Buffer.byteLength(buffer) > maxFrameBytes) this.fail('CODEX_FRAME_TOO_LARGE');
    });
    child.stdout.on('end', () => this.fail('CODEX_DISCONNECTED'));
    child.stdout.on('error', () => this.fail('CODEX_DISCONNECTED'));
    child.stdin.on('error', () => this.fail('CODEX_DISCONNECTED'));
    child.on('error', () => this.fail('CODEX_START_FAILED'));
    child.on('exit', () => this.fail('CODEX_DISCONNECTED'));
    // Drain diagnostics without persisting potential prompt or credential content.
    child.stderr?.resume();
  }

  fail(code) {
    if (this.closed) return;
    this.closed = true;
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(Object.assign(new Error(code), { code, outcome: 'unknown' }));
    }
    this.pending.clear();
    for (const call of this.serverCalls.values()) { clearTimeout(call.timer); call.controller.abort(); }
    this.serverCalls.clear();
    this.emit('disconnect', { code });
  }

  receive(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('INVALID');
    if (typeof message.method === 'string') {
      if (Object.hasOwn(message, 'id')) {
        if (message.method === 'item/tool/call' && this.onToolCall ||
            message.method === 'item/tool/requestUserInput' && this.onUserInput) {
          this.handleServerCall(message);
          return;
        }
        // No remote tool request gains authority merely by arriving on this pipe.
        this.write({ id: message.id, error: { code: -32601, message: 'Client capability not enabled' } });
        this.emit('deniedRequest', { method: message.method });
      } else {
        if (message.method === 'serverRequest/resolved') {
          const call = this.serverCalls.get(message.params?.requestId);
          if (call?.questionThreadId && call.questionThreadId === message.params?.threadId) {
            clearTimeout(call.timer);
            this.serverCalls.delete(message.params.requestId);
            // Resolution also occurs on interruption. Suppress late answers,
            // without claiming that any answer was accepted or work settled.
            call.controller.abort({ code: 'CODEX_USER_INPUT_RESOLVED' });
          }
        }
        this.emit('notification', message);
      }
      return;
    }
    if (!Object.hasOwn(message, 'id') || (Object.hasOwn(message, 'result') === Object.hasOwn(message, 'error'))) {
      throw new Error('INVALID');
    }
    if (Object.hasOwn(message, 'error') && (!message.error || typeof message.error !== 'object' ||
      !Number.isInteger(message.error.code) || typeof message.error.message !== 'string')) throw new Error('INVALID');
    const entry = this.pending.get(message.id);
    if (!entry) return; // Late response after timeout never triggers a replay.
    this.pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) entry.reject(Object.assign(new Error('CODEX_RPC_ERROR'), { code: 'CODEX_RPC_ERROR', rpcCode: message.error.code }));
    else entry.resolve(message.result);
  }

  handleServerCall(message) {
    const id = message.id;
    const userInput = message.method === 'item/tool/requestUserInput';
    const prefix = userInput ? 'CODEX_USER_INPUT' : 'CODEX_TOOL';
    if (!(Number.isSafeInteger(id) || typeof id === 'string' && id.length > 0 && id.length <= 256) ||
        this.seenServerCalls.has(id)) return this.fail(`${prefix}_REQUEST_CONFLICT`);
    if (this.serverCalls.size >= this.maxPending || this.seenServerCalls.size >= 4096) return this.fail(`${prefix}_REQUEST_LIMIT`);
    const questionIds = userInput && Array.isArray(message.params?.questions) ? message.params.questions.map(q => q?.id) : null;
    if (userInput && (!questionIds?.length || !questionIds.every(q => typeof q === 'string' && q.length > 0) ||
        new Set(questionIds).size !== questionIds.length || typeof message.params.isBlocking !== 'boolean' ||
        !['threadId', 'turnId', 'itemId'].every(key => typeof message.params[key] === 'string' && message.params[key].length > 0))) return this.fail('CODEX_USER_INPUT_INVALID_REQUEST');
    this.seenServerCalls.add(id);
    const controller = new AbortController();
    const timer = setTimeout(() => this.fail(`${prefix}_OUTCOME_UNKNOWN`), userInput ? this.userInputTimeoutMs : this.timeoutMs);
    this.serverCalls.set(id, { controller, timer, questionThreadId: userInput ? message.params.threadId : null });
    // Handler owns exact native identity/grant validation. Merely installing it
    // grants no command, file, network or approval capability. User-input handlers
    // also own owner authorization, durable custody and question/answer policy.
    void Promise.resolve().then(() => {
      if (this.closed || controller.signal.aborted) return;
      const handler = userInput ? this.onUserInput : this.onToolCall;
      return handler.call(this, message.params, { signal: controller.signal, ...(userInput ? { requestId: id } : {}) });
    }).then(result => {
      if (this.closed || controller.signal.aborted) return;
      if (userInput) {
        const answers = result?.answers;
        if (!answers || typeof answers !== 'object' || Array.isArray(answers) ||
            Object.keys(answers).length !== questionIds.length || !questionIds.every(q => Object.hasOwn(answers, q) &&
              Array.isArray(answers[q]?.answers) && answers[q].answers.every(answer => typeof answer === 'string'))) throw new Error('INVALID_USER_INPUT_RESPONSE');
        // Only the advertised answer shape leaves this transport. Writing it is
        // not acknowledgment of receipt, model consumption or task completion.
        this.write({ id, result: { answers: Object.fromEntries(questionIds.map(q => [q, { answers: answers[q].answers }])) } });
        return;
      }
      if (!result || typeof result.success !== 'boolean' || !Array.isArray(result.contentItems) ||
          !result.contentItems.every(item => item && typeof item === 'object' &&
            (item.type === 'inputText' && typeof item.text === 'string' ||
             item.type === 'inputImage' && typeof item.imageUrl === 'string' ||
             item.type === 'inputAudio' && typeof item.audioUrl === 'string'))) throw new Error('INVALID_TOOL_RESPONSE');
      this.write({ id, result: { success: result.success, contentItems: result.contentItems } });
    }).catch(() => { if (!controller.signal.aborted) this.fail(`${prefix}_OUTCOME_UNKNOWN`); }).finally(() => {
      clearTimeout(timer); this.serverCalls.delete(id);
    });
  }

  write(message) {
    if (this.closed) throw Object.assign(new Error('CODEX_DISCONNECTED'), { outcome: 'not_sent' });
    if (this.backpressured) throw Object.assign(new Error('CODEX_BACKPRESSURE'), { outcome: 'not_sent' });
    const data = JSON.stringify(message) + '\n';
    if (Buffer.byteLength(data) > this.maxFrameBytes) throw new Error('CODEX_FRAME_TOO_LARGE');
    this.backpressured = !this.child.stdin.write(data);
  }

  request(method, params = {}) {
    if (this.pending.size >= this.maxPending) return Promise.reject(Object.assign(new Error('CODEX_PENDING_LIMIT'), { outcome: 'not_sent' }));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Object.assign(new Error('CODEX_TIMEOUT'), { code: 'CODEX_TIMEOUT', outcome: 'unknown' }));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.write({ id, method, params }); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  async initialize({ experimentalApi = false } = {}) {
    if (typeof experimentalApi !== 'boolean') throw new Error('INVALID_INITIALIZE');
    const result = await this.request('initialize', {
      clientInfo: { name: 'hehebot', version: '0.1.0' },
      capabilities: { experimentalApi },
    });
    this.write({ method: 'initialized' });
    return result;
  }

  close() {
    this.fail('CODEX_CLOSED');
    this.child.stdin.end();
    this.child.kill();
  }
}

function configValue(value, depth = 0) {
  if (['string', 'boolean'].includes(typeof value)) return JSON.stringify(value);
  if (depth < 4 && value && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}=${configValue(item, depth + 1)}`).join(',')}}`;
  }
  throw new Error('INVALID_CONFIG_OVERRIDES');
}

/** Dedicated customer-owned home; never inherit provider keys or Amp auth. */
export function spawnCodex({ binary, home, cwd, timeoutMs, userInputTimeoutMs, onToolCall = null, onUserInput = null, configOverrides = {} }) {
  if (!binary?.startsWith('/') || !home?.startsWith('/') || !cwd?.startsWith('/')) throw new Error('ABSOLUTE_PATHS_REQUIRED');
  if (!validUserInputTimeout(userInputTimeoutMs)) throw new Error('INVALID_USER_INPUT_TIMEOUT');
  if (!configOverrides || typeof configOverrides !== 'object' || Array.isArray(configOverrides) ||
      Object.keys(configOverrides).some(key => !/^[a-z_][a-z0-9_-]*(?:\.[a-z_][a-z0-9_-]*)*$/.test(key))) throw new Error('INVALID_CONFIG_OVERRIDES');
  const overrides = Object.entries(configOverrides).flatMap(([key, value]) => ['-c', `${key}=${configValue(value)}`]);
  const env = Object.fromEntries(['PATH', 'LANG']
    .filter(key => process.env[key]).map(key => [key, process.env[key]]));
  env.HOME = home;
  env.CODEX_HOME = home;
  return new CodexTransport(spawn(binary, ['app-server', ...overrides, '--listen', 'stdio://'], {
    cwd, env, stdio: ['pipe', 'pipe', 'pipe'],
  }), { timeoutMs, userInputTimeoutMs, onToolCall, onUserInput });
}
