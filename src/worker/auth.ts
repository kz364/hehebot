import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTVerifyGetKey } from 'jose';
import { createHash, timingSafeEqual } from 'node:crypto';
import { ControlError } from '../core/errors';
import type { Database } from '../core/store';

export interface AuthConfig {
  AUTH_MODE: string;
  INSTALLATION_ID: string;
  ACCESS_ISSUER: string;
  ACCESS_AUD: string;
  OWNER_SUB: string;
}
export interface AuthVerificationOptions { jwks?: JWTVerifyGetKey; now?: Date }
export interface RuntimeGenerationAuthority { epoch:number;boot_id:string;transition_id:string }
const resolvers = new Map<string, JWTVerifyGetKey>();
const unauthorized = () => new ControlError('UNAUTHORIZED', 'Authentication is required.', 401);
const configurationError = () => new ControlError('AUTH_CONFIGURATION_REQUIRED', 'Authentication is not configured.', 503);

function accessIssuer(config: AuthConfig): URL {
  if (config.AUTH_MODE !== 'access' || !config.ACCESS_ISSUER || !config.ACCESS_AUD || !config.OWNER_SUB) throw configurationError();
  let issuer: URL;
  try { issuer = new URL(config.ACCESS_ISSUER); } catch { throw configurationError(); }
  // Issuer is trusted deployment configuration, never a value taken from token claims.
  if (issuer.protocol !== 'https:' || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer.hostname) ||
      issuer.port || issuer.username || issuer.password || issuer.search || issuer.hash || issuer.pathname !== '/') throw configurationError();
  return issuer;
}

/** Bind hosted data before seeding it. Configuration changes are not ownership migration. */
export function bindOwnerAuth(db: Database, config: AuthConfig): string | undefined {
  return db.transaction(() => {
    const key = 'installation_owner';
    const saved = db.all<{ value_json: string }>('SELECT value_json FROM runtime_metadata WHERE key=?', key)[0];
    if (!saved && config.AUTH_MODE !== 'access') return; // Preserve existing local-only installations.
    const binding = JSON.stringify({ auth_mode: config.AUTH_MODE, installation_id: config.INSTALLATION_ID,
      issuer: config.ACCESS_ISSUER, audience: config.ACCESS_AUD, owner_subject: config.OWNER_SUB });
    const migrationRequired = () => new ControlError('OWNER_MIGRATION_REQUIRED', 'Installation ownership differs or is unbound. Explicit migration is required.', 503);
    if (saved) {
      if (saved.value_json !== binding) throw migrationRequired();
      return createHash('sha256').update(binding).digest('hex');
    }
    accessIssuer(config);
    if (!config.INSTALLATION_ID) throw configurationError();
    if (db.all('SELECT 1 FROM objects UNION ALL SELECT 1 FROM commands UNION ALL SELECT 1 FROM runtime_metadata LIMIT 1').length) throw migrationRequired();
    db.exec('INSERT INTO runtime_metadata(key,value_json) VALUES(?,?)', key, binding);
    return createHash('sha256').update(binding).digest('hex');
  });
}

/** Local bypass is only for a loopback-bound wrangler dev process. Never expose that
 * listener through a reverse proxy/tunnel: URL host validation is not a network ACL.
 * X-Forwarded-Host and identity/email headers are deliberately ignored.
 */
export async function authenticateOwner(request: Request, config: AuthConfig, options: AuthVerificationOptions = {}): Promise<string> {
  if (config.AUTH_MODE === 'local') {
    if (config.INSTALLATION_ID !== 'local-only' || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(request.url).hostname)) throw unauthorized();
    return 'local-owner';
  }
  const issuer = accessIssuer(config);
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

/** Deployment-owned generation pin. It is parsed only after bearer authentication
 * and passed over the private Worker-to-Durable-Object RPC boundary. */
export function runtimeGenerationAuthority(value?:string):RuntimeGenerationAuthority|undefined {
  if(value===undefined||value==='')return undefined;
  let parsed:unknown;
  try{parsed=JSON.parse(value);}catch{throw configurationError();}
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw configurationError();
  const authority=parsed as Record<string,unknown>;
  if(Object.keys(authority).sort().join(',')!=='boot_id,epoch,transition_id'||!Number.isSafeInteger(authority.epoch)||Number(authority.epoch)<1||
    typeof authority.boot_id!=='string'||!uuid.test(authority.boot_id)||typeof authority.transition_id!=='string'||!uuid.test(authority.transition_id))throw configurationError();
  return {epoch:Number(authority.epoch),boot_id:authority.boot_id.toLowerCase(),transition_id:authority.transition_id.toLowerCase()};
}

export interface RuntimeTaskGrant extends RuntimeGenerationAuthority {
  installation_id:string;owner_binding_sha256:string;run_id:string;manifest_sha256:string;
  issued_at:string;expires_at:string;
}
const taskAudience='hehebot-runtime-task';
const taskTokenType='hehebot-runtime-task+jwt';

function taskSigningKey(secret:string):Uint8Array {
  if(typeof secret!=='string'||!/^[\x21-\x7e]{32,256}$/.test(secret))throw configurationError();
  return new TextEncoder().encode(secret);
}

/** Manager possession must not reveal the task-signing key or revive a legacy
 * runtime credential. The signing key stays exclusively in the control plane. */
export function assertBootstrapSecrets(managerToken:string|undefined,signingSecret:string|undefined,legacyToken?:string):void {
  if(!managerToken||!signingSecret||managerToken===signingSecret||managerToken===legacyToken||signingSecret===legacyToken)throw configurationError();
  taskSigningKey(managerToken);taskSigningKey(signingSecret);
}

function runtimeTaskGrant(value:unknown):RuntimeTaskGrant {
  if(!value||typeof value!=='object'||Array.isArray(value))throw configurationError();
  const g=value as RuntimeTaskGrant;
  if(Object.keys(g).sort().join(',')!=='boot_id,epoch,expires_at,installation_id,issued_at,manifest_sha256,owner_binding_sha256,run_id,transition_id'||
    typeof g.installation_id!=='string'||!g.installation_id||g.installation_id.length>256||
    typeof g.owner_binding_sha256!=='string'||!/^[a-f0-9]{64}$/.test(g.owner_binding_sha256)||
    typeof g.manifest_sha256!=='string'||!/^[a-f0-9]{64}$/.test(g.manifest_sha256)||
    typeof g.run_id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(g.run_id))throw configurationError();
  for(const timestamp of [g.issued_at,g.expires_at]){
    if(typeof timestamp!=='string'||!Number.isFinite(Date.parse(timestamp))||new Date(timestamp).toISOString()!==timestamp)throw configurationError();
  }
  const duration=Date.parse(g.expires_at)-Date.parse(g.issued_at);
  if(duration<1000||duration>300000)throw configurationError();
  const generation=runtimeGenerationAuthority(JSON.stringify({epoch:g.epoch,boot_id:g.boot_id,transition_id:g.transition_id}))!;
  return {...generation,installation_id:g.installation_id,owner_binding_sha256:g.owner_binding_sha256,
    run_id:g.run_id,manifest_sha256:g.manifest_sha256,issued_at:g.issued_at,expires_at:g.expires_at};
}

/** Sign only an immutable DO-issued assignment. Re-reading it must produce the
 * same token and fixed expiry, never a fresh lease. This is not manager authority. */
export async function issueRuntimeTaskToken(value:RuntimeTaskGrant,secret:string):Promise<string> {
  const grant=runtimeTaskGrant(value),key=taskSigningKey(secret);
  const issued=Math.floor(Date.parse(grant.issued_at)/1000),expires=Math.floor(Date.parse(grant.expires_at)/1000);
  return new SignJWT({grant}).setProtectedHeader({alg:'HS256',typ:taskTokenType})
    .setIssuer(`hehebot:${grant.installation_id}`).setAudience(taskAudience).setSubject(grant.run_id)
    .setIssuedAt(issued).setNotBefore(issued).setExpirationTime(expires).sign(key);
}

/** Authentication is only the first gate: the DO must match manifest hash, exact
 * assigned run and current generation before granting any runtime operation. */
export async function verifyRuntimeTaskToken(request:Request,secret:string,
  expected:{installation_id:string;owner_binding_sha256:string},now=new Date()):Promise<RuntimeTaskGrant> {
  const key=taskSigningKey(secret);
  if(!expected.installation_id||!/^[a-f0-9]{64}$/.test(expected.owner_binding_sha256))throw configurationError();
  const authorization=request.headers.get('Authorization')??'';
  if(!authorization.startsWith('Bearer ')||authorization.length>16384)throw unauthorized();
  try{
    const {payload}=await jwtVerify(authorization.slice(7),key,{algorithms:['HS256'],typ:taskTokenType,
      issuer:`hehebot:${expected.installation_id}`,audience:taskAudience,currentDate:now,clockTolerance:0,
      requiredClaims:['iss','aud','sub','iat','nbf','exp','grant']});
    const grant=runtimeTaskGrant(payload.grant),issued=Math.floor(Date.parse(grant.issued_at)/1000);
    if(Object.keys(payload).sort().join(',')!=='aud,exp,grant,iat,iss,nbf,sub'||
      payload.aud!==taskAudience||payload.sub!==grant.run_id||payload.iat!==issued||payload.nbf!==issued||
      payload.exp!==Math.floor(Date.parse(grant.expires_at)/1000)||grant.installation_id!==expected.installation_id||
      grant.owner_binding_sha256!==expected.owner_binding_sha256||!Number.isFinite(now.getTime())||
      Date.parse(grant.issued_at)>now.getTime()||Date.parse(grant.expires_at)<=now.getTime())throw unauthorized();
    return grant;
  }catch{throw unauthorized();}
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
