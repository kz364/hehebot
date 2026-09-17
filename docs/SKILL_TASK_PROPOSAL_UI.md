# Owner task-to-skill draft UI

**Draft skill from this task** opens the existing bounded skill editor as a blank
new procedural draft. It shows the selected persona ID, task ID and attempt, and
states that no task transcript, input, output, checkpoint or memory is copied.
There is no inference or automatic learning. Failed and unfinished tasks can be
sources without implying success, delivery or settlement.

The action appears on actionable conversation/current-task cards for the selected
persona with a positive integer current attempt. It is absent for unclaimed
attempt zero, other personas, owner-alpha and intentionally read-only routine
history. Recovery-only views receive no new action. Offline actions are disabled;
the existing polling cadence is unchanged. Opening the editor does not read a new
endpoint or write a command.

## Submission boundaries

- Only explicit Save emits `skill.propose_from_task` with `proposal_id`,
  `skill_id`, `expected_skill_revision:0`, `source_run_id`, `expected_attempt` and
  the owner-authored `body`. No client-supplied provenance or executable flag is
  sent on this route. Ordinary draft/update commands retain their existing shape.
- The editor captures selection version, page identity, persona identity/revision
  and visible run identity (ID, owner, attempt, status, title, role, routine and
  error). Save rejects mismatches, missing records, navigation (including away
  and back), offline status or owner-alpha activation. It never silently selects
  another source. A changed target still requires reopening the exact ordinary
  draft/update target; task-origin entry starts a new skill only.
- The current public run projection does not prove retained attempt availability
  or expiry. The server rechecks these and the editor displays a rejection. There
  is no new availability/retention lookup or authority claim.
- The private-facts checkbox is required and covers supporting references. It is
  an owner assertion, not scanning. Reference bounds, exact text preservation,
  optional omission semantics and safe literal rendering use the existing editor.
- The exact body and source are included in the editor's uncertain-retry
  fingerprint. An unchanged explicit retry reuses the same key, proposal ID,
  new skill ID and payload. Changed body/reference content or changed source
  cannot be resent from that editor. Reconnect/navigation never auto-resubmits.
- This stages a pending proposal only. Approval and per-bot enablement remain
  separate; no task execution, steering, retries, cancellation, memory changes,
  effect authority or model dispatch are added.

## Executed verification

```sh
node --check public/app.js
node --check scripts/test-portal-skill-task-proposal.mjs
node scripts/test-portal-skill-task-proposal.mjs
node scripts/test-portal-skill-draft.mjs
node scripts/test-portal-skill-references.mjs
node scripts/test-portal-tasks.mjs
node scripts/test-portal-task-cancel.mjs
git diff --check
```

All pass locally. The new real Chromium HTTP fixture uses two asymmetric sources
(running attempt 3 and failed attempt 7), private canaries, an unclaimed task,
read-only routine history, exact command assertions and unchanged task snapshots.
It verifies references, affirmation, target rejection, exact uncertain retry,
edited-reference retry rejection, changed/missing source fields, navigation and
page identity, offline/alpha fencing and server retention rejection. Only explicit
proposal commands reach its synthetic writer. The neighboring cancellation
fixture finishes all eligibility, snapshot/page, offline/navigation and uncertain
response groups (13 synthetic command envelopes).

Inspected 2× screenshots under `.amp/in/artifacts/`:

- `skill-task-proposal-entry-desktop.png`: explicit task-card entry.
- `skill-task-proposal-desktop.png`, `skill-task-proposal-narrow.png`: source
  disclosure, blank procedure fields and separate action footer.
- `skill-task-proposal-references-narrow.png`: manually authored literal reference.
- `skill-task-proposal-retention-error.png`: server refusal, not a saved claim.

The fixture checks 390px width plus an actually scrollable field area and a footer
outside it. Long form content continues inside that vertical scroll area.

The base is an isolated exact host checkout plus the supplied API patch, committed
before UI edits so delivery excludes host changes. No CSS, backend/runtime/schema,
shared progress docs or verifier files changed. Tests use synthetic HTTP data,
not live accounts, models, providers, native execution or production acceptance.
A narrow Chromium viewport is not physical-phone/touch/Safari evidence. The host
subsequently integrated the patch, corrected streamed UTF-8 decoding in this
fixture and wired it into `scripts/verify-codex.sh`. The host combined run passed
1538 backend/439 runtime tests plus Worker/browser/native/service/build checks
(`.local/task-skill-ui-combined.log`); desktop16 and neighboring task-feed/cancel
fixtures passed. No publishing or live account action occurred.
