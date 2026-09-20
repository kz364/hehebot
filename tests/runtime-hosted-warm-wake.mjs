import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { startHostedControlFixture } from './fixtures/hosted-control.mjs';
import { ControlClient } from '../runtime/control-client.mjs';

// Focused negative integration coverage for the real Worker-to-warm-wake path
// that scripts/test-codex-warm-manager.mjs exercises positively: the actual
// PersonalControl alarm runs the production sendHostedWake workerd fetch to the
// pinned synthetic Sprite destination, which the fixture loopback-routes
// (disposable transport routing only, never a live Sprite provider or Access
// edge, and no URL allowlist change). Unit tests already prove sendHostedOwnerWake
// rejects wrong receipts without retry; these cases prove the Durable Object
// alarm path preserves the once-only intent as UNKNOWN with the exact failure
// phase and never re-delivers, including when a listener appears only later.

const ROUTINE_MANAGE_POLICY = 'f0ff3ead-1e31-4f83-bbc2-aa25f069a962';
const persona = '11111111-1111-4111-8111-111111111111';
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const pause = ms => new Promise(ok => setTimeout(ok, ms));
const waitFor = async (probe, timeoutMs) => {
  const end = Date.now() + timeoutMs;
  do { if (await probe()) return true; await pause(250); } while (Date.now() < end);
  return false;
};

async function admit(t, { setLoopback } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'hehe-warm-wake-'));
  const sessionsDirectory = join(directory, 'sessions');
  await mkdir(sessionsDirectory, { mode: 0o700 });
  const epochOneBoot = randomUUID();
  const originalPolicy = { session_id: randomUUID(), persona_id: persona,
    expires_at: new Date(Date.now() - 120000).toISOString(), max_runs: 1, max_task_seconds: 30,
    text_only: { profile_version: 'codex-text-only-v1', profile_sha256: 'ab'.repeat(32) } };
  const ownerBinding = hash({ auth_mode: 'access', installation_id: 'hosted-fixture',
    issuer: 'https://synthetic.cloudflareaccess.com', audience: 'fixture-audience', owner_subject: 'fixture-owner' });
  const warmConfig = { schema_version: 1, kind: 'owner-alpha-warm-generation-v1', installation_id: 'hosted-fixture',
    owner_id: 'fixture-owner', owner_binding_sha256: ownerBinding, policy_revision: 'warm-stage-a-v1', persona_id: persona,
    text_only: originalPolicy.text_only, expires_at: new Date(Date.now() + 120000).toISOString(), max_task_seconds: 30,
    max_admissions: 2, prior_cost_micro_usd: 1000, prior_cost_source: 'synthetic-baseline', total_cap_micro_usd: 10000000,
    reservation_micro_usd: 2000, seed_retirement: { epoch: 1, boot_id: epochOneBoot, session_id: originalPolicy.session_id,
      transition_id: null, observed_at: new Date(Date.now() - 60000).toISOString(), direct_child_stopped: true,
      execution_lock_free: true, session_lock_free: true, source: 'synthetic-warm-seed' } };
  const [managerToken, hostSigningKey, taskSigningKey, runtimeToken, wakeToken] =
    Array.from({ length: 5 }, (unused, index) => `warm-${index}-` + randomBytes(24).toString('hex'));
  const accessClientId = randomBytes(24).toString('hex'), accessClientSecret = randomBytes(32).toString('hex');
  const fixture = await startHostedControlFixture({ directory: join(directory, 'control'), ownerAlpha: originalPolicy,
    runtimeToken, accessClientId, accessClientSecret,
    warm: { generation: warmConfig, token: managerToken, hostSigningKey, taskSigningKey, wakeToken } });
  t.after(async () => { await fixture.close(); await rm(directory, { recursive: true, force: true, maxRetries: 5 }); });
  assert.equal(fixture.ownerBindingSha256, ownerBinding);
  await fixture.retirePredecessor(epochOneBoot);
  const managerClient = new ControlClient({ origin: fixture.origin, token: managerToken, principal: 'warm-manager',
    accessClientId, accessClientSecret, fetchImpl: fixture.fetchImpl });
  const ownerHeaders = { 'Cf-Access-Jwt-Assertion': fixture.ownerJwt };
  const personaPut = await fixture.fetchImpl('/v1/commands', { method: 'POST', headers: { ...ownerHeaders,
    Origin: fixture.origin, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ schema_version: 1, type: 'persona.put', payload: { id: persona, expected_revision: 1,
      name: 'Chief of Staff', instructions: 'Coordinate the owner’s requests. Keep actions within explicit authorization.',
      tool_policy_ids: [ROUTINE_MANAGE_POLICY], archived: false } }) });
  assert.equal(personaPut.status, 202);
  assert.deepEqual(fixture.warmWakeDeliveries, [], 'passive setup delivered a warm wake');
  if (setLoopback) await setLoopback(fixture);
  const first = await fixture.fetchImpl('/v1/commands', { method: 'POST', headers: { ...ownerHeaders,
    Origin: fixture.origin, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ schema_version: 1, type: 'message.send',
      payload: { conversation_id: persona, text: 'Remember the cobalt blue notebook, reference 47.' } }) });
  assert.equal(first.status, 202);
  const receipt = await first.json();
  assert.equal(receipt.status, 'applied');
  const rows = await fixture.warmRows();
  const generation = rows.filter(row => row.key.endsWith('owner_alpha_warm_generation:2'))[0];
  assert.ok(generation, 'first admission did not create the generation row');
  return { fixture, managerClient, sessionsDirectory, generation, ownerHeaders };
}

const outboundPosts = fixture => fixture.outboundRequests.filter(request => request.method === 'POST');

test('unreachable wake delivery preserves the once-only UNKNOWN intent and is never retried', async t => {
  const { fixture, managerClient, sessionsDirectory, generation } = await admit(t);
  const settled = () => waitFor(async () => {
    const intent = await fixture.wakeIntent();
    return !!intent && intent.status === 'unknown' && intent.error_code && outboundPosts(fixture).length === 1;
  }, 30000);
  assert.ok(await settled(), 'the alarm never attempted exactly one real wake delivery');
  const intent = await fixture.wakeIntent();
  // The production alarm ran sendHostedWake; with no loopback listener arranged
  // the workerd fetch surfaced the refused destination as a 500 response, so the
  // exact intent and its failure phase are retained and nothing is replayed.
  assert.deepEqual(intent, { epoch: 2, boot_id: generation.value.boot_id,
    transition_id: generation.value.transition_id, status: 'unknown',
    error_code: 'HOSTED_WAKE_OUTCOME_UNKNOWN', request_phase: 'response', upstream_status: 500 });
  // Later alarms keep firing while the generation stays BOOTING; the write-once
  // intent row forbids every re-delivery attempt.
  await pause(8000);
  assert.equal(outboundPosts(fixture).length, 1, 'the failed wake delivery was retried');
  assert.deepEqual(await fixture.wakeIntent(), intent, 'the UNKNOWN intent was mutated after the failure');
  // A listener arranged only after the failed delivery never receives the wake:
  // diagnostics never authorize replay.
  const late = createServer((request, response) => {
    response.writeHead(500, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'must-not-be-contacted' }));
  });
  t.after(() => new Promise(resolve => late.close(() => resolve())));
  late.listen(0, '127.0.0.1'); await once(late, 'listening');
  fixture.setWarmWakeLoopback(`http://127.0.0.1:${late.address().port}`);
  await pause(8000);
  assert.equal(outboundPosts(fixture).length, 1, 'a late-arranged listener received the wake');
  assert.deepEqual(await fixture.wakeIntent(), intent);
  // The failed delivery settles nothing: the generation stays BOOTING with its
  // launch envelope intact and no session staged.
  const envelope = await managerClient.request('generation', {});
  assert.ok(envelope && envelope.kind === 'owner-alpha-warm-launch-v1', 'failed delivery withdrew the launch envelope');
  assert.equal(envelope.generation.epoch, 2);
  assert.equal(envelope.generation.transition_id, generation.value.transition_id);
  assert.deepEqual(await readdir(sessionsDirectory), [], 'failed delivery staged a session');
});

test('an accepted-but-wrong 202 receipt is rejected and preserved as UNKNOWN without retry', async t => {
  // A loopback listener that answers the exact production wake POST with a
  // well-formed 202 receipt carrying the wrong epoch.
  const wrongReceipt = createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      response.writeHead(202, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ accepted: true, epoch: 3, echo: JSON.parse(body) }));
    });
  });
  t.after(() => new Promise(resolve => wrongReceipt.close(() => resolve())));
  wrongReceipt.listen(0, '127.0.0.1'); await once(wrongReceipt, 'listening');
  const { fixture, managerClient, sessionsDirectory, generation } = await admit(t, {
    setLoopback: async target => target.setWarmWakeLoopback(`http://127.0.0.1:${wrongReceipt.address().port}`),
  });
  const settled = () => waitFor(async () => {
    const intent = await fixture.wakeIntent();
    return !!intent && intent.status === 'unknown' && intent.request_phase === 'receipt';
  }, 30000);
  assert.ok(await settled(), 'the alarm never delivered the wake to the wrong-receipt listener');
  const intent = await fixture.wakeIntent();
  // The 202 status itself was accepted at the transport layer; the receipt body
  // failed the exact-epoch check, so phase is 'receipt' with the upstream status.
  assert.deepEqual(intent, { epoch: 2, boot_id: generation.value.boot_id,
    transition_id: generation.value.transition_id, status: 'unknown',
    error_code: 'HOSTED_WAKE_OUTCOME_UNKNOWN', request_phase: 'receipt', upstream_status: 202 });
  assert.equal(outboundPosts(fixture).length, 1, 'the wrong-receipt wake delivery was retried');
  const delivered = fixture.warmWakeDeliveries[0];
  assert.equal(delivered.method, 'POST');
  assert.equal(delivered.url, 'https://synthetic-warm.sprites.app/wake');
  assert.deepEqual(delivered.body, { epoch: 2, operationId: generation.value.transition_id });
  await pause(8000);
  assert.equal(outboundPosts(fixture).length, 1, 'the wrong-receipt wake delivery was retried later');
  assert.deepEqual(await fixture.wakeIntent(), intent, 'the wrong-receipt intent was mutated later');
  const envelope = await managerClient.request('generation', {});
  assert.ok(envelope && envelope.kind === 'owner-alpha-warm-launch-v1', 'wrong receipt withdrew the launch envelope');
  assert.deepEqual(await readdir(sessionsDirectory), [], 'wrong receipt staged a session');
});
