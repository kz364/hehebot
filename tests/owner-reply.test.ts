import { afterEach, describe, expect, it } from 'vitest';
import { fixture, bot, otherBot } from './helpers';
import type { Command } from '../src/core/types';

// Portal swipe-to-reply: message.send may name the message it answers.
let f: ReturnType<typeof fixture>;
afterEach(() => f.close());

const send = (payload: Record<string, unknown>) => f.accept({ schema_version: 1, type: 'message.send', payload } as Command);
const lastUserEvent = () => f.db.all<{ id: string; payload_json: string }>("SELECT id,payload_json FROM events WHERE type='message.user' ORDER BY sequence DESC LIMIT 1")[0];
const lastInstruction = () => JSON.parse(f.db.all<{ context_json: string }>('SELECT context_json FROM runs ORDER BY created_at DESC,rowid DESC LIMIT 1')[0].context_json).instruction;

describe('owner replies', () => {
  it('stores the quoted target on the owner message and gives the bot the quote', () => {
    f = fixture(true);
    send({ conversation_id: bot, text: 'Book the 9am train' });
    const original = lastUserEvent();
    expect(send({ conversation_id: bot, text: 'Actually make it 10am', reply_to_event_id: original.id }).status).toBe('applied');
    expect(JSON.parse(lastUserEvent().payload_json)).toMatchObject({ text: 'Actually make it 10am', reply_to: { event_id: original.id, sender: 'You', text: 'Book the 9am train' } });
    expect(lastInstruction()).toBe('[Replying to your owner: "Book the 9am train"]\n\nActually make it 10am');
  });

  it('refuses a reply target from another conversation', () => {
    f = fixture(true);
    send({ conversation_id: otherBot, text: 'Elsewhere' });
    const foreign = lastUserEvent();
    expect(send({ conversation_id: bot, text: 'Reply', reply_to_event_id: foreign.id }).status).toBe('rejected');
  });
});
