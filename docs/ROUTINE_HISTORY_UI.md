# Routine run history UI

Implemented against the unpublished local API baseline supplied by the host. The
existing routine card has a **Run history** disclosure for one selected live
routine at a time. The panel reuses task-card, output-preview, notice and button
styles; no stylesheet change is needed.

## Read contract

- Explicit reads only: `GET /v1/routines/:id/runs?limit=10`, followed by
  `?after=<last UUID>&limit=10`. The cursor is exclusive. Server order is retained;
  this is neither newest-first nor date-sorted history. First page restarts the
  traversal. Concurrent arrivals before the cursor require restarting.
- All retained statuses and whole-routine counts are shown, with the page's
  observation time. Existing conversation tasks remain unfinished-only.
- With schema v12, `captured_routine_revision` comes from the current durable
  attempt, recorded atomically at claim. `attempt_revisions` lists the latest three
  retained attempt/revision pairs, descending by attempt. Retries retain earlier
  attribution. Same-persona children inherit the exact parent-attempt value;
  cross-persona children have no routine revision. Legacy attempts remain null:
  neither migration nor reads infer missing values from context/current routine.
  Only numeric attribution is exposed, never private context or prior output.
  These are captures, not proof that inference executed or effects settled.
- Recorded status and original request application are not output delivery or
  settlement receipts. Current-attempt provisional output remains clearly
  provisional and is never presented as a delivered result. Terminal previews,
  cancelled/invalidated output and old-attempt previews are not rendered.
- **Current attempt record** displays only the exact current `execution.attempt`,
  its recorded status, start/claim and application settlement timestamps, and
  whether a result body is retained. `started_at` is written at claim, before
  native acknowledgement/inference; it is not evidence the model ran. `settled_at`
  is an application record, not a live native-family or safe-sleep guarantee.
  Timestamps retain their explicit API timezone (`Z` in the fixture). Null times
  read “not recorded”; `execution:null` is a missing record, not failure.
  `result_body_retained:false` is not incomplete execution: result payloads may
  have been pruned after 90 days. Retaining a body also does not prove delivery.
- **Run-level delivery records** displays pending, delivered, failed and
  outcome-unknown counts independently. These include portal and all other
  destinations and never synthesize an overall success/failure. Portal status and
  update time remain separate. Portal “delivered” means a persisted portal record,
  not owner receipt or notification; no record does not mean failure. Outbox
  records belong to a run, not an attempt: a delivered record may predate a retry
  and cannot establish delivery for the current attempt. No destination names or
  payloads are rendered. Execution, delivery and provisional output are separate
  labelled sections; no controls, requests or polling were added.
- Steering and executor-termination observations are read-only. There are no
  history dispatch, retry, cancellation, follow-up, recovery or mutation actions.
  The endpoint supplies delivery metadata, not completed result bodies or proof
  that the owner received output; this panel does not invent either or claim safe
  sleep. Existing captured revision/attempt attribution is unchanged.
- History is hidden in owner-alpha, including after an observed mode transition;
  no new routine-history requests are made there.

## Staleness and navigation

Pages are loaded on demand, not polled. Ordinary state refresh preserves expanded
run disclosures but does not refresh history. Hiding, changing persona, navigating
to tasks/skills, changing routine revision/ownership or deleting the routine
invalidates the selected history. Late responses cannot restore it. Errors clear
the page rather than showing old rows as current. Observed offline state clears
rows and invalidates pending responses; reconnect does not reread or restore them.
Hide and reopen history to read again. Changes not yet observed by the client can
only be reflected by the next state/history read; there is no server push.

## Executed local verification

```sh
node --check public/app.js
node --check scripts/test-portal-routine-history.mjs
node scripts/test-portal-routine-history.mjs
node scripts/test-portal-routine-preflight.mjs
node scripts/test-portal-routine-delete.mjs
node scripts/test-portal-tasks.mjs
node scripts/test-portal-alpha-session.mjs
git diff --check
```

All passed. The focused real Chromium fixture uses synthetic HTTP responses and
checks exact routine GET scopes, asymmetric 10+3 UUID pages with non-monotonic
dates, every status label, current-attempt preview filtering and text escaping,
unchanged unfinished task feed, no polling or writes, empty/error/offline states,
wrong-routine response rejection, and late responses after revision, deletion,
hide, persona, offline/reconnect and alpha transitions. Alpha refresh and reload
make zero new history reads. It also checks disclosure persistence and 390px
document width. Neighboring fixtures cover existing deletion, task and alpha
behavior independently.

The execution/delivery extension also checks a running attempt 2 whose delivered
portal record predates its start/claim time, with asymmetric counts (pending 2,
delivered 1, failed 3, unknown 4). It checks a completed/pruned attempt with retained
settlement metadata, missing attempt/no outbox, a retained-body case and null
timestamps. Assertions independently verify every count and date, attribution
caveats, separate provisional output and zero new controls/requests. The existing
preflight fixture also passes; preflight behavior is unchanged.
The offline late-response case waits for the browser to observe Offline and then
Connected before releasing history. Calling refresh alone is insufficient because
it can return without fetching while a background state poll is in flight.

Inspected 2× Chromium screenshots under `.amp/in/artifacts/`:

- `routine-history-execution-desktop.png`, `routine-history-execution-narrow.png`:
  running current attempt, claim/application settlement labels and limits.
- `routine-history-delivery-desktop.png`, `routine-history-delivery-narrow.png`:
  mixed run-level delivery counts, older portal record and separate provisional
  output.
- `routine-history-pruned-execution.png`: completed status survives body pruning.
- `routine-history-missing-records.png`: missing attempt, zero counts, no portal.

The fixture also regenerates the existing revision, pagination, loading, empty,
error and offline captures. The expanded card uses the existing vertical scroll
container; content beyond a screenshot's viewport remains scrollable.

These prove local browser behavior with synthetic data, not live owner auth,
provider execution, native settlement, delivery, or production acceptance. Narrow
Chromium is not physical-phone/touch/Safari testing. The host owns API integration,
combined verification, shared progress documentation and verifier wiring. No
preflight changes, account actions, push or deployment are included. After API/UI
integration and the observed-offline fixture correction, the host's full verifier
passed in `.local/routine-delivery-combined-final.log`; desktop tests also passed.
