# Hehebot v2 execution architecture (normative, 2026-09-27)

Status: **normative owner decision.** This document supersedes conflicting clauses in
[SPEC.md](../SPEC.md), [PROJECT_INTENT.md](PROJECT_INTENT.md),
[BOT_ORCHESTRATION_ADDENDUM.md](BOT_ORCHESTRATION_ADDENDUM.md),
[NATIVE_ORCHESTRATION.md](NATIVE_ORCHESTRATION.md), [CODEX_RECOVERY.md](CODEX_RECOVERY.md)
and [PRODUCT_UX_SPEC.md](../PRODUCT_UX_SPEC.md). Each superseded clause is listed in
§9, and those documents carry pointers back here. It is a design target, not evidence
that anything is implemented. Production gates and account/deployment authorization
are unchanged.

## 0. Why this exists

From 2026-09-16 to 2026-09-26 roughly 150 commits hardened crash recovery. The work
covered native child-tree reconstruction, unknown-obligation custody across journal
reopen, and proof that a Sprite restart kills old processes. Meanwhile the owner still
could not chat with a bot while it ran a background task. The hosted trial on
2026-09-17 produced a **correct reply** that was never shown as final, because the
root Codex turn did not settle. The design made every user-visible outcome wait on
proving the state of a third-party process. That is unprovable with supported
interfaces, so the project stalled.

Patterns from prior art in hosted assistant products face the same problems and ship
(see [REFERENCE_PATTERNS.md](REFERENCE_PATTERNS.md)). That design **fences effects
instead of proving process death**, **commits messages independently of turn
settlement**, treats **interrupted work as a visible terminal state rather than
something to take over**, and lets the **agent route messages with tools** instead of
a separate classifier. Hehebot keeps its own selected stack (Cloudflare Worker +
SQLite Durable Object, one sleeping Sprite, Codex app-server 0.154.0) and adopts those
patterns.

## 1. Decisions

### A1. The agent speaks only through `hehebot_send_message`

- Every persona coordinator turn and every task turn gets a host tool
  `hehebot_send_message { text, reply_to_event_id? }` (text ≤ 32 768 UTF-8 bytes).
- The runtime forwards the call to the Worker. It carries run, attempt, epoch,
  boot_id and a deterministic `message_key = (attempt_id, native tool-call id)`. The
  Worker checks that the attempt is current and not terminal, dedupes on
  `message_key`, appends a `bot.message` timeline event attributed to the persona
  (and task, when sent from a task), commits, and returns `{ event_id, seq }`. The
  tool result is returned to the model only after the commit.
- **A delivered message is final.** Later turn failure, cancellation, deadline or
  interruption never retracts or hides it. A separate `notice` event explains what
  happened afterwards.
- **Fallback:** if a turn completes with final assistant text and sent no message,
  the Worker publishes that text as `bot.message` with `origin: "final_text"`. If
  the turn fails without sending anything, the owner sees a failure `notice`, never
  silence.
- Streamed assistant deltas are optional presentation (`live` frames, §A6). They are
  never committed and never block anything.
- Limits: 20 messages per attempt and 1 per second per attempt. Excess calls return
  a tool error to the model and do not fail the turn.

### A2. Fence effects by generation, not by proving process death

- The runtime's credential to the Worker is minted per **generation**
  `(installation, epoch, boot_id)`. Every runtime call already carries epoch and
  boot_id. The Worker rejects any older generation, including effect intent/dispatch
  permits and `hehebot_send_message`.
- **Starting a successor needs only an atomic epoch advance.** No provider
  termination proof, no kernel-ID comparison, no retirement inventory. In the same
  transaction:
  - every attempt of the previous generation that is not terminal becomes
    `interrupted`
  - its `dispatched` effects become `outcome_unknown`
  - its `intent` (never dispatched) effects become `abandoned`
  - its resource locks become `held_by_interrupted`: they stay held until their
    unknown effects are reconciled or the owner releases them
- **On the machine:** the supervisor takes the existing executor `flock`. If a live
  earlier holder exists on the same Sprite, it SIGKILLs that holder's process group
  (same PID namespace) and retries for up to 30 s. After that it reports
  `RECOVERY_REQUIRED` with the reason, visible to the owner. It never deletes state
  to get the lock.
- **Mutating tools must pass through a Hehebot-fenced boundary:** a `hehebot_*` host
  tool or the Hehebot MCP gateway, each calling the Worker's effect-permit route.
  Codex-native plugins and apps whose effects bypass Hehebot are classified
  **unfenced**. Only read operations of an unfenced tool may be granted until it is
  wrapped behind the gateway.
- **Accepted residual risk:** a stale process that survives a restart can still use
  model quota and write its private workspace until it is killed. It cannot post
  messages, obtain effect permits or complete runs.

### A3. A turn is atomic; interruption is terminal for the attempt

- One attempt runs one Codex turn and its native descendants. On crash, lease loss,
  deadline, epoch advance or unconfirmed cancellation, the attempt becomes
  `interrupted`, which is terminal. **No native takeover, no reconstruction of
  in-flight child trees, and no requirement to prove descendant termination.**
  Native descendants of an interrupted turn are treated as dead with it: they are
  killed with the process group, and A2 fences their effects.
- **Continuation is a new attempt,** normally on a fresh Codex thread, seeded by the
  Worker with:
  - the task brief
  - the committed timeline messages for that task
  - an effect-ledger summary that lists `outcome_unknown` effects and tells the
    model to reconcile or ask before redoing them
- **Policy:**
  - Read-only tasks with no unknown effects retry automatically, at most twice,
    after 10 s and 60 s (existing policy).
  - Anything with unknown effects parks as **needs-you**, with owner choices
    *reconcile / retry anyway / abandon*.
  - Coordinator turns are never retried automatically. The next owner message or
    task event starts a fresh turn.
- **The sleep/idle predicate counts only live work of the current generation:**
  running turns, tool calls, node calls, transfers and flushes. Interrupted
  attempts, unknown effects, parked tasks and needs-you items are durable records.
  They **never** keep compute awake.
- `runtime/codex-recovery-inspect.mjs` stays as an optional operator diagnostic. It is
  not a gate, not a prerequisite for successor start, and not a target for further
  hardening.

### A4. The coordinator routes with tools; there is no classifier

- Each persona has one **coordinator thread** (a Codex thread for its visible
  conversation). Each logical task has its own **task thread**.
- Owner messages go to a per-persona **inbox** in the Worker:
  - If no coordinator turn is running, the Worker starts one with every pending
    inbox item batched in arrival order.
  - If one is running, it delivers the new message into **that coordinator turn**
    with `turn/steer`. Steering the conversational turn is expected; it is not
    steering background work.
  - When the runtime is asleep, the message waits in the inbox and wakes the
    runtime (existing wake path).
- **Coordinator tools** (plus the existing memory, routine and skill tools):

  | Tool | Effect |
  | --- | --- |
  | `hehebot_send_message` | A1 |
  | `hehebot_start_task { title, brief, capability_ids? }` | The Worker admits a task in the background lane, with capabilities that must be a subset of the persona grant. Returns `{ task_id }` immediately and never waits for the task. |
  | `hehebot_list_tasks { state? }` / `hehebot_task_detail { task_id }` | Read the durable task ledger. |
  | `hehebot_steer_task { task_id, text }` | `turn/steer` into the task's running turn. If no turn is running, returns `not_running`; the model may then queue a follow-up. |
  | `hehebot_queue_followup { task_id, text }` | Delivered as the next turn on that task thread when its current turn ends. |
  | `hehebot_cancel_task { task_id }` | Cancels only that task. The answer distinguishes requested from confirmed. |

- **Intent resolution is the model's choice of tool.** Owner text reaches a task
  thread only through an explicit `steer_task` or `queue_followup` call; nothing is
  routed there implicitly.
- **Task → coordinator wake:** when a task finishes, fails, needs input or is
  interrupted, the Worker appends a `task.event` to the persona inbox. That starts a
  coordinator turn (events arriving within 2 s are batched), and the coordinator
  relays the result with `hehebot_send_message`. Tasks may also post attributed
  progress directly with `hehebot_send_message`.
- **Loop bounds:**
  - at most 3 automatic coordinator turns per owner-message causal chain (the
    existing collaboration limit)
  - coordinator turn deadline 2 minutes
  - a coordinator turn never blocks waiting on a task
- **Capacity is unchanged:** one interactive lane (coordinator turns, fair FIFO
  across personas) and one background lane (task turns). Saturation shows as a
  visible queued state.

### A5. Durable client outbox

- **Before its POST,** the portal persists `{ nonce, conversation_id, text, phase,
  created_at, tries }` to IndexedDB, falling back to localStorage. `nonce` is the
  `Idempotency-Key`.
- **The optimistic bubble renders immediately.** Phases:
  `queued → sending → accepted → echoed`. Failure states: `rejected`, which removes
  the bubble and restores the text to the composer, and `unknown`, which retries
  with the same key and exponential backoff and shows "not yet delivered".
- **Sends are FIFO per conversation.**
- **Reconciliation after reload:** `GET /v1/receipts?idempotency_key=` returns the
  original receipt or `not_found`. Only `not_found` from an authoritative lookup
  permits resending under the same key.
- **Echo:** the timeline `owner.message` event carries the command's idempotency
  key. When the client sees it, the optimistic bubble is replaced by the committed
  one.

### A6. Streamed append-only timeline

- **Every committed timeline event has a monotonic `seq`** (the existing event
  sequence).
- **The primary transport is a Durable Object WebSocket using the Hibernation API:**
  `GET /v1/stream` (Access-authenticated, same origin).
  - Client sends `{ subscribe: [conversation_ids] | "all", cursor }`.
  - Server frames: `events { events[], cursor }`, `heartbeat`, `snapshot_required`,
    `live { persona_id, coordinator_running, tasks:[{task_id,state}], stale_after_ms }`,
    `runtime { state: asleep|waking|running|recovery_required }`.
- **Open or hibernated sockets never wake the runtime or start inference.**
- **Fallback:** the existing `GET /v1/state?after=` long poll, ≤25 s, only while the
  page is visible. The portal's fixed 5-second full refresh is removed.

### A7. Clean thread rendering

| Entry kind | Rendering |
| --- | --- |
| `owner.message` | Owner bubble; optimistic until echoed |
| `bot.message` | Bot bubble; attribution chip when sent by a task |
| `task.card` | One card per task, updated in place with state, steer, follow-up and cancel |
| `activity` | Collapsed under the nearest bubble or card: tool and progress summaries |
| `notice` | Never collapsed: failures, interruptions, needs-you, recovery choices |
| `event` | Routine results and context updates |

Only `owner.message` and `bot.message` are chat bubbles. This replaces the
"provisional preview" presentation of final answers.

### A8. Bounded rooms as a turn scheduler

The Worker asks one room member at a time for a turn with:
`{ room_id, member_id, new_messages since that member's last turn, peers,
deadline_ms, is_winding_down, root_cause_id }`. The member replies with
`hehebot_send_message` or passes. Outcomes are `SENT | PASS | SKIPPED | TIMEOUT |
ERROR`. The existing limits apply: one default responder, at most 3 bot
contributions per owner message, hop depth 2 and fan-out 2.

### A9. The Mac node pulls

The paired Mac keeps an outbound WebSocket to the Durable Object. The Worker queues
node requests (`enqueued_at`, `deadline`). When the Mac is offline, requests park
durably, and the Sprite is never kept awake just to wait for it.

Implementation notes (docs/MAC_NODE.md): the queue, pairing hash and node-token hash
live in `runtime_metadata` rather than new tables, so no schema migration is needed. The
pairing code comes from a dedicated owner route, not a `/v1/commands` receipt, so the
secret never enters the durable command ledger. A settled parked request wakes the
runtime through an ordinary coordinator run (A4 causal depth), not a separate channel.

## 2. What we deliberately do not adopt

- **Temporal or another durable-workflow engine.** A3 gives the needed property:
  an attempt can die without corrupting state. It does this without a second loop,
  and Codex remains the only harness.
- **Per-session VMs, or an object-store disk manifest.** One sleeping Sprite with
  its persistent disk stays the selected runtime.
- **That prior art's full widget catalogue.** Approvals, questions and forms use the
  existing Hehebot contracts, rendered as `notice` or `task.card`.

## 3. Unchanged invariants

- One writer, the Worker/Durable Object, for application state.
- Idempotent `/v1/commands`.
- Ordinary owner messages never implicitly steer or cancel **background tasks**.
- Unknown external outcomes are never blindly replayed.
- Passive updates cause no inference or wake.
- Scoped memory and resource locks.
- No patching of Codex internals and no copying of OAuth caches.
- Production flags stay false until the documented gates pass.

## 4. Acceptance (additions; the V rows in TODO.md track them)

| ID | Test |
| --- | --- |
| V-A1 | A turn calls `hehebot_send_message`, then is killed before completion. The message stays visible after reload, the attempt shows `interrupted` and a notice explains. Repeating the call with the same `message_key` does not duplicate the message. A turn with only final text publishes one `final_text` message. |
| V-A2 | Epoch advance with a live old process fixture. The old generation's send, effect permit and completion all get `STALE_EPOCH`. A same-machine flock holder is killed and the successor starts. No test depends on provider termination evidence. |
| V-A3 | A crashed read-only task auto-continues once on a new attempt with a seeded brief. A crashed task with an `outcome_unknown` effect parks as needs-you. The sleep predicate returns idle while only interrupted or unknown records exist. |
| V-A4 | With task A running, a status question gets a coordinator reply and A is unchanged. "Also do B" produces a `start_task` call and B is independent. "Use tomorrow for A" produces `steer_task` (or `queue_followup` when A is between turns). Completion of A wakes the coordinator, which relays the result. |
| V-A5 | Kill the network mid-send, then reload. The bubble reconciles through the receipt lookup with exactly one owner message and no duplicate run. A rejected send restores the draft. |
| V-A6 | Open idle sockets for 1 hour: zero wakes and zero inference. Resume from a cursor after reconnect, and get `snapshot_required` when retention evicts the cursor. |
| V-A7 | A timeline with tool activity renders only the bubbles, with activity collapsed and notices visible. Checked in Chromium at desktop and 390 px widths. |

A scripted-model fixture is enough for V-A1 through V-A7. Real-model evaluation of
routing quality (V-A4 with a live model) is a separate, owner-authorized step.

## 5. Implementation map

The concrete, file-level work breakdown lives in the **v2 architecture** section at the
top of [TODO.md](../TODO.md) (rows V0–V9). TODO.md is the only live checklist.

## 9. Superseded clauses

| Document | Clause | Now |
| --- | --- | --- |
| SPEC §6 rule 2 | "confirm provider stopped state before replacement execution" | A2: epoch advance + same-machine flock kill |
| SPEC §6 rule 5 | sleep forbidden during "effect uncertainty requiring live reconciliation" | A3: only live current-generation work blocks sleep |
| SPEC §8 S08 | "No second executor" when provider state is unknown | A2: successor may start after epoch advance |
| SPEC §9.1 | 5 s refresh (implementation) / long poll as primary | A6: WebSocket primary, long poll fallback |
| SPEC §10 lifecycle | "Controller does not start another executor until provider confirms old stopped"; "stop owning process group/Machine through fenced recovery" before retry | A2/A3 |
| SPEC §18 | "Epoch fencing could be mistaken for website fencing. Stop old process/provider before replacement" | A2: fencing at the effect-permit boundary; dispatched effects become `outcome_unknown` |
| SPEC §20 | "Complete recursive event/settlement coverage remains unproved, so execution stays disabled" | Live settlement coverage is still required for **sleep**. It is not required to show replies, start successors or run the alpha. |
| PROJECT_INTENT §3 | "Sleep is allowed only after … settle" read as including dead generations | A3 |
| ORCHESTRATION_ADDENDUM routing 1–2 | coordinator "classifies" intent | A4: tool choice |
| NATIVE_ORCHESTRATION "Required routing" | classification; completed root not a barrier for results | A1/A4 |
| CODEX_RECOVERY | recovery inspection as a precondition | A3: optional diagnostic |
| PRODUCT_UX_SPEC UX04 | provisional stream as the reply surface | A1/A7 |
| TODO F3/E01/E02 as "next" | recursive settlement / native takeover as critical path | V rows; E01/E02 are demoted to sleep-correctness-only work |
