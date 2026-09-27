// Owner browser takeover viewer (docs/BROWSER_TAKEOVER.md). Opens
// /v1/takeover/stream (owner Access + same origin), draws the runtime's JPEG
// screencast on a canvas and sends only input events, an http(s) URL, hand
// back or cancel. Frames are decoded with createImageBitmap (no img-src/blob
// CSP widening needed).
const NAMED = new Set(['Enter', 'Tab', 'Backspace', 'Delete', 'Escape', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
const btn = (text, fn, cls = 'quiet') => { const b = el('button', text, cls); b.type = 'button'; b.onclick = fn; return b; };
const mods = e => (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
let current = null;

export function openTakeover({ takeoverId, botName = 'The bot', detail = '' }) {
  if (!/^[0-9a-f-]{36}$/i.test(takeoverId)) return;
  current?.close();
  const root = el('div', undefined, 'takeover'); root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Browser takeover');
  const head = el('div', undefined, 'takeover-head');
  const title = el('div', undefined, 'takeover-title'); title.append(el('strong', `${botName} needs you in its browser`), el('span', detail, 'takeover-detail'));
  const status = el('span', 'Connecting…', 'status takeover-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const handBack = btn('Hand back to bot', () => send({ t: 'handback' }), 'primary');
  const cancel = btn('Cancel', () => send({ t: 'cancel' }));
  const closeViewer = btn('Close viewer', () => close());
  const actions = el('div', undefined, 'takeover-actions'); actions.append(handBack, cancel, closeViewer);
  head.append(title, status, actions);
  const urlForm = el('form', undefined, 'takeover-url'); const url = el('input'); url.type = 'url'; url.placeholder = 'https://…'; url.setAttribute('aria-label', 'Page address');
  urlForm.append(url, btn('Go', () => urlForm.requestSubmit()));
  urlForm.onsubmit = e => { e.preventDefault(); if (/^https?:\/\//i.test(url.value.trim())) send({ t: 'navigate', url: url.value.trim() }); };
  const canvas = el('canvas', undefined, 'takeover-screen'); canvas.width = 1280; canvas.height = 800; canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Live browser. Click to interact; keys are sent to the page.');
  // Phone / fallback typing: text is inserted at the focused field.
  const typeForm = el('form', undefined, 'takeover-type'); const text = el('input'); text.type = 'text'; text.autocomplete = 'off'; text.placeholder = 'Type into the page…'; text.setAttribute('aria-label', 'Text to type into the page');
  typeForm.append(text, btn('Send text', () => typeForm.requestSubmit()), btn('Enter', () => key('Enter')), btn('⌫', () => key('Backspace')), btn('Tab', () => key('Tab')));
  typeForm.onsubmit = e => { e.preventDefault(); if (text.value) { send({ t: 'text', text: text.value.slice(0, 1000) }); text.value = ''; } };
  const note = el('p', 'Everything you do here is your own action in the bot\'s browser. The bot waits until you hand it back.', 'hint');
  root.append(head, urlForm, canvas, typeForm, note);
  document.body.append(root);
  const ctx = canvas.getContext('2d');
  let ws = null, live = false, ended = false, lastMove = 0, pingTimer = null;
  const setStatus = (text, state) => { status.textContent = text; root.dataset.state = state; };
  const setControls = enabled => { for (const b of [handBack, cancel, ...typeForm.querySelectorAll('button'), ...urlForm.querySelectorAll('button')]) b.disabled = !enabled; };
  setControls(false);
  function send(frame) { if (ws?.readyState === 1 && !ended) ws.send(JSON.stringify(frame)); }
  function key(k) { send({ t: 'key', type: 'down', key: k, mods: 0 }); send({ t: 'key', type: 'up', key: k, mods: 0 }); }
  const point = e => { const r = canvas.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }; };
  const button = e => ['left', 'middle', 'right'][e.button] ?? 'left';
  canvas.addEventListener('pointerdown', e => { e.preventDefault(); canvas.focus(); canvas.setPointerCapture?.(e.pointerId); send({ t: 'mouse', type: 'down', ...point(e), button: button(e), clicks: Math.min(3, Math.max(1, e.detail || 1)), mods: mods(e) }); });
  canvas.addEventListener('pointerup', e => { e.preventDefault(); send({ t: 'mouse', type: 'up', ...point(e), button: button(e), clicks: Math.min(3, Math.max(1, e.detail || 1)), mods: mods(e) }); });
  canvas.addEventListener('pointermove', e => { const now = performance.now(); if (now - lastMove < 50) return; lastMove = now; send({ t: 'mouse', type: 'move', ...point(e), mods: mods(e) }); });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('wheel', e => { e.preventDefault(); const f = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
    send({ t: 'wheel', ...point(e), dx: Math.max(-5000, Math.min(5000, e.deltaX * f)), dy: Math.max(-5000, Math.min(5000, e.deltaY * f)) }); }, { passive: false });
  const onKey = type => e => {
    const named = NAMED.has(e.key), printable = [...e.key].length === 1;
    if (!named && !printable) return;
    e.preventDefault();
    send({ t: 'key', type, key: e.key, mods: mods(e) });
  };
  canvas.addEventListener('keydown', onKey('down'));
  canvas.addEventListener('keyup', onKey('up'));
  canvas.addEventListener('paste', e => { const value = e.clipboardData?.getData('text'); if (value) { e.preventDefault(); send({ t: 'text', text: value.slice(0, 1000) }); } });
  const draw = async data => {
    try {
      const image = await createImageBitmap(new Blob([data], { type: 'image/jpeg' }));
      if (canvas.width !== image.width || canvas.height !== image.height) { canvas.width = image.width; canvas.height = image.height; }
      ctx.drawImage(image, 0, 0); image.close?.();
    } catch {}
  };
  const finish = (text, state) => { ended = true; live = false; setControls(false); setStatus(text, state); };
  function connect() {
    let socket;
    try { socket = new WebSocket(`${location.protocol === 'https:' ? 'wss://' : 'ws://'}${location.host}/v1/takeover/stream?takeover_id=${encodeURIComponent(takeoverId)}`); }
    catch { finish('Could not connect.', 'error'); return; }
    socket.binaryType = 'arraybuffer'; ws = socket;
    let opened = false;
    socket.onopen = () => { opened = true; setStatus('Connected. Waiting for the bot\'s browser…', 'waiting'); pingTimer = setInterval(() => { try { socket.send('ping'); } catch {} }, 25000); };
    socket.onmessage = event => {
      if (typeof event.data !== 'string') { void draw(event.data); return; }
      let frame; try { frame = JSON.parse(event.data); } catch { return; }
      if (frame.t === 'peer') { live = !!frame.runtime; setControls(live); setStatus(live ? 'Connected. You have control; the bot is waiting.' : 'Bot\'s browser is not connected yet; waiting…', live ? 'live' : 'waiting'); }
      else if (frame.t === 'meta') { if (document.activeElement !== url) url.value = frame.url ?? ''; canvas.setAttribute('aria-label', `Live browser: ${frame.title || frame.url || 'page'}`); if (!live) { live = true; setControls(true); setStatus('Connected. You have control; the bot is waiting.', 'live'); } }
      else if (frame.t === 'end') finish({ handed_back: 'Handed back to the bot.', cancelled: 'Cancelled. The bot was told.', timeout: 'Timed out; the bot stopped waiting.' }[frame.outcome] ?? 'Takeover ended.', 'ended');
      else if (frame.t === 'error') setStatus('That input was refused.', root.dataset.state);
    };
    socket.onerror = () => {};
    socket.onclose = event => {
      clearInterval(pingTimer); if (ws === socket) ws = null;
      if (ended) return;
      if (!opened) finish('This takeover is no longer open.', 'ended');
      else if (event.code === 4001) finish('Opened in another window.', 'ended');
      else if (event.code === 1000) finish('Takeover ended.', 'ended');
      else { setStatus('Connection lost; reconnecting…', 'waiting'); setControls(false); setTimeout(() => { if (!ended && current === handle) connect(); }, 2000); }
    };
  }
  function close() { ended = true; clearInterval(pingTimer); try { ws?.close(1000, 'viewer closed'); } catch {} ws = null; root.remove(); if (current === handle) current = null; document.removeEventListener('keydown', escape); }
  const escape = e => { if (e.key === 'Escape' && document.activeElement !== canvas) close(); };
  document.addEventListener('keydown', escape);
  const handle = { close };
  current = handle;
  connect();
  canvas.focus();
  return handle;
}
