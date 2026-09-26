#!/usr/bin/env node
// F3/E02 abrupt-crash readback fixture for the pinned, unmodified Codex 0.154.0
// app-server. scripts/test-codex-native.mjs already covers cold readback after
// a GRACEFUL EOF exit with every thread deliberately unloaded; this fixture
// covers the complementary gap: the native executable is SIGKILLed while a
// spawned child turn is genuinely in flight (its provider request is held and
// never answered), over the same disposable native home, and a replacement
// process must recover custody through supported read-only thread/read
// reconciliation only.
// Verified properties:
//  - The killed PID is the attested pinned native executable (resolved through
//    /proc/<pid>/exe from .local/codex-runtime), distinguished from the npm
//    launcher PID; both PIDs are proven gone (ESRCH) before the replacement
//    starts. If the launcher outlives its executable, it is force-killed as
//    this fixture's own disposable process and that is reported, never hidden.
//  - The provider request counter is independent of the native process: the
//    restart and every reconciliation must submit no inference, replay no
//    cancellation (no turn/interrupt at all on the replacement) and change no
//    task identity (threadId/nativeRunId/childTurns key set/spawns survive).
//  - Crossed root/child identity rejects with SETTLEMENT_IDENTITY_MISMATCH
//    before any native read; an identical duplicate readback performs no
//    custody rewrite (journal.update is monkeypatched to fail).
//  - Unknown operation/effect/child obligations stay open: effectsSettled
//    stays undefined, sleep stays denied, and an unobserved in-flight child is
//    never forced into completion. If the supported history cannot reconcile
//    the interrupted active child (turn absent, protocol error, or status left
//    inProgress), that blocker is reported honestly instead of worked around.
// Explicit non-claims: this is process-crash evidence only. It is not
// power-loss evidence, not provider-takeover containment, not a proven safe
// resume, and no restart of inference is ever authorized here. No Codex
// database edits, dependency patches, live accounts, credentials or production
// flags are involved; the loopback model server is synthetic and counted.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdir, mkdtemp, readlink, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnCodex } from '../runtime/codex-transport.mjs';
import { CodexAdapter } from '../runtime/codex-adapter.mjs';
import { CodexEventRouter } from '../runtime/codex-events.mjs';
import { CodexTaskControl } from '../runtime/codex-tasks.mjs';
import { FileJournal } from '../runtime/file-journal.mjs';

const root = resolve(import.meta.dirname, '..');
const binary = join(root, '.local/codex-runtime/node_modules/.bin/codex');
const sleep = ms => new Promise(ok => setTimeout(ok, ms));
const alive = pid => {
  if (!Number.isInteger(pid)) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
};
const exited = child => child.exitCode !== null || child.signalCode !== null;
function response(id, output) {
  return { id, object: 'response', created_at: 1, status: 'completed', error: null,
    incomplete_details: null, instructions: null, model: 'fixture-model', output,
    parallel_tool_calls: true, temperature: null, tool_choice: 'auto', tools: [],
    top_p: null, background: false, max_output_tokens: null, max_tool_calls: null,
    previous_response_id: null, prompt: null, reasoning: { effort: null, summary: null },
    service_tier: 'default', store: false, text: { format: { type: 'text' } },
    truncation: 'disabled', usage: { input_tokens: 1, input_tokens_details: { cached_tokens: 0 }, output_tokens: 1, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 2 }, user: null, metadata: {} };
}
function sendEvents(res, output) {
  const id = `resp_${randomUUID().replaceAll('-', '')}`;
  const completed = response(id, output);
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  send('response.created', { response: { ...completed, status: 'in_progress', output: [] } });
  output.forEach((item, output_index) => {
    send('response.output_item.added', { output_index, item: { ...item, ...(item.type === 'message' ? { content: [] } : item.type === 'function_call' ? { arguments: '' } : {}) } });
    if (item.type === 'function_call') send('response.function_call_arguments.done', { output_index, item_id: item.id, arguments: item.arguments });
    if (item.type === 'message') {
      const text = item.content[0].text;
      send('response.content_part.added', { item_id: item.id, output_index, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
      send('response.output_text.delta', { item_id: item.id, output_index, content_index: 0, delta: text });
      send('response.output_text.done', { item_id: item.id, output_index, content_index: 0, text });
      send('response.content_part.done', { item_id: item.id, output_index, content_index: 0, part: item.content[0] });
    }
    send('response.output_item.done', { output_index, item });
  });
  send('response.completed', { response: completed });
  res.end('data: [DONE]\n\n');
}
function message(text) {
  return [{ id: `msg_${randomUUID().replaceAll('-', '')}`, type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text, annotations: [], logprobs: [] }] }];
}
async function readBody(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 2 * 1024 * 1024) throw new Error('Fixture request exceeds limit');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function waitFor(predicate, label, timeout = 10_000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (predicate()) return; await sleep(20); }
  throw new Error(`timeout waiting for ${label}`);
}
async function waitTurn(turnId, timeout = 30_000) {
  await waitFor(() => notifications.some(n => n.method === 'turn/completed' && n.params?.turn?.id === turnId), `turn/completed ${turnId}`, timeout);
  return notifications.find(n => n.method === 'turn/completed' && n.params?.turn?.id === turnId).params.turn;
}

async function nativeExecutablePid(launcherPid) {
  const processes = execFileSync('ps', ['-eo', 'pid=,ppid=,comm='], { encoding: 'utf8' })
    .trim().split('\n').map(line => {
      const [pid, ppid, name] = line.trim().split(/\s+/);
      return { pid: Number(pid), ppid: Number(ppid), name };
    });
  const children = processes.filter(item => item.ppid === launcherPid && item.name === 'codex');
  assert.equal(children.length, 1, 'expected exactly one Codex executable under the npm launcher');
  const pid = children[0].pid;
  const executable = await readlink(`/proc/${pid}/exe`);
  assert.ok(executable.startsWith(join(root, '.local/codex-runtime') + '/') && executable.endsWith('/codex'),
    'observed child is not the pinned native executable');
  assert.equal(alive(pid), true);
  return pid;
}

// Everything stays under the repository's private .local tree, like the
// warm-auto-stop fixture: the launch floor rejects /tmp ancestors.
let home, workspace, fixture, transport, router, currentNativePid;
let heldRequests = 0;
let heldClosed = 0;
const notifications = [];
const nativeErrors = [];
const fixtureErrors = [];
const bodies = [];
const held = new Map();
const report = { status: 'failed', codex: '0.154.0', modelPosts: 0, heldRequests: 0, heldClosed: 0,
  launcherPid: null, nativeExecutablePid: null, launcherForceKilled: false };
const watchdog = setTimeout(() => {
  report.watchdog = 'script exceeded 240s; failure cleanup stops the disposable fixture processes';
  for (const pid of [currentNativePid, transport?.child?.pid].filter(Number.isInteger)) {
    try { if (alive(pid)) process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
}, 240000);
try {
  const version = await promisify(execFile)(binary, ['--version'], { timeout: 10000 });
  assert.equal(version.stdout.trim(), 'codex-cli 0.154.0');
  home = await mkdtemp(join(resolve('.local'), 'crash-readback-'));
  await chmod(home, 0o700);
  workspace = join(home, 'workspace');
  await mkdir(workspace, { mode: 0o700 });

  fixture = createServer(async (req, res) => {
    try {
      if (req.method !== 'POST' || req.url !== '/v1/responses' || bodies.length >= 4) { res.writeHead(bodies.length >= 4 ? 429 : 404); res.end(); return; }
      const body = await readBody(req);
      bodies.push(body);
      const input = Array.isArray(body.input) ? body.input : [];
      const raw = JSON.stringify(input);
      // The child's user prompt is HELD forever: the child turn stays genuinely
      // in flight at the provider boundary when the native executable is killed.
      if (input.some(item => item?.role === 'user' && JSON.stringify(item.content).includes('HOLD_NATIVE_CHILD'))) {
        heldRequests++;
        res.once('close', () => { if (!res.writableEnded) heldClosed++; });
        held.set(heldRequests, res);
        return;
      }
      const output = input.find(item => item?.type === 'function_call_output');
      if (raw.includes('SPAWN_CHILD_PROOF')) {
        if (output) {
          const agentId = JSON.parse(String(output.output)).agent_id;
          assert.equal(typeof agentId, 'string');
          sendEvents(res, message('CRASH_READBACK_PARENT_ROOT_COMPLETED'));
          return;
        }
        const spawnTool = body.tools.find(tool => tool.name === 'spawn_agent' || tool.tools?.some(nested => nested.name === 'spawn_agent'));
        assert.ok(spawnTool, 'Native spawn_agent must be advertised');
        sendEvents(res, [{ id: `fc_${randomUUID().replaceAll('-', '')}`, type: 'function_call', status: 'completed', call_id: `call_${randomUUID().replaceAll('-', '')}`,
          ...(spawnTool.type === 'namespace' ? { namespace: spawnTool.name } : {}),
          name: 'spawn_agent', arguments: JSON.stringify({ message: 'HOLD_NATIVE_CHILD', agent_type: 'default' }) }]);
        return;
      }
      res.writeHead(404); res.end();
    } catch (error) {
      fixtureErrors.push(error.message);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  await new Promise((resolveListen, reject) => fixture.once('error', reject).listen(0, '127.0.0.1', resolveListen));
  const port = fixture.address().port;
  await writeFile(join(home, 'config.toml'), `model = "fixture-model"\nmodel_provider = "fixture"\napproval_policy = "never"\nsandbox_mode = "read-only"\nthread_unload_delay_secs = 2\n\n[model_providers.fixture]\nname = "Loopback fixture"\nbase_url = "http://127.0.0.1:${port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`, { mode: 0o600 });

  // Phase 1: one pinned native process, a completed root turn that spawns a child,
  // and the child left in flight at the provider boundary. The router is created
  // BEFORE the turn so every live notification is buffered for the later bind;
  // binding only selects the durably acknowledged IDs, never prompt text.
  transport = spawnCodex({ binary, home, cwd: workspace, timeoutMs: 10_000 });
  transport.child.stderr.on('data', chunk => nativeErrors.push(chunk.toString('utf8')));
  transport.on('notification', notification => notifications.push(notification));
  await transport.initialize({ experimentalApi: true });
  const journalPath = join(home, 'executor-journal');
  const journal = new FileJournal(journalPath);
  const liveAdapter = new CodexAdapter({ cwd: workspace, journal, rpc: (method, params) => transport.request(method, params) });
  const routerFailures = [];
  router = new CodexEventRouter({ transport, adapter: liveAdapter, onRecovery: value => routerFailures.push(value.code) });
  const parentThread = (await transport.request('thread/start', { cwd: workspace, modelProvider: 'fixture' })).thread.id;
  const parentTurn = (await transport.request('turn/start', { threadId: parentThread, input: [{ type: 'text', text: 'SPAWN_CHILD_PROOF' }] })).turn.id;
  assert.equal((await waitTurn(parentTurn)).status, 'completed');
  await waitFor(() => heldRequests === 1, 'child model request held at provider boundary');
  const spawned = notifications.find(n => n.method === 'item/completed' && n.params?.threadId === parentThread && n.params?.turnId === parentTurn && n.params.item?.type === 'collabAgentToolCall' && n.params.item.tool === 'spawnAgent')?.params.item;
  assert.equal(spawned.status, 'completed'); assert.equal(spawned.senderThreadId, parentThread);
  assert.equal(spawned.receiverThreadIds.length, 1);
  const childThread = spawned.receiverThreadIds[0];
  const childStarted = notifications.find(n => n.method === 'turn/started' && n.params?.threadId === childThread);
  assert.ok(childStarted, 'Child turn identity must be observed before the crash');
  const childKey = JSON.stringify([childThread, childStarted.params.turn.id]);
  const childTarget = { threadId: childThread, turnId: childStarted.params.turn.id };
  assert.equal(notifications.some(n => n.method === 'turn/completed' && n.params?.threadId === childThread && n.params.turn.id === childStarted.params.turn.id), false,
    'The in-flight child must never be observed as completed before the crash');

  // Durable custody for the live process: the buffered observations flush
  // through the bind, recording the spawn receipt and the in-flight child turn.
  await journal.putIfAbsent('crash-parent', { threadId: parentThread, nativeRunId: parentTurn, status: 'running', rootSettled: false });
  await router.bind('crash-parent');
  const parentRow = await liveAdapter.requireRun('crash-parent');
  assert.equal(parentRow.rootSettled, true);
  assert.equal(parentRow.nativeOutcome, 'completed');
  assert.deepEqual(parentRow.spawns[spawned.id], { status: 'completed', receiverThreadIds: [childThread] });
  assert.equal(parentRow.childTurns[childKey], 'inProgress');
  assert.equal(parentRow.effectsSettled, undefined);
  assert.deepEqual(routerFailures, []); assert.equal(router.pending.length, 0);
  report.liveSpawnReceiptRouting = true;
  const parentRowSnapshot = structuredClone(parentRow);
  // Simulate a Worker commit whose response is lost, using actual native IDs.
  // This is a metadata transport fixture, not live Worker takeover authority.
  const taskIdentity = { epoch: 7, boot_id: 'crash-fixture-boot' };
  const taskParent = { runId: 'crash-root-run', personaId: 'crash-persona', attempt: 1 };
  const registrations = [];
  const taskControl = { request: async (method, payload) => {
    assert.equal(method, 'native-child');
    registrations.push(structuredClone(payload));
    if (registrations.length === 1) throw new Error('synthetic lost registration response');
    assert.deepEqual(payload, registrations[0], 'recovery must reconcile the exact original receipt');
    return { id: 'retained-child-run', parent_run_id: taskParent.runId, persona_id: taskParent.personaId,
      current_attempt: 1, role: 'background', status: 'recovery_required' };
  } };
  const tasks = new CodexTaskControl({ adapter: liveAdapter, control: taskControl, journal,
    identity: taskIdentity, attemptId: 'crash-parent', parent: taskParent, assertLease: () => {} });
  await assert.rejects(tasks.sync(), /synthetic lost registration response/);
  const pendingMapping = await new FileJournal(journalPath).get(tasks.key);
  assert.deepEqual(Object.keys(pendingMapping.children), [childKey]);
  assert.equal(pendingMapping.children[childKey].runId, null);
  assert.equal(pendingMapping.children[childKey].started, false);
  assert.equal(pendingMapping.children[childKey].receipt.native_session_key, childThread);
  report.uncertainRegistrationPersistedBeforeCrash = true;
  router.close();
  await router.tail;
  router = null;

  // Phase 2: abrupt termination of the attested native executable while the
  // child turn is in flight. The transport child is only the npm launcher.
  report.launcherPid = transport.child.pid;
  currentNativePid = await nativeExecutablePid(report.launcherPid);
  report.nativeExecutablePid = currentNativePid;
  report.pinnedExecutableAttested = true;
  report.modelPostsAtCrash = bodies.length;
  assert.equal(bodies.length, 3, 'root spawn request, root continuation and held child request');
  process.kill(report.nativeExecutablePid, 'SIGKILL');
  report.abruptKill = 'SIGKILL';
  await waitFor(() => exited(transport.child), 'launcher exit after native executable crash', 10000)
    .catch(async () => {
      report.launcherForceKilled = true;
      transport.child.kill('SIGKILL');
      await waitFor(() => exited(transport.child), 'forced launcher exit', 5000);
    });
  assert.throws(() => process.kill(report.nativeExecutablePid, 0), error => error.code === 'ESRCH',
    'the native executable still exists after the crash');
  assert.throws(() => process.kill(report.launcherPid, 0), error => error.code === 'ESRCH',
    'the npm launcher still exists after the crash');
  currentNativePid = null;
  report.bothPidsGoneBeforeReplacement = true;
  await waitFor(() => heldClosed === 1, 'held child provider request closure', 10000);
  report.inFlightProviderRequestDiedWithProcess = true;
  assert.equal(bodies.length, 3, 'no provider traffic beyond the held child request');

  // Phase 3: a replacement process over the SAME disposable native home, and
  // read-only reconciliation only. The rpc wrapper independently records every
  // method: nothing except thread/read may ever pass.
  transport = spawnCodex({ binary, home, cwd: workspace, timeoutMs: 10_000 });
  transport.child.stderr.on('data', chunk => nativeErrors.push(chunk.toString('utf8')));
  await transport.initialize();
  currentNativePid = await nativeExecutablePid(transport.child.pid);
  report.replacementNativePid = currentNativePid;
  report.replacementStarted = true;
  assert.equal(bodies.length, 3, 'replacement startup must not submit inference');
  const rpcCalls = [];
  const replacementJournal = new FileJournal(journalPath);
  const replacementAdapter = new CodexAdapter({ cwd: workspace, journal: replacementJournal, rpc: (method, params) => {
    assert.equal(method, 'thread/read', 'crash reconciliation must stay read-only');
    rpcCalls.push(method);
    return transport.request(method, params);
  } });
  const recoveredRoot = await replacementAdapter.reconcile('crash-parent');
  assert.equal(recoveredRoot.rootSettled, true);
  assert.equal(recoveredRoot.nativeOutcome, 'completed');
  assert.equal(recoveredRoot.threadId, parentThread);
  assert.equal(recoveredRoot.nativeRunId, parentTurn);
  assert.equal(recoveredRoot.outputPreview.text, 'CRASH_READBACK_PARENT_ROOT_COMPLETED');
  assert.deepEqual(Object.keys(recoveredRoot.childTurns), [childKey]);
  assert.deepEqual(recoveredRoot.spawns, parentRowSnapshot.spawns);
  assert.equal(recoveredRoot.effectsSettled, undefined);
  assert.equal(bodies.length, 3, 'root reconciliation must not submit inference');
  report.completedRootRecovered = true;

  // Crossed root/child identity must reject before any native read.
  await assert.rejects(replacementAdapter.reconcileChild('crash-parent', { threadId: childThread, turnId: parentTurn }),
    { code: 'SETTLEMENT_IDENTITY_MISMATCH' });
  assert.equal(rpcCalls.length, 1, 'crossed identity must reject before the native read');
  report.crossedIdentityRejectedBeforeRead = true;

  // Genuine crash readback of the still-active child. Whatever the supported
  // history says is captured honestly; an unobserved turn is never completed.
  let recoveredChild = null;
  try {
    recoveredChild = await replacementAdapter.reconcileChild('crash-parent', childTarget);
  } catch (error) {
    if (error.code === 'RECONCILIATION_INCOMPLETE' || error.code === 'CODEX_PROTOCOL_ERROR') {
      report.childReadbackBlocker = error.code;
      report.supportedHistoryCannotReconcileActiveChild = true;
    } else throw error;
  }
  if (recoveredChild) {
    const historyStatus = recoveredChild.childTurns[childKey];
    report.childHistoryStatus = historyStatus;
    assert.ok(['inProgress', 'interrupted'].includes(historyStatus),
      `crash history must never force completion; observed ${historyStatus}`);
    if (historyStatus === 'inProgress') report.supportedHistoryCannotReconcileActiveChild = true;
    assert.equal(recoveredChild.threadId, parentThread);
    assert.equal(recoveredChild.nativeRunId, parentTurn);
    assert.deepEqual(recoveredChild.spawns, parentRowSnapshot.spawns);
    assert.deepEqual(Object.keys(recoveredChild.childTurns), [childKey]);
    assert.equal(recoveredChild.effectsSettled, undefined);
    assert.equal(recoveredChild.childObligations?.[childKey]?.effectsSettled, undefined);
    assert.equal(bodies.length, 3, 'child reconciliation must not submit inference or resume the turn');
    report.crashChildReadback = true;
  }
  assert.equal(replacementAdapter.sleepReadiness().allowed, false);
  report.sleepDeniedAfterCrashReadback = true;

  assert.deepEqual(await new FileJournal(journalPath).get(tasks.key), pendingMapping);
  const restoredTasks = new CodexTaskControl({ adapter: replacementAdapter, control: taskControl,
    journal: new FileJournal(journalPath), identity: taskIdentity, attemptId: 'crash-parent',
    parent: taskParent, assertLease: () => {} });
  const mapped = await restoredTasks.sync();
  assert.deepEqual(Object.keys(mapped), [childKey]);
  assert.equal(mapped[childKey].runId, 'retained-child-run');
  assert.equal(mapped[childKey].started, true);
  assert.deepEqual(mapped[childKey].receipt, pendingMapping.children[childKey].receipt);
  assert.deepEqual(await restoredTasks.sync(), mapped);
  assert.equal(registrations.length, 2, 'one uncertain request plus exact retry, no third registration');
  assert.deepEqual((await new FileJournal(journalPath).get(tasks.key)).children, mapped);
  assert.equal(replacementAdapter.sleepReadiness().allowed, false);
  report.exactRegistrationReconciledAfterCrash = true;
  report.registrationBoundary = 'synthetic Worker response; no lease or takeover claim';

  // Identical duplicate readback must not rewrite custody, for the child and
  // for the already-settled root. The root snapshot is taken AFTER the child
  // reconciliation: that legitimate custody patch is part of the accepted
  // first readback, so the duplicate must reproduce the patched row exactly.
  replacementJournal.update = () => assert.fail('identical crash readback must not rewrite custody');
  if (recoveredChild) assert.deepEqual(await replacementAdapter.reconcileChild('crash-parent', childTarget), recoveredChild);
  assert.deepEqual(await replacementAdapter.reconcile('crash-parent'), await new FileJournal(journalPath).get('crash-parent'));
  delete replacementJournal.update;
  report.duplicateReadbackWithoutRewrite = true;

  // Durable identity after everything: a fresh journal instance reads the same
  // custody, and the counted surfaces stayed silent.
  const durableRow = await new FileJournal(journalPath).get('crash-parent');
  assert.equal(durableRow.threadId, parentThread);
  assert.equal(durableRow.nativeRunId, parentTurn);
  assert.deepEqual(Object.keys(durableRow.childTurns), [childKey]);
  assert.equal(durableRow.effectsSettled, undefined);
  if (recoveredChild) assert.deepEqual(durableRow, recoveredChild);
  assert.equal(bodies.length, 3);
  assert.ok(bodies.every(body => body.model === 'fixture-model' && body.stream === true));
  assert.deepEqual(fixtureErrors, []);
  assert.equal(rpcCalls.filter(method => method !== 'thread/read').length, 0);
  assert.equal(rpcCalls.includes('turn/interrupt'), false, 'no cancellation replay after the crash');
  report.rpcCalls = rpcCalls.length;
  report.taskIdentityPreserved = true;
  report.noInferenceSubmittedByReplacement = true;
  assert.notEqual(report.supportedHistoryCannotReconcileActiveChild, true,
    'unsupported or still-active crash readback is a blocker, not a passing regression');
  assert.equal(report.childHistoryStatus, 'interrupted');
  report.status = 'passed';
} catch (error) {
  report.error = error?.stack ?? String(error);
  if (fixtureErrors.length) report.fixtureErrors = fixtureErrors;
  if (nativeErrors.length) report.nativeErrors = nativeErrors.join('').slice(-8000);
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  report.modelPosts = bodies.length; report.heldRequests = heldRequests; report.heldClosed = heldClosed;
  for (const res of held.values()) res.destroy();
  router?.close();
  if (router) await router.tail;
  transport?.close();
  if (transport) {
    const stopped = () => exited(transport.child) && !alive(transport.child.pid) && !alive(currentNativePid);
    await waitFor(stopped, 'native process stop', 5000)
      .catch(() => {
        if (alive(currentNativePid)) process.kill(currentNativePid, 'SIGKILL');
        transport.child.kill('SIGKILL');
      });
    await waitFor(stopped, 'native forced stop', 5000)
      .catch(() => { report.status = 'failed'; process.exitCode = 1; home = null; });
    if (stopped() && report.replacementStarted) report.replacementBothPidsGone = true;
  }
  if (fixture) { fixture.closeAllConnections(); await new Promise(resolveClose => fixture.close(resolveClose)); }
  if (home) await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => {
    report.status = 'failed'; report.cleanupError = 'PRIVATE_HOME_CLEANUP_FAILED'; process.exitCode = 1;
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
