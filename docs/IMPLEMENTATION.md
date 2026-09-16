# Implementation status

Hehebot is a locally tested foundation, not an operational assistant. Direct Codex app-server **0.154.0** is the only supported harness. No cloud deployment or authenticated inference has been completed; production execution and native-verification flags remain false.

**Progress checklist:** [TODO.md](../TODO.md) is the maintained owner-facing view of completed local deliverables, remaining work, next priority and account/device blockers. This document retains detailed evidence; the specifications retain acceptance requirements.

Native client/child-stream integration (2026-09-16; verified locally):
the reviewed `macos/` delivery is independent SwiftUI/WKWebView source targeting
macOS 14+, not a built Mac release. Five Node checks (one executable script test,
four structural checks), shell syntax and plist parsing pass. Main installed the
signature-verified official Swift 6.3.3 Debian compiler and ran four real Foundation
XCTest methods successfully. Optional checksum-pinned setup is committed under
`macos/scripts/` and opt-in through `.agents/setup`; no Apple SDK or renderer is
available. Native app compilation, permission enforcement, cookies/login, rendering,
signing/notarization, updates, notifications and energy remain unverified/unimplemented.

Actual `--plan-child` was rerun successfully: the default spawned child does not
inherit root Plan mode. Literal plan tags are child message deltas, not Plan events.
Exact child cancellation closes HTTP but leaves an active message and unknown
coverage, so completion and sleep stay denied. See [evidence](CODEX_CHILD_PLAN_EVIDENCE.md).
This mode and Mac source checks now join the combined verifier; no child Plan
acceptance or successful native recovery is inferred.
The integrated verifier passed 1,154 control / 262 runtime tests, eight auditor
tests, five Mac source/script checks, all HTTP/native/service modes and build dry
run. Four Swift XCTest methods passed separately; desktop 16 tests passed.
Logs: `.local/native-client-integration-combined.log`, `.local/macos-swift-policy-final.log`,
`.local/native-client-desktop.log`. Native UI was not rendered: Apple frameworks
are unavailable.

Routine-delete compatibility follow-through (2026-09-16): the portal now uses its
existing accessible editor instead of `window.confirm`, which the native shell
denies. It shows the exact routine ID/revision and requires acknowledgement that
active tasks continue. Submission rechecks current selection, owner, revision and
observed connection; reconnect does not replay. An explicit retry in the same
editor preserves the command key. Server authorization remains authoritative for
races beyond the client's observed snapshot.
`node scripts/test-portal-routine-delete.mjs` passes with native confirm disabled:
required acknowledgement, Escape/Enter, stale/offline rejection, sibling isolation,
same-key uncertain retry and normal Save-label restoration (two synthetic requests,
one receipt). Schedule/recovery Chromium fixtures also pass; desktop, narrow/offline
and uncertain-result screenshots were inspected. Logs:
`.local/routine-delete-{browser,schedule,recovery}.log`. No native WKWebView,
screen-reader, live deletion or external cancellation acceptance is inferred.
Combined rerun passed: `.local/routine-delete-combined.log`, 1,154 control / 262
runtime tests plus compatibility, auditor/Mac source checks, HTTP/native/service
fixtures and typecheck/build dry run. Final production admission remains false.

WhatsApp transport investigation: the locked MCP SDK 1.30.0's
[`Protocol.request`](https://github.com/modelcontextprotocol/typescript-sdk/blob/2d889f2b329e46680ec9bdd565de4616c497825a/src/shared/protocol.ts#L681-L834)
deletes the response handler and rejects locally on timeout/abort; cancellation
notification delivery/remote settlement is not awaited. Its
[`StdioClientTransport.close`](https://github.com/modelcontextprotocol/typescript-sdk/blob/2d889f2b329e46680ec9bdd565de4616c497825a/src/client/stdio.ts#L201-L240)
can return after sending SIGKILL without observing process close. Future transport
assembly must retain unknown in-flight obligations and independently confirm process
and browser-descendant termination; neither a rejected call nor resolved close is
safe-sleep evidence. No SDK installation or connector launch was added by this review.

WhatsApp authority-deadline follow-up (2026-09-16; verified locally):
`readWappMcp` now accepts the exact Worker `{allowed:true,deadline_at}` authorization
response as well as the existing boolean host callback contract. The initial
response can tighten the timer to an earlier ancestor deadline; the second check
cannot extend any previous cap. Malformed/extra fields deny, exact expiry stops,
and late callbacks after cancellation cannot arm new timers. This avoids reducing
the Worker's effective deadline to a boolean in trusted HTTPS composition.
18 scoped-read tests and the HTTPS Worker fixture pass; combined rerun passed
1,154 control / 262 runtime tests, eight auditor tests and all HTTP/native/service/
build checks in `.local/authority-deadline-combined.log`. No MCP registration or live read
has been added, and AbortSignal delivery does not prove upstream termination.

WhatsApp scoped-authority follow-up (2026-09-16):
`HEHEBOT_WHATSAPP_READ_POLICIES` is an operator-provisioned JSON registry keyed by
policy UUID, with values `{chatIds:string[],tools:string[]}`. It defaults to `{}`
in production and local configuration. Only the two scoped reads are accepted;
mutations, duplicate IDs/tools, malformed IDs and >64KiB UTF-8 registry content
reject. At most 64 policies and 100 chats per policy are accepted. No wildcard or
empty-means-all behavior exists.

Admission captures exact registry grants whose policy IDs occur in both the
operator tool registry and persona snapshot. Routines additionally require their
admitted action-policy IDs and the current operator action registry. The optional
`whatsapp_read_policies` snapshot field is absent when none qualify; old snapshots
without it deny reads. Native descendants of the same persona retain the original
snapshot; another admitted persona captures its own scope. Policy edits do not
silently broaden already admitted tasks.

`POST /internal/whatsapp-read-authorize` uses the existing runtime bearer boundary,
execution gates and generated schema. Input is `{identity,run_id,attempt,name,chatId}`;
there are no caller-supplied grants or deadlines. `WhatsAppReadAccess.authorize`
requires current executor/attempt, running/finishing task, unexpired admitted
deadline and non-cancelled/non-stale native ancestry. The exact tool/chat pair must
occur together under one policy in both pinned and current registry grants.
Removing or narrowing current operator configuration denies access; current
persona edits retain the existing immutable-task semantics, so cancel the task
or revoke the operator policy when immediate revocation is needed.

Success returns `{allowed:true,deadline_at}` using the earliest task/ancestor
deadline. The query writes no records, renews no lease and schedules no inference.
The ControlClient allowlist includes it. This is an authorization surface, NOT
connector dispatch: trusted runtime composition must bind original task custody,
use it around `readWappMcp`, supply its admitted deadline, and account for in-flight
MCP operations. No WhatsApp tool is registered, browser started or account paired.

Focused evidence: 38 core tests (9 new scoped-access cases), 11 client tests,
generated contracts and typecheck pass. Coverage includes asymmetric tool/chat
pairs, no policy union widening, registry expansion/narrowing, routine restriction,
cross-persona/legacy denial, exact expiry, parent cancellation, native inheritance,
UTF-8 bounds and rejection of injected grant/result fields. Logs:
`.local/whatsapp-access-focused.log`, `.local/whatsapp-access-client.log`.
The first full verifier passed in `.local/whatsapp-access-combined.log`.
`scripts/test-control-whatsapp.mjs` also passes against a disposable HTTPS Worker:
wrong token/chat/attempt/epoch, mutation and injected-grant fields reject; queries
preserve run/event state; cancellation during a synthetic read suppresses its
result and blocks another dispatch. Two synthetic reads, no live account, MCP,
browser or provider calls. Real runtime MCP assembly remains open.

Second parallel delivery integration (2026-09-16): the artifact-license auditor
and disk-backed receipt-crash harness are reviewed and applied. The auditor's
eight unit tests pass; all 350 locked artifacts pass SRI and are inspected.
Ten byte/metadata-identical aliases are explicitly retained; conflicting contents
or metadata still reject without extraction. Exit 2 deliberately means review
required, never legal approval. See [license evidence](WAPPMCP_LICENSE_EVIDENCE.md).
The worker's 100 crash/reopen trials passed; main's first rerun failed on case 4
with an HTTP timeout during concurrent combined verification, and its cleanup
deadline was not confirmed. A subsequent process scan found no workerd survivors.
Do not count the failed rerun as acceptance. The integrated combined verifier
passed 1,154 control / 259 runtime tests plus HTTP/native/service/build checks.
The subsequent sequential run passed 100 injections/reopens in 470,837ms, with
50 cases of each mode, 1,350 helper requests and all children stopped. The later
alias-only auditor follow-up passed eight focused tests and full artifact inventory.
[Methodology](CONTROL_CRASH_RESTART.md) distinguishes
incomplete-input loss from committed-response loss and excludes power-loss claims.

Parallel integration checkpoint (2026-09-16; verified locally, unpushed):

- Native question binding arms the admitted deadline immediately after validating
  resolver custody, before reading the attempt journal. A stalled initial read now
  stops at exact expiry. Late I/O cannot record/take an answer or invent resolution;
  terminal native resolution still uses original custody. Locally rerun: 45 runtime/
  service tests and 72 core question tests. No underlying I/O cancellation or
  successful recovery claim.
- Pruning rejects impossible applying-journal sequences: only a deleted prefix,
  at most one deleting entry, then pending entries are reachable. Plan order—not
  JSON key order—governs validation. 114 backup/retention/restore tests rerun,
  including all nine two-candidate combinations and receipt-rename failures.
  [Evidence and limits](CONTROL_BACKUP_JOURNAL_SAFETY.md); structural validation
  does not authenticate receipts or prove power-loss durability.
- Portal recovery editors recheck exact task/attempt, effect digest/status and
  current eligibility before POST. Offline actions disable; reconnect does not
  replay. Recovery and question browser fixtures pass locally. Desktop/narrow
  captures inspected: dialog identity/error text and controls fit. Keyboard and
  role=alert checks pass; this is Chromium, not Safari/touch/screen-reader proof.
- 200 seeded real-SQLite drain/effect sequences rerun locally, matching worker
  counts: 369 dispatches, 288 explicit unknown transitions, 600 terminal receipts,
  700 object reconstructions, 100 lease losses and 100 drain preparations.
  [Model and mutation evidence](DRAIN_EFFECT_RACES.md). No process-crash, disk-reopen,
  native continuity or real provider sleep evidence is inferred.
- Model-facing skill/routine reads and commands now enforce the admitted hard
  deadline before watchdog reconciliation. Three claimed/running/finishing exact
  expiry regressions failed before the fix; all 13 agent-command tests pass after.
  Tests preserve commands, task/attempt rows, lifecycle and skill proposals across
  rejection. Immutable admitted policy and existing receipt behavior stay intact.
- WhatsApp reads accept an optional host-only `authorize` callback. It must return
  exactly true before dispatch and after the response; errors deny with fixed
  redacted codes. Both awaits share the original cancellation/deadline envelope;
  late checks cannot start I/O or release results. The callback receives frozen
  tool/chat identity and an owned AbortSignal, not message contents. 15 tests pass,
  including denial on each boundary and independent task isolation. This hook does
  not implement Worker authority: chat-scope representation and trusted lease/
  revocation wiring are still missing. Callers must bind original task custody.
- `config/wappmcp` locks 350 package locations separately from application deps.
  The verifier installs them only in disposable storage with lifecycle scripts
  disabled, checks pristine source and explicitly applies the exact approved patch.
  Patched bytes match the independent hash-pinned extraction. Focused check passes.
  No Chrome download/start, CLI, pairing or tool registration. Metadata review found
  LGPL-3.0-or-later `node-webpmux`, Public Domain `jsonify`, and two missing license
  declarations; source/asset/notice review remains open. See the installation README.

Local logs: `.local/parallel-question-focused.log`, `.local/parallel-control-focused.log`,
`.local/parallel-portal-{recovery,questions}.log`, `.local/parallel-drain-focused.log`,
`.local/agent-deadline-{red,focused}.log`, `.local/wappmcp-locked-focused.log`.
First integration batch passed `.local/parallel-batch-combined.log`; final complete
batch passed **1,145 control / 259 runtime tests**, compatibility, HTTP/native/service
fixtures and typecheck/build dry run in `.local/parallel-final-combined.log`.
Desktop 16 tests passed (`.local/parallel-desktop.log`). Production gates false.

WhatsApp task-deadline checkpoint (2026-09-16): `readWappMcp` accepts optional
host-only canonical UTC `deadlineAt`, copied before asynchronous work. Effective
expiry is the earlier of that admitted task deadline and the bounded relative
timeout. Invalid timestamps reject before I/O; exact expiry prevents dispatch and
suppresses late results. Omitting it preserves the standalone two-minute ceiling;
future trusted task assembly must supply it from custody, never model arguments.
11 scoped-read tests pass (`.local/wappmcp-deadline-focused.log`), including shorter
task versus shorter operation windows, exact expiry, attempted options extension
and pre-microtask expiry. Combined verification passed 931 control / 253 runtime
tests, pinned WhatsApp compatibility, native/service fixtures and typecheck/build
dry run (`.local/wappmcp-deadline-combined.log`). No grant issuance, lease/revocation transport,
connector installation, native termination or production admission is implied.

Approved WhatsApp compatibility checkpoint (2026-09-16): the owner-authorized
exception from the coordination thread is merged into AGENTS.md/SPEC.md without
removing local progress links or native-descendant authority guidance. It supersedes
earlier patch-policy blocker statements below, not live adoption gates.
`node scripts/verify-wappmcp.mjs` verifies pinned public artifacts before extraction,
the distributed patch against the exact approved source revision, clean `git apply`
and rejection of changed/missing bytes and double application. It executes the
actual patched Reaction and Injected/Utils functions with synthetic WhatsApp models:
both `_serialized`/`$1`, precedence, non-mutating normalization, message model and
last-message cache/fallback lookups, and absent-key suppression. All 20 published
tools outside the two scoped reads are denied; the 9 existing read-boundary tests
also pass. Combined verification passed 931 control / 251 runtime tests, the new
WhatsApp check, native/service fixtures and typecheck/build dry run
(`.local/wappmcp-approved-combined.log`); production admission remains false.

Artifact provenance (public downloads; no vendored upstream code):
- wappmcp 0.4.0, MIT, source revision `9a0a39e61b2271df1a1d7fc1e198f1e37f66aaf8`
  (npm `gitHead` matches); npm tarball SHA256
  `f1b28838615cabb55d17734b67ad1d6cb0d8a86cbbf8339564a3bc57dc57f1e8`.
- whatsapp-web.js 1.34.7, Apache-2.0; npm tarball SHA256
  `714e51cc23d1855ac200b99ad063fe8025208d4feca86dad4c27ffdaff096c0c`.
- Approved upstream `patches/whatsapp-web.js+1.34.7.patch`, SHA256
  `b2b582a7650545d6e7534e7a66731a8b546b309efd6bce9e0e9a4722e0a616cf`;
  touches only dependency `src/structures/Reaction.js` and `src/util/Injected/Utils.js`.
  No modifications to that patch. Upstream license files stay in the disposable
  extracted artifacts. Future redistribution must retain MIT/Apache notices and
  complete the transitive dependency/asset license audit; this is not that audit.

This is a disposable compatibility check, not an installer: it runs no npm lifecycle
scripts, browser, MCP server or pairing. No installed graph or signature/provenance
attestation is claimed verified; hashes pin the inspected artifacts. Guided setup,
transitive lockfile, trusted task/lease/revocation transport, persistent pairing,
reconnect coverage and sleep/cost evidence remain open. Rerun compatibility and
authorization checks before upgrades; patch changes require renewed approval.

Resource-deadline checkpoint (2026-09-16): acquiring a new lock now checks the
attempt hard deadline even before watchdog reconciliation. Exact already-held
lock replay remains a no-op; deadline expiry does not release locks or bypass
unknown-effect release checks. Three regression cases failed before the fix;
91 focused lifecycle/orchestration/root-child tests passed, covering claimed,
running and finishing states, −1ms/exact/+1ms, mixed held/new lock rejection,
unchanged acquisition timestamps, release and denied reacquisition
(`.local/resource-deadline-focused.log`, red `.local/resource-deadline-red.log`).
Combined verification passed 931 control / 251 runtime tests, native/service fixtures
and typecheck/build dry run (`.local/resource-deadline-combined.log`).
No native termination, connector authority, provider use or production admission.

Effect-cancellation checkpoint (2026-09-16): first dispatch now requires a running
task, and the descendant boundary rechecks admissible ancestry after intent creation.
Previously cancellation between intent and dispatch did not fence unsent effects.
Duplicate acknowledgements and late outcomes remain recordable without reopening
dispatch. Four new cases failed before the fix; 39 focused effect/root-child/recovery
tests passed (`.local/effect-cancel-focused.log`, red `.local/effect-cancel-red.log`).
Tests cover owner cancellation, root/intermediate/selected-child cancellation,
unchanged locks/effects/unrelated sibling, reconstruction and late receipts.
Combined verification passed 928 control / 251 runtime tests, native/service fixtures
and typecheck/build dry run (`.local/effect-cancel-combined.log`). No external
action is retracted, no native termination inferred and no production gates changed.

Effect-deadline checkpoint (2026-09-16): new intents and first dispatch transitions
now require an unexpired attempt deadline, closing the pre-watchdog running-state
window. Existing immutable receipt lookups and duplicate dispatch acknowledgements
remain no-ops; late confirmed/failed/unknown outcomes can still be recorded. This
does not authorize another external send or cancel an action already sent. Both
new regression cases failed before the fix; 35 focused effect-workflow/root-child/
recovery tests passed, including −1ms/exact/+1ms, reconstruction, unchanged rows
on rejection and late receipt retention (`.local/effect-deadline-focused.log`,
red evidence `.local/effect-deadline-red.log`). Combined verification passed 924
control / 251 runtime tests, native/service fixtures and typecheck/build dry run
(`.local/effect-deadline-combined.log`). No production gates or provider state changed.

Late-start checkpoint (2026-09-16): `submitted` now retains a late native receipt
and marks the run cancelling/DEADLINE_EXCEEDED when its admitted deadline has passed,
including equality. Previously a registered child could acknowledge start after
expiry and become running before watchdog reconciliation. Attempt status remains
running because the observed native work is not settled. Receipt replays remain
no-ops and cannot renew cancellation grace. The exact child boundary failed before
the fix; 82 focused lifecycle/orchestration/task-control tests pass, covering −1ms,
exact and +1ms root/child cases (`.local/late-start-focused.log`, red evidence
`.local/late-start-red.log`). Combined verification passed 922 control / 251 runtime
tests, native/service fixtures and typecheck/build dry run
(`.local/late-start-combined.log`). This is metadata cancellation intent, not verified
native termination, new execution authority or production admission.

Disabled-admission retry checkpoint (2026-09-16): `retryDue` previously deleted a
due retry even when execution was disabled, leaving waiting work without its timer.
It now retains that timer until admission reopens, while still removing stale timers
for cancelled work and moving unresolved-question work to recovery. Both new tests
failed before the fix. Focused recovery/lifecycle: 66 passed
(`.local/disabled-retry-focused.log`; red evidence `.local/disabled-retry-red.log`).
Tests verify repeated reconciliation preserves timer/run/lifecycle, cancellation
prevents revival and re-enablement advances queue sequence/attempt exactly once.
Worker alarm scheduling already excludes disabled retries; retaining them adds no
retry alarm loop. Combined verification passed 919 control / 251 runtime tests,
native/service fixtures and typecheck/build dry run (`.local/disabled-retry-combined.log`).
This is local retry custody, not native recovery or live provider acceptance.

Terminal-cancellation follow-up checkpoint (2026-09-16): cancelling queued/waiting
work now invokes the existing descendant-settlement-aware follow-up flush. Earlier
pending follow-ups otherwise remained stranded, unlike follow-ups submitted after
cancellation. Active/recovery cancellation does not flush. Two waiting-checkpoint
fixtures cover immediate delivery versus live-grandchild deferral, exact target/text,
unchanged sibling/attempt and duplicate receipt/flush prevention. Focused
orchestration/retention/recovery suite: 26 passed
(`.local/cancel-followup-focused.log`). Combined verification passed 917 control /
251 runtime tests, all native/service fixtures and typecheck/build dry run
(`.local/cancel-followup-combined.log`). Synthetic checkpoints do not prove native
parking/restart; no production gates or provider state changed.

Explicit-retry timer checkpoint (2026-09-16): accepting `run.retry` now deletes the
prior attempt's automatic timer in the same transaction. Previously a fast second
failure could hit `scheduleRetry`'s conflict-preserving insert and retain the first
attempt's earlier timer instead of the second attempt's 60-second delay. Tests
verify rejected commands preserve the old timer, accepted commands supersede it,
old receipt replay cannot delete the newer timer, and due admission respects the
second failure's exact deadline. Focused recovery/lifecycle suite: 64 passed
(`.local/retry-timer-focused.log`); combined verification passed 915 control / 251
runtime tests, all native/service fixtures and typecheck/build dry run
(`.local/retry-timer-combined.log`). Admission/uncertainty checks and retry limits are
unchanged. No provider action, native replay authority or production gate change.

Recovery-cancellation checkpoint (2026-09-16): `run.cancel` previously moved an
already recovery-required run back to cancelling. It now preserves recovery while
recording owner cancellation intent and a current event. Heartbeat already includes
recovery-required IDs, so interruption delivery needs no state regression. The new
SQLite test starts with an unconfirmed cancellation and unknown mutation effect,
then verifies active operations, running attempt, effects and locks are unchanged
by another cancel; retry/sleep remain blocked and event status stays truthful.
Focused recovery/lifecycle/control acceptance: 170 passed
(`.local/recovery-cancel-focused.log`). Combined verification passed 914 control /
251 runtime tests, all native/service fixtures and typecheck/build dry run
(`.local/recovery-cancel-combined.log`). No settlement, provider action or production
gate change; successful recovery remains unverified.

Cancellation-grace checkpoint (2026-09-16): repeated distinct owner cancellation
commands and later memory purge/expiry used to reset an already-cancelling run's
`updated_at`, postponing the watchdog indefinitely. Both paths now preserve that
original grace anchor. New command events still use current time, and canonical
memory/context purge and preview discard still occur. First entry into cancellation
is unchanged. Focused recovery/memory/lifecycle tests: 68 passed, including
staggered expiry versus explicit deletion, second owner receipts, −1ms/exact
original 30-second boundary, unsettled attempt and no retry. Log:
`.local/cancel-grace-focused.log`; combined verification passed 913 control / 251
runtime tests, all native/service fixtures and typecheck/build dry run
(`.local/cancel-grace-combined.log`). No schema migration or production-gate change;
the timer transition is not native cancellation or termination proof.

Snapshot-fencing checkpoint (2026-09-16): the real FileJournal/projection/supervisor/
SQLite integration now first persists valid live operations, then injects orphan
timing, a null inventory, invalid completion evidence or a new late-start operation.
The first three fail before heartbeat; the last reaches the Worker and is rejected
by its timing envelope. Every path retains prior operations, attempts, runs,
journal bytes and local/Worker leases, clears the supervisor timer and fences
subsequent dispatch/maintenance. No cancellation, native replay or activity release
occurs. Focused supervisor suite: 55 passed (`.local/snapshot-fencing-focused.log`).
Combined verification passed 910 control / 251 runtime tests, all native/service
fixtures and typecheck/build dry run (`.local/snapshot-fencing-combined.log`). Runtime
behavior is unchanged; this proves refusal, not repair/resume or native termination.

Worker operation envelope checkpoint (2026-09-16): after existing attempt/epoch
authentication and UTC normalization, heartbeat requires start ≤ operation deadline
≤ admitted attempt deadline and progress ≥ start. The hard limit comes from the
attempt row, not the submitted operation. Invalid timing rolls back the entire
heartbeat page and lease update. Progress after a deadline is still accepted so
late completion can be reported; it cannot extend immutable operation custody.
Focused verification passed 63 lifecycle/projection integration tests, including
offset hard-limit +1ms, inverted times, exact limit and late completion. Log:
`.local/operation-envelope-focused.log`; combined verification passed 907 control /
251 runtime tests, all native/service fixtures and typecheck/build dry run
(`.local/operation-envelope-combined.log`). No production gate or provider action
changed; progress-extension policy and actual termination remain unverified.

Interrupted-spawn checkpoint (2026-09-16): pinned generated
`CollabAgentToolCallStatus` includes `interrupted`, already admitted by the event
adapter. Heartbeat projection previously left that invocation unknown, while
offline inspection rejected the entire otherwise-valid record. Both now accept
the terminal invocation state, retaining receiver startup clocks and child work.
Root/nested tests keep active commands, pending grandchild startup, unknown
coverage and `CHILD_TURN_UNKNOWN`; offline inspection remains read-only and cannot
authorize resume/sleep. Focused rerun: 89 tests passed. Initial failures identified
two old fixtures misclassifying interrupted spawns and a new test incorrectly
expecting no missing-grandchild warning; logs are `.local/interrupted-spawn-focused.log`
and `.local/interrupted-spawn-focused-rerun.log`. Combined verification passed
903 control / 251 runtime tests, all native/service fixtures, typecheck and build
dry run (`.local/interrupted-spawn-combined.log`). Schema/synthetic event evidence does not
prove a live interrupted spawn or recursive process termination. No gates changed.

Operation inventory integrity checkpoint (2026-09-16): heartbeat projection rejects
null, scalar and array inventories instead of interpreting them as absent work.
This covers root/child tool and stream maps, spawn maps, child-turn maps and child
owners. Absent fields and empty maps retain legacy behavior. Errors are fixed,
content-free `INVALID_OPERATION_INVENTORY`; reads do not repair journal state.
Verification: 25 runtime tests (200 malformed combinations) and 8 SQLite tests
passed, including unchanged persisted operations/lease after failed projection.
Logs: `.local/inventory-focused.log`, `.local/inventory-control.log`. Combined
verification passed 903 control / 249 runtime tests, all native/service fixtures
and typecheck/build dry run (`.local/inventory-combined.log`). Structural validation
does not authenticate journals, prove complete coverage or authorize sleep/replay.

Overlapping-stream watchdog checkpoint (2026-09-16): real FileJournal → operation
projection → SQLite heartbeat/watchdog tests cover message and plan streams
starting one minute apart. Either can complete without settling the other; the
remaining operation cancels at its own deadline, not a completed earlier deadline
or the run hard deadline. Checks at deadline−1ms/exact deadline and cancellation
+29,999ms/+30,000ms prove the current boundary. Repeated heartbeats preserve the
cancellation timestamp. Unconfirmed cancellation leaves attempts and operations
live, retains unknown coverage, queues no retry and denies sleep. Eight focused
tests passed (`.local/overlap-watchdog-focused.log`); combined verification passed
903 control / 248 runtime tests, all native/service fixtures, typecheck and build
dry run (`.local/overlap-watchdog-combined.log`). No runtime behavior changed.
This does not exercise a real held native stream through expiry, the separate
15-second cancel/15-second verification steps, or actual process termination.

Message completion integrity checkpoint (2026-09-16): live heartbeat projection and
offline inspection reject non-object output maps, invalid item IDs and noncanonical
SHA-256 digest values. Previously, key presence alone could classify a malformed
completion as settled. Root/child same-ID isolation and exact-item matching remain
intact; valid-looking hashes do not authenticate journal contents. All 44 focused
operation/inspection tests passed (`.local/output-completion-focused-final.log`),
including read-only offline checks. Combined verification passed 901 control / 248
runtime tests, all native/service fixtures and typecheck/build dry run; evidence:
`.local/output-completion-combined.log`. No native protocol, deadline, recovery
authority, provider action or production gate changed.

Previous checkpoint (2026-09-16): live agent messages now have independent five-minute, task-capped lifetime clocks, so tool/plan overlap and turn termination cannot erase a still-open stream. Only exact output completion ends that lifetime; deltas/replay cannot refresh it. Offline inspection includes these clocks. Verification passed 99 focused tests, targeted native supervisor-child/Plan reruns, and combined 901 control / 246 runtime tests, all native/service fixtures and typecheck/build. Old fixture-count assumptions failed and were corrected: native Plan generation keeps both its enclosing message and plan open. This is not complete native coverage, watchdog termination or safe sleep. See [service contracts](CODEX_SERVICE.md), [TODO](../TODO.md) and [handoff](HANDOFF.md). No production gate changed.

The owner-selected Mac direction is SwiftUI + WKWebView around the remote portal, not yet implemented. The Electron foundation listed below remains existing code, not a verified Mac release; separate Mac-decision specification edits are awaiting integration.

## Implemented locally

- Cloudflare Worker portal/API and one SQLite Durable Object per installation for commands, receipts, timelines, revisions, routines, occurrences, runs, scoped memory, policies, effects, locks, and lifecycle state.
- Owner JWT verification, origin checks, signed/deduplicated triggers, strict generated schemas, paginated events, and durable idempotency.
- Fenced epochs/leases, serialized lifecycle operations, bounded retries, drain/checkpoint contracts, cancellation isolation, and conservative unknown-effect handling.
- Codex stdio transport, durable submission/event journal, exact root/child identity, steering/cancel intent, scoped host tool callbacks, and supervisor/bridge fixtures.
- Managed skill proposals/revisions/per-bot enablement and routine create/list/inspect/edit/pause/resume/delete/run-now contracts.
- Numeric cron/timezone/DST/misfire behavior, reviewed disabled bot import, flight deadline ledger, provider adapters, and Sprite activity-hold components.
- Static portal and remote-only Electron desktop shell.

Owner-authored memory expiry now arms a Worker alarm even while the runtime is
asleep. Each reconciliation purges at most 100 due canonical memories, including
their revisions and `memory.put` payloads, and rearms remaining work. Expiry
invalidates active captured contexts without settling uncertain tasks, releasing
locks, requesting inference or waking the runtime. This is not full retention or
"forget everywhere": source events, terminal task snapshots, native transcripts
and backups may still contain copies.

Schema v5 adds alarm-driven timeline retention: messages, action requests,
trigger inputs, follow-up notices and results retain 90 days; metadata audit and
derived room updates retain 30 days. Each reconciliation prunes at most 100 rows
and rearms a backlog. Physical cleanup may lag the cutoff, but snapshots, timeline
pages and newly captured recipient context exclude overdue rows immediately.
History floors include overdue rows still awaiting removal. Dates originate at
event creation, not the last read. This is not full payload/storage retention.

Compact event provenance and room-publication digests survive timeline expiry.
Legacy publication identities are backfilled transactionally before deletion,
preserving duplicate suppression and the existing causal contribution count.
Global cursors report interior history gaps and never reset when all events
expire. Recipient contexts disclose expired history alongside current authorized
objects and retained deltas; cleanup never advances consumed watermarks. Timeline
responses expose truncation. The portal displays an expired-history notice,
invalidates cached pages when the retention floor advances, and rejects delayed
pre-pruning responses. `node scripts/test-portal-history.mjs --retention` checks
partial/empty history and stale responses in Chromium with synthetic read-only
HTTP responses; default and `--error` modes cover cross-bot history races.

New recipient context also rechecks referenced object revisions, deletion and
memory scope/expiry. Unavailable references replace that update's text with an
explicit unavailable marker; independent updates remain intact. Original timeline
rows and already captured/native transcripts are not erased by this read-time
check. Publication still creates no inference or wake.

Schema v6 adds indexed, 100-row command-payload cleanup at 90 days from original
acceptance for applied/rejected commands. Receipt identities, body hashes, keys,
outcomes and foreign-key links remain intact; pending acceptance is not erased.
Tests preserve same-key and webhook replay/conflict behavior after body removal.
This does not claim dedupe-key reuse or deletion of receipt metadata at 90 days.

Schema v7 adds indexed, transactional cleanup of at most 100 terminal attempt
results per reconciliation, 90 days after settlement. The current attempt's
delivered portal copy is redacted in the same transaction; a replacement result
uses its own settlement date, not the original outbox creation or delivery update.
Waiting/recoverable runs, pending retries/deliveries, unresolved operations/effects
and resource locks prevent this cleanup. Identity, statuses, timestamps and
checkpoints are preserved; expiry is never evidence of native settlement or sleep.
The Worker schedules cleanup even with execution disabled. Physical purge may lag
the cutoff; these stored result copies have no current retrieval endpoint.

Schema v8 expires undelivered deferred follow-ups at 90 days from receipt, erases
their text and records a content-free expiry notice requiring fresh owner input.
The target task is unchanged. Dispatch enforces the cutoff even before a bounded
100-row cleanup batch reaches that message. Already-dispatched follow-up copies
lose their redundant text but retain their coordinator link/status; captured work
is not silently cancelled or erased. Migration preserves rows and foreign keys
transactionally. `node scripts/test-portal-history.mjs --followup` checks the
accessible notice, cross-bot separation and zero mutations in real Chromium;
desktop/narrow screenshots are synthetic read-only UI evidence, not phone tests.

Never-claimed queued/waiting tasks also lose unused derived context after 30 days
from enqueue, in batches of 100. Only the instruction and room identity remain;
claim rebuilds the full authorized snapshot from current canonical data. Cleanup
does not advance cursors, change run status/timestamps, create events or wake the
runtime at this 30-day boundary. At 90 days, never-started instructions are erased
and marked `failed/MESSAGE_EXPIRED`, with a content-free notice asking for fresh
input. Original command receipt age survives forwarding; commandless scheduled
work uses its enqueue time and retains a skipped occurrence identity. Claim and
retry enforce this cutoff before bounded physical cleanup reaches the row, so
an overdue backlog cannot execute, wake a provider or starve fresh requests.
Wake rechecks after provider observation, including expiry across that await.
Admitted/recoverable
attempts remain untouched. `node scripts/test-portal-history.mjs --input-expiry`
checks the desktop/narrow expiry notice and absence of expired text.

Admitted/terminal task contexts, protected results, non-portal outbox payloads,
revisions, native data and backups remain outside this cleanup.
Compact provenance/causal records currently have no expiry. These are explicit
remaining retention gaps, not proof of full S30 or "forget everywhere". Existing
publication digest semantics are preserved; full per-edge collaboration,
shared-deadline and yielding requirements remain separate.

Disposable service assembly now composes supervisor, bridge, native transport/router,
per-root inherited MCP grants, child controls and conservative operation accounting.
Its native child fixture exercises public owner cancellation through real Worker
heartbeat to one exact interrupt, while completion/sleep remain denied. See
[service evidence and limits](CODEX_SERVICE.md). A separate live Sprite Tasks test
verified hold create/read/renew/delete, not application drain or VM sleep; see
[provider evidence](PROVIDERS.md).

Completion acknowledgments use the retained attempt result, not the mutable run
status. Identical serialized results can replay after a waiting checkpoint or
retryable failure, including after the retry becomes queued, without rewriting
state or publishing another result. Conflicting results fail; pruned receipts
cannot establish replay success. Current epoch, lease and attempt fences still
apply. Owner cancellation continues to suppress result text. SQLite/journal tests
exercise lost acknowledgments and reconstruction, not native restart readiness
or family settlement.

Retry scheduling preserves an existing run checkpoint rather than overwriting it
with a retry timestamp; the retry queue still owns the deadline. The bridge passes
that checkpoint as nested `durable_checkpoint` data to a later admitted attempt's
fresh native thread, without merging it into authorization or another task's
context. SQLite/journal/RPC tests cover owner and automatic retries. This is
checkpoint delivery, not native session restoration, proof that a model uses the
checkpoint correctly, or permission to replay an effect. Existing reconciliation
and retry-admission restrictions still apply.

Quiet-chat result messages retain the recorded event's outcome, error code and
available task title even when no recent run record remains or the body is empty.
Missing legacy status is unavailable, never inferred as success. These historical
labels do not replace current task attention or prove family settlement. The
`test-portal-results.mjs` Chromium fixture covers refresh/reload, conversation
isolation, empty failures/cancellations, unknown status and narrow wrapping with
no mutation requests; native approval/question integration remains incomplete.

[Native-question custody](NATIVE_QUESTION_CUSTODY.md) now binds owner answers to
the original task, attempt, epoch, boot, connection and exact question revision.
The Worker commits response uncertainty before returning answer data; repeated
takes never resend it. Questions block task completion and sleep until separately
resolved or explicitly closed after confirmed executor termination, even after expiry. Resolution proves neither answer consumption nor
task settlement. The portal uses attributed literal question cards and explicit
answer/skip controls, retains hidden-bot attention, fences stale edits, and leaves
the ordinary chat composer independent. SQLite, actual local HTTPS Worker and
inspected Chromium fixtures cover these boundaries. Runtime thread-journal
binding is now connected through default-off disposable service assembly, including
real native answer delivery and cancellation without an answer. Resolved question
content has bounded 90-day cleanup after resolution and task settlement, guarded
by retries, operations, effects and locks. Pending/unknown records, native journals
and backups remain retained. Owner-only `question.close` preserves original
handoff uncertainty in a versioned closed-custody receipt with native resolution
left null. It requires the original attempt's confirmed termination and explicit
revision-checked consent, changes no task/effect/lock, and can reconcile old-epoch
question custody. Retry, claim and recovery closure reject unresolved questions;
unrelated fresh work remains eligible. Closed records share guarded 90-day
retention. SQLite, Worker and Chromium fixtures cover these local contracts.
Actual provider shutdown, full recovery and production callback admission remain
unverified; production execution remains disabled.

Observed native child starts are now acknowledged by the service atomically with
Worker registration. Exact receipt replay recovers a lost acknowledgement without
resubmitting inference or resurrecting a cancelling/terminal task. Legacy journal
mappings reconcile once without replacing known Worker identities. The native
service effect fixture no longer needs a manual child submission call.

[Explicit task steering](CODEX_STEERING.md) now connects an owner-selected exact
attempt to Worker pending/receipt contracts and disposable service maintenance.
The portal separates immediate steering from after-settlement follow-ups, shows
truthful delivery states and disables uncertain resends. Existing command payload
retention applies; known delivery metadata expires after 30 days once the task is
terminal with clear custody, while pending/unknown recovery records remain. No context,
policy, effect, lock or completion is rewritten. Ordinary messages still enqueue
independent work rather than implicitly steering a background task.

The actual pinned native steering fixture observes root and direct-child directives
in their next model context before exact-turn completion, including child delivery
after root completion while a sibling stays held. Reopened journal receipt replay
issues no second native steering RPC. SQLite/HTTP/service/Chromium tests cover the
separate application boundaries. Native acceptance is not model understanding or
consumption, natural-language intent resolution, multi-root Worker admission,
successful crash recovery, full O03 or production/sleep readiness.

Provisional output now has a separate display path: completed native
`agentMessage` items (not deltas, reasoning, command output or tool payloads) feed
the exact root/child attempt's latest preview. Full-message digest and native item
identity prevent replay from replacing newer text; conflicts fence observation.
The router retains at most 8192 UTF-16 units without cutting a surrogate pair;
the journal permits 1024 observed message identities and 101 display owners per
admitted family. This is bounded message snapshots, not token streaming or a
complete transcript. Native `final_answer` is not application settlement.

Service maintenance publishes serially through the authenticated runtime route,
with exact native reference, lease, epoch, boot, attempt and deadline checks.
An identical version can replay after a lost acknowledgement without new native
work. Cancellation/context invalidation rejects late display publication; stale
executor authority still fails rather than becoming a display acknowledgement.
The Worker stores one preview per run, hides terminal/old-attempt/cancelled output,
and expires it 90 days after its first preview without extending expiry on updates.
Memory invalidation discards affected active previews. Native journals and backups
remain separate retention obligations; this is not deletion everywhere.

The portal labels previews provisional and renders text literally, preserving
task expansion through polling and distinguishing recovery from completion.
`node scripts/test-portal-output.mjs` covers root/child, shortened text, injection,
recovery, narrow layout and terminal/cancelled/old-attempt hiding without mutations.
SQLite, Worker HTTP and native service fixtures cover publication separately from
settlement; authenticated inference/model judgment remain unverified.

Trusted [root/descendant effect bookkeeping](ROOT_CHILD_EFFECTS.md) now connects
strict runtime routes to the existing effect/resource ledgers. It validates exact
lease, attempts, native ancestry and original same-task policy/scope, records
child-owned effects and locks atomically, and preserves custody-bound replay.
Reconciliation never releases locks or implies native settlement/sleep. SQLite
and in-process Worker HTTP/RPC tests use synthetic observations and receipts;
this is not connector execution or authenticated per-child MCP provenance.

The active-native-crash fixture verifies fencing and restart refusal during an
open root turn, not successful resume. The [offline recovery diagnostic](CODEX_RECOVERY.md)
projects current task identities and observed obligations without credentials,
network calls or state writes; unknown coverage remains a blocker.

The owner recovery view now pages independently of the newest-100-run snapshot
and retained conversation events. `GET /v1/conversations/:id/recovery` returns
20 tasks by default (maximum 100), bounded effect metadata, and an exclusive
`after`/`next_cursor` task-ID cursor. Persona ownership or the captured room
identity scopes each page. Tasks leaving recovery do not shift subsequent pages;
restart from the first page for concurrent arrivals before the cursor. Reads do
not authorize retry, effect dispatch, lock release or native settlement. Existing
ingress maintenance still runs. Context/checkpoint bodies and provider receipt
payloads are excluded. SQLite, owner RPC, local HTTP and Chromium fixtures cover
pagination, scope, malformed input, empty/error/loading states and late responses.
The portal retains separate explicit effect-decision and recovery-close consent.
This closes the recovery listing window gap, not full restore or native census.

The composer-adjacent task strip reads an independent owner-authenticated task
feed, so unfinished tasks older than the newest100 runs remain discoverable.
Stable ID pagination returns ten tasks at a time with conversation-wide waiting
and recovery counts. Expanded details preserve exact-task cancellation and show
original receipt status separately from completion. Failed refreshes hide stale
controls; conversation switches reject late responses. SQLite/Worker tests and
Chromium checks cover pagination, scope, cancellation isolation, narrow layouts
and stale/empty states. Counts do not prove native approval/question coverage,
family settlement or safe sleep.

[Owner roster organization](ROSTER.md) now persists ordered sections, membership,
collapse and independent hiding through revision-checked owner commands. Search
never changes metadata; removing sections unassigns bots without changing work.
Hidden attention counts include unfinished tasks outside the newest100 window,
remain reachable during search, and disclose stale observations. SQLite/Worker
and inspected Chromium fixtures cover local behavior. Full native approval and
question coverage remains unverified; roster edits cannot enable execution.

Bot profiles expose name, optional role and instructions with Advanced disclosure.
Duplication creates a new identity without tool grants, skills, routines, memories
or active work; source role/instructions copy only after explicit review consent.
Profile edits retain existing archive state rather than silently unarchiving.
The optional role is bounded descriptive text, not a capability grant. SQLite
tests verify isolated creation and unauthorized-policy rejection; Chromium proves
minimal creation, copy consent, source preservation and same-ID/key retry after
a lost acknowledgment. Per-editor retry identity does not survive closing the
editor or reloading; inspect existing profiles before starting a replacement.
No generated introduction, account connection or model call is added.

Routine editing now starts with frequency/time/day controls and an explicit
timezone; numeric cron remains available under Advanced. The owner-only,
rate-limited `/v1/schedules/preview` calls the same scheduler used for saving and
returns three calendar due times without reconciliation, inference or wake.
Changing a schedule invalidates its reviewed preview; late responses cannot
authorize Save. Existing custom cron, nondefault zones, action policies and
trigger-only routines survive ordinary edits. The current installation default
is Jakarta; importing Singapore routines does not change that default. SQLite
tests cover preview/save equivalence across DST gaps/folds and absent month-end
dates; Chromium checks picker mappings, errors, races, trigger preservation and
narrow rendering. Calendar previews are not runtime admission or execution proof.

[Selected portable templates](PORTABLE_TEMPLATES.md) export configuration into
disabled routines and pending skill proposals with grants removed. This is an
offline review plan, not full backup/restore or automatic migration.

[Offline application SQLite snapshots](CONTROL_BACKUP.md) use the supported online
backup API to preserve one committed state, including WAL-backed rows. Private
output includes schema/count/hash verification and preserves unresolved effects,
locks and identities. This is unencrypted local staging, not live DO extraction,
coordinated native backup, restore admission or complete retention. SQLite may
update shared-memory reader markers even though source DB/WAL bytes remain intact.

[Encrypted snapshot packaging](ENCRYPTED_CONTROL_BACKUP.md) now uses checksum-pinned
upstream age v1.3.2 and explicit recipient/identity references. Decryption waits
for whole-stream authentication and schema/hash verification before publishing a
new private staging directory. Real age tests cover wrong keys, late tampering,
bounded containers, path restrictions and no overwrite. Orb setup and combined
verification install only the reviewed Linux x86_64 release and retain its license.
This remains local staging: no off-host custody/durability, authenticated hosted export,
coordinated shutdown, restore admission or secure-erasure claim. These setup
changes are local until pushed to the project's default branch.

[Cooperative encrypted snapshot creation](CONTROL_BACKUP_CREATION.md) preserves
the verified snapshot's original timestamp and holds the pruning directory lock
through encryption, exclusive publication and inventory update. Explicit
[local pruning](CONTROL_BACKUP_PRUNING.md) revalidates a digest-reviewed inventory
before confirmed deletion. Unknown unlink outcomes and unindexed publication
leftovers block retries for operator reconciliation. Disposable real-age and
filesystem-fault tests verify these local contracts, not off-host durability,
power-cut atomicity, secure erasure or automatic retention compliance.

[Application logical export and reconstruction](CONTROL_EXPORT_IMPORT.md) now
roundtrip the actual local Durable Object through owner HTTP and supported SQL,
including streamed exports larger than1MiB. Schema9 adopts the existing flight
deadline table without dropping revisions, receipts or migration history. Exact
typed rows, int64 values and event sequence high-water marks survive offline
reconstruction into a new private snapshot. The backup verifier retains schema8
compatibility; semantic inspection includes schema9 flight obligations and never
authorizes activation. Hosted authorization, off-host custody, native checkpoint
coordination and restore admission remain unverified.

[Optional-routine budget admission](BUDGET.md) now connects owner-reviewed caps
and optional routine selections to a trusted infrastructure projection ledger.
Missing/stale reports or projections at cap park only unstarted selected scheduled
work; one-run owner overrides bind the exact run and policy revision. Claim/wake
queries enforce the same predicate before LIMIT and across provider-observation
awaits. Bounded alarm maintenance does not depend on execution being enabled.
Admitted attempts/effects/locks remain unchanged; budget exceptions never enable
production gates. SQLite/Worker and inspected Chromium fixtures verify local
behavior, not actual provider bills, quota, seven-day costs or the USD5 target.

`state().monitoring` provides content-free control-plane observations: ready
request counts/age (excluding expired and budget-blocked work), heartbeat age,
unsettled operations grouped by kind/status, unresolved effects, locks,
cancellation/recovery counts and current schedule lag. Alerts use strict
45-second heartbeat, 120-second request-age and five-minute schedule thresholds,
plus immediate uncertainty/deadline notices. Projection reads do not write,
invoke inference or decide admission/sleep. Worker ingress may independently
perform its existing maintenance before the snapshot; schedule lag is current,
not a historical reliability statistic. Request age is original receipt/enqueue
age, including prior waits, not a newly invented queue-entry timestamp.

The portal displays these counts and warnings without replay controls or repeated
live-region announcements for unchanged alerts. `node
scripts/test-portal-monitoring.mjs` covers synthetic empty/active/narrow Chromium
states and zero mutations; the captures were inspected. Coordinated backup
verification remains explicitly unavailable, including after local staging
snapshots. This is not native operation completeness, a metrics/tracing exporter,
connector last-sync verification, backup-age attestation or measured SLO evidence.

Scripted native fixtures demonstrate event routing, exact cancellation, callbacks into local Worker/SQLite, and conservative rejection of root-only completion. They do **not** prove model judgment, authenticated inference, recursive descendant/effect settlement, active-work crash recovery, production service assembly, provider sleep, connector behavior, or hardware permissions.

## Run and verify

```sh
bash .agents/setup
bash scripts/verify-codex.sh
npm ci --prefix desktop
npm test --prefix desktop
```

For focused checks use `npm test`, `npm run test:runtime`, `npm run test:e2e`, and `npm run build`. The build is a dry run and does not deploy. Report current command output rather than historical exact totals. HTTP and scripted-provider tests are not browser, model, account, or production acceptance.

## Remaining gates

WhatsApp selection review (2026-09-16): the exact owner-selected wappmcp subsection
was merged from the coordinating thread without replacing other specification
sections. No package/code was imported or installed. At selected revision
[9a0a39e](https://github.com/vaibhavpandeyvpz/wappmcp/tree/9a0a39e61b2271df1a1d7fc1e198f1e37f66aaf8),
`package.json` ships `patches/` and runs `patch-package` on installation. The patch
`patches/whatsapp-web.js+1.34.7.patch` changes Reaction.js and injected Utils.js:
it normalizes WhatsApp Web `$1` message keys to `_serialized` and repairs send/edit
and last-message lookups. Omitting it can leave undefined message IDs and invalid
IndexedDB lookups on affected Web versions; ignoring install scripts is not a
verified compatibility solution. Require an unmodified supported dependency path
or explicit reviewed policy exception before adoption. Neither exists here yet.

`src/lib/mcp/server.ts` registers reads and mutations unconditionally;
`src/lib/whatsapp/channel.ts` applies its allowlist only to incoming channel events,
with empty lists allowing all and user/chat matches combined by OR. This is not
selected-chat tool authorization. Permission-notification relay is not permission
for these tools. Host-scoped read enforcement and default-denied mutations remain
required engineering. Baseline is MIT, with Apache-2.0 whatsapp-web.js and further
transitive licenses requiring audit before redistribution. Node 24+, Chromium,
QR LocalAuth persistence, account terms, history coverage and sleep cost remain
separate prerequisites/evidence. This static review grants no live pairing,
installation, routine activation, provider provisioning or production readiness.

`runtime/wappmcp-reads.mjs` is an independently written, unregistered host read
boundary based on that revision's public MCP schemas in `src/lib/mcp/server.ts`
(message reads/search), `src/lib/mcp/helpers.ts` (structured result envelope), and
`src/lib/whatsapp/session.ts` (search/default semantics). No upstream code,
dependencies, branding or assets were imported; distribution/license audit remains
required before shipping the upstream package.

`readWappMcp(grant, name, args, call, options = {})` accepts only recent-message reads and scoped
message search. The trusted caller must supply the admitted task's exact chat/tool
grant; model input cannot supply grants. It must also enforce live lease/revocation,
bounded transport, one installation connection and the unresolved installation gate.
The module does not install or expose tools, issue grants, authenticate customers
or replace these outer checks. Empty scope denies; global search, chat enumeration,
contacts and every mutation are unavailable. Calls inject explicit defaults of 50
messages/page 1; limits and search pages are capped at 100, query at 1000 UTF-16
units and grant chat IDs at 100. No automatic paging or retries occur.

Options accept an optional AbortSignal and integer `timeoutMs` from 1 to 120000
(default 120000). The caller must cap this wait to the task's remaining deadline.
Cancellation or timeout raises redacted `WHATSAPP_READ_STOPPED`, aborts an owned
signal passed as the third argument to `call`, and suppresses late results.
Pre-cancelled requests never call upstream; success and failure remove listeners
and timers. The deadline is rechecked before returning validated data. This bounds
local waiting, not upstream execution: a transport may ignore abort. It proves
neither remote cancellation nor settlement, and does not authorize VM sleep.

Responses require bounded structured JSON (1MiB), exact requested chat on every
message, distinct nonempty message IDs, canonical timestamps, and matching search
metadata. Mixed-chat batches fail as a whole. Only message ID/body/timestamp and
requested chat/query/page cross the boundary; upstream text/resource blocks,
attachment paths, contact fields and extra metadata do not. Message body remains
untrusted content, not instructions or authorization. Coverage is always `unknown`:
recent reads have no cursor and search supplies no completeness evidence. This
does not prove history recovery, sender attribution, attachment support or live
WhatsApp compatibility. Synthetic contract tests are not live plugin acceptance.

1. Promote the disposable service composition only after complete operation coverage, safe recovery/resume and warm/cold lifecycle evidence. Disconnect, lease-loss and uncertain-admission fixtures do not establish production recovery.
2. Complete owner-authorized Codex login in the executing environment and verify model eligibility, no paid fallback, bounded inference, restart continuity, refresh ownership, and concurrent-turn behavior.
3. Establish authoritative recursive child/tool/effect settlement and exact cancellation. Root completion or cancellation acknowledgment is insufficient.
4. Complete intent-aware status/new-task/steer/deferred-follow-up behavior and the full portal/mobile/accessibility UX.
5. Verify every connector operation and scope independently, including Calendar writes, Gmail no-send enforcement, WhatsApp coverage, browser persistence, and Mac Messages/device permissions.
6. Complete retention, coordinated backup/restore, portable export/import, reconciliation UI, monitoring, crash tests, seven-day cost evidence, and production Access.

Passive context updates must remain zero-inference/zero-wake. Unknown effects remain parked, admitted work retains pinned policy/context identity, and one customer runtime remains the sole execution authority.
