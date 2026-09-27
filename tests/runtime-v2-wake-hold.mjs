import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createV2Runtime } from '../runtime/v2-service-entry.mjs';

const token = 'w'.repeat(40);
const config = () => ({ ownerBindingSha256: null, stateRoot: mkdtempSync(join(tmpdir(), 'v2-hold-')), binary: '/bin/true',
  installationId: 'test', personas: {}, wakeTokenFile: '/unused' });
const idleService = order => () => ({ phase: 'stopped', async start() { order.push('start'); }, async stop() {}, async maintain() {}, async sleep() { return { sleeping: true }; } });
async function wake(runtime, epoch) {
  const server = runtime.server();
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/wake`, { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hehe-wake-token': token }, body: JSON.stringify({ epoch, operationId: randomUUID() }) });
    await response.text(); return response.status;
  } finally { await runtime.settled(); server.close(); }
}

test('v2 wake holds Sprite activity before acknowledging, then boots', { timeout: 5000 }, async () => {
  const order = [];
  const runtime = createV2Runtime(config(), { readSecret: () => token, report: () => {}, createService: idleService(order),
    holdWake: async epoch => { order.push(`hold:${epoch}`); } });
  assert.equal(await wake(runtime, 3), 202);
  assert.deepEqual(order, ['hold:3', 'start']);
});

test('v2 wake refuses (503, no boot) when the activity hold fails', { timeout: 5000 }, async () => {
  const order = [];
  const runtime = createV2Runtime(config(), { readSecret: () => token, report: () => {}, createService: idleService(order),
    holdWake: async () => { throw new Error('api.sock unavailable'); } });
  assert.equal(await wake(runtime, 1), 503);
  assert.deepEqual(order, []);
});
