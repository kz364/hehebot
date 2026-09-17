import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

/** Temporary identity-only deployment. No assets, storage, runtime or control bindings. */
interface BootstrapConfig {
  BOOTSTRAP_HOST: string;
  ACCESS_ISSUER: string;
  ACCESS_AUD: string;
  OWNER_EMAIL: string;
}

export async function bootstrapIdentity(request: Request, env: BootstrapConfig,
  options: { jwks?: JWTVerifyGetKey; now?: Date } = {}): Promise<Response> {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
  const reply = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers });
  const url = new URL(request.url);
  if (!env.BOOTSTRAP_HOST || !/^[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(env.BOOTSTRAP_HOST) ||
    !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_ISSUER) ||
    !env.ACCESS_AUD || !env.OWNER_EMAIL) return reply(503, { error: 'Bootstrap is not configured.' });
  if (url.protocol !== 'https:' || url.host !== env.BOOTSTRAP_HOST ||
    url.pathname !== '/__owner-bootstrap' || request.method !== 'GET') {
    return reply(503, { error: 'Control plane is not published.' });
  }
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || token.length > 16_384) return reply(401, { error: 'Access login required.' });
  try {
    const { payload } = await jwtVerify(token, options.jwks ??
      createRemoteJWKSet(new URL('/cdn-cgi/access/certs', env.ACCESS_ISSUER)), {
      algorithms: ['RS256'], issuer: env.ACCESS_ISSUER, audience: env.ACCESS_AUD,
      requiredClaims: ['iss', 'aud', 'sub', 'email', 'exp', 'iat'], currentDate: options.now,
      clockTolerance: 0,
    });
    if (payload.email !== env.OWNER_EMAIL || typeof payload.sub !== 'string' || !payload.sub) {
      return reply(401, { error: 'Access login required.' });
    }
    return reply(200, { status: 'verified_owner_identity', owner_sub: payload.sub,
      instruction: 'Save owner_sub privately for deployment. This verifies identity only; the portal and database are not available.' });
  } catch {
    return reply(401, { error: 'Access login required.' });
  }
}

export default { fetch: (request: Request, env: BootstrapConfig) => bootstrapIdentity(request, env) };
