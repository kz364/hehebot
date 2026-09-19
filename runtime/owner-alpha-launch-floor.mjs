import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';

const fail = () => { throw Object.assign(new Error('OWNER_ALPHA_LAUNCH_FLOOR_DENIED'), { code: 'OWNER_ALPHA_LAUNCH_FLOOR_DENIED' }); };
const canonical = value => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(canonical(value))).digest('hex');
// Isolated stdlib parser: no shell, imports from the home, config execution or logs.
// Python >=3.11 is a launch prerequisite; missing/invalid TOML fails before Codex.
function parse(bytes) {
  try { return JSON.parse(execFileSync('/usr/bin/python3', ['-I', '-c', 'import sys,tomllib,json; print(json.dumps(tomllib.loads(sys.stdin.read())))'],
    { input: bytes, encoding: 'utf8', timeout: 5000, maxBuffer: 256 * 1024, stdio: ['pipe', 'pipe', 'pipe'] })); } catch { fail(); }
}
function ancestors(path) { const result = []; for (;;) { result.push(path); const parent = dirname(path); if (parent === path) return result; path = parent; } }
const scalarKeys = new Set(['model', 'model_reasoning_effort', 'model_reasoning_summary', 'model_verbosity',
  'model_context_window', 'model_auto_compact_token_limit', 'cli_auth_credentials_store', 'default_permissions', 'approval_policy', 'sandbox_mode']);
function ordinary(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) fail();
  for (const [key, value] of Object.entries(config)) {
    if (scalarKeys.has(key) && ['string', 'number'].includes(typeof value)) continue;
    if (key === 'model_provider' && value === 'openai' || key === 'web_search' && value === 'disabled' || key === 'project_doc_max_bytes' && value === 0) continue;
    if (['features', 'agents', 'tools', 'skills', 'permissions', 'sandbox_workspace_write'].includes(key)) {
      // Permissions remain checked against the exact selected no-network profile
      // by the service before thread/start; they cannot contain startup commands.
      if (key === 'permissions' || key === 'sandbox_workspace_write') {
        const text = JSON.stringify(value);
        if (/"(?:command|args|env|url|base_url|instructions|setup_script|provider)"/.test(text)) fail();
        continue;
      }
      const disabled = node => node === false || node && typeof node === 'object' && !Array.isArray(node) && Object.values(node).every(disabled);
      if (disabled(value)) continue;
    }
    if (key === 'mcp_servers' && value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) continue;
    // Includes notify, hooks, providers, profiles, instruction files, plugins,
    // environment/setup commands and unknown future host-read surfaces.
    fail();
  }
}

/** Production paths are fixed. The second argument is trusted test I/O only,
 * never sourced from a runtime config, environment variable or manager request. */
export function inspectOwnerAlphaLaunchFloor({ home, cwd }, { fs = { lstatSync, readFileSync, realpathSync }, requirementsPath = '/etc/codex/requirements.toml', systemConfigPath = '/etc/codex/config.toml' } = {}) {
  const stat = path => { try { return fs.lstatSync(path); } catch (error) { if (error.code === 'ENOENT') return null; fail(); } };
  const safe = (path, root = false) => {
    if (!isAbsolute(path) || resolve(path) !== path) fail();
    for (const part of ancestors(path)) {
      const s = stat(part); if (!s || s.isSymbolicLink() || s.mode & 0o022 || root && s.uid !== 0 || !root && ![0, process.getuid()].includes(s.uid)) fail();
      if (part !== path && !s.isDirectory()) fail();
    }
    const s = stat(path); if (!s.isFile() || s.size > 128 * 1024) fail();
    return fs.readFileSync(path);
  };
  if (![home, cwd].every(path => typeof path === 'string' && isAbsolute(path) && resolve(path) === path && fs.realpathSync(path) === path)) fail();
  for (const name of ['AGENTS.md', 'AGENTS.override.md', 'environments.toml']) if (stat(join(home, name))) fail();
  const requirements = safe(requirementsPath, true), required = parse(requirements);
  if (required.allow_remote_control !== false || required.features?.memories !== false) fail();
  const paths = [...new Set([systemConfigPath, join(home, 'config.toml'), ...ancestors(cwd).map(path => join(path, '.codex', 'config.toml'))])];
  const layers = paths.map(path => {
    const present = stat(path), bytes = present ? safe(path, path === systemConfigPath) : Buffer.from(''), config = present ? parse(bytes) : {};
    ordinary(config); return { path_sha256: digest(path), content_sha256: digest(bytes), config_sha256: digest(config) };
  });
  return Object.freeze({ version: 'owner-alpha-launch-floor-v1', requirements_sha256: digest(requirements), ordinary_config_sha256: digest(layers),
    layers: Object.freeze(layers.map(Object.freeze)) });
}

/** Same-process readback precedes account/model discovery. No absence inference. */
export function verifyOwnerAlphaLaunchFloor(snapshot, requirementsReadback, readback) {
  const r = requirementsReadback?.requirements;
  if (r?.allowRemoteControl !== false || r.featureRequirements?.memories !== false || readback?.config?.features?.memories !== false ||
      readback.config.features.plugins !== false || !Array.isArray(readback.layers)) fail();
  if (!['system', 'user'].every(type => readback.layers.filter(layer => layer?.name?.type === type).length === 1)) fail();
  for (const layer of readback.layers) {
    if (layer?.name?.type === 'sessionFlags') continue;
    if (!['system', 'user', 'project'].includes(layer?.name?.type)) fail();
    const file = layer.name.type === 'project' && typeof layer.name.dotCodexFolder === 'string' ? join(layer.name.dotCodexFolder, 'config.toml') : layer.name.file;
    if (typeof file !== 'string' || layer.name.profile != null) fail();
    ordinary(layer.config);
    if (!snapshot.layers.some(saved => saved.path_sha256 === digest(file) && saved.config_sha256 === digest(layer.config))) fail();
  }
  return Object.freeze({ version: snapshot.version, requirements_sha256: snapshot.requirements_sha256,
    ordinary_config_sha256: snapshot.ordinary_config_sha256, allowRemoteControl: false, requiredMemories: false, effectiveMemories: false });
}
