#!/usr/bin/env node
// V6: ARCHITECTURE_V2 A6 streamed timeline, `GET /v1/stream`, exercised in real
// local workerd (real Durable Object WebSocket Hibernation upgrade, real
// WebSocketPair, real setWebSocketAutoResponse) instead of the mocked ctx
// tests/stream.test.ts uses (Node has no WebSocketPair). Same pattern as the
// other bundle-with-esbuild-and-run-Miniflare fixtures (scripts/
// test-memory-tokenizer.mjs, tests/fixtures/hosted-control.mjs): the actual
// src/worker/index.ts + src/worker/control-object.ts are bundled unmodified
// and served by a real Miniflare-hosted workerd instance. `AUTH_MODE=local`
// loopback auth bypass matches wrangler.jsonc's `env.local` exactly (same
// vars as scripts/test-control-crash.mjs and scripts/
// test-routine-capacity-worker.mjs assert), so no synthetic Access JWT/JWKS
// plumbing is needed.
//
// `Miniflare#ready` resolves to a real, directly-connectable loopback HTTP
// listener backed by the actual workerd process (verified: a plain
// node:http request against it reaches the real Worker fetch handler, Host
// header included, exactly like a real client connection). That listener
// performs a real HTTP Upgrade handshake for `/v1/stream`, so a real
// WebSocket client (the `ws` package — Node's global WebSocket/fetch cannot
// set the `Origin` header the Fetch spec forbids, but this is exactly the
// header ARCHITECTURE_V2 A6 depends on) proves the real workerd upgrade path,
// not a mock.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import WebSocket from 'ws';

const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)));

function rawRequest(url, { method = 'GET', host, headers = {}, body } = {}) {
  return new Promise((resolvePromise, reject) => {
    const req = http.request(url, {
      method,
      headers: { ...(host !== undefined ? { Host: host } : {}), ...headers },
      signal: AbortSignal.timeout(15000),
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolvePromise({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

function openSocket(url, origin) {
  return new Promise((resolvePromise, reject) => {
    const ws = new WebSocket(url, { headers: { Origin: origin } });
    const onUnexpected = (_req, res) => { cleanup(); reject(new Error(`unexpected upgrade response ${res.statusCode}`)); };
    const onError = error => { cleanup(); reject(error); };
    const onOpen = () => { cleanup(); resolvePromise(ws); };
    function cleanup() { ws.off('unexpected-response', onUnexpected); ws.off('error', onError); ws.off('open', onOpen); }
    ws.on('unexpected-response', onUnexpected);
    ws.on('error', onError);
    ws.on('open', onOpen);
  });
}

// Collects every frame (and raw non-JSON message, e.g. the "pong" auto-response
// text frame) delivered to a socket from the moment this is called.
function frameCollector(ws) {
  const frames = [];
  ws.on('message', data => {
    const text = data.toString();
    try { frames.push(JSON.parse(text)); } catch { frames.push(text); }
  });
  return {
    frames,
    async waitFor(predicate, timeoutMs = 10000, label = 'frame') {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const found = frames.find(predicate);
        if (found) return found;
        if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}. Seen: ${JSON.stringify(frames)}`);
        await new Promise(r => setTimeout(r, 25));
      }
    },
  };
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), 'hehe-stream-workerd-'));
  let mf;
  const sockets = [];
  try {
    // Bundle the actual application entry, unmodified — same shape as
    // tests/fixtures/hosted-control.mjs and scripts/test-memory-tokenizer.mjs.
    console.log('[1/6] bundling src/worker/index.ts with esbuild');
    const bundlePath = join(root, 'worker.mjs');
    await build({
      entryPoints: [join(REPO, 'src/worker/index.ts')], outfile: bundlePath, bundle: true, format: 'esm',
      platform: 'browser', target: 'es2022', loader: { '.sql': 'text' }, external: ['cloudflare:workers', 'node:*'],
      logLevel: 'silent',
    });

    // Same local-dev vars as wrangler.jsonc `env.local` — the real loopback
    // auth bypass, asserted the same way scripts/test-control-crash.mjs does,
    // so this fixture cannot silently start testing a different auth mode.
    console.log('[2/6] real workerd via Miniflare, wrangler.jsonc env.local vars');
    const config = JSON.parse(await readFile(join(REPO, 'wrangler.jsonc'), 'utf8'));
    const local = config.env.local;
    assert.equal(local.vars.AUTH_MODE, 'local');
    assert.equal(local.vars.OWNER_SUB, 'local-owner');
    assert.equal(local.vars.INSTALLATION_ID, 'local-only');
    assert.equal(local.vars.EXECUTION_ENABLED, 'false');
    assert.equal(local.vars.NATIVE_VERIFIED, 'false');
    assert.equal(local.vars.PROVIDER_CONFIG, '{}');

    mf = new Miniflare(convertV4MiniflareOptions({
      rootPath: root, modules: true, scriptPath: 'worker.mjs',
      compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags,
      resourcePersistencePath: join(root, 'miniflare'),
      durableObjects: { CONTROL: { className: 'PersonalControl', useSQLite: true } },
      bindings: { ...local.vars },
      outboundService: async request => { throw new Error(`Blocked unexpected outbound request: ${request.method} ${request.url}`); },
    }));
    const url = await mf.ready;
    const origin = url.origin; // e.g. http://127.0.0.1:PORT — a real loopback listener backed by real workerd.
    console.log(`      ready at ${origin}`);

    // (1) unauthenticated / wrong-Origin / non-upgrade rejected, before the DO.
    console.log('[3/6] rejecting unauthenticated / wrong-Origin / non-upgrade requests');
    const unauthenticated = await rawRequest(new URL('/v1/stream', url), { host: 'control.invalid', headers: { Upgrade: 'websocket', Connection: 'Upgrade' } });
    assert.equal(unauthenticated.status, 401, `expected 401 for non-loopback Host, got ${unauthenticated.status}: ${unauthenticated.body}`);
    const wrongOrigin = await rawRequest(new URL('/v1/stream', url), { headers: { Upgrade: 'websocket', Connection: 'Upgrade', Origin: 'http://evil.example' } });
    assert.equal(wrongOrigin.status, 403, `expected 403 for cross-origin, got ${wrongOrigin.status}: ${wrongOrigin.body}`);
    const nonUpgrade = await rawRequest(new URL('/v1/stream', url), { headers: { Origin: origin } });
    assert.equal(nonUpgrade.status, 426, `expected 426 for a non-upgrade GET, got ${nonUpgrade.status}: ${nonUpgrade.body}`);
    console.log('      401 unauthenticated, 403 wrong-Origin, 426 non-upgrade — all rejected ahead of the Durable Object');

    // (2) authenticated same-origin upgrade -> 101; subscribe(cursor:null) ->
    // events{cursor:number} + runtime frame.
    console.log('[4/6] authenticated same-origin upgrade, subscribe with a null cursor');
    const streamUrl = new URL('/v1/stream', url); streamUrl.protocol = 'ws:';
    const ws1 = await openSocket(streamUrl, origin);
    sockets.push(ws1);
    const collector1 = frameCollector(ws1);
    ws1.send(JSON.stringify({ type: 'subscribe', cursor: null }));
    const events1 = await collector1.waitFor(f => f && f.type === 'events', 10000, 'initial events frame');
    assert.deepEqual(events1.events, []);
    assert.equal(typeof events1.cursor, 'number');
    assert.ok(Number.isSafeInteger(events1.cursor) && events1.cursor >= 0, 'cursor must be a numeric sequence');
    const runtime1 = await collector1.waitFor(f => f && f.type === 'runtime', 10000, 'runtime frame');
    assert.equal(runtime1.state, 'asleep');
    console.log(`      101 upgrade; events{cursor:${events1.cursor}}, runtime{state:${runtime1.state}}`);

    // (3) text "ping" -> "pong" via the real Hibernation auto-response pair
    // (setWebSocketAutoResponse), never invoking webSocketMessage.
    console.log('[5/6] "ping" -> "pong" via the real WebSocket Hibernation auto-response');
    const pongWait = new Promise((resolvePong, rejectPong) => {
      const timer = setTimeout(() => rejectPong(new Error('Timed out waiting for pong')), 10000);
      ws1.once('message', data => { clearTimeout(timer); resolvePong(data.toString()); });
    });
    ws1.send('ping');
    assert.equal(await pongWait, 'pong');
    console.log('      pong received');

    // (4) POST message.send via /v1/commands, same shape as public/app.js
    // command(): {schema_version:1,type,payload} + Idempotency-Key header,
    // same-origin. The open socket must receive an events frame with the
    // resulting message.user event (broadcast-on-commit).
    console.log('[6/6] POST message.send -> broadcast delivers message.user; disconnect/reconnect replays exactly the missed events');
    const state = JSON.parse((await rawRequest(new URL('/v1/state', url))).body);
    const bot = state.objects.find(o => o.kind === 'persona').id;
    async function sendMessage(text) {
      const key = randomUUID();
      const body = JSON.stringify({ schema_version: 1, type: 'message.send', payload: { conversation_id: bot, text } });
      const response = await rawRequest(new URL('/v1/commands', url), {
        method: 'POST', body,
        headers: { Origin: origin, 'Content-Type': 'application/json', 'Idempotency-Key': key },
      });
      assert.equal(response.status, 202, `message.send rejected: ${response.status} ${response.body}`);
      const parsed = JSON.parse(response.body);
      assert.equal(parsed.status, 'applied');
      return parsed;
    }
    const firstText = `first ${randomUUID()}`;
    await sendMessage(firstText);
    const delivered = await collector1.waitFor(
      f => f && f.type === 'events' && f.events.some(e => e.type === 'message.user' && e.payload && e.payload.text === firstText),
      10000, 'events frame containing the message.user event',
    );
    const userEvent = delivered.events.find(e => e.type === 'message.user' && e.payload.text === firstText);
    assert.equal(userEvent.conversation_id, bot);
    assert.equal(typeof userEvent.sequence, 'number');
    const cursorAfterFirst = delivered.cursor;
    assert.ok(cursorAfterFirst > events1.cursor);
    console.log(`      message.user delivered live over the open socket at cursor ${cursorAfterFirst}`);

    // Close, send two more messages while disconnected, then reconnect with
    // the pre-close cursor: exactly the missed events must replay, once.
    await new Promise(resolvePromise => { ws1.once('close', resolvePromise); ws1.close(); });
    const secondText = `second ${randomUUID()}`, thirdText = `third ${randomUUID()}`;
    await sendMessage(secondText);
    await sendMessage(thirdText);
    const ws2 = await openSocket(streamUrl, origin);
    sockets.push(ws2);
    const collector2 = frameCollector(ws2);
    ws2.send(JSON.stringify({ type: 'subscribe', cursor: cursorAfterFirst }));
    const replay = await collector2.waitFor(f => f && f.type === 'events', 10000, 'replay events frame');
    const replayedUserTexts = replay.events.filter(e => e.type === 'message.user').map(e => e.payload.text);
    assert.deepEqual(replayedUserTexts, [secondText, thirdText], 'reconnect must replay exactly the missed message.user events, in order, no more and no less');
    assert.ok(replay.cursor > cursorAfterFirst);
    console.log(`      reconnect with cursor ${cursorAfterFirst} replayed exactly [${replayedUserTexts.join(', ')}]`);

    console.log(JSON.stringify({ result: 'pass', scope: 'ARCHITECTURE_V2 A6 GET /v1/stream in real local workerd (Miniflare, real WebSocket Hibernation upgrade)' }));
  } finally {
    for (const ws of sockets) { try { ws.terminate(); } catch { /* already closed */ } }
    if (mf) await mf.dispose().catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
}

await main();
