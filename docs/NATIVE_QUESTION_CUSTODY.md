# Native question custody

`src/core/native-questions.ts` stores bounded native question obligations in existing `runtime_metadata`, under `native-question:<UUID>`. Its deadline maintenance can request ordinary run cancellation; it does not implement native cancellation, approvals, inference, wake, task settlement, transport or owner authentication. No database schema change is required.

## Public TypeScript contract

Exports: `NativeQuestionLedger`, `NATIVE_QUESTION_PREFIX`, `NativeQuestion`, `NativeQuestionInput`, `NativeQuestionAnswers`, `NativeQuestionAnswerCommand`, `NativeQuestionRecord`, `NativeQuestionView`.

```ts
new NativeQuestionLedger(store, lifecycle, now: () => string)
record(identity: Identity, runId: string, attempt: number, input: NativeQuestionInput): string
get(id: string): NativeQuestionRecord
list(): NativeQuestionView[]
answer(owner: string, commandId: string, input: NativeQuestionAnswerCommand): string
takeAnswer(identity: Identity, id: string, connectionId: string): { answers: NativeQuestionAnswers } | null
resolve(identity: Identity, id: string, connectionId: string): void
closeStopped(owner: string, commandId: string, input: NativeQuestionCloseCommand): string
nextCallbackDeadline(): string | null
expireCallbacks(): void
nextExpiry(): string | null
prune(): number
```

`NativeQuestionInput` is `{id,connection_id,request_id,callback_deadline_at?,params:{threadId,turnId,itemId,isBlocking,questions,autoResolutionMs?}}`. `NativeQuestion` is `{id,header,question,isOther?,isSecret?,options?:{label,description}[]|null}`. `NativeQuestionAnswers` is `Record<string,{answers:string[]}>`. `NativeQuestionAnswerCommand` is `{question_id,expected_revision,answers}`. Unknown object fields are rejected.

`NativeQuestionRecord` extends normalized input with `version:1`, `revision`, `state`, `run_id`, `attempt`, `epoch`, `boot_id`, `persona_id`, `conversation_id`, `created_at`, `expires_at`, and nullable `answers`, `answer_owner_id`, `answer_command_id`, `answered_at`, `response_taken_at`, `resolved_at`. `NativeQuestionView` adds `answerable:boolean`; it is not stored. Missing flags normalize to false, options and autoResolutionMs to null. No text trimming or native-ID rewriting occurs.

## Validation bounds

- Record/connection IDs and persisted application identities: canonical lowercase UUID, versions 1–8, RFC variant. Attempt positive safe integer; epoch nonnegative safe integer.
- Request ID: safe integer or nonempty string up to 128 Unicode codepoints. Numeric and string IDs remain distinct. Native thread/turn/item IDs: 1–256 codepoints.
- Questions: 1–3, unique IDs of 1–128 codepoints; header 1–80; question 1–2000.
- Options: absent/null or 0–3 entries; label 1–200; description 1–1000 codepoints. `isSecret:true` is unsupported and never persisted. `isOther` and `isSecret` must be booleans if present. autoResolutionMs is null or nonnegative safe integer; it does not control ledger expiry.
- Both raw and normalized input: at most 65,536 UTF-8 bytes. Unpaired surrogates are rejected.
- Answers cover exactly the original question IDs, each with 0–1 string of 0–2000 codepoints. Empty array is explicit skip, not permission. With nonempty options and isOther=false, a nonempty answer must equal an offered label. An empty string is permitted by this data contract.
- Owner identifier: 1–256 codepoints; command ID UUID. Accepted/applied receipt must match owner, `question.answer` type, question ID, revision and normalized answers.
- At most 64 unresolved and 4096 total retained records. No eviction. Stored records are bounded to 128 KiB each and validated on reads; corruption fails closed with `NATIVE_QUESTION_CORRUPT`, not silent repair.

## Fencing and uncertainty

Record and answer require `LifecycleCore.authorizeAttempt`, the current original attempt, coordinator without a parent, running/finishing state, no OWNER_CANCELLED/CONTEXT_INVALIDATED error, exact attempt native_run_ref matching turnId, and future canonical attempt deadline. Scope comes from captured context.persona.id and context.room_id (fallback run.persona_id), not native text. Expiry is min(created_at + 15 minutes, original attempt deadline, callback_deadline_at when present); the exact expiry instant is closed. The injected clock must be canonical UTC milliseconds and consistent with the lifecycle clock.

`callback_deadline_at` is canonical UTC millisecond metadata computed by the host,
outside native `params`. The service binding records its frozen five-minute,
attempt-clamped callback deadline in both private journal and Worker input.
Delayed recording cannot restart that window. The declaration survives reload;
changing it on replay conflicts. Fresh expired declarations reject, and stored
expiry beyond the declaration is corruption. Host/Worker clocks must agree;
this is an upper bound on answerability, not a promise that a connection remains
available until then. Cancellation or an earlier callback failure can stop it.

Legacy inputs and records without the field retain their shape and prior cap.
No database migration is needed; `SCHEMAS/runtime.json` and its generated validator
accept the optional field. Update the tested Worker/runtime pair together: an old
Worker rejects the new metadata, and the runtime does not strip it and retry.
This does not introduce parked waits, suppress sibling watchdogs, settle custody
or authorize resume.

The watchdog now atomically records optional `restart_required_at` when an explicit
callback deadline expires while the question is still pending or answered, before
handoff or recorded native resolution. It matches the lifecycle epoch/boot,
current run attempt and native turn; old/terminated attempts and legacy records
without a declaration do not qualify. This is a Worker deadline policy, not an
observation that the native callback timed out. `response_unknown` is excluded:
a committed handoff can represent either successful delivery or a lost response.

The marker increments question revision once and survives reload, native resolution
and stopped closure. A running/finishing run enters ordinary cancellation with
`NATIVE_QUESTION_RESTART_REQUIRED`; existing cancellation/recovery keeps its reason
and original grace start. At 30 seconds unconfirmed cancellation follows the existing
recovery/effect-uncertainty path. No operation, lock, answer or effect is settled by
the marker. Later authorized resolution cannot undo cancellation; termination
and explicit owner recovery remain separate. The question card explains this
distinction and offers no resend/restart action.

`nextCallbackDeadline()` schedules only actionable, unmarked current questions;
it is separate from `nextExpiry()`'s terminal-record retention. Worker alarms and
missed-alarm ingress maintenance apply the policy, without inventing an exact-time
delivery guarantee during outages. The saved marker time is the observed Worker
maintenance time, not a claimed host timeout time. Post-handoff and never-recorded
callback failures still require separate recovery evidence.

Trusted runtime **must independently bind threadId to its native journal**. The application attempt row independently checks only native turn identity, not native thread identity. This ledger does not invent a task-owner ACL; authenticated owner ingress and owner-matching accepted command receipts are the authority boundary. Parent ControlCore.accept owns receipt replay/dedupe. Model/imported question text grants no authority.

Exact normalized repeated record is no-write while original admission remains live. Changed input/custody conflicts. A connection/request-ID type-and-value or connection/thread/turn/item tuple cannot receive another question UUID.

States are pending → answered → response_unknown → resolved, with resolution also allowed directly from pending or answered. Every transition increments revision. `takeAnswer` commits response_unknown and response_taken_at **before** returning data; reconstruction/lost acknowledgment cannot replay it. Pending, response_unknown and resolved return null after original identity/connection fencing; null is not a delivery receipt. Callers must not wrap takeAnswer in an outer transaction that could roll back after sending a native response.

Resolution requires the original connection and fenced original attempt/lease/native turn, but may close expired or cancelled obligations. It preserves answers and response_taken_at and is idempotent. Native request resolution is neither answer acceptance nor model consumption; resolved-before-take retains a null response_taken_at. Native resolution cannot be manufactured under a new epoch.

Owner `question.close` is a distinct, explicit stopped-executor custody decision.
Its exact payload is `{question_id,expected_revision,confirm_stopped_closure:true}`;
`NativeQuestionCloseCommand` exports this type. It requires an accepted matching
owner command and the original attempt's `terminated` status, matching epoch,
boot and native turn, and a recorded termination timestamp at or after the last
question transition and no later than the current clock. Only trusted provider
stop observation establishes that status; idle, expiry, disconnect, root
completion and owner assertion are insufficient. The selected provider's actual
termination proof remains a separate production gate.

Closure creates a version-2 `closed` record with `closed_at`, `close_owner_id` and
`close_command_id`, incrementing the revision once. Version-1 records remain
readable without migration. Original answers and handoff timestamps remain exact;
`resolved_at` stays null. Closure records neither native resolution nor delivery,
consumption or success. It cannot replay an answer or reopen a request. It may
close a historical terminated attempt after an epoch change without modifying
current work. Effects, operations, locks, tasks, native journals and lifecycle
remain unchanged. The owner must separately reconcile effects and close recovery
or request an eligible retry. There is no model/tool closure surface.

`list()` returns unresolved records sorted by created_at then UUID, including stale/expired obligations; resolved and explicitly closed records are excluded. It derives answerable using the same live checks as answer, plus pending state, and `closeable` from original confirmed termination. It catches authority failures only; corrupt metadata and unexpected errors propagate. Reads do not repair or write. Record/answer/take/resolve/closure writes change only question metadata. Separately, watchdog `expireCallbacks()` atomically records the cutoff and requests run cancellation as described above.

## Local owner and Worker integration

Owner `question.answer` enters the existing authenticated `/v1/commands` boundary
with the exact payload and idempotency key. Generated contracts and the model
command boundary reject answering through `agent-command`. The state response
includes unresolved question views, independent of the latest 100 task rows.

Runtime-only, execution-gated endpoints are:

- `question-record`: `{identity,run_id,attempt,question}` → `{id}`.
- `question-take`: `{identity,question_id,connection_id}` → `{state,answer}`.
  `answer` is null or `{answers:<exact map>}`. The Worker commits the transaction
  before returning the RPC response; no native send occurs inside that transaction.
- `question-resolve`: the same custody fields → `{ok:true}`.

An unresolved question blocks its run's new completion receipt and blocks runtime
sleep, including after expiry or loss of current authority. Unrelated task
completion remains independent. Resolution does not produce a result, event,
inference, wake, lock release or effect settlement. Automatic retry, owner retry
and recovery closure also reject unresolved question custody. A retained due
retry with an unresolved question parks in recovery without requesting a wake.
Explicit stopped closure removes only the selected question blocker; it does not
itself enqueue anything or authorize sleep.

The portal attributes questions to their bot and originating conversation, uses
literal text, requires an explicit option/written answer/skip, and submits only
the selected question revision. Hidden and collapsed bots retain question counts.
Saved answers distinguish pending delivery from unknown handoff and offer no
resend action. Stale/offline observations disable new answers; an editor whose
revision changes rejects submission. Answer drafts are not saved to browser
storage. The ordinary chat composer remains separate and usable. Resolved records
leave the unresolved list without manufacturing a completed task result; a
historical question-receipt browser is not implemented.

Confirmed stopped questions offer a separate "Close stopped question" control
with mandatory consent and revision/offline checks. Recovery cards disclose the
remaining question count and keep recovery closure disabled until those records
are resolved or explicitly closed. The ordinary composer stays independent.

`node scripts/test-control-questions.mjs` exercises the actual disposable HTTPS
Worker/SQLite endpoints, CSRF, receipt replay/conflict, connection fencing and
completion guards with synthetic native identities. `node
scripts/test-portal-questions.mjs` exercises Chromium with synthetic HTTP state,
including exact answer/skip mapping, stale edits, hidden attention and narrow
layout. Neither fixture proves authenticated production access or native answer
consumption. The existing production service still installs no question callback.

## Verification and remaining integration

Run on Node with node:sqlite:

```sh
HEHEBOT_NATIVE_QUESTION_TEST_SCHEMA=/absolute/path/to/schema9.sql npx vitest run tests/native-questions.test.ts
npm run typecheck
```

Without the environment override the test uses DB/schema.sql. Tests use disposable in-memory schema9 SQLite, actual Store/LifecycleCore transactions and synthetic data, including unknown effects and locks. They cover request-ID types, two tasks/owners, receipt mismatch, uncertainty/reopen, resolution ordering, authority/expiry fences, Unicode/input bounds, corruption, capacity and failed-write rollback.

Resolved or explicitly closed question records expire 90 days after the later of resolution/closure and attempt settlement, only when the task is terminal, the attempt is terminal or confirmed terminated, and no retry, unsettled operation, uncertain effect or resource lock remains for that task. Worker alarms and missed-alarm ingress maintenance prune at most 100 rows transactionally, including while execution is disabled. Remaining eligible backlog rearms the alarm. Corrupt selected records roll back the batch; pending, answered and response_unknown records are never purged by age. Cleanup touches only these metadata rows, not command receipts, tasks, effects, locks, native journals or backups. Existing command-payload retention separately governs owner answer payloads. This is not deletion everywhere, and retained unresolved work can still exhaust capacity.

Production recovery/transport assembly remain separate work; disposable runtime thread binding is documented in [CODEX_QUESTION_BINDING.md](CODEX_QUESTION_BINDING.md). Expiry only fences answers; it does not cancel a native request or settle a task. Question/answer text remains potentially sensitive despite secret-question rejection; restrict read access and do not put it in logs. Local ingress/rendering tests do not establish production authentication. This unit makes no production readiness or external executor shutdown claim.
