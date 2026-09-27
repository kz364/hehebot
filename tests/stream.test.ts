import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TestDatabase, bot } from './helpers';
import { PersonalControl } from '../src/worker/control-object';
import worker from '../src/worker/index';

// ARCHITECTURE_V2 A6: the streamed timeline. Exercised the same way as
// control-object.test.ts — the real RPC methods, the real SQL, only the
// Cloudflare host (DurableObject base, WebSocketPair/hibernation primitives)
// is replaced. A fake socket is a plain object supporting exactly the
// surface control-object.ts uses (send/close/serializeAttachment/
// deserializeAttachment), fed directly into a fake ctx.getWebSockets().
vi.mock('cloudflare:workers', () => ({ DurableObject: class {
  constructor(public ctx: unknown, public env: unknown) {}
} }));
vi.mock('../DB/schema.sql', () => ({ default: '' }));

type Frame = Record<string, unknown>;
function fakeSocket() {
  return {
    sent: [] as Frame[],
    closed: undefined as { code: number; reason: string } | undefined,
    attachment: null as unknown,
    send(data: string) { if (this.closed) throw new Error('socket is closed'); this.sent.push(JSON.parse(data) as Frame); },
    close(code = 1000, reason = '') { this.closed = { code, reason }; },
    serializeAttachment(value: unknown) { this.attachment = value; },
    deserializeAttachment() { return this.attachment; },
  };
}
type FakeSocket = ReturnType<typeof fakeSocket>;

let db: TestDatabase, control: PersonalControl, sockets: FakeSocket[];
const setAlarm = vi.fn(async (_time: number) => {});
const deleteAlarm = vi.fn(async () => {});
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-10T00:00:00.000Z'));
  setAlarm.mockClear(); deleteAlarm.mockClear();
  db = new TestDatabase();
  sockets = [];
  await initialize();
});
async function initialize(executionEnabled = false) {
  let initialized: Promise<unknown> = Promise.resolve();
  const ctx = {
    storage: {
      sql: { exec: (sql: string, ...values: (string | number | null)[]) => {
        const rows = db.all(sql, ...values); return { toArray: () => rows };
      } },
      transactionSync: <T>(fn: () => T) => db.transaction(fn), getAlarm: async () => null, setAlarm, deleteAlarm,
    },
    blockConcurrencyWhile: (fn: () => Promise<unknown>) => { initialized = fn(); },
    // Hibernation primitives: this test drives webSocketMessage/attachment
    // directly (no real WebSocketPair exists in Node), and only needs
    // getWebSockets() for broadcastStreamCommit to find open sockets.
    getWebSockets: () => sockets as unknown as WebSocket[],
    acceptWebSocket: () => {},
    setWebSocketAutoResponse: () => {},
  };
  control = new PersonalControl(ctx as unknown as DurableObjectState, {
    EXECUTION_ENABLED: String(executionEnabled), NATIVE_VERIFIED: String(executionEnabled), PROVIDER_CONFIG: '{}',
    ACTION_POLICY_IDS: '[]', TOOL_POLICY_IDS: '[]', TRIGGER_CONFIG: '{}',
  } as Env);
  await initialized;
}
afterEach(() => { db.close(); vi.useRealTimers(); });

const message = (text = 'Hello') => ({ schema_version: 1, type: 'message.send', payload: { conversation_id: bot, text } });
async function subscribe(ws: FakeSocket, cursor: number | null) {
  await control.webSocketMessage(ws as unknown as WebSocket, JSON.stringify({ type: 'subscribe', cursor }));
}
function eventsFrames(ws: FakeSocket) { return ws.sent.filter(f => f.type === 'events'); }
function runtimeFrames(ws: FakeSocket) { return ws.sent.filter(f => f.type === 'runtime'); }

it('rejects an unauthenticated, wrong-origin or non-upgrade /v1/stream request before reaching the Durable Object', async () => {
  const env = { AUTH_MODE: 'local', INSTALLATION_ID: 'local-only', CONTROL: { getByName: () => control } } as unknown as Env;
  const get = (origin: string, headers: Record<string, string> = {}) =>
    worker.fetch(new Request(origin + '/v1/stream', { headers: { Origin: origin, ...headers } }), env);
  expect((await get('https://control.invalid', { Upgrade: 'websocket' })).status).toBe(401);
  const wrongOrigin = await worker.fetch(new Request('http://127.0.0.1/v1/stream', { headers: { Origin: 'http://evil.example', Upgrade: 'websocket' } }), env);
  expect(wrongOrigin.status).toBe(403);
  expect((await get('http://127.0.0.1')).status).toBe(426);
  expect(sockets).toEqual([]);
});

// message.send always commits two events (message.user, then run.accepted);
// helpers below isolate the assertion to the event kind under test.
function maxSequence(): number { return db.all<{ seq: number }>('SELECT COALESCE(MAX(sequence),0) AS seq FROM events')[0].seq; }
function messageUserEvents<T extends { type: string }>(events: T[]) { return events.filter(e => e.type === 'message.user'); }

it('subscribes with a null cursor, then delivers a message.send commit as an events frame including the message.user event', async () => {
  const ws = fakeSocket();
  sockets.push(ws);
  await subscribe(ws, null);
  expect(eventsFrames(ws)).toEqual([{ type: 'events', events: [], cursor: 0 }]);
  expect(runtimeFrames(ws)).toEqual([{ type: 'runtime', state: 'asleep' }]);
  ws.sent.length = 0;
  const result = await control.accept('owner', randomUUID(), 'synthetic', message());
  expect(result).toMatchObject({ ok: true });
  const frames = eventsFrames(ws);
  expect(frames).toHaveLength(1);
  const frame = frames[0] as { events: { type: string; conversation_id: string; sequence: number }[]; cursor: number };
  const userEvents = messageUserEvents(frame.events);
  expect(userEvents).toHaveLength(1);
  expect(userEvents[0]).toMatchObject({ type: 'message.user', conversation_id: bot });
  expect(typeof userEvents[0].sequence).toBe('number');
  expect(frame.cursor).toBe(maxSequence());
  expect((ws.attachment as { cursor: number }).cursor).toBe(frame.cursor);
});

it('reconnecting with an old cursor resumes exactly the events missed while disconnected', async () => {
  await control.accept('owner', randomUUID(), 'm1', message('first'));
  const afterFirst = maxSequence();
  await control.accept('owner', randomUUID(), 'm2', message('second'));
  await control.accept('owner', randomUUID(), 'm3', message('third'));
  const ws = fakeSocket();
  sockets.push(ws);
  await subscribe(ws, afterFirst);
  const frames = eventsFrames(ws);
  expect(frames).toHaveLength(1);
  const frame = frames[0] as { events: { type: string; payload: { text: string } }[] };
  expect(frame.events.every(e => e.type === 'message.user' || e.type === 'run.accepted')).toBe(true);
  expect(messageUserEvents(frame.events).map(e => e.payload.text)).toEqual(['second', 'third']);
});

it('pages resumed history at 100 events per frame', async () => {
  await control.accept('owner', randomUUID(), 'm0', message('zero'));
  const base = maxSequence();
  for (let i = 0; i < 150; i++) await control.accept('owner', randomUUID(), `m${i + 1}`, message(`n${i}`));
  const totalNew = maxSequence() - base;
  const ws = fakeSocket();
  sockets.push(ws);
  await subscribe(ws, base);
  const frames = eventsFrames(ws) as { events: unknown[]; cursor: number }[];
  expect(frames.length).toBe(Math.ceil(totalNew / 100));
  frames.slice(0, -1).forEach(frame => expect(frame.events).toHaveLength(100));
  expect(frames.at(-1)!.events.length).toBe(totalNew - 100 * (frames.length - 1));
  expect(frames.reduce((sum, frame) => sum + frame.events.length, 0)).toBe(totalNew);
  for (let i = 1; i < frames.length; i++) expect(frames[i].cursor).toBeGreaterThan(frames[i - 1].cursor);
});

it('replies snapshot_required for a cursor older than retained history, and never delivers to it afterward', async () => {
  await control.accept('owner', randomUUID(), 'm1', message('one'));
  // A tombstone below the current sequence simulates retention having pruned
  // everything up to and including it — the same gap state state()/HISTORY_GAP
  // detects via retentionFloor().
  const seq = db.all<{ sequence: number }>('SELECT sequence FROM events')[0].sequence;
  db.exec('INSERT INTO event_tombstones(id,sequence,conversation_id,created_at) VALUES(?,?,NULL,?)', randomUUID(), seq, '2026-09-10T00:00:00.000Z');
  const ws = fakeSocket();
  sockets.push(ws);
  await subscribe(ws, 0);
  expect(ws.sent[0]).toEqual({ type: 'snapshot_required' });
  expect(ws.sent[1]).toMatchObject({ type: 'runtime' });
  expect((ws.attachment as { cursor: number | null }).cursor).toBeNull();
  ws.sent.length = 0;
  await control.accept('owner', randomUUID(), 'm2', message('two'));
  // Not subscribed to a valid cursor: broadcast-on-commit must not deliver events to it.
  expect(eventsFrames(ws)).toEqual([]);
});

it('sends a runtime frame on subscribe and again whenever the mapped lifecycle phase changes', async () => {
  const ws = fakeSocket();
  sockets.push(ws);
  await subscribe(ws, null);
  expect(runtimeFrames(ws)).toEqual([{ type: 'runtime', state: 'asleep' }]);
  db.exec("UPDATE lifecycle SET phase='BOOTING' WHERE singleton=1");
  await control.getConnectorCatalog('owner').catch(() => {}); // any RPC funnels through broadcastStreamCommit
  expect(runtimeFrames(ws).at(-1)).toEqual({ type: 'runtime', state: 'waking' });
  db.exec("UPDATE lifecycle SET phase='READY' WHERE singleton=1");
  await control.getSchedulePreview('owner', '0 8 * * *', 'UTC');
  expect(runtimeFrames(ws).at(-1)).toEqual({ type: 'runtime', state: 'running' });
  db.exec("UPDATE lifecycle SET phase='RECOVERY_REQUIRED' WHERE singleton=1");
  await control.getSchedulePreview('owner', '0 8 * * *', 'UTC');
  expect(runtimeFrames(ws).at(-1)).toEqual({ type: 'runtime', state: 'recovery_required' });
});

it('adds forward after= pagination to the per-conversation timeline endpoint alongside the existing before= cursor', async () => {
  await control.accept('owner', randomUUID(), 'm1', message('one'));
  const afterFirst = maxSequence();
  await control.accept('owner', randomUUID(), 'm2', message('two'));
  const env = { AUTH_MODE: 'local', INSTALLATION_ID: 'local-only', CONTROL: { getByName: () => control } } as unknown as Env;
  const request = (query: string) => worker.fetch(new Request(`http://127.0.0.1/v1/conversations/${bot}/events${query}`), env);
  const response = await request(`?after=${afterFirst}`);
  expect(response.status).toBe(200);
  const body = await response.json() as { events: { type: string; payload: { text: string } }[]; after_cursor: number; has_more: boolean };
  expect(messageUserEvents(body.events).map(e => e.payload.text)).toEqual(['two']);
  expect(body.has_more).toBe(false);
  expect(body.after_cursor).toBe(maxSequence());
  expect((await request('?before=1&after=1')).status).toBe(422);
  expect((await request('?after=not-a-number')).status).toBe(422);
});

it('leaves an idle subscribed socket with zero wake, zero provider activity and zero lifecycle/alarm change over a simulated hour', async () => {
  const ws = fakeSocket();
  sockets.push(ws);
  await subscribe(ws, null);
  ws.sent.length = 0;
  const before = { phase: db.all<{ phase: string }>('SELECT phase FROM lifecycle WHERE singleton=1')[0].phase,
    events: db.all('SELECT * FROM events'), setAlarmCalls: setAlarm.mock.calls.length };
  // Without a subscribed socket, an idle install (execution disabled, no
  // owner-alpha) issues no alarm and stays STOPPED; a socket must not change that.
  vi.setSystemTime(new Date('2026-09-10T01:00:00.000Z'));
  const withoutSocket = sockets.splice(0, sockets.length);
  await control.getConnectorCatalog('owner');
  const baselineAlarmCalls = setAlarm.mock.calls.length;
  sockets.push(...withoutSocket);
  setAlarm.mockClear();
  await control.getConnectorCatalog('owner');
  expect(setAlarm.mock.calls.length).toBe(0); // matches baseline: neither call arms anything
  expect(baselineAlarmCalls).toBe(0);
  expect(db.all<{ phase: string }>('SELECT phase FROM lifecycle WHERE singleton=1')[0].phase).toBe(before.phase);
  expect(db.all('SELECT * FROM events')).toEqual(before.events);
  expect(ws.closed).toBeUndefined();
});
