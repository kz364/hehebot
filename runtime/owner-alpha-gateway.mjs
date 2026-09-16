import { createServer } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { open, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute } from 'node:path';
import { createHash, randomBytes, timingSafeEqual, X509Certificate } from 'node:crypto';
import { ownerAlphaPolicy } from './owner-alpha-policy.mjs';

const cookieName = '__Host-hehebot_owner_alpha';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const assets = new Set(['/', '/index.html', '/app.js', '/style.css', '/import-setup.js']);
const hash = value => createHash('sha256').update(value).digest();
const equal = (a, b) => timingSafeEqual(hash(a), hash(b));
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const fail = (status = 400) => { throw Object.assign(new Error('Request unavailable.'), { status }); };
const securityHeaders = {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};
const loginPage = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hehebot owner access</title><main><h1>Hehebot owner access</h1><p>Enter the short-lived owner access token. This does not connect a model account.</p><form method="post" action="/login"><label for="token">Owner access token</label><input id="token" name="token" type="password" required maxlength="128" autocomplete="off"><button type="submit">Sign in</button></form><p>Access ends at the configured deadline, even if you refresh.</p></main></html>';

async function privateToken(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) fail();
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.uid !== process.getuid() || stat.mode & 0o077 || stat.size > 1024) fail();
    return { token: (await file.readFile('utf8')).trim(), identity: `${stat.dev}:${stat.ino}` };
  } finally { await file.close(); }
}

function origin(value, loopback = false) {
  const url = new URL(value);
  if (url.origin !== value || url.protocol !== 'https:' || url.username || url.password ||
      loopback && (!['127.0.0.1', '[::1]'].includes(url.hostname) || !url.port)) fail();
  return url;
}

async function body(request, limit) {
  if (request.headers['content-encoding'] || Number(request.headers['content-length'] ?? 0) > limit) fail(413);
  const chunks = []; let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) fail(413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Loopback HTTP listener for a trusted TLS ingress; no publication or runtime credentials. */
export async function startOwnerAlphaGateway(config, { now = Date.now, admissionOpen = () => true } = {}) {
  let policy, upstream, ca, owner, runtime, expires;
  try {
    if (!exact(config, ['publicOrigin', 'upstreamOrigin', 'upstreamCaFile', 'ownerTokenFile',
      'runtimeTokenFile', 'ownerAlpha', 'accessExpiresAt', 'port']) ||
      !Number.isInteger(config.port) || config.port < 0 || config.port > 65535 ||
      process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') fail();
    config = structuredClone(config);
    origin(config.publicOrigin); upstream = origin(config.upstreamOrigin, true);
    if (config.publicOrigin === config.upstreamOrigin) fail();
    policy = ownerAlphaPolicy(config.ownerAlpha);
    expires = Date.parse(config.accessExpiresAt);
    if (!Number.isFinite(expires) || new Date(expires).toISOString() !== config.accessExpiresAt ||
        Date.parse(policy.expires_at) > now() + 300000 ||
        expires <= now() || expires > now() + 1200000 || expires < Date.parse(policy.expires_at) ||
        expires > Date.parse(policy.expires_at) + 900000) fail();
    owner = await privateToken(config.ownerTokenFile); runtime = await privateToken(config.runtimeTokenFile);
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(owner.token) || new Set(owner.token).size < 16 ||
        !runtime.token || owner.identity === runtime.identity || equal(owner.token, runtime.token)) fail();
    if (!isAbsolute(config.upstreamCaFile)) fail();
    ca = await readFile(config.upstreamCaFile);
    if (!new X509Certificate(ca).ca) fail();
  } catch { throw new Error('Invalid owner gateway configuration.'); }
  const sessions = new Set();
  let revoked = false;
  const checkOwnerToken = async () => {
    try {
      const current = await privateToken(config.ownerTokenFile);
      if (!equal(current.token, owner.token)) revoked = true;
    } catch { revoked = true; }
    if (revoked) sessions.clear();
  };
  const send = (response, status, value, headers = {}) => {
    response.writeHead(status, { ...securityHeaders, 'Content-Type': 'application/json', ...headers });
    response.end(value);
  };
  const cookie = value => `${cookieName}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; ${value ? `Expires=${new Date(expires).toUTCString()}` : 'Max-Age=0'}`;
  const forward = (path, method = 'GET', data, key) => new Promise((resolve, reject) => {
    let deadline;
    const finish = (error, result) => {
      clearTimeout(deadline);
      if (error) reject(error); else resolve(result);
    };
    const headers = { Accept: 'application/json' };
    if (data !== undefined) Object.assign(headers, { 'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data), 'Idempotency-Key': key, Origin: upstream.origin,
      'Sec-Fetch-Site': 'same-origin' });
    const req = httpsRequest(new URL(path, upstream), { method, ca, rejectUnauthorized: true,
      headers, agent: false }, res => {
      const chunks = []; let size = 0;
      res.on('data', chunk => { size += chunk.length; if (size > 4 * 1024 * 1024) res.destroy(new Error('Unavailable')); else chunks.push(chunk); });
      res.on('error', error => finish(error));
      res.on('end', () => finish(null, { status: res.statusCode, type: res.headers['content-type'], body: Buffer.concat(chunks) }));
    });
    // Absolute elapsed deadline covers TLS, headers and the entire body. Activity never resets it.
    deadline = setTimeout(() => req.destroy(new Error('Unavailable')), 10000);
    req.on('error', error => finish(error)); req.end(data);
  });
  const server = createServer({ maxHeaderSize: 8192, requestTimeout: 15000, headersTimeout: 10000 }, async (request, response) => {
    try {
      // Host and all forwarded headers are deliberately irrelevant to authority.
      if (!request.url?.startsWith('/') || request.url.startsWith('//') || request.url.includes('%') ||
          request.url.includes('\\') || request.url.includes('#')) fail(404);
      const url = new URL(request.url, config.publicOrigin);
      if (url.pathname + url.search !== request.url) fail(404);
      const path = url.pathname;
      if (request.method === 'POST' && (request.headers.origin !== config.publicOrigin ||
          request.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(request.headers['sec-fetch-site']))) fail(403);
      const candidates = (request.headers.cookie ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${cookieName}=`));
      const candidate = candidates.length === 1 ? candidates[0].slice(cookieName.length + 1) : '';
      let session;
      for (const saved of sessions) if (equal(candidate, saved)) session = saved;
      if (path === '/logout' && request.method === 'POST' && !url.search) {
        await body(request, 0); sessions.delete(session);
        return send(response, 303, '', { Location: '/login', 'Set-Cookie': cookie('') });
      }
      await checkOwnerToken();
      if (now() >= expires || revoked) {
        sessions.clear();
        if (request.method === 'GET' && ['/login', '/'].includes(path) && !url.search)
          return send(response, 401, '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Owner access closed</title><main><h1>Owner access closed</h1><p>This session has expired or been revoked. Ask the operator to start a new authorized session.</p></main></html>', { 'Content-Type': 'text/html; charset=utf-8' });
        fail(401);
      }
      if (path === '/login' && !url.search) {
        if (request.method === 'GET') return send(response, 200, loginPage, { 'Content-Type': 'text/html; charset=utf-8' });
        if (request.method !== 'POST') fail(404);
        if (request.headers['content-type'] !== 'application/x-www-form-urlencoded') fail();
        const form = new URLSearchParams(await body(request, 512));
        if ([...form.keys()].length !== 1 || !form.has('token') || !equal(form.get('token'), owner.token)) fail(401);
        await checkOwnerToken();
        if (now() >= expires || revoked) fail(401);
        if (sessions.size >= 128) fail(429);
        const session = randomBytes(32).toString('base64url'); sessions.add(session);
        return send(response, 303, '', { Location: '/', 'Set-Cookie': cookie(session) });
      }
      if (!session) {
        if (request.method === 'GET' && path === '/' && !url.search) return send(response, 303, '', { Location: '/login' });
        fail(401);
      }
      if (path === '/v1/commands' && request.method === 'POST' && !url.search) {
        if (request.headers['content-type'] !== 'application/json') fail();
        const data = await body(request, 65536), command = JSON.parse(data), key = request.headers['idempotency-key'];
        if (typeof key !== 'string' || !uuid.test(key) || !exact(command, ['schema_version', 'type', 'payload']) || command.schema_version !== 1) fail();
        const p = command.payload;
        if (command.type === 'message.send') {
          if (!exact(p, ['conversation_id', 'text']) || p.conversation_id !== policy.persona_id ||
              typeof p.text !== 'string' || p.text.length < 1 || p.text.length > 32768) fail(403);
          if (now() >= Date.parse(policy.expires_at)) fail(403);
        } else if (command.type === 'run.cancel') {
          if (!exact(p, ['run_id', 'reason']) || typeof p.run_id !== 'string' || !uuid.test(p.run_id) ||
              typeof p.reason !== 'string' || p.reason.length < 1 || p.reason.length > 500) fail(403);
          const state = await forward('/v1/state');
          if (state.status !== 200) fail(502);
          if (!JSON.parse(state.body).runs?.some(run => run.id === p.run_id && run.persona_id === policy.persona_id)) fail(403);
        } else fail(403);
        // Revalidate the file after awaited input/ownership reads, immediately before dispatch.
        await checkOwnerToken();
        if (now() >= expires || revoked || !sessions.has(session)) fail(401);
        if (command.type === 'message.send' && (now() >= Date.parse(policy.expires_at) || admissionOpen() !== true)) fail(403);
        const result = await forward(path, 'POST', data, key);
        if (now() >= expires || revoked || !sessions.has(session)) fail(401);
        if (result.status < 200 || result.status >= 300) fail(502);
        return send(response, result.status, result.body);
      }
      const conversation = path.match(/^\/v1\/conversations\/([^/]+)\/(events|tasks|recovery)$/);
      const receipt = path.match(/^\/v1\/receipts\/([^/]+)$/);
      let keys;
      if (assets.has(path) && ['GET', 'HEAD'].includes(request.method)) keys = [];
      else if (request.method === 'GET' && path === '/v1/state') keys = ['after', 'limit'];
      else if (request.method === 'GET' && conversation && conversation[1] === policy.persona_id)
        keys = conversation[2] === 'events' ? ['before'] : ['after', 'limit'];
      else if (request.method === 'GET' && receipt && uuid.test(receipt[1])) keys = [];
      else fail(404);
      for (const [key, value] of url.searchParams) {
        if (!keys.includes(key) || url.searchParams.getAll(key).length !== 1 || !/^[A-Za-z0-9_.:-]{1,256}$/.test(value)) fail();
      }
      const result = await forward(request.url, request.method);
      if (now() >= expires || revoked || !sessions.has(session)) fail(401);
      if (result.status < 200 || result.status >= 300) fail(502);
      return send(response, result.status, result.body, { 'Content-Type': assets.has(path) ? result.type ?? 'application/octet-stream' : 'application/json' });
    } catch (error) {
      if (!response.headersSent) send(response, [400, 401, 403, 404, 413, 429].includes(error.status) ? error.status : 502,
        JSON.stringify({ error: { code: 'GATEWAY_UNAVAILABLE', message: 'Request unavailable.' } }));
      else response.destroy();
    }
  });
  server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(config.port, '127.0.0.1', resolve); });
  return { server, address: server.address(), stop: async () => {
    revoked = true; sessions.clear(); server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  } };
}
