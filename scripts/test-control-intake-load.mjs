#!/usr/bin/env node
// E15 PARTIAL local intake latency measurement (rate-limit-compatible). This is
// explicitly NOT full SPEC §11 load acceptance: SPEC asks for p95 receipt ≤1s
// at 5 writes/sec for 10min, but the owner write path enforces 60 writes per
// calendar minute per owner (src/worker/control-object.ts rate(owner+':write',60)).
// This harness does not change, bypass, or reinterpret that limit. It measures
// one authorized synthetic owner at 48 writes/min for 10 minutes (smoke mode:
// 1 minute) and reports achieved schedule, drift, p50/p95/p99/max receipt
// latency. Nothing here proves deployed reliability or 5 writes/sec capacity.
//
// Writes are passive room.publish context_update commands: they publish a
// timeline event, enqueue no inference run, and request no provider wake.
// Execution stays disabled (EXECUTION_ENABLED=false), the provider is
// unconfigured, and the harness asserts no runnable inference was created.
//
// Timing semantics: the write schedule is anchored to the monotonic clock; each
// submission's drift is measured immediately BEFORE the request is sent, and
// receipt latency (submission → response body) is measured separately after
// completion. Calendar-minute rate buckets stay on the wall clock.
//
// Schedule acceptance: submissions must not fall more than one schedule
// interval (1250ms) after their scheduled time, and the client-side pacing
// guard must never activate. On any violation the workload aborts without
// catch-up submissions (no unlabelled bursts) and the run fails with all
// failures retained; there are no retries and no favorable-rerun claims.
//
// A separately labelled burst phase runs on a second disposable instance and
// fires 70 unpaced writes to test that the enforced 60/min boundary rejects
// the 61st write in a calendar minute. Burst acceptance is exact: 70 submitted,
// 60 accepted, 10 rejected 429 RATE_LIMITED with the first at index 60, zero
// network/other errors, every 429 carrying the exact RATE_LIMITED code, and
// all requests within one calendar minute (client and server share one host
// clock, so client wall minutes are treated as server-aligned). If the burst
// crosses a minute boundary the result fails as inconclusive rather than
// claiming the boundary passed.
//
// `selfcheck` mode is a cheap fault-injected validation of this harness's
// own acceptance logic (not product measurement): a green mini-compliant
// workload plus red scenarios for a mispaced workload, early rate limiting,
// and a network error during burst. selfcheck passes only when every fault is
// detected as the expected failure kind.
//
// Known local limitation (kept explicit): the first workerd boot in a fresh
// sandbox can add one-time multi-second cold-start stalls. Reported evidence
// is from warm runs; failure evidence directories are never deleted on
// failure.
//
// Real workerd via wrangler dev on loopback only, disposable local SQLite
// state, no credentials, no provider calls, no retries hiding 429s or errors.
// Exit failure on unexpected loss/error/429 in compliant mode, readback
// mismatch, runnable inference, p95 > 1s, or any schedule/burst violation.
//
// Usage: node scripts/test-control-intake-load.mjs smoke|full|selfcheck
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';

const MODES = { smoke: { minutes: 1 }, full: { minutes: 10 }, selfcheck: {} };
const modeName = process.argv[2] ?? '';
assert.equal(process.platform, 'linux', 'Process-tree attestation requires Linux ps');
assert.ok(Object.hasOwn(MODES, modeName) && !!MODES[modeName], 'Usage: node scripts/test-control-intake-load.mjs smoke|full|selfcheck');

const PARTIAL_NOTE = 'PARTIAL rate-limit-compatible local measurement at 48 writes/min; not SPEC 5 writes/sec load acceptance; no deployed-reliability or capacity claim.';
const LIMITATIONS = [
  'Local loopback workerd only; no deployed-reliability, availability, or 5 writes/sec capacity claim.',
  'First workerd boot in a fresh sandbox can add one-time multi-second cold-start stalls; reported latency evidence is from warm runs.',
  'Burst calendar minutes use the client wall clock; client and server share one host, so minutes are treated as server-aligned.',
  'The enforced rate_limits counter is a rolling window pruned to roughly the last two calendar minutes; durable counts are reconciled through the commands table.',
];
const TARGET_WRITES_PER_MINUTE = 48; // compliant schedule, below the enforced 60/min owner write limit
const INTERVAL_MS = 60000 / TARGET_WRITES_PER_MINUTE; // 1250ms
const SCHEDULE_TOLERANCE_MS = INTERVAL_MS; // bounded scheduling tolerance: one interval
const P95_BUDGET_MS = 1000; // E15 receipt target, applied here to the measured passive writes
const WRITE_GUARD = 54; // client-side pacing guard; activation is a failure
const READ_INTERVAL_MS = 600; // receipt readback pacing (~100/min; enforced reads limit is 120/min)
const READ_GUARD = 110;
const BURST_WRITES = 70; // above the 60/min boundary, on separate disposable state
const BURST_EXPECTED_ACCEPTED = 60;
const BURST_EXPECTED_RATE_LIMITED = 10;
const BURST_FIRST_RATE_LIMITED_INDEX = 60;
const EMPTY_TABLES = ['attempts', 'operations', 'effects', 'controller_operations', 'native_task_links', 'runs'];

const cwd = fileURLToPath(new URL('..', import.meta.url));
const root = await mkdtemp(join(tmpdir(), 'hehe-control-intake-'));
const startedAt = Date.now();
const sourceCommit = execFileSync('git', ['-C', cwd, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
let stage = 'setup', current, guardDelays = 0, readGuardDelays = 0;
const minuteWrites = new Map(), minuteReads = new Map(), minuteBurst = new Map();
const bucket = (map, at = Date.now()) => { const m = Math.floor(at / 60000); if (!map.has(m)) map.set(m, { submitted: 0, accepted: 0, rejected: 0, rateLimited: 0, errors: 0 }); return map.get(m); };
const sleepUntilWall = async at => { const wait = at - Date.now(); if (wait > 0) await delay(wait); };
const sleepUntilPerf = async at => { const wait = at - performance.now(); if (wait > 0) await delay(wait); };
const nextMinuteBoundary = () => (Math.floor(Date.now() / 60000) + 1) * 60000;

function processes() {
  return execFileSync('ps', ['-eo', 'pid=,ppid=,stat=,comm='], { encoding: 'utf8' }).trim().split('\n').map(line => {
    const [pid, ppid, stat, comm] = line.trim().split(/\s+/);
    return { pid: Number(pid), ppid: Number(ppid), stat, comm };
  });
}
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
    const match = record.output.replace(/\[[0-9;]*m/g, '').match(/Ready on (http:\/\/127\.0\.0\.1:\d+)/);
    if (match) { record.base = match[1]; return true; }
  }, 'WORKER_READY_TIMEOUT', 45000);
  return record.base;
}
async function stop() {
  if (!current) return;
  const record = current;
  const owned = record.owned ??= tree(record.child.pid);
  if (!record.exited) record.child.kill('SIGTERM');
  try {
    await until(() => record.exited && !processes().some(item => owned.some(old => old.pid === item.pid) && !item.stat.startsWith('Z')), 'CHILD_CLEANUP_UNCONFIRMED');
  } catch (error) {
    for (const item of owned.reverse()) signal(item.pid, 'SIGKILL');
    throw error;
  }
  if (record.base) await assert.rejects(fetch(record.base + '/v1/state', { signal: AbortSignal.timeout(1000) }), { name: 'TypeError' });
  current = null;
}
function killTree() {
  if (!current) return;
  // Retain the pre-kill census: descendants may be reparented before stop()
  // inspects the tree, but cleanup must still attest their absence.
  current.owned ??= tree(current.child.pid);
  for (const item of current.owned) signal(item.pid, 'SIGKILL');
}
async function request(base, path, options) {
  const t0 = performance.now();
  let response;
  try {
    response = await fetch(base + path, { ...options, signal: AbortSignal.timeout(10000) });
  } catch (error) {
    return { status: null, body: null, latencyMs: performance.now() - t0, ttfbMs: null, bodyMs: null, networkOk: false, error: String(error) };
  }
  const ttfbMs = performance.now() - t0;
  let body = null, parseError = null;
  try { body = await response.json(); } catch (error) { parseError = String(error); }
  return { status: response.status, body, latencyMs: performance.now() - t0, ttfbMs, bodyMs: performance.now() - t0 - ttfbMs, networkOk: true, parseError };
}
async function get(base, path) {
  bucket(minuteReads).submitted++;
  const result = await request(base, path);
  if (!result.networkOk || result.status !== 200) throw new Error(`GET ${path} failed: ${result.status ?? result.error}`);
  return result.body;
}
const envelope = (type, payload) => JSON.stringify({ schema_version: 1, type, payload });
const headers = (base, id) => ({ 'Content-Type': 'application/json', Origin: base, 'Idempotency-Key': id });
const send = (base, type, payload, id) => request(base, '/v1/commands', { method: 'POST', headers: headers(base, id), body: envelope(type, payload) });
const key = label => {
  const hex = createHash('sha256').update(`hehe-e15-intake-v2:${label}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
const percentile = (sorted, p) => { if (!sorted.length) return null; const i = Math.ceil(p / 100 * sorted.length) - 1; return sorted[Math.min(Math.max(i, 0), sorted.length - 1)]; };
function stoppedState(state) {
  assert.equal(state.summary.execution_enabled, false, 'execution must stay disabled');
  assert.equal(state.summary.phase, 'STOPPED', 'runtime must stay stopped');
  assert.equal(state.provider.id, 'unconfigured', 'provider must stay unconfigured');
  assert.equal(state.provider.live_verified, false, 'provider must stay live-unverified');
}
function rows(snapshot, table) {
  const entry = snapshot.tables.find(item => item.name === table);
  assert.ok(entry, `Missing application table ${table}`);
  return entry.rows.map(row => Object.fromEntries(entry.columns.map((column, i) => [column, row[i].value])));
}
async function readGuard() {
  while (bucket(minuteReads).submitted >= READ_GUARD) { readGuardDelays++; await sleepUntilWall(nextMinuteBoundary() + 5); }
}
async function writeGuard() {
  while (bucket(minuteWrites).submitted >= WRITE_GUARD) { guardDelays++; await sleepUntilWall(nextMinuteBoundary() + 5); }
}
const log = value => { console.log(JSON.stringify(value)); appendFileSync(join(root, 'run.jsonl'), JSON.stringify(value) + '\n', { mode: 0o600 }); };

// classify one submitted command result against the client's own ledger
function classify(result) {
  if (!result.networkOk) return 'error';
  if (result.status === 429) return 'rateLimited';
  if (result.status === 202 && result.body?.status === 'applied') return 'accepted';
  return 'rejected';
}
async function setupInstance(storeDir, label) {
  const base = await start(join(root, storeDir));
  const initial = await get(base, '/v1/state');
  stoppedState(initial);
  const persona = initial.objects.find(item => item.kind === 'persona');
  assert.ok(persona, 'Seeded persona missing');
  const roomId = key(`${label}:room`);
  await writeGuard();
  bucket(minuteWrites).submitted++;
  const result = await send(base, 'room.put', { id: roomId, expected_revision: 0, name: `E15 intake ${label} room`, member_ids: [persona.id], default_responder_id: persona.id }, key(`${label}:room.put`));
  const kind = classify(result);
  if (kind !== 'accepted') throw new Error(`room setup write failed: ${kind} ${result.status ?? result.error}`);
  bucket(minuteWrites).accepted++;
  return { base, persona, roomId, setup: { phase: 'setup', id: result.body.id, receipt: result.body } };
}
async function runWorkload(base, roomId, persona, opts) {
  const intended = opts.intended;
  const intervalMs = opts.intervalMs ?? INTERVAL_MS;
  const toleranceMs = opts.toleranceMs ?? SCHEDULE_TOLERANCE_MS;
  if (opts.alignStart) await sleepUntilWall(nextMinuteBoundary() + 100);
  const anchorPerf = performance.now();
  const anchorWall = Date.now();
  const records = [], failures = [];
  let heartbeatMaxGapMs = 0;
  const heartbeat = setInterval(() => { const gap = Date.now() - heartbeat.due; if (gap > heartbeatMaxGapMs) heartbeatMaxGapMs = gap; heartbeat.due = Date.now() + 200; }, 200);
  heartbeat.due = Date.now() + 200;
  try {
    for (let i = 0; i < intended; i++) {
      const scheduledPerf = anchorPerf + i * intervalMs;
      await sleepUntilPerf(scheduledPerf);
      if (opts.mispaceAtIndex === i) await delay(toleranceMs + 2000);
      if (!opts.skipGuard && bucket(minuteWrites).submitted >= WRITE_GUARD) {
        guardDelays++;
        failures.push({ kind: 'GUARD_ACTIVATED', index: i, minuteIndex: Math.floor(Date.now() / 60000), guardThreshold: WRITE_GUARD });
        break;
      }
      // submission drift is measured immediately before the request is sent
      const preSubmitPerf = performance.now();
      const driftMs = preSubmitPerf - scheduledPerf;
      if (driftMs > toleranceMs) {
        failures.push({ kind: 'SCHEDULE_DRIFT_EXCEEDED', index: i, driftMs: Math.round(driftMs), toleranceMs });
        break;
      }
      const submittedAtWall = Date.now();
      const b = bucket(minuteWrites, submittedAtWall);
      b.submitted++;
      const result = await send(base, 'room.publish', { room_id: roomId, kind: 'context_update', recipient_ids: [persona.id], text: `E15 partial intake load write ${i + 1}/${intended} (passive context update, no inference)`, references: [], cause_id: key(`${opts.label}:cause:${i}`) }, key(`${opts.label}:write:${i}`));
      const completedAtWall = Date.now();
      const kind = classify(result);
      b[kind === 'accepted' ? 'accepted' : kind === 'rateLimited' ? 'rateLimited' : kind === 'error' ? 'errors' : 'rejected']++;
      records.push({ index: i, scheduledOffsetMs: i * intervalMs, submittedAt: submittedAtWall, completedAt: completedAtWall, driftMs: Math.round(driftMs), latencyMs: Math.round(result.latencyMs * 1000) / 1000, ttfbMs: result.ttfbMs === null ? null : Math.round(result.ttfbMs * 1000) / 1000, bodyMs: result.bodyMs === null ? null : Math.round(result.bodyMs * 1000) / 1000, httpStatus: result.status, kind, code: result.body?.error?.code ?? null, error: result.error ?? null, parseError: result.parseError ?? null, id: result.body?.id ?? null, receipt: result.body });
      appendFileSync(join(root, `${opts.label}-records.jsonl`), JSON.stringify(records.at(-1)) + '\n', { mode: 0o600 });
      if (kind !== 'accepted') {
        failures.push({ kind: kind === 'rateLimited' ? 'RATE_LIMITED' : kind === 'error' ? 'NETWORK_ERROR' : 'REJECTED', index: i, httpStatus: result.status, code: records.at(-1).code, error: result.error ?? null, parseError: result.parseError ?? null, body: result.body });
        break;
      }
      if (opts.progress && ((i + 1) % 24 === 0 || i === intended - 1)) log({ event: 'workload-progress', mode: opts.label, submitted: i + 1, intended, accepted: records.filter(r => r.kind === 'accepted').length, guardDelays });
    }
  } finally { clearInterval(heartbeat); }
  const workloadEndWall = records.length ? records.at(-1).completedAt : Date.now();
  const acceptedRecords = records.filter(r => r.kind === 'accepted');
  const latencies = acceptedRecords.map(r => r.latencyMs).sort((a, b) => a - b);
  const drifts = records.map(r => r.driftMs);
  const perMinuteAccepted = [...minuteWrites.entries()].map(([m, b]) => ({ minuteIndex: m, submitted: b.submitted, accepted: b.accepted, rejected: b.rejected, rateLimited: b.rateLimited, errors: b.errors }));
  if (perMinuteAccepted.some(b => b.accepted > 60)) failures.push({ kind: 'OWNER_WRITE_LIMIT_EXCEEDED_CLIENT_ACCOUNTING', perMinuteAccepted });
  if (records.length !== intended) failures.push({ kind: 'INCOMPLETE_WORKLOAD', submitted: records.length, intended });
  const latency = { count: latencies.length, minMs: latencies[0] ?? null, p50Ms: percentile(latencies, 50), p95Ms: percentile(latencies, 95), p99Ms: percentile(latencies, 99), maxMs: latencies.at(-1) ?? null };
  const durationMs = workloadEndWall - anchorWall;
  const drift = { meanMs: drifts.length ? Math.round(drifts.reduce((a, b) => a + b, 0) / drifts.length) : null, maxMs: drifts.length ? Math.max(...drifts) : null, finalMs: drifts.length ? drifts.at(-1) : null, toleranceMs };
  if (!failures.length && latency.p95Ms !== null && latency.p95Ms > P95_BUDGET_MS) failures.push({ kind: 'P95_OVER_BUDGET', p95Ms: latency.p95Ms, budgetMs: P95_BUDGET_MS });
  return { records, failures, stats: { intended, submitted: records.length, accepted: acceptedRecords.length, rejected: records.filter(r => r.kind === 'rejected').length, errors: records.filter(r => r.kind === 'error').length, rateLimited429: records.filter(r => r.kind === 'rateLimited').length, retries: 0, guardDelays, durationMs, achievedWritesPerMinute: durationMs ? Math.round(acceptedRecords.length / (durationMs / 60000) * 1000) / 1000 : null, drift, latency, heartbeatMaxGapMs, perMinuteAccepted } };
}
async function readbackPhase(base, receipts) {
  let matched = 0;
  const mismatches = [];
  for (const r of receipts) {
    await readGuard();
    await delay(READ_INTERVAL_MS);
    const read = await get(base, `/v1/receipts/${r.id}`);
    try { assert.deepEqual(read, r.receipt); matched++; }
    catch { mismatches.push({ id: r.id, posted: r.receipt, read }); }
  }
  return { checked: receipts.length, matched, mismatched: mismatches.length, mismatches };
}
async function noInferencePhase(base, expectedCommands) {
  const failures = [];
  const finalState = await get(base, '/v1/state');
  if (finalState.summary.execution_enabled !== false) failures.push({ kind: 'EXECUTION_NOT_DISABLED', summary: finalState.summary });
  if (finalState.summary.phase !== 'STOPPED') failures.push({ kind: 'PHASE_NOT_STOPPED', phase: finalState.summary.phase });
  if (finalState.provider.id !== 'unconfigured' || finalState.provider.live_verified !== false) failures.push({ kind: 'PROVIDER_CONFIGURED', provider: finalState.provider });
  if (finalState.runs.length !== 0) failures.push({ kind: 'RUNS_CREATED', runs: finalState.runs.length });
  const snapshot = await get(base, '/v1/export/control');
  const emptyCounts = {};
  for (const table of EMPTY_TABLES) { emptyCounts[table] = rows(snapshot, table).length; if (emptyCounts[table] !== 0) failures.push({ kind: 'INFERENCE_LEAK', table, count: emptyCounts[table] }); }
  const commandRows = rows(snapshot, 'commands');
  if (commandRows.length !== expectedCommands) failures.push({ kind: 'DURABLE_COMMANDS_MISMATCH', observed: commandRows.length, expected: expectedCommands });
  // The enforced write counter is a rolling window pruned to roughly the last two
  // calendar minutes; it must never exceed what this client actually submitted.
  const countedWrites = rows(snapshot, 'rate_limits').filter(row => row.subject.endsWith(':write')).reduce((sum, row) => sum + Number(row.count), 0);
  if (countedWrites > expectedCommands) failures.push({ kind: 'WRITE_COUNTER_EXCEEDS_LEDGER', countedWrites, expectedCommands });
  return { failures, summary: { runs: finalState.runs.length, attempts: emptyCounts.attempts, operations: emptyCounts.operations, effects: emptyCounts.effects, controllerOperations: emptyCounts.controller_operations, nativeTaskLinks: emptyCounts.native_task_links, executionEnabled: finalState.summary.execution_enabled, phase: finalState.summary.phase, provider: finalState.provider.id, durableCommands: commandRows.length, enforcedWriteCounterObserved: countedWrites, expectedCommands } };
}
async function burstPhase(base, persona, roomId, opts = {}) {
  // Align just after a calendar-minute boundary so all 70 writes share one
  // server-aligned rate window; a boundary crossing fails as inconclusive.
  await sleepUntilWall(nextMinuteBoundary() + 100);
  const records = [];
  const minuteIndexes = new Set();
  for (let i = 0; i < BURST_WRITES; i++) {
    if (opts.killAtIndex === i) killTree();
    const submittedAtWall = Date.now();
    minuteIndexes.add(Math.floor(submittedAtWall / 60000));
    const b = bucket(minuteBurst, submittedAtWall);
    b.submitted++;
    const result = await send(base, 'room.publish', { room_id: roomId, kind: 'context_update', recipient_ids: [persona.id], text: `E15 burst boundary write ${i + 1}/${BURST_WRITES}`, references: [], cause_id: key(`burst:cause:${i}`) }, key(`burst:write:${i}`));
    const kind = classify(result);
    b[kind === 'accepted' ? 'accepted' : kind === 'rateLimited' ? 'rateLimited' : kind === 'error' ? 'errors' : 'rejected']++;
    records.push({ index: i, minuteIndex: Math.floor(submittedAtWall / 60000), kind, httpStatus: result.status, code: result.body?.error?.code ?? null, error: result.error ?? null });
    if (kind === 'rateLimited' && !records.some(r => r.kind === 'rateLimited' && r.index !== i)) log({ event: 'burst-rate-limit-observed', writeIndex: i, httpStatus: result.status, code: result.body?.error?.code });
  }
  const failures = [];
  const count = kind => records.filter(r => r.kind === kind).length;
  const first429Index = records.findIndex(r => r.kind === 'rateLimited');
  const minuteList = [...minuteIndexes];
  if (minuteList.length !== 1) failures.push({ kind: 'BURST_SPANS_MINUTE_BOUNDARY', minuteIndexes: minuteList, disposition: 'inconclusive' });
  if (records.length !== BURST_WRITES) failures.push({ kind: 'BURST_SUBMITTED_MISMATCH', submitted: records.length, intended: BURST_WRITES });
  if (count('accepted') !== BURST_EXPECTED_ACCEPTED) failures.push({ kind: 'BURST_ACCEPTED_MISMATCH', accepted: count('accepted'), expected: BURST_EXPECTED_ACCEPTED });
  if (count('rateLimited') !== BURST_EXPECTED_RATE_LIMITED) failures.push({ kind: 'BURST_RATE_LIMITED_MISMATCH', rateLimited429: count('rateLimited'), expected: BURST_EXPECTED_RATE_LIMITED });
  if (first429Index !== BURST_FIRST_RATE_LIMITED_INDEX) failures.push({ kind: 'BURST_FIRST_429_INDEX_MISMATCH', first429Index, expected: BURST_FIRST_RATE_LIMITED_INDEX });
  if (count('error') !== 0) failures.push({ kind: 'BURST_NETWORK_ERROR', networkErrors: count('error') });
  if (count('rejected') !== 0) failures.push({ kind: 'BURST_UNEXPECTED_REJECTIONS', rejectedOther: count('rejected') });
  if (records.some(r => r.kind === 'rateLimited' && r.code !== 'RATE_LIMITED')) failures.push({ kind: 'BURST_429_CODE_MISMATCH' });
  const burst = {
    label: 'SEPARATE burst rejection evidence at the enforced 60 writes/min owner boundary (disposable instance; not part of the compliant latency workload)',
    clockAssumption: 'client wall clock treated as server-aligned (single host)',
    intended: BURST_WRITES,
    submitted: records.length,
    accepted: count('accepted'),
    rateLimited429: count('rateLimited'),
    networkErrors: count('error'),
    rejectedOther: count('rejected'),
    first429Index,
    minuteIndexes: minuteList,
    perMinute: [...minuteBurst.entries()].map(([m, b]) => ({ minuteIndex: m, submitted: b.submitted, accepted: b.accepted, rateLimited: b.rateLimited, errors: b.errors, rejected: b.rejected })),
  };
  return { burst, failures };
}
async function normalFlow(minutes) {
  stage = 'workload:instance';
  const instance = await setupInstance('store-workload', 'workload');
  stage = 'workload:run';
  const wl = await runWorkload(instance.base, instance.roomId, instance.persona, { intended: minutes * TARGET_WRITES_PER_MINUTE, label: 'workload', progress: true });
  // Preserve the original workload failure even if later readback also fails.
  log({ event: 'workload-complete', mode: modeName, ...wl.stats, failures: wl.failures });
  const failures = [...wl.failures];
  const acceptedRecords = wl.records.filter(r => r.kind === 'accepted');
  stage = 'readback';
  const rb = await readbackPhase(instance.base, [instance.setup, ...acceptedRecords.map(r => ({ id: r.id, receipt: r.receipt }))]);
  if (rb.mismatched) failures.push({ kind: 'RECEIPT_READBACK_MISMATCH', count: rb.mismatched, first: rb.mismatches[0] });
  stage = 'no-inference';
  const ni = await noInferencePhase(instance.base, 1 + acceptedRecords.length);
  failures.push(...ni.failures);
  let burst;
  if (failures.length) {
    burst = { skipped: true, reason: 'compliant phase already failed; boundary evidence not claimed from a failed run' };
    await stop();
  } else {
    stage = 'burst';
    await stop();
    stage = 'burst:instance';
    const burstInstance = await setupInstance('store-burst', 'burst');
    const bu = await burstPhase(burstInstance.base, burstInstance.persona, burstInstance.roomId);
    failures.push(...bu.failures);
    burst = bu.burst;
    await stop();
  }
  return { failures, workload: wl.stats, readback: { checked: rb.checked, matched: rb.matched, mismatched: rb.mismatched }, noInference: ni.summary, burst };
}
async function selfcheckFlow() {
  const scenarios = [];
  {
    stage = 'selfcheck:green';
    const instance = await setupInstance('store-green', 'green');
    const wl = await runWorkload(instance.base, instance.roomId, instance.persona, { intended: 4, label: 'green' });
    const accepted = wl.records.filter(r => r.kind === 'accepted');
    const rb = await readbackPhase(instance.base, [instance.setup, ...accepted.map(r => ({ id: r.id, receipt: r.receipt }))]);
    const ni = await noInferencePhase(instance.base, 1 + accepted.length);
    const detected = wl.failures.length === 0 && rb.mismatched === 0 && ni.failures.length === 0 && accepted.length === 4;
    scenarios.push({ name: 'green-compliant-mini-workload', fault: null, detected, workload: wl.stats, readback: { checked: rb.checked, matched: rb.matched, mismatched: rb.mismatched }, noInference: ni.summary, failures: [...wl.failures, ...ni.failures] });
    await stop();
  }
  {
    stage = 'selfcheck:mispace';
    const instance = await setupInstance('store-mispace', 'mispace');
    const wl = await runWorkload(instance.base, instance.roomId, instance.persona, { intended: 8, label: 'mispace', mispaceAtIndex: 4 });
    const detected = wl.failures.some(f => f.kind === 'SCHEDULE_DRIFT_EXCEEDED') && wl.stats.submitted < wl.stats.intended;
    scenarios.push({ name: 'mispaced-workload-detected', fault: 'inject SCHEDULE_TOLERANCE+2000ms hold immediately before submitting write index 4; expected abort without catch-up', detected, workload: wl.stats, failures: wl.failures });
    await stop();
  }
  {
    stage = 'selfcheck:rate-limit';
    const instance = await setupInstance('store-fastpace', 'fastpace');
    const wl = await runWorkload(instance.base, instance.roomId, instance.persona, { intended: 61, label: 'fastpace', intervalMs: 300, skipGuard: true, alignStart: true });
    const detected = wl.failures.some(f => f.kind === 'RATE_LIMITED');
    scenarios.push({ name: 'early-rate-limit-detected', fault: 'fault-injected 300ms pace (200 writes/min target) with the client pacing guard disabled; expect a server 429 before completion', detected, workload: wl.stats, failures: wl.failures });
    await stop();
  }
  {
    stage = 'selfcheck:burst-network-error';
    const instance = await setupInstance('store-burstkill', 'burstkill');
    const bu = await burstPhase(instance.base, instance.persona, instance.roomId, { killAtIndex: 5 });
    const detected = bu.failures.some(f => f.kind === 'BURST_NETWORK_ERROR') && bu.burst.networkErrors > 0;
    scenarios.push({ name: 'burst-network-error-detected', fault: 'SIGKILL the server process tree immediately before submitting burst write index 5; network errors must surface as burst failures', detected, burst: bu.burst, failures: bu.failures });
    await stop();
  }
  return { scenarios, detected: scenarios.every(s => s.detected) };
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

  let flow;
  if (modeName === 'selfcheck') {
    flow = await selfcheckFlow();
    result = { status: flow.detected ? 'passed' : 'failed', scope: 'self-check-fault-injected-validation', partial: true, note: 'Fault-injected validation of harness acceptance logic; not product measurement; no deployed-reliability or capacity claim.', mode: modeName, source: { commit: sourceCommit, harness: 'scripts/test-control-intake-load.mjs' }, scenarios: flow.scenarios, limitations: LIMITATIONS, elapsedMs: Date.now() - startedAt, childrenStopped: true };
  } else {
    flow = await normalFlow(MODES[modeName].minutes);
    result = { status: flow.failures.length ? 'failed' : 'passed', scope: 'partial-rate-limit-compatible-local-intake', partial: true, note: PARTIAL_NOTE, mode: modeName, minutes: MODES[modeName].minutes, source: { commit: sourceCommit, harness: 'scripts/test-control-intake-load.mjs', enforcementUnderTest: 'owner write rate limit 60/calendar-minute (src/worker/control-object.ts accept)' }, workload: flow.workload, readback: flow.readback, noInference: flow.noInference, burst: flow.burst, limitations: LIMITATIONS, elapsedMs: Date.now() - startedAt, childrenStopped: true, ...(flow.failures.length ? { failures: flow.failures } : {}) };
  }
  if (result.status === 'passed') await rm(root, { recursive: true, force: true });
  else { result.privateEvidence = root; process.exitCode = 1; }
} catch (error) {
  appendFileSync(join(root, 'failure.log'), String(error?.stack ?? error), { mode: 0o600 });
  let childrenStopped = false;
  try { await stop(); childrenStopped = true; } catch { /* Preserve private failure evidence. */ }
  result = { status: 'failed', stage, partial: true, note: PARTIAL_NOTE, error: String(error?.message ?? error), childrenStopped, privateEvidence: root };
  process.exitCode = 1;
}
console.log(JSON.stringify(result));
