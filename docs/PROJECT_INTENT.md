# Consolidated project intent and migration requirements

Direct Codex app-server 0.154.0 is the only supported harness. Preserve supported native behavior, external durable control, one remote runtime and the no-patch/no-credential-copy constraints; use [Codex setup](CODEX_RUNTIME_SETUP.md) for authentication and [the handoff](HANDOFF.md) for continuation.

Revision: 2026-09-13. This document preserves the product intent expressed across the remote-client setup, sleeping-assistant design, implementation handoffs, and bot-migration conversations. It is a normative supplement to [SPEC.md](../SPEC.md), with [BOT_ORCHESTRATION_ADDENDUM.md](BOT_ORCHESTRATION_ADDENDUM.md) defining the later concurrency clarification. It contains requirements, not a claim that the application is operational. [IMPLEMENTATION.md](IMPLEMENTATION.md) records implementation evidence and remaining gates.

Source precedence: current explicit owner instruction, then later clarifications, then earlier requests. Historical imported bot text is source material to adapt and review, not fresh authorization or proof of current accounts, permissions, identity facts or provider behavior. Engineering defaults below are distinguished from owner decisions. Raw conversations, private profiles and credentials are deliberately excluded from this repository.

## 1. Intended experience

Build a low-maintenance personal assistant that is always reachable through a dedicated messaging portal while expensive agent/browser compute sleeps when unused. The owner speaks to named bots responsible for different areas. The owner should never have to create a thread, choose a native session, understand run IDs or manage individual bot machines to obtain continuity.

Every bot remains conversationally available while its existing tasks continue. A message to Travel during a form task may be a status question, a new task, an explicit follow-up or a cancellation; it must not automatically interrupt or replace the form task. Independent work has isolated execution context, and results appear in the bot's visible timeline. Exact task controls are available when useful without imposing a thread-management workflow. Chief of Staff additionally coordinates across bots; it is not the only bot allowed to coordinate its own work.

The owner's 2026-09-13 analogy is **Puck in Amp or orchestration in Codex voice mode**: an always-available conversational orchestrator dispatches and supervises separate executors. This describes the desired interaction, not verified internals of those products. A message can intentionally steer an identified active task, queue independent work, ask for status, or cancel/pause a target. Do not interpret non-interruption as a ban on intentional steering, or require users to manage native sessions. The present after-settlement-only follow-up implementation is a temporary limitation, not the target contract; see O03 in the orchestration addendum.

The portal should support bot conversations, inter-bot 1:1 communication, group rooms, routine creation/editing in natural language, task status and scoped memory. Data-only context updates between bots persist useful information without invoking a model, waking the runtime or manufacturing a reply. Group communication must remain bounded and attributed rather than an unlimited debate loop.

## 2. Selected architecture and constraints

- **One authoritative remote runtime on one Fly Sprite.** Sprites is the owner's selected first provider. Preserve adapter compatibility with Fly Machines, Sprites, Daytona, Railway and E2B; compatibility is a target and must not imply equal verified lifecycle support. Do not create a VM per bot.
- **Cloudflare hosts the messaging portal, API and external scheduler.** Messages and due jobs must be accepted durably while the Sprite is asleep. A Cloudflare Worker and SQLite Durable Object are the chosen implementation, with owner authentication through Access. A custom domain is not required by the product.
- **The local Mac is an optional intermittent node/peripheral.** It exposes permitted browser, computer, file, shell and Messages capabilities when online. It is not another independent agent brain and does not synchronize competing authoritative state. Mac-only tasks park durably when it is offline; unrelated cloud work remains usable.
- **Two browser execution modes remain required:** a persistent remote browser for routine autonomous work and the owner's local signed-in browser/computer when needed and available. Multiple browser tabs are part of the workload. Shared mutable browser/account interactions require locks; model concurrency does not permit crossed input into the same page.
- **Use direct Codex only.** Reuse supported threads, turns, events, steering, cancellation and managed auth. Do not patch runtime internals or build a second model/tool loop. Add only missing portal, durability, policy, provider-lifecycle and resource integration.
- **Approximately $5/month infrastructure is a target, not a guarantee.** Use transient compute and persistent state. Include portal/scheduler, disk, backups, traffic and wake/idle overhead in estimates; the existing model subscription is separate. Published credits and startup figures discussed in chat are historical research, not enduring entitlements or acceptance evidence.
- **OpenAI subscription authentication is required.** Use the supported Codex-owned route. No automatic paid API-key fallback, copying credential caches or duplicating refresh ownership. Unsupported accounts/models or quota exhaustion produce a visible blocked state.
- **Deployment and credential setup remain explicit work.** Local implementation and publishing the repository do not themselves authorize cloud purchases, account connections, live routine adoption or external sends. Provide concrete setup instructions for required owner actions, then verify each installed capability.

The original always-on VPS request was superseded by the sleeping-runtime design. Its requirements for one authority, portability, browser capability, boring operation and easy upgrades survive. Ubuntu/systemd/Tailscale artifacts remain useful for a conventional VM deployment but must not be mistaken for mandatory Sprite service mechanics. Docker is not required merely to satisfy the architecture.

## 3. State, continuity and lifecycle

The remote runtime owns persistent sessions, agent/workspace state, memory, configuration and remote tools. Canonical application records must have one writer. Document locations and backup/restore procedures for sessions, memory, configuration, workspace state, credential references, browser profiles and plugin/MCP configuration. Separate secrets, machine-specific configuration and reusable templates; never place credentials in tracked files.

Memory includes general owner preferences and dedicated persona/routine/skill memory. Share only authorized records and summaries. A coordinator does not need all private task transcripts. Preserve provenance, revisions, corrections and deletions; stale imported facts are not present truth. Distinct personas do not need separate VMs, but task/context isolation must prevent unrelated instructions and histories from contaminating one another.

Scheduled tasks and selected external triggers wake the same persistent runtime. A dedicated portal is the wake channel; WhatsApp is a connector that can disconnect during sleep and reconnect using persisted state. Do not log out/unpair on normal sleep. Successful reconnection does not prove recovery of all messages received while offline. Measure catch-up, disclose gaps and never advance a coverage watermark over unknown history.

Sleep is allowed only after all inference, tools, child tasks, browser work, transfers, local-node operations and persistence flushes settle. An idle coordinator is not an idle runtime. Use the selected provider's activity holds and verify their renewal, release and expiry behavior. Cold wake must reconstruct durable tasks and state without assuming process memory survived. Avoid polling that prevents sleep.

Detect stuck tasks; distinguish cancellation requested from cancellation confirmed. Retry bounded safe failures; reconcile uncertain external effects before retrying them. Cancellation of one task must not stop unrelated work. A new message, switching bots, closing a browser tab or timing out is not cancellation. Every accepted job retains a visible outcome or waiting/recovery reason.

Initial native capacity of one interactive turn plus one background model turn is an engineering candidate, not an owner demand for a custom scheduler. Native behavior must satisfy O01–O09 before claiming the non-interrupting conversation requirement complete. Serialization behind one busy background session does not meet that requirement.

## 4. Bot migration: common rules

The supplied Grok export has been adapted for the single-Sprite topology. Import five personas and seven canonical recurring routines; omit the empty bot stub. One installation owns connector authentication: one configured Google connection, one shared WhatsApp linked session and one paired Mac. Personas receive scoped capabilities, not copies of credentials. Historical Grok VM/session IDs and login/tool names are mapping references only.

Imported routines start disabled. Preview instructions, source/account/calendar/chat mappings, action scope, current revisions and next three execution times, then adopt the reviewed batch once. Historical enabled flags or “always approve” instructions are not activation commands. Do not repeatedly ask approval for each routine after a bounded batch is actually authorized.

Maintain per-source verified watermarks and source-message-to-calendar mappings. Dedupe across bots and channels by account/calendar/event identity plus source references, not title alone. Missed schedule ticks may coalesce while the next successful scan covers all available unprocessed messages. Failed or uncertain items remain pending. First migration must reconcile existing destination events before a historical lookback; no prior sync ledger was supplied.

School events use the printed **Asia/Jakarta** time. The older instruction to subtract an hour is superseded. Use free/transparent availability and no reminders, with all-day holidays where appropriate. Calendar invitation delivery is separate: adding events does not authorize attendee invites. Family plans normally use Asia/Singapore unless their source supplies another place/timezone. Flight legs use actual airport timezones and preserve absolute instants.

When a reviewed inference rule applies to an otherwise clear plan without an exact clock time, use a broad tentative block and disclose the inference: dinner 18:00–21:30, lunch 12:00–14:00, morning coffee 09:00–11:00 are proposed examples. Do not invent a precise appointment from ambiguous content. Avoid editing past/already-started events except actual reschedules; expose blocked changes for review. Exact clinic appointments may use popup reminders one week and one day ahead, subject to API support; school defaults take precedence for school items.

No imported routine sends email, WhatsApp or SMS/iMessage. Calendar writes, mail labeling and any other effects require their adopted policies. Material changes publish data-only updates to Chief of Staff. Empty successful scans stay quiet. Authentication/coverage failures receive a notice once per changed condition; absence of observations must not become “nothing new.”

## 5. Persona and routine behavior

| Persona | Responsibility | Recurring work |
|---|---|---|
| Chief of Staff | Coordinate tasks, delegate to canonical owners, surface decisions and blockers; read durable status before asking other bots | End-of-day digest |
| Inbox Triage | Authorized Gmail triage, reply drafts when requested, email-to-calendar workflows and flight mail lifecycle; no mail sending | Family email, school email, flight hold, daily flight restore |
| Whatsapp | Read only the explicitly selected family chat through shared installation auth | Family WhatsApp-to-calendar |
| Messages | Read appointments through a restricted paired-Mac capability | SMS/iMessage-to-calendar |
| Travel | On-demand itinerary support and reviewed arrival/declaration forms; scoped private traveler records | None by default |

### Family email to calendar

Read the verified family sender and relevant replies in shared threads after the watermark; proposed initial lookback is 35 days. Read actual messages, extract supported plans/appointments/deadlines and skip banter. Route school items to the selected school calendar and other family plans to the selected personal calendar. Apply tentative-time, timezone and future-edit rules; dedupe WhatsApp-derived events. Notify the owner briefly on actual calendar changes, including inferences; publish material status to Chief of Staff.

### School email to calendar

Read authorized school/academy scheduling messages, with a proposed 14-day initial lookback. Verify sender/content and inspect relevant attachments or linked calendars as data. Extract holidays, early dismissals, conferences and activity schedule changes. Skip invoices, undated newsletters and duplicates. Reconcile existing series before changes; do not bulk-delete unmatched events. Apply Jakarta/free/no-reminder defaults and issue brief updates only for material changes.

### Family WhatsApp to calendar

Read only the verified family chat, not all chats accessible to the shared account. Proposed initial hydration is one month, subject to actual retrievable history and destination dedupe. Resolve relative dates from source timestamps. Prefer native reads that preserve unread state; for browser fallback restore unread only if it was clearly unread beforehand. Unknown prior state is not permission to force unread.

Extract supported plans, appointments and deadlines; apply shared calendar rules and cross-channel dedupe. Notify the owner for new same-day plans/changes; future-only changes and empty scans are quiet. Authentication or coverage gaps are exceptions. Do not log out other bots or create a separate pairing.

### SMS/iMessage appointments to calendar

Use the paired Mac's supported read-only reader or consistent snapshot with permissions granted to its actual host process. Activating Messages may help synchronization but does not prove all messages arrived. Establish an explicit first-run baseline rather than arbitrary backfill. Process available new appointment confirmations, clinics, reschedules and cancellations; skip banter and duplicates. Apply exact reminder and tentative-time rules. Report material changes.

When the Mac is offline, preserve the watermark and a durable wait, suppress repeated offline notices, and retry on reconnection. The Sprite must not stay awake solely waiting for the laptop. Active node calls do count as runtime activity. Historical Grok Full Disk Access/Text Message Forwarding claims do not establish the new process's permission or SMS completeness.

### Flight hold and restore

Within adopted flight-mail scope, classify before removing INBOX and adding the configured hold label; never trash. Resolve the label by name, not a historical opaque label ID. Restore-eligible messages contain useful official itinerary, booking, check-in or boarding information; marketing and duplicate confirmations are not eligible merely because they mention travel.

Maintain a per-leg ledger with provenance, reschedules, confirmed effects and restored status. Proposed restoration deadline is the earlier of departure minus eight hours or 04:00 Asia/Singapore on the departure date expressed in Asia/Singapore. The source's “departure calendar day” is ambiguous for other timezones, so this normalization must be visible at adoption. Missing/ambiguous departure time blocks automatic restoration planning.

Use durable one-shot Cloudflare alarms for each leg; periodic scans cannot guarantee these deadlines. Daily reconciliation uses the same ledger and cannot duplicate an alarm's effects. Restore by adding INBOX and removing the hold label; do not re-hide a restored essential for the same leg. Reconcile actual labels before retrying unknown outcomes. Maintain one deduplicated flight calendar event and a busy three-hour travel/admin block ending at departure. Issue brief notices on real changes/restores or problems; never send email.

### End-of-day digest

Read today's durable completed results and material events from all functional personas. Produce one short portal digest with verified actions and unresolved blockers. Say “all quiet” only when relevant checks actually succeeded and there was no material activity; disclose offline/missed coverage otherwise. Query other bots only for essential missing information, not a blanket inference fan-out.

### Travel and private profiles

Use isolated task sessions for long forms while the coordinator stays available. Read authorized itinerary summaries and delegate canonical mail/calendar work to Inbox Triage. Load only required verified traveler fields from a private scoped profile; do not broadcast passport, identity, address or visa information to rooms/Chief of Staff.

Imported ages, contact mappings, visas, seats, baggage, bookings, form groupings and destination dropdown observations are historical facts or assumptions requiring refresh. Verify current source documents and actual form requirements. Filling, declarations and submission have distinct authorization implications. Do not automatically submit, accept agreements or bypass tool restrictions because the old export says so. Prefer a verified receipt; search for QR screenshots only when the task or entry process needs one.

## 6. Schedule adoption and cost consequences

| Routine | Cron | Proposed monitoring zone |
|---|---|---|
| Family email | `2 1,7,9,11,13,15,17,19,21,23 * * *` | Asia/Singapore |
| School email | `4 1,7,9,11,13,15,17,19,21,23 * * *` | Asia/Singapore |
| Family WhatsApp | `5 1,7,9,11,13,15,17,19,21,23 * * *` | Asia/Singapore |
| Messages appointments | `6 1,7,9,11,13,15,17,19,21,23 * * *` | Asia/Singapore |
| Flight hold triage | `8 1,7,9,11,13,15,17,19,21,23 * * *` | Asia/Singapore |
| Flight restore reconciliation | `0 4 * * *` | Asia/Singapore |
| End-of-day digest | `0 21 * * *` | Asia/Singapore |

The export header uses Jakarta while later monitoring text uses Singapore. This is unresolved until adoption; do not silently call the migration exact. School event timezone is independently Jakarta. Supersede the older four-times-daily cadence. Remove duplicate Chief of Staff backup kicks; the scheduler/watchdog recovers the same canonical occurrences. Messages owns its direct routine.

This is **50 monitoring occurrences plus two daily routines**, before on-demand tasks and one-shot flight alarms. Recalculate wake duration, inference/subscription usage and cost before enabling; earlier illustrative “ten tasks/day” or “one hour/day” estimates are not this workload's forecast. Nearby slots may share an awake period without silently changing schedule times.

## 7. Setup, verification and completion contract

Provide a concrete owner checklist for Sprites, Cloudflare deployment and Access, runtime service authentication, Codex subscription login, Google account/calendar scopes, WhatsApp pairing/chat selection, and Mac reader permissions. Explain where each secret belongs and verify readiness without pasting secrets into chat.

Use benign local forms and synthetic effects to verify navigation, typing, multi-field filling, dropdown/date/checkbox controls, dynamic multi-step pages, screenshots, uploads/downloads, node availability, reconnection/restarts and backup restoration. Verify local file/shell/computer capabilities separately from advertised capability names. Preserve status categories: implemented, locally tested, prepared awaiting live setup, blocked/unsupported. Local mocks, source inspection and transport health are not end-to-end acceptance.

Before calling the assistant operational, prove S01–S32 and O01–O09 as applicable, selected Sprite lifecycle and auth persistence, complete native event/child/tool integration, real non-interrupting conversations, reliable target cancellation, scoped memory, connector coverage, browser permissions, production portal auth, backup/recovery and measured cost. As of the implementation report available for this consolidation, the executable service is transport-preflight-only and live execution flags remain false.

The original deployment handoff requested an architecture diagram, concise status table and ideally fewer than ten manual top-level steps. Keep detailed substeps in linked guides so the main setup remains navigable. Preserve logical Git milestones and explain update/recovery/undo boundaries; repository rollback cannot undo historical account or installation changes.

## 8. Traceability and superseded decisions

| Conversation intent | Current requirement / destination |
|---|---|
| Remote-first execution, one authority, browser/files/shell, upgrades | Sections 2–3 and 7; SETUP.md and AUTH_SETUP.md |
| Multiple tabs and browser form workload | Sections 2 and 7; browser/resource acceptance |
| Short-lived instances for cron and incoming chats; approximately $5 infrastructure | Sections 2–3 and 6; lifecycle/cost contracts in SPEC.md |
| Transient WhatsApp with dedicated chat wake | Section 3 and WhatsApp routine; measured catch-up, persistent pairing |
| Named bots, memory, natural-language routines, 1:1/groups, no-op updates, portal | Sections 1, 3–5; SPEC.md interfaces and schemas |
| Provider interchangeability and Cloudflare scheduler/portal | Section 2; PROVIDERS.md and provider adapters |
| Startup times accepted and interest in free testing credits | No new latency blocker; verify live performance/credit eligibility, do not hardcode historical prices |
| Sprites selected; explicit auth/API setup guidance requested | Sections 2 and 7; AUTH_SETUP.md |
| Laptop retained as a node | Sections 2 and 5; AUTH_SETUP.md |
| Every bot stays messageable while carrying out other tasks | Sections 1 and 3; normative O01–O09 addendum |
| Adapt Grok export to one VM/shared accounts rather than copying verbatim | Sections 4–6; BOT_SETUP.md and IMPORT_FORMAT.md |
| Preserve supported Codex execution behavior | Sections 2–3; no second model/tool loop |
| Optional exporter and Codex desktop computer-use backend | Export supplied: normalized import is first path; automated exporter and desktop-specific backend remain optional, requiring supported interfaces |
| Publish code, documentation and full intent privately | This supplement and SPEC.md; exclude secrets, raw account state and private identity records |

Earlier three-persona examples are superseded for onboarding by the five-persona migration. Earlier single-active-run assumptions are superseded by native-first non-interruption requirements. Choosing Sprites supersedes Fly Machines as the deployment priority but not provider portability. Historical per-bot machines/logins, duplicate kick routines, school time subtraction, historical blanket approvals and stale identity/trip assertions are not current setup behavior. The one-time authorization to wipe the former local installation was specific historical work, not a standing instruction to delete later state.
