// Runs only against verify-wappmcp's disposable, integrity-locked installation.
// Actual SDK + upstream JSON helper, synthetic messages, no WhatsApp/browser.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { FileJournal } from '../runtime/file-journal.mjs';
import { readJournaledWappMcp } from '../runtime/wappmcp-operations.mjs';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function bounded(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('SDK_FIXTURE_TIMEOUT')), 5000); })]); }
  finally { clearTimeout(timer); }
}

export async function verifyWappMcpSdk(installation) {
  const require = createRequire(join(installation, 'package.json'));
  const sdkVersion = JSON.parse(await readFile(join(installation, 'node_modules/@modelcontextprotocol/sdk/package.json'))).version;
  assert.equal(sdkVersion, '1.30.0');
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
  const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
  const { CallToolResultSchema } = require('@modelcontextprotocol/sdk/types.js');
  const { z } = require('zod');
  const { createJsonResult } = await import(pathToFileURL(join(installation, 'node_modules/wappmcp/dist/lib/mcp/helpers.js')).href);
  const chatId = 'synthetic-family@g.us', recent = 'whatsapp_get_chat_messages', search = 'whatsapp_search_messages';
  const message = { id: 'synthetic-43', chat: { id: chatId }, body: 'Synthetic text', timestamp: '2026-09-16T05:00:00.000Z' };
  const recentSchema = CallToolResultSchema.safeParse(createJsonResult([message]));
  assert.equal(recentSchema.success, false);
  assert.ok(recentSchema.error.issues.some(issue => issue.path[0] === 'structuredContent'));
  const grant = { chatIds: [chatId], tools: [recent, search] };
  const results = [];
  const directory = await mkdtemp(join(tmpdir(), 'hehebot-sdk-journal-'));
  const journal = new FileJournal(directory), attemptId = 'sdk-attempt';
  try {
    await journal.putIfAbsent(attemptId, { attemptId, status: 'running', rootSettled: false });
    for (const mode of ['recent', 'search', 'abort', 'timeout', 'close']) {
      const client = new Client({ name: 'hehebot-synthetic-client', version: '1.0.0' });
      const server = new McpServer({ name: 'hehebot-synthetic-server', version: '1.0.0' });
      const started = deferred(), release = deferred(), cancelled = deferred(), returned = deferred();
      let handlerReturned = false, calls = 0, dispatches = 0;
      const held = ['abort', 'timeout', 'close'].includes(mode), name = mode === 'recent' ? recent : search;
      server.registerTool(name, { inputSchema: z.object({ chatId: z.string(), limit: z.number(), query: z.string().optional(), page: z.number().optional() }) },
        async (args, extra) => {
          calls++; assert.equal(args.chatId, chatId);
          extra.signal.addEventListener('abort', () => cancelled.resolve(), { once: true });
          started.resolve();
          if (held) await release.promise; // Deliberately ignore cancellation.
          handlerReturned = true; returned.resolve();
          return createJsonResult(mode === 'recent' ? [message] : { messages: [message], meta: { q: args.query, chat: { id: chatId }, page: args.page, limit: args.limit } });
        });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const controller = new AbortController();
      const options = { signal: controller.signal, deadlineAt: new Date(Date.now() + 60000).toISOString(), authorize: () => true };
      const call = (tool, args, { signal }) => {
        dispatches++;
        return client.callTool({ name: tool, arguments: args }, CallToolResultSchema, { signal, timeout: mode === 'timeout' ? 37 : 10000 });
      };
      const run = (readOptions = options) => readJournaledWappMcp({ journal, attemptId, operationId: mode }, grant, name,
        { chatId, ...(name === search ? { query: 'Synthetic', page: 3, limit: 17 } : {}) }, call, readOptions);
      try {
        await bounded(server.connect(serverTransport)); await bounded(client.connect(clientTransport));
        const pending = run();
        if (!held) {
          if (mode === 'recent') {
            // Upstream helper casts an array to Record but does not wrap it.
            // Keep this supported-path incompatibility explicit; never bypass SDK validation.
            await assert.rejects(bounded(pending), error => ['WHATSAPP_READ_FAILED', 'WHATSAPP_READ_INVALID'].includes(error.code));
            results.push({ mode, recentArrayCompatible: false, blocker: 'structuredContent must be an object, not an array', calls });
          } else {
            const output = await bounded(pending);
            assert.deepEqual(output, { chatId, messages: [{ id: message.id, body: message.body, timestamp: message.timestamp }], coverage: 'unknown', query: 'Synthetic', page: 3 });
            results.push({ mode, scopedReadPassed: true, calls });
          }
          assert.equal(calls, 1);
          continue;
        }
        const rejected = assert.rejects(bounded(pending), { code: mode === 'abort' ? 'WHATSAPP_READ_STOPPED' : 'WHATSAPP_READ_FAILED' });
        await bounded(started.promise);
        if (mode === 'abort') controller.abort();
        if (mode === 'close') await bounded(client.close());
        await rejected; await bounded(cancelled.promise);
        assert.equal(handlerReturned, false);
        assert.equal((await journal.get(attemptId)).whatsappReads[mode].status, 'intent');
        await bounded(client.close());
        assert.equal(handlerReturned, false); // Transport close does not await work.
        release.resolve(); await bounded(returned.promise); await new Promise(setImmediate);
        assert.equal((await journal.get(attemptId)).whatsappReads[mode].status, 'intent');
        await assert.rejects(run({ ...options, signal: new AbortController().signal }), { code: 'WHATSAPP_READ_FAILED' });
        assert.equal(calls, 1); assert.equal(dispatches, 1);
        results.push({ mode, serverAbortObserved: true, closeBeforeHandlerReturn: true, retainedUnknown: true, replayPrevented: true, calls });
      } finally {
        release.resolve();
        await bounded(client.close()); await bounded(server.close());
      }
    }
    assert.equal((await journal.get(attemptId)).whatsappReads.search.status, 'response');
    return { sdkVersion, transport: 'in-memory', results, livePairing: false, processTerminationVerified: false };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
