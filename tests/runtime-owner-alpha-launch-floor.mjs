import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectOwnerAlphaLaunchFloor, verifyOwnerAlphaLaunchFloor } from '../runtime/owner-alpha-launch-floor.mjs';
import { runHostedOwnerAlpha } from '../runtime/owner-alpha-entry.mjs';

const paths = { home: '/managed/home', cwd: '/managed/session/workspace' };
const managed = '/etc/codex/requirements.toml';
const content = 'allow_remote_control = false\nallowed_approval_policies = ["untrusted"]\n[features]\nmemories = false\n';
const required = { requirements: { allowRemoteControl: false, featureRequirements: { memories: false } } };
const readback = () => ({ config: { model_provider: 'openai', features: { memories: false, plugins: false } },
  layers: [{ name: { type: 'user', file: '/managed/home/config.toml' }, config: {} }, { name: { type: 'system', file: '/etc/codex/config.toml' }, config: {} }] });
function fixture() {
  const files = new Map([[managed, content]]), metadata = new Map();
  const directories = new Set(['/', '/etc', '/etc/codex', '/managed', '/managed/home', '/managed/session', paths.cwd]);
  const fs = {
    lstatSync(path) {
      if (!files.has(path) && !directories.has(path)) throw Object.assign(new Error('absent'), { code: 'ENOENT' });
      return { uid: 0, mode: directories.has(path) ? 0o755 : 0o644, size: Buffer.byteLength(files.get(path) ?? ''),
        isSymbolicLink: () => false, isDirectory: () => directories.has(path), isFile: () => files.has(path), ...metadata.get(path) };
    }, readFileSync: path => Buffer.from(files.get(path)), realpathSync: path => path,
  };
  return { files, metadata, inspect: () => inspectOwnerAlphaLaunchFloor(paths, { fs }) };
}
test('binds requirements and ordinary config without exposing contents or changing unrelated restrictions', () => {
  const f = fixture(), before = f.files.get(managed), snapshot = f.inspect();
  assert.equal(snapshot.version, 'owner-alpha-launch-floor-v1');
  assert.equal(f.files.get(managed), before); assert.equal(JSON.stringify(snapshot).includes('allowed_approval'), false);
  assert.equal(verifyOwnerAlphaLaunchFloor(snapshot, required, readback()).effectiveMemories, false);
  f.files.set(managed, `${content}\n# changed bytes\n`); assert.notEqual(f.inspect().requirements_sha256, snapshot.requirements_sha256);
});
for (const mode of ['missing', 'true', 'omitted', 'duplicate', 'owner', 'writable', 'symlink', 'ancestor-symlink', 'ancestor-writable', 'AGENTS.md', 'AGENTS.override.md', 'environments.toml', 'provider', 'instructions', 'notify', 'hooks']) test(`pre-spawn floor refuses ${mode}`, () => {
  const f = fixture();
  if (mode === 'missing') f.files.delete(managed);
  if (mode === 'true') f.files.set(managed, content.replace('allow_remote_control = false', 'allow_remote_control = true'));
  if (mode === 'omitted') f.files.set(managed, 'allow_remote_control=false');
  if (mode === 'duplicate') f.files.set(managed, `allow_remote_control=true\n${content}`);
  if (mode === 'owner') f.metadata.set(managed, { uid: 1000 });
  if (mode === 'writable') f.metadata.set(managed, { mode: 0o666 });
  if (mode === 'symlink') f.metadata.set(managed, { isSymbolicLink: () => true });
  if (mode === 'ancestor-symlink') f.metadata.set('/etc/codex', { isSymbolicLink: () => true });
  if (mode === 'ancestor-writable') f.metadata.set('/etc/codex', { mode: 0o777 });
  if (['AGENTS.md', 'AGENTS.override.md', 'environments.toml'].includes(mode)) f.files.set(join(paths.home, mode), 'ambient-canary');
  if (mode === 'provider') f.files.set(join(paths.home, 'config.toml'), '[model_providers.openai]\nbase_url="https://unapproved.invalid"');
  if (mode === 'instructions') f.files.set(join(paths.home, 'config.toml'), 'model_instructions_file="/ambient.md"');
  if (mode === 'notify') f.files.set(join(paths.home, 'config.toml'), 'notify=["command"]');
  if (mode === 'hooks') f.files.set(join(paths.home, 'config.toml'), '[hooks]\ncommand="command"');
  assert.throws(f.inspect, { code: 'OWNER_ALPHA_LAUNCH_FLOOR_DENIED' });
});
for (const mode of ['remote', 'required-memory', 'effective-memory', 'plugin', 'layer', 'omitted', 'omitted-layers', 'profile']) test(`same-process readback refuses ${mode}`, () => {
  const f = fixture(), r = structuredClone(required), c = readback();
  if (mode === 'remote') r.requirements.allowRemoteControl = true;
  if (mode === 'required-memory') r.requirements.featureRequirements.memories = true;
  if (mode === 'effective-memory') c.config.features.memories = true;
  if (mode === 'plugin') c.config.features.plugins = true;
  if (mode === 'layer') c.layers[0].config = { notify: ['ambient'] };
  if (mode === 'omitted') delete r.requirements.featureRequirements;
  if (mode === 'omitted-layers') c.layers = [];
  if (mode === 'profile') c.layers[0].name.profile = 'unreviewed';
  assert.throws(() => verifyOwnerAlphaLaunchFloor(f.inspect(), r, c), { code: 'OWNER_ALPHA_LAUNCH_FLOOR_DENIED' });
});
test('every hosted entry rechecks before spawn and before account; no historical floor cache', async t => {
  const stateDirectory = await mkdtemp(join(tmpdir(), 'floor-entry-')); t.after(() => rm(stateDirectory, { recursive: true, force: true }));
  const f = fixture(), calls = []; let mutate = false, badReadback = false;
  const at = Date.now(), persona = '11111111-1111-4111-8111-111111111111';
  const config = { stateDirectory, hostedOwnerBindingSha256: 'a'.repeat(64), ownerAlpha: { session_id: 'aaaaaaaa-1111-4111-8111-111111111111', persona_id: persona,
    expires_at: new Date(at + 60000).toISOString(), max_runs: 1, max_task_seconds: 40 }, personas: { [persona]: { model: 'chosen' } } };
  const run = () => runHostedOwnerAlpha(config, { now: () => at, report: () => {}, launchFloor: f.inspect,
    launch: () => { calls.push('spawn'); return { initialize: async () => { if (mutate) f.files.set(managed, `${content}\n# drift`); }, request: async method => {
      calls.push(method); if (method === 'configRequirements/read') return badReadback ? { requirements: null } : required;
      if (method === 'config/read') return readback();
      if (method === 'account/read') return { account: { type: 'chatgpt' }, requiresOpenaiAuth: true };
      if (method === 'model/list') return { data: [{ model: 'chosen', hidden: false }] }; assert.fail('unexpected RPC');
    } }; }, createService: (_config, deps) => ({ phase: 'stopped', start: () => deps.launch(paths).initialize(), stop: async () => {} }),
  });
  await run(); assert.deepEqual(calls, ['spawn', 'configRequirements/read', 'config/read', 'account/read', 'model/list']);
  calls.length = 0; f.files.delete(managed); await assert.rejects(run()); assert.deepEqual(calls, []);
  f.files.set(managed, content); mutate = true; await assert.rejects(run(), { code: 'OWNER_ALPHA_LAUNCH_FLOOR_CHANGED' }); assert.equal(calls.includes('account/read'), false);
  calls.length = 0; mutate = false; badReadback = true; await assert.rejects(run()); assert.equal(calls.includes('account/read'), false);
  calls.length = 0; f.files.set(join(paths.home, 'environments.toml'), 'ambient'); await assert.rejects(run()); assert.deepEqual(calls, []);
});
