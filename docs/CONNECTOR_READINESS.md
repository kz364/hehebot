# Connector readiness is evidence, not authority

This bounded E09 slice adds a harness-neutral, side-effect-free classifier and
the pinned WhatsApp catalog. It does not install, pair, register or call anything,
and is not wired into production admission or a model prompt. Full E09 remains open.

Owner API: `GET /v1/connectors/catalog` exposes this same bundled JSON baseline
after owner authentication, using the 120/minute owner read limit. The envelope
states `scope:bundled-diagnostic-baseline`, `runtime_inventory:unobserved` and
`authority:not-granted`. Catalog evidence (including installed:false) describes
the bundled baseline, not a fresh runtime inventory or account probe. No
reconciliation, alarm arming, tool registration or provider call runs on this
read; owner-alpha rejects it. The response is no-store and supplies a detached
copy. There is no write/install/pair/enable endpoint in this slice. Other
connectors absent from this catalog must not be labeled unsupported or ready.

`classifyConnectorReadiness(evidence)` in `runtime/connector-readiness.mjs` takes
exactly five required fields for **one operation**:

| Field | Accepted evidence |
| --- | --- |
| `advertised` | Boolean catalog/discovery observation |
| `installed` | Boolean installation observation, separate from disposable artifact checks |
| `artifact` | `unknown`, `verified`, `mismatch` against the selected pins and approved patch |
| `protocol` | `unknown`, `incompatible`, `synthetic-verified`, `live-verified` for that operation |
| `authorization` | `not-checked`, `denied`, `observed-allowed` for an individual prior check |

All fields are explicit; unknown keys/values, missing fields, accessors and
non-record inputs throw content-free `INVALID_CONNECTOR_EVIDENCE`. A false
advertisement need not erase an independently observed installation or protocol
result. A verified disposable artifact does not establish installation. Synthetic
protocol success never establishes live callability. No input creates an `allowed`
response, grant, chat scope or dispatch decision. Even `observed-allowed` is only
a historical observation: cached/stored readiness is not authority or freshness.
Inputs must be selected by trusted host code, not model arguments/imported text.

The returned `missing` strings name unmet evidence and always require fresh Worker
authorization. `authority` stays `not-granted`; notifications, mutations and
imported-routine sends stay unavailable, and coverage stays unknown for every
combination. This deliberately does not expose an overall `connected`/`ready` flag.

## WhatsApp facts must accompany model-facing claims

`config/connector-catalog.json` records selected pins, declarative prerequisites
and per-operation protocol evidence, **not a live installation inventory**. Its
artifact evidence is the existing disposable verifier's result, not a check run
by this classifier. `describeWhatsAppReadiness(tool)` combines common evidence
with the exact read tool's protocol observation. Unknown tools and mutations
reject. Never reuse one operation's evidence for another.

This model-facing baseline includes the catalog's `recentReadBlocker` and all
still-unverified `prerequisites` in `missing`, for either supported read tool.
Today the truthful claim is: pinned artifacts/approved patch were verified in
disposable checks, but no installed, paired or callable runtime exists. Recent
messages return array-shaped `structuredContent`, incompatible with SDK 1.30.0's
object requirement. Object-shaped scoped search is only synthetic-protocol
verified; it is **not recent-history coverage**. There is no validation bypass,
fallback substitution or additional approved patch. A future reviewed fix needs
new pins and compatibility/authorization reruns, not an edited status label.

Node 24+, Chrome/Chromium, a private persistent single-installation profile,
supported process/descendant supervision, separately authorized pairing, live
selected-chat behavior and measured reconnect/history gaps remain separate gates.
Account/platform terms, sleep/cost and redistribution review also remain open.
Do not copy QR material, credentials, browser profiles or downloaded attachments
into logs, Git or exports. See `config/wappmcp/README.md` for the locked graph,
negative SDK/termination evidence and incomplete license review.

## Existing execution authority stays with the Worker

`src/core/whatsapp-access.ts` checks the admitted task snapshot intersected with
current operator policy, exact chat/tool, attempt/lease, ancestor state and hard
deadline. `runtime/wappmcp-reads.mjs` accepts host-held scopes and checks its trusted
authorization callback before dispatch and before releasing results.
`createWappMcpReader` in `runtime/wappmcp-operations.mjs` binds those checks to
the fixed ControlClient endpoint, captured identity/run/attempt and host deadline.
It takes an already connected, host-owned MCP SDK client and journal; it does not
connect or register it. One executor owns the journal. The host must establish
the correct initial attempt-to-task association and supply stable operation IDs;
model arguments cannot supply either. A durable fingerprint rejects changed
custody/scopes/deadlines on reconstruction. Exact schema validation precedes
authority requests. The normal three authority checks are before intent, after
intent persistence and before releasing the response. Worker deadlines only
tighten the cap. MCP gets the resulting timeout and invocation AbortSignal,
with progress-based timeout extension disabled and default result validation.
ControlClient authority requests retain their own bounded timeout; aborting an
invocation does not imply those read-only HTTP requests or server work stopped.
No response/error/close can settle a browser or grant automatic replay.
This classifier neither replaces nor invokes those checks.
Notification allowlists filter incoming events; they never authorize reads or
effects. Imported routines remain no-send. Even a live callable read cannot
authorize another task/chat or a mutation, establish complete history, settle a
browser descendant or permit sleep.

Focused verification: `node --test tests/runtime-connector-readiness.mjs`.
The tests use independent asymmetric expected evidence and exercise the existing
read boundary's denial path; they are credential-free contracts, not live E09
acceptance. Binding coverage: `node --test tests/runtime-wappmcp-binding.mjs`.
The existing public-server check in `node scripts/verify-wappmcp.mjs` also exercises
the binding with real SDK/public factory and synthetic authority/session. Search
can return a validated result; recent-read SDK rejection retains unknown intent
and cannot replay. No production tool registration or installed/callable claim
follows. Trusted startup/inventory, supported process supervision and separate
pairing/live permissions remain necessary.
