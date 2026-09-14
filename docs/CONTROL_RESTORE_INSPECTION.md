# Application snapshot semantic inspection

`inspectControlRestore(absoluteSnapshotDirectory)` inspects a previously created/decrypted **schema8 application snapshot**. It first calls `verifyControl` for private paths/components, exact schema, manifest SHA256/counts, SQLite integrity and foreign keys. It then opens application SQLite read-only with extensions disabled and a query-only read transaction. It re-verifies the snapshot afterward and rejects a changed manifest. It never opens a native database, reads credentials, writes rows, activates tasks, retries effects, releases locks or restores anything.

```sh
node scripts/inspect-control-restore.mjs /absolute/private/staging-snapshot
npx vitest run tests/control-restore-inspection.test.ts
```

Test fixtures default to `DB/schema.sql`. An older extraction must explicitly set `HEHEBOT_RESTORE_TEST_SCHEMA=/absolute/path/to/current-schema.sql` to the parent-transferred schema8, and use the matching current `backup-control.mjs`. No schema or dependency installation is part of this unit. Tested with Node26.5.1; tests use the existing supported SQLite snapshot API (Node22.16+ or24+), while the inspector itself uses `DatabaseSync`.

## Three separate claims

The bounded JSON result contains only version/schema fields, fixed issue/blocker code counts, and readiness distinctions. It never echoes paths, run/persona/native IDs, context, instructions, lock names, digests, policies, receipts or arbitrary database fields.

1. `snapshot_verified:true` means the existing schema/integrity/hash verifier succeeded—not that application relationships are semantically consistent.
2. `semantic_status` is `inconsistent` or `no_detected_inconsistency`. Zero detected issues is limited to the checks below, not universal database correctness. `blockers` reports valid unresolved obligations independently of structural issues.
3. `external_readiness:'unverified'` and `coordinated_restore_ready:false` are unconditional. Even CLI exit0 does not authorize restore or assert executor shutdown.

CLI exit0 means the bounded scan found no issues or listed blockers; exit2 prints a report containing issues and/or blockers. Exit1 returns only `CONTROL_RESTORE_INSPECTION_FAILED` and no report for failed verification, unsupported schema, limits, unsafe paths or read errors. The library returns the report for semantic findings and throws a fixed error for failures.

## Checked relationships and retained obligations

- `CURRENT_ATTEMPT_MISSING`: a positive current attempt must exist for its run; negative counters and active claimed/running/finishing runs with no attempt are inconsistent. Zero-attempt queued/waiting/expired history is permitted.
- `PARENT_ROLE_LINK_MISMATCH`, `PARENT_ATTEMPT_MISSING`: coordinator roots have no parent/native child link; background rows have agreeing `runs.parent_run_id` and `native_task_links.parent_run_id`, with an existing recorded parent attempt.
- `CHILD_NATIVE_REFERENCE_MISMATCH`, `NATIVE_ATTEMPT_LEASE_MISMATCH`: the native link matches an existing child attempt's opaque native reference, whose epoch/boot agrees with the recorded parent attempt. Native reference/session fields obey the existing bounded nonempty string contract. These checks do not reconstruct original native thread/turn hashes or prove native provenance.
- `LINEAGE_CYCLE` counts cycles, not all runs affected by a cycle. Both agreeing parent tables can still encode a cycle.
- `LOCK_ATTEMPT_MISSING`: each lock's run/attempt must exist. Locks pointing to valid historical attempts are **not corruption**; `RETAINED_LOCK` and `HISTORICAL_LOCK_OWNER` preserve their reconciliation obligations.
- `CONTEXT_IDENTITY_MISMATCH`, `ADMITTED_CONTEXT_IDENTITY_MISSING`: JSON must be an object. Present persona/routine/room/scope identity must agree with the run. Admitted contexts retain persona ID, routine identity or null, room identity and computed scope. Unstarted retained-history `{}` and `{schema_version,instruction,room_id}` shapes remain valid, per current `expireQueuedContexts`; the inspector does not require removed persona/scope fields in those rows. It does not require identical personas across a whole native tree: the generic native ledger permits authorized delegation.
- `TERMINAL_EFFECT_RECEIPT_INVALID`: confirmed/failed effects require a nonempty receipt object, following `EffectLedger.transition`. The inspector checks shape, not destination authenticity or truth.
- `ACTIVE_RUN`, `PENDING_RUN`, `RECOVERY_RUN`, `UNSETTLED_ATTEMPT`, `UNRESOLVED_OPERATION`, `UNRESOLVED_EFFECT`, `UNRESOLVED_DELIVERY` count work independently of run terminal status. Effects in intent/dispatched/outcome_unknown remain unresolved; every retained lock blocks. Historical completed/failed/cancelled/terminated attempts need not match the current epoch and are not by themselves active-work blockers.
- `STALE_NATIVE_CUSTODY` counts background runs with pending work/obligations whose own or ancestor mapping no longer matches current parent/child attempts. It follows the entire ancestor chain, including through completed parents. Wholly settled historical trees attached to an earlier root attempt remain acceptable history.

These checks derive from schema8 `runs`, `attempts`, `native_task_links`, `operations`, `resource_locks`, `effects`, and `outbox`, plus `NativeTaskLedger.register`, `ResourceLedger`, `EffectLedger.transition`, and retained-context contracts. Counts overlap: one obligation may contribute to multiple codes and must not be summed as unique tasks. The generic effects table has **no attempt column**; this utility cannot prove generic effect attempt custody or decode/authenticate mediated request digests.

## Bounds and restore gaps

Semantic work is limited to a64MiB verified application database and at most10,000 combined rows in the seven inspected tables; graph identifiers are bounded to512 characters. Exceeding limits fails the inspection, without partial-success results. The preliminary verifier still scans/hashes the supplied snapshot; this is not a constant-time or arbitrary-size ingestion service. Output cardinality is fixed by code names, not database contents. Some SQL checks scan unindexed relationships; limits are intentionally conservative. No partial/chunked scan establishes a whole-snapshot result.

Keep staging under exclusive trusted local custody. Read-only transactions and before/after verification detect ordinary changes but are not an OS ownership lock or protection from a hostile same-UID process replacing files between checks. File-content hashes and directory entries are tested unchanged, including with unresolved effects/locks; no WAL/SHM sidecars are added.

External runtime/journal consistency, old-executor shutdown, identity revocation, connector receipt reconciliation, coordinated object/runtime checkpoint coverage, encryption/key custody and activation fencing remain separate. Runtime result submission requires the original epoch/boot. The separate owner `effect.reconcile` and `run.recover` commands record explicit decisions after confirmed termination; they are not external evidence and this inspector never invokes them. An application-only snapshot cannot establish complete coordinated restore readiness or safe sleep. Production gates remain unchanged.
