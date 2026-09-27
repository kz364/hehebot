#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile, lstat, mkdir, mkdtemp, open, readdir, rm, unlink, access } from 'node:fs/promises';
import process from 'node:process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ControlClient, ControlClientError } from './control-client.mjs';
import { readAccessCredentials } from './agent-tools.mjs';
import { CdpConnection, connectRelay, relayUrl, runTakeover, takeoverResultText } from './browser-takeover.mjs';

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
// The owner takeover tool (docs/BROWSER_TAKEOVER.md). Not a Playwright tool:
// the gateway implements it, and it creates no effect entries.
export const TAKEOVER_TOOL = 'browser_request_takeover';
export const BROWSER_GATEWAY_TOOLS = Object.freeze([...BROWSER_TOOLS, TAKEOVER_TOOL]);
const TAKEOVER_TOOL_DEFINITION = Object.freeze({ name: TAKEOVER_TOOL,
  description: 'Ask the owner to take over this browser (login, CAPTCHA, verification code, anything that needs a human). The owner is notified, sees the page live in the portal and can click and type; this call blocks until they hand the browser back, cancel, or it times out, and then returns the current page. Never share or ask for passwords in messages.',
  inputSchema: { type: 'object', additionalProperties: false, required: ['reason'], properties: { reason: { type: 'string', minLength: 1, maxLength: 500, description: 'What the owner needs to do, e.g. "Log in to example.com" or "Solve the CAPTCHA".' } } } });
const MAX_TAKEOVERS = 3;
export const BROWSER_LIMIT_DEFAULTS = Object.freeze({ callMs: 45000, actionMs: 10000, navigationMs: 30000, repeatLimit: 3, maxActions: 200, takeoverMs: 600000 });
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
      !ok('actionMs', 500, 120000) || !ok('navigationMs', 1000, 300000) || !ok('repeatLimit', 2, 50) || !ok('maxActions', 1, 10000) || !ok('takeoverMs', 60000, 3600000) ||
      limits.callMs <= Math.max(limits.actionMs, limits.navigationMs)) throw Object.assign(new Error('INVALID_BROWSER_LIMITS'), { code: 'INVALID_BROWSER_LIMITS' });
  return limits;
}

/** handle(message) for one attempt's gateway. `child` is a Playwright MCP
 * client: { request(method, params, { timeoutMs }), restart() }. `takeover`
 * runs one owner takeover: ({ takeoverId, timeoutMs, onProgress }) →
 * { outcome, url, title, viewed } (runtime/browser-takeover.mjs). */
const PROGRESS_THROTTLE_MS = 5000;
export function createBrowserGateway({ child, controlClient, config, limits = browserLimits(), now = Date.now, takeover = null }) {
  if (!child || typeof child.request !== 'function' || typeof child.restart !== 'function' ||
      !controlClient || typeof controlClient.request !== 'function' || !config?.identity || !config.runId || !config.attempt) throw new Error('INVALID_CONFIGURATION');
  let upstreamTools = null, calls = 0, lastFingerprint = null, repeats = 0, lastReport = 0, unreported = false, takeoverActive = false, takeovers = 0;
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
    return takeover ? [...upstreamTools, structuredClone(TAKEOVER_TOOL_DEFINITION)] : upstreamTools;
  };
  const blockerNote = result => {
    const text = (result?.content ?? []).filter(item => item?.type === 'text').map(item => item.text).join('\n').slice(0, 200000);
    return BLOCKERS.some(pattern => pattern.test(text))
      ? (takeover
        ? `\n\n[hehebot] This page appears to need a human (login, verification or CAPTCHA). Do not try to bypass it. Call ${TAKEOVER_TOOL} with a short reason so the owner can do it in the live browser; then continue from the page it returns.`
        : '\n\n[hehebot] This page appears to need a human (login, verification or CAPTCHA). Do not try to bypass it; tell the owner with hehebot_send_message what is needed and stop.') : '';
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

  // Owner takeover: notice → live stream while the owner is connected → wait
  // for hand-back/cancel/timeout. Progress keeps the stuck watchdog quiet.
  const requestTakeover = async (id, args) => {
    const reason = typeof args?.reason === 'string' ? args.reason.trim() : '';
    if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => key !== 'reason') || !reason || reason.length > 500) return rpcError(id, -32602, 'Invalid tool name or arguments');
    if (++takeovers > MAX_TAKEOVERS) return toolError(id, `The owner was already asked ${MAX_TAKEOVERS} times in this task. Tell the owner with hehebot_send_message what is blocking you and stop.`);
    const takeoverId = randomUUID();
    takeoverActive = true;
    try {
      try {
        await controlClient.request('browser-takeover', { ...ref, takeover_id: takeoverId, action: 'open', reason, timeout_ms: limits.takeoverMs });
      } catch (error) {
        const code = error instanceof ControlClientError ? error.code : 'TAKEOVER_UNAVAILABLE';
        return toolError(id, `Could not ask the owner to take over (${code}). Tell the owner with hehebot_send_message what is needed, and stop.`);
      }
      const onProgress = () => { void Promise.resolve().then(() => controlClient.request('progress', { ...ref, source: 'browser' })).catch(() => {}); };
      let result;
      try { result = await takeover({ takeoverId, timeoutMs: limits.takeoverMs, onProgress }); }
      catch { result = { outcome: 'failed', url: '', title: '', viewed: false }; }
      await controlClient.request('browser-takeover', { ...ref, takeover_id: takeoverId, action: 'end', outcome: result.outcome }).catch(() => {});
      // The owner may have changed the page: identical-call detection starts over.
      lastFingerprint = null; repeats = 0;
      return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: takeoverResultText(result, limits.takeoverMs) }] } };
    } finally { takeoverActive = false; }
  };

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
    if (takeoverActive) return toolError(message.id, 'The owner is controlling the browser right now. Wait for browser_request_takeover to return.');
    if (name === TAKEOVER_TOOL && takeover) return requestTakeover(message.id, args);
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
      // A busy persistent profile means no browser was started: nothing happened.
      if (error?.code === 'BROWSER_PROFILE_BUSY') {
        await settle('failed', { tool: name, reason: 'BROWSER_PROFILE_BUSY' });
        return toolError(message.id, 'The browser profile is in use by another task; nothing was done. Try again later or tell the owner.');
      }
      await child.restart().catch(() => {});
      await settle('outcome_unknown', { tool: name, reason: error?.code ?? 'BROWSER_CALL_FAILED' });
      return toolError(message.id, `Browser call ${error?.code === 'BROWSER_CALL_TIMEOUT' ? `timed out after ${limits.callMs} ms` : 'failed'}; the browser was restarted and the page state is lost.${action ? ' Whether the action happened is unknown: do not repeat it; tell the owner if it matters.' : ''}`);
    }
    await settle(result?.isError ? 'failed' : 'confirmed', { tool: name, error: !!result?.isError });
    noteProgress(result);
    return { jsonrpc: '2.0', id: message.id, result: withNote(result ?? { content: [] }, blockerNote(result)) };
  };
}

// Both the browser and Playwright MCP prefer to be the OOM victim, so a
// memory spike never kills the runtime (Codex runs at -900).
const OOM_PREFIX = 'echo 1000 > /proc/self/oom_score_adj 2>/dev/null; ';
// Chromium runs in its own process group under a tiny sh supervisor: when the
// gateway dies (its stdin pipe closes) or Chromium exits, the whole group is
// killed, so no orphan browser outlives the attempt.
const CHROMIUM_SUPERVISOR = `${OOM_PREFIX}exec 3<&0; "$@" </dev/null 3<&- & c=$!; ( read -r _ <&3; kill -9 0 ) & wait $c; kill -9 0`;
const fail = code => Object.assign(new Error(code), { code });
const sleep = ms => new Promise(ok => setTimeout(ok, ms));

/** The pinned Chromium headless shell under `${browserDir}/browsers`
 * (scripts/setup-browser.sh), newest revision first. */
export async function findHeadlessShell(browserDir) {
  const root = join(browserDir, 'browsers');
  const revisions = (await readdir(root).catch(() => [])).filter(name => /^chromium_headless_shell-\d+$/.test(name))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const revision of revisions) {
    for (const platform of await readdir(join(root, revision)).catch(() => [])) {
      for (const name of ['chrome-headless-shell', 'headless_shell']) {
        const candidate = join(root, revision, platform, name);
        try { await access(candidate); return candidate; } catch {}
      }
    }
  }
  throw fail('BROWSER_NOT_INSTALLED');
}

/** Chromium flags: Playwright's usual automation defaults, a DevTools port
 * on loopback chosen by the OS (written to DevToolsActivePort), and the
 * profile directory. The port is reachable only from this machine; Codex's
 * sandbox has networking disabled, so model-run commands cannot reach it. */
export function chromiumArgs({ userDataDir }) {
  return ['--headless', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${userDataDir}`,
    '--no-first-run', '--no-default-browser-check', '--no-sandbox', '--disable-dev-shm-usage', '--disable-background-networking',
    '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-breakpad', '--disable-component-update', '--disable-default-apps', '--disable-extensions', '--disable-sync',
    '--disable-hang-monitor', '--disable-popup-blocking', '--disable-prompt-on-repost', '--metrics-recording-only',
    '--password-store=basic', '--use-mock-keychain', '--force-color-profile=srgb', '--hide-scrollbars', '--mute-audio',
    '--window-size=1280,800', 'about:blank'];
}

/** Playwright MCP attached to our Chromium over CDP (0.0.82 supports
 * --cdp-endpoint), so the takeover relay can attach a second CDP client. */
export function playwrightArgs({ browserDir, outputDir, limits, cdpEndpoint }) {
  return [`${browserDir}/node_modules/@playwright/mcp/cli.js`, '--cdp-endpoint', cdpEndpoint, '--output-dir', outputDir,
    '--timeout-action', String(limits.actionMs), '--timeout-navigation', String(limits.navigationMs)];
}

/** One attempt at a time per persistent profile: an exclusive lock file
 * holding the owner pid; a lock whose pid is gone is stale and reclaimed. */
export async function lockProfile(profileDir) {
  await mkdir(profileDir, { recursive: true, mode: 0o700 });
  const path = `${profileDir}.lock`;
  for (let tries = 0; tries < 3; tries++) {
    try {
      const handle = await open(path, 'wx', 0o600);
      try { await handle.writeFile(String(process.pid)); } finally { await handle.close(); }
      return async () => { await unlink(path).catch(() => {}); };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const pid = Number((await readFile(path, 'utf8').catch(() => '')).trim());
      let alive = false;
      if (Number.isSafeInteger(pid) && pid > 0) { try { process.kill(pid, 0); alive = true; } catch (err) { alive = err?.code === 'EPERM'; } }
      if (alive) throw fail('BROWSER_PROFILE_BUSY');
      await unlink(path).catch(() => {});
    }
  }
  throw fail('BROWSER_PROFILE_BUSY');
}

/** Starts Chromium and resolves its browser-level CDP endpoint. */
export async function launchChromium({ executable, userDataDir, spawnImpl = spawn, timeoutMs = 20000 }) {
  await unlink(join(userDataDir, 'DevToolsActivePort')).catch(() => {});
  const proc = spawnImpl('/bin/sh', ['-c', CHROMIUM_SUPERVISOR, 'sh', executable, ...chromiumArgs({ userDataDir })],
    { detached: true, stdio: ['pipe', 'ignore', 'ignore'], env: { PATH: process.env.PATH, HOME: process.env.HOME } });
  let exited = false;
  proc.on('exit', () => { exited = true; });
  proc.stdin?.on?.('error', () => {});
  const kill = () => { try { process.kill(-proc.pid, 'SIGKILL'); } catch { try { proc.kill('SIGKILL'); } catch {} } };
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const [port, path] = (await readFile(join(userDataDir, 'DevToolsActivePort'), 'utf8').catch(() => '')).split('\n');
    if (/^\d{1,5}$/.test(port ?? '') && /^\/devtools\/browser\/[0-9a-f-]+$/.test(path?.trim() ?? '')) {
      const endpoint = `ws://127.0.0.1:${port}${path.trim()}`;
      // Graceful close flushes a persistent profile's cookies to disk
      // (SIGKILL loses the last ~30 s); bounded, then the group is killed.
      const close = async ({ graceful = false } = {}) => {
        if (graceful && !exited) {
          const gone = new Promise(ok => { if (exited) ok(); else proc.once('exit', ok); });
          const cdp = await CdpConnection.connect(endpoint, { timeoutMs: 2000 }).catch(() => null);
          await cdp?.send('Browser.close', {}, undefined, 2000).catch(() => {});
          await Promise.race([gone, sleep(5000)]);
          cdp?.close();
        }
        kill();
      };
      return { endpoint, proc, kill, close };
    }
    if (exited || Date.now() > deadline) { kill(); throw fail('BROWSER_LAUNCH_FAILED'); }
    await sleep(50);
  }
}

/** Playwright MCP over stdio, attached to a Chromium this gateway owns.
 * `profileDir` (opt-in persistent profile) survives across attempts; the
 * default is a fresh profile under outputDir that is deleted on stop. */
export function spawnPlaywright({ browserDir, outputDir, limits, profileDir = null, spawnImpl = spawn, launch = launchChromium, findExecutable = findHeadlessShell }) {
  let proc = null, browser = null, buffer = '', nextId = 1, ready = null, executable = null, releaseLock = null, tempProfile = null, stopping = Promise.resolve();
  const pending = new Map();
  function raw(method, params, timeoutMs) {
    return new Promise((ok, reject) => {
      if (!proc) { reject(fail('BROWSER_EXITED')); return; }
      const id = nextId++;
      const timer = setTimeout(() => { pending.delete(id); reject(fail('BROWSER_CALL_TIMEOUT')); }, timeoutMs);
      pending.set(id, { resolve: ok, reject, timer });
      proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  const stop = () => {
    const old = proc, oldBrowser = browser, oldProfile = tempProfile;
    proc = null; browser = null; ready = null; buffer = ''; tempProfile = null;
    for (const [id, waiter] of pending) { clearTimeout(waiter.timer); waiter.reject(fail('BROWSER_EXITED')); pending.delete(id); }
    if (old) old.kill('SIGKILL');
    const closing = oldBrowser ? Promise.resolve(oldBrowser.close ? oldBrowser.close({ graceful: !!profileDir }) : oldBrowser.kill()).catch(() => {}) : null;
    if (oldProfile) void Promise.resolve(closing).then(() => rm(oldProfile, { recursive: true, force: true })).catch(() => {});
    if (closing) stopping = Promise.all([stopping, closing]);
    return stopping;
  };
  const start = () => {
    ready = (async () => {
      await stopping;
      executable ??= await findExecutable(browserDir);
      if (profileDir && !releaseLock) releaseLock = await lockProfile(profileDir);
      const userDataDir = profileDir ?? (tempProfile = await mkdtemp(join(outputDir, 'profile-')));
      const launched = await launch({ executable, userDataDir, spawnImpl });
      browser = launched;
      launched.proc.on('exit', () => { if (browser === launched) stop(); });
      const own = proc = spawnImpl('/bin/sh', ['-c', `${OOM_PREFIX}exec "$@"`, 'sh', process.execPath,
        ...playwrightArgs({ browserDir, outputDir, limits, cdpEndpoint: launched.endpoint })],
      { env: { PATH: process.env.PATH, HOME: process.env.HOME, PLAYWRIGHT_BROWSERS_PATH: `${browserDir}/browsers` }, stdio: ['pipe', 'pipe', 'ignore'] });
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
          if (reply.error) waiter.reject(fail('BROWSER_RPC_ERROR')); else waiter.resolve(reply.result);
        }
      });
      own.on('exit', () => { if (own === proc) stop(); });
      await raw('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'hehebot-browser', version: '0.1.0' } }, limits.callMs);
      own.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    })();
    return ready;
  };
  const ensure = async () => {
    if (!ready) start();
    const current = ready;
    try { await current; } catch (error) { if (ready === current) stop(); throw error; }
  };
  return {
    async request(method, params, { timeoutMs }) { await ensure(); return raw(method, params, timeoutMs); },
    /** Browser-level CDP endpoint for the takeover relay (launches if needed). */
    async cdpEndpoint() { await ensure(); if (!browser) throw fail('BROWSER_EXITED'); return browser.endpoint; },
    async restart() { await stop(); },
    async close() { await stop(); const release = releaseLock; releaseLock = null; await release?.(); },
  };
}

async function readPrivate(path, limit) {
  if (typeof path !== 'string' || !path.startsWith('/')) throw new Error('INVALID_CONFIGURATION');
  const info = await lstat(path);
  if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o077) !== 0 || info.size < 1 || info.size > limit) throw new Error('INVALID_CONFIGURATION');
  return readFile(path, 'utf8');
}

const CONFIG_KEYS = ['origin', 'tokenFile', 'accessClientIdFile', 'accessClientSecretFile', 'identity', 'runId', 'attempt', 'browserDir', 'outputDir', 'profileDir', 'limits'];
export async function runBrowserGatewayCli() {
  let config;
  try { config = JSON.parse(await readPrivate(process.env[CONFIG_ENV], 65536)); } catch { throw new Error('INVALID_CONFIGURATION'); }
  if (!config || Object.keys(config).some(key => !CONFIG_KEYS.includes(key)) || typeof config.browserDir !== 'string' || !config.browserDir.startsWith('/') ||
      typeof config.outputDir !== 'string' || !config.outputDir.startsWith('/') ||
      config.profileDir !== undefined && (typeof config.profileDir !== 'string' || !config.profileDir.startsWith('/'))) throw new Error('INVALID_CONFIGURATION');
  const limits = browserLimits(config.limits ?? {});
  await mkdir(config.outputDir, { recursive: true, mode: 0o700 });
  const token = (await readPrivate(config.tokenFile, 16384)).trim();
  const access = await readAccessCredentials(config);
  const controlClient = new ControlClient({ origin: config.origin, token, ...access });
  const child = spawnPlaywright({ browserDir: config.browserDir, outputDir: config.outputDir, limits, profileDir: config.profileDir ?? null });
  // Owner takeover relay: same origin, runtime token and Access service token
  // as ControlClient, over an outbound WebSocket (docs/BROWSER_TAKEOVER.md).
  const headers = { Authorization: `Bearer ${token}`,
    ...(access.accessClientId ? { 'CF-Access-Client-Id': access.accessClientId, 'CF-Access-Client-Secret': access.accessClientSecret } : {}) };
  const takeover = async ({ takeoverId, timeoutMs, onProgress }) => {
    const cdp = await CdpConnection.connect(await child.cdpEndpoint());
    try {
      const url = relayUrl(config.origin, { takeoverId, runId: config.runId, attempt: config.attempt, identity: config.identity });
      return await runTakeover({ cdp, timeoutMs, onProgress, openRelay: onMessage => connectRelay({ url, headers, onMessage }) });
    } finally { cdp.close(); }
  };
  const handle = createBrowserGateway({ child, controlClient, config, limits, takeover });
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
  await child.close();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runBrowserGatewayCli().catch(() => { process.stderr.write('hehebot-browser: startup failed\n'); process.exitCode = 1; });
}
