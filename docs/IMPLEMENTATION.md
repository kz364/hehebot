# Implementation status

Hehebot is a locally tested foundation, not an operational assistant. Direct Codex app-server **0.154.0** is the only supported harness. No cloud deployment or authenticated inference has been completed; production execution and native-verification flags remain false.

**Progress checklist:** [TODO.md](../TODO.md) is the maintained owner-facing view of completed local deliverables, remaining work, next priority and account/device blockers. This document retains detailed evidence; the specifications retain acceptance requirements.

Latest checkpoint (2026-09-16): unsupported live native item boundaries now trigger conservative recovery instead of silently escaping operation accounting. Unknown payloads are not buffered or journaled; user-message echoes remain ignored. This refuses unsupported paths rather than implementing their coverage. Verification passed 63 focused router/operation tests and 901 control / 237 runtime combined tests, all native/service fixtures, typecheck and build. Recovery does not establish native termination, permit replay or authorize sleep. See [service contracts](CODEX_SERVICE.md), [TODO](../TODO.md) and [handoff](HANDOFF.md). No production gate changed.

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
