# Bounded skill restore custody evidence

Verified locally on 2026-09-16 from the supplied unpublished host main
[`94aedd2`](https://github.com/kz364/hehebot/commit/94aedd25bc39876f658f79ee98612d2321f41266)
(bundle import, not origin/main). This is bounded E05 backend evidence, not E05
completion. No production defect was reproduced and no core behavior was changed.
There is therefore no production red/green fix claim.

`tests/skill-restore.test.ts` uses the existing `fixture`, Node SQLite and actual
`DB/schema.sql`, generated command validation, `ControlCore.accept`, Store and
LifecycleCore. All ordinary mutations enter real core commands. Test-only SQL
sets the local boot state and removes one historical row to exercise unavailable
history. Authored v1/v2 expectations differ in name, every textual body field and
array lengths/content; expected bodies are not read back from the implementation.

## What the nine cases establish

| Distinction | Observed contract |
| --- | --- |
| Restore vs activate | v1 becomes a pending proposal against current revision 2; owner provenance is `restore:<skill ID>:1`, even when the original body was imported. Objects, history, enablements, runs and lifecycle remain unchanged. |
| Reject vs approve | Rejection retains v2; later approval of that rejected proposal conflicts. Approval of a pending restore creates revision 3 containing the complete v1 body while retaining historical v1/v2. |
| Admitted vs future context | A real message/boot/ready/claim pins v2; approving restore leaves its stored context byte-identical. Future enabled-bot context selects v3/v1 content; an explicitly enabled-then-disabled sibling stays disabled and retains its old enablement revision. |
| Current vs source vs proposal revision | Stale current revision conflicts; unavailable source fails NOT_FOUND; source equal to current is permitted and copies v2. Stale proposal review conflicts. Rejection followed by restaging advances proposal revision to 4 while approval advances object revision only to 3. |
| Pending collision | A second restore for the same skill cannot displace the existing pending proposal, even with a different source revision. |
| Missing/deleted history | Unknown skill, removed exact history row and deleted current skill cannot restore; another skill's history cannot substitute. |
| State changes after staging | Deleting the skill before approval causes a revision conflict, retains the pending proposal and does not restore enablement. |
| Duplicate names | Historical names are checked with case/whitespace normalization both before staging and again if another skill acquires that name before approval. Failed commands preserve the snapshot. |
| Receipt replay | Identical restore/review retries return their original receipts, including restore replay after approval. SQLite total_changes is unchanged. Different content under the same key conflicts; a new-key second approval cannot apply again. |

Failure snapshots compare objects, historical revisions, proposals, enablements,
events, runs and lifecycle. Rejected commands intentionally add a receipt, so
those snapshots exclude the commands table. Exact successful replay additionally
checks SQLite total_changes, covering every table write rather than just the
selected snapshots.

## Reproduction

Run from the repository root:

```sh
npm run types
npm test -- tests/skill-restore.test.ts tests/skills.test.ts tests/routine-lifecycle.test.ts tests/queued-context-retention.test.ts
npm run typecheck
bash scripts/verify-codex.sh
```

Types generation and typecheck passed. The focused run passed **30 tests in four
files**, including **nine new restore cases**, in `.local/e05-restore-focused.log`.
The combined verifier passed (exit 0): **1,206 control tests, 278 runtime tests**,
eight auditor and five Mac source/script checks, the artifact/SDK, HTTP, crash,
native and service fixtures, and build dry run. Its final result explicitly keeps
`assistantOperational`, `productionAdmission` and `modelJudgmentVerified` false.
Log: `.local/e05-restore-combined.log`.
`npm ci --prefix desktop && npm test --prefix desktop` also passed **16 tests**
in `.local/e05-restore-desktop.log`. Logs are private local artifacts.

## Acceptance limits

This checks core commands against disposable in-memory SQLite, not HTTP owner
authentication, Cloudflare Durable Object persistence/crash recovery, distributed
concurrency, portal rendering/retry behavior, native execution or model judgment.
Future context is checked through the real context builder, not a second native
execution. Missing-history deletion is a deliberate fixture fault, not evidence of
normal production history pruning. Pending collision means two proposals for the
same skill, not exhaustive arbitrary proposal-ID/database-corruption coverage.
It does not prove executable-file review, connector permissions, external effects,
backup recovery, or complete skill/routine UX acceptance. No accounts, deployment,
push, production flags, shared completion documents or runtime transport changed.
