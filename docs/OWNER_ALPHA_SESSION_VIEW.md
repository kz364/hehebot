# Owner-alpha session view

The public `GET /v1/state` summary retains `owner_alpha: true` and adds only:

```ts
owner_alpha_session: {
  persona_id: string;
  expires_at: string;       // fixed UTC ISO instant
  max_runs: number;
  admitted_runs: number;
  max_task_seconds: number;
}
```

Both fields are absent for ordinary installations. This is an explicit public projection, not a spread of the private policy. It contains no session ID, bearer token, boot identity or admitted run IDs. Internal runtime `/status` retains its existing exact shape and private policy.

`admitted_runs` is the length of `runtime_metadata`'s `owner_alpha.admitted_run_ids`, written by the existing admission authority. Queued messages, visible run rows, provisional previews and root outcomes are not quota counters. Cancellation, expiry and reconstruction do not refund admissions. Reading the projection does not mutate custody, infer or wake a runtime. Missing or mismatched custody fails closed.

The existing portal banner identifies the authorized persona, remaining admissions, fixed deadline (in the browser's timezone, with zone label) and per-task limit. Other personas and rooms, exhausted/expired sessions, missing or changed policy details and offline observations close the new-message composer. Draft text is retained. Both the disabled Send control and the submit handler enforce the UI guard; the runtime/gateway remain the authority, including races with another tab or an admission between polls.

The short-lived gateway exposes conversation events/tasks/recovery only for the authorized persona. The portal skips those reads for other personas and rooms and labels their history/task pages unavailable, rather than falsely showing a lost connection. `/v1/state` is not filtered: this is sole-owner session scope, not persona confidentiality. Cached/public snapshot data is not a substitute for fetching restricted conversation pages.

The page remembers the maximum observed admission count. A 250ms local timer checks the original absolute deadline and a monotonic elapsed-time deadline, latching expiry without a fetch or write. Clock rollback, stale lower counts and changed deadlines cannot reopen that page. A different session requires a reload and fresh review. This is not trusted server time: an initially incorrect client clock can affect the displayed deadline check; server admission still enforces the actual deadline. Ordinary existing five-second state refresh remains unchanged and does not execute inference.

History, provisional previews, recovery inspection and exact task cancellation remain available. Successful root output is not a completed result, confirmed child/tool/effect settlement, or proof of safe recovery. This change enables neither external effects nor automatic recovery. It does not implement gateway authentication or the host launcher.

## Credential-free verification

```sh
npx vitest run tests/owner-alpha-session-view.test.ts tests/owner-alpha.test.ts
node scripts/test-portal-alpha-session.mjs
node scripts/test-portal-task-cancel.mjs
node scripts/test-portal-recovery.mjs
node scripts/test-portal-output.mjs
```

The SQLite test exercises actual lifecycle claim custody, queued-versus-admitted counts, cancellation, reconstruction, expiry, absent alpha and the exact public key set. Existing owner-alpha tests verify unchanged internal status and durable admission fencing. Browser fixtures exercise ordinary/available sends, wrong persona/room, offline, exhaustion, stale counters, timer-only expiry, clock rollback, changed/missing session data, history/previews/recovery and exact cancel after expiry. They count commands to detect automatic writes and reject programmatic submit while closed. Screenshots cover default, available, exhausted, expired and wrong-persona states at 2× Chromium resolution.

These synthetic checks do not prove live gateway authentication, launcher integration, model output, account access, provider behavior, native settlement or production readiness. Production gates remain false.
