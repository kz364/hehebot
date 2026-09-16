# E01: spawned child does not inherit Plan mode

Credential-free evidence for **Codex app-server 0.154.0**, recorded 2026-09-16.
This slice starts from the owner's bundled local `main`,
[`9479cb7`](https://github.com/kz364/hehebot/commit/9479cb76955880779cc931036af002646e8279ea),
not `origin/main`. It changes only the disposable service fixture and this document.

## Result: native child Plan emission remains unproven

`bash scripts/test-codex-service.sh --plan-child` passes a **negative behavior
contract**, not child Plan acceptance. The fixture enables experimental API and
sets `collaborationMode.mode = "plan"` on the root's supported `turn/start`, then
uses native `spawn_agent` with `agent_type: "default"`. After the parent completes,
the child calls inherited MCP into the disposable HTTPS Worker/SQLite instance.
The next scripted Responses SSE message contains the same `<proposed_plan>`
payload used by the existing root `--plan` fixture.

The actual spawned child emits `item/started` with `agentMessage`, and
`item/agentMessage/delta` containing the literal opening tag and private marker.
It does **not** emit a Plan start or `item/plan/delta`. The stream remains open
before the closing tag; the fixture cancels the exact child through the existing
Worker command path. Codex emits the exact child's interrupted `turn/completed`
and closes its HTTP request. It does not emit completion for the open message.
No native events are fabricated or rewritten.

This agrees with the pinned upstream implementation:

- [Child configuration](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/agent/child_config.rs#L99-L149)
  copies model, reasoning, developer instructions and other parent settings, but
  not the turn's collaboration mode.
- [Session initialization](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/session/mod.rs#L768-L812)
  starts new/forked sessions in `ModeKind::Default`; resumed history is distinct.
- [Spawn arguments](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs#L265-L275)
  and [custom role overrides](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/agent/role.rs#L36-L48)
  do not offer a collaboration-mode setting.
- [Explicit turn start](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server-protocol/src/protocol/v2/turn.rs#L260-L267)
  and [thread settings update](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L273-L285)
  expose collaboration mode. A separately managed subsequent child turn would
  require separate evidence; these are not proof that the automatic first child
  turn inherits Plan mode.

## What the new mode checks

- Four scripted model requests, an actual inherited MCP routine-list receipt,
  root completion before child work, and the existing exact native-child/Worker
  receipt mapping.
- Exact child thread/turn/item attribution of the message start and both streamed
  payload portions. The message heartbeat operation ID uses the child owner
  namespace; all operations still charge the admitted logical root run.
- Two active five-minute inference obligations while open: the message and its
  quiet phase, **not** a Plan item. A delayed content delta leaves the entire
  journal observation and operation snapshot unchanged, including start,
  last-progress and deadline clocks.
- The full active snapshot reaches a Worker heartbeat with HTTP 200. Completion
  rejects with `NATIVE_SETTLEMENT_INCOMPLETE`; drain rejects with `SLEEP_DENIED`
  while the child stream is open, despite the parent's terminal turn.
- One exact child interrupt, interrupted native turn, HTTP closure, no Plan
  events, and no fabricated message completion. After cancellation the heartbeat
  contains **18 operations**, including **one active message obligation** and
  **one unknown-coverage obligation**. Quiet phases close, but the interrupted
  message does not become settled merely because its turn ended.
- The opening tag and both synthetic Plan markers are absent from every persisted
  host journal file after interruption. Completed parent/child previews stay
  separately attributed; the cancelled child's preview disappears from Worker
  output. This is **streaming/cancellation privacy only**, not proof of redaction
  in Codex-owned history or of privacy for a completed Default-mode message.
- Worker root remains `running`, child remains `cancelling`, root-only completion
  fails, sleep remains denied, and offline diagnostics permit neither resume nor
  sleep. Existing production and unknown-coverage gates are unchanged.

## Reproduce and interpret the evidence

```sh
bash scripts/setup-codex.sh
bash scripts/test-codex-service.sh --plan-child
bash scripts/test-codex-service.sh --plan
bash scripts/test-codex-service.sh --child
node --test tests/runtime-codex-events.mjs tests/runtime-codex-operations.mjs tests/runtime-codex-recovery-inspect.mjs
bash scripts/verify-codex.sh
```

The focused run passed all three service modes and **89 tests, 0 failures**.
The full verifier also passed: **1,154 core tests across 53 files**, **259 runtime
tests**, all scripted control/native/service fixtures, typecheck and build dry
run. Its final report retained `assistantOperational: false`,
`productionAdmission: false` and `modelJudgmentVerified: false`; the dry-run
bindings retained `EXECUTION_ENABLED: "false"` and `NATIVE_VERIFIED: "false"`.
`npm ci --prefix desktop --no-audit --no-fund && npm test --prefix desktop`
passed **16 shell tests**. These are this checkout's measured counts, not future
acceptance thresholds.

The root `--plan` run continues to observe actual Plan start/delta/completion,
stable delta clocks and content exclusion. The unchanged `--child` run observes
16 heartbeat operations and exact cancellation. The new mode reports:

```json
{
  "status": "passed",
  "modelRequests": 4,
  "childPlanEmission": false,
  "childPlanTagIsMessageDelta": true,
  "exactChildMessageNamespace": true,
  "childDeltaClockUnchanged": true,
  "activeChildStreamHeartbeatAccepted": true,
  "openChildStreamPreventsSettlementAndSleep": true,
  "childPlanEvents": 0,
  "interruptedMessageCompletionObserved": false,
  "interruptedMessageRemainsActive": true,
  "childStreamTextExcludedFromHostJournal": true,
  "interrupts": 1,
  "heartbeatOperations": 18,
  "unknownCoverage": 1,
  "sleepDenied": true,
  "spriteHoldLive": false,
  "assistantOperational": false
}
```

The coordinator reran `--plan-child` successfully and added it to the combined
verifier during integration. Passing does not close E01 child Plan emission.
No authenticated model, live provider,
connector effect, deployment, production admission, recursive settlement or
model judgment is established. The fixture uses disposable local admission flags
only, as the existing service modes do; production flags remain false.
