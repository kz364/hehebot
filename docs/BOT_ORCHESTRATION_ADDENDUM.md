# Bot orchestration clarification — 2026-09-10

> **2026-09-27 supersession ([ARCHITECTURE_V2.md](ARCHITECTURE_V2.md) A4):** the coordinator resolves intent **by choosing tools**. There is no separate classification step.
> - `hehebot_start_task` creates independent work.
> - `hehebot_steer_task` steers an identified running task.
> - `hehebot_queue_followup` defers an instruction to a task's next turn.
> - `hehebot_cancel_task` cancels one task.
> - Status questions use `hehebot_list_tasks` / `hehebot_task_detail`.
> - Every reply goes through `hehebot_send_message`.
>
> A new owner message may steer the **coordinator's own** running turn. It never reaches a task thread without an explicit steer or follow-up call. Task completion wakes the coordinator through the persona inbox. O01–O09 still apply, interpreted through these tools.

Status: normative user clarification to SPEC.md. Takes precedence over its single-model-run default and any interpretation that one visible bot equals one serial native session. The implementation thread owns integration into SPEC.md, contracts, implementation and setup guides.

## Native-first implementation constraint

Use Codex app-server 0.154.0 through supported interfaces. Add only missing portal routing, durable metadata, provider activity integration and resource arbitration; do not patch the runtime or build a second model/tool loop. The coordinator/task distinctions are behavioral roles and context boundaries, not new process types. Record unsupported behavior before adding a thin adapter workaround.

## User-visible contract

Every bot is a conversational coordinator for its own work. The owner can message Travel while Travel is working on a form, ask it for status, or start a separate task without interrupting the form task. The owner never has to create or choose threads. This applies to every persona, not only Chief of Staff. Chief of Staff additionally coordinates across personas.

Messages may intentionally interrupt an existing task, but must not always interrupt. The coordinator resolves whether the owner wants status, independent work, a deferred follow-up, immediate steering of an identified task, or cancellation/pause. “Use tomorrow instead for the form you're filling” should steer that task; “also research hotels” should create separate queued work. If the target or timing is ambiguous, clarify without disturbing active tasks. Coordinator and executor are separate responsibilities/contexts; this does not require separate VMs.

Separate three identities: persona (instructions/responsibility), conversation (visible inbox/timeline), execution (isolated Codex thread/turn mapped to a logical task). Each persona has a lightweight interactive coordinator context and zero or more task contexts. A long task must not occupy the persona's conversational context for its duration.

## Routing and concurrency

1. Persist every inbound message immediately. Default to the persona coordinator; never automatically append it to the active background task's model input and never cancel that task merely because a new message arrived.
2. Classify owner intent as status, new independent task, deferred task-specific follow-up, immediate task steering, or explicit cancel/pause. Use run references and conversational context; if multiple tasks fit an ambiguous modification, ask one focused question without disturbing either task. The user need not know task IDs or use a magic interruption keyword when intent and target are clear.
3. Status reads the durable task ledger first. The coordinator may summarize it, but must not claim progress from elapsed time. Task results publish attributed events to the bot timeline without commandeering the coordinator session.
4. Queue deferred follow-ups for the named task's safe message boundary/checkpoint. Deliver intended immediate steering through a supported target-specific native mechanism; do not wait for task completion when a safe earlier boundary exists. Keep the logical task identity and record whether the instruction is pending or consumed. Steering may alter remaining work but cannot undo confirmed effects or abandon an uncertain in-flight mutation. Cancellation/pause must settle the exact target; global stop requires explicit owner intent. Switching bots or unrelated messages are not stop. Until native active-task steering is verified, disclose it as unavailable/pending rather than claiming the current after-settlement fallback meets this requirement.
5. Initial concurrency target: two active model turns installation-wide, with one slot reserved for interactive coordinator work and at most one background model turn. Multiple task workflows/tool waits may coexist subject to resource limits. All personas share the interactive lane fairly; no per-persona VM or unbounded fan-out. Background work cannot consume the reserved interactive slot.
6. Do not serialize entire model turns behind a global OAuth mutex. Serialize credential refresh/write ownership through the documented managed-auth mechanism; independently test whether the selected harness supports overlapping turns. If it does not, report this as a compatibility gap, implement ledger-only status/queueing meanwhile, and do not claim the non-blocking conversation requirement complete. Never duplicate credential caches to bypass a runtime limitation.
7. Suggested acceptance target: with one silent background inference active and no other interactive turn, durable message receipt p95 <=1 second and coordinator dispatch p95 <=2 seconds; with a deterministic fake model, status reply <=5 seconds. Real provider response latency is measured separately. Under interactive saturation, show queued state and reason, without canceling background work.
8. Waiting parents yield model slots before child dispatch. Persist continuations; outer workflow and live operation leases remain accounted for. Fair scheduling must prevent background starvation when the interactive lane is continuously busy.

## Shared services and resource locks

One Sprite hosts the runtime; connector credentials/accounts belong to the installation, not to a bot. Grant each persona/routine an explicit scoped capability. Logical responsibility stays with the appropriate bot, but no bot needs a separate WhatsApp login or private VM.

Serialize mutable browser-profile/tab interaction with resource locks; use separate tabs/profiles only when the actual account/tool permits it. Narrow locks to browser interactions, not a whole task's inference lifetime. Read-only connector APIs may overlap where supported. Calendar/Gmail writes use cross-bot entity deduplication, version checks, effect receipts and bounded account/resource locks. Human login intervention must not race automated browser input. Model concurrency does not authorize concurrent mutation of the same page or event.

Hold Sprites activity tasks/leases while any coordinator turn, task inference, tool, child, node call, transfer or flush is active. Coordinator idle does not imply runtime idle. Release compute for durably parked waits only when no live work depends on the process. Cold wake reconstructs coordinators and pending workflows from durable state; in-memory execution stacks are not assumed to survive.

## Memory and UI

Coordinator context contains persona instructions plus authorized summaries/task references, not all private task transcripts. Task sessions pin scope/revisions and never inherit incompatible routine histories. Bot timelines present collapsible task cards and labeled replies, with target-specific follow-up/cancel controls and an ordinary always-available composer. No thread picker is required. Data-only inter-bot updates remain zero-inference/zero-wake events until a real turn consumes them.

## Acceptance additions

- O01: Start Travel task A with silent inference; send Travel a status question. A continues with the same native run and unchanged input; coordinator responds through its separate session.
- O02: While A waits on a browser/tool, send independent task B. B is durably represented separately, and dispatches when its resource lane is available; A is not cancelled or reset.
- O03: Two tasks active, ambiguous “change the time” asks clarification without mutating either. “Use tomorrow instead for form A” steers A at a supported safe boundary before completion, preserving its logical identity and leaving B unchanged. “After A finishes, check its receipt” queues a deferred follow-up without steering A. Pending/consumed status is durable; replay does not deliver steering twice. A late steering request against a completed/uncertain effect reports the outcome rather than pretending to reverse it.
- O04: Cancel B leaves A and the coordinator active; closing a task card or switching bots cancels nothing.
- O05: Two bots contend for the same WhatsApp tab or calendar event. Locks/dedupe prevent crossed page input and duplicate writes, while unrelated chat still responds.
- O06: Background slot occupied, interactive slot remains usable; parent/child dispatch never deadlocks; saturation is visible and bounded.
- O07: Crash/cold wake retains accepted messages, task mapping and results without duplicate effects; updates route to the same logical tasks.
- O08: A coordinator reply finishes while a background tool is active. Sprite remains awake until all activity blockers settle.
- O09: Auth-refresh race under two turns results in one managed refresh owner and no token overwrite, secret leakage or paid fallback.

These tests supplement S01–S32. Update compute defaults, claim capacity/lane schemas, native routing, UI, activity counts, rollout gates and Definition of Done accordingly. The supplied prior-bot export makes a new exporter unnecessary for initial onboarding: implement preview/normalized import from the adapted markdown first.
