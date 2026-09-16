import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:https';
import { request } from 'node:http';
import { mkdtemp, readFile, writeFile, rm, chmod, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { startOwnerAlphaGateway } from '../runtime/owner-alpha-gateway.mjs';

const persona = '11111111-1111-4111-8111-111111111111';
const run = '22222222-2222-4222-8222-222222222222';
const other = '33333333-3333-4333-8333-333333333333';
const publicOrigin = 'https://owner.example.test';
async function fixture(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'hehe-gateway-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const name of ['ca', 'wrong']) execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', join(dir, `${name}.key`), '-out', join(dir, `${name}.pem`), '-days', '1', '-subj', '/CN=Fixture',
    '-addext', 'subjectAltName=IP:127.0.0.1', '-addext', 'basicConstraints=critical,CA:TRUE'], { stdio: 'ignore' });
  const token = randomBytes(32).toString('base64url'), runtimeToken = randomBytes(32).toString('base64url');
  await writeFile(join(dir, 'owner'), token, { mode: 0o600 });
  await writeFile(join(dir, 'runtime'), runtimeToken, { mode: 0o600 });
  const calls = []; let stateStatus = 200, beforeResponse;
  const upstream = createServer({ key: await readFile(join(dir, 'ca.key')), cert: await readFile(join(dir, 'ca.pem')) }, async (req, res) => {
    let data = ''; for await (const chunk of req) data += chunk;
    calls.push({ path: req.url, method: req.method, headers: req.headers, data });
    if (beforeResponse && await beforeResponse(req, res)) return;
    res.writeHead(req.url === '/v1/state' ? stateStatus : 200, { 'Content-Type': 'application/json', 'Set-Cookie': 'upstream=secret', Location: 'https://evil.test', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(req.url === '/v1/state' ? { runs: [{ id: run, persona_id: persona }, { id: other, persona_id: other }] } : { ok: true }));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { upstream.closeAllConnections(); upstream.close(resolve); }));
  let clock = Date.now();
  const config = { publicOrigin, upstreamOrigin: `https://127.0.0.1:${upstream.address().port}`,
    upstreamCaFile: join(dir, 'ca.pem'), ownerTokenFile: join(dir, 'owner'), runtimeTokenFile: join(dir, 'runtime'),
    ownerAlpha: { session_id: other, persona_id: persona, expires_at: new Date(clock + 60000).toISOString(), max_runs: 2, max_task_seconds: 30 },
    accessExpiresAt: new Date(clock + 120000).toISOString(), port: 0 };
  const gateway = await startOwnerAlphaGateway(config, { now: () => clock, ...options });
  t.after(gateway.stop);
  const call = (path, method = 'GET', headers = {}, data = '') => new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: gateway.address.port, path, method,
      headers: { Host: 'proxy-rewritten.invalid', ...headers } }, res => {
      let text = ''; res.on('data', chunk => text += chunk); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject);
    if (typeof data === 'function') data(req); else req.end(data);
  });
  const login = (value = token, headers = {}) => call('/login', 'POST', { Origin: publicOrigin,
    'Content-Type': 'application/x-www-form-urlencoded', ...headers }, `token=${value}`);
  const auth = async () => (await login()).headers['set-cookie'][0].split(';')[0];
  const command = (cookie, type, payload, headers = {}) => call('/v1/commands', 'POST', { Cookie: cookie,
    Origin: publicOrigin, 'Content-Type': 'application/json', 'Idempotency-Key': other, ...headers }, JSON.stringify({ schema_version: 1, type, payload }));
  return { dir, config, token, runtimeToken, calls, call, login, auth, command, gateway,
    beforeResponse: callback => beforeResponse = callback,
    advance: ms => clock += ms, stateStatus: value => stateStatus = value };
}

test('login, cookies, exact public Origin and runtime credential separation', async t => {
  const f = await fixture(t);
  assert.equal((await f.call('/')).status, 303);
  const page = await f.call('/login'); assert.equal(page.status, 200);
  assert.match(page.text, /type="password"/); assert.match(page.text, /method="post"/);
  assert.equal(page.headers['cache-control'], 'no-store'); assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal((await f.call('/v1/state', 'GET', { Authorization: `Bearer ${f.runtimeToken}` })).status, 401);
  assert.equal((await f.login(f.runtimeToken)).status, 401);
  for (const Origin of ['', 'null', 'https://evil.test', `${publicOrigin}/`]) assert.equal((await f.login(f.token, { Origin, 'X-Forwarded-Host': 'owner.example.test' })).status, 403);
  assert.equal((await f.login(f.token, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await f.login('x'.repeat(600))).status, 413);
  assert.equal((await f.login(`${f.token}&token=${f.token}`)).status, 401);
  const signed = await f.login(); assert.equal(signed.status, 303);
  const cookie = signed.headers['set-cookie'][0];
  assert.match(cookie, /^__Host-hehebot_owner_alpha=/); assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/);
  assert.ok(!cookie.includes(f.token)); assert.ok(!cookie.includes('Domain='));
  assert.equal(f.calls.length, 0);
});

test('exact routes and headers; canonical selected-persona writes and fail-closed cancellation', async t => {
  const f = await fixture(t), cookie = await f.auth();
  assert.equal(JSON.parse((await f.call('/v1/state', 'GET', { Cookie: cookie })).text).runs[1].persona_id, other);
  for (const path of ['/', '/index.html', '/app.js', '/style.css', '/import-setup.js', '/v1/state?after=1&limit=2',
    `/v1/conversations/${persona}/events?before=2`, `/v1/conversations/${persona}/tasks`, `/v1/conversations/${persona}/recovery`, `/v1/receipts/${run}`]) {
    const result = await f.call(path, 'GET', { Cookie: cookie, Authorization: `Bearer ${f.runtimeToken}`, 'X-Forwarded-Host': 'evil.test', 'Cf-Access-Jwt-Assertion': f.token });
    assert.equal(result.status, 200, path); assert.equal(result.headers['set-cookie'], undefined);
    assert.equal(result.headers.location, undefined); assert.equal(result.headers['access-control-allow-origin'], undefined);
    const forwarded = f.calls.at(-1).headers;
    for (const key of ['cookie', 'authorization', 'x-forwarded-host', 'cf-access-jwt-assertion']) assert.equal(forwarded[key], undefined);
    assert.equal(forwarded.host, new URL(f.config.upstreamOrigin).host);
  }
  const before = f.calls.length;
  for (const path of ['/internal/status', '/v1/triggers/' + run, '/v1/export/control', '/v1/schedules/preview', '/missing.js', '//evil.test/', '/%69nternal/status', '/a/../v1/state', `/v1/conversations/${other}/events`, '/v1/state?url=https://evil.test', '/app.js?token=secret', '/v1/state?limit=1&limit=2'])
    assert.ok((await f.call(path, 'GET', { Cookie: cookie })).status >= 400, path);
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD']) assert.ok((await f.call('/v1/state', method, { Cookie: cookie, Origin: publicOrigin })).status >= 400);
  assert.equal(f.calls.length, before);
  assert.equal((await f.command(cookie, 'message.send', { conversation_id: persona, text: 'Synthetic hello' })).status, 200);
  assert.equal(f.calls.at(-1).headers.origin, f.config.upstreamOrigin);
  assert.equal(f.calls.at(-1).headers['idempotency-key'], other);
  assert.equal((await f.command(cookie, 'message.send', { conversation_id: other, text: 'No' })).status, 403);
  assert.equal((await f.command(cookie, 'message.send', { conversation_id: persona, text: 'No', permission: true })).status, 403);
  assert.equal((await f.command(cookie, 'run.retry', { run_id: run })).status, 403);
  assert.equal((await f.command(cookie, 'message.send', { conversation_id: persona, text: 'No' }, { Origin: f.config.upstreamOrigin })).status, 403);
  assert.equal((await f.command(cookie, 'run.cancel', { run_id: other, reason: 'No' })).status, 403);
  assert.equal((await f.command(cookie, 'run.cancel', { run_id: run, reason: 'Synthetic cancel' })).status, 200);
  assert.deepEqual(f.calls.slice(-2).map(x => x.path), ['/v1/state', '/v1/commands']);
  f.stateStatus(500); const count = f.calls.filter(x => x.method === 'POST').length;
  assert.equal((await f.command(cookie, 'run.cancel', { run_id: run, reason: 'No' })).status, 502);
  assert.equal(f.calls.filter(x => x.method === 'POST').length, count);
  f.stateStatus(302);
  const redirectsBefore = f.calls.length;
  assert.equal((await f.call('/v1/state', 'GET', { Cookie: cookie })).status, 502);
  assert.equal(f.calls.length, redirectsBefore + 1);
});

test('absolute readback expiry, no refresh extension, logout and token rotation revoke', async t => {
  const f = await fixture(t), cookie = await f.auth();
  f.advance(60000);
  assert.equal((await f.command(cookie, 'message.send', { conversation_id: persona, text: 'Expired inference' })).status, 403);
  assert.equal((await f.call('/v1/state', 'GET', { Cookie: cookie })).status, 200);
  assert.equal((await f.command(cookie, 'run.cancel', { run_id: run, reason: 'Cancel during readback' })).status, 200);
  const refreshed = await f.login(); assert.match(refreshed.headers['set-cookie'][0], new RegExp(new Date(f.config.accessExpiresAt).toUTCString()));
  f.advance(59999); assert.equal((await f.call('/v1/state', 'GET', { Cookie: cookie })).status, 200);
  f.advance(1); assert.equal((await f.call('/v1/state', 'GET', { Cookie: cookie })).status, 401);
  assert.match((await f.call('/login')).text, /Owner access closed/);
  assert.equal((await f.login()).status, 401);
  const logout = await f.call('/logout', 'POST', { Cookie: cookie, Origin: publicOrigin });
  assert.equal(logout.status, 303); assert.match(logout.headers['set-cookie'][0], /Max-Age=0/);
  const g = await fixture(t), active = await g.auth();
  assert.equal((await g.call('/logout', 'POST', { Cookie: active, Origin: publicOrigin })).status, 303);
  assert.equal((await g.call('/v1/state', 'GET', { Cookie: active })).status, 401);
  const next = await g.auth(); await writeFile(g.config.ownerTokenFile, randomBytes(32).toString('base64url'));
  assert.equal((await g.call('/v1/state', 'GET', { Cookie: next })).status, 401);
  await writeFile(g.config.ownerTokenFile, g.token);
  assert.equal((await g.login()).status, 401);
});

test('observed runtime exit during message input closes admission but preserves readback and cancellation', { timeout: 5000 }, async t => {
  const child = spawn(process.execPath, ['-e', 'process.stdin.resume();process.stdin.on("end",()=>process.exit(0))'], { stdio: ['pipe', 'ignore', 'ignore'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); });
  await once(child, 'spawn');
  const f = await fixture(t, { admissionOpen: () => child.exitCode === null && child.signalCode === null });
  const cookie = await f.auth();
  assert.equal((await f.command(cookie, 'message.send', { conversation_id: persona, text: 'Before stop' })).status, 200);
  const reading = new Promise(resolve => f.gateway.server.once('request', req => {
    const interval = setInterval(() => {
      if (req.listenerCount('readable')) { clearInterval(interval); resolve(); }
    }, 5);
    t.after(() => clearInterval(interval));
  }));
  const data = JSON.stringify({ schema_version: 1, type: 'message.send', payload: { conversation_id: persona, text: 'Runtime stops during input' } });
  let pending;
  const response = f.call('/v1/commands', 'POST', { Cookie: cookie, Origin: publicOrigin,
    'Content-Type': 'application/json', 'Idempotency-Key': other }, req => { pending = req; req.write(data.slice(0, 5)); });
  await reading;
  const exited = once(child, 'exit'); child.stdin.end(); await exited;
  assert.equal(child.exitCode, 0);
  pending.end(data.slice(5));
  assert.equal((await response).status, 403);
  const nextCookie = await f.auth();
  assert.equal((await f.command(nextCookie, 'message.send', { conversation_id: persona, text: 'New login cannot reopen admission' })).status, 403);
  assert.equal(f.calls.length, 1, 'Neither stopped-runtime message was forwarded');
  assert.equal((await f.call('/v1/state', 'GET', { Cookie: cookie })).status, 200);
  assert.equal((await f.command(cookie, 'run.cancel', { run_id: run, reason: 'Retain cancellation' })).status, 200);
  assert.deepEqual(f.calls.filter(call => call.method === 'POST').map(call => JSON.parse(call.data).type), ['message.send', 'run.cancel']);
});

test('unsupported config, private-file constraints and mandatory CA verification', async t => {
  const f = await fixture(t);
  for (const patch of [{ extra: true }, { upstreamOrigin: 'http://127.0.0.1:443' }, { upstreamOrigin: 'https://localhost:4433' },
    { upstreamOrigin: 'https://example.test:4433' }, { upstreamOrigin: `${f.config.upstreamOrigin}/internal/` },
    { publicOrigin: `${publicOrigin}/` }, { publicOrigin: 'http://owner.example.test' },
    { ownerTokenFile: f.config.runtimeTokenFile }, { port: -1 }, { upstreamCaFile: 'relative.pem' },
    { accessExpiresAt: new Date(Date.parse(f.config.ownerAlpha.expires_at) + 900001).toISOString() }])
    await assert.rejects(startOwnerAlphaGateway({ ...f.config, ...patch }), /Invalid owner gateway configuration/);
  await writeFile(f.config.ownerTokenFile, f.runtimeToken);
  await assert.rejects(startOwnerAlphaGateway(f.config));
  await writeFile(f.config.ownerTokenFile, f.token); await chmod(f.config.ownerTokenFile, 0o644);
  await assert.rejects(startOwnerAlphaGateway(f.config)); await chmod(f.config.ownerTokenFile, 0o600);
  await symlink(f.config.ownerTokenFile, join(f.dir, 'link'));
  await assert.rejects(startOwnerAlphaGateway({ ...f.config, ownerTokenFile: join(f.dir, 'link') }));
  const gateway = await startOwnerAlphaGateway({ ...f.config, upstreamCaFile: join(f.dir, 'wrong.pem') }); t.after(gateway.stop);
  const base = `http://127.0.0.1:${gateway.address.port}`;
  const login = await fetch(base + '/login', { method: 'POST', redirect: 'manual', headers: { Origin: publicOrigin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: `token=${f.token}` });
  const response = await fetch(base + '/v1/state', { headers: { Cookie: login.headers.get('set-cookie').split(';')[0] } });
  assert.equal(response.status, 502); assert.equal(f.calls.length, 0);
  assert.deepEqual(await response.json(), { error: { code: 'GATEWAY_UNAVAILABLE', message: 'Request unavailable.' } });
});

test('absolute upstream deadline stops a continuously trickling mutation without replay', { timeout: 16000 }, async t => {
  const f = await fixture(t), cookie = await f.auth();
  let chunks = 0;
  f.beforeResponse((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{');
    const interval = setInterval(() => { chunks++; res.write(' '); }, 25);
    res.once('close', () => clearInterval(interval));
    t.after(() => clearInterval(interval));
    return true;
  });
  const started = performance.now();
  const result = await f.command(cookie, 'message.send', { conversation_id: persona, text: 'Synthetic uncertain outcome' });
  const elapsed = performance.now() - started;
  assert.equal(result.status, 502);
  assert.ok(elapsed >= 9500 && elapsed < 14000, `Elapsed ${elapsed}ms`);
  assert.ok(chunks > 100, 'The upstream stayed active rather than timing out from inactivity');
  assert.equal(f.calls.length, 1, 'An uncertain mutation must never be automatically replayed');
  assert.equal(f.calls[0].path, '/v1/commands');
  assert.deepEqual(JSON.parse(result.text), { error: { code: 'GATEWAY_UNAVAILABLE', message: 'Request unavailable.' } });
});

test('token rotation during canonical cancellation lookup prevents mutation dispatch', async t => {
  const f = await fixture(t), cookie = await f.auth();
  f.beforeResponse(async req => {
    assert.equal(req.url, '/v1/state');
    await writeFile(f.config.ownerTokenFile, randomBytes(32).toString('base64url'));
  });
  assert.equal((await f.command(cookie, 'run.cancel', { run_id: run, reason: 'Rotate during lookup' })).status, 401);
  assert.deepEqual(f.calls.map(call => call.path), ['/v1/state']);
});

test('token rotation while reading a message body prevents mutation dispatch', { timeout: 5000 }, async t => {
  const f = await fixture(t), cookie = await f.auth();
  // Observe the async body reader without consuming input or adding a test hook to the gateway API.
  const reading = new Promise(resolve => f.gateway.server.once('request', req => {
    const interval = setInterval(() => {
      if (req.listenerCount('readable')) { clearInterval(interval); resolve(); }
    }, 5);
    t.after(() => clearInterval(interval));
  }));
  const data = JSON.stringify({ schema_version: 1, type: 'message.send', payload: { conversation_id: persona, text: 'Delayed body' } });
  let pending;
  const result = f.call('/v1/commands', 'POST', { Cookie: cookie, Origin: publicOrigin,
    'Content-Type': 'application/json', 'Idempotency-Key': other }, req => { pending = req; req.write(data.slice(0, 5)); });
  await reading;
  await writeFile(f.config.ownerTokenFile, randomBytes(32).toString('base64url'));
  pending.end(data.slice(5));
  assert.equal((await result).status, 401);
  assert.equal(f.calls.length, 0);
});
