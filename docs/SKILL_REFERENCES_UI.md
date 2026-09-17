# Supporting reference text in the skill UI

The skill create/update editor supports up to four named text documents. Names
must match `^[a-z0-9][a-z0-9._-]{0,63}\.(md|txt)$` and be unique. The pattern caps
the stem at 64 characters; the input also has the contract's 80-character bound.
Text must contain 1–16,000 Unicode codepoints. Validation counts codepoints in
JavaScript rather than using textarea `maxlength` (UTF-16 code units).

The application stores reference text; it does not install, fetch or execute it.
Names/extensions are storage policy, not scanning or proof that contents contain
no code or private facts. References do not grant effects or tool authority, nor
guarantee what a model with separately granted tools may do. The existing
private-facts affirmation explicitly covers references. There are no file upload,
download, URL-fetch or executable-support controls.

## Preservation and review

- Text is never trimmed or split through the list-field helper. Leading/trailing
  whitespace, Unicode, line breaks and literal backslashes survive. If textarea
  normalization would change existing CRLF bytes, unchanged text retains its
  original stored value. Actual edits use the textarea's text value.
- An omitted field stays omitted when there are no reference edits; an existing
  explicit empty list stays `[]`. Removing every existing reference sends `[]`.
  Unrelated field edits retain all references without reordering or normalization.
- A draft target change cannot submit. Close and reopen **Propose an update** on
  the exact target (or **Draft skill** for a new skill). This avoids overwriting
  another skill with a draft that never loaded its supporting references.
- All additions/removals/edits go through `skill.propose`. The proposal body,
  including references, is part of same-editor uncertain-retry fingerprinting:
  exact retries retain their key and payload; changed text or names cannot reuse
  that uncertain submission. No automatic approval or activation is added.
- Full names and text use `textContent` in the catalog, current/proposed field
  comparison, retained history, and restore confirmation. Comparisons show both
  sides, including explicit removals and omitted legacy fields. No Markdown/HTML
  renderer or clickable reference URLs are introduced.
- Restore confirmation describes the whole source body and warns that approval
  removes current references absent from it. Restore remains a staged proposal.
  Captured contexts, enablement, executable-change denial, stale/offline checks
  and owner-alpha policies remain unchanged.
- Malformed imported reference shapes show an explicit warning instead of
  breaking proposal rendering/rejection. Editing malformed or over-limit retained
  lists is blocked rather than silently truncating data to four documents. The
  backend independently revalidates retained bodies before staging or approval.

The authoring dialog reuses the existing bounded scrolling-field layout and
separate action footer. No stylesheet changes are required.

## Local verification

```sh
node --check public/app.js
node --check scripts/test-portal-skill-references.mjs
node scripts/test-portal-skill-references.mjs
node scripts/test-portal-skill-draft.mjs
node scripts/test-portal-skill-review.mjs
node scripts/test-portal-skill-history.mjs
git diff --check
```

The focused Chromium fixture checks asymmetric changed/removed/added documents,
whole-list removal disclosure, hostile markup as literal text, invalid names,
duplicate names, 64/65-character stems, four allowed/fifth blocked references,
empty text, 16,000 valid emoji versus 16,001 rejected, byte retention on unrelated
edits, omitted versus empty, new authoring, target-change rejection, exact uncertain
retry, changed-reference retry rejection, restore disclosure, required affirmation,
stale/offline fences and owner-alpha zero new history reads. Synthetic commands
are only propose/restore, never approval, enablement or effects.
Host follow-up reproduced an imported-object rendering exception, then added
malformed-object/null-entry and over-limit retention cases. The invalid-import
editor state is captured in `skill-references-invalid-import.png`.

Neighboring review/history expectations now include the eleventh field. The
review fixture's offline selector targets Approve/Reject, rather than also
matching the unrelated History read/disclosure button. Existing draft behavior is
tested without modifying its fixture.

Inspected 2× Chromium artifacts under `.amp/in/artifacts/`:

- `skill-references-comparison-desktop.png` and `comparison-narrow.png` (same
  `skill-references-` prefix): full current/proposed text, additions and removals.
- `skill-references-editor-desktop.png`, `skill-references-editor-narrow.png`,
  `skill-references-editor-controls-narrow.png`: authoring and scroll/footer layout.
- `skill-references-restore-desktop.png`, `skill-references-restore-narrow.png`:
  literal historical text and separate pending-proposal confirmation.

These are real Chromium checks against synthetic HTTP data, not integration with
the host's concurrently implemented schema/catalog/runtime changes. No live
model, provider, account, deployment, full verifier or native-shell verification
was performed. A 390px viewport is not touch/Safari/physical-phone testing. The
host owns backend integration, verifier wiring and shared progress documentation.
