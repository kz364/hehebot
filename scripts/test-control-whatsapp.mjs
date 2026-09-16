#!/usr/bin/env node
// Disposable HTTPS Worker + real scoped-read boundary; no WhatsApp/MCP process.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent } from 'undici';
import { ControlClient } from '../runtime/control-client.mjs';
import { readWappMcp } from '../runtime/wappmcp-reads.mjs';

const directory = await mkdtemp(join(tmpdir(), 'hehe-whatsapp-http-'));
const wait = async fn => { const end = Date.now() + 45000; while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 50)); } throw Error('FIXTURE_TIMEOUT'); };
let worker, dispatcher, origin;
try {
 const reserve = createServer(); await new Promise(r => reserve.listen(0, '127.0.0.1', r));
 const port = reserve.address().port; await new Promise(r => reserve.close(r)); origin = `https://127.0.0.1:${port}`;
 const token = randomBytes(32).toString('hex'), policy = randomUUID(), tool = 'whatsapp_get_chat_messages';
 const grant = { chatIds: ['synthetic-family@g.us'], tools: [tool] };
 const cert = join(directory, 'cert.pem'), key = join(directory, 'key.pem');
 await promisify(execFile)('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1',
  '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', key, '-out', cert]);
 worker = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--env', 'local', '--ip', '127.0.0.1',
  '--port', String(port), '--inspector-port', '0', '--persist-to', join(directory, 'worker'), '--local-protocol', 'https', '--https-key-path', key, '--https-cert-path', cert,
  '--var', 'EXECUTION_ENABLED:true', '--var', 'NATIVE_VERIFIED:true', '--var', `RUNTIME_TOKEN:${token}`,
  '--var', `TOOL_POLICY_IDS:${JSON.stringify([policy])}`, '--var', `HEHEBOT_WHATSAPP_READ_POLICIES:${JSON.stringify({ [policy]: grant })}`,
  '--var', `PROVIDER_CONFIG:${JSON.stringify({ provider: 'fake', ref: { provider: 'fake', id: 'whatsapp-fixture' } })}`],
  { env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: join(directory, 'logs') }, stdio: ['ignore', 'pipe', 'pipe'] });
 let ready = false; worker.stdout.on('data', chunk => { if (chunk.toString().includes(`Ready on ${origin}`)) ready = true; }); worker.stderr.resume();
 await wait(() => { assert.equal(worker.exitCode, null); return ready; });
 dispatcher = new Agent({ connect: { ca: await readFile(cert) } });
 const trustedFetch = (url, init) => fetch(url, { ...init, dispatcher });
 const control = new ControlClient({ origin, token, fetchImpl: trustedFetch });
 const state = async () => { const res = await trustedFetch(origin + '/v1/state'); assert.equal(res.status, 200); return res.json(); };
 const owner = async (type, payload) => {
  const res = await trustedFetch(origin + '/v1/commands', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'Idempotency-Key': randomUUID() },
   body: JSON.stringify({ schema_version: 1, type, payload }) });
  assert.equal(res.status, 202); const receipt = await res.json(); assert.equal(receipt.status, 'applied'); return receipt;
 };
 const persona = (await state()).objects.find(o => o.kind === 'persona');
 await owner('persona.put', { ...persona.body, id: persona.id, expected_revision: persona.revision, tool_policy_ids: [policy] });
 const receipt = await owner('message.send', { conversation_id: persona.id, text: 'Synthetic selected-chat read.' });
 await wait(async () => (await control.request('status', {})).phase === 'BOOTING');
 const identity = await control.request('boot', { boot_id: randomUUID() }); await control.request('ready', { identity });
 const claim = await control.request('claim', { identity }); assert.equal(claim.run.id, receipt.resource_id);
 const custody = { identity, run_id: claim.run.id, attempt: claim.run.current_attempt };
 await control.request('submitted', { ...custody, native_ref: 'synthetic-whatsapp-turn' });
 const input = { ...custody, name: tool, chatId: grant.chatIds[0] }, before = await state();
 assert.deepEqual(await control.request('whatsapp-read-authorize', input), { allowed: true, deadline_at: claim.deadline_at });
 for (const change of [{ chatId: 'foreign@g.us' }, { attempt: 2 }, { name: 'whatsapp_send_message' }, { grant }, { identity: { ...identity, epoch: identity.epoch + 1 } }])
  await assert.rejects(control.request('whatsapp-read-authorize', { ...input, ...change }));
 const foreign = new ControlClient({ origin, token: 'wrong-runtime-token', fetchImpl: trustedFetch });
 await assert.rejects(foreign.request('whatsapp-read-authorize', input), { status: 401 });
 assert.deepEqual((await state()).runs, before.runs); assert.equal((await state()).next_cursor, before.next_cursor);
 const authorize = ({ name, chatId }) => control.request('whatsapp-read-authorize', { ...custody, name, chatId });
 const message = { id: 'synthetic-17', body: 'Untrusted text', timestamp: '2026-09-16T00:00:00.000Z', chat: { id: grant.chatIds[0] } };
 let calls = 0;
 const output = await readWappMcp(grant, tool, { chatId: grant.chatIds[0] }, async () => { calls++; return { structuredContent: [message] }; }, { authorize, deadlineAt: claim.deadline_at });
 assert.equal(output.messages[0].id, 'synthetic-17');
 await assert.rejects(readWappMcp(grant, tool, { chatId: grant.chatIds[0] }, async () => {
  calls++; await owner('run.cancel', { run_id: claim.run.id, reason: 'Cancel during synthetic read' }); return { structuredContent: [message] };
 }, { authorize, deadlineAt: claim.deadline_at }), { code: 'WHATSAPP_READ_DENIED' });
 await assert.rejects(readWappMcp(grant, tool, { chatId: grant.chatIds[0] }, () => assert.fail('Cancelled task dispatched'), { authorize, deadlineAt: claim.deadline_at }), { code: 'WHATSAPP_READ_DENIED' });
 assert.equal(calls, 2); assert.equal((await state()).runs.find(r => r.id === claim.run.id).status, 'cancelling');
 console.log('PASS: HTTPS Worker scoped read authority, exact registry snapshot, wrong token/chat/attempt/epoch/mutation denial, no query writes, bounded read composition and post-read cancellation suppression. Two synthetic reads; no WhatsApp account, browser, MCP or live provider calls.');
} finally {
 if (worker && worker.exitCode === null && worker.signalCode === null) {
  worker.kill('SIGTERM'); await wait(() => worker.exitCode !== null || worker.signalCode !== null);
 }
 if (origin && dispatcher) await assert.rejects(fetch(origin + '/v1/state', { dispatcher, signal: AbortSignal.timeout(1000) }));
 await dispatcher?.close(); await rm(directory, { recursive: true, force: true });
}
