import { requireThat } from './errors';

// Web Push (TODO.md "Push notifications"): VAPID (RFC 8292) request signing and
// aes128gcm message encryption (RFC 8291 + RFC 8188), implemented with
// WebCrypto only (`crypto.subtle`, global in both the Worker and Node >=22 --
// no npm dependency). AGENTS.md forbids depending on hashed/undocumented
// internals; this stays on the published RFCs and the standard Web Crypto API.

const textEncoder = new TextEncoder();

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

/** HEHEBOT_VAPID_PUBLIC_KEY: base64url of the uncompressed P-256 point (65
 * bytes, 0x04 || X || Y) -- used verbatim as both the browser's
 * `applicationServerKey` and the server's `k=` VAPID header parameter.
 * HEHEBOT_VAPID_PRIVATE_KEY: base64url of the DER PKCS8 encoding of the
 * matching P-256 private key. HEHEBOT_VAPID_SUBJECT: a `mailto:` or `https:`
 * URI identifying the sender (RFC 8292 `sub` claim). See docs/PUSH.md for the
 * exact generation command. */
export type VapidKeys = { publicKey: string; privateKeyPkcs8: string; subject: string };
export type PushSubscriptionKeys = { endpoint: string; p256dh: string; auth: string };

async function importVapidPrivateKey(privateKeyPkcs8Base64Url: string): Promise<CryptoKey> {
  const der = base64UrlDecode(privateKeyPkcs8Base64Url);
  return crypto.subtle.importKey('pkcs8', der as unknown as BufferSource, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

/** A VAPID authentication JWT, ES256-signed. `crypto.subtle.sign('ECDSA',...)`
 * already returns the raw r||s signature (64 bytes for P-256) that JWS ES256
 * requires -- no ASN.1/DER conversion needed. */
export async function signVapidJwt(audience: string, keys: VapidKeys, nowMs: number, ttlSeconds = 12 * 3600): Promise<string> {
  const header = base64UrlEncode(textEncoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = base64UrlEncode(textEncoder.encode(JSON.stringify({ aud: audience, exp: Math.floor(nowMs / 1000) + ttlSeconds, sub: keys.subject })));
  const signingInput = `${header}.${payload}`;
  const privateKey = await importVapidPrivateKey(keys.privateKeyPkcs8);
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, textEncoder.encode(signingInput));
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function hmacSha256(keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', keyBytes as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data as unknown as BufferSource));
}

/** RFC 8291 Message Encryption for Web Push, using the aes128gcm content
 * coding of RFC 8188, with WebCrypto only. The salt and the sender's ephemeral
 * public key travel inside the returned body's own header (RFC 8188 section
 * 2), so the only extra HTTP header this needs is `Content-Encoding:
 * aes128gcm`. Single-record only (payload capped well under the 4096-byte
 * default record size), which is all a push notification ever needs. */
export async function encryptWebPushPayload(plaintext: Uint8Array, subscription: Pick<PushSubscriptionKeys, 'p256dh' | 'auth'>): Promise<Uint8Array> {
  requireThat(plaintext.length <= 3800, 'PAYLOAD_TOO_LARGE', 'Push payload exceeds the safe single-record size.', 413);
  const uaPublicKeyBytes = base64UrlDecode(subscription.p256dh);
  requireThat(uaPublicKeyBytes.length === 65 && uaPublicKeyBytes[0] === 0x04, 'INVALID_INPUT', 'Invalid subscription public key.', 422);
  const authSecret = base64UrlDecode(subscription.auth);
  requireThat(authSecret.length === 16, 'INVALID_INPUT', 'Invalid subscription auth secret.', 422);
  const uaPublicKey = await crypto.subtle.importKey('raw', uaPublicKeyBytes as BufferSource, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublicKeyBytes = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPublicKey }, ephemeral.privateKey, 256));
  // RFC 8291 section 3.3-3.4: derive a shared IKM from the ECDH secret and the
  // subscription's own auth secret, bound to both public keys.
  const prkKey = await hmacSha256(authSecret, ecdhSecret);
  const keyInfo = concatBytes(textEncoder.encode('WebPush: info\0'), uaPublicKeyBytes, asPublicKeyBytes);
  const ikm = (await hmacSha256(prkKey, concatBytes(keyInfo, new Uint8Array([1])))).slice(0, 32);
  // RFC 8188 aes128gcm content coding over that IKM, with a fresh random salt.
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmacSha256(salt, ikm);
  const cek = (await hmacSha256(prk, concatBytes(textEncoder.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmacSha256(prk, concatBytes(textEncoder.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const cekKey = await crypto.subtle.importKey('raw', cek as BufferSource, { name: 'AES-GCM' }, false, ['encrypt']);
  // Single record: plaintext || 0x02 delimiter marks the last (only) record.
  const recordPlaintext = concatBytes(plaintext, new Uint8Array([2]));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as unknown as BufferSource, tagLength: 128 }, cekKey, recordPlaintext as unknown as BufferSource));
  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096, false);
  const header = concatBytes(salt, recordSize, new Uint8Array([asPublicKeyBytes.length]), asPublicKeyBytes);
  return concatBytes(header, ciphertext);
}

export type WebPushResult = { ok: boolean; status: number; shouldRemoveSubscription: boolean };

/** Sends one encrypted push message. Never throws: a delivery failure must
 * never propagate into the DO commit/alarm path that triggered it (see
 * push-dispatch.ts and control-object.ts's dispatchPushNotifications). */
export async function sendWebPush(
  subscription: PushSubscriptionKeys, payload: unknown, keys: VapidKeys,
  options: { fetchImpl?: typeof fetch; nowMs?: number; timeoutMs?: number; ttlSeconds?: number } = {},
): Promise<WebPushResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5000;
  try {
    const audience = new URL(subscription.endpoint).origin;
    const jwt = await signVapidJwt(audience, keys, options.nowMs ?? Date.now());
    const body = await encryptWebPushPayload(textEncoder.encode(JSON.stringify(payload)), subscription);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(subscription.endpoint, {
        method: 'POST', signal: controller.signal,
        headers: {
          'Content-Type': 'application/octet-stream', 'Content-Encoding': 'aes128gcm',
          'TTL': String(options.ttlSeconds ?? 2419200), 'Authorization': `vapid t=${jwt}, k=${keys.publicKey}`,
        },
        body: body as BodyInit,
      });
      return { ok: response.ok, status: response.status, shouldRemoveSubscription: response.status === 404 || response.status === 410 };
    } finally { clearTimeout(timeout); }
  } catch { return { ok: false, status: 0, shouldRemoveSubscription: false }; }
}
