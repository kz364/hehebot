// Test-only contract model and read-only probe. Never launches or migrates a process.
import { access, readFile, realpath, stat, statfs } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, join, normalize } from 'node:path';

export function validate(snapshot, expected) {
  if (!expected || expected.disposable !== true || !isAbsolute(expected.path ?? '') ||
      normalize(expected.path) !== expected.path || expected.path === '/') throw Error('explicit_disposable_domain_required');
  for (const key of ['path', 'dev', 'ino', 'uid', 'bootId']) {
    if (expected[key] === undefined || snapshot[key] !== expected[key]) throw Error(`identity_${key}`);
  }
  if (snapshot.filesystem !== 'cgroup2') throw Error('not_cgroup2');
  if (snapshot.type !== 'domain') throw Error('not_domain');
  if (!snapshot.kill || !snapshot.events) throw Error('missing_kill_or_events');
  if (!snapshot.writableDirectory || !snapshot.writableProcs || !snapshot.writableKill ||
      !snapshot.writableSubtree) throw Error('permission_denied');
  if (snapshot.populated !== 0 || snapshot.generations.length !== 0) throw Error('unresolved_domain');
  if (snapshot.managerInside !== false) throw Error('manager_placement_unknown_or_inside');
}

export function parseEvents(value) {
  const lines = value.trim().split('\n');
  const entries = lines.map(line => line.split(/\s+/));
  if (entries.some(([key, value, extra]) => !key || !/^\d+$/.test(value ?? '') || extra !== undefined) ||
      new Set(entries.map(([key]) => key)).size !== entries.length) throw Error('invalid_events');
  const populated = entries.find(([key]) => key === 'populated')?.[1];
  if (populated !== '0' && populated !== '1') throw Error('invalid_populated');
  return Number(populated);
}

export async function probe(expected) {
  // Validate the supplied path before any access; never discover candidate domains.
  if (!expected || expected.disposable !== true || !isAbsolute(expected.path ?? '') ||
      normalize(expected.path) !== expected.path || expected.path === '/') throw Error('explicit_disposable_domain_required');
  const path = await realpath(expected.path);
  if (path !== expected.path) throw Error('noncanonical_domain');
  const info = await stat(path, { bigint: true });
  const filesystem = await statfs(path);
  const identity = { path, dev: String(info.dev), ino: String(info.ino), uid: Number(info.uid),
    bootId: (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim() };
  for (const key of Object.keys(identity)) {
    if (identity[key] !== expected[key]) throw Error(`identity_${key}`);
  }
  if (filesystem.type !== 0x63677270) throw Error('not_cgroup2');
  // This is only a capability preflight, not a stable held identity or authorization receipt.
  const { readdir } = await import('node:fs/promises');
  const can = async (name, mode) => access(join(path, name), mode).then(() => true, () => false);
  const snapshot = { ...identity, filesystem: 'cgroup2',
    type: (await readFile(join(path, 'cgroup.type'), 'utf8')).trim(),
    kill: await can('cgroup.kill', constants.F_OK), events: await can('cgroup.events', constants.R_OK),
    writableDirectory: await can('.', constants.W_OK), writableProcs: await can('cgroup.procs', constants.W_OK),
    writableKill: await can('cgroup.kill', constants.W_OK), writableSubtree: await can('cgroup.subtree_control', constants.W_OK),
    populated: parseEvents(await readFile(join(path, 'cgroup.events'), 'utf8')),
    generations: (await readdir(path, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name),
    // A recursively empty domain cannot contain the probing manager.
    managerInside: false,
  };
  validate(snapshot, expected);
  return { status: 'prerequisites_observed_only', containmentEvidence: false, launches: 0 };
}

export const phases = ['prepared', 'group_identity', 'helper_identity', 'placement_permit', 'placed', 'exec_permit', 'ready'];

// Hooks are synthetic boundaries, NOT an OS launcher or production controller.
export class OrderingFixture {
  constructor(record) {
    this.record = record;
    this.stopped = false;
    this.trace = [];
    this.execs = 0;
    this.readiness = 0;
    this.helperOutstanding = false;
  }
  stop() { this.stopped = true; this.record.admission = 'sealed'; }
  async start(snapshot, expected, boundary) {
    validate(snapshot, expected);
    if (this.record.phase !== 'new') throw Error('reconciliation_required');
    this.record.admission = 'sealed';
    for (const phase of phases) {
      if (this.stopped) return;
      this.record.phase = phase;
      this.trace.push(phase);
      if (phase === 'helper_identity') this.helperOutstanding = true;
      await boundary(phase, this.record);
      if (this.stopped) return;
      if (phase === 'exec_permit') this.execs++;
      if (phase === 'ready') this.readiness++;
    }
  }
  observeEmpty({ sameIdentity, populated, helpersReaped }) {
    if (!this.stopped || this.record.admission !== 'sealed' || !sameIdentity ||
        populated !== 0 || !helpersReaped) throw Error('termination_unknown');
    this.helperOutstanding = false;
    this.record.phase = 'process_empty';
    // Unknown effects and locks deliberately survive process emptiness.
  }
}
