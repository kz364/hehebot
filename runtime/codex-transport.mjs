import { EventEmitter } from 'node:events';
import { StringDecoder } from 'node:string_decoder';
import { spawn } from 'node:child_process';

/** Codex 0.154.0's supported stdio protocol. Never retries a request. */
export class CodexTransport extends EventEmitter {
  constructor(child, { timeoutMs = 30000, maxFrameBytes = 8 * 1024 * 1024, maxPending = 64 } = {}) {
    super();
    this.child = child;
    this.timeoutMs = timeoutMs;
    this.maxFrameBytes = maxFrameBytes;
    this.maxPending = maxPending;
    this.backpressured = false;
    this.pending = new Map();
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
    this.emit('disconnect', { code });
  }

  receive(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('INVALID');
    if (typeof message.method === 'string') {
      if (Object.hasOwn(message, 'id')) {
        // No remote tool request gains authority merely by arriving on this pipe.
        this.write({ id: message.id, error: { code: -32601, message: 'Client capability not enabled' } });
        this.emit('deniedRequest', { method: message.method });
      } else this.emit('notification', message);
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

  async initialize() {
    const result = await this.request('initialize', {
      clientInfo: { name: 'clawbot', version: '0.1.0' },
      capabilities: { experimentalApi: false },
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

/** Dedicated customer-owned home; never inherit provider keys or Amp auth. */
export function spawnCodex({ binary, home, cwd, timeoutMs }) {
  if (!binary?.startsWith('/') || !home?.startsWith('/') || !cwd?.startsWith('/')) throw new Error('ABSOLUTE_PATHS_REQUIRED');
  const env = Object.fromEntries(['PATH', 'LANG']
    .filter(key => process.env[key]).map(key => [key, process.env[key]]));
  env.HOME = home;
  env.CODEX_HOME = home;
  return new CodexTransport(spawn(binary, ['app-server', '--listen', 'stdio://'], {
    cwd, env, stdio: ['pipe', 'pipe', 'pipe'],
  }), { timeoutMs });
}
