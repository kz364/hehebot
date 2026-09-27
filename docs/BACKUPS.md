# Nightly off-host encrypted control-plane backup (Shrunk-scope "Backups" row)

This is a Worker Cron Trigger that nightly exports the Durable Object's SQLite
control plane, encrypts it in-Worker to an owner-held age recipient, and
writes it to R2 with 14-day retention — plus a scripted, tested offline
restore path. It is **not** native/Sprite backup, and it is **not** a purge or
retention-expiry proof program (that is explicitly out of scope; see
`TODO.md`'s Shrunk-scope table).

## What is backed up, and what deliberately is not

| In the nightly backup | Not in the nightly backup | Recovery path |
| --- | --- | --- |
| The Durable Object's application SQLite (objects, events, runs, memory, routines, effects, ledgers — the exact `hehebot-control-export` logical snapshot; see `docs/CONTROL_EXPORT_IMPORT.md`) | Codex OAuth/auth cache on the Sprite | Re-login through the supported Codex app-server flow. AGENTS.md forbids copying auth caches; this backup never touches the Sprite. |
| — | The Sprite's browser install | `scripts/setup-browser.sh` reproduces it from scratch. |
| — | Runtime/provider config (`wrangler.jsonc` `vars`: `PROVIDER_CONFIG`, `ACTION_POLICY_IDS`, `TOOL_POLICY_IDS`, `HEHEBOT_WHATSAPP_READ_POLICIES`, `TRIGGER_CONFIG`, `HEHEBOT_EXECUTION_MODE`, `HEHEBOT_STUCK_POLICY`, `HEHEBOT_SUCCESSOR_BACKOFF`, `HEHEBOT_BACKUP_AGE_RECIPIENT`, and secrets set via `wrangler secret put`) | It is a small checked-in/operator-held file, not application data; keep `wrangler.jsonc` and the secret values themselves under separate custody (secrets are never in git). |

## How it runs

`wrangler.jsonc` `env.hehebot.triggers.crons` fires `"0 20 * * *"` (20:00 UTC =
03:00 Asia/Jakarta, a quiet hour) into the Worker's `scheduled()` handler
(`src/worker/index.ts`), which calls the Durable Object's
`runScheduledBackup()` RPC method (`src/worker/control-object.ts`) — never an
owner request, so no Access/local auth applies to this path. The actual work
is `runScheduledBackup()` in `src/core/scheduled-backup.ts`:

1. If `env.BACKUPS` (the R2 binding) or `env.HEHEBOT_BACKUP_AGE_RECIPIENT` is
   unset, it does nothing — no runtime_metadata write, no notice. The feature
   is off by default (`wrangler.jsonc`'s `hehebot` env ships the var empty).
2. Otherwise it produces the logical export via the existing
   `exportControl(db, now)` (one synchronous DO transaction/read — the same
   function the owner-facing `/v1/export/control` endpoint uses).
3. It encrypts the export's UTF-8 bytes to the configured `age1...` X25519
   recipient using the `age-encryption` npm package (**v0.3.1, BSD-3-Clause**,
   published as `age-encryption` on npm / `jsr:@age/age-encryption`; upstream
   `github.com/FiloSottile/typage`, by Filippo Valsorda — the same author and
   wire format as the pinned `age` v1.3.2 CLI already used elsewhere in this
   repo for offline backups). It depends only on the pure-JS `@noble/*`
   cryptography libraries and the Web Crypto API, both available in workerd,
   so encryption happens **in the Worker with no shelled-out binary**. Per
   AGENTS.md's reuse policy: exact pinned version `0.3.1`, no modifications,
   no bundled notices required beyond this record (BSD-3-Clause requires
   preserving copyright/license text in redistributed source, not a runtime
   notice; `node_modules/age-encryption/LICENSE` carries it).
4. It writes the ciphertext to R2 bucket `hehebot-backups` (binding
   `BACKUPS`) at `control/YYYY/MM/DD/<iso>-<sha256-prefix>.age`, plus a small
   plaintext sidecar manifest at the same key with `.manifest.json` appended:
   `{created_at, schema_version, bytes:{plaintext,ciphertext},
   sha256:{plaintext,ciphertext}, row_counts:{<table>: <rows>, ...}}`. If the
   manifest write fails, the ciphertext object is deleted rather than left
   orphaned — never a partial pair.
5. It lists everything under the `control/` prefix and deletes any `.age`
   object (and its manifest) beyond the newest 14, keyed by the ISO timestamp
   in the key (which sorts lexicographically = chronologically).
6. It records `runtime_metadata['backup:last'] =
   {at, ok, key?, bytes?, sha256?, error_code?}` and posts a `notice` event
   (`kind:'degraded'`, `reason: 'BACKUP_FAILED'` or `'BACKUP_STALE'`) **once
   per changed condition** — not every day, and not repeated while the same
   condition persists. A recovery to `ok` clears the marker silently. This
   also runs on every owner request's maintenance pass
   (`PersonalControl.reconcile()`), so staleness (no successful backup in the
   last 48h) surfaces even if the cron trigger itself stops firing.
7. Export size/rows are already bounded by `exportControl` (4 MiB / 10,000
   rows — `EXPORT_LIMIT`); the encrypt+upload tail additionally has a 20s
   wall-clock deadline (`BACKUP_TIMEOUT`) so a stalled R2 call fails closed
   with a recorded failure notice instead of a partial/hanging write.

`settings.backup` in `/v1/state` (`src/core/control.ts`) reports
`{enabled:false}` when unconfigured, or
`{enabled:true, kept:14, at?, ok?, key?, bytes?, sha256?, error_code?}`
otherwise. The portal's Workspace → Private data export panel shows a line
("Last backup: `<time>` · 14 kept", or the failure/error code) driven by this
field (`public/index.html` `#backup-status`, rendered in `public/app.js`'s
`renderBackupStatus()`).

## Integrator setup

```sh
npx wrangler r2 bucket create hehebot-backups
age-keygen -o ~/.hehebot-backup-identity.txt   # keep this file offline; never commit or upload it
# age-keygen prints "Public key: age1..." — put ONLY that public key in wrangler.jsonc:
#   env.hehebot.vars.HEHEBOT_BACKUP_AGE_RECIPIENT = "age1..."
npx wrangler deploy --env hehebot
```

The `r2_buckets` binding (`BACKUPS` → `hehebot-backups`) and the
`triggers.crons` entry are already committed in `wrangler.jsonc`'s
`env.hehebot`; only the bucket's actual creation, the recipient var's real
value, and the deploy are live/operator actions this repo cannot perform for
itself (see the HARD CONSTRAINTS this change was built under: no deploy, no
R2 bucket create, no secret/var push). Until the bucket exists and the
recipient var holds a real `age1...` value, `runScheduledBackup()` is a no-op
by design (see step 1 above) — the Cron Trigger firing on an unconfigured
Worker is harmless.

## Restore

1. Find a backup's key: list `control/` in the bucket, or read
   `settings.backup.key` from `/v1/state` for the most recent one.
2. Download the ciphertext and its manifest:
   ```sh
   npx wrangler r2 object get hehebot-backups/<key> --file ./backup.age
   npx wrangler r2 object get "hehebot-backups/<key>.manifest.json" --file ./backup.manifest.json
   ```
3. Reconstruct a verified snapshot offline, using the pinned age v1.3.2 CLI
   (`.local/age-v1.3.2/age/age` or `HEHEBOT_AGE_BIN`; see
   `docs/ENCRYPTED_CONTROL_BACKUP.md` for how that pinned build is obtained)
   and the owner's private identity file from `age-keygen` above:
   ```sh
   node scripts/restore-control-backup.mjs \
     /absolute/backup.age /absolute/backup.manifest.json \
     ~/.hehebot-backup-identity.txt /absolute/path/to/age \
     /absolute/new-snapshot-dir
   ```
   This decrypts with the pinned CLI, checks the ciphertext's and the
   decrypted plaintext's SHA-256 against the manifest, checks the decrypted
   export's row counts against the manifest's `row_counts`, then calls the
   existing `importControlExport()` (`scripts/import-control-export.mjs`),
   which independently re-verifies the full `hehebot-control-export` contract
   (schema pin, cell types, int64 bounds, private staging) before publishing
   `/absolute/new-snapshot-dir/{control.sqlite,manifest.json}`. A tampered or
   truncated ciphertext, or a manifest that doesn't match, fails closed before
   the importer ever runs (`CIPHERTEXT_MISMATCH`, `PLAINTEXT_MISMATCH`,
   `ROW_COUNT_MISMATCH`, `MANIFEST_INVALID`/`MANIFEST_MISMATCH`).
4. **This restores application data only.** There is no supported path in
   this repo today to load a reconstructed `control.sqlite` into a *live*
   Cloudflare Durable Object — Durable Object SQLite storage is not
   externally writable via a supported Cloudflare API, and this project does
   not build or claim one. The honest gap: full-system restore into a fresh
   deployment requires either a future supported DO storage-import path, or
   provisioning a fresh Worker/DO and replaying the exported data through the
   existing owner-authenticated `/v1/commands` surface (not built here). The
   verified reconstructed snapshot (`control.sqlite` + `manifest.json`) is the
   same offline-verified artifact the rest of this repo's backup tooling
   already treats as the trust boundary (see "This is not restore admission"
   in `docs/CONTROL_EXPORT_IMPORT.md`, which applies unchanged here) — this is
   deliberately not overstated as full disaster recovery.
5. Native state (Codex auth, browser install, runtime config) is never in
   scope for this restore; re-establish those per the table above.

## Tests

`tests/scheduled-backup.test.ts` (unit, fake R2 bucket, generated in-test age
identity): disabled-when-unconfigured, exact manifest/hash/row-count
correctness, 14-object retention with paired ciphertext+manifest pruning,
pure retention-math (`pruneKeys`), fail-closed on a malformed recipient, no
orphaned ciphertext if the manifest write fails, a bounded wall-clock
deadline, and notice-once semantics (posts once per changed condition, silent
recovery, reposts on a repeat failure).

`tests/scheduled-backup-restore.test.ts` (end-to-end): Worker-side
`age-encryption` encryption → decrypt with the pinned `age` v1.3.2 CLI →
`scripts/restore-control-backup.mjs` → `importControlExport()` → identical row
counts to the source database, plus a tampered-ciphertext rejection test.
Both **skip visibly** (not a failure) when the pinned age binary isn't found
at `.local/age-v1.3.2/age/age` or `$HEHEBOT_AGE_BIN` — matching the existing
`tests/encrypted-control-backup.test.ts` convention.

```sh
npx tsc --noEmit -p .
npx vitest run tests/scheduled-backup.test.ts tests/scheduled-backup-restore.test.ts \
  tests/backup-control.test.ts tests/control-export-import.test.ts \
  tests/encrypted-control-backup.test.ts tests/control-restore-inspection.test.ts
npx vitest run
```

## Local status vs. live verification

Everything above is built, typechecked and tested locally against a fake R2
bucket and a real pinned age CLI. **Not done, and not claimed done:** the
actual `hehebot-backups` R2 bucket has not been created, the actual
`HEHEBOT_BACKUP_AGE_RECIPIENT` has not been set to a real value, and the
Worker has not been deployed with this config — all of which this change's
HARD CONSTRAINTS (no deploy, no `wrangler r2 bucket create`, no secret/var
push, no live systems) explicitly forbid doing from here. The Cron Trigger
firing for the first real nightly run, the resulting R2 object actually
existing, and one real end-to-end restore from a *live* nightly object remain
owner-performed integration steps (see `TODO.md`'s Backups row).
