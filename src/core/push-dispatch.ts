import { Store } from './store';
import { PushSubscriptions, type StoredPushSubscription } from './push-subscriptions';
import { PushThrottle, selectPushNotifications, type PushNotification } from './push-notify';

const CURSOR_KEY = 'push-notify-cursor';

export type PushSendResult = { ok: boolean; status: number; shouldRemoveSubscription: boolean };
export type PushSender = (subscription: StoredPushSubscription, notification: PushNotification) => Promise<PushSendResult>;
export type PushJob = { notification: PushNotification; subscriptions: StoredPushSubscription[] };

/** The synchronous half of the push hook: advance the read cursor over the
 * committed timeline, apply the collapse window, and read current
 * subscriptions -- all ordinary DB reads/writes, safe to run inline with
 * broadcastStreamCommit() (ARCHITECTURE_V2 A6's sibling hook). No network
 * call happens here; the caller sends the returned jobs outside any commit
 * (e.g. via ctx.waitUntil), so a push failure can never block or fail the
 * command, event or alarm that produced it. */
export function preparePushDispatch(store: Store, now: string): { jobs: PushJob[] } {
  const cursorRow = store.db.all<{ value_json: string }>('SELECT value_json FROM runtime_metadata WHERE key=?', CURSOR_KEY)[0];
  const since = cursorRow ? (JSON.parse(cursorRow.value_json) as { sequence: number }).sequence : 0;
  const { notifications, nextCursor } = selectPushNotifications(store, since, now);
  if (nextCursor !== since) {
    store.db.exec('INSERT INTO runtime_metadata(key,value_json) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json', CURSOR_KEY, JSON.stringify({ sequence: nextCursor }));
  }
  if (!notifications.length) return { jobs: [] };
  const throttle = new PushThrottle(store);
  const deliverable = notifications.filter(notification => throttle.shouldSend(notification.persona_id, now));
  if (!deliverable.length) return { jobs: [] };
  for (const notification of deliverable) throttle.recordSent(notification.persona_id, now);
  const subscriptions = new PushSubscriptions(store, () => now).list();
  if (!subscriptions.length) return { jobs: [] };
  return { jobs: deliverable.map(notification => ({ notification, subscriptions })) };
}

/** The async half: actually send, and clean up any subscription the push
 * service reports as gone (404/410, RFC 8030 §7). Runs outside the DB
 * transaction that committed the triggering event; every send is independent
 * so one bad subscription never blocks another. */
export async function runPushDispatch(store: Store, jobs: PushJob[], send: PushSender): Promise<void> {
  const toRemove = new Set<string>();
  await Promise.all(jobs.flatMap(job => job.subscriptions.map(async subscription => {
    const result = await send(subscription, job.notification);
    if (result.shouldRemoveSubscription) toRemove.add(subscription.endpoint);
  })));
  if (!toRemove.size) return;
  const subscriptions = new PushSubscriptions(store, () => new Date().toISOString());
  for (const endpoint of toRemove) subscriptions.removeByEndpoint(endpoint);
}
