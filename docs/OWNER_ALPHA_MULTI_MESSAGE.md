# Owner-alpha multi-message credential-free prerequisite

`bash scripts/test-codex-service.sh --owner-alpha-multi` is a bounded fixture-model
integration prerequisite. It uses the actual portal form, local HTTPS Worker and
SQLite, the service-owned coordinator-release/admission path, pristine Codex
scripted loopback responses, and the read-only routine MCP grant. It does not use
an account, model subscription, provider hold, native child, production execution
flag, or production-verification flag.

The mode configures `max_runs: 2`. It routes scripted responses by the captured
context instruction rather than global HTTP request order. It checks distinct run,
attempt, native thread and persisted grant custody; retention of the first unresolved
family after acknowledged coordinator release; quota refusal of a third native
admission; reload without inference; exact cancellation of the old run without an
interrupt aimed at the newer native identity; two unknown-coverage obligations;
no `run.result`; and sleep denial.

## Continuity defect and correction

The first run exited nonzero: the second root's actual model input contained
neither the first instruction nor a history/summary. Private-message snapshots
previously had only the current instruction; task summaries cover background work
and context events cover room publications. The fixture did not fabricate history.

New direct-message snapshots carry `conversation_history`. It captures up to20
earlier retained user messages in the same persona conversation, in chronological
order, strictly before the current command's event sequence. Later queued messages
cannot enter an earlier command's history or change an already admitted snapshot.
Room, routine and cross-persona contexts do not receive this private history.

Each message may include its original direct coordinator's currently visible
`provisional_reply`, identified through the original command receipt. Existing
attempt, expiry, cancellation and context-invalidation visibility rules apply;
native references and grants are not included. Replies are explicitly provisional,
not settlement. History is labeled data, not new instructions or authorization.
Tool policies and immutable grants are unchanged.

Each prior user text and provisional reply is capped at2000 UTF-16 code units;
per-entry and aggregate truncation flags disclose clipping, older omitted messages
and retained-history gaps. This is a bounded alpha continuity slice, not the full
selected-tokenizer context budget, summarized transcript, completed-result history
or retrieval implementation required by E06. Original events remain retained under
their existing policy; this change neither extends retention nor claims deletion.

The host native rerun passes with four scripted model requests, two retained
families, no inference on reload and no third native admission. The final fixture
also checks the exact first provisional reply in actual second-root input. SQLite
tests cover private scope, command-sequence cutoff, immutable admitted snapshots,
metadata-noise filtering, clipping and the exact90-day retention boundary.

All evidence is credential-free fixture-model behavior, not actual model judgment
or live multi-message acceptance. No child permission, production gate, settlement,
sleep or external-effect capability is enabled.
