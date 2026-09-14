# Hehebot agent handoff

Checkpoint: 2026-09-14. This is a source-based continuation guide, not permission to use the original owner's accounts. The repository is `kz364/hehebot`; legacy `clawbot` identifiers are intentionally retained. **The assistant is not operational. Production execution and native verification flags remain false.**

## Start here without the original conversation

1. Read [AGENTS.md](../AGENTS.md), [README.md](../README.md), and this handoff.
2. Read [project intent](PROJECT_INTENT.md), [SPEC.md](../SPEC.md), [product UX requirements](../PRODUCT_UX_SPEC.md), and [implementation plan](../IMPLEMENTATION_PLAN.md). These contain targets, not completion claims.
3. Read [current implementation evidence](IMPLEMENTATION.md) and [Codex contracts and limits](CODEX_RUNTIME_SETUP.md). The later direct-Codex choice supersedes older OpenClaw-foundation and single-active-run language. OpenClaw/browser/Mac setup documents remain historical references unless independently revalidated for Codex.
4. Run the credential-free verification below before changing behavior. Work from the checked-out source and test assertions, not historical test counts alone.

## Reproduce the current baseline

Use a Linux orb or equivalent environment with Git, Node/npm and OpenSSL. The independently tested environment used Node 26.5.1 and npm 10.9.9; package.json declares the minimum Node version. No provider credentials or model account are needed.

```sh
git clone https://github.com/kz364/hehebot.git
cd hehebot
bash scripts/verify-codex.sh
npm ci --prefix desktop
npm test --prefix desktop
```

The wrapper installs locked dependencies, generates ignored Worker types, installs pristine Codex 0.154.0, runs the isolated probe and all direct-Codex/control fixtures, then typechecks and dry-run builds. It uses disposable private homes, scripted loopback model responses and local HTTPS Worker/SQLite state. It does not deploy, connect accounts or expose the local authentication bypass through a portal.

Publication rerun passed: 4 setup tests, 343 core tests across 21 files, 99 runtime tests, 20 HTTP checks, native lifecycle fixture (14 scripted requests), MCP and dynamic-control fixtures (7 requests/14 assertions each), supervisor fixture (7 requests/17 assertions), and build. Desktop unit tests passed 15/15. The final wrapper report deliberately says `assistantOperational:false`, `productionAdmission:false`, `modelJudgmentVerified:false`.

## Ownership and implemented behavior

| Boundary | Source and current behavior |
|---|---|
| Durable control plane | `src/worker/`, `src/core/`, `DB/`: owner commands, receipts, scoped snapshots, routines/occurrences, skills, effects, native-task metadata, locks, epochs and leases. Public mutations enter `/v1/commands`. |
| Native transport | `runtime/codex-transport.mjs`: pinned app-server stdio, bounded requests, optional host dynamic callbacks, denied approvals by default, no automatic replay. |
| Durable adapter | `runtime/codex-adapter.mjs` and journal modules: acknowledged exact native identities, submit/steer/cancel intent, unknown-outcome preservation, exact observed-child cancellation. |
| Event routing | `runtime/codex-events.mjs`: buffer before durable binding; journal roots, commands, MCP calls, spawn receipts and direct-child turns; fence conflicting or incomplete observations. |
| Scoped tools | `runtime/codex-tools.mjs` reuses the existing control handler: host grant and exact admitted root identity, durable call fingerprints/results, no replay of unknown effects. Children cannot inherit root authority. |
| Supervision | `runtime/execution-supervisor.mjs`, `runtime/execution-bridge.mjs`: claim/lease/submission custody and root-only completion rejection. Real native supervisor fixture exists; production service assembly and complete operation accounting do not. |
| Provider lifecycle | `src/providers/`, Sprite service/Tasks/activity modules in `runtime/`: selected Sprites integration pieces, not a verified end-to-end sleeping executor. |
| Clients | `public/`: static portal; `desktop/`: independently written remote-only Electron shell, no local agent brain. macOS acceptance/signing are still pending. |

## What the native evidence does and does not prove

- A command can outlive a completed root and be absent from root history. FIFO release produces a late completion automatically journaled by the router. Root completion is not an all-work barrier.
- Native spawn receipts and direct-child turn events are routed into the journal. A child can outlive its parent. Durable exact child cancellation interrupts once; accepted acknowledgments are separate from observed interruption/HTTP closure. Lost acknowledgment and concurrent dedupe are covered synthetically, not by live fault injection.
- A controlled stop/restart after observed work settles recovers exact thread/turn output and persisted obligations through read-only reconciliation. This is not active-work crash recovery or an authoritative recursive descendant census.
- Root dynamic tools carry exact native call identity. Pinned native spawned children do **not** inherit those tools (`dynamicChildToolsAvailable:false`). The root callback must not be treated as a child effect grant. Fixed shared MCP credentials do not identify individual child callers.
- Actual native MCP/dynamic callbacks reach certificate-validated HTTPS Worker/SQLite. Receipts and state prove pending skill provenance, paused routine save/inspect/manual enqueue/delete cancellation, and exact admitted skill reads after disablement.
- The supervisor fixture actually executes a manually queued source routine's scripted native tool sequence. The separate routine created/queued by that sequence is cancelled without execution. Root-only completion is rejected with `NATIVE_SETTLEMENT_INCOMPLETE`; the Worker run stays running. Activity and operation providers in this fixture are stubs, not live sleep proof.
- Model choices are scripted. No authenticated inference, model judgment, recursive child/effect settlement, production admission or real connector mutation is established by these fixtures. `externalModelCalls:0` is fixture-declared, not packet-captured.

## Continue implementation in this order

1. **Bounded authenticated inference:** in an explicitly authorized runtime, verify supported ChatGPT login and available models, then a no-tools synthetic turn. Never copy auth from another orb or silently fall back to an API key. Verify restart continuity and eventual refresh separately.
2. **Production service assembly:** connect actual supervisor/bridge/adapter/router/tool handler to Sprite boot/wake and Worker custody. Replace activity/operation stubs with trusted accounting; test warm wake, cold start, lease loss, disconnect and uncertain acknowledgments. Do not unblock flags to bypass missing contracts.
3. **Child authority and settlement:** implement Worker mapping/owner cancellation delivery and resolve unsupported child-effect grants/recursive settlement at supported boundaries. One considered, unimplemented design is read-only native children proposing work that an authorized root brokers through durable host-owned proposals. This is a design option, not an approved or verified solution; it needs provenance, policy, locks, idempotency and protection against alternate effectful tools.
4. **Intent and experience:** distinguish status/new work/explicit steer/cancel without implicitly steering background tasks; finish streaming/task/recovery UX and scoped knowledge flows against the UX/spec acceptance IDs.
5. **Connectors, browser and Mac:** establish supported headless callable operations and individual scopes, then owner consent. Catalog presence is not execution capability. Calendar read support does not imply writes. Mac permissions and real hardware checks cannot be reproduced by Linux fixtures.
6. **Release gates:** coordinated backup/export/import, disabled imported routines, crash/restore, full settlement/sleep acceptance, measured costs and sustained operation. Preserve the one-runtime-many-personas design and the no-wake/no-inference passive-update invariant.

Keep implementation gaps distinct from external authorization or upstream limitations. Record each new proof with its exact command, fixture boundaries and remaining uncertainty. Do not claim full completion from a green wrapper.

## Private state and account access are not in Git

The original development orb has an owner-authorized ChatGPT login and successful read-only Cloudflare account/Sprites listing checks. Those checks do not prove deployment permissions, authenticated inference, billing limits or provider lifecycle behavior. No hosting resource has been deployed at this checkpoint. A fresh clone has none of that access; use supported owner-authorized flows on its own runtime.

The owner authorized a $10 testing budget for the original work, interpreted as a total budget, not monthly recurring spend or a provider-enforced cap. Coordinate actual expenditure and resource ownership with the owner before another agent provisions anything; do not duplicate resources across agents. Testing approval does not establish routine policies or permit unreviewed real messages/calendar changes.

Do not publish or transfer `.local/`, auth caches, provider keys, raw personal exports/profiles, databases, browser sessions, logs or generated dependencies. The sanitized bot/routine specifications are tracked; private account/contact/calendar mappings require separate setup. No installed dependency patch or native database write is an acceptable compatibility fix.
