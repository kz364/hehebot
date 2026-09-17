#!/usr/bin/env node
// Credential-free native capability check, not backend admission or live alpha.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnCodex } from '../runtime/codex-transport.mjs';

const root = resolve(import.meta.dirname, '..');
const binary = join(root, '.local/codex-runtime/node_modules/.bin/codex');
assert.ok(process.argv.slice(2).length <= 1 && process.argv.slice(2).every(arg => ['--profile-overrides', '--text-only'].includes(arg)), 'Unknown fixture option');
const textOnly = process.argv.includes('--text-only');
const profileOverrides = textOnly || process.argv.includes('--profile-overrides');
const disabled = ['multi_agent', 'multi_agent_v2', 'apps', 'plugins', 'tool_suggest',
  'image_generation', 'standalone_web_search', 'token_budget', 'request_permissions_tool',
  'exec_permission_approvals', 'code_mode', 'code_mode_only',
  ...(textOnly ? ['goals', 'hooks', 'view_image', 'sleep_tool'] : [])];
// Pinned spec: V1 multi_agent_v1.spawn_agent; V2 collaboration.spawn_agent;
// V2 without namespace tools uses plain spawn_agent. Try all, even when hidden.
const probes = [
  { namespace: 'multi_agent_v1', name: 'spawn_agent' },
  { namespace: 'collaboration', name: 'spawn_agent' },
  { name: 'spawn_agent' },
  ...(textOnly ? ['exec_command', 'write_stdin', 'apply_patch', 'view_image', 'create_goal',
    'update_goal', 'get_goal', 'exec', 'wait', 'request_user_input', 'update_plan',
    'list_mcp_resources', 'read_mcp_resource'].map(name => ({ name })) : []),
  ...(textOnly ? [{ namespace: 'clock', name: 'sleep' }] : []),
];
const raw = { rpc: [], events: [], requests: [], stderr: [], failures: [] };
const report = { status: 'capability_gap', codex: '0.154.0', persona: 'Travel',
  profileSource: profileOverrides ? 'cli-overrides' : 'config-file',
  ...(textOnly ? { textOnlyCandidate: true, completionEligible: false } : {}),
  rootTurns: 0, modelRequests: 0, externalModelCalls: 0, mcpServers: 0,
  productionAdmission: false, nativeVerified: false, modelJudgmentVerified: false };
const sleep = ms => new Promise(ok => setTimeout(ok, ms));
const startedAt = Date.now();
let directory, home, transport, server, rootId, modelRequests = 0;
let configPath, originalConfig, catalogPath, originalCatalog;
let deadline;
async function wait(predicate) {
  const until = Date.now() + 15000;
  while (Date.now() < until) { if (predicate()) return; await sleep(20); }
  throw new Error('NATIVE_OBSERVATION_TIMEOUT');
}
function send(res, output) {
  const response = { id: `resp_alpha_${modelRequests}`, object: 'response', status: 'completed',
    model: 'fixture-model', output, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const event = (type, fields) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`);
  event('response.created', { response: { ...response, status: 'in_progress', output: [] } });
  for (const [output_index, item] of output.entries()) {
    event('response.output_item.added', { output_index, item: { ...item,
      ...(item.type === 'function_call' ? { arguments: '' } : { content: [] }) } });
    if (item.type === 'function_call') {
      event('response.function_call_arguments.done', { output_index, item_id: item.id, arguments: item.arguments });
    } else {
      event('response.content_part.added', { output_index, item_id: item.id, content_index: 0,
        part: { type: 'output_text', text: '', annotations: [] } });
      event('response.output_text.delta', { output_index, item_id: item.id, content_index: 0, delta: item.content[0].text });
      event('response.output_text.done', { output_index, item_id: item.id, content_index: 0, text: item.content[0].text });
      event('response.content_part.done', { output_index, item_id: item.id, content_index: 0, part: item.content[0] });
    }
    event('response.output_item.done', { output_index, item });
  }
  event('response.completed', { response });
  res.end('data: [DONE]\n\n');
}
function message(text) {
  return [{ id: `msg_alpha_${modelRequests}`, type: 'message', status: 'completed', role: 'assistant',
    content: [{ type: 'output_text', text, annotations: [] }] }];
}
async function rpc(method, params) {
  const result = await transport.request(method, params);
  raw.rpc.push({ method, params, result });
  return result;
}
try {
  assert.equal((await promisify(execFile)(binary, ['--version'], { timeout: 10000 })).stdout.trim(), 'codex-cli 0.154.0');
  await mkdir(join(root, '.local'), { recursive: true, mode: 0o700 });
  directory = await mkdtemp(join(root, '.local/owner-alpha-native-'));
  home = join(directory, 'home');
  const workspace = join(directory, 'workspace');
  await mkdir(home, { mode: 0o700 });
  await mkdir(workspace, { mode: 0o700 });
  // These are deny-list placeholders, not real credentials or journal content.
  const filesystem = { ':minimal': 'read', [workspace]: 'read', [home]: 'deny',
    [join(directory, 'journal')]: 'deny', [join(directory, 'token')]: 'deny' };
  server = createServer(async (req, res) => {
    try {
      assert.equal(req.method, 'POST'); assert.equal(req.url, '/v1/responses');
      assert.ok(++modelRequests <= 3, 'UNEXPECTED_MODEL_REQUEST_OR_CHILD');
      const chunks = []; let bytes = 0;
      for await (const chunk of req) {
        assert.ok((bytes += chunk.length) <= 2 * 1024 * 1024);
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      raw.requests.push(body);
      assert.equal(body.model, 'fixture-model'); assert.equal(body.stream, true);
      const names = body.tools.flatMap(tool => tool.type === 'namespace'
        ? tool.tools.map(nested => `${tool.name}.${nested.name}`) : [tool.name ?? tool.type]);
      assert.ok(!names.some(name => /spawn_agent|web_search|image_generation|mcp|tool_suggest/.test(name)));
      if (textOnly) assert.deepEqual(body.tools, [], 'TEXT_ONLY_CATALOG_MUST_BE_EMPTY');
      if (modelRequests === 1) {
        report.toolCatalog = names;
        send(res, probes.map((probe, index) => ({ ...probe, id: `fc_alpha_${index}`,
          type: 'function_call', status: 'completed', call_id: `call_alpha_${index}`,
          arguments: JSON.stringify({ task_name: `forbidden_child_${index}`, message: 'FORBIDDEN_CHILD_REQUEST', agent_type: 'default' }) })));
      } else if (modelRequests === 2) {
        const outputs = body.input.filter(item => item.type === 'function_call_output');
        assert.equal(outputs.length, probes.length);
        report.spawnFailures = probes.map((probe, index) => {
          // protocol/src/tool_name.rs Display concatenates without a dot.
          const expected = `unsupported call: ${probe.namespace ?? ''}${probe.name}`;
          assert.equal(outputs.find(item => item.call_id === `call_alpha_${index}`)?.output, expected);
          return expected;
        });
        send(res, message('ROOT_ONLY_DENIALS_VISIBLE_19'));
      } else {
        assert.ok(body.input.some(item => item.role === 'user' && JSON.stringify(item.content).includes('ROOT_COMPLETION_43')));
        send(res, message('ROOT_COMPLETION_OK_43'));
      }
    } catch (error) {
      raw.failures.push(error.stack);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  if (textOnly) {
    // Supported startup-owned catalog, never an edit to a native cache/database.
    // Static direct metadata prevents remote/model-selected code mode overriding flags.
    catalogPath = join(home, 'fixture-models.json');
    const catalog = { models: [{ slug: 'fixture-model', display_name: 'Synthetic text-only fixture', description: null,
      supported_reasoning_levels: [], shell_type: 'unified_exec', visibility: 'list', supported_in_api: true,
      priority: 1, upgrade: null, model_messages: { instructions_template: 'Synthetic credential-free native fixture.', instructions_variables: null },
      default_reasoning_summary: 'auto', support_verbosity: false, tool_mode: 'direct',
      default_verbosity: null, apply_patch_tool_type: null, truncation_policy: { mode: 'bytes', limit: 10000 },
      supports_image_detail_original: false, context_window: 272000, auto_compact_token_limit: null,
      effective_context_window_percent: 95, experimental_supported_tools: [] }] };
    await writeFile(catalogPath, JSON.stringify(catalog), { mode: 0o600 });
    originalCatalog = await readFile(catalogPath);
    report.modelCatalogSha256 = createHash('sha256').update(originalCatalog).digest('hex');
  }
  const filesystemEntries = Object.entries(filesystem).map(([path, mode]) => `${JSON.stringify(path)} = ${JSON.stringify(mode)}`);
  const config = `model = "fixture-model"\nmodel_provider = "fixture"\nweb_search = "disabled"\n` +
    (textOnly ? `model_catalog_json = ${JSON.stringify(catalogPath)}\n[tools.experimental_request_user_input]\nenabled = false\n[tools.update_plan]\nenabled = false\n` : '') +
    (profileOverrides ? '' : 'default_permissions = "owner-alpha"\n') +
    `[agents]\nenabled = false\n[features]\n` +
    disabled.map(key => `${key} = false\n`).join('') +
    (profileOverrides ? '' : `[permissions.owner-alpha.filesystem]\n${filesystemEntries.join('\n')}\n[permissions.owner-alpha.network]\nenabled = false\n`) +
    `[model_providers.fixture]\nname = "Scripted loopback only"\nbase_url = "http://127.0.0.1:${server.address().port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\nrequest_max_retries = 0\nstream_max_retries = 0\n`;
  configPath = join(home, 'config.toml');
  await writeFile(configPath, config, { mode: 0o600 });
  originalConfig = await readFile(configPath);
  report.originalConfigSha256 = createHash('sha256').update(originalConfig).digest('hex');
  if (profileOverrides) {
    assert.doesNotMatch(config, /default_permissions|\[permissions\./);
    report.originalProfileAbsent = true;
    transport = spawnCodex({ binary, home, cwd: workspace, timeoutMs: 10000, configOverrides: {
      'permissions.owner-alpha': { filesystem, network: { enabled: false } }, default_permissions: 'owner-alpha',
    } });
  } else transport = spawnCodex({ binary, home, cwd: workspace, timeoutMs: 10000 });
  // Capture complete protocol frames privately, including callbacks and RPC errors.
  transport.child.stdout.on('data', chunk => (raw.stdout ??= []).push(chunk.toString('utf8')));
  transport.child.stderr.on('data', chunk => raw.stderr.push(chunk.toString('utf8')));
  transport.on('notification', event => raw.events.push(event));
  // Default transport denies every callback; no dynamic/MCP tools are installed.
  deadline = setTimeout(() => { raw.failures.push('ALPHA_DEADLINE_EXCEEDED'); transport.close(); server.closeAllConnections(); }, 240000);
  await transport.initialize({ experimentalApi: true });
  const { config: effective } = await rpc('config/read', { includeLayers: false, cwd: workspace });
  assert.equal(effective.agents.enabled, false);
  for (const key of disabled) assert.equal(effective.features[key], false);
  assert.equal(effective.web_search, 'disabled');
  report.configApprovalPolicy = effective.approval_policy;
  assert.equal(effective.default_permissions, 'owner-alpha');
  assert.deepEqual(effective.permissions['owner-alpha'].filesystem, { glob_scan_max_depth: null, ...filesystem });
  assert.equal(effective.permissions['owner-alpha'].network.enabled, false);
  assert.deepEqual(effective.mcp_servers, {});
  if (textOnly) {
    assert.equal(effective.model_catalog_json, catalogPath);
    // This protocol's config/read omits these extension tool settings. Verify
    // their effect via the exact provider catalog and injected dispatch probes.
    assert.ok(effective.notify == null);
  }
  report.configReadback = true;
  // Values come from native readback; redact only the random private paths.
  report.profileReadback = { default_permissions: effective.default_permissions,
    filesystem: Object.fromEntries(Object.entries(effective.permissions['owner-alpha'].filesystem)
      .map(([path, value]) => [path.startsWith(directory) ? `<private>${path.slice(directory.length)}` : path, value])),
    network: { enabled: effective.permissions['owner-alpha'].network.enabled } };
  const started = await rpc('thread/start', { cwd: workspace, model: 'fixture-model', modelProvider: 'fixture',
    permissions: 'owner-alpha', approvalPolicy: 'untrusted', baseInstructions: 'You are Travel. Only this root is admitted.',
    ...(textOnly ? { dynamicTools: [] } : {}) });
  assert.equal(started.approvalPolicy, 'untrusted');
  report.threadApprovalPolicy = started.approvalPolicy;
  rootId = started.thread.id;
  for (const [prompt, expected] of [['ROOT_SPAWN_DENIAL_19', 'ROOT_ONLY_DENIALS_VISIBLE_19'],
    ['ROOT_COMPLETION_43', 'ROOT_COMPLETION_OK_43']]) {
    const { turn } = await rpc('turn/start', { threadId: rootId, input: [{ type: 'text', text: prompt }],
      ...(textOnly ? { environments: [] } : {}) });
    report.rootTurns++;
    await wait(() => raw.events.some(event => event.method === 'turn/completed' && event.params?.turn.id === turn.id));
    const { thread } = await rpc('thread/read', { threadId: rootId, includeTurns: true });
    const saved = thread.turns.find(item => item.id === turn.id);
    assert.equal(saved.status, 'completed');
    assert.deepEqual(saved.items.filter(item => item.type === 'agentMessage').map(item => item.text), [expected]);
  }
  const loaded = await rpc('thread/loaded/list', {});
  assert.deepEqual(loaded, { data: [rootId], nextCursor: null });
  const listed = await rpc('thread/list', { limit: 100 });
  assert.equal(listed.nextCursor, null);
  assert.deepEqual(listed.data.map(thread => thread.id), [rootId]);
  assert.deepEqual(await rpc('thread/backgroundTerminals/list', { threadId: rootId }), { data: [], nextCursor: null });
  assert.equal(raw.events.filter(event => event.method === 'thread/started').length, 1);
  const turns = raw.events.filter(event => event.method === 'turn/started');
  assert.equal(turns.length, 2); assert.ok(turns.every(event => event.params.threadId === rootId));
  assert.ok(!raw.events.some(event => event.params?.item?.type === 'collabAgentToolCall'));
  assert.equal(modelRequests, 3); assert.deepEqual(raw.failures, []);
  if (textOnly) {
    assert.deepEqual(await readFile(catalogPath), originalCatalog);
    report.modelCatalogUnchanged = true;
    report.forbiddenDispatchesRejected = probes.length;
  }
  assert.ok(Date.now() - startedAt < 300000);
  report.noChildObserved = true;
  report.exactRootOutputs = ['ROOT_ONLY_DENIALS_VISIBLE_19', 'ROOT_COMPLETION_OK_43'];
  report.status = 'passed';
} catch (error) {
  raw.failures.push(error.stack);
  // No raw native errors, paths, arguments or prompt content in public output.
  report.gap = 'ROOT_ONLY_CONTRACT_NOT_ESTABLISHED_SEE_PRIVATE_RAW';
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  transport?.close();
  if (transport) await wait(() => transport.child.exitCode !== null || transport.child.signalCode !== null)
    .catch(() => { transport.child.kill('SIGKILL'); report.status = 'capability_gap'; process.exitCode = 1; });
  if (server) { server.closeAllConnections(); await new Promise(ok => server.close(ok)); }
  if (originalConfig) {
    try {
      const finalConfig = await readFile(configPath);
      report.finalConfigSha256 = createHash('sha256').update(finalConfig).digest('hex');
      assert.deepEqual(finalConfig, originalConfig);
      report.originalConfigUnchanged = true;
    } catch (error) {
      raw.failures.push(error.stack);
      report.status = 'capability_gap'; report.gap = 'ORIGINAL_CONFIG_CHANGED_OR_UNREADABLE'; process.exitCode = 1;
    }
  }
  report.modelRequests = modelRequests;
  report.elapsedMs = Date.now() - startedAt;
  if (directory) {
    await writeFile(join(directory, 'raw.json'), JSON.stringify(raw, null, 2), { mode: 0o600 });
    await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
    await rm(home, { recursive: true, force: true });
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
