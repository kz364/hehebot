import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileJournal } from '../runtime/file-journal.mjs';
import { CodexAdapter } from '../runtime/codex-adapter.mjs';
import { createCodexTools } from '../runtime/codex-tools.mjs';

const contracts = JSON.parse(await readFile(new URL('../SCHEMAS/contracts.json', import.meta.url), 'utf8'));
const runId = '11111111-1111-4111-8111-111111111111';
const grant = { identity: { epoch: 3, boot_id: '22222222-2222-4222-8222-222222222222' }, runId, attempt: 2, allowedTools: ['hehebot_list_routines'] };
const params = { threadId: 'root', turnId: 'turn', callId: 'call-19', namespace: null, tool: 'hehebot_list_routines', arguments: {} };
async function fixture(t, request) {
  const directory = await mkdtemp(join(tmpdir(), 'hehebot-codex-tools-unit-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const journal = new FileJournal(directory), calls = [];
  await journal.putIfAbsent('attempt', { threadId: 'root', nativeRunId: 'turn', status: 'running', rootSettled: false });
  const adapter = new CodexAdapter({ journal, cwd: directory, rpc: () => assert.fail('No native RPC') });
  const controlClient = { request: async (type, payload) => {
    calls.push({ type, payload });
    return request ? request(type, payload) : { routines: [], next_cursor: null };
  } };
  const tools = createCodexTools({ adapter, attemptId: 'attempt', controlClient, grant, contracts });
  return { tools, adapter, calls, journal, controlClient, directory };
}

test('exact root identity maps to immutable admitted Worker identity, not model fields', async t => {
  const f = await fixture(t);
  assert.deepEqual(f.tools.tools.map(tool => tool.name), ['hehebot_list_routines']);
  const reply = await f.tools.handle(params);
  assert.deepEqual(reply, { success: true, contentItems: [{ type: 'inputText', text: '{"routines":[],"next_cursor":null}' }] });
  assert.deepEqual(f.calls, [{ type: 'agent-routines', payload: { identity: grant.identity, run_id: runId, attempt: 2 } }]);
  assert.deepEqual(await f.tools.handle(params), reply); assert.equal(f.calls.length, 1);
  assert.equal((await f.tools.handle({ ...params, arguments: { id: runId } })).success, false);
  assert.equal(f.calls.length, 1);
});

test('child, wrong turn, extra authority fields and ungranted tools cannot reach Worker', async t => {
  const f = await fixture(t);
  for (const patch of [{ threadId: 'child' }, { turnId: 'other' }, { namespace: 'foreign' },
    { tool: 'hehebot_save_routine' }, { arguments: { run_id: runId } }, { run_id: runId }]) {
    assert.equal((await f.tools.handle({ ...params, ...patch })).success, false);
  }
  assert.deepEqual(f.calls, []);
});

test('unknown control outcome survives reconstruction without automatic replay', async t => {
  const f = await fixture(t, () => { throw new Error('private transport failure'); });
  assert.equal((await f.tools.handle(params)).contentItems[0].text, 'CODEX_TOOL_OUTCOME_UNKNOWN');
  const restored = createCodexTools({ adapter: new CodexAdapter({ journal: new FileJournal(f.directory), cwd: f.directory, rpc: () => assert.fail() }),
    attemptId: 'attempt', controlClient: f.controlClient, grant, contracts });
  assert.equal((await restored.handle(params)).contentItems[0].text, 'CODEX_TOOL_OUTCOME_UNKNOWN');
  assert.equal(f.calls.length, 1);
});

test('concurrent delivery cannot execute twice and missing acknowledgement never guesses identity', { timeout: 5000 }, async t => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, () => pending);
  const first = f.tools.handle(params);
  while (!f.calls.length) await new Promise(setImmediate);
  assert.equal((await f.tools.handle(params)).contentItems[0].text, 'CODEX_TOOL_OUTCOME_UNKNOWN');
  release({ routines: [], next_cursor: null });
  assert.equal((await first).success, true); assert.equal(f.calls.length, 1);
  await f.journal.update('attempt', { nativeRunId: null });
  assert.equal((await f.tools.handle({ ...params, callId: 'unacknowledged' })).contentItems[0].text, 'CODEX_TOOL_IDENTITY_DENIED');
  assert.equal(f.calls.length, 1);
});

test('reconstruction cannot rebind an existing native attempt to another Worker grant', async t => {
  const f = await fixture(t); assert.equal((await f.tools.handle(params)).success, true);
  const rebound = createCodexTools({ adapter: f.adapter, attemptId: 'attempt', controlClient: f.controlClient,
    grant: { ...grant, attempt: 3 }, contracts });
  assert.equal((await rebound.handle({ ...params, callId: 'new-call' })).contentItems[0].text, 'CODEX_TOOL_GRANT_CONFLICT');
  assert.equal(f.calls.length, 1);
});

test('cancelled custody or cooperative abort between intent and dispatch prevents Worker call', async t => {
  for (const abort of [false, true]) {
    const f = await fixture(t), controller = new AbortController();
    const put = f.journal.putIfAbsent.bind(f.journal);
    f.journal.putIfAbsent = async (...args) => {
      const result = await put(...args);
      if (abort) controller.abort(); else await f.journal.update('attempt', { status: 'cancelling' });
      return result;
    };
    assert.equal((await f.tools.handle(params, { signal: controller.signal })).success, false);
    assert.deepEqual(f.calls, []);
  }
});
