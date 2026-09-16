# Bounded portal memory search

This is a local E06 slice, not full memory retrieval or E06 acceptance. The portal
filters the already loaded memory list after applying its existing eligibility
rule: global memory or memory owned by the selected persona. A foreign persona's
matching text does not enter results or counts. This is UI filtering, not a new
server authorization boundary; the owner snapshot already contains those objects.

The labelled search input accepts at most 200 UTF-16 code units. Matching uses a
trimmed, lowercased literal substring of memory text only, not metadata, source
events, regex, fuzzy matching or semantic inference. Whitespace-only input shows
all eligible loaded records. Query state stays in the page, is not persisted, and
resets on conversation navigation (including leaving and returning to a persona).
Existing polling/explicit refresh recomputes results without clearing the query.
Counts and empty states say **loaded**; they do not claim complete or fresh
server-side retrieval. No additional request, inference, wake or source fetch is
introduced. Existing refresh traffic and mutation custody are unchanged.

The Clear search button supports keyboard activation and returns focus to the
input. The result count has a polite, atomic status announcement. Search rerenders
only memory cards, not the conversation or navigation. Metadata stays textContent
only; unchanged visible disclosures survive refresh. Changed metadata, removed
results and navigation discard prior disclosures. Edit and Forget still receive
the exact original object and use their existing revision/scope/persona/offline
checks and explicit same-key uncertain retry behavior.

## Reproduce local evidence

Run from the repository root with agent-browser/Chromium installed:

```sh
node scripts/test-portal-memory-search.mjs
node scripts/test-portal-memory-inspect.mjs
node scripts/test-portal-memory-edit.mjs
node scripts/test-portal-memory-delete.mjs
```

The synthetic search fixture disables only its page's periodic timer so request
counts are deterministic. It checks asymmetric global/own/foreign data, literal
case/whitespace matching, metadata nonmatching, hostile HTML as inert text,
keyboard Tab/Enter clearing, accessible label/status, unchanged refresh retention,
revision replacement, text changes, deletion, navigation reset and truthful empty
scope versus no-match states. Each explicit refresh/navigation remains exactly the
existing three reads. Search/clear/inspection produce zero requests; zero commands
or source requests occur. Existing inspector, 12-command edit and eight-command
Forget fixtures pass without weakening assertions.

Logs: `.local/portal-memory-search.log`,
`.local/portal-memory-search-inspect.log`,
`.local/portal-memory-search-edit.log`, `.local/portal-memory-search-delete.log`.
The initial fixture log `.local/portal-memory-search-initial.log` retains a test
failure from clicking the desktop-only Refresh control at narrow width. The fixture
now restores desktop width before that step; the full rerun passes.

The credential-free `bash scripts/verify-codex.sh` passed 1,225 control and 287
runtime tests plus native/service fixtures and typecheck/build dry run (exit 0;
`.local/portal-memory-search-combined.log`). `npm ci --prefix desktop && npm test
--prefix desktop` passed 16 tests (`.local/portal-memory-search-desktop.log`). These
checks do not enable production admission or verify model judgment.

Inspected DPR2 Chromium captures under `.amp/in/artifacts/`:

- `portal-memory-search-desktop.png`: matching shared memory with open metadata.
- `portal-memory-search-empty.png`: no matches, loaded count and Clear search.
- `portal-memory-search-narrow.png`: 390px viewport, matching memory and metadata.

All three render readably without horizontal overflow. Narrow Chromium is not
native phone, Safari or Mac verification. No screen-reader session or live account
was used. Full model retrieval, tokenizer budgets, summaries, native scope isolation,
production settlement and provider behavior remain outside this change. Shared
status, verifier, backend, runtime, manifests and production gates are untouched.
