# Implementation status

Hehebot has demonstrated canonically completed hosted text-only replies, including a Worker-triggered staged wake, with authenticated full-reload persistence. This is not production operation or ongoing availability. Direct Codex app-server **0.154.0** is the only supported harness. Historical failed trial custody remains recovery-required. Production execution and native-verification flags remain false.

**Progress checklist:** [TODO.md](../TODO.md) is the maintained owner-facing view of completed local deliverables, remaining work, next priority and account/device blockers. This document retains detailed evidence; the specifications retain acceptance requirements.

Hosted capability-drop defect (2026-09-18): earlier successful manual Sprite
launches used setpriv, but the automatic listener Service registered Node directly.
Live listener PID20242 showed CapInh/Prm/Eff/Bnd/Amb=a82435fb and NoNewPrivs0.
Two fresh private synthetic homes, actual pinned Codex, fake no-auth loopback-only
provider, initialize/config/read/thread/start only: default caps returned -32603;
setpriv all-dropped/NoNewPrivs1 acknowledged. Both native diagnostics exited and
homes/helpers were removed. No real account or turn used. Evidence
`.local/bootstrap-78-{listener-capabilities,caps-reproduction}.jsonl`.
This reproduces a concrete startup defect, not the discarded exact error of78.

Shared hosted launcher now invokes supported setpriv after both locks and before
the native entrypoint. No fallback, retry, manifest or retirement change. Focused6
tests verify real locks and signal PID through exec, effective/permitted/inheritable/
ambient caps0, NoNewPrivs1, exact bounding-drop invocation, and refusal without
entry. Orb bounding mask remains nonzero despite setpriv; guest reproduction
independently verifies all five masks0. Runtime515/515 pass; full combined recheck
exited0:1669 backend/515 runtime plus Worker/browser/native/service/build in
`.local/hosted-cap-drop-combined.log`. Desktop16 passed at preceding checkpoint;
desktop source is unchanged by this launcher edit.

Supported Service stop completed exit0; deployed originals matched host baseline
hashes. Installed launcher/adapter/inspector exactly match new local SHA256 values,
import-only check started no native process, supported Service start completed.
Authenticated manager16:25:11.484Z returned null; no policy/Worker changes/new message.
Logs `.local/cap-drop-{deployed-before,installed,listener-stop,listener-start}.log`
and `.local/cap-drop-manager-readback.jsonl`. All historical custody remains retained.

Pinned startup audit: thread/start can persist native identity and perform auth,
catalog and generate:false WebSocket prewarm before turn/start. See tagged
[startup prewarm](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/session_startup_prewarm.rs#L185-L327).
Null durable threadId under reviewed intact single-writer custody supports no
first-party turn/start, not no startup effects or billing. Oracle's scoped design
review supports preparing a distinct explicit one-use claimed-pre-turn quarantine
authority, preserving UNKNOWN and reservations, not reusing unused/settlement guards.
Core implementation is integrated locally after exact patch checksum verification
and host review. `claimed_pre_turn_quarantine` defaults absent, requires a new policy
revision and fresh owner message, binds exact expired claimed attempt1 with literal
null native/result/release/settlement fields, rejects contradictory activity, and
retains an immutable disposition through config removal/reopen. Old custody and cost
reservations are unchanged. Host typecheck and focused216/216 pass; combined verifier
first passed1710 backend but failed six hosted-control runtime cases: the new
constructor query ran before a fresh Durable Object installed its SQLite schema.
Host added a schema-presence guard without bypassing existing custody validation;
the same hosted-control tests pass8/8. Original failure remains in
`.local/claimed-pre-turn-host-combined.log`; full recheck exits0 with1710 backend,
515 runtime and Worker/browser/native/service/build in
`.local/claimed-pre-turn-host-combined-recheck.log`.
Runtime evidence producer subsequently integrated after checksum and host review:
pinned original/current sources and configs, canonical root inode/device identities,
exact bridge/adapter fingerprint using claim deadline, literal null native IDs and
strict three-record journal inventory. Both real flocks are inherited and verified;
exclusive0400 marker write fsyncs file/directory and permanently blocks old entry,
including partial/dangling markers. Retained records stay unchanged. Historical
review assertions are mandatory trusted evidence, not conclusions established by
hashes, current settings or null IDs. Output contains no successor grant/expiry or
settlement/refund assertion. Host focused19/19, runtime520/520 and pinned hosted-manager
composition pass after integration; desktop16/16 also passes. Logs
`.local/claimed-pre-turn-host-{runtime-focused,runtime,composition}.log`.
No quarantine deployment, live evidence marker or authority issuance.
Shared-home memory/alternate-ingress fences remain prerequisites. Tagged source
supports managed `/etc/codex/requirements.toml` allow_remote_control=false plus
[features] memories=false; legacy features.remote_control is ignored. No supported
read-only RPC exposes persisted remote-control preference; status can race startup.
Current readback does not prove historical disablement. Do not restart shared-home
app-server just to inspect status before a managed startup fence is established.
No managed requirements/access-control mutation has been performed; installing the
prospective managed fence awaits explicit owner approval for shared native controls.

V3 live staging (2026-09-18): owner returned home/requested retry; existing Mac
Chrome/CDP and SSO passive readiness succeeded15:11:28Z with six runs unchanged.
Only then activated fixed v3 expiry15:22:07.073Z,180s session/120s task, same cost
baseline/reservation/cap and exact unused8 evidence.15:13:27 browser confirms admission
available, empty composer and no old-run change.15:14:15 authenticated manager null
and provider same Sprite cold corroborate passive control-plane-only behavior.
One normal composer message78 applied15:15:30.593Z, commandb934fd98, runda2fd086.
BOOTING→READY/attempt1 then RECOVERY_REQUIRED/STALE_EPOCH by15:17:48.912; zero
canonical result. Six prior runs unchanged. Reload returned15:18:17 but subsequent
state evaluation failed;15:18:44 origin null/no composer, so persistence unverified.
No host guest exec/manual wake before failure, no duplicate send. Private evidence:
`.local/bootstrap-v3-{activation.log,activation.json,before-message.json}`.

First post-failure diagnostic guest exec15:18:39 wakes guest explicitly; it is not
part of the message-wake demonstration. Listener timestamps show native service
failure SERVICE_RECOVERY_REQUIRED15:15:44.383, policyExpired:false/operatorStopped:false,
then stop and LAUNCH_REFUSED_OR_UNKNOWN. Under both actual directory flocks, offline
inspector shows epoch9 dispatch submission_unknown, exact run78/attempt1, native
thread/turn null and NATIVE_ACKNOWLEDGEMENT_UNKNOWN; service journal nativeStopped:true.
No observed native acknowledgment is not proof that thread/start had no effect.
Original RPC cause was discarded by adapter catch; source tracing suggests later
STALE_EPOCH is lease-watchdog fallout, not an established initial identity mismatch.
Sanitized stage/code-only durable diagnostics and existing inspector projection are
integrated locally. The checked patch SHA256 is
1a0a2ac587d6cae80c30a93bf851a7d064d983c7d8543024fde8667f9f2b0ebd.
Host `node --test tests/runtime-codex-adapter.mjs tests/runtime-codex-recovery-inspect.mjs`
passes55/55; `npm run test:runtime` passes514/514. Typecheck and
`node scripts/test-codex-hosted-manager.mjs` pass with one native/scripted completion,
HTTP wake and prelaunch bootstrap hold, not real model/provider acceptance.
Full verifier stopped on encrypted-backup fs.watch EMFILE:1668/1669 backend pass;
isolated recheck reproduces. Orb showed126 visible inotify instances against128
max_user_instances; no unrelated processes terminated or test weakened. Logs
`.local/native-submit-host-{focused,runtime,composition,combined}.log` and
`.local/native-submit-backup-recheck.log`. Subsequent orb-only sysctl increase
fs.inotify.max_user_instances128→256 unblocked unchanged watcher test11/11;
fresh `bash scripts/verify-codex.sh` exited0 with1669 backend/514 runtime plus
Worker/browser/native/service/build. Log `.local/native-submit-host-combined-recheck.log`.
`npm ci --prefix desktop && npm test --prefix desktop` passes16/16;
log `.local/native-submit-host-desktop.log`.
Earlier failed check remains recorded; no test skips or application changes.
Diagnostics allowlist stages/error codes and
signed32-bit RPC codes, omit raw error messages, and preserve UNKNOWN/no replay.
They cannot recover78's discarded original error. Subsequent deployment is above.
Supported native thread/list under both locks15:29:15.644Z returned zero matching
exact-workspace threads/no further page; diagnostic native exited. No thread/start,
resume or inference was requested; absence is not proof of no prior native effect.
Private evidence `.local/bootstrap-78-native-list.jsonl`. No replay or
unused-before-staging recovery for78.
V3 expired unchanged15:22:07.073Z. Native Tasks GET empty15:24:59, no DELETE or refund.
Evidence `.local/bootstrap-78-{listener-private.log,journal-selection.jsonl,
locked-inspection.json,tasks-private.json}` stays private. Production gates false.

Read-only follow-up15:48:04Z: original service permissions name and base-config
digest reconstructed exactly under both kernel locks. Supported initialize/config/read
confirms default profile/filesystem match and disabled network; project maxbytes32768,
markers[.git], fallbackCount0, no reviewed trust entries, three system/user/session
layers without marker overrides. Fixed ancestor/native-home metadata found no
.git/AGENTS.override.md/AGENTS.md/.codex/config.toml candidates; canonical roots
are disjoint and not symlinked. No thread/start/turn/account/model request; diagnostic
native exited and temporary guest/local helpers removed. First inspection refused
before native launch because its guard incorrectly expected persisted
restrictedPermissions:true; service sets that only in memory. Corrected inspection
requires the actual raw config contract plus exact original profile digest.
Evidence `.local/bootstrap-78-config-selection-v2.jsonl`; metadata/config read is not
proof of sandbox readability or original error. Worker pinned0.154.0 reproduction
of nested-home denial is not this live layout. Current core successor requires
completed text-only receipts/settlement; retirement merely records child-stop/locks,
and unused recovery categorically excludes attempt1. Adapter fsyncs threadId before
turn/start and supported runtime writers preserve it; this narrows the boundary
under intact journal custody; tagged-upstream startup effects are recorded above.
No live recovery authority or settlement claim.

Owner architecture alignment (2026-09-18, docs only): imported the reviewed
three-file clarification without replacing current live-status documents. Amp is
a documented reference, not a wrapper/dependency/coding UX; deterministic ingress
remains reachable while model coordination sleeps with the shared runtime except
for admitted work. Codex, one Sprite, cost and settlement gates are unchanged.
Patch applicability and whitespace checks pass; no executable changes, test rerun,
deployment, push or new acceptance claim accompany this clarification.

Live unused evidence/deployment (2026-09-18):09:20:24 preflight reconfirmed exact
reviewed old manager/launcher/lock source hashes, manager config digest and private
native/session root device/inode identities, with no staged session directories.
Operator reviewed the original private-stage creation, exclusive mkdir before
native launch and absence of a deletion path; current hashes alone are not proof
of historical custody. Producer executed once at09:21:55.474 under both real locks,
creating the permanent epoch8 transition fence and0400 fsynced evidence marker.
Digest049cb4035a5a3d7305a7cff50a6c826752d91ec178060400448cfc082ddf87bb
was independently read back after runtime installation. No nativeStopped or
retirement claim. Request/evidence and preflight are private `.local/unused-live-*`.

Supported listener Service stop returned stopped/exit0/complete; installed three
hold-before202 files match local hashes, import check started no native process,
and Service start returned started/complete. Worker deploy exited0 with version
e3541c58-7602-4c21-8f5b-457dcf796123. Logs `.local/hold-listener-*.log` and
`.local/unused-recovery-worker-deploy.log`. Authenticated09:25:54 manager manifest
null and provider same Sprite warm. This is installation evidence, not message wake
or sleep acceptance. Provider-only09:31:22 reports same Sprite cold, recorded in
`.local/unused-final-provider.json`; no zero-billing or process-loss claim follows.
No new trial config/reservation/message, no Git push.
Browser recovery update12:11Z: tracked PID33132 terminated (SIGTERM/exit-1), exposing
agent-browser daemon read error35. Verified Mac shell responds; runner inventory
did not establish its unavailability. A single subsequent passive pinned navigation
hit a hard25s timeout; CLI was killed/reaped, browser-side outcome remains unknown.
State/history reads were not reached; no send or other mutation occurred. Subsequent
no-navigation diagnostics completed: HTTP /json/version returned404 (also seen in
prior working consent mode), CDP handshake timed out at5s, and both owned session
info queries timed out at10s. agent-browser0.38.1 help/version respond. All subprocesses
were reaped; tracked diagnostic PID33279 exited0. Chrome versus daemon/consent blockage
remains unresolved. No documented safe daemon-only reset established; doctor/close
were not executed. Schedule paused12:28Z pending owner inspection for a Chrome remote
debugging consent prompt, whose presence is unknown. V3 remains unissued.
Actual billing remains unverified; unchanged cumulative$10 allowance is not reset.

Live message-bootstrap77 failed (2026-09-18): authenticated browser readiness and
passive control-plane-only navigation preceded new fixed v2 policy. Same Sprite
provider status cold08:19:50 and08:21:42, manager null before message. Single normal
composer submission accepted08:22:33.495Z, receiptcebc1bf7-0856-429e-af4c-0e364fe51d77,
run743d4f08-f8dd-4f9f-8506-dea200381342, user event20. BOOTING observed, never READY;
epoch8 RECOVERY_REQUIRED by08:24:07, run queued/attempt0/error null. Reload retained
one user event, zero results, no preview, old five runs unchanged. No retry/manual
wake/activation/cancel/replay. Wake8 metadata status queued proves strict HTTP202
receipt only. Listener had zero staged sessions and no initial log; at08:24:10,
immediately after diagnostic guest exec, it logged NO_ASSIGNMENT. Service process
owner/modes/port matched expected configuration. Code has an activity gap after202
before manager/native Task hold. Timing strongly suggests idle pause; no direct
provider pause trace establishes causality. Expired grant/custody stays untouched.

Manifest-validated, durable-fenced, bounded bootstrap hold before202 is integrated
locally; no listener-lifetime heartbeat or uncertain replay. Host runtime regression
passes505/505. The strengthened existing HTTP-listener/native composition passes:
bootstrap Task PUT/GET before202, separate native Task PUT/GET, one pinned native
start and scripted response, canonical completion and expiry-gated retirement.
This is synthetic provider/account evidence, not live cold-wake recovery. Hold-only
combined verification exited0 in `.local/bootstrap-hold-combined.log`; desktop16 pass.
Host extended
the existing actual-workerd fixture to prove authenticated manifest callback into
the same DO while its sending alarm awaits acknowledgement; exact grant returned
with wake status unknown, then queued after return. Typecheck and fixture pass in
`.local/bootstrap-preack-workerd.log`. This tests the fix prerequisite, not live success.
At08:36:30 native Tasks GET returned an empty list; no hold deletion performed.
Logs: `.local/bootstrap-77-{listener-final,listener-identity,service-inspect}.log`;
private Tasks response `.local/bootstrap-77-tasks-private.json`. V2 expired08:29:50.104Z.
Automatic rollover intentionally rejects unclaimed/uncertain generation8, so further
live work requires explicit recovery evidence, not a fabricated retirement journal.

Read-only browser custody selection08:55:24.966Z confirms epoch8 RECOVERY_REQUIRED,
run77 queued/current_attempt0 and zero attempt rows for that run across all epochs.
The retained reservation is$1. Its manifest hash matches the selected manifest
reconstructed with policy.text_only; that profile and reservation match the activated
v2 configuration. The worker omitted manifest.text_only from its projection, so this
is reconstruction, not a second full-manifest read. There is no independent earlier
ledger snapshot proving historical reservation unchangedness. No native staging or
retirement conclusion follows from this control-plane evidence. Private selection:
`.local/bootstrap-77-custody-selection.json`. No mutation or new send performed.

Unused recovery integration (local/default-off): core consumes a strict explicit
one-use grant only inside a fresh direct-message transaction. Its separate immutable
disposition binds predecessor and successor manifests without retirement/nativeStopped
claims. Exact expired zero-attempt custody and absence of contradictory activity are
rechecked; original run/events/wake/reservation remain retained and unclaimable.
Trial/session/recovery deadlines and lifetime allowance all constrain the successor.
The new operator-only producer pins the reviewed deployed sources/config/template
and private root identities, takes both real flocks, and exclusively creates/fsyncs
the same transition directory before writing a digest-bound immutable marker.
Preexisting or partial directories fail closed; delayed manager staging loses the
same exclusive mkdir. Linux /proc verifies inherited locks. An explicit operator
historical-root-custody assertion is still required; hashes cannot establish it.
No network, Tasks, model, retirement or successor authorization is produced.
Host typecheck,186 focused core tests and6 real-lock producer tests pass. Fresh
host combined verifier exited0 in `.local/unused-recovery-combined.log`:1669 backend,
511 runtime, Worker/browser/native/service fixtures and dry-run build. Its final
status is passed with assistantOperational/productionAdmission/modelJudgmentVerified
all false. Desktop16 pass in `.local/bootstrap-hold-desktop.log`. No live marker,
recovery config, guest update or new composer message has been issued.

Expired trial reconciliation (2026-09-18T08:12:18Z): fixed expiry08:10:39.410Z
passed unchanged; authenticated manager manifest null, same Sprite provider status
cold. One subsequent bounded guest exec observed the registered listener running
with its original07:48 start time and zero staged session directories. The inspection
itself wakes the guest; neither observation proves fresh-process recovery or live
passive navigation. No new trial or model submission. Evidence:
`.local/bootstrap-expired-{reconciliation.json,listener-inspection.log}`.
Browser execution reconciliation: earlier runner list returned none and thread
metadata stayed running_tools, but worker subsequently confirmed billing navigation
completed exit0 with no running command/PID or app mutation. Those observations did
not prove a hung command. No passive bootstrap checks had occurred. Same worker is
now assigned passive-only current attachment/portal readiness; no new trial before
its result and no composer submission authorized.
No credentials transferred and no new fixtures created for this execution blocker.

Manager/native composition and service staging (2026-09-18): host applied the
four-file fixture patch against the published baseline after verifying its digest.
`node scripts/test-codex-hosted-manager.mjs` passes: one actual pinned native start,
one scripted loopback response, zero advertised tools, canonical result
MANAGER_TEXT_ONLY_CANONICAL_47, exact profile/assignment and expiry-gated retirement.
The launchable endpoint correctly returns null after completion; fixture-only
SQLite inspection confirms the retained manifest is unchanged. Legacy hosted-owner
fixture and typecheck pass; generated Env was refreshed with `npm run types`.
Logs: `.local/hosted-manager-host.log`, `.local/hosted-manager-legacy-host.log`.
This uses synthetic Access/TLS, native home, predecessor and activity holds; it
does not prove the default account launcher, live wake, sleep or billing.

Same existing hehebot Sprite: bounded preflight observed8GiB RAM and
1,385,435,136 root-used bytes, not configured caps or billable storage quantities.
Prior generation7 journal plus both real locks provided direct-child retirement
observation at07:44:12.050Z. Persistent listener imports initially lacked generated
contracts; staging was corrected and import passed without native launch.
Supported Service registration at07:48Z returned HTTP200 started/complete for
`hehebot-listener`, port8080. Registration starts the service; monitoring completion
is not readiness or sleep proof. Provider control-plane GET at07:54:08Z reported
cold; process loss is not inferred. Bootstrap Worker deployment and five-secret
activation then completed successfully, fixed trial expiry08:10:39.410Z,
session180s/task120s, conservative prior allowance$1/reservation$1/total$10.
Authenticated manager read returned null before admission and again at08:08:20Z,
when provider inventory was cold. Browser worker's earlier tool call remains stalled
(execution state unchanged since07:37Z); live navigation/message proof is pending,
and no message submission was authorized. Fixed expiry is not extended.
Fresh combined verifier exits0:1644 backend/497 runtime plus Worker/browser/native/
service/build including manager composition. Desktop16 pass. Logs:
`.local/manager-combined.log`, `.local/manager-desktop.log`.
Credentials remain private; task-signing key was not shipped to the guest.
Evidence: `.local/bootstrap-{sprite-preflight,guest-import}.log` and
`.local/bootstrap-service-registration.ndjson`, `.local/bootstrap-idle-inventory.json`,
`.local/message-bootstrap-{deploy,secret-activation}.log`.

Budget interpretation correction: the existing$10 cumulative in-scope approval
permits conservatively estimated bounded work. All-project billing and an enforceable
provider cap were not owner-imposed prerequisites. Keep estimates distinct from
lagged billing, retain prior costs, and escalate credible overrun risk. Neither
reservations nor the observed8GiB establish a future provider cost ceiling.

Message-bound bootstrap integration (2026-09-18, local/default-off): accepted direct
owner messages can receive one immutable run/session assignment in the same SQLite
transaction. Reads never assign or renew it. Expired current-generation settlement,
trusted exact retirement and lifetime reservations gate successors; historical
UNKNOWN work is not adopted. Reservations and a configured prior-cost baseline are
admission bookkeeping, not proof of actual billing or an enforceable provider cap.
The Worker separates manager manifest/retirement authentication from signed fixed
task capabilities and rejects legacy-token fallback while bootstrap is configured.
The DO additionally binds the exact run, manifest hash and current generation.
The runtime manager stages an exclusive private transition directory before launch;
uncertain or partial staging is never replayed. Retirement requires matching journal
nativeStopped plus actual dual-flock acquisition after expiry, not root completion.

Host verification:78 tests across auth, owner binding and bootstrap passed, including
real Worker handler/DO calls over the SQLite test adapter. These are not workerd
or live-provider evidence. Existing UI fixture passed and all eligible/unavailable/
expired screenshots were inspected. Full combined rerun exited0 at
`.local/bootstrap-combined.log`; earlier failed runs remain failed. Core and runtime
patches and the actual-workerd fixture extension are integrated. Host rerun passed
in `.local/bootstrap-workerd-host.log`: zero passive wake intents/reservations,
one persisted message/one wake, fixed token/policy across process reopen, separate
credentials and exact run/epoch/expiry rejection with old UNKNOWN custody unchanged.
The extended fixture arrived after that stage of the combined run, so this host
rerun is separate supplementary evidence. Typecheck and desktop16 passed. All workers
finished; full verifier passed1644 backend/497 runtime plus browser/native/service
fixtures and build dry-run, ending with status passed and productionAdmission false.
No deployment, Sprite Service registration,
live model call or automatic trial enablement in this checkpoint.

Message-triggered wake / quiet listener follow-up (2026-09-18, local only):
`deliverOwnerAlphaWake` requires an existing claimable run before retaining UNKNOWN
intent. The actual workerd fixture proves activation, state/timeline reads and
alarms cause zero notifications/intent; an accepted, persisted message is present
when the sole notification callback runs. Historical custody remains byte-identical
through alarms/reopen. `--listen` permits a quiet service without a session timer;
`--serve` retains330s. Neither mode creates grants. The warm listener reads current
private immutable staging only after authenticated work and retains prior intents.
The actual CLI boots without staged config, rejects unauthenticated wake and stops
cleanly on SIGTERM. No Service installation or deployment performed for this change.

Verification: typecheck;41 focused successor/auth tests;19 listener/launcher tests;
`scripts/test-hosted-wake-transport.mjs`; two successful runs of
`scripts/test-owner-alpha-successor-worker.mjs` after consuming fixture POST bodies.
The full combined run first failed because an auth fixture lacked getAlarm;
that mock now retains alarm state. The rerun reached local Worker integration but
failed with workerd's unconsumed request-stream error. Both fixture regressions
are fixed; targeted passes do not retroactively make that full run green.
Logs: `.local/message-wake-{combined,combined-rerun,auth-fixture,worker-fixed}.log`.

Read-only browser billing evidence, observed2026-09-18T06:32:06Z, org
kaspar-hidayat: September1–18 Cost Explorer Total Spend$0.03; upcoming September1–
October1 invoice subtotal/amount$0.03; credit balance$0.00. Rounded RAM$0.02,
CPU$0.00 and hot-storage$0.00 do not sum to rounded total. Sprite hehebot was cold.
No tax/credit line, metering-lag bound, RAM allocation or cold-storage quantity was
shown. Advertised$30 credit is not usable-credit evidence. This excludes separately
billed Cloudflare/inference and is not proof of$9.97 remaining in the$10 total.
No billing/resource changes or credentials disclosed. Official current CPU rate
$0.07/CPU-hour, RAM$0.04375/GB-hour, hot storage$0.000683/GB-hour, cold storage
$0.000027/GB-hour; no documented RAM ceiling or Sprites-token cumulative-billing API.
Actual all-in costs remain unverified; do not substitute CPU-only estimates.

Hosted wake diagnosis (2026-09-18): the official working-with-sprites guide permits
default8080 HTTP routing without a named Service. A bounded foreground120s probe on
the retained Sprite observed private-edge401, app-token401 and exact queued202;
duplicate delivery stayed queued, expired synthetic policy refused native launch,
and exit0 left no native state. This does not recreate a listener after cold boot.
The receiver now aborts launch before closing held connections;17 focused tests pass.

Generation4 exposed an alarm starvation bug: each5s portal refresh postponed the
5s generation alarm. Preserve an earlier stored alarm instead. Real workerd regression
failed before and passed after; first green run later lost a Miniflare connection,
isolated rerun passed. Fix deployed. Generation5 still retained UNKNOWN delivery and
RECOVERY_REQUIRED, not missing wake metadata. Listener exit0 and empty state do not
retroactively settle the delivery. Private config/modes passed readback. Historical
observability query returned403/code10000; no token scope/root-cause inference.

Generation6 attached tail before activation and logged request-phase failure with
null upstream status. Actual local workerd, using the default fetch and a real HTTP
receiver, reproduced: TypeError, invalid redirect value; only follow/manual supported.
The receiver saw zero requests. A direct wrapper also failed, ruling out the proposed
unbound-fetch explanation in this reproduction. Changed redirect:'error' to 'manual';
existing strict202 receipt validation rejects3xx without following or forwarding
credentials. The new credential-free scripts/test-hosted-wake-transport.mjs passes
real202 and302/no-follow, and is included in verify-codex.sh. Sender diagnostics retain
only controlled stage/numeric status, never response text, headers or thrown messages.
Four unit checks/typecheck pass. Fix deployed; generation6 remains UNKNOWN and its
listener exited0 with empty session and both locks available.

Generation7 activation applied05:47:10.696Z, receipt7744f413-71ac-4501-9eed-6c45cf2ea0a5.
The Worker-triggered listener emitted actual owner-alpha.ready, session
df18567e-bba1-42fc-98a7-4927ba74ed3f, expires05:51:05.490Z/max1 run120s. No manual native
launch or old-generation replay. One normal UI submission at05:48:46.952Z, receipt
6abe74c6-a373-4b6c-a232-76d281e5044c/runf8063115-21c9-45c8-b188-249854de0fef, completed
05:48:52.786Z (5.834s). Canonical run.result90fddf49-0ee0-458c-b38d-e8eb5b14e23e
contains exact HEHEBOT_WORKER_WAKE_OK_76, coordinator/Chief of Staff, matching cause.
Full reload confirms completed/attempt1/error null and one matching user event. Prior
74/75 and the original recovery/waiting tasks remain unchanged. Inspected screenshot
.amp/in/artifacts/worker-wake-76-completed.png shows recorded Completed/exact text;
role attribution comes from canonical event readback, not the cropped image alone.
Listener emitted stopped/LAUNCH_EXITED and exited0 after the grant expired. Readback
05:53:04.617Z: service recovery/nativeStopped:true, intent still unknown, both locks
acquired, zero matching executors and zero census read errors. No universal termination
or old settlement claim. Production flags remain false. No new Sprite, registered Service,
upgrade, connector or auth-cache copy. Billing remains unverified under the original
$10 total ceiling. Private evidence: .local/wake-generation{4,5,6,7}-*,
wake-{default,bound}-fetch-repro.log, wake-real-transport-green.log,
wake-final-{unit,runtime,worker,build}.log and wake-redirect-fix-deploy.log. Final targeted
real Worker/reopen, transport,4 unit/17 runtime, typecheck/build passed. No new combined
full-green claim; its earlier fixture failure remains recorded below. Next is safe cold
listener recreation and session staging, not renewal/replay of this consumed generation.

Staged wake delivery (2026-09-18, local): optional HEHEBOT_OWNER_ALPHA_WAKE contains
exact transition_id and root HTTPS sprites.app URL, using existing PROVIDER_TOKEN
plus HEHEBOT_OWNER_ALPHA_WAKE_TOKEN. It is accepted only in hosted alpha mode. Alarm
delivery records owner_alpha_wake:<epoch> UNKNOWN atomically before the first await,
requires exact live BOOTING generation/boot/lease/policy and empty provider reference,
and never changes epoch or controller operations. Any existing delivery record prevents
retry, including reconstruction after unknown transport outcome. An exact202 receipt
marks only delivery queued. The normal lease watchdog cadence remains active after
failure. HTTPS dispatch forbids redirects, caps receipt4096 bytes and elapsed15s,
and exposes only fixed errors. No service start, policy renewal or credentials in DB.

Verification:23 focused tests/typecheck; actual workerd alarm with fixture transport
made one notification across two alarms, retained queued intent and watchdog cadence,
and preserved predecessor rows/reopen/epoch3 continuation. Combined check passed1609
backend/485 runtime tests then failed with500 Network connection lost in the initial
global-fetch-interception Worker fixture. Cause unproved; final fixture uses a narrow
transport override and passed separately. Build and16 desktop tests pass. Logs:
.local/alpha-wake-delivery-{focused,combined,worker,build,desktop}.log.
No deployment/live wake/model activity. Official Services API lists no restart-policy
field; safe bounded listener/service lifetime remains to be verified before enabling.

Read-only provider audit:2026-09-18T04:40:59.092Z GET /v1/sprites?max_results=50 returned
200, sprites=[hehebot:cold], has_more=false,next_continuation_token=null.
04:40:59.425Z GET /v1/sprites/hehebot returned200/name hehebot/status cold. CLI selected
org kaspar-hidayat; provider org/count/nested pagination/data were not retained and
cannot be inferred from that selection. No guest/service/session calls or mutations.
Sanitized evidence .local/sprites-readonly-inventory-20260918.json. Retained resource,
not abandoned; old UNKNOWN custody remains. Actual billing still unverified.

One-shot hosted wake preparation (2026-09-18, local only): a default-off HTTP
composition reuses the authenticated /wake queue parser. Its callback requires the
staged epoch/transition ID, authenticated BOOTING status, exact policy, generation,
owner binding, hosted marker and disabled production execution. Config bytes are
rechecked after status and pinned through the dual-lock launcher. An exclusive wx
mode0600 intent is fsynced with its directory before launch and never reset, including
launch errors. Independent listeners racing the same state launch at most once;
reconstruction refuses existing intent. HTTP202 is only queued acknowledgment.
CLI --serve takes absolute config/token paths and port, closes after330s and must
not be installed with automatic restart. No autonomous generation staging, renewal,
credential rotation or provider/control wake wiring is claimed. No live deployment.

Entrypoint reports bounded allowlisted failure codes with run/stop stage and separate
policy-expired/operator-aborted observations. Arbitrary exception code/message text
is excluded, original rejection remains nonzero, and failed stop does not emit stopped.
Thirty focused tests pass (including races, reconstruction, config TOCTOU, expiry
boundary and redaction). Combined verifier passed1605 backend/485 runtime tests and
local control checks, then exited1 when successor Worker returned500 Network connection
lost at same-key receipt readback. One isolated rerun passed; cause remains unproved.
Separate native hosted fixture, typecheck/build and16 desktop tests pass. This is not
a full verifier pass. Evidence .local/alpha-hosted-wake-{focused,combined,worker-rerun,
native,build,desktop}.log. No new provider/model calls or spend.

Live settled-session continuation (2026-09-18): epoch2 service journal recorded
recovery/nativeStopped:true and exact generation; bounded census found zero matching
Codex/workspace processes and zero read errors. Both predecessor locks acquired with
a no-op. No additional Sprite restart. These support restricted non-hostile alpha,
not universal descendant termination. Prior native auth/config/journals stayed in place.
Continuation Worker code deployed; bearer and epoch3 pin changed atomically. Independent
checks returned401 UNAUTHORIZED for epoch2 and409 STALE_EPOCH for epoch3 before activation.
Fresh credential/session directories were staged; same existing Access service scope.

Authenticated activation673418aa-e370-4cbf-a364-104bb62f792f applied03:30:53.819Z.
One UI commandda47d2ce-5f67-478b-b367-6ba50aacb626 at03:32:12.944Z admitted
runa5dd9a1c-2af6-4391-b40a-9a8c63186722, attempt1. Canonical run.result
49835173-2651-48be-872a-552dfda01a99 at03:32:18.427Z (5.483s) retained exact
HEHEBOT_CONTINUED_CHAT_OK_75, completed/error null, correct Chief of Staff/cause/run.
Full reload confirmed exactly one matching user event and completed result. Previous
completed74, old recovery0639f8f7 and waiting7481a204 stayed unchanged. Host independently
read one completed native textOnlyReceipt in session3 journal. No other model/task action.
Evidence .local/alpha-continuation-{stop-evidence,authority-check,receipt}.json,
.local/alpha-generation3-{launch.log,completion-receipt.jsonl,stop-evidence.json}.
Policy expired03:35:06.382Z with max3 admitted roots. Launcher emitted stopped,
stateRetained:true/replayAllowed:false, then exited1 with the generic refusal/stop
message; the specific exception is not exposed by that CLI. Independent retained
service readback confirms phase:recovery/nativeStopped:true. This verifies direct-child
stop, not universal descendant termination, effect settlement or safe sleep. No retry.
This is session rollover verification,
not ongoing availability. No new resource, upgrade or connector; actual billing unverified.

Settled-session continuation (2026-09-18, local): a fresh owner-alpha.activate grant
can append epoch3+ after the current text-only generation's policy and lease expire.
Every prior-generation attempt must be completed with an exact stored profile/turn/
output receipt and completed coordinator release. Unsettled operations/effects/locks,
questions or controller activity reject. A never-used expired generation may advance.
The original epoch1 unknown-retirement path is unchanged. No policy/quota is renewed
in place, historical result promoted, or prior journal replayed.

Reconstruction validates numeric contiguous generation order, exact predecessor
session/boot, increasing event cutoffs, unique identities and immutable activation
command/event digests. Later claim/watchdog SQL is current-generation-only, preserving
all earlier attempts/effects rather than excluding only the immediate predecessor.
Core epoch1→2→3 fixture preserves original dispatched effect and intermediate queued
message, refuses unfinished/failed/recovery statuses, changed receipt digest and held
lock, and rejects identity reuse/missing middle generation. Real workerd fixture
advances unused epoch2, reopens SQLite again and expires epoch3 with retained epoch1
custody unchanged. Runtime already accepts exact descriptors with epoch>=2.

Focused116 and final41/typecheck pass; desktop16 pass. The full verifier exits0 with
1605 backend/473 runtime plus native/Worker/browser/build checks in
.local/alpha-continuation-combined.log. Its extended Worker fixture passed, as did
an explicit WRANGLER_SEND_METRICS=false run. Three isolated direct invocations lost
a local connection during same-key readback; cause remains unproved. Evidence logs
.local/alpha-continuation-worker{,-rerun,-final,-metrics-off}.log preserve both failures
and success; no fixture retry hides these outcomes. No live/provider/model/deployment
or credential change. Operator process-retirement evidence and new server-bound
credentials remain necessary before any later hosted activation; database settlement
is not universal descendant retirement or safe-sleep proof.

Bounded restart follow-up (2026-09-18): owner said fix/continue. Current official
sprites-js0.2.3 at390eb6353576f5da57ef7ec4b7f1eec5223de5f3 confirms the initial empty
POST was correct; no version/body/idempotency/completion endpoint was missing.
Official Go error handling recognizes empty proxy502 and retains Fly-Request-Id.
Owner-requested oracle approved one additional same-Sprite attempt while predecessor
authority was revoked, no successor/autostart existed, with five-minute cap and
120-second observed stability. This is operational convergence, not deduplication
or a provider guarantee against delayed restart. The first unknown record is retained.

Precheck /check returned healthy. Second POST returned202 with Fly-Request-Id saved
privately; changed kernel identity observed at36s and stable122s at158s. Each read
verified same Sprite ID, retained disk nonce and empty services. No third request.
Evidence: .local/alpha-recovery-second-attempt.{json,log}. New disposition receipt
retains late-restart interruption risk, historical unknown settlement and no replay.

Generation-binding Worker code deployed; private pin configured and preactivation
runtime status denied409 STALE_EPOCH. Authenticated owner activation returned202
applied; runtime started fresh session/journal with one120s run and a five-minute
policy. Exactly one new message accepted03:00:56.993Z completed03:01:04.009Z (7.016s).
Receipt595cc42a-d77b-40fc-b27f-c30f2e7867b5/runaaeae25c-6b7b-473a-9f00-c61d70bd3fd7
bind canonical run.result9521ef1d-8cc4-408f-97f8-56ac0d5215bf, exact
HEHEBOT_HOSTED_SUCCESSOR_OK_74, Chief of Staff/coordinator/attempt1/error null.
Full reload retained completed task and canonical event; no provisional-only claim.
Host independently read native completed outcome plus textOnlyReceipt from first-party
journal. Historical recovery/waiting tasks remained unchanged; no task replay/cancel.
Inspected cropped .amp/in/artifacts/hosted-successor-74-completed.png shows recorded
Completed reply only. The launcher exited0 after expiry, state retained/no replay.
This proves bounded hosted completion, not persistent availability, historical effect
settlement or all future recovery. Next is safe bounded session continuation.
No old state or native auth cache copied, no new Sprite/connector/upgrade. Catalog
comes from pinned supported `codex debug models` on the authenticated Sprite;
selected genuine model metadata retains only deliberate direct-tool-mode and empty
experimental-tool-list overrides. Source catalog stays private, not redistributed.
The42KB config exposed a32KB launcher limit: raised to128KiB with exact-limit/+1 and
genuine-sized cases plus launcher/owner tests18 passing. No new broad suite repeated.
Production gates false; observed recovery is not production sleep/containment proof.

Restricted-alpha recovery (2026-09-18): owner-requested oracle supersedes the
universal retirement prerequisite below for this one supervised text-only trial.
The operator receipt means execution-authority retirement with observed restart
evidence, not historical settlement or hostile-workload containment. The server
binds its digest; it cannot independently attest physical evidence. Preserve old
unknown records and forbid replay. No production/native/sleep gate is relaxed.

Local Worker binding: after RUNTIME_TOKEN verification, private
HEHEBOT_RUNTIME_GENERATION parses exactly {epoch,boot_id,transition_id}. The trusted
RPC argument must match the persisted hosted successor generation and lifecycle
before any runtime reconciliation/mutation, including status and boot. Payload
identity must match; the credential cannot simply assert predecessor authority.
Reconstruction does not require the consumed successor grant. Missing/mismatched
pins deny; malformed pins return503 after authentication. Legacy local behavior
is retained. Full verifier exits0 (1605 backend/472 runtime plus native, browser,
Worker and build checks); desktop16 pass. Later focused63/typecheck also verify
missing/wrong-transition/malformed pins and authentication-first rejection.
Logs: .local/alpha-recovery-{combined,focused,desktop}.log. Code remains local,
not pushed or deployed; only the live secret was rotated.

Live authority cutover: predecessor runtime bearer returned Worker401 UNAUTHORIZED
after rotation. Browser worker deleted predecessor Access service token, changed
only the existing internal policy's token binding and read back after reload;
parent owner app/policy unchanged. Host independently confirmed predecessor401 and
successor404 JSON from Worker at internal/access-scope-probe. Fresh credentials
are0600 in this orb only, never placed in Sprite. No activation/model call occurred.

Exactly one supported POST /v1/sprites/{name}/restart returned502 with empty body.
First observation could not exec (temporarily unavailable); two later bounded
observations succeeded with UNCHANGED kernel boot identity. Same immutable Sprite
ID and disk nonce hash were preserved. The live inspector exited naturally at180s,
not because verified reboot terminated it. Disposition is restart_unconfirmed;
no second restart or claim that Sprite malfunctioned. Private intent/evidence:
.local/alpha-recovery-restart-request.json, restart-before.log, restart-after*.log,
restart-final.log, identity-before/after.json and alpha-recovery-disposition.json.
The disposition explicitly forbids successor activation and old replay; never use
its digest as a successful-restart grant. Next provider question: how do we observe
completion of this restart request, given502 and unchanged kernel identity?
No public post/contact authorized or performed. Incremental billing unverified;
same resource only, no paid upgrade, new Sprite, inference or connector activation.

E11 read-only token display (2026-09-17, local): expanded conversation/current-task
and routine-history cards share strict unique-current-attempt validation. Native
cumulative and last snapshots retain six separate counters plus nullable context
window; attempt/version identify the observation, not freshness. Missing, malformed,
duplicate and mismatched observations show unavailable. Selected page data never
falls back to global state, and recovery-only pages have no usage contract. Counts
are literal DOM text, not dollar estimates, percentages, sums or settlement proof.
Usage-only changes participate in rendering; no new polling, route, command or grant.

`node scripts/test-portal-token-usage.mjs` passes asymmetric/decreasing/zero/absent/
malformed/duplicate/stale and page-isolation cases with35 existing GETs/zero writes.
Task, routine-history and alpha-session neighbors pass; build/typecheck and desktop16
pass. Final desktop1280px/narrow390px at2x and unavailable screenshots inspected:
token labels/counters/disclosure readable without clipping. Wide unavailable capture
also shows unrelated existing search-header overlap; not changed here. Screenshots
`.amp/in/artifacts/token-usage-{desktop,narrow,unavailable}.png`; logs
`.local/token-usage-ui-{final,desktop}.log`. Chromium synthetic API evidence, not
physical mobile/touch/Safari/live production verification. No CSS/backend or live
changes/spend. Fixture added to verifier; prior backend1604/runtime472 evidence below
predates only this UI-only stage, not a newly rerun full suite.

E11 token snapshot publication (2026-09-17, local): existing native journal usage
is sent through `token-usage` during the existing task-control output-maintenance
cadence. Root and registered-child observations retain separate task/attempt/native
bindings. A durable pending payload precedes dispatch; unknown acknowledgement must
retry that exact version/content before newer snapshots, including decreases.
Unchanged observations add no calls. A fenced target stops further publication.
This adds no inference, provider wake path, tool or task grant.

Worker `TokenUsageSnapshots` validates six safe nonnegative integer counters per
total/last group and nullable context window. Current epoch/boot/attempt/native
reference, active status and deadline are required. Same-version semantic duplicates
do not write; conflicts and stale versions reject. Counts replace, never accumulate.
Fixed first-observation90-day retention cannot be extended by updates. Ordinary
maintenance prunes; successor mode preserves its existing historical boundary.
Owner state/task pages expose `token_usage_snapshots` only for returned current
attempts, without native references. Terminal readback is historical observation,
not guaranteed final/fresh usage. Absence is unknown, not zero; root and child
native context/session snapshots are not additive task spend or billing receipts.
Neither observations nor reads settle work, modify budget or refresh progress.

Core14 and preview-neighbor13 tests, runtime publisher4 and actual signed-Access
Worker8 tests pass, including exact uncertain retry, replacement/decrease, custody
fences, malformed input and unchanged task rows. Desktop16 pass. Combined verification
passed1604 backend/472 runtime and browser/HTTP checks before the process disappeared
without a final marker; remaining crash/native/service/build sequence resumed
separately and exits0. This is not an uninterrupted full-verifier pass.
Logs `.local/token-usage-{focused,combined,combined-remaining,desktop}.log`.
No UI/live deployment/provider/model call or additional spending in this stage.

Retirement investigation (2026-09-17): one bounded read-only census on the verified
same immutable Sprite returned tini/tail plus inspector, no per-process errors,
one observed PID/mount namespace. Independent provider GET found no service
definitions; exec-session listing found none. This narrows visible surviving work
but does not establish namespace completeness or correlate missing historical
PID/start/namespace IDs. Empty configured model tool allowlist is not proof that
legacy native tools could not create processes. Unknown task/effect custody remains.
Private evidence: `.local/sprite-retirement-{inventory,identity,services}.json` and
`.local/sprite-retirement-sessions.log`. No code changes or tests needed for this
inspection; previous combined1590/467 and desktop16 evidence unchanged.

The official SDK exposes [restartSprite](https://github.com/superfly/sprites-js/blob/4c2b346ed35456e07b5a69cd00a53292e40d6fc4/src/client.ts#L305-L321),
POST `/v1/sprites/{name}/restart`, described only as restarting the backing machine.
Its mocked202/queued response is not completion proof. Public server semantics
were not found. [Service docs](https://docs.sprites.dev/concepts/services/) describe
sticky stops but also HTTP-triggered autostart; their interaction with this endpoint
is not a proven fence. Guest Linux reboot has PID-namespace-dependent behavior and
must not be improvised on retained custody.

Exact provider clarification needed: does this restart discard all prior guest
execution/memory and prevent later restoration, preserve the immutable Sprite ID
and current filesystem without rollback, and preserve explicit service-stop fences
against HTTP autostart? Which observation proves completion rather than queued
acceptance? No provider contact or restart was performed. Inspection billing remains
unverified; no inference, new resource, paid upgrade, replay or deployment.

Successor command integration (2026-09-17, local/unpublished): authenticated
same-origin `/v1/commands` accepts `owner-alpha.activate` with only
`{transition_id,envelope_sha256}`. The digest identifies the parsed/canonical
operator envelope from default-absent private `HEHEBOT_OWNER_ALPHA_SUCCESSOR`.
Worker configuration requires original hosted alpha (Access, both production
flags false, empty provider); successor binding must equal the actual durable
owner-auth digest. Browser/runtime inputs cannot supply replacement authority.
Activation uses the normal accepted→applied command transaction, persisting full
consumed authority and command digest in immutable generation metadata. The ingress
uses canonical JSON hashing: lifecycle must retain this supplied digest rather than
recompute it with property-order-sensitive JSON.stringify. Reconstruction does not
need pending operator config and validates command fields independent of key order.
Activation bypasses historical reconciliation even when rejected; applied activation
arms only generation supervision. Ordinary ingress behavior remains unchanged.

Real workerd/SQLite fixture now calls actual PersonalControl.accept, snapshots old
custody before activation, retries equivalent reordered JSON through canonical
HTTP hashing, and verifies reads/alarms/persistent reopen. Signed-Access fixture7
also verifies valid configured startup, missing grant, wrong JWT/Origin, no internal
runtime activation and owner-binding mismatch refusal. Combined verification exits0:
1590 backend/467 runtime plus Worker/native/browser/build in
`.local/alpha-activation-combined.log`; desktop16 pass in
`.local/alpha-activation-desktop.log`. Final targeted Worker fixture additionally
rejects a changed digest without mutating old lifecycle, alarm or history
(`.local/alpha-activation-worker.log`). No UI appearance changed in this stage.

One bounded same-Sprite kernel observation at18:28UTC matches the retained baseline
exactly (`.local/sprite-retirement-kernel-followup.log`). It supplies no retirement
evidence. No live activation/deployment/model call or new resource; probe billing
increment remains unverified. Existing $10 total authority, gates false and all
historical uncertainty remain intact. Older stage descriptions below are historical.

Worker successor follow-through (2026-09-17): once an active generation exists,
`PersonalControl.reconcile` runs only the generation-fenced watchdog. Retention,
routine/retry/budget/question/preview/steering and other maintenance remain suspended
for this bounded successor, preserving historical custody rather than reconciling
it. Alarm selection ignores old due times; recovery deletes the alarm. Internal
runtime status exposes only the generation's epoch/boot/transition descriptor.
Ordinary no-successor maintenance is unchanged.

The new `test-owner-alpha-successor-worker.mjs` starts actual workerd/SQLite with
allowlisted subprocess environment and disposable storage. Actual state reads,
fresh accept and explicit alarm invocation preserve old run/attempt/unknown effect,
overdue retry, queued context/command/event and original policy. Successor lease
expiry still closes epoch2. Stopping/reopening Wrangler on the same disposable
SQLite preserves exact history, lifecycle, descriptor and absent alarm. Synthetic
fixture-only applied activation is not a public API or retirement proof. Script,
ordinary27 Worker checks and existing migration/capacity cases, typecheck/build
pass; logs `.local/alpha-successor-worker{,-reopen}.log`. Added to the combined
verifier; the previous full1590/464 run below predates this narrow follow-up.
No live resource/account/model calls, deployment or additional spend.

Retained generation core (2026-09-17, local/unpublished): trusted internal
`LifecycleCore.activateOwnerAlphaSuccessor` can consume a matching preexisting
synthetic applied command and operator binding. It validates expired recovery
custody and atomically appends one epoch2 generation/activation event while advancing
only lifecycle ownership. This first implementation refuses further transitions.
The original configured policy/custody remain unchanged. Active policy resolves
through the generation, its command receipt and exact event-sequence cutoff;
quota derives from retained attempts. Old input cannot become fresh through requeue.
Claims exclude only the exact retired predecessor from executor capacity, and
watchdog preserves that predecessor without weakening ordinary lifecycle handling.
No historical task acquires the new text-only contract.

Runtime `ownerAlphaGeneration` pins epoch/boot/transition before status/boot RPCs
in a fresh journal, requires matching hosted text-only policy and owner binding,
and uses only the preselected boot identity. Mismatch refuses before provider hold
or native launch. Host review corrected mutable generation admission tracking,
added activation receipt/cutoff reconstruction checks and independent status epoch
validation, and bounded the initial transition rather than pretending a full
multi-generation chain was verified. Focused121 backend and54 service tests pass;
final retention/cutoff checks19 pass. A first combined run exposed `causation_id`
instead of existing `cause_id`; corrected. Full rerun exits0:1590 backend/464 runtime
tests,27 Worker HTTP checks plus native/browser/service/build; desktop16 pass. Evidence:
`.local/alpha-generation-{focused,retention,combined,combined-rerun,desktop}.log`.

This is not a publicly callable activation: command schema/dispatch, pinned operator
configuration, runtime status descriptor and Worker-wide historical maintenance
exclusion are still unwired. The internal fixture inserts a synthetic applied
command; real activation must remain an authenticated idempotent `/v1/commands`
transaction and derive authority from operator configuration, never browser claims.
The current core method's applied-command requirement needs adapting to that
transaction without permitting an unbound command. Process-retirement evidence is
still unavailable, and none of this establishes provider retirement or live chat.

Successor authority preparation (2026-09-17): `parseOwnerAlphaSuccessor` and
`assertOwnerAlphaSuccessorBinding` validate a default-absent, one-shot operator
envelope with exact owner binding, predecessor session/epoch/boot, retirement
receipt digest and fresh text-only successor policy/boot. Existing policy parser
remains the source of truth. Epoch advancement must remain safe; UUID case changes
cannot disguise reused session/boot identities. No config wiring, command, state
mutation or activation exists yet. Focused successor/alpha/session-view76 tests and
typecheck pass (`.local/alpha-successor-contract.log`); the full verifier below
predates this non-wired parser. Receipt hash binding is not retirement proof.

Focused design review selected operator-pinned authority over a new signing-key
subsystem: the operator already controls deployment/auth. The owner command must
only consume that exact grant. Immutable generation metadata can bind existing
attempt epoch/boot fields, without an attempts schema migration. Use an event-
sequence cutoff, not clock equality, for fresh messages. Both the transition's
pre-request reconciliation and later pruning/watchdog/budget maintenance must
exclude retained historical custody; merely preserving rows in the transition
transaction is insufficient. Keep the original configured policy and custody,
derive active policy from a validated generation, and bind a preselected successor
boot identity. The parser does not implement any of these later stages.

Text-only completion integration (2026-09-17, local/unpublished): a fresh immutable
alpha policy can pin `codex-text-only-v1` and its profile digest. The adapter records
that admission before native RPCs, empty dynamic tools/environments and exact ACK
identities. Service completion refreshes config/catalog and full native history,
flushes routed observations, checks every output digest, rejects forbidden history,
and projects settled coverage only for the admitted profile and completed root.
A settled heartbeat and cancellation check precede the backend completion request.
The backend checks the current fenced attempt, completed coordinator release,
exact output digest and absent children/effects/locks/questions/unsettled operations;
it commits the canonical receipt with the result and rejects changed or missing
proof on replay. Legacy sessions remain ineligible; alpha sleep remains denied.

Focused checks pass112 runtime and88 backend/bridge tests. New real pinned native
`test-codex-service.mjs --text-only` uses a disposable HTTPS Worker/SQLite and one
scripted provider request: completed run, one attributed persisted `run.result`,
exact receipt and no residual preview. The normal service case also passes.
Native owner-alpha receipt now refreshes final config/catalog/history and derives
notification health from observed transport state. This is scripted local evidence,
not genuine account/model catalog provenance or hosted acceptance. Host integration
found and corrected wrong verifier input, missing pre-admission pin and insufficient
live/readback output comparison. Service corruption fixtures retain uncertainty.
Combined verification includes the new native service case and exits0:1571 backend/
457 runtime tests,27 Worker HTTP checks plus native/browser/service/build; desktop16
pass. Evidence is in `.local/text-completion-{focused,backend,combined,desktop}.log`.

The next retained-session transition must append an immutable generation and
retirement evidence, advance only executor ownership, and admit messages strictly
after its committed cutoff. It must not call generic stopped reconciliation, which
settles operations and can schedule retries. Preserve old policy, attempts, effects,
locks, previews and journals; old work cannot inherit the new text-only profile.
No transition implementation or live rollout is claimed by this checkpoint.

Text-only profile integration (2026-09-17, local/unpublished): the shared
`codex-text-only-v1` constructor supplies the actual CLI overrides, thread model/
empty dynamic tools and turn empty environments used by the native fixture.
Host review removed duplicated fixture configuration, added absolute catalog-path
binding, rejected mixed synthetic/genuine attestations and contradictory optional
tool readback. Catalog provenance/account checks remain caller attestations, not
proof produced by this helper. Native validation still returns completionEligible
false. Profile/transport28 tests and all three native owner-alpha modes pass;
text-only has17 exact unsupported calls, empty tools on every provider request,
two root outputs and unchanged private config/catalog. No historical attempt gains
eligibility. Runtime/service admission, coverage and backend completion remain
unimplemented. Logs: .local/text-only-profile-{native,neighbor,normal,runtime}.log.

The retained-session review also found and fixed a concrete lifecycle race:
provider observation awaits now compare epoch, boot ID, provider reference and
controller operation against captured ownership before any cleanup/wake/stop.
Tests cover changed recovery generation, same-epoch identity changes, matching
positive retirement and an idle Sprite reference change; concurrent state is
preserved. This does not change provider stop semantics or authorize retirement.
Focused lifecycle/provider/typecheck evidence is in
.local/text-only-profile-lifecycle.log (126 tests). Combined verifier exits0 with
1562 backend/449 runtime tests,27 Worker HTTP checks plus native/browser/service/
build; desktop16 pass. Logs .local/text-only-profile-{combined,desktop}.log.

Retirement evidence remains distinct from task completion. Official
[Sprites lifecycle](https://docs.sprites.dev/concepts/lifecycle/) says actual cold
discards all process memory, but also calls the transition unobservable. The
[Get Sprite API](https://sprites.dev/api/sprites/) exposes cold/warm/running
without a post-generation observation ordering contract. The documented
[exec kill](https://sprites.dev/api/sprites/exec) signals a process group; it does
not promise escaped-descendant termination. No historical exec-session ID was
retained; an owner-alpha session ID is not a provider exec ID. Fresh cold GET alone
must not clear global custody. Next retirement work needs immutable Sprite identity,
expected epoch/boot, no-restart fencing and authoritative post-execution memory-loss
evidence. Even that would retire processes only: old output stays provisional,
unknown effects/locks persist and no historical replay is allowed.

One authorized read-only exec probe (timeout10s, exit0) reused the existing Sprite:
kernel btime15:10:31Z, observed16:29:38Z, uptime4747.40s, after the failed13:18Z
attempt. This initially looked promising but does NOT prove a reboot. The
[Fly forum clarification](https://community.fly.io/t/when-is-a-sprite-actually-cold-reported-cold-sprite-woke-with-its-original-process-running/28288/3)
explicitly says cold often retains memory and btime updates on resume; reports
include original processes/boot IDs surviving13–28h of cold status. Current boot
ID is retained privately in .local/sprite-retirement-kernel-observation.log as a
baseline, not a retirement receipt. Relevant retained Sprite/hosted logs contain
no earlier kernel boot ID. Application boot_id is a random UUID and cannot be
compared to the kernel ID. A verified later kernel-ID change on the same immutable
Sprite, with no-restart and generation fences, is a possible evidence path;
repeated cold/btime polling is not. No service change, new model call, credential
movement, deployment or new paid resource. Probe billing increment and cumulative
balance remain unverified; existing total $10 authority continues.

Hosted trial outcome (2026-09-17): runtime-only Access app and dedicated service
credentials passed independent host and Sprite ControlClient tests, including
owner-binding digest match, wrong/missing bearer401 and public root/state302.
Authenticated browser /v1/state200 proves initialization. Owner approved connecting
runtime/chat under remaining existing $10 with no repeated scoped approvals.
The real launcher reported READY epoch1/providerHold:true with productionfalse.
Browser sent exactly one fresh prompt at13:18:28.168Z: command
7ee4ae8b-4779-4d92-bb6b-1a2857184954, run0639f8f7-0d27-411f-a57f-a2c56689c9fa.
Exact HEHEBOT_HOSTED_CHAT_OK_73 preview persisted across reload (attempt1/version1),
but no completed assistant event. Native journal independently reports rootSettled
true/nativeOutcome completed/status finishing and retained family. At13:20:28.657Z
deadline caused cancellation; at13:21:11.749Z readback was recovery_required /
CANCEL_UNCONFIRMED. No manual cancel/retry/replay. Old waiting run
7481a204-9126-4ed3-a8db-a0106e7a9156 remained attempt0/CAPABILITY_UNAVAILABLE.
Session expired13:22:11.726Z plus30s grace; launcher exited0 with retained state,
settlementProved:false/replayAllowed:false. Worker RECOVERY_REQUIRED, gates false.
Sprite initially observed warm, later read-only observation cold; neither wrapper
exit nor VM phase proves recursive termination. This is NOT successful completed chat. Inspected cropped screenshot:
.amp/in/artifacts/hosted-chat-provisional-readback.png. Private logs/readbacks:
.local/hosted-chat-{deploy,launch}.log, hosted-runtime-auth-check.json,
hosted-chat-final-status.json and sprite-chat-after.json. Existing expired policy
and journals must remain; no reset or retrospective completion qualification.

Local follow-through: source investigation and focused oracle confirm root-only
observations cannot justify the five-part completion receipt. Goals can continue
after turn completion; current MCP/shell/extension surfaces are not closed, and
history permits late item completions. Added --text-only to existing native
fixture using supported empty environments, static direct model catalog, no MCP/
dynamic tools, and disabled goals/hooks/utility features. Passed: exactly empty
provider catalog on every request,17 exact unsupported dispatches, two root outputs,
no background terminals, unchanged original config/catalog, three loopback calls.
Initial config/read assertion failed because extension tool settings are omitted;
kept exact behavioral catalog/dispatch assertions rather than invent readback.
completionEligible remains false; no live admission change. Full verifier includes
new mode and exits0:1556 backend/444 runtime tests,27 Worker checks plus native/
browser/service/build; desktop16 passed. Logs .local/hosted-text-only-{combined,desktop}.log.
No active check remains. Next is a distinct
versioned closure/receipt/coverage contract plus narrowly scoped Worker completion
and retained-session lifecycle, not longer timeouts or claiming root settlement.

Hosted runtime preparation (2026-09-17): owner confirms portal loads and authorizes
runtime/supervised chat under remaining existing $10 total without repeated scoped
approval. Existing Sprite observed cold, no executor. Current tracked source copied
to distinct /home/sprite/hehebot-hosted-chat; npm locked install, pinned0.154.0 and
provider build pass. Existing native auth remains in place; supported account/read
(refreshToken:false) and model/list confirm ChatGPT/gpt-5.6-luna, no inference.
Real Sprite Tasks GET404→PUT200→readback→renew/readback→DELETE204→GET404 passed.
Native profile fixture initially failed before any turn/model request because
bundled bwrap rejects Sprite's inherited capabilities. Identical fixture under
setpriv with bounding/inheritable/ambient caps dropped and no-new-privileges passes
in825ms: config bytes unchanged, restricted profile readback, exact root outputs,
spawn denials/no children. Effective/bounding/ambient caps all0 and NNP1 verified.
No dependency patch or sandbox bypass. This is not recursive termination proof.
Dedicated private runtime bearer deployed as Worker secret; no alpha admission
yet. Existing browser worker owns runtime-only Access Service Auth setup, parent
owner app unchanged. No model calls, new Sprite, connector/routine activation or
paid upgrade; actual billing balance still unverified. Old waiting messages are
not eligible for queued-only claims. Existing hosted session bounds remain ≤5min
and ≤3 roots, not continuous service. Host retains deployment/runtime ownership.

Full control-plane deployment (2026-09-17): owner supplied successful bootstrap
identity and directed continuation. Host saved valid JSON0600 and generated private
deployment configuration from checked-in wrangler config plus verified identity.
63 auth/owner-binding/hosted-policy tests pass; npm run build and private release
dry-run exit0. Actual Wrangler4.130.0 deploy exit0: four public files uploaded,
2356.86KiB Worker/254.63KiB gzip, startup12ms, CONTROL namespace with SQLite migration
configuration. No retained local state or runtime credentials uploaded. Remote
settings readback matches all configured vars (including owner pin, issuer/AUD,
disabled execution/native), and exactly ASSETS + CONTROL non-variable bindings.
Previews disabled; zero target custom domains. Seven anonymous/forged probes of
root, state, assets, command/internal POST, former bootstrap path all302 to exact
Access team, no data. Owner bootstrap login succeeded; full portal/state login and
new-store initialization still await owner browser confirmation. No claimed hosted
assistant execution. No paid upgrade; billing balance unverified. Private evidence
in .local/control-deploy-{auth,build}.log, control-release-{dry-run,deploy}.log and
control-release-live-check.json. No Access app mutation or Git push.

Identity-only deployment (2026-09-17): browser independently reloaded/read back the
exact-host Access app and sole exact-email Allow policy, one-hour duration and no
bypass, then released ownership. Host app/policy GET403/1010 and list200/empty
persist; token discrepancy unresolved. No duplicate or unrelated app mutation.
Separate owner-bootstrap entrypoint has no database/assets/runtime bindings. It
accepts only exact-host HTTPS GET /__owner-bootstrap and verifies signed RS256
issuer/audience/email before returning the subject with private/no-store. It
neither guesses OWNER_SUB nor grants control-plane access using email alone.
34 bootstrap/auth tests pass, typecheck/dry-run exit0. Actual Wrangler4.130.0 deploy
exit0, 36.49KiB upload/10.15KiB gzip, startup2ms. Live anonymous bootstrap/root/API/
asset plus forged-header probes all302 to configured team Access login. API readback
confirms production hostname enabled, previews disabled, only four bootstrap vars,
zero target custom domains; account zone list200/empty. No successful authenticated
owner login yet. Owner saves displayed verified JSON privately; only then pin
OWNER_SUB and replace bootstrap with current full portal/fresh SQLite deployment.
No retained state, inference, Sprite, connector activation or paid plan change.
Actual billing balance unverified; limited Worker requests do not renew allowance.
Private evidence: bootstrap-deploy.log, bootstrap-live-check.json,
bootstrap-zone-check.json and cloudflare-access-handback-check.json in .local/.

Access write attempt (2026-09-17): private owner config now present and validated
without disclosure; expected team JWKS responds. Authorized POST for one self-hosted
production hostname app with one exact-email allow policy returned HTTP403,
code1010 auth.forbidden. GET afterward confirms total apps0/target0; no blind retry.
After the owner's permission-update report, token re-read and app-list-before-create
preceded one new attempt: same403/1010, app-list-after again0. Token active/same ID,
file unchanged since original provisioning, which does not disprove dashboard scope
edits. Token permission introspection denied403/9109. Official create docs confirm
Access: Apps and Policies Write. Subsequent blanket-permission report prompted one
bounded retry after verifying original authorized account against current listing
and Bearer-only authentication: still403/1010, apps before/after0. Token active
through 2026-09-30T23:59:59Z. Ray a3c6ea200e7506ac-SEA at
2026-09-17 08:59:23 UTC; no X-Request-ID. Account members read succeeds and configured
owner is accepted Super Administrator; this does not identify the token creator.
Token detail/groups denied403/9109, memberships/organization denied403/10000;
IdPs read succeeds but empty. Team-account mapping/Free-plan onboarding and token
creator scope remain unverified; no definitive root cause established. Stop create
attempts. AUTH_SETUP.md records dashboard resource/role/team-plan/IP checks and
manual exact-host, exact-owner-only app fallback. Dashboard edits need not change
token value/mtime; no replacement request for that reason. Private diagnostics:
`.local/cloudflare-access-diagnostic.json` and
`.local/cloudflare-access-readonly-diagnostics.json`.
No Worker/database/bootstrap published or successful shared mutation. Retain existing
scope/approval, no renewed budget or repeated setup. Subject still needs verified
login after protection is available. Private plan/error/readback files retained;
no secrets printed. Documentation-only checkpoint, no tests rerun. Billing remains
unverified, no resource creation/inference/Sprite/connector action.

Owner onboarding recheck (2026-09-17): following “done”, privately verified same
account and active token; workers.dev now exists and Access apps list200/zero.
One unrelated Worker exists, not hehebot-portal; untouched. Organization/users/
subscriptions remain403. No team-domain/owner-email file or environment setting
exists here; coordinating thread confirms none supplied there either. Request only
those two private inputs; no repeat onboarding or consent. Exact owner sub still
requires verified login/bootstrap. No shared writes, deployment/public URL, tests
or billed-resource creation. Raw response mode0600 at
`.local/cloudflare-preflight-current.json`; remaining billing balance unverified.

Continuation pause (2026-09-17): saved schedule read, clean checkout/current handoff
checked, no active assignment or new account input. Schedule update confirmed
enabled:false while the prioritized deployment awaits the already-requested
Cloudflare onboarding/Access permission/owner identity. No new account probes,
tests, infrastructure writes or connector work. Resume on those private inputs;
the bounded deployment authorization and existing budget limits remain unchanged.

Protected workers.dev preparation (2026-09-17 Asia/Jakarta): owner explicitly
authorized control-plane Worker/SQLite and exact-owner Access on the verified
account within the remaining existing $10 ceiling, no paid upgrades. No domain
purchase required. Official Workers Access documentation and October 2025
announcement support hostname-based production workers.dev with the existing
Cf-Access-Jwt-Assertion/JWKS flow. Retain exact issuer/audience/subject checks;
do not adopt ctx.access (Static Assets limitation) or assume new Wrangler APIs.
Pinned Wrangler4.130.0 schema and dry-run accept explicit preview_urls:false.
Default workers_dev remains false until Access is configured; assets run Worker
first; no alternate routes added. 42 auth/policy tests and 8 hosted-runtime tests
pass, as does npm run build at `.local/workers-dev-{auth,build}.log`. No full
combined rerun for this docs/config/auth-regression-only change; preceding combined
evidence remains `.local/wapp-prepare-combined.log` for unchanged implementation.

Private read-only API check reused the mode0600 token: active token, one account,
zero Workers. workers.dev subdomain returns10007; Access applications return
not_enabled; organization/users/subscriptions return403. Account details/token/raw
response remain private in `.local/cloudflare-preflight.json`. No writes/deployment
or public URL exist, and no live owner authentication can yet be verified.
Owner onboarding/Access permission and exact owner subject are unresolved, not
a custom-domain requirement. AUTH_SETUP.md gives the minimal Free dashboard/private
credential step. Billing/remaining balance is unverified; no new budget, Sprite
activity, inference, connector use or retained-state upload. Connector expansion
is lower priority than resuming this authorized deployment when inputs arrive.

WhatsApp prepare-only mode (2026-09-17 Asia/Jakarta): the existing pinned verifier
now accepts `--prepare /absolute/new-directory`. It reserves a private new directory,
performs the unchanged artifact/approved-patch/synthetic compatibility checks and
moves only the checked installation into its final location after success. A
0600 prepared-not-enabled receipt records observation time, lock hash and results.
It is not a full-tree attestation or fresh inventory. Existing destinations refuse;
normal failure removes only new staging. npm gets disposable HOME/config/cache and
an allowlisted environment; Git cannot discover a surrounding checkout. Default
invocation still deletes its graph. No pins, patches or startup gates changed.

`node --test tests/wappmcp-prepare.mjs` passes both tests: exact retained graph/receipt,
0700/0600 permissions, destination refusal, download-failure cleanup and hostile
inherited npm/Git/tar config. Initial Git ceiling at the current directory failed
the existing double-patch assertion; moving the ceiling to its parent fixed the
inside-checkout case. Test graphs are removed afterward. The new fixture is wired
into the combined verifier, which exits 0 at `.local/wapp-prepare-combined.log`:
1542 backend/444 runtime, both installation modes, 27 Worker HTTP checks and
browser/native/service/build pass. Desktop16 pass at `.local/wapp-prepare-desktop.log`.
Read-only delegated review of existing license evidence confirmed 350 inspected
locations/40 binary candidates, incomplete LGPL WASM/native-build/Public Domain/
vendored-asset/notice obligations; no legal or redistribution approval. Guidance is
in config/wappmcp/README.md. Startup, live inventory, pairing and recent-read
compatibility remain separate gaps; no account/provider calls or deployment.

WhatsApp transport binding (2026-09-17 Asia/Jakarta): `createWappMcpReader`
captures host task/attempt/lease, scopes and deadline, persists a payload-free
fingerprint against rebinding, validates actual authority envelopes with the
generated runtime schema, and connects fixed-endpoint ControlClient checks to
journaled MCP reads. The SDK receives tightened timeout/cancellation and retains
its default result schema. No connector is installed/started/registered here.
The host still supplies the correct initial task-to-journal association and one
already connected client; one executor owns the journal. Read-only authority
HTTP calls retain ControlClient's bounded timeout, not server-termination proof.

Five binding tests and all 444 runtime tests pass (`.local/wapp-binding-runtime.log`).
Actual pinned SDK/public-server fixture now also passes with synthetic authority:
exact scoped search returns, recent-read rejection keeps unknown intent, no
repair/fallback/replay. Both results preserve unknown browser settlement. Combined
verification exits 0 at `.local/wapp-binding-combined.log`: backend1542,
runtime444, pinned connector, 27 Worker HTTP checks and browser/native/service/build
pass. Desktop16 pass at `.local/wapp-binding-desktop.log`. No live account/model/provider
calls, changed pins or production gates. Startup/inventory, production registration,
supported process supervision, pairing and live coverage remain open.

Connectors portal (2026-09-17 Asia/Jakarta): hash-verified UI patch integrated.
On-demand page beside Skills displays only bundled WhatsApp diagnostic metadata,
unobserved runtime inventory/no authority, per-read-tool protocol differences,
recent-read blocker and prerequisites. Catalog reads occur on open/restored
selection or explicit Refresh catalog, not ordinary state refresh. No connector
commands, install/pair/enable/probe controls or inferred status for absent providers.
Managed pages are not conversations; navigation/offline/late/alpha checks remove
stale content. All text is literal; source is inert. Host Chromium fixture passes
at `.local/connector-catalog-ui-host.log`; five desktop/narrow/loading/error captures
inspected. Existing internal timeline scrolling starts at its top. Combined exits
0 with 1542 backend/439 runtime, 27 Worker HTTP checks and browser/native/service/
build; desktop16 pass at `.local/connector-ui-{combined,desktop}.log`.
Synthetic Chromium is not device/touch/Safari or live connector evidence.

Owner connector catalog (2026-09-17 Asia/Jakarta): GET /v1/connectors/catalog
returns the existing pinned WhatsApp catalog through authenticated owner ingress.
The envelope labels it bundled-diagnostic-baseline, runtime inventory unobserved,
authority not-granted. No installation/probe/grant occurs; false installed evidence
belongs to the historical bundled baseline, not current inventory. Per-operation
incompatible recent-read vs synthetic-only search remains explicit. Alpha denies;
120/minute owner read limit and no-store apply. Readback copies JSON and performs
no overdue scheduling, alarm arming, inference or provider access.
46 focused HTTP/auth tests and typecheck pass after correcting test-only JSON
typing (`.local/connector-catalog-focused-final.log`). Tests cover signed owner,
foreign/runtime/missing credentials, nonlocal bypass, denied POST, exact rate
boundary, overdue custody, detached response and alpha. Real Worker HTTP fixture
now checks the endpoint. Combined exits 0: 1542 backend/439 runtime plus 27 Worker
HTTP checks and browser/native/service/build; desktop16 pass at
`.local/connector-catalog-{combined,desktop}.log`. Existing UI worker is implementing
an on-demand diagnostic page on the exact unpublished base; not yet integrated.
No catalog status edits, new schema/migration, live/shared actions or gate changes.

Real Worker capacity follow-through (2026-09-17 Asia/Jakarta): hash-verified
two-file fixture integrated and imported by test-local.mjs. A test-only
PersonalControl subclass injects a fixed future clock and readback, leaving real
constructor/accept/reconcile/alarm/arm code intact. Disposable Wrangler workerd
SQLite proves 20 enabled routines (13/7 across two personas), atomic 21st refusal,
disabled draft, 20 coalesced runs after twelve missed ticks, duplicate identity
retention, 13 replacements/seven skips, then exact rows/IDs/context/alarm after
stopping and reopening Wrangler on the same storage. Next alarms are 00:15,
03:15 and 03:45 at each stage. Execution/native flags remain false; active runs
are CAPABILITY_UNAVAILABLE, all attempts zero, no attempts/effects/outbox, and
lifecycle STOPPED/STOP with queue_sequence0. Budget variant remains in the
separate core test below, not claimed by this fixture.

Host commands: node check and `node scripts/test-routine-capacity-worker.mjs`,
`npm run typecheck`, `npm test` (76 files/1540 tests), `npm run test:e2e`
(migration/reopen, capacity/reopen, 26 existing Worker HTTP checks) all pass.
Logs: `.local/routine-capacity-{worker-host,backend,e2e}.log`. Fixture-only changes;
unchanged native/browser/desktop code retains its preceding combined evidence.
No hosted/timed alarm delivery, production ingress auth, live execution,
throughput or dollar-cost evidence. Routes are loopback-only, subprocess env is
allowlisted with disposable HOME, and cleanup removes processes/config/storage.
Retain the cap; there is no evidence here for a cost-safe increase.

Routine capacity prerequisite (2026-09-17 Asia/Jakarta): `tests/schedule.test.ts`
now tests the installation-wide 20/21 enabled boundary with 13/7 routines across two personas,
editing at capacity, disabled drafts and slot reuse. No runtime behavior changed.
A second case makes all 20 routines due after twelve 15-minute ticks: coalescing
creates 20 runs, each recording 11 omitted ticks, not 240 runs. Reconstructing
ControlCore on the same SQLite store and repeating reconciliation adds none.
At 03:30, 13 queue-one routines replace their own pending run, while seven skip
routines preserve theirs. Four optional routines remain BUDGET_UNKNOWN; final
counts are 13 cancelled, 16 queued, four waiting, 40 occurrences and zero
attempts/effects/outbox records. Queue sequence is 25 (16 initial plus nine
replacement admissions); it is not a count of actual provider wakes.

Command: `npx vitest run tests/schedule.test.ts tests/routine-lifecycle.test.ts
tests/budget-admission.test.ts` passes 3 files/33 tests; `npm run typecheck`
passes (`.local/routine-capacity-focused.log`). This is a test/docs-only
checkpoint, so the unchanged native/browser implementation retains its preceding
combined evidence rather than repeating it. No latency/throughput measurement,
workerd restart proof, live model execution or dollar-cost estimate is implied.
Keep the cap pending real Worker batch/alarm and execution/cost evidence. Even
20 minimum-cadence routines have 1920 nominal daily ticks before coalescing,
overlap and budget gates; that arithmetic is not billable inference or wake count.

Task-to-skill portal (2026-09-17 Asia/Jakarta): eligible retained task cards now
open the existing bounded editor with a blank procedure and explicit source
persona/run/attempt disclosure. Nothing is copied from task input/output, and
opening emits no extra read or write. Source, persona, navigation, attempt,
offline and alpha checks precede submission; uncertain retries preserve the
same exact body/source and key. Server retention rejection stays visible.
Failed/unfinished sources do not imply success or settlement. Approval and
enablement remain separate. See [UI scope](SKILL_TASK_PROPOSAL_UI.md).

UI worker patch hash verified and integrated; host fixed streamed UTF-8 decoding
in its HTTP fixture and added it to the combined verifier. Host Chromium fixture
passes (`.local/task-skill-ui-focused.log`); desktop16 pass. Desktop/narrow,
scrolled references and server-error screenshots inspected, with DOM checks for
scrolling/footer separation. Full combined rerun exits 0: 1538 backend/439 runtime
plus Worker/browser/native/service/build checks at `.local/task-skill-ui-combined.log`.
Neighbor task-feed and cancellation fixtures also pass. These are synthetic HTTP/Chromium checks,
not model judgment, device/touch/Safari, live authority or production acceptance.
No backend/schema changes in this UI batch; no live/shared actions.

Task-sourced owner drafts (2026-09-17 Asia/Jakarta): the new owner command
`skill.propose_from_task` takes proposal/skill IDs, expected skill revision,
source run ID, expected attempt and a separately supplied `SkillBody`. It denies
runtime/trigger actors and owner-alpha; requires the exact current attempt plus
a retained attempt row; then reuses normal pending proposal validation, duplicate
handling and review. Provenance is generated as
`{kind:'task',source_ref:'task:<persona>/<run>/<attempt>'}`. No task transcript,
input, output, checkpoint or memory is copied. No inference, run admission,
steering, retry, activation or new authority is part of staging. Failed/unfinished
sources are allowed: source linkage is not a claim of completion or settlement.
A later source retry does not rewrite an already staged provenance record.

This API stages owner-authored corrections; it does not extract or generate a
procedure. `contains_private_facts:false` remains an owner assertion, not a
redaction/content-safety proof. Existing free-form `skill.propose` provenance is
unchanged and must not be mistaken for this command's checked source linkage.
Approval remains separate and does not change admitted snapshots. No migration.
Contract worker finished; 89 focused contract/core/HTTP tests and typecheck pass,
including receipt replay after reconstruction, stale/missing source rejection,
private-input/output canaries, failed-source retry, update-before-duplicate and
denied model/alpha paths (`.local/task-skill-integration.log`). Full verifier
exits 0 with 1538 backend/439 runtime tests plus Worker/browser/native/service
and build checks; desktop16 pass (`.local/task-skill-{combined,desktop}.log`).
Generated validator hashes match the twice-generated contract output. Portal
source selection/editor integration is assigned to the existing UI worker on
the exact unpublished base; host retains integration ownership. Automatic
learning and real-model judgment are not verified. No live/shared actions.

Skill catalog discovery (2026-09-17 Asia/Jakarta): `hehebot_search_skills` routes
through authenticated `agent-skill-search` with host-bound task custody. The
admitted persona must have `SKILL_PROPOSE_POLICY`; owner-alpha rejects discovery.
The service also requires explicit search and proposal tool allowlist entries;
installing this code does not add search to existing grants. Query length is
1–200 Unicode code points, nonblank; optional `after` is an exclusive UUID cursor.
Search uses literal substrings of current approved name/description/when-to-use,
ASCII case folding, ID ordering, and pages of at most 20. It is not semantic
ranking or a snapshot across pages. Results contain only ID, revision and those
three metadata fields, not bodies, references, private memory, provenance or
enablement. Existing admitted full-body reads remain unchanged. Runtime response
validation rejects extra fields and uses the schema's Unicode bounds.

Focused verification passes 42 backend/HTTP and 64 runtime tests plus typecheck.
Cases cover 20+3 asymmetric pages, literal wildcard characters, current revisions,
zero core search writes, body-access denial, wrong credentials, schema bounds,
stale identity/attempt, exact deadline, cancellation, alpha refusal, explicit
grants and metadata-only transport. One initial fixture omitted memory scope;
corrected test data passed. Runtime worker finished; host integrated and corrected
Unicode units and implicit allowlist expansion. Combined verifier exits 0 at
`.local/skill-search-combined.log`: 1527 backend/439 runtime, Worker/browser/native/
service and dry-run build passed. Desktop16 pass; stronger literal/deleted-record
cases pass separately in `.local/skill-search-literal-final.log`. Regeneration
reproduces the runtime validator hash. Focused evidence is in
`.local/skill-search-{integration,runtime-final}.log`. No UI, migration, account,
provider, real-model, publication or gate changes. Search guidance does not prove
that a real model chooses the right existing skill or learns from corrections.

Owner skill Run once (2026-09-17 Asia/Jakarta): `skill.run` requires an explicit
owner request, current approved skill/persona revisions and bounded nonblank
input. It captures exactly one skill without changing enablement. Ordinary
persona/context/permissions refresh on claim; the selected skill body and its
references survive later catalog edits/deletion and retry. The adapter still
sends metadata only and uses the existing task-scoped skill loader. Disabled
execution leaves waiting work, owner-alpha rejects this command, and no runtime
profile or tool grant is expanded. Unstarted selected snapshots expire at 30
days, never rebuild from today's catalog, and require a fresh request. No schema
migration. This is ordinary work, not an isolated safe-test implementation.

Focused SQLite/HTTP/bridge checks pass 182 tests; typecheck passes. The new HTTP
case exposed the fixture SQL shim's lazy writes; it now executes at `exec`, like
Durable Objects, rather than only inside `toArray`. The browser fixture exposed
alpha activation not being latched when first observed on the Skills page; the
render entry now records it before the Skills early return. Browser checks pass
for stale/offline/navigation guards, exact uncertain retry, frozen attribution,
UTF-8 bounds and narrow footer geometry. Four renders inspected. A retained
offline banner after reconnect is pre-existing, noncritical UI behavior, not a
new delivery or completion claim. Initial combined verification passed 1524
backend/435 runtime and Worker checks, then the reference browser fixture rejected
the 16000-emoji boundary request. Per-chunk Buffer-to-string conversion corrupts
split UTF-8 characters: a deterministic split produced 16002 code points instead
of 16000. Both touched HTTP fixtures now use Node's streaming UTF-8 decoder.
The reference rerun and full verifier pass at
`.local/skill-run-reference-decoder.log` and `.local/skill-run-combined-final.log`:
1524 backend/435 runtime tests, real Worker migration/HTTP, browser, pinned-native,
service and dry-run build checks; exit 0. Initial failure is retained in
`.local/skill-run-combined.log`. Desktop 16 tests pass. Regeneration reproduces
both validator hashes. No worker or verification process remains active.
No account/provider/model calls or publication. [UI contract](SKILL_RUN_UI.md).

Skill text references integrated (2026-09-17 Asia/Jakarta): both worker patches
were verified against the exact unpublished base. Optional skill-body
references are bounded named text, not files installed into Codex or fetched
URLs. Existing proposal/review, enablement, admitted revision and executable
denial remain the authority boundaries. Host integration cases cover old-revision
loads after later edits/disablement, catalog-only initial prompts, forced MCP
custody and byte-preserving control export/import without document extraction.
Initial loader/MCP checks rejected the new field before schema integration, while
111 neighboring/integration tests passed. Host review reproduced three malformed
restore/imported-pending approval cases accepted by the first patch; catalog
validation now reuses the canonical generated command schema before staging or
approval, with duplicate-name checks at both boundaries. Rejection still permits
discarding an invalid pending proposal. Focused backend 210/runtime-tool 13 and
typecheck pass. Host browser tests cover full comparisons, exact CRLF/Unicode
retention, omitted versus empty, bounded authoring and uncertain retry. Desktop
16 pass. Combined verifier exits 0 with 1506 backend/435 runtime and real Worker,
Chromium, native/service and build checks (`.local/skill-references-combined.log`).
After that browser stage, host reproduced malformed imported-reference rendering
failure and guarded it; over-limit retained lists cannot be silently truncated by
an unrelated edit. Final neighboring browser checks pass. One earlier Save wait
timed out; logs retain it, later diagnostic/neighbor runs pass, and refresh now
observes exact revision/content/connection rather than assuming a click finished
an in-flight poll. Two final consecutive checks pass in
`.local/skill-references-observed-refresh.log`. Desktop/narrow reference,
restore and invalid-import renders inspected; vertical crop is normal inner
scrolling, with separately verified accessible footer controls. No migration,
live/shared actions, executable supporting files or safe-test execution are
introduced. [UI contract and limits](SKILL_REFERENCES_UI.md).

Routine execution/delivery metadata (2026-09-17 Asia/Jakarta): routine-history
reads now add exact current-attempt application status, recorded start/settlement
times and a result-body-retained boolean. Start is recorded at claim, not proof
that inference ran. Missing current attempts remain null; prior/future attempts
are never substituted. Root release is not used as completion or delivery.
Run-level outbox counts retain pending/delivered/failed/outcome_unknown separately,
plus the portal record's status/update time. Outbox has no attempt key; even a
matching timestamp cannot establish current-attempt delivery. Portal delivered
means a persisted record, not owner read or notification. Private result bodies,
destinations, native references and submission custody are not projected.
Red tests failed on all three absent contracts; implementation and signed-owner
HTTP/retention/lifecycle checks pass 97 tests plus typecheck in
`.local/routine-delivery-focused.log`. Retention regression executes actual pruning
and preserves completion metadata. UI worker patch is integrated; host browser
fixture and desktop 16 pass, six desktop/narrow states inspected. Initial combined
run passed 1468 backend/434 runtime and local Worker checks, then failed the history
fixture's offline late-response assertion. The fixture assumed refresh always
fetches, but the application's in-flight poll guard can return immediately. It
now awaits observed Offline then Connected before releasing the delayed response.
Two focused reruns pass; final combined verifier exits 0 with 1468 backend/434
runtime tests plus real Worker, browser, native/service and build checks in
`.local/routine-delivery-combined-final.log`. Initial failed log retained at
`.local/routine-delivery-combined.log`. Final representative render reinspected.
No active worker remains, and no live/native/provider/settlement claim is added.

Manual occurrence identity integrated (2026-09-17 Asia/Jakarta): host implements
atomic manual occurrence/run/receipt creation, existing exact-key deduplication,
identity retention across retries and explicit scheduled-origin budget/overlap
predicates. V13 schema/compatibility integrated;97 host lifecycle/migration/import/
budget tests and desktop16 pass; earlier47 routine tests and typecheck pass.
Exact legacy v9–12 exports/imports retain original schema/history; v8+ backup and
inspection remain supported. FK scan follows the final version-marker write
before clearing SQLite's stale deferred counter. Regression tests inject failures
after table replacement and final write, preserving referenced runs/attempts.
Full verifier `.local/manual-occurrence-combined.log` passed1464 backend/434 runtime,
actual local Worker startup migration/reopen, browser/native/service/build; exit0.
The Worker check preserves live referenced rows across restart and second reopen,
asserts exact fresh/migrated schema and failed-version/final-write rollback.
Paused run-once remains non-resuming;
manual occurrences have no nominal schedule time and no historical backfill.
No live/shared migration or model/provider call is implied.

Durable attempt attribution integrated (2026-09-17 Asia/Jakarta): host writes
captured revision with root claim, inherits exact parent attempt for same-persona
children, leaves cross-persona/legacy values null, and shows latest3 stored pairs.
No inference/delivery proof is implied. V12 migration and compatibility integrated;
exact v9–11 import/export and v8+ backup/inspection stay supported without
upgrading reconstructed legacy data. Host97 integrated tests pass; earlier112
lifecycle/history/child tests, typecheck, history/preflight browser and desktop16
pass. Three updated renders inspected. Initial combined run passed1443/failed2
on old positional retention fixtures; explicit-column fixes and13 retention tests
pass, including preservation of attribution when result payloads expire.
Final verifier passed1445 backend/434 runtime plus browser/native/service/build,
exit0 in `.local/attempt-revision-combined-final.log`. Final desktop render
reinspected; no active worker or verifier remains.
Existing live sessions are not migrated or reset. Manual occurrence identity is separate because current
budget and overlap predicates rely on non-null occurrence meaning scheduled.

Routine revision attribution (2026-09-17 Asia/Jakarta): routine history projects
only numeric `captured_routine_revision` from matching current-attempt context;
unknown/unstarted/mismatched snapshots are null, never current-object fallback.
Claims rebuild context on each attempt, so this is not original/prior-attempt
history or execution proof. Conversation task shape stays unchanged. Red/green
SQLite regression and25 focused tests/typecheck pass; history/preflight browser
checks pass and three known/unavailable/narrow renders inspected. Fixture drawer
state was corrected after an intercepted click. Desktop16 pass. Combined passed
1427 backend/434 runtime plus browser/native/service/build, exit0 in
`.local/routine-revision-combined.log`. No active workers, live actions or
production changes; prior-attempt attribution still requires separate durable data.

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
