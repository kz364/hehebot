# Hehebot progress and TODO

**Last reviewed: 2026-09-25 (Asia/Jakarta). Not operational; production gates remain false.**
This is the owner-facing progress checklist. Open this file to check progress without asking in chat.
It describes this checkout; local checkpoints are not necessarily published to GitHub.

## Owner follow-through queue — current priority

Owner instruction, 2026-09-19: record all remaining work and orchestrate implementors
with scheduled follow-through. Keep this existing `TODO.md` as the sole checklist;
do not create a competing `todos.md`. This queue supersedes older active-assignment
and next-priority prose below. Local implementation is authorized; external actions
still require their applicable approval. Completed fixtures are not live acceptance.

**Current checkpoint (2026-09-25, verified locally):** read-budget ledger
cleanup is wired into maintenance/alarms at90 days after terminal settlement.
Retry/recovery, live attempts, operations, locks, effects, delivery, root questions
and unsettled native descendants retain charges. At most100 exact keys are deleted
per transaction; structural custody stays intact. Focused73/typecheck pass;
removing descendant protection fails both nested cases. Final backend1942,
HTTP31/typecheck/build pass. This does not bound cleanup scans or total storage. Next:
storage/index construction and legacy snapshot bounds; external gates unchanged.

**Previous checkpoint (2026-09-25, local5be84d6):** owner-summary
projection requires both explicit persona permission and captured host retrieval
support. Summaries disclose omitted source and exact revision/digest/code-point
pointers; true/unclassified constraints remain verbatim. Source work limits still
apply before projection. Projected reads revalidate source, summary, expiry and
scope before charging. Final backend1929/runtime682, HTTP31, native service,
typecheck/build, focused75 and bridge/projection63 pass. Next: storage growth,
index construction, read-ledger retention and legacy enqueue bounds, then remaining
native recovery/settlement work. No new policy, inference on passive edits,
deployment or production gate change.

**Previous checkpoint (2026-09-25, local6191650):** explicitly granted ordinary MCP memory reads
count the exact delivered envelope with the selected model, reserve cumulative
budget, and check deadline/abort at the final write. Dynamic read journals retain
no bodies and never replay same-call content. Backend1911/runtime682, final122
focused checks,17 SQLite retrieval tests, typecheck and desktop16 pass. Resumed
verifier stages passed through shutdown, strict launcher, service modes and build
after correcting a routine-history fixture observation race; the original failed
log is retained, not claimed as a clean combined pass. Final expiry denies only
the read and preserves the shared native connection, with red/green coverage.
No prompt substitution yet. Next: disclosed owner-summary projection with exact
revision pointers and explicit host retrieval availability. Full source remains
counted; storage/legacy/recovery and external gates remain open. Local only.

**Previous checkpoint (2026-09-24):** targeted-read Worker prepare/reserve RPCs
bind exact admitted memory revisions and bounded code-point ranges. A body-free
per-attempt ledger charges cumulative exposure and refuses redelivery on replay;
source/expiry/task/lease are rechecked transactionally. A separate explicitly
adopted persona policy is required; staged alpha remains closed. Final backend1910,
runtime670, HTTP31, native service, typecheck/build pass (segmented checks).
No model-facing read tool or prompt substitution yet. Next: host counting,
reservation/delivery and cached-read fencing, then disclosed summary projection.
Source remains fully counted; storage/legacy/recovery and external gates remain open.

**Previous checkpoint (2026-09-24):** owner `memory.put` can adopt bounded summary
metadata tied to the exact resulting revision and source fields. Only explicitly
non-constraint records qualify; inherited true and unclassified records refuse.
Legacy edits invalidate omitted summaries; expiry purges source and summary
together. Backend1894/runtime670/typecheck, HTTP31, native service and build
dry-run pass. Full source remains in context and is counted alongside metadata:
this does not yet implement compression, retrieval or a summary editor. Next:
revision pointers, disclosed prompt substitution and bounded targeted retrieval.
No inference/wake, new model authority, push/deploy or gate changes.

**Previous checkpoint (2026-09-24):** schema14 adds an ordered partial memory-scope
index. Preparation reads at most65 rows per exact eligible scope (at most195
returned rows), merges before parsing at most65 bodies, and retains complete-or-block
semantics. Node SQLite and actual local workerd query plans use the index without
full scans or temporary sorting. Backend1875/typecheck, migration, HTTP31,
backup/restore drill, native service and build dry-run pass. Full verifier exited0:
backend1875/runtime670 and all browser/native/shutdown/launcher/service/build
stages pass; separate desktop16 pass. No check process or host fixture residue.
Index construction, storage growth and unlimited legacy
enqueue snapshots remain unbounded. Next: versioned summaries/pointers and targeted
retrieval. No active child or unintegrated delivery. Local only; no external gates changed.

**Previous checkpoint (2026-09-24, verified locally):** prepared memory now uses
stable distinct lexical-term overlap against the admitted instruction, then ID.
NFC/case normalization affects ranking only; counted text and all eligible
constraints stay intact, including zero-score constraints. Scope/expiry and
record/byte limits precede ranking. No inference, truncation or authority change.
Three new tests fail against old age ordering; final preparation23/typecheck,
backend1868 and real native service pass. The earlier full verifier below covers
service adoption; it was not repeated for this localized ordering change.
Next: versioned summaries/pointers and targeted retrieval. SQL scan/storage,
legacy enqueue snapshots, native recovery/settlement and external gates remain
open. No active check, child or unintegrated delivery. Local only, no push/deploy.

**Previous checkpoint (2026-09-24, verified locally):** ordinary service dispatch
now prepares and counts the complete eligible memory set before claiming.
Reviewed exact model names are `gpt-5`, `gpt-5.4`, `gpt-5.5`, `gpt-5-codex`;
unknown names fail without prefix fallback or an unbudgeted claim. This encoding
mapping is not account eligibility. Staged alpha remains on its separate path.
Claims recheck source/expiry/model/task identity and persist the exact receipt.
Record/byte work overflow and token-budget overflow visibly block without an
attempt or silent constraint truncation. Recovery aborts counting; lease checks
fence the actual send after journal yields. Removing that fence fails its race test.

Service 65 tests/typecheck and the real credential-free native fixture pass with
the budget receipt in Worker claim custody. The fixture now supplies a supported
disposable direct-tool catalog: bundled GPT-5.5 otherwise defers MCP to search.
Its initial failure is retained, not hidden by weaker tool assertions. Full
credential-free verifier exited0: backend1865/runtime670, browser/native/service
matrix, automatic shutdown, strict launcher, typecheck and build dry-run pass.
Evidence: `.local/memory-service-combined.log` (hash in IMPLEMENTATION.md).
Separate desktop install/tests pass16/16. No workerd or host fixture residue.
Mapping provenance distinguishes reference0.11.0 from upstream mapping4e71bbe;
tokenizer4.0.0, rank/reference pins and notices are unchanged.

Still open: versioned summaries/pointers, targeted
retrieval, bounded SQL scan/storage work, full native recovery/settlement and
broader TODO acceptance. Complete-or-block is not full E06 acceptance. No active
child, check or unintegrated delivery. Local only, not pushed or deployed.
Next: summary/pointer/retrieval contracts. External blockers
and production flags remain unchanged.

**Previous checkpoint:** memory context now filters global/current-persona/
current-routine scope in SQLite before returning record bodies to the Worker.
Deleted records stay excluded; existing ordering, expiry and explicit constraints
are preserved. Backend1824, focused57 and typecheck pass; restoring the old scan
fails both new SQL-return-census tests. This reduces unrelated-body hydration, not
SQL scan cost or the eligible-memory count. No token budget, truncation, tokenizer
adoption or production gate change. Next: bounded selected-model budget/summary/
retrieval contracts; external blockers unchanged. Local only.

**Previous checkpoint:** owner-requested portal visual refresh passes
seven browser fixtures: warm neutral surfaces, charcoal controls, clearer spacing and compact
question cards. Existing safety controls and command behavior are unchanged.
Native checkpoint-input fixture passes against pinned Codex: a fresh retry receives
the exact checkpoint without promoting its embedded grant canary, unrelated input
stays isolated, and reopening running journal custody does not resubmit. Synthetic
claims are not full Worker recovery or native restoration. Typecheck passes; desktop,
narrow dialog, workspace drawer and error captures inspected. Local only, not deployed.
Corrected tokenizer harness is integrated locally after parent review and execution:
92/92 Node/workerd parity, offline23 and runtime643 pass. Parent restored a missing
end-of-text literal with a red/green content assertion. Next: bounded selected-model
budget/summary/retrieval design; no application tokenizer adoption or external gate change.

**Previous recovery checkpoint:** the two automatic-retry custody cases now
restore a file-backed SQLite snapshot and close/reopen the resulting admission
writes. Late running grandchildren and retained unknown effects still block root
retry; unrelated work completes. Exact receipts, ancestry, checkpoint and effect
evidence survive; only settled descendants permit attempt2. A second reopen retains
that decision and denies sleep for outstanding work, not merely idle grace.
Removing recursive checking fails both cases. Full backend1822, final related126
and typecheck pass; production source is unchanged. This is SQLite persistence
evidence, not native process-crash restoration, executor takeover or full E02.
Tokenizer corrections remain with their existing worker; next is corrected-delivery
review and independent verification, without polling or duplicate ownership.

**Latest application checkpoint:** selected-model claim identity and optional
owner-declared memory constraint metadata pass the full credential-free verifier:
backend1820/runtime620, HTTP/browser/native fixtures, warm/background shutdown,
strict launcher2210 probes, all service modes, typecheck and dry-run build. Reference
desktop16 passes separately. Log `.local/e06-prerequisites-integrated.log`, SHA256
`dd19afe6d31289ff54a66de49e506fa3fdb3d81e2359f3540c8cf96f9e57b8ea`.
No lost child delivery or interrupted edit; no duplicate ownership or active check.
Local source-custody only, no push or production change. Memory budgets, summaries,
retrieval and full recovery/termination acceptance remain open. Next: tokenizer
adoption gates and connected budget/constraint behavior; external gates unchanged.

**Active follow-through:** tokenizer harness is accepted as local evidence, not an
application adoption. Corrected child-process bounds and unique evidence directories
pass parent execution; the original and corrected bundles remain preserved. Final
92/92 Node/workerd parity, boundary pairs and batches pass; offline23/runtime643 pass.
The100-record batch took115.3s (wall time, not CPU). Source-rank identity,
package SRI and both MIT notices are verified; the memory boundary is16000 Unicode
code points, not UTF-16 units. No application dependency or budget change follows
from parity alone. Context selection currently scans all eligible memories inside
claim's transaction: bounded computation is required before tokenizer adoption.
Bounded budgeting, summary and retrieval contracts remain next; external gates unchanged.

**Latest bounded follow-through:** real native cold-question fixture passes18
assertions: abrupt process loss, exact interrupted-turn readback, zero recreated
question callbacks, zero readback inference and no late answer replay. Focused85
and typecheck pass. This changes fixture/documentation only; parent full-verifier
evidence above remains separate. Cold history is not answer authority, and a
fresh retry is not native restoration. Next: supported checkpoint/restart authority
and selected-model memory constraints, without weakening settlement gates.

**Selected-model prerequisite (2026-09-21):** authenticated claim now carries the
host persona→model declaration into rebuilt Worker context; native submission uses
the captured selection and rejects a returned mismatch. Backend1817/runtime620,
focused33, typecheck and real service default/text-only/background fixtures pass.
Interrupted edits and returned deliveries were reconciled; nothing was lost or
needs duplicate dispatch. Local only. This is model identity, not token budgets:
enqueue snapshots and legacy claims have no declaration. Constraint representation
is verified below; pinned tokenizer and connected budget behavior remain next.
Summaries, retrieval, relevance, recovery and all external gates remain open.

**Constraint prerequisite verified:** optional owner-declared `explicit_constraint` metadata is
implemented locally. Omitted-field edits preserve the exact current declaration;
only explicit revision-checked false clears it. Scope/expiry/deletion and model
mutation denial remain unchanged. Focused46/typecheck and the full combined verifier
pass, including31 real HTTP checks with preservation/readback. No constraint budget
protection is claimed. Disposable gpt-tokenizer4.0.0 local-workerd spike passes six
official tiktoken0.11.0 vectors with32.5MB used JS heap; realistic load/CPU, broader
parity and rank-data notices remain adoption gates. No tokenizer dependency added.

**Earlier combined checkpoint:** full credential-free verifier passes on local
`6a225a3`: backend1792/runtime615, native/browser fixtures, both warm/background
shutdown modes, strict launcher, service modes and dry-run build. The earlier
1ms-early backstop failure is retained in the implementation evidence; the
production deadline recheck fixes it without changing the assertion. This run's
warm backstop stopped at expiry+30001ms. Strict launcher:2256 lock probes,
non-root owner, all five capability masks zero, NoNewPrivs1 and authentic floor.
Log `.local/shell-integrated-combined.log`, SHA256
`27c46fd68186edee86a01092419bb24e4d9f83ebe559d0df011dca6c60447c1a`.
The opt-in shell window is integrated and capped by attempt deadlines; other
operation bounds and grants are unchanged. Human questions do not park sibling
watchdogs. No recursive containment, settlement or safe-resume/sleep claim.
Corrected intake harness is integrated and parent-verified. Eight
focused harness fault checks and the independent real selfcheck/full run pass.
Parent full: 480/480 accepted, p95 203.475ms, max 223.543ms, maximum submission
drift 1ms, no errors/retries/guard delays, 481/481 canonical receipts matched,
481 durable commands and zero inference/controller records. Separate burst:
60 accepted, 10 RATE_LIMITED, first at write 61, one minute, zero other errors.
Log `.local/intake-parent-full.log`, SHA256
f0d55f8f600efa83b66875b0b32727670eef0cade771c794ce634b514a1c2648.
This is warm local 48/min evidence, not SPEC 5 writes/sec or deployed reliability;
the 60/min limit is unchanged. Earlier failed/deleted worker evidence is disclosed
in IMPLEMENTATION.md, not hidden by these passes. Next priority: remaining
supported recovery/containment and per-operation timing contracts; memory budgets
still need a connected selected-model/constraint contract, not a mock tokenizer.
Connected question-deadline follow-through is verified: the host callback's exact
attempt-clamped deadline now caps Worker answerability, without changing legacy
records, watchdogs, settlement or resume. Runtime616, backend1798, typecheck,
both native question modes, HTTPS and Chromium question fixtures pass. The first
native run exposed missing wire-schema metadata and failed422; that retained
failure led to the contract/validator correction and successful reruns. Chromium
rejects stale edits and disables expired answers; its stale-editor capture was
inspected. These focused integrated checks cover the new change separately from
the earlier full verifier. Complete human-wait recovery remains open.
Verified follow-through: a Worker-clock pre-handoff cutoff now records a durable
question-scoped restart-required reason and uses existing cancellation/grace.
It excludes unknown handoffs, legacy declarations and historical attempts;
does not suppress operation watchdogs, settle custody or authorize restart.
Red13 preceded implementation; final backend1814/typecheck, alarm fixture,
HTTP, native answer/cancel, Chromium and dry-run build pass. Pending and
saved-but-undelivered desktop/narrow captures were inspected. This is Worker
deadline policy, not host-observed timeout; post-handoff/never-recorded callbacks,
native termination, checkpoint parking and safe recovery remain E01/E02.
Host-observation follow-through is implemented locally: only an active binding's
observed deadline stop or the exact transport request's timeout may add private
`callbackTimeout` metadata. Collateral disconnects do not inherit that attribution;
unbound admission creates no invented task record. Offline inspection preserves
unknown handoff status and never grants resume/sleep. Runtime620 and typecheck
pass; the first combined run exposed scheduler-sensitive new fixture assertions
(runtime619/620). Deterministic timer-winner fixtures now pass focused85/typecheck;
full credential-free verifier PID576909 exited0 with backend1814/runtime620 and
all subsequent stages passing. Log `.local/question-timeout-integrated-final.log`,
SHA256 `904eb1cf52ae4d2406c43167ea92a2ecb09f5919d63d8c1e7721d4adad9ea1ae`.
Failed logs are retained. No new Worker timeout protocol or recovery authority.
No additional approval is needed for these local checks; publication and live
operations remain gated.
Historical checkpoints below retain their original failures and restrictions;
they do not override this current scope or the integrated corrections.

**Authorized correction wave (2026-09-20):** owner approved local Hehebot launcher
privilege-boundary and expiry/retirement corrections, superseding the fixture-only
restriction below. Two disjoint implementers own those fixes; a third implements
partial local intake latency evidence at48 writes/min for10min without changing
the60/min limit or claiming the5writes/sec SPEC target. A completed source review
also confirms unbounded context memories and missing explicit operation timing
policies; those need separate contract design, not a test-tokenizer completion claim.
Main owns entry/lock
lifetime and integrated acceptance. Strict assertions, pristine Codex/dependencies,
non-root native launch, private namespace floor/socket and external approval gates
remain unchanged. Baseline `ba8d174caf4ba2fe95ea3b550e99afa380f8591c` transferred
by verified bundle. Entry/floor contracts pass30; both lock observers reject an
available lock with a live synthetic process (exit91), accept absent process (0),
and detect held locks (73). These controls are not real-launcher acceptance.
Launcher design review found the proposed `unshare --map-current-user --keep-caps`
chain clears all capability masks but maps root-owned paths to uid65534, violating
the unchanged floor ownership checks. That proposal was rejected in favor of the
production bootstrap below; uid65534 is not accepted as root.
The revised retirement patch is applied locally: parent focused19/typecheck pass,
and real-native normal mode now retires correctly despite stopping539ms before
expiry (one launch, dual locks, unknown root custody/no replay preserved).
Pending-maintenance also passes: timer at expiry+30000ms, idempotent finally
at+31133ms, retirement/no replay and unknown custody preserved. Combined
verification remains open. Logs `.local/retirement-parent-{native,pending}.log`.
The reusable production root-to-owner bootstrap is now integrated and used by the
strict fixture. Parent launcher/bootstrap16 tests pass with no skips. Real launcher
run passes: non-root entry/npm/native, all5 capability sets zero/NoNewPrivs1, real
floor/readback/Tasks socket,2150 lock probes, automatic exit at expiry+697ms,
dual-lock retirement/no replay/unknown custody. No harness success-stop. Log
`.local/launcher-parent-native.log`, SHA256
`9926f5937aec00e252e489dcb2604a8e5bdcf6b3796194c0e890a501f63f58f9`.
Wrapper session-flags seam remains explicit; not production-config, descendant
containment, settlement, safe-resume or sleep acceptance. Strict fixture added to
combined verifier; fresh full run is the next acceptance step. No live service changed.

**Historical integrated failure, before the corrections above.** On local source
`11deb67817776d3be4775606c5f73f3d4dd48b24`, `bash scripts/verify-codex.sh`
exited 1 in the Stage B normal auto-stop fixture. Backend1790/runtime585,
crash-readback, warm stop modes and Stage B browser/native passed first. Native
stopped 321ms before the millisecond expiry after the whole-second JWT fence;
immediate manager retirement inspection refused before expiry. Later read-only
inspection of the same retained journal under both locks passes. This is not a
full integrated pass, retirement, replay permission or F3 completion.
Log `.local/stage-b-final-combined.log`, SHA256
`c83ee88de94784dd5d83929366de6ec4bbb6b0882a4b6656d8f3a583e240fe0b`.
The later Stage B pending mode and remaining service/build steps did not run in
this invocation. Earlier targeted passes below remain valid but do not erase it.
Separate tail-only continuation on local `61d6198036f5abd9ceee1f0557e3a7f59f8e0346`
now exits 0: pending-maintenance backstop, all 15 remaining service modes and build
dry run pass. Timer stop at expiry+30001ms; production finally at +31257ms.
Log `.local/stage-b-verifier-tail.log`, SHA256
`d7a0bc1d5b17edd47563d90d10580e7a3d46787bb61c9f28027397117a1ed263`.
This completes the previously unexecuted checks, not the failed combined acceptance.
Next approved bounded wave: real launcher/default entry/setpriv/dual-lock/floor
and namespace-local Tasks fixture, with an explicitly labelled supported-CLI
loopback/catalog wrapper; no runtime patch, softened validation, host mounts or
live actions. Preserve the fractional-expiry retirement gap separately.

**Historical launcher capability failure, before the production bootstrap:** the standalone
`bash scripts/test-codex-launcher-boundary.sh` uses a disposable private mount/root
and loopback-only network namespace. Actual non-root default entry reaches ready
with real managed floor/readback, but its CapBnd remains `000001ffffffffff` after
the exact production setpriv command; other capability sets are zero and
NoNewPrivs=1. A direct command outside the namespace reproduces this. Assertions
remain strict; no pre-clearing of the bounding set, runtime patch or gate removal.
The test fails before its lock-lifetime/expiry/retirement assertions; those are
not accepted. Namespace prerequisite check and 32 existing launcher/floor tests
pass. Log `.local/launcher-boundary-pivot.log`, SHA256
`5182b2b7e77c864fddb1491e00c6ead70884ccd432d7efd524a8bdfba1249c34`.
The fixture is not added to the combined verifier. A separately reviewed launch
privilege-boundary correction is needed for the unchanged zero-CapBnd criterion.

**Current checkpoint (2026-09-20):** the prior implementor wave has delivered.
Stage B runtime is reviewed/integrated locally. Actual portal → signed Worker/SQLite
→ one pristine Codex 0.154.0 process passes the three-root browser/native fixture:
S replies while A's child stays active; B has isolated context/read-only credentials;
portal cancellation targets only A's family; reload/replay/passive reads add no work.
Parent tightened background receipt coverage to S/B only; focused tests 15/15,
runtime tests 585/585 and typecheck pass. Screenshots inspected. Evidence:
`.local/stage-b-{browser-final,runtime-all-final,typecheck-final}.log`.
Combined verifier exits 0 in `.local/stage-b-integrated-combined.log`: 1790 backend,
585 runtime, setup safety, backup, both warm F3 modes, Stage B browser/native,
remaining service checks, typecheck and build dry run all pass. Latest regenerated
Stage B exhausted capture inspected. Integration committed locally at `6574cf4`.
Stage B automatic-stop delivery is now parent-reviewed and verified: production
entrypoint normal stop at expiry+139ms; injected pending-maintenance timer stop
at +30001ms, both PIDs gone before release, idempotent finally at +31263ms.
Both retain recovery-required root custody and record dual-lock retirement without
relaunch. Related contracts 47/47 and typecheck pass. Logs
`.local/background-auto-stop-{parent,pending-parent,contracts,typecheck}.log`.
No production source changed; in-process entrypoint/staged floor/synthetic account
seams remain explicit. Both modes added to verifier; preceding full result predates
these test-only additions. All implementors have returned and are integrated.
Crash-readback delivery is now reviewed and locally rerun: actual native SIGKILL
with a held child, both original PIDs gone before replacement, supported history
reports interrupted, exactly three model POSTs/four read-only RPCs, no replay or
sleep authority. Parent tightened blocked-readback failure and replacement-native
cleanup; new fixture and 121 related tests/typecheck pass. Added to verifier;
the full combined result above predates this test-only addition. Evidence:
`.local/crash-readback-{parent-final,contracts,typecheck}.log`.
Electron reference-shell reinstall/tests also pass 16/16; not Mac acceptance.
Next priority is the launcher slice and unresolved integrated timing gap above;
local stop/readback is not safe resume, recursive settlement or sleep acceptance.
No push, deployment, live account calls or production claim.

**F3 pending-maintenance integrated:** parent rerun passes: production timer stop
at expiry+30000ms, both launcher/native PIDs absent before deferred release, then
idempotent finally stop at +31223ms; one launch, no premature stopped report.
Normal mode also passes (expiry−181ms); related runtime tests 46/46 and typecheck
pass. Both modes now also pass the full combined verifier recorded above.
Evidence `.local/warm-pending-{parent,normal-parent,contracts,typecheck}.log`.
This closes the pending-maintenance backstop item in F3 below, not live network
timeout, dual-lock or settlement acceptance. Stage B is now integrated locally.

**F6/E13 setup integrated:** candidates are staged/validated before replacement,
with prior-CLI rollback and unrelated config preservation. Parent found and fixed
ignored nonzero CLI-version exit status (two red/green cases), added both retained
swap-state recovery tests, and reran 13/13 tests plus two real disposable installs
of pristine Codex 0.154.0. Syntax/diff checks pass. No concurrent/active-upgrade or
power-loss guarantee. The earlier combined verifier exited 0; the new integrated
run in `.local/stage-b-integrated-combined.log` includes these setup changes.

| Done | Order / status | Deliverable and exit evidence |
| --- | --- | --- |
| [x] | **F1a — Local entrypoint control flow verified** | Four tests exercise actual runHostedOwnerAlpha expiry plus 30-second grace, pending start/maintenance and operator abort, without test-owned stop. Parent rerun: 4/4 focused, 568/568 runtime and typecheck pass. Service/native termination is simulated; this proves automatic stop dispatch and honest pending-state reporting, not real native shutdown. Explicit-stop native journal/dual-lock proof remains separate; automatic real-native termination remains part of F3 lifecycle acceptance. [Worker](https://ampcode.com/threads/T-01a0ba7c-fad5-710c-a2e1-099b66e11fb5) complete; no production fix needed. |
| [x] | **F1b — Integrated and locally verified** | Corrected real Worker alarm-to-listener patch integrated at 0ecdc55. Parent two UNKNOWN/no-retry negatives and browser --wake-first pass: launch precedes receipt observation, one native process/two replies, exact one wake and idempotent replay. Full verifier exited 0: 1782 backend/570 runtime tests, browser/native/service fixtures, typecheck and dry-run build. Fresh exhausted-composer screenshot inspected. Evidence: `.local/warm-wake-integrated-verify.log`. Loopback routing/scripted model remains non-live; explicit-stop limitation unchanged. |
| [x] | **F2 — Finite Stage B locally integrated / P0.3 / E03 remains partial** | Control, portal and runtime now compose through actual Chromium, signed Worker/SQLite and one pristine Codex process. Parent HTTP/browser runs verify A/S/B, active child through S, separate B context/grant, exact portal A-family cancellation, canonical reload, no passive/replay relaunch, immutable envelope and explicit-stop dual-lock retirement. Focused 15/15 and runtime 585/585 pass; combined verifier exits0. Two final DPR2 screenshots inspected; latest exhausted capture re-inspected after combined run. Stop/crash fixtures are also integrated; separate automatic-stop evidence is recorded in F3. Fixed ordinals are not natural-language routing; no live-account, recursive settlement or safe-sleep acceptance. |
| [ ] | **F3 — Warm/background automatic stop and crash readback verified; lifecycle acceptance partial** | Actual warm and Stage B entrypoints automatically stop native executable/launcher on normal expiry and an injected pending-maintenance +30s backstop; Stage B manager records retirement under both kernel locks. One abrupt native kill with active child recovers interrupted history without inference/cancel replay. Related crash121 and background-stop47 tests/typecheck pass. JWT exp floors to seconds and can fence early; no auth behavior changed. Remaining: production launcher/containment composition, crash takeover/safe resume, unknown effects/locks and recursive settlement before safe sleep/replacement. Process exit and root readback do not close those gates. |
| [ ] | **F4 — Procedure prepared; live trial externally gated / P0.2 / E14** | [Bounded trial procedure](docs/AUTH_SETUP.md#next-bounded-owner-trial-preparation-and-stop-conditions) covers exact release/targets, supported predecessor retirement, separate Access/runtime/wake/account checks, two canonical messages/reload, automatic stop, cumulative reservations/billing and retained rollback custody. No empty-install seed fabrication, warm rollover or warm→background transition. Still need actual target/retirement/containment, budget and eligibility evidence plus applicable deployment/account/live-operation authorization; procedure preparation is not readiness or a trial. Local commits are unpushed; publication is separate. |
| [ ] | **F5 — After usable slice; E05/E07/E09** | Complete required Google/WhatsApp/Messages integrations, adopted routine workflows and browser/computer tasks. Track permissions, per-effect authority, watermarks/dedupe and uncertain effects. Sep20 upstream source recheck found default branch still at the selected wappmcp revision: no newer source fix for array-shaped recent-message results. [Source evidence](docs/CONNECTOR_READINESS.md) retains the SDK blocker; no validation bypass, search substitution or unapproved patch. Connector account access and routine activation remain gated. |
| [ ] | **F6 — After usable slice; E10–E15** | Complete Mac build/render/device acceptance, coordinated backups and restore, clean installation/upgrade, measured cost/reliability and remaining product acceptance. Use the detailed E01–E15 rows below for scope; keep optional polish behind P0/P1. Sep20 runner discovery found no connected runner; actual Apple-framework/device acceptance needs a Mac runner. Electron reference-shell rerun passes16/16, not Mac acceptance. Account/billing data, signing/release and live infrastructure measurements require their own access/approval. |

**Backup drill integrated (2026-09-20):** the [backup/restore implementor](https://ampcode.com/threads/T-01a0be08-b284-765f-b2c5-1aa35bb10799)
is complete. Parent reviewed and reran the real SQLite/age snapshot → encryption →
decryption → semantic-inspection path: exact snapshot bytes and unknown effects/
locks retained; wrong-key/tamper refusal publishes no destination; activation stays
denied. Parent removed fixed-calendar expiry and raw debug-error output; current
and simulated 2027 clocks pass. Related tests 95/95, typecheck and shell syntax pass.
The drill now also passes in the full combined verifier recorded above.
Evidence `.local/backup-restore-{parent,contracts,typecheck,future-clock}.log`.
This advances F6/E10 only for application snapshots, not native/browser restoration
or safe activation. All delivered stop/crash checks are also integrated.

**Ownership and scheduling:** Main is the single user-facing Hehebot project owner,
reporting directly to the user and owning questions, decisions, planning,
implementation, integration, verification, status and blockers. ASK QUESTIONS HERE
is retired/custody-transferred. The canonical uncommitted product ledger is
`.amp/coordination/hehebot-product.md`; external approvals still require the user.
The launcher and retirement corrections are integrated. Two independent workers
own intake-load review corrections and the explicit shell-window slice. Load used
exact local source-custody `ba8d174`; shell received `aac8da0`, not origin/main.
The uncommitted coordination ledger records ownership/lifecycle separately from
this sole product checklist. Direct management remains simpler for parent
verification plus two disjoint implementation units; reconsider when
dependent work is dispatched or decision traffic grows.

An **Amp development follow-through schedule is enabled every two hours** in this
thread (schedule ID `b05eb8f2-8407-53d6-a253-e01637ba8f38`). It advances ready local
work and integrates delivered results; it does not enable Hehebot routines or live
operations. Clear it on completion, owner stop, or when every remaining item is
blocked on external approval/access; report exact blockers once rather than loop.
No-op runs stay quiet. All production gates remain false.

**Active implementation wave (2026-09-19):** owner requested continued implementation
in new threads; this thread retains integration/verification ownership. GLM5.3 composer
worker delivered and parent integrated actual portal → local Worker/manager/native →
two canonical replies/reload. Parent reruns pass HTTP/browser modes and eight fixture
tests; both turns retained, zero passive launches, exact owner-only asset gating.
Review fixes are included; integrated screenshot inspected. Browser mode is now in
the combined verifier, which exited0 in `.local/p02-combined-integrated.log`:
1756 backend/550 runtime plus browser/native/service/build. Desktop16/16 passes.
Composer worker is complete/integrated; checkpoint committed locally, not published.
Astra's completed P0.3 investigation supports one pinned process with tested V2
family isolation for a bounded workload, not general tool containment or settlement.
A new GLM5.3 control-plane worker owns Stage A: separate versioned/default-off finite
text-only generation, two sequential ordinary messages with immutable per-task grants,
host/model capability separation and unchanged cumulative reservations. Runtime work
follows contract review in another new thread; existing one-message grants stay unchanged.
Initial wire review returned corrections: lifetime accounting must include old and new
reservations; output/usage observations are host-only; task tokens retain only existing
scoped reads; admission freezes task deadlines. Legacy-token downgrade, historical
reconstruction and first-message-only wake require explicit tests before integration.
Corrected authority split approved for implementation; final manifest hash must cover
warm version/admission identity, and public summary must distinguish fixed policy expiry
from generation expiry. The portal now recognizes warm metadata and applies
separate composer, conversation-read and action gating; legacy modes are unchanged.
Stage A control contract is now integrated locally after all eight review corrections.
Parent typecheck and 274 focused tests pass, including repeated text, exact deadline
boundaries, immutable custody, lost lease, config removal and a real legacy-bootstrap
transition. Integrated backend suite passes 1,782 tests; desktop passes 16/16.
Combined verifier exited 0 with 550 runtime tests, browser/native/service fixtures,
typecheck and dry-run build. Operational/production/model-judgment flags stay false. Owner-binding
initialization failures are fenced without broadening other initialization behavior.
The GLM5.3 runtime worker owns pending one-process native integration against the
frozen contract and exact transferred source bundle. The portal worker has delivered
composer/status gating. One warm revision admits two tasks, with no rollover.
Parent owns combined integration.
Corrected portal consumer is integrated locally. Parent warm browser suite, all
three legacy alpha-session sections and typecheck pass. Malformed-value, bound-persona,
first-bind/date-type and review-button regressions pass; real narrow Send and blocked
exhausted submit were exercised after scrolling. Representative captures inspected.
Warm browser suite is now in the combined verifier; integrated rerun exited 0:
1,782 backend/550 runtime tests, browser/native/service fixtures and build pass.
Desktop rerun passes 16/16. Final narrow exhausted capture re-inspected after the run.
Corrected runtime is integrated locally at e813bbf. Manager intent now persists
the exact session identity, and the native fixture honestly reports explicit
post-expiry stop rather than automatic shutdown. The initial parent rerun passed
14 warm tests, typecheck and the one-process/two-turn native HTTP fixture.
Runtime combined verifier exited 0 with 1,782 backend/564 runtime tests and all
browser/native/service/build checks. Desktop rerun passes 16/16. Warm composer work
is integrated at d76a074: parent real-browser run passes one process/two canonical
turns, passive refresh, same-generation Send re-enablement, exact receipt replay,
and pre-expiry reload with exhausted composer. Representative screenshot inspected.
Both warm HTTP/browser modes are in the verifier; final combined rerun exited 0
with 1,782 backend/564 runtime tests and all browser/native/service/build checks.
Fresh combined-run screenshot was re-inspected; all report gates remain false.
Automatic warm entrypoint expiry/grace remains separate verification; these fixtures
explicitly call service.stop() after expiry. No implementation worker remains active.
No live state changed. Evidence is in docs/IMPLEMENTATION.md.
Next checkpoint: automatic warm entrypoint/grace coverage before separately
opting into background capabilities. No live rollout,
campaign, spending, push or schedule enablement; owner SSO/provider gates remain separate.

**Previous checkpoint: two-turn native owner continuation passes; two bugs fixed locally.**
Real manager/wake listener/pinned Codex/local Worker fixture now completes two distinct
owner sessions, with prior owner text AND canonical reply reaching the second model
request. Exactly two native starts/model requests; receipt replay launches nothing;
both retirements pass actual stopped-journal/dual-lock inspection. Inference and Sprite
responses are scripted local fixtures, not live owner SSO/provider/model judgment.
The fixture exposed heartbeat leases extending beyond fixed session expiry and
completed replies missing from history. Generation heartbeats now cap at session
expiry; bounded current canonical replies obey same-persona/current-attempt/90-day
retention and invalidation guards. Focused tests/typecheck pass. Source combined check
exited1 after1756 backend/550 runtime passes: alpha-session browser fixture timed out
opening the editor; that run's remaining stages were unverified. Exact source history and ten-file
unstaged delta transferred and hash-verified on local `source-custody`; origin/main
unchanged. Fresh full `bash scripts/verify-codex.sh` exited0:1756 backend/550 runtime,
browser/native/service/build, including two-turn continuation. Unchanged alpha-session
fixture also passed separately; source timeout cause remains unproven. Desktop16/16
and104 focused tests pass; logs `.local/custody-{combined,desktop,focused}.log`.
Desktop install reports14 dependency vulnerabilities (13 high/1 critical), not fixed
by this checkpoint. Schedule disabled. Local commit only, no deployment/new campaign/
live send; test revocation intact. Next: explicitly assigned owner SSO/composer and
live continuation acceptance on the existing installation/Sprite, not another marker trial.

Previous control-plane checkpoint:
Signed owner HTTP → real control object/SQLite now has an integrated two-message
regression: completion/expiry alone stays unavailable, stale retirement refuses,
exact manager retirement reopens readiness, reconstruction retains receipts, replay
creates no run, and the next claim retains prior owner text with a distinct session.
Both synthetic completions persist; two reservations share one cost baseline.
Typecheck and full backend suite pass:86 files/1754 tests. No live model/provider call,
owner SSO proof, deployment or push. Native/service continuation is now verified above;
live activation still requires explicit assignment.

Local regression reproduced service-only grant advertising ordinary owner admission.
Owner summary now remains read-only during a delegated campaign; actual service
submission/result and ordinary owner continuation tests still pass (121 focused tests
plus typecheck). No new send, policy activation or revocation removal. This follow-up
is not deployed. The integrated control-plane continuation check above is now complete;
live owner campaign activation still needs an explicit assignment.

Real same-Sprite native wake completed from the orb without owner Mac/CDP: accepted
08:55:02Z, canonical result `HEHEBOT_NATIVE_TEST_OK` observed08:55:19Z, actual Chromium
reload retained the same completed result08:57:16Z. This is delegated test-principal
acceptance, NOT owner SSO/composer proof. Session-adoption UI and delegated route are
deployed; source remains locally committed, not pushed. Combined verifier passed
(1752 backend/550 runtime plus browser/native/service/build); desktop16/16 passed.
09:04:48Z durable stop record and both free locks verified; named bootstrap/activity
tasks absent and native process count0. One read-only provider GET around09:15Z now
reports cold, without guest execution/wake. This does not prove repeated cold recovery.
Old UNKNOWN/holds remain untouched. Existing $10 cap is unchanged; billing unverified.
End-of-campaign backend revocation deployed and live credential read returned404 at
09:11:48Z;24 focused auth/HTTP tests and typecheck pass. Access token deletion itself
is blocked: dashboard read timed out40s BEFORE any write. Known token expiry is
2026-09-20T08:23:19Z, not immediate revocation. Next: delete exactly the named test token
when dashboard access is available; no navigation retries or new laptop testing loop.
Owner SSO/composer and repeated cold-start acceptance remain outstanding gates.

**Historical pre-delegation checkpoint: trial80 was on HOLD and unsent.**
Owner withdrew the manual-refresh loop. Exclusive browser worker confirms no trial80
fill/click/POST under V5/V6/V7 and no in-flight run. V7 fixed expiry08:11:17.458Z stays
unchanged; do not renew it or ask for another laptop refresh.07:40 authenticated export
confirmed epoch10/manifest unchanged, zero commands/runs after79, baseline+holds$4/$10.
No refund, replay or settlement. Actual billing remains unverified.

Local explicit session review/adoption is implemented in the existing portal: fresh
read at review and confirmation, exact policy/persona/deadline/task bounds, affirmative
consent, no command/wake, no old-revision renewal, monotonic expiry and preserved drafts.
Unconfirmed pending messages block adoption without altering their text/retry key.
Focused Chromium and combined credential-free checks pass (backend1710/runtime550,
Worker/browser/native/service/build); desktop16/16 passes. Desktop and narrow review
captures inspected, alongside adopted/pending states. Not deployed or a live-message success.

Approved next live-testing boundary: narrow delegated test principal in the CURRENT
installation/DO and same single-authority Sprite. New named Access service identity
may submit only a fixed synthetic text-only test and read its own run/result under an
explicit owner-issued bounded grant; no owner impersonation, history/global memory,
connectors, export/config or separate competing executor. Owner explicitly approved
one finite24h revocable named credential, exact `/v1/test/*` Access policy and backend
grant; no renewed scope/spend approval is needed. Dashboard provisioning completed:
one named token expires2026-09-20T08:23:19Z, exact path app/token-only policy read back,
owner/internal apps unchanged; secret transferred privately and host0600 verified.
Core/HTTP isolation and admission integrated;1752 backend and550 runtime tests pass,
combined native/browser checks passed. Effective Sprite argv/manager/template/
seven source pins and retained epoch10 marker verified08:47Z; zero native processes.
Live delegated result is recorded above. Host owns single sender; owner browser HOLD.
Existing API/dashboard visibility discrepancy remains, not a reason to broaden token
permissions again. New wake diagnostic retention passes121 focused tests, preserving UNKNOWN.
Keep production exact owner JWT subject checks and cumulative budget unchanged.
Schedule remains enabled; previous manual-refresh and approval notes below are historical.

**Managed alpha restrictions installed and verified (2026-09-19):** owner “Keep going”
after the disclosed scope authorizes the dedicated Sprite changes. Created the
previously absent `/etc/codex/requirements.toml` exclusively; no existing fields,
auth data or unrelated installations changed. Pinned0.154.0 readback under both
locks/capability drop confirms allowRemoteControl=false, required/effective memories
feature=false and remote-control RPC denial. Native diagnostic exited; final process
count0. No thread/turn/account/model RPC was submitted. Template is tracked; details
and private evidence paths are in IMPLEMENTATION. Initial private umask blocked
readback before launch; corrected config0644/directory0755 and rechecked successfully.
**Previous checkpoint: trial79 failed before observed claim; listener corrected.**
One normal message accepted06:53:39.615Z (HTTP202/applied), then lifecycle entered
RECOVERY_REQUIRED. Authenticated export06:57:00Z confirms epoch10 run queued,
attempt0, zero attempt rows/results, wake UNKNOWN and retained $1 reservation.
No successful reply or completion-only reload. Single-message authorization consumed;
no resend, cancellation or old settlement. Trial78 and its immutable marker remain intact.
The intended manager switch had NOT taken effect: provider PUT returned “already
running with that command”; GET and process argv still named the old manager.
Listener logged PREPARATION_REFUSED_OR_UNKNOWN; no epoch10 session directory exists.
Stopped listener, preserved definition, replaced only its service definition through
supported DELETE/PUT, then verified exact GET fields and running process manager path.
No runtime data/auth/journals were deleted. No Codex process observed after correction.
V4 expires06:58:58.101Z; existing $10 cumulative budget and reservations are unchanged.
Next: review epoch10 unused-admission recovery and obtain another single-message
authorization before any fresh trial. Billing remains unverified. Schedule stays enabled.
Private evidence: `.local/trial79-failure-custody.json`, `.local/trial79-services-*.json`,
`.local/trial79-corrected-process.json`. Details below are historical preparation,
superseded by this checkpoint where they describe current activation or browser status.
V2 producer and per-launch managed/input validation are integrated and installed with
source backup/hash verification. Host focused80/80 and original-binding7/7 pass;
combined verification passes backend1710/runtime550 plus Worker/browser/native/
service/build; desktop16/16 passes. Worker code deployed with expired policy unchanged,
authenticated manager06:13:38Z returns null. New profile template and separate manager
config are staged, not activated; predecessor manager/template hashes remain unchanged.
Supported same-Sprite restart returned202, changed kernel observed stable over two
minutes with all seven retained files unchanged. Directory inodes changed; post-cut
pins are required. Listener auto-started despite its earlier stop and was stopped
again; its startup path is HTTP-only. Live launch-floor/readback passes before account
work. Remaining: exact epoch9 custody review, immutable marker/grant and new profile
activation, then one bounded fresh message and reload verification. Browser worker has
a passive custody/readiness assignment but no returned evidence or send authority.
Owner reconnected the laptop at06:29Z. Runner my-laptop is live with the existing
browser worker attached. CDP works, but one export fetch failed and reload produced
a null-origin page; no custody received. Bounded portal/network diagnosis is active.
Orb unauthenticated portal GET returns302, not proof of laptop/authenticated readiness.
Await exact custody and portal readiness before activation; no new spend approval needed.
Schedule is enabled, not paused. No quarantine marker/grant, fresh message,
completion or reload verification; retained UNKNOWN/reservations are unchanged.

**Hosted startup defect reproduced and fixed (2026-09-18):** the automatic listener
omitted the capability-drop wrapper required by earlier manual Sprite launches.
Live listener had nonzero inherited/permitted/effective/bounding/ambient caps and
NoNewPrivs0. Fresh credential-free pinned native thread/start failed -32603 under
those caps and acknowledged under all-zero caps/NoNewPrivs1; no turn/account used.
Shared hosted launcher now executes setpriv after both locks, refusing failure
without fallback. Focused6 and runtime515/515 pass. Exact launcher plus sanitized
diagnostics installed after supported Service stop; hashes/imports verified and
Service start completed. Fresh full combined recheck exits0:1669 backend/515 runtime
plus Worker/browser/native/service/build.16:25 authenticated manager assignment null.
No new policy/message, replay or settlement.
Next: complete prospective receipt and exact current custody review before claimed-pre-turn
quarantine issuance. The managed fence is verified above. Core and runtime evidence
producer are integrated locally, default-off, preserving UNKNOWN and reservations:
exact expired claimed attempt, fresh-message-only consumption, immutable disposition,
reopen validation after config removal, real dual locks and permanent entry refusal.
Host combined core check passes1710 backend/515 runtime plus Worker/browser/native/
service/build after fixing a fresh-DO schema-order regression. Integrated runtime
recheck passes520/520, focused19/19 and pinned hosted-manager composition; desktop16/16.
No quarantine deployment, live marker or grant. Tagged Codex thread/start can persist
metadata and send generate:false prewarm/auth/catalog requests before turn/start;
no-turn is not no-effects/zero-cost. V1 required historical absence assertions; v2
replaces them with explicit UNKNOWN and a reviewed isolation receipt. Supported prospective
fence is managed allow_remote_control=false
and [features] memories=false on the dedicated Sprite, now installed with approval.
Original source/single-writer custody still needs review, without asserting historical
ingress or memory absence. No quarantine authority or new live trial has been issued.

**Live78 failed after claim, not chat success:** recovered browser/passive reads and
host15:14:15Z manager-null/same-Sprite-cold preceded ONE normal composer send.
Accepted15:15:30.593Z, run da2fd086; BOOTING→READY/attempt1→RECOVERY_REQUIRED/STALE_EPOCH,
zero canonical results. Six old runs unchanged, including77 queued/attempt0. Reload
returned but subsequent browser state check failed; reload persistence unverified.
After failure/session expiry, locked guest inspection found epoch9 dispatch
submission_unknown, no acknowledged native thread/turn, direct child nativeStopped.
Listener had already failed SERVICE_RECOVERY_REQUIRED15:15:44 before expiry; original
RPC error was discarded by adapter. Stage/code-only diagnostics are now integrated
locally; host focused tests55/55, runtime514/514, typecheck and credential-free
HTTP→hosted manager→native canonical completion pass. Fresh full combined verifier
now exits0:1669 backend/514 runtime plus Worker/browser/native/service/build; desktop16/16.
Earlier backup watcher EMFILE reproduced in isolation, then passed11/11 after
orb-only inotify limit128→256; no unrelated processes killed or tests weakened.
No raw errors or replay-policy change. Native ack uncertainty remains parked;
do NOT apply unused-before-staging recovery to78. Tasks list empty15:24:59, no DELETE.
V3 expired unchanged15:22:07.073Z; preserve both reservations and lifetime baseline.
Supported native thread/list under both locks15:29:15 returned zero matching threads
and no next page; diagnostic native exited. This does not prove absence of prior
effects. Locked15:48 config/read reconstructs original profile/hash and confirms
permissions match, network disabled, disjoint canonical roots and no reviewed
ancestor instruction/config candidates. This does not establish the original error.
Current successor requires completed receipts; child-stop cannot unblock claimed
UNKNOWN. Startup audit and subsequent launcher/diagnostic deployment are above;
no new trial until exact custody is reconciled.

**Owner architecture clarification integrated (2026-09-18):** Hehebot remains a
custom assistant independent of Amp accounts/runtime/SDK. Amp is a documented
architecture reference, not a coding UX or per-thread-machine design to adopt.
No always-on model orchestrator: deterministic Worker/SQLite ingress stays reachable;
model coordination runs only for admitted work on the one sleeping Sprite. Codex,
passive zero-wake behavior, cost and settlement gates are unchanged. Docs-only change;
no new live acceptance, deployment or push. Current live blocker remains below.

**Current live checkpoint09:25Z:** epoch8 permanent unused-before-staging marker
created09:21:55.474Z under both real flocks after explicit deployed-source/root
custody review. No retirement claim or replay. Hold-before202 listener files are
installed, supported Service stop/start completed, and Worker recovery source
deployment succeeded.09:25 authenticated manager returns null; same Sprite warm.
Provider-only09:31:22 observation reports same Sprite cold, not zero-billing proof.
Subsequent v3 activation and recovered browser readiness are recorded above.
Runner inventory alone did not establish Mac executor unavailability. Next: verify
v3 passive availability and authorize one normal composer send, without replay.
Prior$1 allowance/reservation and$10 total remain unchanged; actual billing unverified.
No new message, reservation, Git push or production-gate change.

**Latest live attempt FAILED before readiness:** browser readiness confirmed08:18:57Z through existing SSO,
normal history/bot switching and control-plane-only GETs; expired v1 unavailable,
epoch7 and old runs unchanged. Host provider check08:19:50Z reports same Sprite cold.
Only then activated new fixed v2 policy ending08:29:50.104Z, with unchanged cumulative
allowances and180s session/120s task. V2 passive readiness confirmed08:20:30Z;
host08:21:42Z confirms no manager assignment and same Sprite cold. Sole browser
worker submitted exactly one message08:22:33.495Z, receiptcebc1bf7 and run743d4f08.
Epoch8 entered BOOTING then RECOVERY_REQUIRED; run remains queued/attempt0, one user
event and zero canonical results after reload. Old five runs unchanged. Wake metadata
status queued proves strict202 receipt, not runtime start. No manual wake/activation,
retry/cancel or replay. Listener had zero staged sessions; its first callback log
was NO_ASSIGNMENT08:24:10 after diagnostic guest exec, beyond the boot lease.
An unprotected202-to-bootstrap activity gap exists in code; pause is a strong live
hypothesis, not a proved trace. Bounded pre-202 manifest/Task hold fix is integrated
locally:505 runtime tests pass; real HTTP listener through bootstrap/native holds,
one pinned native start/scripted response/canonical completion and retirement passes.
Hold-only full combined verifier exited0, including build; desktop16 also pass.
Host extended
existing actual-workerd fixture: authenticated manifest
callback to the same DO completes before wake acknowledgement; typecheck and fixture
pass. At08:36:30 native Tasks list was empty; no hold deletion. V2 expired unchanged.
Preserve epoch8 and its reservation; automatic rollover intentionally rejects this
unclaimed launch. Strict default-off one-use unused-before-staging core disposition
and operator-only permanent staging-fence producer are now integrated locally.
Host typecheck,186 focused core tests and6 real-lock producer tests pass. Fresh full
combined verifier exited0:1669 backend/511 runtime plus Worker/browser/native/service
and build (`.local/unused-recovery-combined.log`). Desktop16 pass separately.
Read-only08:55 custody selection confirms zero attempts and retained$1 reservation;
reconstructed canonical manifest hash matches. This does not prove historical ledger
unchangedness or native non-staging. Host verified
deployed epoch8 manager/launcher/lock-script hashes match the reviewed old source;
this is not by itself historical custody proof. Subsequent operator review, marker
and deployment are recorded above. No replay of message77 or false retirement claim.
Production gates remain false.

**Publication (2026-09-18):** integrated source through
[`656432f`](https://github.com/kz364/hehebot/commit/656432fad486814479f92510f59674908081c104)
is pushed to `origin/main`, with remote HEAD verified and the remote agent-model
documentation preserved. Current hold/unused-recovery integration is committed
locally and deployed within the authorized trial scope, but not pushed to GitHub.
Earlier “unpushed” notes are historical. This publication
does not deploy or enable the default-off bootstrap, connectors or production gates.

**Current local follow-up:** activation, portal state/history reads and alarms now
produce zero Sprite notifications until a persisted message passes admission.
Host-integrated manager/native composition now passes: one actual pinned Codex
start, one scripted loopback response, canonical result, unchanged retained manifest
and expiry-gated retirement. Legacy hosted regression and regenerated-Env typecheck
also pass. These new fixture changes are committed locally and not yet published.
Fresh full verifier `.local/manager-combined.log` exits0:1644 backend/497 runtime
plus Worker/browser/native/service/build, including the new composition. Desktop16
also pass. Earlier failures remain historical failures, not relabeled successes.
Fresh-session implementation is underway: host task-token/manager transport and
runtime staging integration pass30 auth/wake and39 runtime checks. Existing browser
fixture passes message-triggered eligible/unavailable/expired states, with all three
screenshots inspected. Core assignment and runtime-manager patches are integrated;
Worker route/DO credential separation, exact assignment binding, fixed issuance,
read-only access and expiry pass78 focused tests. The real-workerd bootstrap fixture
is integrated and passes on the host: zero passive wake/reservation, one persisted
message/one wake, separate credentials, expiry and fixed grants after process reopen.
Prior implementation workers finished. Typecheck and desktop16 pass. The prior full combined verifier
exited0 (1644 backend/497 runtime plus browser/native/service/build). Automatic
hosted acceptance remains incomplete; repository defaults remain off.
One admitted message produces one notification; real workerd SQLite/reopen and
HTTP transport checks pass, as do typecheck,41 focused core/auth tests and19
listener/launcher tests. Quiet `--listen` boots without session config and reads
fresh immutable staging only on authenticated work; it does not mint/renew grants.
Worker bootstrap is deployed for a fixed trial ending08:10:39.410Z, with180s
sessions/120s tasks, a$1 conservative prior allowance and$1 per-session reservation
within the unchanged$10 cumulative limit. These allowances are not actual charges.
Authenticated manager readback returns null before admission. The existing Sprite has one supported
`hehebot-listener` HTTP Service registered at07:48Z; startup monitoring completed,
and provider inventory reported cold at07:54:08Z. That does not prove process loss
or cold-start readiness. At08:08:20Z manager manifest was still null and Sprite cold.
Execution reconciliation: earlier `list_runners` returned none, but the worker now
reports its billing navigation completed exit0, with no tracked PID/running command
or app mutation. Stale tool-state metadata did not prove a hung command. No passive
bootstrap actions had occurred. The same worker now owns a new PASSIVE-ONLY browser
readiness check; no other sender, trial staging or composer submission is authorized.
The fixed trial expired unchanged08:10:39.410Z. At08:12:18Z manager manifest was
null and provider status cold. A subsequent bounded guest inspection found the
listener running with its original07:48 start time and zero staged sessions.
That inspection wakes the guest; it is not passive portal or fresh-process recovery
evidence. No new trial or fixture. Confirm current authenticated browser readiness
FIRST; the historical successful attachment does not establish current availability.
Persistent imports pass after including generated contracts.
Earlier combined runs failed missing mock getAlarm and unconsumed fixture POST
bodies. Both regressions are fixed; `.local/bootstrap-combined.log` is the fresh
full-green run, not a relabeling of those failures. The extended bootstrap workerd
fixture arrived after its stage and passed separately in `.local/bootstrap-workerd-host.log`.
Billing readback at2026-09-18T06:32:06Z: Fly Cost Explorer and upcoming invoice show
$0.03, credit balance$0.00, Sprite cold. This is rounded, potentially lagged Fly
usage, not all-project spend or proof of$9.97 remaining. Keep the existing$10 TOTAL.
Next: when browser execution recovers, verify passive no-wake followed by one
same-Sprite message bootstrap under a separately prepared fixed trial if needed.
Do not silently renew this policy or replay an uncertain assignment.
The owner did not require all-project billing or a provider-enforced cap as a
prerequisite. Keep cumulative in-scope estimates and actual observations distinct;
escalate credible overrun risk, not absent hard-cap support. Local reservations are
not a provider spend cap. Portal visits remain control-plane-only throughout.

**Last deployed P0 wake checkpoint:** Worker-triggered generation7 wake → native ready →
one canonical completed portal reply passed, including full reload, attempt1 and
exact attribution (5.834s). Fixed portal-refresh alarm starvation and unsupported
Workers redirect:'error'; manual mode still refuses all redirects. Both fixes deployed.
Real workerd HTTP202/302-no-follow, alarm/reopen,4 unit/17 shutdown tests, typecheck
and build pass. The listener exited0; retained service nativeStopped:true, both locks
free and zero matching executors/read errors. Unknown wake intent and historical
recovery/waiting custody remain unchanged, with no replay or universal termination
claim. No new Sprite, restarting Service, connector or upgrade. Billing unverified
under the existing $10 total cap; production gates false. Source remains unpushed.
Next: safe cold-listener bootstrap and fresh bounded session staging, not more identical
manual canaries. Current grant expired05:51:05.490Z; this is not ongoing chat availability.
Prior full verifier failed after1609 backend/485 runtime passes; no new full-green claim.

**Prior continuation checkpoint:** settled-session continuation is deployed and live-verified.
Epoch2 recorded nativeStopped:true; both locks were free and no matching executor was
observed. Fresh generation3 bearer/pin, journal and authenticated activation produced
one canonical completed reply in5.483s, retained after reload. Prior completed74 and
both historical unknown/waiting tasks are unchanged. No Sprite reboot or replay.
This remains an operator-managed short session, not always-available chat. Next is a
usable session/wake path rather than more identical demonstration messages. Production
gates remain false; incremental billing unverified. One new text-only task, no new
resource/upgrade/connector. Generation3 expired03:35:06.382Z; launcher emitted stopped
and exited1 with a generic refusal/stop message. Independent retained service readback
confirms recovery/nativeStopped:true. This is direct-child stop evidence, not universal
settlement or safe sleep. No consumed session restart.

**Local continuation verification:**
fresh grants can advance past epoch2 without renewing old policies or replaying work.
Exact stored text-only result/receipt and absent unsettled activity are required;
all historical epochs and pre-cutoff messages remain untouched. Focused116, final41,
typecheck and desktop16 pass; extended real Worker epoch3/reopen passes in verifier
environment. Full combined check exits0 (1605 backend/473 runtime plus native,
Worker/browser/build checks). Three isolated Worker invocations lost
connections; retained logs distinguish those failures from passing runs. No hosted
activation/deployment/spend in this stage. Next is operational continuation with
operator stop evidence and generation-bound credentials, not historical replay.

**Verified hosted checkpoint:** after the owner's fix direction, a focused oracle review
approved one additional bounded restart while authority was revoked and no successor
ran. The request returned202; changed kernel identity remained stable122s, same Sprite
and disk nonce, services absent. Historical first502 outcome stays unknown; a delayed
restart interruption risk is explicitly retained, not claimed impossible.
Generation-bound credential checks are deployed; runtime before activation rejected409.
Owner-authenticated successor activation applied and fresh one-run text-only launcher
reported ready. One new message completed with a canonical assistant event in7.016s;
full reload retains exact response, completed status/error null and attempt1 attribution.
Both historical tasks are unchanged. P0.2's bounded hosted path is demonstrated.
Genuine catalog obtained through supported Codex debug models; no auth-cache copy.
Its42KB profile exposed a32KB config bound, raised to128KB with18 focused tests passing.
Prior combined1605 backend/472 runtime and desktop16 remain valid for the generation
binding. Launcher exited0 after its one-run policy expired; this is not ongoing chat
availability. Next P0 deliverable is bounded session continuation without replay or
silently renewing consumed immutable custody, then P0.3 responsive background work.
Old unknown custody/no replay and production gates remain unchanged. No public post,
new Sprite or upgrade; actual billing remains unverified. All assigned workers done.

## Owner priority: first usable chat and background task

**Work the critical path below before additional feature polish.** This ordering supersedes older “next priority” notes below, without weakening safety requirements or deleting remaining product scope. The orchestrator owns integration and demonstration; subagents own independent prerequisites for this path, not an expanding list of unrelated improvements.

| Priority | Deliverable | Exit evidence |
| --- | --- | --- |
| **P0.1 — Highest; E01/E02** | Resolve the supported execution/descendant containment blocker. Finish the bounded prerequisite harness and establish a supported manager/workload boundary or a documented supported alternative. | Name the supported mechanism, demonstrate its relevant lifecycle behavior, or state the exact unresolved provider capability and next decision. Do not substitute more refusal tests for positive evidence, infer settlement from parent exit/free locks, or patch runtime internals. If blocked externally, report the specific access/approval needed promptly and continue independent P0 integration preparation. |
| **P0.2 — Highest; E02/E13/E14** | Assemble one minimal persona path: durable portal message → supported Codex execution → attributed persisted result in the same conversation. Reuse current authentication where valid; request only missing authorization. | One bounded, explicitly authorized real-model task with exact receipt/task/result identity and reconnect readback. Scripted fixtures are preparation, not completion. No connector writes are needed for this first slice. Distinguish a bounded live demonstration from production readiness. |
| **P0.3 — Highest; E03** | Keep that persona responsive while one isolated background task executes. | Real status question leaves task A unchanged; independent task B is durably separate; intentional steer/cancel targets only the selected task. Record unsupported behavior explicitly and retain O01–O09 acceptance. |
| **P0.4 — Highest; E01/E02/E14** | Verify cancellation, uncertainty, restart/recovery and activity accounting for the demonstrated path; prepare the hosted owner trial. | No duplicate task/effect after the tested failure, durable results after reconnect, and no false settlement or unsafe sleep. Hosted wake/result checks require actual provider evidence and applicable deployment/account authorization; production gates stay false until their requirements pass. |
| **P1 — After usable slice** | Required connector integration (including WhatsApp), Mac build/render acceptance, and remaining routine/skill workflows. | Existing acceptance rows and live permissions still apply. Pull work forward only when it removes a concrete P0 dependency. |
| **P2 — Defer new assignments** | Additional roster/search/memory polish, optional UI expansion, and broad audits/test matrices unrelated to a current critical-path defect. | Retain backlog requirements. Finish/integrate already completed work, but do not open more peripheral work just to keep subagents occupied. Necessary security fixes are not deferred. |

At each checkpoint, lead with: **what the owner can now do, which P0 exit passed, the remaining blocker, and the next concrete deliverable**. Test totals are supporting evidence, not the milestone. Identify active assignments versus completed/integrated work. Do not invent an ETA, repeatedly re-request existing authorization, or treat this reprioritization as permission to deploy, spend, connect accounts, or bypass safety gates.

## Owner alpha boundary — newest direction

**Aim for a useful supervised alpha, not bug-free production acceptance.** A first
slice may offer one owner/persona, explicit bounded tasks, persisted attributed
replies and reconnect readback, with provisional/unsettled status and manual
recovery instructions. It must not advertise text-only isolation without an
enforced supported boundary. Full connector/Mac/polish, every recovery scenario
and all S/O/UX acceptance are later work, not prerequisites to any owner use.

- **Alpha safety blockers:** protect credentials, enforce task/effect authority,
  bound execution/spend, prevent automatic replay after uncertainty, and distinguish
  visible output from settlement. Review the concrete restricted runtime's reachable
  capabilities before allowing real inference. Existing runtime production gates
  remain false; an alpha path must be explicit rather than misusing test flags.
- **Containment scope:** complete descendant termination is required for claims of
  safe autonomous sleep/replacement, not automatically for every supervised reply.
  A restricted alpha can retain unknown obligations and refuse sleep/replay while
  showing useful output. It cannot promise child termination or broad tool isolation.
- **Authorized inspection complete:** existing Sprite read-only feasibility plus
  bounded wake/exec under a $10 total ceiling. Result **unknown for protected
  containment**, not absent capability: cgroup v2 and kill interfaces exist and
  access checks report writable, but the same capable identity can reach the 0666
  management socket. No isolation mutation was tested. Sprite returned to cold.
  Conservative estimated inspection cost < $0.15 before tax; not a billing receipt.
- **First real-model trial observed:** owner-authorized device login succeeded;
  one root task used ChatGPT-backed `gpt-5.6-luna` with a 120-second deadline.
  Its final provisional reply persisted across control restart and browser reload.
  Routine reads were denied because the operator used the wrong policy ID; the
  model disclosed the failure. That session remains retained, not replayable.
- **Current authorization:** the owner authorized protected deployment and
  supervised runtime/chat within the remaining existing $10 total, directing no
  repeated scoped approval requests unless there is credible budget risk. This is
  not $10 per attempt or connector/routine activation authority. Reuse the same
  account/runtime, avoid extra Sprites and paid upgrades, no paid API fallback.

## Current checkpoint

**E11 token observations visible locally (2026-09-17):** expanded task and routine-history cards show validated current-attempt native cumulative/last snapshots, attempt/version, nullable context window and persistent partial/stale/non-additive/non-billing disclosure. Missing/malformed/duplicate/wrong-attempt snapshots show unavailable, never zero or global-page fallback. Usage-only refresh rerenders; no controls, commands or new read routes/polling. Host Chromium fixture passes35 existing reads/zero writes; task/history/alpha neighbors, build and desktop16 pass. Desktop390px/1280px at2x and unavailable state inspected; token section readable without clipping. Unrelated search-panel overlap remains visible in the wider unavailable screenshot. No CSS/backend/live/model/provider/spend change. Added fixture to verifier; full prior1604/472 evidence predates only this UI stage. Next: return to supported retirement clarification for hosted completion; E11 billing/overhead/freshness measurement remains separate. Workers/checks finished; continuation enabled.

**E11 usage publication verified locally (2026-09-17):** runtime publishes already-recorded root/registered-child token snapshots on existing maintenance, with durable versioned exact retry payloads. Worker fences epoch/boot/attempt/native/deadline, replaces snapshots including decreases, and exposes bounded current-attempt numeric observations in owner state/task pages without native IDs. Missing remains absent; no summed spend, freshness, billing or settlement claim. Fixed90-day expiry, ordinary pruning and successor historical-retention boundary preserved. Combined passed1604 backend/472 runtime plus browser/HTTP checks before interruption; remaining crash/native/service/build sequence resumed separately and exits0. Desktop16 pass. No UI/live deployment/provider/model call or new spending this stage. Hosted retirement blocker unchanged; next integrate truthful owner display while preserving the priority on hosted completion. Workers/checks finished, continuation enabled.

**Retirement investigation narrowed the external blocker (2026-09-17):** bounded read-only inventory on the same immutable Sprite found only tini/tail plus the inspector, zero service definitions and no active exec sessions. This is not complete retirement proof: PID-namespace coverage and historical launch identity were not established. Official SDK exposes `POST /v1/sprites/{name}/restart`, but no published server contract proves memory discard/non-restoration, disk preservation/no rollback or HTTP autostart fencing. Do not experiment with guest reboot or repeat cold/process polling. Next unblock: provider clarification of that exact restart contract and completion evidence, then bounded successor launch. No code or deployed state changed, no inference/replay/new resource; inspection billing remains unverified. Prior full checks remain valid; continuation enabled, no active workers.

**Authenticated successor activation verified locally (2026-09-17):** `/v1/commands` now accepts only the transition ID and operator-envelope digest; the optional private `HEHEBOT_OWNER_ALPHA_SUCCESSOR` requires original hosted configuration and the durable Access owner binding. Accepted command, immutable consumed authority, activation event and epoch advance commit atomically. Canonical ingress digest is retained, not recomputed from JSON property order. Activation bypasses historical maintenance even on rejection; real workerd activation/retry/read/alarm/reopen preserve predecessor bytes. Full verifier passes1590 backend/467 runtime plus Worker/native/browser/build; desktop16 pass. Final wrong-digest Worker check also preserves old lifecycle/alarm/history. Not deployed or activated. One bounded same-Sprite kernel-ID check at18:28UTC matched the prior baseline: retirement remains unproved, so no live successor launch/replay. Probe billing increment is unverified; no new model call/resource/upgrade. Next: supported process-retirement evidence and bounded hosted successor completion, not another spending approval. Workers/checks finished; continuation remains enabled.

**Worker retained-history boundary verified (2026-09-17):** successor mode now runs only its fenced watchdog, excludes historical due times from alarms, and returns the exact runtime generation descriptor. Actual workerd/SQLite reads, fresh accepts, alarms and persisted Worker reopen preserve old run/attempt/unknown effect/overdue retry/queued context/command/event/original alpha bytes. Lease expiry closes epoch2 and deletes the alarm rather than spinning on old due work. New fixture, ordinary27 Worker checks/migration/capacity fixtures, typecheck and build pass; new case wired into the verifier. Full1590/464 evidence below predates only this narrow Worker follow-up. Next: operator-configured grant and authenticated idempotent activation command; trusted external retirement evidence remains absent. No public activation/config wiring, deployment, provider/inference/spend or push; workers/checks done and continuation enabled.

**Retained-generation core and launch pin verified locally (2026-09-17):** local core fixture advances only the initial expired/recovery-required epoch1 to a pinned text-only epoch2, admits only messages after an activation-event sequence, and completes fresh work while old run/attempt/dispatched effect/original policy remain exact. Generation quota derives from attempts, never rewrites the generation record. Runtime pins the operator-selected boot/session descriptor before RPC and rejects mismatches before hold/native startup. Focused121 backend and54 service tests/typecheck pass; final cutoff-binding regression19 passes. Initial combined check caught a wrong SQL column name; corrected to cause_id. Full rerun exits0:1590 backend/464 runtime,27 Worker HTTP checks plus native/browser/service/build; desktop16 pass. Public command, operator configuration, Worker maintenance exclusion and status wiring remain absent; no live transition is possible. Next: those boundaries and actual trusted process-retirement evidence. No live calls/spend/deploy/push, production gates false; workers/checks returned, continuation enabled.

**Successor authorization preparation (2026-09-17):** after completing the text-only integration below, added a default-absent operator successor envelope parser and exact owner/predecessor epoch/boot/receipt binding checks. This does not activate sessions or expose a command/environment surface. Host review rejects epoch overflow and case-only UUID reuse. Focused successor/alpha/session-view checks76 and typecheck pass; full verifier evidence below predates only this non-wired parser. Next implementation: append immutable generation metadata and explicit owner activation, event-sequence fresh-message cutoff, generation-specific claims/watchdog and historical maintenance exclusion, then pinned successor launcher. Trusted retirement evidence remains separately required; a digest is not proof. No live changes/spend, no active workers/checks, continuation enabled.

**Text-only completion verified locally (2026-09-17):** fresh explicitly pinned text-only alpha tasks can now produce a persisted assistant result in the disposable real-Codex/Worker fixture. This is local preparation, not a hosted fix: the existing portal trial remains recovery-required and unchanged. Receipt binds profile, thread/turn and exact UTF-8 output; fresh config/catalog/full-history checks and flushed event output must agree before settled coverage and completion. Backend retains exact proof atomically and rejects changed replay; legacy sessions cannot gain eligibility. Focused runtime112 and backend/bridge88 pass. Combined verifier exits0:1571 backend/457 runtime,27 Worker HTTP checks plus native/browser/service/build; desktop16 pass. The real native service case verifies one completed result and no residual preview. Host fixed stale verifier input and strengthened pre-admission/observed-output checks; integration tests reject catalog/output drift. Next: additive retained-session transition; external retirement evidence still needs a verified later kernel-ID change or authoritative memory-discard receipt under a no-restart fence. No provider/model/deploy/push or spending this checkpoint; production gates false, old tasks/effects/locks preserved. All bounded workers/checks returned; continuation enabled.

**Text-only profile and lifecycle race fix verified locally (2026-09-17):** the owner-facing portal is unchanged; P0.2 hosted completion is still unmet. Parallel workers delivered the shared profile, retained-session review and delayed-observation fence. Host review made the native fixture execute shared startup/thread/turn settings directly, bound the catalog path, and closed a synthetic-attestation mismatch. Combined verifier exits0:1562 backend/449 runtime,27 Worker HTTP checks plus native/browser/service/build; desktop16 pass. Native text-only proves empty provider tools and17 denied calls, not completion eligibility. Delayed observations now reject changed epoch/boot/provider/controller-operation ownership. No active worker/check, deployment, model call or publication. One authorized ten-second-bounded read-only probe reused the existing Sprite; billing increment unverified. Its later btime is NOT termination proof: a Fly forum clarification says cold may preserve processes and btime changes on resume. Current kernel ID retained as a baseline; no older kernel ID found in relevant retained probe logs. Next: receipt/coverage/service and additive backend admission, plus generation-bound retirement using a verified boot-ID change or supported provider memory-discard evidence. No historical retry/reset or renewed approval request. Continuation remains enabled under the existing $10 total authority.

**Hosted reply observed, completion failed (2026-09-17):** one fresh Chief of Staff prompt produced exact `HEHEBOT_HOSTED_CHAT_OK_73`, persisted across reload as provisional preview only. No completed assistant event. After120s automatic DEADLINE_EXCEEDED led to CANCEL_UNCONFIRMED/recovery_required; old waiting message unchanged/current_attempt0. Launcher stopped cleanly after bounded session, retained custody/no replay, Worker RECOVERY_REQUIRED; latest read-only Sprite observation cold (not proof of termination/safe sleep). Runtime-only Service Auth is configured and host/Sprite owner-binding checks pass; public routes remain owner-only. Root/tool/child/effect settlement is the real blocker, not account permission. Do not reset installation/policy/journal or retry this task. Local `--text-only` fixture now proves empty provider catalog +17 unsupported dispatches, unchanged config/catalog, no background terminals, using supported empty environments/static direct catalog; no live changes and completionEligible remains false. Full credential-free verifier exits0:1556 backend/444 runtime tests,27 Worker checks plus native/browser/service/build; desktop16 pass. No active check or live trial remains. Next is a separately versioned, capability-closed completion contract and safe session lifecycle, not longer timeouts or fake root-only success. Existing $10 authority continues; no new approval needed for scoped work.

**Supervised hosted chat authorized/in progress (2026-09-17):** owner confirms portal loads and explicitly authorizes runtime/chat within the remaining existing $10 total, without repeated scoped approval requests. No connector/routine activation or old-message replay. Same existing Sprite reused; current source installed separately, pinned Codex0.154.0; existing model auth reused in place, account/read + model/list confirm ChatGPT/gpt-5.6-luna without inference. Real Tasks hold/renew/release passes. Native fixture initially fails because default Sprite capabilities break bwrap; supported setpriv dropping all capability sets and setting no-new-privileges makes identical fixture pass (825ms, no real model calls). Production flags stay false. Runtime-only Access setup assigned to existing browser worker; host owns Worker/Sprite. Existing hosted launcher is ≤5min/≤3 roots, not continuous chat. Next: finish runtime service credentials, verify internal owner binding/negative auth, then one bounded fresh-message path. No new Sprite, live model turn or paid upgrade yet; actual billing still unverified.

**Full protected portal deployed (2026-09-17):** owner supplied successful bootstrap identity and asked to continue. Exact subject saved0600 and pinned; Wrangler4.130.0 deployed current full Worker plus four public assets and new CONTROL namespace with SQLite migration configuration. No retained state uploaded. Remote settings match every configured var and only ASSETS/CONTROL bindings; execution/native false, provider/triggers empty, no runtime/alpha credentials. Previews off and zero target custom domains. Seven anonymous/forged-header ingress probes all302 to exact Access team. 63 auth/owner-binding/hosted-policy tests, build and private release dry-run pass. Owner can open the production root; next evidence is authenticated portal/state load to verify new store initialization. No agent/routine/connector/inference/Sprite activation or paid upgrade; billing balance unverified. Local Git remains unpublished. This supersedes bootstrap/login blockers below.

**Identity-only bootstrap deployed (2026-09-17):** browser post-reload app/policy GET confirms exact-host self-hosted app, sole owner-email Allow, one-hour duration, no bypass. Host reused it; direct bearer app/policy GET still403/1010 and list200/empty (unresolved, do not recreate). Wrangler4.130.0 deploy exit0; live anonymous root/bootstrap/API/asset and forged-header probes all302 to configured Access team. API confirms previews off, only four bootstrap vars/no assets/storage/runtime bindings, zero target custom domains; account zone list empty. 34 bootstrap/auth tests, typecheck, dry-run and diff check pass. Next: owner logs in at protected `/__owner-bootstrap`, saves verified JSON privately to mode0600 `.local/secrets/cloudflare-owner-sub.json`, then host pins exact subject and deploys full portal/fresh SQLite. No owner login proof/full control-plane deployment yet; no agents/routines/connectors/inference/Sprite or paid upgrades. Remaining billing balance unverified. This supersedes earlier creation/deployment blockers below; schedule remains paused awaiting login.

**Continuation paused; Access failure now requires diagnosis/manual fallback, not more generic permission requests:** original-token dashboard edits do not change token value/mtime. After blanket-permission report, one bounded create still403/1010 `auth.forbidden`; apps before/after0. Exact account/Bearer route verified, token active through 2026-09-30. Configured owner has accepted Super Administrator membership; token creator identity/scope and team-account/Free-plan association remain unverified. Token detail/groups and organization reads denied; IdPs empty. Ray `a3c6ea200e7506ac-SEA`, 2026-09-17 08:59:23 UTC. Stop create retries. AUTH_SETUP.md records dashboard account-resource/role/team-plan/IP checks and exact-host, exact-owner-only manual Access-app fallback. Reuse verified manually created app; do not duplicate. No successful shared mutation or deployed URL, no activation, budget unchanged/unverified. Private owner config valid; no re-upload/onboarding/consent or token replacement request solely for unchanged value.

- **Protected workers.dev deployment authorized; blocked on account onboarding, not a domain:** owner approved current integrated local Worker/SQLite plus owner-only Access within the remaining existing $10 total, with no paid upgrade or execution activation. Official Cloudflare docs support production workers.dev with existing JWT headers. Local Wrangler 4.130.0 dry run and 42 auth/policy + 8 hosted-runtime tests pass; previews explicitly disabled, default ingress still dark, exact issuer/audience/owner and loopback bypass unchanged. Private read-only API check: valid token, one account, zero Workers; no workers.dev subdomain (10007), Access not enabled, organization/users/billing reads denied. No shared write or deployment/public URL exists. Owner must initialize Workers & Pages and Zero Trust Free, privately supply team domain/exact owner login and appropriate Access-management token permission; obtain owner subject through verified login. Do not repeat deployment approval or infer identity. Prioritize this alpha path over connector expansion; no further probes until account setup changes. Raw account evidence stays private. Remaining billing allowance is unverified, not renewed.

- **WhatsApp prepare-only installation verified locally:** explicit `verify-wappmcp.mjs --prepare /absolute/new-directory` retains the checked pinned graph and private prepared-not-enabled receipt without starting/pairing/registering the connector. Existing destinations refuse; normal failure cleans newly created staging; npm uses disposable HOME/config/cache and Git patching cannot discover the parent checkout. Two preparation tests pass, including real install inside Git with hostile inherited config. Combined exits 0: 1542 backend/444 runtime, default disposable and retained-install checks, 27 Worker HTTP checks plus browser/native/service/build; desktop16 pass (`.local/wapp-prepare-{combined,desktop}.log`). License/source/asset review remains incomplete; retention is not redistribution approval or current inventory. No active worker/check, persistent test installation, live calls or changed gates. Local/unpublished. Next: supported startup and fresh installed-tree inspection, not automatic activation; continuation enabled.

- **WhatsApp task-to-transport binding verified locally:** an unregistered host reader captures exact task/attempt/lease, scopes and deadline, pins them durably against rebinding, and connects Worker authorization to journaled MCP calls. Cancellation and tightened deadlines reach the SDK; incompatible/error/late results retain uncertainty without replay. Actual pinned SDK/public factory passes scoped search with synthetic authority; recent-read rejection remains unknown and cannot replay. Combined exits 0: 1542 backend/444 runtime, 27 Worker HTTP checks plus browser/native/service/build; desktop16 pass (`.local/wapp-binding-{combined,desktop}.log`). No active worker/check. No production registration, installed/paired runtime, live callability or settlement claim. Next: trusted supported installation/startup/inventory, retaining the recent-read compatibility blocker. Local/unpublished; gates and external Cloudflare decision unchanged; continuation enabled.

- **Connectors diagnostic page verified locally:** owner can open the bundled WhatsApp baseline, distinguish incompatible recent reads from synthetic-only scoped search, and inspect prerequisites without installation/account controls. Worker finished/integrated; host Chromium verifies no catalog polling/commands, managed-page routing, literal text, malformed/offline/late/alpha fences. Five desktop/narrow/loading/error renders inspected; heading starts at top and content wraps. Combined exits 0: 1542 backend/439 runtime, 27 Worker HTTP checks plus browser/native/service/build; desktop16 pass (`.local/connector-ui-{combined,desktop}.log`). No active worker/check; local/unpublished. Actual installed/callable inventory and guided supported setup remain the next E09 gap, not proved by this baseline. No live/shared actions or changed Cloudflare decision; continuation enabled.

- **Owner connector-catalog API verified locally; UI active:** GET /v1/connectors/catalog exposes the existing pinned WhatsApp diagnostic as a bundled baseline with unobserved runtime inventory and no authority, not installation/callability proof. Signed owner-only, rate-limited, no-store; no overdue reconciliation/alarm/probe, alpha denied. 46 focused HTTP/auth tests and typecheck pass. Combined exits 0: 1542 backend/439 runtime plus 27 Worker HTTP checks, browser/native/service/build; desktop16 pass (`.local/connector-catalog-{combined,desktop}.log`). Existing UI worker has exact unpublished base and owns on-demand read-only Connectors page; host owns integration. Next: review/integrate that page; no host check remains running. Local/unpublished; no account/install/pairing/provider action, new grant or changed Cloudflare decision; continuation enabled.

- **Real Worker routine-capacity/reopen verified locally:** worker finished; host verified patch/log hashes, reviewed isolation and reran the real PersonalControl fixture. It proves atomic 21st rejection, 20-run catch-up, 13 replacements/7 skips and exact rows/context/alarm after stopped Wrangler reopen. Both execution gates false; all active runs CAPABILITY_UNAVAILABLE, zero attempts/effects/outbox, STOPPED/STOP/queue_sequence0. Wired into test:e2e (and therefore combined verifier). Host backend1540, typecheck and integrated migration/capacity/26 Worker HTTP checks pass (`.local/routine-capacity-{worker-host,backend,e2e}.log`). No full native/browser rerun for fixture-only changes. No active worker/check; local/unpublished. Retain cap: hosted/timed alarm delivery, throughput and representative execution/cost evidence remain unverified. No live/shared actions or changed Cloudflare decision; continuation enabled.

- **20-routine boundary and catch-up custody verified locally:** two SQLite regressions cover installation-wide 20/21 admission across personas, edits/disabled drafts/slot reuse, and 20 simultaneously overdue routines. Twelve missed ticks coalesce into 20 runs; reconstructed/repeated reconciliation adds none. Mixed 13 queue-one/7 skip routines retain independent custody; four unknown-budget routines remain parked without attempts/effects/outbox. 33 focused schedule/lifecycle/budget tests and typecheck pass (`.local/routine-capacity-focused.log`). Tests/docs only; application behavior and cap unchanged. Prior combined pass remains `.local/task-skill-ui-combined.log`; native/browser suites were not repeated for this test-only checkpoint. Next: real Worker alarm/reopen evidence for the full batch before any capacity change; throughput/live dollar costs remain unverified. No active workers, live/shared actions or changed Cloudflare decision; continuation enabled.

- **Task-to-skill portal verified locally:** eligible task cards open a blank reusable-procedure editor with exact source persona/run/attempt. Owner text only; no transcript copying, inference, task changes or activation. UI worker finished/integrated; host corrected streamed UTF-8 fixture decoding and wired the browser test into the verifier. Combined exits 0: 1538 backend/439 runtime plus Worker/browser/native/service/build checks; desktop16 pass (`.local/task-skill-ui-{focused,combined,desktop}.log`). Neighbor task-feed/cancel checks pass; five desktop/narrow/error renders inspected and scrolling/footer DOM assertions pass. No active worker/check remains. Next independent E05 deliverable: bounded local 20-enabled-routine admission/load evidence, distinct from live dollar-cost evidence. Automatic learning/model judgment remain unverified. Local/unpublished; no new live grant, shared action or Cloudflare decision; continuation enabled.

- **Task-sourced skill draft API verified locally; portal integration active:** owner `skill.propose_from_task` stages separately supplied procedure text against an exact retained current task attempt. Server records persona/run/attempt provenance only; it copies no task input/output and does not steer/retry/enqueue or enable skills. Review remains separate. Alpha/model/trigger calls reject. Contract worker finished; 89 focused backend/HTTP tests and typecheck pass. Combined verifier exits 0: 1538 backend/439 runtime plus Worker/browser/native/service/build checks; desktop16 pass (`.local/task-skill-{integration,combined,desktop}.log`). UI worker has the exact unpublished base and owns task-source entry/editor reuse and focused browser evidence; host owns integration. This is not automatic learning, redaction, safe execution, or proof of source completion. No live/shared actions; Cloudflare decision unchanged; continuation enabled.

- **Skill discovery verified locally:** appropriately granted skill authors can search current shared catalog metadata before proposing duplicates. Explicit search+proposal tool allowlists and admitted proposal policy are required; existing grants do not expand. Literal ASCII-case-insensitive substring search returns 20-result exclusive-ID pages, never bodies/references or enablement. Owner-alpha remains denied. Worker finished/integrated. Combined verifier passed 1527 backend/439 runtime plus Worker/browser/native/service/build (exit 0, `.local/skill-search-combined.log`); desktop16 and strengthened literal/deletion cases pass. Runtime Unicode bounds match schemas. No active worker/check, migration, UI, live/shared action or publication; local/unpublished. Next: explicit corrected-task learning handoff, with retained-source privacy/provenance review before implementation. Model judgment remains unverified; Cloudflare approval unchanged; continuation enabled.

- **Run skill once verified locally:** the owner can bind supplied input to one current approved skill revision without per-bot enablement changes. This is ordinary gated work, not a dry run or an isolated safe test; owner-alpha rejects it. Captured skill bodies survive claim/retry and catalog deletion; unstarted input expires at 30 days. Contract/UI workers finished. Full verifier passed 1524 backend/435 runtime plus Worker/browser/native/service/build checks (exit 0, `.local/skill-run-combined-final.log`); desktop 16 pass. Host fixed Skills-page alpha activation retention and two HTTP fixture defects (lazy SQL writes and split-UTF-8 decoding). Initial failures retained; four desktop/narrow/attribution renders inspected. The prior offline error banner may remain after reconnect (noncritical existing behavior). No active worker/check or live/shared action; local/unpublished. Next: bounded model-facing skill metadata discovery before proposing duplicates, without expanding body access or proposal authority. Cloudflare approval unchanged; continuation enabled.

- **Skill text references verified locally:** the owner can author, review, remove and restore up to four named `.md`/`.txt` text references per skill, each bounded to 16,000 Unicode code points. Exact text/legacy omission, admitted snapshots and existing authority remain intact. Both workers finished/integrated. Host fixed imported-body validation bypasses, a malformed-reference rendering exception and silent over-limit editor truncation. Combined verifier passed 1506 backend/435 runtime plus Worker/browser/native/service/build checks; desktop 16 passed. Final UI follow-up and neighboring fixtures pass; after one retained Save-wait timeout, exact revision/content/connection refresh checks pass twice consecutively. Eight representative renders inspected. Logs: `.local/skill-references-{combined,browser-final-2,observed-refresh,desktop}.log`. No active worker/check remains, migration, live call or publication. Next: explicit skill-test admission preserving exact revision without global enablement or tool expansion; no safe-test execution claim. Cloudflare approval unchanged; continuation enabled.

- **Routine execution/delivery disclosure verified locally:** history shows current-attempt application records separately from run-level delivery counts and portal status. Prior delivery is never attributed to a retry; pruned/missing bodies do not erase recorded completion or prove failure. No private destinations, payloads or native identities are exposed. Final combined verifier passed 1468 backend/434 runtime tests plus real Worker, browser, native/service and build checks (exit 0, `.local/routine-delivery-combined-final.log`); desktop 16 pass. Six desktop/narrow renders inspected. Initial combined exposed a fixture assumption: refresh may skip during an in-flight poll. The stronger observed Offline/Connected barrier passes two focused reruns and final combined. UI worker finished/integrated; no active worker or verifier remains. Local/unpublished; Cloudflare approval unchanged, production gates false, no live/shared actions. Next: supporting-file policy for skills, preserving capability review and admitted revisions; safe-test execution remains separate. Continuation enabled.

- **Manual occurrence identity verified locally:** each new Run now has a durable manual occurrence; duplicate receipts/retries retain it, while paused schedules, optional scheduled budgets and queue-one replacement keep their prior behavior. V13 migration/legacy compatibility worker finished and integrated. Full verifier passed1464 backend/434 runtime plus real Worker migration/reopen, browser/native/service/build (exit0, `.local/manual-occurrence-combined.log`); desktop16 pass. Final-write FK failure rolls back without losing referenced custody. No historical manual backfill, live/shared migration, push or deployment. Next: routine-history execution-versus-delivery metadata; run-level outbox must not imply current-attempt delivery. Cloudflare approval unchanged; continuation enabled.

- **Durable attempt attribution verified locally:** routine history now retains captured revisions across retries and shows the latest three attempt/revision pairs; historical attempts stay unknown rather than backfilled. V12 migration/legacy compatibility worker finished and integrated. Combined verifier passed1445 backend/434 runtime plus browser/native/service/build (exit0, `.local/attempt-revision-combined-final.log`); desktop16 pass. Initial two positional retention fixture failures were fixed; pruning preserves attribution. Final desktop and narrow renders inspected. No live session reset, shared migration, push or deployment. Next: manual occurrence identity with explicit origin, preserving scheduled budget/overlap semantics. Cloudflare approval unchanged; continuation enabled.

- **Routine history shows captured revision locally:** matching retained current-attempt context supplies only a numeric revision; unstarted/missing/mismatched snapshots show unavailable. Current routine edits cannot rewrite the displayed captured revision, and conversation task shape stays unchanged. Capture is not execution/delivery proof; retries replace snapshots, so prior-attempt history remains open. Red/green SQLite case and25 focused tests/typecheck, history/preflight Chromium and desktop16 pass; three known/unavailable/narrow captures inspected. Combined passed1427 backend/434 runtime plus browser/native/service/build in `.local/routine-revision-combined.log` (exit0). No active worker or live actions. Next E05 work: manual occurrence identity and durable attempt attribution contract; no speculative schema changes before inspection. Cloudflare decision unchanged, continuation enabled.

- **Routine preflight is now visible locally:** on-demand read-only panel shows exact blockers, observation revision/time, separate execution status, timezone/local+UTC hypothetical times and policy. Run now remains unchanged; history stays independent. Host preflight/history/delete browser checks pass; eight desktop/narrow/loading/error/offline renders inspected; desktop16 pass. Combined verifier includes preflight and passed1426 backend/434 runtime plus browser/native/service/build in `.local/routine-preflight-ui-combined.log` (exit0). Worker finished/integrated, no active assignment or live actions. Next E05 gap is executed routine revision attribution in history, not current-revision substitution. Full credential/input readiness and live routine acceptance remain separate. Cloudflare decision unchanged; continuation enabled.

- **Routine preflight API implemented locally:** owner GET `/v1/routines/:id/preflight` reports current revision/persona, schedule times, policy and manual-run blockers separately from execution-enabled. Shared command checks preserve rejection codes and recheck current authority; paused routines can run once without resuming. This is an observation, not credential/model/input/effect readiness or delivery proof. Rate-only reads create no tasks or alarms.52 focused tests/typecheck/desktop16 passed; combined passed1425 backend/434 runtime plus browser/native/service/build in `.local/routine-preflight-combined.log` (exit0). Extra grant-change test passed the focused rerun after backend stage. Test subagent finished; [preflight UI worker](https://ampcode.com/threads/T-01a0acf2-c565-772e-8025-183e4257343e) owns on-demand display/browser tests on the exact unpublished base. Alpha gateway unchanged, no live actions or repeated deployment request. Continuation enabled.

- **Routine-card history is now integrated locally:** on-demand all-status pages show exact task identity, request status and current-attempt provisional output without claiming delivery or settlement. UUID ordering is explicitly not chronological. No history polling/mutations; alpha makes zero new history requests. Host history/delete/tasks/alpha browser checks and desktop16 pass; six DPR2 desktop/narrow/loading/empty/error/offline renders inspected. Combined verifier now includes history and passed uninterrupted with1402 backend/434 runtime plus browser/native/service/build in `.local/routine-history-ui-combined.log` (exit0). Worker finished/integrated, no active assignment. Next E05 deliverable is routine configuration preflight; live routine acceptance remains separate. No account/provider/publication actions; Cloudflare deployment decision unchanged, continuation enabled.

- **Routine run-history API implemented locally:** owner-only `GET /v1/routines/:id/runs` pages all statuses for one live routine, reusing task output/steering/recovery projection without captured context/checkpoints. Exclusive UUID ordering is stable, not chronological; counts cover the entire routine independent of page. Sibling routine/persona and old-attempt output isolation pass; conversation task pages remain unfinished-only.48 focused tests, typecheck and desktop16 pass. Combined passed1402 backend tests then timed out at FakeProvider boot before model requests; isolated retry and remaining native/service/build checks passed in `.local/routine-history-combined-remaining.log` (exit0). Original failure retained: resumed sequence, not uninterrupted pass. Reads rate-limit without reconciliation, alarms or enqueue. This is history, not preflight, delivery settlement or a UI. [Routine history UI worker](https://ampcode.com/threads/T-01a0acd6-f40d-770f-a3a0-e69fd7ede7bb) has the exact unpublished base and owns the next display and browser checks; host owns integration. Alpha gateway unchanged; no live actions or repeated deployment request.

- **Portal skill history and staged restore now implemented:** approved skill cards load retained pages only on request; historical names and all procedural fields are previewed. Restore requires confirmation and stages a pending proposal for separate approval, with stable identity on uncertain retry. Stale/deleted/offline state and delayed navigation responses reject; alpha mode sends no history or restore requests. Host browser run passes seven reads/two identical mutation requests; draft regression and desktop16 pass. Desktop/narrow history, error and confirmation captures inspected, including scroll/footer DOM checks. Combined verifier exits0 with1,386 backend/434 runtime plus browser/native/service/build (`.local/skill-history-ui-combined.log`). No backend authority or live account changes. Next: routine workflow preflight/history under E05 while Cloudflare approval remains pending. No active subagent; continuation enabled.

- **Owner-only skill history API implemented locally:** `GET /v1/skills/:id/revisions` returns descending retained approved bodies/timestamps, current revision and exclusive pagination (default10/max20), not drafts or actor/source metadata. Deleted/missing/non-skill IDs reject; signed wrong-owner/runtime credentials fail before RPC. Reads use the existing owner read-rate limit without scheduler reconciliation, alarms or native/provider work.36 focused history/HTTP/restore tests and typecheck pass. First full run exposed a test fixture missing its command receipt; corrected through command ingress. Final combined exits0 with1,386 backend/434 runtime plus native/browser/service/build (`.local/skill-history-combined-final.log`); desktop16 pass. No portal control yet: next is history selection and staged restore UI, preserving the separate review step and alpha gateway route limits. Deployment decision unchanged; no active workers or live actions; continuation enabled.

- **Skill drafts preserve uncertain submission identity:** create/update editors now retain proposal ID, stable skill ID, command key and first submitted contents; explicit unchanged retries cannot silently stage a second proposal. Changed contents/target, offline and stale/deleted/missing update targets block before POST. Actual Chromium regression reproduced the old identity change and now passes four exact synthetic requests;14 skill/restore SQLite tests pass. Combined verification exits0 with1,359 backend/434 runtime plus browser/native/service/build checks (`.local/skill-draft-combined.log`); desktop16 pass. This is same-editor protection, not persistence across browser closure or automatic reconciliation. E05 remains partial; no appearance/backend authority changes. Cloudflare approval remains pending without a repeated request. No active worker; next local work is a bounded owner-only skill-history read endpoint and restore discoverability through the existing staged review contract. Continuation enabled.

- **Hosted target preparation reached an external decision:** verified candidate and a control-plane-only publication proposal are recorded in `docs/AUTH_SETUP.md`. Worker `hehebot-portal` has no selected Cloudflare account/route and blank Access identity; no Cloudflare credential environment variables are present. Existing Sprite `hehebot` is identified only from retained inspection, not freshly queried. Request account/hostname selection and explicit Worker/Access publication authorization; no Sprite/model/connector changes or renewed budget. No code gap was found on this bounded P0 path. No tests rerun for documentation-only preparation. Continuation remains enabled for independent P1 routine/skill workflow work while that decision is pending; do not repeat this request or invent new P0 synthetic gates. No active subagent.

- **Private hosted read/reply composition now works:** signed synthetic Access → actual Worker/SQLite → pinned native Codex → scoped routine MCP read → attributed provisional reply, retained after Worker reopen. Four HTTP auth/persistence tests and the native fixture pass with exactly two loopback model requests and synthetic Sprite PUT/GET holds. Production and sleep remain denied. Combined verification exits0 with1,359 backend/434 runtime plus native/browser/service/build checks (`.local/hosted-composition-combined.log`); desktop16 pass. This bypasses the real-account entry check through fixture preparation; it is not live Access ingress, provider or launcher acceptance. The runbook now reflects the implemented mode and remaining live gates. Next: prepare the exact hosted target/release and authorization request, then live ingress/account/provider checks only within granted scope; no publication or retained-session reset. No active subagent remains; continuation enabled.

- **Manual hosted launcher now holds both cooperating locks:** native home first, session state second; private-path/same-inode checks, exact config-digest handoff, exit73 contention and one-child signal forwarding pass real subprocess tests. No reset/retry or HTTP wake activation.21 focused tests pass; full verifier exits0 with1,359 backend/430 runtime plus native/browser/service/build checks (`.local/hosted-launcher-combined.log`); desktop16 pass. Delegated pristine-native experiment found extra lock descriptors survive in the npm wrapper, not its ELF child; free locks therefore cannot prove native termination or authorize takeover. No live account/model/provider action. **Next:** complete private scripted Access/Worker/native/Tasks integration using Miniflare's supported outboundService JWKS interception; retain the distinct provider-containment and deployment gates. Both bounded subagent units are finished; continuation enabled.
- **Distinct hosted admission and supervised composition implemented locally:** `HEHEBOT_HOSTED_OWNER_ALPHA` requires Access, an independent owner pin, false production flags, empty provider config and no local-alpha policy. Wrong pins roll back before seed; bounded claims/quota, exact provisional readback and policy/restart refusal pass real SQLite/Worker HTTP tests. Runtime requires the explicit hosted marker; `runHostedOwnerAlpha` reuses account/model/no-paid-fallback and watchdog behavior with Sprite holds. No hosted CLI/wake activation or deployed configuration exists.71 focused control and54 runtime tests/typecheck pass; full combined exits0 with1,359 backend/426 runtime plus native/browser/service/build checks (`.local/hosted-admission-combined.log`); desktop16 pass. Both delegated parser/control-test units are integrated. **Next:** supervised launcher holding both native-home and session-state locks, then complete private scripted Access/Worker/native/Tasks composition before requesting any hosted deployment. No live account/provider action; production, replay and sleep remain denied. Continuation enabled, no active subagent.
- **Hosted runtime owner/hold composition implemented, not enabled:** explicit `hostedOwnerBindingSha256` persists the expected owner/origin before status, rejects a wrong owner before boot, and requires the Sprite activity guard before native work. Expired holds during startup or maintenance refuse reacquisition; stop/sleep retain the Task. Default local alpha stays loopback/provider-free; the Worker still rejects hosted alpha and the production entrypoint remains transport-only.57 focused tests and full combined verification pass:1,335 backend/419 runtime plus native/browser/service/build checks (`.local/hosted-owner-combined.log`); desktop16 pass. Delegated tests are integrated; host added exact expiry/await and sleep checks. Official docs confirm remote device login, not blanket hosted subscription/resale eligibility. No live account/provider/deployment action. **Next:** implement the separately gated hosted control admission/launcher contract; provider containment, hosted account eligibility and deployment authorization remain external. No active subagent; continuation enabled.
- **Transport preflight now verifies the intended hosted owner:** runtime-authenticated Access status exposes only a stable owner-binding digest; the existing Sprite preflight requires an independently pinned digest and compares it before reporting success. Missing/mismatched identity and malformed config fail closed; caller mutation during awaited status cannot swap the pin. It still performs only status reads and reports executor_ready:false—HTTP202 is wake acceptance, not startup permission. Local-alpha/public status shapes remain unchanged.47 focused SQLite/alpha tests,16 transport tests, full1,335 backend/411 runtime tests and build dry run pass. Full native combined verifier was not repeated for this bounded transport addition. No account/provider/model/deployment action occurred. **Next:** integrate immutable owner/origin checks and mandatory activity holds into a distinct hosted bounded-session startup, retaining all production/replay/sleep gates and separate live-provider authorization. No active subagent; continuation enabled.
- **Hosted owner identity now binds to durable data:** fresh Access installations pin auth mode, installation, issuer, audience and subject before seed. Changed identity/downgrade and populated unbound adoption fail closed without overwriting private data; same-owner reopen and export/import preservation pass. Existing local alpha remains unchanged; no hosted execution mode, deployment or provider mutation is enabled.65 focused Access/binding/alpha tests pass; full combined verifier exits0 with1,333 backend/406 runtime tests plus native/browser/service/build checks in `.local/owner-binding-combined.log`. Hosted design now names the remaining runtime owner/origin binding and mandatory activity-hold integration rather than relaxing the local parser. Existing Access data without a binding needs an explicit migration workflow (not implemented); no cloud installation exists in this project. **Next:** implement hosted runtime/control binding under a distinct bounded mode without enabling production or retrying retained sessions. No active subagent; continuation enabled.
- **Process-crash custody now tested across actual subprocess death:** four deterministic SIGKILL boundaries plus a successful control use real FileJournal/ExecutionBridge and fresh recovery processes. Unknown claim/native outcomes produce no repeated external calls; durable native IDs allow only identical Worker registration retry. Host tightened exact pre-crash call counts and child cleanup.17 focused journal/crash tests and all406 runtime tests pass; no runtime behavior change or new live session. This is simulated-transport application custody, not power loss, Codex recovery, provider takeover or the100-injection acceptance target. Hosted preparation now explicitly distinguishes the working local alpha from an Access deployment: local policy cannot be promoted by flipping flags. **Next:** prepare a separately reviewed hosted bounded-admission design while retaining provider lifecycle and deployment authorization blockers; do not mutate the Sprite or copy model credentials. Continuation enabled, no active subagent; live session remains stopped/retained.
- **Live bounded background responsiveness demonstrated:** same-owner ChatGPT `gpt-5.6-luna`, selected **Chief of Staff**, three admitted roots and one child. A spawned its child and returned; independent status and packing-list replies persisted while the child remained active. Exact A cancellation reached that child (`interrupted`) without cancelling S/B. Their exact previews survived native shutdown, private Worker reconstruction and browser reload; composer is closed and unresolved work correctly requires recovery. The child's MCP read completed; its itinerary was interrupted, not delivered or settled. `.local/owner-v2-live-session/{live-report,verified-evidence,reconstructed-readback}.json` retains evidence. Native and readback services stopped, zero native processes, no reset/replay. Corrected stale portal background wording; inspected2x readback screenshot and DOM verify both previews, Connected and disabled Send. **P0.3 narrow live response/cancel slice passed, not full orchestration acceptance. Next:** prepare the hosted owner trial against remaining provider containment/recovery gates; deployment and provider mutation remain outside this grant. Production/sleep/replay remain denied, no paid API fallback or new infrastructure spending. Continuation remains enabled; no active workers.
- **Bounded V2 launcher opt-in implemented, not yet live-demonstrated:** `backgroundFirstRoot:true` persists the exact first-root policy; omission remains root-only and malformed values refuse before creating custody. Integrated V2 authority/custody plus complete inherited feature restrictions replace the earlier blanket entry refusal; V1 remains prohibited. Final combined verifier exits0 (1,318 backend/399 runtime, native/browser/service/build); subsequent entry/launcher checks pass33 tests. No account/model/provider action occurred. Production, settlement, automatic replay/restart and sleep remain denied. **Next:** exercise the already-authorized same-owner bounded V2 task/status/independent-message/cancel path with fresh private state, retained uncertainty and no paid API fallback; no new deployment or renewed spending allowance. No active subagent remains. Earlier checkpoint blockers below are historical, superseded only by this evidence.
- **Selected V2 restrictions now survive native config layering:** adversarial enabled/always_on sleep config exposed that a per-thread features table drops startup overrides, restoring apps/sleep defaults. The selected root now carries the complete restricted feature set; actual root/child apps/plugins/sleep readbacks are false, inherited read/status/B/exact cancellation still pass7 requests, and old V1/V2 fingerprints cannot replay.48 focused tests pass. Full combined rerun is in `.local/restricted-v2-combined.log`; no account/provider actions or live V2 session occurred. Next: finish this verification and review the bounded owner-entry gate against the integrated evidence, preserving all unknown settlement/restart limits.
- **V2 integrated verification passed:** final combined run passes1,318 backend/395 runtime, native/browser/service checks and build; desktop16/16. Terminal-root native mode passes33 loopback requests: same-tree message queues, followup_task explicitly rejects root, and natural child completion appends metadata without another root turn/inference in a one-second window. No pending/recovery events;31 retained operations still deny sleep. Prior verifier failures and fixture corrections are retained, not hidden. **Next safety fix:** source inspection found `sleep_tool` defaults on independently of disabled token_budget; explicitly disable it/read back the restriction and exercise existing always-on sleep config before live-background gate review. No live account/provider actions, no worker outstanding, continuation enabled.
- **V2 service and multi-turn custody integrated:** scripted portal → Worker → pristine native V2 now passes inherited child read, independent status/B, reload without inference, exact root-family cancellation and sleep refusal (7 loopback requests,26 retained operations). Selected roots use V2 cap2; old V1 selected fingerprints refuse replay. Schema v11 preserves distinct same-thread turn receipts with immutable parent/attempt/persona, transactional migration and exact legacy backup/import compatibility. Host248 focused SQLite tests and17 runtime policy tests pass; a separate adapter→mapper→SQLite regression covers lost ACK/reopen and three attributed turn outputs. Both workers are integrated; no active assignment remains. Combined verification passed1,318 backend/395 runtime tests, then found a stale schema hash in the HTTP export fixture; corrected, rerun pending. Live background gate remains closed pending full integrated verification and bounded native-root lifecycle follow-through. No live/account/provider actions or production flag changes.
- **V2 native activity custody passes:** actual V2-capable child spawn is denied by capacity; sequential idle replacement and foreign-root denial pass31 loopback requests. Integrated runtime now retains both child threads and all3 turns,26 uncertainty-preserving operations, no unbound events and no sleep;4/4 held responses close. Default23-request mode,126 focused/394 runtime tests and typecheck pass. Host fixed a delegated test's incorrect nested event shape against recorded native flat events. **Remaining local blocker:** same-thread followup fails the database's UNIQUE(native_session_key); [schema worker](https://ampcode.com/threads/T-01a0ab67-cf7f-744d-806f-9b46c412122e) owns v11 migration, immutable original-parent custody and strict backup compatibility. Host owns selected-root V2 config/fingerprint/service integration next. Live background gate remains closed, production flags false; no real inference/account/provider actions. Full combined waits for the known red custody regression.
- **Output-recovery verification finished:** combined rerun passed1,298 control/387 runtime plus all native/browser/service checks, then stopped at final build on a test-only undeclared `adapter.rpc` assignment. The test now reopens through the constructor;11 targeted tests, typecheck/build dry run and desktop16/16 pass. Full combined was not repeated after that correction; both failure logs remain. Changes are local/unpublished. The V2 capacity/event worker remains active; host found current event routing recognizes `collabAgentToolCall`, whereas V2 persisted history uses `subAgentActivity`, and requested exact live event evidence before service adoption. Continuation remains enabled; no live background/restart or production change.
- **Missed provisional output now recoverable locally:** exact acknowledged completed-turn history restores bounded root/child previews without inference replay, new clocks or settlement. Partial/failed/interrupted history does not freeze message text; omitted known messages preserve the latest display and conflicting/duplicate IDs reject atomically. Red/green adapter cases,11 SQLite publication tests and native root/child/cold-history checks pass. Final combined rerun is in progress after updating a native steering assertion that expected missed output to stay missing. **V2 source correction:** cap2 shared residency may enforce depth1 despite recursive catalog availability; a live child occupies the sole non-root slot and cannot be evicted. The existing V2 worker now tests actual advertised child spawn capacity denial and sequential idle replacement, owning only its script. Lifetime child custody still needs review; live background remains blocked. Next: integrate that evidence and verify service lifecycle/fingerprint changes before any V2 adoption. No account/provider/model calls or deployment.
- **V2 prerequisite integrated and independently passed:** selected A cannot message, follow up or interrupt unrelated active S by its actual UUID; same-tree calls work and S answers while the child remains active. Host run uses23 loopback requests, zero active turns after cleanup, all3 held responses closed and unchanged config (`.local/owner-background-v2-host.json`). [Evidence and pinned-source decision](docs/OWNER_BACKGROUND_V2_NATIVE.md): child roles cannot enforce a V2 descendant veto; the cap bounds residency, not logical children, and child model metadata controls recursive tools. Live background gate remains closed; root-only alpha is unchanged. V2 worker is finished/integrated, no worker remains active. Next independent P0.4 deliverable: exact-turn provisional-output recovery after a missed native notification, without replay, settlement or automatic runtime restart. No account/model/provider/push/deploy actions.
- **V1 cross-root gap now reproduced natively:** optional `--foreign-close` makes selected root A close unrelated loaded root S by its actual UUID and receive S's completed text, while A's child remains active. Nine loopback requests, exact readback/cleanup and unchanged config pass; default seven-request mode still passes. This is a successful bug reproduction, not safety acceptance or automatic root-reactivation evidence. The host explicitly started A's second turn; no live account/model/provider action occurred. Live background entry remains blocked. V2 worker is still the sole active assignment; next deliverable remains supported cross-task authority proof, not another V1 launch.
- **Background integration passes, but live V1 is blocked on task authority:** both control/runtime workers are reviewed/integrated. Actual scripted browser/Worker/native path passes inherited routine read, status alongside A, independent B, root cancellation reaching old A, three retained families,25 operations and denied sleep. Combined passes1,297 control/380 runtime plus all native/browser/service/build checks (`.local/owner-background-combined.log`); desktop16/16. Host fixed repeated-cancellation no-op writes with failing/passing replay tests. Subsequent pinned-source inspection found V1 send_input/close_agent/wait_agent can target a foreign live root by UUID, with no supported spawn-only filter. The owner entrypoint now rejects background mode before account/service work;24 focused tests pass. No live session used it. Default alpha remains root-only. Next critical prerequisite: [V2 native authority worker](https://ampcode.com/threads/T-01a0ab2c-d340-7198-8811-fbb800f5ed2c) tests known foreign IDs, positive same-tree targeting, capacity/depth and cleanup; source guards alone are not acceptance. No live model/provider/push/deploy or production gate changes. Continuation enabled.
- **Background context isolation fixed; native prerequisite passes:** background summaries now require the exact captured persona/private/room/routine scope, with filtering before the 30-row limit; missing-scope legacy rows are omitted. This prevents private task titles from entering shared-room or unrelated-routine input. Two new SQLite regressions and all1,281 control tests/typecheck pass; restricted background service fixture still answers status while retaining A/B families and denying sleep. The new pinned-native prerequisite verifies one selected root's direct child, actual second-child/grandchild/default-root spawn denials, independent status-root completion, and exact cleanup across seven loopback requests. Combined verifier passed1,281 control/364 runtime plus native/browser/service/build (`.local/background-scope-combined-retry.log`); first run retained a tool-fixture EADDRINUSE failure before inference. Live/service alpha remains root-only: the native cap is per root, not installation-wide. Next deliverable is explicit opt-in durable selection of one background-capable root, with other roots unchanged. Backend and runtime workers are active in isolated checkouts; host owns the new integrated fixture, not yet verified. No live child, account/provider action or gate change.
- **Private follow-up continuity fixed and integrated:** the new root-only two-message fixture reproduced missing prior conversation context. Direct-message claims now carry bounded earlier same-persona messages and explicitly provisional visible replies; command-sequence cutoff excludes later messages, and room/routine/cross-persona scopes remain separate. Final native mode passes four scripted requests, two distinct tasks/threads/grants, exact first reply in second input, both verified routine receipts, third-admission refusal, no inference on reload, old-task cancellation isolation, retained unknown coverage and denied sleep. Combined verifier passed1,279 control/364 runtime plus all scripted/browser/service/build checks (`.local/alpha-continuity-combined.log`); final stronger MCP assertions pass `.local/alpha-multi-host-final.log`.50 focused context tests and typecheck pass. All workers are finished/integrated. The unused live portal session and native runtime are stopped; state/login preserved. No new real inference, production permissions, push or deployment. Next P0 remains useful background-task admission/continuity under an explicitly chosen bounded policy; the current alpha is root-only, not full P0.3 or E06 acceptance.
- **Session expiry / early-stop follow-up:** the exposed session admitted zero tasks; retained `expiry-readback.json` reports no runs/previews and nativeStopped:true at15:42:33Z. Native admission is closed; readback lasts only through15:54:32Z. No reset or new session was started. Future launches now check original native process liveness immediately before gateway message forwarding; observed early exit rejects pending/new messages while reads/cancellation remain available. A real local child exit during a held request verifies the gap, with13 gateway/launcher tests and typecheck passing (`.local/alpha-access-early-stop.log`). This follow-up is not yet in the running readback service; normal expiry already fences it. Next local prerequisite: integrated multi-message root-only alpha must preserve distinct grants, original unresolved families and quota without relaxing child/tool permissions.
- **Authenticated owner access available in a bounded orb session:** both gateway/session-view workers are finished and integrated. Actual HTTPS orb ingress → token form → HttpOnly cookie → private Worker returns Connected, one available admission and 120s task limit; runtime/internal and export routes return 404. No host task was submitted. Fresh dedicated state is `.local/owner-alpha-access-session`; admission expires 2026-09-16T15:39:32.159Z and readback ends 15:54:32.159Z. Preserve custody; never restart/reset this directory. Service `owner-alpha-access` is managed and only the authenticated gateway is exposed. The user receives the private token through Terminal, not chat. Combined verifier passed 1,275 control / 363 runtime plus integrated gateway/browser/native/service/build checks; desktop16/16. Logs: `.local/alpha-access-{combined,desktop,supervisor-child}.log`. Host fixed actual form-Origin failure with same-origin referrer policy, retaining exact CSRF; separate native fixture request-order regression now routes unrelated tasks independently and retains catalog/denial assertions. Actual public portal render inspected at `.amp/in/artifacts/owner-alpha-public-portal.png`. Local changes remain unpublished; no production deployment, connector writes or new inference from host verification. Next: owner-use readback and session shutdown; then P0.3 background admission remains separate from this explicitly root-only alpha.
- **OWNER ALPHA real read/reply milestone demonstrated:** the corrected fresh session produced one successful routine-read MCP call (HTTP 200), one completed native root, and the accurate reply “none exist for this persona in the local instance.” The one-run/one-attempt identity and version-2 provisional reply survived deadline cancellation, Worker reconstruction and browser reload. After the 120-second deadline the task was Cancelling / DEADLINE_EXCEEDED; retained uncertainty later became Needs recovery, with no run.result or completed-result card. Native runtime stopped and both services are off. No 403/429, connector writes, Sprite calls, paid API fallback or gate changes. Private evidence: `.local/owner-alpha-corrected-session/{report,readback}.json` and journal; readback exit 0, `passed_readback`; DPR2 screenshot inspected at `.amp/in/artifacts/owner-alpha-corrected-reply.png`. The orchestration report retains a browser JSON-decoding assertion failure; independent corrected readback passed without restarting inference. This satisfies the narrow real chat/read-only-tool/provisional-reply milestone, not full P0/background/settlement or hosted acceptance.
- **Real chat-to-reply path passed; routine listing did not:** one browser message produced one native root/attempt and a final provisional reply in about 16 seconds. Reopened retained Worker data and browser reload preserved version 3, exact run identity and zero completed-result cards. Both routine calls returned 403: the host trial setup used a random policy ID instead of `ROUTINE_MANAGE_POLICY`. Fast verification polling then hit HTTP 429 and stopped the runner before the deadline check; this is not live timeout evidence. App-server shutdown is recorded, but unknown operations remain and the UI shows Needs recovery. No automatic replay, API fallback, connector writes, Sprite calls or production gate change. Private evidence: `.local/owner-alpha-live-session/{receipt,readback,report}.json` and journal; inspected screenshot: `.amp/in/artifacts/owner-alpha-live-reply.png`. P0.2's real provisional-reply sub-milestone is observed; routine-read success and full result settlement remain open. Both local services are stopped. Next: one separately authorized corrected-policy trial, using slower readback and the same login in place.
- **Authorized live trial stopped at login prerequisite:** `codex --version` returned `codex-cli 0.154.0`; `codex login status` returned `Not logged in` (exit 1) in this orb. The owner’s one-task/120-second authorization is retained, but no account login, model discovery, task submission or inference occurred. Smallest next action: authorize supported device login in this orb and complete its browser authentication, or identify an existing authorized same-owner Codex home available here. No credentials should be pasted into chat. P0.2 remains open; production flags remain false.
- **Explicit owner-alpha path verified locally:** The owner can trial bounded private chat/provisional replies once one real-model task is authorized. `--owner-alpha` now passes actual browser/HTTPS Worker/SQLite/native/read-MCP admission with both production flags false, no test-mode admission, two scripted model requests and zero Sprite holds. Replies survive reload and task deadline cancellation, with inspected working/cancelling renders and explicit alpha limitations. Root-only spawn denials and original config preservation pass native checks. Both [control worker](https://ampcode.com/threads/T-01a0a9b8-ad9e-7047-a439-3f1cf25b0551) and [native worker](https://ampcode.com/threads/T-01a0a9b9-2823-710b-bc67-3e9aa809b6ec) are finished/integrated. Combined passed 1,274 control/350 runtime plus native/service/build checks; final session-watchdog change passes all351 runtime cases; scoped-read revocation/public-summary follow-up passes53 backend cases; desktop16/16 passed. Logs: `.local/owner-alpha-{combined,runtime-final,focused-final,service-final}.log`. No live account/model/provider action, deployment or production gate change. P0.2 real-model exit remains open. Next: authorize one root-only task using existing same-owner login in place, at most120 seconds, no writes/connectors or paid API fallback; stop if login is unavailable. No additional containment/P2 work is needed before that narrow trial.
- **Restricted-alpha boundary checkpoint:** Actual scripted portal/status/background passes with minimal/workspace reads, explicit private-path denies, immutable profile identity and read-only MCP grants (`.local/restricted-background-verified.log`). Provider search/apps/plugins/image-generation surfaces are independently disabled and checked in native readback. Combined passed1244 control/342 runtime plus native/service/build checks (`.local/restricted-final-combined.log`); final explicit-deny change additionally passes48 focused service/transport cases and the six-request restricted path; desktop16/16 passes. [Native worker](https://ampcode.com/threads/T-01a0a99d-ff26-70a8-9aef-f0cd16078094) and [pinned built-in review](https://ampcode.com/threads/T-01a0a99e-5b45-70e2-900d-21e13b430e17) are finished/integrated. Host shell comparison passes26 assertions with exact ELF extra read; service does not add that allowance. Inspected built-ins use sandboxed helpers; no concrete arbitrary file bypass was found, but this is source-supported rather than behavioral proof for those built-ins. No broader containment project is required by this evidence for supervised provisional replies. Next deliverable: explicit bounded owner-alpha session entrypoint, then one specifically authorized real-model task; current disposable gate is not live authorization. No provider/account/model action, production gate or spending change.
- **Latest P0 owner-alpha preparation:** The actual portal/Worker/native scripted path now answers status while A stays active, reloads the attributed provisional reply without inference, cancels independent B, and still cancels old A after new coordinator admission. Host `--background-responsive` passes with all three families retained; unknown coverage still refuses sleep/final settlement. [Backend receipt/migration](https://ampcode.com/threads/T-01a0a983-1f17-755f-98ab-6b7047a68ea3) and [portal/native fixture](https://ampcode.com/threads/T-01a0a983-8f49-759d-9f1b-0d44d9067af3) are reviewed/integrated; both workers finished. Final host combined check passed **1,244 control / 335 runtime**, all scripted/service/build checks, and desktop **16/16** (`.local/family-combined-final.log`, `.local/family-desktop.log`); the responsive browser mode separately passes in `.local/family-background-host.log`. DB v10 preserves old backup/export compatibility. This is local preparation, not real-model or hosted alpha. Next deliverable: apply/review the existing supported named-profile credential/tool boundary in the service, then request one specifically bounded live task when safe; do not wait for full recursive sleep/product acceptance. Known limit: 32 unresolved families, no restart-as-reset or automatic recovery. No further provider inspection/spend or P2 work.
- **P0 current usable preparation:** Actual browser submission → local Worker/SQLite → pinned Codex scripted execution → attributed provisional output survives browser close/reopen/reload with no extra inference. Real-model owner alpha is not yet assembled/authorized; unknown coverage still blocks final settlement/sleep, not the usefulness of visible replies. [P0.1 prerequisite](https://ampcode.com/threads/T-01a0a966-5154-72f3-bd8a-e29226c36865) and [P0.3 native responsiveness](https://ampcode.com/threads/T-01a0a966-ac2b-70ba-a723-2bbc774a074a) are integrated; both workers finished. Native status completes while A stays active and independent B cancellation preserves A; Worker/service admission remains the implementation gap. Authorized Sprite inspection now confirms primitives but not isolation. Next main deliverable: explicit restricted alpha admission and family-preserving coordinator release, retaining old operations/cancellation/holds. No P2 assignments, deployment or inference calls.
- **Current checkpoint:** Three journal-custody regressions reproduced queued input mutation and returned-versus-durable value divergence. Inserts/updates now snapshot before queueing and writes return persisted JSON, preserving omitted-field deletion. 29 journal/service tests and typecheck pass; final combined verification passed 1,227 control/301 runtime in `.local/cancel-journal-final-combined.log`, desktop 16/16 in `.local/cancel-journal-desktop.log`. Reviewed/integrated [guarded task cancellation](https://ampcode.com/threads/T-01a0a94e-b230-7486-9675-69972090171c): 13 exact synthetic envelopes and seven neighboring browser fixtures pass; three DPR2 renders inspected. No server attempt precondition or termination claim. [Supported containment design](https://ampcode.com/threads/T-01a0a94f-4a67-710c-b953-ccbd420e51d8) is reviewed/integrated; real delegated-domain tests remain unavailable. Both workers finished; local commits only. No production or account actions.
- **Current checkpoint:** Five startup/stop regressions reproduce post-stop actions and false success, including promise-resolution gaps. Lazy startup actions now check phase before invocation and after awaits; 26 service/journal tests plus typecheck pass. Reviewed/integrated [lock inheritance evidence](https://ampcode.com/threads/T-01a0a93c-46a4-747f-995b-b1f5b28a4cd0): 30 related cases pass, proving a default-spawn child can remain live despite successful lock acquisition. [Conversation search](https://ampcode.com/threads/T-01a0a93b-ec1b-70ab-bb97-4b1995fee0b1) is integrated: focused plus eight browser regressions pass, four DPR2 renders inspected; filtering leaves unresolved work and pagination intact with zero added search requests. Final verification passed 1,227 control/298 runtime in `.local/startup-history-final-combined.log`; integrated build and desktop 16/16 pass. Both workers finished; local commits only. E02/E04/E09 remain partial; no production activation or account actions.
- **Current work verified:** WhatsApp result custody reproduced two post-response mutation failures; snapshots precede final authorization/journal persistence, with a red/green post-capture deadline guard. All 36 read/operation tests and typecheck pass (`.local/wapp-result-custody-focused-final.log`). Reviewed/integrated [expiry-to-runtime cancellation](https://ampcode.com/threads/T-01a0a92a-6e24-752c-9a6b-9ec134881770): 72 related tests and typecheck pass, exact attempt cancellation preserves uncertainty and grace. [Scoped memory search](https://ampcode.com/threads/T-01a0a92a-1724-7316-929a-f6b830b35a65) is integrated: search/inspector/edit/Forget browser checks pass, zero extra inspection/search requests, three DPR2 search renders inspected. Final combined passed 1,227 control/291 runtime (`.local/search-expiry-final-combined.log`); integrated build and desktop 16/16 pass. Both workers finished; local commits only. E02/E06/E09 remain partial; no live connector or gate changes.
- **Current checkpoint:** Completion captures caller identity/proof/result before bridge awaits and supervisor queueing; five red mutation cases reproduced both gaps, and 92 bridge/supervisor tests plus typecheck pass. Integrated [public MCP server evidence](https://ampcode.com/threads/T-01a0a915-8433-7657-a113-9767c2220f22): 22 catalog tools, eight schema rejections, 26 host denials; recent arrays still fail SDK validation. Integrated [memory metadata inspection](https://ampcode.com/threads/T-01a0a915-91be-77cf-bd61-7cd40e99f01d): exact metadata, no extra requests, unchanged-refresh retention and stale/navigation reset; inspector/edit/forget fixtures and three inspected DPR2 renders pass. Final combined verifier passed 1,225 control/287 runtime; desktop 16/16 (`.local/public-inspect-integration-{combined,desktop}.log`). Both workers finished. Local only; no account actions or gate changes; E06/E09 remain partial.
- **Active checkpoint:** Reviewed/integrated [guarded Forget UI](https://ampcode.com/threads/T-01a0a901-126f-722c-888e-671c15e2b52f) and [memory purge custody](https://ampcode.com/threads/T-01a0a901-2475-709f-b6de-378be6605141): 42 backend tests, eight-request Forget fixture and edit/routine-delete/recovery regressions pass; three DPR2 renders inspected. Main added retained-conversation/terminal-copy disclosure. Seven injected readiness changes across drain awaits no longer produce false sleeping success; 121 supervisor/lifecycle tests pass. Final batch passed 1,217 control/287 runtime in `.local/forget-drain-integration-combined.log`. Public ESM shutdown exports pass 19 cases/13 children, not embedded lifecycle acceptance. Pinned Codex still denies sleep; production gates false. No worker remains pending; main owns integration/status.
- **Latest checkpoint:** Portal memory editing preserves metadata and binds original custody; journaled WhatsApp reads revalidate captured Worker authority after intent persistence and before dispatch, 2026-09-16. A reproduced revocation-during-write race previously dispatched once; the regression now dispatches zero times and retains non-replayable intent. 67 focused tests and the HTTPS held-intent cancellation fixture pass, including tighter cap, clock-before-timer and late-authorization cases. Shutdown integration passed 19 cases/13 synthetic children; pinned CLI unregisters successful-start signal handlers and destroy does not prove termination. Final batch verification passed in `.local/shutdown-reauthorize-{combined,desktop}.log`. No live connector or provider action, push or deployment.
- **Focused evidence:** five actual SDK modes passed in `.local/wapp-sdk-focused.log`; recent array results remain incompatible. Earlier worker evidence (45 runtime/service + 186 control/backup tests and 15 isolated read tests) is retained in `.local/parallel-question-focused.log`, `.local/parallel-control-focused.log`, `.local/wappmcp-locked-focused.log`; those isolated fixtures did not prove SDK read compatibility.
- **Combined:** `bash scripts/verify-codex.sh` passed **1,274 control / 350 runtime tests**, artifact-auditor/Mac source checks, pinned MCP contracts, local HTTP/crash/native/service fixtures, and typecheck/build dry run. Latest log: `.local/owner-alpha-combined.log` (exit 0). Final timer coverage passes all **351 runtime tests**; scoped-read/public-summary checks pass **53 backend tests**. The separate `--owner-alpha` browser/native path passes with two scripted requests and inspected working/cancelling states. Logs: `.local/owner-alpha-{runtime-final,focused-final,service-final}.log`. Production admission remains false. Desktop install/tests passed **16/16**; prior Swift XCTest evidence does not prove native Mac rendering.
- **Evidence boundary:** scripted model/provider responses, pristine Codex 0.154.0 and local Worker/SQLite are not authenticated model judgment, complete native settlement, real provider sleep or production acceptance.
- **Next priority:** make the demonstrated supervised owner-alpha path available for actual owner use through an authenticated access surface; never expose the loopback auth bypass. The real read/reply check no longer blocks this milestone. Preserve both trial sessions and the existing login; no automatic replay/reset. Background tasks, automatic recovery, full settlement and hosted deployment remain separate work, with production flags false. Do not re-ask the bounded-work spend grant below its $5 ceiling.
- **Latest follow-through:** main's sequential 100-case crash/reopen run passed in 470,837ms (50 precommit/50 committed-response-loss), with cleanup confirmed; the earlier concurrent timeout remains documented. Log: `.local/integrated-crash-sequential-100.jsonl`. License inventory now inspects all 350 SRI-verified artifacts, retaining ten identical aliases without extraction; eight focused tests pass. Legal review remains required.
- **Latest integration:** prior eight worker deliveries and the two new independent slices are integrated: [E09 readiness](https://ampcode.com/threads/T-01a0a8bd-a526-7157-b07e-6e4b075e72ea) and [E15 endpoint custody](https://ampcode.com/threads/T-01a0a8be-2ecc-7050-a072-3a6a18874ca6). Main reviewed both and reran focused tests; neither closes its acceptance family. Main owns shared status. Native Mac compilation/rendering remains unverified; prior portal and Linux Swift evidence is retained below.
- **Current integration batch:** [E05 portal review comparison](https://ampcode.com/threads/T-01a0a8d1-cb45-714e-a8c6-aa23a4b20c46) and [E05 restore custody](https://ampcode.com/threads/T-01a0a8d1-d67e-7521-8fa5-c53482233967) are reviewed/integrated. Main reran 30 backend tests, skill-review/routine-delete/recovery browser fixtures, and inspected four desktop/narrow screenshots. Added scroll/footer DOM assertions and full batch verification pass; E05 remains partial. No E05 worker is pending.
- **Latest parallel integration:** [E06 memory editing](https://ampcode.com/threads/T-01a0a8eb-6453-7613-a106-ee1aae24f4bf) now preserves metadata/source and original persona/revision/scope with stale/offline/navigation fences and dialog-local same-save retry. Main reran 12-command Chromium fixture and four neighboring browser regressions and inspected three DPR2 captures; [limits](docs/PORTAL_MEMORY_EDIT.md). [E09 shutdown evidence](https://ampcode.com/threads/T-01a0a8eb-73bc-732e-9d2b-fc0c92f74ad3) is reviewed/integrated with the artifact verifier; [methodology](docs/WAPPMCP_SHUTDOWN.md) retains CLI/process-tree limitations. Neither worker remains pending. Main retains runtime authorization and shared status ownership.
- **Owner action:** read-only Sprite inspection and its $10 ceiling are already authorized and completed; do not ask again. A specific real-model task, any isolation mutation test and deployment require their own applicable approval. Local alpha assembly can continue. No credentials should be pasted into this file or chat.
- **Mac direction:** SwiftUI + WKWebView source now exists in `macos/`, with native settings/windows/menus and strict remote-portal policy. Linux policy tests are not an Apple-framework build or rendered native acceptance. Existing Electron code remains reference-only; no verified Mac release exists.

## How to read and maintain this checklist

- `[x]` means the **stated local deliverable** is implemented with recorded evidence, not that its whole S/O/UX/R acceptance gate passed.
- `[ ]` remains open until its stated exit evidence exists. **Partial** means some implementation exists; **Not implemented** means the named deliverable is absent; **Unverified** means acceptance evidence is missing.
- An external test does not block preparatory coding, synthetic tests or documentation. No overall completion percentage is claimed: task sizes differ and full product acceptance remains open.
- At every substantive implementation checkpoint, update this file's date, current checkpoint, affected rows, evidence and next priority. Record failures and exact blockers. Read the owning code before rebuilding a partial feature.
- Keep detailed contracts/evidence in [implementation status](docs/IMPLEMENTATION.md) and [handoff](docs/HANDOFF.md). Update those when behavior or continuation assumptions change. The [specification](SPEC.md), [UX specification](PRODUCT_UX_SPEC.md), [orchestration contract](docs/BOT_ORCHESTRATION_ADDENDUM.md) and [project intent](docs/PROJECT_INTENT.md) remain normative; this checklist does not weaken them.
- Do not check off a requirement from mock success, tool advertisement or another agent's report alone. Record rendered UI checks for visual work, live/account/device checks separately, and any unsupported capability or explicit owner-approved product difference.
- This file is updated during work, not a live telemetry dashboard. Publishing it, deploying code, activating routines and connecting accounts require their own authorization.

## Completed local deliverables

These are useful foundations that should not be rebuilt simply because their full acceptance gates remain open.

- [x] Bounded named skill text references with exact authoring, comparison, removal, retained history/restore, duplicate validation and imported-body guards. Initial runtime catalogs stay metadata-only; admitted full-content loads and export/import preserve text without materializing files. Combined and focused Chromium checks pass; not executable support, live model judgment or full UX11 acceptance. [Contract and UI limits](docs/SKILL_REFERENCES_UI.md).
- [x] Routine history distinguishes exact current-attempt application records from run-level delivery counts/portal persistence, including unknown delivery, retries, missing records and pruned results. It exposes no result bodies or private destinations and adds no mutations/polling/alpha reads. SQLite/HTTP, Chromium with six inspected captures and full combined verification pass; not live delivery, native settlement or full E05 acceptance.
- [x] Skill review shows eleven current/proposed field pairs (including references) with stale/offline guards, explicit affirmation, unchanged command authority and same-editor uncertain retry. Chromium keyboard/alert/scroll checks and four inspected captures pass. Nine new backend restore cases preserve historical bodies, admitted context, enabled/disabled scope and receipt replay; 30 focused tests plus combined verifier pass. [UI limits](docs/PORTAL_SKILL_REVIEW.md) and [restore limits](docs/SKILL_RESTORE_CUSTODY.md); no full E05 or native Mac acceptance claim.
- [x] Native Tasks elapsed deadline bounds no-response and trickling reads/mutations, clears timers on success/error and preserves unknown outcomes after late responses. Red/green deterministic boundary cases plus real local HTTP and 22 activity/service tests pass; `.local/tasks-deadline-{red,focused}.log`. Request destruction is not proof of provider rollback or live Task settlement.
- [x] Diagnostic readiness separates advertised/installed/artifact/per-operation protocol/historical authorization evidence, never grants authority, and names the pinned recent-read incompatibility even for synthetic scoped search. Seven new tests (144 combinations) and 25 integrated readiness/read tests pass. [Boundaries](docs/CONNECTOR_READINESS.md): no installer, runtime probe or live callability.
- [x] Bounded wrong-owner/runtime-versus-owner endpoint custody matrix uses actual Worker/auth/RPC/core SQLite with signed local JWTs. 43 new tests and 123 integrated auth/question/read/control tests pass; denied routes preserve all tables/change counts and avoid control RPC, alarms and fetch. [Coverage and exclusions](docs/ENDPOINT_CUSTODY_MATRIX.md): not a full security audit or deployed Access proof.
- [x] Activity renewal readback checks the previous hold's exact expiry after awaiting the provider. The 119999ms case succeeds; 120000/120001ms cases block further ensure/release without deleting the Task. Red/green regression and 19 activity/service tests pass; `.local/activity-renewal-{red,focused}.log`. This does not prove uninterrupted live holds or successful recovery.
- [x] Real pinned-SDK stdio fixture independently observes direct-process termination and later progress from its exact synthetic descendant, preserves unknown read intent and denies replay. Cleanup verifies both synthetic identities are no longer executing. `node scripts/verify-wappmcp.mjs` passed; `.local/wapp-stdio-focused.log`. This is not Chromium termination, production process supervision or safe-sleep acceptance.
- [x] Unregistered WhatsApp read assembly fsyncs payload-free intent before dispatch, refuses retained operation IDs and projects unresolved reads across reconstruction/root completion. Responses settle only protocol invocations; SDK rejection, timeout and late response do not establish termination. Eight new tests plus existing read/operation/journal suites pass (61 total). No connector launch, process/browser settlement or E09 completion is claimed.
- [x] Routine deletion uses the accessible portal editor with exact ID/revision, explicit acknowledgement, current selection/owner/revision/offline fencing, and same-editor idempotency key reuse after uncertain response. `node scripts/test-portal-routine-delete.mjs` passed (two synthetic requests, one receipt); schedule/recovery fixtures also pass. Desktop/narrow screenshots inspected. This is Chromium evidence, not native Mac acceptance or proof of external cancellation.
- [x] Portable Swift client origin/navigation policy compiles and passes four actual XCTest methods on Linux with verified Swift 6.3.3; five source/permission-script checks also pass. `macos/` native source remains unbuilt/unrendered against Apple frameworks; E12 is not closed.
- [x] Actual spawned-child proposed-plan-tag stream/cancellation contract confirms Default mode, exact child message ownership, stable clocks, no host-journal streaming payload, and continued sleep denial. [Evidence](docs/CODEX_CHILD_PLAN_EVIDENCE.md). This is not child Plan emission or recursive settlement acceptance.
- [x] Operator-selected WhatsApp chat/tool grants are captured at admission and intersected with current registry, exact attempt/lease, hard deadline and ancestor state. HTTPS Worker composition rejects foreign scope/mutations and suppresses results after cancellation. Evidence: 38 focused core / 11 client tests, two synthetic reads, combined verifier. No actual MCP registration, pairing or browser operation.
- [x] Reproducible pinned-artifact license evidence collection without extraction or lifecycle execution. Eight unit tests and 350 SRI-verified/inspected artifacts; [findings and unresolved obligations](docs/WAPPMCP_LICENSE_EVIDENCE.md). Legal/redistribution approval stays open.
- [x] 100 actual local workerd SIGKILL/same-disk reopen cases, half incomplete-input and half committed-response loss, preserve acknowledged siblings and exact receipts/retries/conflicts. Main rerun passed with child cleanup; [boundaries and initial failure](docs/CONTROL_CRASH_RESTART.md). No power-loss, active-native recovery or full E15 acceptance claim.
- [x] Initial native-question journal reads obey the admitted task deadline; late I/O cannot invent an answer/resolution. Evidence: 45 question/service and 72 core question tests plus combined run. Successful recovery and native termination remain E01/E02.
- [x] Pruning rejects impossible deletion sequences and preserves unknown receipt boundaries. Evidence: 114 backup/retention/restore tests; [limits](docs/CONTROL_BACKUP_JOURNAL_SAFETY.md). Not journal authenticity or off-host deletion proof.
- [x] Recovery editors reject offline/stale task, effect digest/status and eligibility before POST; reconnect never replays. Evidence: recovery/question Chromium checks, keyboard/error-role assertions, inspected desktop/narrow captures. E04 remains partial.
- [x] 200 seeded SQLite effect/drain sequences with independent custody/lock/receipt checks and mutation detection. Evidence: [model and limits](docs/DRAIN_EFFECT_RACES.md); counts reproduced locally. Not process-crash or live-provider acceptance.
- [x] Model-facing skill/routine commands and reads enforce the task hard deadline before watchdog reconciliation. Evidence: three red/green active-state boundary cases, 13 focused tests and combined run; rejected calls preserve stored custody.
- [x] Isolated 350-package WhatsApp lock graph reproduces in disposable storage with scripts disabled and only the exact approved patch. Bounded optional host-authority checks pass 15 read tests. No trusted connector registration; license/source/asset review and live adoption remain E09/E13.
- [x] Durable owner command ingress, idempotent receipts, revisions, scoped context, occurrences, effects and resource locks. Evidence: [implementation](docs/IMPLEMENTATION.md), control/Worker tests.
- [x] Lease/epoch fencing, conservative cancellation/recovery, exact submission-ack replay and complete bounded heartbeat paging. Evidence: [service](docs/CODEX_SERVICE.md), [handoff](docs/HANDOFF.md).
- [x] Host-observed tool/spawn and reasoning-item phase clocks, initial root/child-response and acknowledged-child startup deadlines, canonical heartbeat timestamps and immutable replay custody. Reasoning content is excluded from the host journal. Later quiet gaps, progress extensions and complete operation coverage remain E01.
- [x] Native-question custody, explicit owner answers, uncertain one-shot handoff and stopped-question closure; default-off disposable runtime integration. Evidence: [custody](docs/NATIVE_QUESTION_CUSTODY.md), [binding](docs/CODEX_QUESTION_BINDING.md).
- [x] Exact-task steering, deferred follow-ups and attributed provisional output through local Worker/native fixtures. Intent resolution and responsive independent admission remain E03. Evidence: [steering](docs/CODEX_STEERING.md), [service](docs/CODEX_SERVICE.md).
- [x] Portal profiles, roster sections/hiding/search, task/recovery pagination, schedule picker/preview, question cards and monitoring views with focused browser checks. Full UX acceptance remains E04. Evidence: [implementation](docs/IMPLEMENTATION.md), [roster](docs/ROSTER.md).
- [x] Managed skill and routine command foundations, scoped memory and passive context updates, bounded timeline/payload retention. Full conversational acceptance remains E05/E06. Evidence: [implementation](docs/IMPLEMENTATION.md).
- [x] Offline SQLite snapshots, pinned-age encryption, cooperative creation and explicit digest-reviewed pruning. Evidence: [creation](docs/CONTROL_BACKUP_CREATION.md), [pruning](docs/CONTROL_BACKUP_PRUNING.md). Not coordinated disaster recovery.
- [x] Application logical export/reconstruction, selected authority-stripped templates and offline restore inspection including question custody. Evidence: [export/import](docs/CONTROL_EXPORT_IMPORT.md), [templates](docs/PORTABLE_TEMPLATES.md), [inspection](docs/CONTROL_RESTORE_INSPECTION.md).
- [x] Optional-routine budget admission and content-free monitoring projections. Evidence: [budget](docs/BUDGET.md), [implementation](docs/IMPLEMENTATION.md). Not actual billing or an enforced provider spending cap.
- [x] Credential-free 1,000-publication passive-update volume cases with execution enabled: stopped provider driver receives zero wake calls; idle/busy supervisor receives zero additional native submissions; active task/attempt and recipient delivery remain intact. Evidence: `tests/control-acceptance.test.ts`, `tests/execution-supervisor.test.ts`. Staging trace and full E15 acceptance remain open.
- [x] Content-free quiet-window start/end/duration diagnostics for timeout analysis, with root/child clock-regression rejection against recorded ends. Evidence: `tests/runtime-codex-quiet-phases.mjs`, `tests/runtime-codex-recovery-inspect.mjs`. Real workload collection and VM CPU/billing/safe-sleep analysis remain E11; no shorter timeout is justified yet.
- [x] Independent message-stream lifetime clocks survive observed tool/plan overlap and turn completion, without text/delta retention or replay refresh. Evidence: root/child overlap fixtures, native Plan/service cases and offline inspection. Unobserved stream coverage, progress extensions and verified termination remain E01.
- [x] SQLite watchdog preserves the remaining message/plan deadline in both completion orders and enters recovery exactly 30 seconds after unconfirmed cancellation; heartbeats do not reset grace, settle operations, enqueue retries or permit sleep. Evidence: `tests/codex-operations.test.ts`, 8 focused tests. Not native held-stream expiry or process termination proof.
- [x] Malformed message completion maps/digests cannot settle live or offline stream projections. Evidence: `tests/runtime-codex-operations.mjs` and `tests/runtime-codex-recovery-inspect.mjs`, 44 focused tests passed. Structural validation does not authenticate journal contents or authorize recovery/sleep.
- [x] Malformed operation inventory containers/child owners fail heartbeat projection without changing the journal or Worker operations/lease. Evidence: 200 malformed root/child combinations in `tests/runtime-codex-operations.mjs` plus SQLite rejection/preservation checks. Absent fields still support legacy journals; full native coverage and recovery remain open.
- [x] Interrupted spawn invocation state agrees across adapter, heartbeat projection and offline inspection without settling receiver startup/child work. Evidence: pinned 0.154.0 generated `CollabAgentToolCallStatus`, root/nested operation and recovery fixtures. This is not live interrupted-spawn or recursive termination acceptance.
- [x] Worker heartbeat enforces operation start ≤ deadline ≤ admitted attempt deadline and progress ≥ start, after UTC normalization. Evidence: `tests/lifecycle.test.ts`, atomic page/lease rollback, +1ms hard-limit rejection and exact/late-progress boundaries. Progress extensions and actual termination remain E01.
- [x] Snapshot projection/Worker timing rejection fences the running supervisor and preserves prior custody, without releasing activity or replaying work. Evidence: `tests/execution-supervisor.test.ts`, 55 focused tests; separate pre-heartbeat and Worker-rejection paths. This proves conservative refusal, not successful recovery or provider termination.
- [x] Additional owner cancels and memory purge/expiry cannot renew an already-cancelling run's 30-second grace. Evidence: `tests/recovery.test.ts`, `tests/memory-expiry.test.ts`; second events/purges retained and exact original recovery boundary verified. Native cancellation/termination acceptance remains open.
- [x] Owner cancellation preserves recovery-required state and unresolved custody while remaining a heartbeat cancellation target. Evidence: `tests/recovery.test.ts`, effect/lock/operation/attempt preservation and blocked retry/sleep. No recovery completion or native termination is inferred.
- [x] Explicit owner retry atomically removes the superseded automatic retry timer; later attempts retain their own backoff and receipt replay cannot delete a newer timer. Evidence: `tests/recovery.test.ts`, first/second-attempt asymmetric timing and exact boundaries. Full native retry/recovery acceptance remains open.
- [x] Disabled execution preserves due automatic retry custody until re-enabled or cancelled. Evidence: `tests/recovery.test.ts`, red/green repeated-reconciliation and cancellation cases. Existing Worker alarm excludes disabled retries; no provider wake or successful native recovery is inferred.
- [x] First root/child start acknowledgements enforce the admitted hard deadline while preserving observed native receipts. Evidence: `tests/lifecycle.test.ts`, `tests/orchestration.test.ts`; before/exact/after deadline, replay and cancellation-grace boundaries. Cancellation intent is not native termination proof.
- [x] New effect intent/dispatch admission checks the attempt hard deadline before watchdog reconciliation; late outcome receipts remain recordable. Evidence: `tests/effect-workflow.test.ts`, red/green exact boundaries, reconstruction and receipt preservation. Does not cancel an already dispatched external operation or authorize replay.
- [x] First effect dispatch rechecks task/ancestor state after intent creation; cancellation blocks unsent effects while late outcomes remain recordable. Evidence: `tests/effect-workflow.test.ts`, `tests/root-child-effects.test.ts`, four red/green cancellation cases with lock/sibling preservation. This does not retract already dispatched actions or prove native termination.
- [x] New shared-resource locks require an unexpired attempt; held-lock replay and release preserve existing custody semantics. Evidence: `tests/lifecycle.test.ts`, three red/green task-state cases and exact deadline boundaries. A retained lock grants no connector authority and expiry does not release unresolved effects.
- [x] Terminal owner cancellation checks previously queued follow-ups, delivering once after descendant settlement without steering unrelated work. Evidence: `tests/orchestration.test.ts`, waiting checkpoint and live-grandchild cases, plus retention fixtures. Native checkpoint/restart and full intent-aware E03 behavior remain unverified.
- [x] Five-minute non-checkpointed service question callback ceiling, private wait deadline and matching Worker answerability cap. Worker pre-handoff cutoff now persists a restart-required reason with ordinary cancellation/grace and owner explanation. Evidence: question/service/inspection tests, exact alarm, native answer/cancel fixtures, HTTPS and inspected Chromium checks. Expired custody remains unresolved; post-handoff timeout proof, checkpoint parking and safe compute release remain E01/E02.
- [x] Partial private host callback-timeout observations retain existing request/task identity and are validated by offline inspection. Exact transport timeout winner is distinguished from collateral abort; held handoff and owned-but-unrecorded work retain uncertainty. Evidence: deterministic binding/transport tests, real FileJournal handoff persistence and inspector tests; runtime620 and focused85/typecheck pass. Missing evidence does not prove no timeout; no Worker mutation, native termination, answer replay or safe-resume/sleep claim.
- [x] Cold pending-question readback through supported Codex0.154.0 APIs: exact interrupted turn survives process loss; history restore recreates no question callback or answer authority and submits no inference during the observed calls/window. Evidence: extended native question fixture,18 assertions; upstream pinned-source contract in CODEX_RECOVERY.md. Live reconnect, provider containment and safe native restoration remain E02.
- [x] Unsupported live native item boundaries trigger recovery rather than silently evading operation accounting. Evidence: `tests/runtime-codex-events.mjs`; complete supported coverage remains E01, and recovery does not prove native termination.
- [x] Content-free plan-item lifetime/deadline projection and offline inspection, plus actual root Plan emission, unchanged clocks across native text deltas and accepted active Worker heartbeat under scripted loopback inference. Evidence: `scripts/test-codex-service.sh --plan` and synthetic event/operation/recovery fixtures. Native child Plan emission, held-stream expiry, rendering and full operation coverage remain E01/E04.

## Remaining implementation and acceptance

Order is dependency-oriented, not a promise to complete an external gate before independent local work.

| Done | ID / status | Remaining deliverable and exit evidence | External boundary |
| --- | --- | --- | --- |
| [ ] | **E01 — Partial; next** | Five-minute reasoning-item/initial-response/post-tool/post-message quiet and two-minute acknowledged-child startup bounds pass native/service fixtures; SQLite verifies exact watchdog expiry. Explicit host-declared clocked shell windows up to ten minutes now pass parent service/operation96 and SQLite10 tests, capped by attempt deadlines; grants and other operations are unchanged. Remaining: unknown-item and streaming coverage, human-wait interactions, unclocked legacy records, transfer windows, progress-extension policy, recursive child/tool/transfer/node/flush coverage. Test exact cancellation, bounded retries and no sleep with any unsettled obligation; remove unknown-coverage blockers only with supported evidence. | Local/native fixtures first; actual provider termination and hardware operations separately. |
| [ ] | **E02 — Partial** | Offline clock diagnostics, post-await drain fencing and detached non-replayable checkpoint intent are verified locally; none authorizes resume. Complete safe service assembly, drain, warm/cold restart and crash recovery; retain one executor, task identity, questions, effects and locks. Four real subprocess-kill claim/submission boundaries preserve FileJournal custody without replay; simulated transport is not native/process takeover acceptance. 200 in-process SQLite drain/effect sequences also pass. Native cold readback now recovers a missed exact-child interruption without cancellation replay or sleep permission, alongside existing root-output/command readback; graceful restart is not crash takeover. Interrupted approvals, restored checkpoints and full native/provider service recovery remain open. | Selected Sprite lifecycle and authenticated native continuity require authorized live tests. |
| [ ] | **E03 — Partial** | Keep coordinator responsive during background work; resolve status/new-task/ambiguous-steer/deferred-follow-up intent; independent admission, saturation and exact cancellation. Pass O01–O09, including two-task isolation and managed refresh ownership. | Synthetic routing/concurrency work now; model judgment and refresh require account access. |
| [ ] | **E04 — Partial** | Finish quiet streaming/reconnect, approvals and attention, conversation search, attachments/previews/downloads, replies/reactions, stable references/mentions, read/unread, notification preferences and appearance. Verify desktop/mobile/keyboard/accessibility, stale/offline states and cross-bot isolation. | Most UI work is credential-free; push permissions/delivery and some device checks are external. |
| [ ] | **E05 — Partial** | Complete teach-from-correction skill authoring, update-before-duplicate, review/diff/rollback, supporting-file policy and safe tests. Complete natural-language routine lifecycle, preflight, run history and execution-versus-delivery failure handling; evaluate the 20-enabled-routine cap with load/cost evidence. | Local contracts/UI first; actual model use and connector effects later. |
| [ ] | **E06 — Partial** | Ordinary service complete-or-block budgets pass integrated verification: global ≤4,000 and scoped ≤8,000 tokens, with exact prepared-byte receipts and reviewed model mappings. Stable literal relevance/ID ordering is verified; no silent constraint truncation. Indexed exact-scope preparation reads avoid full scans/sorts in Node and local workerd; ≤195 returned rows and ≤65 parsed bodies. Owner summaries project only with persona permission and host retrieval support, with disclosed exact source pointers and cumulative-budget reads; constraints stay verbatim. Read ledgers now have90-day settled-history cleanup in100-key batches; unresolved custody stays. Index construction, stored data, cleanup scans and unlimited legacy enqueue snapshots remain unbounded. Finish bounded attributed bot/group communication (SPEC §9.3); verify native transcript/search/filesystem scope isolation, private facts excluded from shared procedures, zero-inference/wake publication, and closed-client discussion continuity. | Context packaging, isolation and zero-call fixtures are credential-free; summary fidelity, model judgment and authenticated native retrieval validation later. |
| [ ] | **E07 — Unverified** | Complete remote browser/computer tool integration, authenticated view-only/control separation, locks, safe credential handoff, stale-frame rejection and reconnect. Exercise synthetic multistep forms, files/uploads/downloads and uncertain mutations without replay. | Linux fixtures now; personal browser accounts and real Mac permissions later. |
| [ ] | **E08 — Not implemented** | Opt-in visible demonstration capture → reviewed skill → safe test, excluding microphone audio/secrets and never treating captured actions as authorization. | Credential-free synthetic demonstration possible; real device capture needs hardware. |
| [ ] | **E09 — Partial** | Connector readiness catalog: distinguish advertised, installed, callable and individually authorized operations; named gaps and per-tool restrictions. Add curated discovery/install/enable/disable and packaged-skill workflows through supported surfaces; catalog metadata alone is insufficient and production app-server plugin installation remains unsupported (UX14). Complete migration workflows, provenance/watermarks/dedupe, flight hold/restore, no-send rules and scoped traveler handling. | Catalog/policy/install fixtures now; actual Google/WhatsApp/Messages/traveler data, supported account installation and adopted mappings are external. |
| [ ] | **E10 — Partial** | Coordinated application/native/browser/config backup, off-host/key custody, remaining journal/payload retention, restore admission and a clean second-installation drill. Add owner-configurable retention with cost preview, 24-hour opt-in diagnostic expiry, and explicit indexed-copy/eligible-transcript cleanup for “forget everywhere”; verify canonical purge ≤24h and backup expiry ≤28d without claiming third-party deletion (SPEC §§2/10). Preserve unknown effects, reauthorize accounts, disclose native-state omissions and prove one stopped old executor before activation. | Offline cleanup/restore fixtures now; native deletion requires supported interfaces, hosted export/off-host storage/live shutdown require access and approval. |
| [ ] | **E11 — Partial** | Native root/child token snapshots persist in offline diagnostics, publish through fenced Worker state/task readback and display as current-attempt observations; these are not additive spend or freshness proof. Remaining: per-task usage/overhead, historical reliability and connector/backup freshness; idle client/history/reconnect must cause zero wake/inference. Produce seven-day all-in infrastructure cost and matched-workload model-overhead measurements. Unknown usage is not zero. | Instrumentation now; actual billing, quota and seven-day provider evidence later. |
| [ ] | **E12 — Partial source; Mac acceptance unverified** | Independent SwiftUI + WKWebView source and Linux-executed origin/navigation policy tests now exist. Still build/render and verify exact-origin/login allowlists, per-portal storage isolation, revoked-login handling, permission denial/no remote-page OS access and closed-client task continuity on macOS. Verify packaging, signing/notarization, notifications/updater and actual idle CPU/memory/energy. Do not replace the remote runtime with a local agent. | Five Node source/script checks and four Swift XCTest methods pass; actual Apple frameworks, sandbox/signing and hardware acceptance require a Mac and appropriate authorization. |
| [ ] | **E13 — Partial** | Reproducible clean second installation, interrupted setup/upgrade, config preservation and rollback; capability readiness states and supported sign-in. Implement explicit idle adapter/version/provider migration preserving application IDs and unknown effects/locks; active work remains pinned, missing capabilities reject before execution. Current provider-ref mismatch refuses startup, not a completed switch workflow (UX15). Audit reused source/dependencies/assets/notices; maintain source-dated parity inventory, including named specialized connector/team/payment/mobile-native gaps rather than silently promising them. | Most setup/switch/audit work is local; candidate compatibility, account eligibility and live sign-in require their own evidence. No second harness is selected by this checklist. |
| [ ] | **E14 — Unverified** | Cloudflare deployment/Access, selected-provider end-to-end acceptance, canary, restore/cost evidence and release checklist. Close applicable S/O/UX/R gates before enabling production. | Requires explicit deployment/release authorization plus accounts; passing local tests alone cannot authorize it. |
| [ ] | **E15 — Partial: numeric acceptance and privacy matrix** | Preserve SPEC §11 targets: p95 receipt ≤1s at 5 writes/s for 10min; 30 cold wakes p95≤60s/max120s; schedule admission p95≤90s; 99.5% monthly intake; 100 crash/restart receipt-loss injections; 100 randomized full drain/effect races; 1,000 passive publications with zero inference/wake; mobile LCP≤2.5s/INP≤200ms/JS≤250KiB gzip; wrong-owner endpoint/secret-canary matrix; Chrome/Safari current and prior majors; backup RPO≤24h/restore≤60min. Local no-op volume and 200 seeded SQLite effect/drain sequences now pass; see docs/DRAIN_EFFECT_RACES.md for independent invariants, mutation detection and limits. Object reconstruction does not prove process-crash/disk-reopen or full live drain acceptance. Clarify load workload versus the required 60 owner writes/min rate limit; do not disable it to claim throughput. | Local harnesses, synthetic privacy/load/crash tests and Chromium measurements can proceed. Staging no-op trace, deployment latency/availability, real cold wakes, Safari/device and backup operational measurements remain external. |

## Owner/account/device actions — not needed for the next local task

Do not perform these implicitly. [AUTH_SETUP.md](docs/AUTH_SETUP.md) contains detailed setup steps.

**E09 selected WhatsApp integration:** owner-selected `wappmcp` 0.4.0 at
`9a0a39e61b2271df1a1d7fc1e198f1e37f66aaf8` is now specified in SPEC.md. A diagnostic
catalog and explicit private prepare-only installer exist; guided activation and
live inventory remain unimplemented. An unregistered scoped read boundary now has synthetic
contract and cancellation/timeout tests. Host-only canonical UTC `deadlineAt`
can cap the relative timeout. Worker task-grant/lease/revocation authority is now
implemented and HTTPS-tested; the unregistered `createWappMcpReader` now binds
captured custody/deadlines and Worker checks to an already connected SDK client.
Trusted connection startup, inventory and production registration remain absent.
The journaled read assembly
records pre-dispatch intent and observed responses and exposes retained unknown
invocations through operation snapshots. Browser/process termination, actual MCP
registration and transport recovery remain unimplemented.
- [ ] **Recent-read SDK compatibility blocker:** pinned `createJsonResult` puts `Message[]` directly in `structuredContent`; actual SDK 1.30.0 requires an object. The five-mode in-memory fixture reproduces rejection, proves object-shaped scoped search, and confirms abort/timeout/close do not await server work. `node scripts/verify-wappmcp.mjs` now reports `syntheticCompatibility:false`. A supported upstream fix/version requires review and reruns; any additional patch needs separate owner approval. This is a credential-free compatibility blocker, not missing login.

The owner approved only the pinned upstream 1.34.7 patch; AGENTS.md and SPEC.md
now contain that exception. `scripts/verify-wappmcp.mjs` pins both tarball hashes
and source patch hash, verifies clean application in disposable storage and executes
actual patched normalization/last-message functions with synthetic models.
A disposable installation now passes with lifecycle scripts disabled and the exact
approved patch applied explicitly; no browser or connector was started. The pinned
350-package graph is in `config/wappmcp/`. License metadata includes LGPL-3.0-or-later
`node-webpmux`, Public Domain `jsonify` and two missing declarations; full source,
asset and notice audit remains open, not a permissive-license approval.
Optional host `authorize` checks before/after reads are bounded and redacted.
New snapshots capture exact operator-selected chat/tool policies; legacy snapshots
without scopes deny. The operator registry defaults empty. Fresh installed-tree
inspection, guided startup and license review remain credential-free work.
Pairing, reconnect/history coverage and sleep/cost measurements require separate
live authorization. Notification allowlists are not tool permissions; mutations
must remain unavailable by default. Source findings are in docs/IMPLEMENTATION.md.

- [ ] **Codex:** supported owner login on the executing runtime, then bounded subscription inference, eligibility/quota/no-paid-fallback, restart and later refresh tests. Do not copy auth caches.
- [ ] **Sprites/Cloudflare:** authorize the concrete deployment/lifecycle test and establish appropriate runtime/Access configuration. Existing Sprite status/token availability is not blanket authorization to wake, deploy or mutate it.
- [ ] **Budget evidence:** obtain actual billing/usage/credits and enforce an agreed limit where supported. The $10 testing instruction is not a verified provider-enforced cap; approximately $5/month is a target, not a measured result.
- [ ] **Google:** authorize exact account/calendar/mail scopes; separately verify reads, labels and calendar create/update/cancel/reminders. Calendar lookup does not prove writes; imported routines do not authorize mail sending or invitations.
- [ ] **WhatsApp:** pair the selected session/chat and run the 5-minute/1-hour/24-hour/72-hour catch-up matrix with known messages, reporting missing/duplicate coverage and auth survival separately.
- [ ] **Mac:** supply a macOS execution/device boundary for Swift client checks and explicit browser/Accessibility/screen/Files/Messages permissions as needed; separately verify offline waiting and reconnection.
- [ ] **Routine adoption:** review account/chat/calendar mappings, scopes and next runs for the five personas/seven routines. Resolve Singapore monitoring-zone adoption explicitly; installation default remains Jakarta. Imports stay disabled until authorized.
- [ ] **Release:** authorize publication/deployment/signing or distribution at the appropriate gate. No push or deploy is implied by maintaining this checklist.

## Acceptance coverage index

Every acceptance family is assigned below; assignment is **not a pass**. Consult the linked normative source for the complete distinguishing tests. Optional S28 is not a core release blocker. No family is declared fully accepted in this review.

| Acceptance IDs | Owning TODOs / remaining proof |
| --- | --- |
| S01–S08 | E01/E02/E14: durable intake and lease fixtures exist; full live wake/drain/stop/race proof remains. |
| S09–S13 | E03/E04/E06: scoped context and passive-update foundations exist; complete native isolation/collaboration acceptance remains. |
| S14–S18 | E05/E09: schedule/occurrence/DST fixtures exist; natural-language and adopted real workflow acceptance remains. |
| S19–S21 | E01/E02: timeout/uncertainty/question foundations exist; complete settlement and safe resumed approval remain. |
| S22–S24 | E02/E13/E14: local auth/ingress/watchdog fixtures exist; live model auth/quota and hosted recovery remain. |
| S25–S27 | E09/E10/E11: budget and local backup foundations exist; real costs, coordinated restore and WhatsApp matrix remain. |
| S28 (optional), S29 | E07/E10/E12/E13: reviewed imports exist; proprietary exporter optional, actual Mac acceptance pending. |
| S30–S32 | E02/E06/E14: retention gaps, input bounds and conservative ambiguity fixtures exist; complete native recovery acceptance remains. |
| O01–O06 | E01/E03/E06/E07: responsiveness, exact intent, concurrent resource isolation and saturation. |
| O07–O09 | E01/E02/E03: crash continuity, complete activity-based holds and managed refresh race. |
| UX01–UX05 | E02/E03/E04/E12: conversation continuity, minimal profiles/roster, truthful chat and task controls. |
| UX06–UX07 | E05/E06: routine experience and attributed bounded collaboration. |
| UX08–UX10 | E07/E11/E13: computer handoff, repeatable setup and measured model overhead. |
| UX11–UX12 | E05: full conversational skill/routine lifecycle and real safe tests. |
| UX13–UX15 | E03/E04/E06/E08/E09/E10/E13: interaction/knowledge parity, teaching/integrations/portable state and replaceable supported execution. |
| R01–R02 | E04/E12: secure Mac shell and exact reconnect/partial/final behavior. |
| R03–R04 | E07/E13: supported sign-in and exclusive device control. |
| R05–R06 | E01/E02/E10/E13: sleeping single authority, clean licensed build/import and second installation. |
| R07–R08 | E03/E05/E11/E14: actual idle economics and integrated skill/routine/effect/steering acceptance. |
| SPEC §§9.3/10 | E06/E10/E13: selected-tokenizer context budgets, summaries, native isolation, retention/deletion and explicit state migration. |
| SPEC §11 | E15 with E01/E02/E04/E10/E11/E14: numeric reliability/performance/privacy targets; local fixtures and external measurements are separate evidence. |

Historical design milestones remain in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). They are not a second live checklist. If a new gap does not fit a row, add a scoped row with its source requirement, evidence and exit condition rather than silently dropping it.
