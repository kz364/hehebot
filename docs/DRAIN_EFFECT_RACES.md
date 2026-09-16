# Seeded drain/effect evidence (2026-09-16)

`tests/drain-effect-races.test.ts` adds 200 reproducible model-scheduled sequences
over the real in-memory SQLite schema, ControlCore, LifecycleCore, EffectLedger
and ResourceLedger. Seeds are `0xe15000..0xe150c7` (14766080..14766279).
Random UUIDs label records but do not choose actions or affect their ordering.
Failures include the seed and ordered action trace.

The fixture enables execution only in its disposable core options. Production
configuration, gates, accounts, shared state and provider resources are unchanged.

## What the sequences establish locally

Each seed admits three policy-authorized effects and two resource locks. At least
one effect dispatches before randomized scheduling starts. A state-aware action
frontier interleaves dispatch, uncertainty, asymmetric confirmed/failed receipts,
owner cancellation and three controller-object reconstructions. Half the seeds
also lose their lease at its exact boundary and receive a synthetic stopped-provider
observation at a random point relative to receipts. The other half finish cancelled
work, release locks, wait the idle grace and prepare drain. Queue arrival/cancellation,
commit, reconstruction and optional exact lease loss then race.

After each action the independent model checks exact effect IDs/statuses/receipts,
lock ownership and retention, original attempt/native identity, absence of retries
and premature output. Additional checks cover:

- Rejected lock release is atomic while any effect is unresolved.
- Unknown effects cannot dispatch again; duplicate intent returns the original ID.
- Held-lock replay preserves rows; terminal duplicate receipts cannot replace data.
- Paused/unknown provider observations cannot clear custody.
- Stopped observations preserve unresolved-effect locks and clear settled locks.
- Old executor heartbeat/completion/drain reject after lease loss; authority remains
  valid one millisecond before expiry.
- Cancellation suppresses output and does not erase uncertainty.
- New queue sequence invalidates a prepared drain even after queued-work cancellation.
- Only successful commit stores a checkpoint; failed commit leaves none.

These are deliberately admitted transition sequences with a finite action frontier,
not random malformed inputs. Each step advances the model; rejection checks are
additional invariant probes.

## Reproduction and mutation evidence

```sh
npx vitest run tests/drain-effect-races.test.ts --silent=false --disableConsoleIntercept
```

Result: **200 passed**. Deterministic coverage counters:

| Event | Count |
| --- | ---: |
| Initial effect intents | 600 |
| Admitted dispatches | 369 |
| Explicit unknown transitions (excluding watchdog conversion) | 288 |
| Terminal receipts | 600 |
| Owner cancellations | 200 |
| Controller-object reconstructions | 700 |
| Active-task lease losses | 100 |
| Stops observed with pending / settled effects | 65 / 35 |
| Admitted drain preparations | 100 |
| Successful commits / queue invalidations / lease invalidations | 38 / 33 / 29 |

Temporary test-local mutation: immediately after the first successful
`life.observeStopped` call in the `stop` closure, before `stopped = true`, insert
`f.db.exec('DELETE FROM resource_locks')`.
This emulates the plausible wrong implementation that process stop settles every
resource. The same command produced **65 failed, 135 passed**; the first failing
seed was 14766080, with trace:

```text
0:dispatched -> 0:outcome_unknown -> reconstruct -> 1:intent -> 1:dispatched -> lease-loss -> 1:outcome_unknown -> cancel -> stop-observation
```

Both expected lock rows were missing. Removing that temporary statement restored
**200 passed**, with identical coverage counters. No production source was mutated.
Local logs: `.local/drain-effect-focused.log`, `.local/drain-effect-mutation.log`,
and `.local/drain-effect-restored.log`.

Full verification on the imported local-main baseline plus this test:

```sh
bash scripts/verify-codex.sh
npm ci --prefix desktop --no-audit --no-fund && npm test --prefix desktop
```

The combined verifier exited 0: **1,131 control tests, 253 runtime tests**, pinned
compatibility and all native/service fixtures, typecheck and build dry run passed.
Its final status was `passed`, with `productionAdmission: false`. Desktop:
**16 passed**. Logs: `.local/drain-effect-combined.log` and
`.local/drain-effect-desktop.log`. `git diff --check` also passed.

## Limits: E02 and E15 remain open

No production defect was reproduced by these sequences. They do not prove a
process crash, disk durability/reopen, lost network acknowledgement, actual remote
effect execution, native descendant/tool settlement, supervisor drain awaits,
successful recovery/restart, or live Sprite hold/sleep/wake behavior. Reconstruction
uses the same in-memory database; provider observations and destination receipts
are supplied synthetically. Recovery-required tasks stay parked rather than being
silently resumed. Cross-task lock competition and authenticated effect ingress are
covered elsewhere, not added by this model. The direct dispatched-to-confirmed path
is covered elsewhere; this model emphasizes uncertain outcomes and cancellation.

Thus these 200 local sequences extend the earlier queue/stop-only tests; they do
not close the separate 100 crash/restart receipt-loss injections or full live
drain/effect acceptance gates.
