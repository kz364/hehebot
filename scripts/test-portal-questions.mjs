#!/usr/bin/env node
import assert from 'node:assert/strict';
import {portalFiles,portalFile} from './portal-fixture.mjs';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
const session = `questions-${randomUUID().slice(0, 8)}`, a = randomUUID(), b = randomUUID();
const browser = (...args) => promisify(execFile)('agent-browser', ['--session', session, ...args], { timeout: 30000 });
const evaluate = async text => JSON.parse((await browser('eval', text)).stdout);
const wait = text => browser('wait', '--fn', text);
const click = async selector => {
  await browser('eval', `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
  await browser('click', selector);
};
const make = (persona, state = 'pending') => ({ id: randomUUID(), persona_id: persona, conversation_id: persona,
  run_id: randomUUID(), attempt: 1, revision: 1, state, answerable: state === 'pending',
  created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 900000).toISOString(),
  params: { questions: [{ id: '__proto__', header: 'Region', question: 'Choose <b>West</b> or East. This is literal task text.',
    options: [{ label: 'East', description: 'Eastern region' }, { label: 'West', description: 'Western region' }] },
  { id: 'notes/2', header: 'Notes', question: 'Add optional timing or skip.', isOther: true, options: null }] } });
const first = make(a), hidden = make(b);
const state = { objects: [{ id: a, kind: 'persona', body: { name: 'Alpha' } }, { id: b, kind: 'persona', body: { name: 'Beta' } }],
  runs: [], questions: [first, hidden], summary: { phase: 'READY', execution_enabled: true, queued_runs: 0, blocked_runs: 0 },
  roster: { revision: 1, sections: [], hidden_persona_ids: [b] }, roster_activity: { observed_at: new Date().toISOString(), personas: [] } };
const commands = []; let offline = false;
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://fixture').pathname;
    const json = value => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (path === '/v1/commands') {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const command = JSON.parse(raw); commands.push(command);
      const q = state.questions.find(q => q.id === command.payload.question_id);
      if (command.type === 'question.close') {
        assert.ok(q?.closeable); assert.equal(command.payload.expected_revision, q.revision);
        assert.equal(command.payload.confirm_stopped_closure, true);
        state.questions = state.questions.filter(row => row.id !== q.id);
        return json({ id: randomUUID(), status: 'applied' });
      }
      assert.equal(command.type, 'question.answer');
      assert.ok(q?.answerable); assert.equal(command.payload.expected_revision, q.revision);
      q.state = 'answered'; q.answerable = false; q.revision++; return json({ id: randomUUID(), status: 'applied' });
    }
    assert.equal(req.method, 'GET');
    if (path === '/v1/state') {
      if (offline) { res.writeHead(503); res.end('{}'); return; }
      state.roster_activity.observed_at = new Date().toISOString(); return json(state);
    }
    if (path.endsWith('/tasks')) return json({ counts: { total: 0, waiting: 0, recovery: 0 }, runs: [], next_cursor: null });
    if (path.startsWith('/v1/conversations/')) return json({ events: [], has_more: false, pruned_through: 0 });
    const file = portalFiles[path];
    if (!file) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' });
    res.end(await portalFile(file));
  } catch { res.writeHead(500); res.end(); }
});
await new Promise(ok => server.listen(0, '127.0.0.1', ok));
const artifacts = new URL('../.amp/in/artifacts/', import.meta.url); await mkdir(artifacts, { recursive: true });
const capture = name => browser('screenshot', new URL(`portal-questions-${name}.png`, artifacts).pathname.replace(/%20/g,' '));
const refresh = async () => { await browser('eval', 'document.querySelector("#refresh").click()'); await wait('document.querySelector("#connection").textContent==="Connected"'); };
try {
  await browser('open', `http://127.0.0.1:${server.address().port}/?view=detailed`); await browser('set', 'viewport', '1280', '900', '2');
  await wait('document.querySelector("#connection").textContent==="Connected"');
  assert.equal(await evaluate('document.querySelectorAll(".question-card").length'), 1);
  assert.equal(await evaluate('document.querySelectorAll(".question-card b").length'), 0);
  assert.match(await evaluate('document.querySelector("#hidden-bots-summary").textContent'), /1 question request/);
  assert.equal(commands.length, 0); await capture('desktop');
  await click('.question-card button');
  assert.equal(await evaluate('document.querySelector("[name=written-0]").getBoundingClientRect().height'), 0);
  await browser('select', '[name=question-0]', '1'); await browser('select', '[name=question-1]', 'skip');
  await capture('editor'); await click('#editor-form button[type=submit]'); await wait('!document.querySelector("#editor").open');
  assert.deepEqual(commands[0].payload, { question_id: first.id, expected_revision: 1,
    answers: Object.fromEntries([['__proto__', { answers: ['West'] }], ['notes/2', { answers: [] }]]) });
  await wait('document.querySelector(".question-card").textContent.includes("Answer saved")'); await capture('answered');
  first.state = 'response_unknown'; first.revision++; await refresh();
  await wait('document.querySelector(".question-card").textContent.includes("Do not resend")');
  assert.equal(await evaluate('document.querySelectorAll(".question-card button").length'), 0); await capture('unknown');
  await browser('reload'); await wait('document.querySelector(".question-card")?.textContent.includes("Do not resend")'); assert.equal(commands.length, 1);
  await click('#hidden-bots-summary'); await click(`#hidden-bots-list [data-persona-id="${b}"]`);
  await wait('document.querySelector("#conversation-name").textContent==="Beta"');
  assert.equal(await evaluate('document.querySelector(".question-card").dataset.questionId'), hidden.id);
  await browser('set', 'viewport', '390', '844', '2'); await browser('eval', 'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true); await capture('narrow');
  await click('.question-card button'); await browser('select', '[name=question-0]', '0'); await browser('select', '[name=question-1]', 'text');
  await browser('fill', '[name=written-1]', 'After 19:43, not 04:19.');
  assert.equal(await evaluate('JSON.stringify({...localStorage,...sessionStorage}).includes("After 19:43, not 04:19.")'), false);
  await capture('narrow-editor');
  // Polling changes custody while the editor remains open; no stale command leaves it.
  hidden.answerable = false; hidden.revision++; await refresh();
  await wait('document.querySelector(".question-card").textContent.includes("expired")');
  await click('#editor-form button[type=submit]'); await wait('!document.querySelector("#editor-error").hidden');
  assert.equal(commands.length, 1); assert.equal(await evaluate('document.querySelector("#editor").open'), true); await capture('stale-editor');
  await click('#cancel-editor'); await wait('!document.querySelector("#editor").open');
  assert.equal(await evaluate('document.querySelector(".question-card button").disabled'), true);
  hidden.restart_required_at = new Date().toISOString(); hidden.revision++; await refresh();
  await wait('document.querySelector(".question-card").textContent.includes("Restart required after recovery")');
  assert.match(await evaluate('document.querySelector(".question-card").textContent'), /not confirmed callback or executor termination/);
  assert.equal(await evaluate('document.querySelector(".question-card button").disabled'), true);
  assert.equal(commands.length, 1);
  await browser('set', 'viewport', '390', '1200', '2');
  await browser('eval', 'document.querySelector(".question-card").scrollIntoView({block:"start",behavior:"instant"});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true);
  await capture('restart-required-narrow');
  await browser('set', 'viewport', '1280', '900', '2');
  await browser('eval', 'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  await capture('restart-required-desktop');
  hidden.state = 'answered'; hidden.revision++; await refresh();
  await wait('document.querySelector(".question-card").textContent.includes("delivery window ended before handoff")');
  assert.equal(await evaluate('document.querySelectorAll(".question-card button").length'), 0);
  await capture('restart-required-answered');
  hidden.state = 'pending';
  await browser('set', 'viewport', '390', '844', '2');
  delete hidden.restart_required_at;
  hidden.answerable = true; hidden.revision++; await refresh(); await wait('!document.querySelector(".question-card button").disabled');
  offline = true; await browser('eval', 'document.querySelector("#refresh").click()');
  await wait('document.querySelector(".question-card").textContent.includes("status is stale")');
  assert.equal(await evaluate('document.querySelector(".question-card button").disabled'), true); await capture('offline');
  offline = false; hidden.answerable = false; hidden.closeable = true; hidden.revision++; await refresh();
  await wait('document.querySelector("[data-action=question-close]")?.disabled===false');
  await capture('stopped-narrow');
  await click('[data-action=question-close]');
  assert.match(await evaluate('document.querySelector("#editor").textContent'), /does not record native resolution/);
  await click('#editor-form button[type=submit]'); assert.equal(commands.length, 1);
  await browser('check', '#editor input[type=checkbox]');
  hidden.revision++; await refresh(); await wait(`document.querySelector('.question-card').dataset.questionRevision==='${hidden.revision}'`);
  await click('#editor-form button[type=submit]'); await wait('!document.querySelector("#editor-error").hidden');
  assert.equal(commands.length, 1); await capture('closure-stale-narrow');
  await click('#cancel-editor'); await click('[data-action=question-close]');
  await browser('check', '#editor input[type=checkbox]');
  await browser('set', 'viewport', '1280', '900', '2'); await browser('eval', 'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  await capture('closure-confirm'); await click('#editor-form button[type=submit]');
  await wait('!document.querySelector("#editor").open&&document.querySelectorAll(".question-card").length===0');
  assert.deepEqual(commands[1], { schema_version: 1, type: 'question.close', payload: {
    question_id: hidden.id, expected_revision: hidden.revision, confirm_stopped_closure: true,
  } });
  assert.equal(state.questions[0].id, first.id); assert.equal(state.questions[0].state, 'response_unknown');
  assert.equal(commands.length, 2); assert.equal(await evaluate('document.querySelectorAll(".message.bot").length'), 0);
  console.log('PASS: exact scoped answer/skip, literal text, private drafts, hidden attention, unknown/reload, stale/offline and narrow checks; stopped-question consent and stale revision; unrelated custody preserved; one answer and one explicit closure, no inferred completion.');
} finally { await browser('close').catch(() => {}); await new Promise(ok => server.close(ok)); }
