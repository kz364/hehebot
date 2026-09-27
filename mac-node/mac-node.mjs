#!/usr/bin/env node
// Hehebot Mac node (ARCHITECTURE_V2 A9). A small outbound-only agent: it keeps
// one WebSocket to the Worker's Durable Object, advertises its capabilities,
// and executes only allowlisted, read-only capabilities. It is not a second
// brain: it has no model, no task state and no inbound port. See docs/MAC_NODE.md.
import { chmod, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { DEFAULT_MESSAGES_DB, MessagesError, openMessagesDb, searchMessages } from './messages.mjs';

export const VERSION = '0.1.0';
/** Capabilities this agent can implement. Configuration may narrow, never widen. */
export const IMPLEMENTED_CAPABILITIES = Object.freeze(['ping', 'messages.search']);
export const DEFAULT_CONFIG = join(homedir(), 'Library', 'Application Support', 'Hehebot Node', 'config.json');
const REQUEST_TIMEOUT_MS = 20000;
const MAX_RESULT_BYTES = 60000;
const DEDUPE_ENTRIES = 100;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** Validated https origin (http only for loopback tests). */
export function portalOrigin(value, { allowInsecureLoopback = false } = {}) {
  let url; try { url = new URL(value); } catch { throw new Error('INVALID_ORIGIN'); }
  const loopback = allowInsecureLoopback && url.protocol === 'http:' && LOOPBACK.has(url.hostname);
  if (!(url.protocol === 'https:' || loopback) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('INVALID_ORIGIN');
  return url.origin;
}
export function accessHeaders(access) {
  if (!access) return {};
  if (typeof access.clientId !== 'string' || typeof access.clientSecret !== 'string' || !access.clientId || !access.clientSecret) throw new Error('INVALID_ACCESS_CREDENTIALS');
  return { 'CF-Access-Client-Id': access.clientId, 'CF-Access-Client-Secret': access.clientSecret };
}

export function createHandlers({ messagesDb = DEFAULT_MESSAGES_DB, now = () => Date.now() } = {}) {
  return {
    ping: async () => ({ pong: true, at: new Date(now()).toISOString(), version: VERSION }),
    'messages.search': async args => searchMessages(args, { path: messagesDb, now: now() }),
  };
}

/** Outbound WebSocket session with heartbeat, reconnect/backoff and a strict
 * capability allowlist. Delivery is at-least-once, so results are cached by
 * request id and replayed for a redelivered request instead of re-running it. */
export class NodeAgent {
  #ws = null; #stopped = false; #attempt = 0; #timers = new Set(); #results = new Map(); #inflight = new Set(); #lastRx = 0; #done; #resolveDone;
  constructor({ origin, token, access, capabilities = IMPLEMENTED_CAPABILITIES, handlers, WebSocketImpl = globalThis.WebSocket,
    backoff = { baseMs: 1000, maxMs: 60000 }, heartbeatMs = 30000, allowInsecureLoopback = false, log = () => {}, random = Math.random } = {}) {
    if (typeof token !== 'string' || token.length < 20 || /[\s]/.test(token)) throw new Error('INVALID_TOKEN');
    if (!Array.isArray(capabilities) || capabilities.some(c => !IMPLEMENTED_CAPABILITIES.includes(c))) throw new Error('INVALID_CAPABILITIES');
    if (!handlers || capabilities.some(c => typeof handlers[c] !== 'function')) throw new Error('INVALID_HANDLERS');
    const base = new URL(portalOrigin(origin, { allowInsecureLoopback }));
    base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'; base.pathname = '/node/stream';
    Object.assign(this, { url: base.href, capabilities: [...capabilities], handlers, WebSocketImpl, backoff, heartbeatMs, log, random });
    this.headers = { Authorization: `Bearer ${token}`, ...accessHeaders(access) };
    this.state = 'idle';
    this.#done = new Promise(resolve => { this.#resolveDone = resolve; });
  }
  /** Resolves with the stop reason ('stopped' | 'revoked'). */
  start() { if (this.state === 'idle') this.#connect(); return this.#done; }
  stop(reason = 'stopped') {
    if (this.#stopped) return;
    this.#stopped = true; this.state = reason;
    for (const timer of this.#timers) clearTimeout(timer), clearInterval(timer);
    this.#timers.clear();
    try { this.#ws?.close(1000, 'Node stopping.'); } catch {}
    this.#resolveDone(reason);
  }
  #later(fn, ms) { const t = setTimeout(() => { this.#timers.delete(t); fn(); }, ms); this.#timers.add(t); return t; }
  #send(frame) { try { this.#ws?.send(JSON.stringify(frame)); return true; } catch { return false; } }
  #connect() {
    if (this.#stopped) return;
    this.state = 'connecting';
    let ws;
    try { ws = new this.WebSocketImpl(this.url, { headers: this.headers }); } catch { this.#reconnect(); return; }
    this.#ws = ws;
    let heartbeat;
    ws.onopen = () => {
      this.#lastRx = Date.now();
      this.#send({ type: 'hello', capabilities: this.capabilities, version: VERSION });
      heartbeat = setInterval(() => {
        if (Date.now() - this.#lastRx > this.heartbeatMs * 2.5) { try { ws.close(4002, 'Heartbeat timeout.'); } catch {} return; }
        this.#send({ type: 'heartbeat' });
      }, this.heartbeatMs);
      this.#timers.add(heartbeat);
    };
    ws.onmessage = event => {
      this.#lastRx = Date.now();
      let frame; try { frame = JSON.parse(typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8')); } catch { return; }
      if (!frame || typeof frame !== 'object') return;
      if (frame.type === 'welcome') { this.state = 'online'; this.#attempt = 0; this.log('connected'); }
      else if (frame.type === 'revoked') this.stop('revoked');
      else if (frame.type === 'request') void this.#handle(frame);
    };
    ws.onerror = () => {};
    ws.onclose = event => {
      clearInterval(heartbeat); this.#timers.delete(heartbeat);
      if (this.#ws === ws) this.#ws = null;
      if (this.#stopped) return;
      if (event?.code === 4001) { this.stop('revoked'); return; }
      this.#reconnect();
    };
  }
  #reconnect() {
    if (this.#stopped) return;
    this.state = 'backoff';
    const delay = Math.min(this.backoff.maxMs, this.backoff.baseMs * 2 ** Math.min(this.#attempt++, 16)) * (0.5 + this.random() / 2);
    this.log(`reconnecting in ${Math.round(delay)} ms`);
    this.#later(() => this.#connect(), delay);
  }
  async #handle(frame) {
    const id = typeof frame.id === 'string' && frame.id.length <= 64 ? frame.id : null;
    if (!id) return;
    if (this.#results.has(id)) { this.#send(this.#results.get(id)); return; }
    if (this.#inflight.has(id)) return;
    this.#inflight.add(id);
    let reply;
    try {
      if (!this.capabilities.includes(frame.capability)) throw new MessagesError('CAPABILITY_NOT_ALLOWED', 'This Mac does not allow that capability.');
      let timer;
      const result = await Promise.race([this.handlers[frame.capability](frame.args ?? {}),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new MessagesError('NODE_TIMEOUT', 'The Mac timed out.')), REQUEST_TIMEOUT_MS); })])
        .finally(() => clearTimeout(timer));
      reply = Buffer.byteLength(JSON.stringify(result ?? {})) > MAX_RESULT_BYTES
        ? { type: 'result', id, ok: false, error: { code: 'RESULT_TOO_LARGE', message: 'Result exceeded the node limit.' } }
        : { type: 'result', id, ok: true, result: result ?? {} };
    } catch (error) {
      reply = { type: 'result', id, ok: false, error: { code: error instanceof MessagesError ? error.code : 'NODE_ERROR',
        message: error instanceof MessagesError ? error.message : 'The Mac could not complete the request.' } };
    } finally { this.#inflight.delete(id); }
    this.#results.set(id, reply);
    if (this.#results.size > DEDUPE_ENTRIES) this.#results.delete(this.#results.keys().next().value);
    this.#send(reply);
  }
}

async function readPrivate(path) {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new Error(`INVALID_SECRET_PATH ${path}`);
  const info = await lstat(path);
  if (!info.isFile() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid()) throw new Error(`SECRET_FILE_PERMISSIONS ${path} (must be yours, mode 600)`);
  return (await readFile(path, 'utf8')).trim();
}
async function loadAccess(config) {
  if (!config.accessClientIdFile && !config.accessClientSecretFile) return undefined;
  return { clientId: await readPrivate(config.accessClientIdFile), clientSecret: await readPrivate(config.accessClientSecretFile) };
}
function flags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) throw new Error(`Unexpected argument ${argv[i]}`);
    out[argv[i].slice(2)] = argv[i + 1]; i++;
  }
  return out;
}
async function writePrivate(path, text) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, text, { mode: 0o600 }); await chmod(path, 0o600);
}

/** `pair`: exchange the one-time portal code for a node token (stored 0600). */
export async function pair({ origin, code, name = hostname().slice(0, 64), configPath = DEFAULT_CONFIG, access, accessFiles = {}, fetchImpl = globalThis.fetch, allowInsecureLoopback = false }) {
  const base = portalOrigin(origin, { allowInsecureLoopback });
  const response = await fetchImpl(`${base}/node/exchange`, { method: 'POST', redirect: 'error',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...accessHeaders(access) },
    body: JSON.stringify({ code, name: name.replace(/[^\p{L}\p{N} ._'()-]/gu, '').slice(0, 64) || 'Mac' }) });
  if (!response.ok) throw new Error(`PAIRING_FAILED ${response.status}`);
  const body = await response.json();
  if (typeof body?.token !== 'string' || typeof body?.node_id !== 'string') throw new Error('PAIRING_FAILED invalid response');
  const tokenFile = join(dirname(configPath), 'node-token');
  await writePrivate(tokenFile, body.token + '\n');
  const config = { origin: base, tokenFile, ...accessFiles, messagesDb: DEFAULT_MESSAGES_DB, capabilities: [...IMPLEMENTED_CAPABILITIES] };
  await writePrivate(configPath, JSON.stringify(config, null, 2) + '\n');
  return { node_id: body.node_id, configPath, tokenFile };
}

export async function loadConfig(path) {
  const config = JSON.parse(await readPrivate(path));
  const allowed = ['origin', 'tokenFile', 'accessClientIdFile', 'accessClientSecretFile', 'messagesDb', 'capabilities'];
  if (!config || typeof config !== 'object' || Object.keys(config).some(key => !allowed.includes(key))) throw new Error('INVALID_CONFIG');
  return config;
}

async function main(argv) {
  const [command = 'run', ...rest] = argv;
  const options = flags(rest);
  const configPath = resolve(options.config ?? DEFAULT_CONFIG);
  if (command === 'pair') {
    if (!options.origin || !options.code) throw new Error('Usage: mac-node.mjs pair --origin https://portal --code XXXX-XXXX-XXXX [--name N] [--access-id-file F --access-secret-file F] [--config P]');
    const accessFiles = options['access-id-file'] ? { accessClientIdFile: resolve(options['access-id-file']), accessClientSecretFile: resolve(options['access-secret-file']) } : {};
    const access = accessFiles.accessClientIdFile ? await loadAccess(accessFiles) : undefined;
    const paired = await pair({ origin: options.origin, code: options.code, name: options.name, configPath, access, accessFiles });
    process.stdout.write(`Paired node ${paired.node_id}. Config: ${paired.configPath}\n`);
    return;
  }
  const config = await loadConfig(configPath);
  if (command === 'check') {
    // Verifies Full Disk Access without printing any message content.
    const db = openMessagesDb(config.messagesDb ?? DEFAULT_MESSAGES_DB);
    try { const recent = searchMessages({ limit: 50 }, { db }); process.stdout.write(`Messages database readable (read-only). ${recent.messages.length} message(s) in the last 7 days (content not shown).\n`); }
    finally { db.close(); }
    return;
  }
  if (command !== 'run') throw new Error(`Unknown command ${command}`);
  const agent = new NodeAgent({ origin: config.origin, token: await readPrivate(config.tokenFile), access: await loadAccess(config),
    capabilities: config.capabilities ?? [...IMPLEMENTED_CAPABILITIES], handlers: createHandlers({ messagesDb: config.messagesDb ?? DEFAULT_MESSAGES_DB }),
    log: message => process.stderr.write(`${new Date().toISOString()} hehebot-mac-node: ${message}\n`) });
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => agent.stop());
  const reason = await agent.start();
  process.stderr.write(`hehebot-mac-node: ${reason}\n`);
  // A revoked node exits cleanly (launchd KeepAlive only restarts failures).
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { process.stderr.write(`hehebot-mac-node: ${error.message}\n`); process.exitCode = 1; });
}
