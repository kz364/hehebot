#!/usr/bin/env node
// Disposable actual Codex -> assembled host -> MCP -> HTTPS Worker -> SQLite.
// Sprite Tasks transport is synthetic; this does not verify live provider holds.
import assert from 'node:assert/strict';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, readdir, readlink, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Agent } from 'undici';
import { createSpriteCodexService } from '../runtime/sprites-codex-service.mjs';
import { createCodexService } from '../runtime/codex-service.mjs';
import { ControlClient } from '../runtime/control-client.mjs';
import { spawnCodex } from '../runtime/codex-transport.mjs';
import { inspectCodexRecovery } from '../runtime/codex-recovery-inspect.mjs';
import { codexTextOnlyProfileSha256, createCodexTextOnlyProfile } from '../runtime/codex-text-only.mjs';

const root = resolve(import.meta.dirname, '..');
const textOnlyMode = process.argv.includes('--text-only');
const ownerAlphaBackgroundMode = process.argv.includes('--owner-alpha-background');
const ownerAlphaMultiMode = process.argv.includes('--owner-alpha-multi');
const ownerAlphaMode = process.argv.includes('--owner-alpha') || ownerAlphaMultiMode || ownerAlphaBackgroundMode || textOnlyMode;
const restrictedMode = process.argv.includes('--restricted-background') || ownerAlphaMode;
const backgroundMode = process.argv.includes('--background-responsive') || process.argv.includes('--restricted-background') || ownerAlphaBackgroundMode;
const effectsMode = process.argv.includes('--child-effects');
const historyChildMode = process.argv.includes('--history-child');
const planChildMode = process.argv.includes('--plan-child');
const childMode = process.argv.includes('--child') || effectsMode || historyChildMode || planChildMode || backgroundMode;
const crashMode = process.argv.includes('--crash');
const historyMode = process.argv.includes('--history') || historyChildMode;
const questionCancelMode = process.argv.includes('--questions-cancel');
const questionsMode = process.argv.includes('--questions') || questionCancelMode;
const submissionAckMode = process.argv.includes('--submission-ack');
const operationPagesMode = process.argv.includes('--operation-pages');
const reasoningMode = process.argv.includes('--reasoning');
const planMode = process.argv.includes('--plan') || planChildMode;
const portalMode = process.argv.includes('--portal-readback') || backgroundMode || (ownerAlphaMode && !textOnlyMode);
const browserSession = `service-${randomUUID().slice(0, 8)}`;
const browser = (...args) => promisify(execFile)('agent-browser', ['--session', browserSession, '--ignore-https-errors', ...args], { timeout: 30000 });
const expectedToolCalls = operationPagesMode ? 101 : 1;
const questionAnswers = { route43: { answers: ['West43'] }, timing19: { answers: [] } };
assert.ok(process.argv.slice(2).length <= 1 && process.argv.slice(2).every(arg => ['--child', '--crash', '--child-effects', '--questions', '--questions-cancel', '--history', '--history-child', '--submission-ack', '--operation-pages', '--reasoning', '--plan', '--plan-child', '--portal-readback', '--background-responsive', '--restricted-background', '--owner-alpha', '--owner-alpha-multi', '--owner-alpha-background', '--text-only'].includes(arg)), 'Unknown fixture option');
const sleep = ms => new Promise(ok => setTimeout(ok, ms));
async function wait(fn, label, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await sleep(25); }
  throw new Error(`Timed out: ${label}`);
}
async function port() {
  const server = createServer(); await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  const result = server.address().port; await new Promise(ok => server.close(ok)); return result;
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  try { await wait(() => child.exitCode !== null || child.signalCode !== null, 'worker stop', 5000); }
  catch { child.kill('SIGKILL'); await wait(() => child.exitCode !== null || child.signalCode !== null, 'worker forced stop', 2000); }
}
async function send(res, output, duringPlan = undefined) {
  const response = { id: `resp_${randomUUID()}`, object: 'response', created_at: 1, status: 'completed', error: null,
    incomplete_details: null, model: 'fixture-model', output, parallel_tool_calls: true, tools: [], tool_choice: 'auto',
    usage: { input_tokens: 31, input_tokens_details: { cached_tokens: 7 }, output_tokens: 13,
      output_tokens_details: { reasoning_tokens: 5 }, total_tokens: 44 } };
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const event = (type, fields) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`);
  event('response.created', { response: { ...response, status: 'in_progress', output: [] } });
  for (const [output_index, item] of output.entries()) {
    event('response.output_item.added', { output_index, item: { ...item, ...(item.type === 'function_call' ? { arguments: '' } : { content: [] }) } });
    if (item.type === 'function_call') event('response.function_call_arguments.done', { output_index, item_id: item.id, arguments: item.arguments });
    else if (item.type === 'message') {
      event('response.content_part.added', { output_index, item_id: item.id, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
      const text = item.content[0].text;
      if (duringPlan) {
        const split = text.indexOf('</proposed_plan>'), continuation = text.indexOf('PRIVATE_PLAN_43');
        assert.ok(continuation > 0 && split > continuation);
        event('response.output_text.delta', { output_index, item_id: item.id, content_index: 0, delta: text.slice(0, continuation) });
        await duringPlan(() => event('response.output_text.delta', {
          output_index, item_id: item.id, content_index: 0, delta: text.slice(continuation, split),
        }));
        if (res.destroyed) return; // Exact child interruption can close an open Plan stream.
        event('response.output_text.delta', { output_index, item_id: item.id, content_index: 0, delta: text.slice(split) });
      } else event('response.output_text.delta', { output_index, item_id: item.id, content_index: 0, delta: text });
      event('response.output_text.done', { output_index, item_id: item.id, content_index: 0, text: item.content[0].text });
      event('response.content_part.done', { output_index, item_id: item.id, content_index: 0, part: item.content[0] });
    }
    event('response.output_item.done', { output_index, item });
  }
  event('response.completed', { response }); res.end('data: [DONE]\n\n');
}
const directory = await mkdtemp(join(tmpdir(), 'hehe-service-native-'));
const report = { status: 'failed', modelRequests: 0, nativeReceipt: false, spriteHoldLive: false, assistantOperational: false };
let worker, service, model, dispatcher, workerLogs = '', bound = false;
let toolRequests = 0, childThreadId, childHeld = false, childClosed = false;
let nativeTransport, nativeLaunches = 0, crashHeld = false, crashClosed = false;
let backgroundChild, independentHeld = false, independentClosed = false;
const statusText = 'SERVICE_STATUS_S_71', independentText = 'SERVICE_INDEPENDENT_B_103';
const statusOutput = 'SERVICE_STATUS_PROVISIONAL_71: A remains active; this is not a completed result.';
const alphaFirstText = 'OWNER_ALPHA_MULTI_FIRST_19', alphaSecondText = 'OWNER_ALPHA_MULTI_SECOND_43';
const alphaOutputs = new Map();
const interrupts = [], notifications = [];
const nativeStarts = [];
const errors = [], taskRequests = [];
try {
  const workerPort = await port(), token = randomBytes(32).toString('hex');
  const catalogPath = join(directory, 'text-only-models.json');
  const textOnlyProfileInput = textOnlyMode ? { codexVersion: '0.154.0', model: 'fixture-model', catalogPath,
    modelCatalog: { models: [{ slug: 'fixture-model', display_name: 'Synthetic text-only service fixture', description: null,
      supported_reasoning_levels: [], shell_type: 'unified_exec', visibility: 'list', supported_in_api: true,
      priority: 1, upgrade: null, model_messages: { instructions_template: 'Synthetic credential-free native fixture.', instructions_variables: null },
      default_reasoning_summary: 'auto', support_verbosity: false, tool_mode: 'direct', default_verbosity: null,
      apply_patch_tool_type: null, truncation_policy: { mode: 'bytes', limit: 10000 }, supports_image_detail_original: false,
      context_window: 272000, auto_compact_token_limit: null, effective_context_window_percent: 95,
      experimental_supported_tools: [] }] },
    catalogValidation: 'synthetic-fixture', syntheticFixture: true } : undefined;
  const textOnlyProfile = textOnlyMode ? createCodexTextOnlyProfile(textOnlyProfileInput) : undefined;
  if (textOnlyProfile) await writeFile(catalogPath, JSON.stringify(textOnlyProfile.modelCatalog), { mode: 0o600 });
  const ownerAlpha = { session_id: randomUUID(), persona_id: '11111111-1111-4111-8111-111111111111',
    expires_at: new Date(Date.now() + 300000).toISOString(), max_runs: ownerAlphaBackgroundMode ? 3 : ownerAlphaMultiMode ? 2 : 1,
    max_task_seconds: ownerAlphaBackgroundMode ? 120 : textOnlyMode ? 120 : 15,
    ...(ownerAlphaBackgroundMode ? { background_first_root: true } : {}),
    ...(textOnlyProfile ? { text_only: { profile_version: textOnlyProfile.version,
      profile_sha256: codexTextOnlyProfileSha256(textOnlyProfile) } } : {}) };
  const routinePolicy = 'f0ff3ead-1e31-4f83-bbc2-aa25f069a962';
  const cert = join(directory, 'cert.pem'), key = join(directory, 'key.pem');
  await promisify(execFile)('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', key, '-out', cert]);
  worker = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--env', 'local', '--ip', '127.0.0.1',
    '--port', String(workerPort), '--persist-to', join(directory, 'worker'), '--local-protocol', 'https', '--https-key-path', key, '--https-cert-path', cert,
    '--var', `EXECUTION_ENABLED:${!ownerAlphaMode}`, '--var', `NATIVE_VERIFIED:${!ownerAlphaMode}`, '--var', `RUNTIME_TOKEN:${token}`,
    '--var', `TOOL_POLICY_IDS:${JSON.stringify([routinePolicy])}`,
    ...(effectsMode ? ['--var', `ACTION_POLICY_IDS:${JSON.stringify([routinePolicy])}`] : []),
    ...(ownerAlphaMode ? ['--var', `HEHEBOT_OWNER_ALPHA:${JSON.stringify(ownerAlpha)}`, '--var', 'PROVIDER_CONFIG:{}']
      : ['--var', `PROVIDER_CONFIG:${JSON.stringify({ provider: 'fake', ref: { provider: 'fake', id: 'assembly-fixture' } })}`])],
    { cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: join(directory, 'logs') }, stdio: ['ignore', 'pipe', 'pipe'] });
  worker.stdout.on('data', chunk => { workerLogs += chunk; }); worker.stderr.on('data', chunk => { workerLogs += chunk; });
  await wait(() => workerLogs.replace(/\u001b\[[0-9;]*m/g, '').includes(`Ready on https://127.0.0.1:${workerPort}`), 'Worker readiness', 45000);
  const origin = `https://127.0.0.1:${workerPort}`;
  dispatcher = new Agent({ connect: { ca: await readFile(cert) } });
  const trustedFetch = (url, init) => fetch(url, { ...init, dispatcher });
  const initialState = await trustedFetch(`${origin}/v1/state`);
  assert.equal(initialState.status, 200, 'Worker must accept the explicit fixture policy before any inference');
  const state = await initialState.json();
  const persona = state.objects.find(object => object.kind === 'persona');
  const adopted = await (await trustedFetch(`${origin}/v1/commands`, { method: 'POST', headers: {
    'content-type': 'application/json', Origin: origin, 'idempotency-key': randomUUID(),
  }, body: JSON.stringify({ schema_version: 1, type: 'persona.put', payload: { ...persona.body,
    id: persona.id, expected_revision: persona.revision, tool_policy_ids: [routinePolicy] } }) })).json();
  assert.equal(adopted.status, 'applied');
  const routine = { id: randomUUID(), expected_revision: 0, persona_id: persona.id, name: 'Assembly fixture 19 versus 43',
    instructions: `${effectsMode ? 'SERVICE_ASSEMBLY_19_43 ' : ''}Compare 19 against 43 without external effects.`, enabled: false,
    schedule: { cron: '0 8 * * 1-5', timezone: 'Asia/Jakarta' }, trigger_source_id: null, action_policy_ids: effectsMode ? [routinePolicy] : [],
    policy: { misfire: 'coalesce', overlap: 'queue_one', max_replay: 1, max_lateness_seconds: 60 } };
  const saved = await (await trustedFetch(`${origin}/v1/commands`, { method: 'POST', headers: {
    'content-type': 'application/json', Origin: origin, 'idempotency-key': randomUUID(),
  }, body: JSON.stringify({ schema_version: 1, type: 'routine.put', payload: routine }) })).json();
  assert.equal(saved.status, 'applied');
  let queued;
  if (portalMode) {
    await browser('open', origin); await browser('set', 'viewport', '1280', '900', '2');
    await browser('wait', '--fn', 'document.querySelector("#connection").textContent === "Connected"');
    await browser('click', `[data-persona-id="${persona.id}"]`);
    // Observe the real UI's receipt, without replacing its transport or server response.
    await browser('eval', `window.fixtureReceipts=[];window.fixtureFetch=window.fetch;window.fetch=async(...args)=>{const response=await window.fixtureFetch(...args);if(args[0]==='/v1/commands'&&args[1]?.method==='POST')window.fixtureReceipts.push({request:JSON.parse(args[1].body),key:args[1].headers['Idempotency-Key'],receipt:await response.clone().json()});return response;}`);
    const initialPortalText = ownerAlphaMultiMode ? alphaFirstText : 'SERVICE_ASSEMBLY_19_43';
    await browser('fill', '#message', initialPortalText); await browser('click', '#send');
    await browser('wait', '--fn', 'window.fixtureReceipts.length === 1');
    const [observed] = JSON.parse((await browser('eval', 'window.fixtureReceipts')).stdout);
    assert.deepEqual(observed.request, { schema_version: 1, type: 'message.send', payload: { conversation_id: persona.id, text: initialPortalText } });
    assert.match(observed.key, /^[0-9a-f-]{36}$/); queued = observed.receipt;
    await browser('close');
    report.portalMessageSubmitted = true;
  } else queued = await (await trustedFetch(`${origin}/v1/commands`, { method: 'POST', headers: {
    'content-type': 'application/json', Origin: origin, 'idempotency-key': randomUUID(),
  }, body: JSON.stringify(effectsMode
    ? { schema_version: 1, type: 'routine.run', payload: { id: routine.id, expected_revision: 1 } }
    : { schema_version: 1, type: 'message.send', payload: { conversation_id: persona.id, text: 'SERVICE_ASSEMBLY_19_43' } }) })).json();
  assert.equal(queued.status, 'applied');
  const control = new ControlClient({ origin: origin + '/', token, fetchImpl: trustedFetch });
  if (ownerAlphaMode) assert.deepEqual(await control.request('status', {}), {
    phase: 'STOPPED', epoch: 0, execution_enabled: false, owner_alpha: ownerAlpha,
  });
  else await wait(async () => (await control.request('status', {})).phase === 'BOOTING', 'FakeProvider boot');
  model = createServer(async (req, res) => {
    try {
      assert.equal(req.url, '/v1/responses');
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      assert.equal(body.model, 'fixture-model', 'Native requests use the host-declared selected model');
      report.modelRequests++;
      assert.ok(report.modelRequests <= (ownerAlphaBackgroundMode ? 7 : ownerAlphaMultiMode ? 4 : backgroundMode ? 6 : childMode ? 4 : questionsMode && !questionCancelMode ? 3 : 2), 'Unexpected model continuation');
      if (restrictedMode) {
        const tools = body.tools.flatMap(tool => tool.type === 'namespace' ? tool.tools.map(nested => `${tool.name}.${nested.name}`) : [tool.name]);
        assert.ok(!tools.some(name => /(^|\.)sleep$/.test(name)), 'Restricted root/child cannot request durable sleep');
      }
      await wait(() => bound, 'service acknowledged root');
      if (textOnlyMode) {
        assert.deepEqual(body.tools, [], 'Text-only provider request must have no tools');
        assert.match(JSON.stringify(body.input), /SERVICE_ASSEMBLY_19_43/);
        await send(res, [{ id: 'text_only_answer_43', type: 'message', status: 'completed', role: 'assistant',
          content: [{ type: 'output_text', text: 'SERVICE_TEXT_ONLY_COMPLETE_43', annotations: [] }] }]);
        return;
      }
      const actualContexts = body.input.filter(item => item.role === 'user').flatMap(item => {
        const content = typeof item.content === 'string' ? [item.content] : (item.content ?? []).map(part => part.text);
        return content.flatMap(text => { try { return [JSON.parse(text)]; } catch { return []; } });
      });
      const alphaContext = actualContexts.find(candidate => [alphaFirstText, alphaSecondText].includes(candidate.instruction));
      if (ownerAlphaMultiMode && alphaContext) {
        const key = alphaContext.instruction;
        const count = (alphaOutputs.get(key) ?? 0) + 1; alphaOutputs.set(key, count);
        if (key === alphaSecondText && count === 1) {
          report.secondActualContext = { instruction: alphaContext.instruction,
            task_summaries: alphaContext.task_summaries ?? [], context_events: alphaContext.context_events ?? [],
            conversation_history: alphaContext.conversation_history };
          report.secondInputContainsFirstTask = JSON.stringify(body.input).includes(alphaFirstText);
          assert.equal(alphaContext.conversation_history.messages[0].provisional_reply.text, `${alphaFirstText}_PROVISIONAL`);
        }
        if (count === 1) {
          const tool = body.tools.find(tool => tool.name?.includes('hehebot_list_routines')) ?? body.tools.find(tool => tool.name === 'mcp__hehebot');
          assert.ok(tool, `read-only MCP advertised for ${key}`);
          await send(res, [{ id: `fc_${randomUUID()}`, type: 'function_call', status: 'completed', call_id: `call_${randomUUID()}`,
            ...(tool.name === 'mcp__hehebot' ? { namespace: 'mcp__hehebot', name: 'hehebot_list_routines' } : { name: tool.name }), arguments: '{}' }]);
        } else {
          const outputs = body.input.filter(item => item.type === 'function_call_output');
          assert.equal(outputs.length, 1);
          const decoded = typeof outputs[0].output === 'string' ? JSON.parse(outputs[0].output) : outputs[0].output;
          const content = Array.isArray(decoded) ? JSON.parse(decoded.at(-1).text) : decoded;
          const receipt = content.content ? JSON.parse(content.content.find(item => item.type === 'text').text) : content;
          assert.equal(receipt.next_cursor, null); assert.equal(receipt.routines.length, 1);
          assert.equal(receipt.routines[0].id, routine.id); assert.deepEqual(receipt.routines[0].body, routine);
          report.nativeReceipt = true;
          await send(res, [{ id: `msg_${randomUUID()}`, type: 'message', status: 'completed', role: 'assistant',
            content: [{ type: 'output_text', text: `${key}_PROVISIONAL`, annotations: [] }] }]);
        }
        return;
      }
      if (backgroundMode) {
        // Inspect the actual provider input, not a fabricated context or the claim alone.
        const contexts = body.input.filter(item => item.role === 'user').flatMap(item => {
          const content = typeof item.content === 'string' ? [item.content] : (item.content ?? []).map(part => part.text);
          return content.flatMap(text => { try { return [JSON.parse(text)]; } catch { return []; } });
        });
        const context = contexts.find(candidate => [statusText, independentText].includes(candidate.instruction));
        if (context?.instruction === statusText) {
          assert.ok(backgroundChild, 'A registered before status submission');
          const summary = context.task_summaries?.find(task => task.id === backgroundChild.id);
          assert.ok(summary, 'Actual S model input contains A task summary');
          assert.equal(summary.status, 'running');
          assert.equal(summary.title, backgroundChild.title);
          if (ownerAlphaBackgroundMode) {
            const denial = body.input.find(item => item.type === 'function_call_output' && item.call_id === 'forbidden_status_spawn');
            if (!denial) {
              await send(res, [{ id: 'fc_forbidden_status_spawn', type: 'function_call', status: 'completed',
                call_id: 'forbidden_status_spawn', name: 'spawn_agent', arguments: JSON.stringify({ message: 'FORBIDDEN_STATUS_CHILD' }) }]);
              return;
            }
            assert.equal(denial.output, 'unsupported call: spawn_agent');
            report.statusRootSpawnDenied = true;
          }
          report.statusModelSawChildSummary = true;
          await send(res, [{ id: `msg_${randomUUID()}`, type: 'message', status: 'completed', role: 'assistant',
            content: [{ type: 'output_text', text: statusOutput, annotations: [] }] }]);
          return;
        }
        if (context?.instruction === independentText) {
          independentHeld = true;
          res.once('close', () => { if (!res.writableEnded) independentClosed = true; });
          return;
        }
      }
      if (report.modelRequests === 1) {
        assert.equal((await service.observe()).initialInference, 'inProgress');
        const initial = (await service.supervisor.operations()).filter(operation => operation.kind === 'inference' &&
          Date.parse(operation.deadline_at) === Math.min(Date.parse(dispatched.claim.deadline_at), Date.parse(operation.started_at) + 300000));
        // A <=5-minute alpha also caps the independent root-lifetime record here.
        assert.equal(initial.length, ownerAlphaMode ? 2 : 1); assert.ok(initial.every(op => op.status === 'active'));
        report.initialSilenceBounded = true;
      }
      if (questionsMode && report.modelRequests === 3) {
        const result = body.input.find(item => item.type === 'function_call_output' && item.call_id === 'question_call_43');
        assert.deepEqual(JSON.parse(result.output), { answers: questionAnswers });
        report.nativeQuestionAnswerContext = true;
        await send(res, [{ id: `msg_${randomUUID()}`, type: 'message', status: 'completed', role: 'assistant',
          content: [{ type: 'output_text', text: 'SERVICE_ASSEMBLY_OK', annotations: [] }] }]);
        return;
      }
      if (childMode) {
        const isChild = body.input.some(item => (item.role === 'user' || ownerAlphaBackgroundMode &&
          item.type === 'agent_message' && item.author === '/root' && item.recipient === '/root/child_a') &&
          JSON.stringify(item.content).includes('SERVICE_CHILD_PROOF'));
        if (!isChild) {
          assert.match(JSON.stringify(body.input), /SERVICE_ASSEMBLY_19_43/);
          const output = body.input.find(item => item.type === 'function_call_output');
          if (output) {
            const spawned = JSON.parse(String(output.output));
            if (ownerAlphaBackgroundMode) {
              assert.equal(spawned.task_name, '/root/child_a');
              await wait(async () => {
                const receivers = Object.values((await service.observe())?.spawns ?? {}).flatMap(spawn => spawn.receiverThreadIds);
                if (receivers.length !== 1) return false;
                childThreadId = receivers[0]; return true;
              }, 'V2 observed spawn identity');
            } else childThreadId = spawned.agent_id;
            assert.equal(typeof childThreadId, 'string');
            await send(res, [{ id: `msg_${randomUUID()}`, type: 'message', status: 'completed', role: 'assistant',
              content: [{ type: 'output_text', text: 'SERVICE_PARENT_DONE', annotations: [] }] }]);
          } else {
            const tool = body.tools.find(tool => tool.name === 'spawn_agent' || tool.tools?.some(nested => nested.name === 'spawn_agent'));
            assert.ok(tool, 'native spawn tool advertised');
            await send(res, [{ id: `fc_${randomUUID()}`, type: 'function_call', status: 'completed', call_id: `call_${randomUUID()}`,
              ...(tool.type === 'namespace' ? { namespace: tool.name } : {}), name: 'spawn_agent',
              arguments: JSON.stringify({ message: 'SERVICE_CHILD_PROOF', agent_type: 'default',
                ...(ownerAlphaBackgroundMode ? { task_name: 'child_a', fork_turns: 'none' } : {}) }) }]);
          }
          return;
        }
        await wait(async () => (await service.observe())?.rootSettled, 'parent terminal before child MCP');
        if (toolRequests === 0) {
          await wait(async () => Object.values((await service.observe()).childObligations ?? {}).some(child => child.initialInference === 'inProgress'), 'child initial phase');
          const phases = (await service.supervisor.operations()).filter(operation => operation.kind === 'inference' && operation.status === 'active');
          assert.equal(phases.length, 1); // Child lifetime is kind=child, unlike root lifetime.
          if (ownerAlphaBackgroundMode) assert.ok(phases.every(op => op.deadline_at === dispatched.claim.deadline_at));
          else assert.equal(Date.parse(phases[0].deadline_at) - Date.parse(phases[0].started_at), 300000);
          report.childInitialSilenceBounded = true;
        }
      } else assert.match(JSON.stringify(body.input), /SERVICE_ASSEMBLY_19_43/);
      toolRequests++;
      if (toolRequests === 1) {
        const tool = body.tools.find(tool => tool.name?.includes('hehebot_list_routines')) ?? body.tools.find(tool => tool.name === 'mcp__hehebot');
        assert.ok(tool);
        await send(res, [...(childMode ? [{ id: `msg_${randomUUID()}`, type: 'message', status: 'completed', role: 'assistant', phase: 'commentary',
          content: [{ type: 'output_text', text: 'SERVICE_CHILD_PROGRESS', annotations: [] }] }] : []),
          ...(reasoningMode ? [{ id: 'rs_fixture_43', type: 'reasoning', summary: [{ type: 'summary_text', text: 'PRIVATE_SYNTHETIC_REASONING_43' }] }] : []),
          ...Array.from({ length: expectedToolCalls }, () => ({ id: `fc_${randomUUID()}`, type: 'function_call', status: 'completed', call_id: `call_${randomUUID()}`,
          ...(tool.name === 'mcp__hehebot' ? { namespace: 'mcp__hehebot', name: 'hehebot_list_routines' } : { name: tool.name }), arguments: '{}' }))]);
      } else {
        assert.equal(toolRequests, 2);
        const outputs = body.input.filter(item => item.type === 'function_call_output');
        assert.equal(outputs.length, expectedToolCalls);
        for (const { output } of outputs) {
          const decoded = typeof output === 'string' ? JSON.parse(output) : output;
          const content = Array.isArray(decoded) ? JSON.parse(decoded.at(-1).text) : decoded;
          const receipt = content.content ? JSON.parse(content.content.find(item => item.type === 'text').text) : content;
          assert.equal(receipt.next_cursor, null); assert.equal(receipt.routines.length, 1);
          assert.equal(receipt.routines[0].id, routine.id); assert.equal(receipt.routines[0].revision, 1);
          assert.deepEqual(receipt.routines[0].body, routine); report.nativeReceipt = true;
        }
        if (!historyMode) {
          await wait(async () => {
            const row = await service.observe();
            return [row, ...Object.values(row.childObligations ?? {})].some(owner => Object.values(owner.quietPhases ?? {}).some(phase => phase.status === 'inProgress'));
          }, 'post-tool quiet phase');
          const phases = (await service.supervisor.operations()).filter(operation => operation.kind === 'inference' &&
            operation.status === 'active' && Date.parse(operation.deadline_at) === Math.min(Date.parse(dispatched.claim.deadline_at), Date.parse(operation.started_at) + 300000));
          assert.equal(phases.length, ownerAlphaMode && !childMode ? 2 : 1); report.postToolSilenceBounded = true;
        }
        if (questionsMode) {
          const tool = body.tools.find(tool => tool.name === 'request_user_input' || tool.tools?.some(nested => nested.name === 'request_user_input'));
          assert.ok(tool);
          await send(res, [{ id: 'question_item_43', type: 'function_call', status: 'completed', call_id: 'question_call_43',
            ...(tool.type === 'namespace' ? { namespace: tool.name } : {}), name: 'request_user_input', arguments: JSON.stringify({ questions: [
              { id: 'route43', header: 'Route', question: 'Choose route', options: [{ label: 'West43', description: 'Western' }, { label: 'East19', description: 'Eastern' }] },
              { id: 'timing19', header: 'Timing', question: 'Choose timing', options: [{ label: 'Now19', description: 'Now' }, { label: 'Later43', description: 'Later' }] },
            ] }) }]);
          return;
        }
        if (childMode && !planChildMode) {
          childHeld = true;
          res.once('close', () => { if (!res.writableEnded) childClosed = true; });
          return;
        }
        if (crashMode) {
          crashHeld = true;
          res.once('close', () => { if (!res.writableEnded) crashClosed = true; });
          return;
        }
        await send(res, [{ id: `msg_${randomUUID()}`, type: 'message', status: 'completed', role: 'assistant',
          content: [{ type: 'output_text', text: planMode ? 'SERVICE_ASSEMBLY_OK\n<proposed_plan>\nPLAN_START_19\nPRIVATE_PLAN_43\n</proposed_plan>' : 'SERVICE_ASSEMBLY_OK', annotations: [] }] }], planMode ? async continuePlan => {
            if (planChildMode) {
              // 0.154.0 spawn_agent starts its child in Default mode, even when
              // the parent is in Plan. Prove native behavior, not invented Plan events.
              const row = await wait(async () => {
                const current = await service.observe();
                const owner = Object.values(current.childObligations ?? {})[0];
                return Object.keys(owner?.messageStarts ?? {}).length === 2 && current;
              }, 'open native child message containing proposed_plan');
              const [childKey] = Object.keys(row.childObligations);
              const owner = row.childObligations[childKey];
              const [threadId, turnId] = JSON.parse(childKey);
              const messageId = Object.keys(owner.messageStarts).find(id => !Object.hasOwn(owner.outputItems ?? {}, id));
              assert.equal(threadId, childThreadId); assert.notEqual(threadId, row.threadId);
              assert.equal(row.rootSettled, true); assert.equal(row.childTurns[childKey], 'inProgress');
              assert.deepEqual(row.planItems ?? {}, {}); assert.deepEqual(owner.planItems ?? {}, {});
              assert.ok(notifications.some(n => n.method === 'item/started' && n.params.threadId === threadId &&
                n.params.turnId === turnId && n.params.item.id === messageId && n.params.item.type === 'agentMessage'));
              await wait(() => notifications.some(n => n.method === 'item/agentMessage/delta' && n.params.threadId === threadId &&
                n.params.turnId === turnId && n.params.itemId === messageId && n.params.delta.includes('<proposed_plan>')), 'literal child plan tag delta');
              const before = await service.supervisor.operations();
              const active = before.filter(op => op.kind === 'inference' && op.status === 'active');
              assert.equal(active.length, 2); // Open message plus its quiet-inference phase, not a Plan item.
              const timing = owner.operationTimes[JSON.stringify(['messageStarts', messageId])];
              for (const op of active) {
                assert.equal(op.run_id, queued.resource_id);
                assert.equal(op.started_at, timing.startedAt);
                assert.equal(op.last_progress_at, timing.lastProgressAt);
                assert.equal(Date.parse(op.deadline_at) - Date.parse(op.started_at), 300000);
              }
              // Pin the child namespace independently of timestamps (root and
              // child clocks may coincide). Heartbeats charge the logical root.
              const hex = createHash('sha256').update(JSON.stringify([dispatched.attemptId, queued.resource_id,
                dispatched.claim.run.current_attempt, [childKey, 'messageStarts', messageId]])).digest('hex');
              const expectedId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
              assert.ok(active.some(op => op.id === expectedId));
              await sleep(40); // A refreshed clock cannot accidentally equal the original millisecond.
              continuePlan();
              await wait(() => notifications.some(n => n.method === 'item/agentMessage/delta' && n.params.threadId === threadId &&
                n.params.turnId === turnId && n.params.itemId === messageId && n.params.delta.includes('PRIVATE_PLAN_43')), 'exact child message delta');
              assert.deepEqual(await service.observe(), row);
              assert.deepEqual(await service.supervisor.operations(), before);
              await service.maintain();
              assert.deepEqual(heartbeatPages.at(-1), before);
              await assert.rejects(service.supervisor.complete({ attemptId: dispatched.attemptId, nativeRunId: row.nativeRunId, rootSettled: true }), { code: 'NATIVE_SETTLEMENT_INCOMPLETE' });
              await assert.rejects(service.supervisor.drain({ state: 'open-child-plan-tag' }), { code: 'SLEEP_DENIED' });
              Object.assign(report, { childPlanEmission: false, childPlanTagIsMessageDelta: true,
                exactChildMessageNamespace: true, childDeltaClockUnchanged: true,
                activeChildStreamHeartbeatAccepted: true, openChildStreamPreventsSettlementAndSleep: true });
              childHeld = true;
              await new Promise(resolve => res.once('close', () => { childClosed = !res.writableEnded; resolve(); }));
              return;
            }
            const row = await wait(async () => {
              const current = await service.observe();
              return Object.values(current.planItems ?? {}).includes('inProgress') && current;
            }, 'open native plan stream');
            assert.equal(row.rootSettled, false);
            assert.doesNotMatch(JSON.stringify(row), /PRIVATE_PLAN_43/);
            const active = (await service.supervisor.operations()).filter(op => op.kind === 'inference' && op.status === 'active' &&
              Date.parse(op.deadline_at) - Date.parse(op.started_at) === 300000);
            assert.equal(active.length, 2); // The enclosing message and plan are both still streaming.
            assert.equal(new Set(active.map(op => op.id)).size, 2);
            const [planId] = Object.keys(row.planItems);
            const [messageId] = Object.keys(row.messageStarts);
            assert.deepEqual(active.map(op => op.started_at).sort(), [
              row.operationTimes[JSON.stringify(['planItems', planId])].startedAt,
              row.operationTimes[JSON.stringify(['messageStarts', messageId])].startedAt,
            ].sort());
            continuePlan();
            await wait(() => notifications.some(n => n.method === 'item/plan/delta' && n.params.threadId === row.threadId &&
              n.params.turnId === row.nativeRunId && n.params.itemId === planId && n.params.delta.includes('PRIVATE_PLAN_43')), 'attributed native plan delta');
            assert.deepEqual(await service.observe(), row);
            const reread = await service.supervisor.operations();
            for (const op of active) assert.deepEqual(reread.find(candidate => candidate.id === op.id), op);
            await service.maintain();
            for (const op of active) assert.deepEqual(heartbeatPages.at(-1).find(candidate => candidate.id === op.id), op);
            report.planDeltaClockUnchanged = true;
            report.activePlanHeartbeatAccepted = true;
            report.planStreamActiveBounded = true;
          } : undefined);
      }
    } catch (error) {
      errors.push(error.message);
      if (!res.headersSent) await send(res, [{ id: `msg_${randomUUID()}`, type: 'message', status: 'completed', role: 'assistant',
        content: [{ type: 'output_text', text: 'FIXTURE_FAILED', annotations: [] }] }]);
      else res.end();
    }
  });
  await new Promise(ok => model.listen(0, '127.0.0.1', ok));
  const stateDirectory = join(directory, 'state'); await mkdir(stateDirectory, { mode: 0o700 });
  const runtimeTokenFile = join(directory, 'token'); await writeFile(runtimeTokenFile, token, { mode: 0o600 });
  let held;
  const spriteRequest = (options, callback) => {
    assert.equal(options.socketPath, '/.sprite/api.sock'); assert.equal(options.headers.Authorization, undefined);
    taskRequests.push(options.method);
    const req = new EventEmitter(); req.setTimeout = () => {}; req.destroy = () => {};
    req.end = data => {
      if (options.method === 'PUT') held = { name: options.path.split('/').at(-1), expires_at: new Date(Date.now() + JSON.parse(data).expire * 1000).toISOString() };
      else assert.equal(options.method, 'GET');
      const res = new EventEmitter(); res.statusCode = 200; callback(res);
      res.emit('data', Buffer.from(JSON.stringify(options.method === 'GET' ? held : {}))); res.emit('end');
    };
    return req;
  };
  const config = { ...(ownerAlphaMode ? { ownerAlpha } : { disposableTest: true }), stateDirectory, binary: join(root, '.local/codex-runtime/node_modules/.bin/codex'),
    ...(questionsMode ? { ownerQuestions: true } : {}),
    ...(restrictedMode ? { restrictedPermissions: true } : {}),
    portalOrigin: origin + '/', runtimeTokenFile, tlsCAFile: cert, installationId: 'service-fixture',
    ...(textOnlyProfileInput ? { textOnlyProfile: textOnlyProfileInput } : {}),
    personas: { [persona.id]: { agentId: 'assistant', model: 'fixture-model',
      allowedTools: textOnlyMode ? [] : ['hehebot_list_routines'] } } };
  const submissionRequests = [], heartbeatPages = [], coordinatorReleases = [];
  const dependencies = { spriteRequest, fetchImpl: async (url, init) => {
    const response = await trustedFetch(url, init);
    if ((operationPagesMode || reasoningMode || planMode || backgroundMode) && new URL(url).pathname === '/internal/heartbeat') {
      assert.equal(response.status, 200);
      heartbeatPages.push(JSON.parse(init.body).operations);
    }
    if ((backgroundMode || ownerAlphaMultiMode) && new URL(url).pathname === '/internal/coordinator-release') {
      assert.equal(response.status, 200);
      const input = JSON.parse(init.body);
      const terminal = notifications.find(n => n.method === 'turn/completed' && n.params.turn.id === input.native_ref);
      assert.ok(terminal, 'Coordinator release follows actual native terminal observation');
      assert.equal(input.outcome, terminal.params.turn.status);
      coordinatorReleases.push(input);
    }
    if (submissionAckMode && new URL(url).pathname === '/internal/submitted') {
      assert.equal(response.status, 200);
      submissionRequests.push(JSON.parse(init.body));
      if (submissionRequests.length === 1) {
        await response.text();
        throw new Error('Synthetic reply loss after Worker registration');
      }
    }
    return response;
  },
    launch: options => {
      const transport = spawnCodex(options), request = transport.request.bind(transport);
      if (historyMode) {
        const emit = transport.emit.bind(transport);
        report.withheldMcpCompletions = 0;
        transport.emit = (event, ...args) => {
          if (event === 'notification' && args[0]?.method === 'item/completed' && args[0].params?.item?.type === 'mcpToolCall') {
            report.withheldMcpCompletions++; return true;
          }
          return emit(event, ...args);
        };
      }
      if (questionsMode) {
        const write = transport.write.bind(transport);
        report.nativeAnswerWrites = 0;
        transport.write = message => {
          if (message?.result?.answers) report.nativeAnswerWrites++;
          return write(message);
        };
      }
      nativeTransport = transport; nativeLaunches++;
      transport.on('notification', notification => notifications.push(notification));
      transport.request = (method, params) => {
        if (method === 'thread/start') nativeStarts.push(structuredClone(params));
        if (method === 'turn/interrupt') interrupts.push(structuredClone(params));
        if (planMode && method === 'initialize') params = { ...params, capabilities: { ...params.capabilities, experimentalApi: true } };
        if (planMode && method === 'turn/start') params = { ...params,
          collaborationMode: { mode: 'plan', settings: { model: 'fixture-model', reasoning_effort: null, developer_instructions: null } } };
        return request(method, params);
      };
      return transport;
    },
    prepareNative: home => writeFile(join(home, 'config.toml'), `model = "fixture-model"\nmodel_provider = "fixture"\n[features]\ncode_mode = false\n${restrictedMode ? 'sleep_tool = { enabled = true, mode = "always_on" }\n' : ''}${questionsMode ? 'default_mode_request_user_input = true\n' : ''}[model_providers.fixture]\nname = "Loopback"\nbase_url = "http://127.0.0.1:${model.address().port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`, { mode: 0o600 }) };
  service = ownerAlphaMode ? createCodexService(config, dependencies) : createSpriteCodexService(config, dependencies);
  const dispatched = await service.start(); bound = true;
  assert.equal(dispatched.phase, 'running'); assert.equal(dispatched.claim.run.id, queued.resource_id);
  assert.equal(JSON.parse(dispatched.claim.run.context_json).selected_model, 'fixture-model');
  report.selectedModelInClaimCustody = true;
  if (ownerAlphaMode) {
    assert.equal(service.adapter.testMode, false);
    assert.equal(service.adapter.admissionReadiness().productionVerified, false);
    assert.ok(dispatched.claim.deadline_at <= ownerAlpha.expires_at);
    assert.equal((await control.request('status', {})).execution_enabled, false);
    report.ownerAlphaAdmission = true;
    assert.equal(dispatched.claim.owner_alpha_background, ownerAlphaBackgroundMode ? true : undefined);
  }
  if (textOnlyMode) {
    await wait(async () => {
      await service.maintain();
      const state = await (await trustedFetch(`${origin}/v1/state`)).json();
      return state.runs.find(run => run.id === queued.resource_id)?.status === 'completed' && state;
    }, 'persisted text-only Worker completion', 30000);
    const final = await (await trustedFetch(`${origin}/v1/state`)).json();
    const history = await (await trustedFetch(`${origin}/v1/conversations/${persona.id}/events`)).json();
    const result = history.events.filter(event => event.type === 'run.result' && event.payload.run_id === queued.resource_id);
    assert.equal(report.modelRequests, 1);
    assert.deepEqual(final.output_previews, []);
    assert.equal(result.length, 1);
    assert.equal(result[0].payload.text, 'SERVICE_TEXT_ONLY_COMPLETE_43');
    assert.equal((await service.supervisor.bridge.families()).every(row => row.phase === 'complete'), true);
    const native = await service.observe(dispatched.attemptId);
    assert.equal(native.textOnlyReceipt.profile_sha256, ownerAlpha.text_only.profile_sha256);
    Object.assign(report, { nativeReceipt: true, persistedAssistantCompletion: true,
      receiptRunId: queued.resource_id, nativeThreadId: native.threadId, nativeTurnId: native.nativeRunId });
  } else {
  if (restrictedMode) {
    const { permissions } = await service.journal.get('service');
    assert.match(permissions.name, /^hehebot-restricted-[a-f0-9]{64}$/);
    const contents = await readFile(join(stateDirectory, 'codex-home', 'config.toml'));
    assert.equal(createHash('sha256').update(contents).digest('hex'), permissions.configSha256);
    const readback = await nativeTransport.request('config/read', { includeLayers: false, cwd: join(stateDirectory, 'workspace') });
    assert.equal(readback.config.default_permissions, permissions.name);
    assert.deepEqual(readback.config.permissions[permissions.name].filesystem, { glob_scan_max_depth: null,
      ':minimal': 'read', [join(stateDirectory, 'workspace')]: 'read', [join(stateDirectory, 'journal')]: 'deny',
      [join(stateDirectory, 'codex-home')]: 'deny', [runtimeTokenFile]: 'deny' });
    assert.equal(readback.config.permissions[permissions.name].network.enabled, false);
    assert.equal(readback.config.web_search, 'disabled');
    for (const key of ['apps', 'plugins', 'tool_suggest', 'image_generation', 'standalone_web_search',
      'token_budget', 'request_permissions_tool', 'exec_permission_approvals']) assert.equal(readback.config.features[key], false);
    assert.deepEqual(readback.config.features.sleep_tool, { enabled: false, mode: 'always_on' });
    const features = await nativeTransport.request('experimentalFeature/list', { threadId: (await service.observe()).threadId, limit: 100 });
    for (const name of ['sleep_tool', 'apps', 'plugins']) assert.equal(features.data.find(feature => feature.name === name)?.enabled, false, name);
    if (ownerAlphaBackgroundMode) {
      assert.equal(readback.config.agents.enabled, false);
      assert.equal(readback.config.features.multi_agent, false);
      assert.equal(readback.config.features.multi_agent_v2, false);
    }
    report.providerSurfacesDisabled = true;
    report.restrictedProfileSelected = true;
  }
  if (submissionAckMode) {
    assert.equal(submissionRequests.length, 2);
    assert.deepEqual(submissionRequests[0], submissionRequests[1]);
    assert.equal(submissionRequests[1].native_ref, dispatched.nativeRunId);
    assert.equal(nativeLaunches, 1);
    report.exactSubmissionRegistrationRecovered = true;
  }
  if (questionsMode) {
    const question = await wait(async () => (await (await trustedFetch(`${origin}/v1/state`)).json()).questions?.[0], 'durable native question');
    assert.equal(question.run_id, queued.resource_id); assert.equal(question.attempt, dispatched.claim.run.current_attempt);
    assert.equal(question.state, 'pending'); assert.equal(question.answerable, true);
    assert.equal(question.expires_at, question.callback_deadline_at);
    report.questionAnswerDeadline = question.expires_at;
    assert.equal(report.modelRequests, 2);
    const response = await trustedFetch(`${origin}/v1/commands`, { method: 'POST', headers: {
      'content-type': 'application/json', Origin: origin, 'idempotency-key': randomUUID(),
    }, body: JSON.stringify(questionCancelMode
      ? { schema_version: 1, type: 'run.cancel', payload: { run_id: queued.resource_id, reason: 'Cancel pending fixture question' } }
      : { schema_version: 1, type: 'question.answer', payload: {
        question_id: question.id, expected_revision: question.revision, answers: questionAnswers } }) });
    assert.equal(response.status, 202); assert.equal((await response.json()).status, 'applied');
    if (questionCancelMode) await service.maintain();
    await wait(async () => (await (await trustedFetch(`${origin}/v1/state`)).json()).questions.length === 0, 'native resolved custody');
    report.ownerQuestionResolved = true;
    if (questionCancelMode) {
      const observed = await wait(async () => {
        const row = await service.observe(); return row?.nativeOutcome === 'interrupted' && row;
      }, 'interrupted question root');
      assert.deepEqual(interrupts, [{ threadId: observed.threadId, turnId: observed.nativeRunId }]);
      const late = await trustedFetch(`${origin}/v1/commands`, { method: 'POST', headers: {
        'content-type': 'application/json', Origin: origin, 'idempotency-key': randomUUID(),
      }, body: JSON.stringify({ schema_version: 1, type: 'question.answer', payload: {
        question_id: question.id, expected_revision: question.revision, answers: questionAnswers } }) });
      assert.equal(late.status, 202);
      const lateReceipt = await late.json();
      assert.equal(lateReceipt.status, 'rejected'); assert.equal(lateReceipt.error.code, 'REVISION_CONFLICT');
      await service.maintain();
      assert.equal(report.nativeAnswerWrites, 0); assert.equal(report.modelRequests, 2);
      assert.equal(nativeTransport.closed, false);
      const readback = await nativeTransport.request('thread/read', { threadId: observed.threadId, includeTurns: true });
      assert.equal(readback.thread.id, observed.threadId);
      assert.equal(readback.thread.turns.find(turn => turn.id === observed.nativeRunId)?.status, 'interrupted');
      report.pendingQuestionCancelledWithoutAnswer = true;
    }
  }
  if (backgroundMode) {
    // Multi-family acceptance stays separate from legacy single-cursor totals,
    // recovery diagnostics and cancellation assertions below.
    const getState = async () => (await (await trustedFetch(`${origin}/v1/state`)).json());
    await wait(() => childHeld, 'A inherited MCP receipt and held inference');
    await service.maintain(); // Persist service-owned child registration/output before S captures context.
    const parent = await service.observe(dispatched.attemptId);
    assert.equal(parent.rootSettled, true);
    const [[childKey, childStatus]] = Object.entries(parent.childTurns);
    const [aThread, aTurn] = JSON.parse(childKey);
    assert.equal(aThread, childThreadId); assert.equal(childStatus, 'inProgress');
    assert.deepEqual(Object.values(parent.childObligations[childKey].mcpCalls), ['completed']);
    const registered = await getState();
    const children = registered.runs.filter(run => run.parent_run_id === queued.resource_id);
    assert.equal(children.length, 1); backgroundChild = children[0];
    assert.equal(backgroundChild.status, 'running');
    assert.equal(childClosed, false); assert.deepEqual(interrupts, []);
    report.parentTerminalWithHeldChild = true;

    const portalSubmit = async text => {
      await browser('open', origin); await browser('set', 'viewport', '1280', '900', '2');
      await browser('wait', '--fn', 'document.querySelector("#connection").textContent === "Connected"');
      await browser('click', `[data-persona-id="${persona.id}"]`);
      await browser('eval', `window.fixtureReceipts=[];window.fixtureFetch=window.fetch;window.fetch=async(...args)=>{const response=await window.fixtureFetch(...args);if(args[0]==='/v1/commands'&&args[1]?.method==='POST')window.fixtureReceipts.push({request:JSON.parse(args[1].body),key:args[1].headers['Idempotency-Key'],receipt:await response.clone().json()});return response;}`);
      await browser('fill', '#message', text); await browser('click', '#send');
      await browser('wait', '--fn', 'window.fixtureReceipts.length === 1');
      const [observed] = JSON.parse((await browser('eval', 'window.fixtureReceipts')).stdout);
      assert.deepEqual(observed.request, { schema_version: 1, type: 'message.send', payload: { conversation_id: persona.id, text } });
      assert.match(observed.key, /^[0-9a-f-]{36}$/); assert.equal(observed.receipt.status, 'applied');
      return observed.receipt;
    };
    const statusReceipt = await portalSubmit(statusText);
    assert.equal((await getState()).runs.find(run => run.id === statusReceipt.resource_id).status, 'queued');
    report.statusQueuedBehindParent = true;
    // Only service maintenance may release the lane and pump admission. The
    // unpatched baseline must fail here, not pass via fixture-owned dispatch.
    await wait(async () => {
      await service.maintain();
      assert.deepEqual(errors, []);
      return report.statusModelSawChildSummary;
    }, 'maintenance admits queued S while A remains held');
    const families = await service.supervisor.bridge.families();
    assert.equal(families.length, 2);
    const p = families.find(row => row.attemptId === dispatched.attemptId);
    const s = families.find(row => row.claim.run.id === statusReceipt.resource_id);
    assert.equal(p?.coordinatorRelease?.acknowledged, true, 'P durable coordinator-release acknowledgement');
    assert.equal(p.phase, 'running');
    assert.ok(s); assert.notEqual(s.attemptId, p.attemptId);
    const statusNative = await wait(async () => {
      const row = await service.observe(s.attemptId); return row?.rootSettled && row;
    }, 'S root terminal');
    assert.notEqual(statusNative.threadId, parent.threadId);
    assert.notEqual(statusNative.threadId, aThread);
    const pGrant = await service.journal.get(`grant-${p.attemptId}`);
    const sGrant = await service.journal.get(`grant-${s.attemptId}`);
    assert.equal(pGrant.runId, queued.resource_id); assert.equal(sGrant.runId, statusReceipt.resource_id);
    assert.equal(sGrant.attempt, s.claim.run.current_attempt);
    assert.deepEqual(await service.observe(p.attemptId), parent);
    assert.equal(childClosed, false); assert.deepEqual(interrupts, []);
    await service.maintain();
    const released = coordinatorReleases.find(input => input.run_id === queued.resource_id);
    assert.deepEqual(released, { identity: service.supervisor.identity, run_id: queued.resource_id,
      attempt: p.claim.run.current_attempt, native_ref: p.nativeRunId, outcome: 'completed' });
    assert.deepEqual(p.coordinatorRelease.payload, released);
    const beforeReload = await getState(), requestCount = report.modelRequests;
    assert.equal(beforeReload.runs.find(run => run.id === queued.resource_id).status, 'running');
    assert.equal(beforeReload.output_previews.find(preview => preview.run_id === s.claim.run.id)?.text, statusOutput);
    assert.equal(beforeReload.output_previews.find(preview => preview.run_id === s.claim.run.id)?.attempt, s.claim.run.current_attempt);
    const card = `[data-run-id="${statusReceipt.resource_id}"]`;
    await browser('reload');
    await browser('wait', '--fn', `document.querySelector('${card} .output-preview')?.textContent.includes('SERVICE_STATUS_PROVISIONAL_71')`);
    await browser('eval', `document.querySelector('${card}').open=true`);
    assert.match((await browser('get', 'text', `${card} .output-preview`)).stdout, /provisional.*not a completed result/);
    assert.equal(JSON.parse((await browser('eval', 'document.querySelectorAll(".result-outcome").length')).stdout), 0);
    assert.equal(report.modelRequests, requestCount);
    assert.deepEqual((await getState()).output_previews, beforeReload.output_previews);
    Object.assign(report, { freshStatusThreadAndGrant: true, statusReloadWithoutInference: true });

    const independentReceipt = await portalSubmit(independentText);
    await wait(async () => { await service.maintain(); return independentHeld; }, 'maintenance admits independent B');
    const allFamilies = await service.supervisor.bridge.families();
    assert.equal(allFamilies.length, 3);
    assert.equal(new Set(allFamilies.map(row => row.attemptId)).size, 3);
    const b = allFamilies.find(row => row.claim.run.id === independentReceipt.resource_id);
    assert.ok(b);
    const bNative = await service.observe(b.attemptId);
    assert.equal(new Set([parent.threadId, statusNative.threadId, bNative.threadId, aThread]).size, 4);
    assert.equal((await service.journal.get(`grant-${b.attemptId}`)).runId, independentReceipt.resource_id);
    assert.equal(bNative.rootSettled, false); assert.equal(independentClosed, false);
    const assertCoverage = async () => {
      await service.maintain();
      const operations = await service.supervisor.operations();
      for (const family of allFamilies) {
        const owned = operations.filter(op => op.run_id === family.claim.run.id);
        let unknown = 1; // Universal coverage uncertainty, even for terminal roots.
        if (ownerAlphaBackgroundMode && family.attemptId === p.attemptId) {
          const activities = Object.values((await service.observe(p.attemptId)).v2Activities);
          assert.equal(activities.filter(item => item.kind === 'started').length, 1);
          assert.ok(activities.every(item => ['started', 'completed'].includes(item.kind) && item.targetThreadId === aThread));
          // V2 activity completion does not settle either the spawn invocation
          // or its activity record. A later child-completed activity also stays unknown.
          unknown += 1 + activities.length;
        }
        assert.equal(owned.filter(op => op.status === 'unknown').length, unknown, 'Each family retains all unknown obligations');
        assert.ok(owned.every(op => op.deadline_at <= family.claim.deadline_at));
      }
      assert.equal(new Set(operations.map(op => op.id)).size, operations.length);
      const pages = heartbeatPages.slice(-Math.ceil(operations.length / 100));
      assert.deepEqual(pages.flat(), operations, 'Heartbeat includes old and current families');
      return operations;
    };
    const beforeCancel = await assertCoverage();
    for (const id of [queued.resource_id, independentReceipt.resource_id]) {
      assert.ok(beforeCancel.some(op => op.run_id === id && op.kind === 'inference' && op.status === 'active'));
    }
    const cancel = async runId => {
      const response = await trustedFetch(`${origin}/v1/commands`, { method: 'POST', headers: {
        'content-type': 'application/json', Origin: origin, 'idempotency-key': randomUUID(),
      }, body: JSON.stringify({ schema_version: 1, type: 'run.cancel', payload: {
        run_id: runId, reason: 'Disposable exact background responsiveness cancellation' } }) });
      assert.equal(response.status, 202); assert.equal((await response.json()).status, 'applied');
      await service.maintain();
    };
    await cancel(independentReceipt.resource_id);
    await wait(() => independentClosed, 'B interrupted HTTP closure');
    await wait(async () => (await service.observe(b.attemptId)).nativeOutcome === 'interrupted', 'B exact native interruption');
    assert.deepEqual(interrupts, [{ threadId: bNative.threadId, turnId: bNative.nativeRunId }]);
    assert.deepEqual(await service.observe(p.attemptId), parent);
    assert.equal(childClosed, false);
    assert.notEqual((await service.journal.get(service.supervisor.bridge.cursor)).attemptId, p.attemptId);
    // Alpha proves owner cancellation of the released root reaches its live child.
    // Existing background mode retains direct old-child cancellation coverage.
    await cancel(ownerAlphaBackgroundMode ? queued.resource_id : backgroundChild.id);
    await wait(() => childClosed, 'old A interrupted HTTP closure');
    await wait(async () => (await service.observe(p.attemptId)).childTurns[childKey] === 'interrupted', 'old A exact native interruption');
    await service.maintain(); await service.maintain();
    assert.deepEqual(interrupts, [{ threadId: bNative.threadId, turnId: bNative.nativeRunId }, { threadId: aThread, turnId: aTurn }]);
    const operations = await assertCoverage();
    await assert.rejects(service.supervisor.drain({ state: 'background-responsive' }), { code: 'SLEEP_DENIED' });
    const final = await getState();
    assert.equal(final.runs.find(run => run.id === queued.resource_id).status, ownerAlphaBackgroundMode ? 'cancelling' : 'running');
    assert.equal(final.runs.find(run => run.id === statusReceipt.resource_id).status, 'running');
    for (const id of [backgroundChild.id, independentReceipt.resource_id]) assert.equal(final.runs.find(run => run.id === id).status, 'cancelling');
    const history = await (await trustedFetch(`${origin}/v1/conversations/${persona.id}/events`)).json();
    assert.equal(history.events.filter(event => event.type === 'run.result').length, 0);
    for (const text of ['SERVICE_ASSEMBLY_19_43', statusText, independentText]) {
      assert.equal(history.events.filter(event => event.type === 'message.user' && event.payload.text === text).length, 1);
    }
    assert.equal(report.modelRequests, ownerAlphaBackgroundMode ? 7 : 6); assert.equal(nativeLaunches, 1); assert.deepEqual(errors, []);
    assert.deepEqual(taskRequests, ownerAlphaBackgroundMode ? [] : ['PUT', 'GET']);
    if (ownerAlphaBackgroundMode) {
      assert.equal(final.summary.owner_alpha_session.admitted_runs, 3, 'Child does not consume root quota');
      assert.equal(final.runs.length, 4);
      assert.deepEqual([p, s, b].map(row => row.claim.owner_alpha_background), [true, undefined, undefined]);
      assert.equal(nativeStarts.length, 3);
      assert.deepEqual(nativeStarts[0].config.agents, { enabled: true });
      assert.deepEqual(nativeStarts[0].config.features, { apps: false, plugins: false, tool_suggest: false,
        image_generation: false, standalone_web_search: false, token_budget: false, sleep_tool: false,
        request_permissions_tool: false, exec_permission_approvals: false, multi_agent: false, multi_agent_v2: {
        enabled: true, max_concurrent_threads_per_session: 2, wait_agent_enabled: false,
      } });
      const childFeatures = await nativeTransport.request('experimentalFeature/list', { threadId: aThread, limit: 100 });
      for (const name of ['sleep_tool', 'apps', 'plugins']) assert.equal(childFeatures.data.find(feature => feature.name === name)?.enabled, false, name);
      for (const started of nativeStarts.slice(1)) {
        assert.equal(started.config.agents, undefined);
        assert.equal(started.config.features, undefined);
      }
      for (const [index, family] of [p, s, b].entries()) {
        assert.equal(nativeStarts[index].config.mcp_servers.hehebot.env.HEHEBOT_AGENT_TOOLS_CONFIG,
          service.journal.path(`grant-${family.attemptId}`));
      }
      assert.equal(report.statusRootSpawnDenied, true);
      assert.equal(final.runs.find(run => run.id === backgroundChild.id).error_code, 'OWNER_CANCELLED');
      report.rootCancellationReachedChild = true;
      report.ownerAlphaBackground = true;
    }
    Object.assign(report, { backgroundResponsive: true, exactIndependentCancellation: true, exactOldChildCancellation: true,
      familyCount: 3, heartbeatOperations: operations.length, unknownCoverage: 3, sleepDenied: true,
      completedResultObserved: false, productionCompletion: false, p02Complete: false });
    await service.stop();
    for (const family of allFamilies) {
      assert.ok(await service.journal.get(family.attemptId));
      assert.ok(await service.journal.get(`grant-${family.attemptId}`));
    }
    assert.equal((await service.supervisor.bridge.families()).length, 3);
    assert.deepEqual(await service.supervisor.operations(), operations, 'Per-family coverage survives service stop');
    assert.deepEqual(await service.journal.get(`grant-${p.attemptId}`), pGrant);
    assert.deepEqual(await service.journal.get(`grant-${s.attemptId}`), sGrant);
  } else if (ownerAlphaMultiMode) {
    const getState = async () => (await (await trustedFetch(`${origin}/v1/state`)).json());
    const submit = async text => {
      await browser('open', origin); await browser('set', 'viewport', '1280', '900', '2');
      await browser('wait', '--fn', 'document.querySelector("#connection").textContent === "Connected"');
      await browser('click', `[data-persona-id="${persona.id}"]`);
      await browser('eval', `window.fixtureReceipts=[];window.fixtureFetch=window.fetch;window.fetch=async(...args)=>{const response=await window.fixtureFetch(...args);if(args[0]==='/v1/commands'&&args[1]?.method==='POST')window.fixtureReceipts.push({request:JSON.parse(args[1].body),receipt:await response.clone().json()});return response;}`);
      await browser('fill', '#message', text); await browser('click', '#send');
      await browser('wait', '--fn', 'window.fixtureReceipts.length === 1');
      const [observed] = JSON.parse((await browser('eval', 'window.fixtureReceipts')).stdout);
      assert.deepEqual(observed.request, { schema_version: 1, type: 'message.send', payload: { conversation_id: persona.id, text } });
      assert.equal(observed.receipt.status, 'applied');
      return observed.receipt;
    };
    const firstNative = await wait(async () => { const row = await service.observe(dispatched.attemptId); return row?.rootSettled && row; }, 'first alpha root terminal');
    await service.maintain();
    const firstFamily = (await service.supervisor.bridge.families()).find(row => row.attemptId === dispatched.attemptId);
    assert.equal(firstFamily.coordinatorRelease.acknowledged, true);
    assert.equal(firstFamily.phase, 'running');
    const secondReceipt = await submit(alphaSecondText);
    await wait(async () => { await service.maintain(); return alphaOutputs.get(alphaSecondText) === 2; }, 'second alpha root through MCP');
    const families = await service.supervisor.bridge.families();
    assert.equal(families.length, 2);
    const secondFamily = families.find(row => row.claim.run.id === secondReceipt.resource_id);
    assert.ok(secondFamily); assert.notEqual(secondFamily.attemptId, firstFamily.attemptId);
    const secondNative = await wait(async () => { const row = await service.observe(secondFamily.attemptId); return row?.rootSettled && row; }, 'second alpha root terminal');
    assert.equal(new Set([queued.resource_id, secondReceipt.resource_id]).size, 2);
    assert.equal(new Set([dispatched.attemptId, secondFamily.attemptId]).size, 2);
    assert.equal(new Set([firstNative.threadId, secondNative.threadId]).size, 2);
    const firstGrant = await service.journal.get(`grant-${dispatched.attemptId}`);
    const secondGrant = await service.journal.get(`grant-${secondFamily.attemptId}`);
    assert.equal(firstGrant.runId, queued.resource_id); assert.equal(secondGrant.runId, secondReceipt.resource_id);
    assert.notDeepEqual(firstGrant, secondGrant);
    assert.equal((await getState()).summary.owner_alpha_session.admitted_runs, 2);
    const third = await trustedFetch(`${origin}/v1/commands`, { method: 'POST', headers: {
      'content-type': 'application/json', Origin: origin, 'idempotency-key': randomUUID(),
    }, body: JSON.stringify({ schema_version: 1, type: 'message.send', payload: { conversation_id: persona.id, text: 'OWNER_ALPHA_MULTI_QUOTA_67' } }) });
    assert.equal(third.status, 202); const thirdReceipt = await third.json(); assert.equal(thirdReceipt.status, 'applied');
    assert.equal((await getState()).runs.find(run => run.id === thirdReceipt.resource_id).status, 'waiting');
    await service.maintain(); assert.equal(report.modelRequests, 4);
    assert.equal((await service.supervisor.bridge.families()).length, 2);
    const beforeReload = await getState();
    await browser('reload'); await browser('wait', '--fn', 'document.querySelector("#connection").textContent === "Connected"');
    assert.equal(report.modelRequests, 4); assert.deepEqual((await getState()).output_previews, beforeReload.output_previews);
    const cancel = await trustedFetch(`${origin}/v1/commands`, { method: 'POST', headers: {
      'content-type': 'application/json', Origin: origin, 'idempotency-key': randomUUID(),
    }, body: JSON.stringify({ schema_version: 1, type: 'run.cancel', payload: { run_id: queued.resource_id,
      reason: 'Exact old owner-alpha fixture cancellation' } }) });
    assert.equal(cancel.status, 202); assert.equal((await cancel.json()).status, 'applied'); await service.maintain();
    assert.equal(interrupts.some(item => item.threadId === secondNative.threadId || item.turnId === secondNative.nativeRunId), false);
    const history = await (await trustedFetch(`${origin}/v1/conversations/${persona.id}/events`)).json();
    assert.equal(history.events.filter(event => event.type === 'run.result').length, 0);
    assert.equal(history.events.filter(event => event.type === 'message.user' && [alphaFirstText, alphaSecondText].includes(event.payload.text)).length, 2);
    const operations = await service.supervisor.operations();
    for (const family of families) assert.equal(operations.filter(op => op.run_id === family.claim.run.id && op.status === 'unknown').length, 1);
    await assert.rejects(service.supervisor.drain({ state: 'owner-alpha-multi' }), { code: 'SLEEP_DENIED' });
    assert.deepEqual(taskRequests, []); assert.equal(nativeLaunches, 1); assert.deepEqual(errors, []);
    Object.assign(report, { ownerAlphaMulti: true, familyCount: 2, distinctCustody: true,
      retainedAfterCoordinatorRelease: true, quotaDeniedThirdAdmission: true, reloadWithoutInference: true,
      exactOldCancellationDidNotTargetNewer: true, unknownCoverage: 2, completedResultObserved: false,
      sleepDenied: true, providerHolds: 0, nativeChildren: 0, productionCompletion: false });
    await service.stop();
    assert.equal((await service.supervisor.bridge.families()).length, 2);
    assert.equal(report.secondInputContainsFirstTask, true,
      'Second owner-alpha root input must contain an appropriate first-task summary or history');
  } else {
  if (crashMode) await wait(() => crashHeld, 'active root inference after verified MCP receipt');
  else await wait(async () => (await service.observe())?.rootSettled, 'root completion');
  if (childMode) {
    await wait(() => childHeld, 'child inherited MCP receipt and open model request');
    await service.maintain();
    let observed = await service.observe();
    const [[childKey, childStatus]] = Object.entries(observed.childTurns);
    const [targetThread, targetTurn] = JSON.parse(childKey);
    assert.equal(targetThread, childThreadId); assert.equal(childStatus, 'inProgress');
    if (historyChildMode) {
      assert.equal(report.withheldMcpCompletions, 1); assert.equal(observed.rootSettled, true);
      const before = observed, requests = report.modelRequests;
      assert.deepEqual(Object.values(before.childObligations[childKey].mcpCalls), ['inProgress']);
      const target = { threadId: targetThread, turnId: targetTurn };
      observed = await service.adapter.reconcileChild(dispatched.attemptId, target);
      assert.deepEqual(Object.keys(observed.childObligations[childKey].mcpCalls), Object.keys(before.childObligations[childKey].mcpCalls));
      assert.deepEqual(observed.childTurns, before.childTurns);
      const rootOnly = row => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'childObligations'));
      assert.deepEqual(rootOnly(observed), rootOnly(before));
      assert.deepEqual(await service.adapter.reconcileChild(dispatched.attemptId, target), observed);
      assert.equal(report.modelRequests, requests); assert.equal(childClosed, false);
      report.missedChildMcpCompletionRecovered = true;
    }
    assert.deepEqual(Object.values(observed.childObligations[childKey].mcpCalls), ['completed']);
    const registered = await (await trustedFetch(`${origin}/v1/state`)).json();
    const children = registered.runs.filter(run => run.parent_run_id === queued.resource_id);
    assert.equal(children.length, 1);
    const child = children[0];
    assert.equal(registered.output_previews.find(preview => preview.run_id === queued.resource_id)?.text, 'SERVICE_PARENT_DONE');
    assert.equal(registered.output_previews.find(preview => preview.run_id === child.id)?.text, 'SERVICE_CHILD_PROGRESS');
    assert.equal(registered.output_previews.length, 2);
    assert.equal(observed.effectsSettled, undefined);
    report.nativeChildProvisionalOutput = true;
    const mappingFiles = (await readdir(join(stateDirectory, 'journal'))).filter(name => name.startsWith('native-tasks-'));
    assert.equal(mappingFiles.length, 1);
    const mapping = JSON.parse(await readFile(join(stateDirectory, 'journal', mappingFiles[0]), 'utf8'));
    assert.deepEqual(Object.keys(mapping.children), [childKey]);
    assert.equal(mapping.children[childKey].runId, child.id);
    assert.equal(mapping.children[childKey].receipt.native_session_key, targetThread);
    assert.equal(mapping.children[childKey].receipt.parent_run_id, queued.resource_id);
    assert.equal(mapping.children[childKey].started, true);
    assert.equal(child.status, 'running'); assert.equal(child.persona_id, persona.id);
    report.nativeStartAcknowledgedByService = true;
    assert.equal(childClosed, false); assert.deepEqual(interrupts, []);
    let effectInput, effectResult;
    if (effectsMode) {
      const identity = service.supervisor.identity;
      effectInput = { identity, root_run_id: queued.resource_id, root_attempt: dispatched.claim.run.current_attempt,
        resources: ['calendar:z43', 'browser:a19'], effect: { id: randomUUID(), run_id: child.id, attempt: child.current_attempt,
          action_key: randomUUID(), classification: 'mutation', authorization_ref: routinePolicy,
          request_digest: 'synthetic-request-71', provider_idempotency_key: null } };
      effectResult = (status, receipt = null) => ({ identity, root_run_id: effectInput.root_run_id,
        root_attempt: effectInput.root_attempt, run_id: child.id, attempt: child.current_attempt,
        effect_id: effectInput.effect.id, status, receipt });
      // Service-owned acknowledgement already made the child running. The host
      // fixture never submits that child; it only verifies exact receipt replay.
      const receipt = mapping.children[childKey].receipt;
      await assert.rejects(control.request('native-child', { identity, started: true,
        child: { ...receipt, native_session_key: 'wrong-thread-103' } }), { code: 'CONTROL_HTTP_ERROR', status: 409 });
      const replay = await control.request('native-child', { identity, child: receipt, started: true });
      assert.equal(replay.id, child.id); assert.equal(replay.status, 'running');
      const original = { id: effectInput.effect.id, status: 'intent' };
      assert.deepEqual(await control.request('root-child-effect-intent', effectInput), original);
      assert.deepEqual(await control.request('root-child-effect-intent', { ...effectInput,
        resources: [...effectInput.resources].reverse(), effect: { ...effectInput.effect, id: randomUUID() } }), original);
      await assert.rejects(control.request('root-child-effect-intent', { ...effectInput, resources: ['browser:a19'] }),
        { code: 'CONTROL_HTTP_ERROR', status: 409 });
      await assert.rejects(control.request('root-child-effect-intent', { ...effectInput,
        effect: { ...effectInput.effect, run_id: queued.resource_id } }), { code: 'CONTROL_HTTP_ERROR', status: 403 });
      // A root cannot take its child's locks. Failure after the lexically first
      // free resource must roll back that partial acquisition as well.
      await assert.rejects(control.request('resource-acquire', { identity, run_id: queued.resource_id,
        attempt: dispatched.claim.run.current_attempt, resources: ['a:rollback19', 'calendar:z43'] }),
      { code: 'CONTROL_HTTP_ERROR', status: 409 });
      await control.request('resource-acquire', { identity, run_id: child.id, attempt: child.current_attempt, resources: ['a:rollback19'] });
      // No per-effect resource mapping exists: even this additional lock stays
      // held while the child's external effect is unresolved.
      await assert.rejects(control.request('resource-release', { identity, run_id: child.id,
        attempt: child.current_attempt, resources: ['a:rollback19'] }), { code: 'CONTROL_HTTP_ERROR', status: 409 });
      // Synthetic trusted-executor observations only; no connector is called.
      await control.request('root-child-effect-result', effectResult('dispatched'));
      await control.request('root-child-effect-result', effectResult('outcome_unknown'));
    }
    const cancelled = await (await trustedFetch(`${origin}/v1/commands`, { method: 'POST', headers: {
      'content-type': 'application/json', Origin: origin, 'idempotency-key': randomUUID(),
    }, body: JSON.stringify({ schema_version: 1, type: 'run.cancel', payload: {
      run_id: child.id, reason: 'Disposable service exact child cancellation' } }) })).json();
    assert.equal(cancelled.status, 'applied');
    await service.maintain(); await service.maintain();
    await wait(() => childClosed, 'interrupted child HTTP closure');
    await wait(() => notifications.some(n => n.method === 'turn/completed' && n.params.threadId === targetThread &&
      n.params.turn.id === targetTurn && n.params.turn.status === 'interrupted'), 'exact child interrupted event');
    assert.deepEqual(interrupts, [{ threadId: targetThread, turnId: targetTurn }]);
    assert.equal((await service.observe()).childTurns[childKey], 'interrupted');
    assert.equal(service.supervisor.phase, 'running');
    report.nativeServiceChildCancellation = true;
    if (effectsMode) {
      assert.deepEqual(await control.request('root-child-effect-intent', effectInput), { id: effectInput.effect.id, status: 'outcome_unknown' });
      await assert.rejects(control.request('root-child-effect-result', effectResult('confirmed', {})), { code: 'CONTROL_HTTP_ERROR', status: 422 });
      await control.request('root-child-effect-result', effectResult('confirmed', { synthetic_receipt: 'destination-103' }));
      assert.deepEqual(await control.request('root-child-effect-intent', effectInput), { id: effectInput.effect.id, status: 'confirmed' });
      await assert.rejects(control.request('resource-acquire', { identity: service.supervisor.identity,
        run_id: queued.resource_id, attempt: dispatched.claim.run.current_attempt, resources: effectInput.resources }),
      { code: 'CONTROL_HTTP_ERROR', status: 409 });
      const completion = await trustedFetch(`${origin}/internal/complete`, { method: 'POST', headers: {
        'content-type': 'application/json', Authorization: `Bearer ${token}`,
      }, body: JSON.stringify({ identity: service.supervisor.identity, run_id: child.id, attempt: child.current_attempt,
        result: { status: 'cancelled', text: '' } }) });
      assert.equal(completion.status, 409); assert.equal((await completion.json()).error.code, 'RESOURCE_BUSY');
      Object.assign(report, { nativeChildEffectCustody: true, childOwnedLocksRetained: true, atomicLockRollback: true,
        nativeSubmissionIdentityPreserved: true, effectReconciledDuringCancellation: true, effectReplayPreserved: true, connectorDispatches: 0 });
    }
  }
  if (historyMode && !historyChildMode) {
    const before = await service.observe();
    assert.equal(report.withheldMcpCompletions, 1);
    assert.deepEqual(Object.values(before.mcpCalls), ['inProgress']);
    assert.equal(before.rootSettled, true);
    const requests = report.modelRequests;
    const recovered = await service.adapter.reconcile(dispatched.attemptId);
    assert.deepEqual(Object.keys(recovered.mcpCalls), Object.keys(before.mcpCalls));
    assert.deepEqual(Object.values(recovered.mcpCalls), ['completed']);
    assert.equal(recovered.effectsSettled, undefined);
    assert.deepEqual(await service.adapter.reconcile(dispatched.attemptId), recovered);
    assert.equal(report.modelRequests, requests);
    report.missedMcpCompletionRecovered = true;
  }
  const native = await service.observe();
  assert.deepEqual(Object.values(native.mcpCalls ?? {}), childMode ? [] : Array(expectedToolCalls).fill('completed'));
  assert.equal(native.effectsSettled, undefined);
  await service.maintain();
  const operations = await service.supervisor.operations();
  assert.equal(native.initialInference, 'completed');
  const quietPhases = [native, ...Object.values(native.childObligations ?? {})].flatMap(owner => Object.values(owner.quietPhases ?? {}));
  const messageCount = childMode ? 2 + Number(planChildMode) : crashMode || questionCancelMode ? 0 : 1;
  assert.equal([native, ...Object.values(native.childObligations ?? {})].reduce((n, owner) => n + Object.keys(owner.messageStarts ?? {}).length, 0), messageCount);
  if (!crashMode && !historyMode) {
    const owners = [native, ...Object.values(native.childObligations ?? {})];
    const phases = owners.flatMap(owner => Object.values(owner.quietPhases ?? {}));
    assert.ok(phases.length > 0); assert.ok(phases.every(phase => phase.status === 'completed'));
    assert.ok(phases.every(phase => new Date(phase.startedAt).toISOString() === phase.startedAt));
    if (!questionCancelMode) {
      assert.ok(owners.some(owner => Object.keys(owner.quietPhases ?? {}).some(key => JSON.parse(key)[0] === 'outputItems')));
      assert.ok(owners.some(owner => Object.keys(owner.messageStarts ?? {}).length > 0));
      report.messageStartObserved = true;
      report.postMessagePhaseObserved = true;
    }
    report.quietPhaseJournalObserved = true;
  }
  assert.equal(operations.length, (childMode ? 8 : expectedToolCalls + 3 + Number(reasoningMode) + Number(planMode)) + quietPhases.length + messageCount);
  if (childMode) {
    assert.ok(Object.values(native.childObligations).every(child => child.initialInference === 'completed'));
    assert.equal(operations.filter(operation => operation.kind === 'inference' && operation.status === 'settled').length, 3 + quietPhases.length + messageCount - Number(planChildMode));
    const startup = operations.filter(operation => operation.kind === 'child' && operation.deadline_at < dispatched.claim.deadline_at);
    assert.equal(startup.length, 1); assert.equal(startup[0].status, 'settled');
    const [spawnId] = Object.keys(native.spawns);
    assert.equal(startup[0].started_at, native.operationTimes[JSON.stringify(['spawns', spawnId])].lastProgressAt);
    assert.equal(Date.parse(startup[0].deadline_at) - Date.parse(startup[0].started_at), 120000);
    report.childStartupClockObserved = true;
  }
  if (reasoningMode || (planMode && !planChildMode)) {
    assert.deepEqual(Object.values(native[planMode ? 'planItems' : 'reasoningItems']), ['completed']);
    assert.doesNotMatch(JSON.stringify(native), /PRIVATE_SYNTHETIC_REASONING_43|PRIVATE_PLAN_43/);
    const phases = operations.filter(operation => operation.kind === 'inference' && operation.deadline_at < dispatched.claim.deadline_at);
    assert.equal(phases.length, 2 + quietPhases.length + messageCount); assert.ok(phases.every(phase => phase.status === 'settled'));
    assert.ok(phases.every(phase => Date.parse(phase.deadline_at) - Date.parse(phase.started_at) === 300000));
    assert.deepEqual(heartbeatPages.at(-1), operations);
    if (planMode) {
      assert.ok(notifications.some(n => n.method === 'item/started' && n.params.item.type === 'plan'));
      assert.ok(notifications.some(n => n.method === 'item/completed' && n.params.item.type === 'plan' && n.params.item.text.includes('PRIVATE_PLAN_43')));
      report.planPhaseObserved = true; report.planContentExcluded = true;
    } else { report.reasoningPhaseObserved = true; report.reasoningContentExcluded = true; }
  }
  if (planChildMode) {
    const [childKey] = Object.keys(native.childObligations);
    const owner = native.childObligations[childKey];
    const [threadId, turnId] = JSON.parse(childKey);
    const messageId = Object.keys(owner.messageStarts).find(id => !Object.hasOwn(owner.outputItems ?? {}, id));
    assert.equal(typeof messageId, 'string');
    assert.deepEqual(native.planItems ?? {}, {}); assert.deepEqual(owner.planItems ?? {}, {});
    const childEvents = notifications.filter(n => n.params?.threadId === threadId &&
      (n.params.turnId === turnId || n.params.turn?.id === turnId));
    assert.equal(childEvents.some(n => n.method === 'item/plan/delta' || n.params.item?.type === 'plan'), false);
    assert.equal(childEvents.some(n => n.method === 'item/completed' && n.params.item.id === messageId), false);
    assert.equal(operations.filter(op => op.status === 'active').length, 1);
    assert.equal(operations.find(op => op.status === 'active').kind, 'inference');
    assert.deepEqual(heartbeatPages.at(-1), operations);
    // Inspect persisted host records as well as the in-memory observation. This
    // does not claim native Codex history redaction or completed-message privacy.
    for (const name of await readdir(join(stateDirectory, 'journal'))) {
      assert.doesNotMatch(await readFile(join(stateDirectory, 'journal', name), 'utf8'), /PRIVATE_PLAN_43|PLAN_START_19|<proposed_plan>/);
    }
    Object.assign(report, { childPlanEvents: 0, interruptedMessageCompletionObserved: false,
      interruptedMessageRemainsActive: true, childStreamTextExcludedFromHostJournal: true });
  }
  if (operationPagesMode) {
    const total = 104 + quietPhases.length + messageCount, pageCount = Math.ceil(total / 100);
    assert.deepEqual(heartbeatPages.slice(-pageCount).flat(), operations);
    assert.equal(new Set(operations.map(operation => operation.id)).size, total);
    assert.ok(heartbeatPages.slice(-pageCount).every((page, i) => page.length === Math.min(100, total - i * 100)));
    report.nativeToolCalls = expectedToolCalls;
    report.completeHeartbeatPages = heartbeatPages.slice(-pageCount).map(page => page.length);
  }
  assert.equal(operations.filter(operation => operation.status === 'unknown').length, 1);
  assert.ok(operations.every(operation => operation.run_id === queued.resource_id && operation.deadline_at <= dispatched.claim.deadline_at));
  const timedTools = operations.filter(operation => operation.kind === 'tool' &&
    (ownerAlphaMode ? operation.status === 'settled' : operation.deadline_at < dispatched.claim.deadline_at));
  assert.equal(timedTools.length, expectedToolCalls + Number(childMode));
  assert.ok(timedTools.every(operation => Date.parse(operation.deadline_at) <= Date.parse(operation.started_at) + 120000));
  await assert.rejects(service.supervisor.complete({ attemptId: dispatched.attemptId, nativeRunId: native.nativeRunId, rootSettled: true }), { code: 'NATIVE_SETTLEMENT_INCOMPLETE' });
  await assert.rejects(service.supervisor.drain({ state: 'fixture' }), { code: 'SLEEP_DENIED' });
  if (crashMode) {
    assert.equal(native.rootSettled, false); assert.equal(crashClosed, false);
    assert.equal(operations.find(operation => operation.kind === 'inference').status, 'active');
    // The npm launcher owns one native child. Target that binary, not the shim.
    const launcherPid = nativeTransport.child.pid;
    const nativePids = (await readFile(`/proc/${launcherPid}/task/${launcherPid}/children`, 'utf8')).trim().split(/\s+/).map(Number);
    assert.equal(nativePids.length, 1); assert.ok(Number.isSafeInteger(nativePids[0]) && nativePids[0] > 1);
    assert.match(await readlink(`/proc/${nativePids[0]}/exe`), /\/codex$/);
    process.kill(nativePids[0], 'SIGKILL');
    await wait(() => service.phase === 'recovery' && nativeTransport.child.signalCode === 'SIGKILL', 'native crash fences service');
    await wait(() => crashClosed, 'crashed root HTTP closure');
    assert.equal(notifications.some(n => n.method === 'turn/completed' && n.params.threadId === native.threadId && n.params.turn.id === native.nativeRunId), false);
    await assert.rejects(service.maintain(), { code: 'SERVICE_RECOVERY_REQUIRED' });
    await assert.rejects(service.supervisor.dispatch(), { code: 'EXECUTOR_FENCED' });
    await assert.rejects(service.supervisor.drain({ state: 'fixture' }), { code: 'EXECUTOR_FENCED' });
    assert.deepEqual(await service.journal.get(dispatched.attemptId), native);
    Object.assign(report, { activeNativeCrashFenced: true, rootHttpClosed: crashClosed, rootTerminalObserved: false,
      unknownCoverage: 1, sleepDenied: true });
  }
  if (childMode) {
    assert.equal(operations.find(operation => operation.kind === 'child').status, 'settled');
    const rejected = await trustedFetch(`${origin}/internal/complete`, { method: 'POST', headers: {
      'content-type': 'application/json', Authorization: `Bearer ${token}`,
    }, body: JSON.stringify({ identity: service.supervisor.identity, run_id: queued.resource_id,
      attempt: dispatched.claim.run.current_attempt, result: { status: 'completed', text: 'Root-only result must fail' } }) });
    assert.equal(rejected.status, 409); assert.match(JSON.stringify(await rejected.json()), /CANCEL_UNCONFIRMED/);
  }
  const final = await (await trustedFetch(`${origin}/v1/state`)).json();
  assert.equal(final.runs.find(run => run.id === queued.resource_id).status, questionCancelMode ? 'cancelling' : 'running');
  if (questionCancelMode) assert.deepEqual(final.output_previews, []);
  if (!crashMode && !questionCancelMode) {
    assert.deepEqual(final.output_previews, [{ run_id: queued.resource_id, attempt: dispatched.claim.run.current_attempt,
      version: 1, text: childMode ? 'SERVICE_PARENT_DONE' : planMode ? 'SERVICE_ASSEMBLY_OK\n' : 'SERVICE_ASSEMBLY_OK', truncated: false }]);
    report.nativeProvisionalOutputWithoutSettlement = true;
  }
  if (portalMode) {
    const beforeRequests = report.modelRequests;
    const history = await (await trustedFetch(`${origin}/v1/conversations/${persona.id}/events`)).json();
    assert.equal(history.events.filter(event => event.type === 'message.user' && event.payload.text === 'SERVICE_ASSEMBLY_19_43').length, 1);
    assert.equal(history.events.filter(event => event.type === 'run.accepted' && event.payload.run_id === queued.resource_id).length, 1);
    assert.equal(history.events.filter(event => event.type === 'run.result').length, 0);
    await browser('open', origin); await browser('set', 'viewport', '1280', '900', '2');
    await browser('wait', '--fn', 'document.querySelector("#connection").textContent === "Connected"');
    await browser('click', `[data-persona-id="${persona.id}"]`);
    const card = `[data-run-id="${queued.resource_id}"]`;
    await browser('wait', '--fn', `document.querySelector('${card} .output-preview')?.textContent.includes('SERVICE_ASSEMBLY_OK')`);
    await browser('eval', `document.querySelector('${card}').open=true`);
    assert.match((await browser('get', 'text', `${card} .output-preview`)).stdout, /provisional.*not a completed result/);
    await browser('reload');
    await browser('wait', '--fn', `document.querySelector('${card} .output-preview')?.textContent.includes('SERVICE_ASSEMBLY_OK')`);
    await browser('eval', `document.querySelector('${card}').open=true;document.querySelector('${card}').scrollIntoView({block:'center'})`);
    assert.equal(JSON.parse((await browser('eval', 'document.querySelectorAll(".result-outcome").length')).stdout), 0);
    assert.equal(report.modelRequests, beforeRequests);
    const reread = await (await trustedFetch(`${origin}/v1/state`)).json();
    assert.deepEqual(reread.output_previews, final.output_previews);
    assert.deepEqual(reread.runs.map(run => [run.id, run.current_attempt, run.status]), final.runs.map(run => [run.id, run.current_attempt, run.status]));
    await mkdir(join(root, '.amp/in/artifacts'), { recursive: true });
    assert.equal(JSON.parse((await browser('eval', 'devicePixelRatio')).stdout), 2);
    await browser('eval', 'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    await browser('screenshot', join(root, '.amp/in/artifacts/portal-native-readback.png'));
    if (ownerAlphaMode) {
      assert.equal(reread.summary.owner_alpha, true);
      const alphaBanner = (await browser('get', 'text', '#runtime-banner')).stdout;
      assert.match(alphaBanner, /Supervised owner alpha/);
      assert.match(alphaBanner, /Provisional output.*not a completed result/);
      await wait(async () => {
        const state = await (await trustedFetch(`${origin}/v1/state`)).json();
        if (state.runs.find(run => run.id === queued.resource_id)?.status !== 'cancelling') { await sleep(250); return false; }
        assert.deepEqual(state.output_previews, final.output_previews); return true;
      }, 'alpha deadline retains provisional output', 30000);
      await browser('reload');
      await browser('wait', '--fn', `document.querySelector('${card} .output-preview')?.textContent.includes('SERVICE_ASSEMBLY_OK')`);
      await browser('eval', `document.querySelector('${card}').open=true`);
      assert.match((await browser('get', 'text', card)).stdout, /Cancelling/);
      assert.equal(report.modelRequests, beforeRequests);
      await browser('screenshot', join(root, '.amp/in/artifacts/portal-owner-alpha-expired.png'));
      report.deadlinePreviewRetained = true;
    }
    await browser('close');
    Object.assign(report, { portalReconnectPreview: true, completedResultObserved: false, unknownCoverage: 1,
      receiptRunId: queued.resource_id, conversationId: persona.id, attemptId: dispatched.attemptId,
      nativeThreadId: native.threadId, nativeTurnId: native.nativeRunId, p02Complete: false });
  }
  if (childMode) {
    assert.equal(final.runs.find(run => run.parent_run_id === queued.resource_id).status, 'cancelling');
    assert.equal(interrupts.length, 1);
    Object.assign(report, { interrupts: interrupts.length, childInterrupted: true, childHttpClosed: childClosed,
      heartbeatOperations: operations.length, unknownCoverage: 1, rootWorkerStatus: 'running', childWorkerStatus: 'cancelling', sleepDenied: true });
  }
  assert.deepEqual(taskRequests, ownerAlphaMode ? [] : ['PUT', 'GET']); assert.equal(report.modelRequests, childMode ? 4 : questionsMode && !questionCancelMode ? 3 : 2); assert.deepEqual(errors, []);
  if (questionsMode) assert.equal(report.nativeAnswerWrites, questionCancelMode ? 0 : 1);
  await service.stop();
  assert.equal((await service.journal.get('service')).phase, 'recovery');
  const diagnostic = await inspectCodexRecovery(join(stateDirectory, 'journal'));
  assert.deepEqual(diagnostic.issues, []);
  const { waits, ...questionCounts } = diagnostic.questions;
  if (questionsMode) {
    assert.equal(waits.length, 1); assert.equal(waits[0].phase, 'resolved');
    assert.equal(Date.parse(waits[0].deadlineAt) - Date.parse(waits[0].startedAt), 300000);
    assert.ok(waits[0].deadlineAt <= dispatched.claim.deadline_at);
    assert.equal(waits[0].deadlineAt, report.questionAnswerDeadline);
    report.questionCallbackDeadlineAligned = true;
    report.questionWaitBounded = true;
  } else assert.equal(waits, undefined);
  assert.deepEqual(questionCounts, { complete: true, total: questionsMode ? 1 : 0, unresolved: 0,
    resolutionObserved: questionsMode ? 1 : 0, phases: questionsMode ? { resolved: 1 } : {} });
  assert.equal(diagnostic.dispatch.runId, queued.resource_id);
  assert.equal(diagnostic.dispatch.attemptId, dispatched.attemptId);
  assert.equal(diagnostic.native.root.threadId, native.threadId);
  assert.equal(diagnostic.native.root.turnId, native.nativeRunId);
  assert.equal(diagnostic.native.root.observedTerminal, !crashMode);
  const expectedLastUsage = { inputTokens: 31, cachedInputTokens: 7, cacheWriteInputTokens: 0,
    outputTokens: 13, reasoningOutputTokens: 5, totalTokens: 44 };
  assert.deepEqual(diagnostic.native.root.tokenUsage.last, expectedLastUsage);
  if (childMode) {
    assert.equal(diagnostic.native.children.length, 1);
    assert.deepEqual(diagnostic.native.children[0].tokenUsage.last, expectedLastUsage);
  }
  report.nativeUsageSnapshotObserved = true;
  const inspectedCalls = diagnostic.native.observations.filter(observation => observation.kind === 'mcpCalls');
  assert.equal(inspectedCalls.length, expectedToolCalls);
  const stoppedNative = await service.journal.get(dispatched.attemptId);
  for (const call of inspectedCalls) {
    const owner = call.threadId === stoppedNative.threadId ? stoppedNative
      : stoppedNative.childObligations[JSON.stringify([call.threadId, call.turnId])];
    const stored = owner.operationTimes[JSON.stringify(['mcpCalls', call.itemId])];
    assert.equal(typeof call.timing?.startedAt, 'string');
    assert.deepEqual(call.timing, { startedAt: stored.startedAt, lastProgressAt: stored.lastProgressAt });
  }
  report.offlineOperationClocksPreserved = true;
  assert.equal(diagnostic.resumeAllowed, false); assert.equal(diagnostic.sleepAllowed, false);
  report.offlineRecoveryDiagnostic = true;
  if (crashMode) {
    const before = await service.journal.get(dispatched.attemptId);
    await assert.rejects(createSpriteCodexService(config, dependencies).start(), { code: 'SERVICE_RECOVERY_REQUIRED' });
    assert.equal(nativeLaunches, 1); assert.equal(report.modelRequests, 2);
    assert.deepEqual(await service.journal.get(dispatched.attemptId), before);
    assert.deepEqual(taskRequests, ['PUT', 'GET']);
    Object.assign(report, { restartRefused: true, nativeLaunches, rootWorkerStatus: 'running' });
  }
  }
  }
  report.status = 'passed';
} catch (error) {
  report.error = error.code ?? error.message;
  await writeFile(join(directory, 'diagnostics.log'), workerLogs + '\n' + errors.join('\n') + '\n' + error.stack, { mode: 0o600 });
  process.exitCode = 1;
} finally {
  if (portalMode) await browser('close').catch(() => {});
  try { await service?.stop(); await stop(worker); }
  catch { report.status = 'failed'; report.cleanupError = 'PROCESS_STOP_UNCONFIRMED'; process.exitCode = 1; }
  if (model) { model.closeAllConnections(); await new Promise(ok => model.close(ok)); }
  await dispatcher?.close();
  if (report.status === 'passed') await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  else report.privateDiagnostics = directory;
  console.log(JSON.stringify(report, null, 2));
}
