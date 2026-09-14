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

Native execution checks cover an asymmetric file read, persisted output, separate responsive thread during a held request, exact interruption, and read-only reconstruction of an acknowledged root outcome. That reconstruction does not restart the native process or prove arbitrary descendant settlement. The MCP fixture verifies staged skill provenance plus routine save/inspect/run/delete against real HTTPS Worker/SQLite: inspection returns the exact revision without executing work; a paused Jakarta routine stays paused on manual run; deletion cancels its queued work without cancelling the caller. It also loads an admitted skill after the owner disables it for future tasks. The fixture currently makes seven scripted model requests. It does not execute that queued routine or prove intelligent tool selection, authenticated model access, provider suspension, or live external effects.

Skill procedures load progressively through `clawbot_read_skill`. The execution bridge includes only catalog descriptors in its initial prompt; the full reviewed body remains pinned in the durable admitted snapshot. Reads require the exact active runtime attempt and cannot discover skills absent from that snapshot. A later edit or disable affects future admissions, not current instructions. The host must explicitly expose this MCP tool to the native executor; installing it does not grant action permissions. Production executor wiring remains gated.

A successful handshake and account read prove only protocol compatibility with this pinned CLI. An unauthenticated result is expected in a fresh home and does not establish production authentication. Production admission remains blocked pending owner-managed supported authentication, policy and model eligibility checks, real execution supervision, complete native child/tool/effect event reconciliation, cancellation certainty, and descendant settlement. Root completion alone is not proof that descendants or external effects settled. Never transfer Codex Desktop, Amp, OpenClaw, or another machine's auth cache into this runtime.

## Independent orb evidence

On 2026-09-13 the parent and [independent native orb](https://ampcode.com/threads/T-01a099f9-6c3f-75d8-8172-88f116213dbb) ran the exact transferred unpushed Codex files. The final isolated suite passed 17 checks (five adapter, eight transport, four setup/probe). Both real probes returned `versionMatch:true`, `handshake:true`, `accountRead:true`, `authenticated:false`. No credentials were transferred.

Both orbs also created and read back an empty native thread through supported `thread/start` and `thread/read`, with no `turn/start` or inference. The independent response confirmed `gpt-5.4`, `untrusted` approvals, read-only sandbox and disabled network; the read-back contained zero turns. The native process stopped and private probe homes were removed. This does not prove model eligibility, authenticated execution, persistent turn recovery or whole-tree settlement.

The initial independent check found a malformed `error:null` response incorrectly accepted as success. The final revision rejects it, bounds pending requests and pipe backpressure, validates probe response fields/home identity, and avoids inherited HOME/provider credentials. The 17-check rerun includes these regressions.

2026-09-14: the independent orb ran `bash scripts/verify-codex.sh` from an extraction with no dependencies or ignored Worker types. It passed 337 core tests, 70 runtime tests, four setup tests, 20 HTTP checks, both native fixtures and build. The expanded MCP test executed four real tool calls with five scripted model responses and 11 assertions. No manual prerequisite repair was required.

## Root completion is not command settlement

The subsequent native fixture uses a private FIFO to hold a real `exec_command` open after root completion, without relying on sleep timing. At that point the live stream has `item/started` for `commandExecution` with `inProgress`, but `thread/read` returned only user and assistant messages. After the test releases the FIFO, the exact `item/completed` arrives and history contains the command's successful exit/output. The native fixture now uses six scripted model requests.

The adapter journals observed command starts and terminal events serially. Root completion and incomplete history never erase outstanding command IDs. This closes an unsafe inference from missing history; it does not provide a complete event router, recursive child census, external-effect settlement, or a post-crash liveness guarantee. Production sleep remains blocked. One local run encountered `ENOTEMPTY` removing Codex's temporary plugin-clone directory after direct child exit; cleanup now makes bounded filesystem retries and reports failure instead of losing the verification report. Successful cleanup is not a guarantee that native descendants cannot outlive their parent.

Pinned upstream inspection found standalone client `command/exec` and `process/spawn` controls are connection-scoped, not controls for thread-owned commands. The [client request union](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server-protocol/schema/typescript/ClientRequest.ts) has no authoritative recursive descendant census or settlement barrier. Collaboration `listAgents`/`closeAgent` names are model tools, not client RPCs. Full [turn items](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server-protocol/schema/typescript/v2/ThreadItem.ts) are persisted observations, not proof that no unseen process or child exists. An upstream supported supervision boundary is still needed for authoritative post-restart reconciliation; do not fill this gap by editing native databases or installed code.
