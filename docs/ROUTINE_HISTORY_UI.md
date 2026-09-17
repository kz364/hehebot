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
- Steering and executor-termination observations are read-only. There are no
  history dispatch, retry, cancellation, follow-up, recovery or mutation actions.
  The endpoint does not supply completed result bodies or delivery receipts; this
  panel does not invent them or claim safe sleep.
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
node scripts/test-portal-routine-history.mjs
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

Inspected 2× Chromium screenshots under `.amp/in/artifacts/`:

- `routine-history-desktop.png`: expanded provisional output.
- `routine-history-narrow.png`: second page with completed/waiting/failed runs.
- `routine-history-loading.png`, `routine-history-empty.png`.
- `routine-history-error.png`, `routine-history-offline.png`.

These prove local browser behavior with synthetic data, not live owner auth,
provider execution, native settlement, delivery, or production acceptance. Narrow
Chromium is not physical-phone/touch/Safari testing. The host owns API integration,
combined verification, shared progress documentation and verifier wiring. No
preflight UI, account actions, push or deployment is included.
