#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile, lstat, mkdir } from 'node:fs/promises';
import process from 'node:process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ControlClient, ControlClientError } from './control-client.mjs';
import { readAccessCredentials } from './agent-tools.mjs';

/** Hehebot-fenced browser boundary (AGENTS.md: mutating tools pass through a
 * hehebot gateway with an epoch-bound effect permit). Codex talks to this MCP
 * server only; it proxies an allowlist of Playwright MCP tools. Page actions
 * that can change remote state are recorded in the Worker effect ledger before
 * dispatch; a call that times out is outcome_unknown and never replayed (A3).
 * Arbitrary code, local files and raw network bodies are not exposed. */
export const BROWSER_READ_TOOLS = Object.freeze(['browser_navigate', 'browser_navigate_back', 'browser_snapshot',
  'browser_take_screenshot', 'browser_find', 'browser_wait_for', 'browser_tabs', 'browser_hover',
  'browser_console_messages', 'browser_resize', 'browser_close']);
export const BROWSER_ACTION_TOOLS = Object.freeze(['browser_click', 'browser_type', 'browser_fill_form',
  'browser_select_option', 'browser_press_key', 'browser_drag', 'browser_handle_dialog']);
export const BROWSER_TOOLS = Object.freeze([...BROWSER_READ_TOOLS, ...BROWSER_ACTION_TOOLS]);
// Tool policy that grants browser use; mirrors src/core/agent-commands.ts.
export const BROWSER_POLICY = '0f7d99a8-9dcc-4150-b555-da7944e2554c';
export const BROWSER_LIMIT_DEFAULTS = Object.freeze({ callMs: 45000, actionMs: 10000, navigationMs: 30000, repeatLimit: 3, maxActions: 200 });
// Pages that need the owner, not more automation (CAPTCHAs are never solved).
const BLOCKERS = [/captcha/i, /verify (that )?you('| a)re (a )?human/i, /are you a robot/i, /two-factor|2fa|verification code|one-time (pass)?code/i,
  /unusual traffic/i, /access denied/i];
const SERVER_INSTANCE_ID = randomUUID();
const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const CONFIG_ENV = 'HEHEBOT_BROWSER_GATEWAY_CONFIG';

const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
const toolError = (id, text) => ({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text }] } });
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hasFilename = args => !!args && typeof args === 'object' && Object.hasOwn(args, 'filename');

export function browserLimits(overrides = {}) {
  const limits = { ...BROWSER_LIMIT_DEFAULTS, ...overrides };
  const ok = (key, min, max) => Number.isInteger(limits[key]) && limits[key] >= min && limits[key] <= max;
  if (Object.keys(limits).some(key => !Object.hasOwn(BROWSER_LIMIT_DEFAULTS, key)) || !ok('callMs', 1000, 600000) ||
      !ok('actionMs', 500, 120000) || !ok('navigationMs', 1000, 300000) || !ok('repeatLimit', 2, 50) || !ok('maxActions', 1, 10000) ||
      limits.callMs <= Math.max(limits.actionMs, limits.navigationMs)) throw Object.assign(new Error('INVALID_BROWSER_LIMITS'), { code: 'INVALID_BROWSER_LIMITS' });
  return limits;
}

/** handle(message) for one attempt's gateway. `child` is a Playwright MCP
 * client: { request(method, params, { timeoutMs }), restart() }. */
const PROGRESS_THROTTLE_MS = 5000;
export function createBrowserGateway({ child, controlClient, config, limits = browserLimits(), now = Date.now }) {
  if (!child || typeof child.request !== 'function' || typeof child.restart !== 'function' ||
      !controlClient || typeof controlClient.request !== 'function' || !config?.identity || !config.runId || !config.attempt) throw new Error('INVALID_CONFIGURATION');
  let upstreamTools = null, calls = 0, lastFingerprint = null, repeats = 0, lastReport = 0, unreported = false;
  const seen = new Set();
  const ref = { identity: structuredClone(config.identity), run_id: config.runId, attempt: config.attempt };
  const tools = async () => {
    if (!upstreamTools) {
      const listed = await child.request('tools/list', {}, { timeoutMs: limits.callMs });
      upstreamTools = (listed?.tools ?? []).filter(tool => BROWSER_TOOLS.includes(tool.name)).map(tool => {
        const inputSchema = structuredClone(tool.inputSchema ?? { type: 'object' });
        if (inputSchema.properties) delete inputSchema.properties.filename;
        const action = BROWSER_ACTION_TOOLS.includes(tool.name);
        return { name: tool.name, description: `${tool.description ?? ''}${action ? ' Recorded as an owner-visible effect; never repeat an action whose outcome was unknown.' : ''}`.trim(), inputSchema };
      });
    }
    return upstreamTools;
  };
  const blockerNote = result => {
    const text = (result?.content ?? []).filter(item => item?.type === 'text').map(item => item.text).join('\n').slice(0, 200000);
    return BLOCKERS.some(pattern => pattern.test(text))
      ? '\n\n[hehebot] This page appears to need a human (login, verification or CAPTCHA). Do not try to bypass it; tell the owner with hehebot_send_message what is needed and stop.' : '';
  };
  // Progress = a result the attempt has not seen before (new page, changed
  // content). Reported to the Worker's stuck watchdog, throttled, best effort.
  const noteProgress = result => {
    if (result && !result.isError) {
      const text = (result.content ?? []).map(item => item?.type === 'text' ? item.text : item?.type ?? '').join('\n');
      const hash = digest(text);
      if (!seen.has(hash)) { seen.add(hash); if (seen.size > 256) seen.delete(seen.values().next().value); unreported = true; }
    }
    if (unreported && now() - lastReport >= PROGRESS_THROTTLE_MS) {
      unreported = false; lastReport = now();
      void Promise.resolve().then(() => controlClient.request('progress', { ...ref, source: 'browser' })).catch(() => {});
    }
  };
  const withNote = (result, note) => note ? { ...result, content: [...(result.content ?? []), { type: 'text', text: note }] } : result;

  return async function handle(message) {
    if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return rpcError(message?.id, -32600, 'Invalid Request');
    const notification = !Object.hasOwn(message, 'id');
    if (notification) return undefined;
    if (message.method === 'initialize') return { jsonrpc: '2.0', id: message.id, result: {
      protocolVersion: '2024-11-05', capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'hehebot-browser', version: '0.1.0' } } };
    if (message.method === 'ping') return { jsonrpc: '2.0', id: message.id, result: {} };
    if (message.method === 'tools/list') {
      try { return { jsonrpc: '2.0', id: message.id, result: { tools: await tools() } }; }
      catch { return rpcError(message.id, -32000, 'Browser unavailable.'); }
    }
    if (message.method !== 'tools/call') return rpcError(message.id, -32601, 'Method not found');
    const name = message.params?.name, args = message.params?.arguments ?? {};
    if (!BROWSER_TOOLS.includes(name) || typeof args !== 'object' || Array.isArray(args) || hasFilename(args)) return rpcError(message.id, -32602, 'Invalid tool name or arguments');
    // Stuck detection, cheapest layer: budget and identical-action loops.
    if (++calls > limits.maxActions) return toolError(message.id, `Browser action budget (${limits.maxActions}) for this task is used up. Report progress to the owner and stop.`);
    const fingerprint = digest({ name, args });
    repeats = fingerprint === lastFingerprint ? repeats + 1 : 1; lastFingerprint = fingerprint;
    if (repeats > limits.repeatLimit) return toolError(message.id, `The same browser call was repeated ${repeats} times without a different result. Change approach, or report to the owner that you are stuck.`);
    const action = BROWSER_ACTION_TOOLS.includes(name);
    let effectId = null;
    if (action) {
      effectId = randomUUID();
      try {
        await controlClient.request('effect-intent', { identity: ref.identity, effect: { id: effectId, run_id: ref.run_id, attempt: ref.attempt,
          action_key: `browser:${ref.run_id}:${ref.attempt}:${SERVER_INSTANCE_ID}:${String(message.id).slice(0, 64)}`, classification: 'mutation',
          authorization_ref: BROWSER_POLICY, request_digest: digest({ name, args }), provider_idempotency_key: null } });
        await controlClient.request('effect-result', { ...ref, effect_id: effectId, status: 'dispatched', receipt: { tool: name } });
      } catch (error) {
        const code = error instanceof ControlClientError ? error.code : 'EFFECT_PERMIT_FAILED';
        return toolError(message.id, `Browser action not performed: the permit was refused (${code}). Nothing was clicked or typed.`);
      }
    }
    const settle = (status, receipt) => effectId
      ? controlClient.request('effect-result', { ...ref, effect_id: effectId, status, receipt }).catch(() => {}) : Promise.resolve();
    let result;
    try { result = await child.request('tools/call', { name, arguments: args }, { timeoutMs: limits.callMs }); }
    catch (error) {
      // A hung or dead browser: its state is unknown. Restart it; an action's
      // outcome stays unknown for the owner to reconcile, never replayed.
      await child.restart().catch(() => {});
      await settle('outcome_unknown', { tool: name, reason: error?.code ?? 'BROWSER_CALL_FAILED' });
      return toolError(message.id, `Browser call ${error?.code === 'BROWSER_CALL_TIMEOUT' ? `timed out after ${limits.callMs} ms` : 'failed'}; the browser was restarted and the page state is lost.${action ? ' Whether the action happened is unknown: do not repeat it; tell the owner if it matters.' : ''}`);
    }
    await settle(result?.isError ? 'failed' : 'confirmed', { tool: name, error: !!result?.isError });
    noteProgress(result);
    return { jsonrpc: '2.0', id: message.id, result: withNote(result ?? { content: [] }, blockerNote(result)) };
  };
}

/** Playwright MCP over stdio. The child (and the Chromium it launches)
 * prefers to be the OOM victim so a memory spike never kills the runtime. */
export function spawnPlaywright({ browserDir, outputDir, limits, spawnImpl = spawn }) {
  let proc = null, buffer = '', nextId = 1, ready = null;
  const pending = new Map();
  const start = () => {
    proc = spawnImpl('/bin/sh', ['-c', 'echo 1000 > /proc/self/oom_score_adj 2>/dev/null; exec "$@"', 'sh', process.execPath,
      `${browserDir}/node_modules/@playwright/mcp/cli.js`, '--headless', '--browser', 'chromium', '--isolated',
      '--output-dir', outputDir, '--timeout-action', String(limits.actionMs), '--timeout-navigation', String(limits.navigationMs)],
    { env: { PATH: process.env.PATH, HOME: process.env.HOME, PLAYWRIGHT_BROWSERS_PATH: `${browserDir}/browsers` }, stdio: ['pipe', 'pipe', 'ignore'] });
    const own = proc;
    own.stdout.setEncoding('utf8');
    own.stdout.on('data', chunk => {
      if (own !== proc) return;
      buffer += chunk;
      if (buffer.length > MAX_FRAME_BYTES) { own.kill('SIGKILL'); return; }
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        let reply; try { reply = JSON.parse(line); } catch { continue; }
        const waiter = pending.get(reply.id); if (!waiter) continue;
        pending.delete(reply.id); clearTimeout(waiter.timer);
        if (reply.error) waiter.reject(Object.assign(new Error('BROWSER_RPC_ERROR'), { code: 'BROWSER_RPC_ERROR' })); else waiter.resolve(reply.result);
      }
    });
    own.on('exit', () => {
      if (own !== proc) return;
      for (const [id, waiter] of pending) { clearTimeout(waiter.timer); waiter.reject(Object.assign(new Error('BROWSER_EXITED'), { code: 'BROWSER_EXITED' })); pending.delete(id); }
      proc = null; ready = null;
    });
    ready = raw('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'hehebot-browser', version: '0.1.0' } }, limits.callMs)
      .then(() => { own.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n'); });
    return ready;
  };
  function raw(method, params, timeoutMs) {
    return new Promise((ok, fail) => {
      const id = nextId++;
      const timer = setTimeout(() => { pending.delete(id); fail(Object.assign(new Error('BROWSER_CALL_TIMEOUT'), { code: 'BROWSER_CALL_TIMEOUT' })); }, timeoutMs);
      pending.set(id, { resolve: ok, reject: fail, timer });
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  const stop = () => { const old = proc; proc = null; ready = null; buffer = ''; if (old) { old.kill('SIGKILL'); } };
  return {
    async request(method, params, { timeoutMs }) { if (!proc) start(); await ready; return raw(method, params, timeoutMs); },
    async restart() { stop(); },
    close: stop,
  };
}

async function readPrivate(path, limit) {
  if (typeof path !== 'string' || !path.startsWith('/')) throw new Error('INVALID_CONFIGURATION');
  const info = await lstat(path);
  if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o077) !== 0 || info.size < 1 || info.size > limit) throw new Error('INVALID_CONFIGURATION');
  return readFile(path, 'utf8');
}

const CONFIG_KEYS = ['origin', 'tokenFile', 'accessClientIdFile', 'accessClientSecretFile', 'identity', 'runId', 'attempt', 'browserDir', 'outputDir', 'limits'];
export async function runBrowserGatewayCli() {
  let config;
  try { config = JSON.parse(await readPrivate(process.env[CONFIG_ENV], 65536)); } catch { throw new Error('INVALID_CONFIGURATION'); }
  if (!config || Object.keys(config).some(key => !CONFIG_KEYS.includes(key)) || typeof config.browserDir !== 'string' || !config.browserDir.startsWith('/') ||
      typeof config.outputDir !== 'string' || !config.outputDir.startsWith('/')) throw new Error('INVALID_CONFIGURATION');
  const limits = browserLimits(config.limits ?? {});
  await mkdir(config.outputDir, { recursive: true, mode: 0o700 });
  const token = (await readPrivate(config.tokenFile, 16384)).trim();
  const controlClient = new ControlClient({ origin: config.origin, token, ...await readAccessCredentials(config) });
  const child = spawnPlaywright({ browserDir: config.browserDir, outputDir: config.outputDir, limits });
  const handle = createBrowserGateway({ child, controlClient, config, limits });
  const write = async response => { if (!process.stdout.write(JSON.stringify(response) + '\n')) await once(process.stdout, 'drain'); };
  const pending = new Set();
  let buffered = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) {
    buffered += chunk;
    if (buffered.length > MAX_FRAME_BYTES) throw new Error('FRAME_LIMIT');
    let newline;
    while ((newline = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, newline); buffered = buffered.slice(newline + 1);
      let message; try { message = JSON.parse(line); } catch { await write(rpcError(null, -32700, 'Parse error')); continue; }
      const task = Promise.resolve(handle(message)).then(async response => { if (response) await write(response); })
        .catch(async () => { await write(rpcError(message?.id, -32603, 'Internal error')); })
        .finally(() => pending.delete(task));
      pending.add(task);
    }
  }
  await Promise.allSettled(pending);
  child.close();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runBrowserGatewayCli().catch(() => { process.stderr.write('hehebot-browser: startup failed\n'); process.exitCode = 1; });
}
