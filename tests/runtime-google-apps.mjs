import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { APPROVAL_ACCEPT, APPROVAL_CANCEL, GOOGLE_DISABLED_TOOLS, GOOGLE_POLICY, attendeeEmails, bareToolName,
  createGoogleAppsFence, googleAppsConfig, googleRequestDigest, googleThreadConfig } from '../runtime/google-apps.mjs';
import { CodexAdapter, RESTRICTED_CODEX_FEATURES } from '../runtime/codex-adapter.mjs';
import { CodexTransport, USER_INPUT_NOT_HANDLED } from '../runtime/codex-transport.mjs';
import { FileJournal } from '../runtime/file-journal.mjs';
import { createCodexService } from '../runtime/codex-service.mjs';

const GMAIL = 'connector_2128aebfecb84f64a069897515042a44';
const CALENDAR = 'connector_947e0d954944416db111db556030eea6';
const apps = { gmail: GMAIL, calendar: CALENDAR, ownerEmails: ['owner@example.com'] };
const identity = { epoch: 3, boot_id: '11111111-1111-4111-8111-111111111111' };
const RUN = '22222222-2222-4222-8222-222222222222';

// Exact app-server shapes pinned from rust-v0.154.0: ThreadItem::McpToolCall
// (app-server-protocol v2/item.rs), ToolRequestUserInputParams with item_id =
// call_id (app-server bespoke_event_handling.rs EventMsg::RequestUserInput), and
// build_mcp_tool_approval_question (core/src/mcp_tool_call.rs) under mode "writes".
const started = (id, tool, args, connectorId = GMAIL, { threadId = 'thread-1', turnId = 'turn-1', server = 'codex_apps' } = {}) => ({
  method: 'item/started', params: { threadId, turnId, item: { type: 'mcpToolCall', id, server, tool, status: 'inProgress', arguments: args,
    appContext: { connectorId, linkId: null, resourceUri: null, appName: connectorId === GMAIL ? 'Gmail' : 'Google Calendar', actionName: null },
    pluginId: null, readOnlyHint: false, result: null, error: null, durationMs: null } } });
const completed = (id, status = 'completed', { threadId = 'thread-1', turnId = 'turn-1' } = {}) => ({
  method: 'item/completed', params: { threadId, turnId, item: { type: 'mcpToolCall', id, server: 'codex_apps', tool: 'x', status,
    arguments: {}, result: status === 'completed' ? { content: [], structuredContent: null } : null,
    error: status === 'failed' ? { message: 'user cancelled MCP tool call' } : null, durationMs: 5 } } });
const approval = (itemId, { threadId = 'thread-1', turnId = 'turn-1' } = {}) => ({ threadId, turnId, itemId, isBlocking: true,
  questions: [{ id: `mcp_tool_call_approval_${itemId}`, header: 'Approve app tool call?', question: 'Allow Gmail to run tool "create_draft"?',
    isOther: false, isSecret: false, options: [{ label: 'Allow', description: 'Run the tool and continue.' },
      { label: 'Cancel', description: 'Cancel this tool call.' }] }] });
const answerOf = (reply, itemId) => reply.answers[`mcp_tool_call_approval_${itemId}`].answers;

function fence({ grants = [GOOGLE_POLICY], refuse = null } = {}) {
  const calls = [];
  const control = { request: async (type, payload) => {
    calls.push({ type, payload: structuredClone(payload) });
    if (refuse === type || refuse === `${type}:${payload.status}`) throw Object.assign(new Error('CONTROL_HTTP_ERROR'), { code: 'CONTROL_HTTP_ERROR' });
    if (type === 'effect-intent') return { id: payload.effect.id, status: 'intent' };
    return {};
  } };
  const decisions = [];
  const f = createGoogleAppsFence({ control, identity, apps, onDecision: value => decisions.push(value),
    resolveRun: async ({ threadId, turnId }) => threadId === 'thread-1' && turnId === 'turn-1' ? { runId: RUN, attempt: 2, grants } : null });
  return { f, calls, decisions };
}

test('granted write: permit before Allow, never session/always, then confirmed on completion', async () => {
  const { f, calls } = fence();
  const args = { to: ['someone@example.com'], subject: 'Re: plan', body: 'Draft' };
  f.onNotification(started('call-1', 'create_draft', args));
  const reply = await f.onUserInput(approval('call-1'));
  assert.deepEqual(reply, { answers: { 'mcp_tool_call_approval_call-1': { answers: [APPROVAL_ACCEPT] } } });
  assert.deepEqual(calls.map(call => call.type), ['effect-intent', 'effect-result']);
  const intent = calls[0].payload;
  assert.deepEqual(intent.identity, identity);
  assert.equal(intent.effect.classification, 'mutation');
  assert.equal(intent.effect.authorization_ref, GOOGLE_POLICY);
  assert.equal(intent.effect.action_key, `google:${RUN}:2:call-1`);
  assert.equal(intent.effect.run_id, RUN); assert.equal(intent.effect.attempt, 2);
  assert.equal(intent.effect.request_digest, googleRequestDigest(GMAIL, 'create_draft', { subject: 'Re: plan', body: 'Draft', to: ['someone@example.com'] }));
  assert.equal(calls[1].payload.status, 'dispatched'); assert.equal(calls[1].payload.effect_id, intent.effect.id);
  await f.onNotification(completed('call-1'));
  assert.equal(calls.length, 3);
  assert.equal(calls[2].payload.status, 'confirmed'); assert.equal(calls[2].payload.effect_id, intent.effect.id);
  assert.equal(calls[2].payload.receipt.tool, 'create_draft');
});

test('a failed hosted call is recorded failed', async () => {
  const { f, calls } = fence();
  f.onNotification(started('call-2', 'gmail_archive_emails', { ids: ['a'] }));
  assert.deepEqual(answerOf(await f.onUserInput(approval('call-2')), 'call-2'), [APPROVAL_ACCEPT]);
  await f.onNotification(completed('call-2', 'failed'));
  assert.equal(calls.at(-1).payload.status, 'failed');
  assert.equal(calls.at(-1).payload.receipt.tool, 'archive_emails');
});

test('refused permit declines and never accepts; a refused dispatch records the intent as not performed', async () => {
  const intentRefused = fence({ refuse: 'effect-intent' });
  intentRefused.f.onNotification(started('call-3', 'create_label', { name: 'x' }));
  assert.deepEqual(answerOf(await intentRefused.f.onUserInput(approval('call-3')), 'call-3'), [APPROVAL_CANCEL]);
  assert.deepEqual(intentRefused.calls.map(call => call.type), ['effect-intent']);

  const dispatchRefused = fence({ refuse: 'effect-result:dispatched' });
  dispatchRefused.f.onNotification(started('call-4', 'create_label', { name: 'x' }));
  assert.deepEqual(answerOf(await dispatchRefused.f.onUserInput(approval('call-4')), 'call-4'), [APPROVAL_CANCEL]);
  assert.deepEqual(dispatchRefused.calls.map(call => `${call.type}:${call.payload.status ?? ''}`),
    ['effect-intent:', 'effect-result:dispatched', 'effect-result:failed']);
  // The declined call's native completion (a skip) records nothing further.
  await dispatchRefused.f.onNotification(completed('call-4', 'failed'));
  assert.equal(dispatchRefused.calls.length, 3);
});

test('a stale or conflicting intent (not freshly admitted) is declined', async () => {
  const calls = [];
  const f = createGoogleAppsFence({ control: { request: async (type, payload) => { calls.push(type);
    return type === 'effect-intent' ? { id: 'someone-else', status: 'dispatched' } : {}; } }, identity, apps,
  resolveRun: async () => ({ runId: RUN, attempt: 2, grants: [GOOGLE_POLICY] }) });
  f.onNotification(started('call-5', 'create_draft', {}));
  assert.deepEqual(answerOf(await f.onUserInput(approval('call-5')), 'call-5'), [APPROVAL_CANCEL]);
  assert.deepEqual(calls, ['effect-intent']);
});

test('invites, disabled tools, ungranted runs and foreign connectors are declined before any permit', async () => {
  const { f, calls, decisions } = fence();
  f.onNotification(started('cal-1', 'create_event', { title: 'Sync', attendees: [{ email: 'guest@example.com' }] }, CALENDAR));
  assert.deepEqual(answerOf(await f.onUserInput(approval('cal-1')), 'cal-1'), [APPROVAL_CANCEL]);
  f.onNotification(started('cal-2', 'google_calendar_update_event', { event: { guests: ['Owner@Example.com', 'x@y.z'] } }, CALENDAR));
  assert.deepEqual(answerOf(await f.onUserInput(approval('cal-2')), 'cal-2'), [APPROVAL_CANCEL]);
  for (const tool of GOOGLE_DISABLED_TOOLS) {
    f.onNotification(started(`off-${tool}`, tool, {}, tool === 'respond_event' ? CALENDAR : GMAIL));
    assert.deepEqual(answerOf(await f.onUserInput(approval(`off-${tool}`)), `off-${tool}`), [APPROVAL_CANCEL]);
  }
  f.onNotification(started('foreign', 'create_file', {}, 'connector_other'));
  assert.deepEqual(answerOf(await f.onUserInput(approval('foreign')), 'foreign'), [APPROVAL_CANCEL]);
  assert.equal(calls.length, 0);
  assert.deepEqual(decisions.map(d => d.reason), ['INVITES_NOT_ALLOWED', 'INVITES_NOT_ALLOWED',
    ...GOOGLE_DISABLED_TOOLS.map(() => 'TOOL_DISABLED'), 'CONNECTOR_NOT_GRANTED']);

  const ungranted = fence({ grants: ['0f7d99a8-9dcc-4150-b555-da7944e2554c'] });
  ungranted.f.onNotification(started('call-6', 'create_draft', {}));
  assert.deepEqual(answerOf(await ungranted.f.onUserInput(approval('call-6')), 'call-6'), [APPROVAL_CANCEL]);
  assert.equal(ungranted.calls.length, 0);
});

test('an owner-only event is permitted; attendee extraction covers common shapes', async () => {
  const { f, calls } = fence();
  f.onNotification(started('cal-3', 'create_event', { title: 'Focus', attendees: ['owner@example.com'] }, CALENDAR));
  assert.deepEqual(answerOf(await f.onUserInput(approval('cal-3')), 'cal-3'), [APPROVAL_ACCEPT]);
  assert.equal(calls[0].payload.effect.request_digest.length, 64);
  assert.deepEqual(attendeeEmails({ event: { attendees: [{ email: 'A@b.c' }, 'd@e.f'], add_guests: 'g@h.i' } }), ['a@b.c', 'd@e.f', 'g@h.i']);
  assert.deepEqual(attendeeEmails({ title: 'none' }), []);
  assert.equal(bareToolName('gmail.search_emails'), 'search_emails');
  assert.equal(bareToolName('google_calendar_create_event'), 'create_event');
});

test('read-only calls and other requests: no permit, and anything not a hosted-app approval keeps today\'s refusal', async () => {
  const { f, calls } = fence();
  // Under mode "writes" a readOnly-annotated tool never asks; its lifecycle alone records nothing.
  f.onNotification(started('read-1', 'search_emails', { query: 'from:boss' }));
  await f.onNotification(completed('read-1'));
  assert.equal(calls.length, 0);
  assert.equal(await f.onUserInput({ threadId: 'thread-1', turnId: 'turn-1', itemId: 'q', isBlocking: true,
    questions: [{ id: 'confirm', header: 'Q', question: 'Which?' }] }), USER_INPUT_NOT_HANDLED);
  f.onNotification(started('local-1', 'hehebot_send_message', {}, GMAIL, { server: 'hehebot' }));
  assert.equal(await f.onUserInput(approval('local-1')), USER_INPUT_NOT_HANDLED);
  assert.equal(await f.onUserInput(approval('never-started')), USER_INPUT_NOT_HANDLED);
  assert.equal(calls.length, 0);
});

test('a turn that ends without the call completing leaves its effect outcome_unknown', async () => {
  const { f, calls } = fence();
  f.onNotification(started('call-7', 'batch_modify_email', { ids: ['a'] }));
  assert.deepEqual(answerOf(await f.onUserInput(approval('call-7')), 'call-7'), [APPROVAL_ACCEPT]);
  await f.onNotification({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'interrupted' } } });
  assert.equal(calls.at(-1).payload.status, 'outcome_unknown');
  await f.onNotification(completed('call-7'));
  assert.equal(calls.length, 3, 'nothing is recorded twice');
});

test('thread config enables only the two connectors, asks for every write and keeps every other gate off', () => {
  const config = googleThreadConfig(apps);
  assert.deepEqual(config.features, { ...RESTRICTED_CODEX_FEATURES, apps: true, multi_agent: false, multi_agent_v2: false, tool_call_mcp_elicitation: false });
  for (const [key, value] of Object.entries(RESTRICTED_CODEX_FEATURES)) if (key !== 'apps') assert.equal(config.features[key], value);
  assert.deepEqual(config.apps._default, { enabled: false });
  assert.deepEqual(Object.keys(config.apps).sort(), ['_default', CALENDAR, GMAIL].sort());
  assert.deepEqual(config.apps[GMAIL], { enabled: true, default_tools_approval_mode: 'writes', tools: {
    send_email: { enabled: false }, send_draft: { enabled: false }, forward_emails: { enabled: false }, delete_emails: { enabled: false } } });
  assert.deepEqual(config.apps[CALENDAR], { enabled: true, default_tools_approval_mode: 'writes', tools: { respond_event: { enabled: false } } });
  for (const bad of [{}, { gmail: GMAIL }, { gmail: GMAIL, calendar: GMAIL }, { ...apps, extra: 1 }, { ...apps, ownerEmails: ['nope'] }, { gmail: 'x', calendar: CALENDAR }]) {
    assert.throws(() => googleAppsConfig(bad), /INVALID_GOOGLE_APPS_CONFIGURATION/);
  }
});

test('adapter sends the per-thread grant and a changed grant changes the attempt fingerprint', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'hehe-google-adapter-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const journal = new FileJournal(join(directory, 'journal')), calls = [];
  const rpc = async (method, params) => { calls.push({ method, params });
    return method === 'thread/start' ? { thread: { id: 'thread-1' } } : { turn: { id: 'turn-1' } }; };
  const input = { attemptId: 'attempt-1', installationId: 'i', personaId: 'bot', scope: 'conversation', scopeId: 'bot', message: 'hi', model: 'gpt-5.5' };
  const granted = new CodexAdapter({ rpc, journal, cwd: directory, testMode: true, threadConfig: googleThreadConfig(apps) });
  await granted.submit(input);
  assert.deepEqual(calls[0].params.config, googleThreadConfig(apps));
  const plain = new CodexAdapter({ rpc, journal, cwd: directory, testMode: true });
  await assert.rejects(plain.submit(input), { code: 'IDEMPOTENCY_CONFLICT' });
  await plain.submit({ ...input, attemptId: 'attempt-2' });
  assert.equal(calls.at(-2).params.config, undefined, 'an ungranted thread has no apps table at all');
  assert.throws(() => new CodexAdapter({ rpc, journal, cwd: directory, testMode: true, threadConfig: { mcp_servers: {} } }), /INVALID_CONFIGURATION/);
});

test('transport answers a not-handled user-input request exactly like an absent handler', async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stdin = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
  const writes = []; child.stdin.on('data', chunk => writes.push(JSON.parse(chunk.toString())));
  const transport = new CodexTransport(child, { onUserInput: () => USER_INPUT_NOT_HANDLED });
  child.stdout.write(JSON.stringify({ id: 9, method: 'item/tool/requestUserInput', params: approval('x') }) + '\n');
  await new Promise(setImmediate); await new Promise(setImmediate);
  assert.deepEqual(writes, [{ id: 9, error: { code: -32601, message: 'Client capability not enabled' } }]);
  assert.equal(transport.closed, false); transport.close();
});

// v2 service composition: apps only for a granted persona, and the fence owns user input.
async function v2Service(t, grants) {
  const directory = await mkdtemp(join(tmpdir(), 'hehe-google-service-'));
  const tokenFile = join(directory, 'token'); await writeFile(tokenFile, 'synthetic', { mode: 0o600 });
  const calls = []; let launched; const now = Date.now();
  const transport = new EventEmitter();
  transport.child = { exitCode: null, signalCode: null, kill: () => { transport.child.signalCode = 'SIGKILL'; } };
  transport.initialize = async () => {};
  transport.close = () => { transport.child.exitCode = 0; };
  transport.request = async (method, params) => {
    calls.push({ method, params });
    if (method === 'thread/start') return { thread: { id: 'thread-1' } };
    if (method === 'turn/start') return { turn: { id: 'turn-1' } };
    throw Error('unexpected native RPC');
  };
  const effects = [];
  const control = { request: async (type, payload) => {
    if (type === 'status') return { epoch: 3, phase: 'BOOTING', execution_enabled: true, execution_mode: 'v2', owner_binding_sha256: null };
    if (type === 'boot') return { epoch: 3, boot_id: payload.boot_id };
    if (type === 'ready' || type === 'submitted') return {};
    if (type === 'heartbeat') return { lease_until: new Date(now + 60000).toISOString(), cancellations: [] };
    if (type === 'steer-pending') return [];
    if (type === 'memory-prepare') {
      const value = { schema_version: 1, run_id: RUN, attempt: 1, selected_model: 'gpt-5.5', global: '[]', scoped: '[]' };
      return { ...value, sha256: createHash('sha256').update(JSON.stringify(value)).digest('hex') };
    }
    if (type === 'claim') return payload.lane === 'background' ? null : { submission_key: `${RUN}:1`, run: { id: RUN, current_attempt: 1, persona_id: 'bot',
      context_json: JSON.stringify({ instruction: 'fixture', selected_model: 'gpt-5.5', memories: [], memory_budget: payload.memory_budget,
        persona: { id: 'bot', body: { tool_policy_ids: grants } } }) } };
    if (type === 'effect-intent') { effects.push(payload); return { id: payload.effect.id, status: 'intent' }; }
    if (type === 'effect-result') { effects.push(payload); return {}; }
    throw Error(`unexpected control RPC ${type}`);
  } };
  const service = createCodexService({ executionMode: 'v2', ownerBindingSha256: null, stateDirectory: directory, runtimeTokenFile: tokenFile,
    portalOrigin: 'https://127.0.0.1/', binary: '/synthetic/codex', installationId: 'fixture', googleApps: apps,
    personas: { bot: { agentId: 'assistant', model: 'gpt-5.5', allowedTools: ['hehebot_list_routines'] } } },
  { tasks: { hold: async value => ({ name: value.id, expiresAt: value.expiresAt }), release: async () => {} },
    now: () => now, operations: async () => [], checkVersion: async () => {}, control,
    launch: options => { launched = options; return transport; } });
  t.after(async () => { await service.stop().catch(() => {}); await rm(directory, { recursive: true, force: true }); });
  await service.start();
  return { calls, launched, transport, effects };
}

test('v2 service: a granted persona gets the apps table and fenced approvals; an ungranted one does not', async t => {
  const granted = await v2Service(t, [GOOGLE_POLICY]);
  const start = granted.calls.find(call => call.method === 'thread/start');
  assert.deepEqual(start.params.config.apps, googleThreadConfig(apps).apps);
  assert.equal(start.params.config.features.apps, true);
  assert.equal(start.params.approvalPolicy, 'untrusted');
  assert.equal(typeof granted.launched.onUserInput, 'function');
  granted.transport.emit('notification', started('call-9', 'create_draft', { body: 'x' }));
  const reply = await granted.launched.onUserInput(approval('call-9'));
  assert.deepEqual(answerOf(reply, 'call-9'), [APPROVAL_ACCEPT]);
  assert.equal(granted.effects[0].effect.run_id, RUN);
  assert.equal(granted.effects[0].effect.authorization_ref, GOOGLE_POLICY);

  const plain = await v2Service(t, []);
  const plainStart = plain.calls.find(call => call.method === 'thread/start');
  assert.equal(plainStart.params.config?.apps, undefined);
  assert.equal(plainStart.params.config?.features, undefined);
  plain.transport.emit('notification', started('call-10', 'create_draft', {}));
  assert.deepEqual(answerOf(await plain.launched.onUserInput(approval('call-10')), 'call-10'), [APPROVAL_CANCEL]);
  assert.equal(plain.effects.length, 0);
});
