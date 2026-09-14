#!/usr/bin/env node
// Real portal DOM with delayed, synthetic read-only history responses.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';

const alpha = '11111111-1111-4111-8111-111111111111', beta = '22222222-2222-4222-8222-222222222222';
const failureMode = process.argv.includes('--error');
const retentionMode = process.argv.includes('--retention');
const followupMode = process.argv.includes('--followup');
assert.ok(process.argv.slice(2).length <= 1 && process.argv.slice(2).every(arg => ['--error', '--retention', '--followup'].includes(arg)));
const session = `history-${randomUUID().slice(0, 8)}`;
const browser = (...args) => promisify(execFile)('agent-browser', ['--session', session, ...args], { timeout: 30000 });
const message = (conversation_id, sequence, text) => ({ conversation_id, sequence, id: String(sequence),
  type: 'message.user', payload: { text }, created_at: '2026-09-14T01:00:00.000Z' });
const recent = Array.from({ length: 100 }, (_, i) => message(alpha, i + 101, `Alpha recent ${i + 101}`));
const betaEvents = [message(beta, 301, 'Beta retained 71 versus 103')];
if (followupMode) betaEvents.push({...message(beta, 302, 'Expired body must not render'),type:'task.followup_expired'});
const state = { objects: [[alpha, 'Alpha'], [beta, 'Beta']].map(([id, name]) => ({ id, kind: 'persona', revision: 1, body: { name } })),
  timeline: [], runs: [], summary: { phase: 'STOPPED', execution_enabled: false, queued_runs: 0, blocked_runs: 0 } };
let release, historyRequested, mutations = 0, expired = 0;
const requested = new Promise(ok => { historyRequested = ok; });
const server = createServer(async (req, res) => {
  const json = value => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
  try {
    if (req.method !== 'GET') { mutations++; res.writeHead(405); res.end(); return; }
    const url = new URL(req.url, 'http://fixture');
    if (url.pathname === '/v1/state') return json(state);
    if (url.pathname === `/v1/conversations/${alpha}/events`) {
      if (url.searchParams.has('before')) {
        release = () => {
          if (failureMode) { res.writeHead(503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'Alpha history unavailable' } })); }
          else json({ events: [message(alpha, 19, 'Alpha older 19 versus 43')], has_more: false });
        };
        historyRequested(); return;
      }
      return json(expired ? { events: expired === 199 ? recent.slice(-1) : [], has_more: false, history_gap: true, pruned_through: expired } : { events: recent, has_more: true });
    }
    if (url.pathname === `/v1/conversations/${beta}/events`) return json({ events: betaEvents, has_more: false });
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (!['index.html', 'app.js', 'style.css', 'import-setup.js'].includes(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' });
    res.end(await readFile(new URL(`../public/${file}`, import.meta.url)));
  } catch { res.destroy(); }
});
try {
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  await browser('open', `http://127.0.0.1:${server.address().port}`);
  await browser('set', 'viewport', '1280', '720', '2');
  await browser('wait', '--fn', 'document.querySelectorAll(".message-body").length === 100');
  await browser('eval', 'Array.from(document.querySelectorAll("button")).find(b => b.textContent === "Load earlier messages").click()');
  await Promise.race([requested, new Promise((_, reject) => setTimeout(() => reject(Error('HISTORY_NOT_REQUESTED')), 5000).unref())]);
  await browser('eval', 'Array.from(document.querySelectorAll("#bots button")).find(b => b.textContent.endsWith("Beta")).click()');
  await browser('wait', '--fn', 'document.querySelector(".message-body")?.textContent === "Beta retained 71 versus 103"');
  release();
  await browser('wait', '--fn', 'performance.getEntriesByType("resource").some(e => e.name.includes("events?before="))');
  // Drain browser fetch/render callbacks, not an arbitrary sleep or another refresh.
  await browser('eval', 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
  const visible = await browser('eval', 'JSON.stringify({name: document.querySelector("#conversation-name").textContent, messages: Array.from(document.querySelectorAll(".message-body"), e => e.textContent)})');
  assert.match(visible.stdout, /Beta retained 71 versus 103/);
  assert.doesNotMatch(visible.stdout, /Alpha older|Alpha recent/);
  if (followupMode) {
    const notice = (await browser('get', 'text', '#timeline [role="status"]')).stdout;
    assert.match(notice, /Follow-up expired/); assert.match(notice, /90 days without delivery/); assert.match(notice, /Send a fresh follow-up/);
    assert.doesNotMatch((await browser('get', 'text', '#timeline')).stdout, /Expired body must not render/);
    const artifacts = new URL('../.amp/in/artifacts/', import.meta.url); await mkdir(artifacts, {recursive:true});
    await browser('screenshot', new URL('portal-followup-expiry.png', artifacts).pathname);
    await browser('set', 'viewport', '390', '844', '2');
    await browser('eval', 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
    assert.equal((await browser('eval', 'document.documentElement.scrollWidth <= innerWidth')).stdout.trim(), 'true');
    await browser('screenshot', new URL('portal-followup-expiry-narrow.png', artifacts).pathname);
    await browser('set', 'viewport', '1280', '720', '2');
    console.log('PASS: expired followup has a content-free accessible notice with fresh-input guidance; desktop and narrow Chromium captures.');
  }
  const error = await browser('eval', 'document.querySelector("#error").hidden');
  assert.equal(error.stdout.trim(), 'true');
  await browser('eval', 'Array.from(document.querySelectorAll("#bots button")).find(b => b.textContent.endsWith("Alpha")).click()');
  await browser('wait', '--fn', `Array.from(document.querySelectorAll(".message-body")).some(e => e.textContent === ${JSON.stringify(failureMode ? 'Alpha recent 101' : 'Alpha older 19 versus 43')})`);
  const restored = await browser('eval', 'Array.from(document.querySelectorAll(".message-body"), e => e.textContent)');
  assert.doesNotMatch(restored.stdout, /Beta retained/);
  if (followupMode) assert.doesNotMatch((await browser('get', 'text', '#timeline')).stdout, /Follow-up expired/);
  const count = await browser('get', 'count', '.message-body');
  assert.equal(Number(count.stdout.trim()), failureMode ? 100 : 101);
  if (retentionMode) {
    const secondRequested = new Promise(ok => { historyRequested = ok; });
    await browser('eval', 'Array.from(document.querySelectorAll("button")).find(b => b.textContent === "Load earlier messages").click()');
    await Promise.race([secondRequested, new Promise((_, reject) => setTimeout(() => reject(Error('SECOND_HISTORY_NOT_REQUESTED')), 5000).unref())]);
    expired = 199;
    await browser('eval', 'Array.from(document.querySelectorAll("#bots button")).find(b => b.textContent.endsWith("Beta")).click()');
    await browser('wait', '--fn', 'document.querySelector(".message-body")?.textContent === "Beta retained 71 versus 103"');
    await browser('eval', 'Array.from(document.querySelectorAll("#bots button")).find(b => b.textContent.endsWith("Alpha")).click()');
    await browser('wait', '--fn', 'document.querySelectorAll(".message-body").length === 1 && document.querySelector(".message-body").textContent === "Alpha recent 200"');
    release();
    await browser('wait', '--fn', 'performance.getEntriesByType("resource").some(e => e.name.endsWith("events?before=19"))');
    await browser('eval', 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
    assert.equal(Number((await browser('get', 'count', '.message-body')).stdout.trim()), 1);
    assert.match((await browser('get', 'text', '#timeline')).stdout, /Earlier history has expired/);
    const artifacts = new URL('../.amp/in/artifacts/', import.meta.url);
    await mkdir(artifacts, { recursive: true });
    await browser('eval', 'document.querySelector("#timeline").scrollTop = 0');
    await browser('screenshot', new URL('portal-retention.png', artifacts).pathname);
    expired = 200;
    await browser('eval', 'Array.from(document.querySelectorAll("#bots button")).find(b => b.textContent.endsWith("Beta")).click()');
    await browser('wait', '--fn', 'document.querySelector(".message-body")?.textContent === "Beta retained 71 versus 103"');
    await browser('eval', 'Array.from(document.querySelectorAll("#bots button")).find(b => b.textContent.endsWith("Alpha")).click()');
    await browser('wait', '--fn', 'document.querySelector("#conversation-name").textContent === "Alpha" && document.querySelectorAll(".message-body").length === 0 && document.querySelector("#timeline").textContent.includes("Earlier history has expired")');
    await browser('screenshot', new URL('portal-retention-empty.png', artifacts).pathname);
    // A stale latest-history response must not expose an older /state timeline either.
    expired = 0; state.timeline = [message(alpha, 19, 'Stale snapshot canary')];
    await browser('eval', `window.historyRequestCount = performance.getEntriesByType('resource').filter(e => e.name.endsWith('/v1/conversations/${alpha}/events')).length`);
    await browser('eval', 'Array.from(document.querySelectorAll("#bots button")).find(b => b.textContent.endsWith("Alpha")).click()');
    await browser('wait', '--fn', `performance.getEntriesByType('resource').filter(e => e.name.endsWith('/v1/conversations/${alpha}/events')).length > window.historyRequestCount`);
    await browser('eval', 'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
    assert.equal(Number((await browser('get', 'count', '.message-body')).stdout.trim()), 0);
    console.log('PASS: retention clears cached expired messages, rejects a delayed pre-pruning response, and explains partial/empty retained history.');
  }
  assert.equal(mutations, 0);
  console.log(`PASS: delayed Alpha history ${failureMode ? 'failure' : 'success'} preserves selected Beta DOM and returns to Alpha without crossed messages/errors; zero mutations.`);
} finally {
  await browser('close');
  server.closeAllConnections(); await new Promise(ok => server.close(ok));
}
