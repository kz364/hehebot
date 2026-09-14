import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { CodexTransport } from '../runtime/codex-transport.mjs';

function fixture(options) {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stdin = new PassThrough(); child.stderr = new PassThrough();
  child.kill = () => {};
  const writes = [];
  child.stdin.on('data', chunk => writes.push(JSON.parse(chunk.toString())));
  const transport = new CodexTransport(child, options);
  return { child, writes, transport };
}

test('fragmented UTF8, batched and out-of-order responses retain exact request identity', async () => {
  const { child, transport } = fixture();
  const first = transport.request('one'); const second = transport.request('two');
  const data = Buffer.from('{"id":2,"result":"😀"}\n{"id":1,"result":"first"}\n');
  const split = data.indexOf(Buffer.from('😀')) + 1;
  child.stdout.write(data.subarray(0, split)); child.stdout.write(data.subarray(split));
  assert.equal(await first, 'first'); assert.equal(await second, '😀'); transport.close();
});

test('timeout and late response do not retry a possibly submitted turn', async () => {
  const { child, writes, transport } = fixture({ timeoutMs: 10 });
  await assert.rejects(transport.request('turn/start'), { code: 'CODEX_TIMEOUT', outcome: 'unknown' });
  child.stdout.write('{"id":1,"result":{}}\n');
  assert.equal(writes.length, 1); assert.equal(transport.pending.size, 0); transport.close();
});

test('EOF rejects in-flight requests as unknown and future requests as unsent', async () => {
  const { child, transport } = fixture();
  const pending = transport.request('turn/start'); child.stdout.end();
  await assert.rejects(pending, { code: 'CODEX_DISCONNECTED', outcome: 'unknown' });
  await assert.rejects(transport.request('turn/start'), { outcome: 'not_sent' });
});

test('server-side requests fail closed without granting approvals', () => {
  const { child, writes, transport } = fixture();
  child.stdout.write('{"id":"approval","method":"item/commandExecution/requestApproval","params":{}}\n');
  assert.deepEqual(writes, [{ id: 'approval', error: { code: -32601, message: 'Client capability not enabled' } }]);
  transport.close();
});

test('oversized unterminated frames and malformed JSON close the connection', async () => {
  for (const chunk of ['x'.repeat(101), '{broken}\n']) {
    const { child, transport } = fixture({ maxFrameBytes: 100 });
    const pending = transport.request('one'); child.stdout.write(chunk);
    await assert.rejects(pending); assert.equal(transport.closed, true);
  }
});

test('RPC errors omit upstream diagnostic secrets', async () => {
  const { child, transport } = fixture();
  const pending = transport.request('one');
  child.stdout.write('{"id":1,"error":{"code":-1,"message":"private secret"}}\n');
  await assert.rejects(pending, error => error.message === 'CODEX_RPC_ERROR' && error.rpcCode === -1);
  transport.close();
});

test('null RPC error is malformed, not a successful undefined result', async () => {
  const { child, transport } = fixture();
  const pending = transport.request('one');
  child.stdout.write('{"id":1,"error":null}\n');
  await assert.rejects(pending, { code: 'CODEX_INVALID_FRAME' });
});

test('pending and backpressure bounds reject unsent work without replay', async () => {
  const { child, transport, writes } = fixture({ maxPending: 1 });
  const pending = transport.request('one');
  await assert.rejects(transport.request('two'), { message: 'CODEX_PENDING_LIMIT', outcome: 'not_sent' });
  child.stdout.write('{"id":1,"result":{}}\n'); await pending;
  child.stdin.write = () => false;
  const blocked = transport.request('three');
  await assert.rejects(transport.request('four'), { outcome: 'not_sent' });
  child.stdout.write('{"id":2,"result":{}}\n'); await blocked;
  await assert.rejects(transport.request('five'), { message: 'CODEX_BACKPRESSURE', outcome: 'not_sent' });
  assert.equal(writes.length, 1);
  child.stdin.emit('drain'); assert.equal(transport.backpressured, false); transport.close();
});
