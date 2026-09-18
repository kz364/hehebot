import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { Agent, fetch as undiciFetch } from 'undici';

const run = promisify(execFile);
const ISSUER = 'https://synthetic.cloudflareaccess.com';
const AUDIENCE = 'fixture-audience';
const OWNER = 'fixture-owner';
const INSTALLATION = 'hosted-fixture';
const ROUTINE_MANAGE_POLICY = 'f0ff3ead-1e31-4f83-bbc2-aa25f069a962';

export async function startHostedControlFixture({ directory, ownerAlpha, ownerAlphaSuccessor, runtimeToken, accessClientId, accessClientSecret, manager }) {
  if (![directory, runtimeToken, accessClientId, accessClientSecret].every(value => typeof value === 'string' && value)) {
    throw new TypeError('Hosted fixture requires a private directory and non-empty synthetic credentials.');
  }
  const root = resolve(directory), bundle = join(root, 'worker.mjs');
  const caFile = join(root, 'loopback-cert.pem'), keyFile = join(root, 'loopback-key.pem');
  let mf, server, dispatcher;
  try {
    await mkdir(root, { recursive: true, mode: 0o700 });
    await build({ entryPoints: [resolve(manager ? 'tests/fixtures/hosted-manager-control.ts' : 'src/worker/index.ts')], outfile: bundle, bundle: true, format: 'esm',
      platform: 'browser', target: 'es2022', loader: { '.sql': 'text' },
      external: ['cloudflare:workers', 'node:*'] });
    await run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=localhost',
      '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-keyout', keyFile, '-out', caFile], { windowsHide: true });
    const pair = await generateKeyPair('RS256'), kid = `fixture-${randomUUID()}`;
    const jwk = { ...await exportJWK(pair.publicKey), kid, alg: 'RS256', use: 'sig' };
    const now = Math.floor(Date.now() / 1000);
    const ownerJwt = await new SignJWT({ iss: ISSUER, aud: AUDIENCE, sub: OWNER, iat: now - 5, exp: now + 3600 })
      .setProtectedHeader({ alg: 'RS256', kid }).sign(pair.privateKey);
    const otherOwnerJwt = await new SignJWT({ iss: ISSUER, aud: AUDIENCE, sub: 'other-owner', iat: now - 5, exp: now + 3600 })
      .setProtectedHeader({ alg: 'RS256', kid }).sign(pair.privateKey);
    const binding = JSON.stringify({ auth_mode: 'access', installation_id: INSTALLATION, issuer: ISSUER,
      audience: AUDIENCE, owner_subject: OWNER });
    const ownerBindingSha256 = createHash('sha256').update(binding).digest('hex');
    const successor = typeof ownerAlphaSuccessor === 'function'
      ? ownerAlphaSuccessor(ownerBindingSha256, ownerAlpha)
      : ownerAlphaSuccessor;
    const outboundRequests = [];
    mf = new Miniflare(convertV4MiniflareOptions({ rootPath: root, modules: true, scriptPath: 'worker.mjs', compatibilityDate: '2026-09-10',
      compatibilityFlags: ['nodejs_compat'], resourcePersistencePath: join(root, 'miniflare'),
      durableObjects: { CONTROL: { className: manager ? 'HostedManagerControl' : 'PersonalControl', useSQLite: true } },
      bindings: { INSTALLATION_ID: INSTALLATION, AUTH_MODE: 'access', ACCESS_ISSUER: ISSUER, ACCESS_AUD: AUDIENCE,
        OWNER_SUB: OWNER, EXECUTION_ENABLED: 'false', NATIVE_VERIFIED: 'false', PROVIDER_CONFIG: '{}',
        ACTION_POLICY_IDS: '[]', TOOL_POLICY_IDS: JSON.stringify([ROUTINE_MANAGE_POLICY]),
        HEHEBOT_WHATSAPP_READ_POLICIES: '{}', TRIGGER_CONFIG: '{}', NATIVE_DELEGATIONS: '{}',
        FLIGHT_RESTORE_VERIFIED: 'false', FLIGHT_RESTORE_POLICY_ID: '', RUNTIME_TOKEN: runtimeToken,
        HEHEBOT_HOSTED_OWNER_ALPHA: JSON.stringify({ owner_binding_sha256: ownerBindingSha256, policy: ownerAlpha }),
        ...(manager ? { HEHEBOT_OWNER_ALPHA_BOOTSTRAP: JSON.stringify({ ...manager.bootstrap,
          installation_id: INSTALLATION, owner_id: OWNER, owner_binding_sha256: ownerBindingSha256 }),
        HEHEBOT_OWNER_ALPHA_WAKE: JSON.stringify({ url: 'https://synthetic-manager.sprites.app' }),
        HEHEBOT_OWNER_ALPHA_WAKE_TOKEN: 'synthetic-wake-' + 'w'.repeat(40), PROVIDER_TOKEN: 'synthetic-provider-' + 'p'.repeat(40),
        HEHEBOT_OWNER_ALPHA_MANAGER_TOKEN: manager.token, HEHEBOT_OWNER_ALPHA_TASK_SIGNING_KEY: manager.signingKey } : {}),
        ...(successor === undefined ? {} : { HEHEBOT_OWNER_ALPHA_SUCCESSOR: JSON.stringify(successor) }) },
      outboundService: async request => {
        outboundRequests.push({ method: request.method, url: request.url });
        if (request.method === 'GET' && request.url === `${ISSUER}/cdn-cgi/access/certs`) {
          return Response.json({ keys: [jwk] });
        }
        throw new Error(`Blocked unexpected outbound request: ${request.method} ${request.url}`);
      } }));
    const [key, cert] = await Promise.all([readFile(keyFile), readFile(caFile)]);
    server = createServer({ key, cert }, async (incoming, response) => {
      try {
        const path = incoming.url ?? '/';
        if (path.startsWith('/internal/') &&
          (incoming.headers['cf-access-client-id'] !== accessClientId || incoming.headers['cf-access-client-secret'] !== accessClientSecret)) {
          response.writeHead(403, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: 'synthetic_edge_gate' })); return;
        }
        const chunks = []; for await (const chunk of incoming) chunks.push(chunk);
        const body = Buffer.concat(chunks);
        const result = await mf.dispatchFetch(`https://${incoming.headers.host}${path}`, {
          method: incoming.method, headers: incoming.headers, body: body.length ? body : undefined,
        });
        response.writeHead(result.status, Object.fromEntries(result.headers));
        response.end(Buffer.from(await result.arrayBuffer()));
      } catch {
        response.writeHead(500); response.end('fixture forwarding failed');
      }
    });
    await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
    const address = server.address(), origin = `https://localhost:${address.port}`;
    dispatcher = new Agent({ connect: { ca: cert } });
    const fetchImpl = (input, init = {}) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, origin);
      if (url.origin !== origin) throw new Error('Hosted fixture fetch is pinned to its loopback origin.');
      return undiciFetch(url, { ...init, redirect: 'manual', dispatcher });
    };
    let closed = false;
    const close = async () => {
      if (closed) return; closed = true;
      if (server) await new Promise(resolveClose => server.close(() => resolveClose()));
      if (mf) await mf.dispose();
      if (dispatcher) await dispatcher.close();
    };
    const fixtureCall = async path => {
      const namespace = await mf.getDurableObjectNamespace('CONTROL');
      const response = await namespace.get(namespace.idFromName(INSTALLATION)).fetch(`http://127.0.0.1/${path}`, { method: 'POST', body: '{}' });
      if (!response.ok) throw new Error(`Fixture inspection/seed failed: ${response.status}`);
      return response.json();
    };
    return { origin, caFile, fetchImpl, ownerJwt, otherOwnerJwt, ownerBindingSha256, outboundRequests, close,
      ...(manager ? { retireUnusedPredecessor: () => fixtureCall('fixture-retire'), retainedManifest: () => fixtureCall('fixture-manifest') } : {}) };
  } catch (error) {
    if (server) await new Promise(resolveClose => server.close(() => resolveClose()));
    if (mf) await mf.dispose();
    if (dispatcher) await dispatcher.close();
    throw error;
  }
}
