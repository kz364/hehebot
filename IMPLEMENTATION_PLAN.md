# Implementation plan — local work in progress

> **2026-09-27:** Milestones below are historical design milestones. The current implementation plan is the G rows in [TODO.md](TODO.md), per [docs/GROK_ALIGNMENT.md](docs/GROK_ALIGNMENT.md).


Direct Codex app-server 0.154.0 is the sole harness. Use [TODO.md](TODO.md) for the maintained progress checklist and ordered work, [the agent handoff](docs/HANDOFF.md) for continuation context and [current implementation status](docs/IMPLEMENTATION.md) for partial evidence. This document preserves design milestones, not a second live checklist. Unchecked broad milestones can include implemented subfeatures; inspect owning code and tests before rebuilding them.

Read [SPEC.md](SPEC.md) as the normative contract. Public examples are in [TEST_VECTORS/commands.json](TEST_VECTORS/commands.json); lifecycle expectations in [TEST_VECTORS/lifecycle.json](TEST_VECTORS/lifecycle.json). See docs/IMPLEMENTATION.md for current implementation evidence. No production application deployment is verified; production execution flags remain false and acceptance gates remain unpassed.

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

## Expanded product backlog and runtime decision

[SPEC section 21](SPEC.md#21-consolidated-product-and-apache-reuse-contract) consolidates the S/O contracts, [UX01–UX15](PRODUCT_UX_SPEC.md), Apache adaptation and sleeping-container acceptance R01–R08. These are targets, not completed features. M10's optional proprietary-source extraction is distinct from required export/import of our own portable state. M11's optional Mac backend does not exclude cloud computer use or teaching from parity.

- [ ] **M1/M5 — Apache reuse assessment (R01/R02/R06):** compare a bounded OpenMausBot remote-shell/chat slice with Rakazo's smaller shell against our existing Worker API. Record pinned source paths/licenses/dependencies, exclude enterprise code and restricted assets, preserve notices, and estimate extraction versus rewrite work before selecting one client. Test origin isolation, reconnect and exact task identity; do not import a competing backend or local executor requirement.
- [ ] **M1/M4 — Supported Codex sign-in (R03/R08):** evaluate Apache `codex-device-auth.ts` and `codex.ts` independently of client selection. Test same-runtime account verification, expiry/cancel/duplicate-login, quota state and refresh; audit MCP approval defaults, retries and child settlement before treating the driver as compatible. Keep credentials private to each installation.
- [ ] **M3/M9 — Preserve sleeping-runtime economics (R05/R07):** prove zero wake/inference from idle clients/history/reconnect, bounded live-view/login holds, durable restart recovery and no sleep during unsettled work. Measure actual active/startup/idle/storage/traffic cost for the reviewed workload versus always-on operation. Docker alone is not a saving; no per-bot VM, local desktop brain or unpriced always-on services.

- [ ] **M1/M4 — Codex boundary (UX05/15):** record unsupported capabilities, auth requirements and coordinator/executor ownership. Test long-task responsiveness, exact steering, cancellation settlement, crash uncertainty and idle restart. Do not build a second model/tool loop.
- [ ] **M6 — Managed skills (UX11):** add stable catalog/revisions, per-bot enablement, conversational authoring/editing, update-before-duplicate, reference loading, staged review and safe validation. Verify revisions stay pinned for admitted work and private facts do not leak into shared procedures. Optional automatic review needs its own explicit policy and measured budget.
- [ ] **M7 — Full routine lifecycle (UX06/12):** wire model-facing typed commands for create/list/inspect/edit/pause/resume/delete/run-now; test real execution, paused manual runs, event triggers, history, configuration preflight and execution-versus-delivery failures. Revisit the current 20-enabled-installation cap against Grok's documented 50-per-bot capability; publish cost and load-test evidence before raising it.
- [ ] **M5/M6/M8 — Conversation and knowledge UX (UX01–07/13):** complete quiet streaming, task control, scoped memory correction/search, mentions, attachments/artifacts, replies/reactions, roster, attention and notification settings. Verify rendered desktop/mobile states, reconnect and cross-bot isolation.
- [ ] **M4/M5/M11 — Computer and teaching (UX08/14):** integrate lightweight browser/GUI tools and secure viewing/handoff, then explicit demonstration capture → reviewed skill → safe test. Verify lock ownership, secret exclusion and uncertain timeout recovery in independent orbs; keep actual local-device permissions as separate hardware acceptance.
- [ ] **M9/M10 — Setup and portability (UX09/14/15):** extend reproducible setup, capability/connector catalog, reviewed templates and versioned state export/import. Test a clean second orb, no transferred credentials, disabled imported schedules, omissions, interrupted upgrades and rollback. Native session migration is not assumed.
- [ ] **M9 — Complete parity inventory (UX10/13/14):** maintain source-dated rows for every advertised capability, including specialized connectors, team policies, local-device access, mobile delivery/distribution and payment flows. Classify implemented/synthetic-tested/live-tested/blocked/deliberate difference; do not use generic MCP or portal support as blanket parity evidence. Measure total model overhead and record remaining externally gated tests.

## Milestone execution and rollout

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
