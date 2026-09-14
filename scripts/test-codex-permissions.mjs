#!/usr/bin/env node
// Scripted disposable reads only; no Worker, account, or production admission.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CodexTransport } from '../runtime/codex-transport.mjs';

const binary = resolve(import.meta.dirname, '../.local/codex-runtime/node_modules/.bin/codex');
const directory = await mkdtemp(join(tmpdir(), 'hehe-permissions-'));
const home = join(directory, 'home'), cwd = join(directory, 'workspace'), secrets = join(directory, 'host-only');
const env = { PATH: process.env.PATH, LANG: 'C.UTF-8', HOME: home, CODEX_HOME: home };
const report = { status: 'failed', requests: 0, approvalsDenied: 0, approvalsAccepted: 0, assertions: [], observations: {}, productionEnabled: false,
  externalModelRequests: 0, filesystemIsolationProved: false, childInheritanceProved: false };
let transport, server;
const events = [], errors = [], calls = new Map(), counts = new Map();
const roots = new Map(), active = new Map(), approved = new Set();
function exactApproval(p, expected) {
  return Boolean(expected && p.kind === 'command' && p.command === expected.command && p.cwd === cwd &&
    p.threadId === expected.threadId && p.turnId === expected.turnId && p.itemId === expected.itemId &&
    p.reason == null && p.additionalPermissions == null && p.networkApprovalContext == null &&
    p.proposedNetworkPolicyAmendments == null && p.environmentId === 'local');
}
class SyntheticReadTransport extends CodexTransport {
  receive(message) {
    if (message.method === 'item/commandExecution/requestApproval' && Object.hasOwn(message, 'id')) {
      void this.approveSyntheticRead(message).catch(e => { errors.push(e.message); this.fail('APPROVAL_CHECK_FAILED'); });
      return;
    }
    super.receive(message);
  }
  async approveSyntheticRead(message) {
    const p = message.params, call = calls.get(p.itemId);
    let expected;
    if (call && call.index < 3 && !approved.has(p.itemId) && active.get(p.threadId) === p.turnId) {
      const root = roots.get(call.label.split('_')[0]);
      let correctThread = p.threadId === root;
      if (call.label.endsWith('CHILD') && p.threadId !== root) {
        const readback = await this.request('thread/read', { threadId: p.threadId, includeTurns: false });
        correctThread = readback.thread.source?.subAgent?.thread_spawn?.parent_thread_id === root;
      } else if (call.label.endsWith('CHILD')) correctThread = false;
      if (correctThread) expected = { command: call.command, threadId: p.threadId, turnId: active.get(p.threadId), itemId: p.itemId };
    }
    const accept = !approved.has(p.itemId) && active.get(p.threadId) === p.turnId && exactApproval(p, expected);
    if (accept) { approved.add(p.itemId); report.approvalsAccepted++; }
    else report.approvalsDenied++;
    report.approvalShapes ??= [];
    report.approvalShapes.push({ knownCall: Boolean(call), exactCommand: p.command === call?.command,
      commandShape: p.command?.replaceAll(directory, '<disposable>'), kind: p.kind,
      expectedIdentity: Boolean(expected), cwdMatches: p.cwd === cwd, environmentId: p.environmentId,
      amendmentProposed: p.proposedExecpolicyAmendment != null, networkAmendmentProposed: p.proposedNetworkPolicyAmendments != null,
      reasonPresent: p.reason != null, extraPermissions: p.additionalPermissions != null, accepted: accept });
    this.write({ id: message.id, result: { decision: accept ? 'accept' : 'decline' } });
  }
}
const sleep = ms => new Promise(ok => setTimeout(ok, ms));
async function wait(fn, label, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (errors.length) throw Error(errors[0]); const value = fn(); if (value) return value; await sleep(25); }
  throw Error(`Timed out: ${label}`);
}
const check = (name, fn) => { fn(); report.assertions.push(name); };
function send(res, output) {
  const response = { id: `resp_${randomUUID()}`, object: 'response', created_at: 1, status: 'completed', error: null,
    incomplete_details: null, model: 'fixture-model', output, tools: [], parallel_tool_calls: false,
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const event = (type, fields) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`);
  event('response.created', { response: { ...response, status: 'in_progress', output: [] } });
  output.forEach((item, output_index) => {
    event('response.output_item.added', { output_index, item });
    if (item.type === 'function_call') event('response.function_call_arguments.done', { output_index, item_id: item.id, arguments: item.arguments });
    event('response.output_item.done', { output_index, item });
  });
  event('response.completed', { response }); res.end('data: [DONE]\n\n');
}
function tool(body, name, args, observation) {
  const outer = body.tools.find(t => t.name === name || t.tools?.some(x => x.name === name));
  assert.ok(outer, `advertised ${name}`);
  const call_id = `call_${randomUUID()}`;
  if (observation) calls.set(call_id, observation);
  return [{ id: `fc_${randomUUID()}`, call_id, type: 'function_call', status: 'completed', name,
    ...(outer.type === 'namespace' ? { namespace: outer.name } : {}), arguments: JSON.stringify(args) }];
}
try {
  for (const path of [home, cwd, secrets]) await mkdir(path, { mode: 0o700 });
  const paths = [join(cwd, 'shared.txt'), join(secrets, 'grant.txt'), join(secrets, 'credential.txt')];
  const canaries = paths.map(() => `SYNTHETIC_${randomUUID()}`);
  for (let i = 0; i < paths.length; i++) await writeFile(paths[i], canaries[i], { mode: 0o600 });
  const executable = await realpath(binary);
  const hash = async () => createHash('sha256').update(await readFile(executable)).digest('hex');
  report.binarySha256Before = await hash();
  const version = await promisify(execFile)(binary, ['--version'], { env, cwd, timeout: 10000 });
  report.version = version.stdout.trim(); assert.equal(report.version, 'codex-cli 0.154.0');
  const nativeBinary = resolve(import.meta.dirname, '../.local/codex-runtime/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex');
  const nativeHash = async () => createHash('sha256').update(await readFile(nativeBinary)).digest('hex');
  report.nativeSha256Before = await nativeHash();
  // Evaluate the candidate policy offline only. Never install unsafe prefixes in CODEX_HOME/rules.
  const rulesPath = join(directory, 'candidate.rules');
  await writeFile(rulesPath, paths.map(path => `prefix_rule(pattern = ${JSON.stringify(['cat', path])}, decision = "allow")`).join('\n'), { mode: 0o600 });
  const policyCheck = async argv => JSON.parse((await promisify(execFile)(binary,
    ['execpolicy', 'check', '--rules', rulesPath, '--', ...argv], { env, cwd, timeout: 10000 })).stdout);
  for (const [index, path] of paths.entries()) {
    const result = await policyCheck(['cat', path]);
    check(`candidate prefix matches synthetic path ${index}`, () => assert.equal(result.decision, 'allow'));
  }
  report.prefixAllowsSuffix = (await policyCheck(['cat', paths[0], paths[1]])).decision === 'allow';
  check('prefix is not exact argv and is not installed', () => assert.equal(report.prefixAllowsSuffix, true));
  const otherPath = await policyCheck(['cat', join(directory, 'not-allowed')]);
  check('different path has no matching prefix', () => assert.deepEqual(otherPath.matchedRules, []));
  const expected = { command: `/bin/bash -c 'cat ${paths[0]}'`, threadId: 'root-19', turnId: 'turn-43', itemId: 'item-71' };
  const valid = { ...expected, kind: 'command', cwd, environmentId: 'local' };
  check('approval predicate accepts exact request and rejects suffix/path/identity/escalation', () => {
    assert.equal(exactApproval(valid, expected), true);
    for (const change of [{ command: `${expected.command} ${paths[1]}` }, { command: `cat ${paths[1]}` },
      { command: `head ${paths[0]}` }, { threadId: 'other' }, { turnId: 'other' }, { itemId: 'other' },
      { cwd: home }, { reason: 'retry without sandbox' }, { additionalPermissions: {} },
      { proposedNetworkPolicyAmendments: [] }, { networkApprovalContext: {} }, { environmentId: 'remote' }]) {
      assert.equal(exactApproval({ ...valid, ...change }, expected), false);
    }
    // A proposal is not accepted: response is only "accept", never an amendment/session decision.
    assert.equal(exactApproval({ ...valid, proposedExecpolicyAmendment: ['cat'] }, expected), true);
    assert.equal(exactApproval(valid, undefined), false);
  });
  server = createServer(async (req, res) => {
    try {
      assert.equal(req.url, '/v1/responses'); assert.equal(req.method, 'POST');
      const chunks = []; let bytes = 0;
      for await (const chunk of req) { bytes += chunk.length; assert.ok(bytes < 2097152); chunks.push(chunk); }
      const body = JSON.parse(Buffer.concat(chunks)); assert.ok(++report.requests <= 24);
      const user = body.input.filter(i => i.role === 'user' || i.type === 'agent_message').map(i => JSON.stringify(i.content)).join('\n');
      const label = ['CUSTOM_CHILD', 'BASE_CHILD', 'CUSTOM_ROOT', 'BASE_ROOT'].find(x => user.includes(`PERMISSIONS_${x}`));
      assert.ok(label, 'known scripted task');
      report.toolNames = [...new Set([...(report.toolNames ?? []), ...body.tools.flatMap(t => t.tools ?? [t]).map(t => t.name)])];
      for (const item of body.input) if (item.type === 'function_call_output' && calls.has(item.call_id)) {
        const { label: owner, index } = calls.get(item.call_id);
        const output = String(item.output);
        const read = index < 3 && output.includes(`Output:\n${canaries[index]}`) && output.includes('Process exited with code 0');
        const denied = index < 3 && output.includes(`cat: ${paths[index]}: Permission denied`) && output.includes('Process exited with code 1');
        report.observations[`${owner}:${index}`] = read ? 'read' :
          /reject|declin|approval/i.test(output) ? 'approval-denied' :
          /bwrap|namespace|sandbox.*(?:fail|error)|operation not permitted/i.test(output) ? 'sandbox-launch-failed' :
          denied ? 'filesystem-permission-denied' : 'unknown';
        if (denied) {
          report.readFailureEvidence ??= {};
          report.readFailureEvidence[`${owner}:${index}`] = { exitCode: 1, error: 'Permission denied', path: paths[index].replace(directory, '<disposable>') };
        }
      }
      const step = counts.get(label) ?? 0; counts.set(label, step + 1);
      if (step < 3) {
        const command = `cat ${paths[step]}`;
        send(res, tool(body, 'exec_command', { cmd: command, shell: '/bin/bash', login: false, sandbox_permissions: 'use_default', yield_time_ms: 1000, max_output_chars: 2000 },
          { label, index: step, command: `/bin/bash -c '${command}'` }));
      } else if (step === 3 && label.endsWith('ROOT')) {
        const command = `cat ${paths[0]} ${paths[1]}`;
        send(res, tool(body, 'exec_command', { cmd: command, shell: '/bin/bash', login: false, sandbox_permissions: 'use_default', yield_time_ms: 1000, max_output_chars: 2000 },
          { label, index: 3, command: `/bin/bash -c '${command}'` }));
      } else if (step === 4 && label.endsWith('ROOT')) {
        send(res, tool(body, 'spawn_agent', { message: `PERMISSIONS_${label.replace('ROOT', 'CHILD')}`, agent_type: 'default' }));
      } else send(res, [{ id: `msg_${randomUUID()}`, type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: 'SCRIPTED_DONE', annotations: [] }] }]);
    } catch (e) { errors.push(e.message); if (!res.headersSent) res.writeHead(400); res.end(); }
  });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  await writeFile(join(home, 'config.toml'), `default_permissions = "baseline"\nmodel = "fixture-model"\nmodel_provider = "fixture"\n[features]\ncode_mode = false\nmulti_agent = true\n[permissions.baseline.filesystem]\n":root" = "read"\n[permissions.baseline.network]\nenabled = false\n[permissions.isolated.filesystem]\n":root" = "read"\n":workspace_roots" = "read"\n${JSON.stringify(secrets)} = "deny"\n[permissions.isolated.network]\nenabled = false\n[model_providers.fixture]\nname = "Loopback only"\nbase_url = "http://127.0.0.1:${server.address().port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`, { mode: 0o600 });
  const child = spawn(binary, ['app-server', '--strict-config', '--listen', 'stdio://'], { env, cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  transport = new SyntheticReadTransport(child, { timeoutMs: 15000 });
  transport.on('notification', n => {
    events.push(n);
    if (n.method === 'turn/started') active.set(n.params.threadId, n.params.turn.id);
    if (n.method === 'turn/completed') active.delete(n.params.threadId);
  });
  transport.on('deniedRequest', () => report.approvalsDenied++);
  await transport.initialize({ experimentalApi: true });
  const config = await transport.request('config/read', { includeLayers: false, cwd });
  check('strict config reads exact named deny profile', () => {
    assert.equal(config.config.default_permissions, 'baseline');
    assert.equal(config.config.permissions.isolated.filesystem[secrets], 'deny');
    assert.equal(config.config.permissions.isolated.filesystem[':root'], 'read');
  });
  for (const mode of ['BASE', 'CUSTOM']) {
    const { thread } = await transport.request('thread/start', { cwd, model: 'fixture-model', approvalPolicy: 'untrusted',
      ...(mode === 'BASE' ? { sandbox: 'read-only' } : { permissions: 'isolated' }) });
    roots.set(mode, thread.id);
    const { turn } = await transport.request('turn/start', { threadId: thread.id, input: [{ type: 'text', text: `PERMISSIONS_${mode}_ROOT` }] });
    await wait(() => events.some(n => n.method === 'turn/completed' && n.params.threadId === thread.id && n.params.turn.id === turn.id), `${mode} root terminal`);
    await wait(() => [0, 1, 2].every(i => report.observations[`${mode}_CHILD:${i}`]), `${mode} child read results`);
    let childId;
    for (const id of new Set(events.filter(n => n.method === 'turn/started').map(n => n.params.threadId))) {
      if (id === thread.id) continue;
      const readback = await transport.request('thread/read', { threadId: id, includeTurns: false });
      if (readback.thread.source?.subAgent?.thread_spawn?.parent_thread_id === thread.id) childId = id;
    }
    check(`${mode} child readback has exact asymmetric parent identity`, () => { assert.ok(childId); assert.notEqual(childId, thread.id); });
    await wait(() => events.some(n => n.method === 'turn/completed' && n.params.threadId === childId), `${mode} child terminal`);
    report[`${mode.toLowerCase()}Identities`] = { root: thread.id, child: childId };
  }
  report.binarySha256After = await hash();
  report.nativeSha256After = await nativeHash();
  check('native executable remains pristine', () => assert.equal(report.binarySha256Before, report.binarySha256After));
  check('actual native ELF remains pristine', () => assert.equal(report.nativeSha256Before, report.nativeSha256After));
  check('twelve reads and two suffix-negative calls returned observations', () => {
    assert.equal(Object.keys(report.observations).length, 14);
    assert.equal(calls.size, 14);
  });
  check('all four native turns completed before shutdown', () => {
    assert.equal(active.size, 0);
    const terminal = events.filter(n => n.method === 'turn/completed');
    assert.equal(terminal.length, 4);
    assert.ok(terminal.every(n => n.params.turn.status === 'completed'));
  });
  const observed = (label, index) => report.observations[`${label}:${index}`];
  report.baselineOutsideRead = ['BASE_ROOT', 'BASE_CHILD'].every(l => [0, 1, 2].every(i => observed(l, i) === 'read'));
  report.filesystemIsolationProved = report.baselineOutsideRead && ['CUSTOM_ROOT', 'CUSTOM_CHILD'].every(l =>
    observed(l, 0) === 'read' && [1, 2].every(i => observed(l, i) === 'filesystem-permission-denied'));
  report.childInheritanceProved = report.filesystemIsolationProved;
  check('both actual suffix requests are declined rather than session-authorized', () => {
    assert.equal(observed('BASE_ROOT', 3), 'approval-denied');
    assert.equal(observed('CUSTOM_ROOT', 3), 'approval-denied');
  });
  if (report.filesystemIsolationProved) {
    check('baseline root and child read all three exact canaries', () => assert.equal(report.baselineOutsideRead, true));
    check('custom root and child retain workspace read and deny both outside reads', () => {
      for (const label of ['CUSTOM_ROOT', 'CUSTOM_CHILD']) {
        assert.equal(observed(label, 0), 'read');
        for (const index of [1, 2]) assert.equal(observed(label, index), 'filesystem-permission-denied');
      }
    });
    check('only twelve initial exact commands accepted; two suffixes declined', () => {
      assert.equal(report.approvalsAccepted, 12); assert.equal(report.approvalsDenied, 2);
    });
  }
  if (Object.values(report.observations).every(value => value === 'approval-denied')) {
    check('untrusted rejects every unmatched command before filesystem access', () => assert.equal(report.approvalsDenied, 14));
    report.gap = 'UNTRUSTED_COMMAND_APPROVAL_REQUIRED: no baseline read or filesystem enforcement observed';
  }
  report.status = report.filesystemIsolationProved ? 'passed' : 'capability-gap';
  if (!report.filesystemIsolationProved) process.exitCode = 2;
} catch (e) { report.error = e.message; report.fixtureErrors = errors; process.exitCode = 1; }
finally {
  if (transport) {
    transport.close();
    const stopped = () => transport.child.exitCode !== null || transport.child.signalCode !== null;
    try { await wait(stopped, 'native shutdown', 5000); }
    catch { transport.child.kill('SIGKILL'); await sleep(1000); }
    report.nativeStopped = stopped();
    if (!stopped()) { report.status = 'failed'; process.exitCode = 1; }
  }
  if (server) { server.closeAllConnections(); await new Promise(ok => server.close(ok)); }
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  report.disposableHomeRemoved = true;
  console.log(JSON.stringify(report, null, 2));
}
