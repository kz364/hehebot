# Implementation status

Hehebot is a locally tested foundation, not an operational assistant. Direct Codex app-server **0.154.0** is the only supported harness. No cloud deployment or authenticated inference has been completed; production execution and native-verification flags remain false.

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

Captured task contexts, attempts/outbox results, follow-ups, revisions, native
data and backups remain outside this cleanup.
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

The active-native-crash fixture verifies fencing and restart refusal during an
open root turn, not successful resume. The [offline recovery diagnostic](CODEX_RECOVERY.md)
projects current task identities and observed obligations without credentials,
network calls or state writes; unknown coverage remains a blocker.

[Selected portable templates](PORTABLE_TEMPLATES.md) export configuration into
disabled routines and pending skill proposals with grants removed. This is an
offline review plan, not full backup/restore or automatic migration.

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

1. Promote the disposable service composition only after complete operation coverage, safe recovery/resume and warm/cold lifecycle evidence. Disconnect, lease-loss and uncertain-admission fixtures do not establish production recovery.
2. Complete owner-authorized Codex login in the executing environment and verify model eligibility, no paid fallback, bounded inference, restart continuity, refresh ownership, and concurrent-turn behavior.
3. Establish authoritative recursive child/tool/effect settlement and exact cancellation. Root completion or cancellation acknowledgment is insufficient.
4. Complete intent-aware status/new-task/steer/deferred-follow-up behavior and the full portal/mobile/accessibility UX.
5. Verify every connector operation and scope independently, including Calendar writes, Gmail no-send enforcement, WhatsApp coverage, browser persistence, and Mac Messages/device permissions.
6. Complete retention, coordinated backup/restore, portable export/import, reconciliation UI, monitoring, crash tests, seven-day cost evidence, and production Access.

Passive context updates must remain zero-inference/zero-wake. Unknown effects remain parked, admitted work retains pinned policy/context identity, and one customer runtime remains the sole execution authority.
