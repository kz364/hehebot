# Bounded portal memory editing

The memory editor changes text and the existing All bots / This bot sharing field.
Existing sensitivity, expiry and source-event identity are retained, including an
explicit scope change. New memories retain ordinary/no-expiry defaults and use
only a user message belonging to the selected conversation. Missing existing
provenance never falls back to a recent message.

The optional owner-API `explicit_constraint` declaration is not editable in this
dialog. The server preserves it when this older payload omits the field, including
text/sharing edits. Clearing requires an explicit boolean false with the current
memory revision through the owner API. This metadata does not grant tool authority
or bypass scope, expiry or forgetting; token-budget protection is not implemented.

The dialog binds its original persona, persona revision, memory revision and scope.
Known offline, removed/changed memory, removed/archived/changed persona, and navigation
(including away and back) prevent submission. Server revision checks remain the
authority for changes that the browser has not observed.

The first submission freezes text, scope, memory ID and idempotency key. A failed
reply leaves an explicit **Retry same save** action, never an automatic retry.
Even an uncertain retry rechecks the current local fences. Fields remain locked
after rejection too: close and refresh before preparing a different edit.
Retry state is dialog-local, not persisted through close/reload. This is not a
general command receipt recovery UI or an authorization change.

## Browser regression evidence

Run with installed `agent-browser` and Chromium:

```sh
node scripts/test-portal-memory-edit.mjs
node scripts/test-portal-routine-delete.mjs
node scripts/test-portal-profile.mjs
```

The first command ran against the supplied unpublished baseline before the fix.
Its text-only edit assertion failed: actual `expires_at: null` and
`sensitivity: ordinary`, expected `2091-03-17T04:23:11.000Z` and `sensitive`.
After the fix it passes with 12 synthetic command requests. It checks exact
payload/key identity, both scopes and explicit transitions, stale/deleted/changed
state, navigation, HTTP/rejected/malformed replies, no refresh replay, provenance,
Enter/Escape and DOM error/field attributes. Refreshes wait for a rendered fixture
marker rather than assuming an overlapping refresh completed.

The fixture writes 2× desktop preservation/uncertainty and narrow offline captures
to `.amp/in/artifacts/portal-memory-*.png`. These are synthetic browser contracts,
not live backend, account, provider or native-runtime evidence. No E06 completion
or production admission is implied.
