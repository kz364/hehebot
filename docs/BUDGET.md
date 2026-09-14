# Optional-routine budget ledger (SPEC S25)

`BudgetLedger(store, now, uuid)` is a trusted-host infrastructure projection ledger. It does not estimate model token prices, prove an actual provider bill or account quota, contact a provider, infer work, wake an executor, stop a task, or settle an effect. Its default is **disabled**, with a suggested **500 cents (USD5) per calendar month** and **no optional routines**. Owner commands, Worker admission and the portal now integrate this ledger locally; no production gates change.

## Public API and storage

Exports:
- `BUDGET_POLICY_ID = 'bbbbbbbb-0000-4000-8000-000000000025'`.
- `BUDGET_REPORT_KEY = 'budget-report'`.
- `BUDGET_OVERRIDE_PREFIX = 'budget-override:'`.
- `MAX_BUDGET_CENTS = 1_000_000_000` (integer cents, cap maximum USD10 million; not a spending authorization).
- `BudgetPolicy = {expected_revision, enabled, monthly_cap_cents, optional_routine_ids}`.
- `BudgetReport = {period, projected_cents, observed_at, source_ref}`.
- `BudgetSummary` and `BudgetAdmissionPredicate` types.

`set(owner, commandId, policy): string` validates 0–20 distinct canonical lowercase routine UUIDs that exist and are not deleted, then returns the fixed policy ID. No schedule or routine is automatically classified optional. Caps must be positive bounded safe integers, including while disabled. `expected_revision` uses the existing `Store.put` optimistic revision and immutable revision history; the saved policy body excludes `expected_revision`. Routine IDs are sorted before storage. The accepted/applied command must belong to `owner` and have type `budget.set`; ingress must already have authenticated that owner and validated the command payload. Ledger code is not a replacement for owner authentication or `ControlCore.accept` command dedupe.

`report(report): void` accepts only trusted-host projections. `period` is canonical `YYYY-MM` in **Asia/Jakarta (UTC+07:00)**, independently of host timezone. `observed_at` must be a real canonical UTC timestamp with milliseconds, at or before the host clock, in the same Jakarta month as the report and host clock, and **strictly less than 24 hours old**. `projected_cents` is an integer from 0 through `MAX_BUDGET_CENTS`. `source_ref` is an opaque 1–128-character ASCII token matching `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`; it must not contain credentials, account content, free text or URLs. All input fields are required; unknown fields are rejected.

Only the current report is stored, as the four-field object under one `runtime_metadata` key. A newer timestamp may revise a projection upward or downward. Older replacements and differing content at the same timestamp fail with `REVISION_CONFLICT`. Exact fresh replay, even with different JSON property order, makes **no writes or events** and does not refresh `observed_at`. An expired or prior-month replay fails freshness validation, without renewing it.

`summary()` returns:
```ts
{
  policy: { enabled, monthly_cap_cents, optional_routine_ids },
  revision, period, report,
  freshness: 'missing' | 'fresh' | 'stale' | 'invalid',
  status: 'disabled' | 'ok' | 'BUDGET_UNKNOWN' | 'BUDGET_BLOCKED',
  threshold: 0 | 70 | 90 | 100
}
```
Exactly 24 hours expires a report; Jakarta month rollover expires the previous month's report even if milliseconds old. Enabled + missing/stale/invalid report is `BUDGET_UNKNOWN`; enabled + fresh projection at or above cap is `BUDGET_BLOCKED`. A corrupt or deleted policy does not silently become disabled: policy reads fail with `BUDGET_UNKNOWN` for explicit review. No summary read writes data.

Thresholds use exact integer comparisons, not rounded displayed percentages. Each newer accepted report emits a content-free `budget.threshold_crossed` event for every newly crossed upward 70/90/100 boundary while enabled. Payload is only `{period, threshold, policy_revision}`. Repeated reports above a boundary emit nothing; a downward correction permits a later upward recrossing, and a new month starts below all thresholds. Policy edits reinterpret the previous report against the new cap; they emit `budget.policy_updated`, not retroactive report crossings. `source_ref`, amounts and routine instructions are not copied to threshold events. All ledger writes and their events are transactional.

## One admission predicate, filtered before LIMIT

`admissionPredicate(): {sql: string, bindings: SqlValue[]}` returns a **budget permission** expression for the existing runs alias **`r`**. True means “budget does not block”; it is not full admission authorization. `blocks(run)` evaluates the same expression against the supplied current Run fields. It does not maintain a separate JavaScript override implementation.

```ts
store.db.transaction(() => {
  const { sql, bindings } = budget.admissionPredicate();
  const candidates = store.db.all<Run>(
    `SELECT r.* FROM runs r
     WHERE r.status='queued' AND (${sql})
     ORDER BY r.created_at,r.id LIMIT ?`,
    ...bindings, limit,
  );
  // Parent must still check lease, age, scope, concurrency and all ordinary admission gates.
});
```

Build and execute the predicate inside the same control transaction; do not cache it across policy edits, report changes or freshness/month boundaries. Apply it **before LIMIT** in claim/wake candidate queries. For wait reconciliation, combine it (or its negation) with the parent's exact unstarted/budget-wait conditions before LIMIT; the ledger itself never requeues. All inserted values are bindings; callers must not replace alias `r` through string interpolation of untrusted input. `blockedRoutineIds()` returns at most 20 selected IDs for an unknown/blocked budget and is informational, **not a substitute** for this predicate, because it does not represent per-run exceptions.

Blocking only applies to selected routine IDs on actual occurrence-backed coordinator runs with no parent, `current_attempt=0`, and status `queued` or `waiting`; the occurrence must reference that same routine. Manual runs, children, retries and admitted/terminal states are not budget-blocked. The predicate uses primary-key lookups for the occurrence, one metadata key, and one command receipt per candidate. It does not load an unbounded override list. The query can still examine a backlog of blocked runs; filtering before LIMIT prevents that backlog from hiding later eligible work.

## An override is bound to one original run and policy revision

`override(owner, commandId, runId): string` returns that run ID, only for an exact unstarted selected occurrence-backed coordinator currently waiting with `BUDGET_BLOCKED` or `BUDGET_UNKNOWN` while the budget still blocks optional work. It requires an accepted/applied `budget.override` command belonging to the owner whose original `payload.run_id` equals the target. Another run's receipt cannot authorize this exception.

The key is exactly `budget-override:<runId>` and the value has exactly these seven fields:
```ts
{ run_id, occurrence_id, routine_id, command_id, owner_id, policy_revision, created_at }
```
Admission matches the exact run/occurrence/routine IDs and current policy revision, canonical `created_at`, and the command's owner/type/status/target. Invalid shape, transplanted IDs, absent/rejected receipts or a pruned receipt payload invalidate the exception. Policy changes invalidate every unclaimed earlier-revision exception; creating a replacement requires a new owner command. Identical override replay while still in the eligible waiting state writes nothing. Another command cannot replace a currently valid exception. Metadata is not cryptographic authority: only trusted owner-command handling may write it.

Overrides never modify the run's original `command_id`, input/context, creation/update timestamps, occurrence, attempt, status or error. Parent integration owns any requeue/wake and must preserve original input-age checks; an override is not an age renewal. The ledger does not release locks or touch attempts/effects/operations/lifecycle. Per-run override cleanup under retention is a separate integration responsibility; the current-report key remains bounded independently.

## Control plane and portal integration

Owner-authenticated `/v1/commands` accepts strict `budget.set` and `budget.override` contracts. Overrides include the expected policy revision. The model command boundary does not admit either command. `/internal/budget-report` requires the existing runtime authentication, enabled/verified gates and epoch/boot/attempt custody. It is a trusted-host reporting surface, not a model tool or a provider billing integration.

Enqueue parks selected optional occurrences without requesting a wake. Existing queued/budget-waiting runs reconcile in transactions of at most 100 changes, without changing original input ages. Report/policy/override changes and Worker maintenance trigger reconciliation. Claim and wake selection apply the shared predicate before LIMIT, including after provider-observation awaits, so delayed physical reconciliation cannot admit blocked work. Ordinary retry does not bypass the budget. Already-admitted work, locks and effects remain untouched; unstarted budget-blocked queue entries do not themselves count as sleep activity.

The Worker arms budget maintenance independently of execution enablement: pending changed rows run another bounded batch, and a fresh projection expires at the earlier of 24 hours and Jakarta month rollover. No periodic budget-only runtime polling is needed. An override with execution disabled leaves the run waiting for runtime capability; it never flips gates.

The portal shows cap, projection, reporting age/freshness and disabled/unknown/blocked states separately from model quota. The owner explicitly selects optional routines, edits the USD cap, or confirms an exact revision-bound one-run exception. `node scripts/test-portal-budget.mjs` exercises actual Chromium DOM with synthetic HTTP receipts: exact cents and selections, missing/fresh/stale/over-cap states, one-run override, and a narrow layout. Inspected captures do not establish real billing or physical phone behavior.

## Credential-free evidence and remaining work

```sh
npx vitest run tests/budget.test.ts tests/budget-admission.test.ts tests/control-object.test.ts
node scripts/test-portal-budget.mjs
npm run typecheck
```

The 15 tests use real application schema 8 SQLite with foreign keys, versioned policy revisions and command receipts. An older extraction can load the transferred current schema read-only using `HEHEBOT_BUDGET_TEST_SCHEMA=/absolute/current-schema.sql`; no schema is modified. Coverage includes non-round cap boundaries, expiry at exactly 24 hours, Jakarta month rollover, 0/20/21 selections, invalid/replayed/conflicting/older reports, upward recrossings, exact override identities and revision invalidation, receipt retention, atomic rollback, unchanged active attempts/effects/locks, and a 137-blocked-row backlog preceding eligible work. Query-plan assertions verify indexed metadata/command lookups.

Remaining work includes actual trusted infrastructure metering/quotes, cost-component breakdown and idle overhead, provenance-aware override metadata retention, and seven-day operational evidence. Error paths fail closed rather than treating unavailable budget policy as permission. Synthetic projections prove control behavior only—not actual spend, metered billing completeness, quota availability, successful provider enforcement, or fulfillment of the USD5 operational target.
