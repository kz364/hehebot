# Native responsive-chat prerequisite (P0.3 remains incomplete)

`scripts/test-codex-capacity.mjs` exercises the real pinned Codex app-server
**0.154.0** against scripted loopback Responses data. It does not use an account,
external model, provider, Worker, service bridge, or portal. Scripted status text
is not evidence of model intent recognition or truthful autonomous status judgment.

## Reproduce the narrow prerequisite

```sh
bash scripts/setup-codex.sh # only if the pinned local runtime is absent
node --check scripts/test-codex-capacity.mjs
node scripts/test-codex-capacity.mjs
```

The fixture retains V2, `max_concurrent_threads_per_session = 1`, and
`max_depth = 3`. It preserves the previous overlapping-root check and adds:

1. Native `spawn_agent` receipt `/root/child43`, supported `thread/read` source
   linking child A to its exact coordinator, and observed child turn identity.
2. A scripted completed coordinator root while A's original model request stays
   held open and its exact turn remains active.
3. A distinct `turn/start` on that same coordinator thread with owner input
   `CAPACITY_STATUS97: What is the status of task A? Do not change it.`
   The separate status turn completes without `turn/steer` or interruption of A.
4. An independent **root** B admitted via `thread/start` / `turn/start` while A
   stays held. Exact `turn/interrupt` targeting B produces B's matching
   `turn/completed` / `interrupted`, without ending or replacing A's turn.
5. A's native history and source read back identically before and after status
   and B cancellation. A has one original model request, no new input request,
   no terminal notification, and an unchanged input hash throughout. Only the
   subsequent explicit cleanup interrupts A.

This is independent-task cancellation isolation, **not proof of same-parent
sibling cancellation** or same-session second-child admission. B is deliberately
reported as an independent root. In this configuration A does not advertise
`spawn_agent`, even though its V1/V2 feature readback is enabled; grandchild
dispatch is reported as unsupported, not simulated. The separate V1 steering
fixture is not interchangeable evidence for V2 semantics.

## Evidence and bounds

Each run writes private `.local/capacity-proof-*/trace.jsonl`, `native.log`, and
`report.json`. Trace entries preserve actual outgoing/incoming native messages,
model inputs, and scripted outputs. The report includes exact coordinator,
status, A and B thread/turn IDs, A's native parent/path source, input/history
SHA256, and trace SHA256. IDs change each run. No native completion events are
invented by the test; the loopback model responses are explicitly scripted.

The focused run on 2026-09-16 passed 11 assertions with seven loopback model
requests, zero external model requests, five of five held connections closed,
and the native process confirmed stopped. Syntax checking also passed. Requests
are bounded to 12, individual bodies to 2 MiB, trace to 16 MiB, RPC/waits to
10 seconds, and the fixture watchdog to 90 seconds. Shutdown waits five seconds,
then allows three seconds for forced native termination. Successful runs remove
the disposable Codex home/workspace; failed runs preserve diagnostics privately.

## Remaining integration blockers

- The host service currently retains unknown operation coverage and a running
  root. Native root completion must not be translated into whole-task settlement
  merely to free chat admission. Production custody must distinguish completed
  coordinator inference from continuing child/tool/effect work and retain holds.
- Worker admission, exact application/native task mapping, durable status and
  result delivery, and portal responsiveness must be exercised through the real
  service path. `tests/orchestration.test.ts` proves local metadata admission only;
  this raw-native fixture does not bridge that gap.
- Same-parent sibling cancellation and second-child admission in the selected
  production configuration remain separate from the independent-root B result.
  Recursive settlement/recovery and model intent judgment remain unverified.

`workerAdmissionProved`, `installationWideLimitProved`, `modelUnderstandingProved`,
`p03Complete`, `productionEnabled`, and `assistantOperational` remain **false**.
No production gate, deployment, or account authorization follows from this test.
