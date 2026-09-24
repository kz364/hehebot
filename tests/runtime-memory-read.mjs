import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { createServer } from 'node:https';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createAgentToolsHandler } from '../runtime/agent-tools.mjs';
import { createCodexTools } from '../runtime/codex-tools.mjs';
import { CodexTransport } from '../runtime/codex-transport.mjs';
import { FileJournal } from '../runtime/file-journal.mjs';
import { materializeMemoryResponse } from '../runtime/memory-read.mjs';

const contracts = JSON.parse(await readFile(new URL('../SCHEMAS/contracts.json', import.meta.url)));
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const config = { identity: { epoch: 2, boot_id: uuid(1) }, runId: uuid(2), attempt: 3,
  allowedTools: ['hehebot_read_memory'], memoryBudget: { selected_model: 'gpt-5.4', sha256: 'a'.repeat(64) } };
const args = { memory_id: uuid(4), revision: 7, offset: 3, limit: 19 };
const message = { jsonrpc: '2.0', id: 17, method: 'tools/call', params: { name: 'hehebot_read_memory', arguments: args } };
const text = JSON.stringify({ schema_version: 1, memory: { id: uuid(4), revision: 7, text: 'source-73 🧭e\u0301 <|endoftext|>' }, range: { offset: 3, end: 22 } });
const tokenizer = 'gpt-tokenizer@4.0.0/o200k_base/ordinary-v1';
function fixture(options = {}) {
  let time = 1000;
  const calls = [], counts = [];
  const controlClient = { request: async (type, q) => {
    calls.push({ type, q: structuredClone(q) });
    if (type === 'memory-read-prepare') {
      const p = { schema_version: 1, read_id: q.read_id, run_id: q.run_id, attempt: q.attempt,
        selected_model: 'gpt-5.4', baseline_sha256: 'a'.repeat(64), tokenizer, bucket: options.bucket ?? 'scoped', text, not_after: new Date(5000).toISOString() };
      p.sha256 = createHash('sha256').update(JSON.stringify([1, 2, uuid(1), uuid(2), 3, q.read_id,
        uuid(4), 7, 3, 19, 'a'.repeat(64), 'gpt-5.4', p.bucket, text])).digest('hex');
      return options.prepare ? options.prepare(p) : p;
    }
    assert.equal(type, 'memory-read-reserve');
    const r = { read_id: q.read_id, sha256: q.sha256, reserved: true, delivery_allowed: true, not_after: new Date(4000).toISOString() };
    return options.reserve ? options.reserve(r) : r;
  } };
  const memoryCounter = async (input, opts) => {
    counts.push({ input: structuredClone(input), opts });
    const c = { schema_version: 1, selected_model: 'gpt-5.4', tokenizer,
      global_tokens: input.global ? 73 : 0, scoped_tokens: input.scoped ? 91 : 0 };
    return options.count ? options.count(c) : c;
  };
  const now = () => time;
  const handle = createAgentToolsHandler({ controlClient, config, contracts, memoryCounter, now });
  return { handle, controlClient, memoryCounter, now, calls, counts, advance: value => { time = value; } };
}

for (const bucket of ['global', 'scoped']) test(`counts exact ${bucket} envelope then reserves before one final emission`, async () => {
  const f = fixture({ bucket });
  const response = await f.handle(message);
  assert.equal(JSON.stringify(response), '{}', 'no source body before final write');
  assert.deepEqual(f.counts[0].input, { selected_model: 'gpt-5.4', global: bucket === 'global' ? text : '', scoped: bucket === 'scoped' ? text : '' });
  assert.equal(f.counts[0].opts.timeoutMs, 4000);
  assert.deepEqual(f.calls.map(x => x.type), ['memory-read-prepare', 'memory-read-reserve']);
  const q = f.calls[1].q;
  assert.equal(q.tokens, bucket === 'global' ? 73 : 91);
  assert.deepEqual(q.identity, config.identity); assert.equal(q.attempt, 3);
  assert.equal(q.read_id, f.calls[0].q.read_id); assert.notEqual(q.read_id, String(message.id));
  assert.deepEqual(materializeMemoryResponse(response), { jsonrpc: '2.0', id: 17, result: { content: [{ type: 'text', text }] } });
  assert.throws(() => materializeMemoryResponse(response), /MEMORY_READ_DENIED/);
  const repeated = await f.handle(message);
  assert.notEqual(f.calls[2].q.read_id, q.read_id, 'connection-local RPC ids are not durable read ids');
  assert.equal(materializeMemoryResponse(repeated).result.content[0].text, text);
});

test('real pinned tokenizer counts the delivered metadata envelope, not only source text', async () => {
  const f = fixture();
  const handle = createAgentToolsHandler({ controlClient: f.controlClient, config, contracts, now: f.now });
  const result = materializeMemoryResponse(await handle(message));
  assert.equal(result.result.content[0].text, text);
  // Independently derived using Python tiktoken0.11.0 o200k_base encode_ordinary
  // on this exact compact UTF-8 JSON envelope (no Unicode normalization).
  assert.equal(f.calls[1].q.tokens, 61);
});

test('schemas and grants refuse model authority fields, invalid ranges and staged principals before requests', async () => {
  const f = fixture();
  for (const patch of [{ read_id: uuid(9) }, { selected_model: 'gpt-5' }, { tokens: 1 }, { revision: 0 }, { offset: -1 }, { limit: 2001 }, { identity: config.identity }]) {
    assert.equal((await f.handle({ ...message, params: { ...message.params, arguments: { ...args, ...patch } } })).error.code, -32602);
  }
  assert.deepEqual(f.calls, []);
  for (const patch of [{ memoryBudget: undefined }, { principal: 'warm-task' }, { principal: 'background-task' }]) {
    assert.throws(() => createAgentToolsHandler({ controlClient: f.controlClient, config: { ...config, ...patch }, contracts }), /INVALID_CONFIGURATION/);
  }
  const noGrant = createAgentToolsHandler({ controlClient: f.controlClient, config: { ...config, allowedTools: [] }, contracts });
  assert.equal((await noGrant(message)).error.code, -32602);
});

test('mismatched preparation custody or bytes never reaches counting or reservation', async () => {
  for (const patch of [{ schema_version: 2 }, { read_id: uuid(19) }, { run_id: uuid(19) }, { attempt: 4 },
    { selected_model: 'gpt-5.5' }, { baseline_sha256: 'b'.repeat(64) }, { tokenizer: 'wrong' }, { bucket: 'other' },
    { text: text + 'mutation' }, { sha256: 'b'.repeat(64) }, { not_after: 'invalid' }, { not_after: new Date(1000).toISOString() }]) {
    const f = fixture({ prepare: p => ({ ...p, ...patch }) });
    assert.equal((await f.handle(message)).error.code, -32000, JSON.stringify(patch));
    assert.equal(f.calls.length, 1); assert.equal(f.counts.length, 0);
  }
});

test('invalid counts cannot reserve and an unmapped grant cannot even prepare', async () => {
  for (const patch of [{ schema_version: 2 }, { selected_model: 'gpt-5.5' }, { tokenizer: 'wrong' }, { scoped_tokens: 0 },
    { scoped_tokens: 0.1 }, { scoped_tokens: Number.MAX_SAFE_INTEGER + 1 }, { global_tokens: 1 }]) {
    const f = fixture({ count: c => ({ ...c, ...patch }) });
    assert.equal((await f.handle(message)).error.code, -32000); assert.equal(f.calls.length, 1);
  }
  const f = fixture();
  const handle = createAgentToolsHandler({ controlClient: f.controlClient, config: { ...config,
    memoryBudget: { ...config.memoryBudget, selected_model: 'gpt-5-unreviewed' } }, contracts });
  assert.equal((await handle(message)).error.code, -32000); assert.deepEqual(f.calls, []);
});

test('authority refusal, unknown reservation and reconciliation never disclose or retry', async () => {
  for (const reserve of [() => { throw Error('source deleted or cancelled'); }, () => { throw Error('lost reservation reply'); },
    r => ({ ...r, delivery_allowed: false }), r => ({ ...r, reserved: false }), r => ({ ...r, read_id: uuid(19) }),
    r => ({ ...r, sha256: 'b'.repeat(64) }), r => ({ ...r, not_after: 'invalid' })]) {
    const f = fixture({ reserve });
    const response = await f.handle(message);
    assert.equal(response.error.code, -32000); assert.doesNotMatch(JSON.stringify(response), /source-73/);
    assert.equal(f.calls.length, 2);
  }
});

test('abort and deadline fences apply after count, after reservation and immediately before final emission', async () => {
  for (const where of ['count', 'reserve', 'delivery']) for (const abort of [true, false]) {
    const controller = new AbortController();
    let f;
    const interrupt = () => { if (abort) controller.abort(); else f.advance(5000); };
    f = fixture({ [where]: value => { interrupt(); return value; } });
    const response = await f.handle(message, { signal: controller.signal });
    if (where === 'delivery') {
      interrupt(); assert.equal(materializeMemoryResponse(response).result.isError, true);
    } else assert.equal(response.error.code, -32000);
    assert.equal(f.calls.length, where === 'count' ? 1 : 2);
  }
  const f = fixture(), response = await f.handle(message);
  f.advance(4000); // Reservation shortened the original 5000 deadline.
  assert.equal(materializeMemoryResponse(response).result.isError, true);
});

test('dynamic read journals remain body-free after delivery and reconstruction cannot replay', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'hehe-memory-dynamic-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const f = fixture();
  const adapter = { journal: new FileJournal(directory), requireRun: async () => ({ threadId: 'thread', nativeRunId: 'turn', status: 'running' }) };
  const build = () => createCodexTools({ adapter, attemptId: 'attempt', controlClient: f.controlClient, grant: config, contracts, memoryCounter: f.memoryCounter, now: f.now });
  const params = { threadId: 'thread', turnId: 'turn', callId: 'read-17', namespace: null, tool: 'hehebot_read_memory', arguments: args };
  const result = await build().handle(params);
  assert.equal(JSON.stringify(result), '{}');
  assert.deepEqual(materializeMemoryResponse(result), { success: true, contentItems: [{ type: 'inputText', text }] });
  const files = await readdir(directory);
  const contents = await Promise.all(files.map(file => readFile(join(directory, file), 'utf8')));
  assert.doesNotMatch(contents.join(''), /source-73|contentItems|"result"/);
  assert.equal(JSON.parse(contents[files.findIndex(file => file.startsWith('dynamic-call-'))]).status, 'unknown', 'host write does not attest consumption');
  adapter.journal = new FileJournal(directory);
  assert.equal((await build().handle(params)).success, false); assert.equal(f.calls.length, 2);
  const fresh = await build().handle({ ...params, callId: 'read-18' });
  f.advance(4000);
  assert.equal(materializeMemoryResponse(fresh).success, false);
});

test('Codex transport materializes only at write and suppresses expiration between handler return and write', async () => {
  for (const expired of [false, true]) {
    const f = fixture();
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
    const writes = [];
    child.stdin.on('data', data => writes.push(JSON.parse(data.toString())));
    const transport = new CodexTransport(child, { onToolCall: async () => {
      const response = await f.handle(message);
      const { mapMemoryResponse } = await import('../runtime/memory-read.mjs');
      const result = mapMemoryResponse(response, value => ({ success: value.result.isError !== true, contentItems: [{ type: 'inputText', text: value.result.content[0].text }] }));
      if (expired) queueMicrotask(() => f.advance(4000));
      return result;
    } });
    child.stdout.write(JSON.stringify({ id: 1, method: 'item/tool/call', params: {} }) + '\n');
    await new Promise(setImmediate);
    if (expired) {
      assert.equal(writes.length, 1); assert.equal(writes[0].result.success, false);
      assert.doesNotMatch(JSON.stringify(writes), /source-73/);
      assert.equal(transport.closed, false, 'expiry of one read must not disconnect unrelated tasks');
    }
    else assert.deepEqual(writes, [{ id: 1, result: { success: true, contentItems: [{ type: 'inputText', text }] } }]);
    transport.close();
  }
});

test('real MCP CLI counts and emits exact bytes; cancellation before reservation reply suppresses content', { timeout: 20000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'hehe-memory-mcp-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const key = join(directory, 'key'), cert = join(directory, 'cert');
  await promisify(execFile)('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', key, '-out', cert]);
  const tokenFile = join(directory, 'token'), grantFile = join(directory, 'grant');
  await writeFile(tokenFile, 'synthetic-memory-token', { mode: 0o600 });
  const f = fixture({ prepare: p => ({ ...p, not_after: new Date(Date.now() + 10000).toISOString() }),
    reserve: r => ({ ...r, not_after: new Date(Date.now() + 10000).toISOString() }) });
  let child, cancel = false, sawPing;
  const server = createServer({ key: await readFile(key), cert: await readFile(cert) }, async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const type = req.url.slice('/internal/'.length);
      const result = await f.controlClient.request(type, JSON.parse(Buffer.concat(chunks)));
      if (cancel && type === 'memory-read-reserve') {
        const ping = new Promise(resolve => { sawPing = resolve; });
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 17 } }) + '\n');
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 'barrier', method: 'ping' }) + '\n');
        await ping; // Prove cancellation processed before releasing reservation.
      }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(result));
      if (type === 'memory-read-reserve') child.stdin.end();
    } catch { res.writeHead(500); res.end('{}'); child.stdin.end(); }
  });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  t.after(() => new Promise(ok => { server.closeAllConnections(); server.close(ok); }));
  await writeFile(grantFile, JSON.stringify({ ...config, origin: `https://127.0.0.1:${server.address().port}/`, tokenFile }), { mode: 0o600 });
  for (cancel of [false, true]) {
    child = spawn(process.execPath, ['runtime/agent-tools.mjs'], { timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, HEHEBOT_AGENT_TOOLS_CONFIG: grantFile, NODE_EXTRA_CA_CERTS: cert } });
    const replies = []; let buffer = '', stderr = '';
    child.stdout.on('data', chunk => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const value = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1); replies.push(value);
        if (value.id === 'barrier') sawPing();
      }
    });
    child.stderr.on('data', data => { stderr += data; });
    const done = new Promise((resolve, reject) => { child.on('close', resolve); child.on('error', reject); });
    child.stdin.write(JSON.stringify(message) + '\n');
    assert.equal(await done, 0, stderr);
    const reply = replies.find(value => value.id === 17);
    if (cancel) { assert.ok(reply.error); assert.doesNotMatch(JSON.stringify(replies), /source-73/); }
    else assert.equal(reply.result.content[0].text, text);
  }
  assert.equal(f.calls.length, 4);
  assert.equal(f.calls[1].q.tokens, 61); assert.equal(f.calls[3].q.tokens, 61);
  assert.notEqual(f.calls[1].q.read_id, f.calls[3].q.read_id);
});
