import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { timingSafeEqual } from 'node:crypto';
import { ControlError } from '../core/errors';

export interface AuthConfig {
  AUTH_MODE: string;
  INSTALLATION_ID: string;
  ACCESS_ISSUER: string;
  ACCESS_AUD: string;
  OWNER_SUB: string;
}
export interface AuthVerificationOptions { jwks?: JWTVerifyGetKey; now?: Date }
const resolvers = new Map<string, JWTVerifyGetKey>();
const unauthorized = () => new ControlError('UNAUTHORIZED', 'Authentication is required.', 401);
const configurationError = () => new ControlError('AUTH_CONFIGURATION_REQUIRED', 'Authentication is not configured.', 503);

/** Local bypass is only for a loopback-bound wrangler dev process. Never expose that
 * listener through a reverse proxy/tunnel: URL host validation is not a network ACL.
 * X-Forwarded-Host and identity/email headers are deliberately ignored.
 */
export async function authenticateOwner(request: Request, config: AuthConfig, options: AuthVerificationOptions = {}): Promise<string> {
  if (config.AUTH_MODE === 'local') {
    if (config.INSTALLATION_ID !== 'local-only' || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname)) throw unauthorized();
    return 'local-owner';
  }
  if (config.AUTH_MODE !== 'access' || !config.ACCESS_ISSUER || !config.ACCESS_AUD || !config.OWNER_SUB) throw configurationError();
  let issuer: URL;
  try { issuer = new URL(config.ACCESS_ISSUER); } catch { throw configurationError(); }
  // Issuer is trusted deployment configuration, never a value taken from token claims.
  if (issuer.protocol !== 'https:' || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer.hostname) ||
      issuer.port || issuer.username || issuer.password || issuer.search || issuer.hash || issuer.pathname !== '/') throw configurationError();
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || token.length > 16_384) throw unauthorized();
  let jwks = options.jwks ?? resolvers.get(config.ACCESS_ISSUER);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL('/cdn-cgi/access/certs', issuer), { timeoutDuration: 5000 });
    resolvers.set(config.ACCESS_ISSUER, jwks);
  }
  try {
    const { payload } = await jwtVerify(token, jwks, {
      algorithms: ['RS256'], issuer: config.ACCESS_ISSUER, audience: config.ACCESS_AUD,
      subject: config.OWNER_SUB, requiredClaims: ['iss', 'aud', 'sub', 'exp', 'iat'],
      currentDate: options.now ?? new Date(), clockTolerance: 0,
    });
    if (payload.sub !== config.OWNER_SUB) throw unauthorized();
    return payload.sub;
  } catch { throw unauthorized(); }
}

/** Call on every owner browser mutation; Access supplies its HttpOnly session cookie. */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('Origin');
  if (!origin || origin !== new URL(request.url).origin) throw new ControlError('ORIGIN_REJECTED', 'A same-origin request is required.', 403);
  const site = request.headers.get('Sec-Fetch-Site');
  if (site && site !== 'same-origin' && site !== 'none') throw new ControlError('ORIGIN_REJECTED', 'A same-origin request is required.', 403);
}

export function verifyRuntimeToken(request: Request, expectedToken?: string): void {
  if (!expectedToken) throw configurationError();
  const authorization = request.headers.get('Authorization') ?? '';
  const candidate = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const left = new TextEncoder().encode(candidate);
  const right = new TextEncoder().encode(expectedToken);
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw unauthorized();
}

/** HMAC authentication only. The control-store transaction MUST separately dedupe
 * source/event ID for 90 days and reject a changed body under the same event ID.
 * Caller bounds body bytes before entering this function. No JSON reserialization.
 */
export async function verifyWebhook(rawBody: string | Uint8Array, headers: Headers, perSourceSecret: string,
  now = Date.now()): Promise<{ eventId: string; timestamp: number }> {
  if (!perSourceSecret) throw configurationError();
  const timestampText = headers.get('X-Timestamp') ?? '';
  const eventId = headers.get('X-Event-ID') ?? '';
  const signature = headers.get('X-Signature') ?? '';
  if (!/^(0|[1-9][0-9]{0,12})$/.test(timestampText) || !/^[\x21-\x7e]{1,128}$/.test(eventId) || !/^[a-fA-F0-9]{64}$/.test(signature)) throw unauthorized();
  const timestamp = Number(timestampText);
  if (!Number.isFinite(now) || Math.abs(now / 1000 - timestamp) > 300) throw unauthorized();
  const encoder = new TextEncoder();
  const prefix = encoder.encode(`${timestampText}\n${eventId}\n`);
  const body = typeof rawBody === 'string' ? encoder.encode(rawBody) : rawBody;
  const signed = new Uint8Array(prefix.length + body.length);
  signed.set(prefix); signed.set(body, prefix.length);
  const key = await crypto.subtle.importKey('raw', encoder.encode(perSourceSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const signatureBytes = Uint8Array.from(signature.match(/../g)!, (pair) => Number.parseInt(pair, 16));
  if (!await crypto.subtle.verify('HMAC', key, signatureBytes, signed)) throw unauthorized();
  return { eventId, timestamp };
}
