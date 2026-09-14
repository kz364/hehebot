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
syncs observed ancestry and delivers only requested subtree cancellations. Default
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
