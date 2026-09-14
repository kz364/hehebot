# Codex orchestration and settlement contract

Codex app-server **0.154.0** is the sole execution harness. The application owns persona, conversation, logical task, policy, memory, occurrence, effect, and user-visible result identity. Codex owns its thread/turn/tool loop and runtime-private state. Integrate only through supported app-server and host-tool boundaries.

## Required routing

- Every owner message is durably accepted before inference and enters the persona coordinator unless explicitly targeted at a task.
- Long work uses isolated task threads/turns. Preserve exact root, child, command, MCP call, and logical-task identities in the durable journal.
- Classify messages as status, independent work, exact-task steering, deferred follow-up, or cancel/pause. Ambiguity asks for clarification without changing active work.
- Acknowledged submission/steering/cancellation is not settlement. A completed root is not a descendant/tool/effect barrier.
- Unknown submissions or effects remain parked and are never retried under a fresh identity.
- Host tools require the admitted run, pinned persona/policy/context revision, stable call fingerprint, and durable result. The owner permits the root and native descendants of one admitted logical task to share that task's grant. This does not grant access to another task or persona.
- Waiting parents yield scarce model capacity. Shared browser/account/entity mutations use narrow resource locks and effect receipts.

## Shared task authority

The owner selected shared parent/child authority on 2026-09-14. Native children may inherit the task's approved tools, policy snapshot, scoped memory and resource access without a separate per-child approval. Inheritance cannot widen the task grant, bypass an effect policy, or create separate authority from model-supplied identity fields. Independently admitted tasks retain separate grants, even on the same customer runtime.

Codex 0.154.0 does not inherit root dynamic-tool registrations. Use a supported task-scoped MCP configuration where inheritance is verified; attribute its commands and receipts to the admitted logical task. A fixed stdio MCP grant does not authenticate which descendant called it, so do not claim per-child effect provenance from that transport. Native event IDs can track invocation activity separately. Do not share one task's MCP configuration across independently admitted tasks; production assembly must enforce that boundary.

Shared permission is not shared completion. Track every observed descendant turn, command, tool and effect after root completion. Cancellation acceptance does not settle children or authorize releasing locks or sleep holds.

Coordinator retry also waits for all recorded descendants. The owner retry
command and claim selection share a recursive predicate checking terminal run
status, attempts, operations, locks and unresolved effects. Claim rechecks before
its limit so late child observations block the original root without hiding
independent queued work. This preserves the old parent attempt for reconciliation;
it does not prove a complete native census or settle missing observations.

Deferred task follow-ups use the same recorded-descendant settlement predicate.
A child completion/recovery rechecks only that task and its ancestors; an
unrelated sibling neither receives the instruction nor blocks a settled subtree's
follow-up. Original 90-day instruction expiry and one coordinator continuation
per follow-up still apply. Ordinary messages and immediate steering are separate.

## Current concurrency boundary

[Two-root Worker admission](CODEX_TWO_ROOTS.md) remains globally serialized.
The [native V2 capacity probe](CODEX_CAPACITY.md) independently demonstrates
overlapping native roots and root/child inference with a per-session limit of one;
that setting is not an installation-wide scheduler. The V2 child's tested tool
catalog lacks spawn/wait, so waiting-child yield is not behaviorally proved. Do
not silently switch the service's default native feature family based on this probe.

Preserve independent task grants when evolving admission. Scheduling occupancy
must be separate from the durable task/attempt and all its outstanding obligations.
A second host claim slot alone cannot regulate native-initiated continuations.
Meeting the two-turn reserved-interactive contract requires a supported admission
boundary covering every native start/resumption, including descendants and yielded
parents. A notification followed by interruption is too late to enforce that cap.
Until that boundary is established, do not relax Worker capacity or production gates.

The event router now fences with `NATIVE_ROOT_TURN_UNBOUND` when an observation
arrives for a new, unacknowledged turn on a known root thread. It retains the
unprocessed observation and original task identity instead of treating the prior
root's terminal flag as coverage. Synthetic tests cover observations arriving
before binding and after root completion. This fence is not proof the native turn
or its side effects stopped, and the pending buffer is not a durable event archive.

## Settlement and sleep

The runtime may release its Sprite activity hold only after all model turns, commands, children, tools, subprocesses, transfers, device calls, external effects, output commits, and persistence flushes are definitively settled or durably parked at a restartable checkpoint. On incomplete or conflicting observations, stop admission and enter recovery. Warm/cold wake must reacquire ownership and reconcile before executing.

## Acceptance

O01–O09 in [the orchestration addendum](BOT_ORCHESTRATION_ADDENDUM.md) are normative. Also prove active-work crash recovery, recursive descendant census/settlement, exact cancellation isolation, policy-preserving child effects, no duplicate steering, controlled auth refresh, and provider-hold renewal/release. Scripted app-server fixtures are useful evidence but do not establish model intent, authenticated inference, live effects, or production readiness.
