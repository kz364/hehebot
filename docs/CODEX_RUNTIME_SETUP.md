# Direct Codex runtime setup

The selected direct runtime is the upstream `@openai/codex` **0.154.0** CLI. It is installed in the repository's ignored `.local/` tree and is not added to the application package. The setup does not log in, acquire credentials or keys, copy an existing native/desktop cache, start inference, or modify upstream code.

```sh
bash scripts/setup-codex.sh
node --test tests/setup-codex.test.mjs
node scripts/probe-codex.mjs
```

The setup is safe to repeat and verifies both the installed package and CLI versions. The probe creates a new mode-0700 temporary `CODEX_HOME`, checks the actual pinned binary, performs the supported stdio `initialize` handshake, and calls `account/read` with `refreshToken: false`. It emits only boolean version/handshake/account/authentication status and removes the temporary home. It neither attempts login nor makes an inference request.

For the complete credential-free Linux/orb verification from a fresh checkout:

```sh
bash scripts/verify-codex.sh
```

This installs locked application dependencies, generates ignored Worker binding types, installs the pinned Codex CLI, and runs setup/probe, core/runtime, HTTP, actual native execution/MCP, and build dry-run checks. OpenSSL and Node/npm are required; the standard orb includes them. Native tests use disposable private homes and a scripted loopback model, not an account or Amp OAuth cache. No portal is exposed and no cloud deployment runs. A failure exits nonzero; a passing report still explicitly says `assistantOperational:false`.

Native execution checks cover an asymmetric file read, persisted output, separate responsive thread during a held request, exact interruption, and read-only reconstruction of an acknowledged root outcome. A subsequent check stops the actual native process, starts a new one with the same private state, and reads back the exact completed turn/output and journal obligations without new inference. This is a controlled process restart after the fixture's observed work settles, not an active-work crash or arbitrary descendant-settlement proof. The MCP fixture verifies staged skill provenance plus routine save/inspect/run/delete against real HTTPS Worker/SQLite: inspection returns the exact revision without executing work; a paused Jakarta routine stays paused on manual run; deletion cancels its queued work without cancelling the caller. It also loads an admitted skill after the owner disables it for future tasks. The fixture currently makes seven scripted model requests. It does not execute that queued routine or prove intelligent tool selection, authenticated model access, provider suspension, or live external effects.

Skill procedures load progressively through `clawbot_read_skill`. The execution bridge includes only catalog descriptors in its initial prompt; the full reviewed body remains pinned in the durable admitted snapshot. Reads require the exact active runtime attempt and cannot discover skills absent from that snapshot. A later edit or disable affects future admissions, not current instructions. The host must explicitly expose this MCP tool to the native executor; installing it does not grant action permissions. Production executor wiring remains gated.

A successful handshake and account read prove only protocol compatibility with this pinned CLI. An unauthenticated result is expected in a fresh home and does not establish production authentication. Production admission remains blocked pending owner-managed supported authentication, policy and model eligibility checks, real execution supervision, complete native child/tool/effect event reconciliation, cancellation certainty, and descendant settlement. Root completion alone is not proof that descendants or external effects settled. Never transfer Codex Desktop, Amp, OpenClaw, or another machine's auth cache into this runtime.

## Owner-authorized subscription test setup

The credential-free suite deliberately creates a fresh home on each run. Its `authenticated:false` is not a check of an existing account. Amp's synthetic model tool also does not authenticate the direct Codex process or expose a supported general-purpose OAuth proxy.

For a live test, the owner must first authorize connecting the intended ChatGPT account to this particular orb/runtime. In that runtime's private terminal, from the repository root:

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

Enable device-code login in the account's security settings or workspace permissions if required, then complete the displayed browser link/code yourself. Keep the code and resulting cache out of chat, artifacts and Git. Do not reuse an unrelated existing home. The flow is supported by the pinned CLI's `login --help` and [OpenAI's headless authentication guide](https://developers.openai.com/codex/auth/), checked 2026-09-14. No login has been initiated by these setup instructions.

Verify in the same terminal/home with `CODEX_HOME="$PWD/.local/codex-account" .local/codex-runtime/node_modules/.bin/codex login status`. This verifies sign-in only; model access, quota, refresh, connector grants and a bounded real inference test remain separate gates. Retain this home only on its authorized runtime. A second orb needs its own authorized flow, not a copied cache. No API-key fallback is enabled. Do not enable production execution/sleep flags after login: supervision and settlement acceptance remain unfinished.

## Independent orb evidence

On 2026-09-13 the parent and [independent native orb](https://ampcode.com/threads/T-01a099f9-6c3f-75d8-8172-88f116213dbb) ran the exact transferred unpushed Codex files. The final isolated suite passed 17 checks (five adapter, eight transport, four setup/probe). Both real probes returned `versionMatch:true`, `handshake:true`, `accountRead:true`, `authenticated:false`. No credentials were transferred.

Both orbs also created and read back an empty native thread through supported `thread/start` and `thread/read`, with no `turn/start` or inference. The independent response confirmed `gpt-5.4`, `untrusted` approvals, read-only sandbox and disabled network; the read-back contained zero turns. The native process stopped and private probe homes were removed. This does not prove model eligibility, authenticated execution, persistent turn recovery or whole-tree settlement.

The initial independent check found a malformed `error:null` response incorrectly accepted as success. The final revision rejects it, bounds pending requests and pipe backpressure, validates probe response fields/home identity, and avoids inherited HOME/provider credentials. The 17-check rerun includes these regressions.

2026-09-14: the independent orb ran `bash scripts/verify-codex.sh` from an extraction with no dependencies or ignored Worker types. It passed 337 core tests, 70 runtime tests, four setup tests, 20 HTTP checks, both native fixtures and build. The expanded MCP test executed four real tool calls with five scripted model responses and 11 assertions. No manual prerequisite repair was required.

The subsequent v6 archive (`e6bb49b881dc052c68d9a547355898c19256819d3d6fbae36764a7a0da98824e`, SHA-256) independently passed the same fresh entrypoint: 340 core, 73 runtime, four setup, 20 HTTP checks, native FIFO command settlement observations and MCP six calls/seven scripted responses with 13 assertions. All 151 archived source files remained byte-identical and no fixture processes remained. This establishes reproducible contracts, not authenticated model judgment or production admission. The controlled native-process restart check was added after v6 and then passed independently as v7: exact script SHA-256 `64086f4b0085460af9e4daa1267df6b0734e062314905e4500f00bedbb86619b`, six total model requests, `nativeProcessRestartReadback:true`, no remaining native processes or private homes.

## Root completion is not command settlement

The subsequent native fixture uses a private FIFO to hold a real `exec_command` open after root completion, without relying on sleep timing. At that point the live stream has `item/started` for `commandExecution` with `inProgress`, but `thread/read` returned only user and assistant messages. After the test releases the FIFO, the exact `item/completed` arrives and history contains the command's successful exit/output. Including the later child-agent and dynamic-tool probes, the native fixture now uses fourteen scripted model requests.

The adapter journals observed command starts and terminal events serially. Root completion and incomplete history never erase outstanding command IDs. This closes an unsafe inference from missing history; it does not provide a complete event router, recursive child census, external-effect settlement, or a post-crash liveness guarantee. Production sleep remains blocked. One local run encountered `ENOTEMPTY` removing Codex's temporary plugin-clone directory after direct child exit; cleanup now makes bounded filesystem retries and reports failure instead of losing the verification report. Successful cleanup is not a guarantee that native descendants cannot outlive their parent.

Pinned upstream inspection found standalone client `command/exec` and `process/spawn` controls are connection-scoped, not controls for thread-owned commands. The [client request union](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server-protocol/schema/typescript/ClientRequest.ts) has no authoritative recursive descendant census or settlement barrier. Collaboration `listAgents`/`closeAgent` names are model tools, not client RPCs. Full [turn items](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server-protocol/schema/typescript/v2/ThreadItem.ts) are persisted observations, not proof that no unseen process or child exists. An upstream supported supervision boundary is still needed for authoritative post-restart reconciliation; do not fill this gap by editing native databases or installed code.

## Bounded native event routing

`CodexEventRouter` subscribes before submission, buffers only bounded root/command/MCP identity and status fields, and binds them to the adapter's durably acknowledged thread/turn pair. It discards output text, MCP arguments/results and advisory permission hints from that buffer. Same turn IDs on different threads remain separate; missing acknowledgement cannot be repaired by guessing a thread's newest turn. Overflow, conflicting identity, malformed supported events, disconnect, or journal failure fence routing through a stable recovery callback. Unknown early observations remain unassigned, not silently attributed.

The supervisor accepts this router as its `events` dependency and awaits binding after native admission but before the control-plane submission acknowledgement. It rechecks the lease on both sides. The host must subscribe first and connect the router's recovery callback to supervisor recovery. The native fixture exercises automatic start/root/late-command routing rather than manually forwarding each event.

MCP invocation statuses are stored separately in `mcpCalls`, using the pinned [MCP status enum](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server-protocol/schema/typescript/v2/McpToolCallStatus.ts): `inProgress`, `completed`, `failed`. The native MCP fixture routes all six actual tool invocations automatically and asserts their terminal status independently of root completion. A successful or failed MCP response is not proof that an external effect succeeded, failed or stopped; the effect ledger remains authoritative. `readOnlyHint` cannot grant permission or waive effect reconciliation.

The router also journals native spawn invocation status and receiver thread IDs, omitting prompts and agent-result payloads. Direct-child turn starts and terminal observations are attributed only through those durable receipts, including when the child event arrived first. Parent completion never clears these records; a failed spawn cannot erase an observed receiver. Rebinding after a router restart reconstructs this attribution from the journal. Conflicting ownership, receivers, or terminal outcomes fence routing. These records are observations, not child task grants.

The real native fixture verifies automatic parent spawn and held-child turn routing before exact interruption, then the child's interrupted status afterward, without manually forwarding observations. The router is closed before the separate dynamic-tool probe. This is not a full event reconciler: recursive child/tool/external-effect lifetimes, heartbeat operation projection, trusted result publication and service assembly remain unfinished. Buffered unbound events are not a restart-safe census. The router never authorizes task completion, releases locks, or permits sleep, and the production compatibility gates remain false.

`CodexAdapter.cancelChild` now consumes the exact observed child thread/turn under its recorded parent. It persists cancellation intent before RPC, deduplicates concurrent requests and retains uncertain acknowledgements across journal reopen without replay. The native fixture uses this method to interrupt the held child, verifies only one RPC for repeated requests, and separately observes terminal status and HTTP closure. Synthetic tests reject unobserved turns, unrelated children and parent-as-child targets, preserve a sibling, and retain lost-ack uncertainty. This method is a trusted host primitive, not a model-facing authority grant; Worker child-task mapping and owner-cancel delivery remain separate integration work.

## Native child identity and grant separation

The native fixture now calls the advertised `spawn_agent` in its `multi_agent_v1` namespace. The parent tool result's `agent_id` matches the completed `collabAgentToolCall` receiver ID and sender parent thread. A separate child `turn/started` notification supplies the exact child turn ID. The parent completes while the child's scripted provider request remains open with no child completion event; an exact child `turn/interrupt` then produces `interrupted` and closes that request. This establishes observed spawn/turn identity and independent child lifetime, not recursive settlement or active-work crash recovery. Early fixture attempts omitted the tool namespace; these failed and were corrected without changing native code.

The fixed per-run stdio MCP grant used by the acceptance fixture is **not a production multi-task identity mechanism**. An inheriting child can share the server/environment, and model-originated MCP calls have no documented Codex thread-and-turn metadata contract. Do not attribute an independent child task's effects to its parent's grant merely because it reaches that MCP process.

The supported but experimental app-server `thread/start.dynamicTools` surface returns host requests with exact [`threadId`, `turnId`, `callId`, tool and arguments](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server-protocol/schema/typescript/v2/DynamicToolCallParams.ts). It requires explicit `experimentalApi:true`. The transport now optionally handles only `item/tool/call`, with bounded pending calls, duplicate RPC-ID fencing, abort notification and unknown-outcome handling on timeout/failure. Command approvals remain denied. Installing a callback is not task authorization; its host must validate identity and grants before doing work.

The native fixture now uses fourteen scripted model requests: a root dynamic call round-trips asymmetric arguments and exact native thread/turn/call identity, but a default spawned child **does not receive the tool** (checked at both top level and in advertised namespaces). The fixture reports `dynamicRootIdentity:true` and `dynamicChildToolsAvailable:false`; this is a capability-gap result, not successful child authorization. The child transcript explicitly records unavailability. No dynamic callback performs an external effect.

Pinned source corroborates this boundary: [`ThreadResumeParams`](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server-protocol/src/protocol/v2/thread.rs) has no dynamic-tool field, nor do turn/settings APIs. Native child startup uses the empty `StartThreadOptions.dynamic_tools` default in [`thread_manager.rs`](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/thread_manager.rs). Agent role configuration cannot supply app-server dynamic tools. Starting a separate host-owned thread would not preserve native child lineage and is not an implemented substitute. Child-scoped control tools therefore need a supported upstream identity/registration boundary before production assembly; reconnect/connection ownership and nested-child authorization remain unverified. Production admission remains blocked. No copied credentials or native database changes can fill this gap.
