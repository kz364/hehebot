# Hehebot progress and TODO

**Last reviewed: 2026-09-15 (Asia/Jakarta). Not operational; production gates remain false.**
This is the owner-facing progress checklist. Open this file to check progress without asking in chat.
It describes this checkout; local checkpoints are not necessarily published to GitHub.

## Current checkpoint

- **Latest implementation:** [child initial-response deadlines](docs/CODEX_SERVICE.md), 2026-09-15. Local, not pushed. Each newly observed child start retains an independent five-minute initial phase; root completion and replay cannot end or extend it. E01 remains partial.
- **Verified:** focused runtime checks: **87 passed**; Worker checks: **4 passed**, including cancellation exactly five minutes after child start. Native child fixtures observed the phase while withholding the first response, then verified completion without task/effect settlement. Two stale fixture expectations for new metadata/operation counts were corrected and rerun.
- **Combined:** final `bash scripts/verify-codex.sh` passed **879 control / 192 runtime tests**, all native/service fixtures, typecheck and build dry run. Native child service heartbeats contain seven operations, including unknown coverage.
- **Evidence boundary:** scripted model/provider responses, pristine Codex 0.154.0 and local Worker/SQLite are not authenticated model judgment, complete native settlement, real provider sleep or production acceptance.
- **Next implementation priority:** E01, complete deadline/activity accounting; then E02 recovery and E03 responsive orchestration. These are queued, not claims that an agent is currently running them.
- **Owner action needed now:** none for the next credential-free work. External acceptance actions are listed separately below; no credentials should be pasted into this file or chat.
- **Mac direction:** SwiftUI + WKWebView native shell around the remote portal, as communicated by the owner-decision thread. Not implemented. Existing Electron code is a tested foundation, not a verified Mac release. The separate Mac-decision documentation edits have not been integrated into this checkout.

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

- [x] Durable owner command ingress, idempotent receipts, revisions, scoped context, occurrences, effects and resource locks. Evidence: [implementation](docs/IMPLEMENTATION.md), control/Worker tests.
- [x] Lease/epoch fencing, conservative cancellation/recovery, exact submission-ack replay and complete bounded heartbeat paging. Evidence: [service](docs/CODEX_SERVICE.md), [handoff](docs/HANDOFF.md).
- [x] Host-observed tool/spawn and reasoning-item phase clocks, initial root/child-response deadlines, canonical heartbeat timestamps and immutable replay custody. Reasoning content is excluded from the host journal. Later quiet gaps, pre-notification child startup, progress extensions and complete operation coverage remain E01.
- [x] Native-question custody, explicit owner answers, uncertain one-shot handoff and stopped-question closure; default-off disposable runtime integration. Evidence: [custody](docs/NATIVE_QUESTION_CUSTODY.md), [binding](docs/CODEX_QUESTION_BINDING.md).
- [x] Exact-task steering, deferred follow-ups and attributed provisional output through local Worker/native fixtures. Intent resolution and responsive independent admission remain E03. Evidence: [steering](docs/CODEX_STEERING.md), [service](docs/CODEX_SERVICE.md).
- [x] Portal profiles, roster sections/hiding/search, task/recovery pagination, schedule picker/preview, question cards and monitoring views with focused browser checks. Full UX acceptance remains E04. Evidence: [implementation](docs/IMPLEMENTATION.md), [roster](docs/ROSTER.md).
- [x] Managed skill and routine command foundations, scoped memory and passive context updates, bounded timeline/payload retention. Full conversational acceptance remains E05/E06. Evidence: [implementation](docs/IMPLEMENTATION.md).
- [x] Offline SQLite snapshots, pinned-age encryption, cooperative creation and explicit digest-reviewed pruning. Evidence: [creation](docs/CONTROL_BACKUP_CREATION.md), [pruning](docs/CONTROL_BACKUP_PRUNING.md). Not coordinated disaster recovery.
- [x] Application logical export/reconstruction, selected authority-stripped templates and offline restore inspection including question custody. Evidence: [export/import](docs/CONTROL_EXPORT_IMPORT.md), [templates](docs/PORTABLE_TEMPLATES.md), [inspection](docs/CONTROL_RESTORE_INSPECTION.md).
- [x] Optional-routine budget admission and content-free monitoring projections. Evidence: [budget](docs/BUDGET.md), [implementation](docs/IMPLEMENTATION.md). Not actual billing or an enforced provider spending cap.

## Remaining implementation and acceptance

Order is dependency-oriented, not a promise to complete an external gate before independent local work.

| Done | ID / status | Remaining deliverable and exit evidence | External boundary |
| --- | --- | --- | --- |
| [ ] | **E01 — Partial; next** | Five-minute reasoning-item and initial root/child-response bounds pass native/service fixtures. Remaining: later model/tool quiet gaps, child startup before native start notification, explicit longer shell/transfer windows, progress-extension policy, recursive child/tool/transfer/node/flush coverage. Test exact cancellation, bounded retries and no sleep with any unsettled obligation; remove unknown-coverage blockers only with supported evidence. | Local/native fixtures first; actual provider termination and hardware operations separately. |
| [ ] | **E02 — Partial** | Complete safe service assembly, drain, warm/cold restart and crash recovery; retain one executor, task identity, questions, effects and locks. Test submission/mapping crashes, interrupted approvals, restored checkpoints and 100 randomized drain interleavings without duplicate effects. Conservative refusal is implemented, successful recovery is not proved. | Selected Sprite lifecycle and authenticated native continuity require authorized live tests. |
| [ ] | **E03 — Partial** | Keep coordinator responsive during background work; resolve status/new-task/ambiguous-steer/deferred-follow-up intent; independent admission, saturation and exact cancellation. Pass O01–O09, including two-task isolation and managed refresh ownership. | Synthetic routing/concurrency work now; model judgment and refresh require account access. |
| [ ] | **E04 — Partial** | Finish quiet streaming/reconnect, approvals and attention, conversation search, attachments/previews/downloads, replies/reactions, stable references/mentions, read/unread, notification preferences and appearance. Verify desktop/mobile/keyboard/accessibility, stale/offline states and cross-bot isolation. | Most UI work is credential-free; push permissions/delivery and some device checks are external. |
| [ ] | **E05 — Partial** | Complete teach-from-correction skill authoring, update-before-duplicate, review/diff/rollback, supporting-file policy and safe tests. Complete natural-language routine lifecycle, preflight, run history and execution-versus-delivery failure handling; evaluate the 20-enabled-routine cap with load/cost evidence. | Local contracts/UI first; actual model use and connector effects later. |
| [ ] | **E06 — Partial** | Finish scoped memory inspection/search/correction/deletion and bounded attributed bot/group communication. Verify private facts stay out of shared procedures, passive publication causes zero inference/wake, and closing clients does not stop discussion. | Local isolation/zero-call fixtures now; natural-language behavior later. |
| [ ] | **E07 — Unverified** | Complete remote browser/computer tool integration, authenticated view-only/control separation, locks, safe credential handoff, stale-frame rejection and reconnect. Exercise synthetic multistep forms, files/uploads/downloads and uncertain mutations without replay. | Linux fixtures now; personal browser accounts and real Mac permissions later. |
| [ ] | **E08 — Not implemented** | Opt-in visible demonstration capture → reviewed skill → safe test, excluding microphone audio/secrets and never treating captured actions as authorization. | Credential-free synthetic demonstration possible; real device capture needs hardware. |
| [ ] | **E09 — Partial** | Connector readiness catalog: distinguish advertised, installed, callable and individually authorized operations; named gaps and per-tool restrictions. Complete migration workflows, provenance/watermarks/dedupe, flight hold/restore, no-send rules and scoped traveler handling. | Synthetic fixtures now; Google/WhatsApp/Messages/traveler data and adopted mappings are external. |
| [ ] | **E10 — Partial** | Coordinated application/native/browser/config backup, off-host/key custody, remaining journal/payload retention, restore admission and a clean second-installation drill. Preserve unknown effects, reauthorize accounts, disclose native-state omissions and prove one stopped old executor before activation. | Offline tests now; hosted export, off-host storage and live shutdown require access/approval. |
| [ ] | **E11 — Partial** | Add available per-task model usage/overhead, historical reliability and connector/backup freshness evidence; idle client/history/reconnect must cause zero wake/inference. Produce seven-day all-in infrastructure cost and matched-workload model-overhead measurements. Unknown usage is not zero. | Instrumentation now; actual billing, quota and seven-day provider evidence later. |
| [ ] | **E12 — Not implemented** | Build selected SwiftUI + WKWebView shell with exact-origin/login allowlists, per-portal storage isolation, revoked-login handling, no remote-page OS access and closed-client task continuity. Verify packaging, signing/notarization, notifications/updater and actual idle CPU/memory/energy. Do not replace the remote runtime with a local agent. | Source/protocol work can proceed; build/render/hardware checks require macOS, distribution requires authorization. |
| [ ] | **E13 — Partial** | Reproducible clean second installation, interrupted setup/upgrade, config preservation and rollback; capability readiness states and supported sign-in. Audit any reused source/dependencies/assets/notices before import; maintain source-dated parity inventory and explicit product differences. | Most setup/audit work is local; distribution/account eligibility and live sign-in need external evidence. |
| [ ] | **E14 — Unverified** | Cloudflare deployment/Access, selected-provider end-to-end acceptance, canary, restore/cost evidence and release checklist. Close applicable S/O/UX/R gates before enabling production. | Requires explicit deployment/release authorization plus accounts; passing local tests alone cannot authorize it. |

## Owner/account/device actions — not needed for the next local task

Do not perform these implicitly. [AUTH_SETUP.md](docs/AUTH_SETUP.md) contains detailed setup steps.

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

Historical design milestones remain in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). They are not a second live checklist. If a new gap does not fit a row, add a scoped row with its source requirement, evidence and exit condition rather than silently dropping it.
