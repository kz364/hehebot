# Hehebot agent handoff

Hehebot uses direct Codex app-server **0.154.0** only. It has a durable external control plane and a sleeping single-runtime design. It is not deployed or operational; credentials were locally verified, but authenticated inference and production settlement are unverified.

## Active follow-up (2026-09-16)

WhatsApp invocation accounting now has an unregistered journaled read assembly in
`runtime/wappmcp-operations.mjs`. It fsyncs payload-free intent before dispatch,
requires host IDs/deadline/authorization, rejects retained IDs and preserves unknown
outcomes across timeout/SDK rejection/reconstruction. Actual protocol responses
settle invocation only; browser/process termination is independent. Codex operation
snapshots now include these records and retain the unknown coverage blocker.
61 focused tests pass, including eight new journal/dispatch cases. Combined rerun
passed in `.local/wapp-operations-combined.log`: 1,154 control / 270 runtime tests,
all compatibility/native/service/build checks; admission false. A test-only
response-write cancellation expansion then passed the focused and full runtime
suites again (`.local/wapp-operations-runtime-final.log`); desktop 16 tests pass.
No connector is registered or launched. Next: trusted transport wiring and independently
verified browser/process lifecycle; never treat SDK abort/close as termination.

Third wave is delivered/reviewed/applied. Both workers used the uploaded
`.local/next-coverage.bundle` at source local main 9479cb7, not origin/main.
Child worker `T-01a0a864-4f76-7568-979b-816d30d8c194` delivered the fixture and
`docs/CODEX_CHILD_PLAN_EVIDENCE.md`; the actual default child emits message deltas,
not Plan events. Main rerun passed with active message/unknown coverage retained
after exact interruption; no settlement/sleep or child Plan acceptance claim.
SwiftUI worker `T-01a0a864-5c5a-721e-b726-9efe599ca7ad` delivered `macos/` source.
Main additionally installed signature-verified Swift 6.3.3 Debian compiler, ran
four real Foundation XCTest methods, and prepared hash-pinned optional setup.
Five Node checks and plist/shell checks pass. `.agents/setup` with
`HEHEBOT_SWIFT_POLICY_TESTS=1` passed twice (~32s Swift extraction each), as did
policy tests afterward and compiler invocation from a new login shell.
Native app build/render/permissions/login/storage/energy need Mac acceptance;
unsigned packaging does not activate sandbox entitlements. No worker is pending.
Combined integration rerun passed in `.local/native-client-integration-combined.log`:
1,154 control / 262 runtime tests, eight auditor tests, five Mac checks and all
HTTP/native/service/build modes. It includes `--plan-child`; desktop 16 tests pass.
Routine Delete now uses the existing portal editor, not the native confirm API.
The dedicated Chromium fixture passes with confirm disabled: exact ID/revision,
required acknowledgement, Escape/Enter, stale revision/owner/selection/offline
rejection, no reconnect replay and same-editor retry with the original command key.
Two synthetic requests yield one receipt; schedule/recovery fixtures also pass.
Desktop, narrow/offline and uncertain-result screenshots were inspected. This is
not real WKWebView acceptance; native checks remain open. Focused logs are
`.local/routine-delete-{browser,schedule,recovery}.log`.
Combined rerun passed in `.local/routine-delete-combined.log` (1,154 control / 262
runtime tests and all compatibility/native/service/build checks; admission false).
Next transport work must preserve unresolved MCP I/O across SDK timeout/abort;
see IMPLEMENTATION's pinned SDK investigation. No actual connector was launched.
Main owns runtime read-boundary work: `authorize` may now return exact Worker
`{allowed:true,deadline_at}`, tightening but never extending the original cap.
18 focused tests and HTTPS composition pass; combined rerun passed 1,154 control /
262 runtime tests, eight auditor tests and all HTTP/native/service/build checks in
`.local/authority-deadline-combined.log`. Production admission remains false.

Main has implemented scoped WhatsApp authority: operator registry
`HEHEBOT_WHATSAPP_READ_POLICIES` defaults empty; admission captures exact tool/chat
tuples; `whatsapp-read-authorize` intersects pinned/current grants and checks lease,
attempt, deadline and native ancestor state. No MCP tool registration or live
connector yet. 38 focused core tests and 11 ControlClient tests pass. The integrated
verifier passed 1,154 control / 259 runtime tests, seven license-auditor tests,
the scoped-read HTTPS fixture, two crash/reopen cases and all native/service/build
checks (`.local/authority-integration-combined.log`). Desktop 16 tests and the
separate 18-request/two-restart graceful fixture also passed. Gates remain false.

Two independent workers imported `.local/parallel-next.bundle` (source local main
310bac4, not origin/main). Restart worker `T-01a0a841-c306-71c9-b6e4-34d94d4e7c2c`
delivered the crash harness with 100 passing injections. License worker
`T-01a0a841-dfd3-720d-a7c5-76304d75bf78` delivered the artifact inventory. Both are
reviewed/applied; no workers from that second wave remain outstanding. The inventory deliberately exits
2 (review required), with all 350 locations SRI-verified and inspected. Main added
safe alias handling: ten byte/metadata-identical aliases are retained explicitly;
conflicting contents/metadata reject. Eight focused auditor tests pass after this
follow-up, with no installation/extraction or legal approval inferred.
Main's concurrent 100-case rerun timed out on case 4; cleanup deadline was not
confirmed, but subsequent process scan found no workerd survivors. Sequential
rerun passed all 100 injections/reopens in 470,837ms, 50 of each loss mode, with
all child cleanup confirmed (`.local/integrated-crash-sequential-100.jsonl`).
No timeouts or assertions were weakened. A final process scan found no survivors.
No auth-only boundary reached: trusted MCP transport/operation accounting, guided
connector setup, and remaining E01/E02 coverage are still credential-free work.

## Parallel integration checkpoint (2026-09-16)

Four workers imported `.local/parallel-baseline.bundle` from this thread's local
main at 4756984, not origin/main. Main remains sole TODO/integration owner.
Question worker `T-01a0a82c-d786-72fb-9a17-f84d70d69978` delivered
`.local/question-custody.patch` (SHA256
`5a8f06a38e03ceb6635255efab1f582a30ce7a2a68363613858434d4c0e09cec`):
arm the admitted deadline before initial journal read; reviewed/applied, 45 runtime
and 72 core question tests pass locally. Backup worker
`T-01a0a82c-e317-74a6-9343-e24bb42759b9` delivered
`.local/e10-backup-safety.patch` (SHA256
`b1e3cb4fa9265b47ff7dc6a1b1a19e58f6ab2c12e2021383dc08dc024c2e8fda`):
reject impossible sequential pruning states; reviewed/applied, 114 backup tests
pass locally. Neither implies completed recovery or settlement.

Portal worker `T-01a0a82c-ebaf-74ab-b3fd-1e580a92fcb3` delivered stale/offline
recovery guards and browser fixtures. Seeded-race worker
`T-01a0a82c-fc5e-7653-91d0-b268a3951566` delivered 200 drain/effect sequences.
Both patches reviewed/applied; both browser fixtures and 200 seeds rerun locally,
screenshots inspected. All four workers are complete; no deliveries outstanding.

Main added optional bounded before/after host authorization in `readWappMcp`
(15 tests), and an isolated 350-package graph under `config/wappmcp`.
Disposable npm ci with scripts disabled and exact explicit patch passed; full
license audit is NOT complete. See that directory's README for LGPL/missing
declaration findings. There is still no trusted chat-grant representation or
Worker lease/revocation assembly. A callback hook is not that implementation.
Main also closed model-facing command/read task expiry before watchdog: three
red/green cases, 13 focused tests. Full batch passed 1,145 control / 259 runtime
tests, compatibility, HTTP/native/service fixtures and typecheck/build dry run
in `.local/parallel-final-combined.log`. Desktop 16 passed in
`.local/parallel-desktop.log`. No production gate changed. Continue credential-free
work from TODO; completion/auth-only boundary has NOT been reached. No push/deploy.

## WhatsApp task-deadline checkpoint (2026-09-16)

Scoped reads accept optional host `deadlineAt` (canonical UTC) and use the earlier
of task expiry/relative timeout. Invalid/expired values deny I/O; captured deadlines
cannot be extended through options mutation. 11 scoped-read tests passed
(`.local/wappmcp-deadline-focused.log`). Combined verification passed 931 control /
253 runtime tests, WhatsApp/native/service fixtures and typecheck/build dry run
(`.local/wappmcp-deadline-combined.log`). This primitive is not trusted assembly:
task grant/lease/revocation wiring must supply the admitted deadline. Installer,
transport and other credential-free work remain open. No connector activation;
production gates false and schedule unchanged.

## Approved WhatsApp patch checkpoint (2026-09-16)

Owner-approved exception merged from the coordination thread into AGENTS/SPEC,
preserving local progress and authority guidance. Earlier no-exception blockers
below are superseded. Only revision 9a0a39e61b2271df1a1d7fc1e198f1e37f66aaf8's
exact patch on whatsapp-web.js 1.34.7 is approved; no pairing/activation permission.
`scripts/verify-wappmcp.mjs` pins artifact/patch SHA256, checks distributed/source
equality and clean application, executes actual patched key/message/last-message
functions with synthetic models, denies the 20 other upstream tools and runs 9
scoped-read tests. Focused check passed; combined verification passed 931 control /
251 runtime tests, WhatsApp/native/service fixtures and typecheck/build dry run
(`.local/wappmcp-approved-combined.log`). Provenance/hashes/limits are recorded in
IMPLEMENTATION.md. No connector was installed or started; temporary trees clean up.
Next E09 work: transitive locked installation/license audit and trusted scoped
transport/setup. Live pairing, reconnect/coverage and cost require separate authority.
Production gates false; schedule unchanged.

## Resource-deadline checkpoint (2026-09-16)

Expired attempts cannot acquire new locks, including before watchdog reconciliation.
Exact held-lock replay and authorized release remain unchanged; released locks
cannot be reacquired after expiry. Three red/green cases and 91 focused lifecycle/
orchestration/root-child tests passed (`.local/resource-deadline-focused.log`).
Combined verification passed 931 control / 251 runtime tests, native/service fixtures
and typecheck/build dry run (`.local/resource-deadline-combined.log`).
Complete E01/native termination and other credential-free work remain open.
Production gates false, no provider use, schedule unchanged.

## Effect-cancellation checkpoint (2026-09-16)

First effect dispatch rechecks running task and admissible descendant ancestry,
closing cancellation between intent and dispatch. Late outcomes/acknowledgements
remain recordable; locks and unrelated work stay untouched. Four red/green cases
and focused effect/root-child/recovery tests: 39 passed
(`.local/effect-cancel-focused.log`). Combined verification passed 928 control /
251 runtime tests, native/service fixtures and typecheck/build dry run
(`.local/effect-cancel-combined.log`). Complete native cancellation and other
credential-free work remain open. Production gates false; schedule unchanged.

## Effect-deadline checkpoint (2026-09-16)

New effect intents/first dispatches reject at the attempt deadline even before
watchdog reconciliation. Existing receipt lookups and late outcome recording keep
their previous semantics; none authorizes external replay. Both new cases failed
before the fix, then 35 focused effect/root-child/recovery tests passed
(`.local/effect-deadline-focused.log`). Combined verification passed 924 control /
251 runtime tests, native/service fixtures and typecheck/build dry run
(`.local/effect-deadline-combined.log`). Complete E01 coverage/native termination and
other credential-free work remain open. No provider or production-gate changes;
schedule unchanged.

## Late-start checkpoint (2026-09-16)

First native start acknowledgement at/after hard deadline now retains the native
receipt while setting run cancellation intent. Attempt stays running/unsettled;
acknowledgement replay does not reset grace. Focused lifecycle/orchestration/task
control: 82 passed, with before/exact/after boundaries and heartbeat/replay checks
(`.local/late-start-focused.log`). Exact child boundary failed before the fix.
Combined verification passed 922 control / 251 runtime tests, native/service fixtures
and typecheck/build dry run (`.local/late-start-combined.log`). E01 native
termination and other credential-free work remain open. No provider or production
gate changes; schedule unchanged.

## Disabled-admission retry checkpoint (2026-09-16)

Due automatic retries now survive disabled execution instead of losing their timer.
Cancelled work still discards stale retry entries; re-enablement queues once.
Two red/green regression cases and the focused recovery/lifecycle suite passed
66 tests (`.local/disabled-retry-focused.log`). Combined verification passed 919
control / 251 runtime tests, native/service fixtures and typecheck/build dry run
(`.local/disabled-retry-combined.log`). Existing Worker alarm filtering prevents
disabled retry polling. Full recovery and other credential-free work remain open;
no provider use or gate changes, schedule unchanged.

## Terminal-cancellation follow-up checkpoint (2026-09-16)

Owner cancellation of queued/waiting work now checks pending follow-ups through
existing descendant settlement. Active/recovery cancellation does not flush. The
waiting-checkpoint fixtures prove immediate delivery or live-grandchild deferral,
target isolation and no duplicate continuation. Focused orchestration/retention/
recovery suite: 26 passed (`.local/cancel-followup-focused.log`). Combined verification
passed 917 control / 251 runtime tests, all native/service fixtures and typecheck/
build dry run (`.local/cancel-followup-combined.log`). Native checkpoint/restart and
full E03 acceptance remain open, as does other credential-free work. No provider
use or production-gate change; schedule unchanged.

## Explicit-retry timer checkpoint (2026-09-16)

Accepted owner retry atomically clears the superseded automatic retry entry.
Otherwise a second failure before the old timer fired could inherit a 10-second
first-attempt deadline instead of its 60-second backoff. Focused tests cover
rejected retry, new-attempt timing, old receipt replay and −1ms/exact due boundary:
64 recovery/lifecycle tests passed (`.local/retry-timer-focused.log`). Combined check
passed 915 control / 251 runtime tests, all native/service fixtures and typecheck/
build dry run (`.local/retry-timer-combined.log`). Retry safety checks/limits remain;
no provider use or production-gate change. Full recovery remains open; schedule
unchanged.

## Recovery-cancellation checkpoint (2026-09-16)

Owner cancel now leaves recovery-required work in recovery rather than starting
another cancelling grace period. Heartbeat already delivers these cancellation IDs.
The owner intent/event still records; active operation, attempt, unknown effect and
lock custody stay untouched. Focused recovery/lifecycle/control tests: 170 passed;
log `.local/recovery-cancel-focused.log`. Combined check passed 914 control / 251
runtime tests, all native/service fixtures and typecheck/build dry run
(`.local/recovery-cancel-combined.log`). No settlement/replay, provider activity or
production gates changed. Successful recovery and other credential-free work
remain open; schedule unchanged.

## Cancellation-grace checkpoint (2026-09-16)

Owner cancel and captured-memory purge/expiry now preserve `updated_at` when a run
is already cancelling: it is the watchdog's original 30-second grace anchor, not a
fresh update timestamp in that state. New audit events and privacy purges still
occur. Tests cover distinct owner commands and two staggered memory removals via
expiry/delete, before/exact original boundary, unsettled attempts and no retry.
Focused recovery/memory/lifecycle suite: 68 passed (`.local/cancel-grace-focused.log`).
Combined verification passed 913 control / 251 runtime tests, all native/service
fixtures and typecheck/build dry run (`.local/cancel-grace-combined.log`). No migration,
provider use or production-gate change. Native termination and remaining E01/E02
work are still open; schedule unchanged.

## Snapshot-fencing checkpoint (2026-09-16)

Expanded supervisor integration verifies real journal/projection/SQLite rejection
after valid work was already persisted. Orphan timing, null inventories, malformed
completion and a new start beyond the hard deadline all fence execution without
altering prior runs/attempts/operations, journal bytes or leases. Timer stops;
further dispatch/maintenance reject without native replay, cancel or hold release.
Focused suite: 55 passed (`.local/snapshot-fencing-focused.log`); combined check
passed 910 control / 251 runtime tests, all native/service fixtures and typecheck/
build dry run (`.local/snapshot-fencing-combined.log`). Tests only; successful recovery,
provider termination and E01/E02 acceptance remain open. Schedule/gates unchanged.

## Worker operation envelope checkpoint (2026-09-16)

Heartbeat now enforces start ≤ operation deadline ≤ authenticated attempt deadline
and progress ≥ start, after UTC normalization. Invalid new records roll back the
page and lease. Late completion progress remains reportable without extending
deadlines. Focused lifecycle/projection integration: 63 passed; log
`.local/operation-envelope-focused.log`. Combined check passed 907 control / 251
runtime tests, all native/service fixtures and typecheck/build dry run
(`.local/operation-envelope-combined.log`). No schema migration, provider activity or
production gate change. E01 progress policy/termination and other credential-free
work remain open; schedule unchanged.

## Interrupted-spawn checkpoint (2026-09-16)

Heartbeat projection and offline inspection now agree with the adapter/pinned
schema that `spawnAgent: interrupted` is a terminal invocation state. Receivers,
startup clocks, active child work, unknown coverage and missing-turn warnings stay
independent. Root/nested projection and offline tests passed in an 89-test focused
rerun. Initial failures were fixture expectations, documented in IMPLEMENTATION.
Logs: `.local/interrupted-spawn-focused.log`,
`.local/interrupted-spawn-focused-rerun.log`; combined verification passed 903
control / 251 runtime tests, all native/service fixtures and typecheck/build dry run
(`.local/interrupted-spawn-combined.log`). This is not live interrupted-spawn or
recursive termination proof. Production gates/schedule unchanged; E01 remains open.

## Operation inventory integrity checkpoint (2026-09-16)

Codex heartbeat projection now rejects null/scalar/array observation maps and
malformed child owners with `INVALID_OPERATION_INVENTORY`. Absent legacy fields
and empty maps remain supported. Runtime tests cover 200 malformed combinations;
SQLite integration confirms rejected projection leaves operations and lease
unchanged. Focused results: 25 runtime / 8 control tests, logs
`.local/inventory-focused.log` and `.local/inventory-control.log`. Combined check
passed 903 control / 249 runtime tests, all native/service fixtures and typecheck/
build dry run (`.local/inventory-combined.log`). No repair/replay, native settlement,
provider operation or production-gate change. E01 and other credential-free work
remain open; schedule unchanged.

## Overlapping-stream watchdog checkpoint (2026-09-16)

The SQLite integration suite now checks message/plan streams with distinct
deadlines in both completion orders. Exact deadline and 30-second unconfirmed
cancellation boundaries hold despite repeated heartbeats; no operations settle,
retry is queued or sleep allowed merely because cancellation timed out. Eight
focused tests passed in `.local/overlap-watchdog-focused.log`; combined verification
passed 903 control / 248 runtime tests, all native/service fixtures and typecheck/
build dry run (`.local/overlap-watchdog-combined.log`). No runtime behavior changed.
Native held-stream expiry and actual process termination remain unverified; the
test does not establish the separate 15-second cancel/verify stages. E01 and other
credential-free work remain open. Production gates and schedule remain unchanged.

## Message completion integrity checkpoint (2026-09-16)

Live operation projection and offline inspection now reject malformed completion
maps and digests instead of treating an output key as sufficient settlement.
Root/child and exact-item isolation, unknown coverage and read-only inspection
remain intact. This validates structure, not journal authenticity or safe recovery.
Verification: 44 focused tests; `bash scripts/verify-codex.sh` passed 901 control /
248 runtime tests, all native/service fixtures and typecheck/build dry run. Logs:
`.local/output-completion-focused-final.log`, `.local/output-completion-combined.log`.
Local only; no provider activity or production-gate change. E01 remains next:
complete streaming/recursive coverage, declared longer windows, progress policy
and verified termination. Credential-free work remains; no auth boundary reached.

## Resume

1. Read `AGENTS.md`, `README.md`, `TODO.md`, `SPEC.md`, `PRODUCT_UX_SPEC.md`, `docs/PROJECT_INTENT.md`, and `docs/IMPLEMENTATION.md`.
2. Run:

   ```sh
   bash .agents/setup
   bash scripts/verify-codex.sh
   npm ci --prefix desktop
   npm test --prefix desktop
   ```

3. Report current output without carrying forward old test totals. Scripted model fixtures are execution-contract evidence only.
4. Update [the owner-facing TODO](../TODO.md) at each substantive checkpoint: date, task status, verification, next priority and exact account/device blockers. Do not wait for the owner to ask for progress. Keep unverified acceptance open and distinguish local from published changes.

## Native question checkpoint (2026-09-15)

Owner question custody, explicit portal answers, and default-off disposable service binding are integrated; see [binding contracts](CODEX_QUESTION_BINDING.md). The original combined checkpoint passed 781 control tests and 162 runtime tests, including pristine native → service → HTTPS Worker/SQLite → owner answer → exact next-context delivery. Independent question/RPC deadlines preserve the short RPC bound. Native resolution remains distinct from answer consumption and task settlement. Unknown take outcomes never replay. Owner-only stopped-question closure now preserves uncertainty separately from native resolution, with exact original termination and revision checks; it changes no task/effect/lock or native journal. Retry/claim/recovery closure reject unresolved questions. See [custody contracts](NATIVE_QUESTION_CUSTODY.md). Full provider recovery, journal retention, authenticated inference, and production admission remain unproved. No production flags changed.

## Boundary ownership

| Boundary | Ownership |
|---|---|
| `src/worker/`, `src/core/`, `DB/` | Durable ingress, identities, revisions, policies, schedules, memory, effects, locks, epochs, and leases |
| `runtime/codex-*` and journal modules | Pinned app-server transport, native event identity, submit/steer/cancel uncertainty, and scoped tools |
| supervisor/bridge and Sprite modules | Claim/submission custody and provider activity; production assembly remains unfinished |
| `public/`, `desktop/` | Portal and remote-only Electron shell; desktop is not an execution authority |

Heartbeat renewal now rechecks local authority before and after operation
collection and after the control response. A response received at or after the
previous local lease expiry cannot revive admission, even if the Worker renewed
on time. Startup permits initial lease acquisition but rejects replies after
disconnect. SQLite supervisor tests cover expiry during activity, collection and
response delivery; recovery retains the provider hold. This conservative local
fence does not implement successful warm-resume or alter Worker lease authority.

Lost Worker submission acknowledgments now permit one exact registration retry
under the original live lease. No native admission or claim is replayed; repeated
loss fences the executor. Identical already-registered receipts preserve later
cancellation/terminal state without writes. The combined credential-free check
passed 839 control and 171 runtime tests plus native/service fixtures and build;
the new `--submission-ack` fixture observed one native launch, two model requests,
and two identical HTTPS registration requests after dropping the first reply.
This does not establish production settlement or restart recovery.

Operation snapshots now retain up to 4096 observations and send all of them in
100-record heartbeat pages under the original local lease. Partial failures fence
admission, with no local renewal or hold release. The actual native fixture ran
101 read-only MCP calls, verified every receipt, and delivered 103 operations in
pages of 100 and 3. The combined check passed 848 control and 171 runtime tests,
native/service fixtures and build. Unknown coverage still blocks settlement/sleep;
this is not unlimited retention or multi-root admission.

Offline snapshot inspection now includes native-question custody: unresolved
questions survive expiry/termination in the report; original attempt, scope and
closure relationships are checked without exposing content or authorizing replay.
It remains a bounded semantic diagnostic, not the full ledger payload validator or
coordinated restore proof. Focused tests passed 86; the latest control suite passed
864, with typecheck/build and 16 desktop tests also passing. Prior full native/runtime
verification for the heartbeat checkpoint remains recorded above.

Native tool and spawn invocations now retain host-observed start/progress clocks
and use two-minute phase deadlines capped by the task hard deadline. Buffered
events retain receipt time; duplicate events/history reads never restart clocks.
Corrupt timing and backwards live transitions fence without repairing custody.
Spawn completion does not settle its child. The combined credential-free check
passed 865 control and 183 runtime tests, native/service fixtures and build;
focused timing tests passed 66. Actual native fixtures cover 101 MCP calls and
independent child cancellation. No account or live Sprite calls were made.
Legacy/history-only records keep the hard-deadline fallback. Quiet inference,
explicit longer shell/transfer windows and progress-based extensions remain
unimplemented; do not call this full S19, settlement or production readiness.

Heartbeat operation timestamps now canonicalize to UTC milliseconds before
storage. Equivalent offset replays preserve original instants; changed kind,
start/deadline or backwards progress rejects the whole page without renewing the
lease. Retained offset rows canonicalize only on authorized equivalent replay;
this is not a bulk repair or restore migration. Seven new regressions failed
before the fix. Final focused lifecycle/Worker HTTP checks passed 59 tests;
the final control suite passed 877 tests and typecheck passed. The combined
credential-free verifier passed 872 control and 183 runtime tests plus all
native/service fixtures and build before five additional boundary tests were
added and included in the final control run. Production gates remain false.
No account calls, live provider changes, pushes or deployments were made.

Reasoning-item checkpoint (2026-09-15): exact root/child `reasoning` item boundaries
now retain host-observed five-minute phase clocks capped by the task deadline.
Only identity/status/times enter the host journal, never reasoning content or
deltas. Root completion does not erase unfinished reasoning, and the offline
inspector now includes those obligations. Two new regressions failed before the
change; 68 focused router/adapter/projection tests passed afterward. The actual
native `--reasoning` fixture passed with two scripted model requests and an
accepted HTTPS Worker heartbeat. The combined verifier passed 877 control and
185 runtime tests, all native/service fixtures, typecheck and build dry run.
E01 remains open for before-start silence, progress extensions, longer declared
shell/transfer bounds and complete coverage. Native reasoning history is not
erased by host projection. Production gates remain false; no live accounts,
provider operations, pushes or deployments were used.

Initial-response checkpoint (2026-09-15): new acknowledged submissions persist
`initialInference`, projected as a five-minute phase from original claim, capped
by the task deadline. Root acknowledgment and child events do not end it; exact
root item/terminal observations do, atomically with the observation. Reopen and
duplicate submission never restart it. Legacy markers are not invented.
Two regressions failed before implementation. Focused runtime checks passed 83;
Worker/lifecycle checks passed 54, including the exact five-minute boundary.
The first combined run found a stale native-fixture count; the added initial phase
was verified as an independent settled inference record, and the targeted rerun
passed. Final combined verification passed 878 control / 188 runtime tests, all
native/service fixtures, typecheck and build. The 101-MCP-call fixture now delivers
104 operations in 100+4 pages. Initial root silence is bounded, not every later
quiet interval or child startup. E01 remains partial; production stays disabled.
No accounts, live provider operations, pushes or deployments were used.

Child initial-response checkpoint (2026-09-15): newly observed child starts retain
`initialInference` and immutable `initialInferenceAt` in their own obligation row.
Five minutes from host receipt, capped by the task deadline; root activity cannot
end it. Exact child item/terminal observation or terminal readback ends only this
phase, leaving tools/effects untouched. Replay never restarts it; legacy clocks
are not invented. Offline inspection validates and reports the pair.
Focused runtime checks passed 87 and Worker checks passed 4, including exact
five-minute cancellation. The native service fixture observed the active phase
after parent completion while withholding the child's first response, then
verified seven heartbeat operations with unknown coverage still blocking sleep.
Two combined attempts found stale metadata/count expectations; those assertions
now require the new independent phase while retaining tool/sibling custody checks.
Final `bash scripts/verify-codex.sh` passed 879 control / 192 runtime tests, all
native/service fixtures, typecheck and build. E01 remains partial for later quiet
gaps, time before child-start notification, progress extensions and full coverage.
No accounts, live provider operations, pushes, deployments or gate changes.

Offline-clock checkpoint (2026-09-15): recovery observations now include optional
`timing: {startedAt,lastProgressAt}` copied only from validated stored clocks.
Canonical UTC, nondecreasing progress and exact owner/category/item keys are
required, including nested collaboration keys. Orphan/invalid clocks invalidate
the native report; missing legacy clocks remain absent. No deadline/expiry or
resume authority is inferred. Additional stored fields never enter the report.
Two regressions failed before implementation; 17 focused tests passed afterward,
covering every category, root/child isolation, corruption, redaction and no writes.
Eleven actual native service scenarios preserve MCP timing after shutdown.
`bash scripts/verify-codex.sh` passed 879 control / 195 runtime tests, all
native/service fixtures, typecheck and build. E01/E02 remain partial; next work
remains deadline coverage and successful fenced recovery, not merely inspection.
No accounts, live provider operations, pushes, deployments or gate changes.

Native-usage checkpoint (2026-09-15): supported `thread/tokenUsage/updated`
notifications retain normalized `tokenUsage` under the exact root or observed
child turn. `total`/`last` include six nonnegative safe-integer counters; the
pinned optional cache-write field defaults to zero, context window to null.
Unknown usage stays absent. Snapshots replace, never sum/max; compaction/replay
may lower or repeat observations. Identical normalized snapshots do not write.
Usage never ends initial inference, changes operation clocks or settles work.
Offline inspection validates/reports the snapshot without extra stored content.
This is not billing, freshness proof or complete task usage; see pinned-source
links in CODEX_SERVICE.md. No Worker/UI publication or aggregation yet.
Focused runtime checks passed 77. Eleven native service scenarios preserve exact
asymmetric fields (31 input, 7 cached, 13 output, 5 reasoning, 44 total).
Combined verification passed 879 control / 198 runtime tests, all native/service
fixtures, typecheck and build. E11 remains partial; E01/E02 gaps remain open.
No accounts, paid inference, live provider operations, pushes, deployments or
gate changes were used.

Drain-fence checkpoint (2026-09-15): every asynchronous drain return now checks
the draining phase and original lease. Previously, disconnect during hold release
could be overwritten by `sleeping`; expiry after commit could still initiate release.
Seven regressions failed before the fix. Tests cover disconnect/exact expiry after
prepare, commit, committed-journal write and release; success remains allowed one
millisecond before expiry. Once fenced no new commit/release/retry starts. An
already-started release can still complete; host recovery does not claim retention.
Focused supervisor/lifecycle/control acceptance passed 199 tests, including the
existing 100 seeded queue/stop interleavings (not complete effect-race proof).
First combined run found a question fixture's 30 ms I/O timeout preempting its
intended handoff failure under load. It now uses a bounded larger setup allowance,
requires exact persisted phase/call counts and proves the handoff hook was reached.
Its 28 tests passed. Final combined verification passed 888 control / 198 runtime
tests, all native/service fixtures, typecheck and build. No accounts, live provider
operations, pushes, deployments or production gate changes. E02 remains partial.

Drain-custody checkpoint (2026-09-15): the queued drain snapshots its checkpoint
to a nonempty JSON object before its first await. The same detached value goes
to the intent journal and controller commit. Invalid serialization rejects before
prepare and permits a subsequent valid call. `putIfAbsent` must return null for
new insertion; any returned prior intent causes `DRAIN_REPLAY_FORBIDDEN` and
recovery, with prior contents preserved and no commit/release. Preparation may
already have happened; the host does not infer rollback or automatically retry.
Three initial regressions failed before implementation. The final focused run
passed 205 supervisor/lifecycle/seeded-control tests, covering mutation at three
await boundaries, prior unknown/committed records and malformed checkpoints.
Combined verification passed 894 control / 198 runtime tests, all native/service
fixtures, typecheck and build. This remains single-executor FileJournal behavior,
not successful native recovery or live provider sleep. E02 stays partial.
No accounts, live provider operations, pushes, deployments or gate changes.

Journal-record checkpoint (2026-09-15): live FileJournal now returns null only
for ENOENT; malformed JSON and parsed null/scalar/array records raise fixed
`INVALID_JOURNAL_RECORD` without echoing contents. This closes falsey existing
intent overwrite through putIfAbsent. Writes and patches must encode as JSON
objects before file creation; nested null/false/zero and undefined update-field
omission remain valid. There is no schema/authenticity proof or automatic repair.
Seven regressions failed before implementation. Nine journal tests passed with
unchanged corrupt bytes/mtime and no new temporary artifacts; 49 supervisor tests
passed, including null drain corruption retaining recovery and blocking commit
and release. Final combined verifier passed 895 control / 205 runtime tests,
all native/service fixtures, typecheck and build. E02 remains partial; existing
single-executor/provider/OS-lock assumptions remain. No accounts, live provider
operations, pushes, deployments or production gate changes.

Child-startup checkpoint (2026-09-15): terminal spawns with host clocks project
one two-minute child startup operation per receiver, capped by the task deadline.
Start/progress use the retained spawn lastProgressAt, never a heartbeat time.
Exact valid child-turn evidence settles startup only, even if received before
spawn completion; parent and sibling completion do not. Nested and failed spawn
receivers retain independent obligations; legacy missing clocks are not invented.
History-only completion conservatively uses the earlier retained live clock.
Two regressions failed first; 41 adapter/projection and 5 SQLite watchdog tests
passed, including exact expiry. Native fixtures verify clock identity and retained
startup settlement. Combined verification passed 896 control / 207 runtime tests,
all native/service fixtures, typecheck and build after correcting an outdated
native count assertion and a test-update variable error. Production stays off.
Next quiet-gap work needs explicit ordered journal phases, not inference from
equal wall-clock timestamps of parallel tool completions. No code for that next
phase has been added. No accounts, live providers, push or deployment involved.

Live-clock checkpoint (2026-09-15): heartbeat projection now consumes every
operationTimes entry within its exact root/child owner and canonical category/item
key. Leftovers reject the entire snapshot as INVALID_OPERATION_TIMING, matching
the offline inspector's refusal. Valid nested collaboration keys and identical
IDs across owners remain independent; missing legacy clocks retain fallback.
Two regressions failed first. Final focused checks passed 39 projection/inspection
and 50 supervisor tests. Corrupt bytes/mtime remain unchanged; maintenance fences
before heartbeat, releases no hold and replays no native work. Combined verifier
passed 897 control / 210 runtime tests, all native/service fixtures, typecheck and
build. This is structural consistency, not journal authentication or successful
recovery. Quiet-period implementation remains next; no new phase state added.
No accounts, live provider operations, pushes, deployments or gate changes.

Checklist audit checkpoint (2026-09-15): reviewed SPEC §§9–11/21, UX01–15 and
orchestration/project intent against current code. TODO E06 now explicitly retains
selected-tokenizer budgets, summaries, retrieval and native scope isolation;
E09 retains curated install workflows; E10 retention policy/diagnostic expiry and
forget-everywhere boundaries; E13 idle adapter/version/provider migration. New E15
records numeric load, crash, privacy, browser and recovery acceptance. No requirement
was removed or weakened. The 5-writes/s target versus 60 owner writes/minute limit
needs an explicit workload interpretation, not a disabled limiter.

Implemented the missing local 1,000-publication volume checks: stopped control
reconstruction/ticks/provider drive retain zero wake calls and no runs; idle and
busy supervisors retain zero additional native submissions through maintenance
and dispatch. The busy task/attempt are byte/value-identical, with no cancellation
or follow-up. Recipient delivery is asymmetric, paginated and deduplicated without
consumption. Focused control/supervisor tests passed 159; combined verifier passed
900 control / 210 runtime tests, all native/service fixtures, typecheck and build.
These are synthetic local checks, not the required staging trace, full latency
measurements or proof of production model behavior. Runtime code/gates unchanged.
Continue E01 quiet phases, then E02/E03; context packaging and E15 harnesses are
also credential-free. Preserve exact external blockers in TODO. No account calls,
live provider work, push or deployment occurred.

Quiet-phase journal stage (2026-09-15): adapter records content-free quietPhases
per exact root/child owner after the last observed live item finishes. Native
observation order handles equal timestamps; duplicate/history item reads do not
advance phases. Exact turn termination/readback closes that owner's phases, never
a child's through parent completion. Shapes, canonical IDs/times, one active phase,
4096 retained phases and owner references validate without repair. Inspector adds
quietInference observations. Tests passed 82 focused; combined passed 900 control /
215 runtime tests, all native/service fixtures, typecheck and build. Eight native
service cases observed the new records. This stage does NOT project heartbeat
deadlines; next work connects those records to capped five-minute inference
operations and exact-expiry tests. Post-message/unknown-item and human-wait coverage
remain explicit gaps. No accounts, live provider work, push/deploy or gate changes.

Quiet-phase projection checkpoint (2026-09-15): those journal observations now
produce independent inference heartbeat operations, capped at original start plus
five minutes or the task hard deadline. Replay/reopen never refreshes progress.
Focused tests passed 26 runtime plus 6 SQLite projection/watchdog tests, including
exact expiry and distinct root/child bounds. `bash scripts/verify-codex.sh` passed
901 control / 216 runtime tests, all native/service fixtures, typecheck and build.
Private logs are `.local/quiet-projection-focused.log` and
`.local/quiet-projection-combined.log`. Native fixtures withhold model responses
to inspect active post-tool bounds and account for variable parallel-completion
quiet counts in complete heartbeat pages. No new progress is inferred from reads.
Continue E01 human-wait interactions and post-message/unknown-item coverage;
explicit longer operations and progress policy remain open. Unknown coverage
still blocks completion/sleep; no provider/account calls or gate changes.

Post-message deadline checkpoint (2026-09-15): live completed assistant messages
now open quiet phases keyed by outputItems/message ID, using the existing capped
five-minute projection. Duplicate/history messages do not refresh clocks, active
tools prevent false idle phases, and terminal owners cannot reopen phases. Root
completion does not settle a child's message phase. Focused checks passed 71;
combined verification passed 901 control / 219 runtime tests, all native/service
fixtures, typecheck and build. Seven native service cases observed message phases.
Private evidence: `.local/message-quiet-focused.log` and
`.local/message-quiet-combined.log`. Continue with human-wait handling and
streaming/unknown-item coverage; no full E01 or production acceptance is claimed.

Owner-requested activity timing (2026-09-16): quiet phases now optionally retain
their first live `endedAt`; offline inspection exports `durationMs`. Legacy and
history-only closures remain unmeasured. Replay cannot overwrite an end or refresh
heartbeat progress. Tests passed 72 focused and 901 control / 220 runtime combined,
with all native/service fixtures, typecheck and build. Evidence lives in ignored
`.local/quiet-activity-focused.log` and `.local/quiet-activity-combined.log`.
No added polling or provider calls; no rollout, shorter timeout or gate changes.
These measurements are native-event silence, not CPU idle or billing. Real workload
collection and safe timeout/sleep analysis remain explicit E11 work.

Message-start checkpoint (2026-09-16): router forwards only IDs for live assistant
message starts. Adapter retains bounded validated markers and opens the existing
five-minute phase until the next boundary/terminal observation. Replay, deltas and
history-only starts cannot refresh it; start text is excluded. The initial focused
run caught an obsolete assertion that starts were ignored; it now checks exact
ID-only projection. Final verification passed 68 focused tests, 901 control /
222 runtime combined tests, all native/service fixtures, typecheck and build.
Seven native service cases observed starts. Private logs:
`.local/message-start-focused.log`, `.local/message-start-combined.log`.
Overlapping-stream lifetime accounting and human waits remain E01; no gate changes.

Question-wait checkpoint (2026-09-16): service binding/transport ceilings now agree
at 300000ms per SPEC, with ordinary RPCs still 10000ms. New question journal rows
retain immutable callback entry and task-capped deadline; inspection accepts old
rows without backfill and exposes only timing/phase. Tests passed 60 focused,
901 control / 223 runtime combined, all native/service fixtures, typecheck/build.
Native answer and cancellation cases verify five-minute stored windows. The first
focused failure was a test looking outside the service's journal subdirectory;
the corrected fixture reads actual persisted custody. Private logs:
`.local/question-wait-focused.log`, `.local/question-wait-combined.log`.
Worker custody may outlive the callback. Explicit restart-required UI, checkpoint
parking, coordinated cancellation and compute release remain E01/E02. No gates,
account/provider deployment or replay permissions changed.

Question initialization deadline correction (2026-09-16): the abort timer now
uses the effective task-capped deadline immediately after binding, before initial
journal/record awaits. Previously the stored deadline was capped but those awaits
could leave the callback pending until a longer timeout. Deterministic held-I/O
tests assert pending at 499ms, aborted at 500ms, and no take/false resolution after
late release. Verification: 66 focused tests; 901 control / 225 runtime combined,
all native/service fixtures, typecheck/build. Private logs are
`.local/question-deadline-focused.log`, `.local/question-deadline-combined.log`.
This does not cancel already-started I/O, settle native work or enable sleep.

WhatsApp read-boundary checkpoint (2026-09-16): independently written
`runtime/wappmcp-reads.mjs` permits only bounded selected-chat recent messages and
search using host-supplied task grants. Mutations/global search deny before calls;
mixed-chat or invalid response metadata rejects the entire result. Minimal
ID/body/timestamp records exclude extra payloads and always report unknown coverage.
The optional fifth argument accepts `signal` and `timeoutMs` (1–120000ms,
default 120000). Upstream receives an owned abort signal; late results are ignored.
The caller must cap the wait to its task deadline. Local timeout/cancellation is
not proof of remote cancellation, settlement or safe VM sleep.
Nine focused tests (including 16 denied variants) and combined 901 control / 234
runtime tests passed, with all native/service fixtures, typecheck/build. Logs:
`.local/wappmcp-timeout-focused.log`, `.local/wappmcp-timeout-combined.log`.
No tool registration/installation/pairing occurred. Outer trusted authority,
lease/revocation, bounded transport and setup integration remain; patch policy still
blocks upstream installation. See IMPLEMENTATION.md for pinned source provenance
and contract limits. Do not wire this directly to model-provided grants.

Unsupported native-item checkpoint (2026-09-16): the live router now fences
unsupported item starts/completions, including unknown collaboration tools and
missing types, before buffering payloads. User-message echoes remain ignored.
The existing service recovery callback disconnects admission; no native termination,
settlement or safe sleep is inferred. This intentionally refuses schema-advertised
variants without a host projection as well as unknown future variants. It is not
complete E01 operation coverage. Verification: 63 focused tests; combined 901
control / 237 runtime tests, all native/service fixtures, typecheck and build.
Private logs: `.local/unknown-item-focused.log`, `.local/unknown-item-combined.log`.

Quiet-clock regression checkpoint (2026-09-16): `advanceQuietPhases` checks
recorded ends as well as starts before accepting a live timestamp. A new operation
one millisecond before a closed interval's end rejects without journal writes for
both root and child; exact-end timestamps remain valid. Legacy unknown ends are
not reconstructed. This protects chronology, not complete streaming coverage or
VM idle/cost measurement. Verification: 74 focused tests; 901 control / 240 runtime
combined, native/service fixtures, typecheck and build passed. Private logs:
`.local/quiet-regression-focused.log`, `.local/quiet-regression-combined.log`.

Plan-item checkpoint (2026-09-16): the generated 0.154.0 `PlanThreadItem`
schema defines experimental `plan` with ID/text and no status enum. The host now
projects only ID/type at boundaries and stores `planItems` lifetimes/clocks;
text/deltas are discarded. Root/child/category identities, replay stability,
five-minute task-capped inference bounds and offline clocks pass synthetic tests.
Root completion never settles a still-open plan. No Plan/experimental setting,
tool permission or production gate is enabled. Native Plan-item emission was
unverified at this checkpoint; the follow-up below closes the root case. Verification: 95 focused tests; 901 control / 242
runtime combined, all existing native/service fixtures, typecheck/build passed.
Private logs: `.local/plan-item-focused.log`, `.local/plan-item-combined.log`.

Native Plan follow-up (2026-09-16): `--plan` fixture requests experimental API and
Plan mode only in its disposable transport wrapper. Pristine Codex emits actual
root Plan boundaries from a scripted `<proposed_plan>` response, after an exact
MCP receipt. Two model requests; host/Worker clocks, preview privacy and offline
inspection passed. Initial preview mismatch was the preserved pre-plan newline,
not leaked plan content; corrected exact expectation passed. Combined verification
now includes this case and passed 901 control / 242 runtime tests, native/service
fixtures and typecheck/build. Logs: `.local/plan-native-focused.log` and
`.local/plan-native-combined.log`. Native child Plan emission and held-stream expiry
remain open. No runtime configuration or production gate changed.

Open Plan stream follow-up (2026-09-16): the response writer now supports an
awaited hold before the closing plan tag. While native generation is open, the
fixture checks active five-minute accounting against the exact plan ID, an
unsettled root, no retained plan text and unchanged progress on reread. It releases
the tag and verifies normal completion. Focused fixture passed with two model
requests; combined passed 901 control / 242 runtime tests, all native/service
fixtures and typecheck/build. Logs: `.local/plan-stream-focused.log`,
`.local/plan-stream-combined.log`. This is not watchdog expiry or forced native
termination evidence; those and child Plan emission remain open.

Plan-delta follow-up (2026-09-16): the fixture now emits another plan-text chunk
before closure and waits for native `item/plan/delta` with exact thread/turn/item
and canary text. The journal and original clock remain unchanged, and a successful
Worker heartbeat carries that active clock. Synthetic delta method spelling was
corrected. Verification: 42 router tests, two-request native Plan fixture, combined
901 control / 242 runtime tests, all native/service fixtures and typecheck/build
passed. Logs: `.local/plan-delta-unit.log`, `.local/plan-delta-focused.log`,
`.local/plan-delta-combined.log`. No expiry/forced-termination claim or gate change.

Message lifetime checkpoint (2026-09-16): live `agentMessage` starts now use
`operationTimes[JSON.stringify(['messageStarts', id])]` independently of quiet
phases. Exact output completion ends the stream and updates last progress; tool
activity, turn completion and replay do not. Legacy/history-only starts invent no
clock. Heartbeat and offline inspection retain per-owner obligations. Four overlap
fixtures cover root/child and both tool/message start orders. Native Plan confirms
two active clocks (message + plan); older count assertions in supervisor-child
and Plan fixtures were corrected after observed failures. Verification: 99 focused
tests; targeted native reruns; combined 901 control / 246 runtime tests plus all
native/service fixtures and typecheck/build passed. Logs:
`.local/message-lifetime-focused.log`, `.local/message-lifetime-child.log`,
`.local/message-lifetime-plan-rerun.log`, `.local/message-lifetime-combined-rerun.log`.
Unknown coverage, progress extensions and verified termination remain open.

## Next work

The owner permits a root and native descendants to share one admitted task's grant. The pinned `--child` native fixture verifies inherited MCP tools and real task-scoped Worker receipts after parent completion; dynamic-tool inheritance remains unavailable. Child command/MCP observations now use exact thread/turn namespaces. Do not confuse task-level authorization with per-child caller authentication or completed invocation observations with effect settlement. See `docs/NATIVE_ORCHESTRATION.md` and `docs/CODEX_RUNTIME_SETUP.md`.

The disposable [service composition](CODEX_SERVICE.md) now exercises native child
owner-cancel delivery through its actual supervisor facade and Worker heartbeat.
Unknown coverage still blocks completion and sleep. [Portable templates](PORTABLE_TEMPLATES.md)
provide selected, authority-stripped offline import plans, not complete backups.
Live Sprite Tasks hold/renew/delete evidence is recorded in `docs/PROVIDERS.md`;
it does not prove service sleep, resume or crash recovery.

Use [TODO.md](../TODO.md) as the maintained queue and acceptance coverage index, rather than duplicating its task statuses here. Current order is E01 deadline/activity accounting, E02 recovery/service assembly, then E03 responsive orchestration; independent portal, connector-fixture, portability and client work need not wait for account access. Owner/account/device actions are listed separately there. Mac direction is SwiftUI + WKWebView, not yet implemented; existing Electron files are not a verified Mac release.

Preserve exact task identity and unknown outcomes. A root turn is not settlement. Never copy credentials between orbs, patch the runtime, edit runtime-owned databases, enable production gates to make a demo pass, or treat connector catalog presence as callable authorized effects.
