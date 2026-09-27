import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { after, test } from 'node:test';
import { WebSocketServer } from 'ws';
import { decodeAttributedBody, openMessagesDb, searchMessages } from '../mac-node/messages.mjs';
import { IMPLEMENTED_CAPABILITIES, NodeAgent, createHandlers, loadConfig, pair } from '../mac-node/mac-node.mjs';

// ARCHITECTURE_V2 A9 node agent. Everything runs against a synthetic chat.db
// fixture and a loopback WebSocket server: no real Messages data, no network.
const dir = mkdtempSync(join(tmpdir(), 'hehebot-mac-node-'));
// Every agent/server is torn down even when an assertion fails, so a failing
// test cannot keep the event loop (and the test run) alive.
const agents = [], servers = [];
after(async () => { for (const agent of agents) agent.stop(); for (const close of servers) await close(); rmSync(dir, { recursive: true, force: true }); });
const track = agent => (agents.push(agent), agent);
const APPLE = 978307200;
const ns = iso => (Date.parse(iso) / 1000 - APPLE) * 1e9;
/** Mimics the NSArchiver "streamtyped" NSAttributedString layout. */
function attributedBody(text) {
  const utf8 = Buffer.from(text, 'utf8');
  const length = utf8.length < 0x80 ? Buffer.from([utf8.length]) : Buffer.concat([Buffer.from([0x81]), Buffer.from([utf8.length & 0xff, utf8.length >> 8])]);
  return Buffer.concat([Buffer.from('040b73747265616d747970656481e803840140848484124e5341747472696275746564537472696e67008484084e534f626a6563740085928484', 'hex'),
    Buffer.from('84084e53537472696e6701', 'hex').subarray(0), Buffer.from([0x94, 0x84, 0x01, 0x2b]), length, utf8, Buffer.from('8684026949010f928484840c4e5344696374696f6e617279', 'hex')]);
}
function fixtureDb(path) {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE handle (ROWID INTEGER PRIMARY KEY AUTOINCREMENT UNIQUE, id TEXT NOT NULL, country TEXT, service TEXT NOT NULL, uncanonicalized_id TEXT, person_centric_id TEXT, UNIQUE (id, service));
    CREATE TABLE message (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, guid TEXT UNIQUE NOT NULL, text TEXT, handle_id INTEGER DEFAULT 0, subject TEXT,
      attributedBody BLOB, service TEXT, date INTEGER, date_read INTEGER, is_from_me INTEGER DEFAULT 0, cache_has_attachments INTEGER DEFAULT 0);
    CREATE TABLE chat (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, guid TEXT UNIQUE NOT NULL, style INTEGER, chat_identifier TEXT, service_name TEXT, display_name TEXT);
    CREATE TABLE chat_message_join (chat_id INTEGER REFERENCES chat (ROWID) ON DELETE CASCADE, message_id INTEGER REFERENCES message (ROWID) ON DELETE CASCADE, message_date INTEGER DEFAULT 0, PRIMARY KEY (chat_id, message_id));
    CREATE TABLE attachment (ROWID INTEGER PRIMARY KEY AUTOINCREMENT, guid TEXT UNIQUE NOT NULL, filename TEXT);`);
  db.prepare("INSERT INTO handle(id,service) VALUES('+15550001111','SMS'),('clinic@example.test','iMessage')").run();
  db.prepare("INSERT INTO chat(guid,chat_identifier,service_name,display_name) VALUES('c1','+15550001111','SMS',''),('c2','clinic@example.test','iMessage','Clinic')").run();
  const add = db.prepare('INSERT INTO message(guid,text,handle_id,attributedBody,service,date,is_from_me,cache_has_attachments) VALUES(?,?,?,?,?,?,?,?)');
  const join = db.prepare('INSERT INTO chat_message_join(chat_id,message_id,message_date) VALUES(?,?,?)');
  const rows = [
    ['g1', 'Your dentist appointment is Tue 3 Oct 10:00', 1, null, 'SMS', ns('2026-09-27T02:00:00Z'), 0, 0, 1],
    ['g2', null, 2, attributedBody('Reminder: clinic appointment Thursday 14:30. Reply C to confirm.'), 'iMessage', ns('2026-09-27T05:00:00Z'), 0, 1, 2],
    ['g3', 'ok thanks', 1, null, 'SMS', ns('2026-09-27T06:00:00Z'), 1, 0, 1],
    ['g4', 'Old appointment from last month', 1, null, 'SMS', ns('2026-08-01T00:00:00Z'), 0, 0, 1],
    ['g5', null, 2, attributedBody(`Long appointment note ${'x'.repeat(300)}`), 'iMessage', ns('2026-09-26T00:00:00Z'), 0, 0, 2],
    ['g6', null, 2, Buffer.from('garbage without the marker'), 'iMessage', ns('2026-09-26T01:00:00Z'), 0, 0, 2],
  ];
  for (const [guid, text, handle, body, service, date, fromMe, attach, chat] of rows) {
    const { lastInsertRowid } = add.run(guid, text, handle, body, service, date, fromMe, attach);
    join.run(chat, lastInsertRowid, date);
  }
  db.close();
}
const chatDb = join(dir, 'chat.db');
fixtureDb(chatDb);
const NOW = Date.parse('2026-09-28T00:00:00Z');
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');

test('decodes attributedBody (short and 0x81 long lengths) and refuses unknown layouts', () => {
  assert.equal(decodeAttributedBody(attributedBody('hello')), 'hello');
  assert.equal(decodeAttributedBody(attributedBody('y'.repeat(300))), 'y'.repeat(300));
  assert.equal(decodeAttributedBody(Buffer.from('no marker here, just bytes')), null);
  const truncated = attributedBody('z'.repeat(300)).subarray(0, 120);
  assert.equal(decodeAttributedBody(truncated), null);
});

test('messages.search filters by text (including attributedBody-only rows), sender and date, newest first, bounded', () => {
  const byText = searchMessages({ query: 'APPOINTMENT' }, { path: chatDb, now: NOW });
  assert.deepEqual(byText.messages.map(m => m.id), ['g2', 'g1', 'g5']);
  assert.equal(byText.messages[0].text, 'Reminder: clinic appointment Thursday 14:30. Reply C to confirm.');
  assert.equal(byText.messages[0].chat, 'Clinic');
  assert.equal(byText.messages[0].has_attachments, true);
  assert.equal(byText.messages[0].from, 'clinic@example.test');
  assert.ok(!('filename' in byText.messages[0]) && !('attachments' in byText.messages[0]));
  assert.deepEqual(searchMessages({ sender: '5550001111' }, { path: chatDb, now: NOW }).messages.map(m => [m.id, m.from]), [['g3', 'me'], ['g1', '+15550001111']]);
  assert.deepEqual(searchMessages({ query: 'appointment', since: '2026-07-01T00:00:00Z', until: '2026-08-15T00:00:00Z' }, { path: chatDb, now: NOW }).messages.map(m => m.id), ['g4']);
  assert.equal(searchMessages({ limit: 2 }, { path: chatDb, now: NOW }).messages.length, 2);
  const undecodable = searchMessages({}, { path: chatDb, now: NOW }).messages.find(m => m.id === 'g6');
  assert.deepEqual([undecodable.text, undecodable.text_unavailable], [null, true]);
  assert.throws(() => searchMessages({ limit: 500 }, { path: chatDb, now: NOW }), /limit/);
  assert.throws(() => searchMessages({ path: '/etc/passwd' }, { path: chatDb, now: NOW }), /Unsupported/);
});

test('the Messages database is opened read-only and is never modified', () => {
  const before = digest(chatDb);
  const db = openMessagesDb(chatDb);
  assert.throws(() => db.exec("INSERT INTO handle(id,service) VALUES('x','SMS')"), /readonly|read-only|query_only|attempt to write/i);
  db.close();
  searchMessages({ query: 'appointment' }, { path: chatDb, now: NOW });
  assert.equal(digest(chatDb), before);
  assert.throws(() => openMessagesDb(join(dir, 'missing.db')), error => error.code === 'MESSAGES_UNAVAILABLE' && /Full Disk Access/.test(error.message));
});

/** Loopback node-stream fake: records frames and lets tests drive the session. */
async function fakeWorker() {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise(resolve => server.once('listening', resolve));
  const state = { connections: [], frames: [], headers: [] };
  server.on('connection', (ws, request) => {
    state.connections.push(ws); state.headers.push(request.headers);
    ws.on('message', data => { const frame = JSON.parse(String(data)); state.frames.push(frame); state.onFrame?.(frame, ws); });
    ws.send(JSON.stringify({ type: 'welcome', node_id: 'node-1' }));
  });
  let closed = false;
  const close = () => closed ? Promise.resolve() : (closed = true, new Promise(resolve => { for (const c of server.clients) c.terminate(); server.close(() => resolve()); }));
  servers.push(close);
  return { state, origin: `http://127.0.0.1:${server.address().port}/`, close };
}
const until = async (predicate, ms = 3000) => {
  const end = Date.now() + ms;
  while (!predicate()) { if (Date.now() > end) throw new Error('timed out'); await new Promise(r => setTimeout(r, 10)); }
};
const TOKEN = 'n'.repeat(43);

test('agent authenticates, advertises capabilities, executes only allowlisted capabilities and dedupes redelivery', async () => {
  const worker = await fakeWorker();
  let searches = 0;
  const agent = track(new NodeAgent({ origin: worker.origin, token: TOKEN, access: { clientId: 'cid.access', clientSecret: 'secret' }, allowInsecureLoopback: true,
    capabilities: ['ping', 'messages.search'], heartbeatMs: 60000,
    handlers: { ...createHandlers({ messagesDb: chatDb, now: () => NOW }), 'messages.search': async args => { searches++; return searchMessages(args, { path: chatDb, now: NOW }); } } }));
  const done = agent.start();
  await until(() => worker.state.frames.some(f => f.type === 'hello'));
  assert.equal(worker.state.headers[0].authorization, `Bearer ${TOKEN}`);
  assert.equal(worker.state.headers[0]['cf-access-client-id'], 'cid.access');
  assert.equal(worker.state.headers[0]['cf-access-client-secret'], 'secret');
  assert.deepEqual(worker.state.frames.find(f => f.type === 'hello').capabilities, ['ping', 'messages.search']);
  const ws = worker.state.connections[0];
  ws.send(JSON.stringify({ type: 'request', id: 'r1', capability: 'messages.search', args: { query: 'clinic' } }));
  ws.send(JSON.stringify({ type: 'request', id: 'r2', capability: 'shell.exec', args: { command: 'rm -rf /' } }));
  ws.send(JSON.stringify({ type: 'request', id: 'r3', capability: 'ping', args: {} }));
  await until(() => worker.state.frames.filter(f => f.type === 'result').length === 3);
  const results = Object.fromEntries(worker.state.frames.filter(f => f.type === 'result').map(f => [f.id, f]));
  assert.equal(results.r1.ok, true, JSON.stringify(results.r1));
  assert.deepEqual(results.r1.result.messages.map(m => m.id), ['g2']);
  assert.deepEqual([results.r2.ok, results.r2.error.code], [false, 'CAPABILITY_NOT_ALLOWED']);
  assert.equal(results.r3.result.pong, true);
  ws.send(JSON.stringify({ type: 'request', id: 'r1', capability: 'messages.search', args: { query: 'clinic' } }));
  await until(() => worker.state.frames.filter(f => f.type === 'result').length === 4);
  assert.equal(searches, 1, 'a redelivered request replays the cached result instead of re-running');
  agent.stop();
  assert.equal(await done, 'stopped');
  await worker.close();
});

test('configuration can narrow but never widen the capability allowlist', async () => {
  assert.throws(() => new NodeAgent({ origin: 'https://portal.example', token: TOKEN, capabilities: ['shell.exec'], handlers: { 'shell.exec': async () => ({}) } }), /INVALID_CAPABILITIES/);
  assert.throws(() => new NodeAgent({ origin: 'http://portal.example', token: TOKEN, handlers: createHandlers() }), /INVALID_ORIGIN/);
  const worker = await fakeWorker();
  const agent = track(new NodeAgent({ origin: worker.origin, token: TOKEN, allowInsecureLoopback: true, capabilities: ['ping'], handlers: createHandlers({ messagesDb: chatDb }) }));
  const done = agent.start();
  await until(() => worker.state.frames.some(f => f.type === 'hello'));
  worker.state.connections[0].send(JSON.stringify({ type: 'request', id: 'm1', capability: 'messages.search', args: {} }));
  await until(() => worker.state.frames.some(f => f.type === 'result'));
  assert.equal(worker.state.frames.find(f => f.type === 'result').error.code, 'CAPABILITY_NOT_ALLOWED');
  agent.stop(); await done; await worker.close();
  assert.deepEqual(IMPLEMENTED_CAPABILITIES, ['ping', 'messages.search']);
});

test('reconnects with backoff after a dropped connection and stops on revoke', async () => {
  const worker = await fakeWorker();
  const agent = track(new NodeAgent({ origin: worker.origin, token: TOKEN, allowInsecureLoopback: true, capabilities: ['ping'], handlers: createHandlers(),
    backoff: { baseMs: 20, maxMs: 50 }, random: () => 1 }));
  const done = agent.start();
  await until(() => worker.state.frames.filter(f => f.type === 'hello').length === 1);
  worker.state.connections[0].terminate();
  await until(() => worker.state.frames.filter(f => f.type === 'hello').length === 2);
  assert.equal(worker.state.connections.length, 2);
  worker.state.connections[1].send(JSON.stringify({ type: 'revoked' }));
  assert.equal(await done, 'revoked');
  await new Promise(r => setTimeout(r, 120));
  assert.equal(worker.state.connections.length, 2, 'a revoked node does not reconnect');
  await worker.close();
});

test('heartbeat detects a silent connection and reconnects', async () => {
  const worker = await fakeWorker();
  worker.state.onFrame = () => {}; // never acknowledges heartbeats
  const agent = track(new NodeAgent({ origin: worker.origin, token: TOKEN, allowInsecureLoopback: true, capabilities: ['ping'], handlers: createHandlers(),
    heartbeatMs: 40, backoff: { baseMs: 10, maxMs: 20 } }));
  const done = agent.start();
  await until(() => worker.state.frames.filter(f => f.type === 'hello').length >= 2, 4000);
  assert.ok(worker.state.frames.some(f => f.type === 'heartbeat'));
  agent.stop(); await done; await worker.close();
});

test('pair exchanges the one-time code and stores the token and config with mode 600', async () => {
  const configPath = join(dir, 'pair', 'config.json');
  const calls = [];
  const result = await pair({ origin: 'https://portal.example', code: 'ABCD-EFGH-JKLM', name: 'Test Mac', configPath,
    access: { clientId: 'cid', clientSecret: 'sec' }, accessFiles: { accessClientIdFile: '/x/id', accessClientSecretFile: '/x/secret' },
    fetchImpl: async (url, init) => { calls.push([url, init]); return new Response(JSON.stringify({ node_id: 'n1', token: TOKEN }), { headers: { 'Content-Type': 'application/json' } }); } });
  assert.equal(calls[0][0], 'https://portal.example/node/exchange');
  assert.equal(calls[0][1].headers['CF-Access-Client-Id'], 'cid');
  assert.deepEqual(JSON.parse(calls[0][1].body), { code: 'ABCD-EFGH-JKLM', name: 'Test Mac' });
  assert.equal(readFileSync(result.tokenFile, 'utf8').trim(), TOKEN);
  assert.equal(statSync(result.tokenFile).mode & 0o777, 0o600);
  assert.equal(statSync(configPath).mode & 0o777, 0o600);
  const config = await loadConfig(configPath);
  assert.deepEqual([config.origin, config.accessClientIdFile], ['https://portal.example', '/x/id']);
  chmodSync(configPath, 0o644);
  await assert.rejects(loadConfig(configPath), /SECRET_FILE_PERMISSIONS/);
  await assert.rejects(pair({ origin: 'https://portal.example', code: 'bad', configPath: join(dir, 'p2', 'c.json'), fetchImpl: async () => new Response('{}', { status: 401 }) }), /PAIRING_FAILED 401/);
});

test('launchd template renders to a valid plist without loading it', { skip: process.platform !== 'darwin' }, () => {
  const prefix = join(dir, 'home');
  const output = execFileSync('bash', [fileURLToPath(new URL('../mac-node/install-launchd.sh', import.meta.url)), '--prefix', prefix], { encoding: 'utf8', timeout: 20000 });
  assert.match(output, /launchctl bootstrap/);
  const plist = readFileSync(join(prefix, 'Library/LaunchAgents/com.hehebot.mac-node.plist'), 'utf8');
  assert.doesNotMatch(plist, /@[A-Z]+@/);
  assert.match(plist, /Hehebot Node\/bin\/node/);
  execFileSync('plutil', ['-lint', join(prefix, 'Library/LaunchAgents/com.hehebot.mac-node.plist')], { timeout: 10000 });
});
writeFileSync(join(dir, '.keep'), '');
