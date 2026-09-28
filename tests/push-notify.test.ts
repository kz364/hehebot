import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { TestDatabase, bot, otherBot } from './helpers';
import { Store } from '../src/core/store';
import { selectPushNotifications, PushThrottle, PUSH_THROTTLE_WINDOW_MS } from '../src/core/push-notify';
import { preparePushDispatch, runPushDispatch, type PushJob } from '../src/core/push-dispatch';
import { PushSubscriptions } from '../src/core/push-subscriptions';

const now = '2026-09-28T12:00:00.000Z';
let db: TestDatabase, store: Store;
beforeEach(() => {
  db = new TestDatabase();
  db.exec("INSERT INTO lifecycle(singleton,provider_ref_json,phase,desired_state) VALUES(1,'{}','STOPPED','STOP')");
  store = new Store(db);
  store.put(bot, 'persona', { name: 'Chief of Staff' }, 0, 'owner', now);
  store.put(otherBot, 'persona', { name: 'Inbox Triage' }, 0, 'owner', now);
});
afterEach(() => db.close());

function botMessage(personaId: string, text: string) {
  return store.event(randomUUID(), personaId, 'bot.message', personaId, null, { text, run_id: randomUUID(), attempt: 1, task_run_id: null, origin: 'tool', reply_to_event_id: null }, now);
}
function notice(personaId: string, kind: string, reason = 'SOMETHING') {
  return store.event(randomUUID(), personaId, 'notice', 'system', null, { kind, reason }, now);
}

it('selects a bot.message with the persona name, truncated body, tag and url', () => {
  botMessage(bot, 'Here is the research summary you asked for, with a lot of extra detail that keeps going past one hundred and forty characters so it must be truncated for the push body.');
  const { notifications, nextCursor } = selectPushNotifications(store, 0, now);
  expect(notifications).toHaveLength(1);
  const n = notifications[0];
  expect(n.persona_id).toBe(bot);
  expect(n.title).toBe('Chief of Staff');
  expect(n.tag).toBe(bot);
  expect(n.url).toBe(`/?bot=${bot}`);
  expect([...n.body]).toHaveLength(140);
  expect(nextCursor).toBe(n.event_sequence);
});

it('selects needs_you/runtime/degraded notices but not other notice kinds', () => {
  notice(bot, 'needs_you', 'INTERRUPTED');
  notice(bot, 'runtime', 'STUCK_NO_PROGRESS');
  notice(bot, 'degraded', 'MEMORY_TOKENIZER_UNCONFIGURED');
  notice(bot, 'informational', 'not a push kind');
  const { notifications } = selectPushNotifications(store, 0, now);
  expect(notifications).toHaveLength(3);
  expect(notifications.map(n => n.body)).toEqual([
    'Needs your input: INTERRUPTED', 'Runtime notice: STUCK_NO_PROGRESS', 'Running in a degraded mode: MEMORY_TOKENIZER_UNCONFIGURED',
  ]);
});

it('never selects the owner\'s own messages or passive context updates', () => {
  store.event(randomUUID(), bot, 'message.user', 'owner', null, { text: 'Hi there' }, now);
  store.event(randomUUID(), bot, 'room.context_update', bot, null, { text: 'passive update' }, now);
  const { notifications } = selectPushNotifications(store, 0, now);
  expect(notifications).toHaveLength(0);
});

it('only advances the cursor past resolved events, so a later call does not re-select them', () => {
  const first = botMessage(bot, 'first');
  botMessage(bot, 'second');
  const page1 = selectPushNotifications(store, 0, now, 1);
  expect(page1.notifications).toHaveLength(1);
  expect(page1.nextCursor).toBe(first);
  const page2 = selectPushNotifications(store, page1.nextCursor, now);
  expect(page2.notifications).toHaveLength(1);
  expect(page2.notifications[0].body).toBe('second');
});

it('collapses repeated sends for the same persona within the throttle window, per persona', () => {
  const throttle = new PushThrottle(store);
  expect(throttle.shouldSend(bot, now)).toBe(true);
  throttle.recordSent(bot, now);
  expect(throttle.shouldSend(bot, now)).toBe(false);
  expect(throttle.shouldSend(otherBot, now)).toBe(true); // collapse is per-persona
  const justUnder = new Date(Date.parse(now) + PUSH_THROTTLE_WINDOW_MS - 1).toISOString();
  expect(throttle.shouldSend(bot, justUnder)).toBe(false);
  const atWindow = new Date(Date.parse(now) + PUSH_THROTTLE_WINDOW_MS).toISOString();
  expect(throttle.shouldSend(bot, atWindow)).toBe(true);
});

function subscription(id: string) {
  return { endpoint: `https://push.example.com/send/${id}`, keys: { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) } };
}

it('prepares no jobs when there are no subscriptions, but still advances the cursor', () => {
  botMessage(bot, 'hello');
  const { jobs } = preparePushDispatch(store, now);
  expect(jobs).toEqual([]);
  const { notifications } = selectPushNotifications(store, 0, now);
  expect(notifications).toHaveLength(1); // the event itself is untouched
  expect(preparePushDispatch(store, now).jobs).toEqual([]); // re-running finds nothing new to prepare
});

it('prepares one job per notification, fanned out to every current subscription', () => {
  new PushSubscriptions(store, () => now).subscribe('owner', subscription('a'));
  new PushSubscriptions(store, () => now).subscribe('owner', subscription('b'));
  botMessage(bot, 'hello');
  const { jobs } = preparePushDispatch(store, now);
  expect(jobs).toHaveLength(1);
  expect(jobs[0].subscriptions.map(s => s.endpoint).sort()).toEqual([subscription('a').endpoint, subscription('b').endpoint]);
});

it('collapses a second trigger for the same persona inside the window into zero jobs', () => {
  new PushSubscriptions(store, () => now).subscribe('owner', subscription('a'));
  botMessage(bot, 'first');
  expect(preparePushDispatch(store, now).jobs).toHaveLength(1);
  botMessage(bot, 'second');
  const soonAfter = new Date(Date.parse(now) + 1000).toISOString();
  expect(preparePushDispatch(store, soonAfter).jobs).toEqual([]);
  const afterWindow = new Date(Date.parse(now) + PUSH_THROTTLE_WINDOW_MS + 1).toISOString();
  botMessage(bot, 'third');
  expect(preparePushDispatch(store, afterWindow).jobs).toHaveLength(1);
});

it('runPushDispatch removes only the subscriptions a 404/410 was reported for', async () => {
  const subs = new PushSubscriptions(store, () => now);
  subs.subscribe('owner', subscription('keep'));
  subs.subscribe('owner', subscription('gone-404'));
  subs.subscribe('owner', subscription('gone-410'));
  botMessage(bot, 'hello');
  const { jobs } = preparePushDispatch(store, now);
  const sent: string[] = [];
  const results: Record<string, { ok: boolean; status: number; shouldRemoveSubscription: boolean }> = {
    [subscription('keep').endpoint]: { ok: true, status: 201, shouldRemoveSubscription: false },
    [subscription('gone-404').endpoint]: { ok: false, status: 404, shouldRemoveSubscription: true },
    [subscription('gone-410').endpoint]: { ok: false, status: 410, shouldRemoveSubscription: true },
  };
  await runPushDispatch(store, jobs as PushJob[], async (subscriptionRow) => { sent.push(subscriptionRow.endpoint); return results[subscriptionRow.endpoint]; });
  expect(sent.sort()).toEqual([subscription('gone-404').endpoint, subscription('gone-410').endpoint, subscription('keep').endpoint].sort());
  expect(subs.list().map(s => s.endpoint)).toEqual([subscription('keep').endpoint]);
});

it('a send failure that is not 404/410 never removes the subscription', async () => {
  const subs = new PushSubscriptions(store, () => now);
  subs.subscribe('owner', subscription('flaky'));
  botMessage(bot, 'hello');
  const { jobs } = preparePushDispatch(store, now);
  await runPushDispatch(store, jobs as PushJob[], async () => ({ ok: false, status: 500, shouldRemoveSubscription: false }));
  expect(subs.list()).toHaveLength(1);
});
