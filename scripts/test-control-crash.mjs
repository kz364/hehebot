#!/usr/bin/env node
// E15: real workerd SIGKILL + same-directory SQLite reopen. Linux, loopback only.
// No production hooks, runtime databases, accounts, or rate-limit overrides.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';

const count = Number(process.argv[2] ?? 100);
assert.ok(Number.isInteger(count) && count >= 1 && count <= 100, 'Usage: node scripts/test-control-crash.mjs [1..100]');
assert.equal(process.platform, 'linux', 'Process-tree attestation requires Linux ps');
const cwd = fileURLToPath(new URL('..', import.meta.url));
const root = await mkdtemp(join(tmpdir(), 'hehe-control-crash-'));
const started = Date.now(), cases = [];
let current, relay, stage = 'setup', requests = 0, injections = 0, reopens = 0;
const key = label => {
  const hex = createHash('sha256').update(`hehe-e15-v1:${label}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
const processes = () => execFileSync('ps', ['-eo', 'pid=,ppid=,stat=,comm='], { encoding: 'utf8' }).trim().split('\n').map(line => {
  const [pid, ppid, stat, comm] = line.trim().split(/\s+/);
  return { pid: Number(pid), ppid: Number(ppid), stat, comm };
});
function tree(pid) {
  const all = processes(), ids = new Set([pid]);
  for (let n = -1; n !== ids.size;) {
    n = ids.size;
    for (const item of all) if (ids.has(item.ppid)) ids.add(item.pid);
  }
  return all.filter(item => ids.has(item.pid));
}
function signal(pid, name) {
  try { process.kill(pid, name); } catch (error) { if (error.code !== 'ESRCH') throw error; }
}
async function until(predicate, message, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await predicate()) return; await delay(25); }
  throw new Error(message);
}
async function start(directory) {
  const child = spawn(process.execPath, [join(cwd, 'node_modules/wrangler/bin/wrangler.js'), 'dev', '--config', join(root, 'wrangler.json'), '--local', '--ip', '127.0.0.1', '--port', '0', '--inspector-port', '0', '--persist-to', directory], {
    cwd: root,
    // Do not inherit provider/model credentials or Wrangler account caches.
    env: { PATH: process.env.PATH, HOME: root, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: join(root, 'wrangler') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const record = { child, exited: false, output: '', base: null };
  current = record;
  child.once('exit', (code, signal) => { record.exited = true; record.exit = { code, signal }; });
  child.once('error', error => { record.error = error; });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
    appendFileSync(join(root, 'worker.log'), chunk, { mode: 0o600 });
    record.output = (record.output + chunk.toString()).slice(-20000);
  });
  await until(() => {
    if (record.error) throw record.error;
    assert.equal(record.exited, false, 'Wrangler exited before readiness');
    const match = record.output.replace(/\u001b\[[0-9;]*m/g, '').match(/Ready on (http:\/\/127\.0\.0\.1:\d+)/);
    if (match) { record.base = match[1]; return true; }
  }, 'WORKER_READY_TIMEOUT', 45000);
  return record.base;
}
async function stop(crash = false) {
  if (!current) return;
  const record = current;
  // Retain the first tree if a failed cleanup is retried after parent exit.
  const owned = record.owned ??= tree(record.child.pid);
  const workers = owned.filter(item => item.comm === 'workerd' && !item.stat.startsWith('Z'));
  if (crash) {
    assert.ok(workers.length > 0, 'No live workerd to crash');
    // Kill the actual SQLite-hosting runtime, not merely its Wrangler parent.
    for (const worker of workers) signal(worker.pid, 'SIGKILL');
    injections++;
    await delay(100);
  }
  if (!record.exited) record.child.kill('SIGTERM');
  try {
    await until(() => record.exited && !processes().some(item => owned.some(old => old.pid === item.pid) && !item.stat.startsWith('Z')), 'CHILD_CLEANUP_UNCONFIRMED');
  } catch (error) {
    // Cleanup fallback is not counted as an injection or a passing shutdown.
    for (const item of owned.reverse()) signal(item.pid, 'SIGKILL');
    throw error;
  }
  if (record.base) await assert.rejects(fetch(record.base + '/v1/state', { signal: AbortSignal.timeout(1000) }), { name: 'TypeError' });
  current = null;
  return workers.map(item => item.pid);
}
async function request(base, path, options) {
  requests++;
  const response = await fetch(base + path, { ...options, signal: AbortSignal.timeout(10000) });
  return { status: response.status, body: await response.json() };
}
async function get(base, path) {
  const result = await request(base, path); assert.equal(result.status, 200); return result.body;
}
const envelope = payload => JSON.stringify({ schema_version: 1, type: 'message.send', payload });
const headers = (base, id) => ({ 'Content-Type': 'application/json', Origin: base, 'Idempotency-Key': id });
const send = (base, payload, id) => request(base, '/v1/commands', { method: 'POST', headers: headers(base, id), body: envelope(payload) });
function stopped(state) {
  assert.equal(state.summary.execution_enabled, false);
  assert.equal(state.summary.phase, 'STOPPED');
  assert.equal(state.provider.id, 'unconfigured');
}
// A real owner HTTP connection receives no headers or bytes. The relay either
// withholds the final request byte (provably pre-acceptance) or the entire
// committed response. It records the latter only as a test oracle, not delivery.
async function lossRelay(base, payload, id, mode) {
  let upstream, downstream, resolveGate, rejectGate, responseBytes = 0;
  const gate = new Promise((resolve, reject) => { resolveGate = resolve; rejectGate = reject; });
  const server = createServer((incoming, outgoing) => {
    downstream = outgoing;
    incoming.resume();
    const body = envelope(payload);
    upstream = httpRequest(base + '/v1/commands', { method: 'POST', headers: { ...headers(base, id), 'Content-Length': Buffer.byteLength(body) } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        try { resolveGate({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }); }
        catch (error) { rejectGate(error); }
      });
      response.on('error', rejectGate);
    });
    upstream.on('error', error => { if (mode !== 'precommit') rejectGate(error); });
    if (mode === 'precommit') upstream.write(body.slice(0, -1), () => resolveGate(null));
    else upstream.end(body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = httpRequest(`http://127.0.0.1:${server.address().port}/v1/commands`, { method: 'POST' });
  const outcome = new Promise(resolve => {
    client.on('response', response => { responseBytes++; response.on('data', chunk => { responseBytes += chunk.length; }); response.on('end', () => resolve('delivered')); });
    client.on('error', () => resolve('connection-lost'));
  });
  client.end(envelope(payload));
  relay = {
    async close() {
      upstream?.destroy(); downstream?.destroy(); client.destroy();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      assert.equal(await outcome, 'connection-lost');
      assert.equal(responseBytes, 0, 'Owner received response data');
      relay = null;
    },
  };
  let timer;
  try { return await Promise.race([gate, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('RELAY_GATE_TIMEOUT')), 10000); })]); }
  finally { clearTimeout(timer); }
}
function rows(snapshot, table) {
  const entry = snapshot.tables.find(item => item.name === table);
  assert.ok(entry, `Missing application table ${table}`);
  return entry.rows.map(row => Object.fromEntries(entry.columns.map((column, i) => [column, row[i].value])));
}

let result;
try {
  const config = JSON.parse(await readFile(join(cwd, 'wrangler.jsonc'), 'utf8'));
  const local = config.env.local;
  assert.equal(local.vars.AUTH_MODE, 'local');
  assert.equal(local.vars.EXECUTION_ENABLED, 'false');
  assert.equal(local.vars.NATIVE_VERIFIED, 'false');
  assert.equal(local.vars.PROVIDER_CONFIG, '{}');
  await writeFile(join(root, 'wrangler.json'), JSON.stringify({
    ...config, ...local, env: undefined, main: join(cwd, config.main),
    assets: { ...config.assets, directory: join(cwd, config.assets.directory) },
  }));
  for (let i = 0; i < count; i++) {
    const caseStart = Date.now(), mode = i % 2 ? 'committed-response-lost' : 'precommit';
    const directory = join(root, `store-${i}`);
    stage = `${i + 1}/${count}:${mode}:start`;
    let base = await start(directory);
    const initial = await get(base, '/v1/state'); stopped(initial);
    const bot = initial.objects.find(item => item.kind === 'persona').id;
    const siblingPayload = { conversation_id: bot, text: `Sibling ${i}: appointment 93` };
    const sibling = await send(base, siblingPayload, key(`${i}:sibling`));
    assert.equal(sibling.status, 202); assert.equal(sibling.body.status, 'applied');
    const before = await get(base, '/v1/state'); assert.equal(before.runs.length, 1);
    const payload = { conversation_id: bot, text: `Target ${i}: invoice 17` }, id = key(`${i}:target`);
    stage = `${i + 1}/${count}:${mode}:inject`;
    const oracle = await lossRelay(base, payload, id, mode);
    if (oracle) { assert.equal(oracle.status, 202); assert.equal(oracle.body.status, 'applied'); }
    else assert.deepEqual((await get(base, '/v1/state')).runs, before.runs);
    const crashedWorkerPids = await stop(true);
    await relay.close();
    stage = `${i + 1}/${count}:${mode}:reopen`;
    base = await start(directory); reopens++;
    const reopened = await get(base, '/v1/state'); stopped(reopened);
    assert.equal(reopened.runs.length, oracle ? 2 : 1);
    assert.deepEqual(reopened.runs.find(run => run.id === sibling.body.resource_id), before.runs[0]);
    assert.deepEqual(await get(base, `/v1/receipts/${sibling.body.id}`), sibling.body);
    const retry = await send(base, { text: payload.text, conversation_id: bot }, id);
    assert.equal(retry.status, 202); assert.equal(retry.body.status, 'applied');
    if (oracle) assert.deepEqual(retry.body, oracle.body);
    assert.notEqual(retry.body.resource_id, sibling.body.resource_id);
    const duplicate = await send(base, payload, id);
    assert.equal(duplicate.status, 202); assert.deepEqual(duplicate.body, retry.body);
    assert.deepEqual(await get(base, `/v1/receipts/${retry.body.id}`), retry.body);
    const conflict = await send(base, { ...payload, text: `Changed ${i}: invoice 18` }, id);
    assert.equal(conflict.status, 409); assert.equal(conflict.body.error.code, 'IDEMPOTENCY_CONFLICT');
    const siblingRetry = await send(base, siblingPayload, key(`${i}:sibling`));
    assert.equal(siblingRetry.status, 202); assert.deepEqual(siblingRetry.body, sibling.body);
    const final = await get(base, '/v1/state'); stopped(final); assert.equal(final.runs.length, 2);
    assert.deepEqual(final.runs.find(run => run.id === sibling.body.resource_id), before.runs[0]);
    const timeline = await get(base, `/v1/conversations/${bot}/events`);
    assert.deepEqual(timeline.events.filter(event => event.type === 'message.user').map(event => event.payload.text).sort(), [payload.text, siblingPayload.text].sort());
    // Supported application export, not direct inspection of host/runtime DBs.
    const snapshot = await get(base, '/v1/export/control');
    assert.equal(rows(snapshot, 'commands').length, 2);
    for (const table of ['attempts', 'operations', 'effects', 'controller_operations', 'native_task_links']) assert.equal(rows(snapshot, table).length, 0, table);
    const limits = rows(snapshot, 'rate_limits');
    const writes = limits.filter(row => row.subject.endsWith(':write')).reduce((sum, row) => sum + Number(row.count), 0);
    assert.equal(writes, oracle ? 6 : 5); assert.ok(writes < 60);
    const reads = limits.filter(row => row.subject.endsWith(':read')).reduce((sum, row) => sum + Number(row.count), 0);
    assert.ok(reads < 120);
    stage = `${i + 1}/${count}:${mode}:cleanup`;
    await stop();
    const evidence = { case: i + 1, mode, crashedWorkerPids, reopened: true, ownerResponseBytes: 0, acknowledgedSiblingPreserved: true, exactRetry: true, writes, reads, childrenStopped: true, elapsedMs: Date.now() - caseStart };
    cases.push(evidence);
    appendFileSync(join(root, 'cases.jsonl'), JSON.stringify(evidence) + '\n', { mode: 0o600 });
    console.log(JSON.stringify(evidence));
    await rm(directory, { recursive: true, force: true });
  }
  result = { status: 'passed', scope: 'local-workerd-SIGKILL-disk-reopen', requested: count, completed: cases.length, injections, reopens, precommit: cases.filter(item => item.mode === 'precommit').length, committedResponseLost: cases.filter(item => item.mode === 'committed-response-lost').length, elapsedMs: Date.now() - started, requests, executionEnabled: false, runtimeProcessesStarted: 0, durableAttempts: 0, durableProviderOperations: 0, childrenStopped: true };
  await rm(root, { recursive: true, force: true });
} catch (error) {
  appendFileSync(join(root, 'failure.log'), String(error?.stack ?? error), { mode: 0o600 });
  let childrenStopped = false;
  try { await relay?.close(); await stop(); childrenStopped = true; } catch { /* Preserve private failure evidence. */ }
  result = { status: 'failed', stage, completed: cases.length, injections, reopens, requests, elapsedMs: Date.now() - started, childrenStopped, privateEvidence: root };
  process.exitCode = 1;
}
console.log(JSON.stringify(result));
