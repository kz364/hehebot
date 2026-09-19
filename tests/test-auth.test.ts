import { beforeAll, describe, expect, it } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';
import { authenticateTestPrincipal, parseTestAuthConfig, type TestAuthConfig } from '../src/worker/test-auth';

const now = new Date('2026-09-19T00:00:00.000Z');
const seconds = Math.floor(now.getTime() / 1000);
const config: TestAuthConfig = {
  issuer: 'https://hehebot-test.cloudflareaccess.com',
  audience: 'dedicated-test-route-audience',
  client_id: 'designated-orb.access',
  expires_at: '2026-09-20T00:00:00.000Z',
};
let privateKey: CryptoKey;
let jwks: JWTVerifyGetKey;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  jwks = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: 'test-key', alg: 'RS256', use: 'sig' }] });
});

async function token(overrides: Record<string, unknown> = {}, key = privateKey) {
  return new SignJWT({
    iss: config.issuer, aud: config.audience, sub: '', common_name: config.client_id,
    iat: seconds, exp: seconds + 300, ...overrides,
  }).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).sign(key);
}

const request = (value?: string) => new Request('https://portal.example/v1/test/commands', {
  headers: value ? { 'Cf-Access-Jwt-Assertion': value } : {},
});
const verify = async (value: string, changed = config, at = now) =>
  authenticateTestPrincipal(request(value), changed, { jwks, now: at });

describe('Cloudflare Access test service principal', () => {
  it('parses only a separate test audience without preventing expired-campaign startup',()=>{
    const owner={AUTH_MODE:'access',ACCESS_ISSUER:config.issuer,ACCESS_AUD:'owner-audience'};
    expect(parseTestAuthConfig(undefined,owner)).toBeUndefined();
    expect(parseTestAuthConfig(JSON.stringify(config),owner)).toEqual(config);
    for(const change of [{audience:owner.ACCESS_AUD},{issuer:'https://other.cloudflareaccess.com'},{extra:true}]){
      expect(()=>parseTestAuthConfig(JSON.stringify({...config,...change}),owner)).toThrow();
    }
    expect(()=>parseTestAuthConfig(JSON.stringify(config),{...owner,AUTH_MODE:'local'})).toThrow();
  });

  it('accepts only signed service claims and returns a separate stable actor', async () => {
    await expect(verify(await token())).resolves.toBe(`test-service:${config.client_id}`);
    await expect(verify(await token({ sub: 'owner-sub' }))).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
  });

  it.each([
    ['issuer', { iss: 'https://other.cloudflareaccess.com' }],
    ['audience', { aud: 'owner-portal-audience' }],
    ['client ID', { common_name: 'another-service.access' }],
    ['missing service ID', { common_name: undefined }],
    ['future issued-at', { iat: seconds + 1 }],
    ['expired token', { exp: seconds - 1 }],
  ])('rejects wrong %s claims', async (_label, claims) => {
    await expect(verify(await token(claims))).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
  });

  it('rejects a signature from another key', async () => {
    const other = await generateKeyPair('RS256');
    await expect(verify(await token({}, other.privateKey))).rejects.toMatchObject({ status: 401 });
  });

  it('enforces the exact campaign expiry boundary', async () => {
    const jwt = await token({ exp: seconds + 86_400 });
    await expect(verify(jwt, config, new Date('2026-09-19T23:59:59.999Z'))).resolves.toBe(`test-service:${config.client_id}`);
    await expect(verify(jwt, config, new Date(config.expires_at))).rejects.toMatchObject({ status: 401 });
  });

  it.each([
    { issuer: 'http://hehebot-test.cloudflareaccess.com' },
    { issuer: 'https://cloudflareaccess.com' },
    { issuer: 'https://hehebot-test.cloudflareaccess.com/path' },
    { audience: '' },
    { client_id: '' },
    { expires_at: 'not-a-date' },
    { expires_at: '2026-09-20T00:00:00.001Z' },
  ])('fails closed for bad configuration %j', async (patch) => {
    await expect(verify(await token(), { ...config, ...patch })).rejects.toMatchObject({
      code: 'AUTH_CONFIGURATION_REQUIRED', status: 503,
    });
  });

  it('has no header fallback, bounds tokens, and never exposes token or identity in errors', async () => {
    await expect(authenticateTestPrincipal(new Request('https://portal.example/v1/test/commands', {
      headers: { 'Cf-Access-Authenticated-User-Email': 'owner@example.com', 'X-Test-Principal': config.client_id },
    }), config, { jwks, now })).rejects.toMatchObject({ status: 401 });
    await expect(verify('x'.repeat(16_385))).rejects.toMatchObject({ status: 401 });
    const sensitive = await token({ common_name: 'secret-client-value' });
    try {
      await verify(sensitive);
      throw new Error('expected authentication rejection');
    } catch (error) {
      const rendered = `${(error as Error).message} ${JSON.stringify(error)}`;
      expect(rendered).not.toContain(sensitive);
      expect(rendered).not.toContain('secret-client-value');
      expect(rendered).not.toContain(config.client_id);
    }
  });
});
