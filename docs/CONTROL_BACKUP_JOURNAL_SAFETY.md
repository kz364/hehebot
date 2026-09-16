# Local pruning journal sequence validation

Credential-free E10 checkpoint, 2026-09-16. This is a focused extension of
[local pruning](CONTROL_BACKUP_PRUNING.md), not full backup or restore acceptance.

The apply protocol processes the reviewed plan sequentially. A valid journal has
a prefix of `deleted` candidates, at most one `deleting` candidate, then only
`pending` candidates. Kept entries do not participate. Validation uses plan entry
order, not the insertion order of JSON state keys. The existing reviewed/complete
phase restrictions, inventory/hash/identity checks and explicit confirmation stay
unchanged. No format migration or automatic metadata repair is introduced.

Previously each state was validated independently. An `applying` journal could
therefore report a later candidate as deleted while an earlier candidate was still
pending, or contain two concurrent deleting candidates. Status accepted those
impossible receipts; apply could accept a missing later file with such a deleted
state. All journal consumers now reject these sequences before returning receipts,
publishing a backup, or starting further deletion. Invalid bytes are left intact.
This is corruption detection, not authenticated provenance: an attacker able to
rewrite a journal into a reachable state is outside this structural guarantee.

## Executed evidence

Node 26.5.1, checksum-pinned age 1.3.2, disposable private directories and generated
test identities. No accounts or live resources were used.

```sh
bash .agents/setup
npx vitest run tests/control-backup-pruning.test.ts -t 'unreachable applying'
npx vitest run tests/control-backup-pruning.test.ts tests/backup-retention.test.ts tests/control-backup-creation.test.ts tests/control-restore-inspection.test.ts
npm run typecheck
git diff --check
```

The regression-only command before the implementation failed all four new cases
(27 other tests skipped). The final four-suite run passed **114 tests**. Typecheck
and whitespace checks passed. Private logs: `.local/e10-setup.log`,
`.local/e10-red.log`, `.local/e10-focused.log`, `.local/e10-typecheck.log`.

Tests distinguish all nine two-candidate state combinations, with reversed JSON
key order: four unreachable combinations reject without additional unlink or
inventory/journal mutation; five reachable combinations resume, preserving kept
ciphertext and avoiding duplicate deletion. Additional injected failures before
and after deletion-receipt rename distinguish a missing file with unknown outcome
from a visible recorded receipt. Existing suites retain asymmetric 28-day and
Jakarta calendar boundaries, interrupted creation/deletion, corrupt inventories,
unknown effects/locks and conservative restore-inspection checks.

These are handled I/O-failure fixtures, not power-loss durability certification.
Missing `deleting` candidates still refuse as `PRUNE_OUTCOME_UNKNOWN`; neither
expiry nor inspection settles unknown effects or releases locks. Remote-copy
verification remains false. Off-host/key custody, native/browser/config coverage,
supported account reauthorization and independently confirmed old-executor stop
before activation remain required. No third-party deletion, full 28-day deletion
compliance, clean second-installation restore, RPO/RTO or production admission is
claimed. Shared TODO completion status remains owned by the integration thread.
