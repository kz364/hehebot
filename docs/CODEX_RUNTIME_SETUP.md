# Codex runtime setup and contracts

Hehebot uses pristine upstream `@openai/codex` **0.154.0** behind an external durable control plane. Installation lives in ignored `.local/`; application dependencies do not include the native package. Do not patch installed code, write native databases, copy credentials or silently add a paid API fallback.

## Credential-free verification

```sh
bash scripts/verify-codex.sh
```

Requires Linux, Node/npm and OpenSSL. The wrapper installs locked dependencies, generates ignored Worker types, installs the pinned Codex CLI, then runs setup/probe, core/runtime, HTTP, native lifecycle, MCP, dynamic-control, supervisor and build dry-run checks. Native fixtures use disposable private homes and scripted loopback model responses. HTTPS Worker/SQLite state is local and disposable. No account is connected, no portal is exposed and no deployment runs.

To install/probe only:

```sh
bash scripts/setup-codex.sh
node --test tests/setup-codex.test.mjs
node scripts/probe-codex.mjs
```

The probe creates a new mode-0700 `CODEX_HOME`, performs `initialize` and `account/read` with `refreshToken:false`, checks version/response shape, stops the process and removes the home. A fresh-home `authenticated:false` is expected, not a check of an existing account. Successful protocol checks do not establish model access or production readiness.

## Owner-authorized subscription login

After the owner authorizes this particular runtime, run in its private terminal:

```sh
bash scripts/setup-codex.sh
umask 077
mkdir -p .local/codex-account
chmod 700 .local/codex-account
CODEX_HOME="$PWD/.local/codex-account" \
  .local/codex-runtime/node_modules/.bin/codex \
  -c forced_login_method='"chatgpt"' -c cli_auth_credentials_store='"file"' \
  login --device-auth
```

Complete the browser/device flow and MFA yourself. Enable device authentication in account/workspace security settings if necessary. Keep codes and caches out of chat and Git. Use the supported [Codex authentication flow](https://developers.openai.com/codex/auth/), not another application's cache.

```sh
CODEX_HOME="$PWD/.local/codex-account" \
  .local/codex-runtime/node_modules/.bin/codex login status
```

Verify available models through supported app-server discovery before selecting one. Login, authenticated inference, quota, restart continuity and eventual refresh are separate checks. Each new runtime needs its own authorized flow. Do not enable production or sleep gates merely because login succeeds.

## Durable identity, events and cancellation

`CodexAdapter` persists acknowledged thread identity before `turn/start` and exact turn identity afterward. Unknown submission outcomes remain unknown: recovery never chooses the newest turn or replays inference. Tool definitions are host-owned, snapshotted and included in submission identity.

`CodexEventRouter` subscribes before admission. It buffers bounded identity/status observations, then binds only to a durable acknowledged thread/turn pair. Output, tool arguments/results and permission hints are omitted. Commands, MCP invocations, spawn receipts and descendant turns are separate journal obligations. Conflicting identity/status, overflow, malformed supported events, disconnect and journal failures fence routing. A supervisor rechecks its lease around awaited binding and acknowledges Worker submission only afterward.

Native evidence includes a real FIFO command still `inProgress` after root completion and absent from root history. Releasing the FIFO produces late completion automatically journaled by the router. Root completion and sparse history never erase outstanding work. MCP terminal status settles the invocation, not external effects; `readOnlyHint` grants no authority.

Spawn receipts preserve receiver IDs and attribute direct-child turn observations, including early events. A child can outlive its parent. `cancelChild` requires an observed exact child thread/turn under that parent, journals intent before interrupt and deduplicates repeated/concurrent requests. Lost acknowledgment is retained without replay. Accepted cancellation is separate from observed interruption and provider request closure.

Nested spawn receipts extend the same routing to observed descendants; each spawn belongs to its exact sender thread/turn. An existing receiver cannot gain a second origin or form an ancestry cycle. Per-descendant tool maps remain distinct even when item/turn IDs repeat across threads. Router reconstruction restores these durable links and `cancelChild` accepts an exactly observed grandchild without interrupting ancestors. This is observation-driven accounting, not discovery of unseen work.

`CodexTaskControl` mirrors this durable ancestry through the idempotent Worker `native-child` endpoint. Its host parent grant is fingerprint-bound; registration intent precedes the request, and lost acknowledgments reconcile only the identical receipt/native reference. Worker records inherit the same persona/context and original hard deadline, including under a background parent; stale parent attempts and unauthorized cross-persona delegation fail. Cancellation routes selected Worker IDs down their mapped subtree to exact native turn interrupts, never upward or into siblings. It does not complete Worker tasks or settle effects.

Child/grandchild native fixtures verify actual mapping into HTTPS Worker/SQLite task records without duplicate registration. Synthetic tests with real SQLite/journal/adapter cover lost registration acknowledgment, scoped subtree cancellation, lease loss and unknown ancestry. The supervisor's optional `children` hook synchronizes mapping and delivers heartbeat cancellations with lease checks around awaits. Its ordering/failure unit tests use a stub hook; the native `--supervisor-child` fixture installs the real task controller and verifies owner cancellation end to end. Production service assembly remains unfinished. These task records remain active until complete operation/effect settlement is supplied.

`CodexOperations` projects observed root inference, descendant turns, commands, MCP invocations and spawns into distinct Worker heartbeat records owned by the admitted logical root task. IDs survive reconstruction and separate identical native IDs across threads and item kinds. Claim timestamps/deadlines are retained rather than reporting polling as progress. More than 100 records fences rather than truncates. An always-unknown coverage obligation accounts for unverified native work/effect coverage; observed terminal invocations do not authorize logical completion or sleep. Real SQLite and native supervisor fixtures verify that this obligation blocks Worker completion even after observed invocations terminate.

Controlled settled-work process restart reads back exact acknowledged root output and persisted obligations without new inference. This is **not active-work crash recovery or recursive settlement**. The pinned [client request union](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server-protocol/schema/typescript/ClientRequest.ts) lacks an authoritative recursive descendant census/settlement barrier. Persisted [turn items](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server-protocol/schema/typescript/v2/ThreadItem.ts) are observations, not proof that no unseen work exists. Sleep remains denied.

The native fixture also verifies supported `thread/backgroundTerminals/list`: it identifies the exact outstanding FIFO command after root completion and returns an empty unpaginated result after release. With the supported disposable `thread_unload_delay_secs = 2` configuration (default 60), `thread/unsubscribe` is followed by exact `thread/closed` and `notLoaded` notifications. `thread/loaded/list` then excludes that thread while retaining an unrelated root. Upstream [unload handling](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server/src/request_processors/thread_lifecycle.rs) waits for session shutdown before these notifications; unsubscribe acknowledgment alone is insufficient. The fixture then verifies empty terminal lists for all remaining loaded sessions, unsubscribes them, observes their closure and an empty loaded list, and closes stdin. App-server exits with code 0 and no signal before restart readback. This is controlled graceful shutdown of settled fixture work, not active-command cleanup, detached process containment, external-effect settlement or permission for global drain amid unrelated installation work. Sleep remains denied.

## Shared task tools and dynamic-tool limitations

Host `thread/start.dynamicTools` requires explicit experimental API opt-in. The optional transport callback handles only `item/tool/call`; other approvals remain denied. [Dynamic tool parameters](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server-protocol/schema/typescript/v2/DynamicToolCallParams.ts) carry exact thread, turn and call identity. Duplicate RPC IDs, concurrency, timeouts and handler failures are bounded/fenced; cooperative abort is not proof that side effects stopped.

`runtime/codex-tools.mjs` validates the admitted host grant, acknowledged running root and call fingerprint before dispatch through the existing Worker control handler. Successful duplicates return cached responses; changed arguments/grants conflict; unknown outcomes do not replay. Children cannot choose a parent grant or inject authority fields.

Pinned native spawned children do **not** inherit root dynamic tools (`dynamicChildToolsAvailable:false`). Neither [thread resume](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server-protocol/src/protocol/v2/thread.rs), turn/settings APIs nor role configuration supplies this registration. [Native child startup](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/thread_manager.rs) defaults to empty dynamic tools. Host-created independent threads would not preserve spawn lineage.

The owner permits shared authority within an admitted logical task; see [the normative contract](NATIVE_ORCHESTRATION.md#shared-task-authority). Native children **do inherit task-scoped stdio MCP tools** in the pinned fixture. The supported MCP path reuses the task's fixed Worker grant and forces admitted-run provenance. It does not authenticate per-child effect callers. Separate task/persona grants must remain separate in service assembly; a shared customer runtime is not permission to reuse one task's MCP configuration everywhere.

`CodexAdapter` accepts host-owned `mcpServers`, snapshots it and includes nonempty configuration in the durable submission fingerprint. It passes that snapshot through supported `thread/start.config.mcp_servers`, rather than writing global config. Model submission fields cannot override it. Grant-file contents must remain immutable for the admitted attempt; the config fingerprint binds the path/config, not future file contents. Omission does not disable lower-layer MCP servers: assembly must explicitly disable unwanted configured servers and preserve managed requirements. Do not change MCP configuration on an already-running thread or duplicate model-auth ownership.

The `--child` fixture scripts a native spawn, completes the parent, then executes six inherited tools in the child. Actual decoded outputs and HTTPS Worker/SQLite records prove the same policy-scoped proposal/routine/skill sequence below. The router binds the acknowledged parent, attributes the child from native spawn receipts and turn events, and persists six completed child MCP invocation IDs separately from root obligations. Synthetic tests additionally cover late child tools after child completion, sibling ID collisions, unknown turns, restart binding and conflicting terminal events. Invocation accounting does not establish external effects, recursive settlement or sleep eligibility.

That fixture also starts a second root in the same app-server process with the same MCP server name but a different grant path and a read-only tool list. Its deliberately unadmitted run ID produces an error instead of returning the first task's admitted skill. The first task's child still completes all six scoped calls. This verifies supported per-root configuration and rejection of that unadmitted grant, not a complete cross-task sandbox or two concurrently admitted production tasks.

The native fixture waits for parent completion before returning the dynamic child availability response. This controls request ordering in the fixture; it does not promise native child results can never cause additional parent continuations.

## Actual control and supervisor fixtures

- `node scripts/test-codex-tools.mjs`: actual Codex → stdio MCP → certificate-validated HTTPS Worker → SQLite.
- `node scripts/test-codex-tools.mjs --child`: native child inherits the task MCP grant; eleven scripted requests (parent spawn/final, child's six tools/final, and unrelated root's rejected read/final).
- `node scripts/test-codex-tools.mjs --grandchild`: thirteen scripted requests; extends the same receipt checks to a grandchild after both ancestors complete, with both spawn links and descendant tools automatically journaled. Only this fixture selects V1 (`multi_agent_v2=false`) and `agents.max_depth=2`; it does not raise production fan-out/depth. V1 defaults to depth one and rejects prospective depth greater than the configured maximum; V2 ignores this setting.
- `node scripts/test-codex-tools.mjs --dynamic`: actual Codex host callback → scoped handler → HTTPS Worker/SQLite, no MCP configured.
- `node scripts/test-codex-tools.mjs --supervisor`: actual supervisor/bridge/adapter/router claim and execute a manually queued paused source routine through the same dynamic tools.
- `node scripts/test-codex-tools.mjs --supervisor-child`: actual supervisor admits the paused source routine with task MCP configuration. Its native child executes six tools, then its final model request is held open. The owner cancels the mapped Worker child; repeated supervisor maintenance sends exactly one interrupt to the acknowledged child thread/turn, observes `interrupted` and closure of that held provider connection. The source run stays running and the child record stays cancelling, with no fabricated settlement or activity release. Eleven scripted requests include the independent unadmitted-root denial check.

Each exercises six tool calls: pending skill proposal with forced admitted-run provenance, paused Jakarta routine save, exact inspection, manual enqueue without enablement, deletion cancelling that queued run while preserving the caller, and exact admitted skill read after owner disablement. A final scripted response follows except in supervisor-child mode, which holds and interrupts that final inference request. Mutation outputs must decode to applied receipts and match persisted state. Queries never create work or request wake. The separate routine queued during this sequence is not executed.

Skill procedures load progressively through `hehebot_read_skill`. Initial native input contains only admitted catalog descriptors; full reviewed bodies remain pinned in the durable snapshot. Later edits/disablement affect future admissions. Reading a skill does not authorize its actions or prove execution of its instructions.

The supervisor fixture proves actual source-routine admission and scripted native tool execution, not logical-task completion. Root-only bridge `complete` rejects with `NATIVE_SETTLEMENT_INCOMPLETE`; direct Worker completion rejects with `CANCEL_UNCONFIRMED` after real projected operation heartbeats. The Worker run remains running and the source routine paused. Activity is stubbed and the provider is fake. First scripted dynamic calls wait for durable binding; pre-ack denial is synthetic test evidence rather than a live-race proof.

All model decisions in these fixtures are scripted. `externalModelCalls:0` is fixture-declared, not packet capture. Authenticated inference, model judgment, recursive child/tool/effect settlement, production service assembly, provider sleep and live connector behavior remain unverified. Passing reports keep `assistantOperational`, `productionAdmission` and `modelJudgmentVerified` false. Continue from [HANDOFF.md](HANDOFF.md).
