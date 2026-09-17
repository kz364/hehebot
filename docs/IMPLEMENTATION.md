# Implementation status

Hehebot has demonstrated authenticated chat, a scoped routine read and a persisted provisional reply, not production operation. Direct Codex app-server **0.154.0** is the only supported harness. No cloud deployment has occurred; production execution and native-verification flags remain false.

**Progress checklist:** [TODO.md](../TODO.md) is the maintained owner-facing view of completed local deliverables, remaining work, next priority and account/device blockers. This document retains detailed evidence; the specifications retain acceptance requirements.

Routine preflight portal (2026-09-17 Asia/Jakarta): integrated the worker's
on-demand GET-only disclosure. It shows blockers, observation revision/time,
execution-enabled independently of command checks, explicit schedule timezone
with local/UTC hypothetical times and policy. Run now remains unchanged;
history is independent. Offline/stale/deletion/ownership/navigation/late-response
fences reject old observations; alpha makes zero preflight requests. Host
preflight/history/delete Chromium fixtures pass, eight DPR2 states inspected,
desktop16 pass. Combined verifier includes preflight and passed1426 backend/
434 runtime plus browser/native/service/build in
`.local/routine-preflight-ui-combined.log` (exit0). No worker remains active. These are
synthetic browser observations, not auth/provider/native/delivery proof.

Routine preflight API (2026-09-17 Asia/Jakarta): owner-only
`GET /v1/routines/:id/preflight` returns current revision/persona, enabled state,
schedule preview, overlap/misfire policy and manual-run blockers. The command
shares grant/unfinished-work/persona checks, preserving rejection codes and
rechecking after the observation. Paused manual execution remains allowed without
resuming. Execution-enabled is separate from command allowance; connector/model/
input/effect readiness and delivery are explicitly unverified. Reads use the
schedule-preview rate bucket without reconciliation, alarms, UUIDs or task writes.
52 focused tests, typecheck and desktop16 passed, including grant-change regression.
Combined verification passed1425 backend/434 runtime plus browser/native/service/
build checks in `.local/routine-preflight-combined.log` (exit0). The additional
grant-change test was added after backend verification and passed the52-test rerun.
UI is delegated on exact unpublished base; no alpha gateway expansion, real
inference, provider or account action.

Routine history portal (2026-09-17 Asia/Jakarta): integrated the owned UI patch
against the exact unpublished API base. Routine cards expose on-demand all-status
history with exclusive UUID pages, observation/counts and explicit request,
provisional-output and settlement distinctions. No history mutations or polling;
alpha sends no history requests. Offline, stale/deleted/reassigned routines,
navigation and late responses clear or fence rows. Host browser history, deletion,
tasks and alpha checks pass; six DPR2 renders inspected, including narrow, loading,
empty, error and offline. Desktop16 pass. Combined verification now includes the
history fixture and passed uninterrupted:1402 backend/434 runtime plus browser,
native/service and build checks (`.local/routine-history-ui-combined.log`, exit0).
Worker is integrated; no active assignment or live account/provider action.
This remains synthetic browser evidence, not delivery or settlement proof.

Routine history API (2026-09-17 Asia/Jakarta): authenticated owner GET
`/v1/routines/:id/runs?after=<UUID>&limit=<1..10>` returns the canonical task-page
shape with all statuses scoped to exact routine_id. Pagination uses immutable
ascending UUIDs, not chronological order; restart to see arrivals before a cursor.
Only live routines are addressable here. Existing conversation task pages still
include only unfinished work. Shared projection strips context/checkpoints and
retains current-attempt output/steering/recovery semantics without a new delivery
or settlement claim. The RPC rate-limits but does not reconcile, arm alarms or
enqueue work.16 new real-SQLite/HTTP tests plus neighboring coverage pass48 tests;
typecheck and desktop16 pass. A test-only readonly array typing error was corrected
to an exact status-order assertion. Combined verification passed1402 backend tests
then timed out at FakeProvider boot before model requests; isolated service retry
passed. Original `.local/routine-history-combined.log` retained; remaining native,
service and build checks passed in `.local/routine-history-combined-remaining.log`
(exit0). This is a resumed sequence, not a clean uninterrupted combined pass.
Portal history is delegated
to an isolated worker; preflight and live routine
acceptance remain separate; the restricted alpha gateway has not been expanded.

Portal skill-history restoration (2026-09-17 Asia/Jakarta): History on an approved
card loads retained revision pages on demand, including historical name and all
procedural fields. A confirmation stages `skill.restore` with the captured current
and source revisions, proposal UUID and command key; approval remains separate.
Navigation clears history; stale/deleted/offline state, mismatched page revision,
invalid cursors and errored/loading history block staging. Alpha mode hides this
surface and permits no new history traffic. Lost-response retry sends identical
bytes/key, not a new proposal. Host Chromium fixture passes seven reads/two mutation
requests; draft regression and desktop16 pass. Desktop/narrow history, error and
confirmation captures were inspected at DPR2; narrow scroll/footer DOM checks and
the bottom capture confirm lower fields and affirmation remain reachable.
Combined verification exits0 with1,386 backend/434 runtime plus browser/native/
service/build checks in `.local/skill-history-ui-combined.log`. This is synthetic browser plus existing
SQLite contract evidence, not deployed mutation, Safari or native Mac acceptance.

Skill revision reads (2026-09-17 Asia/Jakarta): owner-authenticated
`GET /v1/skills/:id/revisions?before=<positive revision>&limit=<1..20>` returns
`{skill_id,current_revision,revisions:[{revision,body,created_at}],next_cursor}`.
Default limit10; descending rows use an exclusive cursor and limit-plus-one
lookahead. Gaps remain gaps; new revisions do not duplicate older pages. Only live
skill IDs are readable. Proposals and actor/source metadata are not returned.
The RPC uses the shared owner read-rate limit without reconciliation/alarm work;
no scheduler, inference or provider action is triggered by this read. Core/HTTP
fixtures cover real SQLite, signed owner/wrong-owner and runtime-bearer denial,
pagination, exact bodies, pending-draft exclusion and mutation custody.36 focused
tests and typecheck pass. Initial combined failure was a fixture bypassing the
required command receipt; it now stages through command ingress. The failed log
is `.local/skill-history-combined.log`; final rerun exits0 with1,386 backend/434
runtime tests plus native/browser/service/build checks in
`.local/skill-history-combined-final.log`; desktop16 pass. Portal history/restore controls are next;
the alpha gateway still disallows this route and all skill mutations.

Skill draft retry custody (2026-09-17 Asia/Jakarta): a real Chromium HTTP fixture
reproduced a new proposal UUID and idempotency key on each retry. The editor now
captures both once and freezes its first submitted payload. An unchanged explicit
retry reuses exact custody; changed contents or target reject locally. Latest
connection and selected update target revision/existence are checked before POST.
`node scripts/test-portal-skill-draft.mjs` passes create/update, required affirmation,
lost-response retry and offline/stale/deleted/missing fences with four requests;
14 skill/restore SQLite tests pass. This changes interaction only, with no layout
or backend permission change. It does not persist pending drafts across page close;
closing an uncertain editor requires refreshing and inspecting proposals before
creating another. Combined check exits0 with1,359 backend/434 runtime plus
browser/native/service/build checks in `.local/skill-draft-combined.log`;
desktop16 pass in `.local/skill-draft-desktop.log`. No live accounts or providers.

Private hosted composition (2026-09-17 Asia/Jakarta):
`scripts/test-codex-hosted-owner.mjs` composes signed synthetic Access JWTs,
the actual Worker and persistent SQLite Durable Object, hosted Sprite service,
pristine pinned Codex and read-only task MCP. It verifies an exact routine receipt
and attributed provisional reply with two loopback model requests, then stops
native and reopens Worker persistence to verify readback without inference.
Synthetic Sprite requests are exactly PUT/GET on the expected management socket;
sleep and production remain denied. `tests/runtime-hosted-control.mjs` passes
four tests, including a correctly signed wrong-subject denial, missing/tampered
tokens, dual service-header/runtime-bearer requirements and reboot refusal.
Miniflare 5 uses its exported v4-option converter. Only the exact synthetic issuer
JWKS GET is intercepted; other Worker outbound requests fail. The private HTTPS
proxy simulates the edge service gate; this does not prove Cloudflare edge behavior.
Fixture prepareNative replaces real-account setup, so the launcher/account check,
live Sprite, hosted account eligibility and containment remain separate gates.
Combined verification exits0 with1,359 backend/434 runtime tests plus native,
browser, service and build checks in `.local/hosted-composition-combined.log`.
Desktop16 pass in `.local/hosted-composition-desktop.log`. No account, provider,
deployment or production action occurred; this checkpoint remains local.

Hosted manual launcher (2026-09-17 Asia/Jakarta): runtime/hosted-owner-launcher.mjs
uses the existing flock wrapper twice, native home then session state. Both must
be existing distinct owner-only directories. Parent config bytes are SHA-256-bound
to the child's re-read before account work. Contention returns73; abort forwards
to the exact exec-preserved child; no retry or state deletion occurs. Four new
real-subprocess cases plus entry/lock coverage pass21 tests in
`.local/hosted-launcher-focused.log`. Tests substitute a synthetic Node workload
after asserting the actual lock argv, except the changed-config case exercises
the real entrypoint refusal. This is not complete hosted native integration.
Combined verification exits0 with1,359 backend/430 runtime plus native/browser/
service/build checks in `.local/hosted-launcher-combined.log`; desktop16 pass.
Delegated pristine0.154.0 experiment kept protocol FIFO open after SIGKILL of its
synthetic parent: npm wrapper retained fd3 and exclusion, native ELF had no matching
directory descriptor. Both stayed alive; stopping wrapper stopped native, then a
contender entered. This is bounded delegated evidence, not independently repeated
host proof or arbitrary wrapper-loss containment. Existing process-lock tests also
reproduce Node's default descriptor drop. No transport/dependency patch was made;
free locks still cannot authorize takeover. Both workers finished and cleaned their
synthetic processes. No account/login/model/provider action or deployment occurred.
Next: complete private scripted Access/Worker/native/Tasks composition. HTTP wake
remains preflight-only; supervised CLI existence adds no live deployment grant.

Hosted bounded control composition (2026-09-17 Asia/Jakarta): distinct default-off
HEHEBOT_HOSTED_OWNER_ALPHA accepts the exact owner pin/policy envelope under Access
only, both production flags false and no provider/local-alpha config. Shared policy
validation preserves local serialization. Worker checks the independent pin inside
the owner-binding transaction before seed; a wrong fresh pin leaves no binding or
objects. Internal owner_alpha_hosted:true is mandatory for hosted runtime, refused
by local/test runtime, and absent from public state. Quota and attempt custody use
the existing alpha ledger without reset. Real SQLite plus bearer-authenticated
Worker ingress proves boot/claim/submission, one-run exhaustion, exact preview
reconstruction, denial of mutations/effects/complete/sleep, changed/removed-policy
refusal and used-boot refusal. Owner commands use canonical control.accept in this
fixture; it is not a new signed-JWT/browser or deployed Access test.
runHostedOwnerAlpha composes the existing Sprite Tasks client with the shared
supervised account/model checks and independent expiry+grace watchdog. No hosted
CLI/HTTP wake route is exposed; its caller must hold the kernel executor lock.
71 focused backend and54 runtime tests plus typecheck pass; logs
`.local/hosted-admission-{control,runtime}.log`. Full combined verification exits0
with1,359 backend/426 runtime plus native/browser/service/build checks in
`.local/hosted-admission-combined.log`; desktop16 pass. Delegated parser and Worker tests are
reviewed/integrated. No live provider/model/account action or deployment occurred.
Next is a launcher holding native-home and session-state locks and complete private scripted Access/Worker/native/Tasks
composition; live provider and account eligibility remain separate. This supersedes
the previous checkpoint's absence of a hosted Worker policy, not production gates.

Hosted runtime composition prerequisite (2026-09-17 Asia/Jakarta): optional
`hostedOwnerBindingSha256` requires an exact lowercase digest, owner-alpha policy,
both private Access credential files and Tasks hold/release functions. Existing
fixed-origin HTTPS validation remains authoritative. Fresh service intent persists
`hostedOwner:{bindingSha256,origin}` before status; owner mismatch refuses boot.
The config is captured before awaits. This branch uses SpritesActivityGuard,
including checks before version/native preparation/launch and normal supervisor
admission. An expired startup hold cannot be silently reacquired. Stop retains
the Task; sleep and reused journals remain denied. Default local alpha retains
its loopback/provider-free behavior. Worker Access alpha admission and the Sprite
execution entrypoint remain disabled; synthetic composition does not activate them.
Delegated service tests were reviewed; host added expiry across both startup
await boundaries, a deterministic status barrier, and explicit sleep/retained-Task
checks.57 focused service/alpha/activity tests pass in
`.local/hosted-owner-focused-final.log`. The initial host test edit introduced a
missing brace and referenced a nonexistent activity test filename; corrected
command passes. Full combined verification exits0 in `.local/hosted-owner-combined.log`:
1,335 backend/419 runtime tests plus native/browser/service/build checks; the final
startup-expiry cases were included in that run. Desktop16 pass in
`.local/hosted-owner-desktop.log`.
No account/model/provider/deployment action occurred. Live provider containment,
account eligibility and the separately gated control/launcher contract remain open.

Owner-pinned transport preflight (2026-09-17 Asia/Jakarta): bound Access internal
status now exposes owner_binding_sha256, not raw binding values. Its canonical
digest is checked against a fixed independent vector through actual authenticated
Worker ingress; public/local-alpha responses remain unchanged. Sprite preflight
requires ownerBindingSha256 and captures the complete config before awaiting
status. Match, missing/mismatch, invalid-before-secret-load, caller mutation and
unauthorized HTTP wake cases pass; reports omit binding/hash/secret markers.
Only status is requested; HTTP202 precedes the asynchronous check and does not
mean executor readiness. The existing HTTPS client rejects redirects and pins
origin.47 focused SQLite/alpha and16 preflight/client tests pass. Full backend
passes1,335, runtime411, build dry run passes; logs `.local/owner-preflight-*`.
The initial focused command misspelled the client test filename and ran only the
five preflight tests; the corrected transport command and full runtime run cover
the client. Full native combined verifier was not repeated. No live account/model/
provider or deployment action occurred; actual hosted admission/activity integration
remains separate and disabled. Example preflight config now requires the digest.

Hosted owner binding (2026-09-16): Worker startup now pins Access auth mode,
installation ID, issuer, audience and owner subject in `runtime_metadata` before
seed. Same binding reconstructs without writes; changed identity/local downgrade
fails OWNER_MIGRATION_REQUIRED without replacing private state. First adoption of
populated unbound data also refuses. Existing unbound local data remains unchanged;
no schema version change or hosted-alpha enablement is involved. The common Access
issuer validation was extracted and its20 existing auth tests passed before the
behavior change. Real DO-host-shim/SQLite and application export/import coverage
now pass65 focused binding/auth/alpha tests. Delegated tests were reviewed and an
object-only unbound-data case added. Full combined verification exits0 with1,333
backend/406 runtime tests and native/browser/service/build checks in
`.local/owner-binding-combined.log`; `.local/owner-binding-focused.log` retains the
focused pass. No account/provider/deployment action occurred. AUTH_SETUP records
the remaining hosted owner/origin runtime binding and activity-guard requirements.
Existing unbound hosted data requires an explicit migration workflow; none is
implemented and deleting the binding is not a supported bypass.

Process-crash custody (2026-09-16): `tests/runtime-process-crash.mjs` forks real
Node workers using FileJournal/ExecutionBridge, kills at deterministic durable
claim_unknown, lost claim response, lost native submission response and lost
Worker registration ACK boundaries, then reopens in a different process. The
parent owns HTTP side-effect counters across death. Exact call counts and original
epoch/boot/attempt/native IDs distinguish safe refusal from repeated admission;
submitted_unknown permits only identical registration ACK retry. A successful
control prevents an all-refusal implementation from passing. Host review added
explicit pre-crash counts and unconditional child cleanup on failures.
`node --test tests/runtime-process-crash.mjs tests/runtime-file-journal.mjs`
passes17; `npm run test:runtime` passes406. Logs `.local/process-crash-{focused,runtime}.log`.
No runtime behavior changed; this is simulated-transport application-journal
evidence, not native recovery, power loss, multi-writer fencing or100 randomized
receipt-loss injections. The combined verifier was not repeated for tests/docs only.
`AUTH_SETUP.md` now records hosted-trial configuration/authorization requirements
and explicitly rejects promoting local alpha by flipping production flags.

Live bounded V2 demonstration (2026-09-16,19:20Z): same-owner ChatGPT-backed
gpt-5.6-luna, Chief of Staff, three independent admitted roots and one native child.
A returned after delegation; S's accurate status and B's packing list persisted
while the child remained active. Exact A cancellation propagated OWNER_CANCELLED
to its child; native journal records interrupted child, completed A/S/B roots and
distinct native thread IDs. S/B were not cancelled by A's command. Child MCP read
completed; its itinerary was interrupted, not delivered. No general settlement.
Independent evidence assertions report passed in private
`.local/owner-v2-live-session/verified-evidence.json`; full snapshots/live receipts
are in live-report.json. Native shutdown followed by private Worker reconstruction
and browser reload preserved exact S/B previews (reconstructed-readback.json).
Cancelled A's preview is hidden by the existing owner-cancellation output fence;
the report and native journal retain its earlier acknowledgement.
Both services stopped, zero native processes, state retained and never replayed.
Browser DOM confirms Connected, disabled Send, both provisional replies; the
inspected2x screenshot is `.amp/in/artifacts/owner-v2-live-readback.png`.
Portal wording now describes explicit background opt-in rather than falsely
declaring it unavailable. node --check and rendered DOM verify that text-only
change; the combined verifier predates it. No cloud deployment, paid API fallback
or production flag changes. Full P0.3 orchestration and P0.4 hosted/recovery gates
remain open despite this narrow live responsiveness/cancellation milestone.

V2 service/custody integration (2026-09-16): selected alpha roots use nested V2
cap2 with V1/wait disabled; selected fingerprints include `v2-cap2`, rejecting old
V1 custody before RPC. Default submission fingerprints/config are unchanged.
Application schema v11 removes thread-only uniqueness but preserves per-turn
uniqueness and transactional original-parent/attempt/persona checks. Migration
rollback, exact legacy v9/v10 import/export and v8–v11 backup inspection pass.
Host248 focused tests pass; an actual adapter/journal/mapper→SQLite regression
retains A1/A2/B1 receipts and exact provisional outputs across ACK loss/reopen.
Native service/browser fixture passes7 loopback requests, inherited child routine
read, independent status and B, zero-inference reload, exact root-family cancel,
26 operations and denied sleep. Initial fixture assumptions about V1 message
format and one unknown record per family failed and were corrected for V2's
agent_message and retained activity/spawn uncertainty. No settlement was added.
Logs `.local/v2-{control-host.log,selected-green.log,service-host-final.log}`.
Final `.local/v2-integrated-combined-final.log` passes1,318 control/395 runtime,
native/browser/service checks and build. Earlier failures were a stale HTTP export
pin and editing a running shell script; both logs remain. Desktop16/16 pass.
Terminal-root native mode passes33 requests, no new root inference/turn in its
one-second window, exact followup denial and31 retained operations/no sleep.
The appended completion activity is metadata, not a second turn or settlement.
Source follow-through found sleep_tool default-on independently of token_budget.
Its explicit disable exposed native override layering: the selected per-thread
features table dropped startup overrides, restoring apps/sleep. Native thread
readback contradicted globally disabled config/read. The selected adapter now
carries the complete shared restricted feature map with v2-cap2-restricted
fingerprint; older selected V1/V2 custody cannot replay. Actual root/child feature
readbacks and catalog absence pass with enabled/always_on sleep input config.
48 focused tests pass; final combined rerun `.local/restricted-v2-combined.log`
exits0 with1,318 backend/399 runtime tests and native/browser/service/build checks.
Initial failing checks are retained in `.local/sleep-tool-*`.
The explicit bounded V2 entry now replaces the earlier blanket background refusal:
the composed launcher accepts true-only `backgroundFirstRoot`, persists the exact
policy and leaves absence root-only.33 entry/launcher/background tests pass in
`.local/v2-launcher-focused.log`. No live V2 account-backed trial has run.
Production flags remain false; this admits neither automatic replay/restart,
sleep nor general settlement. V1 remains prohibited. The next deliverable is the
already-authorized bounded same-owner V2 demonstration, not another synthetic gate.

V2 native event integration (2026-09-16): host independently passed the31-request
V2-capable catalog fixture. Advertised grandchild spawn hits capacity; completed
child A is evicted for B while A's history remains readable. Foreign S controls
remain denied. Runtime now records distinct unknown V2 activities and observed
spawn custody, including two child threads/three turns after eviction/followup.
Actual native notifications pass through the router with zero pending/recovery
events;26 operations retain uncertainty, no sleep,4/4 held responses close.
Logs `.local/v2-events-{native-host.json,native-default-host.json,focused-host.log,runtime-host.log}`.
Host review caught the worker's synthetic nested wire shape; the actual flat
fixture failed four tests before correction. Final126 focused/394 runtime tests
and typecheck pass. [Detailed contract](OWNER_BACKGROUND_V2_NATIVE.md).
Control regression fails because native_session_key is UNIQUE across turns;
the isolated v11 migration worker owns immutable thread affinity and compatible
backup/export/restore changes. No selected-config/fingerprint or live gate change
is included in this checkpoint. Full combined waits for the known control gap.

Missed-output recovery (2026-09-16): exact acknowledged completed-turn history now
restores bounded provisional message digests/previews in one journal update.
In-progress/failed/interrupted turns cannot freeze partial text; missing known
messages retain the prior preview, duplicate IDs/conflicting digests reject before
writing, and identical readback is a no-op. History adds no activity clocks and
does not settle tools/effects/descendants or permit sleep. Two initial regressions
failed before the change;67 focused adapter/event tests and11 SQLite task-control
tests then passed. Root/child previews publish once without changing run/attempt
custody. Native fixtures recover exact root output, child final output after an
earlier preview, and missing output from disk after a controlled native restart.
Logs `.local/output-recovery-{red,focused,control,steering,native-final}.log`.
The first combined run passed1,298 control/383 runtime tests but correctly exposed
the steering fixture's old expectation that history never changes preview content.
That expectation now requires the exact final child message/digest/version while
preserving all other custody. The final combined run passed1,298 control/387
runtime and all native/browser/service checks, then failed the final build on the
new test assigning an undeclared adapter.rpc property. The test now reopens via
the public constructor;11 targeted tests and build/typecheck/dry run pass in
`.local/output-recovery-{control,build}-final.log`. Desktop16/16 also passes.
The full combined command was not repeated after this test-only correction;
both unsuccessful full logs are retained. This does not enable automatic live
restart or add a recovery-only owner-alpha entrypoint.

Opt-in integration / authority blocker (2026-09-16): the runtime accepts a true-only
`background_first_root` policy and consumes only an exact persisted claim marker,
not model text or family order. Submission captures the marker before awaits and
includes it in the selected-root fingerprint; old default bytes remain unchanged.
The nested agents/features override merges with the original task MCP grant.
Both workers are integrated. Scripted service/native/browser check passes seven
requests, inherited read, independent status/B, root cancellation reaching its
held child, three retained families/25 operations, no result settlement and sleep
denial. Host fixed redundant cancellation propagation with two red/green replay
cases. Combined passes1,297 control/380 runtime and all remaining checks, exit0,
in `.local/owner-background-combined.log`; desktop16/16.

This does NOT establish independent-task authority. Subsequent pinned-source
inspection found V1 send_input/close_agent/wait_agent can target a foreign live
root by UUID; no public spawn-only filter exists. `runOwnerAlpha` now refuses
background mode before filesystem/service/account work, with24 focused tests
passing in `.local/owner-background-live-gate.log` after the full verifier.
See [exact sources and boundary](OWNER_BACKGROUND_NATIVE.md#cross-root-authority-blocker).
The later `--foreign-close` native probe confirms selected A can remove unrelated
loaded S and receive its completed text. It uses a host-started second A turn and
known S UUID, not automatic reactivation or ID discovery. Nine loopback requests,
persisted output, unchanged config and cleanup pass; default seven-request mode
also passes. Logs: `.local/owner-background-foreign-close-final.log` and
`.local/owner-background-default-after-probe.log`. The wrong-argument initial run
is retained and not counted as containment. No full combined rerun was needed
for this optional fixture-only diagnostic; live background stays blocked.
V2 target paths check the tree registry. The delivered native fixture is now
host-reviewed/integrated and independently passes23 loopback requests: actual
foreign S UUID denied for message/followup/interrupt, positive same-tree controls,
independent S completion, zero active turns and all3 held responses closed.
Config bytes remain unchanged; `.local/owner-background-v2-host.json` retains
host evidence. [V2 decision](OWNER_BACKGROUND_V2_NATIVE.md) records why child-role
overrides cannot disable V2, but shared cap2 residency may itself enforce depth1:
an executing child occupies the only non-root slot and cannot be evicted. That
source-supported correction is pending a native V2-capable child-catalog fixture.
Residency is not a logical-child quota. It is not adopted. No live session used
background mode, no provider/account/production action occurred, and default
root-only alpha is unchanged. Exact-turn output recovery is implemented above;
safe live replacement and recovery-only assembly remain separate prerequisites.

Background scope and native prerequisite (2026-09-16): task summaries previously
selected every same-persona background title, including private titles for a room
or unrelated routine. They now filter by exact captured `scope_key` before LIMIT30,
with deterministic ties and missing-scope legacy rows omitted. Two SQLite tests
cover six asymmetric scopes and an older matching row behind31 unrelated rows,
including no-write/lifecycle/attempt invariants. All1,281 control tests and
typecheck pass (`.local/task-summary-scope-control.log`); the restricted service
background fixture passes (`.local/task-summary-scope-native.log`) with three
retained families, independent status/B, exact cancellation and sleep refusal.

The [native background prerequisite](OWNER_BACKGROUND_NATIVE.md) now tests actual
forbidden spawn calls rather than catalog absence. Seven loopback requests prove
one selected V1 root can hold a direct child while a default root responds;
second-child capacity and grandchild/default-root dispatch reject correctly.
Persisted root messages, exact identities, interruption, closed held request,
native exit and unchanged configuration are verified. The child cap is per root,
not app-server-wide. This is not service admission or live child authorization;
owner alpha remains root-only. Combined verification now includes this fixture;
`.local/background-scope-combined-retry.log` exits0 with1,281 control/364 runtime
and all native/browser/service/build checks. Initial run
`.local/background-scope-combined.log` stopped at a tool-fixture EADDRINUSE before
inference; retained separately, not suppressed. No live account/model, provider,
production gate, push or deployment changes.

Private follow-up continuity (2026-09-16): the delegated two-message root-only
alpha fixture reproduced absence of first-task information in second-root input.
ControlCore now captures bounded same-persona history before the current command
sequence, including visible explicitly provisional replies tied to original
receipts. Claim rebuild excludes later messages and preserves admitted snapshots;
room/routine/cross-persona scopes receive no private history. Retention filtering,
clipping disclosure and non-authoritative labels are verified; this is not complete
token budgeting, completed-result history or actual-model conversational judgment.
See [scope and evidence](OWNER_ALPHA_MULTI_MESSAGE.md).

Combined verification passed 1,279 control / 364 runtime plus scripted native,
browser, HTTP/service and build checks. Final focused mode validates four model
fixture requests, exact first preview in second input, two successful routine
receipts, distinct task/thread/grant custody, third-admission refusal, reload with
no inference and cancellation isolation. Unknown coverage still denies settlement
and sleep. Logs: `.local/alpha-continuity-combined.log`,
`.local/alpha-multi-host-final.log`, `.local/private-context-focused.log`.
The separate early-runtime-exit forwarding fence passes13 gateway/launcher tests;
it preserves readback/cancellation while rejecting held/new messages after exit.
The public session expired unused, nativeStopped:true, zero runs/previews; all
session processes stopped and custody was preserved. No new real inference,
production permission, provider action, push or deployment occurred.

Authenticated orb access (2026-09-16): a fresh-state launcher composes private
HTTPS Worker, existing root-only native entrypoint and short-lived token/cookie
gateway. Worker local-auth bypass is never exposed. Actual orb ingress login
and state read succeed; runtime/internal and export paths return404. Chromium
observes Connected, selected Chief of Staff, one remaining admission and120s task
limit. Host submitted no message. Owner access uses the Terminal-held private
token; it is never in a URL, localStorage or transcript. The instance is owner-wide
read scope, not persona confidentiality, and has no private imports/connectors.

The credential-free browser integration verifies durable queued message/reload,
zero native attempts, forbidden writes and logout. It caught a real form POST
failure: no-referrer suppresses Origin to null; same-origin fixes login without
weakening CSRF. Absolute10s gateway deadlines resist continuous trickle responses;
token rotation during awaited bodies/ownership reads prevents dispatch. Unknown
mutation outcomes are not replayed. Session UI fences expiry/quota/offline/wrong
persona and retains provisional/history/cancel access. Inspected DPR2 screenshots
include actual public ingress and available/expired/wrong-persona states.

Host combined verifier passes1275 control/363 runtime tests and all scripted
HTTP/native/service/build checks; desktop16/16. Private logs:
`.local/alpha-access-{combined,desktop,supervisor-child}.log`. The separate final
supervisor-child check verifies a request-order fixture correction: unrelated
grant proof no longer consumes the root catalog assertion. This is not relaxed
authorization or new model evidence. No production gate changed, push/deployment,
paid API fallback, connector write or Sprite operation. Managed session deadlines
and continuation custody are recorded in HANDOFF; do not reset consumed state.

Corrected live trial (2026-09-16): the owner authorized the follow-up and a $5
ceiling without repeated permission asks for this bounded work. The same ChatGPT
login and `gpt-5.6-luna` produced run `6c057062-54d2-4a28-8532-3565f1708f88`,
attempt 1, thread `01a0aaa5-0a27-7860-9ab4-34117b553963`, native turn
`01a0aaa5-0afe-7230-8e45-f4762ca28fa9`. Correct pre-admission routine policy
yielded exactly one completed MCP read and HTTP 200, no 403/429. The model's
version-2 reply accurately reported no routines in this fresh local instance,
separating that observation from supplied alpha limitations. No routine was
fabricated or enabled, and no connector was read or written.

After the 120-second attempt deadline, the retained run became Cancelling with
DEADLINE_EXCEEDED; native shutdown was journaled. This observes deadline bookkeeping
for an already-finished root, not forced interruption of a still-generating model.
Unknown coverage prevents settlement; after control restart the run remains
recovery_required / CANCEL_UNCONFIRMED. Read-only verification preserved the exact
preview, one run/attempt, one accepted event and zero run.result events/cards.
Browser reconnect/reload and an inspected DPR2 screenshot show the useful reply
and provisional/recovery disclaimers. The initial orchestration report retains
a browser-JSON assertion failure; separately corrected readback exits 0 with
passed_readback, without resubmission or another inference runtime.

Private evidence: `.local/owner-alpha-corrected-session/{report,readback}.json`,
receipt and journal. Screenshot: `.amp/in/artifacts/owner-alpha-corrected-reply.png`.
Native usage is 26,380 input tokens (15,872 cached), 260 output tokens; not a
billing receipt. Both services are stopped. No paid API fallback, Sprite call,
deployment, policy bypass or production gate change. The narrow OWNER ALPHA
real chat/read-only-tool/provisional-reply milestone is now demonstrated; hosted
owner access, background behavior and full settlement remain separate work.

Authorized live trial (2026-09-16): after an initial login prerequisite stop, the
owner separately authorized and completed supported device login. Supported
account/read confirmed ChatGPT and model/list exposed `gpt-5.6-luna`, selected for
the single 120-second task. Actual browser submission produced run
`04829967-3eee-4304-8f3a-5fd9e8d724ba`, attempt 1, native thread
`01a0aa94-064d-7bd1-a0a1-764c55304600`, turn
`01a0aa94-0755-7a43-9cf4-aeaabe0a75af`. The native root completed in about 16 seconds.
Its final version-3 provisional reply disclosed that routine listing failed and
restated the supplied alpha limits; it did not invent an empty routine list.

This trial was partial: the host setup used a random policy ID instead of the
fixed ROUTINE_MANAGE_POLICY, so both read calls correctly failed 403. Rapid host
state polling then received 429 and stopped the runner before its deadline check.
These are operator/verification errors, not evidence that permission or rate-limit
checks should be relaxed. No second root was launched. Reopened retained Worker
data and browser reload verified the exact final reply, one run/attempt, and no
run.result or completed-result card. The inspected DPR2 screenshot shows Needs
recovery, the provisional disclaimer and final text. Native stop is journaled;
unknown operations remain. Both local services are stopped, custody retained in
`.local/owner-alpha-live-session`, and the one-task grant is consumed. No paid API
fallback, connector write, Sprite call, deployment or production gate change.
Native usage reports 35,563 input tokens (17,664 cached), 478 output tokens;
these counters are not a billing receipt. Full timeout/settlement and successful
live routine reads remain unverified. P0.2's real provisional-reply path is observed.

Explicit local owner alpha (2026-09-16): an immutable selected-persona policy now
admits one to three direct owner roots with per-task/session deadlines, separate
from disposable test mode and both false production flags. Worker first boot uses
no provider; durable consumed IDs and original attempt/epoch/boot prevent resetting
quota or replaying uncertain work. Deadline expiry preserves exact callback/output
custody, while owner cancel or memory revocation fences subsequent scoped reads.
Complete, effects, native-child, mutating tools and sleep remain denied.

The host entrypoint checks ChatGPT account and exact visible model through supported
APIs only when explicitly launched. It preserves an optional authorized native home
in place, supplies restricted profiles through CLI overrides, retains store selection,
and rejects custom OpenAI providers and config drift. Root spawning/provider surfaces
are disabled. A separate timer stops native execution at session expiry plus 30-second
grace even during an awaited maintenance call. Existing-home auth and live model
behavior have not been exercised; no login/token copying/provider action occurred.

Host `bash scripts/test-codex-service.sh --owner-alpha` passes the actual browser →
HTTPS Worker/SQLite → native Codex → read-only MCP path with two scripted model
requests, both production flags false, no test-mode admission and zero Sprite hold
calls. Provisional output survives reconnect and the 15-second task deadline, while
the task becomes cancelling and unknown coverage remains. Rendered working and
cancelling states were inspected; the alpha banner discloses unavailable background,
external-action and automatic-recovery behavior. No completed result is fabricated.
Log: `.local/owner-alpha-service-final.log`. The first fixture failures exposed
20-minute-clock assumptions and a UI filter hiding cancelling coordinator previews;
both were corrected without weakening non-alpha assertions.

Native root-only fixture default and CLI-override modes pass three deliberately
unsupported spawn calls, two completed root turns, three loopback requests, no
observed child and byte-identical original config. Exact RPC approval policy works;
top-level TOML `untrusted` does not. The integrated override mode exercises the host
transport encoder. Combined verifier passed1274 control/350 runtime plus native,
service and build checks (`.local/owner-alpha-combined.log`); desktop16/16 passed.
Final scoped-read/public-summary changes pass53 targeted backend cases; final timer
coverage is recorded separately in `.local/owner-alpha-runtime-final.log`.
See [session setup and recovery limits](CODEX_SERVICE.md#explicit-supervised-local-session).
The next usable milestone requires authorization for one bounded real-model task,
not full connector/Mac/recursive-sleep acceptance. P0.2 remains incomplete until that
actual model path is observed; no hosted deployment is implied.

Restricted service preparation (2026-09-16): opt-in disposable composition selects
a digest-bound minimal/workspace-read named profile, disabled network and only
first-party read MCP grants. Startup checks native configuration readback before
readiness; submission rejects config-file drift. Initial host service tests pass23/23,
and `--restricted-background` passes six scripted loopback requests through the
actual browser/Worker/native path, retaining the three unknown families and
denying sleep/final settlement. Initial zero-inference readback refusal and the
corrected null-metadata handling are recorded in
`.local/restricted-background-{first,second}.log`. See [service limits](CODEX_SERVICE.md).

The bounded native permissions worker's patch was reviewed and integrated. Host
reran `node scripts/test-codex-permissions.mjs --minimal-native`: exit0, 24 requests,
26 assertions, exact root/direct-child workspace reads and journal/token/symlink
denials, pristine binaries and confirmed disposable cleanup
(`.local/restricted-profile-host-native.log`). This variant adds only the exact
native ELF read path plus explicit private-path denies. Unaugmented `--minimal`
cannot launch shell and is not enforcement proof; service keeps shell unavailable.
These are separate policies and evidence, not a claim that app-server/MCP or all
model-reachable built-ins are isolated. The completed
[pinned built-in review](ALPHA_NATIVE_CAPABILITY_BOUNDARY.md) found no concrete
arbitrary host-file bypass in the inspected tools; image/patch reads use sandboxed
helpers, and nested code-mode calls retain tool dispatch. No additional container
or shell allowance is required by that source evidence. Built-in denial remains
source-supported rather than behaviorally proved.

Main applied the concrete remaining restriction: native command-line overrides
disable provider search/apps/plugins/suggestions/image generation, token-budget
mode and escalation features. Startup requires their exact config readback and
no inherited MCP servers; admitted MCP `enabled_tools` matches the immutable
read-only grant. The six-request provider-restricted path passes in
`.local/restricted-background-final.log`. Desktop16/16 passes in
`.local/restricted-desktop.log`; final combined verifier passed1244 control
and342 runtime tests plus native/service/build checks in
`.local/restricted-final-combined.log`. The final explicit journal/home/token/Access
path denies additionally pass48 service/transport cases and actual restricted
background with six requests in `.local/restricted-final-focused.log` and
`.local/restricted-background-verified.log`. No live model, provider, account,
deployment or production gate changes. Next deliverable is an explicit bounded
owner-alpha session entrypoint and specifically authorized real-model task, not
further general containment work or enabling the disposable gate for live use.

Owner-alpha direction (2026-09-16): useful supervised tasks with disclosed bugs and
manual recovery need not await complete product/connector/Mac acceptance. Credential,
authority, unknown-effect, replay and spend safeguards remain mandatory. The newly
authorized bounded read-only Sprite inspection is complete: cgroup primitives exist,
but the protected manager/workload boundary remains unknown, not proved impossible.
[Direct provider evidence and cost estimate](PROVIDERS.md#selected-sprite-read-only-containment-decision-2026-09-16)
record cold→read-only exec→cold and no mutation/model work. Full tree termination is
needed for safe autonomous sleep/replacement, not inherently for a persisted
provisional reply. No text-only isolation, real-model task or production gate claim.

Responsive portal/background preparation (2026-09-16): host integration passes
`bash scripts/test-codex-service.sh --background-responsive` in
`.local/family-background-host.log`. Actual Chromium → HTTPS Worker/SQLite → pinned
native Codex uses six scripted loopback requests. The status turn sees A's actual
admitted task summary, receives its own thread/grant, and leaves A unchanged;
reload preserves its attributed provisional reply without more inference. Public
cancellation interrupts B, then old A, at their exact native identities. All three
families remain in 25 heartbeat operations, including three unknown coverage rows.
No `run.result`, sleep permission, provider action or real-model claim follows.
See [the fixture and restricted-session limits](PORTAL_BACKGROUND_ALPHA.md).

The runtime fsyncs released-family custody and release intent in the same cursor
record before sending the Worker receipt; acknowledgment is durable before another
claim. Loss fences admission, and only the exact release receipt can be reconciled.
All-family heartbeat/controller/output/cancel handling outlives the current cursor.
The scheduled admission pump does not block the next lease heartbeat. Offline
diagnostics list retained families and separately label current admission uncertainty;
native detail selects one exact family, never granting resume/sleep authority.
DB v10 stores an exact per-attempt coordinator-release receipt independently of
completion. Migration, fresh/migrated schema hashes, backup and export/import are
updated together; v8/v9 backup and v9 export/import remain supported. The initial
combined failure on a stale v9 E2E export hash is preserved in
`.local/family-combined.log`; it was corrected rather than suppressed.
Final host `bash scripts/verify-codex.sh` exits0 in
`.local/family-combined-final.log`: 1,244 control/335 runtime tests, all scripted
native/service checks and build dry run. Desktop reinstall/tests pass16/16 in
`.local/family-desktop.log`. Focused journal/inspection checks cover lost ACK,
failed custody persistence, the 32-family bound, older-attempt settlement, late
output, all-family operation coverage and unknown-current-claim diagnostics.

Next alpha boundary work should reuse existing
[positive named-profile shell/direct-child deny evidence](CODEX_PERMISSIONS.md),
not re-run general containment refusal matrices. Pinned upstream
[thread permissions](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server-protocol/src/protocol/v2/thread.rs)
select supported named profiles; ordinary `read-only` still permits broad reads.
[Local stdio MCP launch](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/rmcp-client/src/stdio_server_launcher.rs)
is not sandboxed by that profile. Review native file/tool access and the trusted
app-server/MCP boundary with the actual service grant layout before live inference.
Full recursive termination is not a prerequisite to provisional supervised output;
credential/task authority still is. The current service remains disposable-only.

P0 portal/native preparation (2026-09-16): owner priority now supersedes peripheral
work. `bash scripts/test-codex-service.sh --portal-readback` passed through the actual
browser composer, HTTPS local Worker/SQLite and pinned Codex app-server with scripted
loopback model data. Closing/reopening the browser and reloading preserves the exact
run/attempt's provisional output without extra inference or a duplicate run. Receipt,
conversation, admitted attempt and native thread/turn IDs are recorded in
`.local/p0-portal-readback-final.log`; DPR2 portal capture is inspected. This is not
a real-model task, hosted path, Worker crash/restart test or completed `run.result`.
P0.2 remains incomplete: the fixture observes zero result events, one unknown
coverage operation, and rejection of completion/sleep. No production flag changed.
The mode runs separately from the combined verifier, keeping browser prerequisites
explicit rather than silently expanding the default verifier.

The concrete completion blocker is `CodexOperations.snapshot()`'s unconditional
unknown coverage, not missing portal rendering. A read-only pinned-source review
found no public app-server enforced deny-all tool/child-spawn field in
[`ThreadStartParams`](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server-protocol/src/protocol/v2/thread.rs)
or [`TurnStartParams`](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server-protocol/src/protocol/v2/turn.rs).
Empty dynamic tools and restrictive sandboxing are not an empty executable tool
inventory; internal allowed-tool filtering is not a supported host API. Do not
remove coverage or manufacture all-settled proof for a purported text-only mode.
The next integration decision must establish supported bounded operation/descendant
coverage or an explicitly reviewed alternative while keeping effects uncertain.

P0.1/P0.3 prerequisites (2026-09-16): reviewed/integrated both worker deliveries
from exact bundled unpublished main. Main reran the containment contract/probe suite
(28 tests, no kernel launch), and the actual native capacity fixture (11 assertions,
seven loopback requests, five held connections closed). Evidence is
`.local/p0-containment-integrated.log` and `.local/p0-responsive-integrated.log`.
[Containment prerequisites](CONTAINMENT_PREREQUISITES.md) explicitly report positive
kernel mode unavailable. [Native responsiveness](RESPONSIVE_CHAT_PREREQUISITE.md)
proves a completed coordinator's distinct status turn while A remains held and exact
independent-root B cancellation without changing A. It does not prove Worker
admission, same-parent sibling isolation, real-model understanding or P0.3 completion.

P0 integration decision after inspecting bridge/supervisor/core ownership and focused
oracle consultation: retain one coordinator lane and multiple durable unresolved
families. Add exact idempotent coordinator-release evidence separate from all-settled
completion; persist/discover the family before advancing admission. Use fresh native
threads/grants for independent attempts rather than sharing an existing task grant.
Every family must retain its operation projection, task controller, cancellation,
deadlines, unknown coverage and activity obligations. A separate model-backed status
thread still needs these records and does not avoid the multi-family boundary.
No such production change is implemented yet. The next bounded positive fixture
must route portal P→held child A, status S and independent B through Worker/service,
then cancel B and older A exactly after admission advances, with no final result or
sleep claim. Implement the release receipt, durable family registry and all-family
maintenance coherently; do not change only the Worker claim predicate.
Final combined verification passed 1,227 control/329 runtime tests and all scripted
contracts/typecheck/build dry run in `.local/p0-first-path-final-combined.log`;
desktop reinstall and 16 tests passed in `.local/p0-first-path-desktop.log`.

Journal input/return custody (2026-09-16): three red tests reproduced mutations
of queued insert/update inputs and divergence between a direct write's durable
JSON and returned caller reference. Inserts and updates capture JSON before queueing;
writes return the persisted wire value. Updates preserve undefined-field deletion,
including a literal `__proto__` data key. The focused journal/service suite passes
29 tests and typecheck (`.local/journal-custody-focused-final.log`); red evidence is
`.local/journal-custody-red.log`. Combined verification passed 1,227 control/301
runtime tests, scripted contracts and build dry run in `.local/cancel-journal-combined.log`;
desktop reinstall and 16 tests passed in `.local/cancel-journal-desktop.log`.
This is same-process value custody, not
multi-executor exclusion, process-tree settlement or production acceptance.

Exact-task cancellation review (2026-09-16): integrated both entry points with
captured identity, task, attempt, status, navigation and offline checks, explicit
consent and editor-local exact-request uncertain retry. Main reran the 13-envelope
browser fixture plus question/task/recovery/conversation-search fixtures in
`.local/task-cancel-integrated.log`, then memory edit/Forget and skill-review
regressions in `.local/cancel-navigation-regressions.log`. All passed; three main-run
DPR2 desktop/offline/uncertain captures were inspected. Build passed in
`.local/cancel-journal-final-build.log`. The backend has no expected-attempt
precondition, and a browser pre-response transport retry was observed in initial
worker evidence; neither client guards nor cancellation prove native termination
or effect settlement. See [bounded evidence](PORTAL_TASK_CANCEL.md).
Final integrated combined verifier passed 1,227 control/301 runtime tests and all
scripted/build checks in `.local/cancel-journal-final-combined.log` (exit 0).

Descendant containment decision (2026-09-16): reviewed the independently produced
[conditional design](DESCENDANT_CONTAINMENT_DESIGN.md), checked the central Sprite
service and Linux cgroup documentation, and repeated read-only permission checks.
Current orb scope is a root-owned domain with no writable directory/procs/kill and
zero effective capabilities. No real containment test was possible or claimed.
Recommendation retains the Sprite service wrapper and requires a protected manager
plus an explicitly delegated cgroup workload subtree; same-UID writable delegation
does not protect against workload escape. Provider stop progress is not recursive
settlement evidence. Next local work is a bounded prerequisite/ordering harness;
real kernel cases require an administrator-provided disposable delegation, and
selected-Sprite support needs separately authorized inspection/provider guarantees.
Both workers are integrated; no production or infrastructure changes.

Service startup/stop fencing (2026-09-16): three red cases reproduced a control
status call after initial shutdown, activity acquisition after shutdown during the
starting journal write, and successful start return after shutdown during the final
running write. File/journal awaits now recheck startup phase; the in-memory running
transition follows the acknowledged journal write. Two more red cases reproduced
the promise-resolution gap after a helper check; startup now passes lazy actions
to the helper so phase is checked before invocation, with explicit checks before
native setup and final success. All 26 service/journal cases and typecheck pass;
red logs are `.local/startup-stop-{red,microtask-red}.log`, final focused log is
`.local/startup-stop-focused-final.log`. Preliminary combined verification passed;
final batch passed 1,227 control/298 runtime tests, scripted contracts and build dry
run in `.local/startup-history-final-combined.log` (exit 0). This does not prove complete
descendant ownership, native settlement, successful recovery or production readiness.

Lock descendant evidence (2026-09-16): host reviewed/integrated the real Node
inherited-versus-default-spawn fixture and reran 30 lock/journal/service tests.
Explicit fd inheritance preserves exclusion after parent exit; default spawn leaves
a live child while a contender enters. Both children were confirmed reaped.
`.local/startup-lock-integrated.log` records the identities and outcomes. Successful
flock acquisition is not safe takeover, settlement or sleep authority. See
[bounded Linux evidence](EXECUTOR_LOCK_DESCENDANTS.md). No launcher change was made.

Loaded conversation search (2026-09-16): reviewed and integrated message-text-only
filtering with truthful loaded counts, navigation reset and collapsed active-filter
indicator. Questions/tasks/safety notices remain visible; unfiltered history still
owns pagination and retention floors. Main reran the focused fixture plus eight
history/memory/question/task/recovery/result regression invocations successfully
in `.local/conversation-search-integrated.log`, and inspected four matched/empty/
narrow DPR2 captures. No added search request, source retrieval or inference. See
[scope and limits](PORTAL_CONVERSATION_SEARCH.md). Integrated build and desktop 16/16
passed in `.local/startup-history-final-{build,desktop}.log`; desktop reinstall also
passed. Both workers are integrated; all work remains local and gates remain false.

WhatsApp result custody (2026-09-16): two synthetic red cases changed an already
returned message during final authority checking or journal response persistence.
The shared capture boundary now detaches bounded structured data and error status
before those waits; unchecked text/resource blocks are not captured. Original error
responses cannot become successful by later mutation. Journal records still contain
no message payload, and response observation settles only protocol invocation.
All 36 read/operation cases plus typecheck pass, including an additional red/green
case that prevents new authority I/O if result capture crosses the deadline. Logs:
`.local/wapp-result-custody-red.log`, `.local/wapp-result-deadline-red.log` and
`.local/wapp-result-custody-focused-final.log`. The preliminary combined run passed;
final integrated run passed in `.local/search-expiry-final-combined.log`:
1,227 control/291 runtime, scripted contracts and build dry run, exit 0.
Recent-array compatibility and actual connector
admission/browser settlement remain unproved; no patch or gate changed.

Expiry/runtime integration (2026-09-16): both acknowledged and lost cancellation
reply cases pass through real SQLite lifecycle and supervisor composition, preserving
the exact attempt, unknown effects/tools/locks, unrelated active task and original
expiry cancellation grace. Host reran 72 related tests and typecheck successfully
in `.local/expiry-runtime-integrated.log`. No production defect was found; synthetic
native/activity callbacks do not prove Codex interruption, transcript deletion or
physical sleep. See [evidence and limits](MEMORY_EXPIRY_RUNTIME.md).

Scoped local memory search integration (2026-09-16): host reran search, inspector,
12-command edit and eight-command Forget fixtures successfully. Search is literal,
case-insensitive text over loaded eligible records only; no added request or source
retrieval. Navigation clears the query; unchanged refresh retains it and current
metadata disclosure. Matched, empty and narrow DPR2 captures were inspected, with
readable wrapping and actions. See [limits](PORTAL_MEMORY_SEARCH.md). The integrated
build and desktop 16/16 passed in `.local/search-expiry-final-{build,desktop}.log`;
desktop reinstall also passed earlier. No native Mac/Safari/live acceptance implied.
Both workers are integrated locally; no production gate or publication changed.

Completion custody snapshot (2026-09-16): `ExecutionBridge.complete` retained the
caller's observation/result object across journal and control awaits. Three red
cases showed changed identity or divergence between durable result and Worker
payload. The bridge now captures the JSON wire value before the first await;
identity, settlement flags, nested checkpoint and result stay bound to that call.
Six new cases cover three mutation boundaries, denied late proof upgrade, cyclic/
BigInt rejection before I/O and subsequent valid completion. Two further red cases
exposed the same gap while the supervisor queue waits; it now snapshots at entry
as well. All 92 bridge/supervisor tests and typecheck pass in
`.local/completion-custody-focused-final.log`; red evidence is in
`.local/completion-custody-red.log` and `.local/completion-queue-red.log`.
This is a synthetic caller-race reproduction, not authenticated native settlement
or successful restart acceptance.

Integrated public-server and memory-inspector evidence (2026-09-16): the locked
public ESM factory passes 22-tool catalog, eight schema rejection and 26 host
denial checks; actual recent arrays still fail server-side SDK validation.
See [bounded methodology](WAPPMCP_PUBLIC_SERVER.md). No session/browser settlement
or connector admission is implied. Memory metadata uses textContent, distinguishes
null expiry from absent expiry and fetches no source text. Unchanged refresh keeps
disclosures open; changed content/revision, deletion or navigation resets them.
Inspector, 12-command edit and eight-command Forget browser fixtures pass in
`.local/memory-inspect-integrated.log`; three DPR2 captures were inspected.
Final `bash scripts/verify-codex.sh` exited 0 with 1,225 control/287 runtime tests,
all scripted contracts and build dry run; desktop tests passed 16/16. Logs:
`.local/public-inspect-integration-{combined,desktop}.log`. Local only; all
production/model gates remain false and E06/E09 remain partial.

Memory forgetting integration (2026-09-16): exact-memory consent now precedes
`memory.delete`, preserving revision/scope/identity/navigation fences and stable
explicit retry keys. `purge_transcripts` remains false. Main added disclosure of
retained past conversations/completed-task copies, consistent with backend evidence.
Four new custody cases plus related suites pass (42 tests), including both cleanup
flags, scrubbed-put/delete receipt replay without SQLite writes, asymmetric sibling
isolation and exact cancellation grace across repeated different purges. Effects,
locks and terminal copies remain; no deletion-everywhere claim is made. See
[purge custody and retained boundaries](MEMORY_PURGE_CUSTODY.md).
Main reran the eight-request Forget fixture, twelve-request edit fixture and
routine-delete/recovery regressions in `.local/forget-integrated-browser.log`;
three DPR2 desktop/narrow captures inspected. Narrow DOM checks independently
scrolling fields and fully visible error/actions. Final combined batch passed
1,217 control / 287 runtime tests and all included artifact/native/service fixtures
and build dry run in `.local/forget-drain-integration-combined.log`; desktop passed
16 again in `.local/forget-drain-integration-desktop.log`. No native/live E06/E10 completion.

Drain readiness revalidation (2026-09-16): seven supervisor regression cases
initially resolved as sleeping after synthetic native readiness became false
during journal read, maintenance, prepare, intent write, commit, journal update
or provider release. The supervisor now rechecks readiness alongside the lease
between awaited stages. Before prepare it denies without poisoning the running
supervisor; after prepare it enters recovery and preserves recorded uncertainty.
A change observed after release cannot undo that one release, but prevents a false
sleeping claim and replay. 121 supervisor/lifecycle tests pass in
`.local/drain-readiness-focused.log`; red evidence is `.local/drain-readiness-red.log`.
Combined verification passed 1,213 control / 287 runtime tests and all included
fixtures/build checks in `.local/drain-readiness-combined.log`; desktop passed 16.
This is an injected readiness contract, not a production native bug reproduction:
the pinned Codex adapter still denies sleep unconditionally. No atomic provider
release/observation guarantee or descendant settlement is newly proved.

Public shutdown API (2026-09-16): the synthetic shutdown fixture now imports the
pinned package's public ESM root rather than internal subpaths. CommonJS resolution
is not exported; ESM passed all 19 cases/13 children in `.local/wapp-public-root-esm.log`.
The package exports a host-owned session candidate without a CLI patch; its README
does not document an embedded lifecycle. This does not construct/start a session,
prove transport/browser settlement or bypass the recent-array SDK blocker.
See [public API evidence](WAPPMCP_SHUTDOWN.md).

Portal memory editing (2026-09-16): text-only edits previously reset sensitivity
to ordinary and expiry to null. The reviewed fix preserves metadata/provenance,
binds original persona/revision/scope, and fences observed stale/deleted/offline
state and navigation, including away/back. First payload/ID/key remain stable for
explicit retry only; close/reload does not persist retry identity. Main reran
`node scripts/test-portal-memory-edit.mjs`: 12 exact synthetic requests passed in
`.local/memory-integrated-browser.log`, plus routine-delete/profile/skill-review/
recovery regressions. Three DPR2 desktop/narrow captures were inspected: readable
metadata/error disclosures and unclipped controls. This is synthetic Chromium
evidence, not native/live E06 acceptance. See [memory editor limits](PORTAL_MEMORY_EDIT.md).

Post-intent WhatsApp reauthorization (2026-09-16): permission could be revoked
while `readJournaledWappMcp` awaited durable intent, after the initial host check.
The regression observed one dispatch before the final result check denied data.
It now rechecks the same captured task/tool/chat authority immediately after
persistence, before transport dispatch. The helper lives inside `readWappMcp`'s
original cancellation/deadline envelope; no duplicated authorization parser or
new grant is introduced. New authority caps can tighten but never widen the wait.
The transport gets only signal/deadline; the durable intent keeps its original
custody bound. Revocation, timeout or cancelled recheck retains non-replayable
intent rather than fabricating a response or releasing browser coverage.
Six new regression/boundary cases and related suites pass (67 tests):
`.local/wapp-reauthorize-focused-final.log`. Exact 36/37ms cases distinguish success
from expiry, late allow responses cannot dispatch after cancellation/timeout, and
response persistence checks the tightened clock even before the timer callback.
The HTTPS Worker fixture passed cancellation during held intent persistence with
zero dispatch plus retained intent in `.local/wapp-reauthorize-http.log`.
The final combined run passed 1,206 control / 287 runtime tests and all included
artifact/native/service fixtures and typecheck/build dry run in
`.local/shutdown-reauthorize-combined.log`; desktop reinstall/tests passed 16 in
`.local/shutdown-reauthorize-desktop.log`. This does not make remote revocation
and external dispatch atomic, register a connector, prove recent-read SDK
compatibility or permit sleep. Production gates remain false.

Pinned shutdown integration (2026-09-16): `node scripts/verify-wappmcp.mjs`
passed all 12 signal and seven destroy/profile cases across 13 synthetic children
in `.local/wapp-shutdown-integration-focused.log`. Actual installed primitives
preserve the disposable profile; actual logout deletes the negative-control canary.
Destroy timeout/rejection and concurrent calls do not establish termination.
Pinned CLI static inspection finds unconditional signal-handler unregister even
on successful startup; the CLI was not executed. Readiness now names that blocker.
See [shutdown methodology and limits](WAPPMCP_SHUTDOWN.md). No production lifecycle,
process-tree settlement, account pairing or E09 completion is claimed.

Native Tasks elapsed deadline (2026-09-16): `createSpritesTaskTransport` previously
used Node request socket inactivity timeout, which incoming bytes can postpone.
An owned elapsed timer now bounds the full async wait, destroys the request at
expiry and retains the redacted unknown-outcome error. No automatic retry is added.
Late response data/end cannot replace that outcome. Successful responses, request
errors, aborted responses and parse errors clear the timer. A deterministic
regression first remained pending at its exact deadline; after the fix, GET/PUT/
DELETE no-response and trickle cases reject exactly at 50ms (not at 49ms).
A real loopback HTTP response streaming every 10ms also fails at its configured
100ms wait rather than completing after 1s. This is local transport evidence,
not a Sprite call, provider rollback, native termination or safe-sleep proof.
22 activity/service tests pass in `.local/tasks-deadline-focused.log`; red evidence
is `.local/tasks-deadline-red.log`. A real HTTP before/after comparison also
reproduces the old 1-second success beyond a 100ms configured timeout and the new
unknown-outcome rejection: `.local/tasks-deadline-http-comparison.log`.
Full verifier passed (exit 0), 1,197 control / 281 runtime tests and all fixtures/
build checks in `.local/tasks-deadline-combined.log`; production gates stay false.
Desktop reinstall/tests passed 16 tests in `.local/tasks-deadline-desktop.log`.

The independent backend restore delivery has been reviewed and applied; main
reran 30 skill/restore/routine/context tests successfully in
`.local/skill-restore-integration-focused.log`. Nine new restore cases preserve
pending-only staging, explicit review, historical content, admitted context and
receipt replay. No production defect was found; [scope](SKILL_RESTORE_CUSTODY.md)
excludes HTTP, crash and native acceptance. The portal comparison delivery is also
reviewed/applied: ten field pairs, explicit new-skill state, stale/offline fencing,
unchanged review envelope and same-editor uncertain retry key. Main reran
`scripts/test-portal-skill-review.mjs` successfully, including added narrow/desktop
scroll geometry assertions proving the final comparison field remains accessible
above the footer. All four regenerated captures were inspected; partial cards at
the scroll boundary are intentional, with no horizontal clipping or obscured controls.
Keyboard Space/Tab/Enter/Escape and error-alert semantics pass; four synthetic
commands, no live mutations. Routine-delete and recovery browser regressions pass.
Logs: `.local/skill-review-integration-browser-final.log` and
`.local/skill-review-integration-regressions.log`; [limits](PORTAL_SKILL_REVIEW.md)
exclude Safari, real touch, screen-reader and native Mac acceptance. Combined batch
verification passed (exit 0) in `.local/skill-review-integration-combined.log`:
1,206 control / 281 runtime tests plus all artifact/native/service checks and
typecheck/build dry run. Production admission remains false; E05 remains partial.

Activity-renewal continuity fix (2026-09-16): `SpritesActivityGuard.ensure` now
captures the previous receipt's expiry and checks it again after the renewal await.
Previously a renewal begun at 90000ms could return at/after the old 120000ms expiry
with a new 210000ms receipt and be accepted. That receipt proves a current hold,
not uninterrupted continuity. The guard now notifies recovery and blocks later
admission/release; it retains the confirmed renewed receipt and does not delete
the native Task. The 119999ms success and 120000/120001ms rejection cases distinguish
the boundary. Regression failed before the fix (missing expected rejection);
19 activity/service tests pass afterward. Logs: `.local/activity-renewal-red.log`
and `.local/activity-renewal-focused.log`. No live hold, sleep or recovery claim.
Full verifier passed 1,154 control / 271 runtime tests and all fixtures/build checks
in `.local/activity-renewal-combined.log`, production admission false.

Readiness/custody integration (2026-09-16): two independent deliveries based on
unpublished local main were reviewed and integrated. The diagnostic
[connector catalog/classifier](CONNECTOR_READINESS.md) separates installation,
artifact, per-operation protocol and historical authorization evidence; no result
grants dispatch authority. It names the recent-array SDK incompatibility even for
synthetic scoped search. Main reran 25 readiness/read tests successfully.
The [endpoint custody matrix](ENDPOINT_CUSTODY_MATRIX.md) adds 43 actual Worker/auth/
RPC/core SQLite tests using locally signed JWTs; valid foreign-owner and
runtime-versus-owner requests deny before durable access. All-table snapshots,
total_changes, RPC, alarm and fetch assertions detect unauthorized work. Main reran
123 integrated custody/auth/question/read/control tests successfully. No production
defect was reproduced in that bounded matrix; triggers, other runtime endpoints,
live Access and exhaustive policy permutations remain outside its evidence.
Logs: `.local/readiness-integration-focused.log`, `.local/custody-integration-focused.log`.
Combined integration verification passed (exit 0) in `.local/readiness-custody-combined.log`:
1,197 control / 278 runtime tests, eight auditor and five Mac checks, all pinned
artifact/SDK/native/service fixtures and typecheck/build dry run; production admission
false. Desktop reinstall/tests also passed 16 tests; existing dependency warnings
remain, and no dependency upgrade or native Mac rendering is claimed.
E09/E15 remain partial; no installed connector, live callability or security-audit
completion is inferred.

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

Actual locked SDK composition (2026-09-16): `scripts/test-wappmcp-sdk.mjs`, invoked
by the disposable `verify-wappmcp.mjs` installation, runs SDK 1.30.0 Client/McpServer
over its public InMemoryTransport. It imports the actual pinned upstream JSON
helper after matching its installed bytes to the SHA256-verified plugin artifact.
Synthetic handlers and messages are used; neither the real plugin server/session
nor Chrome is started. No extra dependency or patch is installed in the app.

This exposes a previously untested compatibility failure. Upstream
[`getChatMessages`](https://github.com/vaibhavpandeyvpz/wappmcp/blob/9a0a39e61b2271df1a1d7fc1e198f1e37f66aaf8/src/lib/whatsapp/session.ts)
returns `Message[]`, and
[`createJsonResult`](https://github.com/vaibhavpandeyvpz/wappmcp/blob/9a0a39e61b2271df1a1d7fc1e198f1e37f66aaf8/src/lib/mcp/helpers.ts)
casts that value without wrapping it. SDK CallToolResultSchema requires an object
for `structuredContent`. The direct schema check rejects at that field, and an
actual SDK tool request reaches the synthetic handler once but cannot release the
recent-message batch through the host boundary. Object-shaped scoped search passes
with exact chat/query/page/limit checks. Earlier array-valued callback fixtures
proved only host validation, not supported SDK compatibility. Recent history must
remain blocked until a supported fix/version is reviewed; search is not equivalent.
No validation bypass or additional dependency patch is authorized.
Read-only upstream inspection on 2026-09-16 found `main` and latest tag `v0.4.0`
still at the pinned revision, with no later fix, published release or related
issue located. There is no identified newer compatible version to adopt now.

Abort, SDK timeout and connection close each reach server cancellation while the
deliberately non-cooperating handler is still pending. Client close returns before
handler completion. Releasing the handler later leaves the journal intent unknown;
a fresh-signal retry of the same operation cannot call the transport again.
These are three distinct negative contracts, not stdio/browser/process termination
evidence. The verifier reports `syntheticCompatibility:false` while the five-mode
positive/negative fixture passes. Focused log: `.local/wapp-sdk-focused.log`.
An initial fixture replay assertion incorrectly reused an already-aborted signal;
it was corrected to a fresh signal and a transport-dispatch counter so rejection
must come from retained custody, not incidental cancellation or a closed client.
Combined rerun passed in `.local/wapp-sdk-combined.log`: 1,154 control / 270 runtime
tests, all SDK positive/negative, compatibility/native/service and build checks.
Production admission remains false; the negative compatibility result is preserved.

Actual SDK stdio descendant evidence (2026-09-16):
`scripts/test-wappmcp-stdio.mjs` extends the disposable pinned verifier with a real
Node MCP server and one bounded synthetic descendant. Only public SDK Client,
StdioClientTransport, McpServer and StdioServerTransport APIs are used. No real
plugin CLI, Chrome, account, native model or provider is started. Child modes run
only when this fixture file is invoked directly; import alone launches nothing.

After an admitted journaled search dispatch, the descendant publishes an atomic
counter heartbeat. SDK client close returns with its public pid getter null.
The fixture independently checks the direct PID plus Linux /proc start-time identity
is no longer executing, then observes a strictly newer heartbeat from the same
still-running descendant identity. Thus direct-child termination and stdio closure
do not imply descendant termination. The re-opened journal retains unknown intent;
retry of the same operation cannot call the transport again.

Cleanup uses a private stop file for the cooperative synthetic descendant and
verifies both captured identities are gone or terminal (Z/X), not executing; it
does not claim every OS zombie was reaped. Independent 15-second backstops bound
the synthetic processes. The fixture does not signal arbitrary PIDs or implement
a production process-tree supervisor. Temporary state is removed; a subsequent
process scan found no fixture survivors. Focused command
`node scripts/verify-wappmcp.mjs` passed (`.local/wapp-stdio-focused.log`).
The combined verifier passed in `.local/wapp-stdio-combined.log`: 1,154 control /
270 runtime tests and all compatibility/native/service/build checks, including the
stdio fixture. Final admission is false and the recent-read incompatibility remains.
This is stronger than in-memory cancellation evidence but still not Chromium,
Sprite lifecycle, complete descendant containment or safe-sleep acceptance.
An owned service/descendant boundary remains required before connector admission.

WhatsApp invocation-journal follow-through (2026-09-16):
`readJournaledWappMcp` is a trusted, unregistered assembly around the scoped read
boundary. It requires host attempt/operation IDs, a deadline and an authorization
callback. Inside the existing cancellation envelope it serializes and fsyncs a
payload-free `whatsappReads` intent in the exact running attempt before upstream
dispatch. The stored cap includes the initial Worker's tighter deadline. Retained
IDs are never replayed. Concurrent writes preserve sibling/native fields through
the existing single-process journal queue; this is not multi-executor fencing.

Only a trusted transport's observed protocol response can record `response`.
SDK rejection, timeout and late responses leave intent uncertain. A response
already observed before cancellation may finish its durable write afterward;
that records invocation termination, not caller success, authorization or browser
termination. Reads still validate content and recheck authority before release.
`CodexOperations` projects retained intents as unknown and responses as settled,
with stable IDs/clocks and the bounded deadline, while coverage remains unknown.
Root completion cannot erase these records. Corrupt inventories fail closed.
No chat IDs, queries, message bodies or transport error text enter these records.

Eight new tests and the existing read/operation/journal suites pass (61 total):
pre-dispatch disk visibility, exact 37ms expiry, late completion, reconstruction,
replay refusal, concurrent duplicate IDs/siblings, blocked/failed writes, root
completion and corrupt records. Log: `.local/wapp-operations-focused.log`.
`bash scripts/verify-codex.sh` passed (1,154 control / 270 runtime tests, all
compatibility/native/service/build checks, production admission false) in
`.local/wapp-operations-combined.log`. After expanding only the blocked-write test
to include response persistence, focused and full runtime suites passed again
(`.local/wapp-operations-runtime-final.log`, 270 tests). Desktop 16 tests pass.
Real MCP transport registration, descendant/process termination, successful
reconciliation and live pairing remain open. The transport callback must not
resolve on local abort/close; this unit does not assert that an SDK close settled
anything. The existing plain read helper remains for isolated contract fixtures.

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
