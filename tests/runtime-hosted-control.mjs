import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { startHostedControlFixture } from './fixtures/hosted-control.mjs';

const persona = '11111111-1111-4111-8111-111111111111';
const runtimeToken = 'synthetic-runtime-token';
const clientId = 'synthetic-service-id', clientSecret = 'synthetic-service-secret';
const policy = () => ({ session_id: randomUUID(), persona_id: persona,
  expires_at: new Date(Date.now() + 30 * 60_000).toISOString(), max_runs: 1, max_task_seconds: 45 });

async function withFixture(fn) {
  const directory = await mkdtemp(join(tmpdir(), 'hehe-hosted-control-'));
  const ownerAlpha = policy();
  let fixture;
  try { fixture = await startHostedControlFixture({ directory, ownerAlpha, runtimeToken,
    accessClientId: clientId, accessClientSecret: clientSecret }); await fn(fixture, directory, ownerAlpha); }
  finally { await fixture?.close(); await rm(directory, { recursive: true, force: true }); }
}
const service = { 'Cf-Access-Client-Id': clientId, 'Cf-Access-Client-Secret': clientSecret };
const json = response => response.json();

test('actual signed Access owner state and command use the hosted SQLite Worker', () => withFixture(async fixture => {
  const owner = { 'Cf-Access-Jwt-Assertion': fixture.ownerJwt };
  const state = await fixture.fetchImpl('/v1/state', { headers: owner });
  assert.equal(state.status, 200);
  const command = await fixture.fetchImpl('/v1/commands', { method: 'POST', headers: { ...owner,
    Origin: fixture.origin, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ schema_version: 1, type: 'message.send', payload: { conversation_id: persona, text: 'Hosted request' } }) });
  assert.equal(command.status, 202); assert.equal((await json(command)).status, 'applied');
  assert.equal((await fixture.fetchImpl('/v1/state', { headers: owner })).status, 200);
  assert.deepEqual(fixture.outboundRequests, [{ method: 'GET', url: 'https://synthetic.cloudflareaccess.com/cdn-cgi/access/certs' }]);
}));

test('wrong owner and missing Access token reject', () => withFixture(async fixture => {
  assert.equal((await fixture.fetchImpl('/v1/state')).status, 401);
  assert.equal((await fixture.fetchImpl('/v1/state', { headers: { 'Cf-Access-Jwt-Assertion': fixture.otherOwnerJwt } })).status, 401);
  const parts = fixture.ownerJwt.split('.'); parts[1] = `${parts[1].slice(0, -1)}${parts[1].endsWith('A') ? 'B' : 'A'}`;
  assert.equal((await fixture.fetchImpl('/v1/state', { headers: { 'Cf-Access-Jwt-Assertion': parts.join('.') } })).status, 401);
}));

test('internal routes require both synthetic service gate headers and runtime bearer', () => withFixture(async fixture => {
  const call = headers => fixture.fetchImpl('/internal/status', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{}' });
  assert.equal((await call({ Authorization: `Bearer ${runtimeToken}` })).status, 403);
  assert.equal((await call(service)).status, 401);
  assert.equal((await call({ ...service, Authorization: 'Bearer wrong' })).status, 401);
  const response = await call({ ...service, Authorization: `Bearer ${runtimeToken}` });
  assert.equal(response.status, 200);
  const status = await json(response);
  assert.deepEqual(status, { phase: 'STOPPED', epoch: 0, execution_enabled: false,
    owner_alpha: status.owner_alpha, owner_alpha_hosted: true, owner_binding_sha256: fixture.ownerBindingSha256 });
  assert.equal(status.owner_alpha.max_runs, 1);
}));

test('exact hosted false-production status persists and reopening does not grant a new boot', () => withFixture(async (fixture, directory, ownerAlpha) => {
  const call = (active, type, payload) => active.fetchImpl(`/internal/${type}`, { method: 'POST', headers: { ...service,
    Authorization: `Bearer ${runtimeToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const status = await json(await call(fixture, 'status', {}));
  assert.equal(status.execution_enabled, false); assert.equal(status.owner_alpha_hosted, true);
  assert.deepEqual(status.owner_alpha, ownerAlpha); assert.equal(status.owner_binding_sha256, fixture.ownerBindingSha256);
  const first = await json(await call(fixture, 'boot', { boot_id: randomUUID() }));
  await fixture.close();
  const reopened = await startHostedControlFixture({ directory, ownerAlpha, runtimeToken,
    accessClientId: clientId, accessClientSecret: clientSecret });
  try {
    const after = await json(await call(reopened, 'status', {}));
    assert.equal(after.phase, 'BOOTING'); assert.equal(after.epoch, first.epoch);
    const denied = await call(reopened, 'boot', { boot_id: randomUUID() });
    assert.equal(denied.status, 409); assert.equal((await json(denied)).error.code, 'STALE_EPOCH');
    assert.deepEqual(reopened.outboundRequests, []);
  } finally { await reopened.close(); }
}));
