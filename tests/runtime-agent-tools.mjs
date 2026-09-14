import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AGENT_TOOL_NAMES, buildToolDefinitions, createAgentToolsHandler } from '../runtime/agent-tools.mjs';

const contracts = JSON.parse(await readFile(new URL('../SCHEMAS/contracts.json', import.meta.url)));
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const config = { identity: { epoch: 7, boot_id: uuid(10) }, runId: uuid(1), attempt: 3, allowedTools: [...AGENT_TOOL_NAMES] };
const skill = { proposal_id: uuid(2), skill_id: uuid(3), expected_skill_revision: 0, body: {
  name: 'Useful skill', description: 'Does a useful thing', when_to_use: 'When useful', inputs_access: [], steps: ['Do it'], decision_rules: [], validation: ['Check it'], output: 'A result', failure_handling: ['Stop safely'], approval_boundaries: ['No effects'], contains_private_facts: false,
}, executable_files_changed: false };
const routine = { id: uuid(4), expected_revision: 0, persona_id: uuid(5), name: 'Daily check', instructions: 'Check safely', schedule: { cron: '0 9 * * *', timezone: 'Asia/Jakarta' }, trigger_source_id: null, enabled: false, policy: { misfire: 'coalesce', overlap: 'queue_one', max_replay: 1, max_lateness_seconds: 60 }, action_policy_ids: [] };

function fixture(overrides = {}) {
  const calls = [];
  const controlClient = { request: async (...args) => { calls.push(args); return { status: 'applied' }; }, ...overrides };
  return { calls, handle: createAgentToolsHandler({ controlClient, config, contracts }) };
}
const call = (id, name, payload, extra = {}) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: { idempotency_key: uuid(9), payload, ...extra } } });

test('tool schemas derive from canonical command payloads and resolve root refs', () => {
  const tools = buildToolDefinitions(contracts); const ajv = new Ajv({ strict: true }); addFormats(ajv);
  assert.deepEqual(tools.map(x => x.name), AGENT_TOOL_NAMES);
  assert.ok(ajv.compile(tools[0].inputSchema)({ idempotency_key: uuid(9), payload: skill }));
  assert.ok(ajv.compile(tools[1].inputSchema)({ idempotency_key: uuid(9), payload: routine }));
  assert.equal(JSON.stringify(tools).includes('$ref'), false);
  assert.equal(tools[0].inputSchema.properties.payload.properties.provenance, undefined);
});

test('initialize, ping, list and initialized notifications use JSON-RPC envelopes', async () => {
  const { handle } = fixture();
  assert.equal((await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })).result.protocolVersion, '2024-11-05');
  assert.deepEqual(await handle({ jsonrpc: '2.0', id: 'p', method: 'ping' }), { jsonrpc: '2.0', id: 'p', result: {} });
  assert.deepEqual((await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).result.tools.map(x => x.name), AGENT_TOOL_NAMES);
  assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), undefined);
});

test('fixed tools reject unsupported methods, owner review and malformed input locally', async () => {
  const { handle, calls } = fixture();
  assert.equal((await handle({ jsonrpc: '2.0', id: 1, method: 'owner/command' })).error.code, -32601);
  assert.equal((await handle(call(2, 'clawbot_review_skill', skill))).error.code, -32602);
  assert.equal((await handle(call(3, AGENT_TOOL_NAMES[0], { ...skill, name: 'wrong level' }))).error.code, -32602);
  assert.equal((await handle(call(4, AGENT_TOOL_NAMES[0], skill, { actor: 'owner', identity: {} }))).error.code, -32602);
  assert.equal(calls.length, 0);
});

test('host identity wins, provenance is forced, and idempotency key is unchanged', async () => {
  const { handle, calls } = fixture();
  const result = await handle(call(1, AGENT_TOOL_NAMES[0], skill));
  assert.equal(result.result.content[0].type, 'text');
  assert.equal(calls.length, 1); assert.equal(calls[0][0], 'agent-command');
  const sent = calls[0][1];
  assert.deepEqual(sent.identity, config.identity); assert.equal(sent.run_id, config.runId); assert.equal(sent.attempt, 3);
  assert.equal(sent.idempotency_key, uuid(9));
  assert.deepEqual(sent.command.payload.provenance, { kind: 'model', source_ref: config.runId });
});

test('routine uses canonical shape and backend is called exactly once without retries', async () => {
  let attempts = 0;
  const { handle } = fixture({ request: async () => { attempts++; throw new Error('token and backend detail'); } });
  const response = await handle(call(1, AGENT_TOOL_NAMES[1], routine));
  assert.equal(attempts, 1); assert.equal(response.error.code, -32000);
  assert.equal(JSON.stringify(response).includes('token'), false);
  assert.match(response.error.message, /same idempotency key/);
});

test('run and delete tools preserve revision checks and cannot silently save a routine', async () => {
  const { handle, calls } = fixture();
  const payload = { id: uuid(4), expected_revision: 7 };
  for (const [tool, type] of [['clawbot_run_routine', 'routine.run'], ['clawbot_delete_routine', 'routine.delete']]) {
    await handle(call(1, tool, payload));
    assert.deepEqual(calls.at(-1)[1].command, { schema_version: 1, type, payload });
    assert.equal((await handle(call(2, tool, { id: uuid(4) }))).error.code, -32602);
  }
  assert.equal(calls.length, 2);
});

test('routine read tool routes only a bounded query with host-owned identity', async () => {
  const requests = [];
  const { handle } = fixture({ request: async (...args) => { requests.push(args); return { routines: [], next_cursor: null }; } });
  const message = { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'clawbot_list_routines', arguments: { after: uuid(12) } } };
  assert.deepEqual(JSON.parse((await handle(message)).result.content[0].text), { routines: [], next_cursor: null });
  assert.deepEqual(requests, [['agent-routines', { after: uuid(12), identity: config.identity, run_id: config.runId, attempt: config.attempt }]]);
  message.params.arguments.identity = { epoch: 99 };
  assert.equal((await handle(message)).error.code, -32602); assert.equal(requests.length, 1);
});

test('skill read binds host identity and rejects mismatched or malformed returned revisions', async () => {
  const requests = [];
  let result = { skill: { id: uuid(3), revision: 7, body: skill.body } };
  const { handle } = fixture({ request: async (...args) => { requests.push(args); return result; } });
  const message = { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'clawbot_read_skill', arguments: { skill_id: uuid(3) } } };
  assert.deepEqual(JSON.parse((await handle(message)).result.content[0].text), result);
  assert.deepEqual(requests, [['agent-skill', { skill_id: uuid(3), identity: config.identity, run_id: config.runId, attempt: config.attempt }]]);
  for (const value of [{ id: uuid(4), revision: 7 }, { id: uuid(3), revision: 0 }, { id: uuid(3), revision: 1.5 }]) {
    result = { skill: value }; assert.equal((await handle(message)).error.code, -32000);
  }
  message.params.arguments.run_id = uuid(77);
  assert.equal((await handle(message)).error.code, -32602); assert.equal(requests.length, 4);
});

test('allowedTools is a host allowlist and cannot name owner-only commands', async () => {
  const one = createAgentToolsHandler({ controlClient: { request: async () => ({}) }, config: { ...config, allowedTools: [AGENT_TOOL_NAMES[1]] }, contracts });
  assert.deepEqual((await one({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).result.tools.map(x => x.name), [AGENT_TOOL_NAMES[1]]);
  assert.equal((await one(call(2, AGENT_TOOL_NAMES[0], skill))).error.code, -32602);
  assert.throws(() => createAgentToolsHandler({ controlClient: { request() {} }, config: { ...config, allowedTools: ['skill.review'] }, contracts }), /INVALID_CONFIGURATION/);
});

test('real CLI accepts private grants but rejects symlinks and oversized frames without leaking secrets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'clawbot-tools-cli-'));
  try {
    const tokenFile = join(dir, 'token'), grant = join(dir, 'grant'), link = join(dir, 'link');
    await writeFile(tokenFile, 'private-fixture-token', { mode: 0o600 });
    await writeFile(grant, JSON.stringify({ ...config, origin: 'https://127.0.0.1:1/', tokenFile }), { mode: 0o600 });
    await symlink(grant, link);
    const run = (path, input) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['runtime/agent-tools.mjs'], {
        env: { PATH: process.env.PATH, CLAWBOT_AGENT_TOOLS_CONFIG: path }, timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '', stderr = '';
      child.stdout.on('data', x => { stdout += x; }); child.stderr.on('data', x => { stderr += x; });
      child.stdin.on('error', () => {});
      child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }));
      child.stdin.end(input);
    });
    const ping = JSON.stringify({ jsonrpc: '2.0', id: 42, method: 'ping' }) + '\n';
    const healthy = await run(grant, ping);
    assert.equal(healthy.code, 0); assert.deepEqual(JSON.parse(healthy.stdout), { jsonrpc: '2.0', id: 42, result: {} });
    for (const [path, input] of [[link, ping], [grant, 'x'.repeat(1024 * 1024 + 1)]]) {
      const failed = await run(path, input);
      assert.equal(failed.code, 1); assert.equal(failed.stdout, '');
      assert.equal(failed.stderr, 'clawbot-agent-tools: startup failed\n');
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
