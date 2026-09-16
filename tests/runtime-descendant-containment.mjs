import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, open, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrderingFixture, parseEvents, phases, probe } from '../scripts/containment-prerequisite-fixture.mjs';

const expected = { disposable: true, path: '/explicit/disposable', dev: '42', ino: '913', uid: 1000, bootId: 'synthetic-boot' };
const valid = () => ({ ...expected, filesystem: 'cgroup2', type: 'domain', kill: true, events: true,
  writableDirectory: true, writableProcs: true, writableKill: true, writableSubtree: true,
  populated: 0, generations: [], managerInside: false });
const record = () => ({ phase: 'new', admission: 'sealed', generation: 'synthetic-generation-1',
  effect: 'unknown', lock: 'synthetic-resource' });

if (process.argv.length > 2 && !(process.argv.length === 4 && process.argv[2] === '--probe')) {
  console.log('PREREQUISITE_DENIED: usage: node tests/runtime-descendant-containment.mjs [--probe metadata.json]; launches=0; containmentEvidence=false');
  process.exitCode = 2;
} else if (process.argv.includes('--probe')) {
  try {
    const index = process.argv.indexOf('--probe');
    const metadata = JSON.parse(await readFile(process.argv[index + 1], 'utf8'));
    console.log(JSON.stringify(await probe(metadata)));
    console.log('KERNEL_CONTAINMENT_UNAVAILABLE: no placement/credential-drop launcher implemented; launches=0');
    process.exitCode = 2;
  } catch (error) {
    console.log(`PREREQUISITE_DENIED: ${error.code ?? error.message}; launches=0; containmentEvidence=false`);
    process.exitCode = 2;
  }
} else {
  for (const [name, change, reason] of [
    ['missing kill', { kill: false }, /missing_kill/],
    ['missing events', { events: false }, /missing_kill/],
    ['threaded', { type: 'threaded' }, /not_domain/],
    ['domain threaded', { type: 'domain threaded' }, /not_domain/],
    ['wrong owner', { uid: 2000 }, /identity_uid/],
    ['wrong root', { path: '/foreign' }, /identity_path/],
    ['replacement inode', { ino: '914' }, /identity_ino/],
    ['wrong mount', { dev: '43' }, /identity_dev/],
    ['wrong boot', { bootId: 'another-boot' }, /identity_bootId/],
    ['ordinary directory', { filesystem: 'tmpfs' }, /not_cgroup2/],
    ['denied directory', { writableDirectory: false }, /permission_denied/],
    ['denied migration', { writableProcs: false }, /permission_denied/],
    ['denied kill', { writableKill: false }, /permission_denied/],
    ['denied delegation', { writableSubtree: false }, /permission_denied/],
    ['foreign generation', { generations: ['foreign-generation'] }, /unresolved_domain/],
    ['live domain', { populated: 1 }, /unresolved_domain/],
    ['manager inside', { managerInside: true }, /manager_placement/],
  ]) test(`contract only: ${name} denies before launch and preserves uncertainty`, async () => {
    const state = record();
    const before = structuredClone(state);
    const controller = new OrderingFixture(state);
    await assert.rejects(controller.start({ ...valid(), ...change }, expected, () => assert.fail('boundary reached')), reason);
    assert.deepEqual(state, before);
    assert.equal(controller.execs, 0);
    assert.deepEqual(controller.trace, []);
  });

  test('contract only: explicit disposable identity required', async () => {
    for (const metadata of [undefined, {}, { ...expected, disposable: false }, { ...expected, path: '/' }]) {
      const controller = new OrderingFixture(record());
      await assert.rejects(controller.start(valid(), metadata, () => assert.fail()), /explicit_disposable/);
      assert.equal(controller.execs, 0);
    }
  });

  test('contract only: strict recursive populated parser', () => {
    assert.equal(parseEvents('populated 1\nfrozen 0\n'), 1);
    assert.equal(parseEvents('frozen 0\npopulated 0\n'), 0);
    for (const input of ['', 'frozen 0', 'populated 2', 'populated 0\npopulated 1', 'populated 0 extra']) {
      assert.throws(() => parseEvents(input));
    }
  });

  for (const stopAt of phases) test(`contract only: stop while awaiting ${stopAt} seals later admission`, async () => {
    const controller = new OrderingFixture(record());
    let release;
    let arrived;
    const waiting = new Promise(resolve => { arrived = resolve; });
    const running = controller.start(valid(), expected, async phase => {
      if (phase === stopAt) { arrived(); await new Promise(resolve => { release = resolve; }); }
    });
    await waiting;
    const priorExecs = controller.execs;
    controller.stop();
    release();
    await running;
    assert.equal(controller.execs, priorExecs);
    assert.equal(controller.readiness, 0);
    assert.equal(controller.record.admission, 'sealed');
    assert.deepEqual(controller.trace, phases.slice(0, phases.indexOf(stopAt) + 1));
    if (controller.helperOutstanding) {
      assert.throws(() => controller.observeEmpty({ sameIdentity: true, populated: 0, helpersReaped: false }), /termination_unknown/);
    }
  });

  test('contract only: fsynced ordering, reopen refuses replacement, emptiness retains effects', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hehe-containment-'));
    try {
      const path = join(dir, 'intent.json');
      const controller = new OrderingFixture(record());
      await controller.start(valid(), expected, async (_phase, state) => {
        const file = await open(path, 'w', 0o600);
        try { await file.writeFile(JSON.stringify(state)); await file.sync(); } finally { await file.close(); }
        const reopened = new OrderingFixture(JSON.parse(await readFile(path, 'utf8')));
        await assert.rejects(reopened.start(valid(), expected, () => assert.fail()), /reconciliation_required/);
        assert.equal(reopened.execs, 0);
      });
      assert.deepEqual(controller.trace, ['prepared', 'group_identity', 'helper_identity', 'placement_permit', 'placed', 'exec_permit', 'ready']);
      assert.equal(controller.execs, 1);
      assert.equal(controller.readiness, 1);
      controller.stop();
      for (const phase of ['prepared', 'launch_unknown', 'kill_unknown']) {
        const reopened = new OrderingFixture({ ...record(), phase });
        await assert.rejects(reopened.start(valid(), expected, () => assert.fail()), /reconciliation_required/);
      }
      for (const observation of [
        { sameIdentity: true, populated: 1, helpersReaped: true },
        { sameIdentity: false, populated: 0, helpersReaped: true },
        { sameIdentity: true, populated: 0, helpersReaped: false },
      ]) assert.throws(() => controller.observeEmpty(observation), /termination_unknown/);
      controller.observeEmpty({ sameIdentity: true, populated: 0, helpersReaped: true });
      assert.deepEqual(controller.record, { ...record(), phase: 'process_empty' });
      await assert.rejects(controller.start(valid(), expected, () => assert.fail()), /reconciliation_required/);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  test('read-only probe rejects absent metadata, wrong identity and a real ordinary directory', async () => {
    await assert.rejects(probe(undefined), /explicit_disposable/);
    const path = await mkdtemp(join(tmpdir(), 'hehe-containment-probe-'));
    try {
      const info = await stat(path, { bigint: true });
      const metadata = { disposable: true, path, dev: String(info.dev), ino: String(info.ino),
        uid: Number(info.uid), bootId: (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim() };
      await assert.rejects(probe({ ...metadata, ino: 'wrong' }), /identity_ino/);
      await assert.rejects(probe(metadata), /not_cgroup2/);
    } finally { await rm(path, { recursive: true, force: true }); }
  });
  console.log('KERNEL_CONTAINMENT_UNAVAILABLE: explicit delegated domain and protected placement launcher required; launches=0; containmentEvidence=false');
}
