import { beforeAll, expect, it } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';
import { bootstrapIdentity } from '../src/worker/owner-bootstrap';

const env = { BOOTSTRAP_HOST: 'hehebot-portal.synthetic.workers.dev', ACCESS_ISSUER: 'https://synthetic.cloudflareaccess.com',
  ACCESS_AUD: 'bootstrap-audience', OWNER_EMAIL: 'owner@example.com' };
const now = new Date('2026-09-17T12:00:00Z');
const seconds = now.getTime() / 1000;
let key: CryptoKey, jwks: JWTVerifyGetKey;
beforeAll(async () => {
  const pair = await generateKeyPair('RS256'); key = pair.privateKey;
  jwks = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: 'test', alg: 'RS256' }] });
});
async function request(claims = {}, path = '/__owner-bootstrap', host = env.BOOTSTRAP_HOST, method = 'GET') {
  const jwt = await new SignJWT({ iss: env.ACCESS_ISSUER, aud: env.ACCESS_AUD, sub: 'verified-sub-not-email',
    email: env.OWNER_EMAIL, iat: seconds, exp: seconds + 60, ...claims }).setProtectedHeader({ alg: 'RS256', kid: 'test' }).sign(key);
  return new Request(`https://${host}${path}`, { method, headers: { 'Cf-Access-Jwt-Assertion': jwt } });
}
it('returns only signed identity with no-store and no credentials', async () => {
  const result = await bootstrapIdentity(await request(), env, { jwks, now });
  expect(result.status).toBe(200);
  expect(result.headers.get('Cache-Control')).toBe('private, no-store');
  const body = await result.json() as Record<string, unknown>;
  expect(body.owner_sub).toBe('verified-sub-not-email');
  expect(Object.keys(body).sort()).toEqual(['instruction', 'owner_sub', 'status']);
});
it.each([{ iss: 'https://foreign.cloudflareaccess.com' }, { aud: 'other-app' }, { email: 'other@example.com' },
  { email: undefined }, { sub: '' }, { sub: undefined }, { exp: seconds - 1 }, { exp: undefined }, { nbf: seconds + 60 }])(
  'rejects wrong or missing signed claims %j', async claims => {
    expect((await bootstrapIdentity(await request(claims), env, { jwks, now })).status).toBe(401);
  });
it('rejects missing/forged assertions and email headers', async () => {
  for (const assertion of ['', 'eyJhbGciOiJub25lIn0.e30.', 'x'.repeat(16_385)]) {
    const req = new Request(`https://${env.BOOTSTRAP_HOST}/__owner-bootstrap`, {
      headers: { 'Cf-Access-Jwt-Assertion': assertion, 'Cf-Access-Authenticated-User-Email': env.OWNER_EMAIL } });
    expect((await bootstrapIdentity(req, env, { jwks, now })).status).toBe(401);
  }
});
it('has no control, asset, runtime, preview or mutation route even with valid identity', async () => {
  for (const path of ['/', '/app.js', '/v1/state', '/v1/commands', '/internal/claim', '/v1/triggers/example']) {
    expect((await bootstrapIdentity(await request({}, path), env, { jwks, now })).status).toBe(503);
  }
  expect((await bootstrapIdentity(await request({}, '/__owner-bootstrap', 'preview.synthetic.workers.dev'), env, { jwks, now })).status).toBe(503);
  expect((await bootstrapIdentity(await request({}, '/__owner-bootstrap', env.BOOTSTRAP_HOST, 'POST'), env, { jwks, now })).status).toBe(503);
  expect((await bootstrapIdentity(await request(), { ...env, ACCESS_ISSUER: 'http://localhost' }, { jwks, now })).status).toBe(503);
});
