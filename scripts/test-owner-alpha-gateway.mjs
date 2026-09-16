// Credential-free browser -> authenticated gateway -> real local Worker/SQLite.
// No Codex process, account discovery, inference, provider or public portal.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { createServer as createHttps } from 'node:https';
import { createServer as createHttp, request as httpRequest } from 'node:http';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { Agent } from 'undici';
import { startOwnerAlphaGateway } from '../runtime/owner-alpha-gateway.mjs';

process.umask(0o077);
const root = resolve(import.meta.dirname, '..'), exec = promisify(execFile);
const directory = await mkdtemp(join(tmpdir(), 'hehe-alpha-gateway-'));
const browserSession = 'alpha-gw-' + randomUUID().slice(0, 6);
const browser = (...args) => exec('agent-browser', ['--session', browserSession, '--ignore-https-errors', ...args], { timeout: 25000 });
const sleep = ms => new Promise(ok => setTimeout(ok, ms));
async function port() { const s = createHttp(); await new Promise(ok => s.listen(0, '127.0.0.1', ok)); const p = s.address().port; await new Promise(ok => s.close(ok)); return p; }
async function wait(fn, label) { const end = Date.now() + 45000; while (Date.now() < end) { if (await fn()) return; await sleep(250); } throw new Error('Timeout: ' + label); }
let worker, gateway, ingress, agent, workerLog = '', passed = false;
const requests = [];
try {
  const cert = join(directory, 'cert.pem'), key = join(directory, 'key.pem');
  await exec('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1',
    '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', key, '-out', cert]);
  const runtimeToken = randomBytes(32).toString('hex'), ownerToken = randomBytes(32).toString('base64url');
  const runtimeTokenFile = join(directory, 'runtime-token'), ownerTokenFile = join(directory, 'owner-token');
  await writeFile(runtimeTokenFile, runtimeToken, { mode: 0o600 }); await writeFile(ownerTokenFile, ownerToken, { mode: 0o600 });
  const workerPort = await port(), publicPort = await port();
  const upstreamOrigin = `https://127.0.0.1:${workerPort}`, publicOrigin = `https://127.0.0.1:${publicPort}`;
  const ownerAlpha = { session_id: randomUUID(), persona_id: '11111111-1111-4111-8111-111111111111',
    expires_at: new Date(Date.now() + 240000).toISOString(), max_runs: 1, max_task_seconds: 120 };
  worker = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--env', 'local', '--ip', '127.0.0.1', '--port', String(workerPort),
    '--persist-to', join(directory, 'worker'), '--local-protocol', 'https', '--https-key-path', key, '--https-cert-path', cert,
    '--var', 'EXECUTION_ENABLED:false', '--var', 'NATIVE_VERIFIED:false', '--var', 'PROVIDER_CONFIG:{}', '--var', `RUNTIME_TOKEN:${runtimeToken}`,
    '--var', `HEHEBOT_OWNER_ALPHA:${JSON.stringify(ownerAlpha)}`],
  { cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: join(directory, 'logs') }, stdio: ['ignore', 'pipe', 'pipe'] });
  worker.stdout.on('data', bytes => { workerLog += bytes; }); worker.stderr.on('data', bytes => { workerLog += bytes; });
  await wait(() => workerLog.includes(`Ready on ${upstreamOrigin}`), 'private Worker');
  gateway = await startOwnerAlphaGateway({ publicOrigin, upstreamOrigin, upstreamCaFile: cert, ownerTokenFile, runtimeTokenFile,
    ownerAlpha, accessExpiresAt: new Date(Date.now() + 600000).toISOString(), port: 0 });
  gateway.server.on('request', (request, response) => response.on('finish', () => requests.push({
    path: new URL(request.url, publicOrigin).pathname, method: request.method, status: response.statusCode,
    cookiePresent: Boolean(request.headers.cookie), originMatches: request.headers.origin === publicOrigin,
  })));
  // TLS ingress shim intentionally changes Host and injects hostile forwarded
  // identity. Neither is allowed to become gateway authentication/CSRF authority.
  ingress = createHttps({ key: await readFile(key), cert: await readFile(cert) }, (request, response) => {
    const forwarded = httpRequest({ hostname: '127.0.0.1', port: gateway.address.port, path: request.url, method: request.method,
      headers: { ...request.headers, host: `127.0.0.1:${gateway.address.port}`, 'x-forwarded-host': 'attacker.invalid', 'cf-access-authenticated-user-email': 'untrusted@example.invalid' } }, upstream => {
      response.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(response);
    });
    forwarded.on('error', () => { response.writeHead(502); response.end(); }); request.pipe(forwarded);
  });
  await new Promise(ok => ingress.listen(publicPort, '127.0.0.1', ok));
  agent = new Agent({ connect: { ca: await readFile(cert) } });
  const unauth = await fetch(publicOrigin + '/v1/state', { dispatcher: agent, redirect: 'manual' });
  assert.equal(unauth.status, 401);
  const runtimeDenied = await fetch(publicOrigin + '/internal/status', { method: 'POST', dispatcher: agent,
    headers: { Authorization: `Bearer ${runtimeToken}`, Origin: publicOrigin, 'Content-Type': 'application/json' }, body: '{}' });
  assert.ok([401, 404].includes(runtimeDenied.status));
  await browser('open', publicOrigin + '/login'); await browser('set', 'viewport', '1280', '900', '2');
  await browser('wait', '--fn', '!!document.querySelector("input[name=token]")');
  await mkdir(join(root, '.amp/in/artifacts'), { recursive: true });
  await browser('screenshot', join(root, '.amp/in/artifacts/owner-alpha-gateway-login.png'));
  await browser('fill', 'input[name=token]', ownerToken).catch(() => { throw new Error('Private token entry failed'); });
  await browser('click', 'button[type=submit]');
  await browser('wait', '--fn', 'document.querySelector("#connection")?.textContent === "Connected"');
  await browser('click', `[data-persona-id="${ownerAlpha.persona_id}"]`);
  await browser('fill', '#message', 'GATEWAY_AUTHENTICATED_ALPHA_41'); await browser('click', '#send');
  await browser('wait', '--fn', 'document.body.textContent.includes("GATEWAY_AUTHENTICATED_ALPHA_41")');
  const result = JSON.parse((await browser('eval', `(async()=>{const s=await(await fetch('/v1/state')).json();const h=await(await fetch('/v1/conversations/${ownerAlpha.persona_id}/events')).json();return {runs:s.runs,events:h.events,alpha:s.summary.owner_alpha,exportStatus:(await fetch('/v1/export/control')).status,mutationStatus:(await fetch('/v1/commands',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({schema_version:1,type:'persona.delete',payload:{id:'${ownerAlpha.persona_id}',expected_revision:1}})})).status,cookies:document.cookie};})()`)).stdout);
  assert.equal(result.alpha, true); assert.equal(result.runs.length, 1); assert.equal(result.runs[0].status, 'queued');
  assert.equal(result.runs[0].current_attempt, 0); assert.equal(result.events.filter(e => e.type === 'message.user').length, 1);
  assert.ok([403, 404].includes(result.exportStatus)); assert.ok([403, 404].includes(result.mutationStatus));
  assert.equal(result.cookies.includes(ownerToken), false); assert.equal(result.cookies.includes('__Host-hehebot_owner_alpha'), false);
  await browser('reload'); await browser('wait', '--fn', 'document.body.textContent.includes("GATEWAY_AUTHENTICATED_ALPHA_41")');
  await browser('screenshot', join(root, '.amp/in/artifacts/owner-alpha-gateway-portal.png'));
  const logout = JSON.parse((await browser('eval', `(async()=>{await fetch('/logout',{method:'POST'});return (await fetch('/v1/state')).status})()`)).stdout);
  assert.equal(logout, 401);
  passed = true;
  console.log(JSON.stringify({ status: 'passed', authenticatedBrowser: true, privateWorker: true,
    durableMessages: 1, nativeAttempts: 0, cookieHttpOnly: true, logoutRevokedBrowser: true, modelCalls: 0, productionEnabled: false }));
} finally {
  await browser('close').catch(() => {});
  await gateway?.stop(); ingress?.closeAllConnections();
  if (ingress) await new Promise(ok => ingress.close(ok));
  await agent?.close();
  if (worker && worker.exitCode === null && worker.signalCode === null) {
    worker.kill('SIGTERM'); await wait(() => worker.exitCode !== null || worker.signalCode !== null, 'Worker shutdown');
  }
  if (passed) await rm(directory, { recursive: true, force: true });
  else { await writeFile(join(directory, 'worker.log'), workerLog, { mode: 0o600 }); console.error(JSON.stringify(requests)); console.error('Private gateway fixture diagnostics retained at ' + directory); }
}
