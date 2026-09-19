import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { ControlError } from '../core/errors';

export interface TestAuthConfig {
  issuer: string;
  audience: string;
  client_id: string;
  expires_at: string;
}

const resolvers = new Map<string, JWTVerifyGetKey>();
const unauthorized = () => new ControlError('UNAUTHORIZED', 'Authentication is required.', 401);
const configurationError = () => new ControlError('AUTH_CONFIGURATION_REQUIRED', 'Authentication is not configured.', 503);

/** Separate Access application: never reuse the production owner's audience. */
export function parseTestAuthConfig(raw:string|undefined,owner:{AUTH_MODE:string;ACCESS_ISSUER:string;ACCESS_AUD:string}):TestAuthConfig|undefined {
  if(!raw)return undefined;
  let config:TestAuthConfig;
  try{config=JSON.parse(raw);}catch{throw configurationError();}
  if(!config||typeof config!=='object'||Array.isArray(config)||
      Object.keys(config).sort().join(',')!=='audience,client_id,expires_at,issuer'||
      owner.AUTH_MODE!=='access'||config.issuer!==owner.ACCESS_ISSUER||config.audience===owner.ACCESS_AUD)throw configurationError();
  // Expired campaigns must not prevent ordinary owner/internal startup. Requests
  // enforce current time; parsing checks configuration without granting access.
  validateConfig(config,new Date(config.expires_at));
  return config;
}

function validateConfig(config: TestAuthConfig, now: Date): { issuer: URL; campaignExpiry: number } {
  if (!config || typeof config !== 'object' || !Number.isFinite(now.getTime()) ||
      typeof config.issuer !== 'string' || typeof config.audience !== 'string' ||
      typeof config.client_id !== 'string' || typeof config.expires_at !== 'string' ||
      !/^[\x21-\x7e]{1,512}$/.test(config.audience) ||
      !/^[\x21-\x7e]{1,256}$/.test(config.client_id)) throw configurationError();
  let issuer: URL;
  try { issuer = new URL(config.issuer); } catch { throw configurationError(); }
  if (issuer.protocol !== 'https:' || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer.hostname) ||
      issuer.port || issuer.username || issuer.password || issuer.search || issuer.hash || issuer.pathname !== '/') throw configurationError();
  const campaignExpiry = Date.parse(config.expires_at);
  if (!Number.isFinite(campaignExpiry) || new Date(campaignExpiry).toISOString() !== config.expires_at ||
      campaignExpiry > now.getTime() + 24 * 60 * 60 * 1000) throw configurationError();
  return { issuer, campaignExpiry };
}

/** Verify the dedicated Access service identity only. Route authorization, grants,
 * admission, rate limits, and context binding remain the caller's responsibility. */
export async function authenticateTestPrincipal(
  request: Request,
  config: TestAuthConfig,
  options: { jwks?: JWTVerifyGetKey; now?: Date } = {},
): Promise<string> {
  const now = options.now ?? new Date();
  const { issuer, campaignExpiry } = validateConfig(config, now);
  if (campaignExpiry <= now.getTime()) throw unauthorized();
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token || token.length > 16_384) throw unauthorized();
  let jwks = options.jwks ?? resolvers.get(config.issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL('/cdn-cgi/access/certs', issuer), { timeoutDuration: 5000 });
    resolvers.set(config.issuer, jwks);
  }
  try {
    const { payload } = await jwtVerify(token, jwks, {
      algorithms: ['RS256'],
      issuer: config.issuer,
      audience: config.audience,
      requiredClaims: ['iss', 'aud', 'sub', 'exp', 'iat', 'common_name'],
      currentDate: now,
      clockTolerance: 0,
    });
    const nowSeconds = now.getTime() / 1000;
    if (payload.sub !== '' || payload.common_name !== config.client_id ||
        typeof payload.iat !== 'number' || !Number.isInteger(payload.iat) || payload.iat > nowSeconds ||
        typeof payload.exp !== 'number' || !Number.isInteger(payload.exp)) throw unauthorized();
    return `test-service:${config.client_id}`;
  } catch {
    throw unauthorized();
  }
}
