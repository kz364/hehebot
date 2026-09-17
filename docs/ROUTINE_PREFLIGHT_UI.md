# Routine preflight portal

The routine card offers an on-demand **Preflight** disclosure using existing card,
notice and button styles. It reads `GET /v1/routines/:id/preflight` once per open.
It never runs a test, dispatches work, polls preflight, changes a command or gates
Run now. Run history remains independently openable and retains its own state.

The panel distinguishes known grant/busy/persona command checks at observation
from the independent execution-enabled flag. It shows every returned blocker code
and message as text, revision and UTC observation time, enabled/paused state,
cron and explicit schedule timezone, local and UTC hypothetical next times, and
misfire/overlap/replay/lateness policy. Event-triggered routines have no calendar
schedule or invented timezone. Paused routines may run once without resuming.
Neither checks nor execution availability prove credentials, model access, inputs,
effect approvals, execution success or delivery. The actual command remains the
authority and rechecks revision and grants, even after a successful observation.

## Observation boundaries

Only one preflight observation is retained at a time. Hiding, navigation, changed
routine revision/ownership, removal, changed persona revision or owner-alpha mode
invalidate it. Mismatched response routine ID, revision or persona ID is rejected.
Errors show no old observation. Browser offline events and failed state refreshes
clear observations and invalidate pending replies; reconnect does not restore or
automatically reread them. Hide and reopen to observe again. Owner-alpha hides the
action and issues zero new preflight requests, including after reload.

These are observed-state boundaries, not server push or a continuing authorization
lease. A grant or busy-state change not yet observed can make the displayed checks
obsolete. Observation time and command-recheck warnings stay visible.

## Local verification

Executed successfully:

```sh
node --check public/app.js
node scripts/test-portal-routine-preflight.mjs
node scripts/test-portal-routine-history.mjs
node scripts/test-portal-routine-delete.mjs
git diff --check
```

The real Chromium preflight fixture uses a GET-only synthetic server and asserts
zero writes, exact endpoint scope, no polling, zero alpha reads, unchanged Run now
disabled state, independent history disclosures, text escaping, exact dates and
policy values. Asymmetric cases include three blockers with execution enabled and
checks permitted with execution disabled; paused and null-schedule routines;
errors/offline; retained revision invalidation; held replies across revision,
ownership, deletion, persona revision, persona/skills navigation, hiding,
offline/reconnect and alpha transitions; and wrong ID/revision/owner responses.
The neighboring history and deletion Chromium fixtures pass unchanged.

Inspected 2× screenshots under `.amp/in/artifacts/`:

- `routine-preflight-blocked-desktop.png`, `routine-preflight-permitted-desktop.png`.
- `routine-preflight-paused-narrow.png`, `routine-preflight-schedule-narrow.png`.
- `routine-preflight-event-narrow.png` (no calendar schedule).
- `routine-preflight-loading.png`, `routine-preflight-error.png`,
  `routine-preflight-offline.png`.

Narrow Chromium is a 390px desktop-engine viewport, not physical-phone, touch or
Safari verification. Its existing details drawer overlays the background app.
These synthetic checks do not prove production authentication, actual command
grant rechecking, credentials, providers, native execution or delivery. The host
owns API tests, combined verification, shared documentation and verifier wiring.
No accounts, providers, push, deployment or production gate changes are involved.
