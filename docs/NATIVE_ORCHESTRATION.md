# Codex orchestration and settlement contract

Codex app-server **0.154.0** is the sole execution harness. The application owns persona, conversation, logical task, policy, memory, occurrence, effect, and user-visible result identity. Codex owns its thread/turn/tool loop and runtime-private state. Integrate only through supported app-server and host-tool boundaries.

## Required routing

- Every owner message is durably accepted before inference and enters the persona coordinator unless explicitly targeted at a task.
- Long work uses isolated task threads/turns. Preserve exact root, child, command, MCP call, and logical-task identities in the durable journal.
- Classify messages as status, independent work, exact-task steering, deferred follow-up, or cancel/pause. Ambiguity asks for clarification without changing active work.
- Acknowledged submission/steering/cancellation is not settlement. A completed root is not a descendant/tool/effect barrier.
- Unknown submissions or effects remain parked and are never retried under a fresh identity.
- Host tools require the exact admitted run, pinned persona/policy/context revision, stable call fingerprint, and durable result. Child authority must not be inferred from root authority.
- Waiting parents yield scarce model capacity. Shared browser/account/entity mutations use narrow resource locks and effect receipts.

## Settlement and sleep

The runtime may release its Sprite activity hold only after all model turns, commands, children, tools, subprocesses, transfers, device calls, external effects, output commits, and persistence flushes are definitively settled or durably parked at a restartable checkpoint. On incomplete or conflicting observations, stop admission and enter recovery. Warm/cold wake must reacquire ownership and reconcile before executing.

## Acceptance

O01–O09 in [the orchestration addendum](BOT_ORCHESTRATION_ADDENDUM.md) are normative. Also prove active-work crash recovery, recursive descendant census/settlement, exact cancellation isolation, policy-preserving child effects, no duplicate steering, controlled auth refresh, and provider-hold renewal/release. Scripted app-server fixtures are useful evidence but do not establish model intent, authenticated inference, live effects, or production readiness.
