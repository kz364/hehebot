# Implementation plan — local work in progress

Read [SPEC.md](SPEC.md) as the normative contract. Public examples are in [TEST_VECTORS/commands.json](TEST_VECTORS/commands.json); lifecycle expectations in [TEST_VECTORS/lifecycle.json](TEST_VECTORS/lifecycle.json). See docs/IMPLEMENTATION.md for current implementation evidence. No infrastructure is deployed; native production gates remain open.

| Milestone | Deliverables | Dependencies | Exit evidence |
|---|---|---|---|
| M1 Compatibility | Pinned image/runtime lockfile; isolated native submit/observe/cancel; strict runtime envelopes; OAuth setup/run/restart; native context visibility audit | None | S04/S05/S09/S10/S22/S32 capability report; unsupported lifecycle coverage blocks later sleep |
| M2 Contract/store | Owner auth, command validator, receipts, DO transactions, revisions, seed registry for action/tool policies | M1 boundaries | Every command valid/invalid fixture; duplicate and revision races; SQL constraints |
| M3 Lifecycle | Provider interface with fake first; state lock, epoch, serialized start/stop, queue-sequence drain, watchdog | M2 | 100 crash/drain interleavings; S01–S08/S24 |
| M4 Execution | Native adapter, hidden session map, submission journal, active operation ledger, effect intent/receipt, outbox | M1–M3 | Silent/tool/child tests; unknown effects never resend; cancellation settles |
| M5 Portal | Bot/room navigation, timeline, waiting/recovery UI, local unsent drafts, receipt polling, keyboard/mobile | M2/M4 | S09/S23/S29/S31 browser tests |
| M6 Memory | Scoped records, projection, revision pinning, proposal/promotion, deletion | M4/M5 | S10/S11/S30; incompatible routine histories never reused |
| M7 Routines/triggers | Natural-language typed tools, schedule preview, external occurrence authority, DST/misfire/versioning, signed sources | M2–M6 | S14–S18; no duplicate native cron |
| M8 Collaboration | Room membership, one responder, causal budget, parent yield/child result continuation, data-only cursors | M5–M7 | S12/S13; 1000 updates cause zero wakes/model calls |
| M9 Rollout | Dashboards, cost report, backup/restore, WhatsApp matrix, canary | M3–M8 | Seven-day report; S25–S27; owner-visible limitations |
| M10 Optional exporter | Supported source discovery, strict bundle schema, inspect/export/validate CLI, import diff preview | M2/M5/M7 | S28; disabled imports and explicit omissions |
| M11 Optional desktop | Supported interface proof, scoped node actions, online/offline, cancel/checkpoint | M4/M9 | S29; Mac absence never blocks unrelated work |

Execution sequence within each milestone: read current code and instructions; add the minimum contract; implement fake/dependency adapter; test failure paths; integrate; record exact tested versions. No broad refactor or cloud provisioning is implied by this plan. Installation-specific action/tool/trigger policy registries are operator-provisioned configuration in v1; model-authored routines can reference allowed IDs but cannot create or expand permissions.

The original target validation commands below remain milestone requirements. Only scripts listed in package.json are currently runnable; seeded interleavings, restore and cost-report commands are not implemented:

```sh
npm ci
npm run test:unit
npm run test:contracts
npm run test:lifecycle -- --seed=41 --iterations=100
npm run test:adapter
npm run test:e2e
npm run test:restore
npm run test:cost-report -- --days=7
```

Before cloud provisioning: select exact region/size/image, quote compute/rootfs/volume/backup/network/control-plane charges, establish scoped provider credentials, and resolve M1 compatibility gates. Before production mutation tests: use a synthetic destination first and require existing explicit action authorization for real recipients. Use subscription-backed OAuth; no paid API key for convenience. Long local batches run under PID-scoped `caffeinate -i` with health checks at least every 15 minutes.

Rollback checklist: pause new dispatch and schedules, preserve receipts, settle/cancel active operations, reconcile unknown effects, confirm old provider stopped, checkpoint, switch compatible image/schema, perform one read-only test, compare receipt and occurrence counts, re-enable selected flags. A coordinated backup restore is required when native schema is incompatible; disclose its RPO instead of replaying effects blindly.
