/** Owner browser takeover, runtime side (docs/BROWSER_TAKEOVER.md).
 *
 * A second CDP client (next to Playwright MCP) attaches to the current page,
 * streams a bounded JPEG screencast to the owner through an outbound relay
 * socket to the Worker, and maps the owner's input events to CDP Input.*.
 * Owner input is the owner's own action: it is never recorded as an effect.
 * Nothing from the viewer can run script or open non-http(s) URLs. */

export const TAKEOVER_DEFAULTS = Object.freeze({ maxFps: 5, maxWidth: 1280, maxHeight: 1280, quality: 60, minQuality: 30,
  maxFrameBytes: 900 * 1024, maxBufferedBytes: 1024 * 1024, inputPerSecond: 60, progressMs: 30000, cdpCallMs: 10000 });
export const NAMED_KEYS = Object.freeze({
  Enter: { code: 'Enter', keyCode: 13, text: '\r' }, Tab: { code: 'Tab', keyCode: 9 }, Backspace: { code: 'Backspace', keyCode: 8 },
  Delete: { code: 'Delete', keyCode: 46 }, Escape: { code: 'Escape', keyCode: 27 }, ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 }, ArrowRight: { code: 'ArrowRight', keyCode: 39 }, ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  Home: { code: 'Home', keyCode: 36 }, End: { code: 'End', keyCode: 35 }, PageUp: { code: 'PageUp', keyCode: 33 }, PageDown: { code: 'PageDown', keyCode: 34 },
  Shift: { code: 'ShiftLeft', keyCode: 16 }, Control: { code: 'ControlLeft', keyCode: 17 }, Alt: { code: 'AltLeft', keyCode: 18 }, Meta: { code: 'MetaLeft', keyCode: 91 },
});
export const MAX_INPUT_BYTES = 4096;
const unit = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const mods = v => v === undefined || Number.isInteger(v) && v >= 0 && v <= 15;
const exact = (o, keys) => Object.keys(o).every(k => keys.includes(k));

/** Same contract as src/core/browser-takeover.ts validateTakeoverInput; the
 * Worker validates first, the runtime validates again. */
export function validateTakeoverInput(raw) {
  let v = raw;
  if (typeof raw === 'string') {
    if (raw.length > MAX_INPUT_BYTES) return null;
    try { v = JSON.parse(raw); } catch { return null; }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  switch (v.t) {
    case 'mouse':
      if (!exact(v, ['t', 'type', 'x', 'y', 'button', 'clicks', 'mods']) || !['down', 'up', 'move'].includes(v.type) || !unit(v.x) || !unit(v.y) ||
        !['left', 'right', 'middle', 'none', undefined].includes(v.button) || !(v.clicks === undefined || Number.isInteger(v.clicks) && v.clicks >= 0 && v.clicks <= 3) || !mods(v.mods)) return null;
      return { t: 'mouse', type: v.type, x: v.x, y: v.y, button: v.button ?? (v.type === 'move' ? 'none' : 'left'), clicks: v.clicks ?? (v.type === 'move' ? 0 : 1), mods: v.mods ?? 0 };
    case 'wheel':
      if (!exact(v, ['t', 'x', 'y', 'dx', 'dy']) || !unit(v.x) || !unit(v.y) || ![v.dx ?? 0, v.dy ?? 0].every(d => typeof d === 'number' && Number.isFinite(d) && Math.abs(d) <= 5000)) return null;
      return { t: 'wheel', x: v.x, y: v.y, dx: v.dx ?? 0, dy: v.dy ?? 0 };
    case 'key':
      if (!exact(v, ['t', 'type', 'key', 'mods']) || !['down', 'up'].includes(v.type) || typeof v.key !== 'string' || !mods(v.mods)) return null;
      if (!Object.hasOwn(NAMED_KEYS, v.key) && !(Array.from(v.key).length === 1 && !/[\p{Cc}\p{Cf}]/u.test(v.key))) return null;
      return { t: 'key', type: v.type, key: v.key, mods: v.mods ?? 0 };
    case 'text':
      if (!exact(v, ['t', 'text']) || typeof v.text !== 'string' || !v.text.length || v.text.length > 1000 || /[\p{Cc}]/u.test(v.text.replace(/\n/g, ''))) return null;
      return { t: 'text', text: v.text };
    case 'navigate': {
      if (!exact(v, ['t', 'url']) || typeof v.url !== 'string' || v.url.length > 2048) return null;
      let url; try { url = new URL(v.url); } catch { return null; }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
      return { t: 'navigate', url: url.href };
    }
    case 'handback': case 'cancel':
      return exact(v, ['t']) ? { t: v.t } : null;
    default: return null;
  }
}

const BUTTONS = { left: 'left', right: 'right', middle: 'middle', none: 'none' };
/** Maps one validated input to CDP calls. `view` is the page's CSS viewport
 * ({width,height}); coordinates arrive normalized to the streamed frame. */
export function inputToCdp(input, view) {
  const at = (x, y) => ({ x: Math.round(x * view.width * 100) / 100, y: Math.round(y * view.height * 100) / 100 });
  switch (input.t) {
    case 'mouse': return [['Input.dispatchMouseEvent', { type: { down: 'mousePressed', up: 'mouseReleased', move: 'mouseMoved' }[input.type], ...at(input.x, input.y),
      button: BUTTONS[input.button], clickCount: input.clicks, modifiers: input.mods }]];
    case 'wheel': return [['Input.dispatchMouseEvent', { type: 'mouseWheel', ...at(input.x, input.y), deltaX: input.dx, deltaY: input.dy }]];
    case 'key': {
      const named = NAMED_KEYS[input.key];
      // Ctrl/Alt/Meta chords are raw key events without text (shortcuts);
      // plain printable keys type their character.
      const chord = (input.mods & 7) !== 0;
      const text = named ? named.text : (chord ? undefined : input.key);
      const keyCode = named ? named.keyCode : /^[a-z0-9]$/i.test(input.key) ? input.key.toUpperCase().charCodeAt(0) : 0;
      const code = named ? named.code : /^[a-z]$/i.test(input.key) ? `Key${input.key.toUpperCase()}` : /^[0-9]$/.test(input.key) ? `Digit${input.key}` : undefined;
      if (input.type === 'up') return [['Input.dispatchKeyEvent', { type: 'keyUp', key: input.key, ...(code ? { code } : {}), windowsVirtualKeyCode: keyCode, modifiers: input.mods }]];
      return [['Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: input.key, ...(code ? { code } : {}), windowsVirtualKeyCode: keyCode,
        modifiers: input.mods, ...(text ? { text, unmodifiedText: text } : {}) }]];
    }
    case 'text': return [['Input.insertText', { text: input.text }]];
    case 'navigate': return [['Page.navigate', { url: input.url }]];
    default: return [];
  }
}

/** Minimal CDP client over a WebSocket (browser endpoint, flattened sessions). */
export class CdpConnection {
  #ws; #next = 1; #pending = new Map(); #listeners = new Set(); #closed = false;
  constructor(ws) {
    this.#ws = ws;
    ws.addEventListener('message', event => {
      let message; try { message = JSON.parse(typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8')); } catch { return; }
      if (message.id !== undefined) {
        const waiter = this.#pending.get(message.id); if (!waiter) return;
        this.#pending.delete(message.id); clearTimeout(waiter.timer);
        if (message.error) waiter.reject(Object.assign(new Error('CDP_ERROR'), { code: 'CDP_ERROR', detail: String(message.error.message ?? '').slice(0, 200) }));
        else waiter.resolve(message.result ?? {});
      } else for (const listener of this.#listeners) { try { listener(message.method, message.params ?? {}, message.sessionId); } catch {} }
    });
    ws.addEventListener('close', () => this.#fail());
    ws.addEventListener('error', () => this.#fail());
  }
  #fail() {
    this.#closed = true;
    for (const [id, waiter] of this.#pending) { clearTimeout(waiter.timer); waiter.reject(Object.assign(new Error('CDP_CLOSED'), { code: 'CDP_CLOSED' })); this.#pending.delete(id); }
    for (const listener of this.#listeners) { try { listener('hehebot.closed', {}, undefined); } catch {} }
  }
  static connect(url, { WebSocketImpl = globalThis.WebSocket, timeoutMs = 10000 } = {}) {
    return new Promise((resolve, reject) => {
      let ws; try { ws = new WebSocketImpl(url); } catch (error) { reject(error); return; }
      const timer = setTimeout(() => { try { ws.close(); } catch {} reject(Object.assign(new Error('CDP_CONNECT_TIMEOUT'), { code: 'CDP_CONNECT_TIMEOUT' })); }, timeoutMs);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(new CdpConnection(ws)); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(timer); reject(Object.assign(new Error('CDP_CONNECT_FAILED'), { code: 'CDP_CONNECT_FAILED' })); }, { once: true });
    });
  }
  get closed() { return this.#closed; }
  on(listener) { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  send(method, params = {}, sessionId, timeoutMs = TAKEOVER_DEFAULTS.cdpCallMs) {
    if (this.#closed) return Promise.reject(Object.assign(new Error('CDP_CLOSED'), { code: 'CDP_CLOSED' }));
    return new Promise((resolve, reject) => {
      const id = this.#next++;
      const timer = setTimeout(() => { this.#pending.delete(id); reject(Object.assign(new Error('CDP_TIMEOUT'), { code: 'CDP_TIMEOUT' })); }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      this.#ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  close() { this.#closed = true; try { this.#ws.close(); } catch {} }
}

/** Relay URL for the Worker's runtime-side takeover socket. */
export function relayUrl(origin, { takeoverId, runId, attempt, identity }) {
  const url = new URL('/internal/takeover/stream', origin);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) throw new Error('INVALID_CONFIGURATION');
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.search = new URLSearchParams({ takeover_id: takeoverId, run_id: runId, attempt: String(attempt), epoch: String(identity.epoch), boot_id: identity.boot_id }).toString();
  return url.href;
}

/** Outbound relay socket with reconnect (1, 2, 4 … 15 s). Headers carry the
 * same runtime token and Access service token as ControlClient. Node's
 * built-in WebSocket (undici) accepts `{ headers }`. */
export function connectRelay({ url, headers, WebSocketImpl = globalThis.WebSocket, onMessage, onState = () => {}, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let ws = null, closed = false, delay = 1000, timer = null;
  const open = () => {
    if (closed) return;
    let socket; try { socket = new WebSocketImpl(url, { headers }); } catch { schedule(); return; }
    socket.binaryType = 'arraybuffer';
    ws = socket;
    socket.addEventListener('open', () => { delay = 1000; onState('connected'); });
    socket.addEventListener('message', event => { if (typeof event.data === 'string' && event.data.length <= MAX_INPUT_BYTES) onMessage(event.data); });
    socket.addEventListener('close', () => { if (ws === socket) { ws = null; onState('disconnected'); schedule(); } });
    socket.addEventListener('error', () => {});
  };
  const schedule = () => { if (closed || timer) return; timer = setTimer(() => { timer = null; open(); }, delay); delay = Math.min(15000, delay * 2); };
  open();
  return {
    get open() { return !!ws && ws.readyState === 1; },
    get bufferedAmount() { return ws?.bufferedAmount ?? 0; },
    send(data) { if (ws && ws.readyState === 1) { ws.send(data); return true; } return false; },
    close() { closed = true; if (timer) clearTimer(timer); const socket = ws; ws = null; try { socket?.close(1000, 'done'); } catch {} },
  };
}

/** Runs one takeover until hand-back, cancel or timeout. `cdp` is a
 * CdpConnection-like object ({send,on,closed}); `relay` is created by
 * `openRelay(onMessage)` and returns {send,close,bufferedAmount}. Resolves to
 * {outcome, url, title, viewed}. Never throws for owner/network trouble. */
export async function runTakeover({ cdp, openRelay, timeoutMs, onProgress = () => {}, limits = TAKEOVER_DEFAULTS, clock = { now: Date.now, setTimeout, clearTimeout, setInterval, clearInterval } }) {
  let session = null, targetId = null, streaming = false, viewer = false, viewed = false, quality = limits.quality, lastFrameAt = 0;
  let url = '', title = '', view = { width: 1280, height: 720 }, finish, window = 0, count = 0, relay, infoAt = 0, chain = Promise.resolve();
  const known = new Set();
  const done = new Promise(resolve => { finish = resolve; });
  let ended = false;
  const end = outcome => { if (!ended) { ended = true; finish(outcome); } };
  const meta = () => relay?.send(JSON.stringify({ t: 'meta', url: url.slice(0, 2048), title: title.slice(0, 300), w: view.width, h: view.height }));
  const pages = async () => ((await cdp.send('Target.getTargets')).targetInfos ?? []).filter(t => t.type === 'page' && !t.url.startsWith('devtools://'));
  const stopScreencast = async () => { if (session && streaming) { streaming = false; await cdp.send('Page.stopScreencast', {}, session).catch(() => {}); } };
  const startScreencast = async () => {
    if (!session || streaming || !viewer) return;
    streaming = true;
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality, maxWidth: limits.maxWidth, maxHeight: limits.maxHeight, everyNthFrame: 1 }, session).catch(() => { streaming = false; });
    // A still page emits no screencast frames; send one now so the owner sees it.
    const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality }, session).catch(() => null);
    if (shot?.data) sendFrame(Buffer.from(shot.data, 'base64'));
  };
  // Page title/url: targetInfoChanged is not reliable for title changes, so
  // the info is also re-read at most once a second while frames flow.
  const refreshInfo = async () => {
    if (!targetId) return;
    const info = (await cdp.send('Target.getTargetInfo', { targetId }).catch(() => null))?.targetInfo;
    if (info && (info.url !== url || info.title !== title)) { url = info.url; title = info.title; meta(); }
  };
  // Target switches are serialized: events and the initial attach never race.
  const attach = id => (chain = chain.then(() => attachNow(id)).catch(() => {}));
  const attachNow = async id => {
    if (id === targetId && session) return;
    await stopScreencast();
    if (session) { const old = session; session = null; await cdp.send('Target.detachFromTarget', { sessionId: old }).catch(() => {}); }
    targetId = id;
    if (!id) return;
    const attached = await cdp.send('Target.attachToTarget', { targetId: id, flatten: true });
    session = attached.sessionId;
    await cdp.send('Page.enable', {}, session).catch(() => {});
    const metrics = await cdp.send('Page.getLayoutMetrics', {}, session).catch(() => null);
    const css = metrics?.cssVisualViewport ?? metrics?.cssLayoutViewport;
    if (css?.clientWidth > 0 && css?.clientHeight > 0) view = { width: css.clientWidth, height: css.clientHeight };
    const info = (await pages().catch(() => [])).find(t => t.targetId === id);
    if (info) { url = info.url; title = info.title; }
    meta();
    await startScreencast();
  };
  const sendFrame = bytes => {
    if (!relay || !viewer) return;
    if (bytes.byteLength > limits.maxFrameBytes) { quality = Math.max(limits.minQuality, quality - 10); return; }
    if (relay.bufferedAmount > limits.maxBufferedBytes) return; // backpressure: drop, the next frame supersedes it
    relay.send(bytes);
  };
  const off = cdp.on((method, params, sessionId) => {
    if (method === 'hehebot.closed') { end('failed'); return; }
    if (method === 'Page.screencastFrame' && sessionId === session) {
      const md = params.metadata ?? {};
      if (md.deviceWidth > 0 && md.deviceHeight > 0 && (md.deviceWidth !== view.width || md.deviceHeight !== view.height)) { view = { width: md.deviceWidth, height: md.deviceHeight }; meta(); }
      sendFrame(Buffer.from(params.data ?? '', 'base64'));
      if (clock.now() - infoAt >= 1000) { infoAt = clock.now(); void refreshInfo(); }
      // Acknowledging late caps the frame rate: Chromium sends the next frame only after the ack.
      const wait = Math.max(0, lastFrameAt + 1000 / limits.maxFps - clock.now());
      lastFrameAt = clock.now() + wait;
      const ack = () => { cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId }, session).catch(() => {}); };
      if (wait > 0) clock.setTimeout(ack, wait); else ack();
    } else if (method === 'Target.targetCreated' && params.targetInfo?.type === 'page' && !known.has(params.targetInfo.targetId)) {
      // A new page (e.g. an OAuth popup) becomes the page the owner sees.
      known.add(params.targetInfo.targetId);
      void attach(params.targetInfo.targetId);
    } else if (method === 'Target.targetDestroyed' && params.targetId === targetId) {
      session = null; streaming = false;
      void pages().then(list => attach(list.at(-1)?.targetId ?? null)).catch(() => {});
    } else if (method === 'Target.targetDestroyed') { known.delete(params.targetId);
    } else if (method === 'Target.targetInfoChanged' && params.targetInfo?.targetId === targetId) {
      url = params.targetInfo.url; title = params.targetInfo.title; meta();
    }
  });
  const onMessage = async text => {
    let frame; try { frame = JSON.parse(text); } catch { return; }
    if (frame?.t === 'viewer' && typeof frame.connected === 'boolean') {
      viewer = frame.connected;
      if (viewer) { viewed = true; meta(); await startScreencast(); } else await stopScreencast();
      return;
    }
    const input = validateTakeoverInput(frame);
    if (!input) return;
    const second = Math.floor(clock.now() / 1000);
    if (second !== window) { window = second; count = 0; }
    if (++count > limits.inputPerSecond) return;
    viewed = true;
    if (input.t === 'handback') { end('handed_back'); return; }
    if (input.t === 'cancel') { end('cancelled'); return; }
    if (!session) return;
    for (const [method, params] of inputToCdp(input, view)) await cdp.send(method, params, session).catch(() => {});
    if (input.t === 'navigate' || input.t === 'mouse' && input.type === 'up' || input.t === 'key' && input.key === 'Enter') clock.setTimeout(() => { void refreshInfo(); }, 500);
  };
  const timeout = clock.setTimeout(() => end('timeout'), timeoutMs);
  const ticker = clock.setInterval(() => { try { onProgress(); } catch {} }, limits.progressMs);
  try { onProgress(); } catch {}
  try {
    relay = openRelay(text => { void onMessage(text); });
    const list = await pages().catch(() => []);
    for (const page of list) known.add(page.targetId);
    await cdp.send('Target.setDiscoverTargets', { discover: true }).catch(() => {});
    await attach(list.at(-1)?.targetId ?? null);
  } catch { end('failed'); }
  const outcome = await done;
  clock.clearTimeout(timeout); clock.clearInterval(ticker); off();
  await chain;
  if (outcome !== 'failed') await refreshInfo();
  await stopScreencast();
  if (session) await cdp.send('Target.detachFromTarget', { sessionId: session }).catch(() => {});
  try { relay?.send(JSON.stringify({ t: 'end', outcome })); } catch {}
  try { relay?.close(); } catch {}
  return { outcome, url, title, viewed };
}

export function takeoverResultText({ outcome, url, title, viewed }, timeoutMs) {
  const page = url ? ` Current page: "${title || 'untitled'}" ${url}.` : '';
  const minutes = Math.round(timeoutMs / 60000);
  switch (outcome) {
    case 'handed_back': return `The owner handed the browser back.${page} Take a fresh browser_snapshot before continuing; do not repeat steps the owner already completed.`;
    case 'cancelled': return `The owner cancelled the takeover.${page} Do not retry the blocked step; tell the owner with hehebot_send_message what you could not finish, and stop.`;
    case 'timeout': return viewed
      ? `The owner looked at the browser but did not hand it back within ${minutes} min.${page} Take a fresh browser_snapshot; if still blocked, tell the owner and stop.`
      : `The owner did not take over within ${minutes} min. Tell the owner with hehebot_send_message what is needed, and stop.`;
    default: return `Browser takeover failed (the browser is unavailable). Tell the owner with hehebot_send_message what is needed, and stop.`;
  }
}
