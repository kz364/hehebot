# Native user questions: root-only, mode-gated, and not an approval channel

`node scripts/test-codex-questions.mjs` runs pristine **Codex app-server0.154.0** against synthetic loopback Responses API fixtures. It uses disposable HOME/CODEX_HOME directories, `approvalPolicy:'untrusted'`, `sandbox:'read-only'`, `code_mode=false`, and no accounts, OAuth caches, paid inference, external model provider or shell effects. The fixture answers only its own exact observed question identities. Unknown server methods, tools and approvals retain the transport's default denial path. This script does not enable production question handling or authorize any action.

## Advertised does not mean callable

The fixture generates both ordinary and `--experimental` JSON schemas from the installed binary and observes actual model tool schemas and execution. Both generated bundles advertise `item/tool/requestUserInput`; the ordinary `TurnStartParams` omits experimental `collaborationMode`. A real `turn/start` with explicit collaboration mode and `initialize.capabilities.experimentalApi:false` is rejected before a model request. Other runs explicitly opt into that capability.

| Configuration and subject | Actual result |
| --- | --- |
| V1, Default root, `default_mode_request_user_input=false` | Tool advertised, but invocation returns `request_user_input is unavailable in Default mode`; no question RPC. |
| V1, Plan root, feature false | Question RPC with `isBlocking:true`; exact answer map delivered in next model context. |
| V1, Default root, feature true | Question RPC with `isBlocking:false`; observed tool still awaited the explicit response and delivered it in next model context. |
| V1, direct child, feature true | Tool advertised, but invocation returns `request_user_input can only be used by the root thread`; no child question RPC. |
| V2, Default root, feature true | Root RPC and exact next-context answer delivery, `isBlocking:false`. V2 descendants are not exercised. |

`codex features list` identifies `default_mode_request_user_input` as **under development**, default false; `multi_agent` is stable/default true and `multi_agent_v2` stable/default false in this pin. Tests explicitly set V1/V2 rather than infer them. Do not enable the under-development flag in production on the strength of this fixture. `isBlocking` describes the mode, not proof of task settlement or a reason to auto-answer.

The pinned [upstream request_user_input handler](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/tools/handlers/request_user_input.rs) rejects `session_source.is_non_root_agent()` **before** checking mode; this corroborates the actual V1 rejection. It sets `is_blocking` only in Plan mode and `auto_resolution_ms=None`. The supported direction for a descendant needing user input is coordinator mediation, not forging a child question RPC or weakening that check. Such mediation, its authority and end-to-end answer routing are **not implemented or proven here**. The V2 root result does not demonstrate a V2 child bypass.

## Exact request/answer shapes and three distinct identities

The model function is `request_user_input`, with `{questions:[{id,header,question,options:[{label,description}]}]}`. The advertised schema requires those keys and disallows extras. Its descriptions prefer one question, at most three, headers up to12 characters and 2–3 options; these descriptions are not a substitute for host-side bounds. The fixture uses two asymmetric questions and two options each. Native normalization sets `isOther:true` and `isSecret:false` in the observed server requests, permitting a synthetic free-form second answer without a model-supplied Other option.

Server request, with illustrative placeholders:

```json
{
  "id": 0,
  "method": "item/tool/requestUserInput",
  "params": {
    "threadId": "native-thread",
    "turnId": "native-turn",
    "itemId": "original-model-call-id",
    "questions": [
      {"id":"route_id","header":"Route","question":"Synthetic choice?","isOther":true,"isSecret":false,"options":[{"label":"North17","description":"First"},{"label":"South83","description":"Second"}]}
    ],
    "isBlocking": true,
    "autoResolutionMs": null
  }
}
```

Client response uses **the same server RPC `id`**, not the question ID or item ID:

```json
{"id":0,"result":{"answers":{"route_id":{"answers":["North17"]}}}}
```

Generated `ToolRequestUserInputParams` requires `threadId,turnId,itemId,questions,isBlocking`. `autoResolutionMs` is optional/deprecated. Generated question records require `id,header,question`; `options` can be absent/null at that protocol layer, unlike the advertised model function schema. Generated `ToolRequestUserInputResponse` requires an `answers` object mapping question IDs to `{answers:string[]}`. The tested host transport additionally validates unique question IDs and the exact response key set. Do not conflate model tool schema, server protocol schema and host authorization policy.

`itemId` matched the original model `function_call.call_id`; the next model request contained a `function_call_output` under that same `call_id`, with its `output` JSON equal to the entire answer map. The proof checks this while the original native turn is still active, **not merely after writing a response**. It correlates a real V1 spawn receipt and `thread/read.source.subAgent.thread_spawn.parent_thread_id` before recording the child-only rejection. A simultaneously held unrelated root receives no extra model request or answer and remains on its original native turn. The child context receives no root answer.

## `serverRequest/resolved` is not answer acceptance

Observed notification:

```json
{"method":"serverRequest/resolved","params":{"threadId":"native-thread","requestId":0}}
```

Its params contain **exactly `threadId` and `requestId`**. Generated `ServerRequestResolvedNotification` requires both; request IDs may be strings or int64 integers. There is no turn ID, item ID, question ID, answer, success flag or cancellation reason. The host must join its original question record using the connection/generation plus request identity; ID0 was reused across independent app-server processes.

- Plan/V1 Default/V2 Default answered roots emitted `resolved` after the response write. Separately, the proof observed the exact answer map in the next model context. The event alone did not establish that delivery.
- **Interruption counterexample:** question → `turn/interrupt` → `turn/completed(status:'interrupted')` → `serverRequest/resolved`, before any answer. The final transport aborts that exact callback with `signal.reason={code:'CODEX_USER_INPUT_RESOLVED'}`. The fixture deliberately resolves the callback afterward and verifies **no late RPC write** and no new model request for the interrupted turn. The unrelated held root and connection remain usable. Resolution therefore can mean cancellation **without any answer**.
- Earlier dependency evidence (SHA256 `277b88ea02dfccdfdda3b53435d46a1359a48695cce17de4dc431518398e597f`) did write an intentionally late answer after interruption/resolution; no further model request for that interrupted turn was observed. That counterexample motivated the final dependency correction. It is not the final transport behavior and does not establish durable discard, restart recovery or authorization to retry.
- Closing while another question was pending produced **no observed resolved notification**, aborted the actual host callback signal, and suppressed a deliberately late callback result. No answer context was observed. Missing notification after disconnect proves neither unresolved server state nor successful cancellation: outcome remains unknown outside the local evidence.

The final transport matches both the original request ID (including its type) and thread ID before aborting a pending question on `serverRequest/resolved`. It still emits the notification and does not settle application work. The future owner-response ledger must preserve this distinction and fence stale/cancelled questions. Distinguish local response written, native request resolved, and separately observed context delivery—not a single success receipt. This document defines no new ledger or retry mechanism.

## Host boundary, evidence and limits

`CodexTransport` and `spawnCodex` accept an optional `userInputTimeoutMs` (integer 1–900000). It bounds only owner-question callbacks; ordinary RPCs and dynamic tool calls retain `timeoutMs`. Omission preserves the existing shared timeout. Expiry still closes the transport as an unknown outcome, aborts the callback, and suppresses late answers; a longer answer window does not extend application custody or lease authority. The independent-deadline tests pass with a 5ms RPC deadline and a 100ms question deadline. The native proof was rerun after this additive change: all 16 checkpoints passed with 15 model requests, 5 question RPCs, unchanged pinned binary and cleanup confirmed.

The proof uses the parent-transferred `CodexTransport` **`onUserInput(params,{signal,requestId})` callback**. Its subclass only records traffic; it does not override request handling or manually emit answers. The fixture callback validates its exact known root, observed current turn, original item/call ID, original server RPC ID, question IDs/content and normalized flags before resolving synthetic answers. The transport owns the RPC ID, answer validation and bounds. Original delivery's tested dependency SHA256 (before the separate timeout addition above):

```text
d78bd2fcd33a1e24f91f503a53065c2643fb89ccc62433a4b9622ce459e96b7e
```

The dependency was copied locally only for verification; it is **not part of this two-file delivery**. The original dependency was preserved separately. A future changed dependency requires rerunning the proof; each report hashes it before/after. Binary path is the existing pinned Linux-x64 `.local/codex-runtime/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex`; required binary SHA256:

```text
3188814c35471432d4123203e0eb38e5bddc60226e3d7ddf0e59e649ea140022
```

Run `node --check scripts/test-codex-questions.mjs` and `node scripts/test-codex-questions.mjs`. The final executed fixture passed **16 named checkpoints**, **5 native question RPCs**, and **15 scripted model requests**, with zero unexpected server requests/approvals, unchanged binary/dependency, all native processes and held connections closed, and disposable homes removed. Child completion can cause an additional root model request; the report records actual counts rather than assuming one deterministic total. Exact maps, identities, blocking flags and no-progress-before-answer checks supplement the named checkpoints.

Each run prints only the sanitized report and keeps exact responses/notifications/question data in private `.local/questions-proof-*` evidence (0700 directory, 0600 trace/report). Generated protocol schemas are also retained there. Trace is capped at16 MiB, model requests at28 with bodies at2 MiB, question callbacks at10, transport requests/callbacks at10 seconds, individual waits at12 seconds and the native-process watchdog at90 seconds. Private evidence is not archived or published; the archive contains only this document and the script. No dependencies are installed by the probe.

This is protocol behavior and host-callback evidence, not UI acceptance, real-model comprehension, owner authorization, durable response custody, delivery acknowledgment, full task/family settlement or recovery proof. Parent integration must separately bind owner commands and run/attempt/epoch/boot identity, preserve question/answer privacy (including secret questions), apply bounds, cancel stale requests, render an accessible pending-question UI, and avoid treating answers as tool grants. No service, Worker, schema, production gate, account, deployment or permission policy is modified.
