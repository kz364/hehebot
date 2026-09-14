#!/usr/bin/env node
// Real local HTTP and disk-backed Durable Object restart acceptance. Execution
// stays disabled. No native Gateway, model, provider, or connector is invoked.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'claw-control-restart-'));
let current, requests = 0, restarts = 0, stage = 'start';
async function start() {
  const child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--env', 'local', '--ip', '127.0.0.1', '--port', '0', '--persist-to', directory], {
    cwd, env: { ...process.env, WRANGLER_LOG_PATH: join(directory, 'wrangler'), WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  current = { child, exited: false, exit: new Promise(resolve => child.once('exit', (code, signal) => { current.exited = true; resolve({ code, signal }); })) };
  child.on('error', () => { if (!child.pid) current.exited = true; });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
    appendFileSync(join(directory, 'worker.log'), chunk, { mode: 0o600 });
    output = (output + chunk.toString()).slice(-20000);
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('WORKER_READY_TIMEOUT')); }, 45000);
    const interval = setInterval(() => {
      const match = output.replace(/\u001b\[[0-9;]*m/g, '').match(/Ready on (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) { cleanup(); current.base = match[1]; resolve(match[1]); }
      else if (current.exited) { cleanup(); reject(new Error('WORKER_EXITED')); }
    }, 50);
    function cleanup() { clearTimeout(timer); clearInterval(interval); }
    child.once('error', () => { cleanup(); reject(new Error('WORKER_LAUNCH_FAILED')); });
  });
}
async function stop() {
  if (!current) return;
  if (!current.exited) {
    current.child.kill('SIGTERM');
    let timer;
    try {
      await Promise.race([current.exit, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('WORKER_STOP_UNCONFIRMED')), 10000); })]);
    } finally { clearTimeout(timer); }
  }
  // Wrangler exiting alone is insufficient if an orphan workerd still serves.
  if (current.base) await assert.rejects(fetch(current.base + '/v1/state', { signal: AbortSignal.timeout(1000) }), { name: 'TypeError' });
}
async function request(base, path, options) {
  requests++;
  const response = await fetch(base + path, { ...options, signal: AbortSignal.timeout(5000) });
  return { status: response.status, body: await response.json() };
}
async function get(base, path) {
  const response = await request(base, path); assert.equal(response.status, 200); return response.body;
}
function send(base, payload, key, type = 'message.send') {
  return request(base, '/v1/commands', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, 'Idempotency-Key': key }, body: JSON.stringify({ schema_version: 1, type, payload }) });
}
let result;
try {
  let base = await start();
  const initial = await get(base, '/v1/state');
  assert.equal(initial.summary.execution_enabled, false); assert.equal(initial.summary.phase, 'STOPPED');
  const bot = initial.objects.find(x => x.kind === 'persona').id;
  const payload = { conversation_id: bot, text: 'Synthetic durable invoice 17' }, key = crypto.randomUUID();
  stage = 'concurrent-ingress';
  const duplicates = await Promise.all(Array.from({ length: 4 }, () => send(base, payload, key)));
  const receipt = duplicates[0].body;
  assert.equal(receipt.status, 'applied');
  for (const duplicate of duplicates) { assert.equal(duplicate.status, 202); assert.deepEqual(duplicate.body, receipt); }
  const sibling = await send(base, { conversation_id: bot, text: 'Independent synthetic appointment 93' }, crypto.randomUUID());
  assert.equal(sibling.status, 202); assert.notEqual(sibling.body.resource_id, receipt.resource_id);
  const before = await get(base, '/v1/state'); assert.equal(before.runs.length, 2);
  stage = 'first-restart'; await stop(); base = await start(); restarts++;
  assert.deepEqual(await get(base, `/v1/receipts/${receipt.id}`), receipt);
  // Canonical body hashing must ignore JSON property order across restart.
  const retry = await send(base, { text: payload.text, conversation_id: bot }, key);
  assert.equal(retry.status, 202); assert.deepEqual(retry.body, receipt);
  const conflict = await send(base, { ...payload, text: 'Changed invoice 18' }, key);
  assert.equal(conflict.status, 409); assert.equal(conflict.body.error.code, 'IDEMPOTENCY_CONFLICT');
  const after = await get(base, '/v1/state'); assert.deepEqual(after.runs, before.runs);
  assert.equal(after.summary.execution_enabled, false); assert.equal(after.summary.phase, 'STOPPED');
  const timeline = await get(base, `/v1/conversations/${bot}/events`);
  assert.deepEqual(timeline.events.filter(x => x.type === 'message.user').map(x => x.payload.text).sort(), [payload.text, 'Independent synthetic appointment 93'].sort());
  const gate = await request(base, '/internal/boot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ boot_id: crypto.randomUUID() }) });
  assert.ok([401, 503].includes(gate.status));
  const cancelKey = crypto.randomUUID(), cancel = { run_id: receipt.resource_id, reason: 'Only invoice 17' };
  const cancelled = await send(base, cancel, cancelKey, 'run.cancel'); assert.equal(cancelled.status, 202); assert.equal(cancelled.body.status, 'applied');
  stage = 'second-restart'; await stop(); base = await start(); restarts++;
  assert.deepEqual(await get(base, `/v1/receipts/${cancelled.body.id}`), cancelled.body);
  const cancelRetry = await send(base, cancel, cancelKey, 'run.cancel'); assert.equal(cancelRetry.status, 202); assert.deepEqual(cancelRetry.body, cancelled.body);
  const final = await get(base, '/v1/state'); assert.equal(final.runs.length, 2);
  assert.equal(final.runs.find(x => x.id === receipt.resource_id).status, 'cancelled');
  assert.deepEqual(final.runs.find(x => x.id === sibling.body.resource_id), before.runs.find(x => x.id === sibling.body.resource_id));
  assert.equal(final.summary.execution_enabled, false); assert.equal(final.summary.phase, 'STOPPED');
  assert.deepEqual(await get(base, `/v1/receipts/${receipt.id}`), receipt);
  stage = 'shutdown'; await stop();
  result = { status: 'passed', scope: 'real-local-Worker-SQLite-HTTP', requests, restarts, executionEnabled: false, workersStopped: true };
  await rm(directory, { recursive: true, force: true });
} catch (error) {
  appendFileSync(join(directory, 'failure.log'), String(error?.stack ?? error), { mode: 0o600 });
  try { await stop(); } catch { /* Preserve evidence/state if shutdown is uncertain. */ }
  result = { status: 'failed', stage, requests, restarts, reason: 'LOCAL_RESTART_CHECK_FAILED', privateEvidence: directory };
  process.exitCode = 1;
}
console.log(JSON.stringify(result));
