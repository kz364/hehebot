import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../runtime/probe-gateway.mjs', import.meta.url));
const transport = new URL('../runtime/gateway-transport.mjs', import.meta.url).href;

async function run(t, fixture) {
  const cwd = await mkdtemp(join(tmpdir(), 'claw-probe-test-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(join(cwd, '.local'));
  if (fixture?.setupFailure) await mkdir(join(cwd, '.local/native-transport-probe'));
  const args = [];
  if (fixture) {
    // Substitute only in this subprocess. No Gateway or model is started.
    const preload = `
      import childProcess from 'node:child_process';
      import { syncBuiltinESMExports } from 'node:module';
      import { EventEmitter } from 'node:events';
      import assert from 'node:assert/strict';
      import { GatewayTransport } from ${JSON.stringify(transport)};
      const fixture = ${JSON.stringify(fixture)};
      childProcess.spawn = (_command, _args, options) => {
        if (_command === '/usr/bin/caffeinate') return {exitCode: 0};
        assert.equal(options.env.OPENCLAW_SKIP_CHANNELS, '1');
        assert.equal(options.env.HOME, undefined);
        assert.equal(options.env.OPENAI_API_KEY, undefined);
        const child = new EventEmitter(); child.pid = 2147483647;
        if (fixture.launchError) {
          delete child.pid;
          queueMicrotask(() => child.emit('error', new Error('SYNTHETIC_PRIVATE_FAILURE')));
        }
        process.kill = (_pid, signal) => {
          if (fixture.stopped !== false) child.emit('exit', 0, signal);
          return true;
        };
        return child;
      };
      syncBuiltinESMExports();
      GatewayTransport.prototype.connect = async () => ({protocol: 4, version: '2026.9.3', scopes: ['operator.read']});
      GatewayTransport.prototype.request = async method => {
        assert.equal(method, 'health');
        if (fixture.stopped === false || fixture.error) {
          let clock = Date.now(); Date.now = () => clock += 60000;
        }
        if (fixture.error) throw Object.assign(new Error('SYNTHETIC_PRIVATE_FAILURE'), {code: 'SYNTHETIC_PRIVATE_FAILURE'});
        return fixture.health;
      };
    `;
    args.push('--import', `data:text/javascript,${encodeURIComponent(preload)}`);
  }
  let result;
  try { result = { ...await exec(process.execPath, [...args, cli, join(cwd, 'missing-package')], { cwd }), code: 0 }; }
  catch (error) { result = error; }
  const report = JSON.parse(result.stdout);
  if (!fixture?.setupFailure) {
    assert.deepEqual(JSON.parse(await readFile(join(cwd, '.local/native-transport-probe/report.json'), 'utf8')), report);
    assert.equal(report.inferenceCalls, 0);
    assert.equal(report.externalSends, 0);
  }
  assert.equal(result.stderr, '');
  return { report, code: result.code };
}

test('healthy response and confirmed stop are required for CLI success', async t => {
  const { report, code } = await run(t, { health: { ok: true } });
  assert.equal(code, 0);
  assert.equal(report.status, 'passed');
  assert.equal(report.healthOk, true);
  assert.equal(report.processStopped, true);
  assert.equal(report.reason, undefined);
});

for (const health of [{ ok: false }, null, { ok: 'true' }]) {
  test(`unhealthy or malformed health ${JSON.stringify(health)} blocks CLI`, async t => {
    const { report, code } = await run(t, { health });
    assert.equal(report.status, 'blocked');
    assert.equal(report.healthOk, false);
    assert.equal(report.processStopped, true);
    assert.equal(code, 1);
  });
}

test('healthy response with unconfirmed cleanup blocks CLI', async t => {
  const { report, code } = await run(t, { health: { ok: true }, stopped: false });
  assert.equal(report.status, 'blocked');
  assert.equal(report.healthOk, true);
  assert.equal(report.processStopped, false);
  assert.equal(code, 1);
});

test('real child launch failure blocks CLI', async t => {
  const { report, code } = await run(t);
  assert.equal(report.status, 'blocked');
  assert.equal(report.processExit.code, 1);
  assert.equal(report.processStopped, true);
  assert.equal(code, 1);
});

test('health exceptions are sanitized and block CLI', async t => {
  const { report, code } = await run(t, { error: true });
  assert.equal(report.status, 'blocked');
  assert.equal(JSON.stringify(report).includes('SYNTHETIC_PRIVATE_FAILURE'), false);
  assert.equal(code, 1);
});

test('spawn error is sanitized and cannot pass even with a synthetic healthy response', async t => {
  const { report, code } = await run(t, { launchError: true, health: { ok: true } });
  assert.equal(report.status, 'blocked');
  assert.equal(report.reason, 'GATEWAY_LAUNCH_FAILED');
  assert.equal(report.processStopped, true);
  assert.equal(code, 1);
});

test('existing probe directory is refused with a sanitized nonzero CLI result', async t => {
  const { report, code } = await run(t, { setupFailure: true });
  assert.deepEqual(report, { status: 'blocked', reason: 'PROBE_FAILED' });
  assert.equal(code, 1);
});
