import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlClient, ControlClientError, RUNTIME_ENDPOINT_TYPES } from '../runtime/control-client.mjs';
const response = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const settings = { origin: 'https://portal.example', token: 'runtime-secret' };

test('fixed origin, runtime bearer and optional Access service headers; payload only', async () => {
  const calls = [];
  const client = new ControlClient({ ...settings, accessClientId: 'access-id', accessClientSecret: 'access-secret', fetchImpl: async (...args) => { calls.push(args); return response({ epoch: 1 }); } });
  assert.deepEqual(await client.request('boot', { boot_id: 'boot-1' }), { epoch: 1 });
  assert.equal(calls[0][0], 'https://portal.example/internal/boot');
  const options = calls[0][1]; assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
  assert.equal(options.headers.Authorization, 'Bearer runtime-secret');
  assert.equal(options.headers['CF-Access-Client-Id'], 'access-id'); assert.equal(options.headers['CF-Access-Client-Secret'], 'access-secret');
  assert.deepEqual(JSON.parse(options.body), { boot_id: 'boot-1' });
  assert.equal(JSON.stringify(client), '{}');
});
test('manager transport has a disjoint fixed endpoint allowlist and no retries', async () => {
  const calls = [];
  const manager = new ControlClient({ ...settings, principal: 'manager', token: 'manager-secret',
    fetchImpl: async (...args) => { calls.push(args); return response(null); } });
  assert.equal(await manager.request('manifest', {}), null);
  assert.equal(calls[0][0], 'https://portal.example/internal/manager/manifest');
  assert.equal(calls[0][1].headers.Authorization, 'Bearer manager-secret');
  for (const type of ['boot', 'claim', '../claim']) await assert.rejects(manager.request(type, {}), { code: 'UNSUPPORTED_RUNTIME_ENDPOINT' });
  const runtime = new ControlClient({ ...settings, fetchImpl: async () => { assert.fail('must reject before dispatch'); } });
  await assert.rejects(runtime.request('manifest', {}), { code: 'UNSUPPORTED_RUNTIME_ENDPOINT' });
  let attempts = 0;
  const uncertain = new ControlClient({ ...settings, principal: 'manager', fetchImpl: async () => {
    attempts++; throw Error('private manager response');
  } });
  await assert.rejects(uncertain.request('retirement', {}), { code: 'CONTROL_TRANSPORT_FAILED', outcomeUnknown: true });
  assert.equal(attempts, 1); assert.equal(calls.length, 1);
});
test('endpoint allowlist matches the TypeScript runtime type keys', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/core/runtime-types.ts', import.meta.url), 'utf8');
  for (const key of RUNTIME_ENDPOINT_TYPES) assert.ok(source.includes(`${key}:`) || source.includes(`'${key}':`));
  const schema = JSON.parse(await readFile(new URL('../SCHEMAS/runtime.json', import.meta.url), 'utf8'));
  assert.deepEqual([...RUNTIME_ENDPOINT_TYPES].sort(), schema.oneOf.map(entry => entry.properties.type.const).sort());
});
test('rejects insecure/configurable path origins and partial Access credentials', () => {
  for (const origin of ['http://portal.example', 'https://user:pass@portal.example', 'https://portal.example/other', 'https://portal.example/?q=1', 'https://portal.example/#x']) assert.throws(() => new ControlClient({ ...settings, origin }), ControlClientError);
  assert.throws(() => new ControlClient({ ...settings, accessClientId: 'only' }), ControlClientError);
  assert.throws(() => new ControlClient({ ...settings, token: 'bad\r\nsecret' }), ControlClientError);
});
test('rejects endpoint injection and oversize payload before fetch', async () => {
  let count = 0; const client = new ControlClient({ ...settings, maxRequestBytes: 10, fetchImpl: async () => { count++; return response({}); } });
  await assert.rejects(client.request('../owner', {}), { code: 'UNSUPPORTED_RUNTIME_ENDPOINT', outcomeUnknown: false });
  await assert.rejects(client.request('complete', { text: 'x'.repeat(20) }), { code: 'REQUEST_TOO_LARGE', outcomeUnknown: false });
  const cyclic = {}; cyclic.self = cyclic;
  await assert.rejects(client.request('complete', cyclic), { code: 'INVALID_PAYLOAD' }); assert.equal(count, 0);
});
test('accepts null empty claim response', async () => {
  assert.equal(await new ControlClient({ ...settings, fetchImpl: async () => response(null) }).request('claim', { identity: {} }), null);
});
test('memory preparation is runtime-only; staged hosts and tasks cannot dispatch it', async () => {
  const payload = { identity: { epoch: 1, boot_id: 'synthetic' }, persona_models: {} };
  const client = new ControlClient({ ...settings, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://portal.example/internal/memory-prepare');
    assert.deepEqual(JSON.parse(options.body), payload); return response(null);
  } });
  assert.equal(await client.request('memory-prepare', payload), null);
  for (const principal of ['manager', 'warm-manager', 'warm-host', 'warm-task', 'background-manager', 'background-host', 'background-task']) {
    const restricted = new ControlClient({ ...settings, principal, fetchImpl: () => assert.fail('denied before network') });
    await assert.rejects(restricted.request('memory-prepare', payload), { code: 'UNSUPPORTED_RUNTIME_ENDPOINT' });
  }
});
test('accepts only bounded arrays for steering polling without widening other response contracts', async () => {
  for (const rows of [[], [{ command_id: 'synthetic' }], [{}, {}, {}, {}]]) {
    const client = new ControlClient({ ...settings, fetchImpl: async () => response(rows) });
    assert.deepEqual(await client.request('steer-pending', {}), rows);
    await assert.rejects(client.request('claim', {}), { code: 'INVALID_CONTROL_RESPONSE' });
  }
  for (const invalid of [null, {}, 'text', [{}, {}, {}, {}, {}]]) {
    await assert.rejects(new ControlClient({ ...settings, fetchImpl: async () => response(invalid) }).request('steer-pending', {}), { code: 'INVALID_CONTROL_RESPONSE' });
  }
});
test('mutation network failures are sanitized unknown outcomes and never retried', async () => {
  let calls = 0;
  const client = new ControlClient({ ...settings, fetchImpl: async () => { calls++; throw new Error('runtime-secret access-secret'); } });
  await assert.rejects(client.request('submitted', {}), error => error.code === 'CONTROL_TRANSPORT_FAILED' && error.outcomeUnknown && !error.message.includes('secret'));
  assert.equal(calls, 1);
});
test('HTTP errors and redirects are not followed and never expose body', async () => {
  for (const status of [302, 401, 503]) {
    const client = new ControlClient({ ...settings, fetchImpl: async () => new Response('runtime-secret', { status, headers: { Location: 'https://elsewhere.example' } }) });
    await assert.rejects(client.request('complete', {}), error => error.outcomeUnknown && !error.message.includes('secret'));
  }
});
test('validates response JSON, MIME, shape, bytes and UTF-8', async () => {
  const fixtures = [new Response('text'), response('primitive'), new Response('{', { headers: { 'Content-Type': 'application/json' } }), response({ text: 'x'.repeat(100) }), new Response(new Uint8Array([255]), { headers: { 'Content-Type': 'application/json' } })];
  for (const value of fixtures) await assert.rejects(new ControlClient({ ...settings, maxResponseBytes: 30, fetchImpl: async () => value }).request('ready', {}), ControlClientError);
});
test('deadline covers fetch implementations which ignore cancellation', async () => {
  const client = new ControlClient({ ...settings, timeoutMs: 10, fetchImpl: () => new Promise(() => {}) });
  await assert.rejects(client.request('heartbeat', {}), { code: 'CONTROL_TIMEOUT', outcomeUnknown: true });
});
test('deadline also bounds slow response streams', async () => {
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); } });
  const client = new ControlClient({ ...settings, timeoutMs: 10, fetchImpl: async () => new Response(stream, { headers: { 'Content-Type': 'application/json' } }) });
  await assert.rejects(client.request('heartbeat', {}), error => error.outcomeUnknown);
});
