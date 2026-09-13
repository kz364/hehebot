import test from 'node:test';
import assert from 'node:assert/strict';
import { GatewayTransport } from '../runtime/gateway-transport.mjs';
class Socket extends EventTarget {
  static instance;
  sent = []; bufferedAmount = 0; closed = false;
  constructor() { super(); Socket.instance = this; }
  send(raw) { this.sent.push(JSON.parse(raw)); }
  message(frame) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(frame) })); }
  close() { this.closed = true; this.dispatchEvent(new Event('close')); }
}
function setup(overrides = {}) { return new GatewayTransport({ url: 'ws://127.0.0.1:19887', token: 'synthetic-token', WebSocketImpl: Socket, timeoutMs: 100, ...overrides }); }
const hello = { type: 'hello-ok', protocol: 4, server: { version: '2026.9.3' }, auth: { role: 'operator', scopes: ['operator.read'], deviceToken: 'do-not-return' }, features: { methods: ['health'] }, policy: { maxPayload: 1048576, maxBufferedBytes: 2097152 }, snapshot: { private: true } };
async function connected(t, overrides = {}) {
  const transport = setup(overrides); t.after(() => transport.close());
  const promise = transport.connect(), socket = Socket.instance;
  socket.message({ type: 'event', event: 'connect.challenge', payload: { nonce: 'synthetic', ts: 1 } });
  assert.equal(socket.sent[0].method, 'connect');
  assert.equal(socket.sent[0].params.client.id, 'gateway-client');
  assert.equal(socket.sent[0].params.auth.token, 'synthetic-token');
  socket.message({ type: 'res', id: socket.sent[0].id, ok: true, payload: hello });
  const metadata = await promise;
  assert.equal(metadata.version, '2026.9.3'); assert.equal('snapshot' in metadata, false); assert.equal('deviceToken' in metadata, false);
  return { transport, socket };
}
test('correlates out-of-order RPC responses by request ID', async (t) => {
  const { transport, socket } = await connected(t);
  const first = transport.request('health'), second = transport.request('health');
  socket.message({ type: 'res', id: socket.sent[2].id, ok: true, payload: { value: 2 } });
  socket.message({ type: 'res', id: socket.sent[1].id, ok: true, payload: { value: 1 } });
  assert.deepEqual(await first, { value: 1 }); assert.deepEqual(await second, { value: 2 });
});
test('mutation deadline is unknown outcome and never retries', async (t) => {
  const { transport, socket } = await connected(t);
  await assert.rejects(transport.request('agent', {}, { timeoutMs: 5 }), { code: 'RPC_TIMEOUT', outcomeUnknown: true });
  assert.equal(socket.sent.length, 2);
  socket.message({ type: 'res', id: socket.sent[1].id, ok: true, payload: {} });
  assert.equal(socket.sent.length, 2);
});
test('disconnect rejects all pending requests', async (t) => {
  const { transport, socket } = await connected(t);
  const one = transport.request('health'), two = transport.request('agent');
  const checks = Promise.all([assert.rejects(one, { code: 'CONNECTION_CLOSED', outcomeUnknown: true }), assert.rejects(two, { code: 'CONNECTION_CLOSED', outcomeUnknown: true })]);
  socket.close(); await checks;
  await assert.rejects(transport.request('health'), { code: 'NOT_CONNECTED' });
});
test('enforces outbound bytes, pending bound and backpressure', async (t) => {
  const { transport, socket } = await connected(t, { maxPayloadBytes: 1024, maxPending: 1 });
  await assert.rejects(transport.request('agent', { text: '😀'.repeat(300) }), { code: 'PAYLOAD_TOO_LARGE', outcomeUnknown: false });
  const pending = transport.request('health');
  await assert.rejects(transport.request('health'), { code: 'TOO_MANY_PENDING_REQUESTS' });
  socket.message({ type: 'res', id: socket.sent[1].id, ok: true, payload: {} }); await pending;
  socket.bufferedAmount = 2048;
  await assert.rejects(transport.request('health'), { code: 'BACKPRESSURE_LIMIT' });
});
test('sanitizes Gateway errors without copying error body', async (t) => {
  const { transport, socket } = await connected(t);
  const result = transport.request('health');
  socket.message({ type: 'res', id: socket.sent[1].id, ok: false, error: { message: 'secret-body', details: 'secret-token' } });
  await assert.rejects(result, e => e.code === 'GATEWAY_RPC_REJECTED' && !JSON.stringify(e).includes('secret'));
});
test('malformed challenge and scope downgrade fail closed', async () => {
  const transport = setup(), pending = transport.connect();
  const check = assert.rejects(pending, { code: 'INVALID_GATEWAY_CHALLENGE' });
  Socket.instance.message({ type: 'event', event: 'connect.challenge', payload: { nonce: 'x' } }); await check;
  const other = setup(), next = other.connect(), socket = Socket.instance;
  socket.message({ type: 'event', event: 'connect.challenge', payload: { nonce: 'x', ts: 1 } });
  socket.message({ type: 'res', id: socket.sent[0].id, ok: true, payload: { ...hello, auth: { role: 'operator', scopes: [] } } });
  await assert.rejects(next, { code: 'INCOMPATIBLE_GATEWAY_HELLO' });
});
test('handshake timeout does not send credentials without challenge', async () => {
  const transport = setup({ timeoutMs: 5 });
  await assert.rejects(transport.connect(), { code: 'HANDSHAKE_TIMEOUT' }); assert.equal(Socket.instance.sent.length, 0);
});
test('remote and embedded-credential URLs are rejected', () => {
  for (const url of ['ws://remote.example', 'wss://remote.example', 'ws://user:pass@localhost', 'ws://localhost?token=secret']) assert.throws(() => setup({ url }), { code: 'LOOPBACK_GATEWAY_REQUIRED' });
});
