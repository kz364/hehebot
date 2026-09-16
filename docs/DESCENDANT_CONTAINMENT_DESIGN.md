# E02/E09: installation-owned descendant containment

Design and read-only research, retrieved **2026-09-16 (UTC)**. No runtime,
connector admission, service, cgroup, account, deployment or gate changes.

Baseline is the unpublished host main
[`f79006b`](https://github.com/kz364/hehebot/commit/f79006b3bbcaa7cb8870b1b0f93e211ec3eb071d),
not `origin/main`; that link may remain unavailable until publication. Imported
`.local/cancel-journal.bundle` has SHA256
`a62db11985cbc6b50a9b06fbc12c1f4713ee7a3181115918758d2e05c8ee580e`.

## Decision: use a delegated workload subtree, but Sprite support is unproved

Keep the **Sprite service as the restart/wake wrapper**. Put all installation
execution processes below one installation-owned cgroup v2 workload subtree,
managed by a small trusted owner outside that workload. Use the supported kernel
`cgroup.kill` operation followed by recursive `cgroup.events: populated 0` as the
local live-process termination boundary. Close admission and prevent migration
or launches back into the subtree before accepting that observation.

This is a concrete conditional design, **not a claim that the selected Sprite
currently grants delegation**. Public Sprites documentation establishes service
management, but the inspected sources provide neither an installation-delegation
contract nor a service-stop recursive-empty guarantee. Neither option is proved
deployable for containment today. A writable, provider-approved delegated subtree
plus a protected manager/payload permission split is the smallest missing platform
capability for the recommended design. If Sprites cannot supply it through a
supported surface, keep execution/connector admission blocked and request a
provider-owned containment contract instead; do not emulate it with PID scans.

Containment proves absence of **live local processes in the owned domain**, not
completion of remote requests, effects, native tasks, profile flushes or output
delivery. E02 and E09 remain open even after a successful containment harness.

## Existing ownership and the exact gap

- `scripts/with-executor-lock.sh` uses `flock --no-fork` on the private state
  directory. Keep it for serializing cooperating owners, not for counting trees.
  [Existing real subprocess evidence](EXECUTOR_LOCK_DESCENDANTS.md) shows a default
  Node-spawn child alive after parent exit while a contender acquires that lock.
- `runtime/codex-transport.mjs: spawnCodex()` launches supported app-server
  0.154.0 with only three pipes; extra lock descriptors are not passed. Its
  `close()` ends stdin and signals its direct child. `exit`, closed pipes and
  `kill()` success are not descendant receipts.
- `runtime/codex-service.mjs: createCodexService()` explicitly requires
  `disposableTest`; startup persists `boot_unknown` before native launch and
  refuses existing service intent. `stop()` waits for the direct child, escalates
  that PID, and writes `nativeStopped: true` in recovery. Interpret that existing
  field only as direct-process evidence. It cannot clear containment uncertainty.
  The current refusal to release activity or commit sleep on shutdown is correct.
- `runtime/sprites-service-entry.mjs` is HTTP transport preflight, not an executor.
  Future containment belongs outside `createCodexService`, at process admission;
  do not turn `/wake` into an alternate process launcher or weaken preflight.
- `runtime/sprites-codex-service.mjs` composes the actual provider Tasks client and
  `runtime/sprites-task-transport.mjs` binds only Tasks to `/.sprite/api.sock`.
  `src/providers/sprites.ts` starts a named service and sends authenticated wake;
  `stop()` rejects whole-runtime termination, `confirmedStop` is false, and warm/
  cold observations never set `executionStopped`. Preserve these distinctions.
- [WhatsApp shutdown evidence](WAPPMCP_SHUTDOWN.md) proves public `destroy()` can
  return without confirmed browser termination. A connector protocol response or
  SDK destroy must remain separate from its process and effect obligations.

## Authoritative sources and what they actually promise

All quotations below were retrieved on **2026-09-16**. Sprites concept and API
pages were explicitly refreshed. API pages displayed **sprite-env v0.0.1-rc48**;
this is documentation version evidence, not the selected Sprite's installed
version. No upstream code was copied or imported.

| Source / section | Exact short quotation | Design consequence |
| --- | --- | --- |
| [Sprites Services — lifecycle](https://docs.sprites.dev/concepts/services/) | “A service process that exits on its own gets restarted by the runtime.” | Unexpected owner exit can launch a replacement wrapper; replacement must start recovery-only. |
| Same, managing services | “A stopped service stays stopped. The runtime won’t restart it behind your back.” | Use explicit stop for service lifecycle, not `signal TERM` as an assumed stop. |
| Same, managing services | “Send `TERM` or `KILL` via `signal`, or kill the PID directly, and the runtime treats it as a crash and restarts the service.” | A signal to the wrapper is not restart exclusion. |
| Same, serving HTTP | “If the service isn’t running when a request arrives, the proxy starts it first, then forwards the request.” | Do not use stopped state alone as an admission fence. Interaction with sticky stop needs provider clarification/testing. |
| Same, logs | “Sprites don’t run systemd” | No Sprite `systemctl`, `Delegate=yes` installation recipe or orb-to-Sprite inference. |
| Same, lifecycle | “The VM was suspended with your process inside it. The process resumes mid-thought; it is not restarted.” | Warm wake can resume old executors. Paused is not dead. |
| Same, lifecycle | “Process state was dropped. The runtime starts every service fresh, in dependency order.” | Cold boot drops processes, not durable effect uncertainty; identity must distinguish incarnations. |
| Same, lifecycle | “Services don’t keep a Sprite from pausing.” | Renew Tasks holds while draining; holds are not containment. |
| [Sprites Services API — Stop Service](https://sprites.dev/api/sprites/services) | “Stop a running service. Returns streaming NDJSON with service stop progress.” | `POST /v1/sprites/{name}/services/{service_name}/stop`, default wait 10s; `stopping`, `stopped`, `complete`, `error` are not specified as recursive-empty evidence. |
| Same, Restart Service | “Restart a service (stop if running, then start).” | Do not use combined restart where reconciliation is required between old and new execution. |
| [Sprites Command Execution — Execute Command](https://sprites.dev/api/sprites/exec) | “Commands continue running after disconnect” | Disconnect cannot release ownership. `max_run_after_disconnect` defaults to 0/forever for TTY, 10s for non-TTY, not a descendant receipt. |
| Same, Kill Exec Session | “Timeout waiting for process to exit (default: `10s`)” | Kill targets a session, with default SIGTERM; neither timeout nor stream completion proves installation settlement. |
| Same, kill example | “Signaling SIGTERM to process group 1847” | Published example describes a process group. It does not establish a cgroup/tree guarantee, and does not prove service stop uses the same implementation. |
| [Linux cgroup v2 — Processes](https://docs.kernel.org/admin-guide/cgroup-v2.html#organizing-processes-and-threads) | “When a process forks a child process, the new process is born into the cgroup that the forking process belongs to at the time of the operation.” | Place the trusted launcher before any workload fork/exec. Moving an already-running parent does not move existing descendants. |
| [Linux cgroup v2 — Core Interface Files](https://docs.kernel.org/admin-guide/cgroup-v2.html#core-interface-files) | “Killing a cgroup tree will deal with concurrent forks appropriately and is protected against migrations.” | `cgroup.kill = 1` is the recursive force-stop primitive; do not reproduce it in a userspace PID loop. |
| Same, `cgroup.events` | “1 if the cgroup or its descendants contains any live processes; otherwise, 0.” | Read the workload root, not an empty parent PID list. Zero excludes live processes, not unreaped zombies or unfinished filesystem/remote effects. |
| [Linux cgroup v2 — Delegation](https://docs.kernel.org/admin-guide/cgroup-v2.html#delegation) | “A delegated sub-hierarchy is contained in the sense that processes can’t be moved into or out of the sub-hierarchy by the delegatee.” | Requires the documented common-ancestor/destination write restrictions or namespace delegation; not merely a directory name. |
| [systemd Control Group APIs and Delegation](https://systemd.io/CGROUP_DELEGATION/) | “Only sub-trees can be delegated” | Obtain explicit ownership; do not write arbitrary systemd-owned cgroups. |
| Same, delegation guarantees | “systemd won’t fiddle with your sub-tree of the cgroup tree anymore.” | `Delegate=` on a service/scope is the supported local-systemd setup boundary, not proof Sprites offers it. |
| Same, Some Don’ts | “It’s fine to read from any attribute you like however.” | Current investigation reads attributes only. No cgroup creation, migration, kill, remount or service mutation. |
| [Node child_process — stdio](https://nodejs.org/api/child_process.html#optionsstdio) | “For fd 3 and up, the default is `'ignore'`.” | Default spawning loses the directory lock fd. Explicit fd passing helps only descendants that retain it. |
| [Node child_process — kill](https://nodejs.org/api/child_process.html#subprocesskillsignal) | “On Linux, child processes of child processes will not be terminated when attempting to kill their parent.” | Direct child exit is not a tree stop. |
| [Linux flock(2)](https://man7.org/linux/man-pages/man2/flock.2.html) | “the lock is released either by an explicit `LOCK_UN` operation on any of these duplicate file descriptors, or when all such file descriptors have been closed.” | Lock availability is not membership or termination evidence. |
| [Linux setsid(2)](https://man7.org/linux/man-pages/man2/setsid.2.html) | “The calling process also becomes the process group leader of a new process group in the session” | A descendant can leave an inherited process group through ordinary supported process APIs. |

The full kernel page was inspected, including delegation containment, migration,
no-internal-process constraints and `cgroup.kill`'s non-root/domain requirements.
It displayed 7.3.0-rc3 documentation; require actual feature probes rather than
assuming the selected Sprite runs that kernel. Search of public Sprites sources
did not establish delegation; absence from these sources is not proof the platform
cannot support it. Provider implementation details remain unknown.

## Only two credible options

| | Provider-owned service containment | Installation-owned delegated cgroup |
| --- | --- | --- |
| Existing supported surface | Named service create/get/start/stop, restart and NDJSON progress. | Linux cgroup v2 ABI, conditional on provider-approved delegation and permissions. |
| Required owner | Sprite runtime must own every descendant of a service generation, independently of parent lifetime/process group. | Protected installation manager owns every process-launch path and one workload subtree. Sprite owns only the outer service lifecycle. |
| Missing guarantee | Recursive capture across fork/setsid/parent exit; no old children after auto-restart; authenticated generation-specific emptiness; serialization against starts/HTTP wake. | No evidence the selected Sprite grants a persistent/reconstructible delegated subtree, usable kill/events, or the required workload privilege restriction. |
| Implementable now | A stop-progress adapter, **not a settlement adapter**. Its 200/stopped/complete response cannot close E02. | Credential-free capability validation and disposable harness code; real kernel tests need a deliberately delegated test domain first. Production use needs selected-Sprite evidence. |
| Decision | Prefer only if provider publishes and verifies the stronger contract; fewer installation mechanisms then suffice. Do not infer it from exec examples. | Recommended design to implement conditionally because membership, recursive kill and empty observation have specified kernel semantics. Fail closed if support/permissions are missing. |

Even a stronger service-stop contract would cover only the named owned service,
not arbitrary exec sessions or other services in the Sprite. Keep all installation
execution under the chosen boundary and retain unrelated runtime processes outside.
There is no reason to change `SpritesProvider.confirmedStop` to true for a
service-scoped receipt: that field presently describes whole-runtime stopping.

## Read-only inspection of this orb, not the selected Sprite

Observed at approximately 08:24–08:26 UTC, 2026-09-16:

```text
id: uid=1000(user), gid=1000(user), groups=1000(user),0(root)
kernel: 6.1.158+; /proc/1/comm: systemd
/sys/fs/cgroup: cgroup2 rw,nosuid,nodev,noexec,relatime,nsdelegate,memory_recursiveprot
current unit: amp-run-2902-27289.scope
ControlGroup=/amp.slice/amp-workload.slice/amp-run-2902-27289.scope
LoadState=loaded; ActiveState=active; Delegate=no; KillMode=control-group
current cgroup: drwxr-xr-x root:root; type=domain
cgroup.procs, cgroup.subtree_control: -rw-r--r-- root:root
cgroup.kill: --w------- root:root
cgroup.events: -r--r--r-- root:root; populated 1; frozen 0
effective test -w: no for directory/procs/subtree_control/kill/events
CapEff=0000000000000000; NoNewPrivs=0
command -v sprite sprite-env: neither found
```

Read commands were `id`, `uname -r`, `/proc/self/cgroup`, `findmnt`, `stat`,
`test -w`, reads of `cgroup.type/events/controllers`, filtered `/proc/self/status`,
and `systemctl show "$unit"` using the current scope name. Scope names change
between shell invocations; no fixed Amp scope is a deployment target. The initial
probe of `amp.service` returned an empty ControlGroup and was not used as evidence
for the current scope. Missing `cgroup.kill` at the mount root is expected: the
kernel documents it for non-root groups. Its presence in the actual scope was
confirmed separately. `rw` mount and membership in group `root` do not grant the
needed write access. No sudo, D-Bus mutation or access-bypass probe was attempted.

Thus this orb supports **read-only prerequisite inspection**, not an authorized
delegated-subtree test as currently configured. No selected-Sprite permissions,
service state, account details or kernel were inspected. Its systemd behavior
cannot be inferred from the orb (and Sprites documentation says no systemd).

### Minimal external permission, separately scoped

1. **For a real local credential-free harness:** the orb administrator may provide
   one disposable delegated cgroup v2 domain under a dedicated service/scope with
   `Delegate=yes`, started through the administrator's supported service surface.
   The fixture must be born inside it or receive authorized initial placement.
   Grant the fixture manager child-directory creation and the delegation files
   required by the kernel, and writable child `cgroup.kill` plus readable events.
   No permission over `amp.slice`, other workloads or the mount root is needed.
   This is a local administrative grant, not model/provider authentication. It
   has not been requested or exercised here.
2. **For selected-Sprite feasibility:** owner authorization for read-only in-guest
   inspection is needed first (exec may itself wake the Sprite). Separately obtain
   provider confirmation of a supported delegation/provisioning surface: stable
   ownership across wrapper restart, reconstruction on cold boot, feature support,
   and manager-only writes. An API token or guest root alone is not that contract.
3. **For live acceptance later:** authorize disposable synthetic processes and
   service stop/crash/wake tests in the selected Sprite, with bounded cleanup and
   no accounts/connectors/model. Provider service tests and privilege provisioning
   are external mutations requiring their own permission. Neither permission to
   inspect nor this document authorizes those tests.

If the platform supports only provider-owned services, request explicit answers
about recursive killing after leader exit/setsid, whether old descendants survive
automatic restart, what `stopped` confirms, how stop excludes concurrent start and
HTTP autostart, and how to identify the stopped service generation. Do not ask for
host-kernel access, an insecure remount, a security-policy bypass or unrestricted
privileged workload execution.

## Concrete ownership and admission protocol

Proposed layout **inside one selected Sprite**, not one VM per persona:

```text
Sprite runtime owns the named wrapper service
  provider-approved installation delegation D (no workload processes at D)
    owner/                  trusted installation manager + control/wake transport
    workload-G/             one generation, the sole execution domain
      native/               Codex app-server and all locally spawned native tools
      connector/            optional host-launched MCP/browser descendants
```

The manager survives killing `workload-G`; it never writes `D/cgroup.kill` or
kills the wrapper to achieve a workload drain. All personas share this installation.
Native child threads are not assumed to be OS processes or independently killable
cgroups. A generation-wide forced kill is an installation recovery action, **not
ordinary cancellation of one task**. Exact task cancellation uses existing
supported native IDs; failure remains unknown. An installation shutdown affects
every active task and requires its own authority, not an implicit escalation from
one owner's targeted cancel.

**Privilege contract:** only the trusted manager can create groups, move processes
or admit executable commands. Workload credentials cannot write the delegation
root, `owner/`, another generation, or outside ancestors; cannot use sudo or
equivalent capabilities; and cannot call the Sprite management socket/API to
launch independent services/execs. Giving manager and arbitrary workload code the
same writable delegation UID is insufficient: it could migrate into `owner/` and
evade the workload kill. Use an administrator-provisioned distinct workload UID
and a narrowly authorized launcher for placement/credential drop, or an equivalent
supported confinement mechanism that enforces these restrictions. Do not claim
the current same-UID runtime already has this isolation. This permission split is
part of the Sprite feasibility question, not a new kernel bypass.

The manager keeps the existing kernel lock on a stable private local state inode
for **owner serialization only**. Its directory/journal must be inaccessible for
workload mutation; existing runtime journal ownership assumptions need explicit
integration review before splitting credentials. The payload never receives
provider tokens or owner-management authority. A trusted Tasks bridge stays in
`owner/`; model tools do not receive the raw management socket. Host-mediated
effects still require the existing Worker identity/policy/lock checks. Unmediated
remote effects already in flight remain outside local containment.

Admission sequence (proposed states/records, not existing schema fields):

1. Acquire owner lock, close all launch/claim/connector admission, read durable
   service/containment intent, verify current Worker epoch/boot/lease and read-only
   containment prerequisites. A free lock never skips reconciliation.
2. Identify the delegated root from trusted provisioned metadata, not a model
   path or PID. Validate domain type, same mount/delegation identity, permissions,
   and manager placement. Enumerate **all owned workload generation directories**,
   not only the latest journal name. Reject foreign/ambiguous entries. Never
   overwrite/remove unresolved generation state on startup.
3. Persist and fsync `prepared` intent before any group creation or workload
   launch: installation ID, Worker epoch/boot, OS boot ID, unique generation,
   delegated root identity, relative workload name, closed-admission state.
   Create the unique workload group; retain its open directory identity/handle
   and persist identity before spawning. This makes an orphan created between
   awaits discoverable. Missing metadata means recovery, not a new clean launch.
4. Launch only a trusted, single-threaded pre-exec helper. It moves **itself** into
   the target group before running any workload code or spawning children; then
   drops workload credentials and reports placement over a private readiness
   channel before `exec` of the pinned binary. Parent-side migration of an already
   running Node/Codex process is forbidden. A supported atomic create-in-cgroup
   primitive can replace the helper later, but is not required for this design.
5. Serialize helper creation, placement authorization and stop under the manager.
   Keep not-yet-placed helpers separately owned/reaped. Stop cancels their permits
   and awaits their termination before testing workload emptiness; no helper can
   join after the empty observation. No native readiness, task claim or connector
   grant may precede confirmed placement, fsynced identity and live authority.
   A helper begins blocked on a private owner channel, with a finite deadline;
   it cannot migrate/exec on EOF or timeout. Record its exact identity before
   granting placement. After owner crash, replacement must reconcile any outstanding
   helper permit before accepting emptiness, including a permit delivered just
   before the crash. Channel loss alone is not proof the helper has exited.
6. Persist `running` only after all confirmations. Manager-only launch authority
   maintains the no-new-arrival invariant. Fork, exec, dropped fds, double-fork,
   setsid and native child reparenting do not change cgroup membership.

Group names are never reused within an OS boot; path text alone is not identity.
Use boot identity, generation and held kernel-object identity together. On reopen,
validate against trusted on-disk metadata and the delegated subtree; path absence,
replacement, changed delegation or metadata corruption is not proof of termination.
On a verified cold reboot old live processes cannot survive, but journal/effect
reconciliation still precedes fresh grants. Restored checkpoint files must not
resurrect old Worker authority or mark outstanding effects successful.

## Drain and restart states preserve uncertainty

| State / event | Required action and durable outcome | Admission / sleep consequence |
| --- | --- | --- |
| `unavailable` prerequisites | Record missing/denied delegation or unsupported type/kill/events without launching. | Block execution, including connector startup. |
| `prepared` / placement reply lost | Keep original intent; stop and reconcile the possible helper/workload. Never retry launch from absence of reply. | No replacement generation or native submit. |
| `running` / normal task cancellation | Send only exact supported native cancellation, retain operation/effect identity. | Unrelated tasks continue; no installation kill for target cancellation. |
| `draining` | Durably close all claims, tool/connector admissions and launcher permits first. Preserve lease fencing and Tasks hold; ask native/SDKs for graceful shutdown within a fixed deadline. | Root completion, SDK destroy and empty operation snapshots alone cannot authorize sleep. |
| `kill_requested` | After authorized installation drain grace, persist stop intent, write `1` to that generation's `cgroup.kill`, then observe events under the same identity. | A successful write or direct child exit is not `process_empty`. |
| Kill write error/timeout or still `populated 1` | Keep `termination_unknown`; bounded observation ends in recovery. Uninterruptible kernel waits can delay death even after SIGKILL. | No replay, takeover, release or clean sleep receipt. |
| `process_empty` | Only with admission sealed, no joining helpers, same owned group identity, recursive `populated 0` and owned direct children reaped. Persist evidence. | Local live processes are gone; effects, fsync, remote node calls and outputs remain separate obligations. |
| `reconciliation_required` | Preserve outstanding attempts, resource locks, questions and unknown effects; resolve through supported receipts/owner workflow. | Empty local cgroup does not clear unknown native/effect records or authorize retry. |
| `settled` | All independently required process/native/tool/effect/persistence checks pass under current lifecycle identity; persist checkpoint and use existing prepare/commit protocol. | Only then request normal hold release; lost commit/release replies remain unknown. |
| Owner crash / auto-restart | New wrapper acquires owner lock, starts closed, inspects every old generation and journal, and recovers. Old processes may still live; wrapper existence is not authority. | Never call plain create-service/combined restart as permission to replace execution. |
| Lease/hold loss or warm wake | Fence new work immediately; recheck current authority before any async continuation. Manager drains only under a preauthorized installation shutdown policy. | Expired hold can permit suspension with live processes; no indefinite hold or termination claim. |
| Verified cold boot | Reconstruct delegation through supported provisioning; correlate new OS incarnation with old intent and external Worker state. | No automatic replay, connector pairing, question answer or resource-lock release. |

The manager may repeat a recursive kill only against the **same validated,
sealed, unreused generation** after recording intent. That operation cannot
resubmit native work or repeat an external effect. A name-only provider stop
request after an unknown response is not equivalent: a new service generation may
now occupy that name. Observe/reconcile first and retain uncertainty where the
provider does not supply adequate generation fencing.

The manager's death can leave workload processes running until a replacement
manager recovers; this design guarantees fenced takeover, not instantaneous
death-on-owner-loss. Old grants must remain fenced at Worker ingress, and already
dispatched external outcomes remain unknown. If a stricter fail-stop deadline is
required despite manager/provider unavailability, neither current option proves
it; that requires an independently enforced provider watchdog contract.

## Smallest next credential-free unit

**Next local deliverable: one disposable `tests/runtime-descendant-containment.mjs`
harness with a test-only placement/stop controller, not production assembly.**
It should accept an explicitly supplied, already delegated disposable domain;
it must never create a systemd service, search for writable host cgroups, invoke
sudo, remount, install a dependency, or contact a Sprite/model/account. Keep its
journal and synthetic workload under a private temporary directory. Reuse the
existing lock fixture's exact-process readiness, bounded watchdog and cleanup
patterns; do not copy upstream implementation code.

This unit can be written without credentials. In the present orb only its
prerequisite-denial/parser/order tests can run; report real containment as
**unavailable**, not passing or silently skipped acceptance. Actual kernel cases
need the scoped local delegation grant described above. This is a platform
permission prerequisite, not a reason to start account setup or claim all
remaining engineering is blocked on authentication.

Required discriminating cases, in this order:

1. Feed missing kill/events, threaded type, wrong owner/root, denied writes and
   foreign generation identity: launch count remains zero, durable uncertainty
   is not removed. Inject stop at every intent/placement/readiness await: no
   subsequent workload exec or readiness publication. Use fake filesystem data
   for these tests and label them contract tests, not kernel evidence.
2. In an explicitly delegated kernel domain, start a synthetic Node parent via
   the self-placement helper, then a default-spawn child and a nested child that
   uses setsid. They exchange private-file nonce replies, not credentials. Verify
   all reported memberships are within the same workload domain before proceeding.
3. Exit the parent; independently verify live descendants and a free flock.
   `populated` must still be 1 and the harness must refuse replacement. This input
   distinguishes real containment evidence from a direct-child-exit implementation.
4. Seal admissions, issue recursive kill, await `populated 0`, reap direct children
   and verify synthetic descendants no longer answer. A separately owned sibling
   outside the killed workload must still answer a fresh nonce. Bound forks/counts
   and total duration; no fork bomb. Kernel emptiness is primary evidence; PID
   start-time/pidfd observations support fixture diagnosis, not the production proof.
5. Reopen the controller/journal after crash at prepared, launch-unknown and
   kill-unknown boundaries. Preserve generation identity, discover old owned groups,
   refuse new execution while populated/ambiguous, and retain a synthetic unknown
   effect and its lock **after** successful process empty. Inject the never-empty
   path rather than trying to manufacture an unkillable real process.

Use synthetic independent deadlines (for example 5s observation, 20s child
self-exit, 30s case ceiling), with exact owned cleanup and failure diagnostics.
Fail if containment cleanup cannot be confirmed; no global process-name kills.
Record kernel, domain permissions, placement evidence, parent-exit/free-lock/live-
child observation, kill result, empty event, sibling liveness and unresolved-effect
state. This harness is a bounded next unit; it does not wire a runtime launcher,
claim a security audit, or prove the full manager/payload privilege split unless
that split is actually provisioned and separately exercised.

After that unit passes, integrate the smallest supported launcher/containment
receipt at the `createCodexService` caller and future host connector launch owner.
Keep direct transport/SDK shutdown observations separate. Add service tests that
refuse settlement from `nativeStopped` alone. Only later test the same boundary
through real Sprite service crash/stop/warm/cold lifecycle under explicit approval.
Do not start with a generic cross-provider abstraction or enable production gates.

## Why weaker primitives cannot close the gate

**Process groups:** membership can change through setsid/setpgid; parent exit and
double-fork break ancestry inventory. A negative-PGID signal reaches the current
group, not all historical descendants or separately hosted browsers. Process-group
kill can assist graceful teardown but has no recursive-empty contract.

**Flock:** belongs to open file descriptions, not descendant ancestry. Default
Node spawning already demonstrates live descendants without the lock; even
explicit inheritance cannot prevent a later exec/close/unlock from dropping it.
Use it for cooperating owner serialization with durable recovery, never settlement.

**PID polling:** a PID identifies one current process, can be reused, and says
nothing about an orphan no longer in the observed ancestry. Enumerating `/proc`
while processes fork/reparent has no atomic closure point. Start times/pidfds
improve individual identity, not recursive membership. Zombie observation is not
a live process, while absence of one PID is not absence of its descendants.

**Closed transports/destroy:** are local protocol/library observations. They do
not inventory OS descendants, make remote effects reversible, flush a browser
profile, or prohibit future service autostart. None can substitute for sealed
admission plus an authoritative containment-empty observation and independent
durable task/effect reconciliation.

## Delivery and verification limits

This work added only this design document. Baseline bundle digest and exact commit
were checked; cited owning modules and source pages were read; local permissions
were inspected without mutation. No kernel containment harness, application test
suite, selected-Sprite call or service lifecycle test was run for this document.
Historical fixture results above are attributed to their existing evidence files,
not presented as rerun results. Plain patch delivery is
`.local/descendant-containment-design.patch`; no shared status files are changed.
