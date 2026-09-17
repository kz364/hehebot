import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { PINNED_CODEX } from './codex-adapter.mjs';

export const CODEX_TEXT_ONLY_PROFILE_VERSION = 'codex-text-only-v1';
export const CODEX_TEXT_ONLY_FEATURES = Object.freeze([
  'multi_agent', 'multi_agent_v2', 'apps', 'plugins', 'tool_suggest',
  'image_generation', 'standalone_web_search', 'token_budget',
  'request_permissions_tool', 'exec_permission_approvals', 'code_mode',
  'code_mode_only', 'goals', 'hooks', 'view_image', 'sleep_tool',
]);

const fail = code => { throw Object.assign(new Error(code), { code }); };
const digest = value => createHash('sha256').update(value).digest('hex');
const bytes = value => Buffer.isBuffer(value) ? value : Buffer.from(value);
const exactKeys = (value, expected, code, required = expected) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !expected.includes(key)) || required.some(key => !Object.hasOwn(value, key))) fail(code);
};
const deepFreeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

/** Builds immutable startup commands and their content binding. It does not
 * establish model entitlement, execute Codex, or settle a task. */
export function createCodexTextOnlyProfile({ codexVersion, model, modelCatalog, catalogPath,
  catalogValidation, accountModelChecked = false, syntheticFixture = false }) {
  exactKeys(arguments[0], ['codexVersion', 'model', 'modelCatalog', 'catalogPath', 'catalogValidation', 'accountModelChecked', 'syntheticFixture'],
    'TEXT_ONLY_INVALID_INPUT', ['codexVersion', 'model', 'modelCatalog', 'catalogPath', 'catalogValidation']);
  if (codexVersion !== PINNED_CODEX || typeof model !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(model) ||
      typeof catalogPath !== 'string' || !isAbsolute(catalogPath) || catalogPath.includes('\0') ||
      typeof syntheticFixture !== 'boolean' || typeof accountModelChecked !== 'boolean') fail('TEXT_ONLY_INVALID_INPUT');
  // These are caller attestations, not catalog provenance or entitlement proofs.
  if (syntheticFixture !== (catalogValidation === 'synthetic-fixture')) fail('TEXT_ONLY_CATALOG_UNVALIDATED');
  if (catalogValidation !== 'validated-genuine' && !(catalogValidation === 'synthetic-fixture' && syntheticFixture === true))
    fail('TEXT_ONLY_CATALOG_UNVALIDATED');
  if (!syntheticFixture && accountModelChecked !== true) fail('TEXT_ONLY_ACCOUNT_MODEL_CHECK_REQUIRED');
  exactKeys(modelCatalog, ['models'], 'TEXT_ONLY_CATALOG_MISMATCH');
  if (!Array.isArray(modelCatalog.models) || modelCatalog.models.length !== 1) fail('TEXT_ONLY_CATALOG_MISMATCH');
  const entry = modelCatalog.models[0];
  if (!entry || entry.slug !== model || entry.tool_mode !== 'direct' ||
      !Array.isArray(entry.experimental_supported_tools) || entry.experimental_supported_tools.length) fail('TEXT_ONLY_CATALOG_MISMATCH');

  modelCatalog = deepFreeze(structuredClone(modelCatalog));
  const catalogBytes = Buffer.from(JSON.stringify(modelCatalog));
  const startupConfig = Object.freeze({
    model, model_catalog_json: catalogPath, web_search: 'disabled',
    'agents.enabled': false,
    ...Object.fromEntries(CODEX_TEXT_ONLY_FEATURES.map(key => [`features.${key}`, false])),
    'tools.experimental_request_user_input.enabled': false,
    'tools.update_plan.enabled': false,
    mcp_servers: Object.freeze({}),
  });
  const commandedBytes = Buffer.from(JSON.stringify(startupConfig));
  const binding = Object.freeze({ version: CODEX_TEXT_ONLY_PROFILE_VERSION, codexVersion, model,
    catalogSha256: digest(catalogBytes), commandedConfigSha256: digest(commandedBytes) });
  return Object.freeze({ version: CODEX_TEXT_ONLY_PROFILE_VERSION, model, modelCatalog,
    startupConfig, threadStart: Object.freeze({ model, dynamicTools: Object.freeze([]) }),
    turnStart: Object.freeze({ environments: Object.freeze([]) }), binding,
    evidence: Object.freeze({ catalogValidation, accountModelChecked, syntheticFixture,
      extensionToolSettingsReadback: 'omitted-bind-commanded-settings' }) });
}

/** Checks native readback plus immutable startup content. Native config/read in
 * 0.154.0 omits extension tool settings, so their commanded digest is checked
 * rather than inventing readback fields. */
export function verifyCodexTextOnlyProfile(profile, { codexVersion, model, configReadback,
  catalogContent, commandedConfigContent }) {
  exactKeys(arguments[1], ['codexVersion', 'model', 'configReadback', 'catalogContent', 'commandedConfigContent'], 'TEXT_ONLY_INVALID_VERIFICATION');
  if (profile?.version !== CODEX_TEXT_ONLY_PROFILE_VERSION || codexVersion !== PINNED_CODEX ||
      model !== profile.model || profile.binding?.model !== model) fail('TEXT_ONLY_PROFILE_MISMATCH');
  if (digest(bytes(catalogContent)) !== profile.binding.catalogSha256 ||
      digest(bytes(commandedConfigContent)) !== profile.binding.commandedConfigSha256) fail('TEXT_ONLY_PROFILE_CHANGED');
  const config = configReadback;
  if (!config || config.model !== model || config.model_catalog_json !== profile.startupConfig.model_catalog_json ||
      config.web_search !== 'disabled' || config.agents?.enabled !== false ||
      Object.keys(config.mcp_servers ?? {}).length || config.notify != null) fail('TEXT_ONLY_READBACK_MISMATCH');
  for (const tool of ['experimental_request_user_input', 'update_plan']) {
    if (config.tools?.[tool] !== undefined && config.tools[tool]?.enabled !== false) fail('TEXT_ONLY_READBACK_MISMATCH');
  }
  for (const key of CODEX_TEXT_ONLY_FEATURES) {
    const actual = config.features?.[key];
    if (key === 'sleep_tool' ? actual !== false && actual?.enabled !== false : actual !== false) fail('TEXT_ONLY_READBACK_MISMATCH');
  }
  return Object.freeze({ valid: true, version: profile.version, model,
    catalogSha256: profile.binding.catalogSha256, commandedConfigSha256: profile.binding.commandedConfigSha256,
    completionEligible: false, extensionToolSettingsReadback: 'omitted-bind-commanded-settings' });
}
