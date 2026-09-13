import { randomUUID } from 'node:crypto';

export class GatewayTransportError extends Error {
  constructor(code, outcomeUnknown = false) { super(code); this.code = code; this.outcomeUnknown = outcomeUnknown; }
}
const error = (code, sent = false) => new GatewayTransportError(code, sent);
const bytes = (text) => new TextEncoder().encode(text).length;
/** Supported direct-loopback backend auth exception from pinned Gateway protocol 4.
 * Deploy beside Gateway. Remote/device pairing is intentionally not emulated.
 * Never retries requests or reconnects: a dropped mutation has an unknown outcome.
 */
export class GatewayTransport {
  #socket; #pending = new Map(); #connected = false; #closed = false; #hello;
  #maxBytes; #maxBuffered; #challengeSeen = false; #connecting = false;
  constructor({ url, token, scopes = ['operator.read'], WebSocketImpl = globalThis.WebSocket,
    timeoutMs = 10000, maxPayloadBytes = 1048576, maxPending = 32, onEvent = () => {} }) {
    const endpoint = new URL(url);
    if (!['ws:', 'wss:'].includes(endpoint.protocol) || !['127.0.0.1', '[::1]', 'localhost'].includes(endpoint.hostname) ||
        endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== '/') throw error('LOOPBACK_GATEWAY_REQUIRED');
    if (typeof token !== 'string' || !token || typeof WebSocketImpl !== 'function') throw error('INVALID_CONFIGURATION');
    if (!Array.isArray(scopes) || !scopes.length || scopes.some(x => !['operator.read', 'operator.write', 'operator.admin', 'operator.approvals'].includes(x))) throw error('INVALID_SCOPES');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000 || !Number.isInteger(maxPayloadBytes) || maxPayloadBytes < 1024 || maxPayloadBytes > 26214400 || !Number.isInteger(maxPending) || maxPending < 1 || maxPending > 100) throw error('INVALID_LIMIT');
    this.config = { url, token, scopes, WebSocketImpl, timeoutMs, maxPending, onEvent };
    this.#maxBytes = maxPayloadBytes; this.#maxBuffered = maxPayloadBytes * 2;
  }
  connect() {
    if (this.#connecting || this.#closed) return Promise.reject(error('CONNECTION_NOT_REUSABLE'));
    this.#connecting = true;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.#fail(error('HANDSHAKE_TIMEOUT')), this.config.timeoutMs);
      this.#hello = { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (e) => { clearTimeout(timer); reject(e); } };
      try {
        this.#socket = new this.config.WebSocketImpl(this.config.url);
        this.#socket.addEventListener('message', (event) => this.#receive(event.data));
        this.#socket.addEventListener('error', () => this.#fail(error('CONNECTION_FAILED')));
        this.#socket.addEventListener('close', () => this.#fail(error('CONNECTION_CLOSED')));
      } catch { this.#fail(error('CONNECTION_FAILED')); }
    });
  }
  #receive(raw) {
    if (this.#closed) return;
    if (typeof raw !== 'string' || bytes(raw) > this.#maxBytes) return this.#fail(error('INVALID_GATEWAY_FRAME'));
    let frame; try { frame = JSON.parse(raw); } catch { return this.#fail(error('INVALID_GATEWAY_FRAME')); }
    if (!frame || typeof frame !== 'object' || Array.isArray(frame)) return this.#fail(error('INVALID_GATEWAY_FRAME'));
    if (!this.#connected && frame.type === 'event' && frame.event === 'connect.challenge') {
      if (this.#challengeSeen || typeof frame.payload?.nonce !== 'string' || !frame.payload.nonce || !Number.isSafeInteger(frame.payload.ts) || frame.payload.ts < 0) return this.#fail(error('INVALID_GATEWAY_CHALLENGE'));
      this.#challengeSeen = true;
      this.#send('connect', { minProtocol: 4, maxProtocol: 4,
        client: { id: 'gateway-client', version: '0.1.0', platform: process.platform, mode: 'backend' },
        role: 'operator', scopes: this.config.scopes, caps: ['tool-events'],
        auth: { token: this.config.token } }, this.config.timeoutMs, true).then(hello => {
        if (this.#closed) return;
        if (hello?.type !== 'hello-ok' || hello.protocol !== 4 || typeof hello.server?.version !== 'string' ||
            hello.auth?.role !== 'operator' || !Array.isArray(hello.auth.scopes) ||
            !this.config.scopes.every(s => hello.auth.scopes.includes(s)) || !Array.isArray(hello.features?.methods) ||
            !Number.isSafeInteger(hello.policy?.maxPayload) || hello.policy.maxPayload < 1 ||
            !Number.isSafeInteger(hello.policy?.maxBufferedBytes) || hello.policy.maxBufferedBytes < 1) return this.#fail(error('INCOMPATIBLE_GATEWAY_HELLO'));
        this.#maxBytes = Math.min(this.#maxBytes, hello.policy.maxPayload);
        this.#maxBuffered = Math.min(this.#maxBuffered, hello.policy.maxBufferedBytes);
        this.#connected = true;
        // Deliberately discard snapshot, device tokens and other private handshake fields.
        this.#hello.resolve({ protocol: hello.protocol, version: hello.server.version,
          methods: hello.features.methods, scopes: hello.auth.scopes }); this.#hello = null;
        this.config.token = '';
      }).catch(e => this.#fail(e));
      return;
    }
    if (frame.type === 'res') {
      if (typeof frame.id !== 'string' || typeof frame.ok !== 'boolean') return this.#fail(error('INVALID_GATEWAY_FRAME'));
      const pending = this.#pending.get(frame.id);
      if (!pending) return; // Late or repeated responses never trigger another submission.
      this.#pending.delete(frame.id); clearTimeout(pending.timer);
      if (frame.ok) pending.resolve(frame.payload);
      else pending.reject(error('GATEWAY_RPC_REJECTED', pending.sent)); // Never expose raw Gateway errors.
      return;
    }
    if (frame.type === 'event' && this.#connected && typeof frame.event === 'string') {
      try { this.config.onEvent({ event: frame.event, payload: frame.payload, seq: frame.seq }); }
      catch { this.#fail(error('EVENT_CONSUMER_FAILED')); }
      return;
    }
    this.#fail(error('INVALID_GATEWAY_FRAME'));
  }
  request(method, params = {}, { timeoutMs = this.config.timeoutMs } = {}) {
    if (!this.#connected || this.#closed) return Promise.reject(error('NOT_CONNECTED'));
    if (typeof method !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_.-]{0,127}$/.test(method) || method === 'connect' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) return Promise.reject(error('INVALID_REQUEST'));
    return this.#send(method, params, timeoutMs, false);
  }
  #send(method, params, timeoutMs, handshake) {
    if (this.#pending.size >= this.config.maxPending) return Promise.reject(error('TOO_MANY_PENDING_REQUESTS'));
    const id = randomUUID(); let frame;
    try { frame = JSON.stringify({ type: 'req', id, method, params }); } catch { return Promise.reject(error('INVALID_REQUEST')); }
    if (bytes(frame) > (handshake ? Math.min(this.#maxBytes, 65536) : this.#maxBytes)) return Promise.reject(error('PAYLOAD_TOO_LARGE'));
    if ((this.#socket?.bufferedAmount ?? 0) + bytes(frame) > this.#maxBuffered) return Promise.reject(error('BACKPRESSURE_LIMIT'));
    return new Promise((resolve, reject) => {
      const pending = { resolve, reject, sent: false, timer: setTimeout(() => {
        this.#pending.delete(id); reject(error('RPC_TIMEOUT', pending.sent));
      }, timeoutMs) };
      this.#pending.set(id, pending);
      try { pending.sent = true; this.#socket.send(frame); }
      catch { clearTimeout(pending.timer); this.#pending.delete(id); reject(error('CONNECTION_FAILED', true)); }
    });
  }
  #fail(reason) {
    if (this.#closed) return; this.#closed = true; this.#connected = false;
    this.config.token = '';
    if (this.#hello) { this.#hello.reject(reason); this.#hello = null; }
    for (const item of this.#pending.values()) { clearTimeout(item.timer); item.reject(error(reason.code, item.sent)); }
    this.#pending.clear();
    try { this.#socket?.close(); } catch { /* already closed */ }
  }
  close() { this.#fail(error('CONNECTION_CLOSED')); }
}
