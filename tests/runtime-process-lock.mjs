import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, symlink, chmod, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve('scripts/with-executor-lock.sh');
function run(directory, code) {
  const child = spawn('bash', [script, directory, process.execPath, '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.resume();
  return child;
}

// G3 (GROK_ALIGNMENT A2, AGENTS.md trap 1): CHANGED from the pre-G3 "second
// executor is simply refused (exit 73), the first holder keeps running"
// expectation. That encoded exactly the "successor waits for the prior
// executor to exit/be proven dead on its own" precondition G3 removes: a
// contended lock now kills the live prior holder's process group and takes
// over within the 30s retry budget, so a successor never needs independent
// proof of process death.
test('G3: a contended lock kills the live holder and the contender takes over', { timeout: 20000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'hehe-lock-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const holder = run(directory, "process.stdout.write('ready'); setInterval(()=>{},1000)");
  t.after(() => { if (holder.exitCode === null && holder.signalCode === null) holder.kill(); });
  await once(holder.stdout, 'data');
  const successor = run(directory, "process.stdout.write('ok'); process.exit(0)");
  const [holderExit, successorExit] = await Promise.all([once(holder, 'exit'), once(successor, 'exit')]);
  // The holder was killed by the takeover (a signal, not its own exit(0)).
  assert.equal(holderExit[0], null);
  assert.ok(typeof holderExit[1] === 'string' && holderExit[1].startsWith('SIG'));
  assert.deepEqual(successorExit, [0, null]);
  const replacement = run(directory, 'process.exit(0)');
  assert.deepEqual(await once(replacement, 'exit'), [0, null]);
});

// G3: when the recorded holder cannot actually be reclaimed (e.g. a stale or
// foreign pid on record, so the takeover kill is a no-op) the contender waits
// out the full budget and reports RECOVERY_REQUIRED rather than hanging
// forever or silently proceeding.
test('G3: an unreclaimable lock reports RECOVERY_REQUIRED after the retry budget', { timeout: 40000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'hehe-lock-unreclaimable-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const holder = run(directory, "process.stdout.write('ready'); setInterval(()=>{},1000)");
  t.after(() => { if (holder.exitCode === null && holder.signalCode === null) holder.kill(); });
  await once(holder.stdout, 'data');
  // Overwrite the real holder's recorded pid with one that cannot be killed
  // (already-exited), so the takeover's kill is a genuine no-op and the real
  // holder survives for the whole retry window.
  await writeFile(join(directory, 'holder.pid'), '1\n');
  const start = Date.now();
  const contender = run(directory, 'process.exit(0)');
  const [code] = await once(contender, 'exit');
  const elapsed = Date.now() - start;
  assert.equal(code, 75);
  assert.ok(elapsed >= 29000, `expected the full ~30s retry budget, got ${elapsed}ms`);
  assert.equal(holder.exitCode, null);
  assert.equal(holder.signalCode, null);
});

test('symlink and nonprivate state directories cannot acquire ownership', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'hehe-lock-invalid-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const link = directory + '-link';
  await symlink(directory, link); t.after(() => rm(link));
  assert.equal((await once(run(link, 'process.exit(0)'), 'exit'))[0], 64);
  await chmod(directory, 0o755);
  assert.equal((await once(run(directory, 'process.exit(0)'), 'exit'))[0], 64);
});

async function poll(label, inspect) {
  const deadline = Date.now() + 5000;
  do {
    const value = await inspect();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 20));
  } while (Date.now() < deadline);
  assert.fail(`bounded wait expired: ${label}`);
}

async function optionalFile(path) {
  try { return await readFile(path, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function identity(pid) {
  const raw = await optionalFile(`/proc/${pid}/stat`);
  if (!raw) return null;
  const fields = raw.slice(raw.lastIndexOf(')') + 2).split(' ');
  return { state: fields[0], parent: Number(fields[1]), start: fields[19] };
}

// Fixture-only Linux descriptor inspection. Do not assume flock's fd number.
const inspectDescriptors = `
  const fs = require('node:fs');
  const target = fs.statSync(directory);
  function publish(name, value) {
    fs.writeFileSync(directory + '/' + name + '.tmp', JSON.stringify(value));
    fs.renameSync(directory + '/' + name + '.tmp', directory + '/' + name);
  }
  function lockDescriptors() {
    return fs.readdirSync('/proc/self/fd').filter(name => {
      try {
        const value = fs.fstatSync(Number(name));
        return value.dev === target.dev && value.ino === target.ino;
      } catch (error) { if (error.code === 'EBADF') return false; throw error; }
    }).map(Number);
  }
`;

for (const inherit of [true, false]) test(
  `parent exit: ${inherit ? 'inherited descriptor retains exclusion' : 'default Node spawn leaves live child without exclusion'}`,
  { timeout: 30000 }, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'hehe-lock-descendant-'));
    const childCode = `
      const directory = ${JSON.stringify(directory)};
      ${inspectDescriptors}
      publish('child-ready', {
        pid: process.pid, parent: process.ppid, descriptors: lockDescriptors()
      });
      // Independent safety ceiling, including loss of the test runner.
      setTimeout(() => process.exit(91), 20000);
      setInterval(() => {
        if (fs.existsSync(directory + '/stop-child')) process.exit(0);
        if (fs.existsSync(directory + '/probe') && !fs.existsSync(directory + '/reply')) {
          publish('reply', {
            pid: process.pid, parent: process.ppid, descriptors: lockDescriptors()
          });
        }
      }, 10);
    `;
    const parent = run(directory, `
      const directory = ${JSON.stringify(directory)};
      ${inspectDescriptors}
      const { spawn } = require('node:child_process');
      const descriptors = lockDescriptors();
      if (descriptors.length !== 1) process.exit(92);
      const args = ['-e', ${JSON.stringify(childCode)}];
      const child = ${inherit
        ? "spawn(process.execPath, args, { stdio: ['ignore', 'ignore', 'ignore', descriptors[0]] })"
        : 'spawn(process.execPath, args)'};
      child.on('error', () => process.exit(93));
      publish('parent-ready', {
        pid: process.pid, child: child.pid, descriptors
      });
      setTimeout(() => process.exit(94), 20000);
      setInterval(() => {
        if (fs.existsSync(directory + '/exit-parent')) process.exit(0);
      }, 10);
    `);
    // Register immediately: cleanup also covers assertion/setup failures. No PID
    // patterns or process-group kills; the child obeys its private stop file.
    const parentExit = new Promise((resolve, reject) => {
      parent.once('exit', (code, signal) => resolve({ code, signal }));
      parent.once('error', reject);
    });
    t.after(async () => {
      await writeFile(join(directory, 'stop-child'), 'stop');
      // Let startup publish child identity before exiting, even if setup failed.
      await writeFile(join(directory, 'exit-parent'), 'exit');
      const timer = setTimeout(() => {
        if (parent.exitCode === null && parent.signalCode === null) parent.kill('SIGKILL');
      }, 5000);
      try { await parentExit; } finally { clearTimeout(timer); }
      const report = await optionalFile(join(directory, 'parent-ready'));
      if (report && JSON.parse(report).child) {
        const pid = JSON.parse(report).child;
        await poll(`child ${pid} reaped (not merely zombie)`, async () => !await identity(pid));
      }
      await rm(directory, { recursive: true, force: true });
    });
    const owner = JSON.parse(await poll('parent ready', () => optionalFile(join(directory, 'parent-ready'))));
    const child = JSON.parse(await poll('child ready', () => optionalFile(join(directory, 'child-ready'))));
    assert.equal(owner.pid, parent.pid); // flock --no-fork / exec preserved identity.
    assert.equal(child.pid, owner.child);
    assert.equal(child.parent, owner.pid);
    assert.deepEqual(child.descriptors, inherit ? [3] : []);
    const before = await identity(child.pid);
    assert.ok(before && !['Z', 'X'].includes(before.state));
    assert.equal(before.parent, owner.pid);

    async function checkContender(expected) {
      const marker = join(directory, 'contender-entered');
      await rm(marker, { force: true });
      const contender = run(directory, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'entered')`);
      const timer = setTimeout(() => contender.kill('SIGKILL'), 5000);
      try {
        assert.deepEqual(await once(contender, 'exit'), [expected, null]);
        assert.equal(await optionalFile(marker), expected === 0 ? 'entered' : null);
      } finally { clearTimeout(timer); }
    }
    await checkContender(73);
    await writeFile(join(directory, 'exit-parent'), 'exit');
    assert.deepEqual(await parentExit, { code: 0, signal: null });
    assert.equal(await identity(owner.pid), null);
    await writeFile(join(directory, 'probe'), 'probe after observed parent exit');
    const reply = JSON.parse(await poll('live child response after parent exit', () => optionalFile(join(directory, 'reply'))));
    assert.equal(reply.pid, child.pid);
    assert.notEqual(reply.parent, owner.pid);
    assert.deepEqual(reply.descriptors, child.descriptors);
    await checkContender(inherit ? 73 : 0);
    const after = await identity(child.pid);
    assert.ok(after && !['Z', 'X'].includes(after.state));
    assert.equal(after.start, before.start); // same process, not recycled PID.
    assert.notEqual(after.parent, owner.pid);
    t.diagnostic(JSON.stringify({ inherit, parent: owner.pid, child: child.pid,
      childStart: after.start, descriptors: reply.descriptors, contenderExit: inherit ? 73 : 0 }));
    await writeFile(join(directory, 'stop-child'), 'stop');
    await poll('child fully reaped', async () => !await identity(child.pid));
    await checkContender(0);
    t.diagnostic('child reaped; post-cleanup contender entered and exited');
  });
