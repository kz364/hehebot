# Hehebot agent handoff

Hehebot uses direct Codex app-server **0.154.0** only. It has a durable external control plane and a sleeping single-runtime design. It is not deployed or operational; credentials were locally verified, but authenticated inference and production settlement are unverified.

## Resume

1. Read `AGENTS.md`, `README.md`, `TODO.md`, `SPEC.md`, `PRODUCT_UX_SPEC.md`, `docs/PROJECT_INTENT.md`, and `docs/IMPLEMENTATION.md`.
2. Run:

   ```sh
   bash .agents/setup
   bash scripts/verify-codex.sh
   npm ci --prefix desktop
   npm test --prefix desktop
   ```

3. Report current output without carrying forward old test totals. Scripted model fixtures are execution-contract evidence only.
4. Update [the owner-facing TODO](../TODO.md) at each substantive checkpoint: date, task status, verification, next priority and exact account/device blockers. Do not wait for the owner to ask for progress. Keep unverified acceptance open and distinguish local from published changes.

## Native question checkpoint (2026-09-15)

Owner question custody, explicit portal answers, and default-off disposable service binding are integrated; see [binding contracts](CODEX_QUESTION_BINDING.md). The original combined checkpoint passed 781 control tests and 162 runtime tests, including pristine native → service → HTTPS Worker/SQLite → owner answer → exact next-context delivery. Independent question/RPC deadlines preserve the short RPC bound. Native resolution remains distinct from answer consumption and task settlement. Unknown take outcomes never replay. Owner-only stopped-question closure now preserves uncertainty separately from native resolution, with exact original termination and revision checks; it changes no task/effect/lock or native journal. Retry/claim/recovery closure reject unresolved questions. See [custody contracts](NATIVE_QUESTION_CUSTODY.md). Full provider recovery, journal retention, authenticated inference, and production admission remain unproved. No production flags changed.

## Boundary ownership

| Boundary | Ownership |
|---|---|
| `src/worker/`, `src/core/`, `DB/` | Durable ingress, identities, revisions, policies, schedules, memory, effects, locks, epochs, and leases |
| `runtime/codex-*` and journal modules | Pinned app-server transport, native event identity, submit/steer/cancel uncertainty, and scoped tools |
| supervisor/bridge and Sprite modules | Claim/submission custody and provider activity; production assembly remains unfinished |
| `public/`, `desktop/` | Portal and remote-only Electron shell; desktop is not an execution authority |

Heartbeat renewal now rechecks local authority before and after operation
collection and after the control response. A response received at or after the
previous local lease expiry cannot revive admission, even if the Worker renewed
on time. Startup permits initial lease acquisition but rejects replies after
disconnect. SQLite supervisor tests cover expiry during activity, collection and
response delivery; recovery retains the provider hold. This conservative local
fence does not implement successful warm-resume or alter Worker lease authority.

Lost Worker submission acknowledgments now permit one exact registration retry
under the original live lease. No native admission or claim is replayed; repeated
loss fences the executor. Identical already-registered receipts preserve later
cancellation/terminal state without writes. The combined credential-free check
passed 839 control and 171 runtime tests plus native/service fixtures and build;
the new `--submission-ack` fixture observed one native launch, two model requests,
and two identical HTTPS registration requests after dropping the first reply.
This does not establish production settlement or restart recovery.

Operation snapshots now retain up to 4096 observations and send all of them in
100-record heartbeat pages under the original local lease. Partial failures fence
admission, with no local renewal or hold release. The actual native fixture ran
101 read-only MCP calls, verified every receipt, and delivered 103 operations in
pages of 100 and 3. The combined check passed 848 control and 171 runtime tests,
native/service fixtures and build. Unknown coverage still blocks settlement/sleep;
this is not unlimited retention or multi-root admission.

Offline snapshot inspection now includes native-question custody: unresolved
questions survive expiry/termination in the report; original attempt, scope and
closure relationships are checked without exposing content or authorizing replay.
It remains a bounded semantic diagnostic, not the full ledger payload validator or
coordinated restore proof. Focused tests passed 86; the latest control suite passed
864, with typecheck/build and 16 desktop tests also passing. Prior full native/runtime
verification for the heartbeat checkpoint remains recorded above.

Native tool and spawn invocations now retain host-observed start/progress clocks
and use two-minute phase deadlines capped by the task hard deadline. Buffered
events retain receipt time; duplicate events/history reads never restart clocks.
Corrupt timing and backwards live transitions fence without repairing custody.
Spawn completion does not settle its child. The combined credential-free check
passed 865 control and 183 runtime tests, native/service fixtures and build;
focused timing tests passed 66. Actual native fixtures cover 101 MCP calls and
independent child cancellation. No account or live Sprite calls were made.
Legacy/history-only records keep the hard-deadline fallback. Quiet inference,
explicit longer shell/transfer windows and progress-based extensions remain
unimplemented; do not call this full S19, settlement or production readiness.

Heartbeat operation timestamps now canonicalize to UTC milliseconds before
storage. Equivalent offset replays preserve original instants; changed kind,
start/deadline or backwards progress rejects the whole page without renewing the
lease. Retained offset rows canonicalize only on authorized equivalent replay;
this is not a bulk repair or restore migration. Seven new regressions failed
before the fix. Final focused lifecycle/Worker HTTP checks passed 59 tests;
the final control suite passed 877 tests and typecheck passed. The combined
credential-free verifier passed 872 control and 183 runtime tests plus all
native/service fixtures and build before five additional boundary tests were
added and included in the final control run. Production gates remain false.
No account calls, live provider changes, pushes or deployments were made.

## Next work

The owner permits a root and native descendants to share one admitted task's grant. The pinned `--child` native fixture verifies inherited MCP tools and real task-scoped Worker receipts after parent completion; dynamic-tool inheritance remains unavailable. Child command/MCP observations now use exact thread/turn namespaces. Do not confuse task-level authorization with per-child caller authentication or completed invocation observations with effect settlement. See `docs/NATIVE_ORCHESTRATION.md` and `docs/CODEX_RUNTIME_SETUP.md`.

The disposable [service composition](CODEX_SERVICE.md) now exercises native child
owner-cancel delivery through its actual supervisor facade and Worker heartbeat.
Unknown coverage still blocks completion and sleep. [Portable templates](PORTABLE_TEMPLATES.md)
provide selected, authority-stripped offline import plans, not complete backups.
Live Sprite Tasks hold/renew/delete evidence is recorded in `docs/PROVIDERS.md`;
it does not prove service sleep, resume or crash recovery.

Use [TODO.md](../TODO.md) as the maintained queue and acceptance coverage index, rather than duplicating its task statuses here. Current order is E01 deadline/activity accounting, E02 recovery/service assembly, then E03 responsive orchestration; independent portal, connector-fixture, portability and client work need not wait for account access. Owner/account/device actions are listed separately there. Mac direction is SwiftUI + WKWebView, not yet implemented; existing Electron files are not a verified Mac release.

Preserve exact task identity and unknown outcomes. A root turn is not settlement. Never copy credentials between orbs, patch the runtime, edit runtime-owned databases, enable production gates to make a demo pass, or treat connector catalog presence as callable authorized effects.
