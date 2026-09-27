import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestDatabase, fixture, bot } from './helpers';
import { PersonalControl } from '../src/worker/control-object';
import worker from '../src/worker/index';

vi.mock('cloudflare:workers', () => ({ DurableObject: class {
  constructor(public ctx: unknown, public env: unknown) {}
} }));
vi.mock('../DB/schema.sql', () => ({ default: '' }));

// ARCHITECTURE_V2 A5: the portal's durable outbox reconciles a send after a
// reload or a lost response by looking its own Idempotency-Key back up, and
// the committed message.user event must carry that same key so the portal
// can recognize its own echo. See docs/ARCHITECTURE_V2.md A5 and TODO.md V5.
describe('receipt lookup by idempotency key', () => {
  it('returns the original receipt for this owner and echoes the key on message.user', () => {
    const f = fixture();
    const key = randomUUID();
    const receipt = f.accept({ schema_version: 1, type: 'message.send', payload: { conversation_id: bot, text: 'Outbox reconciliation fixture' } }, key);
    expect(receipt.status).toBe('applied');

    const byKey = f.core.receiptByIdempotencyKey('owner', key);
    expect(byKey).toEqual(receipt);

    const events = f.db.all<{ payload_json: string }>("SELECT payload_json FROM events WHERE conversation_id=? AND type='message.user' ORDER BY sequence DESC LIMIT 1", bot);
    expect(JSON.parse(events[0].payload_json)).toEqual({ text: 'Outbox reconciliation fixture', idempotency_key: key });
  });

  it('is NOT_FOUND for an unknown key and never leaks another owner’s command', () => {
    const f = fixture();
    expect(() => f.core.receiptByIdempotencyKey('owner', randomUUID())).toThrow();
    try { f.core.receiptByIdempotencyKey('owner', randomUUID()); } catch (error) { expect((error as { code: string }).code).toBe('NOT_FOUND'); }
    const key = randomUUID();
    f.accept({ schema_version: 1, type: 'message.send', payload: { conversation_id: bot, text: 'Owned by someone else' } }, key);
    expect(() => f.core.receiptByIdempotencyKey('someone-else', key)).toThrow();
  });

  it('a rejected command is still reachable by its idempotency key, distinguishable from acceptance', () => {
    const f = fixture();
    const key = randomUUID();
    const receipt = f.accept({ schema_version: 1, type: 'message.send', payload: { conversation_id: randomUUID(), text: 'Unknown conversation' } }, key);
    expect(receipt.status).toBe('rejected');
    expect(f.core.receiptByIdempotencyKey('owner', key)).toEqual(receipt);
  });
});

describe('GET /v1/receipts?idempotency_key= (worker route)', () => {
  let db: TestDatabase, control: PersonalControl;
  beforeEach(async () => {
    db = new TestDatabase();
    let initialized: Promise<unknown> = Promise.resolve();
    const ctx = {
      storage: {
        sql: { exec: (sql: string, ...values: (string | number | null)[]) => {
          const rows = db.all(sql, ...values); return { toArray: () => rows };
        } },
        transactionSync: <T>(fn: () => T) => db.transaction(fn), getAlarm: async () => null, setAlarm: vi.fn(), deleteAlarm: vi.fn(),
      },
      blockConcurrencyWhile: (fn: () => Promise<unknown>) => { initialized = fn(); },
    };
    control = new PersonalControl(ctx as unknown as DurableObjectState, {
      EXECUTION_ENABLED: 'false', NATIVE_VERIFIED: 'false', PROVIDER_CONFIG: '{}',
      ACTION_POLICY_IDS: '[]', TOOL_POLICY_IDS: '[]', TRIGGER_CONFIG: '{}',
    } as Env);
    await initialized;
  });
  afterEach(() => db.close());
  const env = () => ({ AUTH_MODE: 'local', INSTALLATION_ID: 'local-only', CONTROL: { getByName: () => control } } as unknown as Env);

  it('finds the original receipt by the client Idempotency-Key, 404s for an unknown one, and requires auth', async () => {
    const key = randomUUID();
    const post = await worker.fetch(new Request('http://127.0.0.1/v1/commands', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key, Origin: 'http://127.0.0.1' },
      body: JSON.stringify({ schema_version: 1, type: 'message.send', payload: { conversation_id: bot, text: 'Reload me' } }),
    }), env());
    expect(post.status).toBe(202);
    const receipt = await post.json();

    const found = await worker.fetch(new Request(`http://127.0.0.1/v1/receipts?idempotency_key=${key}`), env());
    expect(found.status).toBe(200);
    expect(await found.json()).toEqual(receipt);

    const missing = await worker.fetch(new Request(`http://127.0.0.1/v1/receipts?idempotency_key=${randomUUID()}`), env());
    expect(missing.status).toBe(404);
    expect((await missing.json() as { error: { code: string } }).error.code).toBe('NOT_FOUND');

    expect((await worker.fetch(new Request(`https://control.invalid/v1/receipts?idempotency_key=${key}`), env())).status).toBe(401);
    expect((await worker.fetch(new Request('http://127.0.0.1/v1/receipts?idempotency_key=too-short'), env())).status).toBe(422);
  });
});
