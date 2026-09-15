# Codex/Sprite service composition

`runtime/codex-service.mjs` assembles the existing runtime components behind an
explicit **disposable-test-only** boundary. It is not production admission.
`runtime/sprites-service-entry.mjs` remains the production transport preflight:
it cannot claim work or invoke a model. Execution/native verification flags stay
false. No account connection, deployment or live Sprite task is part of these tests.

## Run locally

After the normal `bash scripts/verify-codex.sh` prerequisites:

```sh
node --test tests/runtime-file-journal.mjs tests/runtime-codex-service.mjs
bash scripts/test-codex-service.sh
bash scripts/test-codex-service.sh --child
bash scripts/test-codex-service.sh --child-effects
bash scripts/test-codex-service.sh --crash
bash scripts/test-codex-service.sh --submission-ack
bash scripts/test-codex-service.sh --operation-pages
```

The second command builds `src/providers/sprites.ts` into the ignored
`.local/codex-service/sprites.mjs`, then runs the native fixture under the existing
kernel executor-lock launcher. The build uses esbuild from the locked Wrangler
dependency tree. It does not import private package internals or reimplement
`SpritesTasksClient`. Keep this build step when packaging the runtime; a missing
artifact is a build failure, not permission to use a mock client.

The native fixture uses pristine Codex 0.154.0, two scripted loopback responses,
one actual scoped MCP query, and certificate-validated HTTPS Worker/SQLite. It
decodes the query receipt, verifies native event accounting and a Worker heartbeat,
and proves root-only completion is rejected. The real Sprite Tasks client and Unix
socket transport are composed, but `http.request` is synthetic: PUT/GET checks
**do not prove a live Sprite hold**. Successful cleanup removes fixture homes,
SQLite and certificates. Failures retain private diagnostics for inspection.

The `--submission-ack` mode drops the first registration reply after the real
HTTPS Worker has acknowledged it. The supervisor retries exactly that persisted
`submitted` receipt once under its existing live lease. The fixture checks two
identical registration requests, one native launch, and the normal two model
requests. No claim or native turn is replayed. SQLite tests separately cover loss
before registration, cancellation/terminal replay without writes, conflicting
native identity and expired authority. A second failure, disconnect, or local
lease expiry fences admission and retains the hold; this is not crash recovery
or permission to retry unknown native submission or effects.

The `--operation-pages` mode runs 101 actual native read-only MCP calls and checks
every returned routine receipt. The resulting 103 unique operations (including
root inference and unknown coverage) reach HTTPS Worker heartbeats in pages of
100 and 3. Two scripted model requests suffice; no connector or paid model runs.
The host bounds each complete snapshot at 4096 records and retains settled history
as well as active/unknown obligations. It sends every page on each maintenance,
not a rotating subset. The Worker request limit remains 100. Cancellation IDs
from all successful replies are combined. All pages must finish within the prior
local lease before renewal becomes usable; loss, invalid replies, disconnect or
expiry fences admission without releasing the provider hold or replaying native
work. Pages are separate transactions, not an atomic inventory replacement.
This raises the supported retained-history bound, not unlimited task duration or
complete operation coverage. Missing coverage still blocks settlement and sleep.

Heartbeat invocation statuses follow the adapter's per-kind terminal enums.
For example, a declined file change can be settled, but a declined MCP call is
unknown; an interrupted collaboration call can be settled, but an interrupted
spawn is unknown. Search/wait/compaction/image records accept only observed
completion as terminal. Unexpected statuses remain explicit unknown operations
for both root and child records, preserving stable operation IDs and original
progress timestamps without rewriting the journal. This does not validate all
journal structure or remove the separate unknown-coverage blocker.

The `--child` mode uses four scripted requests. The native root spawns a child,
finishes, and the child uses its inherited root MCP grant to retrieve the exact
paused routine from Worker/SQLite. Its next model HTTP response is deliberately
held open. The actual service child facade persists the native-to-Worker mapping;
an owner `run.cancel` command then travels through Worker heartbeat and supervisor
maintenance to exactly one child `turn/interrupt`, even across repeated maintenance.
The fixture separately observes the exact interrupted turn and HTTP connection
closure. Five root-owned heartbeat operations retain one unknown coverage record.
Worker completion returns HTTP 409 `CANCEL_UNCONFIRMED`; the root remains running,
the child remains cancelling, and supervisor completion/sleep are denied. This is
not recursive settlement, model judgment, active-work crash recovery, per-child
effect authentication, or a live Sprite hold test. No service runtime is replaced
with a stub; only Sprite requests and model decisions are synthetic.

The `--child-effects` mode keeps the same four-request native child/cancellation
sequence, but starts an owner-adopted synthetic routine with a pinned action
policy. The trusted fixture host uses the service's exact persisted child mapping
and real certificate-validated HTTPS `ControlClient` to exercise
[root/descendant effect bookkeeping](ROOT_CHILD_EFFECTS.md). Registration alone
cannot admit intent; the service's child controller now sends `started: true`
with its exact observed receipt. The Worker atomically registers and acknowledges
that start. No fixture-owned child `submitted` call is used. Replaying the exact
receipt returns the original running child; a changed session identity conflicts.
No effect tool or new grant is exposed to the model.

The fixture checks original-ID replay with reordered resources, changed-resource
conflict, root-as-child rejection and child-owned locks. A root lock acquisition
that encounters a held child resource rolls back its preceding free-resource
acquisition. Synthetic dispatch/unknown/confirmation records reconcile during
owner cancellation; they are **not observations of an actual connector action**.
Replay preserves the recorded status, confirmation retains the locks, and direct
child completion fails with `RESOURCE_BUSY`. Root completion and sleep still fail
with unknown operation coverage. `connectorDispatches: 0` means no connector ran,
not proof of a live connector's exactly-once dispatch protocol. Native identity,
the one exact interrupt, and child HTTP closure remain independently asserted.

The Linux `--crash` mode holds the root's second scripted response after a verified
MCP read. It identifies the npm launcher's exact native child through `/proc` and
kills that binary with SIGKILL during the active turn. It observes process exit,
HTTP closure and automatic service fencing, but no terminal root event. The
journal remains unresolved; Worker remains running; maintenance, dispatch and
sleep reject. After shutdown, reconstructing the service refuses the existing
marker without launching another native process, replaying inference or releasing
the hold. This proves active-crash **fencing and refusal**, not successful recovery,
reconciliation of external effects, detached-process containment or safe resume.

## Composition contract

`createSpriteCodexService(config, dependencies)` composes the real Tasks client,
socket transport and activity guard with `createCodexService`. Configuration has:

- `stateDirectory`: existing owner-only absolute directory on persistent disk;
- `binary`: absolute pinned Codex executable;
- `portalOrigin`, `runtimeTokenFile`, optional `tlsCAFile`: HTTPS control origin,
  private runtime bearer file and fixture CA;
- optional paired `accessClientIdFile`, `accessClientSecretFile`: absolute,
  owner-owned regular files with no group/other permission bits, each 1–16384
  bytes. Symlinks are rejected. Trimmed contents must be nonempty and contain
  no embedded CR, LF or NUL. Both references must be supplied or both omitted;
- `installationId`, `personas`: host-owned persona mappings containing `agentId`,
  `model`, and an explicit `allowedTools` subset;
- `disposableTest: true`: explicit opt-in for test composition only. Omission or
  false rejects before disk, control, provider or native activity.

Callers own the kernel lock for the entire process lifetime; use
`scripts/with-executor-lock.sh`. Use canonical directory paths, never symlink
aliases. The FileJournal queue now serializes reconstructed instances of the same
normalized directory **within one process**; it does not replace the OS lock.

Startup requires Worker `BOOTING` with execution enabled in disposable state. It
persists boot intent before registration, obtains a confirmed activity hold, checks
the native version, and creates a fresh private native home/workspace. One app-server
transport and event router serve the supervisor. The supervisor persists each claim
before the service writes that root's fsynced immutable MCP grant and submits the
root with supported `thread/start.config.mcp_servers`. There is no global MCP grant
in the native home. Grant selection is host-owned; the Worker still validates the
admitted attempt and policies. Configuration/files in one same-UID process are not
a filesystem security boundary. Do not rewrite grant files during an attempt.

Access values are loaded only by the host service and MCP CLI into the existing
fixed-origin `ControlClient`. Both Access headers accompany the runtime bearer;
redirects are rejected. Only file references enter the immutable root grant,
never credential values, model arguments or native subprocess environment values.
Raw `accessClientId`/`accessClientSecret` configuration fields are rejected.
Keep referenced files stable for an admitted attempt; separate processes read them
at startup, so file references do not provide atomic credential rotation.
CLI failures are sanitized. Loopback HTTPS tests prove header propagation and
redirect rejection with synthetic values, not real Cloudflare Access admission.

The child hook selects `CodexTaskControl` from the current durable bridge attempt,
syncs observed ancestry, acknowledges starts and delivers only requested subtree
cancellations. The optional boolean `native-child.started` defaults to false for
metadata-only callers. A true observation advances only a claimed child, under
its exact original attempt/epoch/boot/native reference; cancellation, recovery,
waiting and terminal states are never resurrected. Registration and acknowledgement
share one SQLite transaction. A lost response can replay only the same persisted
receipt, including when cancellation arrives before readback. Legacy journal
mappings without a start marker reconcile that exact receipt once; known run IDs
are retained and cannot be rebound. This does not replay native inference, settle
operations or authorize service restart. Default
heartbeat operations use `CodexOperations` with original claim bounds and an
always-unknown coverage obligation. Before a claim, the projection is empty.
Unit tests inject synthetic native/control responses; the native service fixture
exercises child cancellation through this composition in `--child` mode.

## Recovery and shutdown are conservative

Startup refuses any previous service marker before another boot or native launch.
No automatic restart/replay or state deletion is provided. A lost boot/claim/native
response requires explicit reconciliation, not another executor. Disconnect, lease
loss or uncertain activity holds fence the supervisor. Shutdown during startup
cannot subsequently launch a native process or acknowledge readiness.

`stop()` stops the app-server, confirms its process exit, retains journal/grants and
marks recovery. It does **not** prove descendants or external effects stopped, publish
a result, release an activity hold, or commit sleep. Holds retain their bounded TTL;
there is no claim of indefinite protection after process termination. Root-only
completion remains `NATIVE_SETTLEMENT_INCOMPLETE`, and sleep remains denied.

Remaining production work includes verified operation/effect coverage, recovery
and service resume policy, live Sprite hold/lock behavior, supported account auth,
and live production Access configuration/acceptance. These are not solved by
setting `disposableTest`, injecting a mock operation list or disabling
the production preflight gate.
