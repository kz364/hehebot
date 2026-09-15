# Native question custody

`src/core/native-questions.ts` stores bounded native question obligations in existing `runtime_metadata`, under `native-question:<UUID>`. It does not implement approvals, inference, wake, cancellation, task settlement, transport, owner authentication, or UI. No schema change is required.

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
nextExpiry(): string | null
prune(): number
```

`NativeQuestionInput` is `{id,connection_id,request_id,params:{threadId,turnId,itemId,isBlocking,questions,autoResolutionMs?}}`. `NativeQuestion` is `{id,header,question,isOther?,isSecret?,options?:{label,description}[]|null}`. `NativeQuestionAnswers` is `Record<string,{answers:string[]}>`. `NativeQuestionAnswerCommand` is `{question_id,expected_revision,answers}`. Unknown object fields are rejected.

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

Record and answer require `LifecycleCore.authorizeAttempt`, the current original attempt, coordinator without a parent, running/finishing state, no OWNER_CANCELLED/CONTEXT_INVALIDATED error, exact attempt native_run_ref matching turnId, and future canonical attempt deadline. Scope comes from captured context.persona.id and context.room_id (fallback run.persona_id), not native text. Expiry is min(created_at + 15 minutes, original attempt deadline); the exact expiry instant is closed. The injected clock must be canonical UTC milliseconds and consistent with the lifecycle clock.

Trusted runtime **must independently bind threadId to its native journal**. The application attempt row independently checks only native turn identity, not native thread identity. This ledger does not invent a task-owner ACL; authenticated owner ingress and owner-matching accepted command receipts are the authority boundary. Parent ControlCore.accept owns receipt replay/dedupe. Model/imported question text grants no authority.

Exact normalized repeated record is no-write while original admission remains live. Changed input/custody conflicts. A connection/request-ID type-and-value or connection/thread/turn/item tuple cannot receive another question UUID.

States are pending → answered → response_unknown → resolved, with resolution also allowed directly from pending or answered. Every transition increments revision. `takeAnswer` commits response_unknown and response_taken_at **before** returning data; reconstruction/lost acknowledgment cannot replay it. Pending, response_unknown and resolved return null after original identity/connection fencing; null is not a delivery receipt. Callers must not wrap takeAnswer in an outer transaction that could roll back after sending a native response.

Resolution requires the original connection and fenced original attempt/lease/native turn, but may close expired or cancelled obligations. It preserves answers and response_taken_at and is idempotent. Native request resolution is neither answer acceptance nor model consumption; resolved-before-take retains a null response_taken_at. Old-epoch reconciliation is intentionally unavailable here.

`list()` returns unresolved records sorted by created_at then UUID, including stale/expired obligations. It derives answerable using the same live checks as answer, plus pending state. It catches authority failures only; corrupt metadata and unexpected errors propagate. Reads do not repair or write. All writes are transactional metadata upserts; no runs, attempts, effects, locks, lifecycle, events or other objects change.

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
inference, wake, lock release or effect settlement. Old-epoch reconciliation is
still unavailable; these obligations deliberately remain blockers.

The portal attributes questions to their bot and originating conversation, uses
literal text, requires an explicit option/written answer/skip, and submits only
the selected question revision. Hidden and collapsed bots retain question counts.
Saved answers distinguish pending delivery from unknown handoff and offer no
resend action. Stale/offline observations disable new answers; an editor whose
revision changes rejects submission. Answer drafts are not saved to browser
storage. The ordinary chat composer remains separate and usable. Resolved records
leave the unresolved list without manufacturing a completed task result; a
historical question-receipt browser is not implemented.

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

Resolved question records expire 90 days after the later of native resolution and attempt settlement, only when both task and attempt are terminal and no retry, unsettled operation, uncertain effect or resource lock remains for that task. Worker alarms and missed-alarm ingress maintenance prune at most 100 rows transactionally, including while execution is disabled. Remaining eligible backlog rearms the alarm. Corrupt selected records roll back the batch; pending, answered and response_unknown records are never purged by age. Cleanup touches only these metadata rows, not command receipts, tasks, effects, locks, native journals or backups. Existing command-payload retention separately governs owner answer payloads. This is not deletion everywhere, and retained unresolved work can still exhaust capacity.

Post-epoch reconciliation and production transport assembly remain separate work; disposable runtime thread binding is documented in [CODEX_QUESTION_BINDING.md](CODEX_QUESTION_BINDING.md). Expiry only fences answers; it does not cancel a native request or settle a task. Question/answer text remains potentially sensitive despite secret-question rejection; restrict read access and do not put it in logs. Local ingress/rendering tests do not establish production authentication. This unit makes no production readiness or external executor shutdown claim.
