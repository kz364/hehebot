import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fork } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const fixture = new URL('./fixtures/execution-crash-child.mjs', import.meta.url);
const identity = { epoch: 17, boot_id: 'crash-regression-boot' };
const claim = {
  submission_key: 'run-crash:1',
  run: { id: 'run-crash', current_attempt: 1, persona_id: 'persona-crash', routine_id: null,
    context_json: JSON.stringify({ room_id: 'room-crash', text: 'survive the crash' }) },
};
const attemptId = createHash('sha256').update(JSON.stringify([
  'crash-regression-installation', claim.submission_key,
])).digest('hex');
const nativeRunId = 'native-run-crash-1';

function deadline(promise, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`watchdog: ${label}`)), 5000); }),
  ]).finally(() => clearTimeout(timer));
}

async function harness(t, holdAt) {
  const directory = await mkdtemp(join(tmpdir(), 'hehebot-process-crash-'));
  const calls = { claim: [], native: [], submitted: [] };
  const children = [];
  let reached;
  const boundary = new Promise(resolve => { reached = resolve; });
  const server = createServer(async (request, response) => {
    const type = request.url.slice(1), chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    calls[type].push(payload);
    if (type === holdAt && calls[type].length === 1) { reached({ type, payload }); return; }
    const value = type === 'claim' ? claim : type === 'native'
      ? { nativeRunId, status: 'running' } : {};
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(value));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    for (const process of children) {
      if (process.exitCode !== null || process.signalCode !== null) continue;
      const exited = new Promise(resolve => process.once('exit', resolve));
      process.kill('SIGKILL');
      await deadline(exited, 'fixture cleanup');
    }
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  return { directory, calls, boundary, reached, endpoint, children };
}

function child(h, action, boundary = '-') {
  const process = fork(fixture, [h.directory, h.endpoint, action, boundary], {
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  h.children.push(process);
  return process;
}

function message(process, predicate, label) {
  return deadline(new Promise((resolve, reject) => {
    const onMessage = value => {
      if (value?.type === 'error') { cleanup(); reject(Object.assign(new Error(value.message), value)); }
      else if (predicate(value)) { cleanup(); resolve(value); }
    };
    const onExit = (code, signal) => { cleanup(); reject(new Error(`child exited before ${label}: ${code}/${signal}`)); };
    const cleanup = () => { process.off('message', onMessage); process.off('exit', onExit); };
    process.on('message', onMessage); process.on('exit', onExit);
  }), label);
}

async function killAtBoundary(process, reached, label) {
  await deadline(reached, label);
  const exited = new Promise(resolve => process.once('exit', (code, signal) => resolve({ code, signal })));
  process.kill('SIGKILL');
  assert.deepEqual(await deadline(exited, `${label} exit`), { code: null, signal: 'SIGKILL' });
}

const cases = [
  ['durable claim_unknown before claim transport', 'claim_unknown', null, 'claim_unknown', [0, 0, 0]],
  ['admitted control claim with its response lost', '-', 'claim', 'claim_unknown', [1, 0, 0]],
  ['native submission with its reply lost', '-', 'native', 'submission_unknown', [1, 1, 0]],
  ['persisted native ID with Worker submitted ACK lost', '-', 'submitted', 'submitted_unknown', [1, 1, 1]],
];

for (const [name, journalBoundary, transportBoundary, phase, counts] of cases) {
  test(name, { timeout: 15_000 }, async t => {
    const h = await harness(t, transportBoundary);
    const first = child(h, 'run', journalBoundary);
    const reached = journalBoundary === 'claim_unknown'
      ? message(first, value => value?.type === 'boundary', name)
      : h.boundary;
    await killAtBoundary(first, reached, name);

    const before = structuredClone(h.calls);
    assert.deepEqual(['claim', 'native', 'submitted'].map(key => before[key].length), counts);
    const restored = child(h, 'recover');
    const result = await message(restored, value => value?.type === 'result', `${name} recovery`);
    assert.equal(result.before.phase, phase);
    assert.deepEqual(result.before.identity, identity);
    assert.deepEqual(result.after, phase === 'submitted_unknown'
      ? { ...result.before, phase: 'running' }
      : result.before);

    if (phase === 'claim_unknown') {
      assert.equal(result.before.claim, undefined);
      assert.deepEqual(h.calls, before, 'claimNext must not replay an unknown claim');
    } else if (phase === 'submission_unknown') {
      assert.equal(result.before.claim.run.id, claim.run.id);
      assert.equal(result.before.attemptId, attemptId);
      assert.equal(result.before.nativeRunId, undefined);
      assert.deepEqual(h.calls, before, 'claimNext must not replay claim or native submission');
    } else {
      assert.equal(result.before.claim.run.id, claim.run.id);
      assert.equal(result.before.attemptId, attemptId);
      assert.equal(result.before.nativeRunId, nativeRunId);
      assert.equal(h.calls.claim.length, before.claim.length);
      assert.equal(h.calls.native.length, before.native.length);
      assert.equal(h.calls.submitted.length, before.submitted.length + 1);
      assert.deepEqual(h.calls.submitted.at(-1), h.calls.submitted[0],
        'recovery may retry only the identical Worker registration');
    }
  });
}

test('no-crash control reaches running through one claim, native submission, and registration', { timeout: 15_000 }, async t => {
  const h = await harness(t, null);
  const process = child(h, 'run');
  const result = await message(process, value => value?.type === 'result', 'successful control');
  assert.equal(result.row.phase, 'running');
  assert.equal(result.row.attemptId, attemptId);
  assert.equal(result.row.nativeRunId, nativeRunId);
  assert.deepEqual(Object.fromEntries(Object.entries(h.calls).map(([key, values]) => [key, values.length])),
    { claim: 1, native: 1, submitted: 1 });
});
