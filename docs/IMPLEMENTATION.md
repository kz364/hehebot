# Implementation status

Hehebot has demonstrated canonically completed hosted text-only replies, including a Worker-triggered staged wake, with authenticated full-reload persistence. This is not production operation or ongoing availability. Direct Codex app-server **0.154.0** is the only supported harness. Historical failed trial custody remains recovery-required. Production execution and native-verification flags remain false.

**Progress checklist:** [TODO.md](../TODO.md) is the maintained owner-facing view of completed local deliverables, remaining work, next priority and account/device blockers. This document retains detailed evidence; the specifications retain acceptance requirements.

Nested authority ID projection and NUL-key correction (2026-09-25): persona/routine
objects with exactly one unescaped string ID return only that ID; all other nested
shapes keep original JSON. Stored snapshots and independent EffectLedger checks are
unchanged. Body hydration regressions fail4; omitting nested uniqueness fails4.
After an initial passing suite, an additional SQLite probe found that -> '$.id'
matches id\\u0000 before the true id. Four grant/denial regressions reproduced this
at nested persona and top-level room keys, including an incorrect grant in the
earlier local escape-guard projection. NUL-containing decoded keys now disable
projection at both boundaries; no prior external publication is claimed.
Final focused293/backend2309/typecheck/dry-run build and real workerd pass. Workerd
now exercises >1MiB escaped memory, persona and routine bodies individually, and
both NUL-key grant/denial directions for room/persona ID. Returned context remains
<8KiB in these fixtures, source bytes unchanged, late outcomes available. Duplicate,
escaped, null and missing nested IDs retain JS behavior. Initial successful logs
are retained but superseded by the final runs after the discovered NUL-key failure.
No fixed selected-field/fallback size, SQL-work or storage bound claimed. Full
runtime/native service/browser/shutdown/desktop matrix not rerun; original
intermittent failures and production gates unchanged.
- .local/authority-id-red.log SHA256:
  `e8e1c9a0abbabda7a9300d6928e0ecdc8939cac1532589a44dd10546ca863d6c`
- .local/authority-id-mutant.log SHA256:
  `e641169c86fd0847d1e20c2356551896fb4614d579fadc269abd800e4791d811`
- .local/authority-id-nul-red.log SHA256:
  `4ba07138adf28ca7b71a338b8ef6a201fee68f87ffcd41aaaa2692cb68bf3edc`
- .local/authority-id-focused-final.log SHA256:
  `f7e614d450ba4ca6d658ce1b46151d35294d0bb7f60a732279679aff673c4483`
- .local/authority-id-integrated-final.log SHA256:
  `871915d7fcaad7615cf83eacf7d8d64aee23aeea716c2c737d524fca7f4f413d`
- .local/authority-id-workerd-final.log SHA256:
  `9dbec5a60c46c76c149dd3fa62f19ccad5686d26ac59a042e70f82eb85803c12`

Authority escape guard narrowing (2026-09-25): inspect only selected JSON fragments
for backslashes, falling back if a selected key cannot be extracted. Escapes in
discarded memory/instruction content no longer force whole-snapshot hydration.
Selected escaped values, duplicate authority keys, numeric rooms, non-objects and
raw NUL keep fallback; no authority predicate/order or source storage changed.
Two escaped-memory hydration tests fail before fix. Final focused277/backend2293/
typecheck/dry-run build and real workerd migration/authority regressions pass.
Fixtures cover >1MiB memory with escaped newline, quote, backslash and lone surrogate,
both new admission and late outcome; four escaped authority-key aliases and both
duplicate room-key orders preserve JS behavior. No fixed authority-field/fallback
size or SQL-work/storage bound claimed. Prior full runtime/native service/browser/
shutdown/desktop matrix not repeated; original intermittent failures remain open.
- .local/authority-escape-red.log SHA256:
  `b554ca1b94773a2c28370e3d942a7f147377498e9ce9b11ff5dcecf2b55e70bb`
- .local/authority-escape-focused.log SHA256:
  `d60952dc0328be1bad75dd78e1dc8da054dabafe2a4fa3ecd94b6390dfecc960`
- .local/authority-escape-workerd.log SHA256:
  `31e20a3f2ab8e18c6b71b8dc26fe979349478be166e32b8ac6af583f762d001a`
- .local/authority-escape-integrated.log SHA256:
  `27b14bafe7e3e8af250d72ec777a79622deada8f3f0749c867b94ef65adf9a55`

Guarded authority JSON projection (2026-09-25): RootChildEffects readRun returns
persona/routine/room_id/scope_key/authorization_policy_ids fragments on the safe
object path. It retains nested JSON rather than converting to SQL scalar values.
Duplicate selected keys, any backslash escape, numeric rooms, non-object roots and
raw NULs use unchanged original JSON. This conservative guard preserves last-key,
missing-field, object identity, number/coercion and parse-error behavior; stored
snapshots are never rewritten. Irrelevant fields disappear only from read results.
No fixed bound claimed for large authority fields, fallback bodies or SQLite work.
Initial oversized-body regressions fail2. Focused269/typecheck/backend2285/native
child-effects service/dry-run build pass; real workerd projection and all existing
migration/index/room regressions pass. Node fixtures cover guarded fallbacks and
object-valued rooms without duplicate top-level keys; >1MiB irrelevant-memory
fixtures return <8KiB context results, including late unknown outcomes. Workerd
fixture initially failed before reaching projection because the migration's live
coordinator correctly blocked a new claim. It now explicitly settles only that
disposable old run/attempt after earlier migration assertions; rerun passes. Failed
log retained. Full runtime/browser/shutdown/desktop matrix not repeated; original
intermittent failures and production flags unchanged.
- .local/authority-projection-red.log SHA256:
  `f47b94c29b899ec39e2d95f925061ff4a3e5255a7b70d604462d2e6303f85a64`
- .local/authority-projection-focused-final.log SHA256:
  `71844fa25a0b5549f27e05ad830d00941abbead236879cc8523842fbd9500402`
- .local/authority-projection-workerd.log SHA256 (initial fixture failure):
  `591eaa318ce4e5e54e535b98f55ebc6d95676d59f180d20b2d6f9ef0833babe6`
- .local/authority-projection-workerd-final.log SHA256:
  `31e20a3f2ab8e18c6b71b8dc26fe979349478be166e32b8ac6af583f762d001a`
- .local/authority-projection-integrated.log SHA256:
  `c57c4e63490216bba3192d156283ff9f76a6c74c3e2d7fd2edd1d4bda6d30588`

Authority representation regressions (2026-09-25, test-only): admission and late
outcomes obey last duplicate room/scope/persona keys, including nested persona ids.
Separately parsed equal-looking object/array room values refuse (JS identity);
false versus0 refuses, -0 versus0 admits, and 1e999 in both rooms admits with the
historical room/Infinity scope. Rejected operations retain effect/lock state and
duplicate-key snapshots remain unchanged. These are compatibility facts, not new
recommended snapshot shapes. Blind SQL extraction or value equality is unsafe.
Temporary JSON.stringify room comparison fails2; temporary SQLite room/scope
json_extract overlay fails2. Both mutations fully reverted (production diff empty).
Final four-file focused262/typecheck pass. Full backend/runtime/browser/native/
shutdown/desktop matrix not repeated for tests only; no new resource bound claimed.
- .local/child-authority-mutant.log SHA256:
  `f0d76ec36906ea3c2d5f4b0207c7c5eecb12bbcc6f4342a0b546a23631101782`
- .local/child-authority-first-key-mutant.log SHA256:
  `6cb3d04ee8708f9ba78c4f2494cf227aa85420a6959989dfcdd9b63e68243a22`
- .local/child-authority-final.log SHA256:
  `b6c3674569c011ede07b2dbf2a2a7e8421ce8692927be51afe00a59aa76ddcc3`

New effect ancestry admission limit (2026-09-25): previously unseen action keys
require at most64 runs including the coordinator root. After64 validated lineage
entries, before reading another parent, new keys refuse ANCESTRY_PREPARATION_LIMIT.
Existing keys continue full validation and exact identity comparison; outcomes
remain uncapped to preserve historical custody. This bounds new-key traversal only,
not arbitrary existing-key requests, per-context parsing, SQL work or storage.
Native child registration is unchanged: observed children are never dropped.
The limit is an explicit local admission policy, not an upstream Codex depth limit.
Test admits depth64, refuses depth65 without effect/lock changes or further attempt
authorization, and simulates a historical deep effect through exact task custody.
Deep intent replay, unknown/confirmed outcomes pass; another effect's key conflicts;
stale root linkage beyond the limit still rejects existing replay and transition.
Initial regression fails1; focused254 passes, followed by a test-only unknown-row
typing failure (retained). Corrected assertion then backend2270/typecheck/native
child-effects service/dry-run build pass. Full runtime/browser/shutdown/desktop
matrix not repeated; original intermittent failures and production gates unchanged.
- .local/child-depth-red.log SHA256:
  `7dee2b79ce5549e599e9ca5de8216114ccb0e1335f90400f78597da2138b5441`
- .local/child-depth-focused.log SHA256 (includes test typing failure):
  `12c1cc5dc3ff0515d303360c58d2d47c892725e9fb4de82bf71da5653995aa28`
- .local/child-depth-integrated.log SHA256:
  `19a76739ea0dfc602baa4b630ee81e6ce8298feea632d9d31b14391d11779731`

Root-child replay receipt projection (2026-09-25): intent lookup selects only the
EffectRow identity/status fields, excluding receipt_json. Two grandchild vectors
retain >1MiB UTF-8 unknown receipt evidence after deadline expiry: exact replay
returns outcome_unknown, changed request digest refuses IDEMPOTENCY_CONFLICT.
Neither loads receipt bodies or changes effects/locks. Old read fails2; focused253/
backend2269/typecheck/dry-run build pass. No context parsing, ancestry depth, SQL-work
or storage bound claimed. Full runtime/browser/native/shutdown/desktop matrix not
repeated; production gates and original intermittent failures unchanged.
- .local/child-receipt-red.log SHA256:
  `64973e380e0a83f903d40479389da2c7b6722fbc97a1aa7512ba61b3e267075f`
- .local/child-receipt-focused.log SHA256:
  `171562a14c41d390b462b5facdb4d29ab64ce9531f686bc86d912520e811cd13`
- .local/child-receipt-integrated.log SHA256:
  `157ce6b36048f63aaf0449294411d5136d99ff1b586ea6602131a139bf9b0056`

Root-child checkpoint projections (2026-09-25): admitted ancestry loads only its
eight required fields; ResourceLedger acquire loads status/current_attempt only.
No parsing, predicate, traversal or outcome transition order changed. Root/parent/
grandchild checkpoints larger than1MiB stay stored but absent from SQL results
during intent, replay and unknown-outcome recording. Initial red3; partial fix left
two failures exposing the lock-admission read. Focused251 passed after that fix;
typecheck exposed an unknown-row assertion type error, corrected without weakening
the assertion. Final backend2267/typecheck/dry-run build pass. Full runtime/browser/
native/shutdown/desktop matrix not rerun. Context parsing/ancestry depth and storage
are not bounded by this projection; late outcomes still use original JS authority.
- .local/child-checkpoint-red.log SHA256:
  `95c393510bae838ccfe07543ac9a717a6a4d99ab2c1cb0c1abbbe3c3dcc3165a`
- .local/child-checkpoint-focused.log SHA256:
  `18522ef7b2534500e9409144cd0e1c388587715c51f67cf2678c14fe7e865466`
- .local/child-checkpoint-focused-final.log SHA256 (includes assertion type error):
  `22e446e6b473a315a0669ec8e151d6a9b515fcb78d1dd8d641022d616850b58b`
- .local/child-checkpoint-integrated.log SHA256:
  `ff3331e1ac24cc54eaf46b1dab22646da7e10e496217a82d9af5706d1a141b93`

Effect intent context read boundary (2026-09-25): SQL CASE hydrates context only
at <=1048576 raw UTF-8 bytes and omits checkpoints. Missing/inactive run checks
precede overflow refusal; under-limit JS parsing, last-key grants, identity and
deadline ordering remain unchanged. Above-limit fresh and repeated intents refuse
CONTEXT_PREPARATION_LIMIT without rewriting stored evidence. Earlier RootChildEffects
parsing remains unbounded: this is a ledger hydration limit, not a whole-request or
SQL-work/storage bound. Integration confirms new lock rollback on refusal and an
existing effect's transition to outcome_unknown remains available.
Initial red4; initial focused run failed the old 1.1MB parse-reuse success fixture.
That fixture now explicitly fits below the cap; separate oversized integration
coverage asserts refusal and retained outcome custody. Final focused248/typecheck,
backend2264/native child-effects service/dry-run build pass. Full runtime/browser/
shutdown/desktop matrix not repeated; original intermittent failures stay open.
- .local/intent-context-red.log SHA256:
  `77134895180505a72ea332872b268773a284ceb7140fdd8c4d77a0a646f91b2c`
- .local/intent-context-focused.log SHA256:
  `d3f5c88b81622903fd3e01c5c729d58acce550ee1dd1888332d4052751727c48`
- .local/intent-context-focused-final.log SHA256:
  `2d84826bbae3755345c4c3db305a5a519538ad58b38d7f576aaf0d451dfe0abd`
- .local/intent-context-integrated.log SHA256:
  `903fd4bb45ffe7bc5210514c925d15d72c228a4833e62f74f1f3dd724fa2f8d1`

Effect dispatch/idempotency projections (2026-09-25): dispatch reads only run status
and current_attempt; repeated intent lookup selects its seven identity/status fields
without destination receipt. No authority predicate changed: intent still parses
full context before replay lookup, all six identity comparisons remain, deadline
blocks new dispatch while exact unknown-outcome lookup can replay after expiry.
Old reads fail3; focused313/backend2257/typecheck/dry-run build pass. Tests preserve
oversized run bodies and retained unknown receipt and distinguish identity conflict
from expiry. Full runtime/browser/native/shutdown/desktop matrix not repeated.
- .local/effect-metadata-red.log SHA256:
  `fce2b3d54186ee57dc11e36063265dbe5ee0906ffd2b27bb55b5a9cf2071cd7f`
- .local/effect-metadata-focused.log SHA256:
  `36be5bbc50c763e6bac602bc6bbcbf8fe1d4f17d658921706abe5154b6506fce`
- .local/effect-metadata-backend.log SHA256:
  `ac23b716b066447061ef5ad80fb88ba798139d6e2dc83483a8acff79ef1c162d`

Reconciliation receipt read limit (2026-09-25): SQL CASE returns receipt_json only
at <=1048576 raw UTF-8 bytes, with an overflow flag distinct from stored NULL.
After existing identity/termination/operation/digest checks, overflow refuses with
RECEIPT_PREPARATION_LIMIT and leaves evidence/outcome unchanged. No truncated JSON
or guessed replay match. At/below limit normal JS parsing, including duplicate-key
semantics, remains unchanged. Above limit even a fresh command matching a previous
owner decision refuses; exact command-key replay still returns its saved response.
Multibyte exact/one-over vectors cover unknown and confirmed effects; old behavior
fails2. Wrong digest remains earlier than overflow. Focused147/backend2254/typecheck/
dry-run build pass. No SQL inspection/total-storage bound claimed. Full runtime/
browser/native/shutdown/desktop matrix not repeated; gates unchanged.
- .local/receipt-bound-red.log SHA256:
  `dc7c21c527930b956f4baeb5254fb584caa712d1f3d6fa0769432326607c909e`
- .local/receipt-bound-focused.log SHA256:
  `4239b61815fd88ba36af51d8540132aa5c345fc5ab216684ad4dd0d3b9fd815b`
- .local/receipt-bound-backend.log SHA256:
  `1fa5b3c06a911dda1a3d6b8a08bb0064684f18c2c664aa8d5b8a985258f5d2df`

Stopped effect reconciliation projection (2026-09-25): attempt validation reads only
run id/current_attempt; audit publication reads only persona_id. Same transaction,
NOT_FOUND, termination, operation, exact digest and outcome checks remain. Three
old-read regressions fail; confirmed/failed receipts, persona event and wrong-digest
refusal pass with >1MiB historical context/checkpoint retained unchanged. Final
focused142/backend2249/typecheck/dry-run build pass. Effect receipt parsing and
other storage/scan limits are not bounded by this change. Full runtime/browser/
native/shutdown/desktop matrix not rerun. No external action or gate change.
- .local/reconcile-projection-red.log SHA256:
  `9d8645d40e6634c7fa0615143d2c10d597a0ce2a6c5822da3448c921bbe53721`
- .local/reconcile-projection-focused.log SHA256:
  `9c6a3df969808cc9e971cd3a808a050101dabbe340a68838647690188009557e`
- .local/reconcile-projection-backend.log SHA256:
  `13214b4cf1292daa72c7ddfa4f3ed7921a4980e30dc0903bbf39815eab011942`

Owner recovery metadata projection (2026-09-25): run.recover replaces Store.run's
SELECT * with id/current_attempt/status/error_code/occurrence_id/persona_id. Existing
NOT_FOUND and subsequent attempt/termination/question/operation/effect/descendant
checks are unchanged. Resource release and follow-up flushing remain transactional.
Three old-read regressions fail on returned context/checkpoint fields, including
success and live-attempt/unknown-effect refusals. Multibyte >1MiB context and >1MiB
checkpoint remain byte-identical; lifecycle state remains unchanged. Final139
focused/backend2246/typecheck/dry-run build pass. No total storage/metadata/SQL scan
bound claimed. Full runtime/browser/native/shutdown/desktop matrix not rerun.
- .local/owner-recovery-projection-red.log SHA256:
  `617574e1804bd350799450dc4beedcf57b411ee70fdbdf36cd75265c3ed07fa8`
- .local/owner-recovery-projection-focused.log SHA256:
  `f232df4a33a446bdd97eb264cbc8da9aa02edf9a39bff166e1f9afd432c7215d`
- .local/owner-recovery-projection-backend.log SHA256:
  `d641b8b300d2d46679a5f99d71560b50401387ee07c0ad96279fe2aa7f3a6bb4`

Settled native-child retry coverage (2026-09-25): prior tests rejected unsettled
children before reaching the explicit background-role restriction. New ordinary,
context-overflow and memory-overflow vectors settle the child, then assert exact
CAPABILITY_UNAVAILABLE rejection and idempotent replay without changing snapshots,
attempts, timers or lifecycle/wake state. Temporarily omitting only the role guard
made all3 commands applied; mutant fails3. Restored control.ts has zero diff.
Final orchestration/recovery/lifecycle136 and typecheck pass. No production change,
no native execution or disk-reopen claim. Full matrix not repeated for test-only unit.
- .local/settled-child-retry-mutant.log SHA256:
  `e08b29323f11538495e22da85de8bbc5960b669785d457ad2b5a11f62bf0b84f`
- .local/settled-child-retry-final.log SHA256:
  `728bb283d894e9fbcb7b100ef0c83226660e1f5ab0326933c4f503c5e788e58a`

Refusal provenance during recovery (2026-09-25): cancellation timeout, lease expiry
and confirmed provider stop now copy a still-known native memory refusal into exact
run/current-attempt metadata before replacing errors. SQL joins native parent and
attempt/reference identity and copies no snapshot. Cancellation targets selected
run IDs; lease expiry keeps its generation epoch/boot fence. Existing recovery error
codes, effect uncertainty and provider-stop authority checks are unchanged.
Regressions fail3 before fix; final focused120/backend2240/runtime682/native child
service/encrypted backup drill/typecheck/dry-run build pass. Tests distinguish early
watchdog from due transition, preserve source snapshots and verify timeout plus
completion cannot revive a late descendant. Already lost history is not recovered.
Browser/timed-shutdown/desktop matrix not rerun; original intermittent failures stay
unresolved. No external state or production-gate change.
Logs and SHA256:
- .local/refusal-recovery-red.log:
  `52f226d61985d73b18e6861431fb839ca40f87f6f10088334fa7f5744ccf1d23`
- .local/refusal-recovery-focused.log:
  `5236a335d2ce8134fb5e9a84087f516c7bcfc9bad5fc6c8bafa881fdbd72f750`
- .local/refusal-recovery-integrated.log:
  `7be8c4d4fef6b4837fd67865b2e26158aedb6aea23801652b2e82a3c6937b75d`

Refusal provenance at completion (2026-09-25): task.registered records cancellation
status but not reason; completion receipts contain submitted results, not prior
errors. There is no supported reconstruction from an empty memory array. Before
completion clears a still-known native MEMORY_PREPARATION_LIMIT, retain the exact
run/attempt reason in runtime_metadata. This transaction leaves historical context
and result receipt unchanged. Resource/operation/effect settlement gates run first;
failed completion writes no refusal receipt. Replay remains exact. Native registration
reads only the exact parent attempt key; another attempt's evidence is ignored.
Restore inspection counts retained evidence as NATIVE_CONTEXT_UNAVAILABLE, unions
snapshot markers to avoid double counting, and does not exempt identity mismatches.
Original regression fails1; final focused117, backend2237, runtime682, native child
service, encrypted backup drill, typecheck and dry-run build pass. Full backend ran
before the final extra lock-refusal assertions; focused117 reran afterward. Browser/
timed-shutdown/desktop matrix not repeated. Already lost provenance is not restored;
watchdog/provider-stop error overwrites still need preservation. No external actions.
Logs and SHA256:
- .local/refusal-provenance-red.log:
  `670ce2aeceb907a266d0d2ab8d15f0f0c966d2b2ebc4f4866c084e1453115351`
- .local/refusal-provenance-backend.log:
  `565fdb86e23a108a21ab7a53563e6820181a9ef0d13f7d7a4ef1b8e57f7e147e`
- .local/refusal-provenance-final.log:
  `06838a185fd93060df516e7b5f56e33a98b66f71824c0b8bb638f95737ee9ef3`

Legacy memory refusal inheritance (2026-09-25): registration now recognizes a
surviving parent MEMORY_PREPARATION_LIMIT error as evidence of unavailable context,
even without the new marker. New descendants receive the custody-only marker; the
historical parent is not rewritten. Cancelling/recovery_required regressions fail2
before the fix and prove propagation beyond descendant completion afterward.
Empty memory alone is valid and cannot classify a legacy snapshot. Already cleared
or overwritten errors remain unresolved; this is not a historical-data migration.
Focused114/backend2234/typecheck/dry-run build pass. Full runtime/browser/native/
shutdown/desktop matrix not repeated. No production gates or external state changed.
Logs and SHA256:
- .local/legacy-memory-red.log:
  `25935acd65de2ee4a2abb614c442d7b35c66402ae8f9cddae9cd61b7ef3bff13`
- .local/legacy-memory-focused.log:
  `09d90ed62f93a9e866254b47f922830807ae4d5a62d45ac893141355c7139ccd`
- .local/legacy-memory-backend.log:
  `eff925c531b91f433f3aa212a9f4f706a6d6c888dc86a0ea812b3d69bc74645d`
- .local/legacy-memory-build.log:
  `388f9f44273256542f39eb150a6b5ee45ed0975ae44b3fbf641c064e259f7435`

Delegated memory overflow follow-up (2026-09-25): a real regression demonstrated
that completing the old partial-snapshot child cleared its error and allowed a late
descendant to become running without required memory. New overflows now retain the
same custody-only shape with MEMORY_PREPARATION_LIMIT; both known reasons propagate
after error clearing. Existing revocation/deadline precedence and ordinary cloning
remain unchanged. Source memory and settled parent are preserved. Restore inspection
recognizes both exact markers as blockers, rejects unknown reasons and preserves
all forged-marker checks. Older partial snapshots are not migrated or repaired.
Verification: focused89/typecheck; backend2232/runtime682/native service --child,
encrypted backup drill and dry-run build pass. Prior browser/timed-shutdown/desktop
matrix not repeated; original catalog/alpha intermittency remains unresolved.
Logs and SHA256:
- .local/delegated-memory-red.log (original regression fails1):
  `7139d449b2557fed49ea4594bf472c32057847defcea084fc6aaeccbc253025d`
- .local/delegated-memory-focused.log:
  `b47685a07e6d9b3597e7291dbc7316d10014aa62eafd8374c5bbe661890a6e61`
- .local/delegated-memory-integrated.log:
  `5c130aec117b5e9ed5b427ce3c1b8d7d717e1edf3fbb221baf820e04e24fca30`
Local only. No provider/account calls or production-gate changes.

Native inherited-context preparation limit (2026-09-25): new native registrations
project context only when raw UTF-8 <=1048576 bytes, after existing authority and
receipt/conflict checks. Ordinary <=limit JSON.parse/spread/stringify stays exact.
Overflow retains child/run/attempt/link custody as cancelling, preserving existing
revocation/deadline precedence. Parent bytes remain unchanged; no raw SQL clone.
Focused oracle advice identified raw duplicate-key scope leakage through task
summaries and alpha reads even on cancelling children. The chosen custody-only
marker carries null context persona/room/scope and empty grants/skills/memories;
actual owner persona and ancestry stay in run metadata. Persona task/recovery
visibility remains; inherited room placement is deliberately unavailable. Marker
propagation keeps late descendant metadata cancelling after terminal results clear
the parent's error; it does not attest native stop. Removing it yields a running
descendant (mutant fails1).
Restore inspection recognizes only the exact <=4096-byte marker on a matching
native child outside executable run states, as NATIVE_CONTEXT_UNAVAILABLE, never readiness. Extra
grants/keys, duplicate keys, running/foreign-role/missing-link cases stay inconsistent.
No bound claimed for prior authorization fallback, SQL inspection or total storage.
Existing cross-persona MEMORY_PREPARATION_LIMIT placeholder is unchanged; inspect
its late-descendant behavior next rather than assuming this new marker covers it.
Verification: focused135, final backend2228/typecheck/backup drill; runtime682,
HTTP31/workerd, native service --child/--child-effects and build pass. Original
focused test API mistakes corrected before final evidence; not counted as red proof.
Logs and SHA256:
- .local/native-context-bound-integrated.log:
  `d64a9885b6947ed61552dbc0f27cfe3b20cc322f322d7eee6393ffbd6dc00b27`
- .local/native-context-bound-final.log:
  `5dc8486c71b5c60ae39b52dde4746891f790b542c9f84cacb5368fffac5e3b9a`
- .local/native-context-marker-mutant.log:
  `2bcf85bbff85581bab6fb8ef935d9def76aea383ceff807b3b5872f1cabc11d1`
- .local/native-context-restore-focused.log:
  `99cba33f43b371febba6f0a8e29cda35e508badab699317418277b86eb76f7ea`
Prior browser/timed-shutdown/desktop matrix not repeated. No external actions.

Assignment snapshot projections (2026-09-25): bootstrap/warm/background
assignNewMessage reads metadata, then reuses runHasFalsyRoom in the original
short-circuit position. Checkpoints never hydrate; unambiguous context returns
only a scalar. Duplicate/numeric/non-object/raw-NUL JSON retains the established
JS fallback and exact historical bytes. No new refusal or SQL-scan bound.
Shared31 falsy-room vectors across all three paths plus metadata-precedence tests
pass; focused278/backend2213/runtime682/HTTP31/workerd/typecheck pass.
Full verifier attempted, with segmented completion rather than a clean invocation:
- Original log .local/assignment-projection-combined.log (SHA256
  `7cdd58e00f6cba0b2e190f641b1ff8851fb04da4488aec86c36f1a57d039575f`)
  failed alpha review click11. Screenshot showed no modal obstruction. Diagnostic
  pointer/mouse/click tracing passed all review actions; instrumentation removed.
  Cause remains unproven, not a claimed portal fix. Diagnostic log SHA256
  `38331802e44f408b2a8279294e71f6d1d2a19dfbed03f25b7dd0a83d9b8beb50`.
- Resumed .local/assignment-projection-remaining.log passed native/background/
  warm/shutdown but failed strict launcher retirement. SHA256
  `2a48a2a6fb6243073e7a0c54585db187bb685a04dc5013e61290eaa72e17bfbf`.
  Its lock monitor actively acquires the same locks as manager inspection; the
  fixture now stops/joins that monitor after launcher exit before returning to
  the manager. Runtime checks and exact expiry are unchanged. This eliminates
  a concrete contention race; original failure lacks proof of that exact cause.
  Corrected strict launcher passes, unknown-root custody and no-replay retained:
  .local/assignment-launcher-joined-monitor.log SHA256
  `089965917a28bf7b65946b34206d564e27e20b7dc936b6c1f1aa72942b288376`.
- Remaining service variants/build and desktop16 pass; log
  .local/assignment-service-tail.log SHA256
  `fcc83c9a0b9a22a2cd81356b2b098688bbb64d7218b025fa5812655bf9690ec9`.
No active check/child/delivery or host floor/Tasks fixture residue. Existing desktop
advisories remain; no push/deploy/live account calls or gate changes.

Explicit retry read boundary (2026-09-25): run.retry projects metadata and never
loads checkpoint_json. Started attempts do not load context; unstarted attempts
load at most1048576 raw UTF-8 bytes for the existing skill-expiry check. Over-limit
unstarted retries reject CONTEXT_PREPARATION_LIMIT without rewriting snapshots,
creating attempts, changing timers or requesting wake. Expected-attempt/status/
expired-code/90-day receipt checks retain precedence. Started retry admission still
uses existing custody checks and the later claim-time context gate. Budget predicate
types now accept metadata; predicate behavior is unchanged. This bounds hydration,
not SQL byte inspection, persisted snapshot size or total storage.
Focused94/backend2117/HTTP31/typecheck/dry-build pass. Character-count mutant fails
the multibyte one-byte-over case (incorrectly applied); restored byte check passes.
Logs: .local/explicit-retry-integrated.log, .local/explicit-retry-character-mutant.log,
.local/explicit-retry-focused-final.log. Initial .local/explicit-retry-focused.log
records a fixture error (Receipt.resource_id corrected), not regression evidence.
Full runtime/browser/native/shutdown/desktop matrix not rerun; no external actions.

Candidate metadata hydration budget (2026-09-25): limited scopedMemories executes
up to three indexed scalar SUM preflights over the same bounded candidate ranges.
Combined id/kind/created_at/updated_at raw UTF-8 must fit131072 before any candidate
strings hydrate. Deleted_at is NULL by predicate; revisions/body lengths are scalar.
All candidate keys needed for JS merging count, including later unselected rows;
this is deliberately distinct from the selected-body budget. Oversized candidate
metadata refuses preparation without truncation/source edits. Unlimited reads stay
unchanged. No SQL byte-inspection or database storage bound is claimed.
Exact/one-over multibyte ID/created_at/updated_at regressions assert only scalar
counts returned on refusal and exact legacy values retained. Focused53/typecheck,
backend2110/build and real workerd schema/query-plan/body/index/room regressions
pass. Both preflight and metadata queries use indexed searches without temporary
sorts. Log .local/metadata-bound-integrated.log SHA256
`d64eb67672b2a5c8c7b8d532fa53c2fb68aa91ce8a1744e3b41b6e447fb9e3d7`.
Full runtime/browser/native/shutdown/desktop matrix not rerun; no external changes.

Real workerd memory-bound follow-through (2026-09-25): extended the disposable
Durable Object fixture and existing test-schema-migration runner. Aggregate raw
body128KiB boundaries execute in ASCII/BMP/astral compositions across two scopes;
one-over returns metadata only and retains exact source text. The older single-body
assertion now explicitly checks absence of body_json rather than serializing an
undefined array element as null. Four sub-row-size multibyte timestamp records
exercise4MiB aggregate key admission and one-byte-over refusal.100000 total object
admission and100001 refusal preserve rows/version/no index. Existing rollback,
persistent reopen, exact schema, query plans and64 room vectors continue to pass.
`node scripts/test-schema-migration.mjs` and `npm run typecheck` exit0; log
.local/workerd-memory-bounds.log SHA256
`67fabc8406e3783da63105d97b3a1572605670882a321d91066fb1d64134cb58`.
No application behavior changes or full runtime/browser/desktop rerun in this
test-only follow-up.10000-active-row/64MiB-JSON construction boundaries retain Node
SQLite evidence, not new workerd boundary evidence. No live data/account calls.

Index scan/key follow-up (2026-09-25): new builds first count at most100001 total
object rows and refuse above100000 before inspecting active memory JSON. This
bounds rows visited by subsequent scans, not disk bytes/CPU time. Aggregate active
memory id/created_at UTF-8 input must also fit4 MiB; extracted scope keys remain
within the separate64 MiB JSON input bound. Existing-index handling is unchanged.
Exact/one-over100000 rows and4 MiB key tests include foreign persona rows and
multibyte IDs/timestamps, source preservation and no DDL/version advancement.
Initial fixture reset collided with schema_versions PK; retained in
.local/index-scan-focused.log, not application regression evidence. Corrected
focused18/typecheck/backend2107/build/HTTP31 pass; .local/index-scan-integrated.log
SHA256 `4b0a9edcf8b21821736b13a429997643e9b644bc64f8396a9d81c67e88ca4715`.
Full runtime matrix not rerun. Preflight byte inspection, ongoing storage growth,
metadata hydration and historical run snapshots remain open; no live migration.

Memory index construction admission (2026-09-25): a missing v14 memory-scope index
requires at most10000 active memory rows and64 MiB raw memory JSON. Preflight returns
only count/sum for up to10001 eligible rows. Over-limit MIGRATION_WORK_LIMIT503
occurs before DDL and leaves v13/source rows intact. These are reversible engineering
safety limits, not write/storage quotas. Existing indexes retain exact-SQL validation;
no build budget is imposed on an already-created index. Operators encountering this
gate must reconcile a legacy installation explicitly; never delete memory or bypass
the gate automatically. No live migration was run.
Exact10000/10001 and67108864/67108865-byte fixtures verify admission/refusal, exact
source retention, schema non-advancement and deleted-memory exclusion. Raising both
limits by one fails2. Focused15/typecheck/backend2104/build/local Worker HTTP31 pass.
Evidence .local/memory-index-budget-mutant.log SHA256
`8d20cf417361da973004c535af9ae932c5b0e4acf71009446adbddf0247149ce`;
.local/memory-index-budget-integrated.log SHA256
`c464dd6a2b07d2a6c945e215bcf157f1c402c8571ad7fde774d0f99b99197728`.
Underlying table scans, preflight byte inspection, metadata/index-key size and later
storage growth remain unbounded. Full runtime/browser/native/shutdown/desktop matrix
not rerun for this migration gate; production flags and external state unchanged.

Aggregate memory raw-body preflight (2026-09-25): limited scopedMemories reads
at most three indexed metadata partitions, merges/slices in the original order,
and refuses selected raw UTF-8 body totals above131072 before loading any body.
Accepted selection then uses bounded primary-key reads (at most65 in preparation).
This synchronous read path has no await or intervening application write. Unlimited
reads retain their semantics. Raw whitespace/escapes count toward this work limit;
normalized selected-model token budgets remain separate. No source is truncated.
Tests cover exact/one-over aggregate ASCII/BMP/astral bytes split across scopes,
no body return on refusal, exact source preservation, foreign/deleted/unselected
exclusion and index query plans without scan/temp sort. Weakened262144 limit fails3.
Focused45/typecheck/backend2102/build and real local Worker HTTP31 pass.
Logs .local/memory-aggregate-{focused,mutant,integrated}.log; integrated SHA256
`23bca453b2298bddf593e388be4a74745750c4a104b481bb26ab6d430c8293f5`, mutant
`10d98f5125d03ae0ad2d19b8fc40474ccd11ef2d6c3273b2fa08063c9796efd9`.
This is a hydration bound, not a bound on SQL byte inspection, legacy metadata,
database storage/index construction or historical run snapshots. Full runtime/
browser/native/shutdown/desktop matrix not rerun; no external/gate changes.

Selected-child parse reuse (2026-09-25): RootChildEffects.admitted retains the
selected child's first lineage parse for later policy checks. Attempt authorization
still precedes parsing; root parsing and the separate EffectLedger authorization
parse remain unchanged. >1MiB duplicate-policy-key fixture asserts exact stored
bytes, intent/reconciliation parse counts and retained unknown-effect locks. Stale
child boot with null context still returns STALE_EPOCH before context access.
Initial test omitted the independent ledger parse (retained child-parse-red.log);
corrected duplicate-parse mutant fails1. Focused46/typecheck/backend2099/build pass.
Evidence .local/child-parse-mutant.log SHA256
`60e50d9cd518846d80b22e8d3a3dc144f6a47ed4771c16d8f59b0ea7032d705d`;
.local/child-parse-integrated.log SHA256
`f81f16b34749da2f52142c50e8ccf48de93fbf8e8b89f716931e8dcf407cc9c0`.
Full runtime/browser/native/shutdown/desktop not rerun for this parse-only unit.
No SQL/storage bound, snapshot rewrite, replay permission or production gate change.

Queued snapshot parse reuse (2026-09-25): expireQueuedContexts retains its first
JSON.parse result for instruction/room projection. A >1MiB historical fixture with
duplicate instruction/room keys asserts one parse and exact last-key JS output.
Initial fixture lacked persona and was not due; those failures are retained in
.local/queued-parse-{red,final}.log, not counted as regression evidence. Corrected
duplicate-parse mutant fails1 in .local/queued-parse-mutant.log (observed2 versus
expected1 parses). Final retention/skills20 and typecheck pass. No SQL, authority,
clone or storage-bound change; full matrix not rerun for this parse-only change.

Follow-up retention projections (2026-09-25): expiry reads only persona_id from
the target run; dispatch reads id/persona_id/title from settled ancestors. Missing
run errors, recursive settlement predicates, cutoff and ordering are unchanged.
Fixtures retain >1MiB context and checkpoint bodies, assert exact projected rows,
unchanged target records, exact continuation text and idempotent dispatch. Existing
orchestration tests cover live descendants and unrelated sibling isolation.
Old reads fail2, focused31/typecheck pass; npm test passes2096 and npm run build
passes (dry run only). Evidence .local/followup-projection-{red,focused,integrated}.log:
SHA256 red `96af2ab1971f4c79848b958098d9ca90bb436b43c3b9909e62849c836f3427ca`,
focused `ff0957e7e49db91659aa3f2f4fd816fd020b11f62bc921b9a69f16df6d6f3345`,
integrated `f72facd7cab574bd1a36146e019048ba60c7175ed7a8de512b3d128e2888d8f7`.
No full runtime/browser/native/shutdown/desktop rerun for this SQL-only unit. This
reduces hydration, not SQL work, scan counts or storage; no gate/external changes.

Retention run projections (2026-09-25): memory purge reads id/status/context/updated
time; queued expiry reads id/context/occurrence/persona/command/instruction age.
Neither loads retained checkpoints or unrelated metadata. Existing purge/replay
and 30-day expiry fixtures now retain >1MiB checkpoints and assert actual returned
columns plus exact final runs. No purge/cancellation-grace/expiry/skill behavior
changed. Source bodies still hydrate; neither scanning nor total storage is bounded.
Old-query regressions fail3: `.local/retention-projection-red.log`, SHA256
`f05952ba6018e81ba8b08210b6f255c6fa695d935ce2b82cdd15e9fd73b6af83`.
Focused54/typecheck/backend2096/HTTP31/workerd/build pass, PID1252535 exit0:
`.local/retention-projection-final.log`, SHA256
`5d95a1fbada0081ab225ce5a1879b807ec70488b6e3aee59a7582668cf4a49d8`.
Full follow-through on local54e71e1: `bash scripts/verify-codex.sh` passed in one
uninterrupted run (PID1255664 exit0): backend2096/runtime682, dependency and
backup/restore contracts, HTTP31/workerd, browser fixtures, native recovery/tools,
managers, all intentional timed shutdown variants, strict launcher, all service
modes and build. Final status passed; assistantOperational, productionAdmission
and modelJudgmentVerified all false. Evidence:
`.local/authority-retention-combined.log`, SHA256
`390e3e7d49414aa9681d3f8cd9e9ac11cdcc81d0162238a321b20b6f2dee5690`.
`npm ci --prefix desktop && npm test --prefix desktop` passed16/16 (PID1255685
exit0); install still reports14 advisories (13 high, 1 critical), no package changes.
`.local/authority-retention-desktop.log`, SHA256
`46c2204f02ea345d6dc4eff0f94e82108a95cba85b6882a36751c510f3c5e40f`.
Catalog browser fixture passed unchanged; earlier intermittency remains undiagnosed.
All providers/models were disposable loopback fixtures, not live account acceptance.
Post-run `/etc/codex` and `/.sprite` absent; no tracked worktree changes or remaining
test-codex/workerd serve process. No native-clone, migration, gate or external changes.

Native representation decision (2026-09-25): direct source inspection traced all
context writers to JSON.stringify or literal {}, but pinned export/import/backup
preserve raw text and exact rows. Focused oracle consultation recommends retaining
JS cloning, not adopting a copied provenance flag or an incomplete SQL guard.
Executed orchestration regressions confirm two counterexamples: the canonical text
`{"instruction\u0000suffix":"keep","instruction":"old"}` aliases SQLite's
`$.instruction` to the wrong field; integer-key order and escaped string spelling
remain different under SQL copying even without duplicates or unsafe numbers.
Tests assert independently specified exact child bytes, unchanged parent bytes,
idempotent replay and that candidate json_set output differs. Focused346/typecheck
pass: `.local/native-representation-guard.log`, SHA256
`fd28af3cc38edec81ba37bdf810a907b2f3d22b23231cf918b7efd485d424316`.
No application change in this follow-up and no full matrix rerun.

A future fast-path certificate must bind the current exact text to object-root
JS-normalized representation AND compatible instruction keys (not just stringify
provenance). Every context update must invalidate it before trusted same-transaction
recertification. Verified backup/import artifacts retain exact rows; their copied
certificate is not trusted for execution. A writable-database reopen/restore trust
reset would be required before fast-path use, itself separate from the verified
artifact and potentially database-wide work. This is a deferred design constraint,
not an implemented marker/migration or a storage/SQL-work bound. Keep the genuine
JS fallback and cross-persona composition; never reject already-observed children
merely because the parent snapshot is large. Continue retention/snapshot read work
instead of introducing an unmeasured representation migration.

Root attempt room projection (2026-09-25 Asia/Jakarta): validAttempt uses the
separate runHasFalsyRoom predicate, not generation strict-null semantics. Unique
non-numeric room fields return a scalar; numeric fields retain JS conversion,
including negative zero, underflow and overflow. Duplicate keys, non-object roots
and raw NULs also retain JS fallback/exceptions. Text emptiness uses byte length:
SQLite text length stops at NUL, unlike JS truthiness. Root identity, manifest,
deadline, receipt and parent-link predicates are unchanged. Native-child room
context is never used; native cloning and stored context/checkpoints are unchanged.
This is a returned-data improvement, not a SQL scan/storage or fallback bound.

31 new Node/workerd vectors plus native-custody authorization tests distinguish
false/empty/absent from strict-null, empty versus NUL text, object/array truthiness,
duplicate/escaped keys, negative zero, both sides of underflow, overflow, exception
behavior and >1MiB source preservation. Child context is deliberately null to catch
accidental authority use. Existing large-root/child fixture now forbids both bodies.
Old read fails1: `.local/root-room-red.log`, SHA256
`1275ae3f31d140e80fff80d480a070956fce87dec2ba051dfc4c15977a1822fc`.
Text-length mutant fails2 (including actual child authorization), restored before
integrated checks: `.local/root-room-nul-mutant.log`, SHA256
`163eab906cf31001f45cf0e8987b03843cb3315adbda3277e3a60e4ac26e6c90`.
Focused344/typecheck/workerd64 room cases pass, PID1247066 exit0:
`.local/root-room-focused.log`, SHA256
`1eca53831b3107041eef6aa51861b692c311402f5ea71566835d7acf09c70376`.
After mutant restoration, `npm test`2094, `npm run typecheck`, `npm run test:e2e`
(HTTP31 and workerd), `npm run build` pass, PID1247640 exit0:
`.local/root-room-integrated.log`, SHA256
`2e788dca7decb07d21dede92665f68e144997b74d370200c8be688447fed7ef5`.
Prior full runtime/browser/native/shutdown/desktop matrix not rerun for this
localized predicate change. No push/deploy/live calls or production-gate changes.

Strict-null generation room projection (2026-09-25 Asia/Jakarta): Store counts
decoded root `room_id` keys with json_each and returns only a scalar for zero/one
key. Bootstrap/warm/background metadata reads omit context. Duplicate room keys,
non-object roots and trailing raw NUL use the original JS parse predicate, including
its exceptions. The existing json_valid CHECK excludes other malformed/deep inputs;
SQLite admits trailing raw NUL while JS rejects it. No stored snapshot is rewritten,
and native child cloning remains unchanged. This bounds scalar return, not SQLite
JSON scan work, historical fallback, total storage or registration work.

33 shared Node/workerd vectors cover both duplicate orders, escaped-equivalent
keys, all seven individually escaped key characters, NUL-containing keys, strict
false/zero/empty/object/array refusal, nested/absent keys, null-root exception,
trailing-NUL exception, overflow numbers and >1MiB context preservation. Existing
signed-generation fixtures assert no body/checkpoint returned and exact storage.
Old queries fail3 (`.local/room-predicate-red.log`, SHA256
`4622ccff5c41bc04b308c0e7da8313e2d3caefe33fc01b7231f463f268cdc81d`).
A temporary json_type path-extraction mutant fails5, including duplicate authority
and a NUL-containing property name; restored afterward. Log
`.local/room-predicate-first-key-mutant.log`, SHA256
`910f4278f728756297db5550df005c9852c532501abedb376c1920019bbd2aac`.
Initial test setup incorrectly attempted four contexts rejected by schema CHECK;
removed those impossible stored cases, then fixed a mock-result TypeScript narrowing.
Both failed logs remain as `.local/room-predicate-focused{,-final}.log`.

Integrated `npm run typecheck`, real workerd harness, `npm test` (2036),
`npm run test:e2e` (HTTP31 plus workerd), and `npm run build` pass, PID1242439 exit0.
`.local/room-predicate-integrated.log`, SHA256
`73ae79937aaf177ff62b58a43c2121721b7e65c86b3abe5829bdbc0184a3ce45`.
After restoring the mutant, focused alpha/orchestration/room286 plus typecheck pass:
`.local/room-predicate-final.log`, SHA256
`36f565b400e898cac13f399f7cd7f0c500139e8d12562b97005672998521f307`.
Prior full runtime/browser/native/shutdown/desktop matrix was not rerun for this
predicate-only change. No push, deploy, live calls or production-gate changes.

Warm/background generation projections (2026-09-25 Asia/Jakarta): validators select
command/persona/role/parent/routine/occurrence/context, excluding unused checkpoints.
Signed-owner HTTP admission fixtures create real generations, then pad contexts
with400000 Unicode characters and checkpoints with1100000 ASCII characters.
Actual returned columns and exact stored bodies are checked, followed by both
duplicate room-key orders and false/absent strict-null rejection. Old queries
fail2: `.local/warm-background-projection-red.log`, SHA256
`de9a285a93117cb64bc9e3021e1f8c4cc29a018053d2431713ea00b80f443fd2`.
An intermediate assertion also matched a legitimate background status-only read;
the exact-column assertion was scoped to the authority read (including SELECT*
negative control), not weakened. Retained test-correction log records that failure.
Focused alpha/orchestration253/backend2003/HTTP31/workerd/typecheck/build pass,
PID1237121 exit0; `.local/warm-background-projection-final.log`, SHA256
`d44d73602c46d0365d9618d81a522a1258fb7b3b8f4cf896121c8be9a55ac8fc`.
Prior full runtime/browser/native/shutdown/desktop matrix not rerun for this SQL
unit. Full authority contexts still hydrate and parse; no total bound is claimed.
No production-gate or external changes.

Bootstrap generation projection (2026-09-25 Asia/Jakarta): OwnerAlpha.generations
selects seven consumed run fields instead of SELECT*, excluding checkpoint_json.
No admission predicates changed; strict room_id===null remains JS-parsed. Tests
pad context with400000 Unicode characters and checkpoint with1100000 ASCII chars,
inspect actual query result columns and preserve the whole stored record. Room
tests distinguish duplicate-key orders and reject false/absent rather than treating
all falsy values as null. Old query fails1, `.local/bootstrap-generation-read-red.log`,
SHA256 `4d5f2c61c2de1864e5c4aaec91fa27d11873ad9ee4f8c91ae020ccaa4a230565`.
`npx vitest run tests/owner-alpha*.test.ts tests/orchestration.test.ts` passes251;
typecheck/backend2001/HTTP31/workerd/build pass. PID1233354 exits0; log
`.local/bootstrap-generation-read-final.log`, SHA256
`7ea62fc4581e8e7df1abc0fdcab5dd04c04ea17674ea8f42870aed6125be9aac`.
Prior full runtime/browser/native/shutdown/desktop matrix not rerun for this
projection. Warm/background SELECT* and unbounded context parsing/cloning remain.
No SQL-work/storage bound, production-gate change or external action claimed.

Integrated native-registration checkpoint (2026-09-25 Asia/Jakarta): complete
`bash scripts/verify-codex.sh` on local1487769 exits0 (PID1192490), ending with
`{"status":"passed","scope":"credential-free Codex and control contracts","assistantOperational":false,"productionAdmission":false,"modelJudgmentVerified":false}`.
Backend1996/runtime682, backup/restore, license/preparation, Worker/HTTP31, portal
browser, native recovery/tools, warm/background manager and timed auto-stop,
strict launcher, service modes and final dry-run build all pass in one run.
Evidence `.local/native-registration-combined.log`, SHA256
`b960a732f7bb677486e1480a74e409755d573c49e9d2879a53f6254edce16288`.
Connector catalog passes unchanged in this run; this does not resolve the earlier
intermittency or rewrite the earlier segmented verifier result. Independent
`npm ci --prefix desktop && npm test --prefix desktop` exits0,16/16 tests
(PID1192617). Install reports14 advisories (13 high,1 critical); dependency versions
were not changed. Generated types/contracts left the tracked worktree unchanged.
No live account/provider/model calls, push, deploy or production-gate changes.
Snapshot cloning/root-generation read bounds, native restoration/recursive
settlement and broader TODO/external acceptance remain incomplete.

Native parent deferred read (2026-09-25 Asia/Jakarta): registration reads parent
metadata, fetching context only after duplicate receipt handling. The clone itself
is unchanged. Extended actual-row regression proves no parent checkpoint on new
registration and no parent/child body on ordinary replay, preserving both stored
records. Alpha root/generation checks retain their separate context reads.
Old query fails2: `.local/native-parent-read-red.log`, SHA256
`1eac2af4399c1ff6eda2fda8f1c94131f4fbe64922fbffd14bc2db6562812d85`.
Focused269/backend1996/HTTP31/workerd/typecheck/build pass, PID1189472 exit0,
`.local/native-parent-read-final.log`, SHA256
`ff44808d48075480c6f2cedce3633cf358619dce37ca91bf39b75c1d3a7d17c2`.
Runtime682/native-child service passed on preceding response commit, not rerun
after this localized change. Browser/shutdown/desktop matrix not rerun.

SQL clone decision: retain JS parse/spread/stringify. Executed probe
`.local/native-copy-json-semantics.log`, SHA256
`cf7daece6ff9a0c686ad7ee861ebace3feaf696f50516468991e3f297041b45a`
shows json_set replaces the first duplicate instruction, leaving the last one to
override it in JavaScript. Raw copying also preserves duplicates where current
cloning normalizes scope and authorization keys; SQL and JS consumers disagree.
Focused oracle advised retaining cloning until a proven snapshot representation
invariant permits a canonical-only fast path with unchanged historical fallback.
New tests pin both final room variants, duplicate instruction/scope/grants,
unknown nested duplicates, overflowing number normalization and escaped child
instruction; child SQL-extracted scope/grant must agree with JS. No fabricated
authority, cutoff-based rejection, SQL-work bound or storage bound introduced.

Native registration response adoption (2026-09-25 Asia/Jakarta): returns all Run
metadata except context_json/checkpoint_json, selecting those fields directly on
new, duplicate and started paths. Stored snapshots remain available to authority
and recovery code. Runtime consumes id/parent/persona/attempt/role/status only.
Two new regressions inspect actual child read results and responses with a large
inherited Unicode context and >1MiB retained checkpoint, checking stable replay
and byte-for-byte storage preservation. Existing snapshot tests read stored runs
instead of the response; exact unaffected-task comparisons remain intact.
Old paths fail2, `.local/native-response-red.log`, SHA256
`09800dfc994acec76ef60217e7214ca719ccf2c9186fa302b5e69daa60d90fbf`.
Focused267/backend1994/runtime682/HTTP31/workerd/typecheck/build pass, plus
`bash scripts/test-codex-service.sh --child` (real pinned Codex, loopback model,
child interruption/custody, no account/provider calls). PID1179883 exit0,
`.local/native-response-final.log`, SHA256
`65eae65a989b53dd583663ba635078ed6661497e6e04763afa7506c689a5ed97`.
Intermediate test/typecheck failures exposed old full-response assertions and a
test variable inference mistake; retained logs document correction, not green runs.
Browser/shutdown/desktop matrix not rerun. Parent reads/cloning and root/generation
authority contexts still unbounded. This is not total registration acceptance.

Alpha child-context prerequisite (2026-09-25 Asia/Jakarta): validAttempt selects
seven run metadata fields, reads context lazily only for root room checks, and
uses command/routine metadata for the final legacy parent receipt comparison.
No predicates changed. Regression pads root/child snapshots, inspects actual
authorization query results for absent checkpoints/child context, and confirms
stored snapshots unchanged. Duplicate room keys in both orders, array and false
values preserve existing JavaScript semantics rather than SQL extraction.
Old query fails1: `.local/alpha-child-context-red.log`, SHA256
`f0deca3a010e866f83d32f7bd43e3fe12eb12c165ecbc9632acbe0b478efdf34`.
Focused alpha/orchestration242, backend1992, HTTP31/workerd/typecheck/build pass,
PID1172675 exit0, `.local/alpha-child-context-final.log`, SHA256
`4e67632849d4e4bfe09e37a764bc903b06ff4e1956ef2fe2ca78cd60754a2a07`.
Prior runtime/browser/shutdown/desktop matrix not rerun. Root/generation contexts,
registration parent cloning and response reads remain; no total bound claimed.

Alpha cancellation projection prerequisite (2026-09-25 Asia/Jakarta): propagation
reads root status/error_code and child id/status/error_code/updated_at. Existing
validAttempt checks, cancellation reasons and grace timestamp remain unchanged.
Worker heartbeat regression pads contexts with 400000 Unicode characters and
checkpoints with 1100000 ASCII characters, checks actual child-return columns,
root/child cancellation, stable timestamp after ten seconds and unchanged snapshots.
Old query fails: `.local/alpha-cancel-projection-red.log`, SHA256
`a0098cf5f99a5dec99b7b771525b1836d64e14a3aa7aab8a61dd7755096d6fb3`.
`npx vitest run tests/owner-alpha*.test.ts tests/orchestration.test.ts` passes237;
`npm run typecheck`, `npm test` (1987), `npm run test:e2e` (HTTP31/workerd),
`npm run build` pass, PID1169078 exit0. Final log
`.local/alpha-cancel-projection-final.log`, SHA256
`cde6682ef844806e5346dfa81c9617be0e10f6d1fcba4567bfb1abe9ab4dff9c`.
Prior runtime/browser/shutdown/desktop matrix not rerun. Indirect validAttempt
contexts still hydrate; no total registration/SQL/storage bound is claimed.
Room projection probe found duplicate room_id keys differ between JavaScript
JSON.parse (last key) and SQLite json_extract (first); no room parsing changed.
Evidence: `.local/alpha-room-json-semantics.log`. Gates remain unchanged.

Alpha attempt projection prerequisite (2026-09-25 Asia/Jakarta): validAttempt
selects epoch, boot_id, deadline_at, started_at, native_run_ref and submission_key
instead of the entire attempt including result_json. No predicate changed. The
regression invokes the Worker submitted route with >1MiB retained Unicode result,
checks actual returned columns and exact receipt/status with result preserved.
Old query fails, `.local/alpha-attempt-projection-red.log`, SHA256
`b223f4fafe4597788fa2d5f107fc1e883f7ce0c43952c11fd22d733f4f276722`.
Alpha/orchestration236 and backend1986/HTTP31/workerd/typecheck/build pass,
PID1165569 exit0, `.local/alpha-attempt-projection-final.log`, SHA256
`a02b096dd280bd59729d1b413b60f7a9797953259dbad6833f029db50979f3f0`.
Prior runtime/browser/shutdown/desktop matrix not rerun. Native registration still
hydrates run contexts through alpha validation, parent cloning and return reads;
this is not full registration, SQL-work or storage acceptance. No gate changes.

Native ACK projection prerequisite (2026-09-25 Asia/Jakarta): submitted reads
current_attempt/status/error_code after unchanged authorization, preserving
missing-row errors, native receipt conflict/replay, late cancellation and reason
retention. Tests inspect on-time/expired ACK and replay with >1MiB historical
context/checkpoint and unchanged stored bodies. Old query fails2:
`.local/native-ack-projection-red.log`, SHA256
`a4a7fb57fc18a8224c36b3b5701d72b5eb441500d88d6de508b87e4742c8b7c4`.
Focused129/backend1985/HTTP31/workerd/typecheck/build pass, PID1161426 exit0,
`.local/native-ack-projection-final.log`, SHA256
`993a10600ec5a903bb95cad887ffa77235dad7ba2563f5bb3bb7b19d7fe7f2a3`.
Prior runtime/browser/shutdown/desktop matrix not rerun for this projection.
Native-child registration remains unbounded: parent parsing/cloning, response
reads and indirect alpha reads remain. Focused advisor review distinguished a
SQL-copy/metadata-response path preserving snapshots from a new denial-context
design requiring consumer/reconciliation changes. SQL copy would avoid JS
hydration, not bound SQL work/storage. No registration/API change shipped here;
no replacement authority, child cancellation policy or external gate change.

Due-retry projection (2026-09-25 Asia/Jakarta): retryDue selects id/status rather
than Store.run's full historical bodies. The missing-row NOT_FOUND/404 contract
is retained. Admission pause, question/cancellation fences and queue transitions
are unchanged. Two regressions inspect returned fields with >1MiB context and
checkpoint, enabled/disabled admission, timer custody and unchanged prior attempt.
Old read fails2, `.local/retry-due-projection-red.log`, SHA256
`7a075c93be494af02bf1438f183adb4f7bdee1cd5915b5cd04cfe9394aaaea70`.
Final focused128/backend1983/HTTP31/workerd/typecheck/build pass, PID1157282 exit0,
`.local/retry-due-projection-final.log`, SHA256
`3aaa68fc32e68eaa8c0801263893cf08b735b2dbe281a21b351c4806d5bc304b`.
Prior runtime/browser/shutdown/desktop matrix not rerun for this SQL-only unit.
No SQL-scan/row-count/storage bound, native-child change or external action.

State run projection (2026-09-25 Asia/Jakarta): state selects public run metadata
without returning context/checkpoint bodies from SQLite. Initial and incremental
responses retain newest100 ordering, exact fields, recovery decisions and global
summary counts. A101-run regression has asymmetric timestamps and >1MiB context/
checkpoint values, inspects DB-returned metadata and verifies stored rows unchanged.
Old query fails, `.local/state-run-projection-red.log`, SHA256
`fe6c0c6ee15585b9d69faab132448c9be0c297b97d1ee83413d474c0aa9753bf`.
Initial focused run caught a fixture expectation error: execution-disabled runs
are waiting, not queued. Corrected expected counts without application changes;
retained `.local/state-run-projection-focused.log`, SHA256
`d2dbf2c8354fc8fd21ef2b606c39a18c170109fa9941406ee49d22605aad38f8`.
Final focused117/backend1981/HTTP31/workerd/typecheck/build pass, PID1153703 exit0,
`.local/state-run-projection-final.log`, SHA256
`4183be24fa5e63d379a9161865cc36db0e53a0a270e8d4c97d294e2ce548f31e`.
Prior runtime/browser/shutdown/desktop matrix not rerun for this SQL-only unit.
Other state object/proposal/monitoring reads remain outside this projection;
no total-memory, SQL-work or storage bound. No native-child, external or gate change.

Task-page projection (2026-09-25 Asia/Jakarta): scopedTaskPage now selects run
metadata plus joined request_status instead of full historical bodies. Counts,
scope predicates, keyset ordering/lookahead, attempt/delivery/recovery lookups
and unfinished-only conversation pages are unchanged. Room filtering still
inspects context in SQLite; this is not a SQL-work, storage or total-memory bound.
Three regressions cover persona/room/routine with >1MiB Unicode contexts and
checkpoints, exact returned columns/IDs, public metadata, counts/cursors and
unchanged storage. Old query fails3, `.local/task-page-projection-red.log`, SHA256
`a69a70e514fcd3361befd897c3fb169e2a8ffeaceec0ff1ff90ba809d6c5c6d2`.
Focused107/typecheck pass, `.local/task-page-projection-focused.log`, SHA256
`6dc2b2dce01a04dfbb9e305d78c788e18136032384d081a1f9fdcd1b98adcf4f`.
Backend1980/HTTP31/workerd/typecheck/build pass, PID1150153 exit0,
`.local/task-page-projection-integrated.log`, SHA256
`b4fad30ec6e2e173bf25f80071fb133c78429c8a45ad71be67b2e640daec03cd`.
Prior runtime/browser/shutdown/desktop matrix not rerun for this SQL-only unit.
No UI or native-child changes, push/deploy, account calls or gate changes.

Recovery-page projection (2026-09-25 Asia/Jakarta): recoveryPage now selects its
13 public metadata fields rather than reading and discarding context_json and
checkpoint_json. recoveryMetadata requires only id/current_attempt; its custody
queries are unchanged. Persona/room scope, cursor ordering/lookahead, response
metadata and stored snapshots remain exact. Room scope still inspects context
within SQLite; no SQL-work, total-memory or storage bound is claimed.
The existing pagination regression now checks DB-returned columns for both scopes
with >1MiB Unicode context and >1MiB checkpoint, exact public metadata, retained
snapshots, deleted cursor and invalid input behavior. Old query fails:
`.local/recovery-page-projection-red.log`, SHA256
`6b0d27afb1dca231dbe66ace28e49ed6d53ab3ba5883ae217c3a138cd5f51669`.
Focused142/typecheck pass, `.local/recovery-page-projection-focused.log`, SHA256
`71a5f7d305100b582e866edbd968f52e23e57f4c75755424248e154da6c65ed3`.
Final backend1977/HTTP31/workerd/typecheck/build pass, PID1146844 exit0,
`.local/recovery-page-projection-integrated.log`, SHA256
`d68fef43e0dfe2963f7e9f05c1bcdb720c2fbe5d3c92fa41a641218e10a13a99`.
Prior runtime/browser/shutdown/desktop matrix not rerun for this SQL-only unit.
No UI, native-child registration, external action or production gate change.

Stopped-runtime retry projection (2026-09-25 Asia/Jakarta): observeStopped now
returns only id, role, current_attempt and error_code for recovery candidates.
scheduleRetry preserves checkpoint_json inside SQLite with COALESCE instead of
hydrating and rewriting its value through JavaScript. Retry eligibility, delay,
effect/operation/question checks, attempt termination and retained locks are
unchanged. This removes snapshot transfer, not SQL scans, row count or storage.
Native-child registration and other historical reads remain separate work.
Regression cases retain >1MiB contexts and NULL, empty-string or >1MiB Unicode
checkpoints; inspect exact returned fields, stored snapshots, retry deadline and
terminated attempt. Old query fails3: `.local/stopped-retry-projection-red.log`,
SHA256 `2680ff4a7bd61e3f5dbcdae5f1b20b6ffde5dae9c0572010a18c069c659f8667`.
Focused recovery/lifecycle81 and typecheck pass:
`.local/stopped-retry-projection-focused.log`, SHA256
`7d7e7e95a95352643241e9b9b2e83309cb053189748c54a35d08c3be2b4e9518`.
Backend1977/HTTP31/workerd/typecheck/dry-build passed, PID1143296 exit0:
`.local/stopped-retry-projection-integrated.log`, SHA256
`7b0023c50f0a8b0f7cf14c7f026fd7a127f467949ecc64d2e45c8d3a213b22c0`.
Prior runtime/browser/shutdown/desktop matrix not rerun for this SQL-only unit.
No push/deploy, account calls or production gate changes.

Queued historical snapshot read ceiling (2026-09-25 Asia/Jakarta): an engineering
safety policy now limits context_json plus checkpoint_json returned by
nextClaimableRun to 1048576 UTF-8 bytes. SQL CASE returns NULL bodies above the
combined limit, retaining candidate metadata rather than silently skipping work.
Preparation and claim park that candidate with CONTEXT_PREPARATION_LIMIT, retain
the stored bodies, and start no new attempt. Runtime recognizes this blocked
preparation without invoking the counter, claiming or submitting inference.
This can refuse otherwise schema-valid large contexts; it is not a model token
budget. Native-child registration is unchanged. SQLite still inspects stored
values, and metadata, new context construction, active/alpha snapshot reads,
native-child cloning, total storage and index construction remain outside the cap.

Exact/one-byte-over cases cover context-only, checkpoint-dominant and split bodies
with multibyte padding; tests inspect DB-returned values before the caller and
retain oversized stored data. Claim revalidates after counting. Existing explicit
skill revision/body and room-scope tests pass. Original query fails3, log
`.local/historical-snapshot-red.log`, SHA256
`1f84e27f03476c50181e806897b5336729440ddcf1615dd2b7f6c556e8a4497f`.
Focused108/typecheck passes, log `.local/historical-snapshot-focused-v2.log`, SHA256
`1e5cad0e78b77f585ad1dc8b6c7bd1e2793041d085db4d0a759fcce6b09a895c`.
Full verifier passed backend1974/runtime682, then failed on ESRCH reading a
departed synthetic process's /proc stat in the wappmcp stdio fixture. Original log
`.local/historical-snapshot-combined.log`, SHA256
`bc06fa6c1578fa1068d19c98be36e65eb5c260857dd55dbf4f975e15e481cdfa`.
The fixture now handles ESRCH alongside ENOENT; permission/I/O errors still throw,
and PID/start-time checks are unchanged. Deterministic red/green evidence is in
`.local/stdio-exit-race-{red,green}.log`. No upstream dependency/patch changed.
Verification resumed at verify-wappmcp through the remaining stages and desktop
as PID1106939 in `.local/historical-snapshot-remaining.log`; the corrected real
stdio fixture passes. HTTP31/workerd and token-usage browser passed, then the
catalog assertion failed at scrollTop10 versus0. Diagnostic run sampled zero
over30 frames and passed (`.local/historical-snapshot-scroll-diagnostic.log`);
cause remains unproven. Temporary instrumentation was removed without changing
the assertion or portal. Remaining browser/native/shutdown/strict-launcher/service/
build stages and desktop16 passed, PID1109360 exit0,
`.local/historical-snapshot-final-tail.log`, SHA256
`139fed468070215aa33f1745a3719e14dfb8dd354bcb0c2b60a901f6e4cee89b`.
Final typecheck clean; host fixture paths absent. Resumed failure log SHA256
`e69ac882784c4d4773a54ace6d8aa9459be569f695924a2e2c2f540fe41cfb41`;
scroll diagnostic SHA256
`3d2cb0ad5c6c8681c3fb9166f7f5e35d649f07958acc486673f9ec89d59dd93c`.
This is segmented evidence, not a clean original run; the intermittent catalog
failure remains unresolved. No active check, child or unintegrated delivery.
No production configuration or external action changed.

Cancellation-grace projection (2026-09-25 Asia/Jakarta): the watchdog now selects
only run IDs for escalation, avoiding unnecessary historical context_json and
checkpoint_json transfer to JavaScript. No predicate or transition changed.
The regression retains >1MiB context/checkpoint values and tests both sides of the
30-second boundary, reason precedence, effect uncertainty, confirmed effects,
unchanged snapshots/attempts/child links/locks and continued sleep refusal.
It fails against SELECT r.*: `.local/watchdog-projection-red-v2.log`, SHA256
`ebf1fad4920ffa2bc4e8ca98bb59fb8d82337afb555a3462c23e9b9fa1e96b24`.
An earlier fixture error (acquiring a lock after cancellation) remains in
`.local/watchdog-projection-red.log`; setup now acquires it before cancellation.
Focused89/typecheck passes; `npm test && npm run test:e2e && npm run build`
passes backend1969/HTTP31/workerd/typecheck/dry-build. Integrated log
`.local/watchdog-projection-integrated.log`, SHA256
`b88c97a2d252ec9dd3da147420f1a8200eead10fe74de09927a4494262f7cdcb`.
The prior full runtime/browser/shutdown/desktop matrix was not repeated for this
projection-only change. This bounds neither selected row count nor SQLite work,
storage, or other snapshot reads/clones. No runtime/UI or production gate change.

Observed-child memory overflow custody (2026-09-25 Asia/Jakarta): authorized
cross-persona registration previously rolled back when target context preparation
exceeded the record/byte work limits. It now preserves the exact native receipt,
parent/attempt identity and inherited deadline in cancelling state. Its empty-memory
placeholder is not an executable context and refuses child-scoped new effect
intents; this does not establish per-child native caller authentication or physical
termination. Original source memories and
parent context are unchanged. This is not truncation of an executing context.
Existing cancellation/deadline reasons retain precedence. Replay cannot revive
the child after source cleanup, and later same-persona descendants inherit its
cancellation. Attempts remain unsettled through watchdog escalation; child and
grandchild settlement are both required before sleep. Authorization and other
errors still reject normally. Historical context_json hydration/cloning remains
unbounded; this is a prerequisite custody fix, not snapshot-size acceptance.

Regression run failed four cases on the original rollback path, log
`.local/native-memory-custody-red.log`, SHA256
`e2b44738d983fdfa7f9072f2cfad9a324d56d7065fdbd1a010851cf37dd665a3`.
Two subsequent failed fixture logs are retained: the test originally used hard
deletion despite revision foreign keys, then attempted to retry a completed root
instead of the recovery-required child. Corrected focused69/typecheck passes in
`.local/native-memory-custody-focused-v3.log`, SHA256
`67d0c6ee4b34414f94e1b94876ab40371cf2eb56a52e8808c8c9d5a112caa3af`.
A normal 64-record boundary case was then added to distinguish cancellation from
unconditional refusal/omission. `bash scripts/verify-codex.sh` followed by
`npm ci --prefix desktop --no-audit --no-fund && npm test --prefix desktop` exited0
in one complete invocation: backend1968/runtime682, HTTP31, all browser/native/
shutdown/strict-launcher/service checks, typecheck/dry-build and desktop16 pass.
Log `.local/native-memory-custody-combined.log`, SHA256
`cdc57279bfe06a36b64f1c576e70f15e5705fe2bb03d6fce8acf20b8038be529`.
Host fixture paths /etc/codex and /.sprite are absent afterward. No active check,
child or unintegrated delivery; no push/deploy, live account call or gate change.

Scoped memory body read-work guard (2026-09-25 Asia/Jakarta): limited reads now
return NULL instead of body bytes when stored JSON exceeds 131072 UTF-8 bytes,
then refuse with MEMORY_PREPARATION_LIMIT if that row belongs to the merged
selection. This is a per-record raw-read limit; the existing aggregate serialized
memory budget remains independently enforced. No source is truncated or rewritten.
Expired oversized rows still consume read work until retention removes them.
Foreign/deleted rows and rows outside the merged selection cannot block it.
Unlimited reads retain their existing behavior. SQLite may still inspect the
whole stored value: this does not bound SQL work, metadata bytes, isolate memory,
storage/index construction or historical run context_json parsing/cloning.

Boundary cases cover exactly 131072 and 131073 bytes in ASCII, BMP and astral
text. A character-count mutant failed both Unicode cases (2 failed/1 passed),
then the byte implementation was restored. Tests observe NULL at the DB/JS return
boundary, preserve source records, and prove parked messages produce no wake or
attempt even with execution enabled. Real workerd confirms the same boundary
and existing indexed plans. Initial focused42/workerd/typecheck log
`.local/memory-body-limit-focused.log`, SHA256
`ecb18c8fa7b0a3de38857938db239e906b8fbc1778f4a36a6834d2def3b7fd41`;
mutant `.local/memory-body-character-mutant.log`, SHA256
`550eb3683baa36e9f36f8a5529e920e5f2a0559fb33415ff860cfe1d0a5c7c21`.
Final `npm test && npm run test:e2e && npm run build` passes backend1962,
HTTP31/workerd/typecheck/dry-build, log `.local/memory-body-limit-integrated.log`,
SHA256 `60a0537ea689d6e9d21f8de3cd01867f88d701523afec0f3e3d2af8af3e7b2d4`.
The prior runtime/browser/shutdown/desktop matrix was not rerun for this localized
SQL unit. No active check/child/delivery, schema migration, external action or
production gate change. Local checkpoint only.

Recursive parent lookup (2026-09-25 Asia/Jakarta): application schema15 adds
`runs_parent(parent_run_id,id)`. Both the seed and recursive step of the unchanged
descendant-settlement predicate use covering parent lookups instead of a table
scan/automatic index. This is not a family-size, obligation-scan, total-storage or
index-construction bound. No shared database migration was executed.

The v14→v15 migration rejects conflicting named indexes and rolls back index
creation if the version write fails; exact-index adoption and inert reruns are
tested. Canonical schema SHA256 is
`327be864123d24d2aa574a9bddb9b333948b7311e2eb0ea9363d4b37b3799c5c`;
the pinned SQL file SHA256 is
`d760d97d5e400a0d7e2ab3f2d5a2230fa354503d34a531304f02e780eabbd306`.
Historical backup/export pins are unchanged. Imports reconstruct pre15 snapshots
without the new index or invented migration history. Node coverage includes a
live grandchild, settled family, cycle dedupe and an index-removal negative control.
Real workerd verifies both recursive steps in retention queries, startup migration,
exact fresh schema and persistent reopen. Its log plus typecheck is
`.local/run-parent-workerd.log`, SHA256
`1cd0c396b33f264defe04d375b66b594058631e6fec7cbbf1e4d23798a9c03d5`.
Initial focused202:201 passed; one stale restore-version expectation failed and
was corrected. Retained `.local/run-parent-focused.log` SHA256
`29c82c80025b0345c98564be4f96421e1f37d5f06f3ac7e02a91ac744d844221`.
Original combined verifier passed backend1956/runtime682, backup/restore, HTTP31
and workerd migration/plans before failing the connector-catalog browser assertion:
`scrollTop` was0.5 instead of0. Retained `.local/run-parent-combined.log` SHA256
`25e34f31562ee6f5256e5cc2655dbea771d6bc355b8b704d5289f84f5f23bd85`.
A diagnostic run sampled zero over9 frames and passed the unchanged assertion;
this does not establish the first failure's cause. Temporary instrumentation was
removed; neither portal nor fixture is changed. Diagnostic log
`.local/run-parent-catalog-diagnostic.log` SHA256
`8e907cce10f990858d440c47c8e0ecf6c588cac822b871404fbd5bb10eb03a91`.
Remaining verifier stages exited0 through browser/native/shutdown/strict launcher/
service/typecheck/dry build in `.local/run-parent-remaining.log`, SHA256
`3bbe2145d5b2b6a1b1f34a53b0448434f4598eb312eaf974395a109c67bf8643`.
Evidence is segmented, not an original clean invocation. Separate desktop16 passes in
`.local/run-parent-desktop.log`, SHA256
`13333bf2a5e741199fa2cad2a588caf0d843a8a084a5cd06f60bc098cde522d3`.
No active check/child/delivery or host fixture residue remains. Local checkpoint
only; no publication or clean full-verifier claim. Production gates remain false.

Read-ledger cleanup query plan (2026-09-25 Asia/Jakarta): the shared `nextDue`/
`prune` query now starts with the indexed memory-read key range, then probes exact
attempt and run primary keys. The previous plan traversed terminal runs and their
attempt histories before ledger lookup. Canonical UUID IDs and variable-width
integer attempts follow the existing runtime contract; exact reconstructed-key
equality prevents CAST aliases from gaining deletion eligibility. The 90-day,
100-delete, transaction and recursive settlement predicates are unchanged.
This removes broad outer run/attempt traversal, not remaining ledger scans,
recursive family/obligation scans, sorting, total storage or index construction.

Node and real workerd plan assertions cover both queries with 1001 attempts,
exact deletion, preserved attempt records and retained numeric aliases. All 32
retrieval/retention tests pass, including uncertainty/descendant/rollback cases.
The initial plan test failed against the old query; removing reconstructed-key
equality also failed (6 deletions instead of 1), then the guard was restored.
Evidence: `.local/memory-retention-plan-red.log` SHA256
`528654ef64d4761daa0ab60ad67ce69e921c6842332adfb08453f242fd558600`;
`.local/memory-retention-alias-mutant.log` SHA256
`3b71cfcf084a47e87f6fae69ef77a0ca46401d4405fa5fb683a8111344d4e4ed`.
`npm test && npm run test:e2e && npm run build` passed backend 1949, HTTP 31,
workerd migration/plan/occurrence checks, typecheck and dry build:
`.local/memory-retention-plan-integrated.log` SHA256
`f888e882ade283a090e6edd2e77dd43d39301fad88e6459c55466644c8c009ba`.
Final stronger key-first/run-primary-key assertions also pass Node 32/workerd/
typecheck in `.local/memory-retention-plan-final.log`, SHA256
`2938ef6262e2fecc17d545e93a04af1fd2731815f3c6eacedc02b7c22c6b45da`.
Runtime/browser/shutdown/desktop checks below predate this SQL-only unit; they
were not rerun. No schema migration, live database, provider/account call,
deployment, publication or production gate change.

Ordinary memory snapshot bounds (2026-09-25 Asia/Jakarta): context construction
now shares preparation's indexed 65-row sentinel, 64-record complete-or-refuse cap
and 131072-byte combined serialized buckets. Expired rows still consume record
work; foreign scopes do not. Constraints remain verbatim. Oversized enqueue
persists a waiting request with `MEMORY_PREPARATION_LIMIT` and an empty, unadmitted
memory placeholder, without requesting a wake. Passive memory deletion does not
resume it; explicit retry rebuilds current context. Legacy claims recheck growth
and park before attempts, letting unrelated queued work continue. Due routine
occurrences still commit independently. This does not add legacy token accounting
or bound total storage, index construction, cleanup scans or historical snapshots.

Focused 48/typecheck pass, including exact 131072/131073-byte boundaries, 64/65 rows,
expired sentinels, scope, no-wake/delete/retry, preserved constraints and independent
due routines. `.local/memory-legacy-focused-final.log` SHA256
`5e0fe997f1a2e73572e89e9c965ed9f8473a747de8096e28c3d514600ec889a3`.
The full verifier passed backend 1946/runtime 682, HTTP 31 and preceding browser/
Worker stages, then failed at an unobserved second alpha review click. Its original
log is retained in `.local/memory-legacy-combined.log`, SHA256
`c8526406657951a9af67505c453ce18f075a55e52fdadd347a6abb4cd50a7927`.
The fixture now waits for its click listener before asserting the exact target;
no retry or application change. Standalone alpha-session passes all three sections:
`.local/memory-legacy-alpha-click-wait.log` SHA256
`2c77217821cc33a46dd7aeb3025e8e411f7e5400b745ad45ba17c61c20d3ef7e`.
The final routine regression was added after the full backend segment and is in
the 48 focused tests. Desktop 16 pass. The remaining verifier (PID968999) exited0,
including browser/native/shutdown/strict-launcher/service/typecheck/dry-build:
`.local/memory-legacy-remaining.log` SHA256
`021088750365a7ef667679684c0c2448529fc115fa1196de59dd0f46dc4da747`.
This is segmented verification, not a clean original full invocation. No
push/deploy, live calls or production gate changes.

Read-ledger retention (2026-09-25 Asia/Jakarta): Worker maintenance/alarms now use
the existing90-day settled-history window for exact memory-read attempt keys.
The attempt/run must be terminal, with no retry, live root attempt, operation,
lock, uncertain effect, undelivered result, unresolved root question or unsettled
native descendant. Cleanup is independent of result JSON and leaves structural
custody unchanged; an old terminal attempt cannot restart read accounting.
At most100 keys are deleted per transaction. Total storage and cleanup SQL scans
are not bounded by this change. No live database or production gate was changed.

Thirteen new retrieval/retention cases cover exact time boundary, terminal-read
refusal independent of expired lease/source guards, uncertainty, recursive
grandchild/effect custody, result-pruned rows, batch limits and atomic rollback.
Focused73/typecheck pass in `.local/memory-read-retention-focused.log`, SHA256
`ce92cb8b1b2c1e49bd53345d6df6b0ad4f552a5aab6597cf3567f20d197143bc`.
Temporarily removing the descendant predicate fails both nested cases;
`.local/memory-read-retention-mutant.log` SHA256
`0055dbd5925fc527a55e69a03ce043a950b4847386d77b0763262a67e0bbff72`.
The predicate is restored. Final backend1942, HTTP31, typecheck/build pass in
`.local/memory-read-retention-integrated.log`, SHA256
`7a93bc367ffdda0f37366ca1d82ab7ca24372d7273aa0870207519f39b96b037`.
Runtime/native/browser evidence below predates this control-only cleanup unit.

Summary projection (2026-09-25 Asia/Jakarta): budgeted preparation/claim accepts
an optional bounded host `memory_read_personas` declaration, captured before awaits.
Only host-enabled, persona-authorized, owner-adopted non-constraint summaries
replace prompt source text. Entries disclose omitted source, exact ID/revision,
source digest/code-point length and bounded read tool. Lexical ranking and raw
work limits precede projection; all projected metadata enters the token domain.
Reads reproduce the admitted projection from current source before returning a
range, retaining expiry/scope/deletion/attempt/lease fences and cumulative charging.
Legacy paths and constraints remain verbatim. No policy or automatic inference
is introduced. Representation is not summary-fidelity or deployed acceptance.

Initial four failing behavior cases are retained in `.local/memory-projection-red.log`,
SHA256 `21b04b127cf04a71dbe970877785db10a92c43b6d8b8d3a18ec9e6effa430290`.
Focused75 and bridge/projection63 pass; the latter uses real worker-thread counts,
schema validation, SQLite claim and exact adapter input, then reads the original
source. Bridge log `.local/memory-projection-bridge.log`, SHA256
`7fd17e5cd32ecd84eeaa971742fa7de4463ebe2aad2ea2676e77fe46ff4cda84`.
The first backend run passed1928/1929; its sole failure was the new fixture asking
for22 characters but expecting23 including punctuation. Corrected the requested
range, not the exact assertion. Failure `.local/memory-projection-integrated.log`,
SHA256 `3b879f705dd64ade8d2ee6b5475aa32cb42ac79f5934d1e7d81be0c1094c057a`.
Final backend1929/runtime682, HTTP31, native service, typecheck/build pass in
`.local/memory-projection-integrated-final.log`, SHA256
`cfdad2072ab519a23d96d50e393ac93afd22e462ccd7836316495816390d86fe`.
This unit uses targeted integrated checks, not another complete browser/shutdown
matrix invocation. The preceding runtime-delivery
checkpoint below retains the segmented full verifier evidence. Storage growth,
index construction, read-ledger retention and legacy enqueue limits remain open.

Runtime targeted reads (2026-09-25 Asia/Jakarta): `hehebot_read_memory` is an explicitly listed
ordinary MCP/dynamic tool. The service binds admitted model/budget digest into its
immutable grant. A shared model mapping governs pre-claim and read counts. The
host verifies preparation identity/hash, counts the exact response text, reserves,
then holds a nonserializable single-use delivery closure. MCP stdout and native
transport resolve it at the synchronous write boundary, after deadline/abort
checks. Dynamic call journals retain no source bodies and refuse same-call replay;
mutation receipts keep their existing replay behavior. MCP cancellation during
an unknown reservation does not refund or retry it. No grant/policy is adopted.

Focused77 runtime/service tests and17 SQLite retrieval tests plus typecheck pass
in `.local/memory-delivery-service.log`, SHA256
`94e6c544ca76fb8482c75a2ecbc8173eef248c49ae0d6c2133dffe95047b11d2`.
Evidence includes real pinned worker-thread counting against the SQLite boundary,
source edit during counting, exact61-token response checked independently with
Python tiktoken0.11.0, body-free disk journal/reconstruction, final native write
expiry, and an actual TLS MCP subprocess with cancellation-before-reservation-
reply proved by a ping barrier. Transport fixtures are local, not native-model or
deployed acceptance. Desktop16 passes separately. The combined run passed
backend1911/runtime682 and HTTP31, then failed the routine-history fixture's alpha
late-response assertion. The fixture did not prove the browser had observed alpha:
`refresh()` can return early during an existing poll. The fixture now waits for
the independent alpha accessibility marker before releasing held history; the
original history/no-new-read assertions are unchanged, with no portal-code edit.
Original failure retained in `.local/memory-delivery-combined.log`, SHA256
`7db09ad984f7a47a16b490c3aa2cb8419eb4f8bfcdc60c5d266b5e24a0ef23be`.
Resumed verifier from that fixture exited0 through all remaining browser/native/
shutdown/strict-launcher/service/build stages in `.local/memory-delivery-remaining.log`,
SHA256 `97e7f4f510dec42e689edf80fedc827b93abeacaef0352d4e48ebb01f29fdc1e`.
Host fixture paths `/etc/codex` and `/.sprite` are absent after cleanup.
Final focused122/typecheck pass in `.local/memory-delivery-final-focused.log`, SHA256
`e03e4cb3b20c33ccc8a130fd08875601259318f65517b07e3c595328dfcb9ea6`;
the final journal assertion preserves unknown consumption rather than claiming
completed delivery. No full clean combined invocation is claimed.
Self-review then found that expiry at final emission closed the shared native
connection. Three strengthened assertions failed first in
`.local/memory-delivery-expiry-red.log`, SHA256
`4924b75a13077641450fa0648d76dc671093a03c4fc4a0c36050371b4560dd4a`.
Final delivery now returns a tool denial, keeps the connection usable, and leaves
the reserved charge intact. All122 focused checks and typecheck pass in
`.local/memory-delivery-expiry-green.log`, SHA256
`7647e7d8586a70caa1501b455563dfbfa6831c2eab8486480273f3b5cc7081e1`.
The final denial-wording check passes11/11 in
`.local/memory-delivery-wording.log`, SHA256
`7858fdf106aec642e3bf9f4e41c1a4a6d89336db0654cef41bf0cc4cf5c989ba`.
Source remains verbatim in initial prompts. Next summary projection requires
explicit host read capability as well as persona policy; storage/legacy and full
recovery/settlement remain open. No live accounts/providers or production changes.

Targeted-read control plane (2026-09-24): ordinary authenticated prepare/reserve
RPCs bind an exact admitted pointer, range, model and byte digest. Source revision
and scope filter in SQL before body hydration. Reservation rechecks source and
current task/expiry/lease, then atomically charges initial bucket counts plus
additional envelopes. One body-free runtime_metadata ledger per attempt caps64
read identities; identical replay reconciles without authorizing redelivery.
Policy adoption is explicit; alpha/task-scoped staged credentials stay denied.
This is not a model-facing read tool: host counting, final delivery/replay fences
and summary substitution remain pending. Accounting is versioned exposure, not
exact concatenated/native prompt tokenization. See MEMORY_TOKENIZER.md.

Sixteen focused tests cover cumulative bucket edges, range/Unicode disclosure,
no foreign-body hydration, current authority/source races, replay after expiry,
bounded work, strict schemas, class reconstruction and real SQLite snapshot/reopen.
Token counts in these ledger tests are synthetic arithmetic inputs, not tokenizer
or native-delivery evidence. Initial typecheck caught widened tokenizer literal
typing; corrected the preparation return type rather than casting away the check.
Integrated backend1909/runtime670/HTTP31/native service pass in
`.local/memory-read-integrated.log` SHA256
`44216e5145f0584377fe1390b10a0a35160b7cca27f58861ba1c954f37853d56`.
Final SQL-before-hydration test and code pass backend1910/typecheck/build in
`.local/memory-read-final.log` SHA256
`7cce4c576301209c805f9e655a9d4e7c08e50d1536a4aeb253c381ea7430ac31`.
The full combined verifier predates this unit; these are segmented checks.
No inference, live accounts/providers, deployment, UI or production gate changes.

Owner summary adoption (2026-09-24): optional memory.put summary metadata has
schema_version1, bounded text and a digest over the exact resulting revision and
source fields. Wire algorithm and limitations are in MEMORY_TOKENIZER.md. Only
explicit false constraint classification qualifies; inherited true/omitted flags
do not. No model-facing mutation is added. Legacy omission drops stale summaries;
existing canonical expiry purge covers current/revision/command summary content.
Raw source stays in context, counted alongside metadata; this is not prompt
compression, a retrieval tool, fidelity validation or a summary UI.

Tests first:12 expected failures before the schema extension; five malformed
inputs already refused. Final19 tests cover binding changes (including canonically
equivalent but byte-distinct Unicode), inherited constraints, revision adoption,
legacy invalidation,2000/2001 astral limits, zero wake/work and expiry purge.
Backend1894/typecheck, HTTP31, migration/persistence checks and build dry-run pass.
Runtime670 and credential-free native service also pass. Their evidence:
`.local/memory-summary-runtime.log` SHA256
`a7ee70aa8877f2e97bc47bd34f96873f0dac444f739a428076b596a0b5e5aa94`;
`.local/memory-summary-native.log` SHA256
`ec0c7d5c1dbcae2c88681caedf2110a454106fe6ee24838e8cb55ca9600ffb54`.
The earlier full combined verifier predates this
localized contract unit. No UI changes, live account/model/provider calls or gates.
Evidence `.local/memory-summary-check.log` SHA256
`d780b90781df17e222390fc67b3929a56a98e9046c17529eb5ba2ce2a96e043d`;
intentional red `.local/memory-summary-red.log` SHA256
`39e5b6dc841273756651f70316a765e8e767c00ea2c033d809696c95fa0c8b09`.

Indexed pre-claim memory reads (2026-09-24): schema14 adds the active-memory
scope/created_at/id partial index. Two or three exact-scope queries return at
most65 records each; a deterministic merge selects at most65 before JSON parsing.
The existing64-record complete-or-block gate includes expired records as work;
deleted/foreign-scope records are excluded. Unlimited legacy calls retain their
full eligible result. Neither index construction nor storage/legacy snapshots
are bounded by this change. No record truncation or constraint authority change.
Migration verifies canonical index SQL, refuses conflicts, and rolls back index
creation on version-write failure. Export/import and backup retain older pins;
schema14 canonical SHA256 is
`1fe0bfe3a7be6a29c66dc3b73bb3b8974de03fbda7773fe921c50e7b19558ddb`.
Raw schema SQL SHA256 is
`15bb79308fca82dc553445cd7f4ce7e556c5adae390b6f136ce619e26bdc2e54`.

Old OR-query implementation fails both new bounded-read tests. Final focused32
and backend1875/typecheck pass. Node and real local workerd plans both show
SEARCH using objects_memory_scope without full scans or temporary sorts; this
is query-plan evidence, not a deployed CPU/latency threshold. Actual Worker
v12→14 migration/reopen, HTTP31, backup/restore drill, native service and build
dry-run pass. Full `bash scripts/verify-codex.sh` PID833755 exited0:
backend1875/runtime670, all browser/native/shutdown/strict-launcher/service
checks and build dry-run pass. Separate desktop install/tests pass16/16.
No remaining workerd processes or host `/etc/codex` and `/.sprite` fixtures.
Combined log `.local/memory-index-combined.log` SHA256
`bec01da215678a67d0c4537248001a03361fbafc8508e4de570a05775e30a47f`.
No push/deploy or production flag changes; no live account/provider/model calls.
Evidence: `.local/memory-index-backend.log` SHA256
`03e4a1f5991196d862d6232ba4c9ed13d77a5273c0a143ecc5d3517b8692900b`;
`.local/memory-index-integrated.log` SHA256
`049b9b6c80d8ace010a5cf4ffd1b6b6b4708d283d0da1aa9d5f1e6dd7c6ac9d7`;
`.local/memory-index-red.log` SHA256
`a0fdd92bd2fca017805e6f3b56b162f58bd90dd29aeed96d3beb3df0eb389807`.
Initial compatibility failures in `.local/memory-index-migration.log` remain
retained: missing export pin and stale version fixtures were corrected, not skipped.

Stable memory ordering (2026-09-24): after scope/expiry filtering and work bounds,
preparation ranks by distinct lexical-term overlap with the admitted instruction,
then ID. Terms are NFC-normalized/lowercased runs of Unicode letters/marks/numbers;
matching is literal, not semantic, stemming or language-aware word segmentation.
Only order changes: every eligible record and zero-score explicit constraint is
retained, raw text is unchanged and the exact sorted buckets are counted/digested.
Claim recomputes the same order. Legacy unbudgeted snapshots are unchanged.
Three initial tests fail against age ordering; final tests also discriminate
repeat-frequency weighting, age-based ties and missing Unicode normalization.
Red log `.local/memory-relevance-red.log` SHA256
`167872f52f864555392f7850207ed9d18d03eb3f38bdcbabec21bb9b3e687637`.
Backend1868 and typecheck pass in `.local/memory-relevance-green.log` SHA256
`7b1193d8361166b071fa5f37d67357dcd4607ea607e4e3b62977a06a05eeb406`.
Final stronger query-repetition case, preparation23/typecheck and real native
service pass in `.local/memory-relevance-final.log` SHA256
`39a1c240f63dec8c85ac2afa8d7bc28d3fad808c833cb3e21ee01bb3aa0b02e6`.
The full verifier below predates this localized change; it was not repeated.
No inference on edits, truncation, summary generation, authority or gate change.
Versioned summaries/pointers, targeted retrieval and bounded SQL/storage work
remain open. No UI appearance change, push or deployment.

Ordinary service memory adoption (2026-09-24, verified locally): the
service now always supplies pre-claim counting outside staged alpha, for exact
reviewed names gpt-5/gpt-5.4/gpt-5.5/gpt-5-codex. Unknown names refuse before
claim without prefix fallback. This is mapping, not account eligibility.
The Worker owns source revalidation and visible overflow waiting; no attempt,
native submission or truncation is substituted for failure. A 5,020-token
synthetic global bucket is counted intact and sent for refusal; expected counts
were derived independently using tiktoken0.11.0 encode_ordinary (5,000 text
tokens plus20 framing tokens, scoped empty-array count1).

Service65/typecheck pass in `.local/memory-service-unit-corrected.log` SHA256
`c9f1736b7c01889dabe13ee2fc7ea2fc2a314f1a18c30392ef81057ecf099c0d`.
Actual Codex → host → HTTPS Worker → SQLite passes with memoryBudgetInClaimCustody
true in `.local/memory-service-native-corrected.log` SHA256
`5d712822aef6172eb558561c20517e4b87a3e35472d9e44724eaa5647288e586`.
Full `bash scripts/verify-codex.sh` PID782930 exited0: backend1865/runtime670,
browser/native/service matrix, both warm/background automatic-stop variants,
strict launcher, typecheck and build dry-run pass. Log
`.local/memory-service-combined.log` SHA256
`628e39ff03bf247e7a849bd020f1e13b4e4864c52f5b98344ec4ad5069c966b2`.
Separate `npm ci --prefix desktop --no-audit --no-fund && npm test --prefix desktop`
passes16/16. No remaining workerd process; host `/etc/codex` and `/.sprite`
fixture paths are absent. No UI appearance change, live calls, push or deployment;
production flags remain false. Initial failed evidence below remains retained.

Initial native failure remains `.local/memory-service-native-initial.log`
SHA256 `b958bfde35b9cfb3a85f8b766b8ca9ee874e8905d991d0cd6de2abad09ed214b`,
private fixture `/tmp/hehe-service-native-1UxYWY`. Known GPT-5.5 catalog metadata
enables search/deferred MCP, so the old synthetic fixture could not find its
direct tool. The fixture now uses supported startup model_catalog_json with
tool_mode direct, supports_search_tool false, use_responses_lite false and
multi_agent_version null. This restores its previous direct-tool contract,
not bundled/live GPT-5.5 behavior; no production configuration or dependency is
patched and tool assertions stay strict. See pinned Codex
[MCP exposure](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/mcp_tool_exposure.rs#L74-L95)
and [search selection](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/tools/spec_plan.rs#L650-L663).
Initial added unit tests also failed cleanup ordering; they now stop the service
before shared fixture removal. Failed `.local/memory-service-unit-final.log`
remains retained. Complete-or-block is not full E06: relevance, summaries,
pointers, targeted retrieval, bounded SQL scan/storage and live gates remain open.

Mapping provenance correction (2026-09-24): direct immutable-source reads and
AST dictionary checks contradicted the earlier attribution. Reference `eedc856`
has only `gpt-5-` and cannot map bare GPT-5 or dotted 5.4/5.5. Current upstream
mapping was independently pinned at `4e71bbe0c078468e00fefbf94b39849389f346e5`;
its exact/broad-prefix mappings select o200k_base for those names. Both map a
deliberately nonexistent GPT-5 name too, so neither establishes eligibility.
Source URLs, hashes and limitations are in MEMORY_TOKENIZER.md. No dependency,
reference-version or application mapping change was made by this correction.

Supervisor memory custody (2026-09-24): optional counting receives a supervisor-
owned abort signal. Recovery/disconnect abort it; lease checks fence both count
boundaries and the actual preparation/claim send after asynchronous journal work.
Tests verify independent heartbeat renewal during counting, abort before any
attempt, exact lease expiry and recovery during the post-count journal write.
Deleting the final send check fails that race test by admitting an attempt after
recovery. Restored source passes134 focused tests, full backend1865/runtime661,
typecheck and the real credential-free native service fixture (two local model
requests, native receipt verified, production admission unchanged).
Logs and SHA256:
- `.local/memory-supervisor-mutant.log`: `565b96e3a4862789b833e20aecc8f649c53bf584da8898dbf0b2c540c119a0d2`.
- `.local/memory-supervisor-backend.log`: `df3b254846b7f862d74b90a42c3559af20c1786aa1d7155bbfe08f2d8791ba73`.
- `.local/memory-supervisor-runtime.log`: `2dba50d3e7ecbfc035d986e164d2f9f34759216005f7390893a9706093685e84`.
- `.local/memory-supervisor-native.log`: `8a753beb213685ead6b74990e4bc06102d615e0a2358d2b3d5c927e24929fe44`.
This remains an optional integration seam, not ordinary service adoption or
completed selected-model accounting. Explicit encoding mapping/service wiring
and the remaining E06 summary/retrieval requirements are still open.

Optional bridge memory custody (2026-09-24): an injected counter enables
prepare → count → claim without changing the default/staged service path.
The bridge checks the preparation digest, counts the exact serialized buckets
before journaling claim uncertainty, and compares the returned snapshot and
receipt before native submission. Counting failure has no unbudgeted fallback;
lost claim acknowledgement retains uncertainty and does not recount/reclaim.
Asymmetric scope/constraint/framing tests, empty/no-work cases, overflow,
counter errors, altered preparation/receipt/snapshot and native crash/family
regressions pass:177 Vitest +34 Node tests and typecheck. Log
`.local/memory-bridge-final.log` SHA256
`205e5e97aa64c8ef4c001ab1f9fc8f91e798e9f16031c63d7510d1de00b6321b`.
Service adoption, supervisor lease/abort integration, explicit encoding mapping,
summaries and retrieval remain incomplete; this callback alone enforces none
of them on the default service path.

The preceding protocol/counter verification is now complete in segments:
remaining verifier PID735480 exited0 through strict launcher, all service modes
and dry-run build; final aggregate backend1849/runtime661/typecheck passed.
The original failed browser run is still a failure, not relabelled green.
Logs and SHA256:
- `.local/memory-preclaim-remaining.log`: `c996c05ebd357e27306d2c5f214f6f6b4556921702906186913d3918eef9d6fa`.
- `.local/memory-counter-runtime-final.log`: `60d5511b78f43a5b1e1605bb33b3a41d080329f528477dad1f54ec5f55c708b1`.
- `.local/memory-preclaim-backend-final.log`: `d0ce27fa958115d0daa5a4f977d9f6d6a9d55dde3efd0f045f8dce7a6739b64c`.

Bounded runtime counter integration (2026-09-24): corrected worker deliverycbf320f
is integrated with exact `gpt-tokenizer@4.0.0`, its verified SRI, no runtime
transitive dependencies and no other dependency-version changes. Both MIT notices
are preserved verbatim in MEMORY_TOKENIZER.md. The module owns a worker thread,
caps input bytes and deadlines, handles abort, retains listeners through cleanup,
and rejects unconfirmed termination instead of returning counts. It validates and
echoes model identity only; no selected-model mapping or account admission is
implied. Ordinary bridge dispatch does not call it yet.

Parent inspection rejected the original natural-work termination evidence:20s
subprocess bounds could pass after11s of natural completion. Corrected fixtures
use a nonterminating tokenizer stub and execute no-termination mutants on both
timeout and abort paths; mutants settle their promise but fail to exit until the
fixture's bound kills them. Parent independent40/40 and main-checkout40/40 pass,
plus typecheck. Independent log `.local/memory-counter-parent.log` SHA256
`2fee778581a16580793e8ccf3609f2b7d04a72797eb1b927583a046738bdff74`;
integrated log `.local/memory-counter-integrated.log` SHA256
`7c733016728e1d50b41e5060ce111d5c3db04f84ab3c1c701490b0657c05ab80`.
Original/corrected bundles remain retained; disposable parent review checkout and
install are removed. This additive module is not imported by the concurrently
running remaining native verifier stages. Budget enforcement and E06 remain open.

Pre-claim memory protocol (2026-09-24, verification in progress): authenticated
ordinary-runtime `memory-prepare` returns complete global/scoped JSON arrays for
the next queued task, without starting an attempt or consuming room cursors. It
refuses more than64 scoped rows (expired rows still count against this read-work
cap) or more than131072 combined UTF-8 bytes. The SHA256 binds those exact arrays,
record metadata/revisions, next attempt, run and declared selected model. Claim
recomputes the complete bounded source set inside its transaction; stale sources,
expiry, task or model fail before admission. A valid receipt above4000 global or
8000 scoped tokens instead persists `waiting/MEMORY_BUDGET_EXCEEDED` and an event,
with no attempt or truncation. Oversize preparation persists
`waiting/MEMORY_PREPARATION_LIMIT`. Owner retry remains explicit; passive edits
do not create a run, wake or count request.

This is an **optional protocol foundation**, not enforced bridge budgeting.
Counts are authenticated runtime assertions, not Worker-executed tokenization.
Existing legacy/staged-alpha dispatch is unchanged; alpha, warm/background host
and task clients do not gain preparation authority. Enqueue still captures legacy
context; SQL scan cost, total stored memory, and eligible memory on the legacy
path are not bounded by this change. No summary, retrieval, relevance ranking or
silent constraint dropping is implemented. Model-to-encoding mapping remains
separate from selected-model identity and account eligibility (see MEMORY_TOKENIZER.md).

Boundary/core20, authenticated ingress47, client13 and alpha-denial checks pass,
including both token bucket boundaries,64/65 rows,128KiB/exactly one byte over,
all source mutations/expiry, lease/boot denial, persisted receipt, and cross-task
selection races. Passive edits preserve waiting and runtime metadata; explicit
retry readmits the same run at attempt1. Removing the digest comparison fails five
stale-source cases; restored final focused72/typecheck pass. Reference desktop16
passes separately. Logs: `.local/memory-preclaim-mutant.log` SHA256
`695f9fdd4b926356c9c5dc9e82d03b0b35a2b6b424040046824d8c194b433b33`
and `.local/memory-preclaim-final-focused.log`.

Initial full verifier `.local/memory-preclaim-combined.log` passed backend1848,
runtime644 and early HTTP/browser stages, then failed the existing alpha-session
browser fixture. Diagnostic run captured no click event at a review button despite
the browser click command returning; it failed later at the same review action.
The fixture now scrolls that button instantly, waits two layout frames and asserts
that the real click reaches it, without retrying or bypassing disabled controls.
All alpha-session cases pass independently with this change; no portal code or
behavior was changed. Remaining verifier stages run separately in
`.local/memory-preclaim-remaining.log` (PID735480); do not report a clean original
combined run. Failure log SHA256
`f6fc4e8f4b2a8898fc9d5e935cf1558c4cd4477f168ffb28bc4a61b21a1f5c93`;
diagnostic `.local/memory-preclaim-alpha-diagnostic.log`, passing fixture
`.local/memory-preclaim-alpha-scroll.log`.
The first mock-alpha test failed because its mock had no real custody; it was
replaced by a real HTTP alpha-denial fixture, not a changed production gate.
That failed log remains `.local/memory-preclaim-focused.log`.

Memory scope filtering before hydration (2026-09-24): `Store.scopedMemories`
applies the existing global/persona/routine predicate in SQLite before returning
bodies to `ControlCore.context`. Tombstones and created_at/id order remain intact;
expiry still uses Date.parse, preserving offset and millisecond semantics. Tests
inspect real SQLite returned rows as well as final context for personal/routine
requests, sibling scopes, deletion, exact expiry and one millisecond after expiry,
and explicit constraints. The former all-memory hydration path produces the same
final context but fails both new returned-row checks when restored as a mutant.
No record cap, token budget, new authority, truncation or schema migration; SQLite
may still scan all memory rows and eligible context size remains unbounded.
Full backend1824/91 files passes; final focused57/typecheck pass after mutation
restoration. Logs: `.local/memory-scope-backend.log` SHA256
`7852ce98c67fc463573873f7aa07402cedd6adcce2e9db1b803412f61eeaa6b8`,
`.local/memory-scope-mutant.log` SHA256
`cd5e3e9cb4aaed45a82605f4cf1db3c56659f232ee0d7b001c4caaa36a60e4ef`,
`.local/memory-scope-final.log` SHA256
`4713435789759ab4235553f6ad6c06419ef42d3b6381c14df13aaea3909e03b7`.
Local only; no UI, runtime/provider or production flag change.

Tokenizer harness integration (2026-09-24): corrected worker delivery44b6c08
passed bundle hash/prerequisite/three-file inspection and independent execution
(92 cases, offline23,100-record batch109715ms). Parent then found the named
end-of-text case and seeded pool lacked that literal; a content assertion failed
before restoring the escaped literal. Final main-checkout run passes92/92 exact
Node/workerd parity, all boundary pairs and negative controls; offline23 and full
runtime643 pass. Corpus SHA256 is now
`8504940a4abde48d50b1ce036580808d54e9fa1c6ce44ec655aa0fa682a648df`.
Workerd ready428ms, parity6746ms, batches1/10/100 in1532/11843/115338ms.
JS heap used103796612/total175808512 after load is not total isolate memory;
wall time is not billed CPU, and these observations are not deployed acceptance.
No application dependency adoption or budget behavior change. Do not tokenize an
unbounded memory scan inside claim's SQLite transaction.
Final evidence `.local/memory-tokenizer-harness/2026-09-24T12-36-19-778Z-eacd7b59/`;
log `.local/tokenizer-integrated-final.log` SHA256
`1013cf1d2d355eaf27336b85a4766da4d1cff623bae20f8699b7a58de52be203`;
runtime log `.local/tokenizer-integrated-runtime.log` SHA256
`6f63f42180b190bd6c3c39e8ad416b15fd74c870a6acada7516f64b6670c9795`.
Intentional red `.local/tokenizer-literal-red.log` retained. Original and corrected
bundles and independent pre-fix evidence retained; review worktree removed and no
workerd process remains. Harness accepted locally, broad E06 remains open.

Portal visual refresh and native retry-input evidence (2026-09-24): owner requested
a substantial visual improvement. Three generated concepts informed an independently
written warm-neutral CSS theme; no third-party app code/assets, fonts or dependencies
were imported. Conversation, question, workspace, dialog and narrow states share
the theme; authorization, command handling and visibility rules remain unchanged.
Executed `node scripts/test-portal-{questions,results,profile,roster,memory-search,recovery,skill-review}.mjs`
as seven separate commands: all pass. These exercise literal untrusted text, scoped
answers, stale/offline fencing, exact explicit retries, navigation without mutations,
memory-search scope and narrow overflow. `npm run typecheck` passes. Inspected DPR2
Chromium desktop question/results, narrow answer dialog, narrow memory drawer and
desktop skill-error captures in `.amp/in/artifacts/`. Narrow page remains vertically
scrollable; this is Chromium viewport emulation, not Mac or native-phone acceptance.

`node scripts/test-codex-native.mjs` passes with three new report flags:
freshRetryCheckpointInputVerified, checkpointIsolatedFromUnrelatedTask and
retryJournalReopenDidNotResubmit. After the fixture's real native restart, synthetic
claims pass through ExecutionBridge and CodexAdapter to the pinned native process.
Attempt2 receives an exact checkpoint in a fresh native thread, top-level grants
remain empty despite a checkpoint grant canary, unrelated input excludes the
checkpoint, and reopened running journal custody issues no duplicate claim/start.
This is actual request input evidence, not model judgment, Worker admission,
crash takeover, full restoration or effect settlement. Sleep remains denied.
Log `.local/checkpoint-native-first.log`, SHA256
`efd84619dbb7a15e873c21b9e3572c0c84568277d2b080fbb87d2aa22ae4695b`.
No live account calls, production flag changes, push or deployment.

Disk-restored automatic retry custody (2026-09-24 Asia/Jakarta): the two existing
retry reconstruction cases now use `node:sqlite` backup to create a closed
file-backed snapshot, open it through the existing test database adapter without
schema initialization, and execute only against that restored connection. A late
running grandchild or terminal grandchild with unknown effect evidence blocks
root attempt2 while an independently admitted task completes. Exact old-result
replay, ancestry, checkpoint, attempt and effect rows remain intact. Settling the
running grandchild permits attempt2 with its original checkpoint and distinct
submission key; unknown effect evidence never gains a fabricated resolution.
Closing/reopening the updated file preserves both outcomes and independent task
completion. Sleep denial is asserted specifically for outstanding work/effects,
not idle grace. The original in-memory source remains at attempt1.

Verification: `npm test` passed1822 tests in91 files, covering the shared helper's
unchanged default behavior. After strengthening the sleep-reason assertion,
`npm test -- tests/lifecycle.test.ts tests/recovery.test.ts tests/orchestration.test.ts tests/execution-bridge.test.ts`
passed126 and `npm run typecheck` passed. Temporarily omitting recursive SQL family
checking failed both disk cases at the forbidden retry claim; production source
was restored byte-for-byte before final checks. Temporary databases were removed.
Evidence logs (including the intentional failure) are retained:
- `.local/retry-disk-backend.log`, SHA256 `0f7b71b5ba34fba58326ae2ed4582d80a8e80afee0fb16d2f705da1cff969c1b`.
- `.local/retry-disk-final.log`, SHA256 `d58bb15b64ee5a5268c0c68dcaf1e24b5570b60736050f228a5bcadf6ca2eb64`.
- `.local/retry-disk-mutant.log`, SHA256 `eaee1b7b4f2217ac80776f5b5baf30ed65d67b15786cbd66a21be829efb5ae9b`.

Tests/documentation only; no production behavior changed. Clean SQLite snapshot
restoration and connection reopening do not prove abrupt process-loss recovery,
native checkpoint restoration, provider containment, executor takeover or safe
sleep. No new native/runtime/desktop combined run was needed for this test-only
change; previous application verification remains separate. Tokenizer corrections
stay with their existing worker; no duplicate assignment, push or deployment.

Automatic retry reconstruction contract (2026-09-21): two new cases in
`tests/lifecycle.test.ts` queue a transient root retry, record late child/grandchild
observations, finish the direct child, then reconstruct Store/ControlCore/LifecycleCore
over the same SQLite database. A running grandchild or restored terminal grandchild
with an unknown effect blocks the next root claim. Exact old result replay preserves
the queued state, checkpoint, attempts, effect evidence and native ancestry.
An unrelated queued task still claims/completes; settling the running grandchild
then permits root attempt2 with its distinct submission key and original checkpoint.
The unknown-effect case remains blocked; no reconciliation outcome is invented.

Mutation check: temporarily omitting recursive descendants from the existing SQL
predicate caused both cases to fail at the first forbidden claim. Production source
was restored byte-for-byte and remains unchanged. Final command:
`npm test -- tests/lifecycle.test.ts tests/recovery.test.ts tests/orchestration.test.ts tests/execution-bridge.test.ts`
passed126 tests; `npm run typecheck` passed. Final log
`.local/retry-reconstruction-final.log` SHA256
`3f72d15ac117d89bafb29418bf7a1ecb8ee46a3ea074af84f12933987b0ee600`;
intentional failed mutation log `.local/retry-reconstruction-mutant.log` SHA256
`3d59db5c4ec82a1eac987fe83feb2b570807ec0cdd03ae44ba64440fb2cc5b61`.
This adds contract coverage, not new recovery behavior. Object reconstruction is
not disk reopen, native process recovery, provider containment, checkpoint restoration
or permission to resume/sleep. Full combined verification was not repeated for this
test-only change; the last application checkpoint remains separate below.

Tokenizer harness parent review (2026-09-21, not integrated): the returned
three-file bundle has SHA256
`9cc4ad12cf1b8c8bfdcf6f7f41033cab2da8e1e225ffa53a251312864922cbaa`;
its exact29d8806 prerequisite and scope were verified. Review found unbounded
workerd/inspector operations and fixed failure filenames that overwrite prior
evidence. The existing worker owns corrections, negative tests and a fresh
delivery; no duplicate implementation or application dependency change.

Parent independently ran the original in an isolated worktree with
`timeout --signal=TERM --kill-after=15s 600s node scripts/test-memory-tokenizer.mjs`:
exit0 in167757ms. All91 cases matched official tiktoken0.11.0 exact token IDs in
Node and real workerd; corrupted expectation detected; real memory schema maxima
and supplied one-over variants behaved correctly. Offline harness tests9/9 pass.
Ready534ms, workerd corpus5362ms,1/10/100-record batches1533/14376/129786ms;
used/total JS heap before31941552/34865152, after94784964/169439232 bytes.
These are local wall-time and heap observations, not billed CPU, total isolate
memory, worst-case bounds or deployed acceptance. No workerd processes or
tokenizer temporary installations remained after the run.
Log `.local/tokenizer-parent-original.log` SHA256
`60038f3cd21d1f1605cf70784f93f7cb87963518d19a37c3ad96489769e6b2ac`;
evidence `.local/tokenizer-parent-original.json` SHA256
`48fd57d9fdcb8c5a1235419eee798d1d761d9249071ce4f0470befe807124ccd`.

Adoption decision: do not place full-record tokenization into current admission
transactions. `ControlCore.context()` selects all eligible memories and
`LifecycleCore.claim()` rebuilds this context inside a SQLite transaction;
`ExecutionBridge` serializes the full snapshot. The measured stress batch makes
that direct integration unsuitable without bounded computation. A future design
must preserve exact model/tokenizer and memory revision identity, explicit
constraints, scope/expiry invalidation and disclosed summary/retrieval behavior.
This is an implementation constraint, not a selected cache/precomputation policy
or permission to truncate. Corrected harness acceptance and the connected budget
design remain open; the previously verified application code is unchanged.

Tokenizer provenance follow-through (2026-09-21, no adoption): official tiktoken
tag0.11.0 resolves to [eedc8563](https://github.com/openai/tiktoken/tree/eedc856364506a9d4651645a0290eb0ba81e6935).
Its [encoding definition](https://github.com/openai/tiktoken/blob/eedc856364506a9d4651645a0290eb0ba81e6935/tiktoken_ext/openai_public.py)
pins o200k_base SHA256
`446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d`.
Both the official blob and candidate
[source rank file](https://github.com/niieani/gpt-tokenizer/blob/fb04ebca53f662200e737caefe9a5ef372a5e41a/data/o200k_base.tiktoken)
were downloaded and match that exact hash. This is source-data identity, not proof
that generated JS code or every Unicode encoding result is equivalent.
The npm4.0.0 tarball is9130169 bytes, SHA256
`e50075c9a98389fbe59bf6b42d8d50b49c1cbd7aec6c205bfc28847ee0eeb20a`;
the published SHA512 SRI was verified before inspecting its manifest/notices.
Manifest declares MIT and no runtime dependencies. No package script was run.

Candidate root/source/package MIT notice is copyright2023–2024 Bazyli Brzoska,
SHA256`55c0b09ede96ed11bd312d90b200d74807cad56415cb491a76364e6a537d3b92`.
Official pinned tiktoken root MIT notice is copyright2022 OpenAI, Shantanu Jain,
SHA256`418cb499b436128d653d79941333a5437b7be2ea9213dcc2f04d15d5d2c51d86`.
The complete candidate Git tree and npm archive list only their root/package
LICENSE, with no separate rank-data notice found. Preserve both complete MIT
notices in a future distributed artifact and record embedded-rank origin; finding
MIT text is not a complete legal/redistribution audit or production approval.
Public source/artifact evidence remains under `.local/tokenizer-provenance/`.
No code/data/license file from these packages was added to the application tree.

One disjoint task-worker now owns a repeatable pinned official parity/local-workerd
load harness, using verified29d8806 source; parent retains adoption and integration.
The initial brief's16000 UTF-16-unit label was corrected: Ajv maxLength counts
Unicode code points, so16000 astral characters may occupy32000 UTF-16 units.
Memory lacks the separate32768-byte message limit; test maximum/one-over values
against the generated command validator rather than assuming the browser limit.
No product limit was changed. Broader parity, realistic load/CPU evidence and
parent review remain pending; six-sample evidence is not E06 budget acceptance.

Explicit-constraint representation (2026-09-21, locally verified): owner
`memory.put` accepts optional boolean `explicit_constraint`. Missing fields retain
an existing boolean from the exact live revision; explicit false clears it under
ordinary optimistic revision checks. Legacy records remain unchanged in shape.
Effective values are retained in object revisions without rewriting command payloads.
The flag describes the owner's memory constraint; it grants no tool/action authority
and does not bypass scope, expiry, deletion, restricted-context or model-write fences.
The portal still edits only text/sharing; its omitted field is preserved server-side.
Declaration/clearing is currently an owner API surface, not a new portal control.
There is no classifier or inference from imported text. No budgeting/summary logic
exists yet; the flag alone does not satisfy the no-silent-constraint-loss requirement.

Focused46/typecheck pass (`.local/memory-constraints-focused.log`); final focused3
adds model-write denial (`.local/memory-constraints-final-focused.log`). Initial
red log has two missing-contract failures and one incorrect test expectation for
schema rejection (throws before receipt); that expectation was corrected rather
than changing ingress behavior. Combined verifier PID631959 exited0:
backend1820/runtime620, HTTP/browser/native fixtures, warm/background automatic
shutdown, strict launcher2210 lock probes, every service mode, typecheck and dry-run
build pass. Log `.local/e06-prerequisites-integrated.log`, SHA256
`dd19afe6d31289ff54a66de49e506fa3fdb3d81e2359f3540c8cf96f9e57b8ea`.
Reference desktop16 passes in `.local/e06-desktop.log`, SHA256
`5ae55c8bb5c0ea450c79e8cd7ed2d5ea546bdccd8ecc47b75d2b4c9a61264b0d`.
Real HTTP fixture passes31 checks including owner declaration and preservation on
a legacy text edit, with canonical readback. No workerd process or launcher host
fixture paths remain. Production flags remain false; no push, deploy or live calls.

Tokenizer adoption remains unaccepted. Public source inspection identifies
`js-tiktoken@1.0.21` as dqbd's port, not an official OpenAI JS package; npm gitHead
is `4c8b748e07992c00386f3180af5c574b27b65139` in dqbd/tiktoken. Its MIT notice and
base64-js1.5.1's MIT notice must be retained if adopted (the js-tiktoken npm artifact
does not include a LICENSE file). Narrow lite/o200k_base imports need no runtime
network/fs/WASM. Untrusted strings need `encode(text, [], [])` to treat special-token
literals as ordinary text. OpenAI's current gpt-5 prefix mapping selects o200k_base,
not model eligibility; js-tiktoken's model-name helper does not cover arbitrary
future GPT-5 suffixes. Unicode/regex parity still needs pinned upstream vectors.
Disposable esbuild probe with SQL text loader: current Worker2809443 bytes versus
candidate5144693; gzip313252 versus1458844. This is not Wrangler deployment sizing.
Node constructor probe765ms, heap delta99375936 bytes/RSS delta174780416 bytes,
not an isolate memory measurement. Cloudflare's current limits page lists128MB
per isolate and1s startup; memory/cold-start headroom needs real Worker validation
before adoption. Logs `.local/tokenizer-bundle-sizing.log` and
`.local/tokenizer-sizing-probe.json`; no repository dependency added. Initial
esbuild attempt lacked the existing SQL loader and failed; no result was claimed.
Sources: [dqbd package source](https://github.com/dqbd/tiktoken/tree/4c8b748e07992c00386f3180af5c574b27b65139/js),
[OpenAI model mapping](https://github.com/openai/tiktoken/blob/main/tiktoken/model.py),
[OpenAI rank definition](https://github.com/openai/tiktoken/blob/main/tiktoken_ext/openai_public.py),
[Cloudflare limits](https://developers.cloudflare.com/workers/platform/limits/).
The main-branch mapping links are research references, not an adopted immutable pin.

Alternative disposable probe: `gpt-tokenizer@4.0.0`, npm gitHead
[`fb04ebca`](https://github.com/niieani/gpt-tokenizer/tree/fb04ebca53f662200e737caefe9a5ef372a5e41a),
MIT copyright2023–2024 Bazyli Brzoska, no runtime dependencies. Narrow
`encoding/o200k_base` import with `setMergeCacheSize(0)` and empty allowed/disallowed
special-token sets took152ms for import plus six encodings, heap delta31670144/RSS
70848512 bytes in Node. Full Worker esbuild candidate6223184 bytes/gzip1469583.
The six multilingual/special-literal/surrogate samples agree with js-tiktoken;
cross-port agreement is not authoritative parity. Measurement boundaries differ
(js-tiktoken's figure counts constructor only), and neither is a Worker memory test.
Logs `.local/tokenizer-alt-sizing-probe.json` and `.local/tokenizer-alt-bundle-sizing.log`.
Source inspection finds pure JS embedded ranks, no runtime network/fs/WASM, but
eager reverse-map allocation remains; disabling the default100000-entry merge cache
does not avoid that. Before adoption: actual Worker memory/startup measurement,
pinned official tiktoken differential vectors, and explicit embedded-rank provenance
and notices (package MIT alone is not a completed rank-data license review).
Both disposable installations were removed; repository dependencies are unchanged.
Official reference check via `uv run --no-project --with tiktoken==0.11.0` passes
exact token IDs for all six samples with `o200k_base` and disallowed_special empty
(`.local/tokenizer-official-vectors.log`). This covers English, Indonesian, Chinese,
special-token literals, emoji/combining marks/CRLF and a lone surrogate. It is not
complete parity or a Worker execution test; no project Python dependency was added.

Follow-up local workerd spike with the full application module bundled and a
probe-only fetch handler passes the same six exact-reference vectors. Named user
Worker inspector reports used heap32496344, total heap35028992,
embedder heap386904 and backing storage680893 bytes. Process/readiness wall
time421ms; six encodings11ms. This is not total isolate memory, deployed startup
CPU, free-plan CPU acceptance or realistic multi-record context load. No DO/data
path or provider route ran. Miniflare was disposed and its disposable installation
removed. Log `.local/tokenizer-workerd-spike-verified.log`; preceding failures
(`-first.log`, `-final.log`) retain an obsolete Miniflare constructor shape and an
inspector ws→http listing correction, not tokenizer failures. Actual package
adoption still needs rank provenance/notices, broader vectors and worst-case
context-load headroom; there is no repository dependency or deployment change.

Selected-model declaration prerequisite (2026-09-21): authenticated `claim` accepts
optional `persona_models` (UUID keys, at most256 entries, existing opaque model-name
syntax). Worker selects the claimed persona's exact model, fails atomically on a
missing mapping and writes `selected_model` into the rebuilt run context. The host
captures persona configuration before its first await and uses the same captured
model for native submission. A present returned mismatch fails before submission
while retaining claimed custody; it does not retry or erase the uncertain claim.
Read-only status, grants, native settlement and execution gates are unchanged.
Queued contexts and legacy claims retain their old shape. This requires a matched
runtime/Worker upgrade: an older strict Worker rejects the new claim field; the
runtime does not retry by stripping metadata. Legacy returned contexts without
metadata remain accepted, so this is not a mandatory budget-enforcement gate.
No tokenizer/encoding claim, budget, constraint protection, summary, retrieval or
relevance implementation is implied. Future budgets must address pre-claim context
and missing declarations explicitly; model identity is not model eligibility.

Verification: initial red3 retained in `.local/model-declaration-red.log`; final
backend1817/runtime620 in `.local/model-declaration-checks.log`. The interrupted
process handle disappeared but its complete log was recovered, not rerun blindly.
Strengthened focused33 in `.local/model-declaration-final-focused.log` checks
asymmetric persona selection, host mutation after capture, forged prior context,
actual native model, mismatch fencing, schema rejection and rollback/legacy behavior.
Real workerd→service→pinned Codex fixtures pass in default, text-only and staged
background modes (`.local/model-declaration-service.log`,
`.local/model-declaration-text-only.log`, `.local/model-declaration-background.log`):
claim context contains fixture-model and every synthetic model request uses it.
Final typecheck passes (`.local/model-declaration-typecheck.log`). These are local
loopback fixtures, not live inference. The prior full verifier remains separate.

Cold pending-question recovery contract (2026-09-21), fixture-only follow-through
on local0c5a566: `node scripts/test-codex-questions.mjs` passes18 assertions with
the pinned native executable and synthetic loopback responses. An exact active
question is interrupted by SIGKILL; old PID absence precedes replacement startup.
Same-home `thread/read` → `thread/resume` → `thread/read` preserves the exact
interrupted turn, transitions notLoaded history to idle, recreates0 callbacks,
submits0 model requests during readback and suppresses the abandoned callback's
late answer. Binary/transport hashes are unchanged; native processes and held
connections close and disposable homes are removed. This is a bounded cold-readback
observation, not authenticated inference, live reconnect, safe resume or settlement.
Pinned upstream source agrees that callback IDs/waiters are process-local; source
links and the resulting authority boundary are in CODEX_RECOVERY.md. No production
runtime transition was added: old question custody cannot be rebound from history.
Existing run.recover closes reconciled custody; run.retry starts a fresh attempt
with checkpoint data, subject to existing gates. Drain intent restoration remains
unimplemented. Focused85 question/transport/inspection tests and typecheck pass.
The full verifier already passed the parent checkpoint and was not repeated for
this fixture/documentation-only change; it already invokes this extended script.
Final check also counts denied requests on the replacement connection:0.
Private log `.local/question-cold-readback-final.log` SHA256
`26db541cb30fa56eb7d2566a10be4aeba92874fd071bc5e8b49abaa4ac5ef739`;
trace `.local/questions-proof-1qyzXi/trace.jsonl` SHA256
`5453e8c3fb9d00c3c55648bf20a6e8bfedea43502fc64b581012e5619ce28e3b`.

Host question timeout observation (2026-09-21): runtime adds optional private
`callbackTimeout: {source, observedAt}` to an already-owned question row after an
active binding observes its deadline or that exact transport request's timer fires.
Numeric/string request IDs remain distinct; collateral connection aborts, dependency
failures, successful callback returns and native resolution do not create timeout
evidence. The observation queues behind in-flight journal/control work without
delaying abort or retrying failed I/O. Unbound admission creates no task association.
Offline inspection validates source/time against immutable wait clocks and retains
unresolved handoff status, false resume/sleep permissions and content exclusions.
No Worker RPC, expiry inference, phase transition, native settlement or replay.
Missing markers remain unknown, including crash and failed/late journal writes;
this is partial diagnostic coverage, not full human-wait recovery acceptance.

Verification so far: six initial red discriminators (54/60 pass) retained in
`.local/question-timeout-winner-red.log`. First focused implementation run had
82/83 pass: the existing deadline check could stop before the timer and omit its
observation. Routing that observed deadline stop through the same helper corrected
it; final runtime620 and typecheck pass in `.local/question-timeout-winner-runtime.log`.
Tests cover exact typed timeout winner versus collateral abort, held committed
handoff with no native write, initial journal/control waits, unbound initial read,
one failed marker-write attempt, successful answer one millisecond before expiry,
and malformed/content-bearing inspector metadata. The first full verifier passed
backend1814 but stopped at runtime619/620: a real-time held-handoff fixture assumed
the binding timer always beat a competing bounded wait. A subsequent focused run
exposed the same invalid assumption in the ordinary timeout test. Logs are retained
in `.local/question-timeout-integrated.log` and `.local/question-timeout-deterministic.log`.
The timer-winner and failed-write fixtures now use deterministic clocks with real
FileJournal writes; ordinary real-time cleanup retains its original no-settlement
checks without claiming every competing stop has timeout evidence. Focused85 and
typecheck pass (`.local/question-timeout-deterministic-final.log`). Full verifier
PID576909 exited0: backend1814/runtime620, HTTP/browser/native fixtures, warm and
background normal/pending auto-stop, strict launcher2242 lock probes, all service
modes and dry-run build pass. Warm pending backstop stopped at expiry+30001ms.
Reference Electron shell16 also passes; this is not Mac acceptance. Host fixture
paths `/etc/codex` and `/.sprite` are absent afterward. No live account/provider
calls, deployment or production-gate changes. Full human-wait recovery, native
termination coverage and safe restart/sleep remain open.

Private evidence SHA256s:
- `.local/question-timeout-integrated-final.log`: `904eb1cf52ae4d2406c43167ea92a2ecb09f5919d63d8c1e7721d4adad9ea1ae`.
- `.local/question-timeout-integrated.log` (failed first combined run): `eb0041748c33ddd8684a3a5a823743dd71d2dd7071091bb0389bef5977be50a8`.
- `.local/question-timeout-winner-red.log`: `a7dd33a804e779965247569e73bf6253143c7a154b321f3442f04eab8bc1af68`.
- `.local/question-timeout-deterministic-final.log`: `9e10ddb254ab50826b8b5a969d0b4d7a0fdf48749b30c0fefde582f81f16e666`.
- `.local/question-timeout-desktop.log`: `cd8dc010a3187677e1723f42db88a2725a718cb6345cf8e82d055dbb257b12ff`.

Pre-handoff question cutoff (2026-09-21): watchdog records optional
`restart_required_at` once for explicit elapsed callback declarations while
pending/answered. Current lifecycle epoch/boot, attempt and native turn must match;
terminated/historical/legacy and response_unknown custody is excluded. Metadata
and run cancellation commit atomically. Existing reasons and cancellation grace
remain unchanged; no sibling watchdog suppression, retry, wake, lock release or
settlement. The question revision increments and the reason survives reload,
resolution and stopped closure. Resolution/closure cannot precede that marker.
Alarm scheduling uses actionable callback deadlines separately from90d retention.
Owner cards distinguish this Worker policy cutoff from observed host timeout or
confirmed executor termination, including saved-but-undelivered answers.

Verification:13 red cases before implementation (`.local/question-cutoff-red.log`),
initial119 focused green, then final `npm test`1814 and typecheck pass. Coverage
includes exact before/at cutoff, both handoff/resolution orderings, earlier owner/
context/tool cancellation grace, current-attempt isolation, fault-injected atomic
rollback, reload, stopped closure and clock regression. The actual Worker RPC/
SQLite alarm fixture schedules a3s deadline and records it without provider work.
HTTP questions and native answer/cancel fixtures pass; these native fixtures are
regressions, not a live5min callback-timeout observation. Dry-run build passes.
Chromium verifies disabled pending answers, saved-answer delivery-window-ended
text and no resend/restart actions. Desktop and390px captures were inspected.
Initial narrow capture was scrolled past the warning; corrected390×1200 capture
shows it legibly, alongside390×844 interaction/overflow checks. No phone claim.
The full long-running verifier was not repeated for this bounded unit.

Private log SHA256s:
- `question-cutoff-red.log`:4190232c546c450dd945d89fce457ff6daf23090d7470a55e9a189bb54b1ac56.
- `question-cutoff-backend-final.log`:8f864b02b99f94ed70cee437fc93d47a98b703f64dac8cb9a646a873225a8c04.
- `question-cutoff-browser-reviewed.log`:d2746eca25d0b7db350b2ca6a2524912cdbb1c3cb6e28ee2e4dee8bd7d034dae.
- `question-cutoff-http.log`:ec7f9e39cddf31053dff851f8b5a62e3ae03faa54bfbe6edf5c0fac58225ed64.
- `question-cutoff-native.log`:022c27a316d088515d7a7cb3f459b3273517a0f7047afc38e351038718da5329.
- `question-cutoff-native-cancel.log`:f71c7c85ecfc6d4cf2240cd9e0fb0ad7e1a09d7b79fa9e402d2adb0832b57a92.
- `question-cutoff-build-final.log`:0f991d031db26cca7e03e1778bac89cc64d0c6f3568aed9a3cace15b77f61c6c.
All logs are under `.local/`. Post-handoff/never-recorded timeout evidence,
durable checkpoint parking and safe recovery remain open. No production gates,
dependencies or live accounts changed.

Connected question deadline (2026-09-21): host-generated `callback_deadline_at`
now carries the frozen, attempt-clamped callback deadline through the runtime
wire contract into Worker question custody. Expiry is the minimum of that value,
record time +15min and attempt deadline. Native text cannot declare it; delayed
recording does not restart it. Reload/idempotency preserve it, fresh expired or
malformed declarations reject, and stored expiry +1ms beyond it is corrupt.
Legacy records retain their shape/window; no database migration. Update the
tested Worker/runtime pair together: older Workers reject the field, with no
stripping/retry fallback. Host/Worker clock agreement is required. This bounds
answerability, not connection availability, settlement, restart or safe sleep.
No sibling watchdog suppression or new timeout recovery state is implemented.

Verification: runtime/core red discriminators preceded implementation. Initial
broad run passed backend1797/runtime616 and typecheck, then native questions
failed HTTP422 due to the omitted wire-schema field. Retained failure:
`.local/question-deadline-native.log`, SHA256
8ce76ff71453fc7ecc4739d94007fe7122427216f367bd48e0afab21c67f85c3.
A contract red test reproduced it; `npm run generate:contracts` updated the
validator. Contracts/core35 and both pristine0.154.0 native question modes now
pass (PID553591 exit0), proving public expiry equals the private five-minute
deadline in answer and cancel paths. Actual HTTPS Worker question checks pass.
Final `npm test` passes1798, `npm run typecheck` passes, and Chromium question
regression passes (PID554281 exit0): exact scoped answer/skip, expired controls,
stale/offline rejection, unknown/reload and explicit stopped closure. Inspected
stale-editor capture shows refusal, not successful delivery. No UI styling change.

Private evidence hashes:
- `.local/question-deadline-broad.log` (runtime616): def263eff47e46726b21f520192a78b972ad2d92714582aa6119740881b7afbe.
- `.local/question-deadline-final-backend.log`: 3c9393cada51ad798aaa4ea79d98e8b3e7da1184e99b145bbaa8121f9666c840.
- `.local/question-deadline-native-final.log`: 66f9b26cc129ef8e92600b6f94929cf75956eda9d503cd6cc6e788375ee6358c.
- `.local/question-deadline-native-cancel.log`: 5247c885583bb3cb8160cdf779fcd454dc772771fd890540ec29ebbc850d7758.
- `.local/question-deadline-http.log`: ec7f9e39cddf31053dff851f8b5a62e3ae03faa54bfbe6edf5c0fac58225ed64.
- `.local/question-deadline-browser.log`: d2746eca25d0b7db350b2ca6a2524912cdbb1c3cb6e28ee2e4dee8bd7d034dae.

Full corrected-source acceptance (2026-09-21): `bash scripts/verify-codex.sh`
on local 6a225a3 exited0 (PID505075). Backend1792/runtime615, all browser/native
fixtures, both warm/background stop modes, real bootstrap/launcher boundary,
remaining service modes and dry-run build pass. Warm normal stopped+482ms;
warm pending backstop+30001ms. Background normal fenced582ms early, then the
manager waited to exact expiry before retirement. Strict launcher recorded2256
lock probes, non-root uid1000, all five capability masks zero, NoNewPrivs1,
authentic root floor and retirement/no replay/unknown custody. Host `/etc/codex`
and `/.sprite` are absent after cleanup. Log `.local/shell-integrated-combined.log`
SHA25627c46fd68186edee86a01092419bb24e4d9f83ebe559d0df011dca6c60447c1a.
This supersedes pending combined checks below, without erasing their failures or
proving live accounts, recursive containment, settlement, safe resume or sleep.
Production flags remain false. The new intake harness is a separate check, not
included in this verifier run: parent review retained the process census before
fault-injected kill and logged workload failures before readback. Eight focused
fault checks pass (`.local/intake-parent-review.log`).

Independent partial intake acceptance (2026-09-21): source ca08154, harness
SHA25612ab57cb0a92c8dbf39bf7954a54baca35afd485be91945112d2303dadfc2159.
`node scripts/test-control-intake-load.mjs selfcheck` exited0: green4/4 with5/5
receipt readbacks, injected3249ms delay aborts without catch-up, over-paced write61
gets RATE_LIMITED, and injected server loss surfaces65 network failures. Child
cleanup confirmed. Log `.local/intake-parent-selfcheck.log` SHA256
c49bce7d8d9920ba18b5457a7d3ee21a8fa5e2f735537b6223424c5e3b8c68aa.
`node scripts/test-control-intake-load.mjs full` exited0 (PID545448):480 submitted
and accepted at48/min over598771ms; no errors,429s,retries or guard activation.
p50 62.317ms, p95 203.475ms, p99 217.767ms, max223.543ms; submission drift mean0ms,
max1ms. All481 canonical receipts match, durable commands481; runs/attempts/
operations/effects/controller-operations/native-task-links all0, STOPPED,
execution disabled, provider unconfigured. Separate disposable burst:70 submitted,
60 accepted,10 RATE_LIMITED, first at index60, one calendar minute, zero network or
other errors. All child processes stopped and temporary intake directory removed.
Typecheck passed before the run. Log `.local/intake-parent-full.log` SHA256
f0d55f8f600efa83b66875b0b32727670eef0cade771c794ce634b514a1c2648.
The submission workload is ten minutes; readback/burst made total elapsed1248773ms.
This is warm local48/min measurement, not SPEC5writes/sec, deployed reliability,
or cold-start latency acceptance. The enforced60/min owner limit was unchanged.
Worker disclosed earlier deleted failed evidence: first cold smoke p95 1774.7ms,
and a later failed run with an incorrect rolling-counter assertion. Those artifacts
cannot be audited and are not acceptance evidence. Parent corrected-source runs
above passed on their first invocation; future failures remain retained.

Retirement correction parent integration (2026-09-20): amended worker patch
SHA256293b3a2b37b3d808bef4631c89ba55d3e24216bc88529365eca8620d7a1354cd
applied to localfc60892. Parent requested supported abortable-delay listener cleanup,
abort refusal before inspection and after its await before retirement dispatch.
The manager waits to the immutable millisecond expiry; it does not renew auth,
retry the read/launch, or weaken identity/stop/lock checks. Parent focused19 and
typecheck pass. Real native normal mode passes with automatic stop539ms before
expiry, then dual-lock retirement; one native launch, recovery_required/STALE_EPOCH,
no second envelope. Log `.local/retirement-parent-native.log`, SHA256
a76bdf518d7568e51ca056f1ac113dcf897616442a6adaac15fb95c8d82179ab.
Pending mode also passes: timer+30000ms/finally+31133ms, same retirement/no-replay
and retained unknown root. `.local/retirement-parent-pending.log`, SHA256
c53c234bcf3176b9d27413fcb39b965ec0e4f886740a46c3d5cd7835cf5839cd.
These two modes remain in-process entry/staged readback evidence. Combined
acceptance remains open. Parent rejected fixture-only pre-clearing and integrated
a reusable production root-to-owner startup helper plus launcher readback guard
(worker patch SHA25627b0e8ed4fb1fc63e3eec2a61d0a22cacce7ed8ea17c90747266d3678a2f9916).
The userns proposal zeros caps but maps actual root paths to65534, which fails
unchanged root-owned floor inspection. No ownership check is weakened.

Real launcher parent pass (2026-09-21 Asia/Jakarta): same production bootstrap
now precedes the fixture's non-root manager/default entry. All root floor/socket
mounts remain in the disposable private namespace. Parent16 launcher/bootstrap
contracts pass with0 skips. Added integer-overflow identity negatives (red before
length-bound fix); composition scratch now stays under the test cleanup directory.
Private root needed Debian's standard awk alternatives link; no binary stub or
privilege bypass added. Actual entry/npm/native PIDs446713/446748/446755 observed
uid1000, five zero masks,NoNewPrivs1; real floor/readback before ready;3 model POSTs
with held child,2150 lock probes, expiry-driven exit+697ms, process absence before
successful lock acquisition, real manager retirement/no replay/unknown custody.
Log `.local/launcher-parent-native.log`, SHA256
9926f5937aec00e252e489dcb2604a8e5bdcf6b3796194c0e890a501f63f58f9.
Host `/etc/codex` and `/.sprite` remain absent. The supported-loopback/catalog
session-arguments wrapper stays labelled: no production configuration, recursive
containment, settlement, safe resume or safe sleep proved. The strict fixture is
now in the combined verifier. Production Service registration remains unchanged.

Fresh combined run (2026-09-21): source
`aac8da0746c70889721ad15f57c2584ec68ac299`, PID458949 exited1.
Backend1790/runtime599 and earlier fixtures passed, but warm pending-maintenance
failed before later Stage B/strict-launcher/tail checks: timer stop1789926402448
preceded expiry1789926372449 +30000 by1ms. Log
`.local/launcher-retirement-combined.log`, SHA256
c67aaf9314190296e47d8bbe7280ed49e699ba2a57803457c164a68b66d931f2.
Parent added a deterministic early-callback discriminator: timer queue fires while
policy clock is1ms short. It fails before the fix, then passes when the production
callback rechecks the immutable grace deadline and rearms only its remainder.
No fixed extra grace or softened assertion; operator abort/final cleanup unchanged.
Focused5 and typecheck pass (`.local/grace-deadline-{red,green}.log`); native and
broader verification subsequently passed on local b8c1136: runtime600/600, no
skips; corrected native tail from warm pending through build exited0. Warm pending
stopped at +30001ms; both background stop modes, strict launcher (2260 lock probes),
15 service modes and build pass. This is tail-only, not a fresh full verifier pass.
Logs `.local/grace-deadline-runtime.log` SHA256
76c6ff0b7ac371f0f6442467385ae5380f7b10086a868d43c10e3c5f22791866 and
`.local/grace-deadline-native-tail.log` SHA256
a20c48b39916ce6915a9fb73a74121379008161b2a1a811463f0748d37aa4cae.
Earlier failure evidence remains retained; reference desktop tests16 pass separately.

Shell-window parent integration (2026-09-21): verified worker patch SHA256
7acced1ccdc540dea86f5dbf675a5bf6770568e43963650a8a07cecb4a422745 from exact
aac8da0 source applied after native-tail exit. Optional trusted host configuration
`shellOperationTimeoutMs` (120001..600000) affects only clocked command operations,
clamped to the attempt deadline. Defaults, legacy unclocked records, other tool
deadlines, grants, settlement and sleep remain unchanged. Parent tightened test
identity/clamp assertions; operations/service96, SQLite watchdog10 and typecheck
pass. Log `.local/shell-timing-parent.log` SHA256
f739754d8b3cede5d325dce49ca5f9cd8935694d3796255b603a4f0ed1a7c341.
Fresh full combined acceptance remains open. No production flags changed.

Authorized correction wave (2026-09-20), exact sourceba8d174: owner permits local
Hehebot launcher privilege-drop and expiry/retirement fixes, not dependency/Codex
patches or relaxed assertions. Disjoint implementers received verified complete
bundle SHA2563616a11201014201781d980ec01c3b6510c0af698316ed03196d63d92bd5a546.
Parent ran entry/floor contracts30/30 (`node --test
tests/runtime-owner-alpha-warm-entry.mjs tests/runtime-owner-alpha-launch-floor.mjs`),
log `.local/runtime-corrections-entry-contracts.log` SHA256
0411cf1ecadd6a1d0d506f4bfafa9c6c2267819bb14c79509e459fb5c19a42c8.
An independent subprocess negative control executes the exact strict fixture
lock-observer expression: each lock returns73 while held, returns91 when available
but its monitored synthetic process survives, and returns0 only after that process
exits. Log `.local/runtime-corrections-lock-negative.log`, SHA256
5cd5b3f08848ac34ddf781ab4eba8429cbf75adbe487eda15ff7dae2a2498169.
This validated the observer, not native cleanup or the full launcher. At that
checkpoint no runtime correction was integrated; the later parent passes above
supersede that state without erasing the earlier failures.

Partial verifier continuation (2026-09-20), source
61d6198036f5abd9ceee1f0557e3a7f59f8e0346: extracted only the commands from
`node scripts/test-codex-background-auto-stop.mjs --pending-maintenance` through
`npm run build` in scripts/verify-codex.sh and ran them with `bash -ex`.
Exit0; pending-maintenance, all15 service modes and dry-run build pass. The full
verifier's final success banner was deliberately excluded. Log
`.local/stage-b-verifier-tail.log`, SHA256
d7a0bc1d5b17edd47563d90d10580e7a3d46787bb61c9f28027397117a1ed263.
Pending mode records one native start, three model POSTs, timer stop at
expiry+30001ms, deferred release at +30256ms and production finally at +31257ms;
both PIDs absent before release, retirement reported, no replay or settlement.
This fills the unexecuted tail after the failed combined run below, without
retrying its normal-expiry failure or changing runtime source. It does not close
the finite wave, launcher acceptance, F3, containment, safe resume or sleep.

Real launcher slice (2026-09-20), based on local2a33854: standalone
`scripts/test-codex-launcher-boundary.{sh,mjs}` is implemented but NOT accepted.
Private mount/network namespaces with tmpfs root/pivot_root supply actual root-owned
floor files and an actual namespace-local Tasks Unix socket. The launcher/default
entry/service/native are unchanged; a labelled exec wrapper adds supported synthetic
loopback/catalog session flags and privately captures native stderr. Native launches
as uid1000. Actual entry reaches ready, proving its real managed-floor/readback gate
ran; strict process inspection then fails on CapBnd=000001ffffffffff. Other sets
are zero and NoNewPrivs=1. The exact production setpriv invocation reproduces this
outside the fixture (util-linux2.38.1 exits0 with bounding set unchanged). No
privileged pre-clearing is used to hide that behavior; no runtime/dependency patch.
Log `.local/launcher-boundary-pivot.log`, SHA256
5182b2b7e77c864fddb1491e00c6ead70884ccd432d7efd524a8bdfba1249c34.
The initial chroot setup prevented nested user namespaces; host probes succeeded,
and replacing chroot with namespace-local pivot_root fixed that fixture error
without kernel changes. Host /.sprite and /etc/codex remain absent/unchanged.
`--probe` namespace check and32 existing launcher/floor tests pass; syntax/diff clean.
Latest code only narrows failure diagnostics to capability fields; the full failed
log predates that formatting-only change. Lock lifetime, automatic expiry, manager
retirement and uncertainty assertions after the CapBnd gate remain unexecuted here.
Not in combined verifier. Strict acceptance needs a separately reviewed privilege
boundary correction, not a weaker assertion. This is distinct from the timing
failure below and neither demonstrates recursive containment nor safe resume/sleep.

Latest combined verification (2026-09-20), source
11deb67817776d3be4775606c5f73f3d4dd48b24: FAILED, exit1 at normal Stage B
auto-stop retirement. Log `.local/stage-b-final-combined.log`, SHA256
c83ee88de94784dd5d83929366de6ec4bbb6b0882a4b6656d8f3a583e240fe0b.
Backend1790/runtime585, crash readback, both warm stop modes and background
browser/native passed before this failure; later steps were not executed.
Frozen expiry 13:35:55.888Z; heartbeat401/production stop at 13:35:55.567Z;
stopped report at .596Z. The immediate manager inspect refuses before expiry,
so wake result is LAUNCH_REFUSED_OR_UNKNOWN, not RETIREMENT_REPORTED.
Retained service journal is recovery/nativeStopped=true. A later read-only
dual-lock `--inspect-locked` over the identical config/digest passes. No retirement
was manually submitted, no replay or runtime/auth change made. The second recorded
stop at .868Z is failure cleanup, not production stop evidence. This contradicts
unconditional retirement acceptance for fractional-expiry normal runs; earlier
targeted passes below do not close the finite wave. Preserve the failure rather
than retrying to obtain a favorable sub-second schedule.

F3 Stage B automatic-stop integration (2026-09-20): verified single-file patch
SHA256 5481e845faca2281c2ebc50abc0c71e480cf80fd5b6984bc1a900f96d8bd03e0.
Parent reviewed and ran both real-native modes. Normal production stop is
expiry+139ms (ready/failed/stopped); pending-maintenance backstop is +30001ms,
both executable/launcher PIDs absent before deferred release, finally +31263ms
(ready/stopped). Both have one native start/three scripted model requests,
exactly one real Worker wake, immutable generation/manifests, recovery_required
STALE_EPOCH root custody, no second launch envelope and manager retirement using
the actual dual-lock inspect subprocess. No test-owned stop satisfies success.
Related47 tests, typecheck and syntax/diff checks pass. Logs:
`.local/background-auto-stop-{parent,pending-parent,contracts,typecheck}.log`.

Review changes: exact version check before staging/launch, strict POST path/body
checks while retaining harmless GET404s, and acceptance of the genuine clean
single-finally-stop path when the supervisor fences first. No runtime/auth change.
The held child is observed active before expiry, not proof of family settlement
at stop. Entry runs in-process (not the setpriv launcher); one configRequirements
readback/floor is staged, account/model/provider seams synthetic; pending await
is injected, not live I/O. Both modes are now in the verifier. Prior full1790/585
pass predates these and crash-readback test additions; their focused runs pass,
not a newly claimed full-suite rerun. All delegated fixtures are integrated.

F3/E02 native crash-readback integration (2026-09-20): verified delivered patch
SHA256 e41568444223d80da4628869c29183bf1178e6eb4d9662f1e05fcc03c3b08307.
Actual pinned executable SIGKILL occurs with a held synthetic child model request;
both original executable/launcher PIDs are absent before replacement over the same
disposable native home. Supported thread/read returns the completed root's exact
text and the child's interrupted state, preserving identity/spawn custody, leaving
effect settlement unproved and sleep denied. Three model POSTs before/after,
four read-only RPCs, crossed identity rejected before read and duplicate readback
without journal rewrites. Parent first rerun reproduced worker evidence, then
tightened blocker reporting to fail the regression and independently attested/stopped
the replacement native executable, not just its npm launcher. Strengthened fixture
passes with replacementBothPidsGone:true; 121 related tests, typecheck and shell
syntax pass. Logs `.local/crash-readback-{parent-final,contracts,typecheck}.log`.
Added to combined verifier; preceding full1790/585 result predates this test-only
addition. This is one abrupt-process-death case, not power-loss, provider takeover,
safe resume, external effect reconciliation or recursive settlement acceptance.

Stage B runtime integration (2026-09-20): delivered patch SHA256
5b82dec794dc076745043dc9f06a0c4db80cc73e16122b9ce37b616141885f1d verified
against exact c35e118. Versioned background binding, manager and separate task
credentials now compose with the existing finite control/portal contract. Parent
restricted coverage receipt settlement to status/independent roles and added
malformed/cross-turn/nonterminal/descendant/legacy-role rejection coverage.
Focused runtime tests 15/15, full runtime 585/585 and typecheck pass.

Parent added actual Chromium submission/reload/cancellation to the native fixture:
one pristine Codex 0.154.0 process, six scripted model requests, three distinct
root threads/grants, Worker alarm-driven wake, S visible while A's child is active,
B's own read-only routine call, frozen status context, and exact task-card/dialog
A-family cancellation leaving S/B completed. Passive reads and exact receipt replay
cause no additional work. Exhaustion/reload retain exactly three owner texts and
one canonical S/B reply each; composer disabled/readOnly with runtime-banner
aria-describedby and role=status. Both final DPR2 captures were inspected:
`.amp/in/artifacts/background-manager-{status,exhausted}.png`.
HTTP and browser runs exit 0; logs `.local/stage-b-{native-parent,browser-final}.log`.
The combined verifier now includes `test-codex-background-manager.mjs --browser`
and exits0 in `.local/stage-b-integrated-combined.log`: 1790 backend and 585 runtime
tests, setup13, backup drill, warm normal/pending-maintenance shutdown, Stage B
browser/native, remaining service fixtures, typecheck and dry-run build all pass.
The latest regenerated exhausted capture was re-inspected. Electron clean install
and tests separately pass16/16. Integration commit is local 6574cf4; nothing pushed.

Evidence boundary: loopback model/Sprite seams and staged floor readback are
synthetic; authenticated real accounts/providers are unverified. Fixed A/S/B
ordinals are not general intent routing. Post-expiry stop is explicit in this
fixture, not an automatic timer claim. Retained A/child uncertainty blocks sleep;
S/B root receipts do not settle A's family. No production gates or live authority
changed. Prior implementor wave is integrated; two new bounded stop/crash fixture
assignments remain unverified. Their return alone will not close acceptance.

F6/E13 setup integration (2026-09-20): verified worker patch SHA256
b1a29ecbc50a5875108424885b0e8e506385318bac4249554e7b1dad18e522c1.
Pinned candidate installation/validation now precedes replacement, with prior
node_modules rollback on final validation failure; unrelated config stays intact.
Parent reproduced two missed failures: expected version output plus exit17 was
accepted in staging and after swap. Explicit exit-status checks now reject both,
preserving prior bytes/executable. Added repeatable before/after swap retained-state
recovery tests. `node --test tests/setup-codex.test.mjs` passes13/13; syntax/diff
checks pass. Logs `.local/setup-safety-parent-{red,green}.log`. Two actual disposable
installs passed with `codex-cli 0.154.0`, no scratch leftovers; no account calls.
Concurrent/active upgrade and fsync/power-loss durability remain unsupported.
Combined verifier still running; its earlier setup step predates this integration.

F3 pending-maintenance integration (2026-09-20): verified patch SHA256
eecf99c5e0db81725fa8810b718d5560c1eefe02d644ed7ea6848c8f76157776.
Parent real-native run passed: production deadline stop at expiry+30000ms;
launcher and attested executable absent before deferred release, no premature
stopped report or entrypoint completion; finally stop +31223ms, one native start,
exit0, retained recovery identity, no replay/settlement. Normal-mode regression
passed (expiry−181ms); related runtime tests46/46, typecheck and verifier shell
syntax passed. Logs `.local/warm-pending-{parent,normal-parent,contracts,typecheck}.log`.
Added new mode to combined verifier; full suite not rerun for this test-only
integration. This is an injected maintenance await, not observed live I/O failure.
No production runtime/auth changes; dual locks and recursive settlement stay open.

Scheduled F3 follow-up (2026-09-20): source review of the real entrypoint confirms
the independent timer runs while service.maintain is awaited, but stopped reporting
waits for that await to finish and finally to run. Reused the completed shutdown
implementor for a real-native --pending-maintenance regression on exact d8124cf.
Its explicit deferred-await fault injection must distinguish native stop from
entrypoint completion; it cannot claim live I/O cancellation or settlement.
Assignment only, no new verification result. Stage B runtime ownership unchanged.

F3 automatic native stop integration (2026-09-20): worker patch SHA256
6667a56eda297038519a98837908416ce8ca157ee98d8fefcb3a9c6495524a1e verified.
Parent first reproduced stop at expiry−154ms, launcher exit0. Review found the
transport PID belongs to the npm launcher, so parent added Linux process/exec-path
attestation for its actual pinned Codex child and requires both PIDs absent after
production stop. Strengthened rerun passes: one start/model request/canonical
result/wake, one stop at expiry+598ms, launcher exit0 and actual native PID absent.
The retained journal stays recovery/nativeStopped with exact generation identity;
no test-owned stop satisfies success and no effect/descendant settlement is inferred.
Logs `.local/warm-auto-stop-{parent,native-pid,contracts,typecheck}.log`; related
runtime tests 46/46, typecheck and syntax pass. Added to combined verifier; full
suite not rerun for this fixture-only integration.

Important corrected expectation: warmTimestamps floors JWT exp to seconds with
zero tolerance (also used by background grants), so host authentication can fence
up to 999ms before the precise policy deadline. Lease/phase fencing applies at
expiry. Responsive maintenance therefore reaches automatic finally-stop near
expiry, not a guaranteed expiry+30s reconciliation window. The rerun reports
EXECUTOR_FENCED then stopped, preserving uncertainty. The independent 30s backstop
can still matter for pending I/O; this test does not cover that case and does not
prove it unreachable. AUTH_SETUP corrected and Stage B implementor notified.
No production auth/runtime change. Floor filesystem/configRequirements readback,
account/model/provider are explicit synthetic seams; live eligibility/containment,
dual launcher locks in this composition and recursive settlement remain open.

F6/E10 backup drill integration (2026-09-20): verified worker patch SHA256
762dad71f08e3342326342eb7bf2045fb5edf85505364bd801bbd04d02362c9a and inspected
the public-API composition. Real SQLite snapshot and pinned age encryption/decrypt
retain byte-identical snapshot files and exact recovery/effect/lock/operation
blockers; wrong-key and tampered-ciphertext refusals publish no staging result.
API/CLI inspection is read-only and reports external readiness unverified and
coordinated restore false. Parent corrected the fixed October 1 retention clock
and removed optional raw-error debug logging. Current-clock and simulated
2027-02-03 drill runs pass, plus 95 related tests, typecheck, shell syntax and
diff checks. Logs `.local/backup-restore-{parent,contracts,typecheck,future-clock}.log`.
The drill is now in verify-codex.sh. Full verifier not rerun for this test-only
addition; preceding full result remains separately dated below. No production
code change, native/browser restore, external key-custody or activation acceptance.

Parallelism checkpoint (2026-09-20): owner requested continued implementor progress.
Existing runtime/automatic-stop assignments received continuation instructions.
Source inspection found separate backup creation/decrypt and semantic-inspector
tests, but no composed encrypted restore drill preserving unresolved custody.
A third implementor owns only new test files for that F6/E10 path from verified
local 2713a38 bundle. This is an assignment, not new backup/restore acceptance;
native/browser state, external key custody and activation remain outside its scope.

Owner follow-through (2026-09-20): `node scripts/test-codex-native.mjs` passes with
`coldMissedChildInterruptionRecovered:true` and `coldChildCancellationNotReplayed:true`
in `.local/cold-child-recovery.log`. A separate host journal captures actual
pre-interrupt parent/child observations and persists the one cancellation ACK,
but receives no later notifications. After confirmed graceful native exit and
a new pristine 0.154.0 process, read-only `reconcileChild` recovers the exact
interrupted child. Crossed root/child turn identity rejects before native read;
duplicate history cannot write. Parent identity/spawn custody remain unchanged,
effect settlement remains unproved and sleep stays denied. This verifies missed
event recovery, not a process crash/takeover, live model, provider containment or
recursive family settlement. No production runtime change was needed.

Automatic real-native expiry/stop is independently assigned to a new-script-only
worker from c35e118, disjoint from the active Stage B runtime implementor.
AUTH_SETUP now contains the bounded two-message trial procedure and exact stop
conditions; SETUP no longer incorrectly says deployment has never happened.
The procedure preserves predecessor retirement, immutable generation/budget and
all live authorization gates. It is not evidence that current targets are ready.
Combined verifier exited 0 in `.local/followthrough-integrated-verify.log`:
1790 backend/570 runtime tests plus browser/native/service fixtures, typecheck
and dry-run build. The new cold-child flags and real warm wake-first browser
flags pass in that run. Focused adapter/process-crash tests pass 37/37 in
`.local/cold-child-recovery-contracts.log`; Electron reference shell passes 16/16.
Stage B control and portal are included, but its not-yet-delivered runtime is not.
Upstream wappmcp source recheck found no later default-branch fix for the existing
recent-message SDK incompatibility; source links are in CONNECTOR_READINESS.
Runner discovery returned none, so actual Mac acceptance remains external.
No live operation or publication occurred.

Stage B portal integration (2026-09-20, local befc7d0): patch SHA256
7bef3d8fe2e5e04866d82c4708bd8c8c53f33c7f3a89582b2caeb310d05ee783
reviewed. Parent regression reproduced enabled Send with conflicting legacy
session-only custody; fixed that plus same-page latched warm→background transition.
Rendered status-available capture exposed a stale closed-admission error; Stage B
now clears only its prior matching block reason, not unrelated request errors.
Background and warm browser fixtures pass; legacy adoption timed out once with
its conversation/connection guard and passes isolated rerun (both logs retained).
Node syntax, verifier shell syntax and diff checks pass. Pre-first, status-blocked,
status-available and exhausted DPR2 captures inspected; composer disabled/readOnly
and ARIA associations asserted. New browser fixture is in the combined verifier.
Evidence `.local/stage-b-portal-{red,parent,warm,legacy,legacy-rerun}.log`.
Synthetic browser consumer only; actual browser/native assembly remains open.
Existing cancel/follow-up actions unchanged; steer remains execution-gated.

Stage B control integration (2026-09-20, local c35e118): worker patch SHA256
4d8b376fcb8e2da1ddf096430c76453b2a85789bc0d4b3092d15766d8845a9b9
verified and reviewed. Parent reran 8 SQLite/signed-HTTP tests and typecheck;
combined verifier exited0 with backend1790/runtime570 and native/browser/service
fixtures, typecheck and dry-run build in `.local/stage-b-integrated-verify.log`.
This full run precedes the later portal integration. Parent corrected pre-first next_role from
null to background (the original test copied the wrong behavior) and restored
legacy warm custody counting. New background custody uses manifest order, not UUID
order, and excludes observed children from admission counts. Restricted enqueue/
claim context and frozen-summary bytes preserve privacy across reconstruction.
A remains unsettled; only S/B receive exact canonical root-only receipts. Retained
configuration removal denies legacy fallback. Runtime/native and portal workers
now own disjoint follow-through; this does not prove live/native Stage B behavior.

Stage B contract review (2026-09-20): revised single-file delivery SHA256
d511a446c7697af8c388160ab0fb16e8c7aa455a46eeb76af7d75949f1999ef7
verified and applied; parent source review added necessary context and persistence
rules before committing 17954ea. `Lifecycle.claim` rebuilds generic context;
`ControlCore.context` includes historical owner text/previews/child titles, so the
new generation must explicitly select a restricted snapshot at enqueue and claim.
The frozen status summary must persist its bytes, not only its hash. Completion
stores an immutable S/B receipt; root thread IDs are host-asserted because attempts
only store native_run_ref. A remains unsettled and no termination/sleep is inferred.
Control implementation is assigned with SQLite/signed-HTTP and privacy-canary tests;
runtime/native integration remains unimplemented. This is source/contract review,
not executed Stage B acceptance; no production flag or deployed configuration changed.

F1b replacement integration (2026-09-20, local 0ecdc55): reviewed replacement
8eaca10d89070526a8f5210eb0b8d5c74439c5946d26ff6608c36739a82f1ad6.
Callback expectations now read config and durable generation/manifest rows
independently. The manager request seam checks byte-stability before staging;
post-admission empty-session/nonnull-envelope timing assertions are removed.
Parent `node --test tests/runtime-hosted-warm-wake.mjs` passes 2/2 and
`node scripts/test-codex-warm-manager.mjs --browser --wake-first` exits 0.
Forced receipt-observation delay lasts until real alarm wake and native staging;
both turns still complete in one process with exact once-only wake, no duplicate
on replay and reload retention. Pending-alarm manager callback completes without
deadlock. Unknown receipt/delivery outcomes retain intent without retry. Logs:
`.local/warm-wake-parent-{negative,browser}.log`. Representative 2x screenshot
inspected: Connected, exact four messages, exhausted banner, empty disabled composer.
Real Worker outbound fetch is routed to a disposable loopback listener; no live
Sprite/Access/model is proved. Explicit stop still does not prove automatic real
native termination. `bash scripts/verify-codex.sh` exited 0: 1782 backend/570 runtime
tests, browser/native/service fixtures, typecheck and dry-run build. Evidence:
`.local/warm-wake-integrated-verify.log`, with browser --wake-first now permanent.
Stage B proposed wire contract was returned for correction: first-admission order,
actual runtime payloads/full claim context, default-denied effects and preservation
of unsettled A descendants and terminal Stage A custody. No Stage B authority is
implemented or enabled yet. No live operations or production gates changed.

F1b first review (2026-09-19): worker reports positive HTTP/browser real alarm
delivery and two UNKNOWN/no-retry negative tests. Parent verified patch SHA256
3eb7edd449b8d41fffdcf68c5d4a8351ea987563ede9a97cc8d4a8152bbc6d9d,
but did not apply or rerun it. Source review found launchImpl closes over
post-send main-flow receipt/generation/manifest bindings, while the now-real
alarm can launch independently. Post-admission nonnull-envelope and empty-session
assertions likewise assume observation wins the wake race. Production has a
minimum 5-second alarm delay, but browser receipt waits allow 15 seconds; that
delay is not a correctness guarantee. Requested a replacement with independent
callback custody and deliberately delayed receipt observation. This is a test
orchestration finding, not evidence of a production wake defect. No new acceptance
claim or live operation; worker owns corrections and parent will verify replacement.

F1a automatic warm entrypoint control flow (2026-09-19, local): imported and
reviewed tests/runtime-owner-alpha-warm-entry.mjs. Parent focused tests pass 4/4,
full runtime suite passes 568/568 and typecheck passes. Logs:
`.local/warm-entry-parent.log`, `.local/warm-entry-runtime.log`,
`.local/warm-entry-typecheck.log`. No production code changes. Existing runtime
test glob automatically includes the new suite in the combined verifier; the
broad browser/native verifier was not rerun for this test-only addition.
Actual runHostedOwnerAlpha drives the normal deadline loop, independent timer
while start/maintenance awaits remain pending, and immediate operator abort.
Stop dispatch is observed exactly at expiry plus 30 seconds; pending awaits do
not produce false shutdown/settlement reports. Service and native execution are
simulated: no real Codex boot, termination or durable service journal is proved
here. Real explicit-stop journal/dual-lock fixtures remain separate; automatic
real-native termination is still lifecycle acceptance work under F3.

Owner-directed follow-through (2026-09-19): TODO.md now records the ordered F1–F6
remaining queue and explicit exit evidence. Two disjoint implementors started from
the verified local source-custody bundle at 5d45262: automatic warm entrypoint
expiry/grace and real local Worker-to-warm-listener delivery. Neither is complete
yet; previous test totals are not evidence for these new gaps. Parent retains
review, integration and verification. Amp development schedule
b05eb8f2-8407-53d6-a253-e01637ba8f38 was successfully enabled every two hours,
existing-thread mode. Worker results arrive by message, not scheduled polling.
Ready local work proceeds; external-only blockers stop the schedule with an exact
owner action list. No product routines, deployment, spend or live flags were enabled.

Stage A warm composer integration (2026-09-19, local d76a074): parent reviewed
patch 79ff88a29b9df9283ef37d83dc7b4e1012397bb2862c84b57e6f57aef83830e6
and added actual passive-refresh observation and pre-expiry reload assertions.
`node scripts/test-codex-warm-manager.mjs --browser` exits 0: nativeStarts 1,
modelRequests 2, exact two composer commands and canonical replies, independent
task credentials/roots, prior canonical context, same-generation Send reopening,
exhaustion and reload retention. Authenticated assets return 200; unauthenticated
and wrong-owner assets return 401. Zero passive commands, zero page errors and no
pending send storage. Screenshot `.amp/in/artifacts/warm-manager-browser-portal.png`
inspected at 2x: Connected, Chief of Staff, exact four messages, exhausted banner,
empty disabled composer. Evidence `.local/warm-browser-parent.log`.
The runtime combined verifier exited 0 with 1,782 backend/564 runtime tests plus
browser/native/service/build checks (`.local/warm-runtime-integrated-verify.log`).
Desktop rerun 16/16. Final combined verification with both warm HTTP and browser
modes exited 0 in `.local/warm-browser-integrated-verify.log`: 1,782 backend and
564 runtime tests, browser/native/service fixtures and build passed. Fresh final
screenshot re-inspected. assistantOperational, productionAdmission and
modelJudgmentVerified all remain false in the final report.
Fixture identity/model/Sprite/wake seams remain synthetic/manual; explicit
post-expiry stop does not prove automatic warm entrypoint/grace. No live gates changed.

Stage A runtime correction integration (2026-09-19, local): replacement SHA256
31e9722afe28904348a6f449d9da2cd760ccd80d18279e5696d4f0ead670e607
is integrated at e813bbf. Exact manager intent now includes generation.session_id,
tested by full deep equality. Native report uses explicitPostExpiryStop and states
that automatic warm entrypoint/grace needs separate verification. No shutdown
semantics changed. Trailing blank EOF removed. The combined verifier now includes
the warm native HTTP script; parent run is in progress in
`.local/warm-runtime-integrated-verify.log`. Actual warm composer/native work is
assigned separately from the exact integrated bundle, not origin/main. No live
operations or production gates changed.

Stage A runtime first review (2026-09-19, local/uncommitted): imported patch
9aa6dcfc2ca5f7d85cd5907df5a3adfe017ecab006e7fb656a6e899e76adfac7.
Parent `node --test tests/runtime-owner-alpha-warm.mjs` passes14/14 and
`npx tsc --noEmit` is clean. `node scripts/test-codex-warm-manager.mjs` exits0,
nativeStarts1/modelRequests2, with both canonical replies, distinct task credentials,
same generation, replay exclusion and dual-lock retirement checks. This rerun exits
normally; no post-report hang observed. Evidence is in
`.local/warm-runtime-parent-{unit,native}.log`.
Review found manager intent session_id reads the nonexistent policy.session_id,
so JSON serialization omits it; generation.session_id is the correct source.
The reported fixedExpiryStop flag follows a test-owned wait and service.stop(),
not the real entrypoint's automatic expiry+30s stop path. Both corrections were
returned to the runtime worker; no change to established shutdown semantics asked.
The HTTP fixture manually delivers wake and uses scripted loopback model/Sprite
responses. It is not browser-composer, automatic expiry, live provider or account
acceptance. Imported runtime changes remain under review pending replacement.

Stage A portal round-2 integration (2026-09-19, local): replacement SHA256
e6aa804f4eeda6311e8e25cc6b08ea0236d3ab54381da688dbfc36c61a832169
fixes the review findings below and is integrated at ebe78e1. Parent reran the
new warm browser suite and legacy alpha-session suite: both exited 0, including
all three legacy sections. Typecheck passes. Evidence:
`.local/warm-portal-round2-{browser,legacy}.log`. Fresh-page malformed values close
all reads and Send; changed persona cannot redirect the validated read scope.
Generation/count consistency, string timestamps and hidden legacy review controls
are covered. Chromium 390×844 at 2x exercises an actual Send and a blocked exhausted
submit: scrolling114px moves Send from900–945px to786–831px inside the viewport.
Parent inspected narrow enabled/exhausted and malformed captures; the final
representative artifact is `.amp/in/artifacts/portal-alpha-warm-narrow-exhausted.png`.
No layout change was needed for reachability; ordinary scroll-edge clipping remains.
The new browser script is included in scripts/verify-codex.sh; integrated full rerun
exited 0 in `.local/warm-portal-integrated-verify.log`: 1,782 backend/550 runtime tests,
browser/native/service fixtures, typecheck and dry-run build passed. Desktop rerun
passes 16/16 (`.local/warm-portal-desktop.log`). Final exhausted capture re-inspected
after combined run. Existing two-launch composer/native retention regression still
passes. Final operational/production/model-judgment report flags remain false.
The warm summary server is synthetic: this does not prove warm native execution,
provider behavior or live SSO. Local commits only; no publication or activation.
Runtime worker remains active; parent owns subsequent combined composer/native proof.

Stage A portal draft review (2026-09-19, local): patch SHA256
76f4904cb619011833da506cfb8683aa4fd58ed52ff20d2df98289e7a2c50653
was applied temporarily for review and then removed pending correction. Parent
`node scripts/test-portal-alpha-warm-portal.mjs` exited 0; evidence:
`.local/warm-portal-review-baseline.log`. Executing the actual app functions in a
Node VM with browser-state stubs exposed two omitted cases: present null/false/0/empty
warm metadata returns the non-warm sentinel without setting warmSeen/alphaSeen;
changing a bound persona makes warmBlock invalid but alphaConversationAvailable
allows the changed persona and denies the original one. These are frontend admission/
read-gating defects, not evidence of bypassing Worker authorization. Requested actual
browser regressions, strict string timestamps, first-call generation/count binding,
and hiding the legacy review control on warm transition. Parent inspected fresh 2x
desktop available/expired captures and narrow pre-first capture. Narrow Send is below
the captured viewport; worker must exercise scroll/reachability rather than infer it.
No portal code is integrated yet; native/runtime worker continues independently.

Stage A round-2 integration (2026-09-19, local): replacement SHA256
c7dae83f1624b40665ae20203aa009b67db71ea2d2f352f9039b26b32c58503b
addresses all eight findings below and is integrated locally at 63c1421. Parent
typecheck and nine focused suites pass 274 tests. Integrated full backend suite
passes 89 files / 1,782 tests; desktop passes 16/16. Combined browser/native/build
verification exited 0 in `.local/warm-stage-a-integrated-verify.log`: 550 runtime
tests, all browser/native/service fixtures, typecheck and dry-run build passed.
Final report retains assistantOperational, productionAdmission and modelJudgmentVerified
false. Existing hosted-manager browser regression retains two canonical replies,
zero passive launches and reload persistence; this is not the new warm runtime proof.
Focused evidence: `.local/warm-round2-focused.log`; desktop evidence:
`.local/warm-stage-a-desktop.log`. Review worktree initially lacked generated
Cloudflare declarations; `npm run types` resolved that prerequisite failure.
Repeated-body/same-clock admissions now remain distinct, sub-second claims create
no attempts, generation/manifest-1 bytes are immutable, and actual bootstrap-to-warm
reconstruction preserves legacy reservations. Removal and lost lease deny new runs.
Authenticated owner binding is validated and its initialization failure fences RPCs;
broader legacy initialization semantics are deliberately unchanged. Host launch
credentials are activation-bound and stable across reads. Parent fixed one doc
sentence about repeated command-body hashes; code/tests already used the correct rule.
The contract remains default-off, one finite warm revision, two text-only tasks and
no rollover. New disjoint runtime/portal workers consume the exact transferred
fd6f503 source bundle; one-process native acceptance remains next.
control fixtures do not prove live provider/model behavior. Nothing was published.

Stage A control draft review (2026-09-19, local): received154482-byte patch SHA256
4de1b25d4d471302e5fe8d36c5578527b68042760c015bc3a7763c1e4d1ac5d0,
baseline dd3808b. Applied only to isolated `.local/warm-review`, not the integration
checkout. Parent reran the unmodified warm suites:22/22 pass. Two deliberately
asymmetric probes expose missing coverage: repeating the first message body with
a fresh idempotency key returns503 INVALID_CONFIGURATION (validator wrongly
requires distinct body hashes); claiming at00:04:19.900 for fixed00:04:20 deadline
persists one attempt instead of refusing before writes. Logs:
`.local/warm-review-{baseline,identical,deadline}.log`. Probe edits were restored.
Static review also found missing comparison between warm owner binding and actual
authenticated custody, second-admission gate lacking live-lease validation, and
host-token issuance using manager read time rather than activation time. Draft
rewrites its generation row to append admissions and creates waiting runs after
config removal, contrary to the agreed immutable/no-orphan contract. Requested
corrections plus real message-bound predecessor reconstruction, valid legacy JWT
isolation, repeat-text/same-clock and rounded-deadline tests from the control worker.
One finite warm revision remains an intentional Stage A limit, not rollover support.
Runtime/UI assignment and integration remain blocked on correction/reverification.
No live/account/provider operations or production gate changes occurred.

Composer/native integration (2026-09-19, local): GLM worker's two-file patch reviewed,
revised and hash-verified before parent integration. Hosted-manager `--browser` now
drives the actual portal with fixture-signed owner JWT through real authenticated
Worker/SQLite, manager/wake and pinned Codex0.154.0. Two composer sends each produce
one canonical reply; exact browser command bytes/keys replay without another launch,
retirement reopens Send, prior owner text/reply reach turn2, and reload retains exactly
two owner messages/two replies with no pending localStorage or page errors. Passive
portal load/selection/readback makes zero commands/native/model/Sprite calls.
Optional real asset binding uses run_worker_first; unauthenticated/wrong-owner `/`
and `/app.js` return401, owner requests200/nonempty. Parent review corrected a
truthy-Connecting wait and shortened browser session naming before application.
Parent browser and standalone HTTP reruns both exit0 with2 native starts/2 model
requests; eight shared-fixture tests pass. Evidence `.local/p02-{browser,http,fixture}-integrated.log`.
The parent capture `.amp/in/artifacts/hosted-manager-browser-portal.png` was inspected:
both turns and empty composer readable. Runtime recovery/provider-unconfigured labels
describe disposable runtime state, not failed canonical task results. No public UI
code changed. Browser mode replaces HTTP mode in combined verification (HTTP mode
remains separately tested). Full `.local/p02-combined-integrated.log` exited0:
86 files/1756 backend tests,550 runtime, browser/native/service fixtures and build.
Final browser capture re-inspected after combined run. Desktop16/16 passes in
`.local/p02-desktop-integrated.log`. Final report retains assistantOperational,
productionAdmission and modelJudgmentVerified false. Integration committed locally.
No production Access SSO, live model/provider acceptance, deployment or push is claimed.

Native ordinary-owner continuation (2026-09-19, local): existing hosted-manager fixture
now runs two ordinary owner sessions through actual signed local HTTP, real Worker,
manager staging/wake listener, pinned Codex0.154.0, canonical completion and manager
retirement. Exactly2 native starts/2 loopback model requests; second request contains
first owner text and completed reply. Same-key replay between sessions returns the
old receipt without launch or manifest replacement. Both expiries/retirements use
real clocks and stopped journal/dual-lock observations; no clock override for rollover.
Scripted model/Sprite transport is not owner SSO, model judgment or provider acceptance.
Evidence `.local/owner-continuation-native-final.log` (passed).

This integration reproduced two bugs absent from the earlier HTTP-only fixture:
heartbeat extended epoch2 lease past its fixed expiry, and completed assistant text
was omitted because history only included provisional previews. Heartbeat now mirrors
registration's generation-expiry cap. History adds `completed_reply` from the current
canonical completed attempt only, original direct coordinator/same persona,2000 chars
with truncation disclosure,90-day cutoff even before pruning, excluding invalidated
or cancelled context and pruned results. No new authority or native reference is copied.
Boundary regression reproduced00:06:28 lease vs00:05:00 expiry; focused162 lifecycle/
bootstrap and6 history/HTTP tests pass, typecheck passes. Source combined verification
exited1 after86 files/1756 backend and550 runtime tests passed: alpha-session browser
wait for `#editor.open` timed out25s; remainder was not verified. Source desktop16/16
passed. Exact full-history bundle plus unstaged patch restored on `source-custody`,
with artifact hashes, ten changed-file hashes, HEAD and status verified; origin/main
unchanged. Only sanitized verification facts and synthetic native output transferred.
Destination typecheck/104 focused tests and unchanged alpha-session browser fixture
pass; timeout cause remains unproven. Fresh full combined verification exited0 in
`.local/custody-combined.log`:86 files/1756 backend,550 runtime, all browser/native/
service checks and build dry run. Hosted-manager reports2 starts/2 requests, both
canonical replies, priorConversationReachedNative/receiptReplayDidNotLaunch true,
and both retirement checks pass. Final report keeps assistantOperational,
productionAdmission and modelJudgmentVerified false. Desktop16/16 passed separately
in `.local/custody-desktop.log`; install reported14 dependency vulnerabilities
(13 high/1 critical), left outside this change. Review required no further runtime
or browser fixture edits. Local checkpoint only, undeployed/unpushed; schedule disabled.

Ordinary owner continuation integration (2026-09-19):
`tests/owner-alpha-http-continuation.test.ts` exercises locally signed owner JWTs,
normal `/v1/commands`, real PersonalControl/SQLite, separately authenticated manager
retirement, and repeated object reconstruction. Completion and expiry without retirement
keep readiness false; stale epoch retirement returns422; exact current report returns200.
Replaying the first key and reading its receipt preserve all runs and the old manifest.
A fresh second message gets epoch3/distinct session and retains the first owner's text
at actual claim. Both synthetic completion records persist; two reservations and one
baseline remain. No live model/native launch/SSO or actual manager lock observation is
claimed by this fixture. Full `npm test` passes86 files/1754 tests; typecheck passes.
Evidence `.local/owner-continuation-backend.log`; no production code/deployment change.

Owner continuation follow-through (2026-09-19, local): real DO/HTTP fixture reproduced
owner-facing `message_admission_available:true` for a service-only campaign. Bootstrap
summary now keeps that policy visible but unavailable to the ordinary composer;
service submission still uses unchanged actor/grant admission. The regression then
executes the existing signed-service submit/result flow.121 campaign/route/bootstrap
tests and typecheck pass, including ordinary owner readiness after trusted retirement.
`node scripts/test-portal-alpha-session.mjs` passed existing Chromium DOM checks:
unavailable admission blocks normal/programmatic Send, eligible admission works,
review/adoption performs no commands/reload, and uncertain message text/key persist.
Log `.local/owner-readiness-browser.log`; no visual layout changes in this follow-up.
No live campaign, deployment or gate change. One bounded provider metadata GET around
09:15Z returned `status:cold`; no guest execution or wake. Earlier process/lock checks
plus this observation are not repeated cold-recovery or general sleep acceptance.

Delegated live acceptance (2026-09-19): source deployed as Worker version
`ba6b658b-4ba2-4ed5-bea2-9ed645e4bd0b`, followed by atomic campaign/auth/bootstrap
secret update. Includes explicit session-adoption UI; no owner SSO/composer acceptance
is inferred. Orb-only single sender submitted command `3bc3066d-94b1-4e5a-80f5-ee46d5446916`
once, HTTP202/applied08:55:02.362Z. Run `ca895bf8-887e-4323-85a3-a9dcd5b29f9a`
claimed attempt1 and canonically completed08:55:18.677Z, observed08:55:19.111Z,
with exact text `HEHEBOT_NATIVE_TEST_OK`. Independent HTTP reread and actual Chromium
reload08:57:16.024Z retained the same result. Inspected screenshot:
`.amp/in/artifacts/delegated-native-result-reloaded.png`. This exercises real native
wake/result under the delegated synthetic capability in the same installation/Sprite,
not owner login/composer or unrestricted ongoing availability.

Session epoch11/boot44ac930c-c965-4501-9c0c-82605a35ac20 expired08:58:02.362Z.
09:04:48.411Z supported inspect-locked read verified durable nativeStopped plus both
executor/session locks free;09:04:49.745Z bootstrap/activity tasks absent and Codex
process count0. Provider observation09:04:08Z was warm: cold/hibernated state unproven.
No old UNKNOWN was replayed/refunded/settled. Cumulative cap remains$10; reservations
are not measured billing. End-of-campaign dashboard revocation blocked BEFORE write
by40s CDP read timeout. Token is not claimed deleted. Backend revocation binding
`HEHEBOT_TEST_REVOKED` disables test routes before auth/RPC without changing immutable
grants, production owner authentication or runtime policy. Follow-up deployment
`1b93f346-8341-4f31-a6e3-cc3c8d6dcb7f`; live credential GET09:11:48.277Z returned
404/NOT_FOUND. Typecheck and24 auth/route/DO integration tests pass; test proves valid
owner auth still works while service reads/writes refuse without RPC. Private evidence
`.local/delegated-revocation.json`. Named Access token deletion remains cleanup for
sole dashboard owner; no retry/login loop. Private evidence: `.local/delegated-trial80-*.json`,
`.local/delegated-browser-readback.json`. No credentials or owner content in screenshot.
Full `bash scripts/verify-codex.sh` exited0:85 files/1752 backend tests,550 runtime,
browser/native/service/build, final status passed with production flags false.
`npm ci --prefix desktop && npm test --prefix desktop` passed16/16. Logs:
`.local/delegated-combined.log`, `.local/delegated-desktop.log`. Source committed locally,
not pushed. Historical implementation checkpoints below precede this live result.

Delegated test implementation checkpoint (2026-09-19): owner explicitly approved one
24h revocable named Access Service Auth credential, exact `/v1/test/*` path app/policy,
bounded backend grant in current installation/DO and same Sprite. No owner impersonation,
private memory/history, tools/connectors, generic routes or new infrastructure. Existing
Browser worker completed one-time provisioning/readback08:24Z: token
9096f9fe-ed91-4216-ad77-91ab6e419a59 expires2026-09-20T08:23:19Z; app
5f8a728b-ed42-4eba-93e8-6734910ae50c and specific-token Service Auth policy
1842fb70-85e1-432e-a95e-be1fc8caea84, owner/internal apps unchanged. Private new
credential file transferred to host and chmod0600 verified; no personal session copied.
API403/list-empty discrepancy is not evidence known apps are absent; no token broadening.
Host integrated core context isolation/admission and real DO/HTTP test:1752 backend,
550 runtime pass, combined suite passed; desktop16/16 passes. Live acceptance is
recorded above. Delegated grant permits3 submissions, fixed persona,180s
session/120s task, existing$1 reservation and$10 lifetime ledger. Exact operator-reviewed
unused epoch10 evidence remains unchanged; service principal cannot provide it.
Separate manager/template staged on same Sprite; old configs preserved. Effective
service GET and actual argv, manager/template/profile/seven source hashes and retained
marker checked08:47:32Z; native process count0. Private evidence:
`.local/delegated-{template-report,effective-preflight,services-effective}.json`.

Wake diagnostic retention: typed sanitized delivery failure now records fixed
HOSTED_WAKE_OUTCOME_UNKNOWN, request_phase and numeric/null upstream_status on the
exact pre-dispatch UNKNOWN intent using compare-and-swap; no upstream text, retries,
settlement or budget release.121 focused bootstrap/successor/wake tests pass in
`.local/wake-diagnostics-tests.log`, including reconstruction/no replay/custody checks.
This cannot recover historical trial79 diagnostics that were never retained.

Session adoption checkpoint (2026-09-19, local): existing portal offers an explicit
Review current session action without page navigation. It reads authenticated state,
shows exact persona/revision/fixed deadline/task bound and requires affirmation. A
second state read must match reviewed fields and still allow admission; offline,
changed selection, revoked admission, old adopted revision, wall/monotonic expiry
and in-flight sends refuse. Adoption changes only local reviewed state and sends no
command/wake. Drafts remain; any pending unconfirmed message blocks adoption without
altering saved text/idempotency key. Existing expiry/retry guards remain in force.
Browser fixture verifies changed task limit while modal open, revoked availability,
cancel, wrong persona, clock rollback past monotonic deadline, offline confirmation,
same/previous revision rejection, and preserved uncertain-message custody. Desktop
review/adopted/pending and narrow review captures inspected. Combined credential-free
verification exits0 (backend1710/runtime550 plus Worker/browser/native/service/build),
with final status passed and operational/production/model-judgment flags false;
`.local/session-adoption-combined.log`. Desktop16/16 passes separately in
`.local/session-adoption-desktop.log`; focused browser check also passes.
Initial browser run caught banner text replacement deleting new controls; corrected
both banner render paths. Later fixture clicks now wait for loading guard to clear.
No production auth changes, deployment or live result are implied by these checks.

Owner-directed independent orb testing (research, no provisioning): trial80 was held
before any send under v5/v6/v7.07:40 authenticated reconciliation retained epoch10,
zero later commands/runs and$4 baseline+holds. V7 fixed expiry08:11:17.458Z is unchanged;
no further manual-refresh request or timed-policy cycle. Shared provider remains one
Sprite and one installation control authority. No new model call/reservation/result.

Production `authenticateOwner` requires RS256 signature plus exact issuer/audience/
OWNER_SUB; immutable installation binding prevents changing subject as a test shortcut.
Official [Access JWT documentation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/)
distinguishes user `sub` from service-token empty `sub`/`common_name`. Existing runtime/
manager credentials must never become owner credentials. [Supported agent authentication](https://developers.cloudflare.com/cloudflare-one/access-controls/authenticate-agents/)
permits fresh orb-local user login, but this grants real owner authority, is not route-
scoped and needs reauthentication at expiry; it is not persistent unattended testing.
Never import personal cookies/OAuth caches or expose loopback auth publicly.

Recommended minimal REAL-runtime path is a new narrowly delegated test principal in
the current installation/DO: new finite named [Access Service Auth credential](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/),
exact issuer/test-route audience/client identity validation and an explicit owner-issued
test grant, separate audited service actor. Allow only one fixed synthetic-context
text-only submission at a time plus that actor's own receipt/run/result reads. Exclude
owner global memory/history, connectors/tools, exports/config and generic owner routes.
Reuse lifecycle admission, immutable manifests, locks, uncertainty and cumulative$10
ledger on the same Sprite. New code/grant must bind provenance and context rather than
mapping service identity to OWNER_SUB. Requires approval for exact Access path policy,
finite designated-orb credential and listed read/write capabilities before provisioning.
This can prove actual bounded native wake/result and test-surface reload persistence,
not real owner SSO or production owner composer. A separate synthetic-only installation
does not close that gate; serially sharing the same Sprite with a second control plane
would need additional explicit fencing/migration, so it is not the recommended shortcut.
No auth platform, passcode bypass, new Worker/DO/Sprite or paid upgrade was created.

Trial80 follow-up07:30Z: after owner go-for-it, passive access recovered. Authenticated
07:25 no-send reconciliation found no new command/run since79, epoch10 and$4 ledger
unchanged. Host exact service GET/process argv, manager/template/profile/marker hashes
pass; manager null, no new session directory. Evidence `.local/trial80-host-resume.json`
and `.local/trial80-service-resume.json`. V5 expired unused; new V6 revision activated
with fixed07:36:16.338Z expiry, same180s/120s and cumulative$10 ceiling.
Automation reload again timed out15s, following eval12s. Later passive07:29:39Z read
returned v6 admission=true/correct persona but empty readonly composer/disabled Send.
`public/app.js` alphaBlock latches changed policy revision until document reload; fresh
state alone is not safe readiness and guards must not be removed. Request one manual
normal refresh of existing portal tab; no further automated reload or fixed-window
staging against an unresolved prerequisite. No message/result or additional hold.
Installed CLI0.38.1 documents default action timeout25s, reload without wait-until;
external15s bound may preempt it, and env10s application to existing daemon unknown.
Eventual reads disprove persistent CDP deadlock as an established diagnosis. No evidence
proves consent was the cause. No browser restart/security change or credential copying.

Trial80 preparation (2026-09-19 07:06Z): saved owner continuation authorizes fresh
bounded trials without repeating consent. Exact authenticated epoch10 custody/zero
attempts/obligations and persistent-root/source review support existing unused path,
not a new historical absence assertion. Producer ran once under both locks, issuing
marker07:04:43.609Z SHA25699e8f558e26bd00b45b35b03463285360bf8f40b3a30f254abe95810debf38e4.
Independent marker readback, corrected service GET/process argv, manager/template
hashes and new-profile recomputation pass; seven installed sources match local pins.
Authenticated manager null07:05:53.850Z. V5 fixed expiry07:15:53.997Z activated with
180s session/120s task, existing baseline$1 and three retained $1 reservations.
Next reservation makes$5 of$10; actual billing unverified. Browser worker assigned one
fresh composer message after current readiness and then canonical completion/reload.
No trial79 replay/refund/settlement; no native or model call in host preparation.
Evidence `.local/trial80-{preflight-custody,unused-request-report,unused-evidence,
manager-before,service-preflight}.json` and `.local/bootstrap-v5-*`. No result yet.

Trial80 browser blocker07:09Z: normal reload and read-only eval timed out15s each,
before any fill/send. Bounded follow-up found responsive Mac shell, but session-info7s
and raw direct CDP WebSocket5s both timed out; TCP connected without upgrade response.
The /json/version404 is known endpoint behavior, not evidence Chrome is down. Exact
cause remains unknown, possibly consent. All diagnostic subprocesses exited/reaped.
No second reload, send, replay, runtime wake, Chrome restart, settings change or auth
copy. Need owner to inspect Chrome responsiveness/remote-debugging consent. Fixed v5
expiry unchanged; no canonical result/reload/shutdown evidence can be claimed for an
unsent trial. This is a device-control blocker, not renewed spend approval.

Trial79 reconciliation (2026-09-19, supersedes earlier activation claims): one normal
composer message received HTTP202/applied06:53:39.615Z, but lifecycle reached recovery
without READY/claim. Authenticated export06:57:00Z confirms epoch10, queued attempt0,
zero attempt rows and canonical results, wake UNKNOWN, retained $1 reservation.
Manifest expiry06:56:39.615Z; bootstrap v4 expiry06:58:58.101Z. No completion/reload,
resend, cancellation, replay or old settlement. Export hash
`a319021e8d97679d5642e708e5637046297d55556936524706e837c05295c457` in
`.local/trial79-failure-custody.json` verified locally. Provider was cold after failed
observation; subsequent guest execution was failure reconciliation, not trial wake evidence.

Deployment error found: earlier service PUT returned “already running with that command”
and did NOT apply new manager arguments. Service GET and actual process argv both
still pointed at `.local/manager.json`. Listener log06:53:44.907Z records
PREPARATION_REFUSED_OR_UNKNOWN; no epoch10 session directory was created. Old template
profile differs from new assignment; manager validates it before session creation.
This explains the observed refusal path, though the redacted log itself has no substage.
Stopped listener, preserved complete old definition, confirmed a stopped PUT still
ignored args and a different command returned a configuration conflict. Followed the
provider response's supported DELETE/PUT replacement for that service definition only.
No filesystem, credentials, journal, marker or task records were removed. New definition
GET matches every requested field (`EXACT_SERVICE_DEFINITION_PASS running`); process
argv independently confirms `.local/manager-forward-isolation.json`. Named Codex process
count0, epoch10 session absent, old marker hash still
`c7b7d38b1305c3e157407e148f6b4563d4b049aa4f761eb1f7810146fbca7380`.
Evidence `.local/trial79-{listener-*,services-*,corrected-process.json}`. This is a verified
listener correction, not a successful fresh hosted trial. Single-message authorization
is consumed; further admission must preserve UNKNOWN/reservations and have fresh authority.
No application code changed at this checkpoint; previous full test results remain
historical, not a rerun or proof of this live deployment. No Git push performed.

Managed-alpha restrictions (2026-09-19): verified owner “Keep going” in parent
thread after its disclosed restrictions/recovery/fresh-message scope. On the same
dedicated Sprite, initial metadata check found no requirements file and zero Codex
processes. Installed tracked `config/codex-owner-alpha-requirements.toml` exclusively
under native-home and old-session flocks at `/etc/codex/requirements.toml`:
`allow_remote_control=false`, `[features] memories=false`. No prior fields existed;
auth and unrelated machines/installations were untouched. Exact SHA256
`0cb20d85e00b1c4ff62cb3c4e98c597273eaf541bbb2f64c170ae7ef7c35abbf`.
Inherited private umask initially made root-owned file/directory0600/0700, so the
first readback failed before native launch. Checked content and only approved file
present, corrected to0644/0755, then successfully rechecked. Bounded pinned0.154.0
diagnostic under both locks and full capability drop initialized the supported
stdio transport, then used only configRequirements/read, config/read and
remoteControl/status/read. Same-process results: required allowRemoteControl=false,
required memories=false, effective config.features.memories=false, status RPC denied;
subordinate memory settings omitted (null/unknown, not false). Native exited; final
process count0. No thread/start, turn/start, account/read or model/list request.
Private logs `.local/managed-alpha-fence-{before,install,readback,mode,directory-mode,
readback-recheck,final}.jsonl`; recheck exited0 and temporary helpers were removed.
Rollback, if separately chosen, must first verify this exact installed digest and
restore prior absence of this file only, not overwrite unrelated future settings.
No rollback was performed. This is prospective verification, not historic settlement
or billing evidence; the existing $10 cumulative allowance is unchanged and actual
billing remains unverified. No quarantine deployment, marker/grant or fresh message.

Historical uncertainty (not a permanent forward-admission gate): pinned source review says memories feature defaults false,
but config/profile overrides can enable it; subordinate generate/use defaults true
do not alone show execution. Stdio starts remote supervision with persisted desired
state unless managed denial applies; it is not an ingress fence. No contemporaneous
effective-memory/requirements readback or complete scoped ingress-transition history
is available for78. Neither required historical assertion is established, nor is
either proven false just by defaults. New fences cannot fill those gaps. V1 must
refuse issuance rather than fabricate assertions; fresh completion/reload remains
unverified. Source: tagged [feature defaults](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/features/src/lib.rs),
[memory startup](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/memories/write/src/start.rs),
and [remote desired state](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server-transport/src/transport/remote_control/desired_state.rs).

Forward-isolation checkpoint (2026-09-19): owner-requested oracle follow-up separates
old settlement from prospective safety under the buggy-runtime, not established
compromise, threat model. Existing authenticated native home can remain in place;
no auth copying or native-store edits. Require whole-execution cut, fresh never-resumed
context, per-launch root-controlled managed denial/input review, same-process readback
before account work. Old persistent queues must never be loaded by resuming old threads;
global AGENTS/override/environments are native host inputs, not sandbox-denied reads.
V2 producer retains historical memory/remote activity literally UNKNOWN and binds a
five-minute prospective receipt, changed/current kernel identity, retained bytes/source
digests, managed readback and ambient inventory. Imported worker patch SHA256
0ca224802c1fe503103c2e52c6bffe5cd59ce83cc2de7f06b101649f5ed7a5a2; host focused7/7
pass in `.local/forward-isolation-host-focused.log`. No live receipt or authority.
The official [Sprites JS client](https://github.com/superfly/sprites-js/blob/main/src/client.ts)
exports restartSprite(name), POST /v1/sprites/{name}/restart, described as restarting
the backing machine. Reused trial74's established bounded procedure, not a new API
assumption. Current single POST returned202; changed kernel observed stable >2min,
same Sprite identity and seven pinned retained files unchanged. Inodes changed across
boot while paths/bytes remained; current receipts use newly observed root pins.
Listener auto-started despite the prior Service stop. Stopped it again; reviewed
HTTP-only startup has no native launch/poll and expired authority remains unchanged.
No named Codex processes observed; that scan is corroboration, not containment proof.
Launch-floor patch SHA25682baff050cda7bf633f0aacd89fba7e3608b9c9b787672a153b35e6c71d58797
is integrated; host pins it only in current sources, preserving original sources and
commanded digest. Host focused80/80 plus legacy-command-binding7/7 pass. Five runtime
files installed with original source backup and matching hashes. Live floor and
same-process requirements/config readback pass under both locks and capability drop;
native diagnostic exited without thread/account/model calls. Evidence:
`.local/forward-isolation-{installed.log,live-floor-inspection.json,live-readback.json,
retained-before.json,retained-after-stable.json,services-after.json}`. Full combined
verifier exits0: backend1710/runtime550 plus Worker/browser/native/service/build,
`.local/forward-isolation-integrated-combined.log`; desktop16/16 passes separately.
Worker source deployed with keep-vars and expired policy unchanged, version
e52e649b-a54d-472c-9c6a-f7585665aa27. Authenticated manager06:13:38Z returns null.
New profile template staged separately, old template/manager unchanged; no marker/grant
or fresh message. Separate new manager config is also staged, with the future Service
definition prepared locally but not applied. All seven predecessor file pins remain
identical after staging; kernel unchanged and no named Codex process observed. Evidence
`.local/forward-isolation-{manager-report,retained-after-staging}.json`.
Exact epoch9 custody and browser readiness review pending. Schedule
resumed: the previous pause incorrectly treated historical absence proof as exhaustion
of all useful authorized work. No new message, replay, settlement or budget reset.

Hosted capability-drop defect (2026-09-18): earlier successful manual Sprite
launches used setpriv, but the automatic listener Service registered Node directly.
Live listener PID20242 showed CapInh/Prm/Eff/Bnd/Amb=a82435fb and NoNewPrivs0.
Two fresh private synthetic homes, actual pinned Codex, fake no-auth loopback-only
provider, initialize/config/read/thread/start only: default caps returned -32603;
setpriv all-dropped/NoNewPrivs1 acknowledged. Both native diagnostics exited and
homes/helpers were removed. No real account or turn used. Evidence
`.local/bootstrap-78-{listener-capabilities,caps-reproduction}.jsonl`.
This reproduces a concrete startup defect, not the discarded exact error of78.

Shared hosted launcher now invokes supported setpriv after both locks and before
the native entrypoint. No fallback, retry, manifest or retirement change. Focused6
tests verify real locks and signal PID through exec, effective/permitted/inheritable/
ambient caps0, NoNewPrivs1, exact bounding-drop invocation, and refusal without
entry. Orb bounding mask remains nonzero despite setpriv; guest reproduction
independently verifies all five masks0. Runtime515/515 pass; full combined recheck
exited0:1669 backend/515 runtime plus Worker/browser/native/service/build in
`.local/hosted-cap-drop-combined.log`. Desktop16 passed at preceding checkpoint;
desktop source is unchanged by this launcher edit.

Supported Service stop completed exit0; deployed originals matched host baseline
hashes. Installed launcher/adapter/inspector exactly match new local SHA256 values,
import-only check started no native process, supported Service start completed.
Authenticated manager16:25:11.484Z returned null; no policy/Worker changes/new message.
Logs `.local/cap-drop-{deployed-before,installed,listener-stop,listener-start}.log`
and `.local/cap-drop-manager-readback.jsonl`. All historical custody remains retained.

Pinned startup audit: thread/start can persist native identity and perform auth,
catalog and generate:false WebSocket prewarm before turn/start. See tagged
[startup prewarm](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/core/src/session_startup_prewarm.rs#L185-L327).
Null durable threadId under reviewed intact single-writer custody supports no
first-party turn/start, not no startup effects or billing. Oracle's scoped design
review supports preparing a distinct explicit one-use claimed-pre-turn quarantine
authority, preserving UNKNOWN and reservations, not reusing unused/settlement guards.
Core implementation is integrated locally after exact patch checksum verification
and host review. `claimed_pre_turn_quarantine` defaults absent, requires a new policy
revision and fresh owner message, binds exact expired claimed attempt1 with literal
null native/result/release/settlement fields, rejects contradictory activity, and
retains an immutable disposition through config removal/reopen. Old custody and cost
reservations are unchanged. Host typecheck and focused216/216 pass; combined verifier
first passed1710 backend but failed six hosted-control runtime cases: the new
constructor query ran before a fresh Durable Object installed its SQLite schema.
Host added a schema-presence guard without bypassing existing custody validation;
the same hosted-control tests pass8/8. Original failure remains in
`.local/claimed-pre-turn-host-combined.log`; full recheck exits0 with1710 backend,
515 runtime and Worker/browser/native/service/build in
`.local/claimed-pre-turn-host-combined-recheck.log`.
Runtime evidence producer subsequently integrated after checksum and host review:
pinned original/current sources and configs, canonical root inode/device identities,
exact bridge/adapter fingerprint using claim deadline, literal null native IDs and
strict three-record journal inventory. Both real flocks are inherited and verified;
exclusive0400 marker write fsyncs file/directory and permanently blocks old entry,
including partial/dangling markers. Retained records stay unchanged. Historical
review assertions are mandatory trusted evidence, not conclusions established by
hashes, current settings or null IDs. Output contains no successor grant/expiry or
settlement/refund assertion. Host focused19/19, runtime520/520 and pinned hosted-manager
composition pass after integration; desktop16/16 also passes. Logs
`.local/claimed-pre-turn-host-{runtime-focused,runtime,composition}.log`.
No quarantine deployment, live evidence marker or authority issuance.
Shared-home memory/alternate-ingress fences remain prerequisites. Tagged source
supports managed `/etc/codex/requirements.toml` allow_remote_control=false plus
[features] memories=false; legacy features.remote_control is ignored. No supported
read-only RPC exposes persisted remote-control preference; status can race startup.
Current readback does not prove historical disablement. Do not restart shared-home
app-server just to inspect status before a managed startup fence is established.
This checkpoint originally awaited approval for managed access-control changes;
the owner subsequently approved and the prospective fence is now verified above.

V3 live staging (2026-09-18): owner returned home/requested retry; existing Mac
Chrome/CDP and SSO passive readiness succeeded15:11:28Z with six runs unchanged.
Only then activated fixed v3 expiry15:22:07.073Z,180s session/120s task, same cost
baseline/reservation/cap and exact unused8 evidence.15:13:27 browser confirms admission
available, empty composer and no old-run change.15:14:15 authenticated manager null
and provider same Sprite cold corroborate passive control-plane-only behavior.
One normal composer message78 applied15:15:30.593Z, commandb934fd98, runda2fd086.
BOOTING→READY/attempt1 then RECOVERY_REQUIRED/STALE_EPOCH by15:17:48.912; zero
canonical result. Six prior runs unchanged. Reload returned15:18:17 but subsequent
state evaluation failed;15:18:44 origin null/no composer, so persistence unverified.
No host guest exec/manual wake before failure, no duplicate send. Private evidence:
`.local/bootstrap-v3-{activation.log,activation.json,before-message.json}`.

First post-failure diagnostic guest exec15:18:39 wakes guest explicitly; it is not
part of the message-wake demonstration. Listener timestamps show native service
failure SERVICE_RECOVERY_REQUIRED15:15:44.383, policyExpired:false/operatorStopped:false,
then stop and LAUNCH_REFUSED_OR_UNKNOWN. Under both actual directory flocks, offline
inspector shows epoch9 dispatch submission_unknown, exact run78/attempt1, native
thread/turn null and NATIVE_ACKNOWLEDGEMENT_UNKNOWN; service journal nativeStopped:true.
No observed native acknowledgment is not proof that thread/start had no effect.
Original RPC cause was discarded by adapter catch; source tracing suggests later
STALE_EPOCH is lease-watchdog fallout, not an established initial identity mismatch.
Sanitized stage/code-only durable diagnostics and existing inspector projection are
integrated locally. The checked patch SHA256 is
1a0a2ac587d6cae80c30a93bf851a7d064d983c7d8543024fde8667f9f2b0ebd.
Host `node --test tests/runtime-codex-adapter.mjs tests/runtime-codex-recovery-inspect.mjs`
passes55/55; `npm run test:runtime` passes514/514. Typecheck and
`node scripts/test-codex-hosted-manager.mjs` pass with one native/scripted completion,
HTTP wake and prelaunch bootstrap hold, not real model/provider acceptance.
Full verifier stopped on encrypted-backup fs.watch EMFILE:1668/1669 backend pass;
isolated recheck reproduces. Orb showed126 visible inotify instances against128
max_user_instances; no unrelated processes terminated or test weakened. Logs
`.local/native-submit-host-{focused,runtime,composition,combined}.log` and
`.local/native-submit-backup-recheck.log`. Subsequent orb-only sysctl increase
fs.inotify.max_user_instances128→256 unblocked unchanged watcher test11/11;
fresh `bash scripts/verify-codex.sh` exited0 with1669 backend/514 runtime plus
Worker/browser/native/service/build. Log `.local/native-submit-host-combined-recheck.log`.
`npm ci --prefix desktop && npm test --prefix desktop` passes16/16;
log `.local/native-submit-host-desktop.log`.
Earlier failed check remains recorded; no test skips or application changes.
Diagnostics allowlist stages/error codes and
signed32-bit RPC codes, omit raw error messages, and preserve UNKNOWN/no replay.
They cannot recover78's discarded original error. Subsequent deployment is above.
Supported native thread/list under both locks15:29:15.644Z returned zero matching
exact-workspace threads/no further page; diagnostic native exited. No thread/start,
resume or inference was requested; absence is not proof of no prior native effect.
Private evidence `.local/bootstrap-78-native-list.jsonl`. No replay or
unused-before-staging recovery for78.
V3 expired unchanged15:22:07.073Z. Native Tasks GET empty15:24:59, no DELETE or refund.
Evidence `.local/bootstrap-78-{listener-private.log,journal-selection.jsonl,
locked-inspection.json,tasks-private.json}` stays private. Production gates false.

Read-only follow-up15:48:04Z: original service permissions name and base-config
digest reconstructed exactly under both kernel locks. Supported initialize/config/read
confirms default profile/filesystem match and disabled network; project maxbytes32768,
markers[.git], fallbackCount0, no reviewed trust entries, three system/user/session
layers without marker overrides. Fixed ancestor/native-home metadata found no
.git/AGENTS.override.md/AGENTS.md/.codex/config.toml candidates; canonical roots
are disjoint and not symlinked. No thread/start/turn/account/model request; diagnostic
native exited and temporary guest/local helpers removed. First inspection refused
before native launch because its guard incorrectly expected persisted
restrictedPermissions:true; service sets that only in memory. Corrected inspection
requires the actual raw config contract plus exact original profile digest.
Evidence `.local/bootstrap-78-config-selection-v2.jsonl`; metadata/config read is not
proof of sandbox readability or original error. Worker pinned0.154.0 reproduction
of nested-home denial is not this live layout. Current core successor requires
completed text-only receipts/settlement; retirement merely records child-stop/locks,
and unused recovery categorically excludes attempt1. Adapter fsyncs threadId before
turn/start and supported runtime writers preserve it; this narrows the boundary
under intact journal custody; tagged-upstream startup effects are recorded above.
No live recovery authority or settlement claim.

Owner architecture alignment (2026-09-18, docs only): imported the reviewed
three-file clarification without replacing current live-status documents. Amp is
a documented reference, not a wrapper/dependency/coding UX; deterministic ingress
remains reachable while model coordination sleeps with the shared runtime except
for admitted work. Codex, one Sprite, cost and settlement gates are unchanged.
Patch applicability and whitespace checks pass; no executable changes, test rerun,
deployment, push or new acceptance claim accompany this clarification.

Live unused evidence/deployment (2026-09-18):09:20:24 preflight reconfirmed exact
reviewed old manager/launcher/lock source hashes, manager config digest and private
native/session root device/inode identities, with no staged session directories.
Operator reviewed the original private-stage creation, exclusive mkdir before
native launch and absence of a deletion path; current hashes alone are not proof
of historical custody. Producer executed once at09:21:55.474 under both real locks,
creating the permanent epoch8 transition fence and0400 fsynced evidence marker.
Digest049cb4035a5a3d7305a7cff50a6c826752d91ec178060400448cfc082ddf87bb
was independently read back after runtime installation. No nativeStopped or
retirement claim. Request/evidence and preflight are private `.local/unused-live-*`.

Supported listener Service stop returned stopped/exit0/complete; installed three
hold-before202 files match local hashes, import check started no native process,
and Service start returned started/complete. Worker deploy exited0 with version
e3541c58-7602-4c21-8f5b-457dcf796123. Logs `.local/hold-listener-*.log` and
`.local/unused-recovery-worker-deploy.log`. Authenticated09:25:54 manager manifest
null and provider same Sprite warm. This is installation evidence, not message wake
or sleep acceptance. Provider-only09:31:22 reports same Sprite cold, recorded in
`.local/unused-final-provider.json`; no zero-billing or process-loss claim follows.
No new trial config/reservation/message, no Git push.
Browser recovery update12:11Z: tracked PID33132 terminated (SIGTERM/exit-1), exposing
agent-browser daemon read error35. Verified Mac shell responds; runner inventory
did not establish its unavailability. A single subsequent passive pinned navigation
hit a hard25s timeout; CLI was killed/reaped, browser-side outcome remains unknown.
State/history reads were not reached; no send or other mutation occurred. Subsequent
no-navigation diagnostics completed: HTTP /json/version returned404 (also seen in
prior working consent mode), CDP handshake timed out at5s, and both owned session
info queries timed out at10s. agent-browser0.38.1 help/version respond. All subprocesses
were reaped; tracked diagnostic PID33279 exited0. Chrome versus daemon/consent blockage
remains unresolved. No documented safe daemon-only reset established; doctor/close
were not executed. Schedule paused12:28Z pending owner inspection for a Chrome remote
debugging consent prompt, whose presence is unknown. V3 remains unissued.
Actual billing remains unverified; unchanged cumulative$10 allowance is not reset.

Live message-bootstrap77 failed (2026-09-18): authenticated browser readiness and
passive control-plane-only navigation preceded new fixed v2 policy. Same Sprite
provider status cold08:19:50 and08:21:42, manager null before message. Single normal
composer submission accepted08:22:33.495Z, receiptcebc1bf7-0856-429e-af4c-0e364fe51d77,
run743d4f08-f8dd-4f9f-8506-dea200381342, user event20. BOOTING observed, never READY;
epoch8 RECOVERY_REQUIRED by08:24:07, run queued/attempt0/error null. Reload retained
one user event, zero results, no preview, old five runs unchanged. No retry/manual
wake/activation/cancel/replay. Wake8 metadata status queued proves strict HTTP202
receipt only. Listener had zero staged sessions and no initial log; at08:24:10,
immediately after diagnostic guest exec, it logged NO_ASSIGNMENT. Service process
owner/modes/port matched expected configuration. Code has an activity gap after202
before manager/native Task hold. Timing strongly suggests idle pause; no direct
provider pause trace establishes causality. Expired grant/custody stays untouched.

Manifest-validated, durable-fenced, bounded bootstrap hold before202 is integrated
locally; no listener-lifetime heartbeat or uncertain replay. Host runtime regression
passes505/505. The strengthened existing HTTP-listener/native composition passes:
bootstrap Task PUT/GET before202, separate native Task PUT/GET, one pinned native
start and scripted response, canonical completion and expiry-gated retirement.
This is synthetic provider/account evidence, not live cold-wake recovery. Hold-only
combined verification exited0 in `.local/bootstrap-hold-combined.log`; desktop16 pass.
Host extended
the existing actual-workerd fixture to prove authenticated manifest callback into
the same DO while its sending alarm awaits acknowledgement; exact grant returned
with wake status unknown, then queued after return. Typecheck and fixture pass in
`.local/bootstrap-preack-workerd.log`. This tests the fix prerequisite, not live success.
At08:36:30 native Tasks GET returned an empty list; no hold deletion performed.
Logs: `.local/bootstrap-77-{listener-final,listener-identity,service-inspect}.log`;
private Tasks response `.local/bootstrap-77-tasks-private.json`. V2 expired08:29:50.104Z.
Automatic rollover intentionally rejects unclaimed/uncertain generation8, so further
live work requires explicit recovery evidence, not a fabricated retirement journal.

Read-only browser custody selection08:55:24.966Z confirms epoch8 RECOVERY_REQUIRED,
run77 queued/current_attempt0 and zero attempt rows for that run across all epochs.
The retained reservation is$1. Its manifest hash matches the selected manifest
reconstructed with policy.text_only; that profile and reservation match the activated
v2 configuration. The worker omitted manifest.text_only from its projection, so this
is reconstruction, not a second full-manifest read. There is no independent earlier
ledger snapshot proving historical reservation unchangedness. No native staging or
retirement conclusion follows from this control-plane evidence. Private selection:
`.local/bootstrap-77-custody-selection.json`. No mutation or new send performed.

Unused recovery integration (local/default-off): core consumes a strict explicit
one-use grant only inside a fresh direct-message transaction. Its separate immutable
disposition binds predecessor and successor manifests without retirement/nativeStopped
claims. Exact expired zero-attempt custody and absence of contradictory activity are
rechecked; original run/events/wake/reservation remain retained and unclaimable.
Trial/session/recovery deadlines and lifetime allowance all constrain the successor.
The new operator-only producer pins the reviewed deployed sources/config/template
and private root identities, takes both real flocks, and exclusively creates/fsyncs
the same transition directory before writing a digest-bound immutable marker.
Preexisting or partial directories fail closed; delayed manager staging loses the
same exclusive mkdir. Linux /proc verifies inherited locks. An explicit operator
historical-root-custody assertion is still required; hashes cannot establish it.
No network, Tasks, model, retirement or successor authorization is produced.
Host typecheck,186 focused core tests and6 real-lock producer tests pass. Fresh
host combined verifier exited0 in `.local/unused-recovery-combined.log`:1669 backend,
511 runtime, Worker/browser/native/service fixtures and dry-run build. Its final
status is passed with assistantOperational/productionAdmission/modelJudgmentVerified
all false. Desktop16 pass in `.local/bootstrap-hold-desktop.log`. No live marker,
recovery config, guest update or new composer message has been issued.

Expired trial reconciliation (2026-09-18T08:12:18Z): fixed expiry08:10:39.410Z
passed unchanged; authenticated manager manifest null, same Sprite provider status
cold. One subsequent bounded guest exec observed the registered listener running
with its original07:48 start time and zero staged session directories. The inspection
itself wakes the guest; neither observation proves fresh-process recovery or live
passive navigation. No new trial or model submission. Evidence:
`.local/bootstrap-expired-{reconciliation.json,listener-inspection.log}`.
Browser execution reconciliation: earlier runner list returned none and thread
metadata stayed running_tools, but worker subsequently confirmed billing navigation
completed exit0 with no running command/PID or app mutation. Those observations did
not prove a hung command. No passive bootstrap checks had occurred. Same worker is
now assigned passive-only current attachment/portal readiness; no new trial before
its result and no composer submission authorized.
No credentials transferred and no new fixtures created for this execution blocker.

Manager/native composition and service staging (2026-09-18): host applied the
four-file fixture patch against the published baseline after verifying its digest.
`node scripts/test-codex-hosted-manager.mjs` passes: one actual pinned native start,
one scripted loopback response, zero advertised tools, canonical result
MANAGER_TEXT_ONLY_CANONICAL_47, exact profile/assignment and expiry-gated retirement.
The launchable endpoint correctly returns null after completion; fixture-only
SQLite inspection confirms the retained manifest is unchanged. Legacy hosted-owner
fixture and typecheck pass; generated Env was refreshed with `npm run types`.
Logs: `.local/hosted-manager-host.log`, `.local/hosted-manager-legacy-host.log`.
This uses synthetic Access/TLS, native home, predecessor and activity holds; it
does not prove the default account launcher, live wake, sleep or billing.

Same existing hehebot Sprite: bounded preflight observed8GiB RAM and
1,385,435,136 root-used bytes, not configured caps or billable storage quantities.
Prior generation7 journal plus both real locks provided direct-child retirement
observation at07:44:12.050Z. Persistent listener imports initially lacked generated
contracts; staging was corrected and import passed without native launch.
Supported Service registration at07:48Z returned HTTP200 started/complete for
`hehebot-listener`, port8080. Registration starts the service; monitoring completion
is not readiness or sleep proof. Provider control-plane GET at07:54:08Z reported
cold; process loss is not inferred. Bootstrap Worker deployment and five-secret
activation then completed successfully, fixed trial expiry08:10:39.410Z,
session180s/task120s, conservative prior allowance$1/reservation$1/total$10.
Authenticated manager read returned null before admission and again at08:08:20Z,
when provider inventory was cold. Browser worker's earlier tool call remains stalled
(execution state unchanged since07:37Z); live navigation/message proof is pending,
and no message submission was authorized. Fixed expiry is not extended.
Fresh combined verifier exits0:1644 backend/497 runtime plus Worker/browser/native/
service/build including manager composition. Desktop16 pass. Logs:
`.local/manager-combined.log`, `.local/manager-desktop.log`.
Credentials remain private; task-signing key was not shipped to the guest.
Evidence: `.local/bootstrap-{sprite-preflight,guest-import}.log` and
`.local/bootstrap-service-registration.ndjson`, `.local/bootstrap-idle-inventory.json`,
`.local/message-bootstrap-{deploy,secret-activation}.log`.

Budget interpretation correction: the existing$10 cumulative in-scope approval
permits conservatively estimated bounded work. All-project billing and an enforceable
provider cap were not owner-imposed prerequisites. Keep estimates distinct from
lagged billing, retain prior costs, and escalate credible overrun risk. Neither
reservations nor the observed8GiB establish a future provider cost ceiling.

Message-bound bootstrap integration (2026-09-18, local/default-off): accepted direct
owner messages can receive one immutable run/session assignment in the same SQLite
transaction. Reads never assign or renew it. Expired current-generation settlement,
trusted exact retirement and lifetime reservations gate successors; historical
UNKNOWN work is not adopted. Reservations and a configured prior-cost baseline are
admission bookkeeping, not proof of actual billing or an enforceable provider cap.
The Worker separates manager manifest/retirement authentication from signed fixed
task capabilities and rejects legacy-token fallback while bootstrap is configured.
The DO additionally binds the exact run, manifest hash and current generation.
The runtime manager stages an exclusive private transition directory before launch;
uncertain or partial staging is never replayed. Retirement requires matching journal
nativeStopped plus actual dual-flock acquisition after expiry, not root completion.

Host verification:78 tests across auth, owner binding and bootstrap passed, including
real Worker handler/DO calls over the SQLite test adapter. These are not workerd
or live-provider evidence. Existing UI fixture passed and all eligible/unavailable/
expired screenshots were inspected. Full combined rerun exited0 at
`.local/bootstrap-combined.log`; earlier failed runs remain failed. Core and runtime
patches and the actual-workerd fixture extension are integrated. Host rerun passed
in `.local/bootstrap-workerd-host.log`: zero passive wake intents/reservations,
one persisted message/one wake, fixed token/policy across process reopen, separate
credentials and exact run/epoch/expiry rejection with old UNKNOWN custody unchanged.
The extended fixture arrived after that stage of the combined run, so this host
rerun is separate supplementary evidence. Typecheck and desktop16 passed. All workers
finished; full verifier passed1644 backend/497 runtime plus browser/native/service
fixtures and build dry-run, ending with status passed and productionAdmission false.
No deployment, Sprite Service registration,
live model call or automatic trial enablement in this checkpoint.

Message-triggered wake / quiet listener follow-up (2026-09-18, local only):
`deliverOwnerAlphaWake` requires an existing claimable run before retaining UNKNOWN
intent. The actual workerd fixture proves activation, state/timeline reads and
alarms cause zero notifications/intent; an accepted, persisted message is present
when the sole notification callback runs. Historical custody remains byte-identical
through alarms/reopen. `--listen` permits a quiet service without a session timer;
`--serve` retains330s. Neither mode creates grants. The warm listener reads current
private immutable staging only after authenticated work and retains prior intents.
The actual CLI boots without staged config, rejects unauthenticated wake and stops
cleanly on SIGTERM. No Service installation or deployment performed for this change.

Verification: typecheck;41 focused successor/auth tests;19 listener/launcher tests;
`scripts/test-hosted-wake-transport.mjs`; two successful runs of
`scripts/test-owner-alpha-successor-worker.mjs` after consuming fixture POST bodies.
The full combined run first failed because an auth fixture lacked getAlarm;
that mock now retains alarm state. The rerun reached local Worker integration but
failed with workerd's unconsumed request-stream error. Both fixture regressions
are fixed; targeted passes do not retroactively make that full run green.
Logs: `.local/message-wake-{combined,combined-rerun,auth-fixture,worker-fixed}.log`.

Read-only browser billing evidence, observed2026-09-18T06:32:06Z, org
kaspar-hidayat: September1–18 Cost Explorer Total Spend$0.03; upcoming September1–
October1 invoice subtotal/amount$0.03; credit balance$0.00. Rounded RAM$0.02,
CPU$0.00 and hot-storage$0.00 do not sum to rounded total. Sprite hehebot was cold.
No tax/credit line, metering-lag bound, RAM allocation or cold-storage quantity was
shown. Advertised$30 credit is not usable-credit evidence. This excludes separately
billed Cloudflare/inference and is not proof of$9.97 remaining in the$10 total.
No billing/resource changes or credentials disclosed. Official current CPU rate
$0.07/CPU-hour, RAM$0.04375/GB-hour, hot storage$0.000683/GB-hour, cold storage
$0.000027/GB-hour; no documented RAM ceiling or Sprites-token cumulative-billing API.
Actual all-in costs remain unverified; do not substitute CPU-only estimates.

Hosted wake diagnosis (2026-09-18): the official working-with-sprites guide permits
default8080 HTTP routing without a named Service. A bounded foreground120s probe on
the retained Sprite observed private-edge401, app-token401 and exact queued202;
duplicate delivery stayed queued, expired synthetic policy refused native launch,
and exit0 left no native state. This does not recreate a listener after cold boot.
The receiver now aborts launch before closing held connections;17 focused tests pass.

Generation4 exposed an alarm starvation bug: each5s portal refresh postponed the
5s generation alarm. Preserve an earlier stored alarm instead. Real workerd regression
failed before and passed after; first green run later lost a Miniflare connection,
isolated rerun passed. Fix deployed. Generation5 still retained UNKNOWN delivery and
RECOVERY_REQUIRED, not missing wake metadata. Listener exit0 and empty state do not
retroactively settle the delivery. Private config/modes passed readback. Historical
observability query returned403/code10000; no token scope/root-cause inference.

Generation6 attached tail before activation and logged request-phase failure with
null upstream status. Actual local workerd, using the default fetch and a real HTTP
receiver, reproduced: TypeError, invalid redirect value; only follow/manual supported.
The receiver saw zero requests. A direct wrapper also failed, ruling out the proposed
unbound-fetch explanation in this reproduction. Changed redirect:'error' to 'manual';
existing strict202 receipt validation rejects3xx without following or forwarding
credentials. The new credential-free scripts/test-hosted-wake-transport.mjs passes
real202 and302/no-follow, and is included in verify-codex.sh. Sender diagnostics retain
only controlled stage/numeric status, never response text, headers or thrown messages.
Four unit checks/typecheck pass. Fix deployed; generation6 remains UNKNOWN and its
listener exited0 with empty session and both locks available.

Generation7 activation applied05:47:10.696Z, receipt7744f413-71ac-4501-9eed-6c45cf2ea0a5.
The Worker-triggered listener emitted actual owner-alpha.ready, session
df18567e-bba1-42fc-98a7-4927ba74ed3f, expires05:51:05.490Z/max1 run120s. No manual native
launch or old-generation replay. One normal UI submission at05:48:46.952Z, receipt
6abe74c6-a373-4b6c-a232-76d281e5044c/runf8063115-21c9-45c8-b188-249854de0fef, completed
05:48:52.786Z (5.834s). Canonical run.result90fddf49-0ee0-458c-b38d-e8eb5b14e23e
contains exact HEHEBOT_WORKER_WAKE_OK_76, coordinator/Chief of Staff, matching cause.
Full reload confirms completed/attempt1/error null and one matching user event. Prior
74/75 and the original recovery/waiting tasks remain unchanged. Inspected screenshot
.amp/in/artifacts/worker-wake-76-completed.png shows recorded Completed/exact text;
role attribution comes from canonical event readback, not the cropped image alone.
Listener emitted stopped/LAUNCH_EXITED and exited0 after the grant expired. Readback
05:53:04.617Z: service recovery/nativeStopped:true, intent still unknown, both locks
acquired, zero matching executors and zero census read errors. No universal termination
or old settlement claim. Production flags remain false. No new Sprite, registered Service,
upgrade, connector or auth-cache copy. Billing remains unverified under the original
$10 total ceiling. Private evidence: .local/wake-generation{4,5,6,7}-*,
wake-{default,bound}-fetch-repro.log, wake-real-transport-green.log,
wake-final-{unit,runtime,worker,build}.log and wake-redirect-fix-deploy.log. Final targeted
real Worker/reopen, transport,4 unit/17 runtime, typecheck/build passed. No new combined
full-green claim; its earlier fixture failure remains recorded below. Next is safe cold
listener recreation and session staging, not renewal/replay of this consumed generation.

Staged wake delivery (2026-09-18, local): optional HEHEBOT_OWNER_ALPHA_WAKE contains
exact transition_id and root HTTPS sprites.app URL, using existing PROVIDER_TOKEN
plus HEHEBOT_OWNER_ALPHA_WAKE_TOKEN. It is accepted only in hosted alpha mode. Alarm
delivery records owner_alpha_wake:<epoch> UNKNOWN atomically before the first await,
requires exact live BOOTING generation/boot/lease/policy and empty provider reference,
and never changes epoch or controller operations. Any existing delivery record prevents
retry, including reconstruction after unknown transport outcome. An exact202 receipt
marks only delivery queued. The normal lease watchdog cadence remains active after
failure. HTTPS dispatch forbids redirects, caps receipt4096 bytes and elapsed15s,
and exposes only fixed errors. No service start, policy renewal or credentials in DB.

Verification:23 focused tests/typecheck; actual workerd alarm with fixture transport
made one notification across two alarms, retained queued intent and watchdog cadence,
and preserved predecessor rows/reopen/epoch3 continuation. Combined check passed1609
backend/485 runtime tests then failed with500 Network connection lost in the initial
global-fetch-interception Worker fixture. Cause unproved; final fixture uses a narrow
transport override and passed separately. Build and16 desktop tests pass. Logs:
.local/alpha-wake-delivery-{focused,combined,worker,build,desktop}.log.
No deployment/live wake/model activity. Official Services API lists no restart-policy
field; safe bounded listener/service lifetime remains to be verified before enabling.

Read-only provider audit:2026-09-18T04:40:59.092Z GET /v1/sprites?max_results=50 returned
200, sprites=[hehebot:cold], has_more=false,next_continuation_token=null.
04:40:59.425Z GET /v1/sprites/hehebot returned200/name hehebot/status cold. CLI selected
org kaspar-hidayat; provider org/count/nested pagination/data were not retained and
cannot be inferred from that selection. No guest/service/session calls or mutations.
Sanitized evidence .local/sprites-readonly-inventory-20260918.json. Retained resource,
not abandoned; old UNKNOWN custody remains. Actual billing still unverified.

One-shot hosted wake preparation (2026-09-18, local only): a default-off HTTP
composition reuses the authenticated /wake queue parser. Its callback requires the
staged epoch/transition ID, authenticated BOOTING status, exact policy, generation,
owner binding, hosted marker and disabled production execution. Config bytes are
rechecked after status and pinned through the dual-lock launcher. An exclusive wx
mode0600 intent is fsynced with its directory before launch and never reset, including
launch errors. Independent listeners racing the same state launch at most once;
reconstruction refuses existing intent. HTTP202 is only queued acknowledgment.
CLI --serve takes absolute config/token paths and port, closes after330s and must
not be installed with automatic restart. No autonomous generation staging, renewal,
credential rotation or provider/control wake wiring is claimed. No live deployment.

Entrypoint reports bounded allowlisted failure codes with run/stop stage and separate
policy-expired/operator-aborted observations. Arbitrary exception code/message text
is excluded, original rejection remains nonzero, and failed stop does not emit stopped.
Thirty focused tests pass (including races, reconstruction, config TOCTOU, expiry
boundary and redaction). Combined verifier passed1605 backend/485 runtime tests and
local control checks, then exited1 when successor Worker returned500 Network connection
lost at same-key receipt readback. One isolated rerun passed; cause remains unproved.
Separate native hosted fixture, typecheck/build and16 desktop tests pass. This is not
a full verifier pass. Evidence .local/alpha-hosted-wake-{focused,combined,worker-rerun,
native,build,desktop}.log. No new provider/model calls or spend.

Live settled-session continuation (2026-09-18): epoch2 service journal recorded
recovery/nativeStopped:true and exact generation; bounded census found zero matching
Codex/workspace processes and zero read errors. Both predecessor locks acquired with
a no-op. No additional Sprite restart. These support restricted non-hostile alpha,
not universal descendant termination. Prior native auth/config/journals stayed in place.
Continuation Worker code deployed; bearer and epoch3 pin changed atomically. Independent
checks returned401 UNAUTHORIZED for epoch2 and409 STALE_EPOCH for epoch3 before activation.
Fresh credential/session directories were staged; same existing Access service scope.

Authenticated activation673418aa-e370-4cbf-a364-104bb62f792f applied03:30:53.819Z.
One UI commandda47d2ce-5f67-478b-b367-6ba50aacb626 at03:32:12.944Z admitted
runa5dd9a1c-2af6-4391-b40a-9a8c63186722, attempt1. Canonical run.result
49835173-2651-48be-872a-552dfda01a99 at03:32:18.427Z (5.483s) retained exact
HEHEBOT_CONTINUED_CHAT_OK_75, completed/error null, correct Chief of Staff/cause/run.
Full reload confirmed exactly one matching user event and completed result. Previous
completed74, old recovery0639f8f7 and waiting7481a204 stayed unchanged. Host independently
read one completed native textOnlyReceipt in session3 journal. No other model/task action.
Evidence .local/alpha-continuation-{stop-evidence,authority-check,receipt}.json,
.local/alpha-generation3-{launch.log,completion-receipt.jsonl,stop-evidence.json}.
Policy expired03:35:06.382Z with max3 admitted roots. Launcher emitted stopped,
stateRetained:true/replayAllowed:false, then exited1 with the generic refusal/stop
message; the specific exception is not exposed by that CLI. Independent retained
service readback confirms phase:recovery/nativeStopped:true. This verifies direct-child
stop, not universal descendant termination, effect settlement or safe sleep. No retry.
This is session rollover verification,
not ongoing availability. No new resource, upgrade or connector; actual billing unverified.

Settled-session continuation (2026-09-18, local): a fresh owner-alpha.activate grant
can append epoch3+ after the current text-only generation's policy and lease expire.
Every prior-generation attempt must be completed with an exact stored profile/turn/
output receipt and completed coordinator release. Unsettled operations/effects/locks,
questions or controller activity reject. A never-used expired generation may advance.
The original epoch1 unknown-retirement path is unchanged. No policy/quota is renewed
in place, historical result promoted, or prior journal replayed.

Reconstruction validates numeric contiguous generation order, exact predecessor
session/boot, increasing event cutoffs, unique identities and immutable activation
command/event digests. Later claim/watchdog SQL is current-generation-only, preserving
all earlier attempts/effects rather than excluding only the immediate predecessor.
Core epoch1→2→3 fixture preserves original dispatched effect and intermediate queued
message, refuses unfinished/failed/recovery statuses, changed receipt digest and held
lock, and rejects identity reuse/missing middle generation. Real workerd fixture
advances unused epoch2, reopens SQLite again and expires epoch3 with retained epoch1
custody unchanged. Runtime already accepts exact descriptors with epoch>=2.

Focused116 and final41/typecheck pass; desktop16 pass. The full verifier exits0 with
1605 backend/473 runtime plus native/Worker/browser/build checks in
.local/alpha-continuation-combined.log. Its extended Worker fixture passed, as did
an explicit WRANGLER_SEND_METRICS=false run. Three isolated direct invocations lost
a local connection during same-key readback; cause remains unproved. Evidence logs
.local/alpha-continuation-worker{,-rerun,-final,-metrics-off}.log preserve both failures
and success; no fixture retry hides these outcomes. No live/provider/model/deployment
or credential change. Operator process-retirement evidence and new server-bound
credentials remain necessary before any later hosted activation; database settlement
is not universal descendant retirement or safe-sleep proof.

Bounded restart follow-up (2026-09-18): owner said fix/continue. Current official
sprites-js0.2.3 at390eb6353576f5da57ef7ec4b7f1eec5223de5f3 confirms the initial empty
POST was correct; no version/body/idempotency/completion endpoint was missing.
Official Go error handling recognizes empty proxy502 and retains Fly-Request-Id.
Owner-requested oracle approved one additional same-Sprite attempt while predecessor
authority was revoked, no successor/autostart existed, with five-minute cap and
120-second observed stability. This is operational convergence, not deduplication
or a provider guarantee against delayed restart. The first unknown record is retained.

Precheck /check returned healthy. Second POST returned202 with Fly-Request-Id saved
privately; changed kernel identity observed at36s and stable122s at158s. Each read
verified same Sprite ID, retained disk nonce and empty services. No third request.
Evidence: .local/alpha-recovery-second-attempt.{json,log}. New disposition receipt
retains late-restart interruption risk, historical unknown settlement and no replay.

Generation-binding Worker code deployed; private pin configured and preactivation
runtime status denied409 STALE_EPOCH. Authenticated owner activation returned202
applied; runtime started fresh session/journal with one120s run and a five-minute
policy. Exactly one new message accepted03:00:56.993Z completed03:01:04.009Z (7.016s).
Receipt595cc42a-d77b-40fc-b27f-c30f2e7867b5/runaaeae25c-6b7b-473a-9f00-c61d70bd3fd7
bind canonical run.result9521ef1d-8cc4-408f-97f8-56ac0d5215bf, exact
HEHEBOT_HOSTED_SUCCESSOR_OK_74, Chief of Staff/coordinator/attempt1/error null.
Full reload retained completed task and canonical event; no provisional-only claim.
Host independently read native completed outcome plus textOnlyReceipt from first-party
journal. Historical recovery/waiting tasks remained unchanged; no task replay/cancel.
Inspected cropped .amp/in/artifacts/hosted-successor-74-completed.png shows recorded
Completed reply only. The launcher exited0 after expiry, state retained/no replay.
This proves bounded hosted completion, not persistent availability, historical effect
settlement or all future recovery. Next is safe bounded session continuation.
No old state or native auth cache copied, no new Sprite/connector/upgrade. Catalog
comes from pinned supported `codex debug models` on the authenticated Sprite;
selected genuine model metadata retains only deliberate direct-tool-mode and empty
experimental-tool-list overrides. Source catalog stays private, not redistributed.
The42KB config exposed a32KB launcher limit: raised to128KiB with exact-limit/+1 and
genuine-sized cases plus launcher/owner tests18 passing. No new broad suite repeated.
Production gates false; observed recovery is not production sleep/containment proof.

Restricted-alpha recovery (2026-09-18): owner-requested oracle supersedes the
universal retirement prerequisite below for this one supervised text-only trial.
The operator receipt means execution-authority retirement with observed restart
evidence, not historical settlement or hostile-workload containment. The server
binds its digest; it cannot independently attest physical evidence. Preserve old
unknown records and forbid replay. No production/native/sleep gate is relaxed.

Local Worker binding: after RUNTIME_TOKEN verification, private
HEHEBOT_RUNTIME_GENERATION parses exactly {epoch,boot_id,transition_id}. The trusted
RPC argument must match the persisted hosted successor generation and lifecycle
before any runtime reconciliation/mutation, including status and boot. Payload
identity must match; the credential cannot simply assert predecessor authority.
Reconstruction does not require the consumed successor grant. Missing/mismatched
pins deny; malformed pins return503 after authentication. Legacy local behavior
is retained. Full verifier exits0 (1605 backend/472 runtime plus native, browser,
Worker and build checks); desktop16 pass. Later focused63/typecheck also verify
missing/wrong-transition/malformed pins and authentication-first rejection.
Logs: .local/alpha-recovery-{combined,focused,desktop}.log. Code remains local,
not pushed or deployed; only the live secret was rotated.

Live authority cutover: predecessor runtime bearer returned Worker401 UNAUTHORIZED
after rotation. Browser worker deleted predecessor Access service token, changed
only the existing internal policy's token binding and read back after reload;
parent owner app/policy unchanged. Host independently confirmed predecessor401 and
successor404 JSON from Worker at internal/access-scope-probe. Fresh credentials
are0600 in this orb only, never placed in Sprite. No activation/model call occurred.

Exactly one supported POST /v1/sprites/{name}/restart returned502 with empty body.
First observation could not exec (temporarily unavailable); two later bounded
observations succeeded with UNCHANGED kernel boot identity. Same immutable Sprite
ID and disk nonce hash were preserved. The live inspector exited naturally at180s,
not because verified reboot terminated it. Disposition is restart_unconfirmed;
no second restart or claim that Sprite malfunctioned. Private intent/evidence:
.local/alpha-recovery-restart-request.json, restart-before.log, restart-after*.log,
restart-final.log, identity-before/after.json and alpha-recovery-disposition.json.
The disposition explicitly forbids successor activation and old replay; never use
its digest as a successful-restart grant. Next provider question: how do we observe
completion of this restart request, given502 and unchanged kernel identity?
No public post/contact authorized or performed. Incremental billing unverified;
same resource only, no paid upgrade, new Sprite, inference or connector activation.

E11 read-only token display (2026-09-17, local): expanded conversation/current-task
and routine-history cards share strict unique-current-attempt validation. Native
cumulative and last snapshots retain six separate counters plus nullable context
window; attempt/version identify the observation, not freshness. Missing, malformed,
duplicate and mismatched observations show unavailable. Selected page data never
falls back to global state, and recovery-only pages have no usage contract. Counts
are literal DOM text, not dollar estimates, percentages, sums or settlement proof.
Usage-only changes participate in rendering; no new polling, route, command or grant.

`node scripts/test-portal-token-usage.mjs` passes asymmetric/decreasing/zero/absent/
malformed/duplicate/stale and page-isolation cases with35 existing GETs/zero writes.
Task, routine-history and alpha-session neighbors pass; build/typecheck and desktop16
pass. Final desktop1280px/narrow390px at2x and unavailable screenshots inspected:
token labels/counters/disclosure readable without clipping. Wide unavailable capture
also shows unrelated existing search-header overlap; not changed here. Screenshots
`.amp/in/artifacts/token-usage-{desktop,narrow,unavailable}.png`; logs
`.local/token-usage-ui-{final,desktop}.log`. Chromium synthetic API evidence, not
physical mobile/touch/Safari/live production verification. No CSS/backend or live
changes/spend. Fixture added to verifier; prior backend1604/runtime472 evidence below
predates only this UI-only stage, not a newly rerun full suite.

E11 token snapshot publication (2026-09-17, local): existing native journal usage
is sent through `token-usage` during the existing task-control output-maintenance
cadence. Root and registered-child observations retain separate task/attempt/native
bindings. A durable pending payload precedes dispatch; unknown acknowledgement must
retry that exact version/content before newer snapshots, including decreases.
Unchanged observations add no calls. A fenced target stops further publication.
This adds no inference, provider wake path, tool or task grant.

Worker `TokenUsageSnapshots` validates six safe nonnegative integer counters per
total/last group and nullable context window. Current epoch/boot/attempt/native
reference, active status and deadline are required. Same-version semantic duplicates
do not write; conflicts and stale versions reject. Counts replace, never accumulate.
Fixed first-observation90-day retention cannot be extended by updates. Ordinary
maintenance prunes; successor mode preserves its existing historical boundary.
Owner state/task pages expose `token_usage_snapshots` only for returned current
attempts, without native references. Terminal readback is historical observation,
not guaranteed final/fresh usage. Absence is unknown, not zero; root and child
native context/session snapshots are not additive task spend or billing receipts.
Neither observations nor reads settle work, modify budget or refresh progress.

Core14 and preview-neighbor13 tests, runtime publisher4 and actual signed-Access
Worker8 tests pass, including exact uncertain retry, replacement/decrease, custody
fences, malformed input and unchanged task rows. Desktop16 pass. Combined verification
passed1604 backend/472 runtime and browser/HTTP checks before the process disappeared
without a final marker; remaining crash/native/service/build sequence resumed
separately and exits0. This is not an uninterrupted full-verifier pass.
Logs `.local/token-usage-{focused,combined,combined-remaining,desktop}.log`.
No UI/live deployment/provider/model call or additional spending in this stage.

Retirement investigation (2026-09-17): one bounded read-only census on the verified
same immutable Sprite returned tini/tail plus inspector, no per-process errors,
one observed PID/mount namespace. Independent provider GET found no service
definitions; exec-session listing found none. This narrows visible surviving work
but does not establish namespace completeness or correlate missing historical
PID/start/namespace IDs. Empty configured model tool allowlist is not proof that
legacy native tools could not create processes. Unknown task/effect custody remains.
Private evidence: `.local/sprite-retirement-{inventory,identity,services}.json` and
`.local/sprite-retirement-sessions.log`. No code changes or tests needed for this
inspection; previous combined1590/467 and desktop16 evidence unchanged.

The official SDK exposes [restartSprite](https://github.com/superfly/sprites-js/blob/4c2b346ed35456e07b5a69cd00a53292e40d6fc4/src/client.ts#L305-L321),
POST `/v1/sprites/{name}/restart`, described only as restarting the backing machine.
Its mocked202/queued response is not completion proof. Public server semantics
were not found. [Service docs](https://docs.sprites.dev/concepts/services/) describe
sticky stops but also HTTP-triggered autostart; their interaction with this endpoint
is not a proven fence. Guest Linux reboot has PID-namespace-dependent behavior and
must not be improvised on retained custody.

Exact provider clarification needed: does this restart discard all prior guest
execution/memory and prevent later restoration, preserve the immutable Sprite ID
and current filesystem without rollback, and preserve explicit service-stop fences
against HTTP autostart? Which observation proves completion rather than queued
acceptance? No provider contact or restart was performed. Inspection billing remains
unverified; no inference, new resource, paid upgrade, replay or deployment.

Successor command integration (2026-09-17, local/unpublished): authenticated
same-origin `/v1/commands` accepts `owner-alpha.activate` with only
`{transition_id,envelope_sha256}`. The digest identifies the parsed/canonical
operator envelope from default-absent private `HEHEBOT_OWNER_ALPHA_SUCCESSOR`.
Worker configuration requires original hosted alpha (Access, both production
flags false, empty provider); successor binding must equal the actual durable
owner-auth digest. Browser/runtime inputs cannot supply replacement authority.
Activation uses the normal accepted→applied command transaction, persisting full
consumed authority and command digest in immutable generation metadata. The ingress
uses canonical JSON hashing: lifecycle must retain this supplied digest rather than
recompute it with property-order-sensitive JSON.stringify. Reconstruction does not
need pending operator config and validates command fields independent of key order.
Activation bypasses historical reconciliation even when rejected; applied activation
arms only generation supervision. Ordinary ingress behavior remains unchanged.

Real workerd/SQLite fixture now calls actual PersonalControl.accept, snapshots old
custody before activation, retries equivalent reordered JSON through canonical
HTTP hashing, and verifies reads/alarms/persistent reopen. Signed-Access fixture7
also verifies valid configured startup, missing grant, wrong JWT/Origin, no internal
runtime activation and owner-binding mismatch refusal. Combined verification exits0:
1590 backend/467 runtime plus Worker/native/browser/build in
`.local/alpha-activation-combined.log`; desktop16 pass in
`.local/alpha-activation-desktop.log`. Final targeted Worker fixture additionally
rejects a changed digest without mutating old lifecycle, alarm or history
(`.local/alpha-activation-worker.log`). No UI appearance changed in this stage.

One bounded same-Sprite kernel observation at18:28UTC matches the retained baseline
exactly (`.local/sprite-retirement-kernel-followup.log`). It supplies no retirement
evidence. No live activation/deployment/model call or new resource; probe billing
increment remains unverified. Existing $10 total authority, gates false and all
historical uncertainty remain intact. Older stage descriptions below are historical.

Worker successor follow-through (2026-09-17): once an active generation exists,
`PersonalControl.reconcile` runs only the generation-fenced watchdog. Retention,
routine/retry/budget/question/preview/steering and other maintenance remain suspended
for this bounded successor, preserving historical custody rather than reconciling
it. Alarm selection ignores old due times; recovery deletes the alarm. Internal
runtime status exposes only the generation's epoch/boot/transition descriptor.
Ordinary no-successor maintenance is unchanged.

The new `test-owner-alpha-successor-worker.mjs` starts actual workerd/SQLite with
allowlisted subprocess environment and disposable storage. Actual state reads,
fresh accept and explicit alarm invocation preserve old run/attempt/unknown effect,
overdue retry, queued context/command/event and original policy. Successor lease
expiry still closes epoch2. Stopping/reopening Wrangler on the same disposable
SQLite preserves exact history, lifecycle, descriptor and absent alarm. Synthetic
fixture-only applied activation is not a public API or retirement proof. Script,
ordinary27 Worker checks and existing migration/capacity cases, typecheck/build
pass; logs `.local/alpha-successor-worker{,-reopen}.log`. Added to the combined
verifier; the previous full1590/464 run below predates this narrow follow-up.
No live resource/account/model calls, deployment or additional spend.

Retained generation core (2026-09-17, local/unpublished): trusted internal
`LifecycleCore.activateOwnerAlphaSuccessor` can consume a matching preexisting
synthetic applied command and operator binding. It validates expired recovery
custody and atomically appends one epoch2 generation/activation event while advancing
only lifecycle ownership. This first implementation refuses further transitions.
The original configured policy/custody remain unchanged. Active policy resolves
through the generation, its command receipt and exact event-sequence cutoff;
quota derives from retained attempts. Old input cannot become fresh through requeue.
Claims exclude only the exact retired predecessor from executor capacity, and
watchdog preserves that predecessor without weakening ordinary lifecycle handling.
No historical task acquires the new text-only contract.

Runtime `ownerAlphaGeneration` pins epoch/boot/transition before status/boot RPCs
in a fresh journal, requires matching hosted text-only policy and owner binding,
and uses only the preselected boot identity. Mismatch refuses before provider hold
or native launch. Host review corrected mutable generation admission tracking,
added activation receipt/cutoff reconstruction checks and independent status epoch
validation, and bounded the initial transition rather than pretending a full
multi-generation chain was verified. Focused121 backend and54 service tests pass;
final retention/cutoff checks19 pass. A first combined run exposed `causation_id`
instead of existing `cause_id`; corrected. Full rerun exits0:1590 backend/464 runtime
tests,27 Worker HTTP checks plus native/browser/service/build; desktop16 pass. Evidence:
`.local/alpha-generation-{focused,retention,combined,combined-rerun,desktop}.log`.

This is not a publicly callable activation: command schema/dispatch, pinned operator
configuration, runtime status descriptor and Worker-wide historical maintenance
exclusion are still unwired. The internal fixture inserts a synthetic applied
command; real activation must remain an authenticated idempotent `/v1/commands`
transaction and derive authority from operator configuration, never browser claims.
The current core method's applied-command requirement needs adapting to that
transaction without permitting an unbound command. Process-retirement evidence is
still unavailable, and none of this establishes provider retirement or live chat.

Successor authority preparation (2026-09-17): `parseOwnerAlphaSuccessor` and
`assertOwnerAlphaSuccessorBinding` validate a default-absent, one-shot operator
envelope with exact owner binding, predecessor session/epoch/boot, retirement
receipt digest and fresh text-only successor policy/boot. Existing policy parser
remains the source of truth. Epoch advancement must remain safe; UUID case changes
cannot disguise reused session/boot identities. No config wiring, command, state
mutation or activation exists yet. Focused successor/alpha/session-view76 tests and
typecheck pass (`.local/alpha-successor-contract.log`); the full verifier below
predates this non-wired parser. Receipt hash binding is not retirement proof.

Focused design review selected operator-pinned authority over a new signing-key
subsystem: the operator already controls deployment/auth. The owner command must
only consume that exact grant. Immutable generation metadata can bind existing
attempt epoch/boot fields, without an attempts schema migration. Use an event-
sequence cutoff, not clock equality, for fresh messages. Both the transition's
pre-request reconciliation and later pruning/watchdog/budget maintenance must
exclude retained historical custody; merely preserving rows in the transition
transaction is insufficient. Keep the original configured policy and custody,
derive active policy from a validated generation, and bind a preselected successor
boot identity. The parser does not implement any of these later stages.

Text-only completion integration (2026-09-17, local/unpublished): a fresh immutable
alpha policy can pin `codex-text-only-v1` and its profile digest. The adapter records
that admission before native RPCs, empty dynamic tools/environments and exact ACK
identities. Service completion refreshes config/catalog and full native history,
flushes routed observations, checks every output digest, rejects forbidden history,
and projects settled coverage only for the admitted profile and completed root.
A settled heartbeat and cancellation check precede the backend completion request.
The backend checks the current fenced attempt, completed coordinator release,
exact output digest and absent children/effects/locks/questions/unsettled operations;
it commits the canonical receipt with the result and rejects changed or missing
proof on replay. Legacy sessions remain ineligible; alpha sleep remains denied.

Focused checks pass112 runtime and88 backend/bridge tests. New real pinned native
`test-codex-service.mjs --text-only` uses a disposable HTTPS Worker/SQLite and one
scripted provider request: completed run, one attributed persisted `run.result`,
exact receipt and no residual preview. The normal service case also passes.
Native owner-alpha receipt now refreshes final config/catalog/history and derives
notification health from observed transport state. This is scripted local evidence,
not genuine account/model catalog provenance or hosted acceptance. Host integration
found and corrected wrong verifier input, missing pre-admission pin and insufficient
live/readback output comparison. Service corruption fixtures retain uncertainty.
Combined verification includes the new native service case and exits0:1571 backend/
457 runtime tests,27 Worker HTTP checks plus native/browser/service/build; desktop16
pass. Evidence is in `.local/text-completion-{focused,backend,combined,desktop}.log`.

The next retained-session transition must append an immutable generation and
retirement evidence, advance only executor ownership, and admit messages strictly
after its committed cutoff. It must not call generic stopped reconciliation, which
settles operations and can schedule retries. Preserve old policy, attempts, effects,
locks, previews and journals; old work cannot inherit the new text-only profile.
No transition implementation or live rollout is claimed by this checkpoint.

Text-only profile integration (2026-09-17, local/unpublished): the shared
`codex-text-only-v1` constructor supplies the actual CLI overrides, thread model/
empty dynamic tools and turn empty environments used by the native fixture.
Host review removed duplicated fixture configuration, added absolute catalog-path
binding, rejected mixed synthetic/genuine attestations and contradictory optional
tool readback. Catalog provenance/account checks remain caller attestations, not
proof produced by this helper. Native validation still returns completionEligible
false. Profile/transport28 tests and all three native owner-alpha modes pass;
text-only has17 exact unsupported calls, empty tools on every provider request,
two root outputs and unchanged private config/catalog. No historical attempt gains
eligibility. Runtime/service admission, coverage and backend completion remain
unimplemented. Logs: .local/text-only-profile-{native,neighbor,normal,runtime}.log.

The retained-session review also found and fixed a concrete lifecycle race:
provider observation awaits now compare epoch, boot ID, provider reference and
controller operation against captured ownership before any cleanup/wake/stop.
Tests cover changed recovery generation, same-epoch identity changes, matching
positive retirement and an idle Sprite reference change; concurrent state is
preserved. This does not change provider stop semantics or authorize retirement.
Focused lifecycle/provider/typecheck evidence is in
.local/text-only-profile-lifecycle.log (126 tests). Combined verifier exits0 with
1562 backend/449 runtime tests,27 Worker HTTP checks plus native/browser/service/
build; desktop16 pass. Logs .local/text-only-profile-{combined,desktop}.log.

Retirement evidence remains distinct from task completion. Official
[Sprites lifecycle](https://docs.sprites.dev/concepts/lifecycle/) says actual cold
discards all process memory, but also calls the transition unobservable. The
[Get Sprite API](https://sprites.dev/api/sprites/) exposes cold/warm/running
without a post-generation observation ordering contract. The documented
[exec kill](https://sprites.dev/api/sprites/exec) signals a process group; it does
not promise escaped-descendant termination. No historical exec-session ID was
retained; an owner-alpha session ID is not a provider exec ID. Fresh cold GET alone
must not clear global custody. Next retirement work needs immutable Sprite identity,
expected epoch/boot, no-restart fencing and authoritative post-execution memory-loss
evidence. Even that would retire processes only: old output stays provisional,
unknown effects/locks persist and no historical replay is allowed.

One authorized read-only exec probe (timeout10s, exit0) reused the existing Sprite:
kernel btime15:10:31Z, observed16:29:38Z, uptime4747.40s, after the failed13:18Z
attempt. This initially looked promising but does NOT prove a reboot. The
[Fly forum clarification](https://community.fly.io/t/when-is-a-sprite-actually-cold-reported-cold-sprite-woke-with-its-original-process-running/28288/3)
explicitly says cold often retains memory and btime updates on resume; reports
include original processes/boot IDs surviving13–28h of cold status. Current boot
ID is retained privately in .local/sprite-retirement-kernel-observation.log as a
baseline, not a retirement receipt. Relevant retained Sprite/hosted logs contain
no earlier kernel boot ID. Application boot_id is a random UUID and cannot be
compared to the kernel ID. A verified later kernel-ID change on the same immutable
Sprite, with no-restart and generation fences, is a possible evidence path;
repeated cold/btime polling is not. No service change, new model call, credential
movement, deployment or new paid resource. Probe billing increment and cumulative
balance remain unverified; existing total $10 authority continues.

Hosted trial outcome (2026-09-17): runtime-only Access app and dedicated service
credentials passed independent host and Sprite ControlClient tests, including
owner-binding digest match, wrong/missing bearer401 and public root/state302.
Authenticated browser /v1/state200 proves initialization. Owner approved connecting
runtime/chat under remaining existing $10 with no repeated scoped approvals.
The real launcher reported READY epoch1/providerHold:true with productionfalse.
Browser sent exactly one fresh prompt at13:18:28.168Z: command
7ee4ae8b-4779-4d92-bb6b-1a2857184954, run0639f8f7-0d27-411f-a57f-a2c56689c9fa.
Exact HEHEBOT_HOSTED_CHAT_OK_73 preview persisted across reload (attempt1/version1),
but no completed assistant event. Native journal independently reports rootSettled
true/nativeOutcome completed/status finishing and retained family. At13:20:28.657Z
deadline caused cancellation; at13:21:11.749Z readback was recovery_required /
CANCEL_UNCONFIRMED. No manual cancel/retry/replay. Old waiting run
7481a204-9126-4ed3-a8db-a0106e7a9156 remained attempt0/CAPABILITY_UNAVAILABLE.
Session expired13:22:11.726Z plus30s grace; launcher exited0 with retained state,
settlementProved:false/replayAllowed:false. Worker RECOVERY_REQUIRED, gates false.
Sprite initially observed warm, later read-only observation cold; neither wrapper
exit nor VM phase proves recursive termination. This is NOT successful completed chat. Inspected cropped screenshot:
.amp/in/artifacts/hosted-chat-provisional-readback.png. Private logs/readbacks:
.local/hosted-chat-{deploy,launch}.log, hosted-runtime-auth-check.json,
hosted-chat-final-status.json and sprite-chat-after.json. Existing expired policy
and journals must remain; no reset or retrospective completion qualification.

Local follow-through: source investigation and focused oracle confirm root-only
observations cannot justify the five-part completion receipt. Goals can continue
after turn completion; current MCP/shell/extension surfaces are not closed, and
history permits late item completions. Added --text-only to existing native
fixture using supported empty environments, static direct model catalog, no MCP/
dynamic tools, and disabled goals/hooks/utility features. Passed: exactly empty
provider catalog on every request,17 exact unsupported dispatches, two root outputs,
no background terminals, unchanged original config/catalog, three loopback calls.
Initial config/read assertion failed because extension tool settings are omitted;
kept exact behavioral catalog/dispatch assertions rather than invent readback.
completionEligible remains false; no live admission change. Full verifier includes
new mode and exits0:1556 backend/444 runtime tests,27 Worker checks plus native/
browser/service/build; desktop16 passed. Logs .local/hosted-text-only-{combined,desktop}.log.
No active check remains. Next is a distinct
versioned closure/receipt/coverage contract plus narrowly scoped Worker completion
and retained-session lifecycle, not longer timeouts or claiming root settlement.

Hosted runtime preparation (2026-09-17): owner confirms portal loads and authorizes
runtime/supervised chat under remaining existing $10 total without repeated scoped
approval. Existing Sprite observed cold, no executor. Current tracked source copied
to distinct /home/sprite/hehebot-hosted-chat; npm locked install, pinned0.154.0 and
provider build pass. Existing native auth remains in place; supported account/read
(refreshToken:false) and model/list confirm ChatGPT/gpt-5.6-luna, no inference.
Real Sprite Tasks GET404→PUT200→readback→renew/readback→DELETE204→GET404 passed.
Native profile fixture initially failed before any turn/model request because
bundled bwrap rejects Sprite's inherited capabilities. Identical fixture under
setpriv with bounding/inheritable/ambient caps dropped and no-new-privileges passes
in825ms: config bytes unchanged, restricted profile readback, exact root outputs,
spawn denials/no children. Effective/bounding/ambient caps all0 and NNP1 verified.
No dependency patch or sandbox bypass. This is not recursive termination proof.
Dedicated private runtime bearer deployed as Worker secret; no alpha admission
yet. Existing browser worker owns runtime-only Access Service Auth setup, parent
owner app unchanged. No model calls, new Sprite, connector/routine activation or
paid upgrade; actual billing balance still unverified. Old waiting messages are
not eligible for queued-only claims. Existing hosted session bounds remain ≤5min
and ≤3 roots, not continuous service. Host retains deployment/runtime ownership.

Full control-plane deployment (2026-09-17): owner supplied successful bootstrap
identity and directed continuation. Host saved valid JSON0600 and generated private
deployment configuration from checked-in wrangler config plus verified identity.
63 auth/owner-binding/hosted-policy tests pass; npm run build and private release
dry-run exit0. Actual Wrangler4.130.0 deploy exit0: four public files uploaded,
2356.86KiB Worker/254.63KiB gzip, startup12ms, CONTROL namespace with SQLite migration
configuration. No retained local state or runtime credentials uploaded. Remote
settings readback matches all configured vars (including owner pin, issuer/AUD,
disabled execution/native), and exactly ASSETS + CONTROL non-variable bindings.
Previews disabled; zero target custom domains. Seven anonymous/forged probes of
root, state, assets, command/internal POST, former bootstrap path all302 to exact
Access team, no data. Owner bootstrap login succeeded; full portal/state login and
new-store initialization still await owner browser confirmation. No claimed hosted
assistant execution. No paid upgrade; billing balance unverified. Private evidence
in .local/control-deploy-{auth,build}.log, control-release-{dry-run,deploy}.log and
control-release-live-check.json. No Access app mutation or Git push.

Identity-only deployment (2026-09-17): browser independently reloaded/read back the
exact-host Access app and sole exact-email Allow policy, one-hour duration and no
bypass, then released ownership. Host app/policy GET403/1010 and list200/empty
persist; token discrepancy unresolved. No duplicate or unrelated app mutation.
Separate owner-bootstrap entrypoint has no database/assets/runtime bindings. It
accepts only exact-host HTTPS GET /__owner-bootstrap and verifies signed RS256
issuer/audience/email before returning the subject with private/no-store. It
neither guesses OWNER_SUB nor grants control-plane access using email alone.
34 bootstrap/auth tests pass, typecheck/dry-run exit0. Actual Wrangler4.130.0 deploy
exit0, 36.49KiB upload/10.15KiB gzip, startup2ms. Live anonymous bootstrap/root/API/
asset plus forged-header probes all302 to configured team Access login. API readback
confirms production hostname enabled, previews disabled, only four bootstrap vars,
zero target custom domains; account zone list200/empty. No successful authenticated
owner login yet. Owner saves displayed verified JSON privately; only then pin
OWNER_SUB and replace bootstrap with current full portal/fresh SQLite deployment.
No retained state, inference, Sprite, connector activation or paid plan change.
Actual billing balance unverified; limited Worker requests do not renew allowance.
Private evidence: bootstrap-deploy.log, bootstrap-live-check.json,
bootstrap-zone-check.json and cloudflare-access-handback-check.json in .local/.

Access write attempt (2026-09-17): private owner config now present and validated
without disclosure; expected team JWKS responds. Authorized POST for one self-hosted
production hostname app with one exact-email allow policy returned HTTP403,
code1010 auth.forbidden. GET afterward confirms total apps0/target0; no blind retry.
After the owner's permission-update report, token re-read and app-list-before-create
preceded one new attempt: same403/1010, app-list-after again0. Token active/same ID,
file unchanged since original provisioning, which does not disprove dashboard scope
edits. Token permission introspection denied403/9109. Official create docs confirm
Access: Apps and Policies Write. Subsequent blanket-permission report prompted one
bounded retry after verifying original authorized account against current listing
and Bearer-only authentication: still403/1010, apps before/after0. Token active
through 2026-09-30T23:59:59Z. Ray a3c6ea200e7506ac-SEA at
2026-09-17 08:59:23 UTC; no X-Request-ID. Account members read succeeds and configured
owner is accepted Super Administrator; this does not identify the token creator.
Token detail/groups denied403/9109, memberships/organization denied403/10000;
IdPs read succeeds but empty. Team-account mapping/Free-plan onboarding and token
creator scope remain unverified; no definitive root cause established. Stop create
attempts. AUTH_SETUP.md records dashboard resource/role/team-plan/IP checks and
manual exact-host, exact-owner-only app fallback. Dashboard edits need not change
token value/mtime; no replacement request for that reason. Private diagnostics:
`.local/cloudflare-access-diagnostic.json` and
`.local/cloudflare-access-readonly-diagnostics.json`.
No Worker/database/bootstrap published or successful shared mutation. Retain existing
scope/approval, no renewed budget or repeated setup. Subject still needs verified
login after protection is available. Private plan/error/readback files retained;
no secrets printed. Documentation-only checkpoint, no tests rerun. Billing remains
unverified, no resource creation/inference/Sprite/connector action.

Owner onboarding recheck (2026-09-17): following “done”, privately verified same
account and active token; workers.dev now exists and Access apps list200/zero.
One unrelated Worker exists, not hehebot-portal; untouched. Organization/users/
subscriptions remain403. No team-domain/owner-email file or environment setting
exists here; coordinating thread confirms none supplied there either. Request only
those two private inputs; no repeat onboarding or consent. Exact owner sub still
requires verified login/bootstrap. No shared writes, deployment/public URL, tests
or billed-resource creation. Raw response mode0600 at
`.local/cloudflare-preflight-current.json`; remaining billing balance unverified.

Continuation pause (2026-09-17): saved schedule read, clean checkout/current handoff
checked, no active assignment or new account input. Schedule update confirmed
enabled:false while the prioritized deployment awaits the already-requested
Cloudflare onboarding/Access permission/owner identity. No new account probes,
tests, infrastructure writes or connector work. Resume on those private inputs;
the bounded deployment authorization and existing budget limits remain unchanged.

Protected workers.dev preparation (2026-09-17 Asia/Jakarta): owner explicitly
authorized control-plane Worker/SQLite and exact-owner Access on the verified
account within the remaining existing $10 ceiling, no paid upgrades. No domain
purchase required. Official Workers Access documentation and October 2025
announcement support hostname-based production workers.dev with the existing
Cf-Access-Jwt-Assertion/JWKS flow. Retain exact issuer/audience/subject checks;
do not adopt ctx.access (Static Assets limitation) or assume new Wrangler APIs.
Pinned Wrangler4.130.0 schema and dry-run accept explicit preview_urls:false.
Default workers_dev remains false until Access is configured; assets run Worker
first; no alternate routes added. 42 auth/policy tests and 8 hosted-runtime tests
pass, as does npm run build at `.local/workers-dev-{auth,build}.log`. No full
combined rerun for this docs/config/auth-regression-only change; preceding combined
evidence remains `.local/wapp-prepare-combined.log` for unchanged implementation.

Private read-only API check reused the mode0600 token: active token, one account,
zero Workers. workers.dev subdomain returns10007; Access applications return
not_enabled; organization/users/subscriptions return403. Account details/token/raw
response remain private in `.local/cloudflare-preflight.json`. No writes/deployment
or public URL exist, and no live owner authentication can yet be verified.
Owner onboarding/Access permission and exact owner subject are unresolved, not
a custom-domain requirement. AUTH_SETUP.md gives the minimal Free dashboard/private
credential step. Billing/remaining balance is unverified; no new budget, Sprite
activity, inference, connector use or retained-state upload. Connector expansion
is lower priority than resuming this authorized deployment when inputs arrive.

WhatsApp prepare-only mode (2026-09-17 Asia/Jakarta): the existing pinned verifier
now accepts `--prepare /absolute/new-directory`. It reserves a private new directory,
performs the unchanged artifact/approved-patch/synthetic compatibility checks and
moves only the checked installation into its final location after success. A
0600 prepared-not-enabled receipt records observation time, lock hash and results.
It is not a full-tree attestation or fresh inventory. Existing destinations refuse;
normal failure removes only new staging. npm gets disposable HOME/config/cache and
an allowlisted environment; Git cannot discover a surrounding checkout. Default
invocation still deletes its graph. No pins, patches or startup gates changed.

`node --test tests/wappmcp-prepare.mjs` passes both tests: exact retained graph/receipt,
0700/0600 permissions, destination refusal, download-failure cleanup and hostile
inherited npm/Git/tar config. Initial Git ceiling at the current directory failed
the existing double-patch assertion; moving the ceiling to its parent fixed the
inside-checkout case. Test graphs are removed afterward. The new fixture is wired
into the combined verifier, which exits 0 at `.local/wapp-prepare-combined.log`:
1542 backend/444 runtime, both installation modes, 27 Worker HTTP checks and
browser/native/service/build pass. Desktop16 pass at `.local/wapp-prepare-desktop.log`.
Read-only delegated review of existing license evidence confirmed 350 inspected
locations/40 binary candidates, incomplete LGPL WASM/native-build/Public Domain/
vendored-asset/notice obligations; no legal or redistribution approval. Guidance is
in config/wappmcp/README.md. Startup, live inventory, pairing and recent-read
compatibility remain separate gaps; no account/provider calls or deployment.

WhatsApp transport binding (2026-09-17 Asia/Jakarta): `createWappMcpReader`
captures host task/attempt/lease, scopes and deadline, persists a payload-free
fingerprint against rebinding, validates actual authority envelopes with the
generated runtime schema, and connects fixed-endpoint ControlClient checks to
journaled MCP reads. The SDK receives tightened timeout/cancellation and retains
its default result schema. No connector is installed/started/registered here.
The host still supplies the correct initial task-to-journal association and one
already connected client; one executor owns the journal. Read-only authority
HTTP calls retain ControlClient's bounded timeout, not server-termination proof.

Five binding tests and all 444 runtime tests pass (`.local/wapp-binding-runtime.log`).
Actual pinned SDK/public-server fixture now also passes with synthetic authority:
exact scoped search returns, recent-read rejection keeps unknown intent, no
repair/fallback/replay. Both results preserve unknown browser settlement. Combined
verification exits 0 at `.local/wapp-binding-combined.log`: backend1542,
runtime444, pinned connector, 27 Worker HTTP checks and browser/native/service/build
pass. Desktop16 pass at `.local/wapp-binding-desktop.log`. No live account/model/provider
calls, changed pins or production gates. Startup/inventory, production registration,
supported process supervision, pairing and live coverage remain open.

Connectors portal (2026-09-17 Asia/Jakarta): hash-verified UI patch integrated.
On-demand page beside Skills displays only bundled WhatsApp diagnostic metadata,
unobserved runtime inventory/no authority, per-read-tool protocol differences,
recent-read blocker and prerequisites. Catalog reads occur on open/restored
selection or explicit Refresh catalog, not ordinary state refresh. No connector
commands, install/pair/enable/probe controls or inferred status for absent providers.
Managed pages are not conversations; navigation/offline/late/alpha checks remove
stale content. All text is literal; source is inert. Host Chromium fixture passes
at `.local/connector-catalog-ui-host.log`; five desktop/narrow/loading/error captures
inspected. Existing internal timeline scrolling starts at its top. Combined exits
0 with 1542 backend/439 runtime, 27 Worker HTTP checks and browser/native/service/
build; desktop16 pass at `.local/connector-ui-{combined,desktop}.log`.
Synthetic Chromium is not device/touch/Safari or live connector evidence.

Owner connector catalog (2026-09-17 Asia/Jakarta): GET /v1/connectors/catalog
returns the existing pinned WhatsApp catalog through authenticated owner ingress.
The envelope labels it bundled-diagnostic-baseline, runtime inventory unobserved,
authority not-granted. No installation/probe/grant occurs; false installed evidence
belongs to the historical bundled baseline, not current inventory. Per-operation
incompatible recent-read vs synthetic-only search remains explicit. Alpha denies;
120/minute owner read limit and no-store apply. Readback copies JSON and performs
no overdue scheduling, alarm arming, inference or provider access.
46 focused HTTP/auth tests and typecheck pass after correcting test-only JSON
typing (`.local/connector-catalog-focused-final.log`). Tests cover signed owner,
foreign/runtime/missing credentials, nonlocal bypass, denied POST, exact rate
boundary, overdue custody, detached response and alpha. Real Worker HTTP fixture
now checks the endpoint. Combined exits 0: 1542 backend/439 runtime plus 27 Worker
HTTP checks and browser/native/service/build; desktop16 pass at
`.local/connector-catalog-{combined,desktop}.log`. Existing UI worker is implementing
an on-demand diagnostic page on the exact unpublished base; not yet integrated.
No catalog status edits, new schema/migration, live/shared actions or gate changes.

Real Worker capacity follow-through (2026-09-17 Asia/Jakarta): hash-verified
two-file fixture integrated and imported by test-local.mjs. A test-only
PersonalControl subclass injects a fixed future clock and readback, leaving real
constructor/accept/reconcile/alarm/arm code intact. Disposable Wrangler workerd
SQLite proves 20 enabled routines (13/7 across two personas), atomic 21st refusal,
disabled draft, 20 coalesced runs after twelve missed ticks, duplicate identity
retention, 13 replacements/seven skips, then exact rows/IDs/context/alarm after
stopping and reopening Wrangler on the same storage. Next alarms are 00:15,
03:15 and 03:45 at each stage. Execution/native flags remain false; active runs
are CAPABILITY_UNAVAILABLE, all attempts zero, no attempts/effects/outbox, and
lifecycle STOPPED/STOP with queue_sequence0. Budget variant remains in the
separate core test below, not claimed by this fixture.

Host commands: node check and `node scripts/test-routine-capacity-worker.mjs`,
`npm run typecheck`, `npm test` (76 files/1540 tests), `npm run test:e2e`
(migration/reopen, capacity/reopen, 26 existing Worker HTTP checks) all pass.
Logs: `.local/routine-capacity-{worker-host,backend,e2e}.log`. Fixture-only changes;
unchanged native/browser/desktop code retains its preceding combined evidence.
No hosted/timed alarm delivery, production ingress auth, live execution,
throughput or dollar-cost evidence. Routes are loopback-only, subprocess env is
allowlisted with disposable HOME, and cleanup removes processes/config/storage.
Retain the cap; there is no evidence here for a cost-safe increase.

Routine capacity prerequisite (2026-09-17 Asia/Jakarta): `tests/schedule.test.ts`
now tests the installation-wide 20/21 enabled boundary with 13/7 routines across two personas,
editing at capacity, disabled drafts and slot reuse. No runtime behavior changed.
A second case makes all 20 routines due after twelve 15-minute ticks: coalescing
creates 20 runs, each recording 11 omitted ticks, not 240 runs. Reconstructing
ControlCore on the same SQLite store and repeating reconciliation adds none.
At 03:30, 13 queue-one routines replace their own pending run, while seven skip
routines preserve theirs. Four optional routines remain BUDGET_UNKNOWN; final
counts are 13 cancelled, 16 queued, four waiting, 40 occurrences and zero
attempts/effects/outbox records. Queue sequence is 25 (16 initial plus nine
replacement admissions); it is not a count of actual provider wakes.

Command: `npx vitest run tests/schedule.test.ts tests/routine-lifecycle.test.ts
tests/budget-admission.test.ts` passes 3 files/33 tests; `npm run typecheck`
passes (`.local/routine-capacity-focused.log`). This is a test/docs-only
checkpoint, so the unchanged native/browser implementation retains its preceding
combined evidence rather than repeating it. No latency/throughput measurement,
workerd restart proof, live model execution or dollar-cost estimate is implied.
Keep the cap pending real Worker batch/alarm and execution/cost evidence. Even
20 minimum-cadence routines have 1920 nominal daily ticks before coalescing,
overlap and budget gates; that arithmetic is not billable inference or wake count.

Task-to-skill portal (2026-09-17 Asia/Jakarta): eligible retained task cards now
open the existing bounded editor with a blank procedure and explicit source
persona/run/attempt disclosure. Nothing is copied from task input/output, and
opening emits no extra read or write. Source, persona, navigation, attempt,
offline and alpha checks precede submission; uncertain retries preserve the
same exact body/source and key. Server retention rejection stays visible.
Failed/unfinished sources do not imply success or settlement. Approval and
enablement remain separate. See [UI scope](SKILL_TASK_PROPOSAL_UI.md).

UI worker patch hash verified and integrated; host fixed streamed UTF-8 decoding
in its HTTP fixture and added it to the combined verifier. Host Chromium fixture
passes (`.local/task-skill-ui-focused.log`); desktop16 pass. Desktop/narrow,
scrolled references and server-error screenshots inspected, with DOM checks for
scrolling/footer separation. Full combined rerun exits 0: 1538 backend/439 runtime
plus Worker/browser/native/service/build checks at `.local/task-skill-ui-combined.log`.
Neighbor task-feed and cancellation fixtures also pass. These are synthetic HTTP/Chromium checks,
not model judgment, device/touch/Safari, live authority or production acceptance.
No backend/schema changes in this UI batch; no live/shared actions.

Task-sourced owner drafts (2026-09-17 Asia/Jakarta): the new owner command
`skill.propose_from_task` takes proposal/skill IDs, expected skill revision,
source run ID, expected attempt and a separately supplied `SkillBody`. It denies
runtime/trigger actors and owner-alpha; requires the exact current attempt plus
a retained attempt row; then reuses normal pending proposal validation, duplicate
handling and review. Provenance is generated as
`{kind:'task',source_ref:'task:<persona>/<run>/<attempt>'}`. No task transcript,
input, output, checkpoint or memory is copied. No inference, run admission,
steering, retry, activation or new authority is part of staging. Failed/unfinished
sources are allowed: source linkage is not a claim of completion or settlement.
A later source retry does not rewrite an already staged provenance record.

This API stages owner-authored corrections; it does not extract or generate a
procedure. `contains_private_facts:false` remains an owner assertion, not a
redaction/content-safety proof. Existing free-form `skill.propose` provenance is
unchanged and must not be mistaken for this command's checked source linkage.
Approval remains separate and does not change admitted snapshots. No migration.
Contract worker finished; 89 focused contract/core/HTTP tests and typecheck pass,
including receipt replay after reconstruction, stale/missing source rejection,
private-input/output canaries, failed-source retry, update-before-duplicate and
denied model/alpha paths (`.local/task-skill-integration.log`). Full verifier
exits 0 with 1538 backend/439 runtime tests plus Worker/browser/native/service
and build checks; desktop16 pass (`.local/task-skill-{combined,desktop}.log`).
Generated validator hashes match the twice-generated contract output. Portal
source selection/editor integration is assigned to the existing UI worker on
the exact unpublished base; host retains integration ownership. Automatic
learning and real-model judgment are not verified. No live/shared actions.

Skill catalog discovery (2026-09-17 Asia/Jakarta): `hehebot_search_skills` routes
through authenticated `agent-skill-search` with host-bound task custody. The
admitted persona must have `SKILL_PROPOSE_POLICY`; owner-alpha rejects discovery.
The service also requires explicit search and proposal tool allowlist entries;
installing this code does not add search to existing grants. Query length is
1–200 Unicode code points, nonblank; optional `after` is an exclusive UUID cursor.
Search uses literal substrings of current approved name/description/when-to-use,
ASCII case folding, ID ordering, and pages of at most 20. It is not semantic
ranking or a snapshot across pages. Results contain only ID, revision and those
three metadata fields, not bodies, references, private memory, provenance or
enablement. Existing admitted full-body reads remain unchanged. Runtime response
validation rejects extra fields and uses the schema's Unicode bounds.

Focused verification passes 42 backend/HTTP and 64 runtime tests plus typecheck.
Cases cover 20+3 asymmetric pages, literal wildcard characters, current revisions,
zero core search writes, body-access denial, wrong credentials, schema bounds,
stale identity/attempt, exact deadline, cancellation, alpha refusal, explicit
grants and metadata-only transport. One initial fixture omitted memory scope;
corrected test data passed. Runtime worker finished; host integrated and corrected
Unicode units and implicit allowlist expansion. Combined verifier exits 0 at
`.local/skill-search-combined.log`: 1527 backend/439 runtime, Worker/browser/native/
service and dry-run build passed. Desktop16 pass; stronger literal/deleted-record
cases pass separately in `.local/skill-search-literal-final.log`. Regeneration
reproduces the runtime validator hash. Focused evidence is in
`.local/skill-search-{integration,runtime-final}.log`. No UI, migration, account,
provider, real-model, publication or gate changes. Search guidance does not prove
that a real model chooses the right existing skill or learns from corrections.

Owner skill Run once (2026-09-17 Asia/Jakarta): `skill.run` requires an explicit
owner request, current approved skill/persona revisions and bounded nonblank
input. It captures exactly one skill without changing enablement. Ordinary
persona/context/permissions refresh on claim; the selected skill body and its
references survive later catalog edits/deletion and retry. The adapter still
sends metadata only and uses the existing task-scoped skill loader. Disabled
execution leaves waiting work, owner-alpha rejects this command, and no runtime
profile or tool grant is expanded. Unstarted selected snapshots expire at 30
days, never rebuild from today's catalog, and require a fresh request. No schema
migration. This is ordinary work, not an isolated safe-test implementation.

Focused SQLite/HTTP/bridge checks pass 182 tests; typecheck passes. The new HTTP
case exposed the fixture SQL shim's lazy writes; it now executes at `exec`, like
Durable Objects, rather than only inside `toArray`. The browser fixture exposed
alpha activation not being latched when first observed on the Skills page; the
render entry now records it before the Skills early return. Browser checks pass
for stale/offline/navigation guards, exact uncertain retry, frozen attribution,
UTF-8 bounds and narrow footer geometry. Four renders inspected. A retained
offline banner after reconnect is pre-existing, noncritical UI behavior, not a
new delivery or completion claim. Initial combined verification passed 1524
backend/435 runtime and Worker checks, then the reference browser fixture rejected
the 16000-emoji boundary request. Per-chunk Buffer-to-string conversion corrupts
split UTF-8 characters: a deterministic split produced 16002 code points instead
of 16000. Both touched HTTP fixtures now use Node's streaming UTF-8 decoder.
The reference rerun and full verifier pass at
`.local/skill-run-reference-decoder.log` and `.local/skill-run-combined-final.log`:
1524 backend/435 runtime tests, real Worker migration/HTTP, browser, pinned-native,
service and dry-run build checks; exit 0. Initial failure is retained in
`.local/skill-run-combined.log`. Desktop 16 tests pass. Regeneration reproduces
both validator hashes. No worker or verification process remains active.
No account/provider/model calls or publication. [UI contract](SKILL_RUN_UI.md).

Skill text references integrated (2026-09-17 Asia/Jakarta): both worker patches
were verified against the exact unpublished base. Optional skill-body
references are bounded named text, not files installed into Codex or fetched
URLs. Existing proposal/review, enablement, admitted revision and executable
denial remain the authority boundaries. Host integration cases cover old-revision
loads after later edits/disablement, catalog-only initial prompts, forced MCP
custody and byte-preserving control export/import without document extraction.
Initial loader/MCP checks rejected the new field before schema integration, while
111 neighboring/integration tests passed. Host review reproduced three malformed
restore/imported-pending approval cases accepted by the first patch; catalog
validation now reuses the canonical generated command schema before staging or
approval, with duplicate-name checks at both boundaries. Rejection still permits
discarding an invalid pending proposal. Focused backend 210/runtime-tool 13 and
typecheck pass. Host browser tests cover full comparisons, exact CRLF/Unicode
retention, omitted versus empty, bounded authoring and uncertain retry. Desktop
16 pass. Combined verifier exits 0 with 1506 backend/435 runtime and real Worker,
Chromium, native/service and build checks (`.local/skill-references-combined.log`).
After that browser stage, host reproduced malformed imported-reference rendering
failure and guarded it; over-limit retained lists cannot be silently truncated by
an unrelated edit. Final neighboring browser checks pass. One earlier Save wait
timed out; logs retain it, later diagnostic/neighbor runs pass, and refresh now
observes exact revision/content/connection rather than assuming a click finished
an in-flight poll. Two final consecutive checks pass in
`.local/skill-references-observed-refresh.log`. Desktop/narrow reference,
restore and invalid-import renders inspected; vertical crop is normal inner
scrolling, with separately verified accessible footer controls. No migration,
live/shared actions, executable supporting files or safe-test execution are
introduced. [UI contract and limits](SKILL_REFERENCES_UI.md).

Routine execution/delivery metadata (2026-09-17 Asia/Jakarta): routine-history
reads now add exact current-attempt application status, recorded start/settlement
times and a result-body-retained boolean. Start is recorded at claim, not proof
that inference ran. Missing current attempts remain null; prior/future attempts
are never substituted. Root release is not used as completion or delivery.
Run-level outbox counts retain pending/delivered/failed/outcome_unknown separately,
plus the portal record's status/update time. Outbox has no attempt key; even a
matching timestamp cannot establish current-attempt delivery. Portal delivered
means a persisted record, not owner read or notification. Private result bodies,
destinations, native references and submission custody are not projected.
Red tests failed on all three absent contracts; implementation and signed-owner
HTTP/retention/lifecycle checks pass 97 tests plus typecheck in
`.local/routine-delivery-focused.log`. Retention regression executes actual pruning
and preserves completion metadata. UI worker patch is integrated; host browser
fixture and desktop 16 pass, six desktop/narrow states inspected. Initial combined
run passed 1468 backend/434 runtime and local Worker checks, then failed the history
fixture's offline late-response assertion. The fixture assumed refresh always
fetches, but the application's in-flight poll guard can return immediately. It
now awaits observed Offline then Connected before releasing the delayed response.
Two focused reruns pass; final combined verifier exits 0 with 1468 backend/434
runtime tests plus real Worker, browser, native/service and build checks in
`.local/routine-delivery-combined-final.log`. Initial failed log retained at
`.local/routine-delivery-combined.log`. Final representative render reinspected.
No active worker remains, and no live/native/provider/settlement claim is added.

Manual occurrence identity integrated (2026-09-17 Asia/Jakarta): host implements
atomic manual occurrence/run/receipt creation, existing exact-key deduplication,
identity retention across retries and explicit scheduled-origin budget/overlap
predicates. V13 schema/compatibility integrated;97 host lifecycle/migration/import/
budget tests and desktop16 pass; earlier47 routine tests and typecheck pass.
Exact legacy v9–12 exports/imports retain original schema/history; v8+ backup and
inspection remain supported. FK scan follows the final version-marker write
before clearing SQLite's stale deferred counter. Regression tests inject failures
after table replacement and final write, preserving referenced runs/attempts.
Full verifier `.local/manual-occurrence-combined.log` passed1464 backend/434 runtime,
actual local Worker startup migration/reopen, browser/native/service/build; exit0.
The Worker check preserves live referenced rows across restart and second reopen,
asserts exact fresh/migrated schema and failed-version/final-write rollback.
Paused run-once remains non-resuming;
manual occurrences have no nominal schedule time and no historical backfill.
No live/shared migration or model/provider call is implied.

Durable attempt attribution integrated (2026-09-17 Asia/Jakarta): host writes
captured revision with root claim, inherits exact parent attempt for same-persona
children, leaves cross-persona/legacy values null, and shows latest3 stored pairs.
No inference/delivery proof is implied. V12 migration and compatibility integrated;
exact v9–11 import/export and v8+ backup/inspection stay supported without
upgrading reconstructed legacy data. Host97 integrated tests pass; earlier112
lifecycle/history/child tests, typecheck, history/preflight browser and desktop16
pass. Three updated renders inspected. Initial combined run passed1443/failed2
on old positional retention fixtures; explicit-column fixes and13 retention tests
pass, including preservation of attribution when result payloads expire.
Final verifier passed1445 backend/434 runtime plus browser/native/service/build,
exit0 in `.local/attempt-revision-combined-final.log`. Final desktop render
reinspected; no active worker or verifier remains.
Existing live sessions are not migrated or reset. Manual occurrence identity is separate because current
budget and overlap predicates rely on non-null occurrence meaning scheduled.

Routine revision attribution (2026-09-17 Asia/Jakarta): routine history projects
only numeric `captured_routine_revision` from matching current-attempt context;
unknown/unstarted/mismatched snapshots are null, never current-object fallback.
Claims rebuild context on each attempt, so this is not original/prior-attempt
history or execution proof. Conversation task shape stays unchanged. Red/green
SQLite regression and25 focused tests/typecheck pass; history/preflight browser
checks pass and three known/unavailable/narrow renders inspected. Fixture drawer
state was corrected after an intercepted click. Desktop16 pass. Combined passed
1427 backend/434 runtime plus browser/native/service/build, exit0 in
`.local/routine-revision-combined.log`. No active workers, live actions or
production changes; prior-attempt attribution still requires separate durable data.

Routine preflight portal (2026-09-17 Asia/Jakarta): integrated the worker's
on-demand GET-only disclosure. It shows blockers, observation revision/time,
execution-enabled independently of command checks, explicit schedule timezone
with local/UTC hypothetical times and policy. Run now remains unchanged;
history is independent. Offline/stale/deletion/ownership/navigation/late-response
fences reject old observations; alpha makes zero preflight requests. Host
preflight/history/delete Chromium fixtures pass, eight DPR2 states inspected,
desktop16 pass. Combined verifier includes preflight and passed1426 backend/
434 runtime plus browser/native/service/build in
`.local/routine-preflight-ui-combined.log` (exit0). No worker remains active. These are
synthetic browser observations, not auth/provider/native/delivery proof.

Routine preflight API (2026-09-17 Asia/Jakarta): owner-only
`GET /v1/routines/:id/preflight` returns current revision/persona, enabled state,
schedule preview, overlap/misfire policy and manual-run blockers. The command
shares grant/unfinished-work/persona checks, preserving rejection codes and
rechecking after the observation. Paused manual execution remains allowed without
resuming. Execution-enabled is separate from command allowance; connector/model/
input/effect readiness and delivery are explicitly unverified. Reads use the
schedule-preview rate bucket without reconciliation, alarms, UUIDs or task writes.
52 focused tests, typecheck and desktop16 passed, including grant-change regression.
Combined verification passed1425 backend/434 runtime plus browser/native/service/
build checks in `.local/routine-preflight-combined.log` (exit0). The additional
grant-change test was added after backend verification and passed the52-test rerun.
UI is delegated on exact unpublished base; no alpha gateway expansion, real
inference, provider or account action.

Routine history portal (2026-09-17 Asia/Jakarta): integrated the owned UI patch
against the exact unpublished API base. Routine cards expose on-demand all-status
history with exclusive UUID pages, observation/counts and explicit request,
provisional-output and settlement distinctions. No history mutations or polling;
alpha sends no history requests. Offline, stale/deleted/reassigned routines,
navigation and late responses clear or fence rows. Host browser history, deletion,
tasks and alpha checks pass; six DPR2 renders inspected, including narrow, loading,
empty, error and offline. Desktop16 pass. Combined verification now includes the
history fixture and passed uninterrupted:1402 backend/434 runtime plus browser,
native/service and build checks (`.local/routine-history-ui-combined.log`, exit0).
Worker is integrated; no active assignment or live account/provider action.
This remains synthetic browser evidence, not delivery or settlement proof.

Routine history API (2026-09-17 Asia/Jakarta): authenticated owner GET
`/v1/routines/:id/runs?after=<UUID>&limit=<1..10>` returns the canonical task-page
shape with all statuses scoped to exact routine_id. Pagination uses immutable
ascending UUIDs, not chronological order; restart to see arrivals before a cursor.
Only live routines are addressable here. Existing conversation task pages still
include only unfinished work. Shared projection strips context/checkpoints and
retains current-attempt output/steering/recovery semantics without a new delivery
or settlement claim. The RPC rate-limits but does not reconcile, arm alarms or
enqueue work.16 new real-SQLite/HTTP tests plus neighboring coverage pass48 tests;
typecheck and desktop16 pass. A test-only readonly array typing error was corrected
to an exact status-order assertion. Combined verification passed1402 backend tests
then timed out at FakeProvider boot before model requests; isolated service retry
passed. Original `.local/routine-history-combined.log` retained; remaining native,
service and build checks passed in `.local/routine-history-combined-remaining.log`
(exit0). This is a resumed sequence, not a clean uninterrupted combined pass.
Portal history is delegated
to an isolated worker; preflight and live routine
acceptance remain separate; the restricted alpha gateway has not been expanded.

Portal skill-history restoration (2026-09-17 Asia/Jakarta): History on an approved
card loads retained revision pages on demand, including historical name and all
procedural fields. A confirmation stages `skill.restore` with the captured current
and source revisions, proposal UUID and command key; approval remains separate.
Navigation clears history; stale/deleted/offline state, mismatched page revision,
invalid cursors and errored/loading history block staging. Alpha mode hides this
surface and permits no new history traffic. Lost-response retry sends identical
bytes/key, not a new proposal. Host Chromium fixture passes seven reads/two mutation
requests; draft regression and desktop16 pass. Desktop/narrow history, error and
confirmation captures were inspected at DPR2; narrow scroll/footer DOM checks and
the bottom capture confirm lower fields and affirmation remain reachable.
Combined verification exits0 with1,386 backend/434 runtime plus browser/native/
service/build checks in `.local/skill-history-ui-combined.log`. This is synthetic browser plus existing
SQLite contract evidence, not deployed mutation, Safari or native Mac acceptance.

Skill revision reads (2026-09-17 Asia/Jakarta): owner-authenticated
`GET /v1/skills/:id/revisions?before=<positive revision>&limit=<1..20>` returns
`{skill_id,current_revision,revisions:[{revision,body,created_at}],next_cursor}`.
Default limit10; descending rows use an exclusive cursor and limit-plus-one
lookahead. Gaps remain gaps; new revisions do not duplicate older pages. Only live
skill IDs are readable. Proposals and actor/source metadata are not returned.
The RPC uses the shared owner read-rate limit without reconciliation/alarm work;
no scheduler, inference or provider action is triggered by this read. Core/HTTP
fixtures cover real SQLite, signed owner/wrong-owner and runtime-bearer denial,
pagination, exact bodies, pending-draft exclusion and mutation custody.36 focused
tests and typecheck pass. Initial combined failure was a fixture bypassing the
required command receipt; it now stages through command ingress. The failed log
is `.local/skill-history-combined.log`; final rerun exits0 with1,386 backend/434
runtime tests plus native/browser/service/build checks in
`.local/skill-history-combined-final.log`; desktop16 pass. Portal history/restore controls are next;
the alpha gateway still disallows this route and all skill mutations.

Skill draft retry custody (2026-09-17 Asia/Jakarta): a real Chromium HTTP fixture
reproduced a new proposal UUID and idempotency key on each retry. The editor now
captures both once and freezes its first submitted payload. An unchanged explicit
retry reuses exact custody; changed contents or target reject locally. Latest
connection and selected update target revision/existence are checked before POST.
`node scripts/test-portal-skill-draft.mjs` passes create/update, required affirmation,
lost-response retry and offline/stale/deleted/missing fences with four requests;
14 skill/restore SQLite tests pass. This changes interaction only, with no layout
or backend permission change. It does not persist pending drafts across page close;
closing an uncertain editor requires refreshing and inspecting proposals before
creating another. Combined check exits0 with1,359 backend/434 runtime plus
browser/native/service/build checks in `.local/skill-draft-combined.log`;
desktop16 pass in `.local/skill-draft-desktop.log`. No live accounts or providers.

Private hosted composition (2026-09-17 Asia/Jakarta):
`scripts/test-codex-hosted-owner.mjs` composes signed synthetic Access JWTs,
the actual Worker and persistent SQLite Durable Object, hosted Sprite service,
pristine pinned Codex and read-only task MCP. It verifies an exact routine receipt
and attributed provisional reply with two loopback model requests, then stops
native and reopens Worker persistence to verify readback without inference.
Synthetic Sprite requests are exactly PUT/GET on the expected management socket;
sleep and production remain denied. `tests/runtime-hosted-control.mjs` passes
four tests, including a correctly signed wrong-subject denial, missing/tampered
tokens, dual service-header/runtime-bearer requirements and reboot refusal.
Miniflare 5 uses its exported v4-option converter. Only the exact synthetic issuer
JWKS GET is intercepted; other Worker outbound requests fail. The private HTTPS
proxy simulates the edge service gate; this does not prove Cloudflare edge behavior.
Fixture prepareNative replaces real-account setup, so the launcher/account check,
live Sprite, hosted account eligibility and containment remain separate gates.
Combined verification exits0 with1,359 backend/434 runtime tests plus native,
browser, service and build checks in `.local/hosted-composition-combined.log`.
Desktop16 pass in `.local/hosted-composition-desktop.log`. No account, provider,
deployment or production action occurred; this checkpoint remains local.

Hosted manual launcher (2026-09-17 Asia/Jakarta): runtime/hosted-owner-launcher.mjs
uses the existing flock wrapper twice, native home then session state. Both must
be existing distinct owner-only directories. Parent config bytes are SHA-256-bound
to the child's re-read before account work. Contention returns73; abort forwards
to the exact exec-preserved child; no retry or state deletion occurs. Four new
real-subprocess cases plus entry/lock coverage pass21 tests in
`.local/hosted-launcher-focused.log`. Tests substitute a synthetic Node workload
after asserting the actual lock argv, except the changed-config case exercises
the real entrypoint refusal. This is not complete hosted native integration.
Combined verification exits0 with1,359 backend/430 runtime plus native/browser/
service/build checks in `.local/hosted-launcher-combined.log`; desktop16 pass.
Delegated pristine0.154.0 experiment kept protocol FIFO open after SIGKILL of its
synthetic parent: npm wrapper retained fd3 and exclusion, native ELF had no matching
directory descriptor. Both stayed alive; stopping wrapper stopped native, then a
contender entered. This is bounded delegated evidence, not independently repeated
host proof or arbitrary wrapper-loss containment. Existing process-lock tests also
reproduce Node's default descriptor drop. No transport/dependency patch was made;
free locks still cannot authorize takeover. Both workers finished and cleaned their
synthetic processes. No account/login/model/provider action or deployment occurred.
Next: complete private scripted Access/Worker/native/Tasks composition. HTTP wake
remains preflight-only; supervised CLI existence adds no live deployment grant.

Hosted bounded control composition (2026-09-17 Asia/Jakarta): distinct default-off
HEHEBOT_HOSTED_OWNER_ALPHA accepts the exact owner pin/policy envelope under Access
only, both production flags false and no provider/local-alpha config. Shared policy
validation preserves local serialization. Worker checks the independent pin inside
the owner-binding transaction before seed; a wrong fresh pin leaves no binding or
objects. Internal owner_alpha_hosted:true is mandatory for hosted runtime, refused
by local/test runtime, and absent from public state. Quota and attempt custody use
the existing alpha ledger without reset. Real SQLite plus bearer-authenticated
Worker ingress proves boot/claim/submission, one-run exhaustion, exact preview
reconstruction, denial of mutations/effects/complete/sleep, changed/removed-policy
refusal and used-boot refusal. Owner commands use canonical control.accept in this
fixture; it is not a new signed-JWT/browser or deployed Access test.
runHostedOwnerAlpha composes the existing Sprite Tasks client with the shared
supervised account/model checks and independent expiry+grace watchdog. No hosted
CLI/HTTP wake route is exposed; its caller must hold the kernel executor lock.
71 focused backend and54 runtime tests plus typecheck pass; logs
`.local/hosted-admission-{control,runtime}.log`. Full combined verification exits0
with1,359 backend/426 runtime plus native/browser/service/build checks in
`.local/hosted-admission-combined.log`; desktop16 pass. Delegated parser and Worker tests are
reviewed/integrated. No live provider/model/account action or deployment occurred.
Next is a launcher holding native-home and session-state locks and complete private scripted Access/Worker/native/Tasks
composition; live provider and account eligibility remain separate. This supersedes
the previous checkpoint's absence of a hosted Worker policy, not production gates.

Hosted runtime composition prerequisite (2026-09-17 Asia/Jakarta): optional
`hostedOwnerBindingSha256` requires an exact lowercase digest, owner-alpha policy,
both private Access credential files and Tasks hold/release functions. Existing
fixed-origin HTTPS validation remains authoritative. Fresh service intent persists
`hostedOwner:{bindingSha256,origin}` before status; owner mismatch refuses boot.
The config is captured before awaits. This branch uses SpritesActivityGuard,
including checks before version/native preparation/launch and normal supervisor
admission. An expired startup hold cannot be silently reacquired. Stop retains
the Task; sleep and reused journals remain denied. Default local alpha retains
its loopback/provider-free behavior. Worker Access alpha admission and the Sprite
execution entrypoint remain disabled; synthetic composition does not activate them.
Delegated service tests were reviewed; host added expiry across both startup
await boundaries, a deterministic status barrier, and explicit sleep/retained-Task
checks.57 focused service/alpha/activity tests pass in
`.local/hosted-owner-focused-final.log`. The initial host test edit introduced a
missing brace and referenced a nonexistent activity test filename; corrected
command passes. Full combined verification exits0 in `.local/hosted-owner-combined.log`:
1,335 backend/419 runtime tests plus native/browser/service/build checks; the final
startup-expiry cases were included in that run. Desktop16 pass in
`.local/hosted-owner-desktop.log`.
No account/model/provider/deployment action occurred. Live provider containment,
account eligibility and the separately gated control/launcher contract remain open.

Owner-pinned transport preflight (2026-09-17 Asia/Jakarta): bound Access internal
status now exposes owner_binding_sha256, not raw binding values. Its canonical
digest is checked against a fixed independent vector through actual authenticated
Worker ingress; public/local-alpha responses remain unchanged. Sprite preflight
requires ownerBindingSha256 and captures the complete config before awaiting
status. Match, missing/mismatch, invalid-before-secret-load, caller mutation and
unauthorized HTTP wake cases pass; reports omit binding/hash/secret markers.
Only status is requested; HTTP202 precedes the asynchronous check and does not
mean executor readiness. The existing HTTPS client rejects redirects and pins
origin.47 focused SQLite/alpha and16 preflight/client tests pass. Full backend
passes1,335, runtime411, build dry run passes; logs `.local/owner-preflight-*`.
The initial focused command misspelled the client test filename and ran only the
five preflight tests; the corrected transport command and full runtime run cover
the client. Full native combined verifier was not repeated. No live account/model/
provider or deployment action occurred; actual hosted admission/activity integration
remains separate and disabled. Example preflight config now requires the digest.

Hosted owner binding (2026-09-16): Worker startup now pins Access auth mode,
installation ID, issuer, audience and owner subject in `runtime_metadata` before
seed. Same binding reconstructs without writes; changed identity/local downgrade
fails OWNER_MIGRATION_REQUIRED without replacing private state. First adoption of
populated unbound data also refuses. Existing unbound local data remains unchanged;
no schema version change or hosted-alpha enablement is involved. The common Access
issuer validation was extracted and its20 existing auth tests passed before the
behavior change. Real DO-host-shim/SQLite and application export/import coverage
now pass65 focused binding/auth/alpha tests. Delegated tests were reviewed and an
object-only unbound-data case added. Full combined verification exits0 with1,333
backend/406 runtime tests and native/browser/service/build checks in
`.local/owner-binding-combined.log`; `.local/owner-binding-focused.log` retains the
focused pass. No account/provider/deployment action occurred. AUTH_SETUP records
the remaining hosted owner/origin runtime binding and activity-guard requirements.
Existing unbound hosted data requires an explicit migration workflow; none is
implemented and deleting the binding is not a supported bypass.

Process-crash custody (2026-09-16): `tests/runtime-process-crash.mjs` forks real
Node workers using FileJournal/ExecutionBridge, kills at deterministic durable
claim_unknown, lost claim response, lost native submission response and lost
Worker registration ACK boundaries, then reopens in a different process. The
parent owns HTTP side-effect counters across death. Exact call counts and original
epoch/boot/attempt/native IDs distinguish safe refusal from repeated admission;
submitted_unknown permits only identical registration ACK retry. A successful
control prevents an all-refusal implementation from passing. Host review added
explicit pre-crash counts and unconditional child cleanup on failures.
`node --test tests/runtime-process-crash.mjs tests/runtime-file-journal.mjs`
passes17; `npm run test:runtime` passes406. Logs `.local/process-crash-{focused,runtime}.log`.
No runtime behavior changed; this is simulated-transport application-journal
evidence, not native recovery, power loss, multi-writer fencing or100 randomized
receipt-loss injections. The combined verifier was not repeated for tests/docs only.
`AUTH_SETUP.md` now records hosted-trial configuration/authorization requirements
and explicitly rejects promoting local alpha by flipping production flags.

Live bounded V2 demonstration (2026-09-16,19:20Z): same-owner ChatGPT-backed
gpt-5.6-luna, Chief of Staff, three independent admitted roots and one native child.
A returned after delegation; S's accurate status and B's packing list persisted
while the child remained active. Exact A cancellation propagated OWNER_CANCELLED
to its child; native journal records interrupted child, completed A/S/B roots and
distinct native thread IDs. S/B were not cancelled by A's command. Child MCP read
completed; its itinerary was interrupted, not delivered. No general settlement.
Independent evidence assertions report passed in private
`.local/owner-v2-live-session/verified-evidence.json`; full snapshots/live receipts
are in live-report.json. Native shutdown followed by private Worker reconstruction
and browser reload preserved exact S/B previews (reconstructed-readback.json).
Cancelled A's preview is hidden by the existing owner-cancellation output fence;
the report and native journal retain its earlier acknowledgement.
Both services stopped, zero native processes, state retained and never replayed.
Browser DOM confirms Connected, disabled Send, both provisional replies; the
inspected2x screenshot is `.amp/in/artifacts/owner-v2-live-readback.png`.
Portal wording now describes explicit background opt-in rather than falsely
declaring it unavailable. node --check and rendered DOM verify that text-only
change; the combined verifier predates it. No cloud deployment, paid API fallback
or production flag changes. Full P0.3 orchestration and P0.4 hosted/recovery gates
remain open despite this narrow live responsiveness/cancellation milestone.

V2 service/custody integration (2026-09-16): selected alpha roots use nested V2
cap2 with V1/wait disabled; selected fingerprints include `v2-cap2`, rejecting old
V1 custody before RPC. Default submission fingerprints/config are unchanged.
Application schema v11 removes thread-only uniqueness but preserves per-turn
uniqueness and transactional original-parent/attempt/persona checks. Migration
rollback, exact legacy v9/v10 import/export and v8–v11 backup inspection pass.
Host248 focused tests pass; an actual adapter/journal/mapper→SQLite regression
retains A1/A2/B1 receipts and exact provisional outputs across ACK loss/reopen.
Native service/browser fixture passes7 loopback requests, inherited child routine
read, independent status and B, zero-inference reload, exact root-family cancel,
26 operations and denied sleep. Initial fixture assumptions about V1 message
format and one unknown record per family failed and were corrected for V2's
agent_message and retained activity/spawn uncertainty. No settlement was added.
Logs `.local/v2-{control-host.log,selected-green.log,service-host-final.log}`.
Final `.local/v2-integrated-combined-final.log` passes1,318 control/395 runtime,
native/browser/service checks and build. Earlier failures were a stale HTTP export
pin and editing a running shell script; both logs remain. Desktop16/16 pass.
Terminal-root native mode passes33 requests, no new root inference/turn in its
one-second window, exact followup denial and31 retained operations/no sleep.
The appended completion activity is metadata, not a second turn or settlement.
Source follow-through found sleep_tool default-on independently of token_budget.
Its explicit disable exposed native override layering: the selected per-thread
features table dropped startup overrides, restoring apps/sleep. Native thread
readback contradicted globally disabled config/read. The selected adapter now
carries the complete shared restricted feature map with v2-cap2-restricted
fingerprint; older selected V1/V2 custody cannot replay. Actual root/child feature
readbacks and catalog absence pass with enabled/always_on sleep input config.
48 focused tests pass; final combined rerun `.local/restricted-v2-combined.log`
exits0 with1,318 backend/399 runtime tests and native/browser/service/build checks.
Initial failing checks are retained in `.local/sleep-tool-*`.
The explicit bounded V2 entry now replaces the earlier blanket background refusal:
the composed launcher accepts true-only `backgroundFirstRoot`, persists the exact
policy and leaves absence root-only.33 entry/launcher/background tests pass in
`.local/v2-launcher-focused.log`. No live V2 account-backed trial has run.
Production flags remain false; this admits neither automatic replay/restart,
sleep nor general settlement. V1 remains prohibited. The next deliverable is the
already-authorized bounded same-owner V2 demonstration, not another synthetic gate.

V2 native event integration (2026-09-16): host independently passed the31-request
V2-capable catalog fixture. Advertised grandchild spawn hits capacity; completed
child A is evicted for B while A's history remains readable. Foreign S controls
remain denied. Runtime now records distinct unknown V2 activities and observed
spawn custody, including two child threads/three turns after eviction/followup.
Actual native notifications pass through the router with zero pending/recovery
events;26 operations retain uncertainty, no sleep,4/4 held responses close.
Logs `.local/v2-events-{native-host.json,native-default-host.json,focused-host.log,runtime-host.log}`.
Host review caught the worker's synthetic nested wire shape; the actual flat
fixture failed four tests before correction. Final126 focused/394 runtime tests
and typecheck pass. [Detailed contract](OWNER_BACKGROUND_V2_NATIVE.md).
Control regression fails because native_session_key is UNIQUE across turns;
the isolated v11 migration worker owns immutable thread affinity and compatible
backup/export/restore changes. No selected-config/fingerprint or live gate change
is included in this checkpoint. Full combined waits for the known control gap.

Missed-output recovery (2026-09-16): exact acknowledged completed-turn history now
restores bounded provisional message digests/previews in one journal update.
In-progress/failed/interrupted turns cannot freeze partial text; missing known
messages retain the prior preview, duplicate IDs/conflicting digests reject before
writing, and identical readback is a no-op. History adds no activity clocks and
does not settle tools/effects/descendants or permit sleep. Two initial regressions
failed before the change;67 focused adapter/event tests and11 SQLite task-control
tests then passed. Root/child previews publish once without changing run/attempt
custody. Native fixtures recover exact root output, child final output after an
earlier preview, and missing output from disk after a controlled native restart.
Logs `.local/output-recovery-{red,focused,control,steering,native-final}.log`.
The first combined run passed1,298 control/383 runtime tests but correctly exposed
the steering fixture's old expectation that history never changes preview content.
That expectation now requires the exact final child message/digest/version while
preserving all other custody. The final combined run passed1,298 control/387
runtime and all native/browser/service checks, then failed the final build on the
new test assigning an undeclared adapter.rpc property. The test now reopens via
the public constructor;11 targeted tests and build/typecheck/dry run pass in
`.local/output-recovery-{control,build}-final.log`. Desktop16/16 also passes.
The full combined command was not repeated after this test-only correction;
both unsuccessful full logs are retained. This does not enable automatic live
restart or add a recovery-only owner-alpha entrypoint.

Opt-in integration / authority blocker (2026-09-16): the runtime accepts a true-only
`background_first_root` policy and consumes only an exact persisted claim marker,
not model text or family order. Submission captures the marker before awaits and
includes it in the selected-root fingerprint; old default bytes remain unchanged.
The nested agents/features override merges with the original task MCP grant.
Both workers are integrated. Scripted service/native/browser check passes seven
requests, inherited read, independent status/B, root cancellation reaching its
held child, three retained families/25 operations, no result settlement and sleep
denial. Host fixed redundant cancellation propagation with two red/green replay
cases. Combined passes1,297 control/380 runtime and all remaining checks, exit0,
in `.local/owner-background-combined.log`; desktop16/16.

This does NOT establish independent-task authority. Subsequent pinned-source
inspection found V1 send_input/close_agent/wait_agent can target a foreign live
root by UUID; no public spawn-only filter exists. `runOwnerAlpha` now refuses
background mode before filesystem/service/account work, with24 focused tests
passing in `.local/owner-background-live-gate.log` after the full verifier.
See [exact sources and boundary](OWNER_BACKGROUND_NATIVE.md#cross-root-authority-blocker).
The later `--foreign-close` native probe confirms selected A can remove unrelated
loaded S and receive its completed text. It uses a host-started second A turn and
known S UUID, not automatic reactivation or ID discovery. Nine loopback requests,
persisted output, unchanged config and cleanup pass; default seven-request mode
also passes. Logs: `.local/owner-background-foreign-close-final.log` and
`.local/owner-background-default-after-probe.log`. The wrong-argument initial run
is retained and not counted as containment. No full combined rerun was needed
for this optional fixture-only diagnostic; live background stays blocked.
V2 target paths check the tree registry. The delivered native fixture is now
host-reviewed/integrated and independently passes23 loopback requests: actual
foreign S UUID denied for message/followup/interrupt, positive same-tree controls,
independent S completion, zero active turns and all3 held responses closed.
Config bytes remain unchanged; `.local/owner-background-v2-host.json` retains
host evidence. [V2 decision](OWNER_BACKGROUND_V2_NATIVE.md) records why child-role
overrides cannot disable V2, but shared cap2 residency may itself enforce depth1:
an executing child occupies the only non-root slot and cannot be evicted. That
source-supported correction is pending a native V2-capable child-catalog fixture.
Residency is not a logical-child quota. It is not adopted. No live session used
background mode, no provider/account/production action occurred, and default
root-only alpha is unchanged. Exact-turn output recovery is implemented above;
safe live replacement and recovery-only assembly remain separate prerequisites.

Background scope and native prerequisite (2026-09-16): task summaries previously
selected every same-persona background title, including private titles for a room
or unrelated routine. They now filter by exact captured `scope_key` before LIMIT30,
with deterministic ties and missing-scope legacy rows omitted. Two SQLite tests
cover six asymmetric scopes and an older matching row behind31 unrelated rows,
including no-write/lifecycle/attempt invariants. All1,281 control tests and
typecheck pass (`.local/task-summary-scope-control.log`); the restricted service
background fixture passes (`.local/task-summary-scope-native.log`) with three
retained families, independent status/B, exact cancellation and sleep refusal.

The [native background prerequisite](OWNER_BACKGROUND_NATIVE.md) now tests actual
forbidden spawn calls rather than catalog absence. Seven loopback requests prove
one selected V1 root can hold a direct child while a default root responds;
second-child capacity and grandchild/default-root dispatch reject correctly.
Persisted root messages, exact identities, interruption, closed held request,
native exit and unchanged configuration are verified. The child cap is per root,
not app-server-wide. This is not service admission or live child authorization;
owner alpha remains root-only. Combined verification now includes this fixture;
`.local/background-scope-combined-retry.log` exits0 with1,281 control/364 runtime
and all native/browser/service/build checks. Initial run
`.local/background-scope-combined.log` stopped at a tool-fixture EADDRINUSE before
inference; retained separately, not suppressed. No live account/model, provider,
production gate, push or deployment changes.

Private follow-up continuity (2026-09-16): the delegated two-message root-only
alpha fixture reproduced absence of first-task information in second-root input.
ControlCore now captures bounded same-persona history before the current command
sequence, including visible explicitly provisional replies tied to original
receipts. Claim rebuild excludes later messages and preserves admitted snapshots;
room/routine/cross-persona scopes receive no private history. Retention filtering,
clipping disclosure and non-authoritative labels are verified; this is not complete
token budgeting, completed-result history or actual-model conversational judgment.
See [scope and evidence](OWNER_ALPHA_MULTI_MESSAGE.md).

Combined verification passed 1,279 control / 364 runtime plus scripted native,
browser, HTTP/service and build checks. Final focused mode validates four model
fixture requests, exact first preview in second input, two successful routine
receipts, distinct task/thread/grant custody, third-admission refusal, reload with
no inference and cancellation isolation. Unknown coverage still denies settlement
and sleep. Logs: `.local/alpha-continuity-combined.log`,
`.local/alpha-multi-host-final.log`, `.local/private-context-focused.log`.
The separate early-runtime-exit forwarding fence passes13 gateway/launcher tests;
it preserves readback/cancellation while rejecting held/new messages after exit.
The public session expired unused, nativeStopped:true, zero runs/previews; all
session processes stopped and custody was preserved. No new real inference,
production permission, provider action, push or deployment occurred.

Authenticated orb access (2026-09-16): a fresh-state launcher composes private
HTTPS Worker, existing root-only native entrypoint and short-lived token/cookie
gateway. Worker local-auth bypass is never exposed. Actual orb ingress login
and state read succeed; runtime/internal and export paths return404. Chromium
observes Connected, selected Chief of Staff, one remaining admission and120s task
limit. Host submitted no message. Owner access uses the Terminal-held private
token; it is never in a URL, localStorage or transcript. The instance is owner-wide
read scope, not persona confidentiality, and has no private imports/connectors.

The credential-free browser integration verifies durable queued message/reload,
zero native attempts, forbidden writes and logout. It caught a real form POST
failure: no-referrer suppresses Origin to null; same-origin fixes login without
weakening CSRF. Absolute10s gateway deadlines resist continuous trickle responses;
token rotation during awaited bodies/ownership reads prevents dispatch. Unknown
mutation outcomes are not replayed. Session UI fences expiry/quota/offline/wrong
persona and retains provisional/history/cancel access. Inspected DPR2 screenshots
include actual public ingress and available/expired/wrong-persona states.

Host combined verifier passes1275 control/363 runtime tests and all scripted
HTTP/native/service/build checks; desktop16/16. Private logs:
`.local/alpha-access-{combined,desktop,supervisor-child}.log`. The separate final
supervisor-child check verifies a request-order fixture correction: unrelated
grant proof no longer consumes the root catalog assertion. This is not relaxed
authorization or new model evidence. No production gate changed, push/deployment,
paid API fallback, connector write or Sprite operation. Managed session deadlines
and continuation custody are recorded in HANDOFF; do not reset consumed state.

Corrected live trial (2026-09-16): the owner authorized the follow-up and a $5
ceiling without repeated permission asks for this bounded work. The same ChatGPT
login and `gpt-5.6-luna` produced run `6c057062-54d2-4a28-8532-3565f1708f88`,
attempt 1, thread `01a0aaa5-0a27-7860-9ab4-34117b553963`, native turn
`01a0aaa5-0afe-7230-8e45-f4762ca28fa9`. Correct pre-admission routine policy
yielded exactly one completed MCP read and HTTP 200, no 403/429. The model's
version-2 reply accurately reported no routines in this fresh local instance,
separating that observation from supplied alpha limitations. No routine was
fabricated or enabled, and no connector was read or written.

After the 120-second attempt deadline, the retained run became Cancelling with
DEADLINE_EXCEEDED; native shutdown was journaled. This observes deadline bookkeeping
for an already-finished root, not forced interruption of a still-generating model.
Unknown coverage prevents settlement; after control restart the run remains
recovery_required / CANCEL_UNCONFIRMED. Read-only verification preserved the exact
preview, one run/attempt, one accepted event and zero run.result events/cards.
Browser reconnect/reload and an inspected DPR2 screenshot show the useful reply
and provisional/recovery disclaimers. The initial orchestration report retains
a browser-JSON assertion failure; separately corrected readback exits 0 with
passed_readback, without resubmission or another inference runtime.

Private evidence: `.local/owner-alpha-corrected-session/{report,readback}.json`,
receipt and journal. Screenshot: `.amp/in/artifacts/owner-alpha-corrected-reply.png`.
Native usage is 26,380 input tokens (15,872 cached), 260 output tokens; not a
billing receipt. Both services are stopped. No paid API fallback, Sprite call,
deployment, policy bypass or production gate change. The narrow OWNER ALPHA
real chat/read-only-tool/provisional-reply milestone is now demonstrated; hosted
owner access, background behavior and full settlement remain separate work.

Authorized live trial (2026-09-16): after an initial login prerequisite stop, the
owner separately authorized and completed supported device login. Supported
account/read confirmed ChatGPT and model/list exposed `gpt-5.6-luna`, selected for
the single 120-second task. Actual browser submission produced run
`04829967-3eee-4304-8f3a-5fd9e8d724ba`, attempt 1, native thread
`01a0aa94-064d-7bd1-a0a1-764c55304600`, turn
`01a0aa94-0755-7a43-9cf4-aeaabe0a75af`. The native root completed in about 16 seconds.
Its final version-3 provisional reply disclosed that routine listing failed and
restated the supplied alpha limits; it did not invent an empty routine list.

This trial was partial: the host setup used a random policy ID instead of the
fixed ROUTINE_MANAGE_POLICY, so both read calls correctly failed 403. Rapid host
state polling then received 429 and stopped the runner before its deadline check.
These are operator/verification errors, not evidence that permission or rate-limit
checks should be relaxed. No second root was launched. Reopened retained Worker
data and browser reload verified the exact final reply, one run/attempt, and no
run.result or completed-result card. The inspected DPR2 screenshot shows Needs
recovery, the provisional disclaimer and final text. Native stop is journaled;
unknown operations remain. Both local services are stopped, custody retained in
`.local/owner-alpha-live-session`, and the one-task grant is consumed. No paid API
fallback, connector write, Sprite call, deployment or production gate change.
Native usage reports 35,563 input tokens (17,664 cached), 478 output tokens;
these counters are not a billing receipt. Full timeout/settlement and successful
live routine reads remain unverified. P0.2's real provisional-reply path is observed.

Explicit local owner alpha (2026-09-16): an immutable selected-persona policy now
admits one to three direct owner roots with per-task/session deadlines, separate
from disposable test mode and both false production flags. Worker first boot uses
no provider; durable consumed IDs and original attempt/epoch/boot prevent resetting
quota or replaying uncertain work. Deadline expiry preserves exact callback/output
custody, while owner cancel or memory revocation fences subsequent scoped reads.
Complete, effects, native-child, mutating tools and sleep remain denied.

The host entrypoint checks ChatGPT account and exact visible model through supported
APIs only when explicitly launched. It preserves an optional authorized native home
in place, supplies restricted profiles through CLI overrides, retains store selection,
and rejects custom OpenAI providers and config drift. Root spawning/provider surfaces
are disabled. A separate timer stops native execution at session expiry plus 30-second
grace even during an awaited maintenance call. Existing-home auth and live model
behavior have not been exercised; no login/token copying/provider action occurred.

Host `bash scripts/test-codex-service.sh --owner-alpha` passes the actual browser →
HTTPS Worker/SQLite → native Codex → read-only MCP path with two scripted model
requests, both production flags false, no test-mode admission and zero Sprite hold
calls. Provisional output survives reconnect and the 15-second task deadline, while
the task becomes cancelling and unknown coverage remains. Rendered working and
cancelling states were inspected; the alpha banner discloses unavailable background,
external-action and automatic-recovery behavior. No completed result is fabricated.
Log: `.local/owner-alpha-service-final.log`. The first fixture failures exposed
20-minute-clock assumptions and a UI filter hiding cancelling coordinator previews;
both were corrected without weakening non-alpha assertions.

Native root-only fixture default and CLI-override modes pass three deliberately
unsupported spawn calls, two completed root turns, three loopback requests, no
observed child and byte-identical original config. Exact RPC approval policy works;
top-level TOML `untrusted` does not. The integrated override mode exercises the host
transport encoder. Combined verifier passed1274 control/350 runtime plus native,
service and build checks (`.local/owner-alpha-combined.log`); desktop16/16 passed.
Final scoped-read/public-summary changes pass53 targeted backend cases; final timer
coverage is recorded separately in `.local/owner-alpha-runtime-final.log`.
See [session setup and recovery limits](CODEX_SERVICE.md#explicit-supervised-local-session).
The next usable milestone requires authorization for one bounded real-model task,
not full connector/Mac/recursive-sleep acceptance. P0.2 remains incomplete until that
actual model path is observed; no hosted deployment is implied.

Restricted service preparation (2026-09-16): opt-in disposable composition selects
a digest-bound minimal/workspace-read named profile, disabled network and only
first-party read MCP grants. Startup checks native configuration readback before
readiness; submission rejects config-file drift. Initial host service tests pass23/23,
and `--restricted-background` passes six scripted loopback requests through the
actual browser/Worker/native path, retaining the three unknown families and
denying sleep/final settlement. Initial zero-inference readback refusal and the
corrected null-metadata handling are recorded in
`.local/restricted-background-{first,second}.log`. See [service limits](CODEX_SERVICE.md).

The bounded native permissions worker's patch was reviewed and integrated. Host
reran `node scripts/test-codex-permissions.mjs --minimal-native`: exit0, 24 requests,
26 assertions, exact root/direct-child workspace reads and journal/token/symlink
denials, pristine binaries and confirmed disposable cleanup
(`.local/restricted-profile-host-native.log`). This variant adds only the exact
native ELF read path plus explicit private-path denies. Unaugmented `--minimal`
cannot launch shell and is not enforcement proof; service keeps shell unavailable.
These are separate policies and evidence, not a claim that app-server/MCP or all
model-reachable built-ins are isolated. The completed
[pinned built-in review](ALPHA_NATIVE_CAPABILITY_BOUNDARY.md) found no concrete
arbitrary host-file bypass in the inspected tools; image/patch reads use sandboxed
helpers, and nested code-mode calls retain tool dispatch. No additional container
or shell allowance is required by that source evidence. Built-in denial remains
source-supported rather than behaviorally proved.

Main applied the concrete remaining restriction: native command-line overrides
disable provider search/apps/plugins/suggestions/image generation, token-budget
mode and escalation features. Startup requires their exact config readback and
no inherited MCP servers; admitted MCP `enabled_tools` matches the immutable
read-only grant. The six-request provider-restricted path passes in
`.local/restricted-background-final.log`. Desktop16/16 passes in
`.local/restricted-desktop.log`; final combined verifier passed1244 control
and342 runtime tests plus native/service/build checks in
`.local/restricted-final-combined.log`. The final explicit journal/home/token/Access
path denies additionally pass48 service/transport cases and actual restricted
background with six requests in `.local/restricted-final-focused.log` and
`.local/restricted-background-verified.log`. No live model, provider, account,
deployment or production gate changes. Next deliverable is an explicit bounded
owner-alpha session entrypoint and specifically authorized real-model task, not
further general containment work or enabling the disposable gate for live use.

Owner-alpha direction (2026-09-16): useful supervised tasks with disclosed bugs and
manual recovery need not await complete product/connector/Mac acceptance. Credential,
authority, unknown-effect, replay and spend safeguards remain mandatory. The newly
authorized bounded read-only Sprite inspection is complete: cgroup primitives exist,
but the protected manager/workload boundary remains unknown, not proved impossible.
[Direct provider evidence and cost estimate](PROVIDERS.md#selected-sprite-read-only-containment-decision-2026-09-16)
record cold→read-only exec→cold and no mutation/model work. Full tree termination is
needed for safe autonomous sleep/replacement, not inherently for a persisted
provisional reply. No text-only isolation, real-model task or production gate claim.

Responsive portal/background preparation (2026-09-16): host integration passes
`bash scripts/test-codex-service.sh --background-responsive` in
`.local/family-background-host.log`. Actual Chromium → HTTPS Worker/SQLite → pinned
native Codex uses six scripted loopback requests. The status turn sees A's actual
admitted task summary, receives its own thread/grant, and leaves A unchanged;
reload preserves its attributed provisional reply without more inference. Public
cancellation interrupts B, then old A, at their exact native identities. All three
families remain in 25 heartbeat operations, including three unknown coverage rows.
No `run.result`, sleep permission, provider action or real-model claim follows.
See [the fixture and restricted-session limits](PORTAL_BACKGROUND_ALPHA.md).

The runtime fsyncs released-family custody and release intent in the same cursor
record before sending the Worker receipt; acknowledgment is durable before another
claim. Loss fences admission, and only the exact release receipt can be reconciled.
All-family heartbeat/controller/output/cancel handling outlives the current cursor.
The scheduled admission pump does not block the next lease heartbeat. Offline
diagnostics list retained families and separately label current admission uncertainty;
native detail selects one exact family, never granting resume/sleep authority.
DB v10 stores an exact per-attempt coordinator-release receipt independently of
completion. Migration, fresh/migrated schema hashes, backup and export/import are
updated together; v8/v9 backup and v9 export/import remain supported. The initial
combined failure on a stale v9 E2E export hash is preserved in
`.local/family-combined.log`; it was corrected rather than suppressed.
Final host `bash scripts/verify-codex.sh` exits0 in
`.local/family-combined-final.log`: 1,244 control/335 runtime tests, all scripted
native/service checks and build dry run. Desktop reinstall/tests pass16/16 in
`.local/family-desktop.log`. Focused journal/inspection checks cover lost ACK,
failed custody persistence, the 32-family bound, older-attempt settlement, late
output, all-family operation coverage and unknown-current-claim diagnostics.

Next alpha boundary work should reuse existing
[positive named-profile shell/direct-child deny evidence](CODEX_PERMISSIONS.md),
not re-run general containment refusal matrices. Pinned upstream
[thread permissions](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server-protocol/src/protocol/v2/thread.rs)
select supported named profiles; ordinary `read-only` still permits broad reads.
[Local stdio MCP launch](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/rmcp-client/src/stdio_server_launcher.rs)
is not sandboxed by that profile. Review native file/tool access and the trusted
app-server/MCP boundary with the actual service grant layout before live inference.
Full recursive termination is not a prerequisite to provisional supervised output;
credential/task authority still is. The current service remains disposable-only.

P0 portal/native preparation (2026-09-16): owner priority now supersedes peripheral
work. `bash scripts/test-codex-service.sh --portal-readback` passed through the actual
browser composer, HTTPS local Worker/SQLite and pinned Codex app-server with scripted
loopback model data. Closing/reopening the browser and reloading preserves the exact
run/attempt's provisional output without extra inference or a duplicate run. Receipt,
conversation, admitted attempt and native thread/turn IDs are recorded in
`.local/p0-portal-readback-final.log`; DPR2 portal capture is inspected. This is not
a real-model task, hosted path, Worker crash/restart test or completed `run.result`.
P0.2 remains incomplete: the fixture observes zero result events, one unknown
coverage operation, and rejection of completion/sleep. No production flag changed.
The mode runs separately from the combined verifier, keeping browser prerequisites
explicit rather than silently expanding the default verifier.

The concrete completion blocker is `CodexOperations.snapshot()`'s unconditional
unknown coverage, not missing portal rendering. A read-only pinned-source review
found no public app-server enforced deny-all tool/child-spawn field in
[`ThreadStartParams`](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server-protocol/src/protocol/v2/thread.rs)
or [`TurnStartParams`](https://github.com/openai/codex/blob/rust-v0.154.0/codex-rs/app-server-protocol/src/protocol/v2/turn.rs).
Empty dynamic tools and restrictive sandboxing are not an empty executable tool
inventory; internal allowed-tool filtering is not a supported host API. Do not
remove coverage or manufacture all-settled proof for a purported text-only mode.
The next integration decision must establish supported bounded operation/descendant
coverage or an explicitly reviewed alternative while keeping effects uncertain.

P0.1/P0.3 prerequisites (2026-09-16): reviewed/integrated both worker deliveries
from exact bundled unpublished main. Main reran the containment contract/probe suite
(28 tests, no kernel launch), and the actual native capacity fixture (11 assertions,
seven loopback requests, five held connections closed). Evidence is
`.local/p0-containment-integrated.log` and `.local/p0-responsive-integrated.log`.
[Containment prerequisites](CONTAINMENT_PREREQUISITES.md) explicitly report positive
kernel mode unavailable. [Native responsiveness](RESPONSIVE_CHAT_PREREQUISITE.md)
proves a completed coordinator's distinct status turn while A remains held and exact
independent-root B cancellation without changing A. It does not prove Worker
admission, same-parent sibling isolation, real-model understanding or P0.3 completion.

P0 integration decision after inspecting bridge/supervisor/core ownership and focused
oracle consultation: retain one coordinator lane and multiple durable unresolved
families. Add exact idempotent coordinator-release evidence separate from all-settled
completion; persist/discover the family before advancing admission. Use fresh native
threads/grants for independent attempts rather than sharing an existing task grant.
Every family must retain its operation projection, task controller, cancellation,
deadlines, unknown coverage and activity obligations. A separate model-backed status
thread still needs these records and does not avoid the multi-family boundary.
No such production change is implemented yet. The next bounded positive fixture
must route portal P→held child A, status S and independent B through Worker/service,
then cancel B and older A exactly after admission advances, with no final result or
sleep claim. Implement the release receipt, durable family registry and all-family
maintenance coherently; do not change only the Worker claim predicate.
Final combined verification passed 1,227 control/329 runtime tests and all scripted
contracts/typecheck/build dry run in `.local/p0-first-path-final-combined.log`;
desktop reinstall and 16 tests passed in `.local/p0-first-path-desktop.log`.

Journal input/return custody (2026-09-16): three red tests reproduced mutations
of queued insert/update inputs and divergence between a direct write's durable
JSON and returned caller reference. Inserts and updates capture JSON before queueing;
writes return the persisted wire value. Updates preserve undefined-field deletion,
including a literal `__proto__` data key. The focused journal/service suite passes
29 tests and typecheck (`.local/journal-custody-focused-final.log`); red evidence is
`.local/journal-custody-red.log`. Combined verification passed 1,227 control/301
runtime tests, scripted contracts and build dry run in `.local/cancel-journal-combined.log`;
desktop reinstall and 16 tests passed in `.local/cancel-journal-desktop.log`.
This is same-process value custody, not
multi-executor exclusion, process-tree settlement or production acceptance.

Exact-task cancellation review (2026-09-16): integrated both entry points with
captured identity, task, attempt, status, navigation and offline checks, explicit
consent and editor-local exact-request uncertain retry. Main reran the 13-envelope
browser fixture plus question/task/recovery/conversation-search fixtures in
`.local/task-cancel-integrated.log`, then memory edit/Forget and skill-review
regressions in `.local/cancel-navigation-regressions.log`. All passed; three main-run
DPR2 desktop/offline/uncertain captures were inspected. Build passed in
`.local/cancel-journal-final-build.log`. The backend has no expected-attempt
precondition, and a browser pre-response transport retry was observed in initial
worker evidence; neither client guards nor cancellation prove native termination
or effect settlement. See [bounded evidence](PORTAL_TASK_CANCEL.md).
Final integrated combined verifier passed 1,227 control/301 runtime tests and all
scripted/build checks in `.local/cancel-journal-final-combined.log` (exit 0).

Descendant containment decision (2026-09-16): reviewed the independently produced
[conditional design](DESCENDANT_CONTAINMENT_DESIGN.md), checked the central Sprite
service and Linux cgroup documentation, and repeated read-only permission checks.
Current orb scope is a root-owned domain with no writable directory/procs/kill and
zero effective capabilities. No real containment test was possible or claimed.
Recommendation retains the Sprite service wrapper and requires a protected manager
plus an explicitly delegated cgroup workload subtree; same-UID writable delegation
does not protect against workload escape. Provider stop progress is not recursive
settlement evidence. Next local work is a bounded prerequisite/ordering harness;
real kernel cases require an administrator-provided disposable delegation, and
selected-Sprite support needs separately authorized inspection/provider guarantees.
Both workers are integrated; no production or infrastructure changes.

Service startup/stop fencing (2026-09-16): three red cases reproduced a control
status call after initial shutdown, activity acquisition after shutdown during the
starting journal write, and successful start return after shutdown during the final
running write. File/journal awaits now recheck startup phase; the in-memory running
transition follows the acknowledged journal write. Two more red cases reproduced
the promise-resolution gap after a helper check; startup now passes lazy actions
to the helper so phase is checked before invocation, with explicit checks before
native setup and final success. All 26 service/journal cases and typecheck pass;
red logs are `.local/startup-stop-{red,microtask-red}.log`, final focused log is
`.local/startup-stop-focused-final.log`. Preliminary combined verification passed;
final batch passed 1,227 control/298 runtime tests, scripted contracts and build dry
run in `.local/startup-history-final-combined.log` (exit 0). This does not prove complete
descendant ownership, native settlement, successful recovery or production readiness.

Lock descendant evidence (2026-09-16): host reviewed/integrated the real Node
inherited-versus-default-spawn fixture and reran 30 lock/journal/service tests.
Explicit fd inheritance preserves exclusion after parent exit; default spawn leaves
a live child while a contender enters. Both children were confirmed reaped.
`.local/startup-lock-integrated.log` records the identities and outcomes. Successful
flock acquisition is not safe takeover, settlement or sleep authority. See
[bounded Linux evidence](EXECUTOR_LOCK_DESCENDANTS.md). No launcher change was made.

Loaded conversation search (2026-09-16): reviewed and integrated message-text-only
filtering with truthful loaded counts, navigation reset and collapsed active-filter
indicator. Questions/tasks/safety notices remain visible; unfiltered history still
owns pagination and retention floors. Main reran the focused fixture plus eight
history/memory/question/task/recovery/result regression invocations successfully
in `.local/conversation-search-integrated.log`, and inspected four matched/empty/
narrow DPR2 captures. No added search request, source retrieval or inference. See
[scope and limits](PORTAL_CONVERSATION_SEARCH.md). Integrated build and desktop 16/16
passed in `.local/startup-history-final-{build,desktop}.log`; desktop reinstall also
passed. Both workers are integrated; all work remains local and gates remain false.

WhatsApp result custody (2026-09-16): two synthetic red cases changed an already
returned message during final authority checking or journal response persistence.
The shared capture boundary now detaches bounded structured data and error status
before those waits; unchecked text/resource blocks are not captured. Original error
responses cannot become successful by later mutation. Journal records still contain
no message payload, and response observation settles only protocol invocation.
All 36 read/operation cases plus typecheck pass, including an additional red/green
case that prevents new authority I/O if result capture crosses the deadline. Logs:
`.local/wapp-result-custody-red.log`, `.local/wapp-result-deadline-red.log` and
`.local/wapp-result-custody-focused-final.log`. The preliminary combined run passed;
final integrated run passed in `.local/search-expiry-final-combined.log`:
1,227 control/291 runtime, scripted contracts and build dry run, exit 0.
Recent-array compatibility and actual connector
admission/browser settlement remain unproved; no patch or gate changed.

Expiry/runtime integration (2026-09-16): both acknowledged and lost cancellation
reply cases pass through real SQLite lifecycle and supervisor composition, preserving
the exact attempt, unknown effects/tools/locks, unrelated active task and original
expiry cancellation grace. Host reran 72 related tests and typecheck successfully
in `.local/expiry-runtime-integrated.log`. No production defect was found; synthetic
native/activity callbacks do not prove Codex interruption, transcript deletion or
physical sleep. See [evidence and limits](MEMORY_EXPIRY_RUNTIME.md).

Scoped local memory search integration (2026-09-16): host reran search, inspector,
12-command edit and eight-command Forget fixtures successfully. Search is literal,
case-insensitive text over loaded eligible records only; no added request or source
retrieval. Navigation clears the query; unchanged refresh retains it and current
metadata disclosure. Matched, empty and narrow DPR2 captures were inspected, with
readable wrapping and actions. See [limits](PORTAL_MEMORY_SEARCH.md). The integrated
build and desktop 16/16 passed in `.local/search-expiry-final-{build,desktop}.log`;
desktop reinstall also passed earlier. No native Mac/Safari/live acceptance implied.
Both workers are integrated locally; no production gate or publication changed.

Completion custody snapshot (2026-09-16): `ExecutionBridge.complete` retained the
caller's observation/result object across journal and control awaits. Three red
cases showed changed identity or divergence between durable result and Worker
payload. The bridge now captures the JSON wire value before the first await;
identity, settlement flags, nested checkpoint and result stay bound to that call.
Six new cases cover three mutation boundaries, denied late proof upgrade, cyclic/
BigInt rejection before I/O and subsequent valid completion. Two further red cases
exposed the same gap while the supervisor queue waits; it now snapshots at entry
as well. All 92 bridge/supervisor tests and typecheck pass in
`.local/completion-custody-focused-final.log`; red evidence is in
`.local/completion-custody-red.log` and `.local/completion-queue-red.log`.
This is a synthetic caller-race reproduction, not authenticated native settlement
or successful restart acceptance.

Integrated public-server and memory-inspector evidence (2026-09-16): the locked
public ESM factory passes 22-tool catalog, eight schema rejection and 26 host
denial checks; actual recent arrays still fail server-side SDK validation.
See [bounded methodology](WAPPMCP_PUBLIC_SERVER.md). No session/browser settlement
or connector admission is implied. Memory metadata uses textContent, distinguishes
null expiry from absent expiry and fetches no source text. Unchanged refresh keeps
disclosures open; changed content/revision, deletion or navigation resets them.
Inspector, 12-command edit and eight-command Forget browser fixtures pass in
`.local/memory-inspect-integrated.log`; three DPR2 captures were inspected.
Final `bash scripts/verify-codex.sh` exited 0 with 1,225 control/287 runtime tests,
all scripted contracts and build dry run; desktop tests passed 16/16. Logs:
`.local/public-inspect-integration-{combined,desktop}.log`. Local only; all
production/model gates remain false and E06/E09 remain partial.

Memory forgetting integration (2026-09-16): exact-memory consent now precedes
`memory.delete`, preserving revision/scope/identity/navigation fences and stable
explicit retry keys. `purge_transcripts` remains false. Main added disclosure of
retained past conversations/completed-task copies, consistent with backend evidence.
Four new custody cases plus related suites pass (42 tests), including both cleanup
flags, scrubbed-put/delete receipt replay without SQLite writes, asymmetric sibling
isolation and exact cancellation grace across repeated different purges. Effects,
locks and terminal copies remain; no deletion-everywhere claim is made. See
[purge custody and retained boundaries](MEMORY_PURGE_CUSTODY.md).
Main reran the eight-request Forget fixture, twelve-request edit fixture and
routine-delete/recovery regressions in `.local/forget-integrated-browser.log`;
three DPR2 desktop/narrow captures inspected. Narrow DOM checks independently
scrolling fields and fully visible error/actions. Final combined batch passed
1,217 control / 287 runtime tests and all included artifact/native/service fixtures
and build dry run in `.local/forget-drain-integration-combined.log`; desktop passed
16 again in `.local/forget-drain-integration-desktop.log`. No native/live E06/E10 completion.

Drain readiness revalidation (2026-09-16): seven supervisor regression cases
initially resolved as sleeping after synthetic native readiness became false
during journal read, maintenance, prepare, intent write, commit, journal update
or provider release. The supervisor now rechecks readiness alongside the lease
between awaited stages. Before prepare it denies without poisoning the running
supervisor; after prepare it enters recovery and preserves recorded uncertainty.
A change observed after release cannot undo that one release, but prevents a false
sleeping claim and replay. 121 supervisor/lifecycle tests pass in
`.local/drain-readiness-focused.log`; red evidence is `.local/drain-readiness-red.log`.
Combined verification passed 1,213 control / 287 runtime tests and all included
fixtures/build checks in `.local/drain-readiness-combined.log`; desktop passed 16.
This is an injected readiness contract, not a production native bug reproduction:
the pinned Codex adapter still denies sleep unconditionally. No atomic provider
release/observation guarantee or descendant settlement is newly proved.

Public shutdown API (2026-09-16): the synthetic shutdown fixture now imports the
pinned package's public ESM root rather than internal subpaths. CommonJS resolution
is not exported; ESM passed all 19 cases/13 children in `.local/wapp-public-root-esm.log`.
The package exports a host-owned session candidate without a CLI patch; its README
does not document an embedded lifecycle. This does not construct/start a session,
prove transport/browser settlement or bypass the recent-array SDK blocker.
See [public API evidence](WAPPMCP_SHUTDOWN.md).

Portal memory editing (2026-09-16): text-only edits previously reset sensitivity
to ordinary and expiry to null. The reviewed fix preserves metadata/provenance,
binds original persona/revision/scope, and fences observed stale/deleted/offline
state and navigation, including away/back. First payload/ID/key remain stable for
explicit retry only; close/reload does not persist retry identity. Main reran
`node scripts/test-portal-memory-edit.mjs`: 12 exact synthetic requests passed in
`.local/memory-integrated-browser.log`, plus routine-delete/profile/skill-review/
recovery regressions. Three DPR2 desktop/narrow captures were inspected: readable
metadata/error disclosures and unclipped controls. This is synthetic Chromium
evidence, not native/live E06 acceptance. See [memory editor limits](PORTAL_MEMORY_EDIT.md).

Post-intent WhatsApp reauthorization (2026-09-16): permission could be revoked
while `readJournaledWappMcp` awaited durable intent, after the initial host check.
The regression observed one dispatch before the final result check denied data.
It now rechecks the same captured task/tool/chat authority immediately after
persistence, before transport dispatch. The helper lives inside `readWappMcp`'s
original cancellation/deadline envelope; no duplicated authorization parser or
new grant is introduced. New authority caps can tighten but never widen the wait.
The transport gets only signal/deadline; the durable intent keeps its original
custody bound. Revocation, timeout or cancelled recheck retains non-replayable
intent rather than fabricating a response or releasing browser coverage.
Six new regression/boundary cases and related suites pass (67 tests):
`.local/wapp-reauthorize-focused-final.log`. Exact 36/37ms cases distinguish success
from expiry, late allow responses cannot dispatch after cancellation/timeout, and
response persistence checks the tightened clock even before the timer callback.
The HTTPS Worker fixture passed cancellation during held intent persistence with
zero dispatch plus retained intent in `.local/wapp-reauthorize-http.log`.
The final combined run passed 1,206 control / 287 runtime tests and all included
artifact/native/service fixtures and typecheck/build dry run in
`.local/shutdown-reauthorize-combined.log`; desktop reinstall/tests passed 16 in
`.local/shutdown-reauthorize-desktop.log`. This does not make remote revocation
and external dispatch atomic, register a connector, prove recent-read SDK
compatibility or permit sleep. Production gates remain false.

Pinned shutdown integration (2026-09-16): `node scripts/verify-wappmcp.mjs`
passed all 12 signal and seven destroy/profile cases across 13 synthetic children
in `.local/wapp-shutdown-integration-focused.log`. Actual installed primitives
preserve the disposable profile; actual logout deletes the negative-control canary.
Destroy timeout/rejection and concurrent calls do not establish termination.
Pinned CLI static inspection finds unconditional signal-handler unregister even
on successful startup; the CLI was not executed. Readiness now names that blocker.
See [shutdown methodology and limits](WAPPMCP_SHUTDOWN.md). No production lifecycle,
process-tree settlement, account pairing or E09 completion is claimed.

Native Tasks elapsed deadline (2026-09-16): `createSpritesTaskTransport` previously
used Node request socket inactivity timeout, which incoming bytes can postpone.
An owned elapsed timer now bounds the full async wait, destroys the request at
expiry and retains the redacted unknown-outcome error. No automatic retry is added.
Late response data/end cannot replace that outcome. Successful responses, request
errors, aborted responses and parse errors clear the timer. A deterministic
regression first remained pending at its exact deadline; after the fix, GET/PUT/
DELETE no-response and trickle cases reject exactly at 50ms (not at 49ms).
A real loopback HTTP response streaming every 10ms also fails at its configured
100ms wait rather than completing after 1s. This is local transport evidence,
not a Sprite call, provider rollback, native termination or safe-sleep proof.
22 activity/service tests pass in `.local/tasks-deadline-focused.log`; red evidence
is `.local/tasks-deadline-red.log`. A real HTTP before/after comparison also
reproduces the old 1-second success beyond a 100ms configured timeout and the new
unknown-outcome rejection: `.local/tasks-deadline-http-comparison.log`.
Full verifier passed (exit 0), 1,197 control / 281 runtime tests and all fixtures/
build checks in `.local/tasks-deadline-combined.log`; production gates stay false.
Desktop reinstall/tests passed 16 tests in `.local/tasks-deadline-desktop.log`.

The independent backend restore delivery has been reviewed and applied; main
reran 30 skill/restore/routine/context tests successfully in
`.local/skill-restore-integration-focused.log`. Nine new restore cases preserve
pending-only staging, explicit review, historical content, admitted context and
receipt replay. No production defect was found; [scope](SKILL_RESTORE_CUSTODY.md)
excludes HTTP, crash and native acceptance. The portal comparison delivery is also
reviewed/applied: ten field pairs, explicit new-skill state, stale/offline fencing,
unchanged review envelope and same-editor uncertain retry key. Main reran
`scripts/test-portal-skill-review.mjs` successfully, including added narrow/desktop
scroll geometry assertions proving the final comparison field remains accessible
above the footer. All four regenerated captures were inspected; partial cards at
the scroll boundary are intentional, with no horizontal clipping or obscured controls.
Keyboard Space/Tab/Enter/Escape and error-alert semantics pass; four synthetic
commands, no live mutations. Routine-delete and recovery browser regressions pass.
Logs: `.local/skill-review-integration-browser-final.log` and
`.local/skill-review-integration-regressions.log`; [limits](PORTAL_SKILL_REVIEW.md)
exclude Safari, real touch, screen-reader and native Mac acceptance. Combined batch
verification passed (exit 0) in `.local/skill-review-integration-combined.log`:
1,206 control / 281 runtime tests plus all artifact/native/service checks and
typecheck/build dry run. Production admission remains false; E05 remains partial.

Activity-renewal continuity fix (2026-09-16): `SpritesActivityGuard.ensure` now
captures the previous receipt's expiry and checks it again after the renewal await.
Previously a renewal begun at 90000ms could return at/after the old 120000ms expiry
with a new 210000ms receipt and be accepted. That receipt proves a current hold,
not uninterrupted continuity. The guard now notifies recovery and blocks later
admission/release; it retains the confirmed renewed receipt and does not delete
the native Task. The 119999ms success and 120000/120001ms rejection cases distinguish
the boundary. Regression failed before the fix (missing expected rejection);
19 activity/service tests pass afterward. Logs: `.local/activity-renewal-red.log`
and `.local/activity-renewal-focused.log`. No live hold, sleep or recovery claim.
Full verifier passed 1,154 control / 271 runtime tests and all fixtures/build checks
in `.local/activity-renewal-combined.log`, production admission false.

Readiness/custody integration (2026-09-16): two independent deliveries based on
unpublished local main were reviewed and integrated. The diagnostic
[connector catalog/classifier](CONNECTOR_READINESS.md) separates installation,
artifact, per-operation protocol and historical authorization evidence; no result
grants dispatch authority. It names the recent-array SDK incompatibility even for
synthetic scoped search. Main reran 25 readiness/read tests successfully.
The [endpoint custody matrix](ENDPOINT_CUSTODY_MATRIX.md) adds 43 actual Worker/auth/
RPC/core SQLite tests using locally signed JWTs; valid foreign-owner and
runtime-versus-owner requests deny before durable access. All-table snapshots,
total_changes, RPC, alarm and fetch assertions detect unauthorized work. Main reran
123 integrated custody/auth/question/read/control tests successfully. No production
defect was reproduced in that bounded matrix; triggers, other runtime endpoints,
live Access and exhaustive policy permutations remain outside its evidence.
Logs: `.local/readiness-integration-focused.log`, `.local/custody-integration-focused.log`.
Combined integration verification passed (exit 0) in `.local/readiness-custody-combined.log`:
1,197 control / 278 runtime tests, eight auditor and five Mac checks, all pinned
artifact/SDK/native/service fixtures and typecheck/build dry run; production admission
false. Desktop reinstall/tests also passed 16 tests; existing dependency warnings
remain, and no dependency upgrade or native Mac rendering is claimed.
E09/E15 remain partial; no installed connector, live callability or security-audit
completion is inferred.

Native client/child-stream integration (2026-09-16; verified locally):
the reviewed `macos/` delivery is independent SwiftUI/WKWebView source targeting
macOS 14+, not a built Mac release. Five Node checks (one executable script test,
four structural checks), shell syntax and plist parsing pass. Main installed the
signature-verified official Swift 6.3.3 Debian compiler and ran four real Foundation
XCTest methods successfully. Optional checksum-pinned setup is committed under
`macos/scripts/` and opt-in through `.agents/setup`; no Apple SDK or renderer is
available. Native app compilation, permission enforcement, cookies/login, rendering,
signing/notarization, updates, notifications and energy remain unverified/unimplemented.

Actual `--plan-child` was rerun successfully: the default spawned child does not
inherit root Plan mode. Literal plan tags are child message deltas, not Plan events.
Exact child cancellation closes HTTP but leaves an active message and unknown
coverage, so completion and sleep stay denied. See [evidence](CODEX_CHILD_PLAN_EVIDENCE.md).
This mode and Mac source checks now join the combined verifier; no child Plan
acceptance or successful native recovery is inferred.
The integrated verifier passed 1,154 control / 262 runtime tests, eight auditor
tests, five Mac source/script checks, all HTTP/native/service modes and build dry
run. Four Swift XCTest methods passed separately; desktop 16 tests passed.
Logs: `.local/native-client-integration-combined.log`, `.local/macos-swift-policy-final.log`,
`.local/native-client-desktop.log`. Native UI was not rendered: Apple frameworks
are unavailable.

Routine-delete compatibility follow-through (2026-09-16): the portal now uses its
existing accessible editor instead of `window.confirm`, which the native shell
denies. It shows the exact routine ID/revision and requires acknowledgement that
active tasks continue. Submission rechecks current selection, owner, revision and
observed connection; reconnect does not replay. An explicit retry in the same
editor preserves the command key. Server authorization remains authoritative for
races beyond the client's observed snapshot.
`node scripts/test-portal-routine-delete.mjs` passes with native confirm disabled:
required acknowledgement, Escape/Enter, stale/offline rejection, sibling isolation,
same-key uncertain retry and normal Save-label restoration (two synthetic requests,
one receipt). Schedule/recovery Chromium fixtures also pass; desktop, narrow/offline
and uncertain-result screenshots were inspected. Logs:
`.local/routine-delete-{browser,schedule,recovery}.log`. No native WKWebView,
screen-reader, live deletion or external cancellation acceptance is inferred.
Combined rerun passed: `.local/routine-delete-combined.log`, 1,154 control / 262
runtime tests plus compatibility, auditor/Mac source checks, HTTP/native/service
fixtures and typecheck/build dry run. Final production admission remains false.

Actual locked SDK composition (2026-09-16): `scripts/test-wappmcp-sdk.mjs`, invoked
by the disposable `verify-wappmcp.mjs` installation, runs SDK 1.30.0 Client/McpServer
over its public InMemoryTransport. It imports the actual pinned upstream JSON
helper after matching its installed bytes to the SHA256-verified plugin artifact.
Synthetic handlers and messages are used; neither the real plugin server/session
nor Chrome is started. No extra dependency or patch is installed in the app.

This exposes a previously untested compatibility failure. Upstream
[`getChatMessages`](https://github.com/vaibhavpandeyvpz/wappmcp/blob/9a0a39e61b2271df1a1d7fc1e198f1e37f66aaf8/src/lib/whatsapp/session.ts)
returns `Message[]`, and
[`createJsonResult`](https://github.com/vaibhavpandeyvpz/wappmcp/blob/9a0a39e61b2271df1a1d7fc1e198f1e37f66aaf8/src/lib/mcp/helpers.ts)
casts that value without wrapping it. SDK CallToolResultSchema requires an object
for `structuredContent`. The direct schema check rejects at that field, and an
actual SDK tool request reaches the synthetic handler once but cannot release the
recent-message batch through the host boundary. Object-shaped scoped search passes
with exact chat/query/page/limit checks. Earlier array-valued callback fixtures
proved only host validation, not supported SDK compatibility. Recent history must
remain blocked until a supported fix/version is reviewed; search is not equivalent.
No validation bypass or additional dependency patch is authorized.
Read-only upstream inspection on 2026-09-16 found `main` and latest tag `v0.4.0`
still at the pinned revision, with no later fix, published release or related
issue located. There is no identified newer compatible version to adopt now.

Abort, SDK timeout and connection close each reach server cancellation while the
deliberately non-cooperating handler is still pending. Client close returns before
handler completion. Releasing the handler later leaves the journal intent unknown;
a fresh-signal retry of the same operation cannot call the transport again.
These are three distinct negative contracts, not stdio/browser/process termination
evidence. The verifier reports `syntheticCompatibility:false` while the five-mode
positive/negative fixture passes. Focused log: `.local/wapp-sdk-focused.log`.
An initial fixture replay assertion incorrectly reused an already-aborted signal;
it was corrected to a fresh signal and a transport-dispatch counter so rejection
must come from retained custody, not incidental cancellation or a closed client.
Combined rerun passed in `.local/wapp-sdk-combined.log`: 1,154 control / 270 runtime
tests, all SDK positive/negative, compatibility/native/service and build checks.
Production admission remains false; the negative compatibility result is preserved.

Actual SDK stdio descendant evidence (2026-09-16):
`scripts/test-wappmcp-stdio.mjs` extends the disposable pinned verifier with a real
Node MCP server and one bounded synthetic descendant. Only public SDK Client,
StdioClientTransport, McpServer and StdioServerTransport APIs are used. No real
plugin CLI, Chrome, account, native model or provider is started. Child modes run
only when this fixture file is invoked directly; import alone launches nothing.

After an admitted journaled search dispatch, the descendant publishes an atomic
counter heartbeat. SDK client close returns with its public pid getter null.
The fixture independently checks the direct PID plus Linux /proc start-time identity
is no longer executing, then observes a strictly newer heartbeat from the same
still-running descendant identity. Thus direct-child termination and stdio closure
do not imply descendant termination. The re-opened journal retains unknown intent;
retry of the same operation cannot call the transport again.

Cleanup uses a private stop file for the cooperative synthetic descendant and
verifies both captured identities are gone or terminal (Z/X), not executing; it
does not claim every OS zombie was reaped. Independent 15-second backstops bound
the synthetic processes. The fixture does not signal arbitrary PIDs or implement
a production process-tree supervisor. Temporary state is removed; a subsequent
process scan found no fixture survivors. Focused command
`node scripts/verify-wappmcp.mjs` passed (`.local/wapp-stdio-focused.log`).
The combined verifier passed in `.local/wapp-stdio-combined.log`: 1,154 control /
270 runtime tests and all compatibility/native/service/build checks, including the
stdio fixture. Final admission is false and the recent-read incompatibility remains.
This is stronger than in-memory cancellation evidence but still not Chromium,
Sprite lifecycle, complete descendant containment or safe-sleep acceptance.
An owned service/descendant boundary remains required before connector admission.

WhatsApp invocation-journal follow-through (2026-09-16):
`readJournaledWappMcp` is a trusted, unregistered assembly around the scoped read
boundary. It requires host attempt/operation IDs, a deadline and an authorization
callback. Inside the existing cancellation envelope it serializes and fsyncs a
payload-free `whatsappReads` intent in the exact running attempt before upstream
dispatch. The stored cap includes the initial Worker's tighter deadline. Retained
IDs are never replayed. Concurrent writes preserve sibling/native fields through
the existing single-process journal queue; this is not multi-executor fencing.

Only a trusted transport's observed protocol response can record `response`.
SDK rejection, timeout and late responses leave intent uncertain. A response
already observed before cancellation may finish its durable write afterward;
that records invocation termination, not caller success, authorization or browser
termination. Reads still validate content and recheck authority before release.
`CodexOperations` projects retained intents as unknown and responses as settled,
with stable IDs/clocks and the bounded deadline, while coverage remains unknown.
Root completion cannot erase these records. Corrupt inventories fail closed.
No chat IDs, queries, message bodies or transport error text enter these records.

Eight new tests and the existing read/operation/journal suites pass (61 total):
pre-dispatch disk visibility, exact 37ms expiry, late completion, reconstruction,
replay refusal, concurrent duplicate IDs/siblings, blocked/failed writes, root
completion and corrupt records. Log: `.local/wapp-operations-focused.log`.
`bash scripts/verify-codex.sh` passed (1,154 control / 270 runtime tests, all
compatibility/native/service/build checks, production admission false) in
`.local/wapp-operations-combined.log`. After expanding only the blocked-write test
to include response persistence, focused and full runtime suites passed again
(`.local/wapp-operations-runtime-final.log`, 270 tests). Desktop 16 tests pass.
Real MCP transport registration, descendant/process termination, successful
reconciliation and live pairing remain open. The transport callback must not
resolve on local abort/close; this unit does not assert that an SDK close settled
anything. The existing plain read helper remains for isolated contract fixtures.

WhatsApp transport investigation: the locked MCP SDK 1.30.0's
[`Protocol.request`](https://github.com/modelcontextprotocol/typescript-sdk/blob/2d889f2b329e46680ec9bdd565de4616c497825a/src/shared/protocol.ts#L681-L834)
deletes the response handler and rejects locally on timeout/abort; cancellation
notification delivery/remote settlement is not awaited. Its
[`StdioClientTransport.close`](https://github.com/modelcontextprotocol/typescript-sdk/blob/2d889f2b329e46680ec9bdd565de4616c497825a/src/client/stdio.ts#L201-L240)
can return after sending SIGKILL without observing process close. Future transport
assembly must retain unknown in-flight obligations and independently confirm process
and browser-descendant termination; neither a rejected call nor resolved close is
safe-sleep evidence. No SDK installation or connector launch was added by this review.

WhatsApp authority-deadline follow-up (2026-09-16; verified locally):
`readWappMcp` now accepts the exact Worker `{allowed:true,deadline_at}` authorization
response as well as the existing boolean host callback contract. The initial
response can tighten the timer to an earlier ancestor deadline; the second check
cannot extend any previous cap. Malformed/extra fields deny, exact expiry stops,
and late callbacks after cancellation cannot arm new timers. This avoids reducing
the Worker's effective deadline to a boolean in trusted HTTPS composition.
18 scoped-read tests and the HTTPS Worker fixture pass; combined rerun passed
1,154 control / 262 runtime tests, eight auditor tests and all HTTP/native/service/
build checks in `.local/authority-deadline-combined.log`. No MCP registration or live read
has been added, and AbortSignal delivery does not prove upstream termination.

WhatsApp scoped-authority follow-up (2026-09-16):
`HEHEBOT_WHATSAPP_READ_POLICIES` is an operator-provisioned JSON registry keyed by
policy UUID, with values `{chatIds:string[],tools:string[]}`. It defaults to `{}`
in production and local configuration. Only the two scoped reads are accepted;
mutations, duplicate IDs/tools, malformed IDs and >64KiB UTF-8 registry content
reject. At most 64 policies and 100 chats per policy are accepted. No wildcard or
empty-means-all behavior exists.

Admission captures exact registry grants whose policy IDs occur in both the
operator tool registry and persona snapshot. Routines additionally require their
admitted action-policy IDs and the current operator action registry. The optional
`whatsapp_read_policies` snapshot field is absent when none qualify; old snapshots
without it deny reads. Native descendants of the same persona retain the original
snapshot; another admitted persona captures its own scope. Policy edits do not
silently broaden already admitted tasks.

`POST /internal/whatsapp-read-authorize` uses the existing runtime bearer boundary,
execution gates and generated schema. Input is `{identity,run_id,attempt,name,chatId}`;
there are no caller-supplied grants or deadlines. `WhatsAppReadAccess.authorize`
requires current executor/attempt, running/finishing task, unexpired admitted
deadline and non-cancelled/non-stale native ancestry. The exact tool/chat pair must
occur together under one policy in both pinned and current registry grants.
Removing or narrowing current operator configuration denies access; current
persona edits retain the existing immutable-task semantics, so cancel the task
or revoke the operator policy when immediate revocation is needed.

Success returns `{allowed:true,deadline_at}` using the earliest task/ancestor
deadline. The query writes no records, renews no lease and schedules no inference.
The ControlClient allowlist includes it. This is an authorization surface, NOT
connector dispatch: trusted runtime composition must bind original task custody,
use it around `readWappMcp`, supply its admitted deadline, and account for in-flight
MCP operations. No WhatsApp tool is registered, browser started or account paired.

Focused evidence: 38 core tests (9 new scoped-access cases), 11 client tests,
generated contracts and typecheck pass. Coverage includes asymmetric tool/chat
pairs, no policy union widening, registry expansion/narrowing, routine restriction,
cross-persona/legacy denial, exact expiry, parent cancellation, native inheritance,
UTF-8 bounds and rejection of injected grant/result fields. Logs:
`.local/whatsapp-access-focused.log`, `.local/whatsapp-access-client.log`.
The first full verifier passed in `.local/whatsapp-access-combined.log`.
`scripts/test-control-whatsapp.mjs` also passes against a disposable HTTPS Worker:
wrong token/chat/attempt/epoch, mutation and injected-grant fields reject; queries
preserve run/event state; cancellation during a synthetic read suppresses its
result and blocks another dispatch. Two synthetic reads, no live account, MCP,
browser or provider calls. Real runtime MCP assembly remains open.

Second parallel delivery integration (2026-09-16): the artifact-license auditor
and disk-backed receipt-crash harness are reviewed and applied. The auditor's
eight unit tests pass; all 350 locked artifacts pass SRI and are inspected.
Ten byte/metadata-identical aliases are explicitly retained; conflicting contents
or metadata still reject without extraction. Exit 2 deliberately means review
required, never legal approval. See [license evidence](WAPPMCP_LICENSE_EVIDENCE.md).
The worker's 100 crash/reopen trials passed; main's first rerun failed on case 4
with an HTTP timeout during concurrent combined verification, and its cleanup
deadline was not confirmed. A subsequent process scan found no workerd survivors.
Do not count the failed rerun as acceptance. The integrated combined verifier
passed 1,154 control / 259 runtime tests plus HTTP/native/service/build checks.
The subsequent sequential run passed 100 injections/reopens in 470,837ms, with
50 cases of each mode, 1,350 helper requests and all children stopped. The later
alias-only auditor follow-up passed eight focused tests and full artifact inventory.
[Methodology](CONTROL_CRASH_RESTART.md) distinguishes
incomplete-input loss from committed-response loss and excludes power-loss claims.

Parallel integration checkpoint (2026-09-16; verified locally, unpushed):

- Native question binding arms the admitted deadline immediately after validating
  resolver custody, before reading the attempt journal. A stalled initial read now
  stops at exact expiry. Late I/O cannot record/take an answer or invent resolution;
  terminal native resolution still uses original custody. Locally rerun: 45 runtime/
  service tests and 72 core question tests. No underlying I/O cancellation or
  successful recovery claim.
- Pruning rejects impossible applying-journal sequences: only a deleted prefix,
  at most one deleting entry, then pending entries are reachable. Plan order—not
  JSON key order—governs validation. 114 backup/retention/restore tests rerun,
  including all nine two-candidate combinations and receipt-rename failures.
  [Evidence and limits](CONTROL_BACKUP_JOURNAL_SAFETY.md); structural validation
  does not authenticate receipts or prove power-loss durability.
- Portal recovery editors recheck exact task/attempt, effect digest/status and
  current eligibility before POST. Offline actions disable; reconnect does not
  replay. Recovery and question browser fixtures pass locally. Desktop/narrow
  captures inspected: dialog identity/error text and controls fit. Keyboard and
  role=alert checks pass; this is Chromium, not Safari/touch/screen-reader proof.
- 200 seeded real-SQLite drain/effect sequences rerun locally, matching worker
  counts: 369 dispatches, 288 explicit unknown transitions, 600 terminal receipts,
  700 object reconstructions, 100 lease losses and 100 drain preparations.
  [Model and mutation evidence](DRAIN_EFFECT_RACES.md). No process-crash, disk-reopen,
  native continuity or real provider sleep evidence is inferred.
- Model-facing skill/routine reads and commands now enforce the admitted hard
  deadline before watchdog reconciliation. Three claimed/running/finishing exact
  expiry regressions failed before the fix; all 13 agent-command tests pass after.
  Tests preserve commands, task/attempt rows, lifecycle and skill proposals across
  rejection. Immutable admitted policy and existing receipt behavior stay intact.
- WhatsApp reads accept an optional host-only `authorize` callback. It must return
  exactly true before dispatch and after the response; errors deny with fixed
  redacted codes. Both awaits share the original cancellation/deadline envelope;
  late checks cannot start I/O or release results. The callback receives frozen
  tool/chat identity and an owned AbortSignal, not message contents. 15 tests pass,
  including denial on each boundary and independent task isolation. This hook does
  not implement Worker authority: chat-scope representation and trusted lease/
  revocation wiring are still missing. Callers must bind original task custody.
- `config/wappmcp` locks 350 package locations separately from application deps.
  The verifier installs them only in disposable storage with lifecycle scripts
  disabled, checks pristine source and explicitly applies the exact approved patch.
  Patched bytes match the independent hash-pinned extraction. Focused check passes.
  No Chrome download/start, CLI, pairing or tool registration. Metadata review found
  LGPL-3.0-or-later `node-webpmux`, Public Domain `jsonify`, and two missing license
  declarations; source/asset/notice review remains open. See the installation README.

Local logs: `.local/parallel-question-focused.log`, `.local/parallel-control-focused.log`,
`.local/parallel-portal-{recovery,questions}.log`, `.local/parallel-drain-focused.log`,
`.local/agent-deadline-{red,focused}.log`, `.local/wappmcp-locked-focused.log`.
First integration batch passed `.local/parallel-batch-combined.log`; final complete
batch passed **1,145 control / 259 runtime tests**, compatibility, HTTP/native/service
fixtures and typecheck/build dry run in `.local/parallel-final-combined.log`.
Desktop 16 tests passed (`.local/parallel-desktop.log`). Production gates false.

WhatsApp task-deadline checkpoint (2026-09-16): `readWappMcp` accepts optional
host-only canonical UTC `deadlineAt`, copied before asynchronous work. Effective
expiry is the earlier of that admitted task deadline and the bounded relative
timeout. Invalid timestamps reject before I/O; exact expiry prevents dispatch and
suppresses late results. Omitting it preserves the standalone two-minute ceiling;
future trusted task assembly must supply it from custody, never model arguments.
11 scoped-read tests pass (`.local/wappmcp-deadline-focused.log`), including shorter
task versus shorter operation windows, exact expiry, attempted options extension
and pre-microtask expiry. Combined verification passed 931 control / 253 runtime
tests, pinned WhatsApp compatibility, native/service fixtures and typecheck/build
dry run (`.local/wappmcp-deadline-combined.log`). No grant issuance, lease/revocation transport,
connector installation, native termination or production admission is implied.

Approved WhatsApp compatibility checkpoint (2026-09-16): the owner-authorized
exception from the coordination thread is merged into AGENTS.md/SPEC.md without
removing local progress links or native-descendant authority guidance. It supersedes
earlier patch-policy blocker statements below, not live adoption gates.
`node scripts/verify-wappmcp.mjs` verifies pinned public artifacts before extraction,
the distributed patch against the exact approved source revision, clean `git apply`
and rejection of changed/missing bytes and double application. It executes the
actual patched Reaction and Injected/Utils functions with synthetic WhatsApp models:
both `_serialized`/`$1`, precedence, non-mutating normalization, message model and
last-message cache/fallback lookups, and absent-key suppression. All 20 published
tools outside the two scoped reads are denied; the 9 existing read-boundary tests
also pass. Combined verification passed 931 control / 251 runtime tests, the new
WhatsApp check, native/service fixtures and typecheck/build dry run
(`.local/wappmcp-approved-combined.log`); production admission remains false.

Artifact provenance (public downloads; no vendored upstream code):
- wappmcp 0.4.0, MIT, source revision `9a0a39e61b2271df1a1d7fc1e198f1e37f66aaf8`
  (npm `gitHead` matches); npm tarball SHA256
  `f1b28838615cabb55d17734b67ad1d6cb0d8a86cbbf8339564a3bc57dc57f1e8`.
- whatsapp-web.js 1.34.7, Apache-2.0; npm tarball SHA256
  `714e51cc23d1855ac200b99ad063fe8025208d4feca86dad4c27ffdaff096c0c`.
- Approved upstream `patches/whatsapp-web.js+1.34.7.patch`, SHA256
  `b2b582a7650545d6e7534e7a66731a8b546b309efd6bce9e0e9a4722e0a616cf`;
  touches only dependency `src/structures/Reaction.js` and `src/util/Injected/Utils.js`.
  No modifications to that patch. Upstream license files stay in the disposable
  extracted artifacts. Future redistribution must retain MIT/Apache notices and
  complete the transitive dependency/asset license audit; this is not that audit.

This is a disposable compatibility check, not an installer: it runs no npm lifecycle
scripts, browser, MCP server or pairing. No installed graph or signature/provenance
attestation is claimed verified; hashes pin the inspected artifacts. Guided setup,
transitive lockfile, trusted task/lease/revocation transport, persistent pairing,
reconnect coverage and sleep/cost evidence remain open. Rerun compatibility and
authorization checks before upgrades; patch changes require renewed approval.

Resource-deadline checkpoint (2026-09-16): acquiring a new lock now checks the
attempt hard deadline even before watchdog reconciliation. Exact already-held
lock replay remains a no-op; deadline expiry does not release locks or bypass
unknown-effect release checks. Three regression cases failed before the fix;
91 focused lifecycle/orchestration/root-child tests passed, covering claimed,
running and finishing states, −1ms/exact/+1ms, mixed held/new lock rejection,
unchanged acquisition timestamps, release and denied reacquisition
(`.local/resource-deadline-focused.log`, red `.local/resource-deadline-red.log`).
Combined verification passed 931 control / 251 runtime tests, native/service fixtures
and typecheck/build dry run (`.local/resource-deadline-combined.log`).
No native termination, connector authority, provider use or production admission.

Effect-cancellation checkpoint (2026-09-16): first dispatch now requires a running
task, and the descendant boundary rechecks admissible ancestry after intent creation.
Previously cancellation between intent and dispatch did not fence unsent effects.
Duplicate acknowledgements and late outcomes remain recordable without reopening
dispatch. Four new cases failed before the fix; 39 focused effect/root-child/recovery
tests passed (`.local/effect-cancel-focused.log`, red `.local/effect-cancel-red.log`).
Tests cover owner cancellation, root/intermediate/selected-child cancellation,
unchanged locks/effects/unrelated sibling, reconstruction and late receipts.
Combined verification passed 928 control / 251 runtime tests, native/service fixtures
and typecheck/build dry run (`.local/effect-cancel-combined.log`). No external
action is retracted, no native termination inferred and no production gates changed.

Effect-deadline checkpoint (2026-09-16): new intents and first dispatch transitions
now require an unexpired attempt deadline, closing the pre-watchdog running-state
window. Existing immutable receipt lookups and duplicate dispatch acknowledgements
remain no-ops; late confirmed/failed/unknown outcomes can still be recorded. This
does not authorize another external send or cancel an action already sent. Both
new regression cases failed before the fix; 35 focused effect-workflow/root-child/
recovery tests passed, including −1ms/exact/+1ms, reconstruction, unchanged rows
on rejection and late receipt retention (`.local/effect-deadline-focused.log`,
red evidence `.local/effect-deadline-red.log`). Combined verification passed 924
control / 251 runtime tests, native/service fixtures and typecheck/build dry run
(`.local/effect-deadline-combined.log`). No production gates or provider state changed.

Late-start checkpoint (2026-09-16): `submitted` now retains a late native receipt
and marks the run cancelling/DEADLINE_EXCEEDED when its admitted deadline has passed,
including equality. Previously a registered child could acknowledge start after
expiry and become running before watchdog reconciliation. Attempt status remains
running because the observed native work is not settled. Receipt replays remain
no-ops and cannot renew cancellation grace. The exact child boundary failed before
the fix; 82 focused lifecycle/orchestration/task-control tests pass, covering −1ms,
exact and +1ms root/child cases (`.local/late-start-focused.log`, red evidence
`.local/late-start-red.log`). Combined verification passed 922 control / 251 runtime
tests, native/service fixtures and typecheck/build dry run
(`.local/late-start-combined.log`). This is metadata cancellation intent, not verified
native termination, new execution authority or production admission.

Disabled-admission retry checkpoint (2026-09-16): `retryDue` previously deleted a
due retry even when execution was disabled, leaving waiting work without its timer.
It now retains that timer until admission reopens, while still removing stale timers
for cancelled work and moving unresolved-question work to recovery. Both new tests
failed before the fix. Focused recovery/lifecycle: 66 passed
(`.local/disabled-retry-focused.log`; red evidence `.local/disabled-retry-red.log`).
Tests verify repeated reconciliation preserves timer/run/lifecycle, cancellation
prevents revival and re-enablement advances queue sequence/attempt exactly once.
Worker alarm scheduling already excludes disabled retries; retaining them adds no
retry alarm loop. Combined verification passed 919 control / 251 runtime tests,
native/service fixtures and typecheck/build dry run (`.local/disabled-retry-combined.log`).
This is local retry custody, not native recovery or live provider acceptance.

Terminal-cancellation follow-up checkpoint (2026-09-16): cancelling queued/waiting
work now invokes the existing descendant-settlement-aware follow-up flush. Earlier
pending follow-ups otherwise remained stranded, unlike follow-ups submitted after
cancellation. Active/recovery cancellation does not flush. Two waiting-checkpoint
fixtures cover immediate delivery versus live-grandchild deferral, exact target/text,
unchanged sibling/attempt and duplicate receipt/flush prevention. Focused
orchestration/retention/recovery suite: 26 passed
(`.local/cancel-followup-focused.log`). Combined verification passed 917 control /
251 runtime tests, all native/service fixtures and typecheck/build dry run
(`.local/cancel-followup-combined.log`). Synthetic checkpoints do not prove native
parking/restart; no production gates or provider state changed.

Explicit-retry timer checkpoint (2026-09-16): accepting `run.retry` now deletes the
prior attempt's automatic timer in the same transaction. Previously a fast second
failure could hit `scheduleRetry`'s conflict-preserving insert and retain the first
attempt's earlier timer instead of the second attempt's 60-second delay. Tests
verify rejected commands preserve the old timer, accepted commands supersede it,
old receipt replay cannot delete the newer timer, and due admission respects the
second failure's exact deadline. Focused recovery/lifecycle suite: 64 passed
(`.local/retry-timer-focused.log`); combined verification passed 915 control / 251
runtime tests, all native/service fixtures and typecheck/build dry run
(`.local/retry-timer-combined.log`). Admission/uncertainty checks and retry limits are
unchanged. No provider action, native replay authority or production gate change.

Recovery-cancellation checkpoint (2026-09-16): `run.cancel` previously moved an
already recovery-required run back to cancelling. It now preserves recovery while
recording owner cancellation intent and a current event. Heartbeat already includes
recovery-required IDs, so interruption delivery needs no state regression. The new
SQLite test starts with an unconfirmed cancellation and unknown mutation effect,
then verifies active operations, running attempt, effects and locks are unchanged
by another cancel; retry/sleep remain blocked and event status stays truthful.
Focused recovery/lifecycle/control acceptance: 170 passed
(`.local/recovery-cancel-focused.log`). Combined verification passed 914 control /
251 runtime tests, all native/service fixtures and typecheck/build dry run
(`.local/recovery-cancel-combined.log`). No settlement, provider action or production
gate change; successful recovery remains unverified.

Cancellation-grace checkpoint (2026-09-16): repeated distinct owner cancellation
commands and later memory purge/expiry used to reset an already-cancelling run's
`updated_at`, postponing the watchdog indefinitely. Both paths now preserve that
original grace anchor. New command events still use current time, and canonical
memory/context purge and preview discard still occur. First entry into cancellation
is unchanged. Focused recovery/memory/lifecycle tests: 68 passed, including
staggered expiry versus explicit deletion, second owner receipts, −1ms/exact
original 30-second boundary, unsettled attempt and no retry. Log:
`.local/cancel-grace-focused.log`; combined verification passed 913 control / 251
runtime tests, all native/service fixtures and typecheck/build dry run
(`.local/cancel-grace-combined.log`). No schema migration or production-gate change;
the timer transition is not native cancellation or termination proof.

Snapshot-fencing checkpoint (2026-09-16): the real FileJournal/projection/supervisor/
SQLite integration now first persists valid live operations, then injects orphan
timing, a null inventory, invalid completion evidence or a new late-start operation.
The first three fail before heartbeat; the last reaches the Worker and is rejected
by its timing envelope. Every path retains prior operations, attempts, runs,
journal bytes and local/Worker leases, clears the supervisor timer and fences
subsequent dispatch/maintenance. No cancellation, native replay or activity release
occurs. Focused supervisor suite: 55 passed (`.local/snapshot-fencing-focused.log`).
Combined verification passed 910 control / 251 runtime tests, all native/service
fixtures and typecheck/build dry run (`.local/snapshot-fencing-combined.log`). Runtime
behavior is unchanged; this proves refusal, not repair/resume or native termination.

Worker operation envelope checkpoint (2026-09-16): after existing attempt/epoch
authentication and UTC normalization, heartbeat requires start ≤ operation deadline
≤ admitted attempt deadline and progress ≥ start. The hard limit comes from the
attempt row, not the submitted operation. Invalid timing rolls back the entire
heartbeat page and lease update. Progress after a deadline is still accepted so
late completion can be reported; it cannot extend immutable operation custody.
Focused verification passed 63 lifecycle/projection integration tests, including
offset hard-limit +1ms, inverted times, exact limit and late completion. Log:
`.local/operation-envelope-focused.log`; combined verification passed 907 control /
251 runtime tests, all native/service fixtures and typecheck/build dry run
(`.local/operation-envelope-combined.log`). No production gate or provider action
changed; progress-extension policy and actual termination remain unverified.

Interrupted-spawn checkpoint (2026-09-16): pinned generated
`CollabAgentToolCallStatus` includes `interrupted`, already admitted by the event
adapter. Heartbeat projection previously left that invocation unknown, while
offline inspection rejected the entire otherwise-valid record. Both now accept
the terminal invocation state, retaining receiver startup clocks and child work.
Root/nested tests keep active commands, pending grandchild startup, unknown
coverage and `CHILD_TURN_UNKNOWN`; offline inspection remains read-only and cannot
authorize resume/sleep. Focused rerun: 89 tests passed. Initial failures identified
two old fixtures misclassifying interrupted spawns and a new test incorrectly
expecting no missing-grandchild warning; logs are `.local/interrupted-spawn-focused.log`
and `.local/interrupted-spawn-focused-rerun.log`. Combined verification passed
903 control / 251 runtime tests, all native/service fixtures, typecheck and build
dry run (`.local/interrupted-spawn-combined.log`). Schema/synthetic event evidence does not
prove a live interrupted spawn or recursive process termination. No gates changed.

Operation inventory integrity checkpoint (2026-09-16): heartbeat projection rejects
null, scalar and array inventories instead of interpreting them as absent work.
This covers root/child tool and stream maps, spawn maps, child-turn maps and child
owners. Absent fields and empty maps retain legacy behavior. Errors are fixed,
content-free `INVALID_OPERATION_INVENTORY`; reads do not repair journal state.
Verification: 25 runtime tests (200 malformed combinations) and 8 SQLite tests
passed, including unchanged persisted operations/lease after failed projection.
Logs: `.local/inventory-focused.log`, `.local/inventory-control.log`. Combined
verification passed 903 control / 249 runtime tests, all native/service fixtures
and typecheck/build dry run (`.local/inventory-combined.log`). Structural validation
does not authenticate journals, prove complete coverage or authorize sleep/replay.

Overlapping-stream watchdog checkpoint (2026-09-16): real FileJournal → operation
projection → SQLite heartbeat/watchdog tests cover message and plan streams
starting one minute apart. Either can complete without settling the other; the
remaining operation cancels at its own deadline, not a completed earlier deadline
or the run hard deadline. Checks at deadline−1ms/exact deadline and cancellation
+29,999ms/+30,000ms prove the current boundary. Repeated heartbeats preserve the
cancellation timestamp. Unconfirmed cancellation leaves attempts and operations
live, retains unknown coverage, queues no retry and denies sleep. Eight focused
tests passed (`.local/overlap-watchdog-focused.log`); combined verification passed
903 control / 248 runtime tests, all native/service fixtures, typecheck and build
dry run (`.local/overlap-watchdog-combined.log`). No runtime behavior changed.
This does not exercise a real held native stream through expiry, the separate
15-second cancel/15-second verification steps, or actual process termination.

Message completion integrity checkpoint (2026-09-16): live heartbeat projection and
offline inspection reject non-object output maps, invalid item IDs and noncanonical
SHA-256 digest values. Previously, key presence alone could classify a malformed
completion as settled. Root/child same-ID isolation and exact-item matching remain
intact; valid-looking hashes do not authenticate journal contents. All 44 focused
operation/inspection tests passed (`.local/output-completion-focused-final.log`),
including read-only offline checks. Combined verification passed 901 control / 248
runtime tests, all native/service fixtures and typecheck/build dry run; evidence:
`.local/output-completion-combined.log`. No native protocol, deadline, recovery
authority, provider action or production gate changed.

Previous checkpoint (2026-09-16): live agent messages now have independent five-minute, task-capped lifetime clocks, so tool/plan overlap and turn termination cannot erase a still-open stream. Only exact output completion ends that lifetime; deltas/replay cannot refresh it. Offline inspection includes these clocks. Verification passed 99 focused tests, targeted native supervisor-child/Plan reruns, and combined 901 control / 246 runtime tests, all native/service fixtures and typecheck/build. Old fixture-count assumptions failed and were corrected: native Plan generation keeps both its enclosing message and plan open. This is not complete native coverage, watchdog termination or safe sleep. See [service contracts](CODEX_SERVICE.md), [TODO](../TODO.md) and [handoff](HANDOFF.md). No production gate changed.

The owner-selected Mac direction is SwiftUI + WKWebView around the remote portal, not yet implemented. The Electron foundation listed below remains existing code, not a verified Mac release; separate Mac-decision specification edits are awaiting integration.

## Implemented locally

- Cloudflare Worker portal/API and one SQLite Durable Object per installation for commands, receipts, timelines, revisions, routines, occurrences, runs, scoped memory, policies, effects, locks, and lifecycle state.
- Owner JWT verification, origin checks, signed/deduplicated triggers, strict generated schemas, paginated events, and durable idempotency.
- Fenced epochs/leases, serialized lifecycle operations, bounded retries, drain/checkpoint contracts, cancellation isolation, and conservative unknown-effect handling.
- Codex stdio transport, durable submission/event journal, exact root/child identity, steering/cancel intent, scoped host tool callbacks, and supervisor/bridge fixtures.
- Managed skill proposals/revisions/per-bot enablement and routine create/list/inspect/edit/pause/resume/delete/run-now contracts.
- Numeric cron/timezone/DST/misfire behavior, reviewed disabled bot import, flight deadline ledger, provider adapters, and Sprite activity-hold components.
- Static portal and remote-only Electron desktop shell.

Owner-authored memory expiry now arms a Worker alarm even while the runtime is
asleep. Each reconciliation purges at most 100 due canonical memories, including
their revisions and `memory.put` payloads, and rearms remaining work. Expiry
invalidates active captured contexts without settling uncertain tasks, releasing
locks, requesting inference or waking the runtime. This is not full retention or
"forget everywhere": source events, terminal task snapshots, native transcripts
and backups may still contain copies.

Schema v5 adds alarm-driven timeline retention: messages, action requests,
trigger inputs, follow-up notices and results retain 90 days; metadata audit and
derived room updates retain 30 days. Each reconciliation prunes at most 100 rows
and rearms a backlog. Physical cleanup may lag the cutoff, but snapshots, timeline
pages and newly captured recipient context exclude overdue rows immediately.
History floors include overdue rows still awaiting removal. Dates originate at
event creation, not the last read. This is not full payload/storage retention.

Compact event provenance and room-publication digests survive timeline expiry.
Legacy publication identities are backfilled transactionally before deletion,
preserving duplicate suppression and the existing causal contribution count.
Global cursors report interior history gaps and never reset when all events
expire. Recipient contexts disclose expired history alongside current authorized
objects and retained deltas; cleanup never advances consumed watermarks. Timeline
responses expose truncation. The portal displays an expired-history notice,
invalidates cached pages when the retention floor advances, and rejects delayed
pre-pruning responses. `node scripts/test-portal-history.mjs --retention` checks
partial/empty history and stale responses in Chromium with synthetic read-only
HTTP responses; default and `--error` modes cover cross-bot history races.

New recipient context also rechecks referenced object revisions, deletion and
memory scope/expiry. Unavailable references replace that update's text with an
explicit unavailable marker; independent updates remain intact. Original timeline
rows and already captured/native transcripts are not erased by this read-time
check. Publication still creates no inference or wake.

Schema v6 adds indexed, 100-row command-payload cleanup at 90 days from original
acceptance for applied/rejected commands. Receipt identities, body hashes, keys,
outcomes and foreign-key links remain intact; pending acceptance is not erased.
Tests preserve same-key and webhook replay/conflict behavior after body removal.
This does not claim dedupe-key reuse or deletion of receipt metadata at 90 days.

Schema v7 adds indexed, transactional cleanup of at most 100 terminal attempt
results per reconciliation, 90 days after settlement. The current attempt's
delivered portal copy is redacted in the same transaction; a replacement result
uses its own settlement date, not the original outbox creation or delivery update.
Waiting/recoverable runs, pending retries/deliveries, unresolved operations/effects
and resource locks prevent this cleanup. Identity, statuses, timestamps and
checkpoints are preserved; expiry is never evidence of native settlement or sleep.
The Worker schedules cleanup even with execution disabled. Physical purge may lag
the cutoff; these stored result copies have no current retrieval endpoint.

Schema v8 expires undelivered deferred follow-ups at 90 days from receipt, erases
their text and records a content-free expiry notice requiring fresh owner input.
The target task is unchanged. Dispatch enforces the cutoff even before a bounded
100-row cleanup batch reaches that message. Already-dispatched follow-up copies
lose their redundant text but retain their coordinator link/status; captured work
is not silently cancelled or erased. Migration preserves rows and foreign keys
transactionally. `node scripts/test-portal-history.mjs --followup` checks the
accessible notice, cross-bot separation and zero mutations in real Chromium;
desktop/narrow screenshots are synthetic read-only UI evidence, not phone tests.

Never-claimed queued/waiting tasks also lose unused derived context after 30 days
from enqueue, in batches of 100. Only the instruction and room identity remain;
claim rebuilds the full authorized snapshot from current canonical data. Cleanup
does not advance cursors, change run status/timestamps, create events or wake the
runtime at this 30-day boundary. At 90 days, never-started instructions are erased
and marked `failed/MESSAGE_EXPIRED`, with a content-free notice asking for fresh
input. Original command receipt age survives forwarding; commandless scheduled
work uses its enqueue time and retains a skipped occurrence identity. Claim and
retry enforce this cutoff before bounded physical cleanup reaches the row, so
an overdue backlog cannot execute, wake a provider or starve fresh requests.
Wake rechecks after provider observation, including expiry across that await.
Admitted/recoverable
attempts remain untouched. `node scripts/test-portal-history.mjs --input-expiry`
checks the desktop/narrow expiry notice and absence of expired text.

Admitted/terminal task contexts, protected results, non-portal outbox payloads,
revisions, native data and backups remain outside this cleanup.
Compact provenance/causal records currently have no expiry. These are explicit
remaining retention gaps, not proof of full S30 or "forget everywhere". Existing
publication digest semantics are preserved; full per-edge collaboration,
shared-deadline and yielding requirements remain separate.

Disposable service assembly now composes supervisor, bridge, native transport/router,
per-root inherited MCP grants, child controls and conservative operation accounting.
Its native child fixture exercises public owner cancellation through real Worker
heartbeat to one exact interrupt, while completion/sleep remain denied. See
[service evidence and limits](CODEX_SERVICE.md). A separate live Sprite Tasks test
verified hold create/read/renew/delete, not application drain or VM sleep; see
[provider evidence](PROVIDERS.md).

Completion acknowledgments use the retained attempt result, not the mutable run
status. Identical serialized results can replay after a waiting checkpoint or
retryable failure, including after the retry becomes queued, without rewriting
state or publishing another result. Conflicting results fail; pruned receipts
cannot establish replay success. Current epoch, lease and attempt fences still
apply. Owner cancellation continues to suppress result text. SQLite/journal tests
exercise lost acknowledgments and reconstruction, not native restart readiness
or family settlement.

Retry scheduling preserves an existing run checkpoint rather than overwriting it
with a retry timestamp; the retry queue still owns the deadline. The bridge passes
that checkpoint as nested `durable_checkpoint` data to a later admitted attempt's
fresh native thread, without merging it into authorization or another task's
context. SQLite/journal/RPC tests cover owner and automatic retries. This is
checkpoint delivery, not native session restoration, proof that a model uses the
checkpoint correctly, or permission to replay an effect. Existing reconciliation
and retry-admission restrictions still apply.

Quiet-chat result messages retain the recorded event's outcome, error code and
available task title even when no recent run record remains or the body is empty.
Missing legacy status is unavailable, never inferred as success. These historical
labels do not replace current task attention or prove family settlement. The
`test-portal-results.mjs` Chromium fixture covers refresh/reload, conversation
isolation, empty failures/cancellations, unknown status and narrow wrapping with
no mutation requests; native approval/question integration remains incomplete.

[Native-question custody](NATIVE_QUESTION_CUSTODY.md) now binds owner answers to
the original task, attempt, epoch, boot, connection and exact question revision.
The Worker commits response uncertainty before returning answer data; repeated
takes never resend it. Questions block task completion and sleep until separately
resolved or explicitly closed after confirmed executor termination, even after expiry. Resolution proves neither answer consumption nor
task settlement. The portal uses attributed literal question cards and explicit
answer/skip controls, retains hidden-bot attention, fences stale edits, and leaves
the ordinary chat composer independent. SQLite, actual local HTTPS Worker and
inspected Chromium fixtures cover these boundaries. Runtime thread-journal
binding is now connected through default-off disposable service assembly, including
real native answer delivery and cancellation without an answer. Resolved question
content has bounded 90-day cleanup after resolution and task settlement, guarded
by retries, operations, effects and locks. Pending/unknown records, native journals
and backups remain retained. Owner-only `question.close` preserves original
handoff uncertainty in a versioned closed-custody receipt with native resolution
left null. It requires the original attempt's confirmed termination and explicit
revision-checked consent, changes no task/effect/lock, and can reconcile old-epoch
question custody. Retry, claim and recovery closure reject unresolved questions;
unrelated fresh work remains eligible. Closed records share guarded 90-day
retention. SQLite, Worker and Chromium fixtures cover these local contracts.
Actual provider shutdown, full recovery and production callback admission remain
unverified; production execution remains disabled.

Observed native child starts are now acknowledged by the service atomically with
Worker registration. Exact receipt replay recovers a lost acknowledgement without
resubmitting inference or resurrecting a cancelling/terminal task. Legacy journal
mappings reconcile once without replacing known Worker identities. The native
service effect fixture no longer needs a manual child submission call.

[Explicit task steering](CODEX_STEERING.md) now connects an owner-selected exact
attempt to Worker pending/receipt contracts and disposable service maintenance.
The portal separates immediate steering from after-settlement follow-ups, shows
truthful delivery states and disables uncertain resends. Existing command payload
retention applies; known delivery metadata expires after 30 days once the task is
terminal with clear custody, while pending/unknown recovery records remain. No context,
policy, effect, lock or completion is rewritten. Ordinary messages still enqueue
independent work rather than implicitly steering a background task.

The actual pinned native steering fixture observes root and direct-child directives
in their next model context before exact-turn completion, including child delivery
after root completion while a sibling stays held. Reopened journal receipt replay
issues no second native steering RPC. SQLite/HTTP/service/Chromium tests cover the
separate application boundaries. Native acceptance is not model understanding or
consumption, natural-language intent resolution, multi-root Worker admission,
successful crash recovery, full O03 or production/sleep readiness.

Provisional output now has a separate display path: completed native
`agentMessage` items (not deltas, reasoning, command output or tool payloads) feed
the exact root/child attempt's latest preview. Full-message digest and native item
identity prevent replay from replacing newer text; conflicts fence observation.
The router retains at most 8192 UTF-16 units without cutting a surrogate pair;
the journal permits 1024 observed message identities and 101 display owners per
admitted family. This is bounded message snapshots, not token streaming or a
complete transcript. Native `final_answer` is not application settlement.

Service maintenance publishes serially through the authenticated runtime route,
with exact native reference, lease, epoch, boot, attempt and deadline checks.
An identical version can replay after a lost acknowledgement without new native
work. Cancellation/context invalidation rejects late display publication; stale
executor authority still fails rather than becoming a display acknowledgement.
The Worker stores one preview per run, hides terminal/old-attempt/cancelled output,
and expires it 90 days after its first preview without extending expiry on updates.
Memory invalidation discards affected active previews. Native journals and backups
remain separate retention obligations; this is not deletion everywhere.

The portal labels previews provisional and renders text literally, preserving
task expansion through polling and distinguishing recovery from completion.
`node scripts/test-portal-output.mjs` covers root/child, shortened text, injection,
recovery, narrow layout and terminal/cancelled/old-attempt hiding without mutations.
SQLite, Worker HTTP and native service fixtures cover publication separately from
settlement; authenticated inference/model judgment remain unverified.

Trusted [root/descendant effect bookkeeping](ROOT_CHILD_EFFECTS.md) now connects
strict runtime routes to the existing effect/resource ledgers. It validates exact
lease, attempts, native ancestry and original same-task policy/scope, records
child-owned effects and locks atomically, and preserves custody-bound replay.
Reconciliation never releases locks or implies native settlement/sleep. SQLite
and in-process Worker HTTP/RPC tests use synthetic observations and receipts;
this is not connector execution or authenticated per-child MCP provenance.

The active-native-crash fixture verifies fencing and restart refusal during an
open root turn, not successful resume. The [offline recovery diagnostic](CODEX_RECOVERY.md)
projects current task identities and observed obligations without credentials,
network calls or state writes; unknown coverage remains a blocker.

The owner recovery view now pages independently of the newest-100-run snapshot
and retained conversation events. `GET /v1/conversations/:id/recovery` returns
20 tasks by default (maximum 100), bounded effect metadata, and an exclusive
`after`/`next_cursor` task-ID cursor. Persona ownership or the captured room
identity scopes each page. Tasks leaving recovery do not shift subsequent pages;
restart from the first page for concurrent arrivals before the cursor. Reads do
not authorize retry, effect dispatch, lock release or native settlement. Existing
ingress maintenance still runs. Context/checkpoint bodies and provider receipt
payloads are excluded. SQLite, owner RPC, local HTTP and Chromium fixtures cover
pagination, scope, malformed input, empty/error/loading states and late responses.
The portal retains separate explicit effect-decision and recovery-close consent.
This closes the recovery listing window gap, not full restore or native census.

The composer-adjacent task strip reads an independent owner-authenticated task
feed, so unfinished tasks older than the newest100 runs remain discoverable.
Stable ID pagination returns ten tasks at a time with conversation-wide waiting
and recovery counts. Expanded details preserve exact-task cancellation and show
original receipt status separately from completion. Failed refreshes hide stale
controls; conversation switches reject late responses. SQLite/Worker tests and
Chromium checks cover pagination, scope, cancellation isolation, narrow layouts
and stale/empty states. Counts do not prove native approval/question coverage,
family settlement or safe sleep.

[Owner roster organization](ROSTER.md) now persists ordered sections, membership,
collapse and independent hiding through revision-checked owner commands. Search
never changes metadata; removing sections unassigns bots without changing work.
Hidden attention counts include unfinished tasks outside the newest100 window,
remain reachable during search, and disclose stale observations. SQLite/Worker
and inspected Chromium fixtures cover local behavior. Full native approval and
question coverage remains unverified; roster edits cannot enable execution.

Bot profiles expose name, optional role and instructions with Advanced disclosure.
Duplication creates a new identity without tool grants, skills, routines, memories
or active work; source role/instructions copy only after explicit review consent.
Profile edits retain existing archive state rather than silently unarchiving.
The optional role is bounded descriptive text, not a capability grant. SQLite
tests verify isolated creation and unauthorized-policy rejection; Chromium proves
minimal creation, copy consent, source preservation and same-ID/key retry after
a lost acknowledgment. Per-editor retry identity does not survive closing the
editor or reloading; inspect existing profiles before starting a replacement.
No generated introduction, account connection or model call is added.

Routine editing now starts with frequency/time/day controls and an explicit
timezone; numeric cron remains available under Advanced. The owner-only,
rate-limited `/v1/schedules/preview` calls the same scheduler used for saving and
returns three calendar due times without reconciliation, inference or wake.
Changing a schedule invalidates its reviewed preview; late responses cannot
authorize Save. Existing custom cron, nondefault zones, action policies and
trigger-only routines survive ordinary edits. The current installation default
is Jakarta; importing Singapore routines does not change that default. SQLite
tests cover preview/save equivalence across DST gaps/folds and absent month-end
dates; Chromium checks picker mappings, errors, races, trigger preservation and
narrow rendering. Calendar previews are not runtime admission or execution proof.

[Selected portable templates](PORTABLE_TEMPLATES.md) export configuration into
disabled routines and pending skill proposals with grants removed. This is an
offline review plan, not full backup/restore or automatic migration.

[Offline application SQLite snapshots](CONTROL_BACKUP.md) use the supported online
backup API to preserve one committed state, including WAL-backed rows. Private
output includes schema/count/hash verification and preserves unresolved effects,
locks and identities. This is unencrypted local staging, not live DO extraction,
coordinated native backup, restore admission or complete retention. SQLite may
update shared-memory reader markers even though source DB/WAL bytes remain intact.

[Encrypted snapshot packaging](ENCRYPTED_CONTROL_BACKUP.md) now uses checksum-pinned
upstream age v1.3.2 and explicit recipient/identity references. Decryption waits
for whole-stream authentication and schema/hash verification before publishing a
new private staging directory. Real age tests cover wrong keys, late tampering,
bounded containers, path restrictions and no overwrite. Orb setup and combined
verification install only the reviewed Linux x86_64 release and retain its license.
This remains local staging: no off-host custody/durability, authenticated hosted export,
coordinated shutdown, restore admission or secure-erasure claim. These setup
changes are local until pushed to the project's default branch.

[Cooperative encrypted snapshot creation](CONTROL_BACKUP_CREATION.md) preserves
the verified snapshot's original timestamp and holds the pruning directory lock
through encryption, exclusive publication and inventory update. Explicit
[local pruning](CONTROL_BACKUP_PRUNING.md) revalidates a digest-reviewed inventory
before confirmed deletion. Unknown unlink outcomes and unindexed publication
leftovers block retries for operator reconciliation. Disposable real-age and
filesystem-fault tests verify these local contracts, not off-host durability,
power-cut atomicity, secure erasure or automatic retention compliance.

[Application logical export and reconstruction](CONTROL_EXPORT_IMPORT.md) now
roundtrip the actual local Durable Object through owner HTTP and supported SQL,
including streamed exports larger than1MiB. Schema9 adopts the existing flight
deadline table without dropping revisions, receipts or migration history. Exact
typed rows, int64 values and event sequence high-water marks survive offline
reconstruction into a new private snapshot. The backup verifier retains schema8
compatibility; semantic inspection includes schema9 flight obligations and never
authorizes activation. Hosted authorization, off-host custody, native checkpoint
coordination and restore admission remain unverified.

[Optional-routine budget admission](BUDGET.md) now connects owner-reviewed caps
and optional routine selections to a trusted infrastructure projection ledger.
Missing/stale reports or projections at cap park only unstarted selected scheduled
work; one-run owner overrides bind the exact run and policy revision. Claim/wake
queries enforce the same predicate before LIMIT and across provider-observation
awaits. Bounded alarm maintenance does not depend on execution being enabled.
Admitted attempts/effects/locks remain unchanged; budget exceptions never enable
production gates. SQLite/Worker and inspected Chromium fixtures verify local
behavior, not actual provider bills, quota, seven-day costs or the USD5 target.

`state().monitoring` provides content-free control-plane observations: ready
request counts/age (excluding expired and budget-blocked work), heartbeat age,
unsettled operations grouped by kind/status, unresolved effects, locks,
cancellation/recovery counts and current schedule lag. Alerts use strict
45-second heartbeat, 120-second request-age and five-minute schedule thresholds,
plus immediate uncertainty/deadline notices. Projection reads do not write,
invoke inference or decide admission/sleep. Worker ingress may independently
perform its existing maintenance before the snapshot; schedule lag is current,
not a historical reliability statistic. Request age is original receipt/enqueue
age, including prior waits, not a newly invented queue-entry timestamp.

The portal displays these counts and warnings without replay controls or repeated
live-region announcements for unchanged alerts. `node
scripts/test-portal-monitoring.mjs` covers synthetic empty/active/narrow Chromium
states and zero mutations; the captures were inspected. Coordinated backup
verification remains explicitly unavailable, including after local staging
snapshots. This is not native operation completeness, a metrics/tracing exporter,
connector last-sync verification, backup-age attestation or measured SLO evidence.

Scripted native fixtures demonstrate event routing, exact cancellation, callbacks into local Worker/SQLite, and conservative rejection of root-only completion. They do **not** prove model judgment, authenticated inference, recursive descendant/effect settlement, active-work crash recovery, production service assembly, provider sleep, connector behavior, or hardware permissions.

## Run and verify

```sh
bash .agents/setup
bash scripts/verify-codex.sh
npm ci --prefix desktop
npm test --prefix desktop
```

For focused checks use `npm test`, `npm run test:runtime`, `npm run test:e2e`, and `npm run build`. The build is a dry run and does not deploy. Report current command output rather than historical exact totals. HTTP and scripted-provider tests are not browser, model, account, or production acceptance.

## Remaining gates

WhatsApp selection review (2026-09-16): the exact owner-selected wappmcp subsection
was merged from the coordinating thread without replacing other specification
sections. No package/code was imported or installed. At selected revision
[9a0a39e](https://github.com/vaibhavpandeyvpz/wappmcp/tree/9a0a39e61b2271df1a1d7fc1e198f1e37f66aaf8),
`package.json` ships `patches/` and runs `patch-package` on installation. The patch
`patches/whatsapp-web.js+1.34.7.patch` changes Reaction.js and injected Utils.js:
it normalizes WhatsApp Web `$1` message keys to `_serialized` and repairs send/edit
and last-message lookups. Omitting it can leave undefined message IDs and invalid
IndexedDB lookups on affected Web versions; ignoring install scripts is not a
verified compatibility solution. Require an unmodified supported dependency path
or explicit reviewed policy exception before adoption. Neither exists here yet.

`src/lib/mcp/server.ts` registers reads and mutations unconditionally;
`src/lib/whatsapp/channel.ts` applies its allowlist only to incoming channel events,
with empty lists allowing all and user/chat matches combined by OR. This is not
selected-chat tool authorization. Permission-notification relay is not permission
for these tools. Host-scoped read enforcement and default-denied mutations remain
required engineering. Baseline is MIT, with Apache-2.0 whatsapp-web.js and further
transitive licenses requiring audit before redistribution. Node 24+, Chromium,
QR LocalAuth persistence, account terms, history coverage and sleep cost remain
separate prerequisites/evidence. This static review grants no live pairing,
installation, routine activation, provider provisioning or production readiness.

`runtime/wappmcp-reads.mjs` is an independently written, unregistered host read
boundary based on that revision's public MCP schemas in `src/lib/mcp/server.ts`
(message reads/search), `src/lib/mcp/helpers.ts` (structured result envelope), and
`src/lib/whatsapp/session.ts` (search/default semantics). No upstream code,
dependencies, branding or assets were imported; distribution/license audit remains
required before shipping the upstream package.

`readWappMcp(grant, name, args, call, options = {})` accepts only recent-message reads and scoped
message search. The trusted caller must supply the admitted task's exact chat/tool
grant; model input cannot supply grants. It must also enforce live lease/revocation,
bounded transport, one installation connection and the unresolved installation gate.
The module does not install or expose tools, issue grants, authenticate customers
or replace these outer checks. Empty scope denies; global search, chat enumeration,
contacts and every mutation are unavailable. Calls inject explicit defaults of 50
messages/page 1; limits and search pages are capped at 100, query at 1000 UTF-16
units and grant chat IDs at 100. No automatic paging or retries occur.

Options accept an optional AbortSignal and integer `timeoutMs` from 1 to 120000
(default 120000). The caller must cap this wait to the task's remaining deadline.
Cancellation or timeout raises redacted `WHATSAPP_READ_STOPPED`, aborts an owned
signal passed as the third argument to `call`, and suppresses late results.
Pre-cancelled requests never call upstream; success and failure remove listeners
and timers. The deadline is rechecked before returning validated data. This bounds
local waiting, not upstream execution: a transport may ignore abort. It proves
neither remote cancellation nor settlement, and does not authorize VM sleep.

Responses require bounded structured JSON (1MiB), exact requested chat on every
message, distinct nonempty message IDs, canonical timestamps, and matching search
metadata. Mixed-chat batches fail as a whole. Only message ID/body/timestamp and
requested chat/query/page cross the boundary; upstream text/resource blocks,
attachment paths, contact fields and extra metadata do not. Message body remains
untrusted content, not instructions or authorization. Coverage is always `unknown`:
recent reads have no cursor and search supplies no completeness evidence. This
does not prove history recovery, sender attribution, attachment support or live
WhatsApp compatibility. Synthetic contract tests are not live plugin acceptance.

1. Promote the disposable service composition only after complete operation coverage, safe recovery/resume and warm/cold lifecycle evidence. Disconnect, lease-loss and uncertain-admission fixtures do not establish production recovery.
2. Complete owner-authorized Codex login in the executing environment and verify model eligibility, no paid fallback, bounded inference, restart continuity, refresh ownership, and concurrent-turn behavior.
3. Establish authoritative recursive child/tool/effect settlement and exact cancellation. Root completion or cancellation acknowledgment is insufficient.
4. Complete intent-aware status/new-task/steer/deferred-follow-up behavior and the full portal/mobile/accessibility UX.
5. Verify every connector operation and scope independently, including Calendar writes, Gmail no-send enforcement, WhatsApp coverage, browser persistence, and Mac Messages/device permissions.
6. Complete retention, coordinated backup/restore, portable export/import, reconciliation UI, monitoring, crash tests, seven-day cost evidence, and production Access.

Passive context updates must remain zero-inference/zero-wake. Unknown effects remain parked, admitted work retains pinned policy/context identity, and one customer runtime remains the sole execution authority.
