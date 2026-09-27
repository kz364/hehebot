import assert from 'node:assert/strict';
import test from 'node:test';
import { BROWSER_POLICY, BROWSER_TOOLS, browserLimits, createBrowserGateway } from '../runtime/browser-gateway.mjs';

const identity = { epoch: 3, boot_id: '11111111-1111-4111-8111-111111111111' };
const config = { identity, runId: '22222222-2222-4222-8222-222222222222', attempt: 1 };
const upstream = ['browser_navigate', 'browser_click', 'browser_snapshot', 'browser_run_code_unsafe', 'browser_evaluate', 'browser_file_upload', 'browser_type']
  .map(name => ({ name, description: name, inputSchema: { type: 'object', properties: { filename: { type: 'string' }, url: { type: 'string' } } } }));

function fixture({ call = async () => ({ content: [{ type: 'text', text: 'ok' }] }), control = async () => ({}) } = {}) {
  const requests = [], calls = [];
  let restarts = 0;
  const child = { async request(method, params) { if (method === 'tools/list') return { tools: upstream }; calls.push(params); return call(params); },
    async restart() { restarts++; } };
  const controlClient = { async request(type, payload) { requests.push([type, payload]); return control(type, payload); } };
  const handle = createBrowserGateway({ child, controlClient, config, limits: browserLimits({ callMs: 2000, actionMs: 500, navigationMs: 1000, repeatLimit: 2, maxActions: 5 }) });
  let id = 0;
  const invoke = (name, args = {}) => handle({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } });
  return { handle, invoke, requests, calls, restarts: () => restarts };
}

test('lists only allowlisted tools and strips file output arguments', async () => {
  const f = fixture();
  const listed = (await f.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).result.tools;
  assert.deepEqual(listed.map(tool => tool.name).sort(), ['browser_click', 'browser_navigate', 'browser_snapshot', 'browser_type']);
  assert.ok(listed.every(tool => !tool.inputSchema.properties.filename));
  assert.ok(!BROWSER_TOOLS.includes('browser_run_code_unsafe') && !BROWSER_TOOLS.includes('browser_evaluate'));
});

test('arbitrary code, local files and filename arguments are refused before the browser', async () => {
  const f = fixture();
  for (const [name, args] of [['browser_run_code_unsafe', { code: 'x' }], ['browser_evaluate', { function: '() => 1' }],
    ['browser_file_upload', { paths: ['/etc/passwd'] }], ['browser_snapshot', { filename: '/tmp/x' }]]) {
    assert.equal((await f.invoke(name, args)).error.code, -32602);
  }
  assert.equal(f.calls.length, 0);
});

test('reads skip the ledger; actions are permitted, dispatched and confirmed in order', async () => {
  const f = fixture();
  await f.invoke('browser_navigate', { url: 'https://example.com' });
  assert.equal(f.requests.length, 0);
  const result = await f.invoke('browser_click', { element: 'More', target: 'e3' });
  assert.equal(result.result.isError, undefined);
  assert.deepEqual(f.requests.map(([type, payload]) => type === 'effect-intent' ? `${type}:${payload.effect.classification}:${payload.effect.authorization_ref}` : `${type}:${payload.status}`),
    [`effect-intent:mutation:${BROWSER_POLICY}`, 'effect-result:dispatched', 'effect-result:confirmed']);
});

test('a refused permit performs nothing', async () => {
  const f = fixture({ control: async type => { if (type === 'effect-intent') throw Object.assign(new Error('FORBIDDEN'), { code: 'FORBIDDEN' }); return {}; } });
  const result = await f.invoke('browser_type', { element: 'q', target: 'e1', text: 'hi' });
  assert.equal(result.result.isError, true);
  assert.match(result.result.content[0].text, /permit was refused/);
  assert.equal(f.calls.length, 0);
});

test('a hung action is outcome_unknown, the browser restarts, nothing is replayed', async () => {
  const f = fixture({ call: async () => { throw Object.assign(new Error('BROWSER_CALL_TIMEOUT'), { code: 'BROWSER_CALL_TIMEOUT' }); } });
  const result = await f.invoke('browser_click', { element: 'Pay', target: 'e9' });
  assert.equal(result.result.isError, true);
  assert.match(result.result.content[0].text, /timed out.*do not repeat/s);
  assert.equal(f.restarts(), 1);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.requests.at(-1)[1].status, 'outcome_unknown');
});

test('identical-call loops and the action budget stop the task', async () => {
  const f = fixture();
  for (let i = 0; i < 2; i++) assert.equal((await f.invoke('browser_snapshot')).result.isError, undefined);
  assert.match((await f.invoke('browser_snapshot')).result.content[0].text, /repeated 3 times/);
  await f.invoke('browser_navigate', { url: 'https://a.example' });
  await f.invoke('browser_navigate', { url: 'https://b.example' });
  assert.match((await f.invoke('browser_navigate', { url: 'https://c.example' })).result.content[0].text, /budget \(5\)/);
});

test('a CAPTCHA page tells the model to hand off to the owner', async () => {
  const f = fixture({ call: async () => ({ content: [{ type: 'text', text: 'Please verify you are human to continue' }] }) });
  const result = await f.invoke('browser_navigate', { url: 'https://shop.example' });
  assert.match(result.result.content.at(-1).text, /need a human/);
});

test('limits are configuration and validated', () => {
  assert.throws(() => browserLimits({ callMs: 1000, navigationMs: 30000 }), { code: 'INVALID_BROWSER_LIMITS' });
  assert.throws(() => browserLimits({ unknown: 1 }), { code: 'INVALID_BROWSER_LIMITS' });
  assert.equal(browserLimits().callMs, 45000);
});

test('the gateway policy id matches the Worker constant', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../src/core/agent-commands.ts', import.meta.url), 'utf8');
  assert.match(source, new RegExp(`BROWSER_POLICY='${BROWSER_POLICY}'`));
});
