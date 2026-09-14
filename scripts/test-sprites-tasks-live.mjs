#!/usr/bin/env node
// Explicit opt-in, inside an existing Sprite only. No model or application work.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { SpritesTasksClient } from '../.local/codex-service/sprites.mjs';
import { createSpritesTaskTransport } from '../runtime/sprites-task-transport.mjs';

if (process.argv.length !== 3 || process.argv[2] !== '--live-test') {
  throw new Error('Explicit --live-test required inside the authorized Sprite');
}
assert.equal((await lstat('/.sprite/api.sock')).isSocket(), true);
const name = `hehebot-test-${randomUUID()}`;
const report = { status: 'failed', nativeTaskHold: false, nativeTaskRenewal: false,
  nativeTaskRelease: false, modelCalls: 0, productionAdmission: false, requests: [] };
const transport = createSpritesTaskTransport();
const client = new SpritesTasksClient(async request => {
  const result = await transport(request);
  report.requests.push({ method: request.method, status: result.status,
    fields: result.body && typeof result.body === 'object' ? Object.keys(result.body) : [],
    ...(typeof result.body?.expires_at === 'string' ? { expiresInMs: Date.parse(result.body.expires_at) - Date.now() } : {}) });
  return result;
});
let dispatched = false;
try {
  assert.equal(await client.observe(name), null);
  dispatched = true;
  const first = await client.hold({ id: name, expiresAt: Date.now() + 30000 });
  assert.equal(first.name, name); assert.ok(first.expiresAt > Date.now());
  report.nativeTaskHold = true;
  const renewed = await client.hold({ id: name, expiresAt: Date.now() + 60000 });
  assert.equal(renewed.name, name); assert.ok(renewed.expiresAt > first.expiresAt);
  assert.deepEqual(await client.observe(name), renewed);
  report.nativeTaskRenewal = true;
} catch (error) {
  // Never print provider response bodies or credential-bearing diagnostics.
  report.error = error.code ?? 'TASK_CONTRACT_FAILED';
  process.exitCode = 1;
} finally {
  // Delete only the uniquely named task this fixture may have created. This
  // permits idle; it neither releases application holds nor proves VM sleep.
  if (dispatched) {
    try { await client.release(name); report.nativeTaskRelease = true; }
    catch { report.cleanupError = 'TEST_TASK_RELEASE_UNCONFIRMED'; process.exitCode = 1; }
  }
  if (report.nativeTaskHold && report.nativeTaskRenewal && report.nativeTaskRelease) report.status = 'passed';
  console.log(JSON.stringify(report, null, 2));
}
