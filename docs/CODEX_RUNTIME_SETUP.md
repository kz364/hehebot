# Direct Codex runtime setup

The selected direct runtime is the upstream `@openai/codex` **0.154.0** CLI. It is installed in the repository's ignored `.local/` tree and is not added to the application package. The setup does not log in, acquire credentials or keys, copy an existing native/desktop cache, start inference, or modify upstream code.

```sh
bash scripts/setup-codex.sh
node --test tests/setup-codex.test.mjs
node scripts/probe-codex.mjs
```

The setup is safe to repeat and verifies both the installed package and CLI versions. The probe creates a new mode-0700 temporary `CODEX_HOME`, checks the actual pinned binary, performs the supported stdio `initialize` handshake, and calls `account/read` with `refreshToken: false`. It emits only boolean version/handshake/account/authentication status and removes the temporary home. It neither attempts login nor makes an inference request.

A successful handshake and account read prove only protocol compatibility with this pinned CLI. An unauthenticated result is expected in a fresh home and does not establish production authentication. Production admission remains blocked pending owner-managed supported authentication, policy and model eligibility checks, real execution supervision, complete native child/tool/effect event reconciliation, cancellation certainty, and descendant settlement. Root completion alone is not proof that descendants or external effects settled. Never transfer Codex Desktop, Amp, OpenClaw, or another machine's auth cache into this runtime.

## Independent orb evidence

On 2026-09-13 the parent and [independent native orb](https://ampcode.com/threads/T-01a099f9-6c3f-75d8-8172-88f116213dbb) ran the exact transferred unpushed Codex files. The final isolated suite passed 17 checks (five adapter, eight transport, four setup/probe). Both real probes returned `versionMatch:true`, `handshake:true`, `accountRead:true`, `authenticated:false`. No credentials were transferred.

Both orbs also created and read back an empty native thread through supported `thread/start` and `thread/read`, with no `turn/start` or inference. The independent response confirmed `gpt-5.4`, `untrusted` approvals, read-only sandbox and disabled network; the read-back contained zero turns. The native process stopped and private probe homes were removed. This does not prove model eligibility, authenticated execution, persistent turn recovery or whole-tree settlement.

The initial independent check found a malformed `error:null` response incorrectly accepted as success. The final revision rejects it, bounds pending requests and pipe backpressure, validates probe response fields/home identity, and avoids inherited HOME/provider credentials. The 17-check rerun includes these regressions.
