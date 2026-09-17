import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileJournal } from '../runtime/file-journal.mjs';
import { ControlClient } from '../runtime/control-client.mjs';
import { createWappMcpReader } from '../runtime/wappmcp-operations.mjs';

const tool = 'whatsapp_search_messages';
const args = { chatId: 'selected@g.us', query: 'lunch', page: 3, limit: 17 };
const response = { structuredContent: { messages: [], meta: { q: 'lunch', chat: { id: args.chatId }, page: 3, limit: 17 } } };
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'hehe-wapp-binding-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const journal = new FileJournal(directory), requests = [], calls = [];
  const config = { journal, attemptId: 'a'.repeat(128),
    identity: { epoch: 7, boot_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    runId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', attempt: 3,
    deadlineAt: new Date(Date.now() + 60000).toISOString(),
    grant: { chatIds: [args.chatId], tools: [tool] } };
  await journal.putIfAbsent(config.attemptId, { attemptId: config.attemptId, status: 'running' });
  const f = { config, requests, calls, decision: () => ({ allowed: true, deadline_at: config.deadlineAt }),
    dispatch: async () => structuredClone(response) };
  config.controlClient = new ControlClient({ origin: 'https://control.example', token: 'synthetic-token', fetchImpl: async (url, init) => {
    assert.equal(url, 'https://control.example/internal/whatsapp-read-authorize');
    requests.push(JSON.parse(init.body));
    return new Response(JSON.stringify(await f.decision()), { headers: { 'content-type': 'application/json' } });
  } });
  config.mcpClient = { async callTool(...input) {
    calls.push(input);
    assert.equal((await journal.get(config.attemptId)).whatsappReads.operation.status, 'intent');
    return f.dispatch(...input);
  } };
  return f;
}

test('binds exact immutable Worker custody and durable intent to SDK arguments and tightened deadline', async t => {
  const f = await fixture(t), expected = { identity: structuredClone(f.config.identity), run_id: f.config.runId, attempt: 3, name: tool, chatId: args.chatId };
  const cap = Date.now() + 37000;
  f.decision = () => ({ allowed: true, deadline_at: new Date(cap).toISOString() });
  const read = createWappMcpReader(f.config);
  f.config.identity.epoch = 99; f.config.grant.chatIds[0] = 'other@g.us'; f.config.attempt = 9;
  const result = await read('operation', tool, args);
  assert.deepEqual(result, { chatId: args.chatId, query: 'lunch', page: 3, messages: [], coverage: 'unknown' });
  assert.deepEqual(f.requests, [expected, expected, expected]);
  assert.equal(f.calls.length, 1);
  const [payload, schema, options] = f.calls[0];
  assert.deepEqual(payload, { name: tool, arguments: args });
  assert.equal(schema, undefined); // SDK default validation stays enabled.
  assert.ok(options.signal instanceof AbortSignal);
  assert.ok(options.timeout > 0 && options.timeout <= 37000);
  assert.equal(options.resetTimeoutOnProgress, false);
  assert.equal((await f.config.journal.get(f.config.attemptId)).whatsappReads.operation.status, 'response');
});

test('reopened binding rejects another run/attempt/lease/deadline/scope before Worker or MCP access', async t => {
  const f = await fixture(t);
  await createWappMcpReader(f.config)('operation', tool, args);
  for (const change of [
    { runId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }, { attempt: 4 },
    { identity: { ...f.config.identity, epoch: 8 } },
    { deadlineAt: new Date(Date.parse(f.config.deadlineAt) + 1).toISOString() },
    { grant: { chatIds: [args.chatId, 'other@g.us'], tools: [tool] } },
  ]) {
    const read = createWappMcpReader({ ...f.config, journal: new FileJournal(f.config.journal.directory), ...change });
    await assert.rejects(read('new-operation', tool, args), { code: 'WHATSAPP_READ_DENIED' });
  }
  assert.equal(f.requests.length, 3); assert.equal(f.calls.length, 1);
  await assert.rejects(createWappMcpReader(f.config)('operation', tool, args), { code: 'WHATSAPP_READ_FAILED' });
  assert.equal(f.calls.length, 1);
});

test('Worker denial before dispatch and revocation before release preserve truthful invocation state', async t => {
  for (const deniedAt of [1, 2, 3]) {
    const f = await fixture(t);
    f.decision = () => f.requests.length === deniedAt ? { allowed: false } : { allowed: true, deadline_at: f.config.deadlineAt };
    await assert.rejects(createWappMcpReader(f.config)('operation', tool, args));
    assert.equal(f.requests.length, deniedAt);
    assert.equal(f.calls.length, deniedAt === 3 ? 1 : 0);
    const row = await f.config.journal.get(f.config.attemptId);
    assert.equal(row.whatsappReads?.operation?.status, deniedAt === 1 ? undefined : deniedAt === 2 ? 'intent' : 'response');
  }
});

test('cancellation reaches only the invocation signal; late result and SDK rejection cannot settle or replay', async t => {
  const f = await fixture(t), controller = new AbortController();
  let release, started;
  const dispatched = new Promise(resolve => { started = resolve; });
  f.dispatch = () => { started(); return new Promise(resolve => { release = resolve; }); };
  const read = createWappMcpReader(f.config);
  const pending = read('operation', tool, args, controller.signal);
  const rejected = assert.rejects(pending, { code: 'WHATSAPP_READ_STOPPED' });
  await dispatched; controller.abort(); await rejected;
  assert.equal(f.calls[0][2].signal.aborted, true);
  release(response); await new Promise(setImmediate);
  assert.equal((await f.config.journal.get(f.config.attemptId)).whatsappReads.operation.status, 'intent');
  await assert.rejects(read('operation', tool, args));
  assert.equal(f.calls.length, 1);
  const failed = await fixture(t);
  failed.dispatch = () => { throw Error('PRIVATE_SDK_DETAIL'); };
  await assert.rejects(createWappMcpReader(failed.config)('operation', tool, args), { code: 'WHATSAPP_READ_FAILED' });
  assert.equal((await failed.config.journal.get(failed.config.attemptId)).whatsappReads.operation.status, 'intent');
});

test('model-supplied custody, unscoped reads, mutations and malformed host identity cause no requests', async t => {
  const f = await fixture(t), read = createWappMcpReader(f.config);
  for (const [name, input] of [[tool, { ...args, run_id: f.config.runId }], [tool, { ...args, chatId: 'other@g.us' }],
    ['whatsapp_send_message', { chatId: args.chatId, text: 'not allowed' }]]) {
    await assert.rejects(read('operation', name, input), { code: 'WHATSAPP_READ_DENIED' });
  }
  await assert.rejects(createWappMcpReader({ ...f.config, identity: { ...f.config.identity, token: 'not-custody' } })('operation', tool, args),
    { code: 'WHATSAPP_READ_DENIED' });
  assert.deepEqual(f.requests, []); assert.deepEqual(f.calls, []);
});
