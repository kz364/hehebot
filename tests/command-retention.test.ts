import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { fixture, bot } from './helpers';

it.each(['applied', 'rejected'])('expires %s command bodies at 90 days without changing receipts, dedupe, or linked work', status => {
  const f = fixture();
  try {
    const key = randomUUID(), command = { schema_version: 1 as const, type: 'message.send' as const,
      payload: { conversation_id: status === 'applied' ? bot : randomUUID(), text: 'Command-only canary 43' } };
    const original = f.accept(command, key), runs = f.db.all('SELECT * FROM runs');
    expect(original.status).toBe(status);
    const row = f.db.all<Record<string, unknown>>('SELECT * FROM commands WHERE id=?', original.id)[0];
    expect(f.core.nextCommandPayloadExpiry()).toBe('2026-12-09T00:00:00.000Z');
    f.setNow('2026-12-08T23:59:59.999Z'); expect(f.core.expireCommandPayloads()).toBe(0);
    f.setNow('2026-12-09T00:00:00.000Z'); expect(f.core.expireCommandPayloads()).toBe(1);
    expect(f.core.expireCommandPayloads()).toBe(0); expect(f.core.nextCommandPayloadExpiry()).toBeNull();
    expect(f.db.all('SELECT * FROM commands WHERE id=?', original.id)).toEqual([{ ...row, payload_json: '{}' }]);
    expect(f.core.receipt(original.id)).toEqual(original); expect(f.accept(command, key)).toEqual(original);
    expect(() => f.accept({ ...command, payload: { ...command.payload, text: 'Changed 71' } }, key)).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
    expect(f.db.all('SELECT * FROM runs')).toEqual(runs);
    expect(f.db.all('SELECT desired_state,queue_sequence FROM lifecycle')).toEqual([{ desired_state: 'STOP', queue_sequence: 0 }]);
  } finally { f.close(); }
});

it('bounds payload cleanup and leaves pending acceptance and future bodies intact', () => {
  const f = fixture();
  try {
    for (let i = 0; i < 101; i++) f.accept({ schema_version: 1, type: 'message.send', payload: { conversation_id: bot, text: `Input ${i}` } });
    const pending = f.accept({ schema_version: 1, type: 'message.send', payload: { conversation_id: bot, text: 'Pending acceptance' } });
    f.db.exec("UPDATE commands SET status='accepted' WHERE id=?", pending.id);
    f.setNow('2026-12-08T00:00:00.000Z');
    const future = f.accept({ schema_version: 1, type: 'message.send', payload: { conversation_id: bot, text: 'Future retention' } });
    f.setNow('2026-12-09T00:00:00.000Z');
    expect(f.core.expireCommandPayloads()).toBe(100); expect(f.core.nextCommandPayloadExpiry()).toBe(f.core.now());
    expect(f.core.expireCommandPayloads()).toBe(1); expect(f.core.expireCommandPayloads()).toBe(0);
    expect(f.db.all<{payload_json:string}>('SELECT payload_json FROM commands WHERE id=?', pending.id)[0].payload_json).toContain('Pending acceptance');
    expect(f.db.all<{payload_json:string}>('SELECT payload_json FROM commands WHERE id=?', future.id)[0].payload_json).toContain('Future retention');
    expect(f.core.nextCommandPayloadExpiry()).toBe('2027-03-08T00:00:00.000Z');
  } finally { f.close(); }
});
