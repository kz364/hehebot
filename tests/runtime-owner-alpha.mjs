import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ownerAlphaPolicy } from '../runtime/owner-alpha-policy.mjs';
import { runHostedOwnerAlpha, runOwnerAlpha, checkAlphaAccount } from '../runtime/owner-alpha-entry.mjs';
import { CodexAdapter } from '../runtime/codex-adapter.mjs';
import { FileJournal } from '../runtime/file-journal.mjs';

const at = Date.parse('2026-09-16T10:00:00.000Z');
const policy = { session_id: 'aaaaaaaa-1111-4111-8111-111111111111',
  persona_id: '11111111-1111-4111-8111-111111111111', expires_at: new Date(at + 60000).toISOString(),
  max_runs: 2, max_task_seconds: 43 };
async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'hehe-alpha-unit-'));
  t.after(() => rm(path, { recursive: true, force: true })); return path;
}

test('alpha policy is exact, bounded and independently captured', () => {
  const source = structuredClone(policy), captured = ownerAlphaPolicy(source);
  source.max_runs = 99; assert.equal(captured.max_runs, 2);
  for (const bad of [null, { ...policy, extra: true }, { ...policy, max_runs: 0 },
    { ...policy, max_runs: 4 }, { ...policy, max_task_seconds: 301 },
    { ...policy, expires_at: '2026-09-16T10:01:00Z' }, { ...policy, persona_id: 'bot' },
    { ...policy, session_id: [policy.session_id] }]) {
    assert.throws(() => ownerAlphaPolicy(bad), { code: 'INVALID_OWNER_ALPHA_POLICY' });
  }
});

test('live entry refuses malformed background opt-in before filesystem, service or account work', async () => {
  await assert.rejects(runOwnerAlpha({ ownerAlpha: { ...policy, background_first_root: false } }, {
    createService: () => assert.fail('must not create service'),
    launch: () => assert.fail('must not launch native/account work'),
  }), { code: 'INVALID_OWNER_ALPHA_POLICY' });
});

test('account check requires ChatGPT, exact visible model and bounded supported discovery', async () => {
  const calls = [];
  await checkAlphaAccount({ request: async (method, params) => {
    calls.push([method, params]);
    if (method === 'account/read') return { account: { type: 'chatgpt' }, requiresOpenaiAuth: true };
    return params.cursor === null ? { data: [{ model: 'wrong', hidden: false }], nextCursor: 'page2' }
      : { data: [{ model: 'chosen', hidden: false }], nextCursor: null };
  } }, 'chosen');
  assert.deepEqual(calls.map(call => call[0]), ['account/read', 'model/list', 'model/list']);
  assert.deepEqual(calls[0][1], { refreshToken: false });
  for (const account of [null, { type: 'apiKey' }]) {
    await assert.rejects(checkAlphaAccount({ request: async method => {
      assert.equal(method, 'account/read'); return { account, requiresOpenaiAuth: true };
    } }, 'chosen'), { code: 'OWNER_ALPHA_LOGIN_REQUIRED' });
  }
  await assert.rejects(checkAlphaAccount({ request: async method => method === 'account/read'
    ? { account: { type: 'chatgpt' }, requiresOpenaiAuth: true }
    : { data: [{ model: 'chosen', hidden: true }], nextCursor: null } }, 'chosen'), { code: 'OWNER_ALPHA_MODEL_UNAVAILABLE' });
});

test('alpha adapter is separate from test mode and rejects expiry across journal and thread awaits', async t => {
  for (const boundary of ['entry', 'journal', 'thread', 'positive']) {
    const cwd = await directory(t), journal = new FileJournal(cwd), calls = [];
    let now = boundary === 'entry' ? at + 60000 : at;
    const put = journal.putIfAbsent.bind(journal);
    journal.putIfAbsent = async (...args) => { const result = await put(...args); if (boundary === 'journal') now = at + 60000; return result; };
    const adapter = new CodexAdapter({ cwd, journal, ownerAlpha: policy, now: () => now, permissionsProfile: 'alpha-profile',
      rpc: async method => { calls.push(method); if (boundary === 'thread') now = at + 60000;
        return method === 'thread/start' ? { thread: { id: 'native-root' } } : { turn: { id: 'native-turn' } }; } });
    const input = { attemptId: 'attempt1', installationId: 'alpha', personaId: 'assistant',
      scope: 'conversation', scopeId: policy.persona_id, message: 'read', model: 'chosen' };
    assert.equal(adapter.testMode, false); assert.equal(adapter.admissionReadiness().productionVerified, false);
    if (boundary === 'entry') await assert.rejects(adapter.submit(input), { code: 'OWNER_ALPHA_ADMISSION_DENIED' });
    else {
      const result = await adapter.submit(input);
      assert.equal(result.status, boundary === 'positive' ? 'running' : 'recovery_required');
    }
    assert.deepEqual(calls, boundary === 'positive' ? ['thread/start', 'turn/start'] : boundary === 'thread' ? ['thread/start'] : []);
    assert.equal(adapter.sleepReadiness().allowed, false);
    await assert.rejects(adapter.submit({ ...input, scopeId: 'other' }), { code: 'OWNER_ALPHA_ADMISSION_DENIED' });
    assert.throws(() => new CodexAdapter({ cwd, journal, rpc: async () => {}, ownerAlpha: policy, testMode: true,
      permissionsProfile: 'alpha-profile' }), { code: 'INVALID_CONFIGURATION' });
  }
});

for (const hosted of [false, true]) for (const background of [false, true]) test(`entrypoint preserves hosted=${hosted} background=${background}, account selection and bounded grace`, async t => {
  const stateDirectory = await directory(t), reports = [], calls = [];
  let now = at, stopped = 0;
  const config = { stateDirectory, ownerAlpha: { ...policy, ...(background ? { background_first_root: true } : {}) }, personas: { [policy.persona_id]: { model: 'chosen' } },
    ...(hosted ? { hostedOwnerBindingSha256: '19'.repeat(32) } : {}) };
  await (hosted ? runHostedOwnerAlpha : runOwnerAlpha)(config, { now: () => now, report: value => reports.push(value), wait: async () => { now += 45000; },
    launch: options => {
      assert.deepEqual(options.configOverrides, { 'features.apps': false, model_provider: 'openai' });
      return { initialize: async () => ({}), request: async method => {
        calls.push(method); return method === 'config/read' ? { config: { model_provider: 'openai', model_providers: {} } }
          : method === 'account/read' ? { account: { type: 'chatgpt' }, requiresOpenaiAuth: true }
          : { data: [{ model: 'chosen', hidden: false }], nextCursor: null };
      } };
    },
    createService: (captured, dependencies) => {
      config.personas[policy.persona_id].model = 'changed-after-capture';
      assert.equal(captured.personas[policy.persona_id].model, 'chosen');
      assert.deepEqual(captured.ownerAlpha, { ...policy, ...(background ? { background_first_root: true } : {}) });
      return { phase: 'running', start: async () => dependencies.launch({ configOverrides: { 'features.apps': false } }).initialize(),
        maintain: async () => calls.push('maintain'), stop: async () => { stopped++; } };
    },
  });
  assert.equal(stopped, 1); assert.deepEqual(calls, ['config/read', 'account/read', 'model/list', 'maintain', 'maintain']);
  assert.equal(reports[0].productionEnabled, false); assert.equal(reports[1].settlementProved, false);
  assert.equal(reports[0].providerHold, hosted);
  assert.equal(reports[0].hosted, hosted ? true : undefined);
  assert.equal(reports[1].replayAllowed, false);
});

test('local and hosted entrypoints reject absent, malformed or crossed mode before service/filesystem work', async () => {
  const options = { createService: () => assert.fail('must not create service') };
  for (const value of [undefined, false, 'AA'.repeat(32), '19'.repeat(31)])
    await assert.rejects(runHostedOwnerAlpha({ hostedOwnerBindingSha256: value }, options), { code: 'INVALID_OWNER_ALPHA_CONFIGURATION' });
  await assert.rejects(runOwnerAlpha({ hostedOwnerBindingSha256: '19'.repeat(32) }, options), { code: 'INVALID_OWNER_ALPHA_CONFIGURATION' });
});

test('entrypoint refuses test flags and preexisting custody before launch', async t => {
  const stateDirectory = await directory(t);
  const config = { stateDirectory, ownerAlpha: policy, personas: { [policy.persona_id]: { model: 'chosen' } } };
  const options = { now: () => at, createService: () => assert.fail('must not create service') };
  await assert.rejects(runOwnerAlpha({ ...config, disposableTest: false }, options), { code: 'INVALID_OWNER_ALPHA_CONFIGURATION' });
  await mkdir(join(stateDirectory, 'journal'));
  await writeFile(join(stateDirectory, 'journal', 'unknown.json'), 'retained');
  await assert.rejects(runOwnerAlpha(config, options), { code: 'OWNER_ALPHA_FRESH_STATE_REQUIRED' });
});

test('existing home keeps its store selection and rejects custom provider before account discovery', async t => {
  const stateDirectory = await directory(t), nativeHome = await directory(t), calls = [];
  await writeFile(join(nativeHome, 'config.toml'), 'cli_auth_credentials_store = "keyring"\n', { mode: 0o600 });
  const config = { stateDirectory, nativeHome, ownerAlpha: policy, personas: { [policy.persona_id]: { model: 'chosen' } } };
  await assert.rejects(runOwnerAlpha(config, { now: () => at, report: () => {},
    launch: options => {
      assert.deepEqual(options.configOverrides, { model_provider: 'openai' });
      return { initialize: async () => ({}), request: async method => {
        calls.push(method);
        return { config: { model_provider: 'openai', model_providers: { openai: { base_url: 'https://unapproved.invalid' } } } };
      } };
    },
    createService: (captured, dependencies) => {
      assert.equal(captured.nativeHome, nativeHome);
      return { start: () => dependencies.launch({}).initialize(), stop: async () => calls.push('stop') };
    },
  }), { code: 'OWNER_ALPHA_PROVIDER_DENIED' });
  assert.deepEqual(calls, ['config/read', 'stop']);
});

for (const hosted of [false, true]) test(`session watchdog hosted=${hosted} stops native work at grace boundary during held maintenance`, async t => {
  const stateDirectory = await directory(t);
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: at });
  const entered = Promise.withResolvers(), held = Promise.withResolvers();
  let stops = 0;
  const result = (hosted ? runHostedOwnerAlpha : runOwnerAlpha)({ stateDirectory, ownerAlpha: policy,
    ...(hosted ? { hostedOwnerBindingSha256: '19'.repeat(32) } : {}),
    personas: { [policy.persona_id]: { model: 'chosen' } } }, {
    report: () => {}, createService: () => ({ phase: 'running', start: async () => {},
      maintain: () => { entered.resolve(); return held.promise; },
      stop: async () => { stops++; held.reject(Object.assign(new Error('stopped'), { code: 'NATIVE_STOPPED' })); },
    }),
  });
  const rejected = assert.rejects(result, { code: 'NATIVE_STOPPED' });
  await entered.promise;
  t.mock.timers.tick(89999); assert.equal(stops, 0);
  t.mock.timers.tick(1); await rejected;
  assert.equal(stops, 2); // Timed stop plus idempotent final cleanup.
});

test('hosted failures report only bounded codes and expiry observations without masking rejection', async t => {
  for (const [stage, code, clock, expected] of [
    ['run', 'EXECUTOR_FENCED', at + 59999, 'EXECUTOR_FENCED'],
    ['run', 'OWNER_ALPHA_ADMISSION_DENIED', at + 60000, 'OWNER_ALPHA_ADMISSION_DENIED'],
    ['run', 'private-token-in-code', at + 60000, 'OWNER_ALPHA_FAILURE'],
    ['stop', 'NATIVE_STOP_UNCONFIRMED', at, 'NATIVE_STOP_UNCONFIRMED'],
  ]) {
    const stateDirectory = await directory(t), reports = [];
    let now = at;
    const error = Object.assign(new Error('private-token-in-message'), { code });
    await assert.rejects(runHostedOwnerAlpha({ stateDirectory, ownerAlpha: policy,
      hostedOwnerBindingSha256: '19'.repeat(32), personas: { [policy.persona_id]: { model: 'chosen' } } }, {
      now: () => now, report: value => reports.push(value),
      createService: () => ({ phase: stage === 'run' ? 'running' : 'recovery', start: async () => {},
        maintain: async () => { now = clock; throw error; },
        stop: async () => { if (stage === 'stop') throw error; },
      }),
    }), thrown => thrown === error);
    assert.deepEqual(reports.find(value => value.event === 'owner-alpha.failed'), {
      event: 'owner-alpha.failed', stage, code: expected, policyExpired: clock >= at + 60000,
      operatorStopped: false, replayAllowed: false,
    });
    assert.equal(reports.some(value => value.event === 'owner-alpha.stopped'), stage !== 'stop');
    assert.equal(JSON.stringify(reports).includes('private-token'), false);
  }
});
