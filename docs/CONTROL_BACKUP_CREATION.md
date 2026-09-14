# Cooperative creation of inventoried encrypted application snapshots

`scripts/create-control-backup.mjs` encrypts an **existing verified application snapshot** into an explicitly selected private backup directory. It composes `verifyControl`, `encryptControlBackup` and the pruning module's stable directory lock and inventory validators. It does not extract a live database, discover directories or keys, decrypt, prune, activate, or attest executor shutdown. Production gates are unchanged.

## Explicit API and CLI

```js
const entry = await createControlBackup(snapshotDirectory, backupDirectory, {
  id,        // Fresh canonical UUID; filename is exactly `${id}.age`.
  recipient, // Explicit public age1 recipient, never a private identity.
  ageBinary, // Explicit absolute path to pinned age v1.3.2.
  now,       // Trusted host as-of time: canonical UTC YYYY-MM-DDTHH:mm:ss.sssZ.
});
// entry: {id, snapshot_at, bytes, sha256}
```

```sh
node scripts/create-control-backup.mjs \
  /private/snapshot /private/encrypted UUID PUBLIC_AGE_RECIPIENT \
  /private/tools/age 2026-09-28T17:00:00.000Z
```

Exactly six positional arguments are required. Success prints only the content-free entry above. Failure exits 1 with `CONTROL_BACKUP_CREATE_FAILED`, without paths, recipient, application content or native error details. Embedders must likewise avoid logging arbitrary caught exceptions. This entry is local bookkeeping, not a signed custody receipt.

The target directory and its `inventory.json` must already exist. For a **new, empty directory only**, initialize the private catalog explicitly to `{"version":1,"backups":[]}` before allowing concurrent operations. This script never initializes or replaces an existing catalog with an empty one. Directories must be owner-only (normally 0700), files owner-only (0600), regular files with one link, and paths absolute/canonical without symlink components. Existing pruning path, ancestor, inventory and journal checks apply unchanged.

## Publication and timestamp custody

1. Verify the plaintext snapshot, copy only `control.sqlite` and `manifest.json` to a newly allocated private temporary directory, then verify that frozen copy again. Use **that copy's original `manifest.createdAt`** as `snapshot_at` and encrypt that same copy. Neither filesystem mtime nor publication time changes retention provenance. The manifest is unsigned: this binds supplied metadata, not its authenticity or real-world age.
2. Acquire the same nonblocking Linux flock used by pruning. Validate all journals and the complete inventory, including every retained/candidate ciphertext's length, SHA256 and age header. Refuse incomplete `applying` journals, missing/extra files, unsafe entries and ambiguous leftovers. Refuse UUIDs already in the catalog or any retained prune plan. This bounded history is not an eternal global UUID registry; callers must always generate fresh UUIDs.
3. While holding the lock, produce the real age ciphertext in a new private `.create-*` directory. Validate its metadata and complete ciphertext against existing inventory bounds before final publication. The trusted helper `publishInventoriedBackup(directory, now, {id,snapshot_at}, produce)` calls `produce(absolutePrivateStagedFile)` under the lock; the callback returns `{bytes,sha256}`. It is an internal trusted-local composition API, not a model-callable writer, and must not reenter the lock or mutate other directory entries.
4. Exclusively copy to `UUID.age` with `COPYFILE_EXCL`; fsync the ciphertext and directory. Atomically write/fsync/rename the updated inventory under the same lock. Preserve every existing entry and original timestamp. Remove only this invocation's temporary staging on handled completion/failure, then release the lock. Existing reviewed prune plans are now stale and cannot be applied to the changed catalog.

The existing policy remains 7 Jakarta daily buckets plus 4 Monday-start weekly buckets, with maximum age independent of bucket selection. A snapshot already exactly 28 days old can be encrypted without rejuvenation; the next review marks it `maximum_age`. **Creation never automatically deletes it or any other file.** This is not enforcement of a 28-day deletion deadline: actual review/authorized apply and scheduling remain separate.

Catalog limits remain 256 ciphertexts, 256 MiB per ciphertext, 1 GiB combined, 256 KiB JSON and 32 retained prune journals. Encryption has its own snapshot/container limits; the stricter resulting ciphertext limit wins. No pruning or journal rotation occurs when capacity is reached. Hash/header verification of existing files does not authenticate age ciphertext without the private key.

## Failure is not rollback or permission to retry blindly

- Failure before final publication ordinarily leaves catalog and existing ciphertext unchanged. Handled temporary files are cleaned.
- An interrupted/failed copy may leave a partial final ciphertext. Failure after successful copy but before inventory commit leaves an unindexed final ciphertext. **Neither is deleted, overwritten or silently added to inventory on retry.** Exact-directory validation blocks subsequent create/review operations until a separately authorized operator reconciles the evidence.
- A failure after inventory rename can leave a complete catalogued ciphertext despite the caller receiving failure. A subsequent review can validate that state, but retrying the same UUID still fails. The failure itself is not a durable-success receipt.
- Process/power failure can leave `.create-*` or `inventory.json.next`; these cause refusal, not automatic repair. A private frozen plaintext copy under the host temporary directory may also survive a process crash. Encryption's private working directory can contain plaintext while encryption runs. Secure temporary storage, swap, crash cleanup and deletion of plaintext source backups require separate custody policy; this script never deletes the source backup.

The stable `.prune.lock` inode must never be replaced. All writers, creators and pruners must cooperate with `withBackupDirectoryLock`; nested acquisition fails. The inherited-descriptor Linux `/usr/bin/flock` interface protects cooperating processes, **not hostile same-UID processes, root, overriding ACLs, network filesystems or privileged path replacement**. Use a controlled local filesystem honoring exclusive creation, rename and fsync. No multi-file atomic transaction or power-loss hardware guarantee is claimed.

## Setup, verification and remaining limits

Reuse pinned **age v1.3.2 (BSD-3-Clause)** installation from `ENCRYPTED_CONTROL_BACKUP.md`; no new dependency, setup or package modification is introduced. Linux `/usr/bin/flock` from util-linux is also required. Node's SQLite backup API floor remains **22.16.0**; exercised here with Node **26.5.1**, age **1.3.2**, util-linux **2.38.1**. The minimum Node version was not independently exercised.

```sh
HEHEBOT_CREATOR_TEST_SCHEMA=/absolute/current-schema9.sql \
  npx vitest run tests/control-backup-creation.test.ts \
    tests/control-backup-pruning.test.ts tests/backup-retention.test.ts
npm run typecheck
```

The optional schema environment variable affects only the disposable test fixture; default is `DB/schema.sql`, and production verification still uses the existing pinned schema fingerprints. Test binaries default to `.local/age-v1.3.2/age/{age,age-keygen}`; creator tests also accept explicit `HEHEBOT_AGE_BIN`/`HEHEBOT_AGE_KEYGEN_BIN` paths. Tests use actual age encryption and disposable identity decryption, exact plaintext roundtrip, original timestamp/hash/bytes, source/key/kept-file preservation, contention, duplicate IDs, stale review rejection, incomplete apply, known-history UUID reuse, unsafe catalog states, publication fault injection and fixed CLI errors. Injected I/O failures and simulated crash leftovers are not a power-cut durability test.

This is offline application backup custody only. Off-host durability, recipient/key availability, authenticated provenance, remote-copy retention, coordinated DO/native/runtime-journal checkpoints, old-executor stop/lease evidence, unresolved-effect reconciliation and restore activation fencing remain separate. A created or decryptable application backup does not establish full-system restore readiness.
