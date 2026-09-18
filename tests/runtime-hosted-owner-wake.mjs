import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHostedOwnerWakeService } from '../runtime/hosted-owner-wake.mjs';

const token = 'w'.repeat(40);
const persona = '11111111-1111-4111-8111-111111111111';
const boot = '22222222-2222-4222-8222-222222222222';
const transition = '33333333-3333-4333-8333-333333333333';
const binding = 'ab'.repeat(32);
const profile = 'cd'.repeat(32);

async function fixture(t, expires = Date.now() + 60000) {
  const root = await mkdtemp(join(tmpdir(), 'hehe-hosted-wake-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const stateDirectory = join(root, 'state'); await mkdir(stateDirectory, { mode: 0o700 });
  const wakeTokenFile = join(root, 'wake-token'); await writeFile(wakeTokenFile, token, { mode: 0o600 });
  const policy = { session_id: 'aaaaaaaa-1111-4111-8111-111111111111', persona_id: persona,
    expires_at: new Date(expires).toISOString(), max_runs: 1, max_task_seconds: 30,
    text_only: { profile_version: 'codex-text-only-v1', profile_sha256: profile } };
  const generation = { epoch: 4, boot_id: boot, transition_id: transition };
  const config = { stateDirectory, portalOrigin: 'https://control.example', hostedOwnerBindingSha256: binding,
    ownerAlpha: policy, ownerAlphaGeneration: generation, personas: { [persona]: { model: 'synthetic', allowedTools: [] } } };
  const configPath = join(root, 'config.json'); await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  return { root, stateDirectory, wakeTokenFile, configPath, config, policy, generation };
}

const statusFor = f => ({ phase: 'BOOTING', epoch: f.generation.epoch, execution_enabled: false,
  owner_alpha_hosted: true, owner_binding_sha256: binding, owner_alpha: structuredClone(f.policy),
  owner_alpha_generation: structuredClone(f.generation) });

async function start(service) {
  service.listen(0, '127.0.0.1'); await once(service, 'listening');
  return service.address().port;
}

async function wake(port, body = { epoch: 4, operationId: transition }) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: '127.0.0.1', port, path: '/wake', method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hehe-wake-token': token } }, response => {
      let text = ''; response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(text) }));
    });
    request.on('error', reject); request.end(JSON.stringify(body));
  });
}

function serviceFor(f, { status = statusFor(f), launch, now = Date.now, report, control } = {}) {
  return createHostedOwnerWakeService({ configPath: f.configPath, wakeTokenFile: f.wakeTokenFile, port: 8080 }, {
    control: control ?? { request: async type => { assert.equal(type, 'status'); return status; } },
    launch, now, report,
  });
}

async function waitFor(predicate) {
  for (let index = 0; index < 100; index++) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('callback did not finish');
}

test('valid staged text-only wake queues then invokes exactly one digest-bound launch', async t => {
  const f = await fixture(t); let calls = 0; const reports = [];
  const service = serviceFor(f, { launch: async (path, options) => {
    calls++; assert.equal(path, f.configPath); assert.match(options.expectedSha256, /^[a-f0-9]{64}$/);
    return { code: 0, signal: null };
  }, report: value => reports.push(value) });
  t.after(() => service.close()); const port = await start(service);
  const response = await wake(port);
  assert.deepEqual(response, { status: 202, body: { accepted: true, epoch: 4, duplicate: false } });
  await waitFor(() => reports.length === 1);
  assert.equal(calls, 1); assert.deepEqual(reports[0], { event: 'hosted-owner-wake', code: 'LAUNCH_EXITED', ready: false });
  const intent = JSON.parse(await readFile(join(f.stateDirectory, 'hosted-owner-launch-intent.json')));
  assert.deepEqual(intent.owner_alpha_generation, f.generation); assert.equal(intent.phase, 'unknown');
  assert.equal((await stat(join(f.stateDirectory, 'hosted-owner-launch-intent.json'))).mode & 0o777, 0o600);
});

test('changed policy, generation, binding, expired policy, and existing runtime state refuse launch', async t => {
  for (const variant of ['policy', 'generation', 'binding', 'expired', 'journal']) await t.test(variant, async t => {
    const now = Date.now(), f = await fixture(t, now + 60000), status = statusFor(f);
    if (variant === 'policy') status.owner_alpha.max_runs = 2;
    if (variant === 'generation') status.owner_alpha_generation.transition_id = '44444444-4444-4444-8444-444444444444';
    if (variant === 'binding') status.owner_binding_sha256 = 'ef'.repeat(32);
    if (variant === 'expired') { f.config.ownerAlpha.expires_at = new Date(now - 1).toISOString(); await writeFile(f.configPath, JSON.stringify(f.config), { mode: 0o600 }); }
    if (variant === 'journal') await mkdir(join(f.stateDirectory, 'journal'));
    let calls = 0, reports = 0;
    const service = serviceFor(f, { status, now: () => now, launch: async () => { calls++; }, report: () => { reports++; } });
    t.after(() => service.close()); const port = await start(service); assert.equal((await wake(port)).status, 202);
    await waitFor(() => reports === 1); assert.equal(calls, 0);
  });
});

test('config mutation while status is awaited refuses before intent or launch', async t => {
  const f = await fixture(t); let release, calls = 0, reports = 0;
  const control = { request: () => new Promise(resolve => { release = resolve; }) };
  const service = serviceFor(f, { control, launch: async () => { calls++; }, report: () => { reports++; } });
  t.after(() => service.close()); const port = await start(service); assert.equal((await wake(port)).status, 202);
  await waitFor(() => release !== undefined);
  f.config.personas[persona].model = 'changed'; await writeFile(f.configPath, JSON.stringify(f.config), { mode: 0o600 });
  release(statusFor(f)); await waitFor(() => reports === 1); assert.equal(calls, 0);
  await assert.rejects(stat(join(f.stateDirectory, 'hosted-owner-launch-intent.json')), { code: 'ENOENT' });
});

test('exclusive retained intent refuses replay after service reconstruction', async t => {
  const f = await fixture(t); let calls = 0, reports = 0;
  const launch = async () => { calls++; return { code: 0, signal: null }; };
  for (let index = 0; index < 2; index++) {
    const service = serviceFor(f, { launch, report: () => { reports++; } });
    const port = await start(service); assert.equal((await wake(port)).status, 202);
    await waitFor(() => reports === index + 1); await new Promise(resolve => service.close(resolve));
  }
  assert.equal(calls, 1);
});

test('unknown launch failure retains intent and can never retry', async t => {
  const f = await fixture(t); let calls = 0, reports = 0;
  const launch = async () => { calls++; throw new Error('private provider output'); };
  for (let index = 0; index < 2; index++) {
    const service = serviceFor(f, { launch, report: value => {
      reports++; assert.deepEqual(value, { event: 'hosted-owner-wake', code: 'LAUNCH_REFUSED_OR_UNKNOWN', ready: false });
    } });
    const port = await start(service); assert.equal((await wake(port)).status, 202);
    await waitFor(() => reports === index + 1); await new Promise(resolve => service.close(resolve));
  }
  assert.equal(calls, 1);
  assert.equal(JSON.parse(await readFile(join(f.stateDirectory, 'hosted-owner-launch-intent.json'))).phase, 'unknown');
});

test('independent listeners race one durable intent; closing winner aborts only its launch', async t => {
  const f = await fixture(t), gate = Promise.withResolvers();
  let reads = 0, calls = 0, reports = 0, launchSignal;
  const control = { request: async () => { if (++reads === 2) gate.resolve(); await gate.promise; return statusFor(f); } };
  const services = Array.from({ length: 2 }, () => serviceFor(f, { control,
    launch: async (path, { signal }) => {
      calls++; launchSignal = signal;
      await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
      return { code: 1, signal: null };
    }, report: () => { reports++; },
  }));
  t.after(() => services.forEach(service => service.close()));
  const ports = await Promise.all(services.map(start));
  const responses = await Promise.all(ports.map(port => wake(port)));
  assert.ok(responses.every(response => response.status === 202));
  await waitFor(() => calls === 1 && reports === 1);
  assert.equal(launchSignal.aborted, false);
  await Promise.all(services.map(service => new Promise(resolve => service.close(resolve))));
  await waitFor(() => reports === 2);
  assert.equal(calls, 1); assert.equal(launchSignal.aborted, true);
  assert.equal(JSON.parse(await readFile(join(f.stateDirectory, 'hosted-owner-launch-intent.json'))).phase, 'unknown');
});
