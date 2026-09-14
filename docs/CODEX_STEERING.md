# Exact native steering: bounded context-delivery proof

Run from a checkout containing the pinned runtime and the adapter's `steerChild` implementation:

```sh
node --check scripts/test-codex-steering.mjs
node scripts/test-codex-steering.mjs
```

Tested with Node26.5.1 and pristine Linux x64 `codex-cli 0.154.0`. The fixture invokes the installed ELF directly at `.local/codex-runtime/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex`; it does not install, patch or replace the runtime. Required ELF SHA256 is `3188814c35471432d4123203e0eb38e5bddc60226e3d7ddf0e59e649ea140022`, checked before and after. The tested parent adapter SHA256 was `d776478a2b366b4556a184c911e03e96bffdd69c8350e57853716d35d6d01b87`; the fixture checks adapter nonmutation without pinning future adapter source revisions.

## What executes

One real app-server runs with private disposable HOME/CODEX_HOME/workspace and a scripted loopback Responses provider that requires no authentication. No inherited account environment, shell/file tool calls, approval grants, MCP authorities or external model are used. The adapter retains `untrusted` and `read-only` defaults. Strict config and `config/read` explicitly establish `multi_agent=true`, `multi_agent_v2=false`, and `code_mode=false`. Agents have depth1 and max_threads4; this is not a capacity test.

The actual advertised `multi_agent_v1.spawn_agent` schema accepts `message` and `fork_context`; it does **not** advertise `agent_type`. The fixture uses only the former supported fields, with `fork_context:false`. Spawn tool results and native `thread/read` parent links establish two direct child identities; the real event router persists their turn observations in FileJournal. No synthetic native observations are injected.

1. `adapter.submit` starts the root. Scripted V1 calls spawn a target child and an untargeted sibling. All three model responses are held.
2. `adapter.steer` journals an unknown receipt before calling supported `turn/steer` with exact `threadId`, `expectedTurnId`, text and `clientUserMessageId`. The returned turn ID must match. The fixture then completes the held model response. Codex requests another inference containing the root directive as user context, before the original turn completes.
3. After root completion, reopening FileJournal and the adapter replays the root receipt without another RPC or journal-content change.
4. `adapter.steerChild` targets the observed direct child. After releasing its initial response, the next model request contains the child directive, excludes the root directive and remains on the original child turn. The sibling retains its initial open response, original turn and one request throughout both steering operations.
5. Reopened child replay, same-command retargeting to the sibling, an unobserved turn, and changed text produce no additional steering RPC or journal-content change. Child receipt replay also works after child completion. An exact sibling interrupt is used only for cleanup.
6. A separate FileJournal snapshot taken before child completion misses that terminal event. `reconcileChild` reads the exact persisted native thread/turn and checks its source parent, restoring only the child terminal observation while the sibling remains live. Unknown/missing turns are never inferred from history order; unit tests also cover nested ancestry and omitted open tools.
7. After all fixture turns terminate and native terminal inventories are empty, unsubscribe the fixture-owned threads, observe an empty loaded-thread list, close stdin and require successful native exit. Start a new pinned process with the same private home, then repeat exact child readback with no new inference. This is controlled settled-work restart, not active-work crash recovery.

Successful evidence: **7 model requests (root4/target2/sibling1), 13 named assertions, exactly2 steering RPCs, 1 cleanup interrupt, 0 approval requests, and 5 closed held HTTP responses**. Root and target native outcomes are completed; sibling is interrupted. Logical attempt, root thread/turn and child identity remain unchanged. Binary/adapter integrity, native process stop and disposable-home cleanup must succeed.

The fixture explicitly sets and reads back supported `thread_unload_delay_secs=2`, as the existing native restart fixture does. The default 60-second grace initially exceeded the 15-second observation wait; unsubscribe acknowledgement alone did not mean unload. See pinned [unload lifecycle](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server/src/request_processors/thread_lifecycle.rs). This changes only disposable fixture configuration, not production defaults or approvals.

## Evidence handling and limits

The fixture prints a sanitized JSON assertion report. Exact native messages, scripted request/response bodies, native diagnostics and final journal records are retained only in a new private `.local/steering-proof-*` directory: mode0700 directory and mode0600 `trace.jsonl`/`report.json`. The report includes the trace SHA256. These contain synthetic fixture context, not production transcripts, and are deliberately excluded from delivery archives. Temporary native homes and journals are removed, including on ordinary failure. RPCs have10s timeouts, observation waits15s, and a90s watchdog bounds native execution. Each model request is bounded to2MiB, total requests to9 and private trace to16MiB. Unexpected activity fails the fixture.

**Accepted is not consumed.** This proof independently observes directive delivery into a subsequent model request before exact-turn completion. It does not establish that a real model understands or obeys a directive: every output here is scripted. It does not mark adapter receipts consumed, perform Worker admission, authenticate a child MCP caller, isolate filesystems, prove crash-recovery exactly-once delivery, release effects/locks, settle a task family, or enable sleep/production. Steering replay uses the live process; the final controlled process restart proves only settled child history readback. Parent Worker/service/UI integration and owner authorization remain separate boundaries. All production gates remain false.

## Owner, Worker and disposable service integration

The separate application path accepts owner-only `run.steer` with `run_id`,
`expected_attempt` and at most 32768 UTF-8 bytes of nonblank `text`. Ordinary
messages still enqueue independent work; `run.followup` still waits for settlement.
Model tools cannot issue either owner steering or its runtime delivery receipts.

`TaskSteering` stores compact `steer:<run>:<attempt>:<command>` receipts in existing
`runtime_metadata`; text remains solely in the original command payload. No schema
change, context rewrite, policy grant, inference enqueue or wake is introduced.
Admission requires a running acknowledged attempt, future deadline, READY live
lease and matching epoch/boot. Unknown target effects block admission/delivery;
unrelated sibling uncertainty does not. One pending or uncertain steering command
per attempt prevents blind resending. Accepted commands can be followed by another
explicit instruction; acceptance is not proof that the first was obeyed.

Authenticated `steer-pending` accepts at most 101 exact runtime-owned targets and
returns at most four eligible commands, filtering custody, current native identity,
active state, deadline, original command age/payload and effects before LIMIT.
Four worst-case JSON-escaped messages fit the client's 1 MiB response bound.
`steer-result` records only `accepted`, `outcome_unknown` or `not_delivered`; the
last means the adapter rejected before dispatch, not confirmed cancellation.
Same outcome replay is inert; contradictory outcomes fail closed. Deadline/task
completion does not block a late receipt when the exact lease/custody still holds.

The disposable service delivers after child synchronization and cancellation in
existing supervisor maintenance. It maps Worker identities only through its
persisted root/descendant mapping, validates the full response before dispatch,
then uses the adapter's journaled exact-turn call. Lost native acknowledgements
stay unknown; lost Worker receipt delivery cannot cause another native steering
RPC. Lease loss or other contradictory state fences maintenance. This is current
in-process custody, not automatic restart recovery or a complete transaction
across Worker/native effects. New uncertainty after a delivery snapshot cannot
revoke a request already sent; steering never settles or abandons that effect.

State returns up to five content-free current-attempt receipts per visible run,
prioritizing unresolved receipts. The portal separates “Steer this task now” from
“Follow up after settlement,” preserves expanded task cards on receipt refresh,
disables resends for pending/unknown delivery, and never calls accepted “consumed.”
An expired or no-longer-running task may retain pending acknowledgement when no
native delivery evidence arrived; it is not automatically labeled undelivered.
Command payload retention remains 90 days. Content-free accepted/not-delivered
metadata is audit: eligible at 30 days from original creation, never polling or
acknowledgement time, only after both run and exact attempt are terminal with
settlement recorded and no retry, unsettled operation, lock or unresolved effect.
Worker alarms prune at most 100 per transaction even with execution disabled.
Pending/unknown records remain recovery state, with no manufactured delivery
verdict or immediate repeated expiry alarm. Original command receipts, input age,
attempts and effects remain unchanged. Old-attempt receipt browsing/reconciliation
remains unfinished; retaining unresolved content-free metadata is not recovery proof.

Verification: `tests/task-steering.test.ts` uses SQLite for custody, asymmetric
task isolation, expiry boundaries, command redaction, receipt conflicts and batch
limits. `tests/codex-task-control.test.ts` crosses real application ledgers and
FileJournal with synthetic native responses. Runtime service and Worker HTTP/RPC
tests cover actual assembly, token/schema rejection and production gates.
`node scripts/test-portal-steering.mjs` exercises rendered desktop/narrow receipt
states, exact synthetic owner payloads, sibling controls and cross-bot isolation.
This implements explicit target controls, not natural-language intent resolution,
the complete O03 scenario, multi-root Worker admission or full O01–O09 acceptance.
