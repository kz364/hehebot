import test from 'node:test';
import assert from 'node:assert/strict';
import { CODEX_TEXT_ONLY_FEATURES, createCodexTextOnlyProfile, verifyCodexTextOnlyProfile } from '../runtime/codex-text-only.mjs';

const modelEntry = { slug: 'gpt-owner', tool_mode: 'direct', experimental_supported_tools: [], display_name: 'Owner model' };
const make = (extra = {}) => createCodexTextOnlyProfile({ codexVersion: '0.154.0', model: 'gpt-owner',
  modelCatalog: { models: [modelEntry] }, catalogPath: '/private/models.json', catalogValidation: 'validated-genuine', accountModelChecked: true, ...extra });
const readback = profile => ({ model: profile.model, web_search: 'disabled', notify: null,
  model_catalog_json: '/private/models.json',
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
