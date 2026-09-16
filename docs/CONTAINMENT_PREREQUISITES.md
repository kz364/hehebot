# Containment prerequisite harness: contract evidence only

This bounded P0.1 deliverable follows [the containment design](DESCENDANT_CONTAINMENT_DESIGN.md).
It adds no production launcher, admission, service, provider or status integration.
**Real kernel containment is unavailable, not passed or skipped acceptance.**
The current orb has no supplied writable delegation. This harness intentionally
does not implement a positive kernel mode against an unprovisioned permission contract.

## Run the credential-free checks

```sh
node --check scripts/containment-prerequisite-fixture.mjs
node --check tests/runtime-descendant-containment.mjs
node --test tests/runtime-descendant-containment.mjs
```

The suite has 28 tests: synthetic prerequisite/ordering contracts plus a read-only
ordinary-directory rejection test. It prints:

```text
KERNEL_CONTAINMENT_UNAVAILABLE: explicit delegated domain and protected placement launcher required; launches=0; containmentEvidence=false
```

The test-only controller models prepared intent → group identity → blocked helper
identity → placement permit → placed acknowledgment → exec permit → readiness.
Stop is injected during each awaited boundary; later exec/readiness is denied.
An exec already admitted before stop is not retroactively described as prevented.
Outstanding helpers prevent accepting emptiness until explicitly reaped. Identity
mismatch, populated state, foreign generations, missing interfaces and denied
writes reject before any launch boundary and leave uncertainty intact. Reopen
refuses replacement at prepared, launch-unknown and kill-unknown boundaries.
Simulated empty requires sealed admission, unchanged identity and reaped helpers;
it retains the synthetic unknown effect and resource lock.

Temporary intent files are private, fsynced, reopened and removed in `finally`.
This tests ordering, not atomic crash-safe journal publication (directory fsync,
power loss and actual owner death are not exercised). Phase names, placement
acknowledgments and helper reaping are synthetic inputs, not kernel receipts.
There are no child processes, PID scans, flock settlement claims or cgroup writes.

## Optional read-only probe of an explicitly supplied domain

An administrator must first supply the canonical path and trusted identity of
**one already delegated, empty, disposable non-root cgroup v2 domain**. Do not
derive authorization from a writable path. Metadata is a private JSON file:

```json
{
  "disposable": true,
  "path": "/administrator/supplied/canonical/domain",
  "dev": "administrator-supplied decimal st_dev",
  "ino": "administrator-supplied decimal st_ino",
  "uid": 1000,
  "bootId": "administrator-supplied OS boot ID"
}
```

```sh
node tests/runtime-descendant-containment.mjs --probe /private/domain-metadata.json
```

The probe checks the supplied object only: canonical identity, filesystem magic,
domain type, empty recursive events, no existing subdirectories, readable events,
and effective write access to the directory/procs/subtree-control/kill interfaces.
It never creates or migrates anything. A recursively empty supplied domain excludes
the probing manager. Existing generations are conservatively rejected, not removed.
No writable-host search, sudo, service creation, remount, permission changes,
dependency installation or network/account calls occur.

Exit **2** means prerequisite denial or kernel mode unavailable. Even a successful
probe reports `prerequisites_observed_only`, `containmentEvidence:false`, zero
launches and exits 2. Unknown CLI options also exit 2; they cannot silently run a
green suite instead of a requested kernel test. Read-time identity/access checks
are racy observations, not held directory identity, a security boundary or proof
of delegation authority. No successful probe authorizes production execution.

## Exact prerequisite for the next real test

The local orb administrator must authorize and provision a dedicated disposable
delegation using its supported service/scope surface (on this systemd orb,
`Delegate=yes`), with a manager outside the killed workload, child-directory
creation and migration rights at the delegated common ancestor, child kill write
access and readable recursive events. Supply boot/device/inode/owner identity and
exclusive ownership; no unrelated processes or foreign generations may be present.
Do not grant access to `amp.slice`, the mount root or other workloads.

Before implementing positive mode, settle the narrowly scoped launcher contract:
a trusted single-threaded helper starts blocked on a private deadline-bounded
channel, records exact identity before permission, self-places before workload
fork/exec, drops to an administrator-provisioned workload credential, and cannot
place/exec on EOF or timeout. Stop revokes permits and reaps outstanding helpers
before observing emptiness, including a permit delivered just before owner death.
Held object identity and a durable exclusive generation record are required;
the read-only probe here is not a substitute. Do not improvise setuid or sudo.

Then implement and run the design's bounded real cases: default-spawn and setsid
descendants survive parent exit/free flock; membership stays in the owned domain;
sealed recursive kill produces `populated 0`; direct children are reaped; an
outside sibling still answers a fresh nonce. Use finite counts and deadlines
(5-second observation, 20-second child self-exit, 30-second case ceiling), confirm
owned cleanup, and retain unknown effects/locks after emptiness. None of those
positive kernel cases, real helper EOF/timeout races, or crash recovery has run
or is implemented by this contract fixture.

## Selected-Sprite permission remains separate

Local delegation proves nothing about Sprites. First obtain owner-authorized
read-only guest inspection (exec may wake it); separately obtain a supported
provider delegation/provisioning contract across wrapper restart/cold boot and
manager-only launch/migration authority. Same-UID writable delegation is not
workload isolation: payloads must not migrate into the manager, launch external
services/execs, access provider management sockets/tokens, or mutate owner journals.
Distinct protected credentials or equivalent supported confinement must be
provisioned and exercised. Sprite does not use systemd; the orb setup is not a
Sprite recipe. Live disposable service crash/stop/wake tests require separate
authorization. No model login, API token or guest root implies these guarantees.

P0.1 is therefore **prerequisite and ordering implementation only**. Production
assembly/status/verifier remain owned by the host thread; the next decision is
whether to obtain the scoped local delegation/launcher contract for actual
kernel evidence. No production flag or settlement gate changes are justified.
