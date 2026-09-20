import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runHostedOwnerAlpha } from '../runtime/owner-alpha-entry.mjs';

// Automatic warm entrypoint expiry/grace verification. scripts/test-codex-warm-manager.mjs
// deliberately stops the warm service itself after generation expiry and proves only
// explicit stopped custody. These tests drive the actual runHostedOwnerAlpha control
// flow (every hosted launch funnels through the shared runBoundedOwnerAlpha body) and
// prove the entrypoint stops a warm generation by itself at the frozen policy expiry
// + 30s grace, with no deadline extension and no success/settlement inference.
// Service and native process termination are SIMULATED through the explicit
// createService/launch credential-free test seams: no native Codex process is
// spawned or killed, no transport, account, provider or live work is touched, and
// every stop below only records the call. A stop that was called while an await is
// still pending is never reported as shutdown or settlement.
const layers = ['user', 'system'].map(type => ({ name: { type, file: `/warm-entry/${type}/config.toml` }, config: {} }));
const hash = text => createHash('sha256').update(text).digest('hex');
const floor = { version: 'owner-alpha-launch-floor-v1', requirements_sha256: '3c'.repeat(32), ordinary_config_sha256: '4d'.repeat(32),
  layers: layers.map(layer => ({ path_sha256: hash(layer.name.file), config_sha256: hash('{}') })) };
const requirements = { requirements: { allowRemoteControl: false, featureRequirements: { memories: false } } };
const safeConfig = { features: { memories: false, plugins: false }, model_provider: 'openai', model_providers: {} };
const generation = { epoch: 2, boot_id: 'bbbbbbbb-bbbb-4bbb-8bbb-1bbbbbbbbbbb', transition_id: 'cccccccc-cccc-4ccc-8ccc-1cccccccccc' };
const flush = () => new Promise(resolve => setImmediate(resolve));

async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'hehe-warm-entry-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

/** A staged hosted warm-generation configuration mirroring the warm manager's
 * session template: frozen owner policy, generation identity and warm binding. */
function warmConfig({ at, session, persona, model }) {
  return {
    hostedOwnerBindingSha256: '2a'.repeat(32),
    ownerAlpha: { session_id: session, persona_id: persona, expires_at: new Date(at + 60000).toISOString(),
      max_runs: 2, max_task_seconds: 30, text_only: { profile_version: 'codex-text-only-v1', profile_sha256: '9b'.repeat(32) } },
    ownerAlphaGeneration: { ...generation },
    ownerAlphaWarm: { generation_sha256: '5e'.repeat(32) },
    personas: { [persona]: { model } },
  };
}

/** The entrypoint's wrapped launch seam plus a fake service factory asserting
 * warm custody: the service receives the staged generation identity unchanged. */
function warmServiceFixture({ at, session, persona, model }, service) {
  const launches = [];
  return {
    launches,
    createService: (captured, dependencies) => {
      assert.equal(captured.hostedOwnerBindingSha256, '2a'.repeat(32));
      assert.deepEqual(captured.ownerAlphaGeneration, generation);
      assert.deepEqual(captured.ownerAlphaWarm, { generation_sha256: '5e'.repeat(32) });
      assert.equal(captured.ownerAlpha.expires_at, new Date(at + 60000).toISOString());
      assert.equal(captured.ownerAlpha.session_id, session);
      assert.equal(captured.personas[persona].model, model);
      return service(dependencies);
    },
    launch: options => {
      launches.push(options);
      assert.deepEqual(options.configOverrides, { model_provider: 'openai', 'features.memories': false, 'features.plugins': false });
      return { initialize: async () => ({}), request: async method =>
        method === 'configRequirements/read' ? requirements : method === 'config/read' ? { config: safeConfig, layers }
        : method === 'account/read' ? { account: { type: 'chatgpt' }, requiresOpenaiAuth: true }
        : { data: [{ model, hidden: false }], nextCursor: null } };
    },
    launchFloor: () => floor,
  };
}

test('automatic expiry stops a warm generation exactly at expiry+30s grace with no deadline extension', async t => {
  const at = Date.parse('2026-09-19T01:17:00.000Z');
  const scenario = { at, session: 'dddddddd-dddd-4ddd-8ddd-111111111111', persona: 'eeeeeeee-eeee-4eee-8eee-111111111111', model: 'warm-expiry-model' };
  const stateDirectory = await directory(t), nativeHome = await directory(t);
  let clock = at;
  const events = [], reports = [];
  const fixture = warmServiceFixture(scenario, dependencies => ({
    phase: 'running',
    start: async () => { events.push(['start', clock]); await dependencies.launch({}).initialize(); },
    maintain: async () => { events.push(['maintain', clock]); },
    stop: async () => { events.push(['stop', clock]); },
  }));
  await runHostedOwnerAlpha({ stateDirectory, nativeHome, ...warmConfig(scenario) }, {
    ...fixture, now: () => clock, wait: async ms => { clock += ms; }, report: value => reports.push(value),
  });
  // 60s policy + 30s grace at the fixed 1s cadence: exactly 90 maintenance rounds,
  // the last one beginning strictly before the boundary. Maintenance never extends
  // the frozen expiry+30s deadline.
  const maintains = events.filter(([name]) => name === 'maintain');
  assert.deepEqual(maintains.map(([, atClock]) => atClock),
    Array.from({ length: 90 }, (_, index) => at + index * 1000));
  // The entrypoint stopped the generation itself, once, at the grace boundary.
  assert.deepEqual(events.filter(([name]) => name === 'stop'), [['stop', at + 90000]]);
  assert.equal(fixture.launches.length, 1); // one boot, no replay
  // Only bounded lifecycle observations; expiry is not success or settlement.
  assert.deepEqual(reports.map(value => value.event), ['owner-alpha.ready', 'owner-alpha.stopped']);
  assert.deepEqual(reports[1], { event: 'owner-alpha.stopped', stateRetained: true, settlementProved: false, replayAllowed: false });
  assert.equal(reports[0].hosted, true); assert.equal(reports[0].providerHold, true);
  assert.equal(reports[0].productionEnabled, false); assert.equal(reports[0].outputIsProvisional, true);
  assert.equal(reports[0].session_id, scenario.session);
  assert.equal(reports[0].expires_at, new Date(at + 60000).toISOString());
  // No replay or live work after the automatic stop.
  clock += 300000; await flush();
  assert.equal(events.filter(([name]) => name === 'maintain').length, 90);
  assert.deepEqual(events.filter(([name]) => name === 'stop'), [['stop', at + 90000]]);
  assert.equal(fixture.launches.length, 1);
});

test('grace timer independently stops a hung warm maintenance await without mislabeling it as shutdown', async t => {
  const at = Date.parse('2026-09-19T02:23:00.000Z');
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: at });
  const scenario = { at, session: 'd1d1d1d1-d1d1-4d1d-8d1d-222222222222', persona: 'e2e2e2e2-e2e2-4e2e-8e2e-222222222222', model: 'warm-held-maintenance-model' };
  const stateDirectory = await directory(t), nativeHome = await directory(t);
  const reports = [], stops = [];
  const entered = Promise.withResolvers();
  let release; const hang = new Promise(resolve => { release = resolve; });
  let maintains = 0;
  const fixture = warmServiceFixture(scenario, dependencies => ({
    phase: 'running',
    start: async () => { await dependencies.launch({}).initialize(); },
    maintain: () => { maintains++; entered.resolve(); return hang; },
    stop: async () => { stops.push(Date.now()); },
  }));
  const run = runHostedOwnerAlpha({ stateDirectory, nativeHome, ...warmConfig(scenario) },
    { ...fixture, report: value => reports.push(value) });
  let outcome;
  run.then(() => outcome = 'fulfilled', error => outcome = { rejected: error.code });
  await entered.promise;
  t.mock.timers.tick(89999);
  assert.deepEqual(stops, []); // grace still open while the await hangs
  t.mock.timers.tick(1);
  assert.deepEqual(stops, [at + 90000]); // timer stop exactly at the frozen boundary
  await flush();
  // The stop was called, but the maintenance await is still hung: the entrypoint
  // must not claim shutdown, settlement or any terminal outcome.
  assert.equal(outcome, undefined);
  assert.deepEqual(reports.map(value => value.event), ['owner-alpha.ready']);
  assert.equal(maintains, 1);
  // Only once the pending await actually settles does the entrypoint complete its
  // own automatic stop path.
  release();
  await flush(); // the hung maintenance await resolves and schedules the next wait
  t.mock.timers.tick(1000); // inter-maintenance wait
  await flush();
  assert.equal(outcome, 'fulfilled');
  // Timer stop, then the idempotent final cleanup one wait interval later.
  assert.deepEqual(stops, [at + 90000, at + 91000]);
  assert.deepEqual(reports.map(value => value.event), ['owner-alpha.ready', 'owner-alpha.stopped']);
  assert.deepEqual(reports[1], { event: 'owner-alpha.stopped', stateRetained: true, settlementProved: false, replayAllowed: false });
  assert.equal(fixture.launches.length, 1); // no replay after the boundary
  t.mock.timers.tick(60000); await flush();
  assert.equal(stops.length, 2); assert.equal(reports.length, 2); assert.equal(maintains, 1);
});

test('an early timer callback rechecks the frozen grace deadline before stopping', async t => {
  const at = Date.parse('2026-09-19T02:47:00.000Z');
  t.mock.timers.enable({ apis: ['setTimeout'], now: at });
  const scenario = { at, session: 'd1d1d1d1-d1d1-4d1d-8d1d-222222222222', persona: 'e2e2e2e2-e2e2-4e2e-8e2e-222222222222', model: 'warm-early-timer-model' };
  const stateDirectory = await directory(t), nativeHome = await directory(t);
  let clock = at;
  const entered = Promise.withResolvers(), held = Promise.withResolvers();
  const stops = [], reports = [];
  const fixture = warmServiceFixture(scenario, dependencies => ({
    phase: 'running',
    start: async () => { await dependencies.launch({}).initialize(); },
    maintain: () => { entered.resolve(); return held.promise; },
    stop: async () => { stops.push(clock); },
  }));
  const run = runHostedOwnerAlpha({ stateDirectory, nativeHome, ...warmConfig(scenario) },
    { ...fixture, now: () => clock, report: value => reports.push(value) });
  await entered.promise;
  try {
    // The timer queue reaches its scheduled callback while the policy clock is
    // still one millisecond short, reproducing the real-native failure exactly.
    clock = at + 89999;
    t.mock.timers.tick(90000);
    assert.deepEqual(stops, []);
    assert.deepEqual(reports.map(value => value.event), ['owner-alpha.ready']);
    clock++;
    t.mock.timers.tick(1);
    assert.deepEqual(stops, [at + 90000]);
  } finally {
    clock = at + 90000;
    held.resolve(); await flush();
    t.mock.timers.tick(1000); await run;
  }
  assert.deepEqual(stops, [at + 90000, at + 90000]);
  t.mock.timers.tick(60000);
  assert.equal(stops.length, 2);
  assert.equal(fixture.launches.length, 1);
});

test('grace timer stops a warm service whose start await is pending; a late start is refused, not settled', async t => {
  const at = Date.parse('2026-09-19T03:31:00.000Z');
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: at });
  const scenario = { at, session: 'd3d3d3d3-d3d3-4d3d-8d3d-333333333333', persona: 'e4e4e4e4-e4e4-4e4e-8e4e-333333333333', model: 'warm-held-start-model' };
  const stateDirectory = await directory(t), nativeHome = await directory(t);
  const reports = [], stops = [];
  const entered = Promise.withResolvers();
  let release; const hang = new Promise(resolve => { release = resolve; });
  let maintains = 0;
  const fixture = warmServiceFixture(scenario, dependencies => ({
    phase: 'running',
    // Native boot is simulated through the launch seam; the initialization await
    // never returns, so service.start() stays pending.
    start: () => { dependencies.launch({}); entered.resolve(); return hang; },
    maintain: () => { maintains++; return hang; },
    stop: async () => { stops.push(Date.now()); },
  }));
  const run = runHostedOwnerAlpha({ stateDirectory, nativeHome, ...warmConfig(scenario) },
    { ...fixture, report: value => reports.push(value) });
  let outcome;
  run.then(() => outcome = 'fulfilled', error => outcome = { rejected: error.code });
  await entered.promise;
  t.mock.timers.tick(89999);
  assert.deepEqual(stops, []);
  t.mock.timers.tick(1);
  assert.deepEqual(stops, [at + 90000]); // timer stop exactly at the frozen boundary
  await flush();
  // A start that has not returned is not readiness, shutdown or failure: zero
  // lifecycle claims while the await hangs.
  assert.equal(outcome, undefined);
  assert.deepEqual(reports, []);
  // A start that completes only after the boundary is stopped, never settled.
  release(); await flush();
  assert.deepEqual(outcome, { rejected: 'OWNER_ALPHA_STOPPED' });
  assert.deepEqual(stops, [at + 90000, at + 90000]);
  assert.deepEqual(reports, [
    { event: 'owner-alpha.failed', stage: 'run', code: 'OWNER_ALPHA_STOPPED', policyExpired: true, operatorStopped: false, replayAllowed: false },
    { event: 'owner-alpha.stopped', stateRetained: true, settlementProved: false, replayAllowed: false },
  ]);
  assert.equal(maintains, 0); // no live work after the boundary stop
  assert.equal(fixture.launches.length, 1); // one boot, no replay
  t.mock.timers.tick(60000); await flush();
  assert.equal(stops.length, 2); assert.equal(reports.length, 2); assert.equal(maintains, 0);
});

test('operator abort stops a warm generation immediately through the abort listener before grace expiry', async t => {
  const at = Date.parse('2026-09-19T04:41:00.000Z');
  const scenario = { at, session: 'd5d5d5d5-d5d5-4d5d-8d5d-555555555555', persona: 'e6e6e6e6-e6e6-4e6e-8e6e-555555555555', model: 'warm-abort-model' };
  const stateDirectory = await directory(t), nativeHome = await directory(t);
  let clock = at;
  const events = [], reports = [];
  const controller = new AbortController();
  const fixture = warmServiceFixture(scenario, dependencies => ({
    phase: 'running',
    start: async () => { events.push(['start', clock]); await dependencies.launch({}).initialize(); },
    maintain: async () => {
      events.push(['maintain', clock]);
      if (events.filter(([name]) => name === 'maintain').length === 3) controller.abort();
    },
    stop: async () => { events.push(['stop', clock]); },
  }));
  await runHostedOwnerAlpha({ stateDirectory, nativeHome, ...warmConfig(scenario) }, {
    ...fixture, signal: controller.signal, now: () => clock, wait: async ms => { clock += ms; }, report: value => reports.push(value),
  });
  // The abort listener delivers the stop signal at once, long before expiry; the
  // final cleanup stop is idempotent. The stop is not a settlement claim.
  assert.deepEqual(events.filter(([name]) => name === 'stop'), [['stop', at + 2000], ['stop', at + 3000]]);
  assert.deepEqual(events.filter(([name]) => name === 'maintain').map(([, atClock]) => atClock), [at, at + 1000, at + 2000]);
  assert.deepEqual(reports.map(value => value.event), ['owner-alpha.ready', 'owner-alpha.stopped']);
  assert.deepEqual(reports[1], { event: 'owner-alpha.stopped', stateRetained: true, settlementProved: false, replayAllowed: false });
  assert.equal(fixture.launches.length, 1);
});
