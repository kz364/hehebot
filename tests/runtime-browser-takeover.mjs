import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CdpConnection, connectRelay, inputToCdp, relayUrl, runTakeover, takeoverResultText, validateTakeoverInput, TAKEOVER_DEFAULTS } from '../runtime/browser-takeover.mjs';
import { BROWSER_GATEWAY_TOOLS, TAKEOVER_TOOL, browserLimits, chromiumArgs, createBrowserGateway, lockProfile, playwrightArgs, spawnPlaywright } from '../runtime/browser-gateway.mjs';

const identity = { epoch: 3, boot_id: '11111111-1111-4111-8111-111111111111' };
const runId = '22222222-2222-4222-8222-222222222222';

// ---- input validation and CDP mapping ------------------------------------
export const INPUT_VECTORS = [
  [{ t: 'mouse', type: 'down', x: 0.5, y: 0.25, button: 'left', clicks: 1, mods: 0 }, true],
  [{ t: 'mouse', type: 'move', x: 1, y: 0 }, true],
  [{ t: 'mouse', type: 'down', x: 1.5, y: 0 }, false],
  [{ t: 'mouse', type: 'drag', x: 0, y: 0 }, false],
  [{ t: 'mouse', type: 'down', x: 0, y: 0, extra: 1 }, false],
  [{ t: 'wheel', x: 0.1, y: 0.1, dy: 120 }, true],
  [{ t: 'wheel', x: 0.1, y: 0.1, dy: 99999 }, false],
  [{ t: 'key', type: 'down', key: 'a' }, true],
  [{ t: 'key', type: 'down', key: 'Enter', mods: 8 }, true],
  [{ t: 'key', type: 'down', key: 'F12' }, false],
  [{ t: 'key', type: 'down', key: '\u0007' }, false],
  [{ t: 'key', type: 'down', key: 'a', mods: 16 }, false],
  [{ t: 'text', text: 'hello world' }, true],
  [{ t: 'text', text: 'x'.repeat(1001) }, false],
  [{ t: 'text', text: 'bad\u0000' }, false],
  [{ t: 'navigate', url: 'https://example.com/login' }, true],
  [{ t: 'navigate', url: 'file:///etc/passwd' }, false],
  [{ t: 'navigate', url: 'javascript:alert(1)' }, false],
  [{ t: 'navigate', url: 'https://user:pw@example.com/' }, false],
  [{ t: 'eval', code: '1' }, false],
  [{ t: 'handback' }, true],
  [{ t: 'cancel', why: 'x' }, false],
  ['not json', false],
  [[1, 2], false],
];

test('viewer input is validated: only bounded input events, http(s) URLs, hand-back and cancel', () => {
  for (const [value, ok] of INPUT_VECTORS) assert.equal(validateTakeoverInput(typeof value === 'string' ? value : JSON.stringify(value)) !== null, ok, JSON.stringify(value));
  assert.equal(validateTakeoverInput('x'.repeat(5000)), null);
});

test('input maps to CDP Input.* in CSS pixels; chords type no text', () => {
  const view = { width: 1000, height: 500 };
  const down = inputToCdp(validateTakeoverInput({ t: 'mouse', type: 'down', x: 0.5, y: 0.5 }), view);
  assert.deepEqual(down, [['Input.dispatchMouseEvent', { type: 'mousePressed', x: 500, y: 250, button: 'left', clickCount: 1, modifiers: 0 }]]);
  assert.equal(inputToCdp(validateTakeoverInput({ t: 'wheel', x: 0, y: 1, dy: 100 }), view)[0][1].type, 'mouseWheel');
  assert.deepEqual(inputToCdp(validateTakeoverInput({ t: 'key', type: 'down', key: 'a' }), view)[0][1], { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 0, text: 'a', unmodifiedText: 'a' });
  assert.equal(inputToCdp(validateTakeoverInput({ t: 'key', type: 'down', key: 'Enter' }), view)[0][1].text, '\r');
  const chord = inputToCdp(validateTakeoverInput({ t: 'key', type: 'down', key: 'a', mods: 2 }), view)[0][1];
  assert.equal(chord.type, 'rawKeyDown'); assert.equal(chord.text, undefined);
  assert.deepEqual(inputToCdp(validateTakeoverInput({ t: 'text', text: 'hunter2' }), view), [['Input.insertText', { text: 'hunter2' }]]);
  assert.deepEqual(inputToCdp(validateTakeoverInput({ t: 'navigate', url: 'https://a.example/' }), view), [['Page.navigate', { url: 'https://a.example/' }]]);
  assert.deepEqual(inputToCdp({ t: 'handback' }, view), []);
});

// ---- takeover state machine with a fake CDP --------------------------------
function fakeClock() {
  let now = 1_000_000, id = 0; const timers = new Map();
  const add = (fn, ms, every) => { const t = ++id; timers.set(t, { fn, at: now + ms, every }); return t; };
  return {
    now: () => now, setTimeout: (fn, ms) => add(fn, ms), clearTimeout: t => timers.delete(t), setInterval: (fn, ms) => add(fn, ms, ms), clearInterval: t => timers.delete(t),
    async advance(ms) {
      const until = now + ms;
      for (;;) {
        const next = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [key, t] = next; now = t.at;
        if (t.every) t.at += t.every; else timers.delete(key);
        t.fn(); await flush();
      }
      now = until; await flush();
    },
  };
}
const flush = async () => { for (let i = 0; i < 20; i++) await new Promise(ok => setImmediate(ok)); };
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64');
function fakeCdp({ pages = [{ targetId: 'T1', type: 'page', url: 'https://login.example/', title: 'Log in' }] } = {}) {
  const calls = [], listeners = new Set();
  return {
    calls, pages, closed: false,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    emit(method, params, sessionId) { for (const fn of listeners) fn(method, params, sessionId); },
    async send(method, params = {}, sessionId) {
      calls.push([method, params, sessionId]);
      if (method === 'Target.getTargets') return { targetInfos: this.pages };
      if (method === 'Target.attachToTarget') return { sessionId: `S-${params.targetId}` };
      if (method === 'Page.getLayoutMetrics') return { cssVisualViewport: { clientWidth: 1280, clientHeight: 800 } };
      if (method === 'Page.captureScreenshot') return { data: JPEG };
      return {};
    },
  };
}
function fakeRelay() {
  const relay = { sent: [], closed: false, bufferedAmount: 0, onMessage: null,
    send(data) { relay.sent.push(data); return true; }, close() { relay.closed = true; },
    deliver(frame) { return relay.onMessage(typeof frame === 'string' ? frame : JSON.stringify(frame)); },
    binary() { return relay.sent.filter(x => typeof x !== 'string'); }, json() { return relay.sent.filter(x => typeof x === 'string').map(x => JSON.parse(x)); } };
  return relay;
}
function start({ cdp = fakeCdp(), relay = fakeRelay(), clock = fakeClock(), timeoutMs = 600000, limits = TAKEOVER_DEFAULTS, debugLog } = {}) {
  const progress = [];
  const done = runTakeover({ cdp, timeoutMs, limits, clock, onProgress: () => progress.push(clock.now()),
    openRelay: onMessage => { relay.onMessage = onMessage; return relay; }, ...(debugLog ? { debugLog } : {}) });
  return { cdp, relay, clock, progress, done };
}

test('streams only while the owner watches; frames are acked at <=5 fps; input goes to the attached page', async () => {
  const t = start(); await flush();
  assert.ok(t.cdp.calls.some(([m, p]) => m === 'Target.attachToTarget' && p.targetId === 'T1' && p.flatten));
  assert.ok(!t.cdp.calls.some(([m]) => m === 'Page.startScreencast'), 'no stream without a viewer');
  assert.deepEqual(t.relay.json()[0], { t: 'meta', url: 'https://login.example/', title: 'Log in', w: 1280, h: 800 });
  await t.relay.deliver({ t: 'viewer', connected: true }); await flush();
  const screencast = t.cdp.calls.find(([m]) => m === 'Page.startScreencast');
  assert.deepEqual(screencast[1], { format: 'jpeg', quality: 60, maxWidth: 1280, maxHeight: 1280, everyNthFrame: 1 });
  assert.equal(screencast[2], 'S-T1');
  assert.equal(t.relay.binary().length, 1, 'an immediate still frame');
  for (let i = 0; i < 3; i++) t.cdp.emit('Page.screencastFrame', { data: JPEG, sessionId: i, metadata: { deviceWidth: 1280, deviceHeight: 800 } }, 'S-T1');
  await flush();
  assert.equal(t.relay.binary().length, 4);
  const acks = () => t.cdp.calls.filter(([m]) => m === 'Page.screencastFrameAck').length;
  assert.equal(acks(), 1, 'later acks are delayed');
  await t.clock.advance(400); assert.equal(acks(), 3);
  await t.relay.deliver({ t: 'mouse', type: 'down', x: 0.5, y: 0.5 }); await flush();
  assert.deepEqual(t.cdp.calls.at(-1), ['Input.dispatchMouseEvent', { type: 'mousePressed', x: 640, y: 400, button: 'left', clickCount: 1, modifiers: 0 }, 'S-T1']);
  await t.relay.deliver({ t: 'text', text: 'owner-secret' }); await flush();
  assert.deepEqual(t.cdp.calls.at(-1), ['Input.insertText', { text: 'owner-secret' }, 'S-T1']);
  const before = t.cdp.calls.length;
  await t.relay.deliver({ t: 'navigate', url: 'file:///etc/passwd' }); await t.relay.deliver('{"t":"eval","code":"1"}'); await flush();
  assert.equal(t.cdp.calls.length, before, 'invalid input never reaches the browser');
  await t.relay.deliver({ t: 'viewer', connected: false }); await flush();
  assert.ok(t.cdp.calls.some(([m]) => m === 'Page.stopScreencast'));
  await t.relay.deliver({ t: 'handback' });
  const result = await t.done;
  assert.deepEqual(result, { outcome: 'handed_back', url: 'https://login.example/', title: 'Log in', viewed: true });
  assert.deepEqual(t.relay.json().at(-1), { t: 'end', outcome: 'handed_back' });
  assert.equal(t.relay.closed, true);
  assert.ok(t.cdp.calls.some(([m]) => m === 'Target.detachFromTarget'));
});

test('timeout, cancel and progress: progress at start and every 30 s, never past the end', async () => {
  const t = start({ timeoutMs: 120000 }); await flush();
  assert.equal(t.progress.length, 1);
  await t.clock.advance(119000);
  assert.equal(t.progress.length, 4);
  await t.clock.advance(2000);
  assert.deepEqual(await t.done, { outcome: 'timeout', url: 'https://login.example/', title: 'Log in', viewed: false });
  await t.clock.advance(120000); assert.equal(t.progress.length, 4);
  const c = start(); await flush(); await c.relay.deliver({ t: 'cancel' });
  assert.equal((await c.done).outcome, 'cancelled');
  assert.match(takeoverResultText({ outcome: 'timeout', viewed: false }, 600000), /did not take over within 10 min/);
  assert.match(takeoverResultText({ outcome: 'handed_back', url: 'https://x.example/', title: 'X' }, 600000), /handed the browser back.*"X" https:\/\/x\.example\//);
});

// ---- debug logging (optional, no-op by default) ----------------------------
test('runTakeover is silent by default; with a debug logger it records one session entry with outcome/duration/viewed, never the url or title', async () => {
  const bare = start(); await flush(); await bare.relay.deliver({ t: 'cancel' }); await bare.done; // no debugLog: must not throw

  const entries = [];
  const debugLog = { log: (component, event, details) => entries.push({ component, event, details }) };
  const t = start({ debugLog }); await flush();
  await t.clock.advance(1000);
  await t.relay.deliver({ t: 'handback' });
  const result = await t.done;
  assert.equal(result.outcome, 'handed_back');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].component, 'browser_takeover'); assert.equal(entries[0].event, 'session');
  assert.deepEqual(entries[0].details, { outcome: 'handed_back', ms: 1000, viewed: true });
  const raw = JSON.stringify(entries);
  assert.ok(!raw.includes('login.example'), 'the page url is never logged');
  assert.ok(!raw.includes('Log in'), 'the page title is never logged');
});

test('input is rate-limited, oversized frames lower quality, backpressure drops frames, popups are followed', async () => {
  const t = start({ limits: { ...TAKEOVER_DEFAULTS, inputPerSecond: 5 } }); await flush();
  await t.relay.deliver({ t: 'viewer', connected: true }); await flush();
  const before = t.cdp.calls.length;
  for (let i = 0; i < 8; i++) await t.relay.deliver({ t: 'mouse', type: 'move', x: 0.1, y: 0.1 });
  await flush();
  assert.equal(t.cdp.calls.length - before, 5);
  const frames = t.relay.binary().length;
  t.cdp.emit('Page.screencastFrame', { data: Buffer.alloc(TAKEOVER_DEFAULTS.maxFrameBytes + 1).toString('base64'), sessionId: 9, metadata: {} }, 'S-T1');
  t.relay.bufferedAmount = TAKEOVER_DEFAULTS.maxBufferedBytes + 1;
  t.cdp.emit('Page.screencastFrame', { data: JPEG, sessionId: 10, metadata: {} }, 'S-T1');
  await flush();
  assert.equal(t.relay.binary().length, frames, 'both dropped');
  t.relay.bufferedAmount = 0;
  t.cdp.pages.push({ targetId: 'T2', type: 'page', url: 'https://idp.example/', title: 'Sign in' });
  t.cdp.emit('Target.targetCreated', { targetInfo: t.cdp.pages[1] }); await flush();
  const restart = t.cdp.calls.filter(([m]) => m === 'Page.startScreencast').at(-1);
  assert.equal(restart[2], 'S-T2'); assert.equal(restart[1].quality, 50, 'quality lowered after an oversized frame');
  assert.equal(t.relay.json().filter(f => f.t === 'meta').at(-1).url, 'https://idp.example/');
  t.cdp.emit('hehebot.closed', {}); assert.equal((await t.done).outcome, 'failed');
});

// ---- relay framing ---------------------------------------------------------
test('relay URL carries the takeover binding; the socket sends runtime headers and reconnects', async () => {
  const url = relayUrl('https://hehebot.example', { takeoverId: '33333333-3333-4333-8333-333333333333', runId, attempt: 2, identity });
  assert.equal(url, `wss://hehebot.example/internal/takeover/stream?takeover_id=33333333-3333-4333-8333-333333333333&run_id=${runId}&attempt=2&epoch=3&boot_id=${identity.boot_id}`);
  assert.throws(() => relayUrl('http://evil.example', { takeoverId: 'x', runId, attempt: 1, identity }));
  const sockets = [], timers = [];
  class FakeWs extends EventTarget { constructor(u, o) { super(); this.url = u; this.options = o; this.readyState = 0; this.sent = []; sockets.push(this); }
    send(d) { this.sent.push(d); } close() { this.readyState = 3; this.dispatchEvent(new Event('close')); } }
  const received = [], states = [];
  const relay = connectRelay({ url, headers: { Authorization: 'Bearer t', 'CF-Access-Client-Id': 'id' }, WebSocketImpl: FakeWs, onMessage: m => received.push(m), onState: s => states.push(s),
    setTimer: (fn, ms) => { timers.push([fn, ms]); return timers.length; }, clearTimer: () => {} });
  assert.deepEqual(sockets[0].options, { headers: { Authorization: 'Bearer t', 'CF-Access-Client-Id': 'id' } });
  assert.equal(relay.send('x'), false, 'nothing is queued before open');
  sockets[0].readyState = 1; sockets[0].dispatchEvent(new Event('open'));
  assert.equal(relay.send('x'), true);
  const msg = data => Object.assign(new Event('message'), { data });
  sockets[0].dispatchEvent(msg('{"t":"viewer","connected":true}'));
  sockets[0].dispatchEvent(msg(new ArrayBuffer(4)));
  sockets[0].dispatchEvent(msg('y'.repeat(5000)));
  assert.deepEqual(received, ['{"t":"viewer","connected":true}'], 'only bounded text frames reach the takeover');
  sockets[0].readyState = 3; sockets[0].dispatchEvent(new Event('close'));
  assert.deepEqual(states, ['connected', 'disconnected']); assert.equal(timers[0][1], 1000);
  timers[0][0](); assert.equal(sockets.length, 2, 'reconnected');
  relay.close(); assert.equal(sockets[1].readyState, 3);
});

// ---- gateway tool ----------------------------------------------------------
function gateway({ takeover, control = async () => ({}) } = {}) {
  const requests = [], calls = [];
  const child = { async request(method, params) { if (method === 'tools/list') return { tools: [{ name: 'browser_snapshot', inputSchema: { type: 'object' } }, { name: 'browser_navigate', inputSchema: { type: 'object' } }] };
    calls.push(params); return { content: [{ type: 'text', text: 'Please verify you are human' }] }; }, async restart() {} };
  const controlClient = { async request(type, payload) { requests.push([type, payload]); return control(type, payload); } };
  const handle = createBrowserGateway({ child, controlClient, config: { identity, runId, attempt: 1 }, limits: browserLimits({ takeoverMs: 120000 }), takeover });
  let id = 0;
  const invoke = (name, args = {}) => handle({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } });
  return { handle, invoke, requests, calls };
}

test('browser_request_takeover: notice, progress while waiting, other calls blocked, result text, no effect entries', async () => {
  let release;
  const g = gateway({ takeover: ({ takeoverId, timeoutMs, onProgress }) => { onProgress(); assert.equal(timeoutMs, 120000); assert.match(takeoverId, /^[0-9a-f-]{36}$/);
    return new Promise(ok => { release = ok; }); } });
  const listed = (await g.handle({ jsonrpc: '2.0', id: 0, method: 'tools/list' })).result.tools.map(t => t.name);
  assert.ok(listed.includes(TAKEOVER_TOOL)); assert.ok(BROWSER_GATEWAY_TOOLS.includes(TAKEOVER_TOOL));
  assert.match((await g.invoke('browser_navigate', { url: 'https://x.example' })).result.content.at(-1).text, /Call browser_request_takeover/);
  assert.equal((await g.invoke(TAKEOVER_TOOL, {})).error.code, -32602);
  assert.equal((await g.invoke(TAKEOVER_TOOL, { reason: 'x', extra: 1 })).error.code, -32602);
  const pending = g.invoke(TAKEOVER_TOOL, { reason: 'Log in to example.com' });
  await flush();
  const open = g.requests.find(([type]) => type === 'browser-takeover');
  assert.deepEqual({ ...open[1], takeover_id: 'x' }, { identity, run_id: runId, attempt: 1, takeover_id: 'x', action: 'open', reason: 'Log in to example.com', timeout_ms: 120000 });
  assert.ok(g.requests.some(([type, p]) => type === 'progress' && p.source === 'browser'));
  assert.match((await g.invoke('browser_snapshot')).result.content[0].text, /owner is controlling the browser/);
  assert.equal(g.calls.length, 1, 'no bot call reached the browser during takeover');
  release({ outcome: 'handed_back', url: 'https://x.example/home', title: 'Home', viewed: true });
  const result = await pending;
  assert.match(result.result.content[0].text, /handed the browser back.*"Home"/);
  const end = g.requests.filter(([type]) => type === 'browser-takeover').at(-1)[1];
  assert.equal(end.action, 'end'); assert.equal(end.outcome, 'handed_back'); assert.equal(end.takeover_id, open[1].takeover_id);
  assert.ok(!g.requests.some(([type]) => type.startsWith('effect-')), 'owner control is not a bot effect');
});

test('a refused notice skips the takeover; takeovers per attempt are capped', async () => {
  let ran = 0;
  const g = gateway({ takeover: async () => { ran++; return { outcome: 'timeout', url: '', title: '', viewed: false }; },
    control: async (type, payload) => { if (type === 'browser-takeover' && payload.action === 'open' && payload.reason === 'refuse') throw Object.assign(new Error('x'), { code: 'STALE_EPOCH' }); return {}; } });
  assert.match((await g.invoke(TAKEOVER_TOOL, { reason: 'refuse' })).result.content[0].text, /Could not ask the owner/);
  assert.equal(ran, 0);
  for (let i = 0; i < 2; i++) assert.match((await g.invoke(TAKEOVER_TOOL, { reason: `r${i}` })).result.content[0].text, /did not take over/);
  assert.match((await g.invoke(TAKEOVER_TOOL, { reason: 'again' })).result.content[0].text, /already asked 3 times/);
});

test('a persistent profile held by another attempt fails the action cleanly (no restart, not unknown)', async () => {
  const requests = []; let restarts = 0;
  const child = { async request(method) { if (method === 'tools/list') return { tools: [] }; throw Object.assign(new Error('busy'), { code: 'BROWSER_PROFILE_BUSY' }); }, async restart() { restarts++; } };
  const handle = createBrowserGateway({ child, controlClient: { async request(type, payload) { requests.push([type, payload.status]); return {}; } }, config: { identity, runId, attempt: 1 } });
  const result = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'browser_click', arguments: { element: 'x', target: 'e1' } } });
  assert.match(result.result.content[0].text, /profile is in use/);
  assert.equal(restarts, 0);
  assert.deepEqual(requests.map(([type, status]) => status ?? type), ['effect-intent', 'dispatched', 'failed']);
});

// ---- launch arguments, process supervision and profile lock ----------------
test('Playwright MCP attaches over --cdp-endpoint to a Chromium the gateway launches; restart kills both', async () => {
  assert.deepEqual(playwrightArgs({ browserDir: '/b', outputDir: '/o', limits: browserLimits(), cdpEndpoint: 'ws://127.0.0.1:9/devtools/browser/x' }),
    ['/b/node_modules/@playwright/mcp/cli.js', '--cdp-endpoint', 'ws://127.0.0.1:9/devtools/browser/x', '--output-dir', '/o', '--timeout-action', '10000', '--timeout-navigation', '30000']);
  const args = chromiumArgs({ userDataDir: '/p' });
  for (const flag of ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--user-data-dir=/p', '--headless']) assert.ok(args.includes(flag), flag);
  const spawned = [], launches = [];
  const spawnImpl = (cmd, argv) => {
    const proc = new EventEmitter(); proc.kills = 0; proc.kill = () => { proc.kills++; proc.emit('exit'); };
    proc.stdout = new EventEmitter(); proc.stdout.setEncoding = () => {};
    proc.stdin = { write: line => { const m = JSON.parse(line); if (m.id) setImmediate(() => proc.stdout.emit('data', JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { tools: [] } }) + '\n')); } };
    spawned.push({ cmd, argv, proc }); return proc;
  };
  const launch = async ({ executable, userDataDir }) => { const proc = new EventEmitter(); const b = { endpoint: `ws://127.0.0.1:1/devtools/browser/${launches.length}`, proc, kills: 0, kill() { b.kills++; } };
    launches.push({ executable, userDataDir, b }); return b; };
  const out = await mkdtemp(join(tmpdir(), 'hb-gw-'));
  try {
    const child = spawnPlaywright({ browserDir: '/b', outputDir: out, limits: browserLimits(), spawnImpl, launch, findExecutable: async () => '/b/shell' });
    await child.request('tools/list', {}, { timeoutMs: 1000 });
    assert.equal(launches.length, 1); assert.ok(launches[0].userDataDir.startsWith(join(out, 'profile-')));
    assert.equal(spawned[0].argv[1].includes('oom_score_adj'), true);
    assert.ok(spawned[0].argv.includes('--cdp-endpoint') && spawned[0].argv.includes('ws://127.0.0.1:1/devtools/browser/0'));
    assert.equal(await child.cdpEndpoint(), 'ws://127.0.0.1:1/devtools/browser/0');
    await child.restart();
    assert.equal(launches[0].b.kills, 1); assert.equal(spawned[0].proc.kills, 1);
    await child.request('tools/list', {}, { timeoutMs: 1000 });
    assert.equal(launches.length, 2, 'relaunched lazily');
    launches[1].b.proc.emit('exit');
    assert.equal(spawned[1].proc.kills, 1, 'a dead browser takes Playwright MCP down with it');
    child.close();
  } finally { await rm(out, { recursive: true, force: true }); }
});

test('a persistent profile is locked to one attempt at a time; a stale lock is reclaimed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hb-lock-'));
  const profile = join(dir, 'persona');
  const holder = spawn(process.execPath, ['-e', 'setTimeout(()=>{},30000)'], { stdio: 'ignore' });
  try {
    await writeFile(`${profile}.lock`, String(holder.pid));
    await assert.rejects(lockProfile(profile), { code: 'BROWSER_PROFILE_BUSY' });
    holder.kill('SIGKILL'); await new Promise(ok => holder.once('exit', ok));
    const release = await lockProfile(profile);
    assert.equal((await readFile(`${profile}.lock`, 'utf8')).trim(), String(process.pid));
    await release();
    await assert.rejects(readFile(`${profile}.lock`), { code: 'ENOENT' });
  } finally { holder.kill('SIGKILL'); await rm(dir, { recursive: true, force: true }); }
});

// ---- real Chromium (skipped with a reason when not installed) ---------------
const browserDir = process.env.HEHEBOT_TEST_BROWSER_DIR ?? fileURLToPath(new URL('../.local/browser', import.meta.url));
const installed = await access(join(browserDir, 'node_modules/@playwright/mcp/cli.js')).then(() => true, () => false);
let wsModule = null; try { wsModule = await import('ws'); } catch {}
const skip = !installed ? `no browser stack at ${browserDir} (run HEHEBOT_BROWSER_DIR=${browserDir} HEHEBOT_BROWSER_SKIP_DEPS=1 bash scripts/setup-browser.sh)` : !wsModule ? 'ws dev dependency missing' : false;
if (skip) console.log(`# SKIP real-Chromium takeover test: ${skip}`);

test('real Chromium: screencast a frame over the relay, click through it, hand back', { skip, timeout: 90000 }, async () => {
  const page = '<!doctype html><title>Ready</title><button style="position:fixed;inset:0;width:100%;height:100%" onclick="document.title=\'Clicked\';this.textContent=\'done\'">Click me</button>';
  const http = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(page); });
  await new Promise(ok => http.listen(0, '127.0.0.1', ok));
  const wss = new wsModule.WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise(ok => wss.once('listening', ok));
  const out = await mkdtemp(join(tmpdir(), 'hb-real-'));
  const child = spawnPlaywright({ browserDir, outputDir: out, limits: browserLimits() });
  let cdp;
  try {
    await child.request('tools/call', { name: 'browser_navigate', arguments: { url: `http://127.0.0.1:${http.address().port}/` } }, { timeoutMs: 30000 });
    // The fake Worker relay: checks the runtime headers, then plays the owner.
    const seen = { headers: null, frames: 0, metas: [] };
    const owner = new Promise((resolve, reject) => {
      wss.on('connection', (socket, request) => {
        seen.headers = request.headers;
        socket.send(JSON.stringify({ t: 'viewer', connected: true }));
        let clicked = false;
        socket.on('message', (data, binary) => {
          if (binary) {
            seen.frames++;
            if (data[0] !== 0xff || data[1] !== 0xd8) reject(new Error('not a JPEG'));
            if (!clicked) { clicked = true;
              socket.send(JSON.stringify({ t: 'mouse', type: 'down', x: 0.5, y: 0.5, button: 'left', clicks: 1 }));
              socket.send(JSON.stringify({ t: 'mouse', type: 'up', x: 0.5, y: 0.5, button: 'left', clicks: 1 })); }
            return;
          }
          const frame = JSON.parse(String(data));
          if (frame.t === 'meta') { seen.metas.push(frame); if (frame.title === 'Clicked') socket.send(JSON.stringify({ t: 'handback' })); }
          if (frame.t === 'end') resolve(frame);
        });
      });
    });
    cdp = await CdpConnection.connect(await child.cdpEndpoint());
    const url = relayUrl(`http://127.0.0.1:${wss.address().port}`, { takeoverId: '33333333-3333-4333-8333-333333333333', runId, attempt: 1, identity });
    const result = await runTakeover({ cdp, timeoutMs: 60000, openRelay: onMessage => connectRelay({ url, headers: { Authorization: 'Bearer runtime-token' }, onMessage }) });
    assert.deepEqual(await owner, { t: 'end', outcome: 'handed_back' });
    assert.equal(seen.headers.authorization, 'Bearer runtime-token');
    assert.ok(seen.frames >= 1);
    assert.equal(result.outcome, 'handed_back'); assert.equal(result.title, 'Clicked');
    assert.ok(seen.metas[0].w > 0 && seen.metas[0].w <= 1280);
    // The bot sees the owner's change through its own Playwright session.
    const snapshot = await child.request('tools/call', { name: 'browser_snapshot', arguments: {} }, { timeoutMs: 30000 });
    assert.match(JSON.stringify(snapshot), /done/);
  } finally {
    cdp?.close(); child.close(); wss.close(); http.close();
    await rm(out, { recursive: true, force: true });
  }
});

test('real Chromium: a killed gateway takes its browser with it (no orphan)', { skip, timeout: 60000 }, async () => {
  const out = await mkdtemp(join(tmpdir(), 'hb-orphan-'));
  const script = `import { spawnPlaywright, browserLimits } from ${JSON.stringify(new URL('../runtime/browser-gateway.mjs', import.meta.url).href)};
    const child = spawnPlaywright({ browserDir: ${JSON.stringify(browserDir)}, outputDir: ${JSON.stringify(out)}, limits: browserLimits() });
    console.log(await child.cdpEndpoint()); setInterval(() => {}, 1000);`;
  const gatewayProc = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    const endpoint = await new Promise((ok, reject) => { let text = ''; gatewayProc.stdout.on('data', d => { text += d; if (text.includes('\n')) ok(text.trim()); }); gatewayProc.once('exit', () => reject(new Error('gateway exited'))); });
    const probe = await CdpConnection.connect(endpoint); probe.close();
    gatewayProc.kill('SIGKILL');
    const deadline = Date.now() + 10000;
    let alive = true;
    while (alive && Date.now() < deadline) {
      await new Promise(ok => setTimeout(ok, 200));
      alive = await CdpConnection.connect(endpoint, { timeoutMs: 1000 }).then(c => { c.close(); return true; }, () => false);
    }
    assert.equal(alive, false, 'Chromium must exit when its gateway dies');
  } finally { gatewayProc.kill('SIGKILL'); await rm(out, { recursive: true, force: true }); }
});

test('real Chromium: the portal viewer draws frames and turns a click and typing into input frames', { skip, timeout: 60000 }, async () => {
  const script = await readFile(new URL('../public/takeover.js', import.meta.url), 'utf8');
  const page = `<!doctype html><title>viewer</title><body><script type="module">import { openTakeover } from '/takeover.js'; window.handle = openTakeover({ takeoverId: '44444444-4444-4444-8444-444444444444', botName: 'Chief', detail: 'Log in' });</script>`;
  const http = createServer((req, res) => {
    if (req.url === '/takeover.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(script); return; }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(page);
  });
  const wss = new wsModule.WebSocketServer({ server: http, path: '/v1/takeover/stream' });
  await new Promise(ok => http.listen(0, '127.0.0.1', ok));
  const out = await mkdtemp(join(tmpdir(), 'hb-viewer-'));
  const child = spawnPlaywright({ browserDir, outputDir: out, limits: browserLimits() });
  let cdp;
  try {
    cdp = await CdpConnection.connect(await child.cdpEndpoint());
    const [target] = (await cdp.send('Target.getTargets')).targetInfos.filter(t => t.type === 'page');
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    const shot = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 50 }, sessionId)).data, 'base64');
    const inputs = [];
    const gotInputs = new Promise(ok => wss.on('connection', (socket, request) => {
      assert.match(request.url, /takeover_id=44444444-4444-4444-8444-444444444444/);
      socket.send(JSON.stringify({ t: 'peer', runtime: true }));
      socket.send(JSON.stringify({ t: 'meta', url: 'https://login.example/', title: 'Log in', w: 1280, h: 800 }));
      socket.send(shot);
      socket.on('message', data => { const frame = JSON.parse(String(data)); inputs.push(frame); if (frame.t === 'text') ok(); });
    }));
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${http.address().port}/` }, sessionId);
    const evaluate = async expression => (await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)).result.value;
    let box = null;
    for (let i = 0; i < 50 && !box; i++) {
      await new Promise(ok => setTimeout(ok, 100));
      box = await evaluate(`(() => { const c = document.querySelector('.takeover-screen'); return c && c.width === ${1280} && c.height > 0 && document.querySelector('.takeover[data-state=live]') ? (({x,y,width,height}) => ({x,y,width,height}))(c.getBoundingClientRect()) : null; })()`);
    }
    assert.ok(box, 'viewer went live and sized the canvas from the frame');
    const at = { x: box.x + box.width * 0.25, y: box.y + box.height * 0.5 };
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...at, button: 'left', clickCount: 1 }, sessionId);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at, button: 'left', clickCount: 1 }, sessionId);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'x', text: 'x' }, sessionId);
    await evaluate(`(() => { const i = document.querySelector('.takeover-type input'); i.value = 'hello'; i.form.requestSubmit(); })()`);
    await gotInputs;
    const down = inputs.find(f => f.t === 'mouse' && f.type === 'down');
    assert.ok(Math.abs(down.x - 0.25) < 0.02 && Math.abs(down.y - 0.5) < 0.02, JSON.stringify(down));
    assert.ok(inputs.some(f => f.t === 'key' && f.key === 'x' && f.type === 'down'));
    assert.deepEqual(inputs.at(-1), { t: 'text', text: 'hello' });
    assert.equal(await evaluate(`document.querySelector('.takeover-url input').value`), 'https://login.example/');
  } finally { cdp?.close(); await child.close(); wss.close(); http.close(); await rm(out, { recursive: true, force: true }); }
});

test('real Chromium: a persistent profile keeps cookies across a browser restart and is released on close', { skip, timeout: 60000 }, async () => {
  const out = await mkdtemp(join(tmpdir(), 'hb-profile-'));
  const http = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html', ...(req.url === '/login' ? { 'set-cookie': 'session=owner; Max-Age=3600' } : {}) }); res.end(`<title>${req.headers.cookie ?? 'none'}</title>`); });
  await new Promise(ok => http.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${http.address().port}`;
  const profileDir = join(out, 'profiles', 'persona');
  const child = spawnPlaywright({ browserDir, outputDir: out, limits: browserLimits(), profileDir });
  try {
    await child.request('tools/call', { name: 'browser_navigate', arguments: { url: `${base}/login` } }, { timeoutMs: 30000 });
    await assert.rejects(lockProfile(profileDir), { code: 'BROWSER_PROFILE_BUSY' });
    await child.restart();
    const again = await child.request('tools/call', { name: 'browser_navigate', arguments: { url: `${base}/home` } }, { timeoutMs: 30000 });
    assert.match(JSON.stringify(again), /session=owner/);
  } finally { await child.close(); http.close(); }
  const release = await lockProfile(profileDir); await release();
  await rm(out, { recursive: true, force: true });
});
