// Linux-only, bounded synthetic process fixture. Never starts WhatsApp/Chrome.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { FileJournal } from '../runtime/file-journal.mjs';
import { readJournaledWappMcp } from '../runtime/wappmcp-operations.mjs';

const script = fileURLToPath(import.meta.url);
async function processIdentity(pid) {
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
    return { pid, start: fields[19], state: fields[0] };
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
const active = (current, original) => current?.start === original.start && !['Z', 'X'].includes(current.state);
async function until(check) {
  const end = Date.now() + 6000;
  do { const result = await check(); if (result) return result; await delay(20); } while (Date.now() < end);
  throw Error('STDIO_FIXTURE_TIMEOUT');
}
async function bounded(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('STDIO_FIXTURE_TIMEOUT')), 6000); })]); }
  finally { clearTimeout(timer); }
}
async function heartbeat(directory) {
  try { return JSON.parse(await readFile(join(directory, 'heartbeat.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

if (process.argv[1] === script && process.argv[2] === '--descendant') {
  const directory = process.argv[3], identity = await processIdentity(process.pid);
  const end = Date.now() + 15000; let sequence = 0;
  while (Date.now() < end) {
    try {
      try { await readFile(join(directory, 'stop')); break; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await writeFile(join(directory, 'heartbeat.tmp'), JSON.stringify({ ...identity, sequence: ++sequence }), { mode: 0o600 });
      await rename(join(directory, 'heartbeat.tmp'), join(directory, 'heartbeat.json'));
    } catch { break; } // Removed fixture directory also ends this bounded helper.
    await delay(20);
  }
} else if (process.argv[1] === script && process.argv[2] === '--server') {
  const [installation, directory] = process.argv.slice(3), require = createRequire(join(installation, 'package.json'));
  const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
  const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
  const { z } = require('zod');
  // An independent backstop bounds failed-fixture cleanup, not production behavior.
  setTimeout(() => process.exit(1), 15000);
  const server = new McpServer({ name: 'hehebot-synthetic-stdio', version: '1.0.0' });
  server.registerTool('whatsapp_search_messages', { inputSchema: z.object({ chatId: z.string(), query: z.string(), page: z.number(), limit: z.number() }) }, async () => {
    const child = spawn(process.execPath, [script, '--descendant', directory], { stdio: 'ignore', env: { HOME: directory } });
    child.on('error', () => process.exit(1));
    // Deliberately keep work pending after cancellation and stdin closure.
    return new Promise(() => {});
  });
  await server.connect(new StdioServerTransport());
}

export async function verifyWappMcpStdio(installation) {
  assert.equal(process.platform, 'linux', 'This process-identity fixture requires Linux /proc');
  const require = createRequire(join(installation, 'package.json'));
  assert.equal(JSON.parse(await readFile(join(installation, 'node_modules/@modelcontextprotocol/sdk/package.json'))).version, '1.30.0');
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
  const { CallToolResultSchema } = require('@modelcontextprotocol/sdk/types.js');
  const directory = await mkdtemp(join(tmpdir(), 'hehebot-stdio-tree-'));
  const client = new Client({ name: 'hehebot-synthetic-stdio-client', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [script, '--server', installation, directory],
    cwd: directory, env: { HOME: directory }, stderr: 'pipe' });
  transport.stderr.resume(); // No diagnostics or upstream payloads are persisted.
  let parent, descendant, report;
  try {
    await bounded(client.connect(transport));
    parent = await processIdentity(transport.pid); assert.ok(parent);
    const journal = new FileJournal(join(directory, 'journal')), attemptId = 'stdio-attempt';
    await journal.putIfAbsent(attemptId, { attemptId, status: 'running', rootSettled: false });
    const name = 'whatsapp_search_messages', chatId = 'synthetic@g.us'; let dispatches = 0;
    const run = () => readJournaledWappMcp({ journal, attemptId, operationId: 'held-read' }, { chatIds: [chatId], tools: [name] }, name,
      { chatId, query: 'synthetic' }, (tool, args, { signal }) => {
        dispatches++; return client.callTool({ name: tool, arguments: args }, CallToolResultSchema, { signal, timeout: 10000 });
      }, { deadlineAt: new Date(Date.now() + 20000).toISOString(), authorize: () => true });
    const pending = run(), rejected = assert.rejects(pending, { code: 'WHATSAPP_READ_FAILED' });
    descendant = await until(() => heartbeat(directory));
    assert.ok(active(await processIdentity(descendant.pid), descendant));
    await bounded(client.close()); await bounded(rejected);
    assert.equal(transport.pid, null); // This getter alone is not termination evidence.
    await until(async () => !active(await processIdentity(parent.pid), parent));
    const before = await heartbeat(directory);
    const after = await until(async () => { const row = await heartbeat(directory); return row?.sequence > before.sequence && row; });
    assert.equal(after.pid, descendant.pid); assert.equal(after.start, descendant.start);
    assert.ok(active(await processIdentity(descendant.pid), descendant));
    assert.equal((await new FileJournal(journal.directory).get(attemptId)).whatsappReads['held-read'].status, 'intent');
    await assert.rejects(run(), { code: 'WHATSAPP_READ_FAILED' }); assert.equal(dispatches, 1);
    report = { sdkVersion: '1.30.0', transport: 'stdio', directProcessStopped: true,
      descendantProgressAfterClose: true, unknownIntentRetained: true, replayPrevented: true,
      browserTerminationVerified: false, livePairing: false };
  } finally {
    await writeFile(join(directory, 'stop'), '', { mode: 0o600 });
    await bounded(client.close());
    if (parent) await until(async () => !active(await processIdentity(parent.pid), parent));
    if (descendant) await until(async () => !active(await processIdentity(descendant.pid), descendant));
    await rm(directory, { recursive: true, force: true });
  }
  return { ...report, syntheticProcessesStopped: true };
}
