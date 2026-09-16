# Loaded conversation text search (bounded E04)

The portal searches only `payload.text` on loaded `message.user` and `run.result`
events for the selected conversation. It does not search task titles, question
text, provisional output, memory, sources, or unloaded history. This is not full
history retrieval or complete E04 acceptance.

The input is limited to 200 characters (also sliced before matching). Matching
uses literal JavaScript lowercased substring comparison, with outer whitespace
trimmed; it does not evaluate regex, HTML, or instructions. Empty/whitespace-only
input shows all loaded messages. Text still renders through `textContent`.

The native details panel has a labelled search input, described scope, polite
atomic live counts, and keyboard-operable Clear button that restores input focus.
Counts describe loaded message records, not all events or all retained history.
An active filter remains indicated when the panel is collapsed; collapsing it
provides more reading space on short/narrow viewports. Scope details can be opened
without fetching anything. No-match is explicit, including zero loaded messages.

Bot/room selection, Skills, and task/recovery view navigation reset the query.
Ordinary refresh and newly loaded messages preserve it and recompute results.
Queries are not persisted. Existing memory search is independent.

Filtering occurs only inside the message rendering branch. Questions, task cards,
cancel/recovery controls, expiry/retention notices, and runtime warnings retain
their existing visibility and authority. Run association and history pagination
use the unfiltered conversation events. Explicit Load earlier messages remains
the only search-adjacent history fetch; its cursor, 1,000-event older-history cache,
scope checks, and monotonic retention floor checks are unchanged. Search does not
promise a complete archive or change the existing latest-page/cache policy.

## Credential-free browser evidence

Run `node scripts/test-portal-conversation-search.mjs`. The fixture serves the real
portal with asymmetric synthetic bot/room messages and disables polling so added
requests cannot hide among background refreshes. Assertions cover:

- User/result text, literal/case matching, hostile HTML, inaccessible other scopes,
  labelled input, live status/counts and Tab/Enter Clear behavior.
- Zero requests for search and keyboard clear; no source/inference calls or writes.
- Questions, task cancellation controls, expiry/runtime notices surviving no-match.
- Zero-match pagination still requesting `before=101`, not the first matched row.
- Unchanged refresh, newly arrived results, pruning/deletion, and a delayed older
  response rejected after the retention floor advances.
- Bot, room, recovery and Skills navigation resets; collapsed active-filter state.
- DPR2 desktop matched/empty and narrow expanded/collapsed captures without horizontal
  overflow. Narrow Chromium viewport emulation is not native-device verification.

Related regressions: `test-portal-history.mjs` (default, `--error`, `--retention`),
`test-portal-memory-search.mjs`, `test-portal-questions.mjs`, `test-portal-tasks.mjs`,
`test-portal-recovery.mjs`, and `test-portal-results.mjs`, all under `scripts/`.
Synthetic fixtures verify portal behavior, not live provider or production gates.
No backend/runtime, authentication, inference, shared verifier or gate changes.
