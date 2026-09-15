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

Reasoning-item checkpoint (2026-09-15): exact root/child `reasoning` item boundaries
now retain host-observed five-minute phase clocks capped by the task deadline.
Only identity/status/times enter the host journal, never reasoning content or
deltas. Root completion does not erase unfinished reasoning, and the offline
inspector now includes those obligations. Two new regressions failed before the
change; 68 focused router/adapter/projection tests passed afterward. The actual
native `--reasoning` fixture passed with two scripted model requests and an
accepted HTTPS Worker heartbeat. The combined verifier passed 877 control and
185 runtime tests, all native/service fixtures, typecheck and build dry run.
E01 remains open for before-start silence, progress extensions, longer declared
shell/transfer bounds and complete coverage. Native reasoning history is not
erased by host projection. Production gates remain false; no live accounts,
provider operations, pushes or deployments were used.

Initial-response checkpoint (2026-09-15): new acknowledged submissions persist
`initialInference`, projected as a five-minute phase from original claim, capped
by the task deadline. Root acknowledgment and child events do not end it; exact
root item/terminal observations do, atomically with the observation. Reopen and
duplicate submission never restart it. Legacy markers are not invented.
Two regressions failed before implementation. Focused runtime checks passed 83;
Worker/lifecycle checks passed 54, including the exact five-minute boundary.
The first combined run found a stale native-fixture count; the added initial phase
was verified as an independent settled inference record, and the targeted rerun
passed. Final combined verification passed 878 control / 188 runtime tests, all
native/service fixtures, typecheck and build. The 101-MCP-call fixture now delivers
104 operations in 100+4 pages. Initial root silence is bounded, not every later
quiet interval or child startup. E01 remains partial; production stays disabled.
No accounts, live provider operations, pushes or deployments were used.

Child initial-response checkpoint (2026-09-15): newly observed child starts retain
`initialInference` and immutable `initialInferenceAt` in their own obligation row.
Five minutes from host receipt, capped by the task deadline; root activity cannot
end it. Exact child item/terminal observation or terminal readback ends only this
phase, leaving tools/effects untouched. Replay never restarts it; legacy clocks
are not invented. Offline inspection validates and reports the pair.
Focused runtime checks passed 87 and Worker checks passed 4, including exact
five-minute cancellation. The native service fixture observed the active phase
after parent completion while withholding the child's first response, then
verified seven heartbeat operations with unknown coverage still blocking sleep.
Two combined attempts found stale metadata/count expectations; those assertions
now require the new independent phase while retaining tool/sibling custody checks.
Final `bash scripts/verify-codex.sh` passed 879 control / 192 runtime tests, all
native/service fixtures, typecheck and build. E01 remains partial for later quiet
gaps, time before child-start notification, progress extensions and full coverage.
No accounts, live provider operations, pushes, deployments or gate changes.

Offline-clock checkpoint (2026-09-15): recovery observations now include optional
`timing: {startedAt,lastProgressAt}` copied only from validated stored clocks.
Canonical UTC, nondecreasing progress and exact owner/category/item keys are
required, including nested collaboration keys. Orphan/invalid clocks invalidate
the native report; missing legacy clocks remain absent. No deadline/expiry or
resume authority is inferred. Additional stored fields never enter the report.
Two regressions failed before implementation; 17 focused tests passed afterward,
covering every category, root/child isolation, corruption, redaction and no writes.
Eleven actual native service scenarios preserve MCP timing after shutdown.
`bash scripts/verify-codex.sh` passed 879 control / 195 runtime tests, all
native/service fixtures, typecheck and build. E01/E02 remain partial; next work
remains deadline coverage and successful fenced recovery, not merely inspection.
No accounts, live provider operations, pushes, deployments or gate changes.

Native-usage checkpoint (2026-09-15): supported `thread/tokenUsage/updated`
notifications retain normalized `tokenUsage` under the exact root or observed
child turn. `total`/`last` include six nonnegative safe-integer counters; the
pinned optional cache-write field defaults to zero, context window to null.
Unknown usage stays absent. Snapshots replace, never sum/max; compaction/replay
may lower or repeat observations. Identical normalized snapshots do not write.
Usage never ends initial inference, changes operation clocks or settles work.
Offline inspection validates/reports the snapshot without extra stored content.
This is not billing, freshness proof or complete task usage; see pinned-source
links in CODEX_SERVICE.md. No Worker/UI publication or aggregation yet.
Focused runtime checks passed 77. Eleven native service scenarios preserve exact
asymmetric fields (31 input, 7 cached, 13 output, 5 reasoning, 44 total).
Combined verification passed 879 control / 198 runtime tests, all native/service
fixtures, typecheck and build. E11 remains partial; E01/E02 gaps remain open.
No accounts, paid inference, live provider operations, pushes, deployments or
gate changes were used.

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
