# Sleeping personal assistant — implementation specification

Status: consolidated implementation target with local work in progress. Version 0.5, 2026-09-13. See docs/IMPLEMENTATION.md for implemented scope and unpassed gates. No deployment, credentials, runtime configuration, or production schedules are created by this document. Normative contracts below describe the intended system; evidence appendices describe what has actually been inspected.

The full specification includes this document and the normative [project intent](docs/PROJECT_INTENT.md), [bot orchestration contract](docs/BOT_ORCHESTRATION_ADDENDUM.md), and [complete bot/routine instructions](docs/BOT_ROUTINE_INSTRUCTIONS.md). Explicit later user choices take precedence over historical assumptions. Sprites is the selected initial provider. Earlier references to a “Machine” mean the single persistent runtime; Fly-specific stop APIs are portability examples. For Sprites, the selected-provider hibernation semantics below take precedence: clean drain permits provider-managed idle and does not prove termination. Private profile values are configuration, not omitted behavior. See [publication snapshot](docs/PUBLICATION.md) for validation and exclusions.

**Start with section 21 for the consolidated product, Apache-reuse and low-cost execution contract.** It incorporates all UX01–UX15 requirements in [PRODUCT_UX_SPEC.md](PRODUCT_UX_SPEC.md) as normative detail. Sections 1–20 retain storage, lifecycle, authorization and acceptance contracts. [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) maps requirements to delivery work.

Direct Codex app-server **0.154.0** is the only supported harness. Preserve the external control plane, sleeping-container architecture, scoped policies and all settlement gates. Use supported Codex interfaces without a new tool loop; selection is not proof of production compatibility or permission to deploy/connect accounts.

For Gmail/Google Calendar, prefer Codex's supported plugin/app integrations and verify per-account headless tool availability. [Codex plugins](https://developers.openai.com/codex/plugins) explicitly documents Gmail; [Google Calendar](https://openai.com/business/plugins/google-calendar/) advertises event/availability lookup, not proof of required event mutations. Acceptance must separately demonstrate mail reads, authorized label changes, calendar reads/create/update/cancel, exact calendar selection, reminders/timezones, pagination and effect receipts; sending mail remains outside imported routine authority. Missing capabilities stay visible and block only affected workflows, rather than silently adding broad Google scopes or a paid connector.

The [app-server contract](https://developers.openai.com/codex/app-server) documents `app/list`, `app/installed` and `mcpServerStatus/list` for discovery/runtime status; enabled is distinct from callable. Verify supported methods against the pinned CLI schema before use. Its `plugin/install` and `plugin/uninstall` are currently under development with an explicit warning against production clients: use documented supported setup surfaces instead. Prefer native managed `account/login/start` with `chatgptDeviceCode` when supported by the pin, rather than copying a CLI-output parser unnecessarily; Codex owns persistence/refresh. Google authorization remains separate from model login. None of these documentation observations proves this installation has connected Google accounts or that its tools work after sleep/restart.

## 1. Intent Brief

Build a personal assistant with a dedicated messaging portal, named bots with distinct responsibilities, shared and scoped memory, natural-language routines, and bounded bot collaboration. Run one persistent Codex execution runtime only when it has work. An external control plane accepts messages and schedules while execution sleeps, then wakes the same instance and state.

The user should think “ask Travel” or “run the morning briefing,” without managing threads, runtimes, or session keys. Bots are personas in one runtime, not separate VMs. Separate native agent contexts are recommended: they prevent instruction and history contamination at negligible infrastructure cost compared with a second instance. One shared transcript with changing system prompts is rejected for v1 because responsibility, retrieval and permissions become ambiguous.

Each persona coordinates its own isolated background task contexts while remaining available for conversation; ordinary messages do not implicitly steer or cancel active tasks. There is no required intermediate layer of persistent worker agents. Personas and tasks share one installation-owned Codex login and configured tool accounts, with capabilities enforced per persona/task rather than granted by shared authentication. See the [agent model diagram and explainer](docs/AGENT_MODEL.md) for roles, message-routing examples, account boundaries, and unverified gates; the [orchestration contract](docs/BOT_ORCHESTRATION_ADDENDUM.md) defines acceptance.

Provided constraints: approximately $5/month infrastructure target through transient compute; dedicated chat rather than WhatsApp as the wake channel; scheduled and event wake; no sleeping during inference or tools; stuck detection and cancellation/retry; OpenAI subscription OAuth. Codex desktop computer use and Grok export are optional. Implementation is now authorized locally; live deployment and inference remain gated.

Non-goals: multi-user SaaS, a new general-purpose agent orchestration framework, always-on WhatsApp connectivity, guaranteed recovery of every missed WhatsApp message, multiple active copies of the runtime, autonomous spending or sending beyond user authorization, or complete replication of Grok's internals.

Stakeholder: one owner using desktop/mobile browsers and an optional paired Mac. Tradeoffs: cold-start delay and recovery downtime are accepted for lower cost; external orchestration adds a small service but is necessary to wake a stopped runtime; application metadata must have one canonical writer; browser side effects cannot be made exactly-once merely with queue deduplication.

## 2. Assumptions & Defaults

- **Mode:** API/backend plus portal UI and optional CLI. Rationale: lifecycle correctness depends on durable contracts. Override: a different front end may reuse the same command API.
- **Topology:** Cloudflare Worker + one SQLite Durable Object per installation; one persistent runtime selected through a provider adapter; Node 24 and Codex app-server 0.154.0. Rationale: external acceptance/alarms with resumable state and no always-on agent host.
- **Owner login:** one allowlisted owner through Cloudflare Access; verify issuer, audience, signature and subject on every request. Rationale: avoid building account management. Override: another OIDC provider with equivalent checks; never trust an unsigned identity header.
- **Personas:** start with Chief of Staff, Inbox Triage, Whatsapp, Messages, and Travel; enable only configured connectors. Rationale: a small useful set illustrates Grok-like responsibilities without pre-authorizing tasks. Override: owner can create/rename/archive bots and edit instructions.
- **Conversation:** one visible timeline per bot, plus optional rooms; native task sessions hidden. Rationale: remove thread management while keeping tasks isolated. Override: developer diagnostics can expose native IDs; no required user thread workflow.
- **Memory:** canonical application records for global/persona/routine/skill memory; Codex thread state is executor-private. An adapter may use native storage only if equivalent revisions, scopes and deletion are demonstrated.
- **Time:** IANA `Asia/Jakarta`; timestamps UTC RFC3339 with milliseconds; UUIDv4 object IDs. Rationale: current owner timezone and unambiguous persistence. Override: installation timezone and individual schedule timezone, each versioned.
- **Compute:** native main capacity 1 plus subagent capacity 1 is the initial candidate: a reserved interactive coordinator lane and at most one background model turn. Native configuration owns dispatch; do not serialize entire turns for OAuth. Idle grace remains 60 seconds. O01–O09 must prove responsiveness, complete activity, exact cancellation and managed refresh before enabling. [BOT_ORCHESTRATION_ADDENDUM.md](docs/BOT_ORCHESTRATION_ADDENDUM.md) is normative and supersedes earlier single-run assumptions.
- **Routine policies:** overlap `queue_one`, misfire `coalesce` within 24 hours, otherwise `skip`; minimum interval 15 minutes; maximum 20 enabled routines. Rationale: bounded catch-up and wake cost. Override: owner can explicitly select skip or replay up to 3 occurrences, interval down to 5 minutes after cost preview.
- **Authentication:** Codex-owned supported ChatGPT login; no API-key fallback. Account/model availability, restart continuity and refresh must be verified in the executing environment.
- **Retention:** messages/results 90 days, audit 30 days, derived context 30 days; durable memory until deleted/expired; backups 7 daily + 4 weekly. Rationale: bounded storage while retaining useful context. Override: owner retention settings; extra storage is included in the cost preview.
- **Cost:** $5/month infrastructure target, excluding the existing ChatGPT subscription; free control-plane tier assumed. Rationale: user's stated target. Override: an explicitly revised budget or documented already-paid shared plan.

## 3. Open Questions (Short)

The runtime choice is settled: direct Codex app-server 0.154.0 only. The following are implementation or rollout gates, not claims of verified compatibility.

The expanded product target is work-domain-neutral Grok Bot UX/capability parity with replaceable model/harness execution. UX11–UX15 explicitly require managed skill authoring, full conversational routine lifecycle, interaction/knowledge parity, teaching/templates and portable application state. These additions supersede earlier optional-capability omissions for the full product target, but do not claim implementation or change current limits. The 20-enabled-routine cap remains a capacity gap to evaluate, not an owner-requested permanent restriction. Existing S/O acceptance remains necessary but is not sufficient to claim complete product parity.

1. **[BLOCKER for production sleep]** Does the pinned native Codex runtime expose complete admission, cancellation, child/tool and terminal lifecycle coverage? Default: fail closed on sleep and keep production schedules disabled until the adapter tests pass; do not deploy always-on as an unnoticed workaround.
2. **[BLOCKER for production inference]** Does the owner's subscription support the selected model and Codex-managed authentication across restart/refresh? No paid fallback; block affected jobs with `AUTH_REQUIRED` if unsupported.
3. **[NON-BLOCKER]** What WhatsApp catch-up completeness is needed? Default: best-effort historical retrieval with visible last-sync age; no routine may claim complete coverage until the cold-start matrix passes.
4. **[NON-BLOCKER]** Which external events should wake the system? Default: signed generic webhook and portal messages, plus schedules; individual email/calendar subscriptions are later connector configuration, not arbitrary polling.
5. **[NON-BLOCKER]** What measured Sprites CPU/memory/storage footprint meets the budget? Default: Sprites is selected; benchmark actual use and wake overhead before enabling monitoring. Fly Machines sizing is a portability comparison only.
6. **[RESOLVED for initial migration]** The owner supplied a Grok markdown export. Use the reviewed adapted five-bot/seven-routine import. Automated extraction remains optional and is not required for setup.

## 4. Glossary & Definitions

**MUST/MUST NOT** are acceptance requirements; **SHOULD** allows a documented exception. **Bot/persona** maps to one native agent ID and distinct agent directory. **Conversation** is a visible bot or room timeline. **Session** is hidden native model context. **Routine** is versioned instructions, schedule/trigger and execution policy. **Skill** is reviewed reusable procedure/tool guidance, not a schedule. **Run** is one logical requested execution; **attempt** is one bounded execution of that run. **Occurrence** is one nominal schedule tick. **Operation** is live inference, tool, subprocess, transfer, checkpoint or node work. **Epoch** fences stale executor messages. **Checkpoint** is a durable restartable continuation, not saved arbitrary process memory. **Effect** is an externally visible mutation with an intent and receipt ledger. **No-op/context update** changes durable data with zero model calls and zero wake requests. **Accepted** means durably queued, not completed.

## 5. Current Behavior vs Desired Behavior

Current project: local control-plane and scripted Codex fixtures exist, with no cloud runtime provisioned. This is not yet a sleeping assistant deployment. Credentials were locally verified, but authenticated inference was not.

Desired: portal always accepts authenticated work; one stopped Machine resumes with the same state; native personas execute with relevant memory; routine occurrences come from the external scheduler; timelines show outcomes, waiting states and recovery actions. WhatsApp disconnects on stop and reconnects from persisted auth, without logout/unpairing.

Grok observation: its visible app has a bot sidebar, a bot conversation with grouped inter-bot activity, and a routine panel. Accessibility exposed little content and UI navigation did not establish an export mechanism. These observations support the presentation model only. Group dispatch, internal memory architecture and export availability are not verified Grok facts. Do not copy private conversation content into test fixtures.

Compatibility: preserve existing project setup instructions and local state. Reuse native agents, sessions, skills, model auth, task tracking and cancellation where verified; add a thin adapter, not a core fork. Native cron MUST NOT independently fire the same application routine.

## 6. Rules & Invariants

1. Persist and deduplicate ingress before returning 202 or requesting wake.
2. At most one active runtime may own the writable state directory. A stale lease is not proof the old process stopped; confirm provider stopped state before replacement execution.
3. Every executor claim, heartbeat, acknowledgment and completion carries `epoch` and `boot_id`; reject stale ownership. Acquire an OS lock before starting runtime.
4. A run lease begins before native submission and lasts through terminal persistence and result-outbox commit. Tool hooks alone do not constitute an activity ledger.
5. Normal sleep is forbidden while any admitted/running run, inference, tool, child, transfer, effect uncertainty requiring live reconciliation, node operation or flush remains active.
6. Passive sockets, open portal tabs and data-only updates do not count as work. A blocked job may release compute only when a durable checkpoint or explicit non-resumable failure exists.
7. Queue receipt is at-least-once; logical IDs are deduplicated. External effects are not promised exactly-once. Unknown effects must be reconciled before retry.
8. A wait timeout is not cancellation. Cancellation is requested, acknowledged, then verified terminal; UI must distinguish these states.
9. Global/persona/routine/skill scopes are enforced before retrieval. Shared process/workspace is not a security boundary; tool allowlists and application checks remain required. Memory isolation must cover native transcripts/search as well as application retrieval.
10. A `context_update` never invokes `sessions_send`, generates a bot reply, or wakes the Machine. Delivery and consumption watermarks are separate.
11. Explicit owner instructions outrank learned preferences; connector content and bot messages cannot grant tools, recipients, spending or memory access. Imported instructions remain draft until adopted.
12. Schedules are generated by one authority. Occurrence uniqueness is `(routine_id, routine_version, nominal_due_at)`; retrying an alarm must not create a new logical occurrence.
13. Run admission pins instruction revisions and memory watermarks. Routine edits affect unclaimed future work; active work keeps its snapshot unless the owner cancels it.
14. Portal login, executor identity, connector auth and model OAuth are separate credential domains; tokens never enter browser responses or model prompts.
15. No hidden paid fallback. Quota exhaustion parks jobs with reset information if available; unavailable reset time is unknown.
16. User-authorized external actions may execute within scope. Drafting or importing a routine does not authorize sending, deleting or spending; permissions are explicit routine fields.
17. Budget enforcement stops admission of optional work, not an already dispatched external mutation. Cost targets are estimates, not provider billing guarantees.
18. Every acknowledged job ends in completed, failed, cancelled, waiting, or recovery-required state with a visible reason. Silent loss is an acceptance failure.

## 7. Scope of Work

Core: authenticated responsive portal; personas and hidden session routing; scoped memory; natural-language routine authoring/editing; external schedule and signed webhook intake; 1:1 bot messages and group rooms; no-op updates; execution ledger; wake/drain/stop supervisor; watchdog; OAuth integration; persistent WhatsApp/browser state and measured reconnection; cost/status display.

Dependencies: Codex app-server 0.154.0, selected provider lifecycle/persistence, Cloudflare Worker/DO/Access, an eligible OpenAI account, and optional connector/Mac capabilities.

Optional enhancements, separately gated: Grok exporter/import preview; Codex desktop computer-use bridge. Excluded: arbitrary Grok auth/session extraction, unlimited bot debate, automatic connector enrollment, mobile native app, HA replica and API-billing setup.

## 8. Given / When / Then Scenario Suite

Each row is a mandatory automated scenario unless marked staged/manual. Fixtures use synthetic contacts and a fake effect destination.

| ID | Given | When | Then / additional assertions |
|---|---|---|---|
| S01 | Machine stopped | Owner submits message | Receipt durable before wake; one run appears and replies after ready |
| S02 | Same idempotency key | Identical request retried / different body retried | Same receipt / 409; no second run |
| S03 | Concurrent chat and due schedule | Both transactions commit | One boot; each logical job once |
| S04 | Silent inference or queued native run | Idle grace expires | Normal stop rejected; active lease visible |
| S05 | Tool, download, child, Mac call or flush active | No chat for 10 minutes | No normal sleep for every operation class |
| S06 | Empty runnable queue and zero operations | Grace expires | Drain, checkpoint, stop and provider confirmation |
| S07 | Drain in progress | New message before / after stop commit | Token invalidated and resume / durable wake-after-stop; no loss |
| S08 | Executor lease lost | Provider state unknown | No second executor; recovery status; queued work retained |
| S09 | Persona Travel | Owner switches to Inbox | Correct distinct instructions/context; authorized global preferences shared |
| S10 | Routine A private memory | Routine B requests retrieval | Excluded unless explicit shared scope; denial audited |
| S11 | Existing fact revision 2 | Owner corrects it with expected revision 2 | Revision 3 supersedes; next admitted run uses it; stale write conflicts |
| S12 | Bot B sleeping | Bot A publishes context update | Data persisted, no inference/wake; B later consumes relevant delta |
| S13 | Three-bot room | One message with no explicit recipients | One selected responder; bounded handoffs; no self/repeated causal loop |
| S14 | Natural language schedule | Owner says “weekday briefing at 8” | Timezone, next 3 times and action scope shown; unambiguous authorized read-only routine activates once |
| S15 | Ambiguous “Friday morning” | No exact time established | Draft asks for time; no scheduler row enabled |
| S16 | Duplicate alarm / missed 12 ticks | Scheduler reconciles | Unique occurrence; configured coalesce/skip/replay cap; no burst |
| S17 | DST zone | Missing / repeated local time | Skip nonexistent local time / fire once at first occurrence; vectors pin expected UTC |
| S18 | Due job awaiting claim | Routine edited / disabled | Old unclaimed version superseded / cancelled; claimed work unchanged and disclosed |
| S19 | Read-only tool exceeds phase deadline | Watchdog requests cancel | Settle or kill fenced executor; at most 2 retries with backoff |
| S20 | Send succeeded, receipt missing | Runtime crashes | Effect outcome_unknown; no blind resend; reconciliation or owner decision |
| S21 | Approval/checkpoint exists | Machine stops; owner later replies | Approval expiry/scope checked; one continuation with fresh destination state |
| S22 | OAuth expired / quota exhausted | Run admitted | AUTH_REQUIRED / QUOTA_BLOCKED; no API key fallback; other portal functions work |
| S23 | Unauthenticated / wrong subject / stale webhook | Intake attempted | 401/403/replay rejection; no stored runnable work or wake |
| S24 | Alarm retries exhausted | Next owner interaction or watchdog recovers | Queue scanned and overdue work exposed; no invented completion |
| S25 | Cost reaches cap | Optional routine due | Park budget-blocked; explicit user override can admit; current effect completes |
| S26 | Backup restored | Old executor verified stopped | One new owner; counts/revisions checked; connector/auth readiness measured |
| S27 | WhatsApp asleep 5 min, 1 h, 24 h, 72 h | Reconnect after synthetic messages | Report recovered/missing/duplicate counts and auth survival separately; manual staged test |
| S28 | Grok archive unknown schema | Export/import preview requested | Reject unsupported fields without executing instructions or creating schedules; optional |
| S29 | Paired Mac offline | Desktop-only action requested | Wait with capability reason; portal works; no fabricated computer-use success |
| S30 | Cursor older than retention | Bot next runs | Snapshot + retained deltas with history_gap marker; no inference during publication |
| S31 | Max-size message / too large / empty | Submit | 32768 UTF-8 bytes accepted / 413 / 422; idempotent validation |
| S32 | Recovery after native submission before mapping persisted | Redelivery attempted | Reconcile submission key/native ledger; ambiguous outcome parks; no second native run |

## 9. Contracts

### 9.1 Public Interfaces Overview

Portal: left sidebar of bots/rooms, central timeline, contextual routine/memory panel. Owner sends ordinary text, sees durable receipt immediately, and sees queued/waking/running/waiting/completed/failed states. Streaming is optional presentation, never the durable result. Routine status is draft/enabled/paused/error; show next execution in local timezone and UTC, last result and edit/pause/run-now actions. Memory panel shows scopes, provenance, revisions, correction and deletion.

No thread creation requirement. Bot timeline links each routine result to a collapsible run detail. Changing bots preserves unsent drafts per bot locally; do not place message bodies in URLs. Mobile below 768 px uses one pane with explicit back navigation; desktop uses two/three panes. Keyboard navigation, named controls, focus restoration after dialogs, visible focus and WCAG 2.2 AA contrast are required. Errors remain readable without color. Offline drafts are local-only until server receipt and labelled unsent.

Public API is JSON over HTTPS under `/v1`. `POST /commands` is the single mutation ingress; `GET /receipts/{id}` reports command processing; `GET /state?after=sequence&limit=100` returns owner-visible changes and installation summary. State without `after` returns an owner-visible snapshot encoded as events with current entity revisions; a cursor resumes changes after that snapshot transaction. On a history gap return HTTP 409 `HISTORY_GAP`; the next snapshot has `snapshot_required:false`. State long polling at most 25 seconds while visible, exponential backoff when offline; paused when hidden. If retained history has a gap, return snapshot-required and fetch `/state` without `after`. Signed connector route `/triggers/{source_id}` normalizes allowed events into the same ingress transaction. Verify per-source HMAC-SHA256 over timestamp, event ID and exact body with newline separators, constant-time compare, ±300-second timestamp tolerance and 90-day source/event deduplication; same event ID with changed body conflicts. A configured source allowlists event types and maps to a routine; arbitrary payload fields cannot select permissions or another owner. Owner browser mutations require same-origin Origin validation and CSRF protection in addition to a SameSite HttpOnly session; CORS disallows unrelated origins.

### 9.2 API / Function Signatures

`acceptCommand(owner, idempotencyKey, Command) -> Receipt` returns 202 after durable acceptance, including command ID, status, accepted time and resource reference once applied. Metadata commands normally finish in the transaction but retain a receipt. Same key and canonical body hash return original receipt; different hash returns conflict. Keys retained 90 days; clients cannot promise duplicate suppression after expiry. Rate limits: owner 60 writes/minute, reads 120/minute; webhook 120/minute/source. Messages <=32768 UTF-8 bytes, JSON requests <=128 KiB, page limit 1..100, UUIDs validated.

Command types and payloads (exact schemas in `SCHEMAS/contracts.json`): `message.send`, `persona.put`, `routine.put`, `memory.put`, `memory.delete`, `room.put`, `room.publish`, `run.cancel`, `run.retry`, `approval.resolve`, `run.followup`, `setup.adopt`. Updates require `expected_revision`; create uses 0. UUID is client-generated so retries target the same entity. An accepted semantic conflict appears on its receipt with the same stable error code; synchronous validation/auth errors are HTTP errors.

Runtime-only authenticated HTTPS/mTLS or equivalent short-lived scoped service tokens expose these adapter functions. These are application interfaces, not Codex protocol signatures:

```text
claim(boot_id, epoch, capacity=1) -> [RunEnvelope]
heartbeat(boot_id, epoch, active_operations[], last_applied_sequence) -> lease_until
submitNative(run_id, attempt, submission_key, pinned_context) -> native_run_ref
observeNative(native_run_ref, cursor?) -> lifecycle_events + reconciliation_snapshot
cancelNative(native_run_ref, reason) -> cancellation_request_ref
complete(run_id, attempt, epoch, result_ref, effect_receipts[]) -> acknowledgment
prepareSleep(epoch, boot_id, queue_sequence, activity_snapshot) -> stop_token | DENIED
commitSleep(stop_token, epoch, queue_sequence, checkpoint_ref) -> STOP_COMMITTED | DENIED
publishContext(room_id, recipient_ids, revisions, summary, cause_id) -> event_sequence
```

Implement runtime envelopes in the adapter milestone before integration, with strict JSON Schema validation and fixture coverage. A canceled or stale native submission must not be re-admitted merely because a transport request timed out. Native RPC discovery, auth scopes and cancel acknowledgment semantics are compatibility-gate deliverables; no code should assume hashed bundled JS filenames are APIs.

### 9.3 Request/Response Schemas

Companions define the normative public command schema, OpenAPI routes, SQL store and vectors. Unknown fields reject with 422, unknown commands with `UNSUPPORTED_COMMAND`. All writes identify `schema_version:1`; output may gain optional fields in v1.

Persona: ID, revision, display name (1..80), instructions (<=16000 chars), tool policy IDs, archived. Room: ID, revision, name, bot members (1..8), default responder in members. Routine: ID/revision, owner bot, name/instructions, schedule or trigger, enabled, timezone, misfire/overlap policy and authorized action policy IDs. Routine schedule: five-field numeric cron (`*`, lists, ranges, steps), minute granularity, no seconds/macros, explicit IANA timezone; v1 rejects both restricted day-of-month and day-of-week to avoid cron OR ambiguity. Natural-language “weekday at 8” becomes `0 8 * * 1-5`. No arbitrary code in schedule fields. Tool/action/trigger policy IDs reference an operator-provisioned allowlist registry in v1; model commands cannot create permissions. Logical validation verifies minimum interval, both cron day restrictions, timezone, room default membership, reference ownership and actual UTF-8 byte limits beyond JSON Schema character bounds.

Memory: ID/revision, scope kind/id, text, provenance, expiry and sensitivity; scope ID null only for global. Provenance actor/source/event mandatory; user authority determined from verified caller, never trusted from submitted JSON. Global directives <=4000 tokens in run context; retrieved scoped records <=8000 tokens total using selected model tokenizer, stable relevance ordering then ID. Above limits: use a versioned summary with pointers, disclose truncation, and permit targeted retrieval. Never silently drop a current explicit constraint. Auto-extracted facts start as proposed; explicit “remember” saves eligible facts directly. Facts conflict: owner correction supersedes; other conflicting candidates remain proposed.

RunEnvelope: stable run ID, attempt integer, trigger event ID, persona/routine revision, native session routing key, memory watermarks, absolute deadlines, permitted effect classes, epoch and boot ID. Terminal result has status, output reference, error if any, native run reference and effect states. Result delivery to portal is durable outbox commit; a closed browser does not retain an executor lease. External required delivery is a separate bounded job and effect.

### 9.4 Error Taxonomy

All errors use `{error:{code,message,retryable},request_id}`. Logs include request/entity ID and code, never body or credentials.

| Code | HTTP | Retry | Meaning / client action |
|---|---:|---|---|
| UNAUTHENTICATED | 401 | No | Sign in |
| FORBIDDEN | 403 | No | Identity or scope denied |
| NOT_FOUND | 404 | No | Missing entity or inaccessible reference |
| REVISION_CONFLICT | 409 | After reload | Rebase edit on current revision |
| IDEMPOTENCY_CONFLICT | 409 | No | Same key used with different body |
| STALE_EPOCH | 409 | No | Executor must stop admission |
| OUTCOME_UNKNOWN | 409 | No | Reconcile external result before retry |
| HISTORY_GAP | 409 | Snapshot | Fetch current snapshot |
| INVALID_INPUT / UNSUPPORTED_COMMAND | 422 | No | Correct fields/command |
| PAYLOAD_TOO_LARGE | 413 | No | Reduce request |
| RATE_LIMITED | 429 | Yes | Respect Retry-After |
| AUTH_REQUIRED / QUOTA_BLOCKED / CAPABILITY_UNAVAILABLE / BUDGET_BLOCKED | 409 | After condition changes | Park job, show reason |
| DEADLINE_EXCEEDED / CANCEL_UNCONFIRMED | 409 | Policy only | Watchdog reconciliation required |
| TEMPORARY_UNAVAILABLE | 503 | Yes | Backoff with same key |
| INTERNAL_ERROR | 500 | Yes, same key | Fetch receipt before resubmission |

A run error uses the same code inside its result; a 409 run state is not an HTTP failure for a successful GET. Read retries: jittered 1, 2, 4, 8, 16 seconds, capped 30 seconds; no infinite mutation loop.

### 9.5 Examples

```json
{"schema_version":1,"type":"message.send","payload":{"conversation_id":"11111111-1111-4111-8111-111111111111","text":"Every weekday at 8am, summarize my unread mail. Do not send anything."}}
```

The target bot interprets this during an ordinary leased model run, writes a routine through the typed tool with cron `0 8 * * 1-5`, timezone `Asia/Jakarta`, read-only action policy, and displays next 3 executions. If the connector is absent, save paused with `CAPABILITY_UNAVAILABLE`. If the instruction already clearly authorizes this bounded routine, do not ask another confirmation. Ambiguity or a new consequential action produces a draft with one focused question.

```json
{"schema_version":1,"type":"room.publish","payload":{"room_id":"22222222-2222-4222-8222-222222222222","kind":"context_update","recipient_ids":["33333333-3333-4333-8333-333333333333"],"text":"Travel preference revision 4 is available.","references":[{"kind":"memory","id":"44444444-4444-4444-8444-444444444444","revision":4}],"cause_id":"55555555-5555-4555-8555-555555555555"}}
```

This produces a timeline/data event only. A recipient sees authorized referenced content next time it actually runs. Publication sets delivered watermark; successful inclusion in run input sets consumed watermark. Access is rechecked at consumption, including deletion and room membership changes.

### 9.6 Compatibility & Versioning

Public route version v1; schema version 1; routine/persona/memory revisions are independent monotonic integers. Reject future schema versions. Cursor is opaque. Pin image digest, Codex 0.154.0 and adapter together; rerun compatibility tests on every upgrade. Never mutate runtime-owned databases. Application and runtime state migrations have separate backup/rollback gates.

## 10. Data Model

`DB/schema.sql` is the logical SQLite baseline. DO storage uses its transaction API around these entities; the SQL file validates constraints, not a promise that generic `sqlite3` connection semantics equal DO transactions. Entities: versioned objects, commands/receipts, timeline events, consumer cursors, occurrences, runs/attempts, operations, effects, lifecycle singleton and outbox. Object bodies must validate against their command schema before storage. Foreign-key-like references inside JSON are checked transactionally in application code: installation ownership, current persona/member references, revision and scope access.

Authority: DO owns application object revisions, ingress, schedule occurrences, event order, run admission and lifecycle. runtime volume owns native sessions/transcripts, auth, browser profiles and adapter recovery journal. The journal persists submission keys and native refs; it is a recovery ledger, not a second scheduler. Memory projections on disk are read-only generated files; native learned notes are candidates until promoted through the typed memory operation. Mount one volume at `/data`; separate state, profiles, journal, and restricted secrets directories.

Hidden native session routing key is `(persona_id, scope_set_hash, conversation_or_routine_id, context_generation)`. Each routine has its own session lineage; never reuse a session across incompatible memory scope sets. A manual bot conversation cannot inherit routine-private working notes through persona bootstrap files. Restrict native cross-session history/search and memory tools to the admitted scope set; mediate filesystem paths and do not grant unrestricted shell/file access to agents that require memory isolation. If the selected harness cannot enforce these paths, private-memory support stays disabled pending an isolation adapter. Shared skills contain procedure only; per-routine mutable state is retrieved by scope. Context summaries inherit the ACL and provenance of their inputs.

Memory deletion writes a tombstone and invalidates projections/retrieval in the same metadata transaction; active runs receive cancellation if they might reuse deleted sensitive content. Rebuild context before resuming. Purge canonical content within 24 hours; explain that prior transcripts may contain copies. “Forget everywhere” additionally searches/removes indexed copies and eligible transcripts, with backup expiry bounded by 28 days. Do not claim deletion from third-party services. Keep ID/timestamp-only dedupe tombstones for 90 days without deleted text.

Use provider encryption at rest plus encrypted backups; HTTPS for all connections; volume paths 0700 and credential files 0600. DO and volume contain PII, including private message text, preferences and connector session data. Owner-only application access; runtime token limited to one installation and current epoch. Service and OAuth secrets stay in provider secret stores/restricted volume, excluded from Git, browser, model prompts, exports and logs. No third-party analytics of message contents. Logs redact emails, phone numbers, message text, screenshots and tokens by default; opt-in diagnostic artifacts have 24-hour expiry.

Migration: create v1 tables in development, validate foreign keys/uniqueness, backup before changes, then expand-only additions; schema version recorded. Import existing native history through supported read/export interfaces only. No existing native state is overwritten. Backups include coordinated object export, runtime checkpoint/journal, image/config versions and a manifest of counts/hashes. Restore requires confirmed old executor stop; revoke old identity; validate manifests; reauthenticate individual connectors if needed.

### Lifecycle and scheduling state machines

Instance: `STOPPED → START_REQUESTED → BOOTING → READY → DRAINING → STOP_COMMITTED → STOPPING → STOPPED`; unresolved provider/executor state enters `RECOVERY_REQUIRED`. Desired run/stop state is independent of observed provider phase. One serialized controller issues lifecycle operations with operation IDs; duplicate triggers coalesce. Wake API failures retry after 1, 5, 15 and 60 seconds, then enter recovery-required with durable queued work and a 5-minute reconciliation alarm; owner retry uses the same lifecycle operation identity where supported. Never infer a failed start is absent without querying provider state. No provider proxy autostop: request traffic cannot see background model work.

Supervisor heartbeats every 15 seconds, lease 90 seconds. If renewal fails, stop new admission immediately; cancel root inference, active tools, node calls and all child/subprocess groups before expiry with a 15-second safety margin. If cancellation cannot settle, terminate the owning executor process group; preserve uncertain effects for reconciliation. Controller does not start another executor until provider confirms old stopped. Local OS lock prevents two runtime processes in one Machine. Epochs reject late callbacks; they do not undo website actions.

Sleep predicate: no runnable/claimed runs, no live operations, no uncertain live effects, no pending state/outbox commit, all waits parked durably, idle grace elapsed. First close admission, then collect snapshot; prepare stop token binds epoch and queue sequence. Flush native state/browser and persist checkpoint before commit. New work before commit invalidates token and resumes; after commit it sets wake-after-stop. Controller completes stop before issuing next start. A failed drain has a 30-second deadline, then reopens admission or enters recovery; do not force normal sleep through an unknown active operation.

Job: `queued → claimed → running → finishing → completed`; alternatives waiting/failed/cancelling/cancelled/recovery_required. Attempt identity remains stable during transport retries. The adapter writes submission intent before native submission and records native ref afterward; if a crash lands between them, query native ledger by correlation key. If correlation cannot prove absence/presence, park as uncertain instead of submitting twice. Terminal native state plus result/outbox persistence releases lease.

One DO alarm tracks the earliest due schedule, wake retry or external watchdog deadline. Durable alarm delivery is at-least-once; re-arm after processing. Every public request also reconciles overdue alarms. Idle daily reconciliation is permitted for schedule health and does not wake the runtime. No perpetual 15-second alarm while stopped. Claimed occurrences pin revision. Schedule edits atomically invalidate unclaimed old occurrences and recompute next due. DST: skip nonexistent local times; repeated local times fire once at earliest UTC instant. Coalescing records count/range of missed ticks, chooses latest eligible nominal tick, and never hides discarded ticks from run detail. `queue_one` retains only newest eligible pending occurrence during overlap; `skip` records skipped; v1 disallows parallel same-routine execution.

Watchdog: heartbeat absence 45 seconds triggers probe, not immediate retry; quiet inference deadline 5 minutes by default, tool deadline 2 minutes except explicitly declared transfer/shell up to 10 minutes; run hard deadline 20 minutes. Progress may extend phase deadlines only inside hard deadline. Cancellation grace 15 seconds then verify for another 15; if still live, stop owning process group/Machine through fenced recovery. External effects become outcome_unknown where needed. Read-only/idempotent attempts retry at most twice after 10 and 60 seconds; external mutations require matching provider idempotency key or verified receipt. A human wait can park only at restartable checkpoint; ephemeral page/modal waits get a bounded 5-minute hold, then explicit restart-required state.

Bot collaboration: one default responder, at most 3 bot contributions per owner message, hop depth 2, fan-out 2, total run hard deadline shared across the chain. Deduplicate `(cause_id, sender, recipient, request_digest)`; prohibit self-dispatch and repeated causal edges. When a parent requests another bot, persist its continuation and yield the sole execution slot before dispatching the child. The workflow lease remains a sleep blocker while a child or runnable continuation exists. Capacity=1 counts active native execution, not parked parents; a synchronous parent wait holding the slot is forbidden. Owner can explicitly authorize a larger bounded collaboration in a new command. Other bot messages are attributed data, not higher-priority instructions. Room membership grants room visibility, not automatic access to every member's private memory.

## 11. Non-Functional Requirements

Targets are proposed acceptance gates, not achieved measurements.

| Dimension | Metric / target | Measurement and violation behavior |
|---|---|---|
| Intake | p95 durable receipt <=1s at 5 writes/s over 10 min, <=128 KiB each | Staging load test; alert after 5-min sustained violation |
| Wake | p95 ready <=60s over 30 cold starts; max 120s before visible recovery warning | Provider start to adapter-ready histogram; queue remains durable |
| Schedule | p95 admission <=90s after nominal due under healthy providers | Occurrence timestamps; misfire policy when exceeded |
| Portal availability | 99.5% successful authenticated intake/month, excluding client auth/input errors | Synthetic probe every 5 min; 216-min 30-day error budget; no HA promise |
| Durability | Zero acknowledged command loss in 100 crash/restart injections | Receipt/ledger comparison; failure blocks promotion |
| Sleep correctness | Zero premature stops across S04–S08 and 100 randomized drain interleavings | Explicit operation ledger + provider logs |
| No-op | Exactly zero inference and wake calls for 1000 context publications | Fake adapter counters and one staging trace |
| UI | LCP <=2.5s, INP <=200ms on mobile emulation; initial JS <=250 KiB gzip | Browser test; don't poll hidden views |
| Identity/privacy | All protected endpoints reject wrong owner; all secret canaries absent from logs/export | Auth matrix and log scan; block release on leak |
| Compatibility | Chrome/Safari current and previous major; Codex 0.154.0 | Browser matrix and adapter contract suite; version drift fails gate |
| Recovery | Backup RPO <=24h when work exists; restore exercise <=60 min excluding provider outage | Nightly-after-work checkpoint and staging restore drill |
| Cost | Projected infrastructure <=$5/month for declared workload, alerts at 70/90/100% | Seven-day uptime/storage sample + current provider quote; pause optional admission at target |

Cost formula: compute active seconds × regional per-second rate + persistent volume GB-month + stopped rootfs GB-month + backups + control plane + egress/IP/other charges. Include startup, inference waiting, reconnect, idle grace and retry time. Current Fly documentation lists volume and stopped rootfs storage at $0.15/GB-month; a 10 GB volume and 2 GB stopped rootfs are approximately $1.80/month before compute/backups. This is illustrative, not a quote for the final image or region. Cloudflare SQLite DO is available on Free within quotas; Workers Paid has a $5/month minimum, which alone consumes this target. Free-tier quota failure must surface as unavailable intake, never false acceptance.

Reference workload: 10 tasks/day, each 2 minutes useful runtime + 1 minute idle grace = 15 compute hours/30 days before boot/reconnect. Measure the actual native runtime/browser image and RSS; use `remaining_budget / hourly_rate` to derive allowable hours. A 5-minute schedule creates 8640 nominal wakes/month and is not within the light-workload assumption. Display infrastructure estimates separately from account model quota; token estimates are not proof of dollars charged or subscription remaining balance.

## 12. Observability

Metrics: `ingress_latency_ms`, `ingress_errors_total{code}`, `queue_oldest_age_seconds`, `wake_duration_seconds`, `machine_active_seconds{reason}`, `sleep_denied_total{blocker}`, `active_operations{kind}`, `lease_age_seconds`, `run_duration_seconds{status}`, `cancel_unconfirmed_total`, `effects_unknown_total`, `schedule_lag_seconds`, `context_update_wakes_total` (must remain 0), `oauth_blocked_total`, `cost_projected_usd`. Use bounded labels, never message/user text or arbitrary IDs as metric labels.

Structured logs: `command.accepted`, `run.claimed`, `native.submitted`, `operation.started/settled`, `effect.intent/receipt/unknown`, `sleep.prepared/invalidated/committed`, `provider.observed`, `routine.misfire`, `auth.blocked`. Required fields timestamp, level, installation ID, request/run/attempt ID where relevant, epoch, outcome and duration. IDs are trace correlation, not metrics labels. OpenTelemetry spans: ingress transaction, wake provider call, boot, native run, tool operation, checkpoint, delivery. Sample normal traces at 10%, errors 100%; no prompt bodies.

Portal dashboard panels: queue/recovery, active operations and sleep blockers, scheduled next/last runs, capability last-sync, quota state if available, cost breakdown and idle overhead. Alerts in portal: lease >45s while expected running; oldest runnable queue >120s; cancellation unconfirmed immediately; unknown effect immediately; schedule lag >5min; projected budget thresholds; backup age >24h when changes exist. Optional email notifications require owner-configured authorization; default is portal only. Recovery action links describe retry eligibility and uncertainty.

## 13. Rollout & Rollback

Flags default off: `runtime_execution`, `scheduled_wake`, `event_wake`, `auto_sleep`, `bot_collaboration`, `grok_import`, `desktop_bridge`. Portal metadata editing may be enabled independently. Environments: local fake provider/effect sink, isolated staging state/account, then one production owner. Never test destructive actions against real contacts.

Promotion: contract validation → adapter/OAuth proof → lifecycle failure tests → read-only manual portal trials → 7-day staged cost/WhatsApp trial → production read-only tasks → explicitly authorized mutations. Canary for one owner means one selected read-only routine for 24 hours, then up to 3 for 48 hours; all others stay paused. Enable auto-sleep only after sleep/cancel gates; document temporary test uptime cost. No feature automatically enables external recipients.

Rollback: disable admission flags and schedules in control store; preserve queued receipts; request cancellation and reconcile effects; verify old executor stopped; checkpoint/backup; deploy previous compatible adapter/image; validate schema version, ownership lock, auth status and one synthetic read-only run; re-enable selected flags. If native state migration is incompatible, restore coordinated backup into stopped replacement with explicit RPO disclosure; don't point older binaries at newer state. Never rollback by deleting pending receipts or replaying uncertain mutations. Validate one owner, no lost receipts, no duplicate occurrence/effect, and portal reads while runtime stopped.

## 14. Test Plan

Documentation validation now: parse all JSON; validate command examples with Draft 2020-12 JSON Schema; load SQL into in-memory SQLite; validate OpenAPI 3.1 with the selected validator; check internal references and file-block bundle. These are artifact checks, not runtime tests.

Implementation must supply these commands in the root package manifest (they do not exist yet):

```sh
npm ci
npm run test:unit
npm run test:contracts
npm run test:lifecycle -- --seed=41 --iterations=100
npm run test:adapter
npm run test:e2e
npm run test:restore
npm run test:cost-report -- --days=7
```

Unit tests: schema limits, timezone parsing/DST, occurrence keys, optimistic revisions, memory ACL/tombstones, causal budgets, retry classification, sleep predicate. Integration: transactional DO test runtime with fake clock; fake Fly operation ordering; pinned native runtime in isolated state; fake model with silence/tool/child phases; fake effect sink recording idempotency and receipts. E2E: portal bot switch, routine natural-language flow, room/no-op, waiting resume, offline drafts, auth failures, keyboard/mobile views. Never use private Grok chats as fixtures.

Adapter tests must prove every S04/S05 operation and S32 submission ambiguity is observable or conservatively blocked. OAuth smoke uses one small subscription-backed call with a test prompt, stop/restart then a second call; no paid API key. Refresh behavior requires a later expiry/refresh observation or documented simulated test plus explicit pending live gate; don't call two successes proof of indefinite auth. WhatsApp S27 is manual staged measurement with known sent-message IDs and coverage ratios. Optional desktop actions require Mac online/offline tests and task-scoped permissions. Long-running local batches use `caffeinate -i` tied to the process and a <=15-minute wall-clock health check.

## 15. Implementation Task Breakdown (Dependency Order)

1. **Compatibility proof** — isolated native agent submit/observe/cancel, OAuth persistence, browser flush, submission recovery; no dependencies. Deliver adapter API schema and evidence; stop if core observability unavailable.
2. **Contract/store baseline** — schema validator, SQLite/DO migration, command receipts, auth/idempotency; depends 1's boundary decisions. Do not duplicate native transcripts.
3. **Lifecycle controller/supervisor** — fake provider first, lock/epoch/heartbeat/drain/race/watchdog, then provider adapter; depends 2. Pass randomized failure tests before real stop.
4. **Native execution adapter** — context pinning, journal, effect ledger, result outbox, cancellation/reconciliation; depends 1–3. No direct native DB writes.
5. **Portal and personas** — owner login, bots/rooms/timelines/status, hidden session routing, mobile/keyboard; depends 2,4.
6. **Memory** — scopes/provenance/revision/correction/delete/projection; depends 4,5. Prove isolation and conflict behavior.
7. **Routines/triggers** — typed natural-language tools, schedule engine, misfire/version/overlap, signed webhook; depends 2–6. No duplicate native cron ownership.
8. **Bot collaboration** — room messages, no-op events/watermarks, bounded action dispatch; depends 5–7. Zero-wake/no-inference test required.
9. **Operational rollout** — metrics/cost/backup/restore, WhatsApp matrix, 7-day sample, canary; depends 3–8. Production flags remain gated.
10. **Optional Grok export/import** — supported export discovery, normalized bundle and preview; depends 2,5,7; independent of core rollout.
11. **Optional Mac/Codex bridge** — capability discovery, permitted desktop tools, durable wait/cancel; depends 4,9. Never make sleeping-Mac automation a required cloud dependency.

## 16. Definition of Done

Implementation is done only when all core S01–S27 and S29–S32 scenarios pass where applicable; all public and runtime contracts have schemas/examples; native cancellation/activity proof passes; no-op counters stay zero; schedules wake stopped compute; auth refresh and connector limitations are documented; seven-day measured cost projection includes all charges; restore drill passes; UI meets the defined states/accessibility targets; observability and recovery controls are usable; canary completes without acknowledged work loss or duplicate effects; documentation states limitations and exact tested versions. S28 and automated Grok export are optional, not core blockers. This document's completion does not imply these implementation criteria are achieved.

## 17. Spec Lint Checklist

- [x] Proposed targets distinguished from measurements; assumptions have rationale and overrides.
- [x] No unquantified performance/availability claims.
- [x] Public command schemas and examples accompany contracts; runtime-specific unknowns have a mandatory proof milestone.
- [x] Errors have stable codes and retry semantics.
- [x] Sleep races, silent inference, unknown effects, DST, deletion, duplicates and scope leakage covered.
- [x] Open questions localized and phase-specific; none require another user answer to finish this spec.
- [x] Rollout/rollback steps and future test commands specified without claiming they exist today.
- [x] Optional exporter/desktop work separated from core acceptance.

## 18. Skeptic Review

- **“No separate contexts needed” could become one contaminated transcript.** Use one instance with separate native agent contexts; expose bots only. Shared memory is explicit.
- **“No-op” could secretly cost tokens.** Persist events and lazy cursors only; assert zero native calls/wakes. `NO_REPLY` text is not equivalent.
- **“Idle” could mean no streamed tokens.** Outer run lease includes admission, queueing, quiet model work, children and final commit; unknown adapter coverage blocks auto-sleep.
- **“Cancelled” could mean an HTTP request returned.** Verify native terminal/process settlement; preserve effect uncertainty and disable blind retries.
- **Native cron could replay after external firing.** External authority only for user routines; maintenance jobs explicitly distinguished.
- **Authentication evidence could be overgeneralized.** Use the supported Codex route in the executing environment. Do not copy unrelated credentials.
- **$5 could exclude disk/backups or assume continuous free infrastructure.** Price full footprint and actual active time; free quotas can reject requests; surface budget-blocked work.
- **WhatsApp reauthentication could be mistaken for complete history.** Measure message-level cold-start retrieval separately and display gaps/unknowns.
- **Epoch fencing could be mistaken for website fencing.** Stop old process/provider before replacement; reconcile side-effect destination.
- **Memory deletion could leave prompt copies.** Tombstone, invalidate, cancel/rebuild affected context, expire backups, and distinguish canonical deletion from transcript cleanup.
- **Grok exporter could require unsupported extraction.** Treat discovery as optional gate; user-supplied archive first; explicit unsupported-schema failure.

## 19. Traceability

| User request | Design | Acceptance |
|---|---|---|
| Bots hide threads, distinct instructions | 1, 5, 9 persona/session routing | S09 |
| Global and routine/skill memory | 6, 9.3, 10 scopes/revisions | S10–S11, S30 |
| Natural-language routines/cron | 9.5, 10 scheduler | S14–S18 |
| 1:1/group bot communication and no-op | 9.5, 10 collaboration | S12–S13 |
| Grok exporter bonus | Optional contract below | S28 |
| Messaging portal | 9.1–9.4 | S01–S03, S23, S31 |
| Scheduled/event wake | 10 lifecycle/scheduler | S03, S16, S24 |
| No sleep during inference/tools | 6, 10 | S04–S08 |
| Stuck cancel/retry | 10 watchdog/effects | S19–S21, S32 |
| OpenAI OAuth | 2, 3, 14 | S22 + staged auth gate |
| Codex desktop computer use | Optional contract below | S29 |
| ~$5 transient infrastructure | 11, 12 | S25 + seven-day sample |

### Optional Grok exporter contract

First try an official export UI/documented archive. Read-only reconnaissance in this session established neither. Proposed later CLI: `grok-export inspect --input PATH --json`, `grok-export export --input PATH --output bundle.json`, `grok-export validate bundle.json`. Only explicitly selected owner-readable exports; never live auth-token stores or undocumented network endpoints. Input <=50 MiB, local UTF-8 JSON or documented archive; archive paths cannot escape extraction directory. Exit 0 success, 2 usage/schema, 3 unsupported source, 4 permission, 5 parse/partial export. A partial export must mark `complete:false` and enumerate omissions.

Bundle v1: `schema_version`, `source:{product,version,exported_at,method}`, `complete`, `personas:[{source_id,name,instructions}]`, `routines:[{source_id,persona_source_id,name,instructions,schedule_raw,timezone,enabled}]`, `omissions:[{source_id,field,reason}]`; preserve exact instruction text and raw schedule string, not inferred behavior. Exclude conversations, secrets and attachments by default. Build a strict JSON Schema and fixtures at optional milestone 10 before coding parser. Import shows field-by-field preview and duplicates by source ID + content hash; unknown semantics become draft. All imported routines disabled until owner adopts them; adopted instructions remain below application authorization rules. Tool not implemented in this spec-only pass.

### Optional Codex desktop bridge contract

A desktop bridge is optional only if a supported callable interface exists for the desired computer-use action. Development tools are not evidence that unattended Codex can call them. Verify capability discovery, caller identity, action schema, cancellation, screenshot privacy and online status. Cloud work routes an explicit scoped action to the paired Mac, holds a tracked lease, and parks if offline. No automatic permission grants or dependency on keeping the display on.

### Evidence and sources

Use [Codex runtime setup](docs/CODEX_RUNTIME_SETUP.md), [provider constraints](docs/PROVIDERS.md), and current official Cloudflare/Sprites/OpenAI documentation. Revalidate live prices, eligibility, and the pinned runtime before deployment.


## Local implementation amendments (2026-09-10)

Cloudflare Worker hosts the static portal and authenticated API; its SQLite Durable Object owns command acceptance, occurrence scheduling and lifecycle state. Provider identity is a generic `RuntimeRef`, stored as `provider_ref_json`, rather than a Fly machine ID. Provider capabilities differ; docs/PROVIDERS.md is authoritative for adapter coverage, and none is live verified. Changing persisted provider identity requires an explicit stopped-state migration.

The local implementation adds strict internal request schemas in SCHEMAS/runtime.json and an authenticated paginated conversation-events endpoint. Public retry accepts expected_attempt=0 for never-admitted work. Additional stable errors include OWNER_CANCELLED, CONTEXT_INVALIDATED, PROVIDER_MIGRATION_REQUIRED, SCHEMA_MISMATCH, UNAUTHORIZED, AUTH_CONFIGURATION_REQUIRED and ORIGIN_REJECTED. Owner/context cancellation cannot automatically retry or publish late result text; provider-confirmed termination preserves cancellation reasons. Historical unknown effects remain parked and block retry, while an inactive historical run does not prevent unrelated future idle shutdown.

The implementation report explicitly lists missing executor, native coverage, natural-language routine tools, retention/backup and browser acceptance work. The normative acceptance suite is not fully passed by local unit tests.


### Selected initial provider and hibernation semantics

The owner selected Fly Sprites on 2026-09-10. Cloudflare remains the portal/API/state/scheduler host. Other providers may be deferred. Provider-managed hibernation uses IDLE_PERMITTED after clean drain/checkpoint; this revokes the old admission lease but does not declare the VM terminated. The next wake requires a new epoch and boot handshake. Native Tasks holds cover active work and are released only after settlement. Unknown recovery cannot create a replacement or retry uncertain effects based on hibernation. Authentication and remaining integration work are in docs/AUTH_SETUP.md and docs/IMPLEMENTATION.md.

## 20. Native-first local implementation additions (2026-09-10)

See [NATIVE_ORCHESTRATION.md](docs/NATIVE_ORCHESTRATION.md) for Codex contracts and O01–O09. Codex owns its thread/turn/tool loop; the application adds durable child links, task cards, locks and exact-task follow-ups. Complete recursive event/settlement coverage remains unproved, so execution stays disabled.

A task cancellation timeout parks that task and retains its operations/locks, without stopping unrelated tasks. A lost installation executor lease still fences admission and requires provider-confirmed termination for explicit-stop providers. Targeted follow-ups currently wait for definitive native settlement, then create a bounded coordinator request naming the original logical task; active-task continuation is unverified. Background runs are never silently fed through the coordinator retry claimant. Unknown effects cannot be replayed.

`setup.adopt` atomically applies a hash-bound, revision-bound batch of at most twelve persona/routine changes with empty grants and disabled routines. Initial source migration is five bots and seven routines; private identity records stay outside commands/assets. The portal explicitly reviews the Singapore monitoring proposal against the Jakarta source header.

Flight deadlines use the earlier of departure minus eight hours and 04:00 Singapore on the departure's Singapore date. Per-leg revisions deduplicate one-shot alarms and daily reconciliation in the same SQLite authority. Only an enabled canonical Inbox triage run with the configured pinned policy may register a deadline, and confirmed restoration requires the matching external-effect receipt. Uncertain/enqueued older leg revisions block automatic replacement effects. This remains disabled until Gmail tooling and receipt enforcement are verified.

The installed application schema migrates version 1 to version 2 while preserving existing records. Native databases are never migrated by this application. Sprites clean drain reaches `IDLE_PERMITTED` with no idle heartbeat polling; its next wake claims a fresh epoch. The runnable Sprite service currently provides transport preflight only and does not claim jobs.

## 21. Consolidated product and Apache reuse contract

### 21.1 Scope, ownership and preserved work

Deliver a work-domain-neutral, open Grok Bot-style assistant with a dedicated web/Mac portal, replaceable harness/model execution, and inexpensive sleeping compute. Preserve the implemented Worker/SQLite command store, receipts, schedule occurrences, scoped memory records, effect ledger, lifecycle fencing and tests. Do not discard those contracts merely to reuse a desktop application. The existing five-bot/seven-routine configuration remains a reviewed onboarding case, not mandatory product roles.

| Layer | Authoritative responsibility | Reuse boundary |
| --- | --- | --- |
| Web and Mac clients | Presentation, local unsent drafts, notifications, authenticated interaction | Adapt Apache UI/shell; no independent authoritative task DB, scheduler, model login cache or local executor requirement |
| External Worker/SQLite control plane | Durable acceptance, application identities/revisions, scheduling, policies, memory authority, results and recovery | Keep one writer and existing command/receipt semantics; clients work while compute sleeps |
| Conversational coordinator | Interpret intent; answer, dispatch, steer exact task, defer follow-up or cancel | May run on the awakened host; “always reachable” means durable ingress, not an always-running model |
| Execution adapter and supervisor | Native submission/events, process custody, locks, activity holds, checkpoint/recovery | Selected harness owns its tool loop; complete missing supervisor rather than assuming bridge tests prove it exists |
| Customer runtime and peripherals | Shared remote browser/files/tools and optional local-device capabilities | One customer-owned execution environment for its bots, not a VM per bot; separate customers' authority and state |

Codex 0.154.0 is the sole harness. Keep the Mac-client decision separate. Do not introduce two execution/schedule authorities, patch the runtime, or promise threads can move between versions. Keep admitted work pinned until settled or explicitly recovered.

### 21.2 Complete experience inventory

The following inventory incorporates the detailed behaviors and acceptance cases of UX01–UX15; it does not replace them with weaker summaries. Optional means optional to use, not omitted from the full parity target.

| Capability | Required experience | Existing contract / detailed acceptance |
| --- | --- | --- |
| Bots and conversations | Minimal creation, durable per-bot chat, hidden native sessions, roster organization; no fixed work domain | UX01–03; S09 |
| Responsive orchestration | Status/new work does not implicitly interrupt; intentional exact-task steer/cancel, attributed background results and truthful task strip | UX05/15; O01–O09; S19–S21/S32 |
| Chat and artifacts | Quiet streaming, visible approvals/errors, attachments/previews/downloads, search, replies/reactions and stable mentions | UX04/13; S23/S31 |
| Skills and learning | Conversational create/update/delete, catalog/per-bot enablement, revisioned procedures, progressive loading, controlled optional review and safe tests | UX11; S10/S30 plus UX11 acceptance |
| Routines and triggers | Natural-language full lifecycle, next-run/timezone preview, real test/run-now, history, event triggers, missing-input policy and independent delivery status | UX06/12; S14–S18/S24 |
| Memory and collaboration | Scoped facts/provenance/correction/deletion, attributed delegation, bounded groups; passive updates cause no inference or wake | UX07/13; S10–S13/S30 |
| Computer and teaching | Remote/local browser choice, lightweight GUI tools, view versus exclusive control, credential handoff, recorded demonstration → reviewed skill | UX08/14; S04–S08/S29 |
| Attention and setup | Unread versus needs-you, notification preferences, appearance, cloneable installation, supported sign-in, explicit capability readiness | UX09/13; R01/R03 below |
| Portability and distribution | Reviewed templates, disabled imported routines, versioned state export, minimal connector setup, commercially reusable code | UX14/15; R06 below; S28 only concerns optional proprietary-source extraction |
| Cost and recovery | Sleeping execution, restart-safe state, unknown effects not replayed, measured infrastructure and model overhead | UX09/10/15; S01–S08/S25–S27/S32; R05/R07 |

Specialized connectors, team administration, payments and mobile-native delivery remain named parity gaps requiring source-dated capability rows and feasibility evidence, not implied by a generic MCP client. Web mobile acceptance remains required independently. Public research defines advertised behavior, not hidden Grok internals or proof of 100% reliability.

### 21.3 Sleeping containers are a required cost boundary

- Preserve suspendable/containerized execution with durable per-customer state and external wake/schedule acceptance. Sprites remains first deployment target; Docker packaging is not mandatory when the provider supplies the equivalent isolated runtime. A container on an always-billed VM is not automatically cheaper: savings require verified idle billing, packing or suspension behavior. Do not claim a specific reduction before measurement.
- Do not adopt a local desktop-owned brain, per-bot cloud computer allocation, always-on database/queue fleet, or background polling that defeats sleep merely because an upstream client assumes it. Multiple bots share the customer's runtime; tabs/displays and task locks provide coordination, not cross-customer security isolation.
- Closed Mac client, open idle portal, notification delivery, old-screen/history viewing, SSE reconnect and metadata reads must not keep agent compute awake. An explicit live-computer request may wake it and acquire a bounded viewing/control hold; release that hold on disconnect/expiry. Active tools and unresolved live reconciliation still block sleep.
- Normal drain requires settled model/child/tool/transfer/device work, durable results/checkpoints and persistence flushes. Renew provider activity holds during actual work. Unknown cancellation or effects cannot be declared settled to save cost; show recovery and its cost consequence. Safe durable waits for an offline Mac or human approval may release compute only under existing checkpoint/settlement rules.
- Warm resume revalidates ownership; cold start reconstructs from durable state and advances epoch. Persist auth, skill versions, task checkpoints and browser profiles in customer-private storage. Treat live tabs/frame IDs, unsaved forms and process memory as non-durable; re-observe before acting. No snapshot may include another customer's credentials.
- Keep the 60-second idle grace as a current default subject to measured tuning. Nearby occurrences may share an awake interval without changing adopted schedules. Account for the actual 50 monitoring occurrences plus two daily routines, interactive work and one-shot deadlines, not an illustrative ten-job day.
- Report active/startup/drain/idle time, peak and idle memory, retained disk/backups, network/viewer traffic, control-plane costs, minimum billing increments and available model usage. Compare identical successful workloads against always-on operation; retain the approximately $5 infrastructure target as unverified. Neither free trials nor containerization alone establishes affordability.

### 21.4 Pinned Apache source candidates and adaptation requirements

These are source observations, not dependencies already imported or live-tested functionality. Prefer a bounded extraction over a wholesale fork when it avoids importing a competing backend. Record file-level licenses and notices before copying; exclude OpenMausBot `enterprise/`, restricted branding and Gawk code. Recheck transitive dependencies and shipped assets, not just the root license.

| Candidate at inspected revision | Concrete material to evaluate | Required adaptation / non-transferable assumption |
| --- | --- | --- |
| [OpenMausBot desktop](https://github.com/milind-soni/OpenMausBot/tree/b2f6e9d04ee0c66ff2e389de47117ce6e0dd833b/electron) | `environments.cjs`, `preload.cjs`, restricted remote-origin window, desktop menus/badges and release packaging | Connect to our authenticated remote portal; deny remote pages local files/credentials/process control by default. Remove local harness autostart and enterprise dependencies. Use our own signing identity and update feed. |
| [OpenMausBot UI](https://github.com/milind-soni/OpenMausBot/tree/b2f6e9d04ee0c66ff2e389de47117ce6e0dd833b/src) | `components/Sidebar.tsx`, presentational `ChatView.tsx` parts, `BrowserPanel.tsx`/`BrowserViewport.tsx`, `lib/live-events.ts` | Replace `/api/*`, reducer/store entities and SSE frames with our commands/receipts/revisions. Cursor gaps require snapshot/replay, not task resubmission. Viewer input must use server-enforced task/device leases. |
| [OpenMausBot Codex](https://github.com/milind-soni/OpenMausBot/tree/b2f6e9d04ee0c66ff2e389de47117ce6e0dd833b/server/drivers) | `codex.ts`, `codex-device-auth.ts`; official app-server protocol and CLI-owned device login | Evaluate as an adapter, not a replacement control plane. Audit retries, helper/child events and preapproved MCP defaults against our effect/settlement policy. Root `turn/completed` alone is insufficient. |
| [Rakazo desktop](https://github.com/elie222/rakazo/tree/b286fc4a5d0f608005000ef35bee4c473c31a165/apps/desktop/src) | `main.ts`, `setup-config.ts`, `preload.cjs`; remote-instance selection, origin-partitioned sessions and narrow native bridge | Smaller-shell alternative to OpenMausBot, not a second desktop stack. Replace Rakazo health/auth/setup assumptions; no local Docker stack or Rakazo backend required for our client. |
| [Rakazo chat renderer](https://github.com/elie222/rakazo/blob/b286fc4a5d0f608005000ef35bee4c473c31a165/packages/chat-ui/src/markdown.web.tsx) | Safe Markdown/links, streaming incomplete-code handling | Preserve sanitization and link policies; adapt dependencies/styles only if extraction saves work. No requirement to port its full monolithic shell. |
| [Rakazo viewer proxy](https://github.com/elie222/rakazo/blob/b286fc4a5d0f608005000ef35bee4c473c31a165/apps/web/src/screen-proxy.ts) | Credential stripping, authorized stream targets and periodic revocation checks | Node proxy is not a Worker drop-in. Use supported provider/runtime transport; enforce view-only versus control on the server, not solely in viewer UI. |

Both candidate Mac UIs are Electron applications, not native SwiftUI/AppKit interfaces. Installable Mac packaging is the desired outcome; do not promise the latter from reused web components. Keep the browser portal usable without installing a client, and keep Electron off the execution VM. System-WebView alternatives remain possible if a bounded comparison establishes lower maintenance/footprint, not as an additional framework mandate.

### 21.5 Sign-in and managed-host onboarding

Prefer the official CLI-owned device-login pattern when direct Codex is selected: authenticated portal starts a fixed bounded login command on the customer's runtime, presents the official verification link/code, and reports status. User authorizes on OpenAI's site; raw OAuth credentials remain with the runtime, outside portal responses, logs and templates. Verify login with the same executable/environment that executes work. Handle expiry, cancel, concurrent clicks, already-connected accounts and logout without overwriting another identity. Use a bounded setup activity hold during authentication, then release it; do not suspend while a credential write is in flight.

Any reused login UI must invoke the official Codex-owned flow. Do not mix another adapter's refresh ownership or treat auth caches as interchangeable.

Managed subscriptions, if offered, sell runtime hosting/setup, not shared model access. Keep self-hosting/export available. Customers authorize their own eligible model and connector accounts; ChatGPT Plus is an expected starting point, not a guarantee of model availability, unlimited usage or permitted hosted execution. Verify current terms and quotas before launch; no pooled credentials or hidden API-billing fallback. Managed onboarding should avoid requiring customer infrastructure accounts while explaining remaining account/connector/device approvals. Provisioning, billing and multi-customer deployment are not authorized by this spec pass.

### 21.6 Incremental acceptance and implementation gates

All rows are **pending**, even where upstream code or existing synthetic tests cover part of them. S01–S32, O01–O09 and UX01–UX15 remain applicable. Passing a shell test does not enable production execution.

| ID | Required distinguishing test | Evidence boundary |
| --- | --- | --- |
| R01 | Mac-shell/portal login, origin switch, revoked login, external navigation, native-IPC denial and closed-client remote task completion | Browser/security tests in orbs; actual Mac packaging, notifications, updater and signing on Mac/release infrastructure |
| R02 | Disconnect between partial text and final commit; reconnect with expired cursor; switch bots; recover one attributed final result and no second submission | Real Worker/SQLite + representative rendered UI; upstream mocked SSE tests insufficient |
| R03 | Device login success/expiry/cancel, duplicate clicks, existing different account, runtime restart and later refresh; no raw credential output | Synthetic CLI fixtures first; isolated owner-authorized real login and read-only turns separately; no auth transfers between orbs |
| R04 | Two tasks contest one browser/device; view-only input rejected server-side, manual handoff exclusive, stale frame after cold restart rejected | Linux browser/GUI fixtures in orbs; actual Mac permissions remain hardware acceptance |
| R05 | Chat and due schedule race while asleep; single admission authority, one occurrence each; active silent/tool/child work blocks drain; stale epoch cannot execute after wake | Deterministic crash/race tests in two independent orbs, then selected-provider sleep/hold/restart proof |
| R06 | Clean build/import with enterprise folder unavailable; inspect production bundle/dependency notices; clean second installation preserves config and imports disabled routines without credentials | Reproducible Apache-only extraction and setup; no assertion of full legal clearance from automated checks |
| R07 | Open idle client and reconnect cause zero model/wake requests; close live viewer and release only its hold; compare idle/active billing for the real schedule workload | Instrumented orb counters first, then live provider billing/usage plus seven-day sample; no dollar claim from mocks |
| R08 | Run skill → edit → routine → duplicate alarm → crash after effect/before delivery → recover without repeated effect; test exact steer of A while B continues | Integrated application/native evidence, synthetic effects plus bounded real-model evaluation; capability gaps block affected work |

Delivery order: (1) Apache provenance/dependency audit and bounded client/adapter comparison; (2) one retained-control-plane chat/task/result/restart path; (3) supervisor and sleep correctness before automatic idle; (4) full skill/routine, memory, artifact and collaboration UX; (5) desktop/handoff/teaching, templates and setup polish; (6) provider/account/hardware acceptance, measured cost and staged release. Client work can use synthetic backends while execution remains gated, but must not redefine backend truth to match upstream UI assumptions.

For full product completion, require this combined scope, not only the older core Definition of Done. Keep each failure classified as implementation work, upstream unsupported capability, external authorization/hardware blocker or explicit product difference. Do all reproducible debugging in orbs first; a Mac-only or provider-specific check is a final acceptance boundary, not an excuse to defer integration debugging. This document completes planning only and does not claim an operational assistant or authorize implementation to begin automatically.
