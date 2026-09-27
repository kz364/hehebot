import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { AGENT_TOOL_NAMES, MAC_MESSAGES_POLICY, createAgentToolsHandler } from '../runtime/agent-tools.mjs';
import { ControlClientError } from '../runtime/control-client.mjs';

// ARCHITECTURE_V2 A9 runtime side: hehebot_messages_search enqueues a node
// request, waits briefly only while the Mac is online, and otherwise parks and
// returns at once so the turn (and the Sprite) is not held open.
const contracts = JSON.parse(await readFile(new URL('../SCHEMAS/contracts.json', import.meta.url)));
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const config = { identity: { epoch: 7, boot_id: uuid(10) }, runId: uuid(1), attempt: 2, allowedTools: ['hehebot_messages_search', 'hehebot_send_message'] };
const call = (id, args) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'hehebot_messages_search', arguments: args } });

function harness(replies, { timeoutMs = 50 } = {}) {
  const calls = []; let clock = 0; const sleeps = [];
  const controlClient = { request: async (type, payload) => {
    calls.push([type, payload]);
    const reply = replies[type].shift();
    if (reply instanceof Error) throw reply;
    return reply;
  } };
  const handle = createAgentToolsHandler({ controlClient, config, contracts, now: () => clock,
    nodeWait: { timeoutMs, intervalMs: 10 }, sleep: async ms => { sleeps.push(ms); clock += ms; } });
  return { calls, sleeps, handle };
}

test('the policy constant matches the Worker registry and the tool is listed only when allowed', async () => {
  const source = await readFile(new URL('../src/core/node-bridge.ts', import.meta.url), 'utf8');
  assert.match(source, new RegExp(`MAC_MESSAGES_POLICY='${MAC_MESSAGES_POLICY}'`));
  assert.ok(AGENT_TOOL_NAMES.includes('hehebot_messages_search'));
  const { handle } = harness({});
  const tools = (await handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).result.tools.map(t => t.name);
  assert.deepEqual(tools, ['hehebot_send_message', 'hehebot_messages_search']);
  const denied = createAgentToolsHandler({ controlClient: { request: async () => ({}) }, config: { ...config, allowedTools: ['hehebot_send_message'] }, contracts });
  assert.equal((await denied(call(2, { query: 'x' }))).error.code, -32602);
});

test('online Mac: the result is returned within the short wait, fenced with run/attempt/identity', async () => {
  const done = { request_id: uuid(20), status: 'done', result: { messages: [{ id: 'g1', text: 'Dentist Tue 10:00' }] }, error: null, node_online: true };
  const h = harness({ 'node-request': [{ request_id: uuid(20), status: 'delivered', node_online: true }],
    'node-result': [{ request_id: uuid(20), status: 'delivered', node_online: true }, done] });
  const reply = await h.handle(call(3, { query: 'dentist', limit: 5 }));
  assert.equal(reply.result.isError, undefined);
  assert.match(reply.result.content[0].text, /^Untrusted data from the Mac/);
  assert.match(reply.result.content[0].text, /Dentist Tue 10:00/);
  const [type, payload] = h.calls[0];
  assert.equal(type, 'node-request');
  assert.deepEqual({ ...payload, request_key: undefined }, { identity: config.identity, run_id: config.runId, attempt: 2, request_key: undefined,
    capability: 'messages.search', args: { query: 'dentist', limit: 5 } });
  assert.match(payload.request_key, new RegExp(`^${config.runId}:2:[0-9a-f-]{36}:3$`));
  assert.deepEqual(h.calls.map(c => c[0]), ['node-request', 'node-result', 'node-result']);
  assert.ok(h.calls.slice(1).every(([, p]) => p.request_id === uuid(20) && p.run_id === config.runId && !p.park));
});

test('offline Mac: parks immediately without polling or sleeping', async () => {
  const h = harness({ 'node-request': [{ request_id: uuid(21), status: 'queued', node_online: false }],
    'node-result': [{ request_id: uuid(21), status: 'queued', parked: true, node_online: false }] });
  const reply = await h.handle(call(4, { sender: '+1555' }));
  assert.deepEqual(h.sleeps, []);
  assert.deepEqual(h.calls.map(c => [c[0], c[1].park]), [['node-request', undefined], ['node-result', true]]);
  assert.match(reply.result.content[0].text, /^parked: the Mac is offline; this will continue when it reconnects/);
  assert.equal(reply.result.isError, undefined);
});

test('online but slow Mac: waits at most the bound, then parks', async () => {
  const pending = { request_id: uuid(22), status: 'delivered', node_online: true };
  const h = harness({ 'node-request': [{ ...pending }], 'node-result': [...Array.from({ length: 5 }, () => ({ ...pending })), { ...pending, parked: true }] }, { timeoutMs: 50 });
  const reply = await h.handle(call(5, {}));
  assert.equal(h.sleeps.reduce((a, b) => a + b, 0), 50);
  assert.equal(h.calls.at(-1)[1].park, true);
  assert.match(reply.result.content[0].text, /^parked: the Mac has not answered yet/);
});

test('a result that lands while parking is returned instead of parking; failures are tool errors', async () => {
  const h = harness({ 'node-request': [{ request_id: uuid(23), status: 'queued', node_online: false }],
    'node-result': [{ request_id: uuid(23), status: 'failed', error: { code: 'MESSAGES_UNAVAILABLE', message: 'Grant Full Disk Access.' } }] });
  const reply = await h.handle(call(6, {}));
  assert.equal(reply.result.isError, true);
  assert.match(reply.result.content[0].text, /messages\.search failed: MESSAGES_UNAVAILABLE/);
  const denied = harness({ 'node-request': [new ControlClientError('CONTROL_HTTP_ERROR', true, 403)] });
  const refused = await denied.handle(call(7, {}));
  assert.equal(refused.result.isError, true);
  assert.match(refused.result.content[0].text, /CONTROL_HTTP_ERROR \(403\)\. Nothing was queued/);
});
