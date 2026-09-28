#!/usr/bin/env node
// Chromium against an HTTP fixture; no accounts or live skill mutations.
import assert from 'node:assert/strict';
import {portalFiles,portalFile} from './portal-fixture.mjs';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { promisify } from 'node:util';

const session = `skill-draft-${randomUUID().slice(0, 6)}`;
const botId = randomUUID();
const skillId = randomUUID();
const originalBody = {
  name: 'Travel checklist', description: 'Check travel documents.', when_to_use: 'Before travel',
  inputs_access: ['Owner itinerary'], steps: ['Read itinerary'], decision_rules: ['Ask if unclear'],
  validation: ['Check dates'], output: 'Checklist', failure_handling: ['Report missing input'],
  approval_boundaries: ['Never submit forms'], contains_private_facts: false,
};
const originalSkill = { id: skillId, kind: 'skill', revision: 3, body: originalBody };
const state = {
  objects: [{ id: botId, kind: 'persona', body: { name: 'Travel' } }, structuredClone(originalSkill)],
  runs: [], skill_proposals: [], skill_enablements: [],
  summary: { phase: 'STOPPED', execution_enabled: false, queued_runs: 0, blocked_runs: 0 },
};
const requests = [];
const receipts = new Map();
let offline = false;
let loseNext = false;

const browser = (...args) => promisify(execFile)('agent-browser', ['--session', session, ...args], { timeout: 30_000 });
const evaluate = async code => JSON.parse((await browser('eval', code)).stdout);
const wait = code => browser('wait', '--fn', code);
const click = selector => browser('click', selector);
const refresh = () => browser('eval', 'document.querySelector("#refresh").onclick()');
const settle = () => new Promise(resolve => setTimeout(resolve, 300));
const setValue = (name, value) => browser('eval', `(()=>{const e=document.querySelector('#editor [name=${JSON.stringify(name)}]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
// The shared submit button stays disabled until the previous save's refresh settles.
const submit = async () => { await browser('wait', '--fn', '!document.querySelector("#editor-form button[type=submit]").disabled'); await browser('eval', 'document.querySelector("#editor-form button[type=submit]").click()'); };
const affirm = () => browser('check', '#editor [name="affirm"]');
// agent-browser's `press Escape` wedges its daemon (Chromium relaunches) once a refresh has
// re-rendered the editor's opener, so closes use the dialog's own button.
const close = async () => { await browser('click', '#close-editor'); await browser('wait', '--fn', '!document.querySelector("#editor").open'); };

function applyProposal(command) {
  if (state.skill_proposals.some(row => row.id === command.payload.proposal_id)) return;
  state.skill_proposals.push({
    id: command.payload.proposal_id, proposal_revision: 1, status: 'pending',
    ...structuredClone(command.payload),
  });
}

const server = createServer(async (req, res) => {
  const json = (value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
  try {
    const path = new URL(req.url, 'http://fixture').pathname;
    if (req.method === 'POST' && path === '/v1/commands') {
      let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 16_384) throw Error('oversized'); }
      const command = JSON.parse(raw), key = req.headers['idempotency-key'];
      requests.push({ command, key });
      if (receipts.has(key)) {
        assert.equal(raw, receipts.get(key).raw, 'an idempotency key must retain its first exact command');
        return json(receipts.get(key).result);
      }
      assert.equal(command.type, 'skill.propose');
      const result = { status: 'applied', id: randomUUID() };
      receipts.set(key, { raw, result });
      applyProposal(command);
      if (loseNext) { loseNext = false; return json({ error: { message: 'Synthetic response lost; outcome is not confirmed.' } }, 503); }
      return json(result);
    }
    assert.equal(req.method, 'GET');
    if (path === '/v1/state') return offline ? json({ error: { message: 'Synthetic offline state.' } }, 503) : json(state);
    if (path.endsWith('/tasks')) return json({ counts: { total: 0, waiting: 0, recovery: 0 }, runs: [], next_cursor: null });
    if (path.startsWith('/v1/conversations/')) return json({ events: [], has_more: false, pruned_through: 0 });
    const file = portalFiles[path];
    if (!file) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' });
    res.end(await portalFile(file));
  } catch (error) { json({ error: { message: `FIXTURE_REJECTED: ${error.message}` } }, 400); }
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const openDraft = async update => {
  if (update) await browser('eval', `(()=>{const button=[...document.querySelectorAll('.skill-card .actions button')].find(node=>node.textContent==='Propose an update');if(!button)throw Error('update action missing');button.click();})()`);
  else await click('.skills-heading .primary');
  await wait('document.querySelector("#editor").open');
};
const fillRequiredDraft = async prefix => {
  for (const [name, value] of Object.entries({
    name: `${prefix} name`, description: `${prefix} purpose`, when_to_use: `${prefix} use`,
    inputs_access: `${prefix} input`, steps: `${prefix} step`, decision_rules: `${prefix} rule`,
    validation: `${prefix} check`, output: `${prefix} output`, failure_handling: `${prefix} fallback`,
    approval_boundaries: `${prefix} boundary`,
  })) await setValue(name, value);
};
const expectLocalFence = async mutate => {
  await openDraft(true); await affirm(); await mutate(); await refresh();
  const before = requests.length; await submit(); await wait('!document.querySelector("#editor-error").hidden');
  assert.equal(requests.length, before, 'stale/offline draft must not dispatch');
  assert.match((await browser('get', 'text', '#editor-error')).stdout, /stale|changed|offline|deleted|missing/i);
  await close();
};

try {
  await browser('open', `http://127.0.0.1:${server.address().port}/?view=detailed`);
  await browser('set', 'viewport', '1280', '900', '2');
  await wait('document.querySelector("#connection").textContent==="Connected"');
  await click('#show-skills'); await refresh();
  assert.match((await browser('get', 'text', '.subheading')).stdout, /Pending proposals \(0\)/);

  await openDraft(false); await fillRequiredDraft('New');
  await submit();
  assert.equal(requests.length, 0, 'private-facts affirmation is required');
  assert.equal(await evaluate('document.querySelector("#editor-form").checkValidity()'), false);
  await affirm(); loseNext = true; await submit(); await wait('!document.querySelector("#editor-error").hidden');
  await wait('!document.querySelector("#editor-form button[type=submit]").disabled');
  assert.equal(requests.length, 1);
  const createFirst = structuredClone(requests[0]);
  await submit(); await settle();
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1], createFirst, 'new-draft retry must preserve the exact command and key');
  assert.notEqual(createFirst.command.payload.skill_id, 'new');
  assert.match(createFirst.command.payload.skill_id, /^[0-9a-f-]{36}$/);
  assert.match(createFirst.command.payload.proposal_id, /^[0-9a-f-]{36}$/);

  await refresh(); await openDraft(true); await setValue('description', 'Updated purpose'); await affirm();
  loseNext = true; await submit(); await wait('!document.querySelector("#editor-error").hidden');
  await wait('!document.querySelector("#editor-form button[type=submit]").disabled');
  const updateFirst = structuredClone(requests.at(-1)), afterLost = requests.length;
  assert.equal(updateFirst.command.payload.skill_id, skillId);
  assert.equal(updateFirst.command.payload.expected_skill_revision, 3);
  await setValue('description', 'Changed after uncertain response'); await submit(); await settle();
  assert.equal(requests.length, afterLost, 'edited uncertain retry must be rejected locally');
  await setValue('description', 'Updated purpose');
  await setValue('target', 'new'); await submit(); await settle();
  assert.equal(requests.length, afterLost, 'changed target must not turn an uncertain update into a new skill');
  await setValue('target', skillId); await submit(); await settle();
  assert.equal(requests.length, afterLost + 1);
  assert.deepEqual(requests.at(-1), updateFirst, 'identical update retry must preserve command and key');

  state.skill_proposals.length = 0; receipts.clear(); await refresh();
  await expectLocalFence(async () => { offline = true; }); offline = false; await refresh();
  await expectLocalFence(async () => { state.objects.find(row => row.id === skillId).revision = 4; });
  state.objects.find(row => row.id === skillId).revision = 3; await refresh();
  await expectLocalFence(async () => { state.objects.find(row => row.id === skillId).deleted_at = new Date().toISOString(); });
  delete state.objects.find(row => row.id === skillId).deleted_at; await refresh();
  await expectLocalFence(async () => { state.objects = state.objects.filter(row => row.id !== skillId); });

  console.log(`PASS: actual portal draft/update UI, required affirmation, stable new skill/proposal UUIDs, exact same-key retries, edited uncertain retry rejection, and offline/revision/deleted/missing target zero-dispatch fences (${requests.length} synthetic requests).`);
} finally {
  await browser('close').catch(() => {});
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
