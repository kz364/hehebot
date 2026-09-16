# Memory expiry → runtime cancellation: bounded integration evidence

Verified on 2026-09-16 against unpublished host main
[`f5799f9`](https://github.com/kz364/hehebot/commit/f5799f9f9b7ad71bc6b2b12f4387d7c52ba987d0),
loaded from `search-expiry.bundle` after fetching remote main. The bundle SHA256 was
`ac1d29dd03341baa8377fc4db18c03c3694f57993a5aaf66aa4439c4c2d309dc`.
The unpublished commit link may be unavailable remotely until the host publishes it.

`tests/memory-expiry-runtime.test.ts` adds two scripted integration cases to the
existing pure-core expiry and supervisor coverage. Both compose real SQLite
`ControlCore`/`LifecycleCore`, `FileJournal`, `ExecutionBridge` and
`ExecutionSupervisor`. Native submission/cancellation and activity callbacks are
synthetic; the fixture enables execution locally without changing production flags.
No production defect was found in this bounded path.

## Executed observations

- A target coordinator is actually claimed/submitted with two expiring memories and
  one permanent memory. Another persona has a still-running native child under its
  completed coordinator, with a different native reference, scoped memory, resource
  lock and dispatched effect. Public task/effect/resource APIs establish custody;
  direct SQL mutation is limited to lifecycle bootstrap.
- At 9.999 seconds the 10-second memory has not expired, the admitted run remains
  running, and maintenance sends no interrupt. At exactly 10 seconds expiry removes
  only that memory from the control-plane context and marks the run
  `cancelling/CONTEXT_INVALIDATED`. Expiry itself makes no native call. The next real
  lifecycle heartbeat returns only the target run ID; the supervisor sends the exact
  journaled admission attempt ID to `native.cancel`, not its distinct native run ID.
- Both an acknowledged interrupt and a thrown lost-reply error retain the original
  running attempt, unknown tool operation, unknown effect, locks and journal custody.
  The other persona's active task, completed root, dispatched effect and operation
  remain unchanged. No result, retry, extra run or second native submission appears.
- A second memory expires at 25 seconds without resetting the 10-second cancellation
  anchor. At 39.999 seconds the run is still cancelling; at 40 seconds it becomes
  `recovery_required/CONTEXT_INVALIDATED`, while its native attempt stays running.
- At 70 seconds (one full idle interval after the first interrupt), acknowledged
  cancellation still addresses only the same attempt. Incomplete tool/effect proof
  cannot complete the run; redispatch returns the existing journal entry without
  claiming or submitting again. Drain is denied. A lost interrupt reply instead
  fences subsequent maintenance, dispatch and drain before further control requests.
  Both cases retain activity: zero release callbacks, no sleep commit, and direct
  control-plane sleep preparation is also denied. Unknown effects prevent lock release.

These asymmetric controls detect premature expiry, run/native-ID confusion, broad
cancellation, global watchdog effect changes, cancellation-as-settlement, grace
extension and replay/release after uncertain interrupt delivery.

## Validation

```sh
npx vitest run tests/memory-expiry-runtime.test.ts
# Test Files 1 passed (1); Tests 2 passed (2)
npx vitest run tests/memory-expiry-runtime.test.ts tests/memory-expiry.test.ts tests/execution-supervisor.test.ts
# Test Files 3 passed (3); Tests 72 passed (72)
npm run types
# Types written to worker-configuration.d.ts (ignored generated file)
npm run typecheck
# tsc --noEmit; exit 0
```

The initial typecheck found a misplaced `HeartbeatOperation` import in the new test;
it was corrected to `src/core/lifecycle`, then the focused/related suites and
typecheck were rerun successfully. Final logs are supplied separately in
`.local/memory-expiry-runtime-{focused,related,types,typecheck}.log`.

## Limits

This is E06/E02 integration evidence, not acceptance completion or a gate change.
Expiry is invoked through the core API rather than a Worker alarm/HTTP request.
The cancellation endpoint is a synthetic adapter boundary: it does not prove actual
Codex thread/turn interruption, child-controller fan-out, recursive settlement,
transport idempotency, provider hold renewal/release or physical sleep. Repeated
acknowledged maintenance requests the same cancellation; native interrupt deduplication
is outside this fixture. Effects are synthetic read-only ledger entries, not authorized
connector mutations. No accounts, providers, pushes or deployment were used.

Purging the control-plane snapshot does not erase already-admitted context from the
runtime journal or native transcript; the test deliberately preserves that journal
as uncertain execution custody. Runtime/transcript erasure and production service
assembly remain outside this change. Existing production/native-verification flags
remain untouched.
