import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TestDatabase, bot } from './helpers';
import { PersonalControl } from '../src/worker/control-object';
import worker from '../src/worker/index';
import { validateTakeoverInput } from '../src/core/browser-takeover';
import { validateTakeoverInput as runtimeValidate } from '../runtime/browser-takeover.mjs';

// Browser takeover relay in the Durable Object (docs/BROWSER_TAKEOVER.md).
// Real RPC/SQL; only the Cloudflare host is faked: DurableObject base,
// WebSocketPair, 101 responses and tag-aware hibernation primitives.
vi.mock('cloudflare:workers', () => ({ DurableObject: class {
  constructor(public ctx: unknown, public env: unknown) {}
} }));
vi.mock('../DB/schema.sql', () => ({ default: '' }));

type Sent = string | ArrayBuffer;
function fakeSocket() {
  return {
    sent: [] as Sent[], closed: undefined as { code: number; reason: string } | undefined, attachment: null as unknown,
    send(data: Sent) { if (this.closed) throw new Error('closed'); this.sent.push(data); },
    close(code = 1000, reason = '') { this.closed ??= { code, reason }; },
    serializeAttachment(value: unknown) { this.attachment = structuredClone(value); },
    deserializeAttachment() { return this.attachment; },
    json() { return this.sent.filter((x): x is string => typeof x === 'string').map(x => JSON.parse(x) as Record<string, unknown>); },
  };
}
type FakeSocket = ReturnType<typeof fakeSocket>;
class UpgradeResponse extends Response {
  constructor(body: BodyInit | null, init?: ResponseInit) {
    if (init?.status === 101) { super(null, { status: 200 }); Object.defineProperty(this, 'status', { value: 101 }); }
    else super(body, init);
  }
}

let db: TestDatabase, control: PersonalControl, accepted: { ws: FakeSocket; tags: string[] }[];
const identity = { epoch: 1, boot_id: randomUUID() };
let run: string;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-10T00:00:00.000Z'));
  vi.stubGlobal('WebSocketPair', class { constructor() { return { 0: fakeSocket(), 1: fakeSocket() }; } });
  vi.stubGlobal('Response', UpgradeResponse);
  db = new TestDatabase(); accepted = [];
  let initialized: Promise<unknown> = Promise.resolve();
  const ctx = {
    storage: {
      sql: { exec: (sql: string, ...values: (string | number | null)[]) => { const rows = db.all(sql, ...values); return { toArray: () => rows }; } },
      transactionSync: <T>(fn: () => T) => db.transaction(fn), getAlarm: async () => null, setAlarm: async () => {}, deleteAlarm: async () => {},
    },
    blockConcurrencyWhile: (fn: () => Promise<unknown>) => { initialized = fn(); },
    acceptWebSocket: (ws: FakeSocket, tags: string[] = []) => { accepted.push({ ws, tags }); },
    getWebSockets: (tag?: string) => accepted.filter(a => !a.ws.closed && (!tag || a.tags.includes(tag))).map(a => a.ws) as unknown as WebSocket[],
    setWebSocketAutoResponse: () => {},
  };
  control = new PersonalControl(ctx as unknown as DurableObjectState, {
    EXECUTION_ENABLED: 'true', NATIVE_VERIFIED: 'true', PROVIDER_CONFIG: '{}', ACTION_POLICY_IDS: '[]', TOOL_POLICY_IDS: '[]', TRIGGER_CONFIG: '{}',
  } as Env);
  await initialized;
  await control.accept('owner', randomUUID(), 'msg', { schema_version: 1, type: 'message.send', payload: { conversation_id: bot, text: 'Buy the tickets' } });
  run = db.all<{ id: string }>('SELECT id FROM runs')[0].id;
  db.exec("UPDATE lifecycle SET phase='BOOTING',epoch=1,lease_until='2026-09-10T00:02:00.000Z'");
  for (const [type, payload] of [['boot', { boot_id: identity.boot_id }], ['ready', { identity }], ['claim', { identity }], ['submitted', { identity, run_id: run, attempt: 1, native_ref: 'native-1' }]] as const)
    expect(await control.runtime({ type, payload })).toMatchObject({ ok: true });
});
afterEach(() => { db.close(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const takeoverId = '44444444-4444-4444-8444-444444444444';
const open = (extra: Record<string, unknown> = {}) => control.runtime({ type: 'browser-takeover', payload: { identity, run_id: run, attempt: 1, takeover_id: takeoverId, action: 'open', reason: 'Log in to tickets.example', timeout_ms: 600000, ...extra } });
const end = (outcome = 'handed_back') => control.runtime({ type: 'browser-takeover', payload: { identity, run_id: run, attempt: 1, takeover_id: takeoverId, action: 'end', outcome } });
const notices = () => db.all<{ payload_json: string }>("SELECT payload_json FROM events WHERE type='notice' ORDER BY sequence").map(r => JSON.parse(r.payload_json) as Record<string, unknown>);
const upgrade = (role: 'runtime' | 'viewer', params: Record<string, string>) => control.fetch(new Request(
  `http://127.0.0.1/${role === 'runtime' ? 'internal' : 'v1'}/takeover/stream?${new URLSearchParams(params)}`, { headers: { Upgrade: 'websocket' } }));
const runtimeParams = (over: Record<string, string> = {}) => ({ takeover_id: takeoverId, run_id: run, attempt: '1', epoch: '1', boot_id: identity.boot_id, ...over });
const serverFor = (_response: Response) => accepted.at(-1)!.ws;

it('viewer input validation is identical in the Worker and the runtime', () => {
  const vectors: unknown[] = [
    { t: 'mouse', type: 'down', x: 0.5, y: 0.5 }, { t: 'mouse', type: 'move', x: 2, y: 0 }, { t: 'wheel', x: 0, y: 0, dy: 120 },
    { t: 'key', type: 'down', key: 'Enter' }, { t: 'key', type: 'down', key: 'F5' }, { t: 'key', type: 'up', key: 'é', mods: 8 },
    { t: 'text', text: 'hunter2' }, { t: 'text', text: '' }, { t: 'navigate', url: 'https://a.example' }, { t: 'navigate', url: 'file:///etc/passwd' },
    { t: 'navigate', url: 'javascript:alert(1)' }, { t: 'handback' }, { t: 'cancel' }, { t: 'eval', code: '1' }, 'garbage', { t: 'handback', x: 1 },
  ];
  for (const vector of vectors) {
    const raw = typeof vector === 'string' ? vector : JSON.stringify(vector);
    expect(validateTakeoverInput(raw)).toEqual(runtimeValidate(raw));
  }
  expect(validateTakeoverInput('{"t":"navigate","url":"file:///x"}')).toBeNull();
});

it('open posts an owner needs_you notice bound to the run, and is idempotent for the same id', async () => {
  expect(await open()).toMatchObject({ ok: true, value: { takeover_id: takeoverId, expires_at: '2026-09-10T00:10:00.000Z' } });
  expect(await open()).toMatchObject({ ok: true });
  expect(notices()).toEqual([expect.objectContaining({ kind: 'needs_you', reason: 'BROWSER_TAKEOVER', run_id: run, takeover_id: takeoverId, persona_id: bot,
    detail: 'Log in to tickets.example', message: expect.stringContaining('needs you in its browser: Log in to tickets.example') })]);
  expect(await control.runtime({ type: 'browser-takeover', payload: { identity: { ...identity, epoch: 2 }, run_id: run, attempt: 1, takeover_id: randomUUID(), action: 'open', reason: 'x', timeout_ms: 600000 } }))
    .toMatchObject({ ok: false, error: { code: 'STALE_EPOCH' } });
  expect(await open({ timeout_ms: 5 })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
});

it('Worker routes: runtime side needs the runtime token and an upgrade; viewer side needs the owner and same origin', async () => {
  const env = { AUTH_MODE: 'local', INSTALLATION_ID: 'local-only', RUNTIME_TOKEN: 'runtime-token', CONTROL: { getByName: () => control } } as unknown as Env;
  const internal = (headers: Record<string, string>, method = 'GET') => worker.fetch(new Request(`https://control.invalid/internal/takeover/stream?takeover_id=${takeoverId}`, { method, headers }), env);
  expect((await internal({ Upgrade: 'websocket' })).status).toBe(401);
  expect((await internal({ Upgrade: 'websocket', Authorization: 'Bearer wrong' })).status).toBe(401);
  expect((await internal({ Authorization: 'Bearer runtime-token' })).status).toBe(426);
  expect((await internal({ Upgrade: 'websocket', Authorization: 'Bearer runtime-token' }, 'POST')).status).toBe(404);
  const viewer = (origin: string, headers: Record<string, string>) => worker.fetch(new Request(`${origin}/v1/takeover/stream?takeover_id=${takeoverId}`, { headers }), env);
  expect((await viewer('https://control.invalid', { Origin: 'https://control.invalid', Upgrade: 'websocket' })).status).toBe(401);
  expect((await viewer('http://127.0.0.1', { Origin: 'http://evil.example', Upgrade: 'websocket' })).status).toBe(403);
  expect((await viewer('http://127.0.0.1', { Origin: 'http://127.0.0.1' })).status).toBe(426);
  expect((await viewer('http://127.0.0.1', { Origin: 'http://127.0.0.1', Upgrade: 'websocket' })).status).toBe(404); // not opened yet
  await open();
  expect((await viewer('http://127.0.0.1', { Origin: 'http://127.0.0.1', Upgrade: 'websocket' })).status).toBe(101);
  expect((await internal({ Upgrade: 'websocket', Authorization: 'Bearer runtime-token' })).status).toBe(403); // identity missing
});

it('pairs one runtime with one viewer, pipes validated frames both ways and closes cleanly on end', async () => {
  expect((await upgrade('viewer', { takeover_id: takeoverId })).status).toBe(404);
  await open();
  expect((await upgrade('runtime', runtimeParams({ run_id: randomUUID() }))).status).toBe(403);
  expect((await upgrade('runtime', runtimeParams({ epoch: '2' }))).status).toBe(403);
  expect((await upgrade('viewer', { takeover_id: randomUUID() })).status).toBe(404);
  const rt = serverFor(await upgrade('runtime', runtimeParams()));
  expect(rt.json()).toEqual([{ t: 'viewer', connected: false }]);
  const v1 = serverFor(await upgrade('viewer', { takeover_id: takeoverId }));
  expect(v1.json()[0]).toMatchObject({ t: 'peer', runtime: true, reason: 'Log in to tickets.example' });
  expect(rt.json().at(-1)).toEqual({ t: 'viewer', connected: true });
  // runtime → viewer: JPEG bytes and small meta pass; unknown/oversized frames do not.
  const jpeg = new Uint8Array([0xff, 0xd8, 1]).buffer;
  await control.webSocketMessage(rt as unknown as WebSocket, jpeg);
  await control.webSocketMessage(rt as unknown as WebSocket, JSON.stringify({ t: 'meta', url: 'https://tickets.example/login', title: 'Log in', w: 1280, h: 800 }));
  await control.webSocketMessage(rt as unknown as WebSocket, JSON.stringify({ t: 'script', code: 'x' }));
  await control.webSocketMessage(rt as unknown as WebSocket, new ArrayBuffer(1024 * 1024 + 1));
  expect(v1.sent.filter(x => typeof x !== 'string')).toEqual([jpeg]);
  expect(v1.json().at(-1)).toMatchObject({ t: 'meta', title: 'Log in' });
  // viewer → runtime: re-serialized valid input only.
  rt.sent.length = 0;
  await control.webSocketMessage(v1 as unknown as WebSocket, JSON.stringify({ t: 'mouse', type: 'down', x: 0.5, y: 0.5 }));
  await control.webSocketMessage(v1 as unknown as WebSocket, JSON.stringify({ t: 'navigate', url: 'file:///etc/passwd' }));
  await control.webSocketMessage(v1 as unknown as WebSocket, new Uint8Array([1]).buffer);
  expect(rt.json()).toEqual([{ t: 'mouse', type: 'down', x: 0.5, y: 0.5, button: 'left', clicks: 1, mods: 0 }]);
  expect(v1.json().at(-1)).toEqual({ t: 'error', code: 'INVALID_INPUT' });
  // Rate limit: at most 60 input frames per second per viewer.
  rt.sent.length = 0; vi.setSystemTime(new Date('2026-09-10T00:00:01.000Z'));
  for (let i = 0; i < 70; i++) await control.webSocketMessage(v1 as unknown as WebSocket, JSON.stringify({ t: 'mouse', type: 'move', x: 0.1, y: 0.1 }));
  expect(rt.sent.length).toBe(60);
  // One viewer at a time: a newer viewer replaces the older one.
  const v2 = serverFor(await upgrade('viewer', { takeover_id: takeoverId }));
  expect(v1.closed).toEqual({ code: 4001, reason: 'Opened in another window.' });
  await control.webSocketClose(v1 as unknown as WebSocket, 4001, 'x');
  expect(rt.json().at(-1)).toEqual({ t: 'viewer', connected: true }); // the replacement viewer still counts
  // Takeover sockets never receive timeline stream frames.
  await control.accept('owner', randomUUID(), 'msg2', { schema_version: 1, type: 'message.send', payload: { conversation_id: bot, text: 'Another' } });
  expect(v2.json().some(f => f.type === 'events')).toBe(false);
  // Runtime gone → viewer told; hand back → end closes everything and posts the ended notice.
  await control.webSocketClose(rt as unknown as WebSocket, 1006, '');
  expect(v2.json().at(-1)).toEqual({ t: 'peer', runtime: false });
  await control.webSocketMessage(v2 as unknown as WebSocket, JSON.stringify({ t: 'handback' }));
  expect(v2.json().at(-1)).toEqual({ t: 'peer', runtime: false });
  const rt2 = serverFor(await upgrade('runtime', runtimeParams()));
  expect(rt.closed).toBeDefined();
  await control.webSocketMessage(v2 as unknown as WebSocket, JSON.stringify({ t: 'handback' }));
  expect(rt2.json().at(-1)).toEqual({ t: 'handback' });
  expect(await end()).toMatchObject({ ok: true, value: { ended: true } });
  expect(v2.closed).toEqual({ code: 1000, reason: 'Takeover ended.' });
  expect(rt2.closed).toEqual({ code: 1000, reason: 'Takeover ended.' });
  expect(notices().at(-1)).toMatchObject({ kind: 'runtime', reason: 'BROWSER_TAKEOVER_ENDED', takeover_id: takeoverId, outcome: 'handed_back' });
  expect(await end()).toMatchObject({ ok: true, value: { ended: false } });
  expect((await upgrade('viewer', { takeover_id: takeoverId })).status).toBe(404);
});

it('an expired takeover or a run that stopped running cannot be viewed', async () => {
  await open({ timeout_ms: 60000 });
  expect((await upgrade('viewer', { takeover_id: takeoverId })).status).toBe(101);
  vi.setSystemTime(new Date('2026-09-10T00:01:01.000Z'));
  expect((await upgrade('viewer', { takeover_id: takeoverId })).status).toBe(404);
  vi.setSystemTime(new Date('2026-09-10T00:00:30.000Z'));
  await control.accept('owner', randomUUID(), 'cancel', { schema_version: 1, type: 'run.cancel', payload: { run_id: run, reason: 'Stop' } });
  expect((await upgrade('viewer', { takeover_id: takeoverId })).status).toBe(404);
});
