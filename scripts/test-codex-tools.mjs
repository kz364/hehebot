#!/usr/bin/env node
// Credential-free acceptance: pristine Codex -> stdio MCP -> HTTPS Worker -> SQLite.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Agent } from 'undici';
import { spawnCodex } from '../runtime/codex-transport.mjs';
import { ControlClient } from '../runtime/control-client.mjs';
import { CodexAdapter } from '../runtime/codex-adapter.mjs';
import { CodexEventRouter } from '../runtime/codex-events.mjs';
import { CodexTaskControl } from '../runtime/codex-tasks.mjs';
import { CodexOperations } from '../runtime/codex-operations.mjs';
import { FileJournal } from '../runtime/file-journal.mjs';
import { createCodexTools } from '../runtime/codex-tools.mjs';
import { buildToolDefinitions } from '../runtime/agent-tools.mjs';
import { ExecutionSupervisor } from '../runtime/execution-supervisor.mjs';

const root = resolve(import.meta.dirname, '..');
const twoRootsMode = process.argv.includes('--two-roots');
const supervisorChildMode = process.argv.includes('--supervisor-child');
const supervisorMode = supervisorChildMode || process.argv.includes('--supervisor');
const dynamicMode = !supervisorChildMode && (supervisorMode || process.argv.includes('--dynamic'));
const grandchildMode = process.argv.includes('--grandchild');
const childMode = supervisorChildMode || grandchildMode || process.argv.includes('--child');
const expectedModelCalls = grandchildMode ? 13 : childMode ? 11 : 7;
assert.ok(process.argv.slice(2).length <= 1 && process.argv.slice(2).every(arg => ['--two-roots', '--dynamic', '--supervisor', '--child', '--grandchild', '--supervisor-child'].includes(arg)), 'Choose one supported fixture mode');
const binary = join(root, '.local/codex-runtime/node_modules/.bin/codex');
const SKILL_POLICY = '46b2cbdd-d227-4f54-bffa-33148aad0134';
const ROUTINE_POLICY = 'f0ff3ead-1e31-4f83-bbc2-aa25f069a962';
const policies = [SKILL_POLICY, ROUTINE_POLICY];
const allowedTools = ['hehebot_propose_skill', 'hehebot_save_routine', 'hehebot_list_routines', 'hehebot_run_routine', 'hehebot_delete_routine', 'hehebot_read_skill'];
const sleep = ms => new Promise(ok => setTimeout(ok, ms));
const report = { label: 'codex-agent-tools-native-acceptance', toolTransport: dynamicMode ? 'dynamic' : 'mcp', supervisor: supervisorMode, child: childMode, status: 'failed', codex: '0.154.0', modelCalls: 0, externalModelCalls: 0, assertions: [] };
const check = (name, fn) => { fn(); report.assertions.push(name); };
let directory, worker, fixture, transport, dispatcher, router, supervisor, workerLogs = '';
const notifications = [], nativeErrors = [], fixtureErrors = [];

async function freePort() {
  const server = createServer();
  await new Promise((ok, fail) => server.once('error', fail).listen(0, '127.0.0.1', ok));
  const port = server.address().port;
  await new Promise(ok => server.close(ok));
  return port;
}
async function waitFor(fn, label, timeout = 20_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await sleep(40); }
  throw new Error(`timed out waiting for ${label}`);
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(ok => child.once('exit', ok)); child.kill('SIGTERM');
  if (await Promise.race([exited.then(() => true), sleep(5000).then(() => false)])) return;
  child.kill('SIGKILL');
  if (!await Promise.race([exited.then(() => true), sleep(2000).then(() => false)])) throw new Error('process shutdown was not confirmed');
}
async function jsonBody(req) { const chunks = []; let bytes = 0; for await (const chunk of req) { bytes += chunk.length; if (bytes > 2 * 1024 * 1024) throw new Error('Fixture request exceeds limit'); chunks.push(chunk); } return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
function findType(value, type) { if (!value || typeof value !== 'object') return undefined; if (value.type === type) return value; for (const item of Object.values(value).reverse()) { const found = findType(item, type); if (found) return found; } }
function collectTypes(value, found = new Set()) { if (!value || typeof value !== 'object') return found; if (typeof value.type === 'string') found.add(value.type); for (const item of Object.values(value)) collectTypes(item, found); return found; }
function response(id, output) { return { id, object: 'response', created_at: 1, status: 'completed', error: null, incomplete_details: null, instructions: null, model: 'fixture-model', output, parallel_tool_calls: true, temperature: null, tool_choice: 'auto', tools: [], top_p: null, background: false, max_output_tokens: null, max_tool_calls: null, previous_response_id: null, prompt: null, reasoning: { effort: null, summary: null }, service_tier: 'default', store: false, text: { format: { type: 'text' } }, truncation: 'disabled', usage: { input_tokens: 1, input_tokens_details: { cached_tokens: 0 }, output_tokens: 1, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 2 }, user: null, metadata: {} }; }
function sendEvents(res, output) {
  const completed = response(`resp_${randomUUID().replaceAll('-', '')}`, output);
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  send('response.created', { response: { ...completed, status: 'in_progress', output: [] } });
  output.forEach((item, output_index) => {
    send('response.output_item.added', { output_index, item: { ...item, ...(item.type === 'function_call' ? { arguments: '' } : item.type === 'custom_tool_call' ? { input: '' } : { content: [] }) } });
    if (item.type === 'function_call') send('response.function_call_arguments.done', { output_index, item_id: item.id, arguments: item.arguments });
    else if (item.type === 'custom_tool_call') send('response.custom_tool_call_input.done', { output_index, item_id: item.id, input: item.input });
    else {
      const text = item.content[0].text;
      send('response.content_part.added', { item_id: item.id, output_index, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
      send('response.output_text.delta', { item_id: item.id, output_index, content_index: 0, delta: text });
      send('response.output_text.done', { item_id: item.id, output_index, content_index: 0, text });
      send('response.content_part.done', { item_id: item.id, output_index, content_index: 0, part: item.content[0] });
    }
    send('response.output_item.done', { output_index, item });
  });
  send('response.completed', { response: completed }); res.end('data: [DONE]\n\n');
}
const message = text => [{ id: `msg_${randomUUID().replaceAll('-', '')}`, type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text, annotations: [], logprobs: [] }] }];

async function verifyTwoRoots({ ownerCommand, ownerFetch, control, identity, persona, reviewedId, reviewedBody,
  runId, attempt, origin, tokenPath, certPath, home, workspace, grantPath, fixturePort }) {
  const otherPersona = randomUUID(), otherSkill = randomUUID(), proposal = randomUUID();
  const otherBody = { ...reviewedBody, name: 'Other persona private procedure', steps: ['Compare exactly 71 against 103.'] };
  assert.equal((await ownerCommand('persona.put', { ...persona.body, id: otherPersona, expected_revision: 0,
    name: 'Independent persona 71', tool_policy_ids: [SKILL_POLICY] })).value.status, 'applied');
  assert.equal((await ownerCommand('skill.propose', { proposal_id: proposal, skill_id: otherSkill, expected_skill_revision: 0,
    body: otherBody, provenance: { kind: 'owner', source_ref: 'fixture' }, executable_files_changed: false })).value.status, 'applied');
  assert.equal((await ownerCommand('skill.review', { proposal_id: proposal, expected_proposal_revision: 1, decision: 'approve' })).value.status, 'applied');
  assert.equal((await ownerCommand('skill.enable', { skill_id: otherSkill, expected_skill_revision: 1, persona_id: otherPersona, enabled: true })).value.status, 'applied');
  const queued = await ownerCommand('message.send', { conversation_id: otherPersona, text: 'Independent root 71 scope proof' });
  assert.equal(queued.value.status, 'applied');
  assert.notEqual(queued.value.resource_id, runId);
  const secondClaim = await control.request('claim', { identity });
  check('second independent coordinator is queued, but first claimed coordinator blocks claim', () => {
    assert.notEqual(otherPersona, persona.id);
    assert.equal(secondClaim, null, 'Second coordinator admission contract changed; extend positive fixture rather than fabricate admission');
  });
  let bound = false;
  const callIds = [];
  fixture = createServer(async (req, res) => { try {
    assert.equal(req.url, '/v1/responses'); const body = await jsonBody(req);
    report.modelCalls++; assert.ok(report.modelCalls <= 3);
    await waitFor(() => bound, 'first root submitted custody');
    if (report.modelCalls > 1) {
      const raw = findType(body.input, 'function_call_output').output;
      if (report.modelCalls === 2) {
        const decoded = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const content = Array.isArray(decoded) ? JSON.parse(decoded.at(-1).text) : decoded;
        const receipt = content.content ? JSON.parse(content.content.find(item => item.type === 'text').text) : content;
        check('admitted native root reads its own pinned skill snapshot', () => {
          assert.equal(receipt.skill.id, reviewedId); assert.deepEqual(receipt.skill.body, reviewedBody);
        });
      } else {
        check('native cross-persona skill read fails without exposing asymmetric body', () => {
          assert.match(JSON.stringify(raw), /-32000|Agent command failed/);
          assert.equal(JSON.stringify(raw).includes(otherBody.steps[0]), false);
        });
        sendEvents(res, message('FIRST_ROOT_SCOPE_CHECKED')); return;
      }
    }
    const tool = body.tools.find(tool => tool.name?.includes('hehebot_read_skill')) ?? body.tools.find(tool => tool.name === 'mcp__hehebot');
    assert.ok(tool);
    const callId = `call_${randomUUID().replaceAll('-', '')}`; callIds.push(callId);
    sendEvents(res, [{ id: `fc_${randomUUID().replaceAll('-', '')}`, type: 'function_call', status: 'completed', call_id: callId,
      ...(tool.name === 'mcp__hehebot' ? { namespace: tool.name, name: 'hehebot_read_skill' } : { name: tool.name }),
      arguments: JSON.stringify({ skill_id: report.modelCalls === 1 ? reviewedId : otherSkill }) }]);
  } catch (error) { fixtureErrors.push(error.message); sendEvents(res, message('FIXTURE_FAILED')); } });
  await new Promise(ok => fixture.listen(fixturePort, '127.0.0.1', ok));
  await writeFile(join(home, 'config.toml'), `model = "fixture-model"\nmodel_provider = "fixture"\n[features]\ncode_mode = false\n[model_providers.fixture]\nname = "Loopback"\nbase_url = "http://127.0.0.1:${fixturePort}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`, { mode: 0o600 });
  await writeFile(grantPath, JSON.stringify({ origin: origin + '/', tokenFile: tokenPath, identity, runId, attempt,
    allowedTools: ['hehebot_read_skill'] }), { mode: 0o600 });
  const journal = new FileJournal(join(home, 'events'));
  transport = spawnCodex({ binary, home, cwd: workspace, timeoutMs: 15000 });
  transport.child.stderr.on('data', x => nativeErrors.push(x.toString()));
  transport.on('notification', x => notifications.push(x)); await transport.initialize();
  const adapter = new CodexAdapter({ journal, cwd: workspace, rpc: (method, params) => transport.request(method, params), testMode: true,
    mcpServers: { hehebot: { command: process.execPath, args: [join(root, 'runtime/agent-tools.mjs')],
      env: { HEHEBOT_AGENT_TOOLS_CONFIG: grantPath, NODE_EXTRA_CA_CERTS: certPath },
      tools: { hehebot_read_skill: { approval_mode: 'approve' } } } } });
  router = new CodexEventRouter({ transport, adapter, onRecovery: value => fixtureErrors.push(value.code) });
  const native = await adapter.submit({ attemptId: 'two-root-first', installationId: 'two-root-fixture', personaId: persona.id,
    scope: 'conversation', scopeId: persona.id, message: 'First independently admitted root reads its snapshot.', model: 'fixture-model' });
  assert.equal(native.status, 'running'); await router.bind('two-root-first');
  await control.request('submitted', { identity, run_id: runId, attempt, native_ref: native.nativeRunId });
  assert.equal(await control.request('claim', { identity }), null); bound = true;
  const done = await waitFor(() => notifications.find(n => n.method === 'turn/completed' && n.params.threadId === native.threadId && n.params.turn.id === native.nativeRunId), 'first root terminal');
  assert.equal(done.params.turn.status, 'completed'); await router.flush();
  assert.equal(await control.request('claim', { identity }), null);
  await assert.rejects(control.request('agent-skill', { identity, run_id: runId, attempt, skill_id: otherSkill }), error => error.status === 404);
  const final = await (await ownerFetch('/v1/state')).json();
  check('root terminal does not admit second Worker coordinator or settle the first', () => {
    assert.equal(final.runs.find(run => run.id === runId).status, 'running');
    const second = final.runs.find(run => run.id === queued.value.resource_id);
    assert.equal(second.status, 'queued'); assert.equal(second.current_attempt, 0); assert.equal(second.persona_id, otherPersona);
    assert.equal(adapter.sleepReadiness().allowed, false);
  });
  const observed = await adapter.requireRun('two-root-first');
  check('one pristine app-server executed two distinct scoped read invocations', () => {
    assert.equal(report.modelCalls, 3); assert.equal(new Set(callIds).size, 2);
    assert.equal(Object.keys(observed.mcpCalls).length, 2); assert.equal(observed.rootSettled, true);
    assert.equal(observed.effectsSettled, undefined); assert.deepEqual(fixtureErrors, []);
  });
  Object.assign(report, { status: 'blocked', blocker: 'WORKER_SINGLE_COORDINATOR_ADMISSION',
    independentlyAdmittedRoots: 1, queuedRoots: 1, nativeProcesses: 1, twoAdmittedRootIsolationProved: false });
  process.exitCode = 2;
}

try {
  const version = await promisify(execFile)(binary, ['--version'], { timeout: 10_000 });
  check('exact unmodified Codex version', () => assert.equal(version.stdout.trim(), 'codex-cli 0.154.0'));
  directory = await mkdtemp(join(tmpdir(), 'hehebot-codex-tools-')); await chmod(directory, 0o700);
  const [workerPort, fixturePort] = await Promise.all([freePort(), freePort()]);
  const keyPath = join(directory, 'tls.key'), certPath = join(directory, 'tls.crt');
  const openssl = join(directory, 'openssl.cnf');
  await writeFile(openssl, '[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=v3\n[dn]\nCN=127.0.0.1\n[v3]\nsubjectAltName=IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,digitalSignature\n', { mode: 0o600 });
  await promisify(execFile)('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-config', openssl, '-keyout', keyPath, '-out', certPath], { timeout: 10_000 });
  const token = randomBytes(32).toString('hex');
  worker = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--env', 'local', '--ip', '127.0.0.1', '--port', String(workerPort), '--persist-to', join(directory, 'worker-state'), '--local-protocol', 'https', '--https-key-path', keyPath, '--https-cert-path', certPath, '--var', 'EXECUTION_ENABLED:true', '--var', 'NATIVE_VERIFIED:true', '--var', `RUNTIME_TOKEN:${token}`, '--var', `TOOL_POLICY_IDS:${JSON.stringify(policies)}`, '--var', `PROVIDER_CONFIG:${JSON.stringify({ provider: 'fake', ref: { provider: 'fake', id: 'codex-tools-fixture' } })}`], { cwd: root, env: { ...process.env, WRANGLER_LOG_PATH: join(directory, 'wrangler-logs'), WRANGLER_SEND_METRICS: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
  worker.stdout.on('data', x => { workerLogs += x; }); worker.stderr.on('data', x => { workerLogs += x; });
  await waitFor(() => workerLogs.replace(/\u001b\[[0-9;]*m/g, '').includes(`Ready on https://127.0.0.1:${workerPort}`), 'HTTPS Worker readiness', 45_000);
  const origin = `https://127.0.0.1:${workerPort}`;
  dispatcher = new Agent({ connect: { ca: await readFile(certPath) } });
  const trustedFetch = (url, init = {}) => fetch(url, { ...init, dispatcher });
  const ownerFetch = (path, init = {}) => trustedFetch(origin + path, init);
  const stateResponse = await ownerFetch('/v1/state'); assert.equal(stateResponse.status, 200); let state = await stateResponse.json();
  const persona = state.objects.find(x => x.kind === 'persona');
  const ownerCommand = async (type, payload) => { const r = await ownerFetch('/v1/commands', { method: 'POST', headers: { 'content-type': 'application/json', Origin: origin, 'idempotency-key': randomUUID() }, body: JSON.stringify({ schema_version: 1, type, payload }) }); return { status: r.status, value: await r.json() }; };
  const adopted = await ownerCommand('persona.put', { ...persona.body, id: persona.id, expected_revision: persona.revision, tool_policy_ids: policies });
  check('owner explicitly adopted persona tool policy', () => { assert.equal(adopted.status, 202); assert.equal(adopted.value.status, 'applied'); });
  const reviewedId = randomUUID(), reviewedProposal = randomUUID();
  const reviewedBody = { name: 'Reviewed fixture procedure', description: 'A pinned procedure.', when_to_use: 'During this fixture.', inputs_access: [], steps: ['Compare exactly 19 against 43.'], decision_rules: [], validation: ['Preserve the original numbers.'], output: 'Comparison.', failure_handling: ['Stop.'], approval_boundaries: ['No external effects.'], contains_private_facts: false };
  assert.equal((await ownerCommand('skill.propose', { proposal_id: reviewedProposal, skill_id: reviewedId, expected_skill_revision: 0, body: reviewedBody, provenance: { kind: 'owner', source_ref: 'fixture' }, executable_files_changed: false })).value.status, 'applied');
  assert.equal((await ownerCommand('skill.review', { proposal_id: reviewedProposal, expected_proposal_revision: 1, decision: 'approve' })).value.status, 'applied');
  assert.equal((await ownerCommand('skill.enable', { skill_id: reviewedId, expected_skill_revision: 1, persona_id: persona.id, enabled: true })).value.status, 'applied');
  const sourceRoutineId = randomUUID();
  if (supervisorMode) assert.equal((await ownerCommand('routine.put', {
    id: sourceRoutineId, expected_revision: 0, persona_id: persona.id, name: 'Manually invoked native acceptance',
    instructions: 'SUPERVISED_PAUSED_ROUTINE: Stage the synthetic skill proposal using the admitted tool.', enabled: false,
    schedule: { cron: '0 8 * * 1-5', timezone: 'Asia/Jakarta' }, trigger_source_id: null, action_policy_ids: [],
    policy: { misfire: 'coalesce', overlap: 'queue_one', max_replay: 1, max_lateness_seconds: 60 },
  })).value.status, 'applied');
  const queued = supervisorMode ? await ownerCommand('routine.run', { id: sourceRoutineId, expected_revision: 1 })
    : await ownerCommand('message.send', { conversation_id: persona.id, text: 'Stage the synthetic skill proposal using the admitted tool.' });
  assert.equal(queued.value.status, 'applied');
  const control = new ControlClient({ origin: origin + '/', token, fetchImpl: trustedFetch });
  await waitFor(async () => (await control.request('status', {})).phase === 'BOOTING', 'FakeProvider boot');
  const identity = await control.request('boot', { boot_id: randomUUID() }); await control.request('ready', { identity });
  const runId = queued.value.resource_id, attempt = 1;
  const inspectClaim = async claim => {
    check('real SQLite run claimed with fenced identity', () => { assert.equal(claim.run.id, runId); assert.equal(claim.run.current_attempt, attempt); assert.equal(claim.run.persona_id, persona.id); });
    assert.equal((await ownerCommand('skill.enable', { skill_id: reviewedId, expected_skill_revision: 1, persona_id: persona.id, enabled: false })).value.status, 'applied');
  };
  if (!supervisorMode) await inspectClaim(await control.request('claim', { identity }));

  const tokenPath = join(directory, 'runtime.token'), grantPath = join(directory, 'agent-tools.json'), home = join(directory, 'codex-home'), workspace = join(directory, 'workspace');
  await Promise.all([mkdir(home, { mode: 0o700 }), mkdir(workspace, { mode: 0o700 })]);
  await writeFile(tokenPath, token, { mode: 0o600 });
  await writeFile(grantPath, JSON.stringify({ origin: origin + '/', tokenFile: tokenPath, identity, runId, attempt, allowedTools }), { mode: 0o600 });
  if (twoRootsMode) {
    await verifyTwoRoots({ ownerCommand, ownerFetch, control, identity, persona, reviewedId, reviewedBody, runId, attempt,
      origin, tokenPath, certPath, home, workspace, grantPath, fixturePort });
  } else {
  const proposalId = randomUUID(), skillId = randomUUID(), idempotencyKey = randomUUID();
  const toolArgs = { idempotency_key: idempotencyKey, payload: { proposal_id: proposalId, skill_id: skillId, expected_skill_revision: 0, body: { name: 'Synthetic native method', description: 'A bounded native MCP acceptance proposal.', when_to_use: 'Only in this synthetic acceptance.', inputs_access: [], steps: ['Record the staged proposal.'], decision_rules: [], validation: ['Verify pending persisted state.'], output: 'A pending proposal.', failure_handling: ['Stop without effects.'], approval_boundaries: ['Owner review is required.'], contains_private_facts: false }, executable_files_changed: false } };
  const routineId = randomUUID();
  const routine = { id: routineId, expected_revision: 0, persona_id: persona.id, name: 'Synthetic paused routine', instructions: 'Read synthetic local notes.', enabled: false, schedule: { cron: '0 8 * * 1-5', timezone: 'Asia/Jakarta' }, trigger_source_id: null, action_policy_ids: [], policy: { misfire: 'coalesce', overlap: 'queue_one', max_replay: 1, max_lateness_seconds: 60 } };
  const argumentsByStage = [toolArgs, { idempotency_key: randomUUID(), payload: routine },
    { id: routineId },
    { idempotency_key: randomUUID(), payload: { id: routineId, expected_revision: 1 } },
    { idempotency_key: randomUUID(), payload: { id: routineId, expected_revision: 1 } },
    { skill_id: reviewedId }];
  let manualRunId, nativeBound = false, toolRequests = 0, childThreadId, intermediateThreadId, childFinalHeld = false, childFinalClosed = false;
  fixture = createServer(async (req, res) => { try {
    if (req.method !== 'POST' || req.url !== '/v1/responses') { res.writeHead(404); res.end(); return; }
    if (report.modelCalls >= expectedModelCalls) { res.writeHead(400); res.end(); return; }
    report.modelCalls++; const body = await jsonBody(req);
    if (supervisorMode && report.modelCalls === 1) check('native model receives paused routine instructions and progressive skill catalog only', () => {
      const input = JSON.stringify(body.input);
      assert.match(input, /SUPERVISED_PAUSED_ROUTINE/); assert.ok(input.includes(reviewedId));
      assert.match(input, /hehebot_read_skill/); assert.equal(input.includes(reviewedBody.steps[0]), false);
    });
    if (childMode) {
      if (body.input.some(item => item?.role === 'user' && JSON.stringify(item.content).includes('UNRELATED_GRANT_PROOF'))) {
        const output = findType(body.input, 'function_call_output');
        if (output) {
          check('unadmitted second root cannot borrow first task Worker authority', () => {
            const raw = JSON.stringify(output.output);
            assert.match(raw, /-32000|Agent command failed/);
            assert.equal(raw.includes(reviewedBody.steps[0]), false);
          });
          sendEvents(res, message('UNRELATED_GRANT_DENIED')); return;
        }
        check('same-process second root gets its own restricted MCP catalog', () => {
          const names = body.tools.flatMap(tool => tool.tools ?? [tool]).map(tool => tool.name).filter(name => typeof name === 'string');
          assert.ok(names.some(name => name.includes('hehebot_read_skill')));
          assert.ok(!names.some(name => name.includes('hehebot_propose_skill') || name.includes('hehebot_save_routine')));
        });
        const advertised = body.tools.find(tool => tool.name?.includes('hehebot_read_skill')) ?? body.tools.find(tool => tool.name === 'mcp__hehebot');
        assert.ok(advertised);
        sendEvents(res, [{ id: `fc_${randomUUID().replaceAll('-', '')}`, type: 'function_call', status: 'completed', call_id: `call_${randomUUID().replaceAll('-', '')}`,
          ...(advertised.name === 'mcp__hehebot' ? { namespace: 'mcp__hehebot', name: 'hehebot_read_skill' } : { name: advertised.name }),
          arguments: JSON.stringify({ skill_id: reviewedId }) }]);
        return;
      }
      const isChild = body.input.some(item => item?.role === 'user' && JSON.stringify(item.content).includes('SHARED_TASK_CHILD'));
      if (!isChild) {
        const isIntermediate = grandchildMode && body.input.some(item => item?.role === 'user' && JSON.stringify(item.content).includes('SHARED_TASK_DELEGATE'));
        if (isIntermediate) await waitFor(() => nativeBound && notifications.some(n => n.method === 'turn/completed' && n.params?.threadId === threadId && n.params.turn.id === turnId), 'root completion before nested spawn');
        const output = findType(body.input, 'function_call_output');
        if (output) {
          const receiver = JSON.parse(String(output.output)).agent_id;
          assert.equal(typeof receiver, 'string');
          if (grandchildMode && !isIntermediate) intermediateThreadId = receiver;
          else childThreadId = receiver;
          sendEvents(res, message('SHARED_PARENT_DONE')); return;
        }
        const spawnTool = body.tools.find(tool => tool.name === 'spawn_agent' || tool.tools?.some(nested => nested.name === 'spawn_agent'));
        assert.ok(spawnTool, 'Native spawn_agent advertised');
        sendEvents(res, [{ id: `fc_${randomUUID().replaceAll('-', '')}`, type: 'function_call', status: 'completed', call_id: `call_${randomUUID().replaceAll('-', '')}`,
          ...(spawnTool.type === 'namespace' ? { namespace: spawnTool.name } : {}), name: 'spawn_agent',
          arguments: JSON.stringify({ message: grandchildMode && !isIntermediate ? 'SHARED_TASK_DELEGATE' : 'SHARED_TASK_CHILD', agent_type: 'default' }) }]);
        return;
      }
      await waitFor(() => nativeBound && notifications.some(n => n.method === 'turn/completed' && n.params?.threadId === threadId && n.params.turn.id === turnId), 'root terminal before child tools');
      if (grandchildMode) await waitFor(() => intermediateThreadId && notifications.some(n => n.method === 'turn/completed' && n.params?.threadId === intermediateThreadId), 'intermediate terminal before grandchild tools');
      await router.flush();
      assert.equal((await eventJournal.get(adapterAttempt)).rootSettled, true);
    }
    toolRequests++;
    if (dynamicMode) await waitFor(() => nativeBound, 'durable root acknowledgement before scripted tool selection');
    if (toolRequests === 2) report.continuationTypes = [...collectTypes(body.input)];
    const continuation = findType(body.input, 'function_call_output') ?? findType(body.input, 'custom_tool_call_output');
    if (continuation) {
      const raw = typeof continuation.output === 'string' ? continuation.output : JSON.stringify(continuation.output);
      await writeFile(join(directory, 'mcp-output.json'), raw, { mode: 0o600 });
      const output = JSON.parse(raw);
      const content = Array.isArray(output) ? JSON.parse(output.at(-1).text) : output;
      const receipt = content.content ? JSON.parse(content.content.find(x => x.type === 'text').text) : content;
      const stage = toolRequests - 2;
      if (stage !== 2 && stage !== 5) assert.equal(receipt.status, 'applied');
      const current = await (await ownerFetch('/v1/state')).json();
      if (stage === 0) assert.equal(receipt.resource_id, proposalId);
      else if (stage === 1) check('native routine save persisted paused Jakarta configuration', () => {
        assert.equal(receipt.resource_id, routineId);
        assert.deepEqual(current.objects.find(x => x.id === routineId).body, routine);
      });
      else if (stage === 2) check('native routine inspection returns exact saved revision without running it', () => {
        assert.equal(receipt.routines.length, 1); assert.equal(receipt.routines[0].id, routineId);
        assert.equal(receipt.routines[0].revision, 1); assert.deepEqual(receipt.routines[0].body, routine);
        assert.equal(receipt.next_cursor, null); assert.equal(current.runs.filter(x => x.routine_id === routineId).length, 0);
      });
      else if (stage === 3) check('native manual run queued once without enabling routine', () => {
        manualRunId = receipt.resource_id;
        assert.equal(current.objects.find(x => x.id === routineId).body.enabled, false);
        assert.equal(current.runs.filter(x => x.routine_id === routineId).length, 1);
        assert.equal(current.runs.find(x => x.id === manualRunId).status, 'queued');
      });
      else if (stage === 4) check('native deletion cancelled pending routine work, not the caller', () => {
        assert.equal(receipt.resource_id, routineId); assert.equal(current.objects.some(x => x.id === routineId), false);
        assert.equal(current.runs.find(x => x.id === manualRunId).status, 'cancelled');
        assert.equal(current.runs.find(x => x.id === runId).status, supervisorMode ? 'running' : 'claimed');
      });
      else if (stage === 5) check('native skill load returns admitted procedure despite later disablement', () => {
        assert.equal(receipt.skill.id, reviewedId); assert.equal(receipt.skill.revision, 1);
        assert.deepEqual(receipt.skill.body, reviewedBody);
      });
      else assert.fail('Unexpected continuation');
      if (stage === 5) {
        if (supervisorChildMode) {
          childFinalHeld = true;
          res.once('close', () => { if (!res.writableEnded) childFinalClosed = true; });
        } else sendEvents(res, message('MCP_PROPOSAL_STAGED_AND_ROUTINE_LIFECYCLE_VERIFIED'));
        return;
      }
    }
    const next = toolRequests - 1;
    const advertised = (body.tools ?? []).find(x => x?.name?.includes(allowedTools[next])) ?? (body.tools ?? []).find(x => x?.name === 'mcp__hehebot');
    assert.ok(advertised, `hehebot MCP dispatcher not advertised: ${(body.tools ?? []).map(x => x.name).join(',')}`);
    const callId = `call_${randomUUID().replaceAll('-', '')}`;
    // Codex 0.154.0 ResponseItem::FunctionCall keeps namespace separate from name.
    sendEvents(res, [{ id: `fc_${randomUUID().replaceAll('-', '')}`, type: 'function_call', status: 'completed', call_id: callId,
      ...(advertised.name === 'mcp__hehebot' ? { namespace: 'mcp__hehebot', name: allowedTools[next] } : { name: advertised.name }),
      arguments: JSON.stringify(argumentsByStage[next]) }]);
  } catch (error) { fixtureErrors.push(error.stack ?? String(error)); if (!res.headersSent) sendEvents(res, message('FIXTURE_ASSERTION_FAILED')); else res.end(); } });
  await new Promise((ok, fail) => fixture.once('error', fail).listen(fixturePort, '127.0.0.1', ok));
  await writeFile(join(home, 'config.toml'), `model = "fixture-model"\nmodel_provider = "fixture"\napproval_policy = "never"\nsandbox_mode = "read-only"\n[features]\ncode_mode = false\n${grandchildMode ? 'multi_agent_v2 = false\n[agents]\nmax_depth = 2\n' : ''}[model_providers.fixture]\nname = "Loopback fixture"\nbase_url = "http://127.0.0.1:${fixturePort}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`, { mode: 0o600 });
  // Explicitly authorize only these disposable scoped tools. This is the
  // supported per-tool policy, not an annotation-based or global approval bypass.
  const mcpServers = { hehebot: { command: process.execPath, args: [join(root, 'runtime/agent-tools.mjs')], startup_timeout_sec: 10,
    env: { HEHEBOT_AGENT_TOOLS_CONFIG: grantPath, NODE_EXTRA_CA_CERTS: certPath },
    tools: Object.fromEntries(allowedTools.map(name => [name, { approval_mode: 'approve' }])) } };
  const eventJournal = new FileJournal(join(home, 'events'));
  const contracts = JSON.parse(await readFile(join(root, 'SCHEMAS/contracts.json'), 'utf8'));
  const adapter = new CodexAdapter({ cwd: workspace, journal: eventJournal, rpc: (method, params) => transport.request(method, params),
    testMode: supervisorMode || !dynamicMode, mcpServers: dynamicMode ? {} : mcpServers,
    dynamicTools: supervisorMode && dynamicMode ? buildToolDefinitions(contracts).filter(tool => allowedTools.includes(tool.name)).map(tool => ({ type: 'function', ...tool })) : [] });
  let adapterAttempt = 'mcp-proof';
  let dynamicTools = createCodexTools({ adapter, attemptId: adapterAttempt, controlClient: control,
    grant: { identity, runId, attempt, allowedTools }, contracts });
  const dynamicCalls = [];
  transport = spawnCodex({ binary, home, cwd: workspace, timeoutMs: 15_000, onToolCall: dynamicMode ? async (params, options) => {
    const result = await dynamicTools.handle(params, options);
    dynamicCalls.push({ threadId: params.threadId, turnId: params.turnId, callId: params.callId, success: result.success });
    return result;
  } : null });
  transport.child.stderr.on('data', x => nativeErrors.push(x.toString())); transport.on('notification', x => notifications.push(x));
  await transport.initialize({ experimentalApi: dynamicMode });
  const routerFailures = [];
  router = new CodexEventRouter({ transport, adapter, onRecovery: value => { routerFailures.push(value.code); supervisor?.disconnect(); } });
  let threadId, turnId;
  if (supervisorMode) {
    const controlCalls = [];
    supervisor = new ExecutionSupervisor({ control: { request: async (type, payload) => {
      controlCalls.push(type); const result = await control.request(type, payload);
      if (type === 'claim') await inspectClaim(result);
      return result;
    } }, native: adapter, journal: eventJournal, identity, installationId: 'native-supervisor-fixture',
      personas: { [persona.id]: { agentId: 'assistant', model: 'fixture-model' } }, events: router,
      activity: { ensure: async () => {}, releaseAfterDrain: async () => assert.fail('No verified drain') }, operations: async () => {
        const current = await eventJournal.get(supervisor.bridge.cursor);
        if (!current?.attemptId || current.phase === 'complete') return [];
        return new CodexOperations({ journal: eventJournal, attemptId: current.attemptId, runId: current.claim.run.id,
          attempt: current.claim.run.current_attempt, startedAt: current.claim.run.updated_at,
          deadlineAt: current.claim.deadline_at }).snapshot();
      } });
    const dispatched = await supervisor.start();
    adapterAttempt = dispatched.attemptId;
    const admitted = await adapter.requireRun(adapterAttempt); threadId = admitted.threadId; turnId = admitted.nativeRunId;
    dynamicTools = createCodexTools({ adapter, attemptId: adapterAttempt, controlClient: control, grant: { identity, runId, attempt, allowedTools }, contracts });
    check('real supervisor claims, submits, binds native events and acknowledges Worker custody', () => {
      assert.equal(dispatched.phase, 'running'); assert.deepEqual(controlCalls, ['heartbeat', 'claim', 'submitted']);
      assert.equal(dispatched.claim.run.id, runId); assert.equal(dispatched.nativeRunId, turnId);
    });
  } else if (!dynamicMode) {
    const admitted = await adapter.submit({ attemptId: adapterAttempt, installationId: 'mcp-fixture', personaId: persona.id,
      scope: 'conversation', scopeId: persona.id, model: 'fixture-model',
      message: childMode ? 'Delegate the shared logical task to a native child.' : 'Use the admitted hehebot proposal tool exactly once.' });
    assert.equal(admitted.status, 'running'); threadId = admitted.threadId; turnId = admitted.nativeRunId;
    await router.bind(adapterAttempt);
  } else {
    threadId = (await transport.request('thread/start', { cwd: workspace, model: 'fixture-model', modelProvider: 'fixture', approvalPolicy: 'never', sandbox: 'read-only',
      ...(dynamicMode ? { dynamicTools: dynamicTools.tools } : {}) })).thread.id;
    turnId = (await transport.request('turn/start', { threadId, input: [{ type: 'text', text: childMode ? 'Delegate the shared logical task to a native child.' : 'Use the admitted hehebot proposal tool exactly once.' }] })).turn.id;
    await eventJournal.putIfAbsent(adapterAttempt, { threadId, nativeRunId: turnId, status: 'running', rootSettled: false });
    await router.bind(adapterAttempt);
  }
  nativeBound = true;
  let isolated;
  if (childMode) {
    const isolatedGrantPath = join(directory, 'unadmitted-grant.json');
    await writeFile(isolatedGrantPath, JSON.stringify({ origin: origin + '/', tokenFile: tokenPath, identity,
      runId: randomUUID(), attempt, allowedTools: ['hehebot_read_skill'] }), { mode: 0o600 });
    const isolatedServers = structuredClone(mcpServers);
    isolatedServers.hehebot.env.HEHEBOT_AGENT_TOOLS_CONFIG = isolatedGrantPath;
    const other = new CodexAdapter({ cwd: workspace, journal: eventJournal, rpc: adapter.rpc, testMode: true, mcpServers: isolatedServers });
    isolated = await other.submit({ attemptId: 'isolation-proof', installationId: 'mcp-fixture', personaId: persona.id,
      scope: 'conversation', scopeId: persona.id, model: 'fixture-model', message: 'UNRELATED_GRANT_PROOF' });
    assert.equal(isolated.status, 'running'); await router.bind('isolation-proof');
  }
  if (supervisorChildMode) {
    await waitFor(() => childFinalHeld, 'active child awaiting final inference');
    await router.flush();
    supervisor.children = new CodexTaskControl({ adapter, control, journal: eventJournal, identity, attemptId: adapterAttempt,
      parent: { runId, personaId: persona.id, attempt }, assertLease: () => supervisor.assertLease() });
    await supervisor.maintain();
    const mapped = await supervisor.children.sync();
    const [[key, child]] = Object.entries(mapped);
    const [targetThread, targetTurn] = JSON.parse(key);
    assert.equal(targetThread, childThreadId);
    assert.equal((await adapter.requireRun(adapterAttempt)).childTurns[key], 'inProgress');
    const cancelled = await ownerCommand('run.cancel', { run_id: child.runId, reason: 'Synthetic exact child cancellation' });
    assert.equal(cancelled.value.status, 'applied');
    const interrupts = [], rpc = adapter.rpc;
    adapter.rpc = (method, params) => { if (method === 'turn/interrupt') interrupts.push(params); return rpc(method, params); };
    await supervisor.maintain(); await supervisor.maintain();
    await waitFor(() => childFinalClosed, 'native interrupted child provider connection closure');
    check('owner cancellation flows through Worker heartbeat and real supervisor to one exact native child', () => {
      assert.deepEqual(interrupts, [{ threadId: targetThread, turnId: targetTurn }]);
      assert.equal(supervisor.phase, 'running'); assert.equal(adapter.sleepReadiness().allowed, false);
    });
    report.nativeSupervisorChildCancellation = true;
  }
  const completed = await waitFor(() => notifications.find(n => n.method === 'turn/completed' && (childMode ? n.params?.threadId === childThreadId : n.params?.threadId === threadId && n.params?.turn?.id === turnId)), 'native MCP continuation', 25_000);
  if (isolated) {
    const denied = await waitFor(() => notifications.find(n => n.method === 'turn/completed' && n.params?.threadId === isolated.threadId && n.params?.turn?.id === isolated.nativeRunId), 'unrelated root completion');
    assert.equal(denied.params.turn.status, 'completed');
    const history = await transport.request('thread/read', { threadId: isolated.threadId, includeTurns: true });
    assert.match(JSON.stringify(history.thread), /UNRELATED_GRANT_DENIED/);
  }
  check('native turn reached its expected terminal outcome after MCP continuation', () => assert.equal(completed.params.turn.status, supervisorChildMode ? 'interrupted' : 'completed'));
  await router.flush();
  const nativeCalls = await eventJournal.get(adapterAttempt);
  check(dynamicMode ? 'native dynamic tools enforce exact root identity before Worker commands' : 'native MCP invocation lifetimes are automatically journaled without effect authority', () => {
    if (dynamicMode) {
      assert.equal(dynamicCalls.length, 6); assert.equal(new Set(dynamicCalls.map(call => call.callId)).size, 6);
      assert.ok(dynamicCalls.every(call => call.threadId === threadId && call.turnId === turnId && call.success));
      assert.equal(nativeCalls.mcpCalls, undefined);
      assert.equal(Object.keys(nativeCalls.dynamicCalls ?? {}).length, 6);
      assert.ok(Object.values(nativeCalls.dynamicCalls).every(status => status === 'completed'));
    } else {
      const calls = childMode ? nativeCalls.childObligations?.[JSON.stringify([childThreadId, completed.params.turn.id])]?.mcpCalls : nativeCalls.mcpCalls;
      assert.equal(Object.keys(calls).length, 6);
      assert.ok(Object.values(calls).every(status => status === 'completed'));
    }
    assert.equal(nativeCalls.rootSettled, true); assert.equal(nativeCalls.effectsSettled, undefined);
    assert.equal(adapter.sleepReadiness().allowed, false); assert.deepEqual(routerFailures, []);
  });
  if (childMode) check('native child inherits task MCP grant and remains accounted after parent completion', () => {
    assert.deepEqual(Object.values(nativeCalls.spawns).flatMap(spawn => spawn.receiverThreadIds), [grandchildMode ? intermediateThreadId : childThreadId]);
    const expectedTurns = { [JSON.stringify([childThreadId, completed.params.turn.id])]: supervisorChildMode ? 'interrupted' : 'completed' };
    if (grandchildMode) {
      const intermediate = notifications.find(n => n.method === 'turn/completed' && n.params?.threadId === intermediateThreadId);
      const key = JSON.stringify([intermediateThreadId, intermediate.params.turn.id]);
      expectedTurns[key] = 'completed';
      assert.deepEqual(Object.values(nativeCalls.childObligations[key].spawns).flatMap(spawn => spawn.receiverThreadIds), [childThreadId]);
      assert.equal(nativeCalls.childObligations[key].mcpCalls, undefined);
      report.nativeGrandchildToolRouting = true;
    }
    assert.deepEqual(nativeCalls.childTurns, expectedTurns);
    assert.equal(nativeCalls.mcpCalls, undefined); assert.equal(router.pending.length, 0);
    assert.equal(dynamicCalls.length, 0);
  });
  if (childMode) {
    const lease = await control.request('heartbeat', { identity, operations: [] });
    let registrations = 0;
    const taskControl = new CodexTaskControl({ adapter, journal: eventJournal, identity, attemptId: adapterAttempt,
      parent: { runId, personaId: persona.id, attempt },
      assertLease: () => assert.ok(Date.now() < Date.parse(lease.lease_until)),
      control: { request: (type, payload) => { registrations++; return control.request(type, payload); } } });
    const mapped = await taskControl.sync(); await taskControl.sync();
    const current = await (await ownerFetch('/v1/state')).json();
    check('observed native descendants map idempotently to exact Worker task ancestry without completing them', () => {
      assert.equal(registrations, supervisorChildMode ? 0 : grandchildMode ? 2 : 1);
      assert.equal(Object.keys(mapped).length, grandchildMode ? 2 : 1);
      for (const [key, child] of Object.entries(mapped)) {
        const run = current.runs.find(run => run.id === child.runId);
        assert.equal(run.parent_run_id, child.receipt.parent_run_id);
        assert.equal(run.persona_id, persona.id); assert.equal(run.status, supervisorChildMode ? 'cancelling' : 'running');
        assert.equal(child.started, true);
        assert.equal(child.receipt.native_session_key, JSON.parse(key)[0]);
      }
      const leaf = mapped[JSON.stringify([childThreadId, completed.params.turn.id])];
      if (grandchildMode) assert.equal(leaf.receipt.parent_run_id, Object.entries(mapped).find(([key]) => JSON.parse(key)[0] === intermediateThreadId)[1].runId);
      else assert.equal(leaf.receipt.parent_run_id, runId);
      assert.equal(current.runs.find(run => run.id === runId).status, supervisorMode ? 'running' : 'claimed');
    });
  }
  const read = await transport.request('thread/read', { threadId: childMode ? childThreadId : threadId, includeTurns: true }); const transcript = JSON.stringify(read.thread);
  check('native receipts persisted with final response or observed owner interruption', () => { if (!supervisorChildMode) assert.match(transcript, /MCP_PROPOSAL_STAGED/); assert.match(transcript, /hehebot_propose_skill/); assert.match(transcript, new RegExp(proposalId)); });
  state = await (await ownerFetch('/v1/state')).json(); const proposal = state.skill_proposals.find(x => x.id === proposalId);
  if (supervisorMode) {
    await supervisor.maintain();
    const operations = await supervisor.operations();
    check('real heartbeat retains unknown native coverage after observed invocation termination', () => {
      assert.equal(operations.filter(op => op.status === 'unknown').length, 1);
      assert.equal(operations.find(op => op.kind === 'inference').status, 'settled');
      if (supervisorChildMode) {
        assert.equal(operations.length, 11);
        assert.equal(operations.filter(op => op.kind === 'inference' && op.status === 'settled').length, 2);
        assert.equal(operations.find(op => op.kind === 'child').status, 'settled');
        assert.equal(operations.filter(op => op.kind === 'tool' && op.status === 'settled').length, 7);
      }
      assert.ok(operations.every(op => op.run_id === runId && op.attempt === attempt));
    });
    const rejectedCompletion = await trustedFetch(origin + '/internal/complete', { method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ identity, run_id: runId, attempt,
        result: { status: 'completed', text: 'Root-only publication must fail' } }) });
    assert.equal(rejectedCompletion.status, 409);
    assert.match(JSON.stringify(await rejectedCompletion.json()), /CANCEL_UNCONFIRMED/);
    await assert.rejects(supervisor.complete({ attemptId: adapterAttempt, nativeRunId: turnId, rootSettled: true }), { code: 'NATIVE_SETTLEMENT_INCOMPLETE' });
    state = await (await ownerFetch('/v1/state')).json();
    check('root completion alone cannot publish a completed Worker result or release activity', () => {
      assert.equal(state.runs.find(run => run.id === runId).status, 'running'); assert.equal(supervisor.phase, 'running');
      assert.equal(state.runs.find(run => run.id === runId).routine_id, sourceRoutineId);
      assert.equal(state.objects.find(object => object.id === sourceRoutineId).body.enabled, false);
    });
  }
  check('actual control state has pending model/run provenance', () => { assert.equal(proposal.status, 'pending'); assert.equal(proposal.skill_id, skillId); assert.deepEqual(proposal.provenance, { kind: 'model', source_ref: runId }); assert.equal(proposal.executable_files_changed, false); });
  check('proposal did not auto-create or approve a skill', () => { assert.equal(state.objects.some(x => x.kind === 'skill' && x.id === skillId), false); assert.equal(state.skill_proposals.filter(x => x.id === proposalId).length, 1); });
  check('all inference was the scripted loopback fixture', () => { assert.equal(report.modelCalls, expectedModelCalls); assert.equal(toolRequests, 7); assert.deepEqual(fixtureErrors, []); });
  report.status = 'passed'; report.runId = runId; report.attempt = attempt; report.proposalId = proposalId; report.nativeReceiptObserved = true;
  }
} catch (error) {
  report.error = error?.stack ?? String(error); if (fixtureErrors.length) report.fixtureErrors = fixtureErrors;
  // Worker startup output can include the disposable runtime bearer. Keep it private.
  if (directory) await writeFile(join(directory, 'diagnostics.log'), workerLogs + nativeErrors.join(''), { mode: 0o600 });
  process.exitCode = 1;
} finally {
  supervisor?.disconnect();
  if (supervisor) { await supervisor.work; if (supervisor.maintenance) await supervisor.maintenance.catch(() => {}); }
  router?.close(); if (router) await router.tail;
  transport?.close(); if (transport) await stop(transport.child).catch(error => { report.status = 'failed'; report.error = error.message; process.exitCode = 1; });
  await stop(worker).catch(error => { report.status = 'failed'; report.error = error.message; process.exitCode = 1; });
  if (fixture) { fixture.closeAllConnections(); await new Promise(ok => fixture.close(ok)); }
  await dispatcher?.close();
  report.externalModelCalls = 0;
  report.note = 'Execution/native flags, FakeProvider, TLS CA, runtime token, MCP grant, Codex home, model fixture, and SQLite are disposable process-local test state; production configuration is untouched.';
  if (['passed', 'blocked'].includes(report.status) && directory) await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}
