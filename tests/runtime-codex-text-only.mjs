import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CODEX_TEXT_ONLY_FEATURES, codexTextOnlyProfileSha256, createCodexTextOnlyCompletionReceipt,
  createCodexTextOnlyProfile, verifyCodexTextOnlyProfile } from '../runtime/codex-text-only.mjs';

const modelEntry = { slug: 'gpt-owner', tool_mode: 'direct', experimental_supported_tools: [], display_name: 'Owner model' };
const make = (extra = {}) => createCodexTextOnlyProfile({ codexVersion: '0.154.0', model: 'gpt-owner',
  modelCatalog: { models: [modelEntry] }, catalogPath: '/private/models.json', catalogValidation: 'validated-genuine', accountModelChecked: true, ...extra });
const readback = profile => ({ model: profile.model, web_search: 'disabled', notify: null,
  model_catalog_json: '/private/models.json',
  skills: { include_instructions: false }, project_doc_max_bytes: 0,
  agents: { enabled: false }, features: Object.fromEntries(CODEX_TEXT_ONLY_FEATURES.map(key => [key, false])), mcp_servers: {} });
const verify = (profile, extra = {}) => verifyCodexTextOnlyProfile(profile, { codexVersion: '0.154.0', model: profile.model,
  configReadback: readback(profile), catalogContent: JSON.stringify(profile.modelCatalog),
  commandedConfigContent: JSON.stringify(profile.startupConfig), ...extra });

test('constructs the exact versioned direct text-only command surface', () => {
  const profile = make();
  assert.equal(profile.version, 'codex-text-only-v1');
  assert.deepEqual(profile.threadStart, { model: 'gpt-owner', dynamicTools: [] });
  assert.deepEqual(profile.turnStart, { environments: [] });
  assert.deepEqual(profile.startupConfig.mcp_servers, {});
  assert.equal(profile.startupConfig.notify, undefined);
  assert.equal(profile.startupConfig['tools.experimental_request_user_input.enabled'], false);
  assert.equal(profile.startupConfig['tools.update_plan.enabled'], false);
  assert.equal(verify(profile).completionEligible, false);
});

test('forward input flags change only the new commanded digest and require explicit readback', () => {
  const profile = make(), oldCommands = structuredClone(profile.startupConfig);
  for (const key of ['features.memories', 'features.skill_search', 'skills.include_instructions', 'project_doc_max_bytes']) delete oldCommands[key];
  assert.notEqual(profile.binding.commandedConfigSha256, createHash('sha256').update(JSON.stringify(oldCommands)).digest('hex'));
  for (const key of ['memories', 'skill_search']) {
    const config = readback(profile); delete config.features[key];
    assert.throws(() => verify(profile, { configReadback: config }), /TEXT_ONLY_READBACK_MISMATCH/);
  }
  for (const change of [{ skills: null }, { skills: { include_instructions: true } }, { project_doc_max_bytes: 1 }, { project_doc_max_bytes: undefined }])
    assert.throws(() => verify(profile, { configReadback: { ...readback(profile), ...change } }), /TEXT_ONLY_READBACK_MISMATCH/);
});

test('requires caller catalog/account attestations, except explicit synthetic fixtures', () => {
  assert.throws(() => make({ accountModelChecked: false }), { code: 'TEXT_ONLY_ACCOUNT_MODEL_CHECK_REQUIRED' });
  assert.throws(() => make({ catalogValidation: 'claimed' }), { code: 'TEXT_ONLY_CATALOG_UNVALIDATED' });
  assert.throws(() => make({ syntheticFixture: true, accountModelChecked: false }), { code: 'TEXT_ONLY_CATALOG_UNVALIDATED' });
  assert.throws(() => make({ syntheticFixture: 'true' }), { code: 'TEXT_ONLY_INVALID_INPUT' });
  assert.doesNotThrow(() => make({ model: 'fixture', modelCatalog: { models: [{ ...modelEntry, slug: 'fixture' }] },
    catalogValidation: 'synthetic-fixture', syntheticFixture: true, accountModelChecked: false }));
});

test('rejects asymmetric model/catalog metadata and unknown contract keys', () => {
  assert.throws(() => make({ catalogPath: 'relative.json' }), { code: 'TEXT_ONLY_INVALID_INPUT' });
  assert.throws(() => make({ model: 'other' }), { code: 'TEXT_ONLY_CATALOG_MISMATCH' });
  assert.throws(() => make({ modelCatalog: { models: [{ ...modelEntry, tool_mode: 'code' }] } }), { code: 'TEXT_ONLY_CATALOG_MISMATCH' });
  assert.throws(() => make({ modelCatalog: { models: [modelEntry], extra: true } }), { code: 'TEXT_ONLY_CATALOG_MISMATCH' });
  assert.throws(() => createCodexTextOnlyProfile({ codexVersion: '0.154.0', model: 'gpt-owner', modelCatalog: { models: [modelEntry] },
    catalogPath: '/private/models.json', catalogValidation: 'validated-genuine', accountModelChecked: true, surprise: true }), { code: 'TEXT_ONLY_INVALID_INPUT' });
});

test('rejects notify, MCP and dangerous-feature readback presence', () => {
  const profile = make();
  assert.throws(() => verify(profile, { configReadback: { ...readback(profile), model_catalog_json: '/other/models.json' } }), { code: 'TEXT_ONLY_READBACK_MISMATCH' });
  assert.throws(() => verify(profile, { configReadback: { ...readback(profile), tools: { update_plan: { enabled: true } } } }), { code: 'TEXT_ONLY_READBACK_MISMATCH' });
  assert.throws(() => verify(profile, { configReadback: { ...readback(profile), notify: ['command'] } }), { code: 'TEXT_ONLY_READBACK_MISMATCH' });
  assert.throws(() => verify(profile, { configReadback: { ...readback(profile), mcp_servers: { x: {} } } }), { code: 'TEXT_ONLY_READBACK_MISMATCH' });
  assert.throws(() => verify(profile, { configReadback: { ...readback(profile), features: { ...readback(profile).features, hooks: true } } }), { code: 'TEXT_ONLY_READBACK_MISMATCH' });
});

test('binds immutable catalog and commanded omitted settings and rejects profile drift', () => {
  const profile = make();
  assert.throws(() => verify(profile, { model: 'other' }), { code: 'TEXT_ONLY_PROFILE_MISMATCH' });
  assert.throws(() => verify(profile, { catalogContent: `${JSON.stringify(profile.modelCatalog)}\n` }), { code: 'TEXT_ONLY_PROFILE_CHANGED' });
  assert.throws(() => verify(profile, { commandedConfigContent: JSON.stringify({ ...profile.startupConfig, tools: {} }) }), { code: 'TEXT_ONLY_PROFILE_CHANGED' });
});

const receiptInput = profile => ({ profile, verification: { codexVersion: '0.154.0', model: profile.model,
  configReadback: readback(profile), catalogContent: JSON.stringify(profile.modelCatalog),
  commandedConfigContent: JSON.stringify(profile.startupConfig) },
expected: { threadId: 'thread-19', turnId: 'turn-43', agentItemId: 'answer-71', outputText: 'Exact answer ✓' },
submission: { threadStart: { model: profile.model, dynamicTools: [] }, threadIdAck: 'thread-19',
  turnStart: { threadId: 'thread-19', environments: [] }, turnIdAck: 'turn-43' },
readback: { method: 'thread/read', params: { threadId: 'thread-19', includeTurns: true }, result: { thread: {
  id: 'thread-19', turns: [{ id: 'turn-43', status: 'completed', items: [
    { id: 'question', type: 'userMessage', text: 'question' }, { id: 'thought', type: 'reasoning' },
    { id: 'answer-71', type: 'agentMessage', phase: 'final_answer', text: 'Exact answer ✓' }] }] } } },
eventRouter: { threadId: 'thread-19', turnId: 'turn-43', healthy: true, fullyFlushed: true, streamLossObserved: false } });

test('constructs exact local text-only receipt from commanded IDs and supported readback', () => {
  const profile = make(), receipt = createCodexTextOnlyCompletionReceipt(receiptInput(profile));
  assert.equal(receipt.profile_sha256, codexTextOnlyProfileSha256(profile));
  assert.deepEqual(receipt.result, { status: 'completed', text: 'Exact answer ✓' });
  assert.match(receipt.output_sha256, /^[0-9a-f]{64}$/);
  assert.equal(receipt.thread_id, 'thread-19'); assert.equal(receipt.turn_id, 'turn-43');
});

test('receipt rejects identity, profile, output and stream corruption', () => {
  const profile = make();
  const mutate = fn => { const value = structuredClone(receiptInput(profile)); value.profile = profile; fn(value); return value; };
  assert.throws(() => createCodexTextOnlyCompletionReceipt(mutate(v => { v.submission.turnIdAck = 'wrong'; })), { code: 'TEXT_ONLY_SUBMISSION_MISMATCH' });
  assert.throws(() => createCodexTextOnlyCompletionReceipt(mutate(v => { v.verification.model = 'wrong'; })), { code: 'TEXT_ONLY_PROFILE_MISMATCH' });
  assert.throws(() => createCodexTextOnlyCompletionReceipt(mutate(v => { v.readback.result.thread.turns[0].items[2].id = 'wrong'; })), { code: 'TEXT_ONLY_OUTPUT_AMBIGUOUS' });
  assert.throws(() => createCodexTextOnlyCompletionReceipt(mutate(v => { v.eventRouter.streamLossObserved = true; })), { code: 'TEXT_ONLY_STREAM_UNVERIFIED' });
});

test('receipt rejects incomplete turns, competitors, tools, unknowns and ambiguous finals', () => {
  const profile = make();
  for (const [change, code] of [
    [v => { v.readback.result.thread.turns[0].status = 'failed'; }, 'TEXT_ONLY_TURN_NOT_COMPLETED'],
    [v => { v.readback.result.thread.turns.push({ id: 'other', status: 'inProgress', items: [] }); }, 'TEXT_ONLY_COMPETING_TURN'],
    [v => { v.readback.result.thread.turns[0].items.push({ id: 'tool', type: 'commandExecution' }); }, 'TEXT_ONLY_UNSUPPORTED_ITEM'],
    [v => { v.readback.result.thread.turns[0].items.push({ id: 'mystery', type: 'futureItem' }); }, 'TEXT_ONLY_UNSUPPORTED_ITEM'],
    [v => { v.readback.result.thread.turns[0].items.push({ id: 'answer-2', type: 'agentMessage', phase: 'final_answer', text: 'second' }); }, 'TEXT_ONLY_OUTPUT_AMBIGUOUS'],
    [v => { v.readback.result.thread.turns[0].items[2].text = ''; }, 'TEXT_ONLY_OUTPUT_AMBIGUOUS'],
  ]) {
    const value = structuredClone(receiptInput(profile)); value.profile = profile; change(value);
    assert.throws(() => createCodexTextOnlyCompletionReceipt(value), { code });
  }
});
