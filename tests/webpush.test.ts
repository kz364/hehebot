import { createECDH, createHmac, createDecipheriv, generateKeyPairSync, verify as nodeVerify, randomBytes } from 'node:crypto';
import { expect, it } from 'vitest';
import { encryptWebPushPayload, sendWebPush, signVapidJwt, type VapidKeys } from '../src/core/webpush';

function b64url(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(value: string): Buffer {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

function generateVapidPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicDer = publicKey.export({ type: 'spki', format: 'der' });
  const publicRaw = publicDer.subarray(publicDer.length - 65); // uncompressed point is the last 65 bytes of the SPKI DER
  const privateDer = privateKey.export({ type: 'pkcs8', format: 'der' });
  return { publicKeyObject: publicKey, publicRawB64url: b64url(publicRaw), privatePkcs8B64url: b64url(privateDer) };
}

function generateUaPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicDer = publicKey.export({ type: 'spki', format: 'der' });
  const publicRaw = publicDer.subarray(publicDer.length - 65);
  return { privateKey, publicRawB64url: b64url(publicRaw) };
}

it('encrypts a push payload that an independent RFC 8291/8188 Node implementation can decrypt', async () => {
  const ua = generateUaPair();
  const authSecret = randomBytes(16);
  const subscription = { p256dh: ua.publicRawB64url, auth: b64url(authSecret) };
  const payload = { title: 'Chief of Staff', body: 'The flight research task finished.', tag: 'persona-1', url: '/?bot=persona-1' };
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));

  const body = Buffer.from(await encryptWebPushPayload(plaintext, subscription));
  expect(body.length).toBeGreaterThan(21 + 65 + 16); // header + at least the GCM tag

  const salt = body.subarray(0, 16);
  const recordSize = body.readUInt32BE(16);
  const idLen = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idLen);
  const ciphertext = body.subarray(21 + idLen);
  expect(recordSize).toBe(4096);
  expect(idLen).toBe(65);
  expect(salt).toHaveLength(16);

  const uaJwk = ua.privateKey.export({ format: 'jwk' }) as { d: string };
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.from(uaJwk.d, 'base64url'));
  const ecdhSecret = ecdh.computeSecret(asPublic);

  const prkKey = createHmac('sha256', authSecret).update(ecdhSecret).digest();
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), fromB64url(ua.publicRawB64url), asPublic]);
  const ikm = createHmac('sha256', prkKey).update(Buffer.concat([keyInfo, Buffer.from([1])])).digest();
  const prk = createHmac('sha256', salt).update(ikm).digest();
  const cek = createHmac('sha256', prk).update(Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).digest().subarray(0, 16);
  const nonce = createHmac('sha256', prk).update(Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).digest().subarray(0, 12);

  const tag = ciphertext.subarray(ciphertext.length - 16);
  const encrypted = ciphertext.subarray(0, ciphertext.length - 16);
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(tag);
  const plaintextWithDelimiter = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  expect(plaintextWithDelimiter.at(-1)).toBe(2); // RFC 8188 last-record delimiter
  const decrypted = plaintextWithDelimiter.subarray(0, -1);
  expect(JSON.parse(decrypted.toString('utf8'))).toEqual(payload);
});

it('signs a VAPID JWT that an independent Node ECDSA verification accepts, with the right claims', async () => {
  const vapid = generateVapidPair();
  const keys: VapidKeys = { publicKey: vapid.publicRawB64url, privateKeyPkcs8: vapid.privatePkcs8B64url, subject: 'mailto:owner@example.com' };
  const nowMs = Date.parse('2026-09-28T12:00:00.000Z');
  const jwt = await signVapidJwt('https://fcm.googleapis.com', keys, nowMs, 3600);
  const [headerB64, payloadB64, sigB64] = jwt.split('.');
  const header = JSON.parse(fromB64url(headerB64).toString('utf8'));
  const payload = JSON.parse(fromB64url(payloadB64).toString('utf8'));
  expect(header).toEqual({ typ: 'JWT', alg: 'ES256' });
  expect(payload).toEqual({ aud: 'https://fcm.googleapis.com', exp: Math.floor(nowMs / 1000) + 3600, sub: 'mailto:owner@example.com' });

  const signature = fromB64url(sigB64);
  expect(signature).toHaveLength(64); // raw r||s, not DER
  const ok = nodeVerify('sha256', Buffer.from(`${headerB64}.${payloadB64}`), { key: vapid.publicKeyObject, dsaEncoding: 'ieee-p1363' }, signature);
  expect(ok).toBe(true);

  const tampered = `${headerB64}.${b64url(Buffer.from(JSON.stringify({ ...payload, sub: 'mailto:attacker@example.com' })))}`;
  expect(nodeVerify('sha256', Buffer.from(tampered), { key: vapid.publicKeyObject, dsaEncoding: 'ieee-p1363' }, signature)).toBe(false);
});

it('sendWebPush posts the encrypted body with the right headers and reports 404/410 for removal', async () => {
  const ua = generateUaPair();
  const vapid = generateVapidPair();
  const keys: VapidKeys = { publicKey: vapid.publicRawB64url, privateKeyPkcs8: vapid.privatePkcs8B64url, subject: 'mailto:owner@example.com' };
  const subscription = { endpoint: 'https://push.example.com/send/abc123', p256dh: ua.publicRawB64url, auth: b64url(randomBytes(16)) };
  let seenRequest: { url: string; init: RequestInit } | null = null;
  const fetchImpl = (async (url: string, init: RequestInit) => { seenRequest = { url: String(url), init }; return new Response(null, { status: 201 }); }) as typeof fetch;

  const ok = await sendWebPush(subscription, { title: 'x', body: 'y', tag: 'z', url: '/' }, keys, { fetchImpl });
  expect(ok).toEqual({ ok: true, status: 201, shouldRemoveSubscription: false });
  expect(seenRequest).not.toBeNull();
  const headers = seenRequest!.init.headers as Record<string, string>;
  expect(headers['Content-Encoding']).toBe('aes128gcm');
  expect(headers['Content-Type']).toBe('application/octet-stream');
  expect(headers['Authorization']).toMatch(new RegExp(`^vapid t=[^,]+, k=${vapid.publicRawB64url}$`));
  expect(seenRequest!.url).toBe(subscription.endpoint);

  for (const status of [404, 410]) {
    const removalFetch = (async () => new Response(null, { status })) as typeof fetch;
    const result = await sendWebPush(subscription, { title: 'x' }, keys, { fetchImpl: removalFetch });
    expect(result).toEqual({ ok: false, status, shouldRemoveSubscription: true });
  }

  const otherFailureFetch = (async () => new Response(null, { status: 500 })) as typeof fetch;
  expect(await sendWebPush(subscription, { title: 'x' }, keys, { fetchImpl: otherFailureFetch })).toEqual({ ok: false, status: 500, shouldRemoveSubscription: false });

  const throwingFetch = (async () => { throw new Error('network down'); }) as typeof fetch;
  expect(await sendWebPush(subscription, { title: 'x' }, keys, { fetchImpl: throwingFetch })).toEqual({ ok: false, status: 0, shouldRemoveSubscription: false });
});
