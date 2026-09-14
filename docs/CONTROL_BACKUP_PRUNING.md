# Explicit local encrypted-backup pruning

This utility implements **review, then explicitly authorized local deletion** for one supplied private backup directory. It does not discover directories, decrypt data, load credentials, call providers, schedule work, touch databases or change production gates. Files outside this directory and remote copies are not covered.

## API and CLI

Exports from `scripts/prune-control-backups.mjs`:

- `reviewControlBackups(absoluteDirectory, canonicalNow)` returns `{digest, plan}` and persists a private reviewed plan. It reads/hashes every inventoried file, including every kept file. Review writes lock/journal metadata but deletes no ciphertext and does not rewrite the inventory.
- `applyControlBackups(absoluteDirectory, digest, CONFIRM_LOCAL_DELETION)` requires the exact reviewed SHA256 digest and exported confirmation constant, whose value is `DELETE_LOCAL_ENCRYPTED_BACKUPS`. It revalidates the inventory and every remaining file under the exclusive lock before deleting any candidate. It returns a content-free receipt.
- `controlBackupPruneStatus(absoluteDirectory, digest)` reads the durable receipt without deleting anything. It reports journal state, not a fresh ciphertext verification.
- `withBackupDirectoryLock(absoluteDirectory, callback)` exposes the same exclusive lock for cooperative local creator integration. The callback receives `{dev,ino}` strings. The lock is not reentrant; do not call review/apply/status while already holding it.

```sh
node scripts/prune-control-backups.mjs review /absolute/private/backups 2026-09-28T17:00:00.000Z
# Inspect the returned complete metadata plan and retain its digest.
node scripts/prune-control-backups.mjs apply /absolute/private/backups <reviewed-digest> --confirm-local-deletion
node scripts/prune-control-backups.mjs status /absolute/private/backups <reviewed-digest>
npx vitest run tests/control-backup-pruning.test.ts
```

Success prints bounded JSON and exits0. All CLI failures print only `CONTROL_BACKUP_PRUNE_FAILED` and exit1, without echoing paths, file content or supplied values. Failure can occur **after irreversible partial deletion**: inspect the recorded receipt before attempting anything else. Library callers may receive filesystem errors; do not log their raw messages in shared logs. Relevant fixed library codes include `PRUNE_LOCK_BUSY`, `PRUNE_CONFIRMATION_REQUIRED`, `PRUNE_REVIEW_MISMATCH`, `PRUNE_INCOMPLETE_APPLY` and `PRUNE_OUTCOME_UNKNOWN`.

## Complete inventory and original timestamps

The caller supplies `inventory.json` inside the explicit directory, with exactly `{version:1,backups:[...]}`. Each entry has exactly `{id,snapshot_at,bytes,sha256}`:

- `id`: an opaque lowercase UUID accepted by the existing planner. The only ciphertext filename is `<id>.age`; inventory entries cannot supply paths.
- `snapshot_at`: the immutable original application snapshot time, in the planner's canonical UTC millisecond format. Never use encryption/upload/copy time or filesystem mtime. Metadata provenance is the custodian's responsibility; the utility cannot authenticate when a snapshot was originally created.
- `bytes`: exact byte count of the encrypted file.
- `sha256`: lowercase SHA256 of the entire encrypted file, supplied by the custodian, not inferred as a substitute for trusted inventory.

All UUIDs must be unique and timestamps not future-dated relative to the explicit review time. Limits: 256 backups, 256MiB per ciphertext, 1GiB combined ciphertext, 256KiB per metadata document, and32 retained journal files. Files must be private owner-only single-link regular files; directories must be private and owned by the invoking UID. Symlinks, unsafe writable ancestors, noncanonical paths, hardlinks, unknown files, extra/missing ciphertext and byte/hash mismatches fail closed. System sticky temporary ancestors follow the existing private-path convention. Known metadata is only `.prune.lock`, `.prune/` and `inventory.json`; leftover `.next` temporary metadata is not silently ignored.

Both candidates and kept files must match their supplied hashes. Binary age-v1 magic is recognized; ASCII-armored age is not accepted. **Magic recognition and a matching SHA256 do not authenticate age encryption, recipients, payload validity, or application content.** The utility has no key and makes no such claim. Tests create actual age v1.3.2 ciphertext using disposable identities, but production pruning does not invoke age or read identities.

Decisions come directly from `plan-backup-retention.mjs`: current Jakarta day plus six preceding days, current Monday-start Jakarta week plus three preceding weeks, newest representative and UUID tie-breaking, no sparse backfill, and independent expiration at age **at least672 hours**. Daily/weekly representatives may overlap. The plan binds its exact review time/policy, raw inventory hash, canonical metadata, directory device/inode and file device/inode/ctime/mtime identities. Replacements with the same bytes but a different identity invalidate the plan. Reformatting metadata also invalidates review. Apply does not add newly expired files to a stale plan; obtain a new review to evaluate a later time. No automatic deadline enforcement or scheduling is implied.

## Kernel locking and creator cooperation

Supported interface: Linux `flock(2)` through installed `/usr/bin/flock` (tested util-linux2.38.1, Node26.5.1). Node opens the stable zero-byte `.prune.lock` with `O_NOFOLLOW`, then passes the same open file description as inherited fd3 to `flock --exclusive --nonblock --conflict-exit-code 73 3`. The parent retains its descriptor, so the lock survives helper exit and is released when the parent closes or dies. Tests exercise independent contenders and actual holder SIGKILL. No stale PID guessing, lock deletion, lease timeout or takeover mechanism is used. This is a Linux interface, not a claim of universal POSIX/macOS portability or network-filesystem support. The existing OS tool is used without bundling its code.

**Every creator, inventory writer and pruner must cooperate on this stable lock**, holding it across ciphertext publication and inventory updates. Do not unlink/replace the lock inode. Use the [cooperative snapshot creator](CONTROL_BACKUP_CREATION.md) for inventoried publication; the standalone encryption/export tools do not maintain this catalog. Do not concurrently point an unmodified producer at this directory. The creator rejects incomplete apply journals. Between review and apply, a legitimate creator may change inventory under the lock; apply then rejects the old review rather than deleting from stale custody. Locks prevent simultaneous cooperative mutations, not malicious same-UID writes, edits to journal evidence, hardlink creation, or path substitution by an uncooperative process. Private ownership and exclusive local custody remain assumptions.

## Durable partial outcomes, not pretend rollback

Review stores `.prune/<digest>.json`, with the bound plan and candidate states. No application content, recipient, credential, arbitrary path or database data is stored there—only opaque IDs, hashes, byte counts, original timestamps, file identities, policy decisions and state. These are local trusted-host records, **not signed or tamper-proof evidence**.

Apply persists `phase:'applying'`, then for each candidate in UUID order:

1. Recheck the exact candidate's hash/identity.
2. Write `state:'deleting'` using a synced private temporary file, atomic rename and journal-directory fsync. The journal directory's parent entry is synced before any deletion.
3. Unlink only that UUID's ciphertext, then fsync the backup directory.
4. Persist `state:'deleted'` with the same durable write protocol. Only this state is a confirmed receipt for the plan-bound candidate hash.

`pending` means no deletion receipt exists; `deleting` is **unconfirmed/unknown**, not success. If a candidate remains present with its original identity, a repeated explicit apply of the same digest can resume it. If it is missing while `deleting`, apply returns `PRUNE_OUTCOME_UNKNOWN` and stops; it cannot know whether unlink completed before a crash or someone else removed it. A missing `pending` candidate also fails. A `deleted` candidate may be absent because a durable exact-hash receipt exists, but any replacement at its name rejects retry. The utility never deletes a replacement to force replay to succeed.

Once every candidate has a confirmed receipt, apply atomically replaces inventory with the kept entries, preserving their original fields/timestamps, then records `phase:'complete'`. Reopen handles a crash between these two steps by accepting only the exact expected remaining inventory. Completed replay requires the matching completed inventory and files; unrelated later changes reject it. Use status for historical receipts. A partial apply blocks new reviews and other apply plans. Temporary-file debris, corrupt metadata or uncertainty require separate operator reconciliation; there is no automatic repair, metadata bypass or promise to resume after every possible crash.

Receipts include `{digest,phase,deletions:[{id,bytes,sha256,state}],remote_copies_verified:false}`. Journal history is retained; reaching the bound stops new reviews rather than deleting audit evidence. Separate reviewed archival/custody policy is required for long-running use. Plaintext metadata contains linkage-sensitive opaque IDs/hashes and remains private.

## Evidence and remaining boundaries

The tests use only disposable directories, real synthetic age ciphertext and explicit fixture deletion confirmation. They cover asymmetric exact28-day/duplicate-day/weekly choices, immutable kept data, plan and metadata mismatch, retained/candidate replacement, unknown files, unsafe modes/links, independent lock contention/process death, partial failure/reopen, recorded-hash replay, unknown unlink outcomes and redacted CLI errors. Unlink fault injection exercises the durable filesystem state machine; it is not a power-loss/filesystem durability certification.

This unit does not establish off-host durability, deletion of remote/object-store copies, cryptographic erasure, authenticated age/application content, coordinated restore readiness, executor shutdown, or complete28-day deletion compliance. External backup creation, trustworthy clock/inventory custody, review cadence, failure reconciliation and journal archival remain integration work. No database/native state, account connection, effect gate or production admission flag changes.
