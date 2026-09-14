# Local implementation status

## Current publication checkpoint, 2026-09-14

Read [the agent handoff](HANDOFF.md) for current code ownership and ordered continuation work. The latest publication rerun passed `bash scripts/verify-codex.sh`: 4 setup, 343 core, 99 runtime and 20 HTTP checks; actual native lifecycle, MCP, dynamic-control and supervisor fixtures; typecheck/build dry run. Desktop unit tests passed 15/15. Older counts below are historical.

Direct Codex now has automatic root/command/MCP/spawn/direct-child event routing, durable exact child cancellation, scoped root dynamic tool callbacks and actual supervisor-driven execution of a scripted routine. Root-only completion still rejects settlement; production flags remain false. Native child dynamic-tool inheritance is unavailable, recursive child/effect settlement remains unproved, and the production service/activity assembly is unfinished. Controlled settled-work restart readback is not active-work crash recovery.

Owner login/account discovery and read-only Cloudflare/Sprites credential checks succeeded in the original development orb. No authenticated inference or cloud deployment has been verified there yet; a fresh clone does not inherit those credentials. These local setup observations supersede older statements that no account was connected, but do not close the engineering or live acceptance gates.

## Direct Codex implementation, 2026-09-13

The owner selected Codex app-server and authorized implementation. The following supersedes earlier OpenClaw runtime-choice language, not the historical evidence below. **The assistant is not operational and the full specification is not implemented.**

- `runtime/codex-transport.mjs` implements the pinned stdio boundary, bounded frames/pending requests/backpressure, safe errors, explicit denied client capabilities and no automatic retries. Dedicated HOME/CODEX_HOME avoids inheriting Amp auth or provider keys.
- `runtime/codex-adapter.mjs` journals thread and turn submission, exact-turn steering and interrupt intent. Restoring an uncertain submission does not replay inference. Root completion and interrupt acknowledgements never certify child/tool/effect settlement. Production admission remains blocked.
- `scripts/setup-codex.sh` and `scripts/probe-codex.mjs` install 0.154.0 and verify a real isolated no-inference handshake/account read. The same installation and probe passed in an independent orb. Parent additionally verified real `thread/start` and exact `thread/read` without inference. These are not authenticated turn or recovery acceptance.
- `desktop/` is an independently written remote-only Electron shell. Fifteen tests cover private configuration, origin isolation, trusted login redirects and blocked native permissions/navigation. Linux rendering against the real local portal was inspected; it accurately displays the unavailable runtime. The Linux render used `--no-sandbox` in the orb and therefore does not verify Chromium sandbox enforcement. macOS packaging, signing and live login are unverified.

2026-09-14 continuation: managed skills now have staged review, revisions, per-bot enablement and pinned admission snapshots. The portal review/enable flows were exercised and inspected at desktop and narrow widths. A scoped MCP server exposes skill proposals and routine save/list/inspect/run/delete; authority comes from the admitted persona and action-policy snapshot, not model text. Routine edits also cover pause/resume. Queries paginate without creating work or requesting wake. Portal run-now/delete were exercised against real local SQLite and inspected at desktop and narrow widths. Executable skill files remain unavailable.

Current parent checks: 338 application tests, 72 runtime tests and 20 HTTP checks. The independent v5 archive passed the complete `bash scripts/verify-codex.sh` entrypoint from a clean extraction, including Worker type generation, 337 application/70 runtime tests, setup/probe, both native fixtures and build. Later parent native tests exercise a command remaining live after root completion (six scripted requests), journal preservation despite omitted history, and MCP routine inspection (six scripted requests, twelve assertions). These are credential-free execution contracts, not model judgment. Detailed versioned evidence and the upstream supervision gap are in [Codex setup](CODEX_RUNTIME_SETUP.md).

Unfinished implementation is still separate from external blockers: autonomous service/boot integration, full event reconciliation/approvals, native skill loading, expanded portal UX and portable state migration remain work to do. Direct-Codex customer login/refresh, live connectors/provider semantics, and actual Mac acceptance require their respective external environments. Supported app-server APIs do not provide an authoritative post-restart descendant census/settlement barrier; sparse history cannot replace it. Neither the shell nor the native fixtures close those gaps. See [setup](CODEX_RUNTIME_SETUP.md) and [the product backlog](../IMPLEMENTATION_PLAN.md).

## Historical OpenClaw and control-plane evidence

2026-09-10. The portal/control-plane foundation is implemented and tested locally. No deployment, provider provisioning, model inference, owner OAuth login or external message has occurred. The existing Mac OpenClaw configuration is unchanged. The earlier remote-Gateway setup remains available in SETUP.md and docs/REMOTE.md.

2026-09-13 update: [multi-orb verification](ORB_TESTING.md) records fresh isolated control-plane/native health checks and synthetic model calls through Amp's managed thread routing, without per-orb model credentials. These calls are not OpenClaw inference or proof of a working executor. [Grok parity research](GROK_PARITY.md) distinguishes implemented behavior, missing integration and owner-specific choices. The owner clarified that a conversational orchestrator must intentionally steer an identified task or queue independent work according to message intent; the current after-settlement-only follow-up remains a limitation. No OpenClaw source changes or production activation were made.

Latest acceptance supersedes the older test counts below: `node scripts/verify-local.mjs --desktop` passed **371 automated tests with zero skips**, 20 HTTP checks, two real Worker restarts, native agent/orchestration, portal-to-native persisted reply, browser, Linux desktop, and build dry-run. Native tests use scripted loopback model responses and pristine OpenClaw, not real-model judgment. Browser/orchestration and Linux desktop were independently reproduced in other orbs. [The checklist and exact limits](ORB_TESTING.md#completed-orb-acceptance-checklist-2026-09-13) distinguish direct native evidence from controller mocks. Managed tab identities do not survive Gateway restart; desktop timeout recovery does not establish action settlement.

`runtime/execution-bridge.mjs` provides tested claim/submission/completion custody and fails closed on ambiguous acknowledgments. `runtime/execution-supervisor.mjs` adds independent lease/hold renewal, fenced dispatch, exact cancellation and confirmed-drain release; `scripts/with-executor-lock.sh` supplies Linux process exclusion. Autonomous service/boot ownership, complete native settlement production and provider sleep integration remain unfinished. Production gates remain false. Real-model OAuth, live provider/connector semantics and Mac hardware acceptance still require owner setup; these are separate from unfinished implementation.

## Run locally

Use Node 24 (minimum package requirement: Node 22.13). From the repository:

```sh
npm ci
npm run types
npm run dev
```

Wrangler prints the loopback portal address. Local mode permits only localhost/127.0.0.1 and the `local-only` installation. Its SQLite state is separate from native OpenClaw state. Stop with Ctrl-C. Never expose local bypass mode through a public tunnel.

```sh
npm test
npm run test:runtime
npm run test:e2e
npm run build
```

`types` and the HTTP tests need local loopback access. Build generates static validators, typechecks and performs a Wrangler dry run; it does not publish. The generated Worker types are ignored and must be regenerated after installation or binding changes. No deploy script is provided.

## Implemented scope

- Cloudflare Worker serves the portal and API. One SQLite Durable Object per installation owns receipts, objects, commands, runs, events, occurrences and lifecycle state. Alarms schedule occurrences while the external Gateway is stopped.
- Access JWT verification checks signature, issuer, audience and owner subject. Browser writes check origin. Signed external triggers use per-source HMAC secrets, bounded timestamps and durable event deduplication. Strict static JSON-schema validators avoid runtime code generation.
- Commands have durable idempotency receipts, revision checks and transactional semantic rejection. Bot timelines and rooms have paginated history; portal drafts survive reload. The portal supports messages, room creation, memory editing/deletion and structured routine editing. Waiting states honestly indicate unavailable execution.
- The controller fences each boot/attempt with epoch and lease, serializes coordinator admission, tracks activity/operations, validates drain sequence and checkpoints, parks unconfirmed task cancellation without stopping unrelated work, and waits for provider-confirmed termination before recovery. Eligible read-only transient retries use bounded backoff. Owner cancellation and context invalidation never auto-retry or publish late result text. Unknown external effects remain parked.
- Global/persona/routine/skill memory is projected by application scope at claim time. Deletion removes canonical memory from active snapshots and invalidates affected work. This is not full erasure of original messages, prior results, native transcripts or backups.
- Numeric cron scheduling handles timezone previews, DST gap/fold rules, overlap and bounded misfires. Room data events do not enqueue model work. Operator policy registries bound routine action/tool IDs and trigger sources.
- Provider interfaces cover Fly Machines, Sprites, Daytona, Railway and E2B. **These do not have equal verified capabilities.** Fly/Daytona implement the required explicit lifecycle API surface with mocked tests; Sprites/Railway/E2B require additional lifecycle bridges or proof before automatic execution. No provider was live tested. See [PROVIDERS.md](PROVIDERS.md).
- Native adapter/journal and direct-loopback Gateway transport exist. A fresh isolated OpenClaw 2026.9.3 / Node 24.19.0 instance passed authenticated protocol-4 connect and health, then stopped. Native production admission remains blocked. See [RUNTIME_COMPATIBILITY.md](RUNTIME_COMPATIBILITY.md).

## Validation evidence

- `npm test`: 176 passing tests across auth, command schemas/store, scheduling, lifecycle/recovery and providers.
- `npm run test:runtime`: 36 passing synthetic adapter/journal/transport/control-client/Sprite tests.
- `npm run test:e2e`: 20 real local Worker HTTP checks, using temporary SQLite state and no model/provider calls.
- `npm run build`: passed; bundled Worker and four static assets, no deployment. Portal JavaScript syntax check passed.
- Isolated native Gateway read-only health proof passed. Its ignored logs/report are in `.local/native-transport-probe/`.

HTTP checks are not browser interaction or visual/accessibility acceptance. Full specification acceptance, 100 seeded crash interleavings, seven-day operation/cost evidence and live provider tests have not been run.

## Remaining work and gates

1. Implement the executor service connecting the control API, durable journal and native Gateway; OS process ownership, event coverage/replay and full tool/child activity mapping are pending. The adapter intentionally blocks production even if Worker flags change.
2. Owner-managed native OpenClaw OAuth login, effective subscription/profile validation, inference/restart tests and context-visibility audit are required. No copying desktop OAuth and no paid-key fallback.
3. Prove cancellation settlement, native durable admission recovery, all-operation checkpointing and browser state persistence before automatic sleep. A root completion or cancel acknowledgment is insufficient.
4. Wire natural-language routine tools and bounded child continuation; structured routine CRUD and room data/action commands are implemented, but complete model-driven collaboration is not.
5. Add retention sweeps, coordinated backup/restore, migration tooling, reconciliation UI, monitoring and cost measurements. Schema v1 initializes a new installation; it is not an upgrade/restore system. Provider identity changes currently fail closed and require explicit stopped-state migration.
6. Complete browser/mobile/accessibility tests and production Access configuration. Core command support is broader than the present UI; persona administration and detailed recovery controls remain incomplete.
7. Test the actual Cloudflare plan CPU/storage limits. Catch-up currently scans at most 10,000 occurrences and fails closed beyond that; very stale schedules need an operator recovery path and performance validation before production.

`EXECUTION_ENABLED=false` and `NATIVE_VERIFIED=false` remain in all committed configuration. Provider configuration and credentials are empty. Before live setup, select an exact provider/region/image and quote costs; the $5 infrastructure target is unverified. Secrets belong in platform secret storage, never tracked config. This report records partial milestones, not completion of the full specification.


## Sprites selected-provider update

Sprites is the initial runtime; other adapters remain available but are not the deployment priority. See AUTH_SETUP.md and NATIVE_AUTH_SETUP.md for the concrete account/authentication checklist. Only the non-secret template config/sprites/provider.example.json selects Sprites; production bindings remain empty and execution disabled.

The generic provider-idle controller now records IDLE_PERMITTED after a clean drain/checkpoint, immediately revokes the old boot lease, stops idle polling, and requires a new epoch/boot handshake before the next work. It permits first adoption only at epoch zero with no admitted operations. Paused state never permits termination cleanup or emergency takeover. Unknown cancellation stays in recovery. Seven synthetic controller tests cover this path.

SpritesTasksClient provides native Tasks readback/release; runtime/sprites-task-transport.mjs supplies fixed Unix-socket HTTP, and runtime/sprites-activity-guard.mjs supplies serialized bounded renewal and fail-closed expired-hold handling. Five additional runtime tests cover the bridge/guard. The supervisor must schedule renewal during active work, reconcile before confirmed expiry on errors, and release only after native settlement plus controller commit. A hold is finite, not an indefinite guarantee if the supervisor crashes.

Remaining selected-path wiring includes the actual supervisor service, event-driven wake handoff for an already-running warm service, native executor integration and private per-process credential injection. Service-start success alone is not proof an existing warm supervisor revalidated its epoch. Avoid idle outbound polling that prevents provider hibernation. These components are prepared/tested in isolation; the complete Sprites execution path is not yet operational. Live Services cold restart, warm resume, task renewal and filesystem/auth persistence remain untested.

## Bot setup and native orchestration additions

- `scripts/prepare-bot-import.mjs` prepares five persona and seven disabled routine commands from the private adapted export, with deterministic IDs, hashes, timezone conflict and stored next-three previews. The portal manually loads and reviews that JSON, binds current revisions, and submits one atomic `setup.adopt` command. Private historical profiles remain separate and unverified. No adoption has been submitted against a live portal.
- Application schema v2 adds background/coordinator roles, native child links, resource locks and pending task follow-ups. The v1 migration preserves existing records and rolls back partial failures. `native-child` records observed native receipts; it does not spawn a child. New portal messages can be claimed while background metadata remains active. The native producer and full coordinator/task routing remain unimplemented/unverified.
- Exact task cards expose follow-up/cancel without a thread picker. Follow-ups queue until definitive settlement and then request a coordinator continuation naming the logical task. Task cancellation timeout does not stop unrelated work. Locks survive uncertainty and block sleep until settlement; they grant no connector authority. Native `main=1`/`subagent=1` and managed refresh remain the configuration candidates, pending O01–O09.
- Per-leg flight deadlines and the daily reconciliation endpoint use one durable restoration ledger. Canonical Inbox identity, active attempt, pinned policy and enabled restore routine are required. Confirmation binds a matching confirmed external effect; arbitrary caller receipts are rejected. Cron coalescing cannot cancel non-cron deadline jobs. The feature remains off by default.
- Sprite Tasks transport/renewal and a private wake service have synthetic tests. `sprites-service-entry.mjs` runs only transport preflight and reports `executor_ready:false`. Production execution needs native event ingestion, activity completeness, auth concurrency and settlement proof.

Additional validation: four synthetic bot-import tests and five installed-native-source contract checks pass (`node --test tests/bot-import.test.mjs tests/native-orchestration-contracts.test.mjs`). Together with the 36 runtime checks, the combined Node test command passes 45. These source checks are not live O01–O09 tests. The portal import module passes JavaScript syntax and synthetic validation checks; visual browser QA has not been run.
