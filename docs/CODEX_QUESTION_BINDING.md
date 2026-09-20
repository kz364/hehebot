# Opt-in native question binding

`runtime/codex-questions.mjs` exports `CodexQuestionBinding`. It connects an explicitly admitted root question to the application custody ledger. It installs no production callbacks, changes no gates, enables no Codex modes, and grants no tools or approvals.

## API and assembly contract

```js
const binding = new CodexQuestionBinding({
  journal,                         // existing FileJournal, private persistent directory
  control,                         // ControlClient.request(type,payload), no retries
  resolveBinding,                  // async ({threadId,turnId}) => binding below or null
  pollMs: 1000,                    // integer 10..5000
  timeoutMs: 30000,                // integer 1..900000, entire active callback
  controlTimeoutMs: 15000,         // integer 1..60000, each dependency await
  maxRequests: 64,                 // integer 1..64, lifetime per connection
});
// binding.connectionId: fresh immutable random UUID; never caller-selected/reused.
// binding.onUserInput(params,{signal,requestId}): Promise<{answers:map}>
// binding.onNotification(message): Promise<void>
// binding.close(): void
```

The scoped resolver returns exactly:

```js
{
  identity: { epoch, boot_id },
  run_id, attempt,
  attemptId,                      // adapter FileJournal key
  deadline_at                    // canonical UTC milliseconds
}
```

Epoch is a nonnegative safe integer, attempt is a positive safe integer, run/boot IDs are canonical lowercase UUIDs (versions1–8/RFC variant), attemptId matches `[a-zA-Z0-9_-]{1,128}`. Resolver values must remain identical for the active callback. The resolver must bind the exact thread AND turn to the current bridge claim and return only admitted running authority. Parent admission wiring may wait boundedly for submitted acknowledgment; submission_unknown alone is not sufficient. The module waits at most controlTimeoutMs per resolver call. It rechecks the resolver and journal before each take.

The adapter journal must independently match threadId and nativeRunId exactly, with rootSettled===false and status==='running' for record/take. Child observations do not authorize a root callback. Do not implement a resolver that searches by turn alone. Worker lease/epoch/attempt validation remains authoritative; these local checks do not replace it.

For explicit test/opt-in assembly, give `binding.onUserInput` to CodexTransport, forward its `notification` events to `binding.onNotification` with a rejection handler, and call `binding.close()` on transport disconnect/service shutdown. Arrow methods are safe to pass directly. Keep notification forwarding after callback return so a later serverRequest/resolved can be correlated. Never install the binding on a second connection. Transport's own timeout must be chosen consistently with callback/admission/control bounds. Owner routing/UI is separate.

The original unit was tested against transport v2 SHA256 `d78bd2fcd33a1e24f91f503a53065c2643fb89ccc62433a4b9622ce459e96b7e`. Parent integration also verifies the additive separate `userInputTimeoutMs` transport option. ControlClient allows `question-record`, `question-take`, and `question-resolve`.

`createCodexService` now accepts explicit boolean `ownerQuestions`, default off and still blocked outside `disposableTest`. Opt-in installs this binding before native submission, forwards resolution notifications after callback return, and closes it on recovery/disconnect/shutdown. Both binding and transport question windows are 300000ms, matching SPEC's five-minute non-checkpointed human-wait ceiling; ordinary RPCs remain 10000ms. The resolver waits at most 400 × 25ms plus journal I/O, bounded by the binding's 15000ms dependency timeout, for the exact in-flight bridge admission to become `running` after Worker acknowledgment. It checks supervisor lease and exact native identities; an unknown submission never grants answer authority. This option does not enable Codex experimental features or change production gates.

## Wire and validation

- record: `{identity,run_id,attempt,question:{id,connection_id,request_id,callback_deadline_at,params}}` → `{id}`. The host supplies the frozen attempt-clamped callback deadline, not native params.
- take: `{identity,question_id,connection_id}` → `{state,answer:{answers:map}|null}`. Only `pending/null` polls again. Only `response_unknown` plus a validated answer can return once. Known response_unknown/resolved with null stops, never fabricates an answer. Other shapes fail closed.
- resolve: same identity fields as take → `{ok:true}`.

Params/questions and answer checks mirror custody bounds: 1–3 questions; unique question IDs1–128, header1–80, question1–2000 Unicode codepoints; optional/null options, at most3, label1–200/description1–1000; boolean flags, isSecret:true unsupported. Thread/turn/item IDs1–256. requestId is safe integer or1–128 codepoints string; numeric and string identities remain distinct. Input with generated IDs must fit64KiB UTF8. Unknown object fields and unpaired surrogates are rejected. autoResolutionMs is null/absent or nonnegative safe integer; it is data, not permission to settle. Answers cover exactly original IDs (including names such as `__proto__`), each0–1 string0–2000; a nonempty constrained answer must equal an offered label unless isOther. Empty arrays are explicit skip, not approval.

## Durable uncertainty and resolution

Before record, a fresh question UUID, original custody, typed request ID, native tuple and input hash are durably journaled under `question_<SHA256([attemptId,threadId,turnId,itemId])>`. Existing rows always reject replay, even after module reconstruction with a fresh connection UUID. No existing row is repaired or reused. This deliberately sacrifices automatic retry rather than risk duplicate native answers. FileJournal requires exclusive single-executor ownership and the existing OS/provider fence; it is not a cross-process lock or authenticated storage.

Journal phases are record_unknown → waiting → take_unknown → handoff_unknown, with pending take returning to waiting. take_unknown is saved before the mutating take request; handoff_unknown is fsynced before data can leave this module. The journal stores no question text, option text, or answer text; native identifiers/custody and input hash are still private metadata. Do not log callback params or upstream errors.

New records also retain immutable `wait: {startedAt, deadlineAt}` in canonical UTC
milliseconds. Start is callback entry, including admission latency; deadline is
the earlier configured callback limit or original task deadline. Polling and
resolution do not refresh it. Once scoped admission supplies the task deadline,
the abort timer is shortened to that same effective deadline before initial
journal/control work. A held initial write or record request cannot keep the
callback pending until the longer dependency timeout. Already-started I/O may
still finish; its late result cannot trigger a take or synthesize resolution.
Offline inspection validates and exposes timing
and phase without question/connection IDs or content; old records remain readable
without invented timing. The reusable binding still permits explicit fixture
limits up to 15 minutes, but service assembly uses five. New Worker custody expiry
is capped by this same deadline through `callback_deadline_at`; recording latency
cannot restart the window. Legacy records without that optional field retain
their old cap. Update the tested runtime/Worker pair together; older Workers reject
the field and no metadata-stripping fallback is attempted. Clocks must agree,
and earlier disconnect/cancellation can still stop the callback before expiry.
Callback expiry neither resolves that custody nor proves native termination.
The Worker now records a restart-required policy cutoff for pending/answered
current-attempt questions at their declared deadline, with an owner explanation
and ordinary cancellation/grace. This is not host-observed timeout evidence;
post-handoff `response_unknown` questions are excluded. Durable checkpoint parking,
reconciled cancellation and safe compute release remain unimplemented; existing
inference deadlines may stop the callback earlier. No automatic retry or sleep
is introduced. See [custody policy](NATIVE_QUESTION_CUSTODY.md).

An owned private question row may additionally retain
`callbackTimeout: {source: 'binding' | 'transport', observedAt}`. `binding`
means the active host callback stopped after observing its frozen deadline;
the timer rechecks that deadline before stopping. `transport` means that exact
typed native request's transport timer fired. Connection failure also aborts
other requests, but those collateral aborts receive no timeout attribution.
Neither source is inferred from Worker expiry, dependency failure, disconnect,
or an already-returned answer. Existing request, connection, task and native
identity fields remain unchanged; no new binding is invented for failed admission.

The callback stops immediately. One bounded journal update is serialized behind
already-started admission or handoff work, including a handoff whose outcome is
unknown. It does not retry a failed write, change custody phase, synthesize native
resolution, or call the Worker. A crash, unowned initial record, failed or late I/O,
or a competing callback stop can leave no marker: absence does not prove absence
of timeout. A later native resolution may coexist with the historical marker.
Offline inspection validates and projects only source/time alongside the wait
clock and phase; it still refuses resume and sleep. This is partial host diagnostic
evidence, not a complete timeout inventory or a recovery executor.

Resolution is tracked separately as resolutionObserved. A matching typed requestId AND threadId aborts active answer delivery immediately and queues resolution behind the in-flight record/take operation. It can arrive before answer, during take, or after callback return. For resolution, original custody is used without requiring a still-running resolver result, future deadline, rootSettled=false, or running journal status: interruption can settle the root first. Exact journal thread/turn must still match, and Worker enforces the original lease. Successful Worker resolution saves phase resolved. Neither the notification nor this phase proves answer acceptance, RPC delivery, model consumption, or task settlement.

Unknown control/journal failures stop further API operations for that request. A later native notification may persist resolutionObserved but does not retry an unknown record/take/resolve. Duplicates never retry a failed resolve. Local stale/live-admission rejection is distinguished from unknown I/O, so terminal status alone does not suppress an otherwise valid native resolution. Disconnect and timeout are never synthesized as native resolution.

Polling exists only while the callback is active, within the earlier callback/attempt deadline. Abort clears polling/listeners promptly and suppresses late answers. Already-started ControlClient requests cannot be cancelled through its current interface: bounded dependency work may finish after callback abort, persist its known outcome, and then permit an already-observed resolution. Dependency timeout retains uncertainty; it does not prove remote cancellation. Timed-out filesystem promises likewise cannot be forcibly cancelled. Keep dependencies bounded, preserve the journal, and do not remove its directory while I/O may still be outstanding.

Retained bindings count against maxRequests even after resolution; close stops callbacks and rejects future requests. There is no journal deletion, sweep, automatic recovery, epoch reconciliation, generic answer tool, or durability claim about native databases. Rotating a connection is not permission to replay existing journal custody. Retention and recovery need separate integration.

## Executed fixture scope

`node --test tests/runtime-codex-questions.mjs` uses actual FileJournal fsync/rename operations, actual final-v2 CodexTransport over synthetic streams, and a scripted `request(type,payload)` control boundary. It covers typed IDs, unrelated roots/children, lost take outcomes/reconstruction, interruption and late resolutions, pending/unknown/null states, stale authority, journal/control faults, abort and timeout cleanup. All files are disposable private temporary fixtures, deleted by test cleanup. No native process, live model, credentials, Worker HTTP call or production installation is exercised by this unit. Parent separately owns end-to-end service/HTTP/owner integration.

`bash scripts/test-codex-service.sh --questions` exercises pristine Codex 0.154.0 → assembled binding → real local HTTPS Worker/SQLite custody → explicit owner `question.answer` → exact next native model context. Two question IDs carry asymmetric `West43` and explicit skip answers. Native resolution clears unresolved custody, while the task remains running and incomplete operation accounting still denies completion/sleep. The fixture explicitly enables the under-development Default-mode flag only in its disposable native home; it uses synthetic loopback model responses, no accounts or external effects, and synthetic Sprite transport. Service unit tests additionally exercise questions arriving before admission acknowledgment, unrelated roots, terminal-before-resolved ordering, default denial, and callback closure. This is not authenticated inference, old-epoch reconciliation, or production readiness proof.

`bash scripts/test-codex-service.sh --questions-cancel` uses the same actual assembly but sends owner `run.cancel` while the question is pending. Supervisor maintenance delivers one exact thread/turn interrupt. The native root becomes interrupted and the Worker question resolves without any answer RPC write or third model request. A later owner answer receives an HTTP 202 durable **rejected** receipt with `REVISION_CONFLICT`, not a transport-level rejection. The connection remains usable; task status stays `cancelling`, no output preview is invented, and unknown operation coverage still blocks completion and sleep. Offline inspection reports one resolved question without granting recovery. These are bounded cancellation observations, not proof of external-effect settlement or restart recovery.
