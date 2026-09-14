# Offline application logical-export reconstruction

`importControlExport(absoluteExportFile, newAbsoluteSnapshotDirectory)` reconstructs the owner-exported application data into a **new private two-file snapshot**, not an active database. The CLI takes the same two arguments:

```sh
node scripts/import-control-export.mjs /absolute/private/control-export.json /absolute/private/new-snapshot
npx vitest run tests/control-export-import.test.ts
```

The importer uses existing `snapshotControl`/`verifyControl` and Node's SQLite API; no new dependencies. Tests ran with Node26.5.1. The snapshot API requires Node22.16+ or24+; the current verifier includes the Node26 backup-completion callback workaround.

## Owner export and executed local roundtrip

`GET /v1/export/control` uses the existing owner authentication and returns an attachment with `private, no-store` caching. Export is limited to two requests per minute per owner and does not run ingress maintenance, request inference or wake the runtime. One synchronous control transaction reads every canonical application table and `sqlite_sequence`; only the identified host tables `_cf_METADATA` and `__miniflare_do_name` are excluded. Unknown application schema fails closed. The response crosses the Durable Object RPC boundary as a stream, not a size-limited plain RPC value.

Treat the downloaded file as private plaintext: place it in an exclusively owned mode0700 directory and set mode0600 before importing. The importer does not fetch the endpoint or request credentials. `node scripts/test-local.mjs` executes the real local Worker endpoint with an export larger than1MiB, reconstructs it, verifies the original snapshot time and compares every table's exact tagged-row multiset. This proves the local supported-interface data path, not authenticated hosted deployment or full-system restore readiness.

The portal's Workspace panel has **Private data export → Review before downloading → Download private data**. Expanding the disclosure does not fetch data. The explicit button requests the export, blocks duplicate clicks while pending and reports authentication, size-limit, rate-limit and network failures without displaying response bodies. Success requests a browser download and explains that no coordinated backup or restore has been verified. Data is not put in localStorage. `node scripts/test-portal-export.mjs` checks an actual byte-exact Chromium download, loading/error/retry states and narrow layout; representative screenshots were inspected. Browser downloads are not encrypted or permission-hardened by the page: the owner must protect the downloaded file.

## Exact data contract, no executable input

The JSON envelope has exactly `format:'hehebot-control-export'`, `version:1`, `createdAt` (valid canonical UTC millisecond timestamp), `schemaSha256`, `schemaVersions`, and `tables`. This importer targets schema9, fingerprint `15bf82e1965b24b0620dfe9a6541ce74759320113c3ed230fe2048f6e10ee01c`. Header history must be nonempty, strictly ascending integers in1–9, ending at9: for example `[9]` fresh or `[8,9]` upgraded. It must exactly match all imported `schema_versions.version` rows, sorted numerically. All migration rows and their original `applied_at` values are preserved. The separate backup verifier still supports schema8 snapshots; this logical importer does not migrate schema8 exports.

Every table has exactly `name`, `columns`, `rows`. Tables must contain every pinned application table **and `sqlite_sequence`**, once each, in ascending name order. Columns must exactly match local `PRAGMA table_info` order. Each row has exactly one tagged cell per column: `{type:'null',value:null}`, `{type:'text',value:string}`, or `{type:'integer',value:string}`. Integer values use canonical signed decimal, without leading zeros, `+`, `-0`, decimal points or exponents. The complete signed SQLite int64 range is supported using BigInt bindings/readback, not JavaScript Number conversion. REAL/BLOB/other tags are rejected; invalid UTF8 and unpaired Unicode surrogates are rejected rather than replaced. Extra, missing or duplicate keys—including equivalent escaped JSON keys—are rejected.

The bound is **4MiB serialized UTF8 input and 10,000 combined rows**, including schema/version and sequence rows. Exact row widths, cell schemas and int64 bounds are checked before insertion. The wire envelope has a structural nesting limit of32; JSON embedded within text cells remains opaque data, subject to application SQLite CHECK constraints.

Only the locally pinned `DB/schema.sql` is executed. Its byte SHA256 must be `e4c47bc63091f399e0f85996c26093a7f88c5e9b3e1aee8a1cf17ffcd751c138`; the resulting SQLite schema fingerprint is also checked. `HEHEBOT_IMPORT_SCHEMA` can explicitly point an older extraction's tests to the transferred baseline, but the exact byte pin still applies. It cannot substitute arbitrary SQL. Changes even to schema comments require deliberate pin review. Input never supplies SQL; identifiers are compared to the local schema before interpolation, and every value is bound.

Schema9 includes `flight_restore_deadlines`: every revision, status, run reference and receipt is application data and must roundtrip. Missing this table is rejected. The parent exporter excludes identified platform-only `_cf_METADATA` and `__miniflare_do_name`; the importer rejects either as an extra table rather than silently discarding it. No application table is dropped from a source database.

Insertion uses a private staging transaction with foreign-key enforcement temporarily disabled only on that new database, because table-name order is not dependency order. Existing snapshot creation then performs the FK, integrity and schema checks. All normal tables are imported before `sqlite_sequence`; its auto-generated contents are then replaced with the exact exported rows, preserving deleted-row high-water marks. The new database's seeded schema-version row is replaced with the entire exported history, not just the latest version; no source history is cleared.

Tagged-row **multisets** are read back and compared before backup and from the final staged snapshot. Row order and hidden rowids are not contractual. Explicit INTEGER PRIMARY KEY values and `sqlite_sequence` are preserved. SQLite affinity conversions, generated substitute IDs, integer rounding, or any difference in tagged data fail reconstruction instead of being silently accepted. SQL-looking text remains data.

## Private staging, original time and publication

The export file and its parent must be owned/private, with a single-link regular file and no symlink path components. The importer uses a bounded read with `O_NOFOLLOW` and verifies the opened inode. The destination must be a new canonical absolute path under a private parent; an existing file, directory or symlink is never overwritten. Unsafe/group-writable ancestry is rejected, with the existing sticky system-temp exception. Work lives under a new mode0700 `.hehebot-export-*` directory; the application SQLite file and manifest are mode0600.

After reconstruction, normal `snapshotControl` creates `control.sqlite` and `manifest.json`. The importer replaces **only the new staging manifest's `createdAt` with export `createdAt`**, then calls `verifyControl` before publication. Reconstruction time must not reset retention age. The timestamp remains supplied provenance: syntactic validity does not authenticate a source clock or attest that the data was captured then.

Publication follows the existing exclusive-directory convention: create the destination with `mkdir`, move the two verified files into it, sync directories and verify again. This is not an atomic directory swap; a crash can leave a partial destination, which `verifyControl` rejects. Do not consume the destination until the importer succeeds and verification passes. Ordinary failure removes only directories created by this invocation; source export and existing databases are untouched. Private quarantine is removed on completion/failure, but process death can leave artifacts requiring separate operator review. No automatic source deletion occurs.

Success returns a content-free `{status:'verified',format:'hehebot-control-snapshot',version:1,application_only:true,activation_allowed:false}`. CLI exit0 means reconstruction and verification succeeded; exit1 emits only `CONTROL_EXPORT_IMPORT_FAILED`. No paths, IDs, context, policies, receipts or SQL errors are echoed. Tests cover exact asymmetric row/ID/cursor/receipt/effect/lock values, int64 boundaries, sequence high-water, original time, input/source nonmutation, private modes, rejection cleanup and redacted CLI errors.

## This is not restore admission

The logical export is plaintext application data and may contain sensitive content. Its asserted format/fingerprint and output checksums are **not authenticated custody**. Keep input/staging under exclusive trusted local control; checks do not defeat a malicious same-UID process replacing files between filesystem operations. Export completeness and transaction consistency depend on the corresponding exporter. This importer does not read a live Durable Object or obtain an account token.

Logical reconstruction does not prove application semantic consistency, external executor shutdown, old identity revocation, native thread/journal recovery, coordinated full-system checkpoint coverage, connector receipt truth or permission to activate. Run the separate semantic inspector as appropriate; unresolved effects and retained locks are deliberately preserved, never retried, released or marked settled. Separate owner `effect.reconcile` and `run.recover` commands require confirmed termination and explicit decisions; the importer never invokes them and those decisions are not provider evidence. Encryption/key custody, retention/deletion execution, native recovery and production admission remain separate. Production gates stay unchanged.
