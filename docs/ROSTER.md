# UX03 roster organization is owner-controlled display metadata

`RosterLedger` stores one installation-wide layout in the existing `runtime_metadata` row keyed by exported `ROSTER_LAYOUT_KEY = 'roster-layout'`. No schema changes or per-persona object revisions are needed. Layout edits never change persona archival, routine enablement, task admission, authorization, effects, locks or lifecycle state. This module has no model, tool, inference, event, scheduling or wake call.

## Public contract

```ts
type RosterSection = {
  id: string;
  name: string;
  persona_ids: string[];
  collapsed: boolean;
};
type RosterLayout = {
  expected_revision: number;
  sections: RosterSection[];
  hidden_persona_ids: string[];
};
type RosterSummary = {
  revision: number;
  sections: RosterSection[];
  hidden_persona_ids: string[];
};

const ledger = new RosterLedger(store, () => canonicalUtcNow);
ledger.summary(); // No writes. Missing metadata: revision0, sections[], hidden_persona_ids[].
ledger.set(ownerId, acceptedCommandId, layout); // Returns ROSTER_LAYOUT_KEY.
```

`set` is a whole-layout replacement in one `Store.db.transaction`. It requires a matching owner command row of type **`roster.set`**, status `accepted` or `applied`. Owner IDs must be nonempty strings of at most 256 UTF-16 code units; command IDs are canonical UUIDs. This is trusted control-plane provenance, not authentication of an arbitrary caller: the parent must expose only an authenticated owner public command, never a generic model/tool mutation. The existing `ControlCore.accept` receipt boundary owns idempotency and payload routing. A direct repeated call with the original expected revision fails `REVISION_CONFLICT`; it does not silently replay or increment twice. Do not reenter with a fresh revision under an old receipt.

The expected revision is a nonnegative safe integer strictly below `Number.MAX_SAFE_INTEGER`. An absent layout starts at revision0; every successful save increments by one, including an explicit identical save. The compare and metadata upsert share one transaction, following the Store revision-conflict convention. No `Store.put` call is made because this is runtime metadata, not a versioned persona/policy object. There is no separate unbounded layout-history table.

Bounds and validation:

- **0–20 sections**, exported as `MAX_ROSTER_SECTIONS = 20`. Empty sections are allowed.
- **0–200 total distinct referenced personas**, exported as `MAX_ROSTER_PERSONAS = 200`, across memberships and hiding together. At most 200 memberships overall and 200 hidden IDs. Hiding may overlap membership; it is not another section.
- Section IDs and persona IDs are lowercase canonical UUIDs with versions1–8 and RFC variant. Section IDs must be unique. Each persona has at most one membership anywhere in the layout. Hidden IDs must be distinct. Section and persona identity namespaces are separate.
- Names contain **1–80 Unicode code points**, must already be trimmed, and must contain no Unicode control (`Cc`) or surrogate (`Cs`) characters. No normalization or implicit truncation occurs. Duplicate display names are allowed: UUID, not name, identifies a section. Render labels as text, not HTML.
- Exact object keys, actual arrays and booleans are required; extra section/top-level keys fail. Arrays preserve the supplied order exactly, including hidden IDs. The ledger does not infer organization or sort membership.
- Every referenced persona must exist as an undeleted `objects(kind='persona')` row at save time. Archived-but-undeleted personas can retain layout metadata without being unarchived. Routines, unknown IDs and deleted personas fail `NOT_FOUND`.

The stored envelope has exactly `{version:1,revision,sections,hidden_persona_ids,owner_id,command_id,updated_at}`. The injected timestamp must be canonical `YYYY-MM-DDTHH:mm:ss.sssZ`. Reads validate envelope shape, bounds, revision and timestamp, reject metadata over64 KiB and never reset malformed data. `summary()` omits owner/command/time bookkeeping and returns fresh parsed values; caller mutation cannot update storage.

Errors use existing `ControlError` conventions: `INVALID_INPUT`/422 for layout violations, `FORBIDDEN`/403 for missing or mismatched command provenance, `REVISION_CONFLICT`/409 for stale edits, `NOT_FOUND`/404 for unavailable personas, and `ROSTER_INVALID`/409 for malformed stored metadata or an invalid host clock. Messages do not echo names, IDs or stored content. All checks precede the sole metadata write. An enclosing command transaction rollback also rolls the layout back.

## Removal, hiding and later persona deletion

Removing a section means omitting it from the next layout. Its still-existing members are unassigned because no section references them; no persona, routine or task row is modified. Parent UI should compute unassigned personas as current roster IDs minus assigned IDs, preserving the existing plain roster ordering. No section is required to create or use a persona.

`hidden_persona_ids` is explicitly separate from sections, collapse, archival and routine enablement. Deleting a section does not implicitly unhide its members: preserve the hidden array unless the owner also changes it. Hidden bots continue running existing work and enabled routines, and can require approvals or recovery. Collapsing a section likewise changes display only.

A later persona deletion must not silently rewrite manual organization. Reads therefore preserve stored references without checking current existence. The UI must intersect layout references with its current persona list; an unavailable ID is not a resurrected bot. A subsequent save must explicitly remove unavailable references. There is no automatic cleanup or inference-driven organizer.

## Verification and parent integration

```sh
HEHEBOT_ROSTER_TEST_SCHEMA=/absolute/current-schema9.sql npx vitest run tests/roster.test.ts
npm run typecheck
```

The schema override affects only the disposable SQLite test fixture, not application behavior; default is `DB/schema.sql`. Tests exercise real schema9 tables, ordered asymmetric memberships, collapse/hide, empty layout, section removal, reload, owner provenance, revision conflicts, boundary validation, archived/deleted references, invalid metadata/clock and nested rollback. A live synthetic persona has an enabled routine, running attempt, unknown mutation effect and held lock. A successful roster edit produces exactly **one runtime_metadata write**, while all other application tables (including commands, objects/revisions, runs, effects, resource locks, lifecycle and events) remain identical.

## Integrated owner command and portal

`roster.set` now enters the existing authenticated, same-origin `/v1/commands`
boundary. `ControlCore.accept` supplies durable receipt replay/conflict handling;
`/v1/state` returns the layout and per-persona unfinished/waiting/recovery counts
from all retained unfinished runs, independent of the newest100 display window.
The command creates no task, event or wake operation. Ordinary Worker ingress
maintenance can still reconcile unrelated due work.

The portal keeps a plain roster, case-insensitive name search, ordered named
sections and explicit organization editing. Searching temporarily reveals matching
collapsed members without saving metadata. Section collapse persists via an owner
command. Hidden bots have a separate reachable list and waiting/recovery count
that search does not suppress. Removing a section preserves hidden membership.
The editor requires explicit removal of unavailable references and rejects stale
revisions without overwriting concurrent edits. Text labels never become HTML.

`node scripts/test-portal-roster.mjs` exercises these interactions in Chromium,
including ordered memberships, reload, conflicts, narrow bounds and stale reads.
Worker HTTP tests verify same-origin/local-auth restrictions, receipt deduplication,
reload and unchanged execution tables; SQLite tests prove old tasks contribute to
counts. Long editor fields scroll independently of Save/Cancel controls.

Task observations become stale after30 seconds or a failed refresh. Counts are
recorded application tasks, **not full native approval/question coverage** or proof
of family settlement. Narrow rosters scroll within the sidebar. This completes
the local organization surface, not all UX03 native-attention acceptance. No
model/tool organizing surface, accounts, providers or production gates are added.
