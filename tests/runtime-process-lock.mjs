import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, symlink, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve('scripts/with-executor-lock.sh');
function run(directory, code) {
  const child = spawn('bash', [script, directory, process.execPath, '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.resume();
  return child;
}

test('OS lock excludes a second executor and releases after process exit', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'claw-lock-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const holder = run(directory, "process.stdout.write('ready'); setInterval(()=>{},1000)");
  t.after(() => { if (holder.exitCode === null && holder.signalCode === null) holder.kill(); });
  await once(holder.stdout, 'data');
  const blocked = run(directory, 'process.exit(0)');
  assert.equal((await once(blocked, 'exit'))[0], 73);
  const exited = once(holder, 'exit'); holder.kill(); await exited;
  const replacement = run(directory, 'process.exit(0)');
  assert.equal((await once(replacement, 'exit'))[0], 0);
});

test('symlink and nonprivate state directories cannot acquire ownership', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'claw-lock-invalid-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const link = directory + '-link';
  await symlink(directory, link); t.after(() => rm(link));
  assert.equal((await once(run(link, 'process.exit(0)'), 'exit'))[0], 64);
  await chmod(directory, 0o755);
  assert.equal((await once(run(directory, 'process.exit(0)'), 'exit'))[0], 64);
});
