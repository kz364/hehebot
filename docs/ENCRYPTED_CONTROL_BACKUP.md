# Encrypted offline application snapshots

`scripts/encrypt-control-backup.mjs` packages an existing, verified application snapshot using **standard age encryption**, or decrypts one into a new private staging directory and runs `verifyControl` before success. It does not extract a live database, inspect native state/auth caches, discover keys, contact accounts, upload anything, activate an executor, or claim coordinated restore. Original snapshots, ciphertext and identity files are never automatically deleted or modified. Production gates remain unchanged.

## Pinned permissively licensed dependency

Use upstream [FiloSottile/age **v1.3.2**](https://github.com/FiloSottile/age/releases/tag/v1.3.2), BSD-3-Clause. No upstream source or binaries are copied into these three implementation files. The official binary archive includes `age/LICENSE`, containing age and bundled Go copyright/license notices; retain it with any redistribution. Source contracts reviewed: [`cmd/age/age.go`](https://github.com/FiloSottile/age/blob/v1.3.2/cmd/age/age.go), [`cmd/age/parse.go`](https://github.com/FiloSottile/age/blob/v1.3.2/cmd/age/parse.go), [`doc/age.1.ronn`](https://github.com/FiloSottile/age/blob/v1.3.2/doc/age.1.ronn), [`x25519.go`](https://github.com/FiloSottile/age/blob/v1.3.2/x25519.go), and [release notice packaging](https://github.com/FiloSottile/age/blob/v1.3.2/.github/workflows/build.yml). No native patches or modifications were made.

`.agents/setup` and `scripts/verify-codex.sh` invoke `bash scripts/setup-age.sh`,
which checks the archive and extracted binary hashes below. Repeated setup uses
the checked local archive without downloading it again. The setup supports Linux
x86_64 only and retains `age/LICENSE`; it generates no identities.

Equivalent manual setup on Linux amd64, from repository root:

```sh
mkdir -p .local/age-v1.3.2
curl --fail --location --silent --show-error --max-time 120 \
  https://github.com/FiloSottile/age/releases/download/v1.3.2/age-v1.3.2-linux-amd64.tar.gz \
  -o .local/age-v1.3.2/release.tar.gz
printf '%s  %s\n' \
  cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10 \
  .local/age-v1.3.2/release.tar.gz | sha256sum -c -
tar -xzf .local/age-v1.3.2/release.tar.gz -C .local/age-v1.3.2 \
  age/age age/age-keygen age/LICENSE
.local/age-v1.3.2/age/age --version
```

Result: checksum `OK`, version `v1.3.2`. The release asset SHA256 above was checked against GitHub's published release digest over HTTPS. Upstream also supplies [Sigsum proofs](https://github.com/FiloSottile/age/blob/v1.3.2/SIGSUM.md); this unit did **not** verify those proofs and does not claim independent signed-build attestation. Extracted binary SHA256:

- `age`: `eb7dd1b518f0a307c99cd97782623c5321da049154b04acd2d98d21aa7bc9b2c`
- `age-keygen`: `0a0009db842259d6717f7eeb30acb6b90d2a2eb924c6acd0a0db0ca1f1537899`

Only `age` is required at runtime; `age-keygen` generates disposable test identities. Plugins in the release archive are not installed. Other architectures require their own reviewed release asset/digest; the Linux amd64 digest must not be reused. The wrapper checks the explicit binary's version on each operation; version output is not a substitute for trusted installation and checksum review. Node's supported SQLite API floor is 22.16.0, reflected in package engines and setup; execution here used Node 26.5.1. POSIX permissions and `/dev/fd/3` are required; Windows is not supported by this wrapper.

## Explicit inputs, no key discovery

```sh
node scripts/encrypt-control-backup.mjs encrypt \
  /private/backups/snapshot-001 /private/backups/snapshot-001.age \
  "$PUBLIC_AGE_RECIPIENT" /absolute/path/to/age

node scripts/encrypt-control-backup.mjs decrypt \
  /private/backups/snapshot-001.age /private/staging/snapshot-001 \
  /private/keys/backup-identity.txt /absolute/path/to/age
```

The recipient is a **public** native X25519 `age1...` key, not a secret. The decryption argument is only an explicit identity-file reference, never private key material, a passphrase or a secret environment variable. Exactly one native X25519 `AGE-SECRET-KEY-1...` identity is allowed in a file of at most 4096 bytes; blank lines and `#` comments from `age-keygen` are accepted. The wrapper validates the format and supplies the opened descriptor as `/dev/fd/3`, without copying the identity to staging or putting its bytes in child argv/environment. age validates Bech32 checksums. Multiple identities, SSH/PQ/plugin identities, encrypted identity files and passphrase prompts are intentionally unsupported. Never put private identity text into a command argument.

The age child gets only `PATH=''` and `LANG=C`; no account environment, SSH agent, implicit home or arbitrary extra flags are forwarded. Only the explicit absolute binary is executed. age's native identity selection does not invoke plugins from ciphertext. Version calls time out after 5 seconds; encryption/decryption processes are killed and joined after 120 seconds. These timeouts bound the age processes, not SQLite verification or filesystem operations on a stalled device.

Source, ciphertext, identity and output-parent paths must be normalized absolute paths with no symlink components. Data files must be owner-only regular files with one link; relevant private directories must be owner-only (normally 0700). Binary files may be root-owned/readable-executable but not group/other-writable, and also cannot be symlinks/hardlinks. Existing destinations, including dangling symlinks, are rejected. No force/overwrite option exists. Use a trusted local filesystem and a trusted same-UID environment; mode-bit checks do not establish protection from the same UID, root, permissive ACLs, hostile mounts or concurrent trusted administrators replacing paths.

Encrypted output must be outside the source snapshot directory, preserving its exact two-component layout.

The module exports `encryptControlBackup(snapshotDirectory, encryptedFile, recipient, ageBinary)` and `decryptControlBackup(encryptedFile, stagingDirectory, identityFile, ageBinary)`. CLI success emits fixed operation/format/version/status fields. Failures exit 1 with a fixed message; child stderr is discarded. No paths, recipients, SQL errors, source bodies or key bytes are logged. Do not log arbitrary caught module errors in a new host integration.

## Fixed two-component container inside age

Output is an ordinary binary `age-encryption.org/v1` file encrypted by upstream age, **not a custom cryptographic format**. The decrypted payload is a small application container, not tar/zip:

1. Exact ASCII magic `HEHEBOT-CONTROL-BACKUP/1\n` (25 bytes).
2. Unsigned 32-bit big-endian manifest byte length.
3. Unsigned 32-bit big-endian SQLite byte length.
4. Exact `manifest.json` bytes, then exact `control.sqlite` bytes.

There are no entry names, directories, link metadata, compression, extension records or arbitrary extraction operations. The manifest is 1–65536 bytes; database is 100 bytes through 256 MiB and must pass the existing schema 8 verifier. Total plaintext must exactly equal 33 + manifest length + database length. Extra bytes, missing bytes, oversized fields, unknown magic/version and a manifest naming another database are rejected. Input ciphertext is bounded to maximum plaintext plus 1 MiB for age overhead; streamed plaintext and ciphertext are also bounded. Larger application backups require a separately reviewed limit/version change, not silent truncation.

Encryption first verifies the source directory, copies only its two fixed components into a private temporary directory, verifies that exact copy, then feeds the container to age. The encrypted output is published only after age exits successfully. The original source is retained. Decryption writes age stdout to a private temporary container and **waits for successful exit over the entire ciphertext before parsing or creating the requested plaintext directory**. Only then are the two fixed files materialized, verified by `verifyControl`, moved into a newly created private destination and verified again before returning success. Output files are 0600 and directories 0700; files and directories are synced.

age authenticates its stream in chunks: stdout can contain authenticated prefix plaintext before a later chunk fails. The wrapper does not expose that stream to consumers. The real tamper test confirms more than 64 KiB of prefix output from direct age while the wrapper emits no final-directory creation event and removes its temporary directory. This is full-message authentication before publication, not a claim that temporary prefix bytes never exist in memory/on disk.

Temporary plaintext directories are created under the explicit output parent and removed after handled success/failure. A crash, kill, power loss or cleanup I/O error can leave private temporary files or incomplete outputs; deletion is **not secure erasure**. Destination creation/file publication is no-overwrite but not one atomic multi-file commit. Treat an interrupted output as unusable until successful decryption/verification; do not automatically retry by overwriting it. This unit does not delete pre-existing snapshots or ciphertext and does not manage their retention.

## Credential-free validation and remaining boundaries

```sh
npx vitest run tests/encrypted-control-backup.test.ts
npm run typecheck
```

Tests default to the local binary paths installed above; explicit `HEHEBOT_AGE_BIN` and `HEHEBOT_AGE_KEYGEN_BIN` may name reviewed absolute binaries. An older extraction can set `HEHEBOT_ENCRYPTED_BACKUP_TEST_SCHEMA=/absolute/current-schema.sql` to read the transferred schema 8 fixture; it does not change verifier schema support. Missing age is a setup failure, never a skipped/pass result.

The 11 tests use real age, disposable identities and actual application SQLite snapshots. One disposable source snapshot is created with a 30-second setup bound; each case receives its own private copy and identities. They check exact round-trip bytes and source/key preservation, wrong identities, late authentication failure, truncation/header corruption, authenticated malformed containers, traversal manifests, bad hashes/counts, overwrite refusal, symlink/hardlink/private-mode rejection, entry/ciphertext bounds, denied identity/recipient variants, pinned version rejection, fixed CLI errors, and temporary cleanup. No live credentials or provider calls are involved.

This closes only local encrypted packaging. It does not establish off-host storage durability, recipient ownership, secure long-term identity custody/recovery, independent sender signatures, deletion/retention, RPO/RTO, live Durable Object export, coordinated journal/image backup, executor shutdown or restore fencing. Anyone possessing the public recipient can encrypt a new valid payload: age authentication detects ciphertext tampering, not who authored a backup. Approved provenance and key custody must be provided separately. Decryption to a valid application snapshot is never permission to start or take over an executor.
