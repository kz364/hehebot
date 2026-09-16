// Verification only: public ESM factory + locked SDK, synthetic session, no CLI/browser.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readWappMcp } from '../runtime/wappmcp-reads.mjs';

const hashes = {
  'index.js': 'dff70a42c3979a3abd6a8003eca714930b16c0451a657a66cd75bbad9a324abe',
  'lib/mcp/server.js': 'db13ddecbf0735955688867a08690ad1fe7a3b3429e85a83a4996080827346a3',
  'lib/mcp/helpers.js': '81dc4e17e949df937a392b7ad2149b123aea5b66d24b3c9fffb2079663225992',
};
const catalog = [
  'get_me', 'get_status', 'list_chats', 'get_chat', 'get_chat_participants',
  'get_chat_messages', 'search_messages', 'get_message', 'list_contacts',
  'get_contact', 'search_contacts', 'get_contact_lid', 'lookup_number',
  'send_message', 'send_media_from_base64', 'send_media_from_path',
  'reply_to_message', 'react_to_message', 'edit_message', 'delete_message',
  'forward_message', 'send_typing',
].map(name => `whatsapp_${name}`).sort();
async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('PUBLIC_SERVER_FIXTURE_TIMEOUT')), 5000);
    })]);
  } finally { clearTimeout(timer); }
}

/** Caller owns verify-wappmcp's disposable integrity-locked, scripts-disabled graph. */
export async function verifyWappMcpPublicServer(installation) {
  installation = resolve(installation);
  for (const [name, version] of [['wappmcp', '0.4.0'], ['@modelcontextprotocol/sdk', '1.30.0'], ['whatsapp-web.js', '1.34.7']]) {
    assert.equal(JSON.parse(await readFile(join(installation, 'node_modules', name, 'package.json'))).version, version);
  }
  assert.deepEqual(await readFile(join(installation, 'package-lock.json')),
    await readFile(new URL('../config/wappmcp/package-lock.json', import.meta.url)));
  for (const [file, digest] of Object.entries(hashes)) {
    assert.equal(createHash('sha256').update(await readFile(join(installation, 'node_modules/wappmcp/dist', file))).digest('hex'), digest);
  }
  // Bare public imports resolve in the supplied graph; never use private dist imports
  // or CommonJS resolution for wappmcp's import-only export map.
  const bridge = await mkdtemp(join(installation, 'public-server-api-'));
  let client, clientTransport, serverTransport;
  try {
    const entry = join(bridge, 'index.mjs');
    await writeFile(entry, [
      'export { WhatsAppMcpServer, createJsonResult } from "wappmcp";',
      'export { Client } from "@modelcontextprotocol/sdk/client/index.js";',
      'export { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";',
      'export { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";',
    ].join('\n'));
    const { WhatsAppMcpServer, createJsonResult, Client, InMemoryTransport, CallToolResultSchema } = await import(pathToFileURL(entry).href);
    const chatId = 'synthetic-family@g.us', notificationChat = 'synthetic-notification-only@g.us';
    const recent = 'whatsapp_get_chat_messages', search = 'whatsapp_search_messages';
    const messages = [
      { id: 'synthetic-73', chat: { id: chatId }, body: 'Synthetic lunch', timestamp: '2026-09-16T05:03:00.000Z', extra: 'discard me' },
      { id: 'synthetic-19', chat: { id: chatId }, body: 'Synthetic dinner', timestamp: '2026-09-15T12:41:00.000Z' },
    ];
    const searchValue = { messages, meta: { q: 'Synthetic meal', chat: { id: chatId }, page: 3, limit: 17 } };
    const calls = [], unexpected = [], wire = [];
    const session = new Proxy({
      async getChatMessages(...args) { calls.push(['recent', ...args]); return structuredClone(messages); },
      async searchMessages(...args) { calls.push(['search', ...args]); return structuredClone(searchValue); },
    }, { get(target, key) {
      if (Object.hasOwn(target, key)) return target[key];
      unexpected.push(String(key));
      throw Error(`Unexpected synthetic session access: ${String(key)}`);
    } });
    // The notification allowlist intentionally excludes the host-authorized chat.
    const server = WhatsAppMcpServer.create(session, false, [notificationChat]);
    client = new Client({ name: 'hehebot-public-server-fixture', version: '1.0.0' });
    [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const send = serverTransport.send.bind(serverTransport);
    serverTransport.send = async (...args) => {
      wire.push(structuredClone(args[0]));
      return send(...args); // Observe only; never repair or bypass SDK validation.
    };
    let clientClosed = 0;
    client.onclose = () => { clientClosed++; };
    await bounded(server.start(serverTransport));
    await bounded(client.connect(clientTransport));
    assert.deepEqual(client.getServerVersion(), { name: 'wappmcp', version: '0.4.0' });
    assert.equal(client.getServerCapabilities().experimental, undefined);
    await assert.rejects(server.subscribe(), /Channels are not enabled/);
    const listed = await bounded(client.listTools());
    assert.equal(listed.nextCursor, undefined);
    assert.deepEqual(listed.tools.map(tool => tool.name).sort(), catalog);
    const schemas = Object.fromEntries(listed.tools.map(tool => [tool.name, tool.inputSchema]));
    assert.deepEqual(schemas[recent].required, ['chatId']);
    assert.deepEqual(schemas[search].required, ['query']); // Upstream allows global; host does not.
    assert.deepEqual(Object.keys(schemas[recent].properties).sort(), ['chatId', 'limit']);
    assert.deepEqual(Object.keys(schemas[search].properties).sort(), ['chatId', 'limit', 'page', 'query']);
    assert.equal(schemas[recent].properties.limit.maximum, 100);
    const call = (name, args) => bounded(client.callTool({ name, arguments: args }, CallToolResultSchema, { timeout: 3000 }));

    // Real schemas reject before entering either synthetic read method.
    const invalid = [
      [recent, {}], [recent, { chatId: 9 }],
      ...[0, 101, 1.5].map(limit => [recent, { chatId, limit }]),
      [search, { chatId }], [search, { query: 'Synthetic meal', page: 0 }],
      [search, { query: 'Synthetic meal', limit: 1.5 }],
    ];
    for (const [name, args] of invalid) assert.equal((await call(name, args)).isError, true);
    assert.deepEqual(calls, []);
    const rawSearch = await call(search, { chatId, query: 'Synthetic meal', page: 3, limit: 17 });
    assert.deepEqual(rawSearch, { content: [{ type: 'text', text: JSON.stringify(searchValue, null, 2) }], structuredContent: searchValue });
    assert.deepEqual(calls.pop(), ['search', 'Synthetic meal', chatId, 3, 17]);

    // The SDK rejects the handler's array result before sending a success response.
    // Separately check the public helper's exact result, without bypassing that gate.
    const recentValue = createJsonResult(messages);
    assert.deepEqual(recentValue, { content: [{ type: 'text', text: JSON.stringify(messages, null, 2) }], structuredContent: messages });
    const checked = CallToolResultSchema.safeParse(recentValue);
    assert.equal(checked.success, false);
    assert.ok(checked.error.issues.some(issue => issue.path[0] === 'structuredContent'));
    for (const args of [{ chatId, limit: 17 }, { chatId, limit: 100 }, { chatId }]) {
      await assert.rejects(call(recent, args), error => /structuredContent/.test(error.message));
      assert.deepEqual(calls.pop(), ['recent', chatId, args.limit]);
      assert.equal(wire.at(-1).result, undefined);
      assert.match(wire.at(-1).error.message, /structuredContent/);
    }

    const grant = { chatIds: [chatId], tools: [recent, search] };
    let dispatches = 0, authorizations = 0;
    const dispatch = (name, args, { signal }) => {
      dispatches++;
      return client.callTool({ name, arguments: args }, CallToolResultSchema, { signal, timeout: 3000 });
    };
    const options = { timeoutMs: 4000, authorize: () => { authorizations++; return true; } };
    const read = (name, args, authority = grant) => bounded(readWappMcp(authority, name, args, dispatch, options));
    assert.deepEqual(await read(search, { chatId, query: 'Synthetic meal', page: 3, limit: 17 }), {
      chatId, messages: messages.map(({ id, body, timestamp }) => ({ id, body, timestamp })),
      coverage: 'unknown', query: 'Synthetic meal', page: 3,
    });
    assert.deepEqual(calls.pop(), ['search', 'Synthetic meal', chatId, 3, 17]);
    await assert.rejects(read(recent, { chatId }), { code: 'WHATSAPP_READ_FAILED' });
    assert.deepEqual(calls.pop(), ['recent', chatId, 50]);
    assert.equal(dispatches, 2);
    const beforeDenials = authorizations;
    const denied = [
      ...catalog.filter(name => !grant.tools.includes(name)).map(name => [name, { chatId }]),
      [recent, { chatId: notificationChat }],
      [search, { chatId: notificationChat, query: 'Synthetic meal' }],
      [search, { query: 'Synthetic meal' }],
      [search, { chatId, query: 'Synthetic meal', page: 101 }],
      [search, { chatId, query: 'Synthetic meal', limit: 101 }],
    ];
    for (const [name, args] of denied) await assert.rejects(read(name, args), { code: 'WHATSAPP_READ_DENIED' });
    // Even a valid read has no authority from the server's notification allowlist.
    await assert.rejects(read(search, { chatId: notificationChat, query: 'Synthetic meal' },
      { chatIds: [], tools: [] }), { code: 'WHATSAPP_READ_DENIED' });
    assert.equal(dispatches, 2); assert.equal(authorizations, beforeDenials);
    assert.deepEqual(calls, []); assert.deepEqual(unexpected, []);

    await bounded(client.close());
    assert.ok(clientClosed > 0); // Linked transport callbacks need not be exactly once.
    await assert.rejects(call(search, { chatId, query: 'Synthetic meal' }), /not connected/i);
    assert.deepEqual(calls, []); assert.deepEqual(unexpected, []);
    return { status: 'passed', pluginVersion: '0.4.0', sdkVersion: '1.30.0', transport: 'in-memory',
      catalog, hostPermittedTools: grant.tools, schemaRejections: invalid.length, hostDenials: denied.length + 1,
      exactSearchResult: true, exactReadRouting: true, recentArrayCompatible: false,
      channelsEnabled: false, channelSubscriptionStarted: false, permissionRelayInvoked: false,
      notificationAllowlistIsAuthority: false, clientClosed: true, postCloseReadRejected: true,
      hashes, sessionConstructed: false, livePairing: false, sessionSettlementVerified: false,
      browserSettlementVerified: false, productionAdmission: false, e09Complete: false };
  } finally {
    try {
      if (client) await bounded(client.close());
    } finally {
      try { if (serverTransport) await bounded(serverTransport.close()); }
      finally { await rm(bridge, { recursive: true, force: true }); }
    }
  }
}
