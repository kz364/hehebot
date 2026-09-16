# Portal background responsiveness: scripted integration fixture

`bash scripts/test-codex-service.sh --background-responsive` prepares the
owner-alpha concurrency path using the actual local HTTPS Worker/SQLite, the
pinned Codex app-server **0.154.0**, and a credential-free scripted Responses
server. Chromium submits the messages through the existing portal. Sprite Tasks
transport remains synthetic. This is **not real-model alpha completion**,
production admission, connector verification, or proof of safe runtime sleep.

The fixture uses the existing service native configuration, not a substituted
permissions profile. Test-only execution gates apply only to the disposable
local Worker. No login, provider account, paid model, push, or deployment is
required. The shell wrapper builds the existing service and takes its executor
lock; the fixture owns temporary state, native process, Worker and browser cleanup.

## Required integration behavior

1. The portal submits P (`SERVICE_ASSEMBLY_19_43`). Native P calls `spawn_agent`
   for A (`SERVICE_CHILD_PROOF`), then completes its root. A inherits the real
   MCP configuration, reads the synthetic routine from Worker/SQLite and leaves
   its next scripted inference request held open.
2. `service.maintain()` registers A and publishes native previews before the
   portal submits S (`SERVICE_STATUS_S_71`), so S's captured context includes A.
   Maintenance alone releases the coordinator lane and pumps queued admission.
   The fixture never calls claim, dispatch, release, or turn/start to advance S.
   P remains running with unknown coverage despite its terminal native root.
3. S gets a different attempt, native thread and immutable grant. Its **actual
   provider request** must contain A's exact ID, title and running status in
   `task_summaries`. Scripted S emits `SERVICE_STATUS_PROVISIONAL_71`. Browser
   reload reads that run/attempt-attributed preview with the provisional warning,
   no final result card and no duplicate inference.
4. A third portal message B (`SERVICE_INDEPENDENT_B_103`) gets an independent
   thread/grant and remains held. Public `/v1/commands` exact cancellation of B
   must interrupt only B and leave A's native journal and HTTP stream unchanged.
   Cancelling old A after the dispatch cursor moves must use its retained
   controller and interrupt only A's exact native thread/turn. Repeated maintenance
   must not duplicate either interrupt.
5. All three admitted families remain durable; every family retains one unknown
   coverage operation and participates in accepted heartbeat pages before and
   after cancellation. Coverage and original grants survive service stop.
   Worker P/S remain running, A/B remain cancelling, sleep is denied and no
   `run.result` is emitted. Native interruption is not application settlement.

Runtime/backend integration contracts:

- Internal `coordinator-release` accepts
  `{identity, run_id, attempt, native_ref, outcome}` following durable native
  root terminal observation; it releases only coordinator occupancy.
- `service.maintain()` awaits release/admission and reconciles all retained
  families, including their task controllers, outputs, cancellations and operations.
- `service.observe(attemptId)` resolves an exact retained attempt.
- `service.supervisor.bridge.families()` returns one durable row per admitted
  attempt, with `claim`, `attemptId`, `nativeRunId`, `phase` and
  `coordinatorRelease: {payload, acknowledged: true}` after release. Released
  families retain `phase: 'running'`; lane release is not task completion.

A successful run expects six scripted provider requests, one native process,
three admitted families, four distinct native threads (P/A/S/B), two exact
interrupts, and three unresolved coverage records. Multi-family checks are
separate from legacy single-family operation totals and offline diagnostics.

## Preparation evidence and remaining gate

Prepared against the bundled unpublished base
[`d96a498`](https://github.com/kz364/hehebot/commit/d96a498f481a29a4cdc44d2efcb99cc0d2d90131),
not `origin/main`. Bundle SHA-256:
`1e358c59662c0303259baf29758769eea03017d1bf8848b01c7926829a5bb178`.

- `node --check scripts/test-codex-service.mjs` and `git diff --check` pass.
- The unchanged-baseline default service fixture passes with two scripted
  requests, verified MCP receipt and conservative provisional output.
- The unchanged-baseline new mode is **red at the intended second-admission
  boundary**: four scripted requests; portal P submitted; P terminal; A's MCP
  receipt verified and inference held; portal S queued; timeout
  `maintenance admits queued S while A remains held`.
- With the host runtime family-retention/admission patch and backend
  coordinator-release patch together, the new mode **passes**: six scripted
  requests, fresh S thread/grant with A's actual summary, browser reload without
  inference, exact B then old A interruptions, three durable families, 25 accepted
  heartbeat operations, three unknown coverage records, sleep denied and no final
  result. The baseline red log is retained separately from this positive run.
- An intermediate integrated default run exposed
  `DISPATCH_NATIVE_BINDING_UNKNOWN` in the legacy single-cursor recovery
  inspector. After the host supplied its family-aware inspector, **both default
  and background modes pass again**, with every existing default assertion
  intact. Final counts are two and six scripted requests respectively.

The positive result is scripted integration evidence only. Authenticated model
judgment, live provider behavior, settlement and production gates remain
unverified. Future runtime/backend changes should rerun both default and new modes.

## Restricted-session limits

The runtime and Worker stop admitting new coordinator families at **32 unresolved
families**. A provisional reply still occupies one of those retained families until
genuine settlement. This is a bounded preparation path, not indefinite owner use;
restarting or deleting the journal is not a supported way to clear that limit.
Release-acknowledgment uncertainty fences the service rather than replaying native
work. The bridge can reconcile only the exact persisted release receipt.

Offline inspection reports retained family identities separately from the current
admission phase. Its native detail describes one selected family (latest retained
by default, or an exact attempt supplied to `inspectCodexRecovery`), not a complete
native census. Inspection never authorizes resume or sleep. Runtime startup still
refuses existing service custody; automated recovery is not added by this change.

Fresh native threads and separate immutable MCP grants provide task attribution,
not OS isolation or a deny-all native tool boundary. The service is still gated to
disposable scripted tests. A live owner alpha needs an explicit runtime path with
reviewed credential/effect capabilities and separately authorized bounded model
use; no production flag, deployment or account permission follows from this test.
