import { afterEach, beforeEach, expect, it } from 'vitest';
import { TestDatabase } from './helpers';
import { Store } from '../src/core/store';
import { MAX_PUSH_SUBSCRIPTIONS, PushSubscriptions, validatePushSubscription } from '../src/core/push-subscriptions';

const now = '2026-09-28T12:00:00.000Z';
let db: TestDatabase, store: Store, subs: PushSubscriptions;
beforeEach(() => { db = new TestDatabase(); store = new Store(db); subs = new PushSubscriptions(store, () => now); });
afterEach(() => db.close());

const valid = { endpoint: 'https://push.example.com/send/abc', keys: { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) } };
const rejects = (fn: () => unknown, code: string) => expect(fn).toThrowError(expect.objectContaining({ code }));

it('accepts a well-formed PushSubscription.toJSON() shape', () => {
  expect(validatePushSubscription(valid)).toBe(true);
});

for (const [label, patch] of [
  ['http endpoint', { endpoint: 'http://push.example.com/send/abc' }],
  ['non-uuid-safe but oversized endpoint', { endpoint: 'https://push.example.com/' + 'a'.repeat(3000) }],
  ['missing keys', { keys: undefined }],
  ['non-base64url p256dh', { keys: { ...valid.keys, p256dh: 'not base64url!!' } }],
  ['empty auth', { keys: { ...valid.keys, auth: '' } }],
  ['extra field', { extra: true }],
] as const) {
  it(`rejects ${label}`, () => {
    expect(validatePushSubscription({ ...valid, ...patch })).toBe(false);
  });
}

it('stores a subscription and lists it back', () => {
  subs.subscribe('owner', valid);
  expect(subs.list()).toEqual([{ endpoint_sha256: expect.any(String), endpoint: valid.endpoint, p256dh: valid.keys.p256dh, auth: valid.keys.auth }]);
  expect(subs.count()).toBe(1);
});

it('re-subscribing the same endpoint updates its keys instead of duplicating the row', () => {
  subs.subscribe('owner', valid);
  const updated = { ...valid, keys: { p256dh: 'C'.repeat(87), auth: 'D'.repeat(22) } };
  subs.subscribe('owner', updated);
  expect(subs.count()).toBe(1);
  expect(subs.list()[0]).toMatchObject({ p256dh: updated.keys.p256dh, auth: updated.keys.auth });
});

it('rejects an invalid subscription with INVALID_INPUT and stores nothing', () => {
  rejects(() => subs.subscribe('owner', { ...valid, endpoint: 'ftp://not-https' }), 'INVALID_INPUT');
  expect(subs.count()).toBe(0);
});

it('caps the number of stored subscriptions', () => {
  for (let i = 0; i < MAX_PUSH_SUBSCRIPTIONS; i++) subs.subscribe('owner', { ...valid, endpoint: `https://push.example.com/send/${i}` });
  rejects(() => subs.subscribe('owner', { ...valid, endpoint: 'https://push.example.com/send/overflow' }), 'RATE_LIMITED');
  expect(subs.count()).toBe(MAX_PUSH_SUBSCRIPTIONS);
});

it('unsubscribe removes exactly the matching endpoint and is idempotent', () => {
  subs.subscribe('owner', valid);
  subs.subscribe('owner', { ...valid, endpoint: 'https://push.example.com/send/other' });
  subs.unsubscribe({ endpoint: valid.endpoint });
  expect(subs.list().map(s => s.endpoint)).toEqual(['https://push.example.com/send/other']);
  expect(() => subs.unsubscribe({ endpoint: valid.endpoint })).not.toThrow(); // already gone
  expect(subs.count()).toBe(1);
});

it('removeByEndpoint (the 404/410 cleanup path) is likewise idempotent', () => {
  subs.subscribe('owner', valid);
  subs.removeByEndpoint(valid.endpoint);
  expect(subs.count()).toBe(0);
  expect(() => subs.removeByEndpoint(valid.endpoint)).not.toThrow();
});
