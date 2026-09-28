import { createHash } from 'node:crypto';
import { requireThat } from './errors';
import { Store } from './store';

export type PushSubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string } };
export type StoredPushSubscription = { endpoint_sha256: string; endpoint: string; p256dh: string; auth: string };

const MAX_ENDPOINT = 2048;
const B64URL = /^[A-Za-z0-9_-]+$/;
export const MAX_PUSH_SUBSCRIPTIONS = 20;

function endpointHash(endpoint: string): string { return createHash('sha256').update(endpoint).digest('hex'); }

/** The exact shape of the browser's `PushSubscription.toJSON()` (RFC 8030
 * subscription resource + RFC 8291 key material). Never accepted without this
 * check: an http:// or malformed endpoint would otherwise be stored and later
 * handed to `fetch` from the Worker. */
export function validatePushSubscription(input: unknown): input is PushSubscriptionInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => key !== 'endpoint' && key !== 'keys' && key !== 'expirationTime')) return false;
  if (typeof value.endpoint !== 'string' || value.endpoint.length < 1 || value.endpoint.length > MAX_ENDPOINT) return false;
  if (!/^https:\/\//i.test(value.endpoint)) return false;
  try { new URL(value.endpoint); } catch { return false; }
  const keys = value.keys;
  if (!keys || typeof keys !== 'object' || Array.isArray(keys)) return false;
  const k = keys as Record<string, unknown>;
  if (Object.keys(k).some(key => key !== 'p256dh' && key !== 'auth')) return false;
  if (typeof k.p256dh !== 'string' || k.p256dh.length < 1 || k.p256dh.length > 256 || !B64URL.test(k.p256dh)) return false;
  if (typeof k.auth !== 'string' || k.auth.length < 1 || k.auth.length > 64 || !B64URL.test(k.auth)) return false;
  return true;
}

/** Owner-command storage for Web Push subscriptions. This is display/delivery
 * metadata only, parallel to RosterLedger: it grants no execution authority
 * and its rows are consulted only by the push dispatch hook (push-dispatch.ts),
 * never by admission or task logic. */
export class PushSubscriptions {
  constructor(private store: Store, private now: () => string) {}

  subscribe(owner: string, input: PushSubscriptionInput): string {
    requireThat(validatePushSubscription(input), 'INVALID_INPUT', 'Invalid push subscription.', 422);
    return this.store.db.transaction(() => {
      const hash = endpointHash(input.endpoint);
      const existing = this.store.db.all<{ endpoint_sha256: string }>('SELECT endpoint_sha256 FROM push_subscriptions WHERE endpoint_sha256=?', hash)[0];
      if (!existing) {
        const count = this.store.db.all<{ n: number }>('SELECT COUNT(*) AS n FROM push_subscriptions')[0].n;
        requireThat(count < MAX_PUSH_SUBSCRIPTIONS, 'RATE_LIMITED', 'Too many push subscriptions are registered.', 429);
      }
      this.store.db.exec(
        'INSERT INTO push_subscriptions(endpoint_sha256,endpoint,p256dh,auth,owner_id,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(endpoint_sha256) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth,owner_id=excluded.owner_id',
        hash, input.endpoint, input.keys.p256dh, input.keys.auth, owner, this.now());
      return hash;
    });
  }

  unsubscribe(input: unknown): string {
    requireThat(input && typeof input === 'object' && !Array.isArray(input) &&
      typeof (input as { endpoint?: unknown }).endpoint === 'string' &&
      (input as { endpoint: string }).endpoint.length >= 1 && (input as { endpoint: string }).endpoint.length <= MAX_ENDPOINT,
    'INVALID_INPUT', 'Invalid push endpoint.', 422);
    const hash = endpointHash((input as { endpoint: string }).endpoint);
    this.store.db.exec('DELETE FROM push_subscriptions WHERE endpoint_sha256=?', hash);
    return hash;
  }

  list(): StoredPushSubscription[] {
    return this.store.db.all<StoredPushSubscription>('SELECT endpoint_sha256,endpoint,p256dh,auth FROM push_subscriptions ORDER BY created_at,endpoint_sha256');
  }

  removeByEndpoint(endpoint: string): void { this.store.db.exec('DELETE FROM push_subscriptions WHERE endpoint_sha256=?', endpointHash(endpoint)); }

  count(): number { return this.store.db.all<{ n: number }>('SELECT COUNT(*) AS n FROM push_subscriptions')[0].n; }
}
