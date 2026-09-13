# Transient Gateway lifecycle review

Status: proposed design, 2026-09-10. No runtime or cloud changes. This review supplements the main specification. Numeric timeouts are proposed initial defaults, to be tuned by measurement; they are not upstream guarantees.

## Minimal topology and boundaries

Use one authenticated portal Worker and one SQLite-backed Durable Object per personal installation for durable event receipt, schedules, lifecycle arbitration, and status. The object is a control plane, not an LLM agent or duplicate memory store. Run exactly one resumable Fly Machine with one persistent volume, containing the sole authoritative OpenClaw Gateway, its state, and its browser profiles. Stop and restart that same Machine between jobs; do not create a fresh brain per message. Keep the Mac an optional remote tool node.

The portal owns receipt records, schedule definitions, wake epochs, and projected job status. OpenClaw owns runtime transcripts/memories. Each record has one writer and a stable identifier; status synchronization is a projection with acknowledgements, not two writable copies of agent memory. A job is first durably accepted by the portal, then delivered at least once and deduplicated by its stable event ID at the Gateway adapter. Portal acknowledgement means accepted, never completed.

Provider capabilities: Fly can start existing stopped Machines, but proxy-based autostop considers request load, not internal background work. Disable proxy autostop and let the supervisor control shutdown. A stopped Machine remains reusable; scaling must stay at one. [Fly autostart](https://fly.io/docs/launch/autostop-autostart/), [background lifecycle](https://fly.io/docs/blueprints/long-running-tasks/)

Cloudflare alarms wake the control object, with at-least-once delivery and limited automatic retries. One object has one alarm, so store the complete due-time queue and arm its earliest schedule, watchdog, or retry. After processing, re-arm from durable state; never rely on an in-memory timer surviving. [Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)

## Single writer and fencing contract

Control record: `installation_id, machine_id, boot_id, epoch, phase, lease_until, last_heartbeat, pending_event_sequence, stop_token, provider_operation_id`.

1. Each boot obtains a monotonically increasing epoch from a transaction in the control object. Bind it to the configured Machine ID and unique boot ID. Coalesce simultaneous wake requests into one lifecycle operation.
2. The supervisor acquires an exclusive OS lock on the persistent state directory before starting the Gateway. A second Gateway process must fail closed. The control plane never starts a replacement Machine merely because heartbeat expired.
3. Heartbeat every 15 seconds; proposed lease 90 seconds. Every claim/ack/status/action authorization includes epoch and boot ID. Reject stale epochs. Local supervisor must cease admitting work when it cannot renew, and stop child process groups before its lease expires, using a safety margin.
4. Lease expiration alone DOES NOT fence an old browser or arbitrary external website. The control plane must confirm the old Machine is stopped through the provider before advancing to replacement execution. If provider state is ambiguous, hold queued work and display recovery needed. Favor waiting over concurrent side effects.
5. For the normal same-Machine restart, a confirmed provider stopped state plus state-directory lock establishes process exclusivity; epochs prevent late network acknowledgements from a previous boot contaminating current state.
6. Replacement/restore is a maintenance operation: stop old Machine, verify stopped, revoke its service credential, then mount/restore state and assign a new machine identity/epoch. A volume snapshot clone is never started as a parallel production Gateway.

The volume is not an availability guarantee: Fly volumes are local to a host, attached to one Machine, and not automatically replicated. This design accepts recovery downtime and requires separate encrypted backups; it deliberately does not create a second live agent. [Volume model](https://fly.io/docs/volumes/overview/)

## Wake and sleep race protocol

States: `STOPPED → START_REQUESTED → BOOTING → READY → DRAINING → STOP_COMMITTED → STOPPING → STOPPED`; errors enter `RECOVERY_REQUIRED`. The desired state (`RUN` when runnable events exist) is separate from observed provider state.

- Intake transaction deduplicates and persists event, increments queue sequence, and updates desired state. Only afterwards request wake; a failed API call leaves the event durable and retries bounded by policy.
- Ready requires state mount/lock, epoch lease, Gateway authenticated health, adapter readiness, and recovery scan. WhatsApp/browser readiness is per capability; portal chat need not wait for WhatsApp when unrelated.
- Before draining, supervisor proves the sleep predicate below. Controller issues a stop token tied to epoch and current queue sequence. Stop accepting work before collecting the final checkpoint.
- New event during `DRAINING`: invalidate token and resume admission if shutdown has not committed. New event after `STOP_COMMITTED`: preserve event, set `wake_after_stop`, let stop finish, then start. Never send concurrent start/stop operations with uncertain ordering.
- Commit stop only if token/epoch/queue sequence still match and no runnable work or live operation exists. Flush state, close browser gracefully, persist final status, and request/perform stop. Controller confirms provider state before marking `STOPPED` and reconciles queued work again.
- Crash after stop commit but before actual stop: external watchdog completes/reconciles stop. Crash after stop but before status acknowledgement: provider stopped observation reconciles status and triggers pending wake.
- Retry after receipt without acknowledgement must not create a duplicate event, schedule occurrence, or job. A scheduled occurrence key is `(schedule_id, schedule_version, nominal_due_at_utc)`.

## What counts as activity

Do not infer idleness from no chat traffic, low CPU, an idle HTTP proxy, or lack of model tokens. Use an explicit operation registry: `operation_id, job_id, kind, started_at, deadline_at, last_progress_at, cancellation_state, side_effect_class, checkpoint_ref, epoch`.

Sleep predicate: zero running/claimed runnable jobs; zero active inference requests, tool calls, browser navigation/uploads/downloads, shell processes, Mac-node calls, checkpoint writes, and delivery acknowledgements; no uncommitted side effects; no pending intake race; no explicit bounded interactive hold; all waiting jobs durably parked; idle grace elapsed (initially 60 seconds). Passive WhatsApp connectivity and an open portal tab do not keep compute alive. Internal no-op bot synchronization is durable metadata and must not call an LLM or reset idle grace.

Instrumentation must wrap the actual inference/tool boundaries. A periodic Gateway health ping is insufficient. Implementation gate: demonstrate that the selected supported OpenClaw adapter exposes every required start/end/cancel signal. If coverage is incomplete, keep compute alive conservatively and report the gap; do not claim safe autosleep.

Human waits:

- Persist `WAITING_USER` with exact prompt, artifact/checkpoint, resume token, expiry, and authorized action scope. If all tools are closed, the Machine can sleep. The portal receives the reply and wakes/resumes the job.
- A CAPTCHA or an in-progress form may depend on live DOM/browser memory; cookies alone are not a resumable checkpoint. Offer a bounded interactive hold (initially 10 minutes), then park with a clear “page must reopen/revalidate” status. Never silently promise exact resume.
- `WAITING_NODE` records required Mac capability and expiry. Sleep until a genuine node-availability trigger or user retry; no repeated polling wake loop. External provider callbacks can wake a parked async job; otherwise schedule a bounded polling alarm and account for its cost.

## Stuck jobs, cancellation, and side effects

Track process heartbeat separately from useful job progress. A responsive supervisor can accompany hung inference; lack of streamed tokens can also be legitimate reasoning. Each operation needs a kind-specific deadline plus a job wall-clock/budget limit. Suggested initial defaults: wake ready deadline 120 seconds; tool default 120 seconds with explicit upload/download overrides; inference watchdog 10 minutes unless provider-specific limits justify otherwise. Do not use arbitrary output silence alone to kill a healthy task.

Watchdog sequence: flag overdue → request cooperative cancel → allow 30-second grace → terminate owned process group if necessary → reconcile external effect → checkpoint terminal/parked state. A stale Machine heartbeat triggers provider inspection, not immediate duplicate execution. The always-available control plane schedules the watchdog while work is live; it does not wake a stopped Machine merely to discover there is no work.

| Failure class | Automatic handling |
|---|---|
| Read-only operation before durable result | Retry at most twice, with backoff/jitter and remaining budget |
| Deterministic local computation/write with atomic replacement | Retry from checkpoint, same idempotency key |
| External API supports idempotency key | Reuse same logical action key; inspect status before retry |
| Form submit, chat send, payment, or other non-idempotent action with response lost | Mark `OUTCOME_UNKNOWN`; inspect receipt/site/provider evidence; no blind retry |
| Authentication revoked, QR required, permissions missing | Park `WAITING_USER`; suppress reconnect storm |
| Inference quota/rate limit | Persist retry time or wait for user; no automatic paid-provider switch |
| OOM/process crash | Preserve crash evidence, recover jobs; classify effect state before retry; no unapproved size escalation |

Persist an action journal before dispatch: `action_id, job_id, intent_hash, target, authorization_ref, idempotency_key, phase` where phase is `PREPARED`, `DISPATCHED`, `CONFIRMED`, `FAILED`, or `OUTCOME_UNKNOWN`. A cancellation request is not proof the external action was cancelled. After dispatch, browser/network results may arrive late; retain correlation IDs and show confirmed outcomes accurately. Exactly-once external effects cannot be guaranteed against arbitrary websites; acceptance tests must prove duplicate prevention where supported and safe ambiguity handling elsewhere.

## WhatsApp cold-start gate

OpenClaw owns the WhatsApp socket. Credentials can persist across disconnects; explicit logout deletes account authentication. Outbound sending needs a live listener. The documentation distinguishes reconnect catch-up from initial startup, which retains a stale-history guard. Therefore durable login does not establish complete recovery of messages received while asleep. [WhatsApp runtime and credentials](https://docs.openclaw.ai/channels/whatsapp)

Preserve the complete configured WhatsApp auth directory and Gateway state, not merely one credential file. Never call logout during sleep. Record sync attempt start/end, per-chat message IDs, dedupe records, latest observed timestamp, and an explicit completeness status (`unknown`, `observed_test_coverage`, `gap_detected`). A latest-seen timestamp is not a proof of completeness. Store inbound messages idempotently before invoking an agent. Disable unsolicited catch-up replies for monitoring-only routines.

Before declaring periodic monitoring supported, test real cold process starts after 1 minute, 1 hour, overnight, and an extended offline interval. Send uniquely labelled DMs/group messages plus an attachment while asleep; compare transport delivery, durable ingestion, agent retrievability, duplicates, ordering, and auth persistence. Include crash before flush, repeat wake, network outage, credential revocation, and large catch-up batch. No claim of full historical access merely because one reconnect works. If stock Gateway filters catch-up messages, record the capability gap; a reviewed adapter change or alternate ingestion path is a separate design decision. If completeness cannot be established, offer best-effort explicit checks or retain a small listener as an optional cost/architecture change.

## Cost model and controls

Target: approximately $5/month infrastructure at light measured use, excluding existing ChatGPT subscription and any separately authorized inference. This is an engineering target, not a price or reliability promise.

`monthly_total = control_plane_floor + control_usage + active_compute_hours × regional_hourly_rate + provisioned_volume_GB × volume_rate + stopped_rootfs_GB_month × rootfs_rate + snapshots + encrypted_backup_storage + egress + optional_IP/domain + taxes`

As checked 2026-09-10, Fly lists persistent volume capacity at $0.15/GB-month and stopped rootfs at $0.15/GB-month, both relevant here. Measure the built image and preserve those as separate costs. [Fly pricing](https://fly.io/docs/about/pricing/)

Cloudflare SQLite Durable Objects are available on Workers Free, with quotas and failure when free limits are exhausted. Avoid a continuously active object or non-hibernating socket. Workers Paid has a $5/month account minimum, which consumes the entire nominal target before the Machine. Show full-account cost separately from marginal cost if the user already pays for that plan. [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)

Illustration only: 10 GB volume = $1.50, 2 GB rootfs stored while stopped ≈ $0.30, leaving about $3.20 for compute and other items with a free control plane. Compute allowance is `remaining_budget/hourly_rate`; select regional size only after quoting its rate. Startup, shutdown, reconnection, inference waiting, human holds, and idle grace all consume active time. Ten 2-minute runs with 1-minute idle grace daily already use 15 compute hours/month, before startup. A 5-minute check schedule means 8,640 wakes in 30 days: not a light workload by assumption.

Meter provider-observed uptime, wake counts/reasons, cold-start duration, useful task time, idle/hold time, model usage and charge source, retries, bytes stored, and egress. Alert at 70/90/100% of configured target. At cap, stop admitting optional background work and park it; do not kill a dispatched side effect to enforce an approximate dollar limit. Estimates cannot impose an exact provider billing cap. Show degraded/paused routine state in the portal.

## Required failure-injection tests

1. Concurrent schedule/chat triggers produce one boot and one execution per event ID.
2. Inject new work at every drain/stop boundary: all jobs eventually execute or show a durable explicit block; none disappear.
3. Long silent inference, stalled download, active Mac call, shell child, and checkpoint flush each prevent normal sleep.
4. Lost lease plus network partition never starts a competing worker while old provider state is unknown.
5. Crash between dispatch and receipt never blindly resends a non-idempotent action.
6. Killing Gateway while supervisor lives is detected; killing supervisor is detected externally.
7. Human reply after shutdown resumes correct parked job once, with original scope and fresh page validation.
8. Duplicate alarm, exhausted alarm retry, DST transition, schedule edit, and missed occurrence policy preserve correct nominal occurrence keys.
9. Portal remains usable with sleeping/failed Machine; queued receipts survive controller restart.
10. Restore encrypted backup onto a replacement only after old executor is stopped; validate state and browser auth without assuming either survives indefinitely.
11. Seven-day cost sample reports actual active seconds and projects monthly cost, including fixed costs; separately run WhatsApp cold-start matrix above.

## Decisions before implementation

Pin the deployed OpenClaw version and verify operation/cancellation hooks; select a regional Machine rate and storage budget; choose best-effort versus completeness-gated WhatsApp monitoring; define schedule misfire policies (coalesce, skip, or bounded replay) and user timezone semantics; decide maximum interactive hold and background budget. These are implementation gates, not reasons to provision an always-on VM by default.
