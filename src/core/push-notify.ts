import { Store } from './store';

export type PushNotification = { persona_id: string; title: string; body: string; tag: string; url: string; event_sequence: number };

const NOTICE_KINDS = new Set(['needs_you', 'runtime', 'degraded']);
const NOTICE_LABELS: Record<string, string> = { needs_you: 'Needs your input', runtime: 'Runtime notice', degraded: 'Running in a degraded mode' };
export const PUSH_THROTTLE_WINDOW_MS = 10000;

/** Only `bot.message` and a `notice` of kind needs_you/runtime/degraded ever
 * become a push. `message.user` (the owner's own messages) and every passive
 * context/room event are excluded by construction: they are simply not one of
 * these two event types. */
function bodyFor(type: string, payload: Record<string, unknown>): string | null {
  if (type === 'bot.message') {
    const text = typeof payload.text === 'string' ? payload.text : '';
    return text ? [...text].slice(0, 140).join('') : null;
  }
  if (type === 'notice') {
    const kind = payload.kind;
    if (typeof kind !== 'string' || !NOTICE_KINDS.has(kind)) return null;
    const reason = typeof payload.reason === 'string' && payload.reason ? payload.reason : kind;
    return `${NOTICE_LABELS[kind]}: ${reason}`;
  }
  return null;
}

/** Pure selection over the committed timeline: which events since `since`
 * (exclusive) should become a push notification, independent of who is
 * subscribed, whether sending will succeed, or the 10s collapse window. Reuses
 * Store.events(), the same query family the /v1/stream broadcast and /v1/state
 * long-poll fallback already read from (ARCHITECTURE_V2 A6) -- one committed
 * timeline, several readers. */
export function selectPushNotifications(store: Store, since: number, now: string, limit = 200): { notifications: PushNotification[]; nextCursor: number } {
  const events = store.events(since, limit, now);
  const notifications: PushNotification[] = [];
  const names = new Map<string, string | null>();
  for (const event of events) {
    if (event.type !== 'bot.message' && event.type !== 'notice') continue;
    if (!event.conversation_id) continue;
    const body = bodyFor(event.type, event.payload);
    if (body === null) continue;
    if (!names.has(event.conversation_id)) {
      const row = store.db.all<{ body_json: string; kind: string }>('SELECT body_json,kind FROM objects WHERE id=? AND deleted_at IS NULL', event.conversation_id)[0];
      names.set(event.conversation_id, row && row.kind === 'persona' ? (JSON.parse(row.body_json) as { name: string }).name : null);
    }
    const name = names.get(event.conversation_id);
    if (!name) continue; // a room conversation, or a persona that no longer resolves: never guess a title
    notifications.push({ persona_id: event.conversation_id, title: name, body, tag: event.conversation_id, url: `/?bot=${event.conversation_id}`, event_sequence: event.sequence });
  }
  return { notifications, nextCursor: events.at(-1)?.sequence ?? since };
}

/** Collapses repeated pushes for the same persona within PUSH_THROTTLE_WINDOW_MS
 * (the OS-level collapse is `tag`; this is the send-side collapse so a burst of
 * bot messages does not also burst pushes). Reads/writes its own small table,
 * never the caller's transaction: a missed collapse window degrades to "one
 * extra push", never a blocked or failed command. */
export class PushThrottle {
  constructor(private store: Store) {}
  shouldSend(personaId: string, now: string): boolean {
    const row = this.store.db.all<{ sent_at: string }>('SELECT sent_at FROM push_throttle WHERE persona_id=?', personaId)[0];
    return !row || Date.parse(now) - Date.parse(row.sent_at) >= PUSH_THROTTLE_WINDOW_MS;
  }
  recordSent(personaId: string, now: string): void {
    this.store.db.exec('INSERT INTO push_throttle(persona_id,sent_at) VALUES(?,?) ON CONFLICT(persona_id) DO UPDATE SET sent_at=excluded.sent_at', personaId, now);
  }
}
