import type { Identity, LifecycleCore } from './lifecycle';
import type { Store } from './store';
import type { Run } from './types';
import { requireThat } from './errors';

export type BotMessageInput = { run_id: string; attempt: number; message_key: string; text: string; reply_to_event_id?: string | null };
export type BotMessagePayload = { text: string; run_id: string; attempt: number; task_run_id: string | null; origin: 'tool' | 'final_text'; reply_to_event_id: string | null };

const MAX_TEXT_BYTES = 32768;
const MAX_PER_ATTEMPT = 20;
const ACTIVE_STATUSES = ['claimed', 'running', 'finishing', 'cancelling'];

/** V9 (ARCHITECTURE_V2 A8): the conversation a run's hehebot_send_message/
 * final_text lands in. Read only from the run's own admitted context_json --
 * never from a model-supplied argument -- so room targeting cannot be spoofed.
 * A run with no room_id (the overwhelming majority) keeps posting to the
 * bot's own persona conversation, unchanged. */
export function botMessageConversation(store: Store, runId: string, personaId: string): string {
 const row = store.db.all<{ room_id: string | null }>("SELECT json_extract(context_json,'$.room_id') AS room_id FROM runs WHERE id=?", runId)[0];
 return row?.room_id ?? personaId;
}
/** Shared append used by the `hehebot_send_message` tool path and the
 * lifecycle.complete() final_text fallback. A committed bot.message is final:
 * neither caller retracts or edits it afterwards. */
export function appendBotMessageEvent(
 store: Store, uuid: () => string, now: string,
 run: Pick<Run, 'id' | 'persona_id' | 'role'>, attempt: number, text: string,
 origin: 'tool' | 'final_text', replyToEventId: string | null, messageKey: string,
): { event_id: string; sequence: number } {
 const eventId = uuid();
 const payload: BotMessagePayload = { text, run_id: run.id, attempt, task_run_id: run.role === 'background' ? run.id : null, origin, reply_to_event_id: replyToEventId };
 const conversationId = botMessageConversation(store, run.id, run.persona_id);
 const sequence = store.event(eventId, conversationId, 'bot.message', run.persona_id, run.id, payload, now);
 store.db.exec('INSERT INTO bot_messages(message_key,run_id,attempt,event_sequence,origin,created_at) VALUES(?,?,?,?,?,?)', messageKey, run.id, attempt, sequence, origin, now);
 return { event_id: eventId, sequence };
}

/** ARCHITECTURE_V2 A1: the agent speaks only through `hehebot_send_message`.
 * A committed message is final regardless of later turn failure, cancellation
 * or interruption; this class only ever appends, never retracts. */
export class BotMessages {
 constructor(private store: Store, private now: () => string, private uuid: () => string) {}
 post(identity: Identity, input: BotMessageInput, lifecycle: LifecycleCore): { event_id: string; sequence: number } {
  requireThat(typeof input.message_key === 'string' && input.message_key.length >= 1 && input.message_key.length <= 512, 'INVALID_INPUT', 'Invalid message key.', 422);
  requireThat(typeof input.text === 'string' && input.text.length > 0, 'INVALID_INPUT', 'Message text must not be empty.', 422);
  requireThat(new TextEncoder().encode(input.text).length <= MAX_TEXT_BYTES, 'PAYLOAD_TOO_LARGE', 'Message exceeds 32768 bytes.', 413);
  requireThat(input.reply_to_event_id === undefined || input.reply_to_event_id === null || typeof input.reply_to_event_id === 'string', 'INVALID_INPUT', 'Invalid reply target.', 422);
  return this.store.db.transaction(() => {
   lifecycle.authorizeAttempt(identity, input.run_id, input.attempt);
   const run = this.store.db.all<Pick<Run, 'id' | 'current_attempt' | 'status' | 'persona_id' | 'role'>>('SELECT id,current_attempt,status,persona_id,role FROM runs WHERE id=?', input.run_id)[0];
   requireThat(run, 'NOT_FOUND', 'Run unavailable.', 404);
   requireThat(run.current_attempt === input.attempt && ACTIVE_STATUSES.includes(run.status), 'REVISION_CONFLICT', 'Run is not active.');
   const existing = this.store.db.all<{ event_sequence: number }>('SELECT event_sequence FROM bot_messages WHERE message_key=?', input.message_key)[0];
   if (existing) {
    const event = this.store.db.all<{ id: string; payload_json: string }>('SELECT id,payload_json FROM events WHERE sequence=?', existing.event_sequence)[0];
    requireThat(event, 'NOT_FOUND', 'Committed message is unavailable.', 404);
    const payload = JSON.parse(event.payload_json) as BotMessagePayload;
    requireThat(payload.text === input.text, 'IDEMPOTENCY_CONFLICT', 'Message key conflicts with different text.');
    return { event_id: event.id, sequence: existing.event_sequence };
   }
   const count = this.store.db.all<{ count: number }>('SELECT COUNT(*) AS count FROM bot_messages WHERE run_id=? AND attempt=?', run.id, input.attempt)[0].count;
   requireThat(count < MAX_PER_ATTEMPT, 'RATE_LIMITED', 'Message limit for this run attempt has been reached.', 429);
   return appendBotMessageEvent(this.store, this.uuid, this.now(), run, input.attempt, input.text, 'tool', input.reply_to_event_id ?? null, input.message_key);
  });
 }
}
