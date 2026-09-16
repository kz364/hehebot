# Exact-task cancellation review (bounded E04)

Both timeline **Cancel** and task-card **Cancel this task** open the existing portal editor. Opening, closing, pressing Escape, switching conversations, or reconnecting sends no cancellation. The owner must check the exact-task affirmation and select **Request cancellation**. The review displays the selected title, run ID, observed attempt and status as text, not HTML.

Existing eligibility is unchanged: timeline controls allow queued, claimed, running and waiting tasks; cards also allow finishing tasks. Cancellation remains available with execution disabled. This does not change retry, steering, follow-up, recovery or backend authorization.

Before each submission, the editor checks both connection indicators (`Connected` and `navigator.onLine`), selected conversation identity/revision, navigation generation, source view, and the task's latest observed ID, owner, role, title, status and attempt. Snapshot reviews use `snapshot.runs`; paged reviews use the current task/recovery page, including tasks absent from the newest-run snapshot. Missing tasks, changed eligibility/attempts, page changes, and navigating away and back block submission. Entering a task/recovery view advances the existing selection generation so a return to messages cannot revive an old review.

**Client fence, not a server attempt guarantee:** `run.cancel` accepts only `run_id` and `reason`. There is no `expected_attempt` precondition. A task can change after the client check and before server application; this review cannot close that race. No new field, authority, execution gate, or termination claim is introduced. Cancellation does not prove executor/child/tool termination, roll back external effects or release retained locks.

## Uncertainty stays explicit

Each editor captures one immutable JSON envelope and a new idempotency key. Original entry-point reasons are preserved. Network loss, malformed/unrecognized receipts and HTTP 5xx responses conservatively show an editor-local uncertainty alert and **Retry same cancellation**. Only another explicit confirmed submission sends the identical bytes and key, after repeating the client fences. Refresh/reconnect never replays. A known rejected receipt or non-5xx HTTP rejection requires closing and refreshing; repeated submission in that editor sends nothing. Transport classification is local to this review and does not redesign other editors.

The key is editor-local, not persisted across reload/close. After closing an uncertain review, refresh and inspect task status before opening a new review. Idempotent request retry is not native task retry, effect replay or proof of settlement.

## Credential-free browser verification

Run with installed Chromium and `agent-browser`:

```sh
node scripts/test-portal-task-cancel.mjs
node scripts/test-portal-questions.mjs
node scripts/test-portal-tasks.mjs
node scripts/test-portal-recovery.mjs
node scripts/test-portal-conversation-search.mjs
```

The cancellation fixture uses asymmetric A/B IDs and attempts, exact HTTP envelope/key assertions, both entry points, independent paged data, keyboard/required confirmation and alert semantics, stale/terminal/changed attempt and identity cases, both offline indicators, page/navigation round trips, known rejection and uncertain response cases. It asserts no automatic mutation and the original eligibility matrix. The existing tasks fixture explicitly confirms cancellation before expecting its synthetic status transition.

The network-loss fixture interrupts a response after its headers and partial body.
An initial pre-response socket-drop fixture observed one extra browser request;
that failure remains in `.local/portal-task-cancel-first-run.log`. The application
has no retry loop, but the final 13-envelope assertion does not establish absence
of browser-internal transport retransmission before response bytes arrive.
Server idempotency remains necessary even without application replay.

DPR2 captures are written to `.amp/in/artifacts/portal-task-cancel-{desktop,narrow-offline,uncertain}.png`. The narrow capture is Chromium at 390 × 844 CSS pixels, not a real phone/touch or Safari test. These are local synthetic UI/HTTP contracts, not live runtime cancellation, native descendant/effect settlement, account, deployment or production E04 acceptance evidence.
