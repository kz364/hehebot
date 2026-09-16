# Codex/Sprite service composition

`runtime/codex-service.mjs` assembles the existing runtime components behind an
explicit **disposable-test-only** boundary. It is not production admission.
`runtime/sprites-service-entry.mjs` remains the production transport preflight:
it cannot claim work or invoke a model. Execution/native verification flags stay
false. No account connection, deployment or live Sprite task is part of these tests.

## Restricted owner-alpha preparation

Optional `restrictedPermissions: true` still requires `disposableTest: true`;
it does not authorize a live session. It selects a generated named profile with
`:minimal = read`, the exact fresh workspace readable, and network disabled.
Journal, Codex home, runtime token and configured Access credential paths are
explicitly denied to model filesystem tools, including credentials outside the
state directory. Trusted host/MCP processes still read their required files.
Only `hehebot_list_routines` and `hehebot_read_skill` may appear in persona grants.
The same subset is enforced with native MCP `enabled_tools`; startup rejects any
preconfigured MCP server before admission. Supported command-line config overrides
disable web search, hosted apps, plugins, suggestions, image generation, standalone
search, token-budget/history-notes selection and permission-escalation features.
These overrides take precedence over preparation-hook configuration, participate
in the profile identity, and must match native readback. Network sandbox settings
alone do not disable provider-side tools. No dynamic tools are supplied.
The trusted preparation hook may supply provider configuration; its contents
remain private. The profile identity includes that configuration's digest input,
and the journal stores only the name and final config SHA256. Startup checks
supported `config/read` before readiness; each submission rechecks file identity.
Unexpected filesystem entries, inheritance, network enablement or file drift
fence admission. Pinned readback includes null `glob_scan_max_depth` metadata;
that is accepted, not interpreted as an additional readable path.

`bash scripts/test-codex-service.sh --restricted-background` passes the actual
portal/Worker/native six-request scripted sequence with this profile selected:
status while A is held, a fresh status thread/grant, provisional reload without
inference, and exact independent-B then old-A cancellation. Three unresolved
families retain unknown coverage; no final result or sleep is granted. The first
host run refused before inference because the validator rejected Codex's null
metadata; `.local/restricted-background-first.log` preserves that failure and
`.local/restricted-background-second.log` records the corrected positive run.

This service profile deliberately does not grant access to the non-system native
executable. Shell execution under `:minimal` alone is unavailable in this orb;
that failure is not filesystem-denial evidence. Separate native permissions
fixtures evaluate an exact executable-path read allowance. The scripted service
uses chat and trusted read-only MCP, not shell commands. App-server and local MCP
are trusted host processes, not sandboxed by this profile. The completed
[pinned-source review](ALPHA_NATIVE_CAPABILITY_BOUNDARY.md) found no concrete
arbitrary host-file bypass in the inspected built-ins: image/patch reads use
sandboxed helpers, which supply their own exact runtime-executable access.
This is source support, not an executed built-in denial test or general security
proof. Code-mode false flags are not an absolute off switch when model metadata
selects code mode; nested tool dispatch still retains authority. No extra shell
allowance, root-only requirement, safe-tree-termination or text-only claim follows.
The provider-restricted six-request rerun passed in
`.local/restricted-background-final.log`; the service remains disposable-only.

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
every returned routine receipt. Its 104 base operations (including root inference,
initial-response phase and unknown coverage), plus observed quiet phases, reach
HTTPS Worker heartbeats in complete pages of at most 100. Parallel completions
need not create one quiet phase per call; the fixture checks exact page coverage
against retained observations. Two scripted model requests suffice; no connector or paid model runs.
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

Live command, MCP, file-change, dynamic-tool, search, wait, compaction, image and
collaboration (including spawn) starts now retain the trusted host's notification receipt
time, before event buffering. Per-owner/per-kind/per-item clocks are written with
the observed status. Native payload timestamps are ignored. Duplicate starts and
terminal replays do not advance progress; history-only reconciliation cannot
invent a start time. A backwards live transition clock fences reconciliation.
These tool deadlines are two minutes from the first observed start, capped by the
admitted task's hard deadline. Reopening a journal or sending another heartbeat
does not extend them. Worker tests cover the exact timeout boundary for a tool
starting ten minutes into a task; native service fixtures check the MCP deadlines.

Worker heartbeat admission canonicalizes operation timestamps to UTC milliseconds
before persistence, so valid timezone offsets cannot distort lexical watchdog or
monitoring comparisons. Replays must retain the same run, attempt, kind, start and
deadline instants, and progress cannot move backwards. Equivalent offset spellings
are accepted; retained offset rows are canonicalized on an authorized equivalent
replay, not by a bulk migration. Nonrepresentable dates (including leap seconds
and UTC years outside four digits) fail with `INVALID_INPUT`. A bad record rolls
back the entire heartbeat page, including earlier records and lease renewal.
SQLite and authenticated in-process Worker HTTP tests cover offset boundaries,
custody conflicts and unchanged child effects/locks. This does not extend deadlines
or repair retained rows that receive no heartbeat.

Spawn invocation completion does not stop its child clock or settle child work;
the child retains its independent turn and tool observations.
Legacy/history-only observations without clocks retain their existing hard-deadline
fallback. Coverage and root/child inference records also retain that bound.
Live `reasoning` item boundaries now retain separate root/child inference
operations with five-minute deadlines capped by the task hard deadline. Only
identity, boundary status and trusted host clocks enter the application journal;
reasoning summaries, content and deltas are excluded. Duplicate starts do not
reset clocks. Item completion is not root/child/tool/effect settlement, and root
completion cannot erase an unfinished reasoning item. The offline recovery
inspector includes these obligations and rejects invalid status values.

Native `thread/tokenUsage/updated` notifications now retain a `tokenUsage`
snapshot under the exact admitted root or observed child turn. The router strips
unrecognized fields before buffering. Both `total` and `last` retain input,
cached input, cache-write input, output, reasoning-output and total counters;
all must be nonnegative safe integers. The pinned schema defaults absent
`cacheWriteInputTokens` to zero and an absent model context window to null.
Missing usage itself remains unknown, not zero. Identical snapshots do not write.
New snapshots replace old ones, including decreases; they are never summed.
Usage notifications do not end initial inference, update phase clocks, extend
deadlines, settle work or grant sleep. Root/child values remain separate.

These are latest received native observations, not measured billing, quota,
lifetime consumption or a complete per-task model-cost ledger. Native history
replay has no freshness sequence in this payload; retention does not claim to
distinguish replay from a live sample. The pinned
[notification contract](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server-protocol/schema/typescript/v2/ThreadTokenUsageUpdatedNotification.ts),
[usage shape](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server-protocol/schema/typescript/v2/ThreadTokenUsage.ts)
and [replay implementation](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server/src/request_processors/token_usage_replay.rs)
are the supported source boundary. Worker/UI usage publication and matched-workload
overhead measurement remain E11; no account or paid fallback is introduced.

`bash scripts/test-codex-service.sh --reasoning` exercises actual pinned Codex
reasoning boundaries through the service and an accepted HTTPS Worker heartbeat,
with two scripted model requests and a read-only MCP receipt. Router/journal tests
cover root/child isolation, buffering, replay and retained unfinished reasoning;
projection tests cover five-minute versus two-minute bounds and hard-deadline caps.
This does not measure authenticated model behavior or erase native-owned reasoning
history. New acknowledged submissions also persist an `initialInference` phase:
five minutes from the original Worker claim, capped by the task deadline. Native
`turn/start` acknowledgment and `turn/started` do not end it. The first validated
root item handled by the adapter (including completed visible messages), or exact
root terminal observation/readback, ends it atomically with the observation.
Child events and unrelated turn IDs cannot end the root's initial phase. Reopen,
duplicate submission and repeated heartbeats never restart or extend this clock.
Legacy rows without the marker are not backfilled; the diagnostic reports the
marker only when present. Initial-phase completion is not task settlement.
The native fixtures inspect the active phase before returning their first model
response and its completion after native work. Each newly observed child
`turn/started` with a host receipt timestamp also persists its own initial phase
and immutable `initialInferenceAt`. It ends only on that child's validated item
or terminal observation/readback, not parent completion. Its independent five-minute
deadline is capped by the admitted task deadline. Duplicate starts cannot reset
it; missing legacy timestamps are never reconstructed. The native child fixture
observes this phase while withholding the child's first model response, after
the parent has completed. Terminal spawn observations with retained host clocks
also project a two-minute startup operation per acknowledged receiver, capped
by the task deadline. Its identity includes the spawning owner, spawn item and
receiver. The clock uses the spawn's last recorded progress instant, never a
heartbeat/read time; history-only completion conservatively retains the earlier
live clock rather than inventing completion time. Any exact valid turn observation
for that receiver ends startup, including terminal readback or a turn observed
before spawn completion. Parent completion and other children do not end it.
Nested spawns use the same rule. Failed/interrupted spawns retaining receivers
do not erase their startup obligations. Legacy spawns without clocks receive no
invented phase. The spawn invocation remains independently accounted for.
SQLite watchdog tests distinguish the instant before and at startup expiry;
native child fixtures check the retained startup timestamp and settled phase.
These bounds do not establish token-progress liveness.
Remaining quiet periods, explicit longer transfer/shell allowances and
progress-based phase extensions remain separate work; this is not full S19 or
proof of the native operation's true start before its host notification arrived.
Timeout still requests cancellation, not settlement or automatic replay.

Quiet-phase journaling supplies additional bounded inference operations.
When a new live tool/reasoning/spawn or assistant-message completion leaves no observed item active
in its exact owner, the adapter records a `quietPhases` entry keyed by category
and item ID with immutable `startedAt` and `inProgress`/`completed` state. A new
live item boundary or exact turn termination closes the prior phase. Duplicate
items and history-only tool/message reads neither create nor advance phases; terminal
turn readback can close them. Token-usage snapshots are not progress. Parallel
items do not create quiet time until the last one terminates; equal timestamps
use journal observation order rather than lexical sorting. Root termination
does not close child phases. Completed phase IDs never reopen.

The bounded, content-free shape allows at most one active phase and 4096 retained
phases per owner; malformed/orphan records fail rather than being repaired.
Offline inspection includes their original identities/timestamps without writing
state. Heartbeats project each phase with an independent identity and a deadline
five minutes after its original host observation, capped by the task hard deadline.
Reopening or rereading the journal never advances progress. SQLite tests verify
cancellation exactly at expiry, not one millisecond before; native fixtures inspect
the active bound while holding the next model response. Human-wait interactions
and complete streaming/unknown-item coverage remain E01. No sleep/production
gate is relaxed; timeout does not prove native termination or permit replay.

Unsupported `item/started` or `item/completed` variants, including unknown
collaboration tools and missing item types, now fence the event router through
the existing redacted recovery callback before buffering any payload. They are
not silently ignored or assigned fabricated completion/deadline semantics.
User-message echoes remain non-execution input and are ignored. This deliberately
refuses unsupported paths (including schema-advertised variants without a host
projection); it does not implement their operation coverage. Recovery retains
uncertainty and does not prove native termination or permit sleep/replay.

The pinned 0.154.0 schema's experimental `plan` item (`id`, `text`, `type`)
now has a content-free host projection. Only its ID and start/completion boundary
are retained under `planItems`; text and deltas are discarded, and native-supplied
status fields do not determine lifetime. Its clock uses the five-minute inference
bound capped by the task deadline, with separate root/child/category identity.
Replay cannot refresh it, root completion cannot erase it, and exact item completion
ends only that item's lifetime. Post-plan quiet phases and offline inspection use
the same existing contracts. This does not enable experimental API/Plan mode,
render plans, execute their text or authorize effects. The disposable `--plan`
fixture explicitly requests experimental API and Plan mode at its transport
boundary only. Two scripted loopback responses drive pristine 0.154.0 through a
real MCP receipt and a `<proposed_plan>` response. Native plan start/completion,
five-minute clocks in Worker heartbeats, content exclusion from the host journal
and preview, and offline clock preservation are verified. The native preview
retains the newline preceding the plan; the fixture checks it exactly. This closes
root Plan-item service emission evidence, not child Plan-mode emission, a held
stream's expiry, authenticated model judgment or complete operation coverage.
The fixture also withholds the closing tag and response completion until native
plan start is journaled. While that stream is open, it verifies an active
five-minute clock tied to the exact plan item, an unsettled root and no retained
plan text. A second text chunk must produce an actual `item/plan/delta` with
matching thread/turn/item identity; the host journal and operation clock remain
unchanged. A successful Worker heartbeat must contain that same active clock.
The fixture then releases
the closing tag and verifies ordinary completion. This short controlled hold
tests active accounting, not watchdog expiry or forced native termination.

Completed message phases use `outputItems` and the exact message ID, not message
text or a new content copy. A live message during an observed active tool opens
no quiet phase. A message after exact turn termination cannot reopen one. Root
termination leaves child message phases intact. Native fixtures observe these
records; focused tests verify their original five-minute projection and replay
isolation.

Live `agentMessage` starts now retain a bounded `messageStarts` ID-only marker and
open the same five-minute phase when no observed tool remains active. The router
discards start text and all message deltas; neither deltas nor duplicate starts
refresh a clock. A start replayed after completion is a no-op. History-only starts
never backfill timestamps, and malformed marker maps fail admission reads. The
next live item boundary or exact turn termination closes the phase; completion
can then open its separate post-message phase. Independently, each live message
start now records an operation clock under `messageStarts` and the exact item ID.
That five-minute, task-capped stream lifetime survives overlapping tool activity
and root/child turn termination; only the matching output-item completion ends it.
Its live completion updates last progress without changing the original deadline.
History-only/legacy markers do not acquire invented clocks and retain the task
hard deadline. Offline inspection preserves these independent obligations.
This closes the observed message/tool overlap gap, not progress-based extensions,
unobserved stream coverage or verified cancellation. Native coverage remains unknown.

Quiet-window activity diagnostics retain an optional immutable `endedAt` when
the first closing boundary has a live host timestamp. The offline inspector
exports that timestamp and `durationMs` alongside the existing owner, preceding
item/category and start. Historical closure without a timestamp and old journal
rows remain unmeasured; later replay never invents an end. New live boundaries
cannot predate any recorded end for the same owner; a regressed clock refuses
the observation without writing the operation or changing its deadlines. Equal
timestamps remain valid. Legacy records constrain only their known start.
These additions contain
no prompts, answers or tool payloads, create no timer/polling/provider calls and
do not change heartbeat progress or deadlines. Inspect only under the existing
stopped-executor/kernel-lock procedure. They measure observed native-event silence,
not CPU idleness, billing or safe-to-sleep time. Use representative real workload
durations before proposing a shorter timeout; the five-minute value is a maximum
silence bound, not a mandatory delay. No live VM rollout is implied.

The `--child` mode uses four scripted requests. The native root spawns a child,
finishes, and the child uses its inherited root MCP grant to retrieve the exact
paused routine from Worker/SQLite. Its next model HTTP response is deliberately
held open. The actual service child facade persists the native-to-Worker mapping;
an owner `run.cancel` command then travels through Worker heartbeat and supervisor
maintenance to exactly one child `turn/interrupt`, even across repeated maintenance.
The fixture separately observes the exact interrupted turn and HTTP connection
closure. Eight base root-owned heartbeat operations, including the settled child startup
phase, plus observed quiet phases retain one unknown coverage record.
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

The supervisor also fences every asynchronous drain boundary: prepare response,
checkpoint write, commit response, committed-journal write and activity release.
Each continuation requires the same draining phase and an unexpired original
lease; equality at expiry is closed. A disconnect or expiry cannot be overwritten
by a late successful return setting `sleeping`. Once fenced, no later commit or
release is initiated and the same supervisor cannot retry the drain. An already
started release may still complete externally; the host reports recovery rather
than claiming the hold was retained or replaying it. A commit whose continuation
was fenced leaves `commit_unknown` when the local committed marker was not written.
Real SQLite/supervisor tests cover disconnect and exact expiry at four return
boundaries, plus success one millisecond before expiry. These are local await-race
tests, not live provider stop or hardware power-cut proof.

Before its first journal await, the queued drain operation snapshots the supplied
checkpoint into its JSON wire representation and requires a nonempty object.
Serialization failure or an empty/non-object representation rejects before
prepare without changing supervisor readiness. Subsequent caller mutation cannot
change the intent or the checkpoint committed to the controller. After prepare,
`putIfAbsent` must confirm insertion of a new drain intent; any returned prior
intent causes `DRAIN_REPLAY_FORBIDDEN`, recovery and no commit/release. Both unknown
and committed prior intents are preserved, never silently reused or repaired.
The controller may already have prepared a new stop token at this point; refusal
does not claim that preparation was rolled back or authorize retry.

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
