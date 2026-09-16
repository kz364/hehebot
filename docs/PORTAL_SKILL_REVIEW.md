# Portal skill review comparison

The pending proposal and its confirmation editor show all ten procedural fields,
including the name, in current-approved/proposed pairs. Changed/unchanged labels
compare exact values, including list order; an empty list reads “None”. New skills
explicitly have no prior approved version. A missing prior skill is not presented
as an empty approved body. This is a field comparison, not an inline word diff.

Approval still requires a separate review step and the owner's explicit
private-facts affirmation. The portal does not scan or certify privacy. Imported
and model-written text remains untrusted text, rendered with DOM/textContent.
Approval advances already-enabled bots for future tasks; it neither enables
additional bots nor rewrites the context of already-admitted tasks. These are the
existing `SkillCatalog.review`/context-capture semantics, not new backend behavior.

Both review decisions check the latest observed connection, pending proposal
identity/revision/base and approved-skill revision when the editor submits.
Approval also requires the proposal's base to match the current approved revision.
A newly opened rejection can discard a stale-base proposal without altering the
approved catalog. Offline actions are disabled; reconnect does not send commands.
Explicit retries within one editor retain the idempotency key. The wire command
remains `skill.review` with only `proposal_id`, `expected_proposal_revision`, and
`decision`; backend checks remain authoritative for races after the last snapshot.

## Reproduce the bounded browser evidence

Run `node scripts/test-portal-skill-review.mjs` with the installed `agent-browser`
Chromium. It starts and closes a loopback-only synthetic HTTP fixture, serves the
real portal assets, and closes its browser session in `finally`. It verifies:

- Exact current/proposed values for ten fields, asymmetric changes, list reorder,
  removed list contents, unchanged fields, and hostile markup rendered as text.
- Staged review, required affirmation, Escape cancellation and Space/Tab/Enter.
- Both decisions rejecting changed proposal revision/status, changed/missing skill
  and offline snapshots before any POST; no reconnect replay.
- Stale-base approval disabled, rejection available, and explicit new-skill state.
- Server error alerts, exact approve/reject command envelopes, and same-key
  explicit retry after a synthetic uncertain reply (four requests total).
- Chromium desktop 1280×900 and narrow 390×844 at DPR 2, including narrow overflow
  checks and dialog/alert semantics. Screenshots are written to
  `.amp/in/artifacts/skill-review-{desktop,offline-narrow,new-narrow,error-desktop}.png`.

The fixture uses synthetic state and receipts: it does not prove live backend
mutation, authenticated deployment, a screen reader, touch input, Safari or native
WKWebView. Existing `tests/skills.test.ts` covers future-task updates versus captured
task context. The field comparison uses existing styles; no stylesheet, backend,
schema, manifest, verifier, shared status document or production gate is changed.
This bounded delivery does not claim full E05 completion.
