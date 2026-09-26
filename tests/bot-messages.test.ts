import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { fixture, bot } from './helpers';
import { LifecycleCore, type Identity } from '../src/core/lifecycle';
import { BotMessages, type BotMessageInput } from '../src/core/bot-messages';

let f: ReturnType<typeof fixture>, life: LifecycleCore, identity: Identity, messages: BotMessages, input: BotMessageInput, runId: string;
beforeEach(() => {
 f = fixture(true); life = new LifecycleCore(f.store, f.core); messages = new BotMessages(f.store, () => f.core.now(), () => randomUUID());
 f.db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=1,lease_until='2026-09-10T00:02:00.000Z'");
 identity = life.registerBoot(randomUUID()); life.ready(identity);
 runId = f.accept({ schema_version: 1, type: 'message.send', payload: { conversation_id: bot, text: 'Synthetic task' } }).resource_id!;
 life.claim(identity); life.submitted(identity, runId, 1, 'native-root-31');
 input = { run_id: runId, attempt: 1, message_key: `${runId}:1:key-1`, text: 'Hello owner' };
});
afterEach(() => f.close());
const post = (value = input) => messages.post(identity, value, life);

it('commits a bot.message attributed to the persona and inserts the dedupe row', () => {
 const receipt = post();
 const event = f.db.all<{ conversation_id: string; actor_id: string; cause_id: string; type: string; payload_json: string }>('SELECT conversation_id,actor_id,cause_id,type,payload_json FROM events WHERE id=?', receipt.event_id)[0];
 expect(event).toMatchObject({ conversation_id: bot, actor_id: bot, cause_id: runId, type: 'bot.message' });
 expect(JSON.parse(event.payload_json)).toEqual({ text: 'Hello owner', run_id: runId, attempt: 1, task_run_id: null, origin: 'tool', reply_to_event_id: null });
 expect(f.db.all('SELECT message_key,run_id,attempt,event_sequence,origin FROM bot_messages')).toEqual([
  { message_key: input.message_key, run_id: runId, attempt: 1, event_sequence: receipt.sequence, origin: 'tool' },
 ]);
});

it('sets task_run_id to the run id for a background task and null for a coordinator', () => {
 f.db.exec("UPDATE runs SET role='background' WHERE id=?", runId);
 const receipt = post();
 const payload = JSON.parse(f.db.all<{ payload_json: string }>('SELECT payload_json FROM events WHERE id=?', receipt.event_id)[0].payload_json);
 expect(payload.task_run_id).toBe(runId);
});

it('carries reply_to_event_id through when supplied', () => {
 const replyTo = randomUUID();
 const receipt = post({ ...input, reply_to_event_id: replyTo });
 const payload = JSON.parse(f.db.all<{ payload_json: string }>('SELECT payload_json FROM events WHERE id=?', receipt.event_id)[0].payload_json);
 expect(payload.reply_to_event_id).toBe(replyTo);
});

it('replays the same key and text without a second event, and rejects a key conflict', () => {
 const first = post();
 const before = f.db.all('SELECT * FROM events'), beforeRows = f.db.all('SELECT * FROM bot_messages');
 expect(post()).toEqual(first);
 expect(f.db.all('SELECT * FROM events')).toEqual(before);
 expect(f.db.all('SELECT * FROM bot_messages')).toEqual(beforeRows);
 expect(() => post({ ...input, text: 'Different text' })).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
 expect(f.db.all('SELECT * FROM events')).toEqual(before);
 expect(f.db.all('SELECT * FROM bot_messages')).toEqual(beforeRows);
});

it('rejects a stale epoch and a non-current or terminal attempt', () => {
 expect(() => messages.post({ epoch: identity.epoch + 1, boot_id: identity.boot_id }, input, life)).toThrowError(expect.objectContaining({ code: 'STALE_EPOCH' }));
 expect(() => post({ ...input, attempt: 2 })).toThrow();
 f.db.exec("UPDATE runs SET status='completed' WHERE id=?", runId);
 expect(() => post()).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
 expect(f.db.all('SELECT * FROM bot_messages')).toEqual([]);
});

it('rejects the 21st distinct message for the same run and attempt', () => {
 for (let i = 0; i < 20; i++) post({ ...input, message_key: `${runId}:1:key-${i}` });
 expect(f.db.all('SELECT COUNT(*) AS n FROM bot_messages')).toEqual([{ n: 20 }]);
 expect(() => post({ ...input, message_key: `${runId}:1:key-20` })).toThrowError(expect.objectContaining({ code: 'RATE_LIMITED' }));
 expect(f.db.all('SELECT COUNT(*) AS n FROM bot_messages')).toEqual([{ n: 20 }]);
 // A replay of an already-committed key still succeeds past the limit.
 expect(post({ ...input, message_key: `${runId}:1:key-0` })).toBeDefined();
});

it('enforces the non-empty and byte-size text bounds', () => {
 expect(() => post({ ...input, text: '' })).toThrowError(expect.objectContaining({ code: 'INVALID_INPUT' }));
 post({ ...input, text: 'x'.repeat(32768) });
 expect(() => post({ ...input, message_key: `${runId}:1:oversized`, text: 'x'.repeat(32769) })).toThrowError(expect.objectContaining({ code: 'PAYLOAD_TOO_LARGE' }));
});
