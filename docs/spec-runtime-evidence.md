# OpenClaw runtime evidence for the transient personal-agent specification

Research date: 2026-09-10. Read-only investigation; no configuration, credentials, accounts, schedules, or running services changed. This is an evidence appendix and architecture recommendation, not a claim of end-to-end verification.

## Baseline and evidence strength

Installed package version confirmed from `package.json`: **2026.9.3**, state schema 16, agent schema 19. Package root: `/Users/kasparhidayat/.local/share/openclaw/tools/node-v24.19.0/lib/node_modules/openclaw`. The existing project records CLI build `1391f7c`; that hash was not independently rechecked here. Local bundled documentation and selected bundled runtime files were inspected. Live official pages for agent loop, multi-agent, session-state, and automation lifecycle were also retrieved; web docs can move ahead of this pinned package.

Existing `README.md`, `docs/LOCAL.md`, and `agent/README.md` establish one authoritative remote Gateway, an intermittent paired Mac, no provisioned VM, and no configured inference credentials during prior deterministic tests. The transient proposal changes the remote Gateway's uptime, not its authority over persisted OpenClaw state.

## Native capabilities to reuse

| Requirement | Evidence and native surface | Implication |
| --- | --- | --- |
| Personas without separate VMs | One Gateway supports multiple agent IDs, each with workspace instructions and separate agent SQLite state. `agentDir` must never be reused. [Multi-agent](https://docs.openclaw.ai/concepts/multi-agent) | Use one native agent per durable persona, all in one sleeping runtime. Separate context is cheap; separate instances are unnecessary. |
| Shared skills and tailored tools | Skills resolve from workspace plus shared roots; agent allowlists can replace shared defaults. Workspace is a default directory, not a security sandbox. Same source above. | Share reviewed skills, explicitly scope tools and memory; do not mistake persona boundaries for hard filesystem isolation. |
| Inter-bot messages | `sessions_send` targets another local session; accepted/queued is not completion. Reply-back loops exist and `REPLY_SKIP` stops them. [Session tools](https://docs.openclaw.ai/concepts/session-tool) | Reuse native dispatch for actual bot work. A group room still needs explicit membership, speaker selection, history and loop budgets. |
| Low-noise awareness | `stateVersion`, `changesSince`, watchers and coalesced notices exist. The log is best-effort, metadata-only and bounded; some events do not notify, and main watchers can trigger inference via heartbeat. [Session state](https://docs.openclaw.ai/concepts/session-state) | Useful native hint, not a transactional event bus or guaranteed no-inference synchronization. |
| Memory | Native Markdown user preferences, durable facts and dated working notes; search/get; routine behavior belongs in skills/scheduled tasks. [Memory](https://docs.openclaw.ai/concepts/memory) | Keep OpenClaw retrieval; add explicit global/persona/routine scopes and reviewed revision metadata. |
| Cron jobs | Scheduler runs in Gateway, persists jobs and history; Gateway must be online for firing. Startup catch-up has its own deferral rules. [Automation lifecycle](https://docs.openclaw.ai/automation/cron-jobs/how-it-works) | An external scheduler must wake the runtime. Choose one authority for occurrence generation, never two independent schedules. |
| Run tracking | Gateway `agent` returns a run ID; lifecycle and tool streams exist; `agent.wait` observes terminal state. Wait timeout does not cancel. [Agent loop](https://docs.openclaw.ai/concepts/agent-loop) | Admit a durable outer lease before submitting; release only after settled execution, persisted output and required delivery. |
| Stuck work | Native background task records, audit, maintenance and `tasks.cancel`; task terminal state is distinct from delivery. [Tasks](https://docs.openclaw.ai/automation/tasks) | Reuse native cancellation and reconciliation, add external dead-runtime detection and business-safe retry policy. |
| Extension path | Plugin hooks and tools extend core; plugin APIs are explicitly experimental. [Building plugins](https://docs.openclaw.ai/plugins/building-plugins) | Pin host/plugin versions and adapter contract tests. Avoid a core fork or direct database mutations. |

Bundled source additionally confirms `chat.abort` registration in `dist/server-methods-CWI3KUiQ.mjs` and `tasks.cancel` in `dist/tasks-zhYH_s7a.mjs`. These hashed paths are implementation evidence, not stable integration APIs. Cancellation parameters and acknowledgments need an adapter test before implementation relies on them.

## Recommended responsibility split

**Always-available control plane:** dedicated chat portal, authentication, durable ingress queue, external schedule occurrence generation, trigger verification/deduplication, wake/stop provider adapter, instance fencing, result delivery and durable application metadata. Persist messages before acknowledging them; do not require an awake Gateway just to accept a message.

**One resumable OpenClaw runtime:** native persona agents, actual model/tool execution, native session history and memory, WhatsApp reconnect, persistent browser profile, optional paired Mac. Attach the same durable state to one owner at a time. A fresh sandbox image is acceptable; a fresh identity/state directory on every run is not.

**Thin version-pinned OpenClaw adapter/plugin:** map portal bot IDs to native agent/session IDs; submit and observe runs; report leases and completion; implement routine/room tools; inject authorized memory snapshots; use native cancellation. Do not scrape the Control UI or edit OpenClaw SQLite tables as the integration contract.

**Application store:** authoritative persona metadata, routine definitions/revisions, global and routine memory records, room events/cursors, inbox/outbox, execution attempts and side-effect receipts. OpenClaw remains authoritative for its native transcripts/auth/browser state. Any Markdown projection from application memory is a generated view, never a second writable source of truth.

## Personas, rooms and no-op synchronization

Prefer native agents over one ever-growing shared transcript: this permits different instructions and tools without duplicating a VM or provider process. The portal should show bots and rooms, hiding implementation session creation. Maintain a default conversation per bot; allocate bounded task sessions automatically for independent routines. Keep room message IDs and native run/session references separate.

A group message is stored once with ordered sequence, actor, recipients, reply-to, visibility and provenance. Select at most one initial bot speaker unless the user explicitly addresses multiple bots. A bot can request another bot's contribution through bounded native dispatch. Apply depth, turn, cost and fan-out budgets; detect duplicate causal paths.

Define `context_update` as a **data-only room event**: persist revision pointers/summary, advance recipient cursors transactionally, and include relevant deltas on the recipient's next real run. It does not call `sessions_send`, wake the VM or invoke inference. Calling an agent and asking it to return `NO_REPLY` is silent inference, not a no-op. Material task requests use a separate `action_request` event that can wake and execute.

Native watches can supplement this design but cannot replace its guarantees: their log is best-effort, notices omit message contents, retention can produce `historyGap`, and main-session notices can cause heartbeat work. Avoid indiscriminate watches in the cost-sensitive default.

## Memory contract recommendations

Use four layers: compact global user directives; persona-specific instructions and facts; routine/skill-specific operational memory; ephemeral task context. Every durable application record should have ID, scope, revision, provenance, observed/updated time, optional expiry, supersedes pointer, confidence and sensitivity. Explicit user corrections supersede earlier records. Never turn imported external content into higher-priority instructions automatically.

At run admission, pin persona/routine instruction revisions and memory scope/version watermarks. Retrieval exposes only eligible scopes; a routine gets its own memory plus approved global/persona context. Writes go through a typed application operation with optimistic revision check. Skills are executable instructions; routine memory is mutable state; schedules determine when to run. Keep those objects distinct.

## Scheduling and sleep contracts

Preferred first design: control plane owns schedules and deduplicated occurrences; runtime executes each occurrence as ordinary bounded work. Natural-language routine tools write the application schedule store, not a second native cron schedule. Native cron is optional for runtime-local maintenance only, with an explicit owner and no duplicate external firing.

An alternative is mirroring native cron's next due time into an external wake alarm, but this couples shutdown to native catch-up semantics and schedule synchronization. Defer unless there is a strong requirement to retain the native cron UI.

Safe sleep requires a durable gate, not idle CPU or lack of streamed text. Minimum blockers: accepted/queued runs, active inference (including quiet native turns), active tools, children, detached processes, browser transfers, state flushes and undelivered required results. Human approval waits can release compute only after the continuation/approval state is persisted and no live operation depends on the process.

Recommended protocol: mark instance `draining` under a fencing epoch; stop new admission to that instance; recheck all leases and queue; request native drain and browser/state flush; commit resumable state; acknowledge checkpoint; stop machine. If new ingress races shutdown, persist it and either abort draining or wake a subsequent generation. Never mount writable OpenClaw/browser state simultaneously in two generations.

An outer run lease starts **before** OpenClaw admission and lasts through terminal persistence and result-outbox commit. Tool hooks alone miss provider preparation, quiet inference, failures before hooks, detached work and final writes. Track tool/subprocess/transfer leases as additional detail, not substitutes. `finishing` is not terminal, and wait timeout is not proof of inactivity.

## Stuck detection and retry

Separate execution hard deadline, phase deadline, and heartbeat/liveness deadline. Lack of assistant tokens alone does not mean a run is stuck. Query the owning runtime/task ledger; request bounded cancellation; wait for confirmed terminal state; escalate process termination only after a grace window. If the runtime vanished, classify the attempt as interrupted/unknown and reconcile before retry.

Retry automatically only when the step is read-only, idempotent, or has a verified outcome receipt. A timed-out form submit or message send may already have succeeded. Persist side-effect intent before execution and receipt afterward; unknown outcome requires destination reconciliation or human decision rather than blind replay. Cancel acknowledgment never proves an external side effect was undone.

## Required proof before rollout

1. Fresh boot of pinned image preserves agents, memory, session history and auth without re-pairing; single-writer enforcement prevents concurrent mounts.
2. Adapter observes admitted, queued, quiet inference, tool, child, final-write and delivery phases; none can sleep prematurely.
3. Native cancellation targets exactly one run and confirms settlement; an `agent.wait` timeout leaves execution running.
4. Duplicate wake/message/schedule triggers produce one logical occurrence and no duplicate side effects.
5. A data-only room update incurs zero inference and zero wake; next relevant run reads it exactly once or detects a gap.
6. Routine edits atomically revise future occurrences; due/missed/DST/timezone policies are tested externally, not inferred from native catch-up.
7. WhatsApp cold-start catch-up is separately measured; successful authentication is not evidence of complete missed-message retrieval.
8. Crash after external submit but before receipt becomes `outcome_unknown`, never an automatic resend.

Unknowns left deliberately open: adapter RPC authentication/scopes and exact event reconnection semantics; fully supported lifecycle coverage for each selected model harness and tool; safe native browser-profile shutdown; provider-specific instance fencing/volume attachment; exact cancellation request schema; behavior of pending approval continuations across cold boot. These are small compatibility/proof tasks, not reasons to rebuild native OpenClaw functionality.
