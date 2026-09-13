// Static installed-source evidence only: no native imports, runtime, auth or model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const root = process.env.OPENCLAW_PACKAGE_ROOT ?? join(homedir(), '.local/share/openclaw/tools/node-v24.19.0/lib/node_modules/openclaw');
const available = existsSync(join(root, 'package.json'));
function source(prefix, marker) {
  const matches = readdirSync(join(root, 'dist')).filter(name => name.startsWith(prefix) && name.endsWith('.mjs'))
    .map(name => readFileSync(join(root, 'dist', name), 'utf8')).filter(text => text.includes(marker));
  assert.equal(matches.length, 1, `Expected one installed source for ${marker}`);
  return matches[0];
}
function section(text, start, end) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `Missing section ${start}`);
  return text.slice(from, to);
}
const options = { skip: available ? false : 'Pinned OpenClaw package unavailable; set OPENCLAW_PACKAGE_ROOT' };

test('source evidence is tied to OpenClaw 2026.9.3', options, () => {
  assert.equal(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version, '2026.9.3');
});

test('coordinator followup and exact abort fields exist in native RPC schemas', options, () => {
  const text = source('sessions-', 'const ChatSendParamsSchema =');
  const send = section(text, 'const ChatSendParamsSchema =', 'const ChatAbortParamsSchema =');
  for (const field of ['sessionKey', 'agentId', 'message', 'queueMode', 'deliver', 'idempotencyKey']) assert.match(send, new RegExp(`\\b${field}:`));
  const abort = section(text, 'const ChatAbortParamsSchema =', 'const ChatInjectParamsSchema =');
  for (const field of ['sessionKey', 'agentId', 'runId']) assert.match(abort, new RegExp(`\\b${field}:`));
  const queueDocs = readFileSync(join(root, 'docs/concepts/queue.md'), 'utf8');
  assert.match(queueDocs, /`followup`: do not steer/);
});

test('native spawn supports isolated quiet tasks, while sessions_send exposes steering', options, () => {
  const text = source('sessions-spawn-tool-', 'function createSessionsSpawnToolSchema');
  const spawn = section(text, 'function createSessionsSpawnToolSchema', 'function resolveAcpUnavailableMessage');
  for (const field of ['task', 'taskName', 'label', 'runtime', 'context', 'mode', 'cleanup', 'expectsCompletionMessage', 'runTimeoutSeconds']) assert.match(spawn, new RegExp(`\\b${field}:`));
  assert.match(spawn, /false: fire-and-forget; requester gets no completion handoff/);
  const send = section(text, 'const SessionsSendToolSchema =', 'const log =');
  assert.doesNotMatch(send, /queueMode|steeringMode/);
  assert.match(text, /targetDisposition: Type.Union\(\[Type.Literal\("queued"\), Type.Literal\("steered"\)\]\)/);
});

test('native gateway applies separate main and subagent lane capacities', options, () => {
  const text = source('hook-client-ip-config-', 'src/gateway/server-lanes.ts');
  assert.match(text, /main: resolveAgentMaxConcurrent\(cfg\)/);
  assert.match(text, /subagent: resolveSubagentMaxConcurrent\(cfg\)/);
  assert.match(text, /setCommandLaneConcurrency\("main", concurrency.main\)/);
  assert.match(text, /setCommandLaneConcurrency\("subagent", concurrency.subagent\)/);
  // Other lanes exist: this must not be misreported as a universal total-turn cap.
  assert.match(text, /setCommandLaneConcurrency\("nested", 1\)/);
});

test('native OAuth refresh serializes by provider/profile and rereads under a file lock', options, () => {
  const text = source('oauth-', 'function refreshQueueKey(provider, profileId)');
  assert.match(text, /new KeyedAsyncQueue\(\)/);
  assert.ok(text.includes('`${provider}\\u0000${profileId}`'));
  const refresh = section(text, 'async function doRefreshOAuthTokenWithLock', 'async function refreshOAuthTokenWithLock');
  assert.ok(refresh.indexOf('withFileLock(globalRefreshLockPath') < refresh.indexOf('const store = loadStoredOAuthRefreshStore'));
  assert.match(refresh, /hasUsableOAuthCredential\(cred\)/);
  assert.match(text, /refreshQueue.enqueue\(key, \(\) => doRefreshOAuthTokenWithLock\(params\)\)/);
});
