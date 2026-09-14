# Encrypted snapshot retention planning

`planBackupRetention({ now, snapshots })` in `scripts/plan-backup-retention.mjs` is a pure, bounded metadata planner for an already-created encrypted application snapshot catalog. It does not open backups, inspect ciphertext, discover credentials, call providers, write a catalog, or delete anything. Its `expire` decisions are candidates for separately authorized custody/deletion integration, not deletion receipts.

SPEC.md line39 requires **7 daily + 4 weekly**; line229 bounds deletion-related backup expiry by **28 days**. The specification does not define buckets, representative selection or ties. This version makes these choices explicit:

- Daily buckets are the **current Asia/Jakarta calendar day plus six preceding days**. Weekly buckets are the **current Monday-start Jakarta week plus three preceding weeks**. Buckets include their starting instant and exclude the next starting instant. Jakarta is UTC+07:00 for the supported timestamp range (years2000–9999).
- Choose the newest original snapshot timestamp in each bucket. Equal timestamps choose the lexicographically smallest lowercase UUID. A snapshot may represent both daily and weekly buckets and is retained once. The union has at most11 records, often fewer; this is not a guarantee of11 distinct backups.
- Empty buckets remain empty: never fill them with older snapshots. The current day/week is partial. This is calendar-window retention, **not the last seven/four occupied buckets** or seven/four completed periods.
- Independently expire every snapshot whose elapsed age is **at least28 × 24 hours (672 hours)**. Exactly28 days expires; one millisecond younger is age-eligible but can still expire if outside the calendar windows or superseded. Bucket selection cannot extend the deadline. A boundary record can be both too old and outside all windows; `maximum_age` takes precedence.

## Input and output

All input objects reject extra fields. Provide an explicit evaluation time and immutable original snapshot creation time; never supply file mtime, encryption time, upload time or copy time. Timestamps must be canonical UTC `YYYY-MM-DDTHH:mm:ss.sssZ`, valid Gregorian dates and not future-dated relative to `now`. Snapshot IDs are opaque lowercase canonical UUIDs (versions1–8, standard variant), unique even if timestamps differ. Equal timestamps with distinct IDs are allowed. Do not encode personal content into IDs.

```json
{"now":"2026-09-14T06:00:00.000Z","snapshots":[{"id":"00000000-0000-4000-8000-000000000019","snapshot_at":"2026-09-13T22:00:00.000Z"}]}
```

The result has `version:1`, `as_of`, `timezone`, fixed `policy`, and UUID-sorted `decisions`. Each decision includes only `id`, `snapshot_at`, `action` (`keep`/`expire`), `reason` (`bucket_selected`/`not_selected`/`maximum_age`) and selected `buckets` (`daily`, `weekly`, or both). Repeated calls with the same inputs are identical regardless of catalog order. Inputs are not mutated. Malformed input throws the content-free error `INVALID_RETENTION_INPUT`; no partial plan is returned.

The library accepts at most4096 snapshots. The CLI accepts no arguments, reads only stdin (at most1MiB within5 seconds), writes JSON to stdout and returns exit1 with the fixed error on invalid input. It does not obtain the clock implicitly:

```sh
node scripts/plan-backup-retention.mjs < private-catalog.json
npx vitest run tests/backup-retention.test.ts
```

No new dependency or schema change is required. Tested on Node26.5.1; the repository requires Node22.16+ for its SQLite backup API.

## Custody and deletion are still separate

The caller must attest catalog completeness, immutable original timestamps, encrypted artifact identity/integrity and trustworthy current time. The planner cannot detect omitted copies, substituted timestamps or a catalog rolled back to an earlier date. A copy of an old snapshot must retain its original timestamp; repackaging must not reset age. A larger catalog requires a separately designed bounded integration, not chunking: independently selecting each chunk gives incorrect representatives.

Execution frequency, authorization, concurrent snapshot publication, retained ciphertext/hash binding, off-host copies, deletion failures/retries and audited confirmation remain integration work. A plan does not establish the28-day deletion deadline was enforced; delayed execution can violate it. Encryption/key custody, coordinated full-system backups, restore fencing, executor shutdown proof and recovery admission remain outside this unit. No production gates change. Changing calendar-window semantics requires a deliberate policy/version decision; sparse history and missing backups are not repaired by retention planning.
