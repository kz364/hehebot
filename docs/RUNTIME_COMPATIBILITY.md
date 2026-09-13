# Native runtime compatibility gate

Inspected 2026-09-10. **M1 is partially implemented; production inference and automatic sleep remain blocked.** An isolated Gateway transport/health proof subsequently passed (details below). No existing auth state was opened or copied, no model call was made, and no external message was sent. Independent control-plane development can continue against a fake executor.

## Implemented and tested

- `runtime/openclaw-adapter.mjs`: injected named-RPC adapter for `agent`, `agent.wait`, and exact-run `chat.abort`. Strict application submission fields; no delivery recipient fields, `deliver: false`, and message tool disabled. The production constructor path refuses admission; `testMode: true` is only for isolated fake transport tests, not a production bypass.
- `runtime/file-journal.mjs`: private application intent journal, atomic rename and file/directory fsync. Within one journal instance, concurrent attempts serialize. The journal is not a multi-process lock: provider fencing and an OS ownership lock must exist before production use. It does not touch native SQLite.
- Submission intent precedes the transport call. Reusing an attempt with changed content conflicts. A lost response, malformed acceptance, or surviving intent without a native run ID becomes recovery-required; restarting the adapter does not resend it. The correlation key is the attempt ID; a durable native lookup capable of reconciling missing acknowledgments is not implemented.
- Wait timeout and pending responses preserve the run lease. Root completion remains `finishing`. Cancel acknowledgments remain `cancelling`, never `cancelled`. Sleep always returns explicit unverified-coverage blockers.
- Hidden session keys separate installation, persona, routine and conversation. This proves deterministic key separation only. Native workspace retrieval and instruction/memory access have not been audited, so it does not establish security isolation.
- `runtime/probe.mjs`: a read-only installed-package inspector. It verifies the exact package version and required fields in bundled schema declarations without importing runtime modules, starting services, or reading credentials. The resulting `runtime/compatibility-evidence.json` includes schema hashes. Hashed distribution filenames are inspection evidence, never runtime API imports.

Validation command: `node --test tests/runtime.test.mjs` — 8 passing tests. These use injected fake responses and temporary synthetic journal state. They test the adapter's conservative behavior, not native execution. Probe command: `node runtime/probe.mjs /path/to/installed/openclaw` — passed for the installed package. No dependencies beyond Node built-ins; tested Node version is recorded in the evidence JSON.

## Installed surface evidence

Package `openclaw` is **2026.9.3**, state schema **16**, agent schema **19**. Inspection root was the existing user-local OpenClaw Node 24 tool installation, not a cloud image. An immutable cloud image/runtime-plugin digest remains to be locked.

| Surface | Inspected native contract | What it establishes |
| --- | --- | --- |
| `agent` | Required `message` and `idempotencyKey`; optional `agentId`, `sessionKey`, `model`, `deliver`, `disableMessageTool` | Adapter request fields match this installed schema. No end-to-end submission proof. |
| `agent.wait` | `runId`, optional integer `timeoutMs` | Official bundled agent-loop docs say timeout does not stop the run; pending can represent a queued run. |
| `chat.abort` | `sessionKey`, optional `agentId`, `runId`, `preserveSideRuns` | Exact-run cancellation exists. Implementation calls controlled descendant cancellation and returns `{ok, aborted, runIds}`. An acknowledgment is not proof all tools, remote nodes or child processes settled. |
| `tasks.cancel` | `taskId`, optional `reason`; response `found`, `cancelled`, optional task snapshot | Native background-task cancellation exists. Mapping every root/child/task to application leases is pending. |
| Lifecycle | Bundled docs describe `executionSettled: true`, final transcript writes, and separate delivery outcomes | Useful evidence of native distinctions. Completeness, reconnection/replay, and harness-specific coverage are unverified. |

Relevant installed documents: `docs/concepts/agent-loop.md`, `docs/concepts/multi-agent.md`, and `docs/providers/openai.md`. Existing broader evidence remains in [spec-runtime-evidence.md](spec-runtime-evidence.md). The probe checks field presence, not complete runtime/result semantics; it must not be used to promote live capability flags.

## OAuth and inference gate

The installed OpenAI provider documentation describes `openclaw models auth login --provider openai --device-code`, with OpenClaw managing its own auth rather than automatically importing `~/.codex` credentials. Canonical `openai/*` model names support several account configurations; **selecting that prefix alone does not prove subscription-backed inference**. The documentation also describes API-key fallback, so production launch must inspect the effective account/profile and explicitly prohibit paid fallback and inherited API-key environments.

No sign-in was attempted. No existing auth/profile files were read. Do not copy Codex desktop credentials. Required proof is an owner-completed OpenClaw login in an isolated state directory, verification of the actual OAuth profile and selected native Codex harness, one small subscription-backed test run, clean stop/restart and a second test. Auth refresh requires a later refresh observation or a documented simulation with the live gate still open. Fail affected runs as `AUTH_REQUIRED` or quota-blocked; do not route to a paid provider.

## Remaining implementation gates

1. Wire the verified direct-loopback Gateway transport into an executor service. The transport supports authenticated requests and sanitized errors, but deliberately performs no automatic reconnect or mutation retry; event replay/reconciliation and remote device pairing remain unverified. The adapter still injects transport and blocks production execution.
2. Pin the image, OpenClaw plugin/native Codex runtime and adapter together. Revalidate named RPC/result schemas, auth scopes and native harness after any upgrade.
3. Prove durable native submission recovery across Gateway restart. In-memory dedupe presence is insufficient. Until then, uncertain admission stays parked for reconciliation.
4. Observe admission/preparation, silent inference, tool starts/ends, detached processes, browser transfers, node calls, descendants, final writes and output commit. Root `agent.wait` completion alone cannot authorize sleep.
5. Cancel synthetic quiet inference and each tool/child type; verify all owned work settled. Escalation to executor process-group termination must retain unknown-effect receipts and wait for provider stop confirmation before takeover.
6. Verify separate agent directories and scope-authorized native retrieval. Thread-key separation does not fence filesystem tools or native memory access. Add context visibility audit before feeding real memories.
7. Verify persistent browser/WhatsApp flush and restart/catch-up separately. No claim of complete offline message recovery is made.

M1 acceptance S04/S05/S09/S10/S22/S32 therefore remains incomplete. The implementation neither enables live schedules nor substitutes an always-on runtime for the blocked sleep proof.


## Isolated live transport proof

At 2026-09-10T08:20:30Z, `runtime/probe-gateway.mjs` launched installed OpenClaw **2026.9.3** under Node **24.19.0**, using a brand-new `.local/native-transport-probe` directory, loopback port **19887**, and a random synthetic Gateway token. Explicit OpenClaw home, state, configuration and workspace overrides prevented reuse of user state; no model/provider credential environment was inherited. Channels, plugins, browser, cron, model heartbeat, update checks, telemetry and discovery were disabled. The child had a PID-scoped `caffeinate -i` guard.

The transport completed the documented challenge/connect exchange with protocol **4**, negotiated **operator.read**, and received `health.ok: true`. The probe cleanly terminated its Gateway and guard; a separate listener check found no remaining listener on port 19887. The ignored local report/log are `.local/native-transport-probe/report.json` and `gateway.log`. The initial sandbox attempt could not bind loopback (`EPERM`); the authorized elevated run succeeded. Initial startup connection refusals were retried only for connection and the read-only health probe.

`runtime/gateway-transport.mjs` uses the documented trusted direct-loopback backend path (`client.id: gateway-client`, `client.mode: backend`), which permits shared-token authentication without a paired device. It deliberately rejects remote URLs; deployment must place this transport beside Gateway. It requests read scope by default, validates protocol and granted scopes, bounds requests/inbound processing/pending calls/socket backpressure, correlates out-of-order responses, applies deadlines, rejects pending calls on disconnect, and never automatically retries or reconnects. A timed-out sent request has an unknown outcome. Handshake snapshots and issued device tokens are not returned. Event consumers must still implement durable coverage/replay before automatic sleep is safe.

`tests/runtime-transport.test.mjs`: **8 passing tests**, also verified on Node 24.19.0. This proves authenticated native wire compatibility for a read-only RPC, not native inference, durable submission correlation, OAuth, cancellation coverage or safe shutdown checkpoints. The production gates in `openclaw-adapter.mjs` remain unchanged.

Protocol sources inspected from the installed package: `docs/gateway/protocol/handshake.md`, `transport.md`, `auth.md`, and `rpc-methods.md`. Runtime code uses named protocol frames and methods; hashed bundled filenames are not integration dependencies.
