import { beforeAll, describe, expect, it } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { authenticateOwner, assertSameOrigin, verifyRuntimeToken, verifyWebhook, type AuthConfig } from '../src/worker/auth';
const now = new Date('2026-09-10T00:00:00Z');
const seconds = Math.floor(now.getTime() / 1000);
const config: AuthConfig = { AUTH_MODE: 'access', INSTALLATION_ID: 'personal', ACCESS_ISSUER: 'https://test.cloudflareaccess.com', ACCESS_AUD: 'portal-audience', OWNER_SUB: 'owner-sub' };
let key: CryptoKey;
let jwks: JWTVerifyGetKey;
beforeAll(async () => {
  const pair = await generateKeyPair('RS256'); key = pair.privateKey;
  jwks = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' }] });
});
async function token(overrides = {}) {
  return new SignJWT({ iss: config.ACCESS_ISSUER, aud: config.ACCESS_AUD, sub: config.OWNER_SUB, exp: seconds + 60, iat: seconds, ...overrides })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).sign(key);
}
const request = (jwt: string) => new Request('https://portal.example/v1/state', { headers: { 'Cf-Access-Jwt-Assertion': jwt } });
describe('owner Access authentication', () => {
  it('verifies a signed allowlisted owner', async () => {
    await expect(authenticateOwner(request(await token()), config, { jwks, now })).resolves.toBe(config.OWNER_SUB);
  });
  it('production workers.dev uses the same exact JWT owner and origin checks, never local bypass', async () => {
    const origin = 'https://hehebot-portal.synthetic-account.workers.dev';
    const make = (jwt: string) => new Request(`${origin}/v1/state`, { headers: { 'Cf-Access-Jwt-Assertion': jwt } });
    await expect(authenticateOwner(make(await token()), config, { jwks, now })).resolves.toBe(config.OWNER_SUB);
    for (const claims of [{ sub: 'other-member' }, { aud: 'preview-audience' }, { iss: 'https://other.cloudflareaccess.com' }]) {
      await expect(authenticateOwner(make(await token(claims)), config, { jwks, now })).rejects.toMatchObject({ status: 401 });
    }
    await expect(authenticateOwner(new Request(origin, { headers: { 'X-Forwarded-Host': 'localhost', 'Cf-Access-Authenticated-User-Email': 'owner@example.com' } }),
      { ...config, AUTH_MODE: 'local', INSTALLATION_ID: 'local-only' })).rejects.toMatchObject({ status: 401 });
    expect(() => assertSameOrigin(new Request(`${origin}/v1/commands`, { headers: { Origin: origin } }))).not.toThrow();
    expect(() => assertSameOrigin(new Request(`${origin}/v1/commands`, { headers: { Origin: 'https://preview-hehebot-portal.synthetic-account.workers.dev' } }))).toThrow();
  });
  it('checked-in deployment remains dark until Access setup; preview URLs and asset bypass stay disabled', () => {
    const deployment = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
    expect(deployment.workers_dev).toBe(false);
    expect(deployment.preview_urls).toBe(false);
    expect(deployment.env.local.workers_dev).toBe(false);
    expect(deployment.env.local.preview_urls).toBe(false);
    expect(deployment.assets.run_worker_first).toBe(true);
    expect(deployment.vars.AUTH_MODE).toBe('access');
    expect(deployment.vars.EXECUTION_ENABLED).toBe('false');
    expect(deployment.vars.NATIVE_VERIFIED).toBe('false');
  });
  it.each([{ iss: 'https://wrong.cloudflareaccess.com' }, { aud: 'other-audience' }, { sub: 'another-person' }, { exp: seconds - 1 }, { nbf: seconds + 30 }])('rejects wrong claims %j', async (claims) => {
    await expect(authenticateOwner(request(await token(claims)), config, { jwks, now })).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
  });
  it('rejects unsigned tokens and trusted-looking email headers', async () => {
    const unsigned = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: config.OWNER_SUB })).toString('base64url')}.`;
    await expect(authenticateOwner(request(unsigned), config, { jwks, now })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(authenticateOwner(new Request('https://portal.example', { headers: { 'Cf-Access-Authenticated-User-Email': 'owner@example.com' } }), config, { jwks, now })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
  it('rejects missing expiration and a signature from another key', async () => {
    await expect(authenticateOwner(request(await token({ exp: undefined })), config, { jwks, now })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    const other = await generateKeyPair('RS256');
    const bad = await new SignJWT({ iss: config.ACCESS_ISSUER, aud: config.ACCESS_AUD, sub: config.OWNER_SUB, exp: seconds + 60, iat: seconds }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).sign(other.privateKey);
    await expect(authenticateOwner(request(bad), config, { jwks, now })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
  it('refuses insecure or arbitrary JWKS issuer configuration', async () => {
    await expect(authenticateOwner(request(await token()), { ...config, ACCESS_ISSUER: 'http://localhost' }, { jwks, now })).rejects.toMatchObject({ status: 503 });
  });
  it.each(['localhost', '127.0.0.1', '[::1]'])('local bypass permits only loopback and local-only installation: %s', async (host) => {
    await expect(authenticateOwner(new Request(`http://${host}:8787/v1/state`), { ...config, AUTH_MODE: 'local', INSTALLATION_ID: 'local-only' })).resolves.toBe('local-owner');
  });
  it('local mode cannot run on a remote host or production installation', async () => {
    const local = { ...config, AUTH_MODE: 'local', INSTALLATION_ID: 'local-only' };
    await expect(authenticateOwner(new Request('https://portal.example', { headers: { 'X-Forwarded-Host': 'localhost' } }), local)).rejects.toMatchObject({ status: 401 });
    await expect(authenticateOwner(new Request('http://localhost:8787'), { ...local, INSTALLATION_ID: 'personal' })).rejects.toMatchObject({ status: 401 });
  });
});
describe('request integrity', () => {
  it('requires exact origin for browser mutation', () => {
    expect(() => assertSameOrigin(new Request('https://portal.example/v1/commands', { headers: { Origin: 'https://portal.example' } }))).not.toThrow();
    for (const origin of [null, 'null', 'http://portal.example', 'https://portal.example.evil', 'https://portal.example/']) {
      expect(() => assertSameOrigin(new Request('https://portal.example/v1/commands', { headers: origin ? { Origin: origin } : {} }))).toThrow();
    }
  });
  it('runtime bearer token is separate and configuration fails closed', () => {
    const req = new Request('https://portal.example/runtime', { headers: { Authorization: 'Bearer synthetic-test-secret' } });
    expect(() => verifyRuntimeToken(req, 'synthetic-test-secret')).not.toThrow();
    expect(() => verifyRuntimeToken(req, 'synthetic-test-secreu')).toThrow();
    expect(() => verifyRuntimeToken(req, undefined)).toThrow();
  });
  function signed(body: string, timestamp = seconds, event = 'event-1') {
    const signature = createHmac('sha256', 'synthetic-source-secret').update(`${timestamp}\n${event}\n${body}`).digest('hex');
    return new Headers({ 'X-Timestamp': String(timestamp), 'X-Event-ID': event, 'X-Signature': signature });
  }
  it('verifies exact body bytes, event ID and timestamp', async () => {
    const body = '{"type":"synthetic", "data":{}}';
    await expect(verifyWebhook(body, signed(body), 'synthetic-source-secret', now.getTime())).resolves.toEqual({ eventId: 'event-1', timestamp: seconds });
    await expect(verifyWebhook(body + ' ', signed(body), 'synthetic-source-secret', now.getTime())).rejects.toMatchObject({ status: 401 });
    const changed = signed(body); changed.set('X-Event-ID', 'event-2');
    await expect(verifyWebhook(body, changed, 'synthetic-source-secret', now.getTime())).rejects.toMatchObject({ status: 401 });
    await expect(verifyWebhook(body, signed(body), 'wrong-source-secret', now.getTime())).rejects.toMatchObject({ status: 401 });
  });
  it.each([-301, 301])('rejects replay or future timestamp %i seconds away', async (offset) => {
    await expect(verifyWebhook('{}', signed('{}', seconds + offset), 'synthetic-source-secret', now.getTime())).rejects.toMatchObject({ status: 401 });
  });
  it.each([-300, 300])('accepts the exact %i-second boundary', async (offset) => {
    await expect(verifyWebhook('{}', signed('{}', seconds + offset), 'synthetic-source-secret', now.getTime())).resolves.toMatchObject({ timestamp: seconds + offset });
  });
});
