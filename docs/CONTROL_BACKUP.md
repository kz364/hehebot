# Local application SQLite snapshots, not coordinated restore

`scripts/backup-control.mjs` snapshots one explicitly supplied **Hehebot application** SQLite database. It does not discover databases, read native databases/auth caches, connect to an account, contact a Worker, or start an executor. It has no restore, release, retry, settlement, activation or shutdown-attestation command. Production gates remain unchanged.

## Use a private local staging directory

The supported API floor is Node **22.16.0** (the 22.x release adding `node:sqlite.backup`); use a maintained Node release providing this API. This unit was executed on Node **26.5.1**, not on the minimum version. No package engines or dependencies are changed. POSIX ownership and mode checks require a POSIX host.

```sh
node scripts/backup-control.mjs snapshot /private/control/control.sqlite /private/backups/checkpoint-001
node scripts/backup-control.mjs verify /private/backups/checkpoint-001
```

Paths must be absolute and normalized. Source and existing SQLite sidecars must be owner-only regular files with one link. Source directory and destination parent must be owner-only directories owned by the invoking user (normally 0700, files 0600). Symlinks anywhere in the path, unsafe writable ancestors, relative paths and existing destinations are rejected. A system sticky temporary ancestor is permitted. Newly created output directory is 0700; both output files are 0600. These checks do not protect against a malicious process with the same UID, privileged users, path replacement by trusted administrators, ACLs overriding mode bits, or an untrusted filesystem. Use a controlled local filesystem, not a shared network mount.

Success prints only operation/status/scope. Failure exits 1 with a fixed message; it does not echo paths, SQL errors, rows, or manifest content. The module exports `snapshotControl(source, destination)` and `verifyControl(directory)` for local tests; callers must not log arbitrary caught database errors.

## Snapshot and manifest contract

1. Open the source using SQLite `readOnly:true`, extension loading disabled, `query_only=ON`, and an explicit read transaction. Inspect the schema to establish the transaction's snapshot before creating output.
2. Require the exact application schema **8** supplied with the current implementation. The SHA256 of the sorted non-internal `sqlite_schema` records `(type,name,tbl_name,sql)` is `99b9fa6597785da358b9b0adfbef41a09802648ece96da2792956405de55e619`; `schema_versions` must contain exactly version 8. Extra tables, indexes, triggers, changed SQL definitions or another version fail closed. Semantically equivalent but differently represented migrated schemas may be rejected; adding another baseline requires explicit review, not a force flag.
3. Require `PRAGMA integrity_check` = `ok` and no `foreign_key_check` violations. Use Node's online SQLite backup API, **not copying source DB/WAL files**. The read transaction includes committed WAL state, excludes uncommitted changes, and pins one state across another connection's commits.
4. Convert **only the copy** to DELETE journal mode, repeat schema/integrity/FK checks, count every application table, hash the complete database bytes, and sync the output files/directory. The manifest is written last. A handled failure removes only the newly created output; a process/power failure can leave an incomplete private directory, which verification must reject. There is no automatic overwrite or cleanup of pre-existing output.
5. Deliver exactly `control.sqlite` and `manifest.json`. Manifest format `hehebot-control-snapshot`, version 1, is limited to 64 KiB and contains creation time (completion metadata, not a transactional timestamp), fixed database filename, byte length, SHA256, schema hash/versions and table counts. It excludes source paths, application bodies, IDs, prompts and credentials. The database itself contains private application content and possibly SQLite free-page remnants; this is not a redacted export or a deletion mechanism.

Verification requires exactly those two components, private modes, the strict manifest shape, matching length/hash, self-contained SQLite header, supported schema, integrity/FKs and all counts. It rejects a WAL-format header before opening SQLite, avoiding creation of verifier sidecars. Hashes detect accidental corruption, not an attacker replacing both database and unsigned manifest. Schema/integrity checks are not full application semantic validation: JSON references, custody, revision policy, effect settlement and executor ownership remain separate contracts.

The source connection issues no SQL writes and does not checkpoint its WAL. Tests verify unchanged source database/WAL bytes and exact rows. **SQLite shared-memory (`-shm`) reader marks are coordination state and may change or be created during a read-only open.** Do not claim byte-for-byte immutability of the whole source directory. Verification of a completed snapshot leaves its two files unchanged. Reads can delay checkpoint/truncation and increase WAL retention; this utility does not promise a maximum duration on a busy or very large database.

## Executed evidence

```sh
npx vitest run tests/backup-control.test.ts
npm run typecheck
```

When independently testing in an older extraction, the fixture alone can load a transferred current schema via `HEHEBOT_BACKUP_TEST_SCHEMA=/absolute/read-only/schema.sql`. This does not override the utility's pinned schema. The test never modifies that schema file. The 11 disposable-file tests cover committed/uncommitted WAL state; paired commits after snapshot acquisition; asymmetric root/child attempts, revisions, effects, locks, native links, receipts, cursors and retention rows; autoincrement state; source database/WAL and output immutability; CLI redaction; private paths; overwrite and sidecar attacks; unsupported schema; FK/check failures; missing/extra components; truncation/corruption; bounded manifest tampering; and rehashed invalid database rejection.

## Operational requirements still outside this unit

SPEC §§10/14 require coordinated object export, runtime checkpoint/journal, pinned image/config versions, confirmed old executor stop, revoked old identity, manifest validation and connector readiness before restore. This local SQLite file alone meets none of the ownership/settlement preconditions. A completed root still does not settle unknown child effects or release locks. This utility deliberately preserves those records unchanged.

Live Durable Object extraction must use a separately supported export/checkpoint mechanism; do not point this script at undocumented provider or native files. External custodian shutdown/lease evidence, full-system consistency, restore fencing, connector reauthentication and restore drills remain separate. No caller-supplied boolean can prove executor shutdown.

SPEC requires encrypted backups, 7 daily + 4 weekly retention, and bounded backup expiry for deletion (28 days). This utility produces **unencrypted private staging files**, not an encrypted off-host backup or a retention scheduler. Approved encryption/key custody, authenticated manifest custody, secure transfer, expiry/deletion and RPO/RTO validation must be supplied separately before operational backup claims. Never use application storage containing misplaced service/OAuth credentials as an export source; this utility is not a secret scanner.

References: [Node SQLite backup API](https://nodejs.org/api/sqlite.html#sqlitebackupsourceDb-path-options), [SQLite online backup](https://sqlite.org/backup.html), [SQLite WAL read-only databases](https://sqlite.org/wal.html#read_only_databases), repository `SPEC.md` retention/backup/restore requirements.
