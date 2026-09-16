# Memory deletion preserves unsettled custody, not deletion everywhere

Credential-free E06/E10 checkpoint, 2026-09-16. These are bounded application
SQLite fixtures, not completed E06/E10 acceptance, native transcript erasure,
secure erasure, model forgetting, or production readiness. Production flags are
unchanged. The starting point is the host's unpublished local `main` supplied in
`forget-drain.bundle`, not `origin/main`.

## Executed contract

`tests/memory-purge-custody.test.ts` adds four independently authored cases to the
existing simple queued/finishing deletion and memory-expiry coverage:

| Cases | Discriminating evidence |
| --- | --- |
| Two explicit-delete cases | A sensitive memory has different original/revised canaries and an ordinary surviving sibling. Deletion erases both revision bodies and both put payloads, leaves a revision-3 tombstone, and preserves the sibling's revisions/receipts. Waiting and queued contexts become cancelled without changing lifecycle/wake state. |
| Same cases, transcript flags and replay | `purge_transcripts:false` records `not_requested`; `true` records `requires_runtime_verification`, never completion. Replaying the delete and the original scrubbed put returns original receipts with **zero SQLite `total_changes()` increase**. The old put cannot resurrect memory. Source-event text remains. |
| Active family case | One running root, one claimed child, one already-recovery child and one independently scoped running sibling use four memories, three previews, three read-only effect records and three locks. Two different deletes remove only selected memory entries, preserve all other context fields, discard only affected previews and leave attempts/native links/effects/locks unchanged. The sibling's run and preview remain identical. |
| Terminal-boundary case | Real lifecycle completion of a root and child creates terminal contexts/results/portal copies; the root also has a checkpoint. Deletion leaves those rows, native links and prior events intact. Fresh canonical context excludes the deleted memory, but the cleanup notice still requires runtime verification. |

The active case establishes recovery through an owner cancellation at 00:00:01Z
and watchdog at 00:00:31Z, not a direct run-status mutation. Deletes at 00:00:37Z
and 00:00:54Z preserve **00:00:37Z** as the cancelling root/claimed child's grace
anchor. They remain cancelling at 00:01:06.999Z and become recovery-required at
00:01:07.000Z, exactly 30 seconds after the first delete. The already-recovery
child stays recovery-required; its `updated_at` is not a cancellation-grace
anchor and is not asserted to remain unchanged.

Purge itself does not rewrite any effect. At grace expiry, the watchdog changes
the affected root's dispatched effect to `outcome_unknown`; the already-unknown
child effect stays unknown and the unrelated sibling's effect stays dispatched.
All three locks and all four attempt rows remain. No retry or output is created;
sleep, late successful completion, cancellation settlement with held resources,
and late preview publication remain blocked.

## Fixture provenance and bounds

Setup uses `ControlCore.accept`, the actual SQLite schema, `Store.event`,
`LifecycleCore`, `NativeTaskLedger`, `OutputPreviews`, `EffectLedger` and
`ResourceLedger`. Native references and observations are synthetic. The only
direct fixture SQL write beyond the shared database initializer establishes a
BOOTING epoch/lease precondition; `registerBoot` and `ready` perform subsequent
admission. A test-only delegation option permits the other-persona sibling.
There are no injected run/context/effect/lock rows, no provider calls and no
account credentials. Effect records are read-only synthetic dispatch custody,
not actual connector reads or authorized mutation execution.

These are small, deterministic-clock contract cases, not a scale bound on the
production purge. Explicit deletion selects one memory, but the implementation
scans all nonterminal contexts and scrubs that memory's historical revisions and
put payloads in one transaction. This suite does not prove large-dataset latency,
crash/power-loss atomicity, complete operation coverage, or native cancellation.

## Retained boundaries must stay visible

- Tombstone identity, revision numbers, receipt identity/hash/idempotency metadata
  and content-free deletion events remain. Canonical text removal is not receipt
  destruction or permission to reuse an idempotency key.
- Filtering `context.memories` is not arbitrary text search/redaction across
  instructions, context events, checkpoints or other copied data. The test checks
  other context fields are preserved, not that every field is memory-free.
- Terminal run contexts, attempt result bodies, delivered portal outbox payloads,
  checkpoints, source/result timeline events and native task links are observed
  retained here. Separate retention paths may later prune eligible copies; a
  memory-delete receipt does not attest that they did.
- Native transcripts, runtime journals, in-flight process memory, tool/provider
  copies, backup snapshots and SQLite/WAL/free-page bytes are **not inspected or
  erased by this suite**. Application native-link metadata is not a native
  transcript. `purge_transcripts:true` records intent only; no native cleanup
  receipt or completion is manufactured.
- Unconfirmed effects/locks/attempts are preserved for reconciliation. Purge is
  neither a safe-replay decision nor proof of family settlement or permission to
  sleep. No supported native purge protocol or successful runtime cleanup is
  demonstrated.

## Reproduce

```sh
npm run types
npm run typecheck
npx vitest run tests/memory-purge-custody.test.ts tests/memory-expiry.test.ts tests/core.test.ts tests/output-preview.test.ts
bash scripts/verify-codex.sh
npm ci --prefix desktop && npm test --prefix desktop
```

Focused verification passed: **4 files, 42 tests**, including **4 new custody
cases**; typecheck passed after ignored `Env` regeneration. Desktop verification
passed **16 tests**. The full combined verifier exited zero: **56 control test
files / 1,210 tests**, **287 runtime tests**, its additional setup/license/Mac/
read-boundary checks, all scripted local HTTP/native/service fixtures, and build
dry run passed. Its final result retained `assistantOperational:false`,
`productionAdmission:false` and `modelJudgmentVerified:false`. These counts
describe this checkpoint, not permanent suite totals. Private combined and
desktop logs are `.local/memory-custody-combined.log` and
`.local/memory-custody-desktop.log`; they are not part of the patch.
