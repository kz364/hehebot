# Native orchestration contract — pinned OpenClaw 2026.9.3

Read-only inspection on 2026-09-10. Normative requirements: [bot orchestration addendum](BOT_ORCHESTRATION_ADDENDUM.md) and [bot setup](BOT_SETUP.md). This document replaces neither native orchestration nor its authorization. No model, login, task spawn, cancel, or credential-refresh call was made. The earlier isolated Gateway proof covers token authentication and `health` only.

## Recommended native configuration

Merge into the existing configuration; preserve auth, workspace and connector settings. Paths below are deployment placeholders, not existing directories. Portal UUIDs map explicitly to these native IDs; never derive native identity from display names.

```json
{
  "agents": {
    "defaults": {
      "maxConcurrent": 1,
      "subagents": { "maxConcurrent": 1, "maxSpawnDepth": 1, "runTimeoutSeconds": 1200 }
    },
    "list": [
      { "id": "chief-of-staff", "workspace": "/persist/workspaces/chief-of-staff", "agentDir": "/persist/agents/chief-of-staff/agent" },
      { "id": "inbox-triage", "workspace": "/persist/workspaces/inbox-triage", "agentDir": "/persist/agents/inbox-triage/agent" },
      { "id": "whatsapp", "workspace": "/persist/workspaces/whatsapp", "agentDir": "/persist/agents/whatsapp/agent" },
      { "id": "messages", "workspace": "/persist/workspaces/messages", "agentDir": "/persist/agents/messages/agent" },
      { "id": "travel", "workspace": "/persist/workspaces/travel", "agentDir": "/persist/agents/travel/agent" }
    ]
  },
  "messages": { "queue": { "mode": "followup", "cap": 20, "drop": "new" } },
  "cron": { "enabled": false },
  "hooks": { "enabled": false }
}
```

Before applying, verify the installed config schema and run `openclaw config validate`; the full snippet has not been applied to a Gateway. The native fleet projection may use `agents.entries` in resolved configuration; the supported authoring list above is documented in the installed multi-agent guide. Shared auth read-through avoids copying OAuth credentials into those directories. Grant each persona only its approved tools and cross-agent spawn targets; do not enable an unrestricted `full` tool profile just to expose orchestration.

Native `main` and `subagent` are independent process-wide lanes. Source `src/gateway/server-lanes.ts` applies `agents.defaults.maxConcurrent` to `main` and `agents.defaults.subagents.maxConcurrent` to `subagent` separately. Thus **1 + 1 is the native capacity candidate**, not `main=2` plus another background slot. Per-session lanes serialize a native session. Unconfigured top-level capacity is CPU-derived 8–16; subagent default is 8. Explicit values are needed here.

This is not a universal two-model-turn ceiling: nested sessions, cron/hooks and plugin maintenance have other lanes. `sessions_send` uses `nested:<sessionKey>`; unrestricted cross-session sends can escape the intended capacity. Keep optional native cron/hooks/maintenance dispatch disabled and do not use A2A reply loops as routine scheduling. The depth-one default prevents a background child from spawning a grandchild while occupying the sole background lane. Deeper parent-yield behavior requires O06 proof before increasing it. Sources: [queue](https://docs.openclaw.ai/concepts/queue), [sub-agents](https://docs.openclaw.ai/tools/subagents).

## Persona coordinator and child mapping

Keep one native coordinator session per persona, for example `agent:travel:portal-coordinator`. Only bounded conversational/coordinator work occupies it. Native `sessions_spawn` creates long-task sessions. Persist the returned child session key, native run ID, native task ID when available, requesting persona, portal conversation ID and causal command ID. Preserve native identity across follow-ups; application metadata is a routing/index layer over native tasks.

The older `OpenClawAdapter` per-attempt session hashing remains an isolated-execution primitive. It does not itself implement this persistent coordinator/native-child experience. Do not treat ten passing adapter tests as O01–O09 completion.

New owner messages enter the coordinator, never an active child. Native channel default is **steer**, so explicitly use followup queueing. `chat.send` supports this request:

```json
{
  "sessionKey": "agent:travel:portal-coordinator",
  "agentId": "travel",
  "message": "Owner message supplied by the authenticated portal",
  "queueMode": "followup",
  "deliver": false,
  "idempotencyKey": "stable-command-uuid"
}
```

Use the named authenticated Gateway RPC, preserving stable request identity. `chat.send` acceptance is not completion. The transport must retain request uncertainty and reconcile, rather than retry under a fresh key. Local RPC scopes must match the native method; do not expose the Gateway token to the portal browser.

## Background dispatch uses the native model tool

The supported coordinator tool is **`sessions_spawn`**. No `sessions.spawn` Gateway RPC was established. Its native isolated one-shot request is:

```json
{
  "task": "Bounded authorized task with its pinned instructions and scoped input",
  "taskName": "travel_task_42",
  "label": "Complete the requested form",
  "runtime": "subagent",
  "context": "isolated",
  "mode": "run",
  "cleanup": "keep",
  "expectsCompletionMessage": false,
  "runTimeoutSeconds": 1200
}
```

Omit `agentId` for the coordinator's own persona; cross-persona dispatch may set a configured target only when native `subagents.allowAgents` permits it. Non-thread hidden children are isolated by default; explicit `context` avoids accidental forks. `mode:session` requires thread binding and is inappropriate for this hidden portal flow. The native tool returns an accepted receipt containing `runId` and `childSessionKey`; later terminal/delivery state belongs to the native task ledger. A task name is a scoped alias, not a session key.

`expectsCompletionMessage:false` selects native quiet completion: no automatic announce/steer turn commandeers the coordinator, while native task result/history remains available. Portal ingestion must observe native task/result events and persist an attributed task card without inventing a second execution loop. If this result observation cannot be proved complete, keep the UI explicit that result synchronization is unverified. Sources: [session tools](https://docs.openclaw.ai/concepts/session-tool), installed `src/agents/tools/sessions-spawn-tool.ts`.

For a Cloudflare occurrence, submit a bounded ordinary coordinator turn carrying the authorized routine and causal occurrence reference, then have that native coordinator invoke the tool through its normal policy. Record its actual accepted receipt; do not assume a model complied merely because the coordinator turn completed. This dispatch itself uses interactive-lane capacity briefly and its receipt correlation across crash is **unverified**. Report a failed/missing/ambiguous spawn receipt; do not automatically launch another child.

`POST /tools/invoke` is not a shortcut: `sessions_spawn` and `sessions_send` are on its default deny list; shared-token HTTP invocation also has broader operator semantics. Its `dryRun` flag is ignored. Do not remove that deny entry or broaden native tool policy merely to automate scheduling. No public supported policy-preserving direct-spawn RPC was demonstrated in this investigation. [Tools invoke API](https://docs.openclaw.ai/gateway/tools-invoke-http-api)

## Status, continuations and exact cancellation

Owner clarification (2026-09-13): the conversational coordinator must distinguish intentional active-task steering from independent work, status and deferred follow-ups. The Puck/Codex voice analogy specifies the interaction, not an alternative runtime. Native steering is desirable for a resolved target; indiscriminate steering of every inbound message is not. The after-settlement fallback below remains a compatibility limitation and does not satisfy the expanded O03 acceptance criterion.

- Read native `tasks.list` / `tasks.get` and session status first; no inference is necessary to display recorded state. `tasks.get` takes `{ "taskId": "returned-native-task-id" }`.
- `sessions_send` accepts `sessionKey`/`label`/`agentId`, `message`, `timeoutSeconds`, and optional `watch`. **There is no non-steering mode parameter.** A successful result can say `targetDisposition:steered`; `timeoutSeconds:0` means return immediately, not “never inject.” Therefore do not use it for unqualified owner follow-ups to a running task.
- `chat.send` exposes `queueMode:followup`, which queues after the current turn instead of steering. Exact child session routing and subsequent background-lane attribution must be verified before exposing it as a safe active-task continuation. Until then, retain the targeted follow-up as pending metadata and dispatch only after native settlement/checkpoint evidence; disclose the pending state. Never mutate the child transcript directly.
- A coordinator awaiting ordinary announcing children can use native `sessions_yield`, which ends its current turn. Quiet children do not announce, so do not wait for an announcement that was disabled. No synchronous waiting parent should hold the only lane needed by its child.
- Native `subagents` action `cancel` targets a returned `taskId` within the caller's controlled tree. Operator RPC `tasks.cancel` accepts `{ "taskId": "...", "reason": "Owner requested cancellation" }`; its `found`/`cancelled` response is not complete external-effect settlement proof.
- Exact root RPC `chat.abort` accepts `sessionKey`, `agentId`, and `runId`. Always include the target run. Omitting it can cancel all active work in that session. Never use `all` or persona switching as a cancellation target.

Sources: [tasks](https://docs.openclaw.ai/automation/tasks), [session tools](https://docs.openclaw.ai/concepts/session-tool), installed Gateway schema declarations for `ChatSendParamsSchema`, `ChatAbortParamsSchema`, `TasksGetParamsSchema`, `TasksCancelParamsSchema`.

## OAuth refresh ownership

Installed `src/agents/auth-profiles/oauth.ts` uses a `KeyedAsyncQueue` keyed by provider plus profile ID and a global refresh file lock. Inside the lock it rereads the owning store, reuses fresh credentials if another actor already refreshed, and writes back to the real shared/agent owner. Refresh contention has its own error. This is evidence for using native managed refresh, not wrapping entire model turns in an application OAuth mutex or duplicating caches.

This source inspection does not prove the selected Codex harness's two-turn refresh race: O09 still requires a controlled live test with the actual shared OAuth profile. No credentials or refresh endpoint were accessed. [OAuth ownership](https://docs.openclaw.ai/concepts/oauth)

## Acceptance status

| Requirement | Evidence now | Remaining live gate |
| --- | --- | --- |
| O01 | Real quiet child remains held while main coordinator completes, tested with scripted loopback provider in two orbs | Intelligent owner question routing and latency under real browser work |
| O02 | Native isolated spawn and task ledger exist | Second independent task remains separate under tool/resource waits |
| O03 | Real `followup` executes after settlement, `interrupt` aborts/replaces exact root, `steer` injects at tool/model boundary; two orbs | Model intent/target resolution and portal-to-child delivery integration |
| O04 | Real exact quiet-child abort settles without affecting coordinator; application sibling/lock tests pass | Arbitrary tool/child tree cancellation and external-effect settlement |
| O05 | No universal cross-bot connector lock proved | Browser/account/entity-specific lock and effect checks |
| O06 | Actual main=1/subagent=1 overlap observed with held quiet child and completing coordinator | Broader fairness, parent yield and no extra-lane escape |
| O07 | Native task/session identities exist | Crash/replay mapping and missing-spawn-receipt reconciliation |
| O08 | Native activity surfaces exist | Complete tool/child/flush coverage feeding Sprite activity hold |
| O09 | Native keyed refresh queue/file lock proved by source | Actual shared-profile refresh race and no paid fallback |

`tests/native-orchestration-contracts.test.mjs` checks installed source field compatibility and required native behaviors/guards as static evidence. It starts no runtime and makes no model calls. These checks are deliberately not labelled live behavior tests. **O01–O09 remain unverified end to end.**

`scripts/test-native-agent.mjs` adds 16 direct native execution assertions with 12 scripted loopback model calls, reproduced in two orbs. It is not intelligent model acceptance. Steer does not abort an in-flight model response; it applies at the next tool/model boundary. A queued follow-up acknowledgment ID is not necessarily the eventual execution ID: tests correlate native events and persisted unique output rather than treating `agent.wait(ackId)` as proof of failure. `scripts/test-native-bridge.mjs` separately proves bounded portal-to-native tool/reply persistence, not generic orchestration integration. See [orb evidence](ORB_TESTING.md).

## Application adapter evidence

`tests/orchestration.test.ts` verifies synthetic native-receipt metadata, coordinator availability, target-only follow-ups/cancel, cancellation timeout isolation, atomic resource locks, metadata reconstruction and sleep blocking. These checks do not prove the native event producer or model decisions. `NativeTaskLedger` accepts only current-epoch parent receipts and an explicitly allowed persona target; cross-persona delegation remains closed by default in Worker configuration. Native allowAgents configuration and the application target map must agree before CoS delegation is enabled. Scoped locks provide exclusion, not tool authority.

The portal stores follow-ups until terminal native settlement, then queues a coordinator request naming the same logical task. It does not inject into active child input. Automatic retries of background executions are disabled; use an explicitly targeted follow-up after settlement. Installation lease loss is a global ownership failure; a single task's ignored cancel request is not.

## Upstream-only upgrade boundary

The owner reaffirmed on 2026-09-13 that Clawbot is scaffolding around OpenClaw, not a fork. Use native configuration, documented RPCs and supported plugin extension points. Keep application metadata, provider lifecycle and portal contracts in this repository. Do not patch the installed package, import hashed bundle modules into the adapter, or edit native storage. The current source-contract tests inspect bundle text only as version-specific evidence; bundle reshuffling can break those tests without breaking an API.

For an upgrade, install the exact candidate separately with disposable state, inspect official migration/API changes, then run schema checks, real transport health and the behavioral adapter/O01–O09 gates that the deployed feature depends on. A version mismatch must block promotion, not trigger a blind pin update or substring-test rewrite. Pin the tested package/image and adapter together. Preserve the previous image and coordinated backup; native data migration and rollback compatibility must be checked before touching persistent state. If a required behavior has no supported extension point, record the gap and prefer an upstream request; a core patch is an explicit exception, not the default workaround. This reduces upgrade coupling but cannot guarantee upstream never changes its APIs.
