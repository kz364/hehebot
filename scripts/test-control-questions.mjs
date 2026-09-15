#!/usr/bin/env node
// Disposable HTTPS Worker/SQLite custody fixture. Native IDs are synthetic.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent } from 'undici';
import { ControlClient } from '../runtime/control-client.mjs';
const directory = await mkdtemp(join(tmpdir(), 'hehe-question-http-'));
let worker, dispatcher;
const delay = ms => new Promise(ok => setTimeout(ok, ms));
const wait = async (fn, ms = 45000) => {
  const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await delay(50); }
  throw new Error('Fixture timed out');
};
try {
  const reserve = createServer(); await new Promise(ok => reserve.listen(0, '127.0.0.1', ok));
  const port = reserve.address().port; await new Promise(ok => reserve.close(ok));
  const origin = `https://127.0.0.1:${port}`, token = randomBytes(32).toString('hex');
  const cert = join(directory, 'cert.pem'), key = join(directory, 'key.pem');
  await promisify(execFile)('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1',
    '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', key, '-out', cert]);
  worker = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--env', 'local', '--ip', '127.0.0.1',
    '--port', String(port), '--persist-to', join(directory, 'worker'), '--local-protocol', 'https', '--https-key-path', key, '--https-cert-path', cert,
    '--var', 'EXECUTION_ENABLED:true', '--var', 'NATIVE_VERIFIED:true', '--var', `RUNTIME_TOKEN:${token}`,
    '--var', `PROVIDER_CONFIG:${JSON.stringify({ provider: 'fake', ref: { provider: 'fake', id: 'question-fixture' } })}`],
  { env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: join(directory, 'logs') }, stdio: ['ignore', 'pipe', 'pipe'] });
  let ready = false; worker.stdout.on('data', chunk => { if (chunk.toString().includes(`Ready on ${origin}`)) ready = true; }); worker.stderr.resume();
  await wait(() => { assert.equal(worker.exitCode, null); return ready; });
  dispatcher = new Agent({ connect: { ca: await readFile(cert) } });
  const trustedFetch = (url, init) => fetch(url, { ...init, dispatcher });
  const control = new ControlClient({ origin, token, fetchImpl: trustedFetch });
  const getState = async () => { const response = await trustedFetch(origin + '/v1/state'); assert.equal(response.status, 200); return response.json(); };
  const owner = async (type, payload, idempotency = randomUUID(), requestOrigin = origin) => {
    const response = await trustedFetch(origin + '/v1/commands', { method: 'POST', headers: {
      'Content-Type': 'application/json', 'Idempotency-Key': idempotency, Origin: requestOrigin,
    }, body: JSON.stringify({ schema_version: 1, type, payload }) });
    return { status: response.status, body: await response.json() };
  };
  const persona = (await getState()).objects.find(object => object.kind === 'persona');
  const queued = await owner('message.send', { conversation_id: persona.id, text: 'Synthetic question custody only.' });
  assert.equal(queued.body.status, 'applied');
  await wait(async () => (await control.request('status', {})).phase === 'BOOTING');
  const identity = await control.request('boot', { boot_id: randomUUID() }); await control.request('ready', { identity });
  const claim = await control.request('claim', { identity }), run_id = queued.body.resource_id;
  assert.equal(claim.run.id, run_id); await control.request('submitted', { identity, run_id, attempt: 1, native_ref: 'synthetic-turn-19' });
  const question = { id: randomUUID(), connection_id: randomUUID(), request_id: 0, params: {
    threadId: 'synthetic-root-43', turnId: 'synthetic-turn-19', itemId: 'synthetic-call-7', isBlocking: true,
    questions: [{ id: '__proto__', header: 'Region', question: 'Which region?', options: [{ label: 'West', description: 'Western region' }] },
      { id: 'timing', header: 'Timing', question: 'When?' }],
  } };
  assert.deepEqual(await control.request('question-record', { identity, run_id, attempt: 1, question }), { id: question.id });
  const custody = { identity, question_id: question.id, connection_id: question.connection_id };
  assert.deepEqual(await control.request('question-take', custody), { state: 'pending', answer: null });
  let state = await getState(); assert.equal(state.questions[0].answerable, true);
  const closePayload = { question_id: question.id, expected_revision: 1, confirm_stopped_closure: true };
  assert.equal((await owner('question.close', closePayload, randomUUID(), 'https://untrusted.invalid')).status, 403);
  const prematureClose = await owner('question.close', closePayload);
  assert.equal(prematureClose.body.status, 'rejected'); assert.equal(prematureClose.body.error.code, 'CANCEL_UNCONFIRMED');
  assert.equal((await getState()).questions[0].state, 'pending');
  const cursor = state.next_cursor, payload = { question_id: question.id, expected_revision: 1,
    answers: Object.fromEntries([['__proto__', { answers: ['West'] }], ['timing', { answers: [] }]]) };
  const commandKey = randomUUID();
  assert.equal((await owner('question.answer', payload, randomUUID(), 'https://untrusted.invalid')).status, 403);
  const accepted = await owner('question.answer', payload, commandKey); assert.equal(accepted.status, 202); assert.equal(accepted.body.status, 'applied');
  assert.deepEqual((await owner('question.answer', payload, commandKey)).body, accepted.body);
  assert.equal((await owner('question.answer', { ...payload, expected_revision: 2 }, commandKey)).status, 409);
  assert.equal((await owner('question.answer', payload)).body.status, 'rejected');
  state = await getState(); assert.equal(state.next_cursor, cursor); assert.equal(state.questions[0].state, 'answered');
  assert.deepEqual(await control.request('question-take', custody), { state: 'response_unknown', answer: { answers: payload.answers } });
  assert.deepEqual(await control.request('question-take', custody), { state: 'response_unknown', answer: null });
  await assert.rejects(control.request('question-take', { ...custody, connection_id: randomUUID() }));
  await assert.rejects(control.request('complete', { identity, run_id, attempt: 1, result: { status: 'completed', text: 'Premature' } }));
  assert.equal((await getState()).runs.find(run => run.id === run_id).status, 'running');
  assert.deepEqual(await control.request('question-resolve', custody), { ok: true });
  assert.deepEqual(await control.request('question-take', custody), { state: 'resolved', answer: null });
  state = await getState(); assert.equal(state.questions.length, 0); assert.equal(state.next_cursor, cursor);
  assert.equal(state.runs.find(run => run.id === run_id).status, 'running');
  await control.request('complete', { identity, run_id, attempt: 1, result: { status: 'completed', text: 'Separate synthetic result receipt.' } });
  assert.equal((await getState()).runs.find(run => run.id === run_id).status, 'completed');
  console.log('PASS: real HTTPS Worker/SQLite question record, owner-only exact answer, CSRF, receipt replay/conflict, typed IDs, null vs unknown handoff, connection fence, completion block, resolution without task settlement. Disposable FakeProvider; no native/account calls or production changes.');
} finally {
  await dispatcher?.close();
  if (worker && worker.exitCode === null && worker.signalCode === null) {
    worker.kill('SIGTERM');
    try { await wait(() => worker.exitCode !== null || worker.signalCode !== null, 5000); }
    catch { worker.kill('SIGKILL'); await wait(() => worker.exitCode !== null || worker.signalCode !== null, 5000); }
  }
  await rm(directory, { recursive: true, force: true });
}
